// ==================================================================================================
// MESSAGE HANDLER
// ==================================================================================================

import { MESSAGE_TYPES } from '../constants.js';
import { state } from '../storage/state.js';
import { lyricsDB, translationsDB, localLyricsDB } from '../storage/database.js';
import { LyricsService } from './lyricsService.js';
import { TranslationService } from './translationService.js';
import { SponsorBlockService } from '../services/sponsorblockService.js';
import { DataParser } from '../utils/dataParser.js';

export class MessageHandler {
  static handle(message, sender, sendResponse) {
    const handlers = {
      [MESSAGE_TYPES.FETCH_LYRICS]: () => this.fetchLyrics(message, sendResponse),
      [MESSAGE_TYPES.RESET_CACHE]: () => this.resetCache(sendResponse),
      [MESSAGE_TYPES.GET_CACHED_SIZE]: () => this.getCacheSize(sendResponse),
      [MESSAGE_TYPES.TRANSLATE_LYRICS]: () => this.translateLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_SPONSOR_SEGMENTS]: () => this.fetchSponsorSegments(message, sendResponse),
      [MESSAGE_TYPES.UPLOAD_LOCAL_LYRICS]: () => this.uploadLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.GET_LOCAL_LYRICS_LIST]: () => this.getLocalLyricsList(sendResponse),
      [MESSAGE_TYPES.DELETE_LOCAL_LYRICS]: () => this.deleteLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_LOCAL_LYRICS]: () => this.fetchLocalLyrics(message, sendResponse)
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
    if (message.songInfo.lyricsJSON && message.songInfo.lyricsJSON.lyrics.length > 0) {
      const lyrics = DataParser.parseKPoeFormat(message.songInfo.lyricsJSON);
        sendResponse({ success: true, lyrics, metadata: message.songInfo });
    } else {
      try {
        const { lyrics } = await LyricsService.getOrFetch(message.songInfo, message.forceReload);
        sendResponse({ success: true, lyrics, metadata: message.songInfo });
      } catch (error) {
        console.error(`Failed to fetch lyrics for "${message.songInfo?.title}":`, error);
        sendResponse({ success: false, error: error.message, metadata: message.songInfo });
      }
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
      const segments = await SponsorBlockService.fetch(message.videoId);
      sendResponse({ success: true, segments });
    } catch (error) {
      console.error(`Failed to fetch SponsorBlock segments:`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async resetCache(sendResponse) {
    try {
      state.clear();
      await Promise.all([
        lyricsDB.clear(),
        translationsDB.clear()
      ]);
      sendResponse({ success: true, message: "Cache reset successfully" });
    } catch (error) {
      console.error("Cache reset error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getCacheSize(sendResponse) {
    try {
      const [lyricsStats, translationsStats] = await Promise.all([
        lyricsDB.estimateSize(),
        translationsDB.estimateSize()
      ]);

      sendResponse({
        success: true,
        sizeKB: lyricsStats.sizeKB + translationsStats.sizeKB,
        cacheCount: lyricsStats.count + translationsStats.count
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
}
