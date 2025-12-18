// ==================================================================================================
// DATA PARSERS
// ==================================================================================================

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
          if (item.transliteration.syllabus && 
              item.transliteration.syllabus.length === syllabus.length) {
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

    const parsedLines = data.events
      .map(event => {
        const text = event.segs?.map(seg => seg.utf8).join(' ').trim();
        if (!text) return null;

        const startTime = event.tStartMs / 1000;
        const duration = event.dDurationMs / 1000;

        return {
          text,
          startTime,
          endTime: startTime + duration,
          duration
        };
      })
      .filter(Boolean);

    if (parsedLines.length === 0) return null;

    return {
      type: 'Line',
      data: parsedLines,
      metadata: {
        ...songInfo,
        source: "YouTube Captions"
      }
    };
  }
}
