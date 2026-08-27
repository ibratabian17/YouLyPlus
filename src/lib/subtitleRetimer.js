// src/lib/subtitleRetimer.js
/**
 * A smart lyrics aligner to MV
 * Originally designed for Metrolist-KMP, but sure for YouLy+
 */

const RETIMING_OVERLAP_THRESHOLD_MS = 5;
const RETIMING_GAP_THRESHOLD_MS = 1;
const RETIMING_MAX_EXTENSION_MS = 1300;

const BLOCK_SPLIT_THRESHOLD_MS = 3000;
const OUTLIER_TOLERANCE_MS = 4000;
const MIN_BLOCK_MATCHES = 6;
const MIN_BLOCK_ANCHORS = 2;
const MATCH_SIMILARITY_THRESHOLD = 0.75;
const DUP_TOKEN_WINDOW_MS = 300;

const SCORE_HIGH_CONFIDENCE = 0.50;
const SCORE_MEDIUM_CONFIDENCE = 0.25;

const NOISE_TAG_REGEX = /\[[^\]]*\]|\([^)]*(?:music|applause|laughter|audio|singing|cheering|sound|instrumental|beatbox|solo|guitar|piano|drum)[^)]*\)/gi;
const PUNCT_REGEX = /[.,!?♪♫"'()[\]{}:;…\-–—]/g;
const WHITESPACE_REGEX = /\s+/;
const CONTRACTION_REGEX = /['’‘´`](t|s|m|re|ve|ll|d)\b/gi;
const CURLY_QUOTES_REGEX = /['’‘´`"]/g;

const NOISE_WORDS = new Set([
  "music", "applause", "laughter", "cheering", "sound", "singing",
  "instrumental", "beatboxing", "whistling", "groaning", "screaming",
  "cheers", "chuckle", "snicker", "gasp", "sigh", "snort"
]);

const SLANG_CANONICAL = {
  "gonna": "going",
  "gunna": "going",
  "wanna": "want",
  "gotta": "got",
  "kinda": "kind",
  "sorta": "sort",
  "outta": "out",
  "tryna": "trying",
  "cause": "because",
  "cuz": "because",
  "coz": "because",
  "yea": "yeah",
  "yah": "yeah",
  "ya": "you",
  "u": "you",
  "r": "are",
  "ur": "your",
  "imma": "going",
  "bout": "about",
  "em": "them",
  "til": "until",
  "aint": "isnt",
  "ooh": "oh",
  "oooh": "oh",
  "ohh": "oh",
  "whoa": "woah",
  "ahh": "ah"
};

function isNoiseWord(word) {
  return NOISE_WORDS.has(word);
}

function canonicalWord(word) {
  return SLANG_CANONICAL[word] || word;
}

function normalizeWord(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  s = s.replace(CONTRACTION_REGEX, "");
  s = s.replace(CURLY_QUOTES_REGEX, "");
  s = s.replace(PUNCT_REGEX, "");
  s = s.trim();
  if (s.length >= 5 && s.endsWith("in") && !s.endsWith("ain") && !s.endsWith("oin") && !s.endsWith("win")) {
    s += "g";
  }
  return canonicalWord(s);
}

function containsCjk(s) {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3040 && c <= 0x309f) ||
      (c >= 0x30a0 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0x1100 && c <= 0x11ff)
    ) {
      return true;
    }
  }
  return false;
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1 || s1.length === 0) return s2 ? s2.length : 0;
  if (!s2 || s2.length === 0) return s1.length;

  const dp = new Int32Array(s2.length + 1);
  for (let j = 0; j <= s2.length; j++) dp[j] = j;

  for (let i = 1; i <= s1.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= s2.length; j++) {
      const temp = dp[j];
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[s2.length];
}

function levenshteinSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(s1, s2) / maxLen;
}

function wordsMatch(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (containsCjk(a) && containsCjk(b)) {
    if (a.includes(b) || b.includes(a)) return true;
    return levenshteinSimilarity(a, b) >= 0.50;
  }
  return levenshteinSimilarity(a, b) >= MATCH_SIMILARITY_THRESHOLD;
}

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/**
 * Tokenizes lyrics lines into LyricTokens
 */
