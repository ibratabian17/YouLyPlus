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
    let lyrics = await this.fetchByMetadata(songInfo, fetchOptions);
    if (lyrics) return lyrics;

    if (songInfo.isVideo) {
      const cleanTitle = (songInfo.title || '')
        .replace('(Official Video)', '')
        .replace('(Official Music Video)', '')
        .trim();

      if (cleanTitle !== songInfo.title || songInfo.duration > 0) {
        lyrics = await this.fetchByMetadata({ ...songInfo, duration: 0, title: cleanTitle }, fetchOptions);
        if (lyrics) return lyrics;
      }
    }

    return null;
  }

  static async fetchByVideoId(videoId, fetchOptions) {
    const url = `${UNISON_BASE_URL}/lyrics?v=${encodeURIComponent(videoId)}`;
    const result = await this.fetchAndParse(url, fetchOptions);
    if (result) {
      result.byVideoId = true;
      if (!result.metadata) result.metadata = {};
      result.metadata.byVideoId = true;
    }
    return result;
  }

  static async fetchByMetadata(songInfo, fetchOptions) {
    const params = new URLSearchParams({
      song: songInfo.title,
      artist: songInfo.artist
    });

    if (songInfo.album) params.append('album', songInfo.album);
    if (songInfo.duration > 0) params.append('duration', songInfo.duration);

    const url = `${UNISON_BASE_URL}/lyrics?${params}`;
    const result = await this.fetchAndParse(url, fetchOptions);
    if (result) {
      result.byVideoId = false;
      if (!result.metadata) result.metadata = {};
      result.metadata.byVideoId = false;
    }
    return result;
  }

  static async fetchAndParse(url, fetchOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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
