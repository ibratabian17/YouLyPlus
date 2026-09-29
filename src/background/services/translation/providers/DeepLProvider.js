
import { TranslationProvider } from '../TranslationProvider.js';

export class DeepLProvider extends TranslationProvider {
    constructor(settings) {
        super(settings);
        this.apiKey = settings.deeplApiKey;
    }

    resolveTargetLanguage(targetLang) {
        if (!targetLang) return 'EN-US';
        const raw = String(targetLang).trim();
        const upper = raw.toUpperCase();
        const base = raw.split(/[-_]/)[0].toLowerCase();

        // Specific regional target mappings
        if (upper === 'EN-GB') return 'EN-GB';
        if (upper === 'EN-US' || upper === 'EN' || base === 'en') return 'EN-US';
        if (upper === 'PT-BR') return 'PT-BR';
        if (upper === 'PT-PT' || upper === 'PT' || base === 'pt') return 'PT-PT';
        if (upper === 'ZH-HANT' || upper === 'ZH-TW' || upper === 'ZH-HK') return 'ZH-HANT';
        if (upper === 'ZH-HANS' || upper === 'ZH-CN' || upper === 'ZH' || base === 'zh') return 'ZH-HANS';
        if (upper === 'ES-419') return 'ES-419';
        if (upper === 'ES-ES') return 'ES-ES';
        if (upper === 'FR-CA') return 'FR-CA';
        if (upper === 'FR-FR') return 'FR-FR';
        if (upper === 'DE-CH') return 'DE-CH';
        if (upper === 'DE-DE') return 'DE-DE';

        // Special code aliases for DeepL
        if (base === 'no' || base === 'nb') return 'NB';
        if (base === 'ku') return 'KMR';
        if (base === 'fa-af' || base === 'prs') return 'PRS';

        // All 126 DeepL supported languages
        const supported = new Set([
            'ACE', 'AF', 'SQ', 'AR', 'AN', 'HY', 'AS', 'AY', 'AZ', 'BA', 'EU', 'BE', 'BN', 'BHO', 'BS', 'BR',
            'BG', 'MY', 'YUE', 'CA', 'CEB', 'ZH', 'ZH-HANS', 'ZH-HANT', 'HR', 'CS', 'DA', 'PRS', 'NL', 'EN',
            'EN-US', 'EN-GB', 'EO', 'ET', 'FI', 'FR', 'FR-CA', 'FR-FR', 'GL', 'KA', 'DE', 'DE-DE', 'DE-CH',
            'EL', 'GN', 'GU', 'HT', 'HA', 'HE', 'HI', 'HU', 'IS', 'IG', 'ID', 'GA', 'IT', 'JA', 'JV', 'PAM',
            'KK', 'GOM', 'KO', 'KMR', 'CKB', 'KY', 'LA', 'LV', 'LN', 'LT', 'LMO', 'LB', 'MK', 'MAI', 'MG',
            'MS', 'ML', 'MT', 'MI', 'MR', 'MN', 'NE', 'NB', 'OC', 'OM', 'PAG', 'PS', 'FA', 'PL', 'PT',
            'PT-BR', 'PT-PT', 'PA', 'QU', 'RO', 'RU', 'SA', 'SR', 'ST', 'SCN', 'SK', 'SL', 'ES', 'ES-ES',
            'ES-419', 'SU', 'SW', 'SV', 'TL', 'TG', 'TA', 'TT', 'TE', 'TH', 'TS', 'TN', 'TR', 'TK', 'UK',
            'UR', 'UZ', 'VI', 'CY', 'WO', 'XH', 'YI', 'ZU'
        ]);

        const baseUpper = base.toUpperCase();
        if (supported.has(upper)) return upper;
        if (supported.has(baseUpper)) return baseUpper;

        return baseUpper || 'EN-US';
    }

    async translate(texts, targetLang, songInfo = {}) {
        if (!this.apiKey) {
            throw new Error('DeepL API Key is missing. Please set it in Settings.');
        }

        const isFree = this.apiKey.endsWith(':fx');
        const baseUrl = isFree 
            ? 'https://api-free.deepl.com/v2/translate' 
            : 'https://api.deepl.com/v2/translate';

        const resolvedTargetLang = this.resolveTargetLanguage(targetLang);

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
