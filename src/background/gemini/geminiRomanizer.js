// ==================================================================================================
// GEMINI ROMANIZATION - CORE ENGINE
// ==================================================================================================

import { CONFIG } from '../constants.js';
import { Utilities } from '../utils/utilities.js';
import { createRomanizationPrompt } from './prompts.js';
import { SchemaBuilder } from './schemaBuilder.js';
import { ResponseValidator } from './responseValidator.js';

export class GeminiRomanizer {
  constructor(settings) {
    this.settings = settings;
    this.url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiRomanizationModel}:generateContent?key=${settings.geminiApiKey}`;
  }

  async romanize(structuredInput, songInfo = {}, targetLang) {
    const { lyricsForApi, reconstructionPlan } = this.prepareLyrics(structuredInput);
    const hasAnyChunks = lyricsForApi.some(line => line.chunk && line.chunk.length > 0);

    if (lyricsForApi.length === 0) {
      return this.reconstructLyrics([], reconstructionPlan, hasAnyChunks);
    }

    const initialPrompt = this.createInitialPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang);
    const schema = SchemaBuilder.buildRomanizationSchema(hasAnyChunks);
    const selectiveSchema = SchemaBuilder.buildSelectiveRomanizationSchema(hasAnyChunks);

    let currentContents = [{ role: 'user', parts: [{ text: initialPrompt }] }];
    let lastValidResponse = null;
    let sameErrorCount = 0;
    let lastError = null;

    for (let attempt = 1; attempt <= CONFIG.GEMINI.MAX_RETRIES; attempt++) {
      const isSelectiveFix = attempt > 1 && lastValidResponse !== null && sameErrorCount < 3;

      try {
        const responseText = await this.callGeminiAPI(
          currentContents,
          isSelectiveFix ? selectiveSchema : schema
        );

        const parsedJson = JSON.parse(responseText);
        const finalResponse = isSelectiveFix && parsedJson.fixed_lines
          ? this.mergeSelectiveFixes(lastValidResponse, parsedJson.fixed_lines)
          : parsedJson;

        if (attempt === 1) {
          lastValidResponse = parsedJson;
        }

        const validationResult = ResponseValidator.validate(lyricsForApi, finalResponse);

        if (validationResult.isValid) {
          console.log(`Gemini romanization succeeded on attempt ${attempt}`);
          return this.reconstructLyrics(finalResponse.romanized_lyrics, reconstructionPlan, hasAnyChunks);
        }

        console.warn(`Attempt ${attempt} failed validation:`, validationResult.errors.join(', '));

        const currentError = validationResult.errors[0];
        if (currentError === lastError) {
          sameErrorCount++;
        } else {
          sameErrorCount = 1;
          lastError = currentError;
        }

        if (attempt === CONFIG.GEMINI.MAX_RETRIES) {
          throw new Error(`Gemini romanization failed after ${CONFIG.GEMINI.MAX_RETRIES} attempts. Final errors: ${validationResult.errors.join(', ')}`);
        }

        if (sameErrorCount >= 3) {
          console.log("Same error repeating, starting fresh conversation");
          currentContents = [{ role: 'user', parts: [{ text: initialPrompt }] }];
          sameErrorCount = 0;
          lastValidResponse = null;
          continue;
        }

        const problematicLines = this.getProblematicLines(lyricsForApi, finalResponse, validationResult.detailedErrors);
        
        currentContents.push({ role: 'model', parts: [{ text: responseText }] });
        currentContents.push({
          role: 'user',
          parts: [{
            text: this.createCorrectionPrompt(
              problematicLines,
              validationResult,
              lyricsForApi,
              hasAnyChunks
            )
          }]
        });

      } catch (e) {
        console.error(`Gemini romanization attempt ${attempt} failed:`, e.message);
        
        if (attempt === CONFIG.GEMINI.MAX_RETRIES) {
          throw new Error(`Gemini romanization failed after ${CONFIG.GEMINI.MAX_RETRIES} attempts: ${e.message}`);
        }
        
        if (e instanceof SyntaxError) {
          currentContents.push({
            role: 'user',
            parts: [{ text: `Your previous response was not valid JSON. Please provide a corrected JSON response. Error: ${e.message}` }]
          });
        }
      }
    }

    throw new Error("Unexpected error: Gemini romanization process completed without success");
  }

  async callGeminiAPI(contents, schema) {
    const requestBody = {
      contents,
      generation_config: {
        temperature: 0.0,
        response_mime_type: "application/json",
        responseSchema: schema
      }
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

  createCorrectionPrompt(problematicLines, validationResult, lyricsForApi, hasAnyChunks) {
    if (problematicLines.length > 0 && problematicLines.length < lyricsForApi.length * 0.8) {
      return this.createSelectiveFixPrompt(problematicLines, validationResult, hasAnyChunks);
    } else {
      return this.createFullRetryPrompt(validationResult, lyricsForApi, hasAnyChunks);
    }
  }

  createSelectiveFixPrompt(problematicLines, validationResult, hasAnyChunks) {
    return `CRITICAL ERROR CORRECTION NEEDED: Your previous response had structural errors.

**MOST CRITICAL RULE**: ${hasAnyChunks
      ? 'Only add chunk arrays to lines that originally had them. Do not add chunks to line-only lyrics.'
      : 'These are LINE-SYNCED lyrics only. DO NOT add any chunk arrays to any lines.'
    }

**SPECIFIC LINES THAT NEED FIXING:**
${JSON.stringify(problematicLines.map(line => ({
      original_line_index: line.original_line_index,
      original_text: line.text,
      had_chunks: !!(line.chunk && line.chunk.length > 0),
      errors: validationResult.detailedErrors.find(e => e.lineIndex === line.original_line_index)?.errors || []
    })), null, 2)}

PROVIDE ONLY THE CORRECTED LINES in the proper format.`;
  }

  createFullRetryPrompt(validationResult, lyricsForApi, hasAnyChunks) {
    return `CRITICAL STRUCTURAL ERRORS DETECTED: Your previous response had major structural issues.

**MOST SERIOUS ERROR**: ${hasAnyChunks
      ? 'You are adding chunk arrays to lines that should not have them. Only lines that originally had chunks should have chunk arrays in the output.'
      : 'You are adding chunk arrays when these lyrics are LINE-SYNCED only. DO NOT add any chunk arrays.'
    }

**Original lyrics structure for reference:**
${JSON.stringify(lyricsForApi, null, 2)}

PROVIDE A COMPLETE CORRECTED RESPONSE respecting the original structure.`;
  }

  mergeSelectiveFixes(lastValidResponse, fixedLines) {
    if (!lastValidResponse || !lastValidResponse.romanized_lyrics) {
      console.warn('No valid previous response to merge with, using fixed lines as base');
      return { romanized_lyrics: fixedLines };
    }

    const mergedResponse = JSON.parse(JSON.stringify(lastValidResponse));
    console.log(`Merging ${fixedLines.length} selective fixes into previous response`);

    fixedLines.forEach(fixedLine => {
      const index = fixedLine.original_line_index;
      
      if (mergedResponse.romanized_lyrics &&
          mergedResponse.romanized_lyrics[index] &&
          index >= 0 &&
          index < mergedResponse.romanized_lyrics.length) {
        console.log(`Applying fix for line ${index}`);
        mergedResponse.romanized_lyrics[index] = fixedLine;
      } else {
        console.warn(`Could not apply fix for line ${index}: index out of bounds`);
      }
    });

    return mergedResponse;
  }

  getProblematicLines(originalLyricsForApi, response, detailedErrors = []) {
    const problematicLines = [];
    const problematicIndices = new Set();

    detailedErrors.forEach(error => {
      if (error.lineIndex !== undefined) {
        problematicIndices.add(error.lineIndex);
      }
    });

    if (response.romanized_lyrics) {
      response.romanized_lyrics.forEach((line, index) => {
        const originalLine = originalLyricsForApi[index];
        if (!originalLine) return;

        const issues = [];
        const originalHasChunks = Array.isArray(originalLine.chunk) && originalLine.chunk.length > 0;

        if (originalHasChunks && Array.isArray(line.chunk) && line.chunk.length > 0) {
          const emptyChunks = line.chunk.filter(chunk => !chunk.text || chunk.text.trim() === '');
          if (emptyChunks.length > 0) {
            issues.push(`${emptyChunks.length} empty chunk(s)`);
          }

          const nonEmptyChunks = line.chunk.filter(chunk => chunk.text && chunk.text.trim() !== '');
          if (nonEmptyChunks.length === 1 && line.chunk.length > 1) {
            issues.push('text concentrated in single chunk');
          }

          if (originalLine.chunk && originalLine.chunk.length !== line.chunk.length) {
            issues.push(`chunk count mismatch (expected ${originalLine.chunk.length}, got ${line.chunk.length})`);
          }
        }

        if (line.original_line_index !== index) {
          issues.push('incorrect line index');
        }

        if (typeof line.text !== 'string') {
          issues.push('missing or invalid text field');
        }

        if (issues.length > 0) {
          problematicIndices.add(index);
          console.log(`Line ${index} flagged: ${issues.join(', ')}`);
        }
      });
    }

    problematicIndices.forEach(index => {
      if (originalLyricsForApi[index]) {
        problematicLines.push({
          ...originalLyricsForApi[index],
          original_line_index: index
        });
      }
    });

    console.log(`Found ${problematicLines.length} problematic lines out of ${originalLyricsForApi.length} total`);
    return problematicLines;
  }
}
