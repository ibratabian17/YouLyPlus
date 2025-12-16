// src/inject/applemusic/songTracker.js

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
function parseAppleTTML(ttml, offset = 0, separate = false) {
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
    source: 'Apple', songWriters: [], title: '',
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

(function () {
    let mkInstance = null;
    let lastProcessedID = null;
    let debounceTimer = null;

    console.log('LyricsPlus: Tracker Injected');


    // --- 1. Fetcher Lirik Syllable ---
    async function fetchSyllableLyrics(songId, storefront) {
        if (!songId || !mkInstance) return null;
        try {
            const developerToken = mkInstance.developerToken || mkInstance.configuration?.app?.developerToken;
            if (!developerToken) return null;

            const rawLocale = document.documentElement.lang || navigator.language || 'en-US';
            let scriptParam = 'en-Latn'; 
            
            try {
                if (window.Intl && Intl.Locale) {
                    const loc = new Intl.Locale(rawLocale);
                    const baseLang = loc.language;
                    const scriptCode = loc.maximize().script;
                    
                    if (baseLang && scriptCode) {
                        scriptParam = `${baseLang}-${scriptCode}`;
                    }
                }
            } catch (e) {
                console.warn("LyricsPlus: Locale detection failed, using fallback.", e);
            }

            const queryParams = new URLSearchParams({
                'l': rawLocale,          
                'l[lyrics]': rawLocale,
                'l[script]': scriptParam,
                'extend': 'ttmlLocalizations'
            });

            const url = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/syllable-lyrics?${queryParams.toString()}`;

            const headers = {
                'Authorization': `Bearer ${developerToken}`,
                'Accept': 'application/json',
                'Origin': window.location.origin
            };

            if (mkInstance.musicUserToken) headers['Music-User-Token'] = mkInstance.musicUserToken;

            const res = await fetch(url, { headers });
            if (!res.ok) {
                // console.error("LyricsPlus API Error:", await res.text());
                return null;
            }
            return await res.json();
        } catch (e) {
            console.error("LyricsPlus Fetch Error:", e);
            return null;
        }
    }

    // --- 2. Process Metadata ---
    async function handleSongChange() {
        if (!mkInstance) return;

        const item = mkInstance.nowPlayingItem;
        if (!item || !item.attributes || !item.id) return;

        if (lastProcessedID === item.id) return;
        
        lastProcessedID = item.id;
        console.log(`LyricsPlus: Song Detected [${item.attributes.name}]`);

        const attrs = item.attributes;
        const artworkUrl = attrs.artwork?.url ? attrs.artwork.url.replace('{w}', '800').replace('{h}', '800') : '';
        const durationSec = (attrs.durationInMillis || 0) / 1000;
        const songId = attrs.playParams.catalogId || attrs.playParams.id;

        const songInfo = {
            title: attrs.name,
            artist: attrs.artistName,
            album: attrs.albumName,
            duration: durationSec,
            cover: artworkUrl,
            appleId: songId,
            isVideo: attrs.playParams.kind === 'music-videos',
            lyricsJSON: null
        };

        const storefront = mkInstance.storefrontId || 'us';

        if(attrs.hasLyrics){
            const lyricsData = await fetchSyllableLyrics(songId, storefront);
            try {
                if (lyricsData?.data?.[0]) {
                    const ttmlData = lyricsData.data[0].attributes.ttmlLocalizations || lyricsData.data[0].attributes.ttml;
                    
                    if (typeof parseAppleTTML === 'function') {
                        songInfo.lyricsJSON = parseAppleTTML(ttmlData);
                    }
                }
            } catch(err) {
                console.error("LyricsPlus: Parse error", err);
            }
        }

        window.postMessage({
            type: 'LYPLUS_SONG_CHANGED',
            songInfo: songInfo
        }, '*');
    }

    // --- 3. Event Listeners ---
    function init(instance) {
        mkInstance = instance;
        const Events = window.MusicKit.Events;
        
        instance.addEventListener(Events.mediaItemDidChange, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(handleSongChange, 200);
        });

        instance.addEventListener(Events.playbackStateDidChange, () => {
            setTimeout(handleSongChange, 200); 
        });

        handleSongChange();
    }

    // --- 4. Initialization Loop ---
    function waitForMusicKit() {
        if (window.MusicKit && window.MusicKit.getInstance()) {
            init(window.MusicKit.getInstance());
        } else {
            setTimeout(waitForMusicKit, 500);
        }
    }

    waitForMusicKit();
})();