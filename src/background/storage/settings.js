// ==================================================================================================
// SETTINGS MANAGEMENT
// ==================================================================================================

import { PROVIDERS } from '../constants.js';

export class SettingsManager {
  static async get(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  static async getLyricsSettings() {
    const settings = await this.get({
      'lyricsProviderOrder': 'kpoe,lrcred,unison,lrclib',
      'lyricsSourceOrder': 'apple,qq',
      'customKpoeUrl': '',
      'cacheStrategy': 'aggressive',
      'preferUnisonVideo': false
    });
    const sources = typeof settings.lyricsSourceOrder === 'string'
      ? settings.lyricsSourceOrder.split(',').map(source => source.trim()).filter(source => ['apple', 'qq'].includes(source))
      : [];
    settings.lyricsSourceOrder = sources.length ? sources.join(',') : 'apple,qq';
    return settings;
  }

  static async getTranslationSettings() {
    return this.get({
      'translationProvider': PROVIDERS.GOOGLE,
      'romanizationProvider': PROVIDERS.OFFLINE,
      'transliterationTargetScript': 'latin',
      'geminiApiKey': '',
      'geminiModel': 'gemini-pro',
      'geminiRomanizationModel': 'gemini-pro',
      'overrideTranslateTarget': false,
      'customTranslateTarget': '',
      'overrideGeminiPrompt': false,
      'customGeminiPrompt': '',
      'overrideGeminiRomanizePrompt': false,
      'customGeminiRomanizePrompt': '',
      'openRouterApiKey': '',
      'openRouterModel': 'google/gemini-2.0-flash-001',
      'deeplApiKey': ''
    });
  }
}
