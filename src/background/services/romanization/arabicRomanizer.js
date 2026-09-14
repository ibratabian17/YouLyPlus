/**
 * Offline Arabic Romanizer.
 * Supports vocalized/Tashkeel Arabic, sun letters assimilation (الحروف الشمسية)
 * for definite article "ال", and on-the-fly diacritization via Rawi ONNX model.
 */

import { rawiDiacritizer } from './rawiDiacritizer.js';

const ARABIC_CHAR_MAP = {
  '\u0621': "'",
  '\u0622': 'aa',
  '\u0623': 'a',
  '\u0624': "'",
  '\u0625': 'i',
  '\u0626': "'",
  '\u0627': 'a',
  '\u0671': 'a',
  '\u0670': 'aa',

  '\u0628': 'b',
  '\u0629': 'a',
  '\u062A': 't',
  '\u062B': 'th',
  '\u062C': 'j',
  '\u062D': 'h',
  '\u062E': 'kh',
  '\u062F': 'd',
  '\u0630': 'dh',
  '\u0631': 'r',
  '\u0632': 'z',
  '\u0633': 's',
  '\u0634': 'sh',
  '\u0635': 's',
  '\u0636': 'd',
  '\u0637': 't',
  '\u0638': 'z',
  '\u0639': "'",
  '\u063A': 'gh',
  '\u0640': '',
  '\u0641': 'f',
  '\u0642': 'q',
  '\u0643': 'k',
  '\u0644': 'l',
  '\u0645': 'm',
  '\u0646': 'n',
  '\u0647': 'h',
  '\u0648': 'w',
  '\u0649': 'a',
  '\u064A': 'y',

  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',

  '\u060C': ',', '\u061B': ';', '\u061F': '?'
};

// Sun letters (الحروف الشمسية) that cause assimilation of the "l" in "al-"
const SUN_LETTERS = new Set([
  '\u062A',
  '\u062B',
  '\u062F',
  '\u0630',
  '\u0631',
  '\u0632',
  '\u0633',
  '\u0634',
  '\u0635',
  '\u0636',
  '\u0637',
  '\u0638',
  '\u0644',
  '\u0646'
]);

const SUN_LETTER_ROMAN = {
  '\u062A': 't',
  '\u062B': 'th',
  '\u062F': 'd',
  '\u0630': 'dh',
  '\u0631': 'r',
  '\u0632': 'z',
  '\u0633': 's',
  '\u0634': 'sh',
  '\u0635': 's',
  '\u0636': 'd',
  '\u0637': 't',
  '\u0638': 'z',
  '\u0644': 'l',
  '\u0646': 'n'
};

const HARAKAT = {
  '\u064B': 'an',
  '\u064C': 'un',
  '\u064D': 'in',
  '\u064E': 'a',
  '\u064F': 'u',
  '\u0650': 'i',
  '\u0651': 'SHADDAH',
  '\u0652': 'SUKUN',
  '\u0670': 'aa'
};

export class ArabicRomanizer {
  static async romanize(text, lineContext = '') {
    if (!text) return '';
    return await this.romanizeLine(text);
  }

  /**
   * Aligns vocalized Arabic text back onto original syllable slices.
   * Matches base letters with their attached Harakat/Tashkeel combining marks.
   */
  static alignVocalizedToSyllables(unvocalizedSyllables, vocalizedLine) {
    if (!Array.isArray(unvocalizedSyllables)) return [];
    if (!vocalizedLine) return unvocalizedSyllables.map(s => s.text || '');

    const alreadyVocalized = unvocalizedSyllables.some(s => s.text && /[\u064B-\u0652\u0670]/u.test(s.text));
    if (alreadyVocalized) {
      return unvocalizedSyllables.map(s => s.text || '');
    }

    const tokens = vocalizedLine.match(/\p{L}[\p{Mn}]*|[^\p{L}]/gu) || [];
    let tokenIdx = 0;

    return unvocalizedSyllables.map(s => {
      const origText = s.text || '';
      const bareText = origText.replace(/[\u064B-\u0652\u0670]/gu, '');
      let vocalizedChunk = '';

      for (const ch of bareText) {
        if (/\p{L}/u.test(ch)) {
          while (tokenIdx < tokens.length) {
            const tok = tokens[tokenIdx++];
            vocalizedChunk += tok;
            if (/\p{L}/u.test(tok)) break;
          }
        } else {
          vocalizedChunk += ch;
        }
      }

      return vocalizedChunk || origText;
    });
  }

