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
import { DeepLProvider } from '../services/translation/providers/DeepLProvider.js';
import { DeepLKeylessProvider } from '../services/translation/providers/DeepLKeylessProvider.js';

export class TranslationService {
  static createCacheKey(songInfo, action, targetLang, targetScript) {
    const baseLyricsCacheKey = LyricsService.createCacheKey(songInfo);
    return `${baseLyricsCacheKey} - ${action} - ${targetLang} - ${targetScript}`;
  }

  static async getOrFetch(songInfo, action, targetLang, forceReload = false) {
    const settings = await SettingsManager.getTranslationSettings();
    const resolvedTargetLang = targetLang || settings.customTranslateTarget || 'en';
    const actualTargetLang = settings.overrideTranslateTarget && settings.customTranslateTarget
      ? settings.customTranslateTarget
      : resolvedTargetLang;

    const targetScript = settings.transliterationTargetScript || 'latin';

    const translatedKey = this.createCacheKey(songInfo, action, actualTargetLang, targetScript);

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
      songInfo,
      targetScript
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
      case PROVIDERS.DEEPL:
        return new DeepLProvider(settings);
      case PROVIDERS.DEEPL_KEYLESS:
        return new DeepLKeylessProvider(settings);
      case PROVIDERS.GOOGLE:
      default:
        return new GoogleProvider(settings);
    }
  }

  static async performTranslation(originalLyrics, action, targetLang, settings, songInfo = {}, targetScript = 'latin') {
    if (action === 'translate') {
      return this.translate(originalLyrics, targetLang, settings, songInfo);
    } else if (action === 'romanize') {
      return this.romanize(originalLyrics, settings, songInfo, targetLang, targetScript);
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

  /**
   * Builds the ordered list of providers to try for romanization/transliteration.
   * For Latin targets it preserves the legacy behavior: the chosen provider first,
   * falling back to Google. For non-Latin target scripts Google is skipped entirely
   * (it cannot transliterate into other scripts), so Gemini/OpenRouter are used
   * when API keys are available.
   */
  static resolveRomanizationProviders(settings, targetScript) {
    const candidates = [];
    const push = (name) => {
      if (name && !candidates.includes(name)) candidates.push(name);
    };

    const selected = settings.romanizationProvider || PROVIDERS.GOOGLE;
    const isAiProvider = selected === PROVIDERS.GEMINI || selected === PROVIDERS.OPENROUTER;

    if (targetScript && targetScript !== 'latin') {
      if (isAiProvider) push(selected);
      if (settings.geminiApiKey) push(PROVIDERS.GEMINI);
      if (settings.openRouterApiKey) push(PROVIDERS.OPENROUTER);
    } else {
      push(selected);
      push(PROVIDERS.GOOGLE);
    }

    return candidates;
  }

  static async romanize(originalLyrics, settings, songInfo = {}, targetLang, targetScript = 'latin') {
    if (targetScript === 'latin') {
      const hasPrebuilt = originalLyrics.data.some(line =>
        line.romanizedText || (line.syllabus && line.syllabus.some(syl => syl.romanizedText))
      );

      if (hasPrebuilt) {
        console.log("Using prebuilt romanization");
        return originalLyrics.data.map(line => ({
          text: line.romanizedText || line.text
        }));
      }
    }

    const candidates = this.resolveRomanizationProviders(settings, targetScript);
    let lastError = null;

    for (const providerName of candidates) {
      try {
        const provider = this.getProvider(providerName, settings);
        return await provider.romanize(originalLyrics, targetLang, songInfo, targetScript);
      } catch (error) {
        lastError = error;
        console.warn(`Romanization with ${providerName} failed, trying next available provider:`, error.message);
      }
    }

    if (lastError) throw lastError;
    throw new Error(
      targetScript !== 'latin'
        ? `Transliteration into "${targetScript}" script requires Gemini or OpenRouter. Please set an API key in the settings.`
        : 'Romanization failed: no provider available.'
    );
  }
}
