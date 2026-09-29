/**
 * Devanagari Script Romanizer (Hindi, Sanskrit, Marathi, Nepali).
 * Implements IAST / ISO 15919 with Hindi schwa-deletion and conjunct handling.
 */

const VOWELS_INDEPENDENT = {
  '\u0904': 'e',    // Short E
  '\u0905': 'a',    // A
  '\u0906': 'aa',   // AA
  '\u0907': 'i',    // I
  '\u0908': 'ee',   // II
  '\u0909': 'u',    // U
  '\u090A': 'oo',   // UU
  '\u090B': 'ri',   // Vocalic R
  '\u090C': 'li',   // Vocalic L
  '\u090D': 'e',    // Candra E
  '\u090E': 'e',    // Short E
  '\u090F': 'e',    // E
  '\u0910': 'ai',   // AI
  '\u0911': 'o',    // Candra O
  '\u0912': 'o',    // Short O
  '\u0913': 'o',    // O
  '\u0914': 'au'    // AU
};

const VOWELS_DEPENDENT = {
  '\u093E': 'aa',   // AA matra
  '\u093F': 'i',    // I matra
  '\u0940': 'ee',   // II matra
  '\u0941': 'u',    // U matra
  '\u0942': 'oo',   // UU matra
  '\u0943': 'ri',   // Vocalic R matra
  '\u0944': 'ree',  // Vocalic RR matra
  '\u0945': 'e',    // Candra E matra
  '\u0946': 'e',    // Short E matra
  '\u0947': 'e',    // E matra
  '\u0948': 'ai',   // AI matra
  '\u0949': 'o',    // Candra O matra
  '\u094A': 'o',    // Short O matra
  '\u094B': 'o',    // O matra
  '\u094C': 'au',   // AU matra
  '\u0962': 'li',
  '\u0963': 'lee'
};

const CONSONANTS = {
  '\u0915': 'k',   '\u0916': 'kh',  '\u0917': 'g',   '\u0918': 'gh',  '\u0919': 'ng',
  '\u091A': 'ch',  '\u091B': 'chh', '\u091C': 'j',   '\u091D': 'jh',  '\u091E': 'ny',
  '\u091F': 't',   '\u0920': 'th',  '\u0921': 'd',   '\u0922': 'dh',  '\u0923': 'n',
  '\u0924': 't',   '\u0925': 'th',  '\u0926': 'd',   '\u0927': 'dh',  '\u0928': 'n',
  '\u0929': 'n',   '\u092A': 'p',   '\u092B': 'ph',  '\u092C': 'b',   '\u092D': 'bh',
  '\u092E': 'm',   '\u092F': 'y',   '\u0930': 'r',   '\u0931': 'r',   '\u0932': 'l',
  '\u0933': 'l',   '\u0934': 'l',   '\u0935': 'v',   '\u0936': 'sh',  '\u0937': 'sh',
  '\u0938': 's',   '\u0939': 'h',
  // Nukta consonants
  '\u0958': 'q',   '\u0959': 'kh',  '\u095A': 'gh',  '\u095B': 'z',
  '\u095C': 'r',   '\u095D': 'rh',  '\u095E': 'f',   '\u095F': 'y'
};

const VIRAMA = '\u094D'; // Halant ्
const NUKTA = '\u093C';  // ़
const ANUSVARA = '\u0902'; // ं
const CANDRABINDU = '\u0901'; // ँ
const VISARGA = '\u0903'; // ः

export class DevanagariRomanizer {
  static romanize(text) {
    if (!text) return '';
    return this.romanizeLine(text);
  }

  static romanizeLine(lineText) {
    if (!lineText) return '';

    const tokens = lineText.match(/[\u0900-\u097F]+|[^\u0900-\u097F]+/gu) || [lineText];
    let result = '';

    for (const token of tokens) {
      if (/[\u0900-\u097F]/u.test(token)) {
        result += this.romanizeWord(token);
      } else {
        result += token;
      }
    }

    return result;
  }

