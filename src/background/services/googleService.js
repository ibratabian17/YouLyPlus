// ==================================================================================================
// EXTERNAL SERVICE - GOOGLE
// ==================================================================================================

import { Utilities } from '../utils/utilities.js';

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
    if (originalLyrics.type === "Word") {
      return this.romanizeWordSynced(originalLyrics);
    } else {
      return this.romanizeLineSynced(originalLyrics);
    }
  }

  static async romanizeWordSynced(originalLyrics) {
    return Promise.all(originalLyrics.data.map(async (line) => {
      if (!line.syllabus?.length) return line;
      
      const syllableTexts = line.syllabus.map(s => s.text);
      const romanizedTexts = await this.romanizeTexts(syllableTexts);
      
      const newSyllabus = line.syllabus.map((s, index) => ({
        ...s,
        romanizedText: `${romanizedTexts[index]} ` || s.text
      }));
      
      return { ...line, syllabus: newSyllabus };
    }));
  }

  static async romanizeLineSynced(originalLyrics) {
    const linesToRomanize = originalLyrics.data.map(line => line.text);
    const romanizedLines = await this.romanizeTexts(linesToRomanize);
    
    return originalLyrics.data.map((line, index) => ({
      ...line,
      romanizedText: romanizedLines[index] || line.text
    }));
  }

  static async romanizeTexts(texts) {
    const contextText = texts.join(' ');
    
    if (Utilities.isPurelyLatinScript(contextText)) {
      return texts;
    }

    let sourceLang = 'auto';
    try {
      const detectUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(contextText)}`;
      const detectResponse = await fetch(detectUrl);
      
      if (detectResponse.ok) {
        const detectData = await detectResponse.json();
        sourceLang = detectData[2] || 'auto';
      }
    } catch (e) {
      console.error("Language detection failed, using 'auto':", e);
    }

    const romanizedTexts = [];
    for (const text of texts) {
      if (Utilities.isPurelyLatinScript(text)) {
        romanizedTexts.push(text);
        continue;
      }
      
      try {
        const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&hl=en&dt=rm&q=${encodeURIComponent(text)}`;
        const response = await fetch(romanizeUrl);
        const data = await response.json();
        romanizedTexts.push(data?.[0]?.[0]?.[3] || text);
      } catch (error) {
        console.error(`Error romanizing text "${text}":`, error);
        romanizedTexts.push(text);
      }
    }
    
    return romanizedTexts;
  }
}
