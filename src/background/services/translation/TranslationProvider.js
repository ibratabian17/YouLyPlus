
export class TranslationProvider {
    /**
     * @param {Object} settings - The current application settings.
     */
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Translates an array of text strings.
     * @param {string[]} texts - Array of strings to translate.
     * @param {string} targetLang - Target language code (e.g., 'en', 'ko').
     * @param {Object} songInfo - Optional song metadata.
     * @returns {Promise<string[]>} - Promise resolving to an array of translated strings.
     */
    async translate(texts, targetLang, songInfo = {}) {
        throw new Error('translate() must be implemented by subclass');
    }

    /**
     * Romanizes the lyrics.
     * @param {Object} originalLyrics - The original lyrics object.
     * @param {string} targetLang - Target language code.
     * @param {Object} songInfo - Optional song metadata.
     * @returns {Promise<Object[]>} - Promise resolving to an array of lyrics lines with romanization.
     */
    async romanize(originalLyrics, targetLang, songInfo = {}) {
        throw new Error('romanize() must be implemented by subclass');
    }
}
