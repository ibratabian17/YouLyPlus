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

    const [fullLineResults, isolatedResults] = await Promise.all([
      this.romanizeTexts(allLines),
      this.romanizeTexts(allSyllables)
    ]);

    let globalSyllableIndex = 0;

    return originalLyrics.data.map((line, index) => {
      const fullLineRom = fullLineResults[index] || "";
      const count = lineStructure[index];
      const guideChunks = isolatedResults.slice(globalSyllableIndex, globalSyllableIndex + count);
      globalSyllableIndex += count;

      const alignedChunks = this.alignRomanizationAnchors(fullLineRom, guideChunks);

      const formattedChunks = (line.syllabus || []).map((s, i) => ({
        text: alignedChunks[i] + " "
      }));

      return {
        text: formattedChunks.map(c => c.text).join(""),
        chunk: formattedChunks,
        original_line_index: index
      };
    });
  }

  static alignRomanizationAnchors(fullText, guideChunks) {
    let remainingText = fullText.trim().replace(/\s+/g, '').toLowerCase();
    const results = new Array(guideChunks.length).fill("");
    let bufferIndices = [];

    for (let i = 0; i < guideChunks.length; i++) {
      const rawGuide = guideChunks[i].trim().replace(/\s+/g, '').toLowerCase();

      if (!rawGuide) {
        bufferIndices.push(i);
        continue;
      }

      const scanLimit = Math.max(10, bufferIndices.length * 8 + rawGuide.length + 5);
      const searchSpace = remainingText.substring(0, scanLimit);

      const match = this.findBestMatch(rawGuide, searchSpace);

      if (match.found) {
        const preamble = remainingText.substring(0, match.index);

        if (bufferIndices.length > 0) {
          this.distributeTextToBuffer(preamble, bufferIndices, guideChunks, results);
        } else if (preamble.length > 0) {
          if (i > 0) results[i - 1] += preamble;
        }

        results[i] = remainingText.substring(match.index, match.index + match.length);
        remainingText = remainingText.substring(match.index + match.length);
        bufferIndices = [];
      } else {
        bufferIndices.push(i);
      }
    }

    if (remainingText.length > 0 && bufferIndices.length > 0) {
      this.distributeTextToBuffer(remainingText, bufferIndices, guideChunks, results);
    } else if (remainingText.length > 0 && results.length > 0) {
      results[results.length - 1] += remainingText;
    }

    return results;
  }

  static findBestMatch(guide, text) {
    if (!text) return { found: false };

    const maxErrors = guide.length <= 2 ? 0 : Math.floor(guide.length * 0.35);
    let bestDist = Infinity;
    let bestIndex = -1;
    let bestLen = -1;

    for (let idx = 0; idx < text.length; idx++) {
      if (bestDist === 0 && bestIndex === 0) break;

      for (let lenOffset = -1; lenOffset <= 2; lenOffset++) {
        const len = guide.length + lenOffset;
        if (len <= 0) continue;
        if (idx + len > text.length) continue;

        const candidate = text.substring(idx, idx + len);
        const dist = this.levenshteinDistance(guide, candidate);

        if (dist <= maxErrors) {
          if (dist < bestDist || (dist === bestDist && idx < bestIndex)) {
            bestDist = dist;
            bestIndex = idx;
            bestLen = len;
          }
        }
      }
    }

    return bestIndex !== -1 ? { found: true, index: bestIndex, length: bestLen } : { found: false };
  }

  static distributeTextToBuffer(text, bufferIndices, guideChunks, results) {
    if (bufferIndices.length === 0) return;

    const totalGuideLen = bufferIndices.reduce((sum, idx) => sum + guideChunks[idx].length, 0);
    let currentIndex = 0;

    bufferIndices.forEach((bIdx, i) => {
      if (i === bufferIndices.length - 1) {
        results[bIdx] = text.substring(currentIndex);
        return;
      }

      const weight = guideChunks[bIdx].length / totalGuideLen;
      let charCount = Math.round(text.length * weight);

      if (charCount === 0 && text.length > bufferIndices.length) charCount = 1;

      results[bIdx] = text.substring(currentIndex, currentIndex + charCount);
      currentIndex += charCount;
    });
  }

  static levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[b.length][a.length];
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
          const res = batchResultArray[batchIndex] !== undefined ? batchResultArray[batchIndex] : originalText;
          const originalGlobalIndex = validIndices[i + batchIndex];
          resultsMap[originalGlobalIndex] = res;
        });

      } catch (e) {
        console.error("GoogleService: Batch failed, falling back to original text", e);
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

      if (!data || !data[0]) return [];

      const fullRomanizedString = data[0]
        .map(segment => segment[3] || segment[0] || "")
        .join("");

      return fullRomanizedString.replaceAll('| ', '|').replaceAll(' |', '|').split('|').map(t => t);

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