  static async romanizeSyllables(syllables, lineContext = '') {
    if (!Array.isArray(syllables)) return [];

    let alignedVocalized = null;
    const isUnvocalized = lineContext && !/[\u064B-\u0652\u0670]/u.test(lineContext);

    if (isUnvocalized && rawiDiacritizer.isReady()) {
      const vocalizedLine = await rawiDiacritizer.diacritize(lineContext);
      if (vocalizedLine && vocalizedLine !== lineContext) {
        alignedVocalized = this.alignVocalizedToSyllables(syllables, vocalizedLine);
      }
    }

    return syllables.map((s, idx) => {
      const origText = s.text || '';
      const textToRomanize = (alignedVocalized && alignedVocalized[idx]) ? alignedVocalized[idx] : origText;
      let rom = this.romanizeVocalizedLine(textToRomanize);

      const hasTrail = /\s$/.test(origText);
      if (hasTrail && rom && !/\s$/.test(rom)) {
        rom += ' ';
      }

      return { text: rom };
    });
  }

  static async romanizeLine(lineText) {
    if (!lineText) return '';

    let textToProcess = lineText;
    const isUnvocalized = !/[\u064B-\u0652\u0670]/u.test(lineText);

    if (isUnvocalized && rawiDiacritizer.isReady()) {
      textToProcess = await rawiDiacritizer.diacritize(lineText);
    }

    return this.romanizeVocalizedLine(textToProcess);
  }

  static romanizeVocalizedLine(lineText) {
    if (!lineText) return '';

    const tokens = lineText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/gu) || [lineText];

