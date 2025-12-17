// ==================================================================================================
// LYRICS SERVICE
// ==================================================================================================

import { state } from '../storage/state.js';
import { lyricsDB, localLyricsDB } from '../storage/database.js';
import { SettingsManager } from '../storage/settings.js';
import { CONFIG, PROVIDERS } from '../constants.js';
import { DataParser } from '../utils/dataParser.js';
import { Utilities } from '../utils/utilities.js';
import { KPoeService } from '../services/kpoeService.js';
import { LRCLibService } from '../services/lrclibService.js';
import { YouTubeService } from '../services/youtubeService.js';

export class LyricsService {
  static createCacheKey(songInfo) {
    return `${songInfo.title} - ${songInfo.artist} - ${songInfo.album} - ${songInfo.duration}`;
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
      for (const provider of providers) {
        lyrics = await this.fetchFromProvider(provider, songInfo, settings, fetchOptions, forceReload);
        if (!Utilities.isEmptyLyrics(lyrics)) break;
      }

      // Fallback to YouTube subtitles
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

  static getProviderOrder(settings) {
    const allProviders = Object.values(PROVIDERS).filter(
      p => p !== PROVIDERS.GOOGLE && p !== PROVIDERS.GEMINI
    );

    return [
      settings.lyricsProvider,
      ...allProviders.filter(p => p !== settings.lyricsProvider)
    ];
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
