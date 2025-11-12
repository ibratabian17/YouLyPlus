// ==================================================================================================
// EXTERNAL SERVICE - LRCLIB
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';

export class LRCLibService {
  static async fetch(songInfo, fetchOptions = {}) {
    const params = new URLSearchParams({
      artist_name: songInfo.artist,
      track_name: songInfo.title
    });
    
    if (songInfo.album) params.append('album_name', songInfo.album);

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