function tokenizeLyrics(lines) {
  const tokens = [];

  lines.forEach((entry, lineIdx) => {
    const words = entry.words || entry.syllabus || entry.syllables;
    const lineStartTokenCount = tokens.size || tokens.length;

    const entryTimeMs = typeof entry.time === 'number'
      ? (entry.time > 1000 ? Math.round(entry.time) : Math.round(entry.time * 1000))
      : (typeof entry.startTime === 'number' ? Math.round(entry.startTime * 1000) : 0);

    const entryEndTimeMs = typeof entry.endTime === 'number'
      ? (entry.endTime > 1000 ? Math.round(entry.endTime) : Math.round(entry.endTime * 1000))
      : null;

    if (Array.isArray(words) && words.length > 0) {
      const mainWords = words.filter(w => !w.isBackground);
      if (mainWords.length > 0) {
        const hasAnyTrailingSpace = mainWords.some(w => w.hasTrailingSpace || (typeof w.text === 'string' && w.text.endsWith(' ')));

        if (hasAnyTrailingSpace) {
          let currentWord = '';
          let wordStartMs = 0;
          let wordEndMs = 0;
          let firstWordIdx = 0;

          mainWords.forEach((w, wordIdx) => {
            const wStartMs = typeof w.startTime === 'number'
              ? Math.round(w.startTime * 1000)
              : (typeof w.time === 'number' ? (w.time > 1000 ? Math.round(w.time) : Math.round(w.time * 1000)) : entryTimeMs);

            const wEndMs = typeof w.endTime === 'number'
              ? Math.round(w.endTime * 1000)
              : (typeof w.duration === 'number' ? wStartMs + Math.round(w.duration * 1000) : wStartMs + 300);

            if (currentWord.length === 0) {
              wordStartMs = wStartMs;
              firstWordIdx = wordIdx;
            }
            currentWord += (w.text || '');
            wordEndMs = wEndMs;

            const isEndOfWord = w.hasTrailingSpace || (typeof w.text === 'string' && w.text.endsWith(' ')) || wordIdx === mainWords.length - 1;
            if (isEndOfWord) {
              const cleanWord = currentWord.trim();
              if (cleanWord.length > 0) {
                const subWords = cleanWord.split(WHITESPACE_REGEX).filter(Boolean);
                const subWordStep = subWords.length > 1 ? Math.floor((wordEndMs - wordStartMs) / subWords.length) : 0;

                subWords.forEach((subWord, subIdx) => {
                  const norm = normalizeWord(subWord);
                  if (norm.length > 0) {
                    const sStart = subWords.length > 1 ? wordStartMs + subIdx * subWordStep : wordStartMs;
                    const sEnd = subWords.length > 1 ? sStart + subWordStep : wordEndMs;
                    const isFirst = tokens.length === lineStartTokenCount;
                    tokens.push({
                      normalized: norm,
                      lineIdx,
                      wordIdx: firstWordIdx,
                      audioStartMs: sStart,
                      audioEndMs: sEnd,
                      isLineStart: isFirst
                    });
                  }
                });
              }
              currentWord = '';
            }
          });
        } else {
          mainWords.forEach((w, wordIdx) => {
            const norm = normalizeWord(w.text || '');
            if (norm.length > 0) {
              const isFirst = tokens.length === lineStartTokenCount;
              const wStartMs = typeof w.startTime === 'number'
                ? Math.round(w.startTime * 1000)
                : (typeof w.time === 'number' ? (w.time > 1000 ? Math.round(w.time) : Math.round(w.time * 1000)) : entryTimeMs);

              const wEndMs = typeof w.endTime === 'number'
                ? Math.round(w.endTime * 1000)
                : (typeof w.duration === 'number' ? wStartMs + Math.round(w.duration * 1000) : wStartMs + 300);

              tokens.push({
                normalized: norm,
                lineIdx,
                wordIdx,
                audioStartMs: wStartMs,
                audioEndMs: wEndMs,
                isLineStart: isFirst
              });
            }
          });
        }
      }
    } else if (entry.text && typeof entry.text === 'string' && entry.text.trim().length > 0) {
      const trimmed = entry.text.trim();
      const isParenthetical = trimmed.startsWith("(") && trimmed.endsWith(")");
      if (!isParenthetical) {
        const lineEnd = entryEndTimeMs || (entryTimeMs + 5000);
        const lineWords = trimmed
          .split(WHITESPACE_REGEX)
          .map(normalizeWord)
          .filter(w => w.length > 0);

        const lineDuration = Math.max(1, lineEnd - entryTimeMs);
        const wordStep = Math.floor(lineDuration / Math.max(1, lineWords.length));

        lineWords.forEach((norm, wi) => {
          const wordStart = entryTimeMs + wi * wordStep;
          tokens.push({
            normalized: norm,
            lineIdx,
            wordIdx: -1,
            audioStartMs: wordStart,
            audioEndMs: wordStart + wordStep,
            isLineStart: wi === 0
          });
        });
      }
    }
  });

  tokens.sort((a, b) => a.audioStartMs - b.audioStartMs);
  return tokens;
}

