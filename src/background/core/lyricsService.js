// ==================================================================================================
// LYRICS SERVICE
// ==================================================================================================

import { state } from '../storage/state.js';
import { lyricsDB, localLyricsDB, translationsDB } from '../storage/database.js';
import { SettingsManager } from '../storage/settings.js';
import { CONFIG, PROVIDERS } from '../constants.js';
import { DataParser } from '../utils/dataParser.js';
import { Utilities } from '../utils/utilities.js';
import { KPoeService } from '../services/kpoeService.js';
import { LRCLibService } from '../services/lrclibService.js';
import { UnisonService } from '../services/unisonService.js';
import { YouTubeService } from '../services/youtubeService.js';

export class LyricsService {
  static createCacheKey(songInfo) {
    return `${songInfo.title} - ${songInfo.artist} - ${songInfo.album} - ${songInfo.duration}`;
  }

  static async clearExpiredCache() {
    try {
      const settings = await SettingsManager.get({ cacheStrategy: 'aggressive' });

      if (settings.cacheStrategy === 'none') {
        const stats = await lyricsDB.estimateSize();
        if (stats.count > 0) {
          await Promise.all([lyricsDB.clear(), translationsDB.clear()]);
          console.log('Cleared all cache as strategy is none.');
        }
        return;
      }

      const expirationTime = CONFIG.CACHE_EXPIRY[settings.cacheStrategy];
      if (!expirationTime) return;

      const [deletedLyrics, deletedTrans] = await Promise.all([
        lyricsDB.deleteExpired(expirationTime),
        translationsDB.deleteExpired(expirationTime)
      ]);

      if (deletedLyrics > 0 || deletedTrans > 0) {
        console.log(`Cleared expired cache: ${deletedLyrics} lyrics, ${deletedTrans} translations.`);
      }
    } catch (error) {
      console.error('Error clearing expired cache:', error);
    }
  }

  static async getOrFetch(songInfo, forceReload = false) {
    let embeddedFallback = null;

    if (songInfo.lyricsJSON && songInfo.lyricsJSON.lyrics.length > 0) {
      const settings = await SettingsManager.get({ appleMusicTTMLBypass: false });
      const lyricsJsonType = songInfo.lyricsJSON.type.toUpperCase();

      const embeddedResult = {
        lyrics: DataParser.parseKPoeFormat(songInfo.lyricsJSON),
        version: Date.now()
      };

      if (!settings.appleMusicTTMLBypass || lyricsJsonType === "WORD") {
        console.log('Using embedded lyrics (platform specific)');
        return embeddedResult;
      }

      console.log('Apple Music TTML bypass active. Attempting to fetch external lyrics...');
      embeddedFallback = embeddedResult;
    }

    const cacheKey = this.createCacheKey(songInfo);
    let result = null;

    if (!forceReload) {
      if (state.hasCached(cacheKey)) {
        result = state.getCached(cacheKey);
      } else {
        result = await this.getFromDB(cacheKey) || await this.checkLocalLyrics(songInfo);
        if (result) state.setCached(cacheKey, result);
      }
    }

    if (!result) {
      if (state.hasOngoingFetch(cacheKey)) {
        result = await state.getOngoingFetch(cacheKey);
      } else {
        const fetchPromise = this.fetchNewLyrics(songInfo, cacheKey, forceReload);
        state.setOngoingFetch(cacheKey, fetchPromise);
        result = await fetchPromise;
      }
    }

    if (embeddedFallback) {
      if (!result || (result.type && result.type.toUpperCase() !== "WORD")) {
        console.log('Fetched lyrics not WORD synced. Reverting to embedded Apple Music lyrics.');
        return embeddedFallback;
      }
    }

    return result;
  }

  static async getFromDB(key) {
    const settings = await SettingsManager.get({ cacheStrategy: 'aggressive' });

    if (settings.cacheStrategy === 'none') {
      return null;
    }

    const result = await lyricsDB.get(key);

    if (!result) return null;

    const now = Date.now();
    const expirationTime = CONFIG.CACHE_EXPIRY[settings.cacheStrategy];
    const age = now - result.timestamp;

    if (age < expirationTime) {
      return { lyrics: result.lyrics, version: result.version };
    }

    await lyricsDB.delete(key);
    return null;
  }

