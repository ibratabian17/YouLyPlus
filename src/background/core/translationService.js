// ==================================================================================================
// TRANSLATION SERVICE
// ==================================================================================================

import { state } from '../storage/state.js';
import { translationsDB } from '../storage/database.js';
import { SettingsManager } from '../storage/settings.js';
import { PROVIDERS } from '../constants.js';
import { Utilities } from '../utils/utilities.js';
import { LyricsService } from './lyricsService.js';

import { GoogleProvider } from '../services/translation/providers/GoogleProvider.js';
import { GeminiProvider } from '../services/translation/providers/GeminiProvider.js';
import { OpenRouterProvider } from '../services/translation/providers/OpenRouterProvider.js';

export class TranslationService {
  static createCacheKey(songInfo, action, targetLang) {
    const baseLyricsCacheKey = LyricsService.createCacheKey(songInfo);
    return `${baseLyricsCacheKey} - ${action} - ${targetLang}`;
  }

  static async getOrFetch(songInfo, action, targetLang, forceReload = false) {
    const settings = await SettingsManager.getTranslationSettings();
    const resolvedTargetLang = targetLang || settings.customTranslateTarget || 'en';
    const actualTargetLang = settings.overrideTranslateTarget && settings.customTranslateTarget
      ? settings.customTranslateTarget
      : resolvedTargetLang;

    const translatedKey = this.createCacheKey(songInfo, action, actualTargetLang);

    const { lyrics: originalLyrics, version: originalVersion } =
      await LyricsService.getOrFetch(songInfo, forceReload);

    if (Utilities.isEmptyLyrics(originalLyrics)) {
      throw new Error('Original lyrics not found or empty');
    }

    if (!forceReload) {
      const cached = await this.getCached(translatedKey, originalVersion);
      if (cached) return cached;
    }

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

  static getProvider(providerName, settings) {
    switch (providerName) {
      case PROVIDERS.GEMINI:
        return new GeminiProvider(settings);
      case PROVIDERS.OPENROUTER:
        return new OpenRouterProvider(settings);
      case PROVIDERS.GOOGLE:
      default:
        return new GoogleProvider(settings);
    }
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
    const provider = this.getProvider(settings.translationProvider, settings);

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

      try {
        fetchedTranslations = await provider.translate(linesToTranslate, targetLang, songInfo);
      } catch (error) {
        console.warn(`Translation with ${settings.translationProvider} failed, falling back to Google:`, error);
        // Fallback to Google if the primary provider fails
        if (settings.translationProvider !== PROVIDERS.GOOGLE) {
          const fallbackProvider = new GoogleProvider(settings);
          fetchedTranslations = await fallbackProvider.translate(linesToTranslate, targetLang, songInfo);
        } else {
          throw error;
        }
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
      return originalLyrics.data.map(line => ({
        text: line.romanizedText || line.text
      }));
    }

    const provider = this.getProvider(settings.romanizationProvider, settings);

    // We might want to fallback to Google if the selected provider doesn't support romanization properly
    // But currently only GeminiProvider and GoogleProvider implement it fully. 
    // OpenRouter throws, so we should catch it.

    try {
      return await provider.romanize(originalLyrics, targetLang, songInfo);
    } catch (error) {
      console.warn(`Romanization with ${settings.romanizationProvider} failed, falling back to Google:`, error);
      if (settings.romanizationProvider !== PROVIDERS.GOOGLE) {
        const fallbackProvider = new GoogleProvider(settings);
        return await fallbackProvider.romanize(originalLyrics, targetLang, songInfo);
      }
      throw error;
    }
  }
}
