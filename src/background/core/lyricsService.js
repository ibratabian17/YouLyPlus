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
import { parseAppleTTML } from '../../lib/parser.js';

export class LyricsService {
  static createCacheKey(songInfo) {
    const duration = songInfo.duration || '';
    return `${songInfo.title} - ${songInfo.artist} - ${songInfo.album} - ${duration}`;
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

    // Parse Apple Music TTML if provided
    if (songInfo.appleMusicTTML && typeof songInfo.appleMusicTTML === 'string') {
      try {
        songInfo.lyricsJSON = parseAppleTTML(songInfo.appleMusicTTML);
      } catch (error) {
        console.error('Error parsing Apple Music TTML:', error);
      }
    }

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
    const matched = localLyricsList.find(item => {
      if (item.songInfo.title !== songInfo.title || item.songInfo.artist !== songInfo.artist) {
        return false;
      }
      if (item.songInfo.duration && songInfo.duration) {
        return Math.abs(item.songInfo.duration - songInfo.duration) < 2;
      }
      return true;
    });

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
      const providers = this.getProviderOrder(settings, songInfo, settings.preferUnisonVideo);

      const controllers = new Map(
        providers.map(p => [p, new AbortController()])
      );

      let usedProvider = null;
      const promises = providers.map((provider, index) =>
        this.fetchFromProvider(provider, songInfo, settings, fetchOptions, forceReload, controllers.get(provider).signal)
          .then(result => {
            if (result && usedProvider === null) {
              usedProvider = provider;
            }
            return result;
          })
          .catch(() => null)
      );

      const lyrics = await this.raceWithEarlyExit(promises, providers, controllers);

      let finalLyrics = lyrics;

      if (Utilities.isEmptyLyrics(finalLyrics) && songInfo.videoId && songInfo.subtitle) {
        finalLyrics = await YouTubeService.fetchSubtitles(songInfo);
      }

      if (Utilities.isEmptyLyrics(finalLyrics)) {
        throw new Error('No lyrics found from any provider');
      }

      if (usedProvider === PROVIDERS.UNISON && songInfo.isVideo) {
        finalLyrics.ignoreSponsorblock = true;
      }

      const version = Date.now();
      const result = { lyrics: finalLyrics, version };

      state.setCached(cacheKey, result);

      if (settings.cacheStrategy !== 'none') {
        await lyricsDB.set({ key: cacheKey, lyrics: finalLyrics, version, timestamp: Date.now(), duration: songInfo.duration });
      }

      return result;

    } finally {
      state.deleteOngoingFetch(cacheKey);
    }
  }

  static raceWithEarlyExit(promises, providers, controllers) {
    return new Promise((resolve) => {
      const results = new Array(promises.length).fill(undefined);
      const pending = new Set(promises.map((_, i) => i));
      let won = false;

      const abortRemaining = () => {
        for (const i of pending) {
          controllers.get(providers[i])?.abort();
        }
      };

      const tryResolve = () => {
        if (won) return;

        const bestIdx = results.findIndex(
          (r, i) => !pending.has(i) && this.scoreLyrics(r) === 3
        );

        if (bestIdx !== -1) {
          const blockedByEarlier = [...pending].some(i => i < bestIdx);
          if (!blockedByEarlier) {
            won = true;
            abortRemaining();
            return resolve(results[bestIdx]);
          }
        }

        if (pending.size === 0) {
          const best = results.reduce((b, r) =>
            this.scoreLyrics(r) > this.scoreLyrics(b) ? r : b
            , null);
          resolve(best);
        }
      };

      promises.forEach((p, i) => {
        Promise.resolve(p).then(result => {
          if (won) return;
          results[i] = result;
          pending.delete(i);
          tryResolve();
        });
      });
    });
  }

  static scoreLyrics(lyrics) {
    if (Utilities.isEmptyLyrics(lyrics)) return 0;
    const type = (lyrics.type || '').toUpperCase();
    if (type === 'WORD') return 3;
    if (type === 'LINE') return 2;
    return 1;
  }

  static getProviderOrder(settings, songInfo = null, preferUnisonVideo = false) {
    const defaultOrder = ['kpoe', 'unison', 'lrclib'];

    let providersList = (settings.lyricsProviderOrder || '').split(',').map(p => p.trim()).filter(Boolean);
    if (!providersList.length) providersList = defaultOrder;

    let validProviders = providersList.filter(p => [
      PROVIDERS.KPOE, PROVIDERS.CUSTOM_KPOE, PROVIDERS.UNISON, PROVIDERS.LRCLIB
    ].includes(p));

    if (!settings.customKpoeUrl) {
      validProviders = validProviders.filter(p => p !== PROVIDERS.CUSTOM_KPOE);
    }

    if (preferUnisonVideo && songInfo?.isVideo && validProviders.includes(PROVIDERS.UNISON)) {
      const unisonIndex = validProviders.indexOf(PROVIDERS.UNISON);
      if (unisonIndex > 0) {
        validProviders.splice(unisonIndex, 1);
        validProviders.unshift(PROVIDERS.UNISON);
      }
    }

    return validProviders;
  }

  static async fetchFromProvider(provider, songInfo, settings, fetchOptions, forceReload, signal) {
    const opts = { ...fetchOptions, signal };
    switch (provider) {
      case PROVIDERS.KPOE:
        return KPoeService.fetch(songInfo, settings.lyricsSourceOrder, forceReload, opts);

      case PROVIDERS.CUSTOM_KPOE:
        if (settings.customKpoeUrl)
          return KPoeService.fetchCustom(songInfo, settings.customKpoeUrl, settings.lyricsSourceOrder, forceReload, opts);

        return null;
      case PROVIDERS.UNISON:
        return UnisonService.fetch(songInfo, opts);
        
      case PROVIDERS.LRCLIB:
        return LRCLibService.fetch(songInfo, opts);

      case PROVIDERS.LOCAL:
        const localResult = await this.checkLocalLyrics(songInfo);
        return localResult?.lyrics || null;

      default:
        return null;
    }
  }
}