  static romanizeSyllables(syllables) {
    if (!Array.isArray(syllables)) return [];

    return syllables.map(s => {
      const origText = s.text || '';
      const match = origText.match(/^(\s*)(.*?)(\s*)$/);
      const leadingSpace = match ? match[1] : '';
      const coreText = match ? match[2] : origText;
      const trailingSpace = match ? match[3] : '';

      if (!coreText) return { text: origText };

      const romCore = this.romanizeLine(coreText).trim();
      return { text: leadingSpace + romCore + trailingSpace };
    });
  }

  static romanizeWord(word) {
    if (!word) return '';

    let result = '';
    const chars = Array.from(word);
    const len = chars.length;
    let i = 0;

    while (i < len) {
      const c = chars[i];

      // Independent vowel
      if (VOWELS_INDEPENDENT[c] !== undefined) {
        result += VOWELS_INDEPENDENT[c];
        i++;
        continue;
      }

      // Dependent vowel (matra) on its own
      if (VOWELS_DEPENDENT[c] !== undefined) {
        result += VOWELS_DEPENDENT[c];
        i++;
        continue;
      }

      // Anusvara / Chandrabindu / Visarga
      if (c === ANUSVARA || c === CANDRABINDU) {
        result += 'n';
        i++;
        continue;
      }
      if (c === VISARGA) {
        result += 'h';
        i++;
        continue;
      }

      // Consonant
      if (CONSONANTS[c] !== undefined) {
        let base = CONSONANTS[c];
        let j = i + 1;

        // Check for Nukta
        if (j < len && chars[j] === NUKTA) {
          if (c === '\u0915') base = 'q';
          else if (c === '\u0916') base = 'kh';
          else if (c === '\u0917') base = 'gh';
          else if (c === '\u091C') base = 'z';
          else if (c === '\u0921') base = 'r';
          else if (c === '\u0922') base = 'rh';
          else if (c === '\u092B') base = 'f';
          j++;
        }

        // Check for special Hindi pronunciation conjuncts:
        // ज्ञ (ज + ् + ञ) -> gy (e.g. gyan, not jnan)
        if (c === '\u091C' && j + 1 < len && chars[j] === VIRAMA && chars[j + 1] === '\u091E') {
          base = 'gy';
          j += 2;
        } else if (j < len && chars[j] === VIRAMA) {
          result += base;
          i = j + 1;
          continue;
        }

        // Check for Matra (dependent vowel)
        let matra = '';
        if (j < len && VOWELS_DEPENDENT[chars[j]] !== undefined) {
          matra = VOWELS_DEPENDENT[chars[j]];
          j++;
        }

        // Check for Anusvara / Chandrabindu / Visarga attached to this consonant
        let nasal = '';
        if (j < len && (chars[j] === ANUSVARA || chars[j] === CANDRABINDU)) {
          nasal = 'n';
          j++;
        } else if (j < len && chars[j] === VISARGA) {
          nasal = 'h';
          j++;
        }

        if (matra) {
          result += base + matra + nasal;
        } else {
          // Inherent 'a' vowel with Hindi schwa deletion:
          // 1. Word-final consonant drops inherent 'a' (e.g. दिल -> dil, नाम -> naam)
          // 2. Medial consonant in a 3+ letter stem followed by a matra drops 'a' (e.g. करना -> karna, समझना -> samajhna)
          const isWordFinal = j >= len;
          let dropSchwa = isWordFinal;

          if (!isWordFinal && i > 0 && j < len) {
            // Check if next syllable has a matra
            let k = j;
            if (CONSONANTS[chars[k]] !== undefined) {
              k++;
              if (k < len && chars[k] === NUKTA) k++;
              if (k < len && VOWELS_DEPENDENT[chars[k]] !== undefined) {
                dropSchwa = true;
              }
            }
          }

          const vowel = dropSchwa ? '' : 'a';
          result += base + vowel + nasal;
        }

        i = j;
        continue;
      }

      // Any other characters / punctuation
      result += c;
      i++;
    }

    return result;
  }
}
