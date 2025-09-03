
export function parseSyncedLyrics(lrcContent) {
  const lineTimeRegex = /\[(\d+):(\d{2})(?:[.,](\d+))?\]/g;
  const wordTimeRegex = /<(\d+):(\d{2})(?:[.,](\d+))?>/g;

  const parseTime = (match) => {
    if (!match) return 0;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    let milliseconds = 0;
    if (match[3]) {
      // Normalizes millisecond part (e.g., "52" -> 520)
      const msStr = match[3].padEnd(3, '0').substring(0, 3);
      milliseconds = parseInt(msStr, 10);
    }
    return (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
  };

  const lines = lrcContent.split('\n');
  const parsedLyrics = [];
  const isEnhanced = /<(\d+):(\d{2})/.test(lrcContent);

  lines.forEach(line => {
    const lineTimeMatches = [...line.matchAll(lineTimeRegex)];
    if (lineTimeMatches.length === 0) return;

    const textContent = line.replace(lineTimeRegex, '').trim();
    if (!textContent) return; // Skip empty lines

    let syllabus = [];
    if (isEnhanced && textContent) {
      wordTimeRegex.lastIndex = 0;
      
      const parts = textContent.split(wordTimeRegex);
      const wordMatches = [...textContent.matchAll(wordTimeRegex)];
      
      let textParts = [parts[0] || ''];
      
      for (let i = 1; i < parts.length; i++) {
        textParts.push(parts[i] || '');
      }
      
      wordMatches.forEach((wordMatch, index) => {
        const text = textParts[index + 1]; 
        if (text) {
          syllabus.push({
            text: text,
            time: parseTime(wordMatch),
            duration: 0
          });
        }
      });
      
      const initialText = textParts[0];
      if (initialText && syllabus.length === 0) {
        syllabus.push({ 
          text: initialText, 
          time: 0, 
          duration: 0 
        });
      }

      for (let i = 0; i < syllabus.length - 1; i++) {
        syllabus[i].duration = syllabus[i + 1].time - syllabus[i].time;
      }
      
      if (syllabus.length > 0) {
        syllabus[syllabus.length - 1].duration = 500;
      }
    }

    lineTimeMatches.forEach(match => {
      parsedLyrics.push({
        time: parseTime(match),
        duration: 0, // Will be calculated later
        text: textContent.replace(wordTimeRegex, ''),
        syllabus: isEnhanced ? [...syllabus] : [],
        element: { 
          key: "", 
          songPart: "", 
          singer: "" 
        }
      });
    });
  });

  parsedLyrics.sort((a, b) => a.time - b.time);

  for (let i = 0; i < parsedLyrics.length; i++) {
    if (i < parsedLyrics.length - 1) {
      parsedLyrics[i].duration = parsedLyrics[i + 1].time - parsedLyrics[i].time;
    } else {
      const lastSyllable = parsedLyrics[i].syllabus?.[parsedLyrics[i].syllabus.length - 1];
      parsedLyrics[i].duration = lastSyllable 
        ? (lastSyllable.time + lastSyllable.duration) - parsedLyrics[i].time
        : 5000;
    }
  }

  const validLyrics = parsedLyrics.filter(line => 
    line.text.trim() !== '' && 
    line.time >= 0 && 
    !isNaN(line.time)
  );

  return {
    KpoeTools: '1.0-parseSyncedLyrics-LRC',
    type: isEnhanced ? 'Word' : 'Line',
    metadata: {
      source: "Local Files",
      songWriters: [],
      title: '',
      language: '',
      agents: {},
      totalDuration: ''
    },
    lyrics: validLyrics,
    cached: 'None'
  };
}

export function parseAppleTTML(ttml, offset = 0, separate = false) {
  const KPOE = '1.0-ConvertTTMLtoJSON-DOMParser';

  const NS = {
    tt: 'http://www.w3.org/ns/ttml',
    itunes: 'http://music.apple.com/lyric-ttml-internal',
    ttm: 'http://www.w3.org/ns/ttml#metadata',
    xml: 'http://www.w3.org/XML/1998/namespace',
  };

  const timeToMs = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    let totalMs = 0;
    if (parts.length === 3) {
      const [h, m, s] = parts.map(p => parseFloat(p) || 0);
      totalMs = (h * 3600 + m * 60 + s) * 1000;
    } else if (parts.length === 2) {
      const [m, s] = parts.map(p => parseFloat(p) || 0);
      totalMs = (m * 60 + s) * 1000;
    } else {
      totalMs = parseFloat(parts[0]) * 1000;
    }
    return isNaN(totalMs) ? 0 : Math.round(totalMs);
  };

  const decodeHtmlEntities = (text) => {
    if (!text) return text || '';
    const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
    return text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => map[m] || m);
  };

  function getAttr(el, nsUri, localName, prefixedName) {
    if (!el) return null;
    try {
      if (nsUri && el.getAttributeNS) {
        const v = el.getAttributeNS(nsUri, localName);
        if (v !== null && v !== undefined) return v;
      }
    } catch (e) { /* ignore */ }
    if (prefixedName) {
      const v2 = el.getAttribute(prefixedName);
      if (v2 !== null && v2 !== undefined) return v2;
    }
    return el.getAttribute(localName);
  }

  function collectTailText(node) {
    let txt = '';
    let sib = node.nextSibling;
    while (sib && sib.nodeType === 3) { // 3 = TEXT_NODE
      txt += sib.nodeValue || '';
      sib = sib.nextSibling;
    }
    return txt;
  }

  function isInsideBackgroundWrapper(node, paragraph) {
    let current = node.parentNode;
    while (current && current !== paragraph) {
      const roleVal = getAttr(current, NS.ttm, 'role', 'ttm:role');
      if (roleVal === 'x-bg') return true;
      current = current.parentNode;
    }
    return false;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(ttml, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    console.error('Failed to parse TTML document.');
    return null;
  }

  const root = doc.documentElement;
  const timingMode = getAttr(root, NS.itunes, 'timing', 'itunes:timing') || 'Word';

  const metadata = {
    source: 'Local Files', songWriters: [], title: '',
    language: getAttr(root, NS.xml, 'lang', 'xml:lang') || '',
    agents: {},
    totalDuration: getAttr(doc.getElementsByTagName('body')[0], null, 'dur', 'dur') || '',
  };

  const headEl = doc.getElementsByTagName('head')[0];
  const itunesMetaEl = headEl ? headEl.getElementsByTagName('iTunesMetadata')[0] : null;

  if (headEl) {
    const agentNodes = headEl.getElementsByTagName('ttm:agent');
    for (let i = 0; i < agentNodes.length; i++) {
      const a = agentNodes[i];
      const agentId = getAttr(a, NS.xml, 'id', 'xml:id');
      if (!agentId) continue;
      const type = getAttr(a, null, 'type', 'type') || 'person';
      let name = '';
      const nameNode = a.getElementsByTagName('ttm:name')[0];
      if (nameNode) {
        name = decodeHtmlEntities(nameNode.textContent.trim());
      }
      metadata.agents[agentId] = { type, name, alias: agentId.replace('voice', 'v') };
    }

    const metaContent = itunesMetaEl || headEl.getElementsByTagName('metadata')[0];
    if (metaContent) {
      const titleEl = metaContent.getElementsByTagName('ttm:title')[0] || metaContent.getElementsByTagName('title')[0];
      if (titleEl) metadata.title = decodeHtmlEntities(titleEl.textContent.trim());

      const songwritersEl = metaContent.getElementsByTagName('songwriters')[0];
      if (songwritersEl) {
        const songwriterNodes = songwritersEl.getElementsByTagName('songwriter');
        for (let i = 0; i < songwriterNodes.length; i++) {
          const name = decodeHtmlEntities(songwriterNodes[i].textContent.trim());
          if (name) metadata.songWriters.push(name);
        }
      }
    }
  }

  const translationMap = {};
  const transliterationMap = {};

  if (itunesMetaEl) {
    const translationsNode = itunesMetaEl.getElementsByTagName('translations')[0];
    if (translationsNode) {
      const translationNodes = translationsNode.getElementsByTagName('translation');
      for (const transNode of translationNodes) {
        const lang = getAttr(transNode, NS.xml, 'lang', 'xml:lang');
        const textNodes = transNode.getElementsByTagName('text');
        for (const textNode of textNodes) {
          const lineId = getAttr(textNode, null, 'for', 'for');
          if (lineId) {
            translationMap[lineId] = {
              lang: lang,
              text: decodeHtmlEntities(textNode.textContent.trim())
            };
          }
        }
      }
    }

    const transliterationsNode = itunesMetaEl.getElementsByTagName('transliterations')[0];
    if (transliterationsNode) {
      const transliterationNodes = transliterationsNode.getElementsByTagName('transliteration');
      for (const translitNode of transliterationNodes) {
        const lang = getAttr(translitNode, NS.xml, 'lang', 'xml:lang');
        const textNodes = translitNode.getElementsByTagName('text');

        for (const textNode of textNodes) {
          const lineId = getAttr(textNode, null, 'for', 'for');
          if (!lineId) continue;

          const syllabus = [];
          let fullText = '';
          const spans = Array.from(textNode.getElementsByTagName('span'));
          const processedSpans = new Set();

          for (const span of spans) {
            if (processedSpans.has(span)) continue;

            let spanText = '';
            for (const child of span.childNodes) {
              if (child.nodeType === 3) { spanText += child.nodeValue || ''; }
              if (child.nodeType === 1) { // Element node, e.g. nested span
                Array.from(child.getElementsByTagName('span')).forEach(s => processedSpans.add(s));
              }
            }
            spanText = decodeHtmlEntities(spanText);

            const tail = collectTailText(span);
            if (tail && !separate) {
              spanText += decodeHtmlEntities(tail);
            }

            if (spanText.trim() === '' && (!tail || tail.trim() === '')) continue;

            processedSpans.add(span);

            const begin = getAttr(span, null, 'begin', 'begin');
            const end = getAttr(span, null, 'end', 'end');

            syllabus.push({
              time: timeToMs(begin) + offset,
              duration: timeToMs(end) - timeToMs(begin),
              text: spanText,
            });

            fullText += spanText;
          }

          if (syllabus.length > 0) {
            transliterationMap[lineId] = {
              lang: lang,
              text: fullText.trim(),
              syllabus: syllabus,
            };
          }
        }
      }
    }
  }

  const lyrics = [];
  const divs = doc.getElementsByTagName('div');

  for (let i = 0; i < divs.length; i++) {
    const div = divs[i];
    const songPart = getAttr(div, NS.itunes, 'song-part', 'itunes:song-part') || getAttr(div, NS.itunes, 'songPart', 'itunes:songPart') || '';
    const ps = div.getElementsByTagName('p');

    for (let j = 0; j < ps.length; j++) {
      const p = ps[j];
      const key = getAttr(p, NS.itunes, 'key', 'itunes:key') || '';
      const singerId = getAttr(p, NS.ttm, 'agent', 'ttm:agent') || '';
      const singer = singerId.replace('voice', 'v');

      const currentLine = {
        time: 0,
        duration: 0,
        text: '',
        syllabus: [],
        element: { key, songPart, singer }
      };

      const allSpansInP = Array.from(p.getElementsByTagName('span')).filter(span => getAttr(span, null, 'begin', 'begin'));
      const processedSpans = new Set();

      for (const sp of allSpansInP) {
        if (processedSpans.has(sp)) continue;

        const isBg = isInsideBackgroundWrapper(sp, p);
        if (isBg) {
          Array.from(sp.getElementsByTagName('span')).forEach(nested => processedSpans.add(nested));
        }
        processedSpans.add(sp);

        const begin = getAttr(sp, null, 'begin', 'begin') || '0';
        const end = getAttr(sp, null, 'end', 'end') || '0';

        let spanText = '';
        for (const child of sp.childNodes) {
          if (child.nodeType === 3) { spanText += child.nodeValue || ''; }
        }
        spanText = decodeHtmlEntities(spanText);

        const tail = collectTailText(sp);
        if (tail && !separate) {
          spanText += decodeHtmlEntities(tail);
        }

        if (spanText.trim() === '' && (!tail || !tail.includes(' '))) continue;

        const syllabusEntry = {
          time: timeToMs(begin) + offset,
          duration: timeToMs(end) - timeToMs(begin),
          text: spanText
        };
        if (isBg) syllabusEntry.isBackground = true;

        currentLine.syllabus.push(syllabusEntry);
        currentLine.text += spanText;
      }

      if (currentLine.syllabus.length > 0) {
        let earliestTime = Infinity;
        let latestEndTime = 0;

        currentLine.syllabus.forEach(syllable => {
          if (syllable.time < earliestTime) earliestTime = syllable.time;
          const endTime = syllable.time + syllable.duration;
          if (endTime > latestEndTime) latestEndTime = endTime;
        });

        currentLine.time = earliestTime;
        currentLine.duration = latestEndTime - earliestTime;
        currentLine.text = currentLine.text.trim();

        // Attach pre-computed translation and transliteration data
        if (key && translationMap[key]) {
          currentLine.translation = translationMap[key];
        }
        if (key && transliterationMap[key]) {
          currentLine.transliteration = transliterationMap[key];
        }

        lyrics.push(currentLine);
      }
    }
  }

  return {
    KpoeTools: KPOE,
    type: timingMode,
    metadata,
    lyrics,
  };
}

