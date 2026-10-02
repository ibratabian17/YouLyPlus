// ==================================================================================================
// MESSAGE HANDLER
// ==================================================================================================

import { MESSAGE_TYPES } from '../constants.js';
import { state } from '../storage/state.js';
import { lyricsDB, translationsDB, localLyricsDB } from '../storage/database.js';
import { LyricsService } from './lyricsService.js';
import { TranslationService } from './translationService.js';
import { SponsorBlockService } from '../services/sponsorblockService.js';
import { YouTubeService } from '../services/youtubeService.js';
import { DataParser } from '../utils/dataParser.js';
import { dictionaryService } from '../services/romanization/dictionaryService.js';

export class MessageHandler {
  static handle(message, sender, sendResponse) {
    if (!message || message.target === 'rawi-offscreen') {
      return false;
    }

    const handlers = {
      [MESSAGE_TYPES.FETCH_LYRICS]: () => this.fetchLyrics(message, sendResponse),
      [MESSAGE_TYPES.RESET_CACHE]: () => this.resetCache(message, sendResponse),
      [MESSAGE_TYPES.GET_CACHED_SIZE]: () => this.getCacheSize(sendResponse),
      [MESSAGE_TYPES.TRANSLATE_LYRICS]: () => this.translateLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_SPONSOR_SEGMENTS]: () => this.fetchSponsorSegments(message, sendResponse),
      [MESSAGE_TYPES.FETCH_SUBTITLES]: () => this.fetchSubtitles(message, sendResponse),
      [MESSAGE_TYPES.UPLOAD_LOCAL_LYRICS]: () => this.uploadLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.GET_LOCAL_LYRICS_LIST]: () => this.getLocalLyricsList(sendResponse),
      [MESSAGE_TYPES.DELETE_LOCAL_LYRICS]: () => this.deleteLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_LOCAL_LYRICS]: () => this.fetchLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_IMAGE]: () => this.fetchImage(message, sendResponse),
      [MESSAGE_TYPES.SAVE_LYRICS_OFFSET]: () => this.saveLyricsOffset(message, sendResponse),
      [MESSAGE_TYPES.GET_LYRICS_OFFSET]: () => this.getLyricsOffset(message, sendResponse),
      [MESSAGE_TYPES.SWITCH_LYRICS_PROVIDER]: () => this.switchLyricsProvider(message, sendResponse),
      [MESSAGE_TYPES.GET_AVAILABLE_PROVIDERS]: () => this.getAvailableLyricsProviders(message, sendResponse),
      [MESSAGE_TYPES.GET_DICTIONARY_STATUS]: () => this.getDictionaryStatus(message, sendResponse),
      [MESSAGE_TYPES.DOWNLOAD_DICTIONARY]: () => this.downloadDictionary(message, sendResponse),
      [MESSAGE_TYPES.DELETE_DICTIONARY]: () => this.deleteDictionary(message, sendResponse)
    };

    const handler = handlers[message.type];

    if (handler) {
      handler().catch(error => {
        console.error(`Error handling ${message.type}:`, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }

    console.warn("Unknown message type:", message.type);
    sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
    return false;
  }

  static async fetchLyrics(message, sendResponse) {
    try {
      const { lyrics } = await LyricsService.getOrFetch(message.songInfo, message.forceReload, message.requestedSource);
      const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
      sendResponse({ success: true, lyrics, metadata: message.songInfo, availableProviders });
    } catch (error) {
      sendResponse({ success: false, error: error.message, metadata: message.songInfo });
    }
  }

  static async translateLyrics(message, sendResponse) {
    try {
      const translatedLyrics = await TranslationService.getOrFetch(
        message.songInfo,
        message.action,
        message.targetLang,
        message.forceReload
      );
      sendResponse({ success: true, translatedLyrics });
    } catch (error) {
      console.error("Translation error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchSponsorSegments(message, sendResponse) {
    try {
      if (message.ignoreSponsorblock) {
        console.log('SponsorBlock skipped: ignoreSponsorblock flag is set');
        sendResponse({ success: true, segments: [] });
        return;
      }

      const segments = await SponsorBlockService.fetch(message.videoId);
      sendResponse({ success: true, segments });
    } catch (error) {
      console.error(`Failed to fetch SponsorBlock segments:`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchSubtitles(message, sendResponse) {
    try {
      const subtitles = await YouTubeService.fetchSubtitles(message.songInfo);
      sendResponse({ success: true, subtitles });
    } catch (error) {
      console.error(`Failed to fetch subtitles:`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async resetCache(message, sendResponse) {
    try {
      const target = message?.target || 'all';
      if (target === 'lyrics') {
        state.clear('lyrics');
        await lyricsDB.clear();
      } else if (target === 'translations') {
        state.clear('translations');
        await translationsDB.deleteWhere(record => record.key && !record.key.includes(' - romanize - '));
      } else if (target === 'romanization' || target === 'transliteration') {
        state.clear('romanization');
        await translationsDB.deleteWhere(record => record.key && record.key.includes(' - romanize - '));
      } else {
        state.clear('all');
        await Promise.all([
          lyricsDB.clear(),
          translationsDB.clear()
        ]);
      }
      sendResponse({ success: true, message: "Cache reset successfully" });
    } catch (error) {
      console.error("Cache reset error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getCacheSize(sendResponse) {
    try {
      const [lyricsStats, translationsBreakdown, totalTransStats] = await Promise.all([
        lyricsDB.estimateSize(),
        translationsDB.getBreakdown(),
        translationsDB.estimateSize()
      ]);

      const lyricsSizeMB = (lyricsStats.sizeKB / 1024).toFixed(2);
      const transSizeMB = (translationsBreakdown.translations.sizeKB / 1024).toFixed(2);
      const romSizeMB = (translationsBreakdown.romanizations.sizeKB / 1024).toFixed(2);

      const totalSizeKB = lyricsStats.sizeKB + totalTransStats.sizeKB;
      const totalSizeMB = (totalSizeKB / 1024).toFixed(2);
      const totalCount = lyricsStats.count + totalTransStats.count;

      sendResponse({
        success: true,
        lyrics: {
          sizeKB: lyricsStats.sizeKB,
          sizeMB: lyricsSizeMB,
          count: lyricsStats.count
        },
        translations: {
          sizeKB: translationsBreakdown.translations.sizeKB,
          sizeMB: transSizeMB,
          count: translationsBreakdown.translations.count
        },
        romanizations: {
          sizeKB: translationsBreakdown.romanizations.sizeKB,
          sizeMB: romSizeMB,
          count: translationsBreakdown.romanizations.count
        },
        sizeKB: totalSizeKB,
        sizeMB: totalSizeMB,
        cacheCount: totalCount
      });
    } catch (error) {
      console.error("Get cache size error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async uploadLocalLyrics(message, sendResponse) {
    try {
      const songId = `${message.songInfo.title}-${message.songInfo.artist}-${Date.now()}`;
      await localLyricsDB.set({
        songId,
        songInfo: message.songInfo,
        lyrics: message.jsonLyrics,
        timestamp: Date.now()
      });
      sendResponse({ success: true, message: "Local lyrics uploaded successfully", songId });
    } catch (error) {
      console.error("Error uploading local lyrics:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getLocalLyricsList(sendResponse) {
    try {
      const lyricsList = await localLyricsDB.getAll();
      const mappedList = lyricsList.map(item => ({
        songId: item.songId,
        songInfo: item.songInfo,
        timestamp: item.timestamp
      }));
      sendResponse({ success: true, lyricsList: mappedList });
    } catch (error) {
      console.error("Error getting local lyrics list:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async deleteLocalLyrics(message, sendResponse) {
    try {
      await localLyricsDB.delete(message.songId);
      sendResponse({ success: true, message: "Local lyrics deleted successfully" });
    } catch (error) {
      console.error("Error deleting local lyrics:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchLocalLyrics(message, sendResponse) {
    try {
      const localLyrics = await localLyricsDB.get(message.songId);
      if (localLyrics) {
        sendResponse({
          success: true,
          lyrics: localLyrics.lyrics,
          metadata: localLyrics.songInfo
        });
      } else {
        sendResponse({ success: false, error: "Local lyrics not found" });
      }
    } catch (error) {
      console.error("Error fetching local lyrics:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchImage(message, sendResponse) {
    try {
      const response = await fetch(message.url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        sendResponse({ success: true, dataUrl: reader.result });
      };
      reader.onerror = () => {
        sendResponse({ success: false, error: "Failed to read blob" });
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Error fetching image:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async saveLyricsOffset(message, sendResponse) {
    try {
      await LyricsService.saveLyricsOffset(message.songInfo, message.offsetMs);
      sendResponse({ success: true });
    } catch (error) {
      console.error("Error saving lyrics offset:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getLyricsOffset(message, sendResponse) {
    try {
      const offsetMs = await LyricsService.getLyricsOffset(message.songInfo);
      sendResponse({ success: true, offsetMs });
    } catch (error) {
      console.error("Error getting lyrics offset:", error);
      sendResponse({ success: false, error: error.message, offsetMs: 0 });
    }
  }

  static async switchLyricsProvider(message, sendResponse) {
    try {
      const result = await LyricsService.getProviderLyrics(message.songInfo, message.provider);
      if (result && result.lyrics) {
        const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
        sendResponse({ success: true, lyrics: result.lyrics, provider: message.provider, fromCache: result.fromCache, availableProviders });
      } else {
        sendResponse({ success: false, error: "No lyrics available from this provider" });
      }
    } catch (error) {
      console.error(`Failed to switch lyrics provider to "${message.provider}":`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getAvailableLyricsProviders(message, sendResponse) {
    try {
      const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
      sendResponse({ success: true, availableProviders });
    } catch (error) {
      console.error("Error getting available providers:", error);
      sendResponse({ success: false, error: error.message, availableProviders: [] });
    }
  }

  static async getDictionaryStatus(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      const status = isArabic
        ? await dictionaryService.getCattStatus()
        : await dictionaryService.getKuromojiStatus();
      sendResponse({ success: true, status });
    } catch (error) {
      console.error("Error getting dictionary status:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async downloadDictionary(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      const result = isArabic
        ? await dictionaryService.downloadCatt()
        : await dictionaryService.downloadKuromoji();
      sendResponse({ success: true, result });
    } catch (error) {
      console.error("Error downloading dictionary:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async deleteDictionary(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      if (isArabic) {
        await dictionaryService.deleteCatt();
      } else {
        await dictionaryService.deleteKuromoji();
      }
      sendResponse({ success: true });
    } catch (error) {
      console.error("Error deleting dictionary:", error);
      sendResponse({ success: false, error: error.message });
    }
  }
}
