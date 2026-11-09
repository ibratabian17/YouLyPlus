import { DOMParser } from './xmldom.min.js';

/**
 * Convert LRC to KPoe Readable Format
 * Original Implementation:
 * https://github.com/FoedusProgramme/Gramophone/blob/beta/app/src/main/java/org/akanework/gramophone/logic/utils/SemanticLyrics.kt
 * 
 * @param {*} lrcContent - LRC Text
 * @returns 
 */
function parseSyncedLyrics(lrcContent) {
  const lines = lrcContent.split(/\r?\n/);

  const timeTagRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
  const wordTagRegex = /<(\d{2}):(\d{2})[.:](\d{2,3})>/g;
  const offsetRegex = /\[offset:\s*([+-]?\d+)\s*\]/i;
  const speakerRegex = /^(v\d+|bg|\[\s*(?:v\d+|bg)\s*\]):\s*/i;
  const metadataRegex = /^\[(ti|ar|al|by|re|ve|au|length):(.*)\]$/i;

  let offset = 0;
  const rawEntries = [];
  let isEnhanced = false;

  // First pass: find offset
  for (const line of lines) {
    const offsetMatch = line.match(offsetRegex);
    if (offsetMatch) {
      // positive offset means lyric played earlier, so multiply by -1
      // However, standard LRC spec says [offset:200] means timestamps are 200ms too early (shift lyrics forward).
      offset = parseInt(offsetMatch[1], 10);
      break;
    }
  }

  const parseTimeFromMatch = (match) => {
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const msStr = match[3];
    // Handle 2 digits (.10) vs 3 digits (.100)
    const ms = parseInt(msStr.padEnd(3, '0'), 10);
    return Math.max(0, (min * 60 * 1000) + (sec * 1000) + ms - offset);
  };

  let currentSpeaker = null;

  lines.forEach(line => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // Check for metadata (non-timestamp, non-offset)
    if (metadataRegex.test(trimmedLine) || offsetRegex.test(trimmedLine)) {
      return;
    }

    // Find all line timestamps (Compressed LRC support: [00:01][00:10]Text)
    const timeMatches = [...trimmedLine.matchAll(timeTagRegex)];
    if (timeMatches.length === 0) return;

    // Remove line timestamps to get content
    let content = trimmedLine.replace(timeTagRegex, '').trim();

    // Check for Speaker/Walaoke tags
    const speakerMatch = content.match(speakerRegex);
    if (speakerMatch) {
      const tag = speakerMatch[1].replace(/[\[\]\s]/g, '').toLowerCase();
      currentSpeaker = tag;
      content = content.replace(speakerRegex, '').trim();
    }

    // Check for Enhanced LRC Word Timestamps
    const wordMatches = [...content.matchAll(wordTagRegex)];
    let syllabus = [];

    if (wordMatches.length > 0) {
      isEnhanced = true;
      let lastIndex = 0;

      wordMatches.forEach((wm, idx) => {
        // Text before this tag
        const preText = content.substring(lastIndex, wm.index);
        if (preText) {
          // If text exists before first tag, it belongs to previous node or line start.
          syllabus.push({
            text: preText,
            time: 0,
            duration: 0,
            isTag: false
          });
        }

        const wordTime = parseTimeFromMatch(wm);
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
      const lineSyllabus = syllabus.map(s => ({ ...s })); // deep copy
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

function getPrimaryLanguageCode(languageCode) {
  if (!languageCode || typeof languageCode !== 'string') return '';
  const trimmed = languageCode.trim();
  if (!trimmed) return '';
  return trimmed.split(/[-_]/)[0] || '';
}

function getLanguageScript(tag) {
  if (!tag || typeof tag !== 'string') return '';
  const lower = tag.toLowerCase().replace(/_/g, '-');
  if (lower.includes('hant') || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'Hant';
  if (lower.includes('hans') || lower === 'zh-cn' || lower === 'zh-sg') return 'Hans';
  const parts = lower.split('-');
  if (parts.length > 1 && parts[1].length === 4) {
    return parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
  }
  return '';
}

function findFallbackLanguage(availableLanguages, requestedLanguage) {
  if (!Array.isArray(availableLanguages) || availableLanguages.length === 0 || !requestedLanguage) {
    return '';
  }

  const reqList = Array.isArray(requestedLanguage)
    ? requestedLanguage
    : [requestedLanguage];

  for (const req of reqList) {
    if (!req) continue;
    const reqTrimmed = String(req).trim();
    if (!reqTrimmed) continue;

    const exactIdx = availableLanguages.indexOf(reqTrimmed);
    if (exactIdx !== -1) return availableLanguages[exactIdx];

    const reqLower = reqTrimmed.toLowerCase();
    for (const candidate of availableLanguages) {
      if (String(candidate).toLowerCase() === reqLower) {
        return candidate;
      }
    }

    const reqScript = getLanguageScript(reqTrimmed);
    const primaryReq = getPrimaryLanguageCode(reqTrimmed).toLowerCase();

    // Script-aware match (prioritize matching Chinese traditional/simplified scripts)
    if (reqScript && primaryReq) {
      for (const candidate of availableLanguages) {
        if (getPrimaryLanguageCode(candidate).toLowerCase() === primaryReq) {
          const candidateScript = getLanguageScript(candidate);
          if (candidateScript && candidateScript === reqScript) {
            return candidate;
          }
        }
      }
    }

    // Primary language code match, avoiding conflicting scripts
    if (primaryReq) {
      for (const candidate of availableLanguages) {
        if (getPrimaryLanguageCode(candidate).toLowerCase() === primaryReq) {
          const candidateScript = getLanguageScript(candidate);
          if (!reqScript || !candidateScript || reqScript === candidateScript) {
            return candidate;
          }
        }
      }
    }
  }

  return '';
}

export function parseAppleTimestamp(timeStr, defaultVal = -1) {
  if (timeStr === null || timeStr === undefined) return defaultVal;
  const raw = String(timeStr).trim();
  if (!raw) return defaultVal;

  if (/^[+-]?\d+(\.\d+)?ms$/i.test(raw)) {
    const msVal = parseFloat(raw);
    return Number.isNaN(msVal) ? defaultVal : Math.trunc(msVal);
  }

  const parseIntPrefix = (str, fallback = 0) => {
    if (str === null || str === undefined) return fallback;
    const m = String(str).trim().match(/^[+-]?\d+/);
    if (!m) return fallback;
    const val = parseInt(m[0], 10);
    return Number.isNaN(val) ? fallback : val;
  };

  const parseFloatPrefix = (str, fallback = 0.0) => {
    if (str === null || str === undefined) return fallback;
    const m = String(str).trim().match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (!m) return fallback;
    const val = parseFloat(m[0]);
    return Number.isNaN(val) ? fallback : val;
  };

  const parts = raw.split(':');
  if (parts.length >= 4) {
    console.warn(`Timestamp string contains too many colons: ${raw}`);
    return defaultVal;
  }

  let hours = 0;
  let mins = 0;
  let secsStr = '';

  if (parts.length === 1) {
    secsStr = parts[0];
  } else if (parts.length === 2) {
    mins = parseIntPrefix(parts[0], 0);
    secsStr = parts[1];
  } else if (parts.length === 3) {
    hours = parseIntPrefix(parts[0], 0);
    mins = parseIntPrefix(parts[1], 0);
    secsStr = parts[2];
  }

  const hasValidSecNumber = /^[+-]?(?:\d+\.?\d*|\.\d+)/.test(String(secsStr).trim());
  if (!hasValidSecNumber && parts.length === 1) {
    return defaultVal;
  }

  const secs = parseFloatPrefix(secsStr, 0.0);
  const secsMs = Math.trunc(secs * 1000.0);
  return (mins * 60000) + (hours * 3600000) + secsMs;
}

export function formatAppleBackgroundVocalsText(words, keepParenthesis = false, isLineMode = false, useHtml = false) {
  if (!Array.isArray(words) || words.length === 0) return '';
  const getWordStr = (w) => (useHtml && w.htmlText !== undefined ? w.htmlText : (w.text || ''));

  if (isLineMode) {
    const raw = getWordStr(words[0]);
    if (keepParenthesis || !raw) return raw;
    if (raw.startsWith('(') && raw.endsWith(')') && raw.length >= 2) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  let firstNonWsIdx = -1;
  let lastNonWsIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const isWs = words[i].isWhitespace === true || (words[i].begin === -1 && words[i].end === -1);
    if (!isWs) {
      if (firstNonWsIdx === -1) firstNonWsIdx = i;
      lastNonWsIdx = i;
    }
  }

  let stripOuterParens = false;
  if (!keepParenthesis && firstNonWsIdx !== -1 && lastNonWsIdx !== -1) {
    const firstStr = getWordStr(words[firstNonWsIdx]);
    const lastStr = getWordStr(words[lastNonWsIdx]);
    if (firstStr.indexOf('(') === 0 && lastStr.length > 0 && lastStr.lastIndexOf(')') === lastStr.length - 1) {
      stripOuterParens = true;
    }
  }

  let out = '';
  for (let i = 0; i < words.length; i++) {
    let str = getWordStr(words[i]);
    if (stripOuterParens) {
      if (i === firstNonWsIdx && str.length > 0) {
        str = str.slice(1);
      }
      if (i === lastNonWsIdx && str.length > 0) {
        str = str.slice(0, -1);
      }
    }
    out += str;
  }
  return out;
}

/**
 * Convert Apple Music's TTML to KPoe Readable Format
 * Original Implementation:
 * https://github.com/ibratabian17/YouLyPlus/blob/main/src/lib/parser.js
 * 
 * @param {*} ttml - TTML Text
 * @param {*} offset - Format
 * @param {*} separate - Separate non-timed
 * @returns 
 */
function parseAppleTTML(ttml, offset = 0, separate = false) {
  const KPOE = '1.7-1-ConvertTTMLtoJSON-DOMParser';

  if (!ttml || typeof ttml !== 'string') return null;

  const stripNamespace = (name) => {
    if (!name || typeof name !== 'string') return '';
    const idx = name.lastIndexOf(':');
    return idx !== -1 ? name.slice(idx + 1) : name;
  };

  const timeToMs = (timeStr, defaultVal = -1) => parseAppleTimestamp(timeStr, defaultVal);

  const decodeHtmlEntities = (text) => {
    if (!text) return '';
    const map = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&#x27;': "'",
      '&#39;': "'"
    };
    return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, entity) => {
      if (map[m]) return map[m];
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = parseInt(entity.slice(2), 16);
        return !Number.isNaN(code) ? String.fromCodePoint(code) : m;
      }
      if (entity.startsWith('#')) {
        const code = parseInt(entity.slice(1), 10);
        return !Number.isNaN(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    });
  };

  const parseAgentType = (rawType) => {
    const str = String(rawType || '').toLowerCase();
    if (str.includes('person')) return { code: 0, name: 'person' };
    if (str.includes('character')) return { code: 1, name: 'character' };
    if (str.includes('group')) return { code: 2, name: 'group' };
    if (str.includes('organization')) return { code: 3, name: 'organization' };
    if (str.includes('other')) return { code: 4, name: 'other' };
    return { code: 5, name: 'unspecified' };
  };

  const parseAgentNameType = (rawType) => {
    const str = String(rawType || '').toLowerCase();
    if (str.includes('full')) return { code: 0, key: 'full' };
    if (str.includes('family')) return { code: 1, key: 'family' };
    if (str.includes('given')) return { code: 2, key: 'given' };
    if (str.includes('alias')) return { code: 3, key: 'alias' };
    if (str.includes('other')) return { code: 4, key: 'other' };
    return { code: 5, key: 'unspecified' };
  };

  function getAttr(el, ...attrNames) {
    if (!el || !el.getAttribute) return null;

    for (const name of attrNames) {
      if (!name) continue;
      try {
        const val = el.getAttribute(name);
        if (val !== null && val !== undefined && val !== '') return val;
      } catch (e) {}
    }

    if (el.attributes && el.attributes.length > 0) {
      const targetLocals = attrNames.filter(Boolean).map(n => stripNamespace(n).toLowerCase());
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (!attr) continue;
        const attrName = attr.name || '';
        const attrLocal = stripNamespace(attr.localName || attrName).toLowerCase();
        const attrFull = attrName.toLowerCase();
        for (const target of targetLocals) {
          if (attrLocal === target || attrFull === target) {
            return attr.value;
          }
        }
      }
    }

    for (const name of attrNames) {
      if (!name) continue;
      const local = stripNamespace(name);
      try {
        if (el.getAttributeNS) {
          const val = el.getAttributeNS(null, local);
          if (val !== null && val !== undefined && val !== '') return val;
        }
      } catch (e) {}
    }

    return null;
  }

  function getDirectChildren(node, ...targetNames) {
    if (!node || !node.childNodes) return [];
    const targets = targetNames.map(t => stripNamespace(t).toLowerCase());
    const results = [];
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child && child.nodeType === 1) {
        const local = stripNamespace(child.localName || child.nodeName || '').toLowerCase();
        if (targets.length === 0 || targets.includes(local)) {
          results.push(child);
        }
      }
    }
    return results;
  }

  function getElementsByLocalName(node, ...targetNames) {
    if (!node) return [];
    const results = [];
    const matchAll = targetNames.includes('*');
    const targets = targetNames.map(t => stripNamespace(t).toLowerCase());

    function walk(current) {
      if (!current) return;
      if (current.nodeType === 1) {
        const local = stripNamespace(current.localName || current.nodeName || '').toLowerCase();
        if (matchAll || targets.includes(local)) {
          results.push(current);
        }
      }
      const children = current.childNodes;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          walk(children[i]);
        }
      }
    }

    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }

    return results;
  }

  function getFirstElementByLocalName(node, ...targetNames) {
    if (!node) return null;
    const targets = targetNames.map(t => stripNamespace(t).toLowerCase());

    function walk(current) {
      if (!current) return null;
      if (current.nodeType === 1) {
        const local = stripNamespace(current.localName || current.nodeName || '').toLowerCase();
        if (targets.includes(local)) {
          return current;
        }
      }
      const children = current.childNodes;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          const found = walk(children[i]);
          if (found) return found;
        }
      }
      return null;
    }

    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const found = walk(children[i]);
        if (found) return found;
      }
    }

    return null;
  }

  function extractText(node, preserveHtmlTags = false, skipBackgroundSpans = false) {
    if (!node) return '';
    if (node.nodeType === 3 || node.nodeType === 4) {
      return decodeHtmlEntities(node.nodeValue || '');
    }
    if (node.nodeType !== 1) return '';

    let result = '';
    const children = node.childNodes;
    if (!children) return '';

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      if (child.nodeType === 3 || child.nodeType === 4) {
        result += decodeHtmlEntities(child.nodeValue || '');
      } else if (child.nodeType === 1) {
        const tag = stripNamespace(child.localName || child.nodeName || '');
        const tagLower = tag.toLowerCase();
        const role = getAttr(child, 'role');
        if (skipBackgroundSpans && tagLower === 'span' && role === 'x-bg') {
          continue;
        }
        const inner = extractText(child, preserveHtmlTags, skipBackgroundSpans);
        if (preserveHtmlTags && (tagLower === 'b' || tagLower === 'i')) {
          result += `<${tag}>${inner}</${tag}>`;
        } else {
          result += inner;
        }
      }
    }
    return result;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(ttml, 'application/xml');

  if (doc.getElementsByTagName && doc.getElementsByTagName('parsererror').length > 0) {
    console.error('Failed to parse TTML document.');
    return null;
  }

  const root = doc.documentElement;
  if (!root) return null;

  const rawTiming = getAttr(root, 'timing') || '';
  let explicitTimingMode = '';
  if (/line/i.test(rawTiming)) explicitTimingMode = 'Line';
  else if (/word/i.test(rawTiming)) explicitTimingMode = 'Word';
  else if (/none/i.test(rawTiming)) explicitTimingMode = 'None';

  const headNodes = getDirectChildren(root, 'head');
  const headEl = headNodes[0] || getFirstElementByLocalName(root, 'head');
  const metaScope = headEl || getFirstElementByLocalName(root, 'metadata', 'iTunesMetadata', 'sourceMetadata');

  const bodyNodes = getDirectChildren(root, 'body');
  if (bodyNodes.length > 1) {
    console.warn('Attempted to parse a TTML document with multiple <BODY> tags.');
  }
  const bodyEl = bodyNodes[0] || getFirstElementByLocalName(root, 'body');

  const rawBodyDur = getAttr(bodyEl, 'dur') || '';
  const bodyDurationMs = timeToMs(rawBodyDur, -1);

  const metadata = {
    source: 'Apple Music',
    songWriters: [],
    songwriterDetails: [],
    songwritersByLang: {},
    title: '',
    language: getAttr(root, 'lang') || '',
    agents: {},
    songParts: [],
    totalDuration: rawBodyDur,
    durationMs: bodyDurationMs !== -1 ? bodyDurationMs : undefined,
    leadingSilence: '',
    leadingSilenceMs: undefined,
    lyricOffset: 0,
    isTranslationAutomaticallyCreated: false,
    isPronunciationAutomaticallyCreated: false,
    translationLanguages: [],
    pronunciationLanguages: [],
    scriptLanguages: []
  };

  if (metaScope) {
    const scopeElements = [metaScope, ...getElementsByLocalName(metaScope, '*')];
    for (const node of scopeElements) {
      const lsAttr = getAttr(node, 'leadingSilence');
      if (lsAttr !== null && !metadata.leadingSilence) {
        metadata.leadingSilence = lsAttr;
        const parsedLs = timeToMs(lsAttr, -1);
        if (parsedLs !== -1) metadata.leadingSilenceMs = parsedLs;
      }
      const lyricOffsetAttr = getAttr(node, 'lyricOffset');
      if (lyricOffsetAttr !== null && metadata.lyricOffset === 0) {
        metadata.lyricOffset = timeToMs(lyricOffsetAttr, 0);
      }
    }
  }

  const effectiveOffset = metadata.lyricOffset + (Number(offset) || 0);

  function parseTiming(node) {
    const beginAttr = getAttr(node, 'begin');
    const endAttr = getAttr(node, 'end');
    const durAttr = getAttr(node, 'dur');
    const agent = getAttr(node, 'agent', 'singer') || '';

    let rawBegin = timeToMs(beginAttr, -1);
    let rawEnd = timeToMs(endAttr, -1);

    if (rawEnd === -1 && rawBegin !== -1 && durAttr !== null) {
      const rawDur = timeToMs(durAttr, -1);
      if (rawDur !== -1) rawEnd = rawBegin + rawDur;
    }

    if (rawBegin !== -1 && rawEnd !== -1 && rawBegin === rawEnd) {
      rawEnd = rawBegin + 1;
    }

    const begin = rawBegin !== -1 ? rawBegin + effectiveOffset : -1;
    const end = rawEnd !== -1 ? rawEnd + effectiveOffset : -1;
    const duration = (begin !== -1 && end !== -1) ? Math.max(0, end - begin) : 0;

    return {
      begin,
      end,
      duration,
      agent,
      hasBegin: rawBegin !== -1,
      hasEnd: rawEnd !== -1
    };
  }

  let wordIdSeq = 0;
  function createWordEntry(node, lineAgent = '', wordIndex = 0, isBackground = false, keepParenthesis = false) {
    const isElement = node && node.nodeType === 1;
    const timing = isElement
      ? parseTiming(node)
      : { begin: -1, end: -1, duration: 0, agent: '', hasBegin: false, hasEnd: false };

    const rawText = isElement
      ? extractText(node, false, false)
      : decodeHtmlEntities(node?.nodeValue || '');
    const htmlText = isElement
      ? extractText(node, true, false)
      : decodeHtmlEntities(node?.nodeValue || '');

    const resolvedAgent = timing.agent || lineAgent || '';
    const isWhitespace = timing.begin === -1 && timing.end === -1;

    return {
      wordId: ++wordIdSeq,
      wordIndex,
      begin: timing.begin,
      end: timing.end,
      time: timing.begin !== -1 ? timing.begin : 0,
      duration: timing.duration,
      text: rawText,
      htmlText,
      textWithoutParenthesis: rawText.replace(/[()]/g, ''),
      agent: resolvedAgent,
      singer: resolvedAgent ? resolvedAgent.replace('voice', 'v') : '',
      isBackground,
      isWhitespace,
      keepParenthesis
    };
  }

  function parseSpans(containerNode, options = {}) {
    const {
      lineAgent = '',
      wordIndexOffset = 0,
      allowLeadingTextInBackground = false
    } = options;

    let keepParenthesis = getAttr(containerNode, 'parenthesis') === 'keep';
    const mainWords = [];
    const backgroundWords = [];
    const orderedWords = [];

    function walkContainer(node, inBackground) {
      let wordIndex = 0;
      const children = node?.childNodes;
      if (!children) return;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;

        const isElement = child.nodeType === 1;
        const isTextNode = child.nodeType === 3 || child.nodeType === 4;
        const childTag = isElement ? stripNamespace(child.localName || child.nodeName || '').toLowerCase() : '';
        const isSpan = isElement && childTag === 'span';

        const role = isElement ? getAttr(child, 'role') : null;
        if (isElement && getAttr(child, 'parenthesis') === 'keep') {
          keepParenthesis = true;
        }

        if (isSpan && role === 'x-bg') {
          if (!inBackground) {
            const innerSpans = getDirectChildren(child, 'span');
            if (innerSpans.length > 0 || allowLeadingTextInBackground) {
              walkContainer(child, true);
            } else {
              const bgWord = createWordEntry(
                child,
                getAttr(child, 'agent', 'singer') || lineAgent,
                wordIndexOffset + wordIndex,
                true,
                keepParenthesis
              );
              if (bgWord.text) {
                backgroundWords.push(bgWord);
                orderedWords.push(bgWord);
                wordIndex++;
              }
            }
          }
          continue;
        }

        if (!isSpan && !isTextNode) continue;
        if (!isSpan && wordIndex === 0 && !(allowLeadingTextInBackground && inBackground)) continue;

        const inheritedAgent = inBackground
          ? (getAttr(node, 'agent', 'singer') || lineAgent)
          : lineAgent;

        const word = createWordEntry(
          child,
          inheritedAgent,
          wordIndexOffset + wordIndex,
          inBackground,
          keepParenthesis
        );

        if (!isSpan && /^[ \t]*[\r\n]+[ \t\r\n]*$/.test(word.text)) {
          continue;
        }

        if (inBackground) {
          backgroundWords.push(word);
        } else {
          mainWords.push(word);
        }
        orderedWords.push(word);
        wordIndex++;
      }
    }

    walkContainer(containerNode, false);

    if (keepParenthesis) {
      for (const w of orderedWords) {
        w.keepParenthesis = true;
      }
    }

    return {
      keepParenthesis,
      mainWords,
      backgroundWords,
      orderedWords
    };
  }

  function buildSyllabus(orderedWords, isSeparate) {
    const syllabus = [];

    for (let i = 0; i < orderedWords.length; i++) {
      const w = orderedWords[i];

      if (w.isWhitespace) {
        if (!w.text) continue;
        if (isSeparate) {
          const wsEntry = {
            time: -1,
            duration: 0,
            text: w.text,
            isWhitespace: true,
            wordIndex: w.wordIndex
          };
          if (w.isBackground) wsEntry.isBackground = true;
          if (w.keepParenthesis) wsEntry.keepParenthesis = true;
          syllabus.push(wsEntry);
        } else {
          for (let j = syllabus.length - 1; j >= 0; j--) {
            if (Boolean(syllabus[j].isBackground) === Boolean(w.isBackground)) {
              syllabus[j].text += w.text;
              if (syllabus[j].htmlText !== undefined) {
                syllabus[j].htmlText += w.htmlText;
              }
              break;
            }
          }
        }
        continue;
      }

      if (w.text.trim() === '' && !w.text.includes(' ')) continue;

      const entry = {
        time: w.begin !== -1 ? w.begin : 0,
        duration: w.duration,
        text: w.text
      };
      if (w.htmlText && w.htmlText !== w.text) entry.htmlText = w.htmlText;
      if (w.isBackground) entry.isBackground = true;
      if (w.keepParenthesis) entry.keepParenthesis = true;
      if (w.agent) entry.agent = w.agent;
      if (w.singer) entry.singer = w.singer;
      if (w.wordIndex !== undefined) entry.wordIndex = w.wordIndex;

      syllabus.push(entry);
    }

    return syllabus;
  }

  function validateLineWords(lineTiming, words) {
    const warnings = [];
    for (const w of words) {
      if (w.isWhitespace) continue;
      if (lineTiming.begin !== -1 && w.begin !== -1 && w.begin < lineTiming.begin) {
        warnings.push(`Word begin (${w.begin}) < line begin (${lineTiming.begin})`);
      }
      if (lineTiming.end !== -1 && w.end !== -1 && w.end > lineTiming.end) {
        warnings.push(`Word end (${w.end}) > line end (${lineTiming.end})`);
      }
      if (w.duration <= 9) {
        warnings.push(`Word duration (${w.duration}ms) <= 9ms`);
      }
    }
    return warnings;
  }

  const translationMap = {};
  const translationsByKey = {};
  const translationsByLang = {};
  const scriptsByKey = {};
  const scriptsByLang = {};
  const transliterationMap = {};
  const transliterationsByKey = {};
  const pronunciationsByLang = {};

  if (metaScope) {
    // Agents
    const agentNodes = getElementsByLocalName(metaScope, 'agent');
    for (let i = 0; i < agentNodes.length; i++) {
      const a = agentNodes[i];
      const agentId = getAttr(a, 'id');
      if (!agentId) continue;

      const rawType = getAttr(a, 'type') || '';
      const parsedType = parseAgentType(rawType);
      const artistIdAttr = getAttr(a, 'artistId');
      const artistId = artistIdAttr ? (parseInt(String(artistIdAttr).trim(), 10) || 0) : 0;

      const names = {};
      let firstAvailableName = '';
      const nameNodes = getElementsByLocalName(a, 'name');
      for (const nameNode of nameNodes) {
        const parsedNameType = parseAgentNameType(getAttr(nameNode, 'type') || '');
        const nameText = extractText(nameNode, false, false).trim();
        if (nameText) {
          names[parsedNameType.key] = nameText;
          if (!firstAvailableName) firstAvailableName = nameText;
        }
      }

      const name = names.full || names.alias || names.given || names.unspecified || firstAvailableName || '';
      const alias = agentId.replace('voice', 'v');
      const type = parsedType.name === 'unspecified' && !rawType ? 'person' : parsedType.name;

      const agentEntry = {
        id: agentId,
        type,
        typeCode: parsedType.code,
        rawType: rawType || 'person',
        artistId,
        name,
        names,
        alias
      };

      metadata.agents[agentId] = agentEntry;
      if (alias && alias !== agentId && !metadata.agents[alias]) {
        metadata.agents[alias] = agentEntry;
      }
    }

    // Title & Songwriters
    const titleEl = getFirstElementByLocalName(metaScope, 'title');
    if (titleEl && !metadata.title) {
      metadata.title = extractText(titleEl, false, false).trim();
    }

    const copyrightEl = getFirstElementByLocalName(metaScope, 'copyright');
    if (copyrightEl) {
      metadata.copyright = extractText(copyrightEl, false, false).trim();
    }

    const songwritersNodes = getElementsByLocalName(metaScope, 'songwriters');
    for (const songwritersEl of songwritersNodes) {
      const swLang = getAttr(songwritersEl, 'lang') || metadata.language || '';
      const songwriterNodes = getElementsByLocalName(songwritersEl, 'songwriter');
      for (let i = 0; i < songwriterNodes.length; i++) {
        const swNode = songwriterNodes[i];
        const name = extractText(swNode, false, false).trim();
        if (!name) continue;
        const artistIdAttr = getAttr(swNode, 'artistId');
        const artistId = artistIdAttr ? (parseInt(String(artistIdAttr).trim(), 10) || 0) : 0;

        if (!metadata.songWriters.includes(name)) {
          metadata.songWriters.push(name);
        }
        metadata.songwriterDetails.push({ name, artistId, lang: swLang });
        if (!metadata.songwritersByLang[swLang]) {
          metadata.songwritersByLang[swLang] = [];
        }
        metadata.songwritersByLang[swLang].push({ name, artistId });
      }
    }

    // Translations
    const translationsNodes = getElementsByLocalName(metaScope, 'translations');
    for (const translationsNode of translationsNodes) {
      const translationNodes = getElementsByLocalName(translationsNode, 'translation');
      for (const transNode of translationNodes) {
        const lang = getAttr(transNode, 'lang') || '';
        const typeAttr = (getAttr(transNode, 'type') || 'subtitle').toLowerCase();
        const isSubtitle = typeAttr === 'subtitle';
        const isReplacement = !isSubtitle;
        const autoCreated = getAttr(transNode, 'automaticallyCreated') === 'true';

        if (autoCreated) {
          metadata.isTranslationAutomaticallyCreated = true;
        }

        if (lang) {
          if (isSubtitle && !metadata.translationLanguages.includes(lang)) {
            metadata.translationLanguages.push(lang);
          } else if (!isSubtitle && !metadata.scriptLanguages.includes(lang)) {
            metadata.scriptLanguages.push(lang);
          }
        }

        const textNodes = getElementsByLocalName(transNode, 'text');
        for (const textNode of textNodes) {
          const lineKey = getAttr(textNode, 'for');
          if (!lineKey) continue;

          const spanResult = parseSpans(textNode, {
            lineAgent: getAttr(textNode, 'agent', 'singer') || '',
            wordIndexOffset: 0,
            allowLeadingTextInBackground: true
          });

          const hasTimedMainSpans = spanResult.mainWords.some(w => !w.isWhitespace);
          const mainPlainText = hasTimedMainSpans
            ? spanResult.mainWords.map(w => w.text).join('').trim()
            : extractText(textNode, false, true).trim();
          const mainHtmlText = hasTimedMainSpans
            ? spanResult.mainWords.map(w => w.htmlText).join('').trim()
            : extractText(textNode, true, true).trim();

          const hasTimedBgSpans = spanResult.backgroundWords.some(w => !w.isWhitespace);
          const bgPlainText = spanResult.backgroundWords.length > 0
            ? formatAppleBackgroundVocalsText(
                spanResult.backgroundWords,
                spanResult.keepParenthesis,
                !hasTimedBgSpans && spanResult.backgroundWords.length === 1,
                false
              ).trim()
            : '';
          const bgHtmlText = spanResult.backgroundWords.length > 0
            ? formatAppleBackgroundVocalsText(
                spanResult.backgroundWords,
                spanResult.keepParenthesis,
                !hasTimedBgSpans && spanResult.backgroundWords.length === 1,
                true
              ).trim()
            : '';

          const syllabus = (hasTimedMainSpans || hasTimedBgSpans)
            ? buildSyllabus(spanResult.orderedWords, separate)
            : undefined;

          const entry = {
            lang,
            type: isSubtitle ? 'subtitle' : 'replacement',
            isReplacement,
            automaticallyCreated: autoCreated,
            keepParenthesis: spanResult.keepParenthesis,
            text: mainPlainText,
            htmlText: mainHtmlText,
            backgroundText: bgPlainText || undefined,
            htmlBackgroundText: bgHtmlText || undefined,
            syllabus,
            words: hasTimedMainSpans ? spanResult.mainWords : undefined,
            backgroundWords: spanResult.backgroundWords.length > 0 ? spanResult.backgroundWords : undefined
          };

          if (isSubtitle) {
            if (!translationsByKey[lineKey]) translationsByKey[lineKey] = {};
            translationsByKey[lineKey][lang] = entry;
            if (!translationsByLang[lang]) translationsByLang[lang] = {};
            translationsByLang[lang][lineKey] = entry;
            if (!translationMap[lineKey]) {
              translationMap[lineKey] = entry;
            }
          } else {
            if (!scriptsByKey[lineKey]) scriptsByKey[lineKey] = {};
            scriptsByKey[lineKey][lang] = entry;
            if (!scriptsByLang[lang]) scriptsByLang[lang] = {};
            scriptsByLang[lang][lineKey] = entry;
          }
        }
      }
    }

    // Transliterations
    const transliterationsNodes = getElementsByLocalName(metaScope, 'transliterations');
    for (const transliterationsNode of transliterationsNodes) {
      const transliterationNodes = getElementsByLocalName(transliterationsNode, 'transliteration');
      for (const translitNode of transliterationNodes) {
        const lang = getAttr(translitNode, 'lang') || '';
        const autoCreated = getAttr(translitNode, 'automaticallyCreated') === 'true';

        if (autoCreated) {
          metadata.isPronunciationAutomaticallyCreated = true;
        }
        if (lang && !metadata.pronunciationLanguages.includes(lang)) {
          metadata.pronunciationLanguages.push(lang);
        }

        const textNodes = getElementsByLocalName(translitNode, 'text');
        for (const textNode of textNodes) {
          const lineKey = getAttr(textNode, 'for');
          if (!lineKey) continue;

          const spanResult = parseSpans(textNode, {
            lineAgent: getAttr(textNode, 'agent', 'singer') || '',
            wordIndexOffset: 100000,
            allowLeadingTextInBackground: false
          });

          // Check if it has timing spans
          const hasTimedMainSpans = spanResult.mainWords.some(w => !w.isWhitespace);
          const hasTimedBgSpans = spanResult.backgroundWords.some(w => !w.isWhitespace);

          const mainPlainText = hasTimedMainSpans
            ? spanResult.mainWords.map(w => w.text).join('').trim()
            : extractText(textNode, false, true).trim();
          const mainHtmlText = hasTimedMainSpans
            ? spanResult.mainWords.map(w => w.htmlText).join('').trim()
            : extractText(textNode, true, true).trim();

          const bgPlainText = spanResult.backgroundWords.length > 0
            ? formatAppleBackgroundVocalsText(
                spanResult.backgroundWords,
                spanResult.keepParenthesis,
                !hasTimedBgSpans && spanResult.backgroundWords.length === 1,
                false
              ).trim()
            : '';
          const bgHtmlText = spanResult.backgroundWords.length > 0
            ? formatAppleBackgroundVocalsText(
                spanResult.backgroundWords,
                spanResult.keepParenthesis,
                !hasTimedBgSpans && spanResult.backgroundWords.length === 1,
                true
              ).trim()
            : '';

          let entry;
          if (hasTimedMainSpans || hasTimedBgSpans) {
            // Word Sync logic for transliteration
            const syllabus = buildSyllabus(spanResult.orderedWords, separate);
            const fgSyllabus = buildSyllabus(spanResult.mainWords, separate);
            const bgSyllabus = buildSyllabus(spanResult.backgroundWords, separate);
            const fullText = [mainPlainText, bgPlainText].filter(Boolean).join(' ').trim();

            entry = {
              lang,
              automaticallyCreated: autoCreated,
              keepParenthesis: spanResult.keepParenthesis,
              text: fullText || mainPlainText,
              mainText: mainPlainText,
              htmlText: mainHtmlText,
              backgroundText: bgPlainText || undefined,
              htmlBackgroundText: bgHtmlText || undefined,
              syllabus,
              foregroundSyllabus: fgSyllabus,
              backgroundSyllabus: bgSyllabus,
              words: spanResult.mainWords,
              backgroundWords: spanResult.backgroundWords.length > 0 ? spanResult.backgroundWords : undefined
            };
          } else {
            // Line Sync / Plain logic for transliteration
            const fullPlain = extractText(textNode, false, false).trim();
            entry = {
              lang,
              automaticallyCreated: autoCreated,
              keepParenthesis: spanResult.keepParenthesis,
              text: fullPlain,
              mainText: mainPlainText || fullPlain,
              htmlText: mainHtmlText || extractText(textNode, true, false).trim(),
              backgroundText: bgPlainText || undefined,
              htmlBackgroundText: bgHtmlText || undefined
            };
          }

          if (!transliterationsByKey[lineKey]) transliterationsByKey[lineKey] = {};
          transliterationsByKey[lineKey][lang] = entry;
          if (!pronunciationsByLang[lang]) pronunciationsByLang[lang] = {};
          pronunciationsByLang[lang][lineKey] = entry;
          if (!transliterationMap[lineKey]) {
            transliterationMap[lineKey] = entry;
          }
        }
      }
    }
  }

  const lyrics = [];
  let directDivs = bodyEl ? getDirectChildren(bodyEl, 'div') : [];
  if (directDivs.length === 0) {
    directDivs = getElementsByLocalName(bodyEl || root, 'div');
  }
  const divContainers = directDivs.length > 0 ? directDivs : (bodyEl ? [bodyEl] : [root]);

  let detectedAnyWords = false;
  let detectedAnyLineTimes = false;

  for (let i = 0; i < divContainers.length; i++) {
    const div = divContainers[i];
    const songPart = getAttr(div, 'song-part', 'songPart') || '';
    const divAgent = getAttr(div, 'agent', 'singer') || '';

    let ps = getDirectChildren(div, 'p');
    if (ps.length === 0) {
      ps = getElementsByLocalName(div, 'p');
    }

    // Metadata: Song Parts
    const divTiming = parseTiming(div);
    let partTime = divTiming.hasBegin ? divTiming.begin : 0;
    let partDur = (divTiming.hasBegin && divTiming.hasEnd) ? divTiming.duration : 0;

    // Fallback if div has no timing but ps do
    if ((!divTiming.hasBegin || !divTiming.hasEnd) && ps.length > 0) {
      const firstPTiming = parseTiming(ps[0]);
      const lastPTiming = parseTiming(ps[ps.length - 1]);
      if (!divTiming.hasBegin && firstPTiming.hasBegin) partTime = firstPTiming.begin;
      if (!divTiming.hasEnd && lastPTiming.hasEnd && partTime >= 0) {
        partDur = Math.max(0, lastPTiming.end - partTime);
      }
    }

    metadata.songParts.push({
      name: songPart,
      agent: divAgent || undefined,
      time: partTime !== 0 ? partTime : undefined,
      duration: partDur !== 0 ? partDur : undefined
    });

    for (let j = 0; j < ps.length; j++) {
      const p = ps[j];
      const key = getAttr(p, 'key') || '';
      const pTiming = parseTiming(p);
      const singerId = pTiming.agent || divAgent || '';
      const singer = singerId.replace('voice', 'v');

      if (pTiming.hasBegin && pTiming.hasEnd) {
        detectedAnyLineTimes = true;
      }

      const currentLine = {
        lineId: lyrics.length,
        time: 0,
        duration: 0,
        text: '',
        syllabus: [],
        element: { key, singer, songPartIndex: i }
      };

      // Set line timing based on P tag first
      if (pTiming.hasBegin && pTiming.hasEnd) {
        currentLine.time = pTiming.begin;
        currentLine.duration = pTiming.duration;
      }

      const spanResult = parseSpans(p, {
        lineAgent: singerId,
        wordIndexOffset: 0,
        allowLeadingTextInBackground: false
      });

      const hasTimedWords = spanResult.orderedWords.some(w => !w.isWhitespace && (w.begin !== -1 || w.end !== -1));
      const useWordMode = explicitTimingMode === 'Word' || (!explicitTimingMode && hasTimedWords);

      if (useWordMode && hasTimedWords) {
        detectedAnyWords = true;
        currentLine.syllabus = buildSyllabus(spanResult.orderedWords, separate);

        const mainPlainText = spanResult.mainWords.map(w => w.text).join('');
        const mainHtmlText = spanResult.mainWords.map(w => w.htmlText).join('');
        const bgPlainText = spanResult.backgroundWords.length > 0
          ? formatAppleBackgroundVocalsText(spanResult.backgroundWords, spanResult.keepParenthesis, false, false)
          : '';
        const bgHtmlText = spanResult.backgroundWords.length > 0
          ? formatAppleBackgroundVocalsText(spanResult.backgroundWords, spanResult.keepParenthesis, false, true)
          : '';

        currentLine.text = currentLine.syllabus.map(s => s.text).join('').trim();
        currentLine.mainText = mainPlainText.trim();
        currentLine.htmlText = mainHtmlText.trim();
        if (bgPlainText) {
          currentLine.backgroundText = bgPlainText.trim();
          currentLine.htmlBackgroundText = bgHtmlText.trim();
        }
        currentLine.keepParenthesis = spanResult.keepParenthesis;
        currentLine.words = spanResult.mainWords;
        if (spanResult.backgroundWords.length > 0) {
          currentLine.backgroundWords = spanResult.backgroundWords;
        }

        if (!pTiming.hasBegin || !pTiming.hasEnd) {
          const timedWords = spanResult.orderedWords.filter(w => !w.isWhitespace && w.begin !== -1 && w.end !== -1);
          if (timedWords.length > 0) {
            const firstBegin = timedWords[0].begin;
            const lastEnd = timedWords[timedWords.length - 1].end;
            if (!pTiming.hasBegin) currentLine.time = firstBegin;
            if (!pTiming.hasEnd) currentLine.duration = Math.max(0, lastEnd - currentLine.time);
          }
        }

        const warnings = validateLineWords(
          {
            begin: pTiming.hasBegin ? currentLine.time : -1,
            end: pTiming.hasEnd ? currentLine.time + currentLine.duration : -1
          },
          spanResult.orderedWords
        );
        if (warnings.length > 0) {
          currentLine.validationWarnings = warnings;
        }
      } else {
        // Fallback for Word mode if no spans found (treat as line)
        // Line Sync or None
        const mainPlain = extractText(p, false, true).trim();
        const mainHtml = extractText(p, true, true).trim();

        const bgSpans = getDirectChildren(p, 'span').filter(s => getAttr(s, 'role') === 'x-bg');
        let bgPlain = '';
        let bgHtml = '';
        let keepParens = getAttr(p, 'parenthesis') === 'keep';

        if (bgSpans.length > 0) {
          const bgWords = bgSpans.map((bgNode, idx) => {
            if (getAttr(bgNode, 'parenthesis') === 'keep') keepParens = true;
            return createWordEntry(bgNode, singerId, idx, true, keepParens);
          });
          bgPlain = formatAppleBackgroundVocalsText(bgWords, keepParens, true, false).trim();
          bgHtml = formatAppleBackgroundVocalsText(bgWords, keepParens, true, true).trim();
        }

        const fullPlain = extractText(p, false, false).trim();
        currentLine.text = fullPlain || mainPlain;
        currentLine.mainText = mainPlain || fullPlain;
        currentLine.htmlText = mainHtml || extractText(p, true, false).trim();
        if (bgPlain) {
          currentLine.backgroundText = bgPlain;
          currentLine.htmlBackgroundText = bgHtml;
        }
        currentLine.keepParenthesis = keepParens;

        // If Plain text (None), ensure time is 0 if not present
        if (!pTiming.hasBegin || !pTiming.hasEnd) {
          currentLine.time = 0;
          currentLine.duration = 0;
        }
      }

      // Add if valid
      if (currentLine.text || currentLine.syllabus.length > 0) {
        if (key) {
          if (translationMap[key]) currentLine.translation = translationMap[key];
          if (translationsByKey[key]) currentLine.translations = translationsByKey[key];
          if (scriptsByKey[key]) currentLine.scripts = scriptsByKey[key];
          if (transliterationMap[key]) currentLine.transliteration = transliterationMap[key];
          if (transliterationsByKey[key]) currentLine.transliterations = transliterationsByKey[key];
        }
        lyrics.push(currentLine);
      }
    }
  }

  for (let idx = 0; idx < lyrics.length; idx++) {
    lyrics[idx].lineId = idx;
  }

  let detectedType = explicitTimingMode;
  if (!detectedType) {
    if (detectedAnyWords) detectedType = 'Word';
    else if (detectedAnyLineTimes) detectedType = 'Line';
    else detectedType = 'None';
  }

  metadata.translations = translationsByLang;
  metadata.transliterations = pronunciationsByLang;
  metadata.translationsByLang = translationsByLang;
  metadata.pronunciationsByLang = pronunciationsByLang;
  metadata.scriptsByLang = scriptsByLang;

  return {
    KpoeTools: KPOE,
    type: detectedType,
    metadata,
    lyrics,
    cached: 'None'
  };
}

