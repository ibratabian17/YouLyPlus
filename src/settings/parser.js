/**
 * Convert LRC to KPoe Readable Format
 * Original Implementation:
 * https://github.com/FoedusProgramme/Gramophone/blob/beta/app/src/main/java/org/akanework/gramophone/logic/utils/SemanticLyrics.kt
 * 
 * @param {*} lrcContent - LRC Text
 * @returns 
 */
export function parseSyncedLyrics(lrcContent) {
  const timeTagRegex = /\[(\d+):(\d{2})(?:[.:](\d+))?\]/g;
  const wordTagRegex = /<(\d+):(\d{2})(?:[.:](\d+))?>/g;
  const metadataRegex = /^\[([a-zA-Z#]+):([^\]]*)\]$/;
  const offsetRegex = /^\[offset:(-?\d+)\]$/i;
  const speakerRegex = /\[(bg|v1|v2|v3|F|M|D|duet|male|female)(?::)?\]/i;

  let offset = 0;
  const lines = lrcContent.split(/\r?\n/);
  
  // First pass: find offset
  lines.forEach(line => {
    const match = line.trim().match(offsetRegex);
    if (match) {
      // positive offset means lyric played earlier, so multiply by -1
      // However, standard LRC spec says [offset:200] means timestamps are 200ms too early (shift lyrics forward).
      offset = parseInt(match[1], 10) * -1;
    }
  });

  const parseTime = (minutes, seconds, msStr) => {
    const min = parseInt(minutes, 10);
    const sec = parseInt(seconds, 10);
    let ms = 0;
    if (msStr) {
      // Handle 2 digits (.10) vs 3 digits (.100)
      if (msStr.length === 2) ms = parseInt(msStr, 10) * 10;
      else if (msStr.length === 1) ms = parseInt(msStr, 10) * 100;
      else ms = parseInt(msStr.substring(0, 3), 10);
    }
    const total = (min * 60 * 1000) + (sec * 1000) + ms + offset;
    return total < 0 ? 0 : total;
  };

  const parseTimeFromMatch = (match) => parseTime(match[1], match[2], match[3]);

  const rawEntries = [];
  let isEnhanced = false;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    // Check for metadata (non-timestamp, non-offset)
    if (metadataRegex.test(line) && !timeTagRegex.test(line)) {
      return;
    }

    // Check for Speaker/Walaoke tags
    let currentSpeaker = "";
    const speakerMatch = line.match(speakerRegex);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].toLowerCase();
      line = line.replace(speakerRegex, '');
    }

    // Find all line timestamps (Compressed LRC support: [00:01][00:10]Text)
    const timeMatches = [...line.matchAll(timeTagRegex)];
    if (timeMatches.length === 0) return;

    // Remove line timestamps to get content
    let content = line.replace(timeTagRegex, '').trim();
    
    // Check for Enhanced LRC Word Timestamps
    const wordMatches = [...content.matchAll(wordTagRegex)];
    const hasWordTags = wordMatches.length > 0;
    if (hasWordTags) isEnhanced = true;

    let syllabus = [];
    if (hasWordTags) {
      let lastIndex = 0;
      wordMatches.forEach(wm => {
        const wordTime = parseTimeFromMatch(wm);
        // Text before this tag
        const preText = content.substring(lastIndex, wm.index);
        if (preText) {
          // If text exists before first tag, it belongs to previous node or line start.
          syllabus.push({ text: preText, time: 0, duration: 0, isTag: false });
        }
        syllabus.push({ text: "", time: wordTime, duration: 0, isTag: true });
        lastIndex = wm.index + wm[0].length;
      });
      const tailText = content.substring(lastIndex);
      if (tailText) {
         syllabus.push({ text: tailText, time: 0, duration: 0, isTag: false });
      }

      // Post-process syllabus: Bind text to the previous timestamp
      const refinedSyllabus = [];
      let currentWordTime = 0;
      
      syllabus.forEach(item => {
        if (item.isTag) {
          currentWordTime = item.time;
        } else {
          // Text segment
          refinedSyllabus.push({
             text: item.text,
             time: currentWordTime,
             duration: 0
          });
        }
      });
      
      // Fix first word if it had no tag (uses line time later)
      syllabus = refinedSyllabus;
      content = content.replace(wordTagRegex, ''); // Clean content
    }

    timeMatches.forEach(tm => {
      const lineTime = parseTimeFromMatch(tm);
      
      // If syllabus exists, adjust first word time if it was 0 or unmatched
      const lineSyllabus = syllabus.map(s => ({...s})); // deep copy
      if (lineSyllabus.length > 0 && lineSyllabus[0].time === 0) {
          lineSyllabus[0].time = lineTime;
      }

      // Calculate syllable durations
      for (let i = 0; i < lineSyllabus.length - 1; i++) {
        if (lineSyllabus[i + 1].time > lineSyllabus[i].time) {
          lineSyllabus[i].duration = lineSyllabus[i + 1].time - lineSyllabus[i].time;
        }
      }

      rawEntries.push({
        time: lineTime,
        text: content,
        syllabus: lineSyllabus,
        speaker: currentSpeaker
      });
    });
  });

  // Sort by time
  rawEntries.sort((a, b) => a.time - b.time);

  // Calculate Line Durations and Finalize Syllables
  const validLyrics = rawEntries.map((entry, index) => {
    const nextEntry = rawEntries[index + 1];
    let duration = 0;
    
    // Estimate duration based on next line
    if (nextEntry) {
      duration = nextEntry.time - entry.time;
    } else {
      // Last line fallback
      duration = 5000;
    }

    // Sanitize Syllabus
    if (entry.syllabus.length > 0) {
      const lastSyl = entry.syllabus[entry.syllabus.length - 1];
      if (lastSyl.duration === 0) {
        const estimatedEnd = entry.time + duration;
        lastSyl.duration = Math.max(0, estimatedEnd - lastSyl.time);
      }
    }

    if (isEnhanced && entry.syllabus.length === 0 && entry.text) {
      entry.syllabus.push({
        text: entry.text,
        time: entry.time,
        duration: duration
      });
    }

    return {
      time: entry.time,
      duration: duration,
      text: entry.text,
      syllabus: entry.syllabus,
      element: {
        key: "",
        songPart: "",
        singer: entry.speaker
      }
    };
  }).filter(l => l.text.trim() !== '');

  return {
    KpoeTools: '1.1-parseSyncedLyrics-LRC',
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

/**
 * Convert Apple Music's TTML to KPoe Readable Format
 * Original Implementation:
 * https://github.com/ibratabian17/LyricsPlus/blob/cookie/src/shared/parsers/ttml.parser.js
 * 
 * @param {*} ttml - TTML Text
 * @param {*} offset - Format
 * @param {*} separate - Separate non-timed
 * @returns 
 */
export function parseAppleTTML(ttml, offset = 0, separate = false) {
  const KPOE = '1.6-ConvertTTMLtoJSON-DOMParser';

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

          // Get all spans with timing information
          const spans = Array.from(textNode.getElementsByTagName('span')).filter(
            span => getAttr(span, null, 'begin', 'begin')
          );
          const processedSpans = new Set();

          for (const span of spans) {
            if (processedSpans.has(span)) continue;
            processedSpans.add(span);

            let spanText = '';
            for (const child of span.childNodes) {
              if (child.nodeType === 3) { // Text node
                spanText += child.nodeValue || '';
              }
            }
            spanText = decodeHtmlEntities(spanText);

            const tail = collectTailText(span);
            const decodedTail = decodeHtmlEntities(tail);

            if (decodedTail) {
              if (!separate) {
                spanText += decodedTail;
              }
            }

            if (spanText.trim() === '') continue;

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

      // Get timing from paragraph element for line-by-line timing
      const pBegin = getAttr(p, null, 'begin', 'begin');
      const pEnd = getAttr(p, null, 'end', 'end');

      const currentLine = {
        time: 0,
        duration: 0,
        text: '',
        syllabus: [],
        element: { key, songPart, singer }
      };

      // Check if we have word-level spans with timing
      const allSpansInP = Array.from(p.getElementsByTagName('span')).filter(span => getAttr(span, null, 'begin', 'begin'));

      if (allSpansInP.length > 0 && timingMode === 'Word') {
        // Word-by-word timing mode
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
      } else {
        // Line-by-line timing mode - use paragraph timing and extract text
        if (pBegin && pEnd) {
          let lineText = '';

          function extractTextFromNode(node) {
            let text = '';
            for (const child of node.childNodes) {
              if (child.nodeType === 3) {
                text += child.nodeValue || '';
              } else if (child.nodeType === 1) {
                text += extractTextFromNode(child);
              }
            }
            return text;
          }

          lineText = extractTextFromNode(p);
          lineText = decodeHtmlEntities(lineText.trim());

          if (lineText) {
            currentLine.text = lineText;
            currentLine.time = timeToMs(pBegin) + offset;
            currentLine.duration = timeToMs(pEnd) - timeToMs(pBegin);
          }
        }
      }

      if (currentLine.syllabus.length > 0 || (currentLine.text && currentLine.time >= 0)) {
        if (currentLine.syllabus.length > 0 && timingMode === 'Word') {
          let earliestTime = Infinity;
          let latestEndTime = 0;

          currentLine.syllabus.forEach(syllable => {
            if (syllable.time < earliestTime) earliestTime = syllable.time;
            const endTime = syllable.time + syllable.duration;
            if (endTime > latestEndTime) latestEndTime = endTime;
          });

          currentLine.time = earliestTime;
          currentLine.duration = latestEndTime - earliestTime;
        }

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

/**
 * Update Legacy KPoe format to LyricsPlus (new KPoe) Readable Format
 * Original Implementation:
 * https://github.com/ibratabian17/LyricsPlus/blob/cookie/src/shared/parsers/kpoe.parser.js
 * 
 * @param {*} data - The JSON Files
 * @returns 
 */
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

  const metadata = data.metadata || {};
  metadata.source = "Local Files"
  return {
    type: data.type === "syllable" ? "Word" : data.type, // Convert "syllable" to "Word" if needed
    KpoeTools: '1.31R2-LPlusBcknd,' + (data.KpoeTools || 'UnknownV1'),
    metadata,
    ignoreSponsorblock: data.ignoreSponsorblock || undefined,
    lyrics: groupedLyrics,
    cached: data.cached || 'None'
  };
}

// Utility to convert parsed lyrics to a standardized JSON format
export function convertToStandardJson(parsedLyrics) {
    return parsedLyrics;
}