/**
 * Tokenizes subtitle cues into SubtitleTokens
 */
function tokenizeSubtitles(cues) {
  const tokens = [];

  cues.forEach(cue => {
    const cueStartMs = typeof cue.startMs === 'number'
      ? cue.startMs
      : (typeof cue.startTime === 'number'
        ? Math.round(cue.startTime * 1000)
        : (typeof cue.tStartMs === 'number' ? cue.tStartMs : 0));

    const cueDurationMs = typeof cue.durationMs === 'number'
      ? cue.durationMs
      : (typeof cue.duration === 'number'
        ? Math.round(cue.duration * 1000)
        : (typeof cue.dDurationMs === 'number' ? cue.dDurationMs : (typeof cue.endTime === 'number' ? Math.round(cue.endTime * 1000) - cueStartMs : 3000)));

    const cueWords = cue.words || cue.syllabus || cue.syllables;

    if (Array.isArray(cueWords) && cueWords.length > 0) {
      cueWords.forEach((w, wi) => {
        const cleanText = (w.text || '').replace(NOISE_TAG_REGEX, "");
        const norm = normalizeWord(cleanText);
        if (norm.length > 0 && !isNoiseWord(norm)) {
          const dur = (w.durationMs > 0) ? w.durationMs : (w.duration ? Math.round(w.duration * 1000) : 300);
          const wStart = typeof w.startMs === 'number' ? w.startMs : (typeof w.startTime === 'number' ? Math.round(w.startTime * 1000) : cueStartMs);
          tokens.push({
            normalized: norm,
            videoStartMs: wStart,
            videoEndMs: wStart + dur,
            isCueStart: wi === 0
          });
        }
      });
    } else {
      let text = cue.text || '';
      text = text.replace(NOISE_TAG_REGEX, "");
      text = text.replace(/\n/g, ' ');
      const durMs = Math.max(1, cueDurationMs);
      const cueEnd = cueStartMs + durMs;
      const words = text
        .split(WHITESPACE_REGEX)
        .map(normalizeWord)
        .filter(w => w.length > 0 && !isNoiseWord(w));

      if (words.length > 0) {
        const wordStep = Math.floor(durMs / Math.max(1, words.length));
        words.forEach((norm, wi) => {
          const wordStart = cueStartMs + wi * wordStep;
          tokens.push({
            normalized: norm,
            videoStartMs: wordStart,
            videoEndMs: Math.min(cueEnd, wordStart + wordStep),
            isCueStart: wi === 0
          });
        });
      }
    }
  });

  tokens.sort((a, b) => a.videoStartMs - b.videoStartMs);
  return deduplicateSubtitleTokens(tokens);
}

function deduplicateSubtitleTokens(tokens) {
  if (!tokens || tokens.length === 0) return [];
  const result = [];
  for (const token of tokens) {
    const prev = result[result.length - 1];
    if (prev && prev.normalized === token.normalized && Math.abs(token.videoStartMs - prev.videoStartMs) <= DUP_TOKEN_WINDOW_MS) {
      continue;
    }
    result.push(token);
  }
  return result;
}

/**
 * Needleman-Wunsch global sequence alignment between lyric tokens and subtitle tokens
 */