/**
 * Normalizes a v2 lyrics object so every line element uses songPartIndex
 * pointing into metadata.songParts[], replacing legacy songPart strings.
 * If all lines already have songPartIndex, returns the object unchanged.
 */
function normalizeV2(data) {
  if (data.lyrics?.length > 0 && data.lyrics.every(l => l.element?.songPartIndex != null)) {
    return data;
  }

  const songParts = [];
  let currentPartName = null;
  let currentPartIndex = -1;

  const normalizedLyrics = data.lyrics.map(line => {
    const partName = line.element?.songPart || '';

    if (partName !== currentPartName) {
      currentPartName = partName;
      currentPartIndex++;
      songParts.push({ name: partName });
    }

    const { songPart, ...restElement } = line.element || {};
    return {
      ...line,
      element: { ...restElement, songPartIndex: currentPartIndex }
    };
  });

  // Derive time/duration for each songPart from the lines that belong to it
  normalizedLyrics.forEach(line => {
    const idx = line.element.songPartIndex;
    const part = songParts[idx];
    const endTime = line.time + line.duration;

    if (part.time == null || line.time < part.time) part.time = line.time;
    if (part._end == null || endTime > part._end) part._end = endTime;
  });

  songParts.forEach(part => {
    if (part.time != null && part._end != null) part.duration = part._end - part.time;
    delete part._end;
  });

  return {
    ...data,
    metadata: { ...data.metadata, songParts },
    lyrics: normalizedLyrics,
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
function v1Tov2(data) {
  const groupedLyrics = [];
  let currentGroup = null;

  if (data.type === "Line") {
    data.lyrics.forEach(segment => {
      groupedLyrics.push({
        time: segment.time,
        duration: segment.duration,
        text: segment.text,
        syllabus: [],
        element: segment.element || { key: "", songPart: "", singer: "" }
      });
    });
  } else {
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

      if (segment.element?.isBackground === true) {
        syllabusEntry.isBackground = true;
      }

      currentGroup.syllabus.push(syllabusEntry);

      if (segment.isLineEnding === 1) {
        let earliestTime = Infinity;
        let latestEndTime = 0;
        currentGroup.syllabus.forEach(syl => {
          if (syl.time < earliestTime) earliestTime = syl.time;
          const end = syl.time + syl.duration;
          if (end > latestEndTime) latestEndTime = end;
        });
        currentGroup.time = earliestTime;
        currentGroup.duration = latestEndTime - earliestTime;
        currentGroup.text = currentGroup.text.trim();
        groupedLyrics.push(currentGroup);
        currentGroup = null;
      }
    });

    if (currentGroup) {
      let earliestTime = Infinity;
      let latestEndTime = 0;
      currentGroup.syllabus.forEach(syl => {
        if (syl.time < earliestTime) earliestTime = syl.time;
        const end = syl.time + syl.duration;
        if (end > latestEndTime) latestEndTime = end;
      });
      currentGroup.time = earliestTime;
      currentGroup.duration = latestEndTime - earliestTime;
      currentGroup.text = currentGroup.text.trim();
      groupedLyrics.push(currentGroup);
    }
  }

  // normalizeV2 converts element.songPart -> element.songPartIndex
  // and builds metadata.songParts from the grouped lines
  return normalizeV2({
    type: data.type == "syllable" ? "Word" : data.type,
    KpoeTools: '2.0-LPlusBcknd,' + data.KpoeTools,
    metadata: data.metadata,
    ignoreSponsorblock: data.ignoreSponsorblock || undefined,
    lyrics: groupedLyrics,
    cached: data.cached || 'None'
  });
}

