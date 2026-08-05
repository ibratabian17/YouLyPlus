import { CONFIG } from '../constants.js';
import { Utilities } from '../utils/utilities.js';
import { createRomanizationPrompt } from '../services/translation/prompts.js';
import { SchemaBuilder } from './schemaBuilder.js';
import { GoogleService } from '../services/googleService.js';

export class GeminiRomanizer {
  constructor(settings) {
    this.settings = settings;
    this.modelName = settings.geminiRomanizationModel;
    this.url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${settings.geminiApiKey}`;
  }

  async romanize(structuredInput, songInfo = {}, targetLang) {
    const { lyricsForApi, reconstructionPlan } = this.prepareLyrics(structuredInput);
    const hasAnyChunks = lyricsForApi.some(line => line.chunk && line.chunk.length > 0);

    if (lyricsForApi.length === 0) {
      return this.reconstructLyrics([], reconstructionPlan, hasAnyChunks);
    }

    const initialPrompt = this.createInitialPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang);
    const schema = SchemaBuilder.buildRomanizationSchema(hasAnyChunks);

    const contents = [{ role: 'user', parts: [{ text: initialPrompt }] }];

    let responseText;
    let lastError = null;

    // Call Gemini API (retry max 2 times only for JSON syntax/network errors, no prompt redoing)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        responseText = await this.callGeminiAPI(contents, schema);
        const cleanedText = this.cleanJsonOutput(responseText);
        const parsedJson = JSON.parse(cleanedText);

        const returnedLines = Array.isArray(parsedJson)
          ? parsedJson
          : (parsedJson?.romanized_lyrics || parsedJson?.fixed_lines || []);

        // Align each line using GoogleService.alignRomanizationAnchors directly (100% same as Google Translate)
        const alignedApiLyrics = lyricsForApi.map((origLine, index) => {
          const matchingRetLines = returnedLines.filter(r => r && r.original_line_index === index);
          const retLine = matchingRetLines[0] || returnedLines[index];

          // Collect romanized chunk texts if available
          let chunkTexts = [];
          if (matchingRetLines.length > 0) {
            chunkTexts = matchingRetLines.flatMap(r =>
              Array.isArray(r.chunk) ? r.chunk.map(c => (c && typeof c.text === 'string') ? c.text.trim() : '') : []
            ).filter(Boolean);
          } else if (retLine && Array.isArray(retLine.chunk)) {
            chunkTexts = retLine.chunk.map(c => (c && typeof c.text === 'string') ? c.text.trim() : '').filter(Boolean);
          }

          let fullLineRom = '';
          if (chunkTexts.length > 0) {
            fullLineRom = chunkTexts.join(' ');
          } else if (matchingRetLines.length > 0) {
            fullLineRom = matchingRetLines.map(r => r.text || '').join('');
          } else if (retLine) {
            fullLineRom = retLine.text || origLine.text;
          } else {
            fullLineRom = origLine.text;
          }

          if (!origLine.chunk || origLine.chunk.length === 0) {
            return {
              text: fullLineRom,
              original_line_index: index
            };
          }

          const originalSyllables = origLine.chunk;
          const M = originalSyllables.length;

          let romanizedGuides = chunkTexts;
          if (romanizedGuides.length !== M) {
            romanizedGuides = originalSyllables.map(s => s.text || '');
          }

          // Direct call to GoogleService's DP Anchor Alignment algorithm
          const alignedChunks = GoogleService.alignRomanizationAnchors(fullLineRom, romanizedGuides, originalSyllables);

          const formattedChunks = originalSyllables.map((s, i) => ({
            text: alignedChunks[i] || ""
          }));

          return {
            text: formattedChunks.map(c => c.text).join(""),
            chunk: formattedChunks,
            original_line_index: index
          };
        });

        console.log(`Gemini romanization completed using Google Translate DP alignment on attempt ${attempt}`);
        return this.reconstructLyrics(alignedApiLyrics, reconstructionPlan, hasAnyChunks);

      } catch (e) {
        console.warn(`Gemini API call attempt ${attempt} failed:`, e.message);
        lastError = e;

        if (attempt < 2 && e instanceof SyntaxError) {
          contents.push({ role: 'model', parts: [{ text: responseText || '' }] });
          contents.push({
            role: 'user',
            parts: [{ text: `Your previous response was not valid JSON. Please provide valid JSON adhering to the schema. Error: ${e.message}` }]
          });
        }
      }
    }

    throw new Error(`Gemini romanization failed: ${lastError?.message || 'Unknown error'}`);
  }

  async callGeminiAPI(contents, schema) {
    const isGemma = this.modelName.toLowerCase().includes("gemma");

    const generationConfig = {
      temperature: 0.0
    };

    if (!isGemma) {
      generationConfig.response_mime_type = "application/json";
      generationConfig.responseSchema = schema;
    }

    const requestBody = {
      contents,
      generation_config: generationConfig
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: { message: response.statusText }
      }));
      throw new Error(`Gemini API call failed with status ${response.status}: ${errorData.error.message}`);
    }

    const data = await response.json();

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }

    return data.candidates[0].content.parts[0].text;
  }

  cleanJsonOutput(text) {
    if (!text) return "";
    return text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
  }

  prepareLyrics(structuredInput) {
    const lyricsForApi = [];
    const reconstructionPlan = [];
    const contentToApiIndexMap = new Map();

    structuredInput.forEach((line, originalIndex) => {
      if (Utilities.isPurelyLatinScript(line.text)) {
        reconstructionPlan.push({ type: 'latin', data: line, originalIndex });
        return;
      }

      const contentKey = JSON.stringify({ text: line.text, chunk: line.chunk });

      if (contentToApiIndexMap.has(contentKey)) {
        reconstructionPlan.push({
          type: 'api',
          apiIndex: contentToApiIndexMap.get(contentKey),
          originalIndex
        });
      } else {
        const newApiIndex = lyricsForApi.length;
        const apiLine = { text: line.text, original_line_index: newApiIndex };

        if (line.chunk && line.chunk.length > 0) {
          apiLine.chunk = line.chunk;
        }

        lyricsForApi.push(apiLine);
        contentToApiIndexMap.set(contentKey, newApiIndex);
        reconstructionPlan.push({ type: 'api', apiIndex: newApiIndex, originalIndex });
      }
    });

    return { lyricsForApi, reconstructionPlan };
  }

  reconstructLyrics(romanizedApiLyrics, reconstructionPlan, hasAnyChunks) {
    const fullList = [];

    reconstructionPlan.forEach(planItem => {
      let reconstructedLine;

      if (planItem.type === 'latin') {
        reconstructedLine = {
          ...planItem.data,
          text: planItem.data.text,
          chunk: hasAnyChunks && planItem.data.chunk
            ? planItem.data.chunk.map(c => ({ ...c, text: c.text }))
            : undefined,
          original_line_index: planItem.originalIndex
        };
      } else {
        const apiResult = romanizedApiLyrics[planItem.apiIndex];
        reconstructedLine = {
          ...apiResult,
          original_line_index: planItem.originalIndex
        };
      }

      fullList[planItem.originalIndex] = reconstructedLine;
    });

    return fullList;
  }

  createInitialPrompt(lyricsForApi, hasAnyChunks, songInfo = {}, targetLang) {
    const { overrideGeminiRomanizePrompt, customGeminiRomanizePrompt } = this.settings;

    if (overrideGeminiRomanizePrompt && customGeminiRomanizePrompt) {
      const songContext = (songInfo.title && songInfo.artist)
        ? `\n# SONG CONTEXT\n- Title: ${songInfo.title}\n- Artist: ${songInfo.artist}\n`
        : '';
      return songContext + customGeminiRomanizePrompt;
    }

    return createRomanizationPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang);
  }
}