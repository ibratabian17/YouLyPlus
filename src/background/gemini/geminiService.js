// ==================================================================================================
// EXTERNAL SERVICE - GEMINI
// ==================================================================================================

import { createTranslationPrompt } from '../services/translation/prompts.js';
import { GeminiRomanizer } from './geminiRomanizer.js';

export class GeminiService {
  static async translate(texts, targetLang, settings, songInfo = {}) {
    const { geminiApiKey, geminiModel } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    const isGemma = geminiModel.toLowerCase().includes("gemma");

    let prompt = createTranslationPrompt(settings, texts, targetLang, songInfo, geminiModel);

    const generationConfig = {
      temperature: 0.0
    };

    if (!isGemma) {
      generationConfig.response_mime_type = "application/json";
      generationConfig.responseSchema = {
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
          },
          source_language: {
            type: "ARRAY",
            description: "The source language(s) of the original lyrics."
          }
        },
        required: ["translated_lyrics", "target_language"]
      };
    } else {
      prompt += `\n\nIMPORTANT OUTPUT FORMAT:
You must return a valid JSON object exactly like this:
{
  "translated_lyrics": [
    "translated line 1",
    "translated line 2",
    ... (one string per input line)
  ],
  "target_language": "${targetLang}",
  "source_language": ["detected source language(s)"]
} ensure the JSON is properly formatted with correct syntax.
Do not wrap in Markdown code blocks. Just the raw JSON string.`;
    }

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generation_config: generationConfig
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
      let rawText = data.candidates[0].content.parts[0].text;

      rawText = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "");

      const parsedJson = JSON.parse(rawText);

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

  static async romanize(originalLyrics, settings, songInfo = {}, targetLang) {
    if (!settings.geminiApiKey) {
      throw new Error('Gemini API Key is not provided');
    }

    const structuredInput = this.prepareStructuredInput(originalLyrics);
    const romanizer = new GeminiRomanizer(settings);

    return romanizer.romanize(structuredInput, songInfo, targetLang);
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