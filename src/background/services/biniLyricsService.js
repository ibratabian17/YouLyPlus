// ==================================================================================================
// EXTERNAL SERVICE - BINILYRICS (lyrics-api.binimum.org)
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';
import { parseAppleTTML } from '../../lib/parser.js';

const BINILYRICS_BASE_URL = 'https://lyrics-api.binimum.org';

export class BiniLyricsService {
  static async fetch(songInfo, fetchOptions = {}) {
    const query = `${songInfo.title || ''} ${songInfo.artist || ''}`.trim();
    if (!query) return null;

    const url = `${BINILYRICS_BASE_URL}/getLyrics?q=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const options = {
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal
    };

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      if (!data || !Array.isArray(data.results) || data.results.length === 0) {
        return null;
      }

      const match = this.findBestMatch(songInfo, data.results);
      if (!match || !match.lyricsUrl) return null;

      // Fetch the TTML file
      const lyricsController = new AbortController();
      const lyricsTimeoutId = setTimeout(() => lyricsController.abort(), 8000);
      const lyricsOptions = {
        ...fetchOptions,
        signal: fetchOptions.signal || lyricsController.signal
      };

      const lyricsResponse = await fetch(match.lyricsUrl, lyricsOptions);
      clearTimeout(lyricsTimeoutId);

      if (!lyricsResponse.ok) return null;

      const ttmlText = await lyricsResponse.text();
      if (!ttmlText) return null;

      const kpoeData = parseAppleTTML(ttmlText);
      if (!kpoeData || !kpoeData.lyrics || kpoeData.lyrics.length === 0) {
        return null;
      }

      kpoeData.metadata = {
        ...kpoeData.metadata,
        title: match.track_name || songInfo.title,
        artist: match.artist_name || songInfo.artist,
        album: match.album_name || songInfo.album,
        source: 'Apple (via BiniLyrics)'
      };

      return DataParser.parseKPoeFormat(kpoeData);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('BiniLyrics error:', error);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static findBestMatch(songInfo, results) {
    if (!results || results.length === 0) return null;

    // 1. Check exact ISRC match if available
    if (songInfo.isrc) {
      const isrcMatch = results.find(r => r.isrc && r.isrc.toUpperCase() === songInfo.isrc.toUpperCase());
      if (isrcMatch) return isrcMatch;
    }

    // 2. Normalize helper
    const normalize = str => (str || '').toLowerCase().replace(/[^\w\s]/gi, '').trim();
    const cleanTitle = str => normalize(str).replace(/\b(official video|official music video|remix|feat|ft)\b/gi, '').trim();

    const targetTitle = cleanTitle(songInfo.title);
    const targetArtist = normalize(songInfo.artist);

    let bestItem = null;
    let maxScore = -1;

    for (const item of results) {
      const itemTitle = cleanTitle(item.track_name);
      const itemArtist = normalize(item.artist_name);

      let score = 0;

      if (targetTitle && itemTitle && (itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle))) {
        score += 10;
        if (itemTitle === targetTitle) score += 5;
      }

      if (targetArtist && itemArtist && (itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist))) {
        score += 10;
        if (itemArtist === targetArtist) score += 5;
      }

      if (songInfo.duration > 0 && item.duration > 0) {
        const diff = Math.abs(item.duration - songInfo.duration);
        if (diff <= 3) score += 5;
        else if (diff <= 8) score += 2;
      }

      if (score > maxScore) {
        maxScore = score;
        bestItem = item;
      }
    }

    return bestItem || results[0];
  }
}