    let result = '';
    for (const token of tokens) {
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(token)) {
        result += this.romanizeWordOrPhrase(token);
      } else {
        result += token;
      }
    }

    return result;
  }

  static romanizeWordOrPhrase(token) {
    if (!token) return '';

    const hasTashkeel = /[\u064B-\u0652\u0670]/u.test(token);
    if (hasTashkeel) {
      return this.romanizeVocalized(token);
    }

    if (token === 'الله') {
      return 'Allah';
    }

    if (token.startsWith('ال') && token.length > 2) {
      const sunChar = token[2];
      const remainder = token.substring(2);

      if (SUN_LETTERS.has(sunChar)) {
        return 'a' + SUN_LETTER_ROMAN[sunChar] + '-' + this.phonotacticTransliterate(remainder);
      } else {
        return 'al-' + this.phonotacticTransliterate(remainder);
      }
    }

    return this.phonotacticTransliterate(token);
  }

  /**
   * Accurately romanizes fully/partially vocalized Arabic using Harakat rules.
   * Handles Shaddah (gemination), Tanwin, Long vowels, Sun letters, Wasla, and Attached Prefixes.
   */
  static romanizeVocalized(text) {
    if (!text) return '';

    const bare = text.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
    const caseEnding = text.endsWith('\u0650') ? 'i' : (text.endsWith('\u064F') ? 'u' : (text.endsWith('\u064E') ? 'a' : ''));
    if (bare === 'الله') return 'Allah' + caseEnding;
    if (bare === 'والله') return 'Wallah' + caseEnding;
    if (bare === 'بالله') return 'Billah' + caseEnding;
    if (bare === 'فالله') return 'Fallah' + caseEnding;
    if (bare === 'لله') return 'lillah' + caseEnding;

    let result = '';
    const chars = Array.from(text);
    const len = chars.length;

    let i = 0;

    let prefix = '';
    let artStart = 0;

    if (len >= 4 && (chars[0] === 'ف' || chars[0] === 'و' || chars[0] === 'ب' || chars[0] === 'ك') && HARAKAT[chars[1]] !== undefined && (chars[2] === 'ا' || chars[2] === 'ٱ' || chars[2] === 'أ') && chars[3] === 'ل') {
      const pChar = chars[0];
      const pVowel = HARAKAT[chars[1]] === 'i' ? 'i' : (HARAKAT[chars[1]] === 'u' ? 'u' : 'a');
      prefix = (pChar === 'ف' ? 'f' : (pChar === 'و' ? 'w' : (pChar === 'ب' ? 'b' : 'k'))) + pVowel;
      artStart = 2;
    } else if (len >= 3 && (chars[0] === 'ف' || chars[0] === 'و' || chars[0] === 'ب' || chars[0] === 'ك') && (chars[1] === 'ا' || chars[1] === 'ٱ' || chars[1] === 'أ') && chars[2] === 'ل') {
      const pChar = chars[0];
      const pVowel = (pChar === 'ب' ? 'i' : 'a');
      prefix = (pChar === 'ف' ? 'f' : (pChar === 'و' ? 'w' : (pChar === 'ب' ? 'b' : 'k'))) + pVowel;
      artStart = 1;
    }

    let hasSunLetterPrefix = false;
    const checkIdx = prefix ? artStart : 0;
    if (len >= checkIdx + 2 && (chars[checkIdx] === 'ا' || chars[checkIdx] === 'ٱ' || chars[checkIdx] === 'أ') && chars[checkIdx + 1] === 'ل') {
      let nextIdx = checkIdx + 2;
      while (nextIdx < len && HARAKAT[chars[nextIdx]] !== undefined) nextIdx++;

      if (nextIdx < len) {
        const nextC = chars[nextIdx];
        if (SUN_LETTERS.has(nextC)) {
          const sunRom = SUN_LETTER_ROMAN[nextC];
          if (prefix) {
            result += prefix + sunRom + '-';
          } else {
            result += 'a' + sunRom + '-';
          }
          hasSunLetterPrefix = true;
          i = nextIdx;
        } else {
          if (prefix) {
            result += prefix + 'l-';
          } else {
            result += 'al-';
          }
          i = nextIdx;
        }
      }
    }

    while (i < len) {
      const c = chars[i];

      if (HARAKAT[c] !== undefined) {
        i++;
        continue;
      }

      let baseRom = ARABIC_CHAR_MAP[c] !== undefined ? ARABIC_CHAR_MAP[c] : c;

      let hasShaddah = false;
      let vowel = '';
      let j = i + 1;

      while (j < len && HARAKAT[chars[j]] !== undefined) {
        const dia = chars[j];
        if (dia === '\u0651') {
          hasShaddah = true;
        } else if (dia === '\u0652') {
          vowel = '';
        } else {
          vowel = HARAKAT[dia];
        }
        j++;
      }

      if (hasSunLetterPrefix) {
        hasShaddah = false;
        hasSunLetterPrefix = false;
      }

      if (hasShaddah) {
        if (baseRom === 'sh') baseRom = 'shsh';
        else if (baseRom === 'th') baseRom = 'thth';
        else if (baseRom === 'kh') baseRom = 'khkh';
        else if (baseRom === 'dh') baseRom = 'dhdh';
        else if (baseRom === 'gh') baseRom = 'ghgh';
        else if (baseRom.length === 1 && /[a-zA-Z]/.test(baseRom)) baseRom = baseRom + baseRom;
      }

      if (j < len) {
        const nextChar = chars[j];
        if (vowel === 'a' && (nextChar === '\u0627' || nextChar === '\u0649')) {
          vowel = 'a';
          j++;
        } else if (vowel === 'i' && nextChar === '\u064A') {
          vowel = 'i';
          j++;
        } else if (vowel === 'u' && nextChar === '\u0648') {
          vowel = 'oo';
          j++;
        } else if (vowel === 'an' && (nextChar === '\u0627' || nextChar === '\u0649')) {
          j++;
        }
      }

      if (c === '\u0623' || c === '\u0625') {
        if (vowel === 'u') baseRom = 'u';
        else if (vowel === 'i') baseRom = 'i';
        else baseRom = 'a';
        vowel = '';
      } else if (c === '\u0622') {
        baseRom = 'aa';
        vowel = '';
      } else if (c === '\u0639') {
        baseRom = vowel ? ("'" + vowel) : "'";
        vowel = '';
      } else if (c === '\u0629') {
        if (result.endsWith('a')) baseRom = '';
        else baseRom = 'a';
        vowel = '';
      } else if (c === '\u0649') {
        if (result.endsWith('a')) baseRom = '';
        else baseRom = 'a';
        vowel = '';
      } else if ((c === '\u0627' || c === '\u0649') && vowel === 'an') {
        baseRom = '';
      }

      result += baseRom + vowel;
      i = j;
    }

    return result;
  }

  /**
   * Fallback heuristic vocalization for unvocalized Arabic words not found in dictionary.
   */
  static phonotacticTransliterate(word) {
    if (!word) return '';

    if (word.startsWith('فال') || word.startsWith('وال') || word.startsWith('بال') || word.startsWith('كال')) {
      const p = word[0];
      const pv = (p === 'ب' ? 'bi' : (p === 'ف' ? 'fa' : (p === 'و' ? 'wa' : 'ka')));
      const rem = word.substring(3);
      if (rem.length > 0 && SUN_LETTERS.has(rem[0])) {
        const s = SUN_LETTER_ROMAN[rem[0]];
        return pv + s + '-' + this.phonotacticTransliterate(rem);
      } else {
        return pv + 'l-' + this.phonotacticTransliterate(rem);
      }
    } else if (word.startsWith('ال') && word.length > 2) {
      const rem = word.substring(2);
      if (rem.length > 0 && SUN_LETTERS.has(rem[0])) {
        const s = SUN_LETTER_ROMAN[rem[0]];
        return 'a' + s + '-' + this.phonotacticTransliterate(rem);
      } else {
        return 'al-' + this.phonotacticTransliterate(rem);
      }
    } else if (word.startsWith('لل') && word.length > 2) {
      const rem = word.substring(2);
      if (rem.length > 0 && SUN_LETTERS.has(rem[0])) {
        const s = SUN_LETTER_ROMAN[rem[0]];
        return 'li' + s + '-' + this.phonotacticTransliterate(rem);
      } else {
        return 'lil-' + this.phonotacticTransliterate(rem);
      }
    }

    if (word === 'ولى') return 'walla';
    if (word === 'صلى') return 'salla';
    if (word === 'خلى') return 'khalla';
    if (word === 'أرى' || word === 'ارى') return 'ara';
    if (word === 'يرى') return 'yara';
    if (word === 'ترى') return 'tara';
    if (word === 'هدى') return 'huda';
    if (word === 'ظلام') return 'zalam';
    if (word === 'شكر') return 'shukr';
    if (word === 'أحد' || word === 'احد') return 'ahad';
    if (word === 'أمور' || word === 'امور') return 'umoor';

    const len = word.length;
    if (len === 5 && word[1] === 'ا' && word[4] === 'ا') {
      const c1 = ARABIC_CHAR_MAP[word[0]] || word[0];
      const c2 = ARABIC_CHAR_MAP[word[2]] || word[2];
      const c3 = ARABIC_CHAR_MAP[word[3]] || word[3];
      return c1 + 'aa' + c2 + 'i' + c3 + 'an';
    }

    if (len === 5 && word[2] === 'ي' && word[4] === 'ا') {
      let c1 = ARABIC_CHAR_MAP[word[0]] || word[0];
      if (word[0] === 'ع') c1 = "'a";
      else c1 = c1 + 'a';
      const c2 = ARABIC_CHAR_MAP[word[1]] || word[1];
      const c3 = ARABIC_CHAR_MAP[word[3]] || word[3];
      return c1 + c2 + 'ee' + c3 + 'an';
    }

    if (len === 5 && word[1] === 'ا' && word[4] === 'ة') {
      const c1 = ARABIC_CHAR_MAP[word[0]] || word[0];
      const c2 = ARABIC_CHAR_MAP[word[2]] || word[2];
      const c3 = ARABIC_CHAR_MAP[word[3]] || word[3];
      return c1 + 'aa' + c2 + 'i' + c3 + 'a';
    }

    if (len === 4 && (word[0] === 'أ' || word[0] === 'ا' || word[0] === 'إ')) {
      const c1 = ARABIC_CHAR_MAP[word[1]] || word[1];
      const c2 = ARABIC_CHAR_MAP[word[2]] || word[2];
      const c3 = ARABIC_CHAR_MAP[word[3]] || word[3];
      return 'a' + c1 + c2 + 'a' + c3;
    }

    let result = '';
    for (let i = 0; i < len; i++) {
      const c = word[i];
      if (c === 'ع') {
        result += (i === 0) ? "'a" : "'";
      } else {
        result += ARABIC_CHAR_MAP[c] !== undefined ? ARABIC_CHAR_MAP[c] : c;
      }
    }
    return result;
  }

  static stripTashkeel(text) {
    if (!text) return '';
    return text.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
  }
}
