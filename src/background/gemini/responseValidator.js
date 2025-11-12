// ==================================================================================================
// RESPONSE VALIDATOR
// ==================================================================================================

import { Utilities } from '../utils/utilities.js';

export class ResponseValidator {
  static validate(originalLyricsForApi, geminiResponse) {
    const errors = [];
    const detailedErrors = [];

    if (!geminiResponse || !Array.isArray(geminiResponse.romanized_lyrics)) {
      errors.push("The top-level 'romanized_lyrics' key is missing or not an array");
      return { isValid: false, errors, detailedErrors };
    }

    if (geminiResponse.romanized_lyrics.length !== originalLyricsForApi.length) {
      errors.push(`Line count mismatch: response has ${geminiResponse.romanized_lyrics.length}, expected ${originalLyricsForApi.length}`);
      return { isValid: false, errors, detailedErrors };
    }

    geminiResponse.romanized_lyrics.forEach((romanizedLine, index) => {
      const originalLine = originalLyricsForApi[index];
      const lineErrors = [];

      if (romanizedLine.original_line_index !== index) {
        const error = `Line ${index}: incorrect original_line_index (expected ${index}, got ${romanizedLine.original_line_index})`;
        errors.push(error);
        lineErrors.push(error);
      }

      if (typeof romanizedLine.text !== 'string') {
        const error = `Line ${index}: missing or invalid text field`;
        errors.push(error);
        lineErrors.push(error);
      }

      const originalHasChunks = Array.isArray(originalLine.chunk) && originalLine.chunk.length > 0;
      const romanizedHasChunks = Array.isArray(romanizedLine.chunk);

      if (!originalHasChunks && romanizedHasChunks) {
        const error = `Line ${index}: unexpected chunk array (original had none)`;
        errors.push(error);
        lineErrors.push(error);
      } else if (originalHasChunks) {
        if (!romanizedHasChunks) {
          const error = `Line ${index}: missing expected chunk array`;
          errors.push(error);
          lineErrors.push(error);
        } else if (romanizedLine.chunk.length !== originalLine.chunk.length) {
          const error = `Line ${index}: chunk count mismatch (original ${originalLine.chunk.length}, got ${romanizedLine.chunk.length})`;
          errors.push(error);
          lineErrors.push(error);
        } else {
          const chunkErrors = this.validateChunkDistribution(originalLine, romanizedLine, index);
          if (chunkErrors.length > 0) {
            errors.push(...chunkErrors);
            lineErrors.push(...chunkErrors);
          }
        }
      }

      if (lineErrors.length > 0) {
        detailedErrors.push({ lineIndex: index, errors: lineErrors });
      }
    });

    return { isValid: errors.length === 0, errors, detailedErrors };
  }

  static validateChunkDistribution(originalLine, romanizedLine, lineIndex) {
    const errors = [];

    const emptyChunks = romanizedLine.chunk.filter(chunk =>
      !chunk.text || chunk.text.trim() === ''
    );

    if (emptyChunks.length > 0) {
      errors.push(`Line ${lineIndex}: found ${emptyChunks.length} empty chunk(s)`);
    }

    const nonEmptyChunks = romanizedLine.chunk.filter(chunk =>
      chunk.text && chunk.text.trim() !== ''
    );

    if (nonEmptyChunks.length === 1 && romanizedLine.chunk.length > 1) {
      errors.push(`Line ${lineIndex}: all text concentrated in one chunk`);
    }

    const coherenceErrors = this.validateTextCoherence(romanizedLine, lineIndex);
    errors.push(...coherenceErrors);

    return errors;
  }

  static validateTextCoherence(romanizedLine, lineIndex) {
    const errors = [];

    const mergedChunkText = romanizedLine.chunk.map(c => c.text || '').join('');
    const lineText = romanizedLine.text || '';

    const normalizedMerged = Utilities.normalizeText(mergedChunkText);
    const normalizedLine = Utilities.normalizeText(lineText);

    if (normalizedMerged !== normalizedLine) {
      const distance = Utilities.levenshteinDistance(normalizedMerged, normalizedLine);
      const maxLength = Math.max(normalizedMerged.length, normalizedLine.length);
      const percentageDifference = maxLength === 0 ? 0 : (distance / maxLength) * 100;

      if (percentageDifference > 20) {
        errors.push(`Line ${lineIndex}: significant text mismatch (${percentageDifference.toFixed(1)}% difference)`);
        console.log(`Text mismatch - Merged: "${mergedChunkText}", Line: "${lineText}"`);
      }
    }

    return errors;
  }
}
