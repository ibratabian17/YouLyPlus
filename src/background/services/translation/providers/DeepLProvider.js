
import { TranslationProvider } from '../TranslationProvider.js';

export class DeepLProvider extends TranslationProvider {
    constructor(settings) {
        super(settings);
        this.apiKey = settings.deeplApiKey;
    }

    async translate(texts, targetLang, songInfo = {}) {
        if (!this.apiKey) {
            throw new Error('DeepL API Key is missing. Please set it in Settings.');
        }

        const isFree = this.apiKey.endsWith(':fx');
        const baseUrl = isFree 
            ? 'https://api-free.deepl.com/v2/translate' 
            : 'https://api.deepl.com/v2/translate';

        // DeepL expects target_lang in uppercase (e.g., 'EN-US', 'KO')
        // Some codes need to be mapped to DeepL's specific variants if necessary, 
        // but generally simple uppercase works for many.
        let resolvedTargetLang = targetLang.toUpperCase();
        
        // DeepL specific handling for English and Portuguese variants
        if (resolvedTargetLang === 'EN') resolvedTargetLang = 'EN-US';
        if (resolvedTargetLang === 'PT') resolvedTargetLang = 'PT-PT';

        const body = {
            text: texts,
            target_lang: resolvedTargetLang
        };

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`DeepL API Error: ${response.status} ${errorData.message || response.statusText}`);
        }

        const data = await response.json();
        return data.translations.map(t => t.text);
    }

    async romanize(originalLyrics, targetLang, songInfo = {}) {
        // DeepL doesn't support romanization directly. 
        // We throw so TranslationService can fallback to Google.
        throw new Error('DeepL does not support romanization');
    }
}
