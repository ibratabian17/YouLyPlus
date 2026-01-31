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
    const allSyllables = [];
    originalLyrics.data.forEach(line => {
      line.syllabus?.forEach(s => allSyllables.push(s.text));
    });

    const romanizedResults = await this.romanizeTexts(allSyllables);

    let globalIndex = 0;
    return originalLyrics.data.map((line, lineIndex) => {
      const chunks = line.syllabus?.map(s => {
        const rom = romanizedResults[globalIndex++] || s.text;
        return {
          text: rom + " "
        };
      }) || [];

      return {
        text: chunks.map(c => c.text).join(""),
        chunk: chunks,
        original_line_index: lineIndex
      };
    });
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

    // Filter valid texts
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

      return fullRomanizedString.split('|').map(t => t);

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