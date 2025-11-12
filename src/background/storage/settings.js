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
    return this.get({
      'lyricsProvider': PROVIDERS.KPOE,
      'lyricsSourceOrder': 'apple,lyricsplus,musixmatch,spotify,musixmatch-word',
      'customKpoeUrl': '',
      'cacheStrategy': 'aggressive'
    });
  }

  static async getTranslationSettings() {
    return this.get({
      'translationProvider': PROVIDERS.GOOGLE,
      'romanizationProvider': PROVIDERS.GOOGLE,
      'geminiApiKey': '',
      'geminiModel': 'gemini-pro',
      'geminiRomanizationModel': 'gemini-pro',
      'overrideTranslateTarget': false,
      'customTranslateTarget': '',
      'overrideGeminiPrompt': false,
      'customGeminiPrompt': '',
      'overrideGeminiRomanizePrompt': false,
      'customGeminiRomanizePrompt': ''
    });
  }
}
