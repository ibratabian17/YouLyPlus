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
      settings,
      songInfo
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

  static async performTranslation(originalLyrics, action, targetLang, settings, songInfo = {}) {
    if (action === 'translate') {
      return this.translate(originalLyrics, targetLang, settings, songInfo);
    } else if (action === 'romanize') {
      return this.romanize(originalLyrics, settings, songInfo, targetLang);
    }
    
    return originalLyrics.data;
  }

  static async translate(originalLyrics, targetLang, settings, songInfo = {}) {
    const useGemini = settings.translationProvider === PROVIDERS.GEMINI && settings.geminiApiKey;
    
    const normalizeLang = (l) => l ? l.toLowerCase().split('-')[0].trim() : '';
    const targetBase = normalizeLang(targetLang);

    const linesToTranslate = [];
    const indicesToTranslate = [];
    const finalTranslations = new Array(originalLyrics.data.length).fill(null);

    originalLyrics.data.forEach((line, index) => {
      const embedded = line.translation;
      if (embedded && embedded.text && normalizeLang(embedded.lang) === targetBase) {
        finalTranslations[index] = embedded.text;
      } else {
        linesToTranslate.push(line.text);
        indicesToTranslate.push(index);
      }
    });

    if (linesToTranslate.length > 0) {
      let fetchedTranslations;
      
      if (useGemini) {
        fetchedTranslations = await GeminiService.translate(linesToTranslate, targetLang, settings, songInfo);
      } else {
        const translationPromises = linesToTranslate.map(text =>
          GoogleService.translate(text, targetLang)
        );
        fetchedTranslations = await Promise.all(translationPromises);
      }

      fetchedTranslations.forEach((trans, i) => {
        const originalIndex = indicesToTranslate[i];
        finalTranslations[originalIndex] = trans;
      });
    }

    return originalLyrics.data.map((line, index) => ({
      ...line,
      translatedText: finalTranslations[index] || line.text
    }));
  }

  static async romanize(originalLyrics, settings, songInfo = {}, targetLang) {
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
      ? GeminiService.romanize(originalLyrics, settings, songInfo, targetLang)
      : GoogleService.romanize(originalLyrics);
  }
}
