/**
 * Master Offline Romanizer Dispatcher.
 * Uses song-level and line-level language context to prevent crossing
 * Japanese Kanji with Chinese Pinyin and vice versa.
 */

import { KoreanRomanizer } from './koreanRomanizer.js';
import { JapaneseRomanizer } from './japaneseRomanizer.js';
import { PinyinRomanizer } from './pinyinRomanizer.js';
import { CyrillicRomanizer } from './cyrillicRomanizer.js';
import { ArabicRomanizer } from './arabicRomanizer.js';

export class OfflineRomanizer {
  /**
   * Romanizes an array of syllable objects for a line.
   * @param {Array<Object>} syllables - Array of syllable objects (e.g. line.syllabus)
   * @param {string} [lineContext] - Full line text
   * @param {string} [langContext] - Song-level detected language ('japanese'|'chinese'|'korean'|'cyrillic'|'arabic'|'unknown')
   * @param {Object|null} [tokenizer] - Optional Kuromoji tokenizer
   * @returns {Promise<Array<{ text: string }>>}
   */
  static async romanizeLineSyllables(syllables, lineContext = '', langContext = 'unknown', tokenizer = null) {
    if (!Array.isArray(syllables)) return [];

    const isJapanese = langContext === 'japanese' || /[\u3040-\u309F\u30A0-\u30FF]/u.test(lineContext);

    if (isJapanese) {
      return JapaneseRomanizer.romanizeSyllables(syllables, lineContext, tokenizer);
    }

    const isArabic = langContext === 'arabic' || /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(lineContext);

    if (isArabic) {
      return await ArabicRomanizer.romanizeSyllables(syllables, lineContext);
    }

    const isChinese = langContext === 'chinese' || (!isJapanese && /[\u4E00-\u9FFF]/u.test(lineContext));

    return syllables.map((s, idx) => {
      let rom = this.romanizeSyllable(s.text || '', lineContext, langContext);
      const hasTrail = /\s$/.test(s.text || '');
      if (isChinese && !hasTrail && idx < syllables.length - 1 && rom && !/\s$/.test(rom)) {
        rom += ' ';
      }
      return { text: rom };
    });
  }

  /**
   * Romanizes a single syllable text chunk.
   * @param {string} syllableText - The syllable text.
   * @param {string} [lineContext] - Full line context.
   * @param {string} [langContext] - Song-level detected language ('japanese'|'chinese'|'korean'|'cyrillic'|'arabic'|'unknown').
   * @returns {string}
   */
  static romanizeSyllable(syllableText, lineContext = '', langContext = 'unknown') {
    if (!syllableText) return '';

    const hasTrailingSpace = /\s$/.test(syllableText);
    let romanized = '';

    if (/[\uAC00-\uD7A3\u3131-\u318E]/u.test(syllableText)) {
      romanized = KoreanRomanizer.romanize(syllableText);
    } else if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(syllableText) || langContext === 'arabic') {
      romanized = ArabicRomanizer.romanize(syllableText, lineContext);
    } else if (/[\p{Script=Cyrillic}]/u.test(syllableText)) {
      romanized = CyrillicRomanizer.romanize(syllableText);
    } else if (/[\u3040-\u309F\u30A0-\u30FF]/u.test(syllableText)) {
      romanized = JapaneseRomanizer.romanize(syllableText);
    } else if (/[\u4E00-\u9FFF]/u.test(syllableText)) {
      const isJapanese = langContext === 'japanese' ||
                         /[\u3040-\u309F\u30A0-\u30FF]/u.test(lineContext);

      if (isJapanese) {
        // Strictly Japanese - avoid fallback to Chinese Pinyin
        romanized = JapaneseRomanizer.romanize(syllableText);
      } else {
        // Strictly Chinese - avoid calling Japanese romanizer
        romanized = PinyinRomanizer.romanize(syllableText, lineContext);
      }
    } else {
      romanized = syllableText;
    }

    if (romanized && !/\s$/.test(romanized) && hasTrailingSpace) {
      romanized += ' ';
    }

    return romanized;
  }

  /**
   * Romanizes a full line of text.
   * @param {string} lineText
   * @param {string} [langContext]
   * @param {Object|null} [tokenizer] - Optional Kuromoji tokenizer
   * @returns {Promise<string>|string}
   */
  static async romanizeLine(lineText, langContext = 'unknown', tokenizer = null) {
    if (!lineText) return '';

    if (/[\uAC00-\uD7A3\u3131-\u318E]/u.test(lineText)) {
      return KoreanRomanizer.romanize(lineText);
    }

    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(lineText) || langContext === 'arabic') {
      return await ArabicRomanizer.romanizeLine(lineText);
    }

    if (/[\p{Script=Cyrillic}]/u.test(lineText)) {
      return CyrillicRomanizer.romanize(lineText);
    }

    const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/u.test(lineText);
    const hasHan = /[\u4E00-\u9FFF]/u.test(lineText);

    if (hasKana || langContext === 'japanese') {
      return JapaneseRomanizer.romanize(lineText, tokenizer);
    }

    if (hasHan) {
      return PinyinRomanizer.romanize(lineText);
    }

    return lineText;
  }
}
