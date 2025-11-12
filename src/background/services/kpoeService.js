// ==================================================================================================
// EXTERNAL SERVICE - KPOE
// ==================================================================================================

import { CONFIG } from '../constants.js';
import { DataParser } from '../utils/dataParser.js';

export class KPoeService {
  static async fetch(songInfo, sourceOrder, forceReload, fetchOptions) {
    for (const baseUrl of CONFIG.KPOE_SERVERS) {
      const lyrics = await this.fetchFromAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions);
      if (lyrics) return lyrics;
    }
    return null;
  }

  static async fetchCustom(songInfo, customUrl, sourceOrder, forceReload, fetchOptions) {
    if (!customUrl) return null;
    return this.fetchFromAPI(customUrl, songInfo, sourceOrder, forceReload, fetchOptions);
  }

  static async fetchFromAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions) {
    const { title, artist, album, duration } = songInfo;
    const params = new URLSearchParams({ title, artist, duration });
    
    if (album) params.append('album', album);
    if (sourceOrder) params.append('source', sourceOrder);
    if (forceReload) params.append('forceReload', 'true');

    const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}v2/lyrics/get?${params}`;

    try {
      const response = await fetch(url, forceReload ? { cache: 'no-store' } : fetchOptions);
      
      if (response.ok) {
        const data = await response.json();
        return DataParser.parseKPoeFormat(data);
      }
      
      if (response.status === 404 || response.status === 403) {
        return null;
      }
      
      console.warn(`KPoe API failed (${response.status}): ${response.statusText}`);
      return null;
    } catch (error) {
      console.error(`Network error fetching from ${baseUrl}:`, error);
      return null;
    }
  }
}
