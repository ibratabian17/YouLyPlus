/**
 * Cross-browser i18n helper for YouLy+ extension pages (popup & settings).
 * Works with both Chrome (chrome.i18n) and Firefox (browser.i18n).
 */

const i18nApi = (typeof browser !== 'undefined' && browser.i18n) ? browser.i18n : chrome.i18n;

/**
 * Get a localized message by key, with optional substitutions.
 */
function msg(key, substitutions) {
    return i18nApi.getMessage(key, substitutions) || '';
}

/**
 * Apply i18n translations to all elements with data-i18n attributes.
 * Supports:
 *   data-i18n="key"             → sets textContent
 *   data-i18n-title="key"       → sets title attribute
 *   data-i18n-placeholder="key" → sets placeholder attribute
 */
function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const translated = msg(el.dataset.i18n);
        if (translated) el.textContent = translated;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const translated = msg(el.dataset.i18nTitle);
        if (translated) el.title = translated;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const translated = msg(el.dataset.i18nPlaceholder);
        if (translated) el.placeholder = translated;
    });
}

// Auto-apply translations when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyI18n);
} else {
    applyI18n();
}
