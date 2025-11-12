// ==================================================================================================
// UTILITIES
// ==================================================================================================

export class Utilities {
  static isEmptyLyrics(lyrics) {
    return !lyrics || 
           !lyrics.data || 
           lyrics.data.length === 0 || 
           lyrics.data.every(line => !line.text);
  }

  static isPurelyLatinScript(text) {
    return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text);
  }

  static normalizeText(text) {
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, '');
  }

  static levenshteinDistance(s1, s2) {
    const track = Array(s2.length + 1)
      .fill(null)
      .map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) {
      track[0][i] = i;
    }

    for (let j = 0; j <= s2.length; j++) {
      track[j][0] = j;
    }

    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator
        );
      }
    }

    return track[s2.length][s1.length];
  }
}