// Utility to convert parsed lyrics to a standardized JSON format
function convertToStandardJson(parsedLyrics) {
  return parsedLyrics;
}

if (typeof exports !== 'undefined') {
  module.exports = { parseSyncedLyrics, parseAppleTTML, convertToStandardJson, v1Tov2, normalizeV2, findFallbackLanguage, getLanguageScript, getPrimaryLanguageCode };
}

if (typeof window !== 'undefined') {
  if (typeof window.lyricspluslib == 'undefined') window.lyricspluslib = {};
  window.lyricspluslib.parseSyncedLyrics = parseSyncedLyrics;
  window.lyricspluslib.parseAppleTTML = parseAppleTTML;
  window.lyricspluslib.v1Tov2 = v1Tov2;
  window.lyricspluslib.normalizeV2 = normalizeV2;
  window.lyricspluslib.convertToStandardJson = convertToStandardJson;
  window.lyricspluslib.findFallbackLanguage = findFallbackLanguage;
  window.lyricspluslib.getLanguageScript = getLanguageScript;
  window.lyricspluslib.getPrimaryLanguageCode = getPrimaryLanguageCode;
}

export { parseSyncedLyrics, parseAppleTTML, convertToStandardJson, v1Tov2, normalizeV2, findFallbackLanguage, getLanguageScript, getPrimaryLanguageCode };