// ==================================================================================================
// EXTERNAL SERVICE - LRCRED (lrc.red)
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';
import { parseAppleTTML } from '../../lib/parser.js';

const LRCRED_BASE_URL = 'https://lrc.red/api/v1';

export class LrcredService {
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
    const query = `${songInfo.title || ''} ${songInfo.artist || ''}`.trim();
    if (!query) return null;

    const url = `${LRCRED_BASE_URL}?q=${encodeURIComponent(query)}`;

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
        source: 'lrc.red',
        provider: 'lrcred'
      };

      const parsed = DataParser.parseKPoeFormat(kpoeData);
      if (parsed) {
        parsed.provider = 'lrcred';
        if (!parsed.metadata) parsed.metadata = {};
        parsed.metadata.provider = 'lrcred';
      }
      return parsed;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('lrc.red error:', error);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static findBestMatch(songInfo, results) {
    if (!results || !Array.isArray(results) || results.length === 0) return null;

    const targetDuration = Number(songInfo.duration);

    // 1. Check exact ISRC match if available
    if (songInfo.isrc) {
      const targetIsrc = songInfo.isrc.trim().toUpperCase();
      const isrcMatch = results.find(r => r.isrc && r.isrc.trim().toUpperCase() === targetIsrc);
      if (isrcMatch) return isrcMatch;
    }

    // 2. Normalization & cleaning helpers
    const normalize = str => {
      if (!str) return '';
      return str
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const cleanBaseTitle = str => {
      if (!str) return '';
      let s = str.toLowerCase();
      // Remove bracketed/parenthesized tags like (feat. ...), [feat. ...], (with ...), [prod. ...], (remastered)
      s = s.replace(/[\(\[](?:feat\.?|ft\.?|with|prod\.?|bonus track|remaster(?:ed)?)[^\)\]]*[\)\]]/gi, '');
      // Remove trailing/inline feat/ft phrases
      s = s.replace(/\b(?:feat\.?|ft\.?|with)\s+.*$/gi, '');
      // Remove video / audio tags like (Official Video), [Official Music Video], etc.
      s = s.replace(/[\(\[](?:official|music video|video|audio|lyrics?|visualizer|album version|explicit)[^\)\]]*[\)\]]/gi, '');
      return normalize(s);
    };

    const extractArtists = str => {
      if (!str) return [];
      return str
        .split(/[,&/]|(?:\b(?:feat\.?|ft\.?|with|x)\b)/i)
        .map(a => normalize(a))
        .filter(Boolean);
    };

    const MODIFIER_KEYWORDS = [
      'slowed', 'reverb', 'remix', 'mixed', 'dj mix', 'mashup',
      'cover', 'tribute', 'karaoke', 'instrumental', 'acoustic',
      'sped up', 'speed up', 'live', 'edit', 'versión', 'version',
      'bpm', 'guitar', 'piano', 'lofi', 'lo-fi', 'nightcore',
      'club mix', 'extended mix', 'radio edit'
    ];

    const targetFullTitle = normalize(songInfo.title);
    const targetBaseTitle = cleanBaseTitle(songInfo.title);
    const targetArtist = normalize(songInfo.artist);
    const targetAlbum = normalize(songInfo.album);

    const targetModifiers = MODIFIER_KEYWORDS.filter(kw =>
      (songInfo.title && songInfo.title.toLowerCase().includes(kw)) ||
      (songInfo.album && songInfo.album.toLowerCase().includes(kw))
    );

    let bestItem = null;
    let maxScore = -Infinity;

    for (const item of results) {
      const itemDuration = Number(item.duration);
      if (targetDuration > 0 && itemDuration > 0) {
        if (Math.abs(itemDuration - targetDuration) > 2) {
          continue;
        }
      }

      const itemFullTitle = normalize(item.track_name);
      const itemBaseTitle = cleanBaseTitle(item.track_name);
      const itemArtist = normalize(item.artist_name);
      const itemAlbum = normalize(item.album_name);

      let score = 0;

      // Title matching
      if (targetFullTitle && itemFullTitle && targetFullTitle === itemFullTitle) {
        score += 50; // Exact full title match
      } else if (targetBaseTitle && itemBaseTitle) {
        if (targetBaseTitle === itemBaseTitle) {
          score += 35; // Exact base title match
        } else if (itemBaseTitle.includes(targetBaseTitle) || targetBaseTitle.includes(itemBaseTitle)) {
          score += 15; // Partial title match
        } else {
          score -= 40; // Title mismatch
        }
      }

      // Artist matching
      if (targetArtist && itemArtist) {
        if (targetArtist === itemArtist) {
          score += 30; // Exact artist match
        } else if (itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist)) {
          score += 15;
        } else {
          const targetArtists = extractArtists(songInfo.artist);
          const itemArtists = extractArtists(item.artist_name);
          const hasOverlap = targetArtists.some(ta => itemArtists.some(ia => ia === ta || ia.includes(ta) || ta.includes(ia)));
          if (hasOverlap) {
            score += 10;
          } else {
            score -= 50; // Completely different artist (e.g. cover artist)
          }
        }
      }

      // Album matching
      if (targetAlbum && itemAlbum) {
        if (targetAlbum === itemAlbum) {
          score += 35; // Exact album match
        } else if (itemAlbum.includes(targetAlbum) || targetAlbum.includes(itemAlbum)) {
          score += 20; // Partial album match
        }

        const targetIsSingle = targetAlbum.includes('single');
        const itemIsSingle = itemAlbum.includes('single');
        if (!targetIsSingle && itemIsSingle) {
          score -= 15; // Penalize single version when playing full album track
        } else if (targetIsSingle && itemIsSingle) {
          score += 10;
        }
      }

      // Duration matching
      if (targetDuration > 0 && itemDuration > 0) {
        const diff = Math.abs(itemDuration - targetDuration);
        if (diff === 0) {
          score += 25;
        } else if (diff <= 1) {
          score += 20;
        } else if (diff <= 2) {
          score += 15;
        }
      }

      // Timing type quality bonus (TTML word-synced vs line-synced vs unsynced)
      if (item.timing_type === 'word') {
        score += 15;
      } else if (item.timing_type === 'line') {
        score += 8;
      } else {
        score -= 10;
      }

      // Modifier / remix penalty
      const itemModifiers = MODIFIER_KEYWORDS.filter(kw =>
        (item.track_name && item.track_name.toLowerCase().includes(kw)) ||
        (item.album_name && item.album_name.toLowerCase().includes(kw))
      );
      for (const kw of itemModifiers) {
        if (!targetModifiers.includes(kw)) {
          score -= 30; // Mismatched modifier (remix, slowed, reverb, DJ mix, etc.)
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestItem = item;
      }
    }

    if (bestItem && maxScore > 0) {
      return bestItem;
    }

    return null;
  }
}