// V1 to V2
export function v1Tov2(data) {
  const groupedLyrics = [];
  let currentGroup = null;

  // Check if isLineEnding is used for grouping in Word/Syllable types
  const usesLineEndingForGrouping = data.type !== "Line" && data.lyrics.some(segment => segment.isLineEnding === 1);

  if (data.type === "Line" || !usesLineEndingForGrouping) {
    // For Line type, or Word/Syllable type where isLineEnding is not used for grouping,
    // each segment is considered a complete line.
    data.lyrics.forEach(segment => {
      const lineItem = {
        time: segment.time,
        duration: segment.duration,
        text: segment.text,
        syllabus: segment.syllabus || [], // Keep existing syllabus if present
        element: segment.element || { key: "", songPart: "", singer: "" }
      };
      // If it's a Word/Syllable type without explicit line endings,
      // we might need to create a syllabus from the text if not already present.
      if ((data.type === "Word" || data.type === "Syllable") && !lineItem.syllabus.length && lineItem.text) {
          lineItem.syllabus = [{
              time: segment.time,
              duration: segment.duration,
              text: segment.text
          }];
      }
      groupedLyrics.push(lineItem);
    });
  } else {
    // For Word or Syllable types where isLineEnding is used for grouping
    data.lyrics.forEach(segment => {
      if (!currentGroup) {
        currentGroup = {
          time: segment.time,
          duration: 0,
          text: "",
          syllabus: [],
          element: segment.element || { key: "", songPart: "", singer: "" }
        };
      }

      currentGroup.text += segment.text;

      const syllabusEntry = {
        time: segment.time,
        duration: segment.duration,
        text: segment.text
      };

      if (segment.element && segment.element.isBackground === true) {
        syllabusEntry.isBackground = true;
      }

      currentGroup.syllabus.push(syllabusEntry);

      if (segment.isLineEnding === 1) {
        let earliestTime = Infinity;
        let latestEndTime = 0;

        currentGroup.syllabus.forEach(syllable => {
          if (syllable.time < earliestTime) {
            earliestTime = syllable.time;
          }
          const endTime = syllable.time + syllable.duration;
          if (endTime > latestEndTime) {
            latestEndTime = endTime;
          }
        });

        currentGroup.time = earliestTime;
        currentGroup.duration = latestEndTime - earliestTime;
        currentGroup.text = currentGroup.text.trim();
        groupedLyrics.push(currentGroup);
        currentGroup = null;
      }
    });

    if (currentGroup) { // Handle any remaining group if file ends without isLineEnding=1
      let earliestTime = Infinity;
      let latestEndTime = 0;

      currentGroup.syllabus.forEach(syllable => {
        if (syllable.time < earliestTime) {
          earliestTime = syllable.time;
        }
        const endTime = syllable.time + syllable.duration;
        if (endTime > latestEndTime) {
          latestEndTime = endTime;
        }
      });

      currentGroup.time = earliestTime;
      currentGroup.duration = latestEndTime - earliestTime;
      currentGroup.text = currentGroup.text.trim();
      groupedLyrics.push(currentGroup);
    }
  }

  return {
    type: data.type === "syllable" ? "Word" : data.type, // Convert "syllable" to "Word" if needed
    KpoeTools: '1.31R2-LPlusBcknd,' + (data.KpoeTools || 'UnknownV1'),
    metadata: data.metadata,
    ignoreSponsorblock: data.ignoreSponsorblock || undefined,
    lyrics: groupedLyrics,
    cached: data.cached || 'None'
  };
}

// Utility to convert parsed lyrics to a standardized JSON format
export function convertToStandardJson(parsedLyrics) {
    return parsedLyrics;
}
