// ==================================================================================================
// EXTERNAL SERVICE - LRCLIB
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';

export class LRCLibService {
  static async fetch(songInfo, fetchOptions = {}) {
    let lyrics = await this.fetchFromAPI(songInfo, fetchOptions);
    if (lyrics) return lyrics;

    if (songInfo.isVideo) {
      const cleanTitle = (songInfo.title || '')
        .replace('(Official Video)', '')
        .replace('(Official Music Video)', '')
        .trim();

      if (cleanTitle !== songInfo.title || songInfo.duration > 0) {
        lyrics = await this.fetchFromAPI({ ...songInfo, duration: 0, title: cleanTitle }, fetchOptions);
        if (lyrics) return lyrics;
      }
    }

    return null;
  }

  static async fetchFromAPI(songInfo, fetchOptions = {}) {
    const params = new URLSearchParams({
      artist_name: songInfo.artist,
      track_name: songInfo.title
    });
    
    if (songInfo.album) params.append('album_name', songInfo.album);
    if (songInfo.duration > 0) params.append('duration', songInfo.duration);

    const url = `https://lrclib.net/api/get?${params}`;

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) return null;
      
      const data = await response.json();
      return DataParser.parseLRCLibFormat(data);
    } catch (error) {
      console.error("LRCLIB error:", error);
      return null;
    }
  }
}
