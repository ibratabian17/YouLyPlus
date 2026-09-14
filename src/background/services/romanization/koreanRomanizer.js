/**
 * Korean (Hangul) Romanizer based on Revised Romanization of Korean (RR).
 */

const CHOSEONG = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'
];

const JUNGSEONG = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o',
  'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu',
  'eu', 'ui', 'i'
];

const JONGSEONG = [
  '', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk',
  'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps',
  't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'
];

const JONGSEONG_LIAISON = [
  '', 'g', 'kk', 'ks', 'n', 'nj', 'nh', 'd', 'r', 'lg',
  'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'ps',
  's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'
];

const HANGUL_BASE = 0xAC00;
const HANGUL_END = 0xD7A3;

export class KoreanRomanizer {
  /**
   * Decomposes a single Hangul syllable character code into choseong, jungseong, and jongseong indices.
   */
  static decompose(charCode) {
    if (charCode < HANGUL_BASE || charCode > HANGUL_END) return null;
    const offset = charCode - HANGUL_BASE;
    const choseong = Math.floor(offset / 588);
    const jungseong = Math.floor((offset % 588) / 28);
    const jongseong = offset % 28;
    return { choseong, jungseong, jongseong };
  }

  static romanizeChar(char, nextChar = null) {
    const code = char.charCodeAt(0);
    const decomposed = this.decompose(code);
    if (!decomposed) return char;

    const { choseong, jungseong, jongseong } = decomposed;
    let initial = CHOSEONG[choseong];
    const vowel = JUNGSEONG[jungseong];

    let final = '';
    if (jongseong > 0) {
      if (nextChar) {
        const nextCode = nextChar.charCodeAt(0);
        const nextDec = this.decompose(nextCode);
        // Liaison: if next char is Hangul starting with silent 'ㅇ' (choseong === 11)
        if (nextDec && nextDec.choseong === 11) {
          final = JONGSEONG_LIAISON[jongseong] || JONGSEONG[jongseong];
        } else {
          final = JONGSEONG[jongseong];
        }
      } else {
        final = JONGSEONG[jongseong];
      }
    }

    return initial + vowel + final;
  }

  /**
   * Romanizes a Hangul string, preserving non-Hangul characters, spaces, and punctuation.
   */
  static romanize(text) {
    if (!text) return '';
    const hasTrailingSpace = /\s$/.test(text);
    const trimmed = text.trim();
    if (!trimmed) return text;

    let result = '';
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      const code = char.charCodeAt(0);
      if (code >= HANGUL_BASE && code <= HANGUL_END) {
        const nextChar = (i + 1 < trimmed.length) ? trimmed[i + 1] : null;
        result += this.romanizeChar(char, nextChar);
        if (i < trimmed.length - 1) {
          result += ' ';
        }
      } else {
        result += char;
      }
    }

    if (hasTrailingSpace) {
      result += ' ';
    }
    return result;
  }
}
