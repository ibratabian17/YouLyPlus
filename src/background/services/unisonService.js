// ==================================================================================================
// EXTERNAL SERVICE - UNISON (unison.boidu.dev)
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';

const UNISON_BASE_URL = 'https://unison.boidu.dev';

export class UnisonService {
  static async fetch(songInfo, fetchOptions = {}) {
    // Try video ID lookup first (exact match)
    if (songInfo.videoId) {
      const result = await this.fetchByVideoId(songInfo.videoId, fetchOptions);
      if (result) return result;
    }

    // Fall back to metadata search
    return this.fetchByMetadata(songInfo, fetchOptions);
  }

  static async fetchByVideoId(videoId, fetchOptions) {
    const url = `${UNISON_BASE_URL}/lyrics?v=${encodeURIComponent(videoId)}`;
    return this.fetchAndParse(url, fetchOptions);
  }

  static async fetchByMetadata(songInfo, fetchOptions) {
    const params = new URLSearchParams({
      song: songInfo.title,
      artist: songInfo.artist
    });

    if (songInfo.album) params.append('album', songInfo.album);
    if (songInfo.duration > 0) params.append('duration', songInfo.duration);

    const url = `${UNISON_BASE_URL}/lyrics?${params}`;
    return this.fetchAndParse(url, fetchOptions);
  }

  static async fetchAndParse(url, fetchOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const json = await response.json();
      if (!json.success || !json.data) return null;

      return DataParser.parseUnisonFormat(json.data);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Unison error:', error);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
