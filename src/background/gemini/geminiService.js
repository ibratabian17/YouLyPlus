// ==================================================================================================
// EXTERNAL SERVICE - GEMINI
// ==================================================================================================

import { createTranslationPrompt } from './prompts.js';
import { GeminiRomanizer } from './geminiRomanizer.js';

export class GeminiService {
  static async translate(texts, targetLang, settings, songInfo = {}) {
    const { geminiApiKey, geminiModel } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

    const prompt = createTranslationPrompt(settings, texts, targetLang, songInfo);

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generation_config: {
        temperature: 0.0,
        response_mime_type: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            translated_lyrics: {
              type: "ARRAY",
              description: "An array of translated lyric lines, maintaining the original order and count.",
              items: { type: "STRING" }
            },
            target_language: {
              type: "STRING",
              description: "The target language for the translation."
            }
          },
          required: ["translated_lyrics", "target_language"]
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: { message: response.statusText }
      }));
      throw new Error(`Gemini API error: ${response.status} - ${errorData.error.message}`);
    }

    const data = await response.json();

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini translation blocked: ${data.promptFeedback.blockReason}`);
    }

    try {
      const parsedJson = JSON.parse(data.candidates[0].content.parts[0].text);
      
      if (!Array.isArray(parsedJson.translated_lyrics)) {
        throw new Error('Invalid JSON structure: translated_lyrics is not an array');
      }
      
      if (parsedJson.translated_lyrics.length !== texts.length) {
        throw new Error(`Length mismatch: expected ${texts.length} lines, got ${parsedJson.translated_lyrics.length}`);
      }
      
      return parsedJson.translated_lyrics;
    } catch (e) {
      console.error("Gemini response parsing failed:", e);
      throw new Error(`Gemini translation failed: Could not parse valid JSON. ${e.message}`);
    }
  }

  static async romanize(originalLyrics, settings, songInfo = {}) {
    if (!settings.geminiApiKey) {
      throw new Error('Gemini API Key is not provided');
    }

    const structuredInput = this.prepareStructuredInput(originalLyrics);
    const romanizer = new GeminiRomanizer(settings);
    
    return romanizer.romanize(structuredInput, songInfo);
  }

  static prepareStructuredInput(originalLyrics) {
    return originalLyrics.data.map((line, index) => {
      const lineObject = {
        original_line_index: index,
        text: line.text
      };
      
      if (line.syllabus?.length) {
        lineObject.chunk = line.syllabus.map((s, sylIndex) => ({
          text: s.text,
          chunkIndex: sylIndex
        }));
      }
      
      return lineObject;
    });
  }
}
