import { TranslationProvider } from '../TranslationProvider.js';
import { OfflineRomanizer } from '../../romanization/offlineRomanizer.js';
import { rawiDiacritizer } from '../../romanization/rawiDiacritizer.js';
import { dictionaryService } from '../../romanization/dictionaryService.js';

export class OfflineRomanizationProvider extends TranslationProvider {
  /**
   * Detects the dominant language context across the entire lyrics and song metadata.
   * @param {Object} originalLyrics
   * @param {Object} songInfo
   * @returns {'japanese'|'chinese'|'korean'|'cyrillic'|'arabic'|'unknown'}
   */
  static detectLanguageContext(originalLyrics, songInfo = {}) {
    let allText = '';
    if (songInfo?.title) allText += songInfo.title + ' ';
    if (songInfo?.artist) allText += songInfo.artist + ' ';
    if (songInfo?.album) allText += songInfo.album + ' ';

    if (Array.isArray(originalLyrics?.data)) {
      for (const line of originalLyrics.data) {
        if (line.text) allText += line.text + ' ';
      }
    }

    const hangulMatches = allText.match(/[\uAC00-\uD7A3\u3131-\u318E]/g);
    const hangulCount = hangulMatches ? hangulMatches.length : 0;

    const kanaMatches = allText.match(/[\u3040-\u309F\u30A0-\u30FF]/g);
    const kanaCount = kanaMatches ? kanaMatches.length : 0;

    const cyrillicMatches = allText.match(/[\p{Script=Cyrillic}]/gu);
    const cyrillicCount = cyrillicMatches ? cyrillicMatches.length : 0;

    const hanziMatches = allText.match(/[\u4E00-\u9FFF]/g);
    const hanziCount = hanziMatches ? hanziMatches.length : 0;

    const arabicMatches = allText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
    const arabicCount = arabicMatches ? arabicMatches.length : 0;

    if (arabicCount > 0 && arabicCount >= kanaCount && arabicCount >= hangulCount && arabicCount >= hanziCount && arabicCount >= cyrillicCount) {
      return 'arabic';
    }

    if (hangulCount > 0 && hangulCount >= kanaCount) {
      return 'korean';
    }

    // Japanese: Hiragana/Katakana presence confirms Japanese context
    if (kanaCount > 0) {
      return 'japanese';
    }

    if (hanziCount > 0 && kanaCount === 0) {
      return 'chinese';
    }

    if (cyrillicCount > 0) {
      return 'cyrillic';
    }

    return 'unknown';
  }

  /**
   * Romanizes the lyrics locally, syllable by syllable without external APIs.
   * @param {Object} originalLyrics - The original lyrics object.
   * @param {string} targetLang - Target language code.
   * @param {Object} songInfo - Optional song metadata.
   * @param {string} targetScript - Target script (defaults to 'latin').
   * @returns {Promise<Object[]>} - Array of processed line objects.
   */
  async romanize(originalLyrics, targetLang, songInfo = {}, targetScript = 'latin') {
    if (targetScript && targetScript !== 'latin') {
      throw new Error('Local / Offline transliteration only supports Latin alphabet.');
    }

    const langContext = OfflineRomanizationProvider.detectLanguageContext(originalLyrics, songInfo);
    let tokenizer = null;
    if (langContext === 'japanese') {
      tokenizer = await dictionaryService.getKuromojiTokenizer();
    } else if (langContext === 'arabic') {
      await rawiDiacritizer.ensureLoaded();
    }

    if (originalLyrics.type === 'Word') {
      return await this.romanizeWordSynced(originalLyrics, langContext, tokenizer);
    }
    return await this.romanizeLineSynced(originalLyrics, langContext, tokenizer);
  }

  async romanizeWordSynced(originalLyrics, langContext, tokenizer = null) {
    return Promise.all(
      originalLyrics.data.map(async (line, index) => {
        const originalSyllables = line.syllabus || [];
        const lineText = line.text || '';

        const formattedChunks = await OfflineRomanizer.romanizeLineSyllables(
          originalSyllables,
          lineText,
          langContext,
          tokenizer
        );

        const fullRomanized = lineText
          ? await OfflineRomanizer.romanizeLine(lineText, langContext, tokenizer)
          : formattedChunks.map((c) => c.text).join('');

        return {
          text: fullRomanized || line.text || '',
          romanizedText: fullRomanized || line.text || '',
          chunk: formattedChunks,
          original_line_index: index
        };
      })
    );
  }

  async romanizeLineSynced(originalLyrics, langContext, tokenizer = null) {
    return Promise.all(
      originalLyrics.data.map(async (line, index) => {
        const textToRomanize = line.text || '';
        const romanized = await OfflineRomanizer.romanizeLine(textToRomanize, langContext, tokenizer);

        return {
          text: romanized || line.text || '',
          romanizedText: romanized || line.text || '',
          original_line_index: index
        };
      })
    );
  }
}