function align(lyricTokens, subtitleTokens) {
  const n = lyricTokens.length;
  const m = subtitleTokens.length;

  const match = 2;
  const mismatch = -1;
  const gapLyric = -1;
  const gapSubInterior = -1;

  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const trace = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));

  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + gapLyric;
    trace[i][0] = 1;
  }

  for (let i = 1; i <= n; i++) {
    const lTok = lyricTokens[i - 1];
    for (let j = 1; j <= m; j++) {
      const sTok = subtitleTokens[j - 1];

      const matchScore = dp[i - 1][j - 1] + (wordsMatch(lTok.normalized, sTok.normalized) ? match : mismatch);
      const gapInSub = dp[i - 1][j] + gapLyric;
      const gapSubCost = (j === 1 || j === m) ? 0 : gapSubInterior;
      const gapInLyric = dp[i][j - 1] + gapSubCost;

      const best = Math.max(matchScore, gapInSub, gapInLyric);
      dp[i][j] = best;
      trace[i][j] = (best === matchScore) ? 0 : ((best === gapInSub) ? 1 : 2);
    }
  }

  let bestJ = m;
  let maxEndScore = -Infinity;
  for (let j = 0; j <= m; j++) {
    if (dp[n][j] > maxEndScore) {
      maxEndScore = dp[n][j];
      bestJ = j;
    }
  }

  let j = bestJ;
  let i = n;
  const pairs = [];

  while (i > 0 && j > 0) {
    const t = trace[i][j];
    if (t === 0) {
      const lTok = lyricTokens[i - 1];
      const sTok = subtitleTokens[j - 1];
      if (wordsMatch(lTok.normalized, sTok.normalized)) {
        pairs.push({
          audioStartMs: lTok.audioStartMs,
          videoStartMs: sTok.videoStartMs,
          isAnchor: lTok.isLineStart && sTok.isCueStart
        });
      }
      i--;
      j--;
    } else if (t === 1) {
      i--;
    } else {
      j--;
    }
  }

  pairs.reverse();
  return pairs;
}

/**
 * Piecewise offset block detector
 */
function detectBlocks(matches) {
  if (!matches || matches.length === 0) return [];

  const rawDeltas = matches.map(m => m.videoStartMs - m.audioStartMs);
  const globalMedian = median(rawDeltas);

  const cleanPairs = [];
  const cleanDeltas = [];

  for (let i = 0; i < matches.length; i++) {
    const d = rawDeltas[i];
    const start = Math.max(0, i - 3);
    const end = Math.min(matches.length - 1, i + 3);
    const localMed = median(rawDeltas.slice(start, end + 1));

    if (Math.abs(d - localMed) <= OUTLIER_TOLERANCE_MS || Math.abs(d - globalMedian) <= OUTLIER_TOLERANCE_MS) {
      cleanPairs.push(matches[i]);
      cleanDeltas.push(d);
    }
  }

  if (cleanPairs.length === 0) return [];

  const smoothedDeltas = cleanDeltas.map((_, i) => {
    const start = Math.max(0, i - 3);
    const end = Math.min(cleanDeltas.length - 1, i + 3);
    return median(cleanDeltas.slice(start, end + 1));
  });

  const rawBlocks = [{ pairs: [cleanPairs[0]], deltas: [cleanDeltas[0]] }];

  for (let k = 1; k < cleanPairs.size || k < cleanPairs.length; k++) {
    const currentSmoothed = smoothedDeltas[k];
    const lastBlockMedian = median(rawBlocks[rawBlocks.length - 1].deltas);
    if (
      Math.abs(currentSmoothed - lastBlockMedian) > BLOCK_SPLIT_THRESHOLD_MS &&
      Math.abs(cleanDeltas[k] - lastBlockMedian) > BLOCK_SPLIT_THRESHOLD_MS
    ) {
      rawBlocks.push({ pairs: [], deltas: [] });
    }
    rawBlocks[rawBlocks.length - 1].pairs.push(cleanPairs[k]);
    rawBlocks[rawBlocks.length - 1].deltas.push(cleanDeltas[k]);
  }

  const consolidated = [];
  for (const block of rawBlocks) {
    if (consolidated.length === 0) {
      consolidated.push(block);
    } else {
      const prev = consolidated[consolidated.length - 1];
      const prevMed = median(prev.deltas);
      const curMed = median(block.deltas);
      const prevMaxVideo = Math.max(...prev.pairs.map(p => p.videoStartMs));
      const curMinVideo = Math.min(...block.pairs.map(p => p.videoStartMs));

      const hasEnoughEvidence =
        block.pairs.length >= MIN_BLOCK_MATCHES ||
        block.pairs.filter(p => p.isAnchor).length >= MIN_BLOCK_ANCHORS;

      const isPhysicallyPlausible = curMinVideo >= (prevMaxVideo - 2000) && curMed >= (prevMed - 1500);

      if (!hasEnoughEvidence || Math.abs(curMed - prevMed) <= BLOCK_SPLIT_THRESHOLD_MS || !isPhysicallyPlausible) {
        prev.pairs.push(...block.pairs);
        prev.deltas.push(...block.deltas);
      } else {
        consolidated.push(block);
      }
    }
  }

  return consolidated.map(block => {
    const anchorDeltas = block.pairs.filter(p => p.isAnchor).map(p => p.videoStartMs - p.audioStartMs);
    const blockOffset = anchorDeltas.length >= 2 ? median(anchorDeltas) : median(block.deltas);
    return {
      audioStartMs: block.pairs[0].audioStartMs,
      audioEndMs: block.pairs[block.pairs.length - 1].audioStartMs,
      offsetMs: blockOffset,
      matchCount: block.pairs.length
    };
  });
}

