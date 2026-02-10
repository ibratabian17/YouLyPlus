// ==================================================================================================
// EXTERNAL SERVICE - GOOGLE
// ==================================================================================================

import { Utilities } from '../utils/utilities.js';
import { CONFIG } from '../constants.js';

export class GoogleService {
  static async translate(text, targetLang) {
    if (!text.trim()) return "";

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Translate error: ${response.statusText}`);

    const data = await response.json();
    return data?.[0]?.map(segment => segment?.[0]).join('') || text;
  }

  static async romanize(originalLyrics) {
    let processedData;

    if (originalLyrics.type === "Word") {
      processedData = await this.romanizeWordSynced(originalLyrics);
    } else {
      processedData = await this.romanizeLineSynced(originalLyrics);
    }

    return processedData;
  }

  static async romanizeWordSynced(originalLyrics) {
    const allLines = [];
    const allSyllables = [];
    const lineStructure = [];

    originalLyrics.data.forEach(line => {
      allLines.push(line.text);
      const syllables = line.syllabus?.map(s => s.text) || [];
      lineStructure.push(syllables.length);
      syllables.forEach(s => allSyllables.push(s));
    });

    /**
     * Parallel fetch: 
     * Syllable guides help determine cut points.
     * Full lines ensure correct phonetic context and spacing from the engine.
     */
    const [fullLineResults, isolatedResults] = await Promise.all([
      this.romanizeTexts(allLines),
      this.romanizeTexts(allSyllables)
    ]);

    let globalSyllableIndex = 0;

    return originalLyrics.data.map((line, index) => {
      const fullLineRom = fullLineResults[index] || "";
      const count = lineStructure[index];

      const romanizedGuides = isolatedResults.slice(globalSyllableIndex, globalSyllableIndex + count);
      const originalSyllables = line.syllabus || [];

      globalSyllableIndex += count;

      const alignedChunks = this.alignRomanizationAnchors(fullLineRom, romanizedGuides, originalSyllables);

      const formattedChunks = originalSyllables.map((s, i) => {
        return {
          text: alignedChunks[i]
        };
      });

      return {
        text: formattedChunks.map(c => c.text).join(""),
        chunk: formattedChunks,
        original_line_index: index
      };
    });
  }

  static alignRomanizationAnchors(fullText, romanizedGuides, originalSyllables) {
    // Partition fullText into M segments that phonetically match the guides while preserving spaces.
    const target = fullText;
    const N = target.length;
    const M = romanizedGuides.length;

    if (M === 0) return [];
    if (N === 0) return romanizedGuides.map(() => "");

    const dp = Array.from({ length: M + 1 }, () => new Float64Array(N + 1).fill(Number.MAX_VALUE));
    const path = Array.from({ length: M + 1 }, () => new Int32Array(N + 1).fill(-1));

    dp[0][0] = 0;

    for (let i = 1; i <= M; i++) {
      const guideRom = romanizedGuides[i - 1];
      const isLatin = Utilities.isPurelyLatinScript(originalSyllables[i - 1].text);
      const guideLen = guideRom.length;

      // Latin uses strict length; Japanese uses flexible length for contracted sounds/particles.
      const minLen = isLatin ? Math.max(1, guideLen - 1) : 1;
      const maxLen = isLatin ? guideLen + 3 : Math.max(guideLen * 3 + 3, 15);

      for (let j = 1; j <= N; j++) {
        let bestLocalCost = Number.MAX_VALUE;
        let bestPrevJ = -1;

        for (let len = minLen; len <= maxLen; len++) {
          const k = j - len;
          if (k < 0) break;

          if (dp[i - 1][k] === Number.MAX_VALUE) continue;

          const candidate = target.substring(k, j);
          const segmentCost = this.calculateMatchCost(candidate, guideRom, isLatin);

          const totalCost = dp[i - 1][k] + segmentCost;

          if (totalCost < bestLocalCost) {
            bestLocalCost = totalCost;
            bestPrevJ = k;
          }
        }

        dp[i][j] = bestLocalCost;
        path[i][j] = bestPrevJ;
      }
    }

    const results = new Array(M);
    let currJ = N;

    // Fallback: if exact end unreachable, find best possible endpoint
    if (dp[M][N] === Number.MAX_VALUE) {
      let minEndCost = Number.MAX_VALUE;
      for (let k = N; k >= 0; k--) {
        if (dp[M][k] < minEndCost) {
          minEndCost = dp[M][k];
          currJ = k;
        }
      }
    }

    for (let i = M; i > 0; i--) {
      const prevJ = path[i][currJ];
      if (prevJ === -1) {
        results[i - 1] = "";
      } else {
        results[i - 1] = target.substring(prevJ, currJ);
        currJ = prevJ;
      }
    }

    // Distribute remaining characters to first/last chunks
    if (currJ > 0 && results.length > 0) {
      results[0] = target.substring(0, currJ) + results[0];
    }
    const totalLen = results.join("").length;
    if (totalLen < N && results.length > 0) {
      results[results.length - 1] += target.substring(totalLen);
    }

    return results;
  }

  static calculateMatchCost(candidate, guide, isLatin) {
    const cTrim = candidate.trim();
    const gTrim = guide.trim();

    if (!cTrim && gTrim) return 50;

    const cLower = cTrim.toLowerCase();
    const gLower = gTrim.toLowerCase();
    const dist = Utilities.levenshteinDistance(cLower, gLower);

    if (isLatin) {
      // High penalty for Latin mismatches to keep strict alignment
      return dist * 50 + (Math.abs(candidate.length - guide.length) * 0.5);
    }

    const lenDiff = Math.abs(cTrim.length - gTrim.length);
    const hasTrailingSpace = candidate.endsWith(" ");
    const bonus = hasTrailingSpace ? -0.5 : 0;

    return dist + (lenDiff * 0.8) + bonus;
  }

  static async romanizeLineSynced(originalLyrics) {
    const texts = originalLyrics.data.map(line => line.text);
    const romanizedResults = await this.romanizeTexts(texts);

    return originalLyrics.data.map((line, index) => ({
      ...line,
      text: romanizedResults[index] || line.text,
      romanizedText: romanizedResults[index] || line.text
    }));
  }

  static async romanizeTexts(texts) {
    const validIndices = [];
    const textsToFetch = [];

    texts.forEach((text, index) => {
      if (text && !Utilities.isPurelyLatinScript(text)) {
        validIndices.push(index);
        textsToFetch.push(text);
      }
    });

    if (textsToFetch.length === 0) return texts;

    const BATCH_SIZE = 50;
    const resultsMap = {};

    for (let i = 0; i < textsToFetch.length; i += BATCH_SIZE) {
      const batch = textsToFetch.slice(i, i + BATCH_SIZE);
      const batchText = batch.join('|');

      try {
        const batchResultArray = await this.fetchRomanizationWithRetry(batchText);

        batch.forEach((originalText, batchIndex) => {
          if (batchResultArray[batchIndex] !== undefined) {
            resultsMap[validIndices[i + batchIndex]] = batchResultArray[batchIndex];
          } else {
            resultsMap[validIndices[i + batchIndex]] = originalText;
          }
        });

      } catch (e) {
        console.error("GoogleService: Batch failed", e);
      }
    }

    return texts.map((text, index) => resultsMap[index] || text);
  }

  static async fetchRomanizationWithRetry(text, attempt = 0) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
      const response = await fetch(url);

      if (response.status === 429) throw new Error("Rate Limit Exceeded");

      const data = await response.json();

      const fullRomanizedString = data?.[0]
        ?.map(segment => segment?.[3] || segment?.[0] || "")
        .join("") || "";

      if (!fullRomanizedString) return text.split('|');

      return fullRomanizedString
        .replace(/\s*\|\s*/g, '|')
        .split('|');

    } catch (error) {
      if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
        const delay = CONFIG.GOOGLE.RETRY_DELAY_MS * Math.pow(2, attempt);
        await Utilities.delay(delay);
        return this.fetchRomanizationWithRetry(text, attempt + 1);
      }
      throw error;
    }
  }
}