
import { TranslationProvider } from '../TranslationProvider.js';
import { GeminiService } from '../../../gemini/geminiService.js';

export class GeminiProvider extends TranslationProvider {
    async translate(texts, targetLang, songInfo = {}) {
        if (!this.settings.geminiApiKey) {
            throw new Error('Gemini API Key is missing. Please set it in Settings.');
        }
        return GeminiService.translate(texts, targetLang, this.settings, songInfo);
    }

    async romanize(originalLyrics, targetLang, songInfo = {}) {
        if (!this.settings.geminiApiKey) {
            throw new Error('Gemini API Key is missing. Please set it in Settings.');
        }
        return GeminiService.romanize(originalLyrics, this.settings, songInfo, targetLang);
    }
}