function findBlock(audioTimeMs, blocks) {
  if (blocks.length <= 1) return blocks[0];
  for (let i = 0; i < blocks.length - 1; i++) {
    const nextBlock = blocks[i + 1];
    const splitTime = Math.floor((blocks[i].audioEndMs + nextBlock.audioStartMs) / 2);
    if (audioTimeMs < splitTime) {
      return blocks[i];
    }
  }
  return blocks[blocks.length - 1];
}

/**
 * Applies block offsets to lines and words/syllables
 */
function applyOffsets(lines, blocks, timeUnit = "s") {
  if (!blocks || blocks.length === 0) return lines;

  return lines.map(entry => {
    const copy = JSON.parse(JSON.stringify(entry));
    const entryTimeMs = typeof copy.time === 'number'
      ? (copy.time > 1000 ? Math.round(copy.time) : Math.round(copy.time * 1000))
      : (typeof copy.startTime === 'number' ? Math.round(copy.startTime * 1000) : 0);

    const block = findBlock(entryTimeMs, blocks);
    const offsetMs = block.offsetMs;
    const offsetSec = offsetMs / 1000.0;

    const newTimeMs = Math.max(0, entryTimeMs + offsetMs);

    if (copy.hasOwnProperty('time')) {
      copy.time = timeUnit === 'ms' ? newTimeMs : (newTimeMs / 1000);
    }
    if (copy.hasOwnProperty('startTime')) {
      copy.startTime = timeUnit === 'ms' ? newTimeMs : (newTimeMs / 1000);
    }

    if (typeof copy.endTime === 'number') {
      const origEndMs = copy.endTime > 1000 ? Math.round(copy.endTime) : Math.round(copy.endTime * 1000);
      const newEndMs = Math.max(newTimeMs + 1, origEndMs + offsetMs);
      copy.endTime = timeUnit === 'ms' ? newEndMs : (newEndMs / 1000);
    }

    if (typeof copy.duration === 'number') {
      const durMs = copy.duration > 1000 ? Math.round(copy.duration) : Math.round(copy.duration * 1000);
      copy.duration = timeUnit === 'ms' ? durMs : (durMs / 1000);
    }

    const sylKey = copy.hasOwnProperty('syllabus') ? 'syllabus' : (copy.hasOwnProperty('syllables') ? 'syllables' : (copy.hasOwnProperty('words') ? 'words' : null));
    if (sylKey && Array.isArray(copy[sylKey])) {
      copy[sylKey].forEach(w => {
        if (typeof w.startTime === 'number') {
          const wStartSec = w.startTime > 1000 ? w.startTime / 1000 : w.startTime;
          const adjustedSec = Math.max(0, wStartSec + offsetSec);
          w.startTime = w.startTime > 1000 ? Math.round(adjustedSec * 1000) : adjustedSec;
        }
        if (typeof w.endTime === 'number') {
          const wEndSec = w.endTime > 1000 ? w.endTime / 1000 : w.endTime;
          const adjustedSec = Math.max(0, wEndSec + offsetSec);
          w.endTime = w.endTime > 1000 ? Math.round(adjustedSec * 1000) : adjustedSec;
        }
        if (typeof w.time === 'number') {
          // Keep in ms if originally > 1000 or in seconds if originally seconds
          const isMs = w.time > 1000 || timeUnit === 'ms';
          const wSec = isMs ? w.time / 1000 : w.time;
          const adjustedSec = Math.max(0, wSec + offsetSec);
          w.time = isMs ? Math.round(adjustedSec * 1000) : adjustedSec;
        }
      });
    }

    return copy;
  });
}

