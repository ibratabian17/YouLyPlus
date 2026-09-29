import { TranslationProvider } from '../TranslationProvider.js';

export class DeepLKeylessProvider extends TranslationProvider {
    constructor(settings) {
        super(settings);
        this.instanceId = this.generateInstanceId();
    }

    generateInstanceId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        const hex = Array.from({ length: 16 }, () =>
            Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
        ).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    resolveTargetLanguage(targetLang) {
        if (!targetLang) return 'en-US';
        const raw = String(targetLang).trim();
        const upper = raw.toUpperCase();
        const base = raw.split(/[-_]/)[0].toLowerCase();

        // The oneshot endpoint requires regional/script variants for EN, PT, ZH
        if (upper === 'EN-GB') return 'en-GB';
        if (upper === 'EN-US' || upper === 'EN' || base === 'en') return 'en-US';
        if (upper === 'PT-BR') return 'pt-BR';
        if (upper === 'PT-PT' || upper === 'PT' || base === 'pt') return 'pt-PT';
        if (upper === 'ZH-HANT' || upper === 'ZH-TW' || upper === 'ZH-HK') return 'zh-Hant';
        if (upper === 'ZH-HANS' || upper === 'ZH-CN' || upper === 'ZH' || base === 'zh') return 'zh-Hans';
        if (upper === 'ES-419') return 'es-419';

        // DeepL specific aliases
        if (base === 'no') return 'nb';
        if (base === 'ku') return 'kmr';
        if (base === 'fa-af' || base === 'prs') return 'prs';

        // Every other code passes through lowercased
        return base;
    }

    async translate(texts, targetLang, songInfo = {}) {
        if (!texts || texts.length === 0) {
            return [];
        }

        const resolvedTargetLang = this.resolveTargetLanguage(targetLang);
        const MAX_BATCH_CHARS = 1400;
        const allTranslations = [];

        let currentBatch = [];
        let currentBatchCharCount = 0;

        for (const line of texts) {
            const lineLength = line ? line.length : 0;

            if (currentBatch.length > 0 && currentBatchCharCount + lineLength > MAX_BATCH_CHARS) {
                const batchResults = await this.translateBatch(currentBatch, resolvedTargetLang);
                allTranslations.push(...batchResults);
                currentBatch = [];
                currentBatchCharCount = 0;
            }

            currentBatch.push(line);
            currentBatchCharCount += lineLength;
        }

        if (currentBatch.length > 0) {
            const batchResults = await this.translateBatch(currentBatch, resolvedTargetLang);
            allTranslations.push(...batchResults);
        }

        return allTranslations;
    }

    async translateBatch(batch, targetLang) {
        const body = {
            text: batch,
            target_lang: targetLang,
            usage_type: 'translate',
            app_information: {
                app_version: '1.59.0',
                app_build: '10059000',
                app_name: 'chromeExtension',
                os: 'macOS',
                os_version: '10.15.7',
                device: 'MacIntel',
                instance_id: this.instanceId
            }
        };

        const response = await fetch('https://oneshot-free.www.deepl.com/v1/translate', {
            method: 'POST',
            headers: {
                'Origin': 'chrome-extension://cofdbpoegempjloogbagkncekinflcnj',
                'Authorization': 'None',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`DeepL Keyless Error (${response.status}): ${errorText.slice(0, 200)}`);
        }

        const data = await response.json();

        if (!data.translations || !Array.isArray(data.translations)) {
            throw new Error('DeepL Keyless returned invalid response structure');
        }

        if (data.translations.length !== batch.length) {
            console.warn(`DeepL Keyless returned ${data.translations.length} items for ${batch.length} lines.`);
        }

        return data.translations.map(t => t.text || '');
    }

    async romanize(originalLyrics, targetLang, songInfo = {}) {
        throw new Error('DeepL (keyless) does not support romanization');
    }
}
