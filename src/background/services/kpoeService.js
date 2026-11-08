// ==================================================================================================
// EXTERNAL SERVICE - KPOE
// ==================================================================================================

import { CONFIG } from '../constants.js';
import { DataParser } from '../utils/dataParser.js';

export class KPoeService {
  static lastWorkingServer = null;

  static async fetch(songInfo, sourceOrder, forceReload, fetchOptions) {
    const servers = this.getPrioritizedServers();

    for (const baseUrl of servers) {
      let lyrics = await this.fetchFromAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions);
      if (lyrics) {
        this.lastWorkingServer = baseUrl;
        return lyrics;
      }

      if (songInfo.isVideo) {
        const cleanTitle = songInfo.title
          .replace('(Official Video)', '')
          .replace('(Official Music Video)', '')
          .trim();

        if (cleanTitle !== songInfo.title || songInfo.duration > 0) {
          lyrics = await this.fetchFromAPI(baseUrl, { ...songInfo, duration: 0, title: cleanTitle }, sourceOrder, forceReload, fetchOptions);
          if (lyrics) {
            this.lastWorkingServer = baseUrl;
            return lyrics;
          }
        }
      }
    }
    return null;
  }

  static async fetchCustom(songInfo, customUrl, sourceOrder, forceReload, fetchOptions) {
    if (!customUrl) return null;
    let lyrics = await this.fetchFromAPI(customUrl, songInfo, sourceOrder, forceReload, fetchOptions);
    if (lyrics) return lyrics;

    if (songInfo.isVideo) {
      lyrics = await this.fetchFromAPI(customUrl, { ...songInfo, duration: 0 }, sourceOrder, forceReload, fetchOptions);
      if (lyrics) return lyrics;
    }
    return null;
  }

  static async fetchFromAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions) {
    const { title, artist, album, duration, isrc } = songInfo;
    const params = new URLSearchParams({ title, artist });

    if (duration > 0) params.append('duration', duration);
    if (album) params.append('album', album);
    if (isrc) params.append('isrc', isrc);
    if (sourceOrder) params.append('source', sourceOrder);
    if (forceReload) params.append('forceReload', 'true');

    const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}v2/lyrics/get?${params}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        ...(forceReload ? { cache: 'no-store' } : fetchOptions),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const parsed = DataParser.parseKPoeFormat(data);
        if (parsed) {
          const title = parsed.metadata?.title || songInfo.title || '';
          const artist = parsed.metadata?.artist || songInfo.artist || '';
          const album = parsed.metadata?.album || songInfo.album || '';
          const dur = parsed.metadata?.duration || songInfo.duration || 0;

          const queryParams = new URLSearchParams();
          if (title) queryParams.set('title', title);
          if (artist) queryParams.set('artist', artist);
          if (album) queryParams.set('album', album);
          if (dur > 0) queryParams.set('duration', Math.round(dur));

          if (!parsed.metadata) parsed.metadata = {};
          parsed.metadata.sourceUrl = `https://youlyplus.prjktla.my.id/findlyrics.html?${queryParams.toString()}`;
        }
        return parsed;
      }

      if (response.status === 404 || response.status === 403) {
        if (response.status === 404 && isrc) {
          const fallbackSongInfo = { ...songInfo };
          delete fallbackSongInfo.isrc;
          return await this.fetchFromAPI(baseUrl, fallbackSongInfo, sourceOrder, forceReload, fetchOptions);
        }
        return null;
      }

      console.warn(`KPoe API failed (${response.status}): ${response.statusText}`);
      return null;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`Network error fetching from ${baseUrl}:`, error);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static getPrioritizedServers() {
    if (this.lastWorkingServer && CONFIG.KPOE_SERVERS.includes(this.lastWorkingServer)) {
      return [
        this.lastWorkingServer,
        ...CONFIG.KPOE_SERVERS.filter(s => s !== this.lastWorkingServer)
      ];
    }
    return CONFIG.KPOE_SERVERS;
  }
}