/**
 * Retimes lyrics end-times by analyzing overlaps and gaps in a multi-pass process.
 * JavaScript port of retimeLyrics from Reference/Retimer.
 */
function retimeLyrics(lyrics, gapAfterIndex = new Set()) {
  if (!Array.isArray(lyrics) || lyrics.length === 0) return [];

  const lines = lyrics.map((e) => {
    let startMs = 0;
    if (typeof e.startTime === 'number') {
      startMs = Math.round(e.startTime * 1000);
    } else if (typeof e.time === 'number') {
      startMs = e.time > 1000 ? Math.round(e.time) : Math.round(e.time * 1000);
    }

    let endMs = startMs;
    if (typeof e.endTime === 'number') {
      endMs = e.endTime > 1000 ? Math.round(e.endTime) : Math.round(e.endTime * 1000);
    } else {
      const syls = e.syllabus || e.syllables || e.words;
      if (Array.isArray(syls) && syls.length > 0) {
        const lastSyl = syls[syls.length - 1];
        if (typeof lastSyl.endTime === 'number') {
          endMs = lastSyl.endTime > 1000 ? Math.round(lastSyl.endTime) : Math.round(lastSyl.endTime * 1000);
        } else if (typeof lastSyl.time === 'number') {
          endMs = lastSyl.time > 1000 ? Math.round(lastSyl.time) : Math.round(lastSyl.time * 1000);
        }
      }
    }

    return {
      entry: e,
      startMs,
      originalEndMs: endMs,
      newEndMs: endMs
    };
  });

  const len = lines.length;
  let i = 0;
  while (i < len) {
    let clusterEnd = i;
    let maxEndInRange = lines[i].originalEndMs;

    while (clusterEnd < len - 1) {
      const next = lines[clusterEnd + 1];
      const overlap = maxEndInRange - next.startMs;
      if (overlap > RETIMING_OVERLAP_THRESHOLD_MS) {
        clusterEnd++;
        maxEndInRange = Math.max(maxEndInRange, next.originalEndMs);
      } else {
        break;
      }
    }

    let clusterBaseEnd = lines[i].originalEndMs;
    for (let c = i + 1; c <= clusterEnd; c++) {
      clusterBaseEnd = Math.max(clusterBaseEnd, lines[c].originalEndMs);
    }
    let clusterFinalEnd = clusterBaseEnd;

    const lineAfter = lines[clusterEnd + 1];
    if (lineAfter) {
      const gap = lineAfter.startMs - clusterBaseEnd;
      const hasManualGap = gapAfterIndex instanceof Set
        ? gapAfterIndex.has(clusterEnd)
        : (Array.isArray(gapAfterIndex) && gapAfterIndex.includes(clusterEnd));

      if (gap > RETIMING_GAP_THRESHOLD_MS && !hasManualGap) {
        clusterFinalEnd += Math.min(RETIMING_MAX_EXTENSION_MS, gap);
      }
    }

    for (let j = i; j <= clusterEnd; j++) {
      let cutoff = null;
      for (let k = j + 1; k <= clusterEnd; k++) {
        const jClearsK = lines[j].originalEndMs - lines[k].startMs <= RETIMING_OVERLAP_THRESHOLD_MS;
        const chainBrokenAtK = lines[k - 1].originalEndMs - lines[k].startMs <= RETIMING_OVERLAP_THRESHOLD_MS;
        if (jClearsK || chainBrokenAtK) {
          cutoff = lines[k].startMs;
          break;
        }
      }
      lines[j].newEndMs = cutoff !== null ? cutoff : clusterFinalEnd;
    }

    i = clusterEnd + 1;
  }

  return lines.map((w) => {
    const adjustedEndTimeMs = Math.abs(w.newEndMs - w.originalEndMs) > RETIMING_GAP_THRESHOLD_MS
      ? w.newEndMs
      : w.originalEndMs;
    return {
      entry: w.entry,
      actualEndTimeMs: w.originalEndMs,
      adjustedEndTimeMs
    };
  });
}

