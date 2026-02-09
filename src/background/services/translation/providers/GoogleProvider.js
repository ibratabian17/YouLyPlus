
import { TranslationProvider } from '../TranslationProvider.js';
import { GoogleService } from '../../googleService.js';

export class GoogleProvider extends TranslationProvider {
    async translate(texts, targetLang, songInfo = {}) {
        const translationPromises = texts.map(text =>
            GoogleService.translate(text, targetLang).catch(() => text)
        );
        return Promise.all(translationPromises);
    }

    async romanize(originalLyrics, targetLang, songInfo = {}) {
        return GoogleService.romanize(originalLyrics);
    }
}
