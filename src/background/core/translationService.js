// ==================================================================================================
// TRANSLATION SERVICE
// ==================================================================================================

import { state } from '../storage/state.js';
import { translationsDB } from '../storage/database.js';
import { SettingsManager } from '../storage/settings.js';
import { PROVIDERS } from '../constants.js';
import { Utilities } from '../utils/utilities.js';
import { LyricsService } from './lyricsService.js';
import { GoogleService } from '../services/googleService.js';
import { GeminiService } from '../gemini/geminiService.js';

export class TranslationService {
  static createCacheKey(songInfo, action, targetLang) {
    const baseLyricsCacheKey = LyricsService.createCacheKey(songInfo);
    return `${baseLyricsCacheKey} - ${action} - ${targetLang}`;
  }

  static async getOrFetch(songInfo, action, targetLang, forceReload = false) {
    const translatedKey = this.createCacheKey(songInfo, action, targetLang);
    
    const { lyrics: originalLyrics, version: originalVersion } = 
      await LyricsService.getOrFetch(songInfo, forceReload);
    
    if (Utilities.isEmptyLyrics(originalLyrics)) {
      throw new Error('Original lyrics not found or empty');
    }

    if (!forceReload) {
      const cached = await this.getCached(translatedKey, originalVersion);
      if (cached) return cached;
    }

    const settings = await SettingsManager.getTranslationSettings();
    const actualTargetLang = settings.overrideTranslateTarget && settings.customTranslateTarget
      ? settings.customTranslateTarget
      : targetLang;

    const translatedData = await this.performTranslation(
      originalLyrics,
      action,
      actualTargetLang,
      settings
    );

    const finalTranslatedLyrics = { ...originalLyrics, data: translatedData };

    state.setCached(translatedKey, {
      translatedLyrics: finalTranslatedLyrics,
      originalVersion
    });
    
    await translationsDB.set({
      key: translatedKey,
      translatedLyrics: finalTranslatedLyrics,
      originalVersion
    });

    return finalTranslatedLyrics;
  }

  static async getCached(key, originalVersion) {
    // Check memory
    if (state.hasCached(key)) {
      const cached = state.getCached(key);
      if (cached.originalVersion === originalVersion) {
        return cached.translatedLyrics;
      }
    }

    const dbCached = await translationsDB.get(key);
    if (dbCached) {
      if (dbCached.originalVersion === originalVersion) {
        state.setCached(key, {
          translatedLyrics: dbCached.translatedLyrics,
          originalVersion: dbCached.originalVersion
        });
        return dbCached.translatedLyrics;
      } else {
        await translationsDB.delete(key);
      }
    }

    return null;
  }

  static async performTranslation(originalLyrics, action, targetLang, settings) {
    if (action === 'translate') {
      return this.translate(originalLyrics, targetLang, settings);
    } else if (action === 'romanize') {
      return this.romanize(originalLyrics, settings);
    }
    
    return originalLyrics.data;
  }

  static async translate(originalLyrics, targetLang, settings) {
    const useGemini = settings.translationProvider === PROVIDERS.GEMINI && settings.geminiApiKey;
    
    if (useGemini) {
      const textsToTranslate = originalLyrics.data.map(line => line.text);
      const translatedTexts = await GeminiService.translate(textsToTranslate, targetLang, settings);
      return originalLyrics.data.map((line, index) => ({
        ...line,
        translatedText: translatedTexts[index] || line.text
      }));
    } else {
      const translationPromises = originalLyrics.data.map(line =>
        GoogleService.translate(line.text, targetLang)
      );
      const translatedTexts = await Promise.all(translationPromises);
      return originalLyrics.data.map((line, index) => ({
        ...line,
        translatedText: translatedTexts[index] || line.text
      }));
    }
  }

  static async romanize(originalLyrics, settings) {
    // Check for prebuilt romanization
    const hasPrebuilt = originalLyrics.data.some(line =>
      line.romanizedText || (line.syllabus && line.syllabus.some(syl => syl.romanizedText))
    );

    if (hasPrebuilt) {
      console.log("Using prebuilt romanization");
      return originalLyrics.data;
    }

    const useGemini = settings.romanizationProvider === PROVIDERS.GEMINI && settings.geminiApiKey;
    
    return useGemini
      ? GeminiService.romanize(originalLyrics, settings)
      : GoogleService.romanize(originalLyrics);
  }
}