/**
 * Retimes rich lyrics lines against a single subtitle cue track.
 * 1:1 implementation of MusicVideoLyricsRetimer.retimeLyrics(lyrics, cues).
 */
function retimeLyricsWithSingleCueTrack(lyricsLines, cues, timeUnit = "s") {
  if (!Array.isArray(lyricsLines) || lyricsLines.length === 0) return null;
  if (!Array.isArray(cues) || cues.length === 0) return null;

  const lyricTokens = tokenizeLyrics(lyricsLines);
  const subtitleTokens = tokenizeSubtitles(cues);

  if (lyricTokens.length === 0 || subtitleTokens.length === 0) return null;

  const matches = align(lyricTokens, subtitleTokens);
  if (matches.length === 0) return null;

  const blocks = detectBlocks(matches);
  if (blocks.length === 0) return null;

  const score = matches.length / Math.max(1, lyricTokens.length);
  const retimedLines = applyOffsets(lyricsLines, blocks, timeUnit);

  return {
    document: retimedLines,
    score,
    blocks
  };
}

/**
 * Main entry point: tries all available subtitle tracks and selects the best matching one.
 * Matches getRetimedMvLyrics in LyricsRepository.kt.
 */
function retimeLyricsWithSubtitles(lyricsData, subtitleDataOrTracks, timeUnit = "s") {
  if (!Array.isArray(lyricsData) || lyricsData.length === 0) return null;
  if (!subtitleDataOrTracks) return null;

  let candidateTracks = [];
  if (Array.isArray(subtitleDataOrTracks)) {
    if (subtitleDataOrTracks.length > 0 && (subtitleDataOrTracks[0].data || subtitleDataOrTracks[0].tracks)) {
      candidateTracks = subtitleDataOrTracks.map(t => t.data || t).filter(Boolean);
    } else {
      candidateTracks = [subtitleDataOrTracks];
    }
  } else if (subtitleDataOrTracks.tracks && Array.isArray(subtitleDataOrTracks.tracks)) {
    candidateTracks = subtitleDataOrTracks.tracks.map(t => t.data || t).filter(Boolean);
  } else if (subtitleDataOrTracks.data && Array.isArray(subtitleDataOrTracks.data)) {
    candidateTracks = [subtitleDataOrTracks.data];
  }

  if (candidateTracks.length === 0) return null;

  let bestResult = null;

  for (let index = 0; index < candidateTracks.length; index++) {
    const cues = Array.isArray(candidateTracks[index]) ? candidateTracks[index] : (candidateTracks[index].data || []);
    if (cues.length === 0) continue;

    const result = retimeLyricsWithSingleCueTrack(lyricsData, cues, timeUnit);
    if (!result) continue;

    if (result.score >= SCORE_MEDIUM_CONFIDENCE) {
      if (!bestResult || result.score > bestResult.score) {
        bestResult = result;
      }
    }
    if (result.score >= 0.85) {
      break; // High confidence reached
    }
  }

  if (!bestResult || !bestResult.document) {
    return null;
  }

  return bestResult.document;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    retimeLyrics,
    retimeLyricsWithSubtitles,
    retimeLyricsWithSingleCueTrack,
    tokenizeLyrics,
    tokenizeSubtitles,
    align,
    detectBlocks,
    applyOffsets,
    normalizeWord,
    canonicalWord,
    wordsMatch,
    SCORE_HIGH_CONFIDENCE,
    SCORE_MEDIUM_CONFIDENCE
  };
}
