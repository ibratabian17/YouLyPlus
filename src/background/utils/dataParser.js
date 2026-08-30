// ==================================================================================================
// DATA PARSERS
// ==================================================================================================

import { parseSyncedLyrics, parseAppleTTML } from '../../lib/parser.js';

export class DataParser {
  static parseKPoeFormat(data) {
    if (!data?.lyrics || !Array.isArray(data.lyrics) || data.lyrics.length === 0) {
      return null;
    }

    return {
      type: data.type,
      data: data.lyrics.map(item => {
        const startTime = Number(item.time || 0) / 1000;
        const duration = Number(item.duration || 0) / 1000;

        const syllabus = (item.syllabus || []).map(syl => ({
          text: syl.text || '',
          time: Number(syl.time || 0),
          duration: Number(syl.duration || 0),
          isBackground: syl.isBackground || false
        }));

        let lineRomanizedText = undefined;
        let romanizedSyllabus = undefined;

        if (item.transliteration) {
          if (Array.isArray(item.transliteration.syllabus) &&
            item.transliteration.syllabus.length === syllabus.length &&
            syllabus.length > 0) {
            romanizedSyllabus = syllabus.map((syl, index) => ({
              ...syl,
              romanizedText: item.transliteration.syllabus[index].text || syl.text
            }));
            lineRomanizedText = item.transliteration.text || item.text;
          } else if (item.transliteration.text) {
            lineRomanizedText = item.transliteration.text;
          }
        }

        return {
          text: item.text || '',
          startTime,
          duration,
          endTime: startTime + duration,
          syllabus: romanizedSyllabus || syllabus,
          element: item.element || [],
          romanizedText: lineRomanizedText,
          translation: item.translation || null
        };
      }),
      metadata: {
        ...data.metadata,
        source: `${data.metadata.source}`
      },
      ignoreSponsorblock: data.ignoreSponsorblock || data.metadata.ignoreSponsorblock
    };
  }

  static parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;

    const timeRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const lines = data.syncedLyrics.split('\n');

    const matches = lines
      .map(line => timeRegex.exec(line))
      .filter(Boolean)
      .map(match => ({
        startTime: parseInt(match[1], 10) * 60 +
          parseInt(match[2], 10) +
          parseInt(match[3], 10) / (match[3].length === 2 ? 100 : 1000),
        text: match[4].trim()
      }));

    if (matches.length === 0) return null;

    const parsedLines = matches
      .map((current, i) => {
        const endTime = i < matches.length - 1
          ? matches[i + 1].startTime
          : current.startTime + 5;

        return {
          ...current,
          endTime,
          duration: endTime - current.startTime
        };
      })
      .filter(line => line.text.trim() !== "♪" && line.text.trim() !== "");