  static async checkLocalLyrics(songInfo) {
    const localLyricsList = await localLyricsDB.getAll();
    const matched = localLyricsList.find(item =>
      item.songInfo.title === songInfo.title &&
      item.songInfo.artist === songInfo.artist
    );

    if (matched) {
      const fetchedLocal = await localLyricsDB.get(matched.songId);
      if (fetchedLocal) {
        console.log(`Found local lyrics for "${songInfo.title}"`);
        return {
          lyrics: DataParser.parseKPoeFormat(fetchedLocal.lyrics),
          version: fetchedLocal.timestamp || matched.songId
        };
      }
    }

    return null;
  }

  static async fetchNewLyrics(songInfo, cacheKey, forceReload) {
    try {
      const settings = await SettingsManager.getLyricsSettings();
      const fetchOptions = settings.cacheStrategy === 'none' ? { cache: 'no-store' } : {};

      const providers = this.getProviderOrder(settings);
      
      let lyrics = null;
      let highestScore = -1;

      const preferredProvider = providers[0];
      const preferredLyrics = await this.fetchFromProvider(preferredProvider, songInfo, settings, fetchOptions, forceReload);
      
      if (!Utilities.isEmptyLyrics(preferredLyrics)) {
        const score = this.scoreLyrics(preferredLyrics);
        if (score === 3) {
          lyrics = preferredLyrics;
        } else {
          lyrics = preferredLyrics;
          highestScore = score;
        }
      }

      if (!lyrics || highestScore < 3) {
        const remainingProviders = providers.slice(1);
        
        const fetchPromises = remainingProviders.map(async (provider, index) => {
          const result = await this.fetchFromProvider(provider, songInfo, settings, fetchOptions, forceReload);
          return { lyrics: result, index: index + 1 };
        });

        const results = await Promise.allSettled(fetchPromises);

        for (const res of results) {
          if (res.status === 'fulfilled' && !Utilities.isEmptyLyrics(res.value.lyrics)) {
            const score = this.scoreLyrics(res.value.lyrics);
            
            if (score > highestScore || (score === highestScore && !lyrics)) {
              lyrics = res.value.lyrics;
              highestScore = score;
            }
          }
        }
      }

      if (Utilities.isEmptyLyrics(lyrics) && songInfo.videoId && songInfo.subtitle) {
        lyrics = await YouTubeService.fetchSubtitles(songInfo);
      }

      if (Utilities.isEmptyLyrics(lyrics)) {
        throw new Error('No lyrics found from any provider');
      }

      const version = Date.now();
      const result = { lyrics, version };

      state.setCached(cacheKey, result);

      if (settings.cacheStrategy !== 'none') {
        await lyricsDB.set({ key: cacheKey, lyrics, version, timestamp: Date.now(), duration: songInfo.duration });
      }

      return result;

    } finally {
      state.deleteOngoingFetch(cacheKey);
    }
  }

  static scoreLyrics(lyrics) {
    if (Utilities.isEmptyLyrics(lyrics)) return 0;
    const type = (lyrics.type || '').toUpperCase();
    if (type === 'WORD') return 3;
    if (type === 'LINE') return 2;
    return 1;
  }

  static getProviderOrder(settings) {
    const defaultOrder = ['kpoe', 'unison', 'lrclib'];
    
    let providersList = (settings.lyricsProviderOrder || '').split(',').map(p => p.trim()).filter(Boolean);
    if (!providersList.length) providersList = defaultOrder;

    let validProviders = providersList.filter(p => [
      PROVIDERS.KPOE, PROVIDERS.CUSTOM_KPOE, PROVIDERS.UNISON, PROVIDERS.LRCLIB
    ].includes(p));
    
    if (!settings.customKpoeUrl) {
      validProviders = validProviders.filter(p => p !== PROVIDERS.CUSTOM_KPOE);
    }

    return validProviders;
  }

  static async fetchFromProvider(provider, songInfo, settings, fetchOptions, forceReload) {
    switch (provider) {
      case PROVIDERS.KPOE:
        return KPoeService.fetch(songInfo, settings.lyricsSourceOrder, forceReload, fetchOptions);

      case PROVIDERS.CUSTOM_KPOE:
        if (settings.customKpoeUrl) {
          return KPoeService.fetchCustom(
            songInfo,
            settings.customKpoeUrl,
            settings.lyricsSourceOrder,
            forceReload,
            fetchOptions
          );
        }
        return null;

      case PROVIDERS.UNISON:
        return UnisonService.fetch(songInfo, fetchOptions);

      case PROVIDERS.LRCLIB:
        return LRCLibService.fetch(songInfo, fetchOptions);

      case PROVIDERS.LOCAL:
        const localResult = await this.checkLocalLyrics(songInfo);
        return localResult?.lyrics || null;

      default:
        return null;
    }
  }
}