    return {
      type: 'Line',
      data: parsedLines,
      metadata: {
        title: data.trackName,
        artist: data.artistName,
        album: data.albumName,
        duration: data.duration,
        source: "LRCLIB"
      }
    };
  }

  static parseYouTubeSubtitles(data, songInfo) {
    if (!data?.events?.length) return null;

    const rawEvents = data.events;
    const parsedLines = [];

    for (let eIdx = 0; eIdx < rawEvents.length; eIdx++) {
      const event = rawEvents[eIdx];
      if (!event.segs?.length) continue;

      const fullText = event.segs
        .map(seg => seg.utf8 || '')
        .join('')
        .replace(/\r?\n/g, '')
        .replace(/\s+/g, ' ');

      if (!fullText.trim() || fullText.trim() === '♪' || fullText.trim() === '♪♪') continue;

      const eventStartMs = typeof event.tStartMs === 'number' ? event.tStartMs : 0;
      let eventDurationMs = typeof event.dDurationMs === 'number' ? event.dDurationMs : 0;

      if (eventDurationMs <= 0) {
        const nextEvent = rawEvents.slice(eIdx + 1).find(ev => ev.segs?.length && typeof ev.tStartMs === 'number' && ev.tStartMs > eventStartMs);
        if (nextEvent && nextEvent.tStartMs > eventStartMs) {
          eventDurationMs = nextEvent.tStartMs - eventStartMs;
        } else {
          eventDurationMs = 3000;
        }
      }

      const startTime = eventStartMs / 1000;
      const duration = eventDurationMs / 1000;
      const endTime = startTime + duration;

      const validSegs = [];
      let accumulatedOffset = 0;

      for (let sIdx = 0; sIdx < event.segs.length; sIdx++) {
        const seg = event.segs[sIdx];
        if (!seg.utf8 || seg.utf8 === '\n' || seg.utf8 === '\r\n') continue;

        let cleanText = seg.utf8.replace(/\r?\n/g, '');
        if (!cleanText) continue;

        if (/^\s/.test(cleanText) && validSegs.length > 0) {
          if (!/\s$/.test(validSegs[validSegs.length - 1].text)) {
            validSegs[validSegs.length - 1].text += ' ';
          }
          cleanText = cleanText.trimStart();
        }

        const offsetMs = typeof seg.tOffsetMs === 'number' ? seg.tOffsetMs : accumulatedOffset;
        validSegs.push({
          text: cleanText,
          offsetMs
        });

        accumulatedOffset = offsetMs + 200;
      }

      const hasDistinctOffsets = validSegs.some(s => s.offsetMs > 0);
      const syllables = [];

      if (validSegs.length > 1 && hasDistinctOffsets) {
        for (let i = 0; i < validSegs.length; i++) {
          const cur = validSegs[i];
          const sylStartMs = eventStartMs + cur.offsetMs;
          let sylDurationMs = 0;

          if (i < validSegs.length - 1) {
            const nextSylStartMs = eventStartMs + validSegs[i + 1].offsetMs;
            sylDurationMs = nextSylStartMs - sylStartMs;
          } else {
            const lineEndMs = eventStartMs + eventDurationMs;
            sylDurationMs = lineEndMs - sylStartMs;
          }

          if (sylDurationMs <= 0) sylDurationMs = 200;

          syllables.push({
            text: cur.text,
            time: sylStartMs,
            duration: sylDurationMs,
            isBackground: false
          });
        }
      }

      parsedLines.push({
        text: fullText,
        startTime,
        endTime,
        duration,
        time: eventStartMs,
        syllabus: syllables.length > 1 ? syllables : [],
        element: {},
        romanizedText: undefined,
        translation: null
      });
    }

    if (parsedLines.length === 0) return null;

    return {
      type: parsedLines.some(l => l.syllabus && l.syllabus.length > 1) ? 'Word' : 'Line',
      data: parsedLines,
      metadata: {
        ...songInfo,
        source: "YouTube Captions"
      }
    };
  }

  static parseUnisonFormat(data) {
    if (!data?.lyrics) return null;

    const format = (data.format || '').toLowerCase();
    const syncType = (data.syncType || 'plain').toLowerCase();

    // Map Unison syncType to internal type
    const typeMap = { richsync: 'Word', linesync: 'Line', plain: 'Plain' };
    const internalType = typeMap[syncType] || 'Line';

    const metadata = {
      title: data.song || '',
      artist: data.artist || '',
      album: data.album || '',
      language: data.language || '',
      source: 'Unison'
    };

    if (format === 'ttml') {
      const kpoeData = parseAppleTTML(data.lyrics);
      if (!kpoeData?.lyrics?.length) return null;

      kpoeData.metadata.source = 'Unison';
      return this.parseKPoeFormat(kpoeData);
    }

    if (format === 'lrc') {
      const kpoeData = parseSyncedLyrics(data.lyrics);
      if (!kpoeData?.lyrics?.length) return null;

      kpoeData.metadata.source = 'Unison';
      return this.parseKPoeFormat(kpoeData);
    }

    const lines = data.lyrics.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    return {
      type: 'Plain',
      data: lines.map(text => ({
        text: text.trim(),
        startTime: 0,
        endTime: 0,
        duration: 0
      })),
      metadata
    };
  }
}

