// Browser compatibility
const pBrowser = window.chrome || window.browser;

// Current settings object (default values)
let currentSettings = {
    lyricsProvider: 'kpoe', // Can be 'kpoe' or 'lrclib'
    lyricsSourceOrder: 'apple,lyricsplus,musixmatch,spotify,musixmatch-word', // For KPoe provider
    wordByWord: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    autoHideLyrics: false,
    cacheStrategy: 'aggressive',
    fontSize: 16,
    compabilityVisibility: false, // New compatibility setting
    compabilityWipe: false, // New compatibility setting
    customCSS: '',
    translationProvider: 'google', // Default translation provider
    geminiApiKey: '', // Default Gemini API key
    geminiModel: 'gemini-pro', // Default Gemini model
    overrideTranslateTarget: false, // New setting for overriding translation target
    customTranslateTarget: '', // New setting for custom translation target
    overrideGeminiPrompt: false, // New setting for overriding Gemini prompt
    customGeminiPrompt: '' // New setting for custom Gemini prompt
};

// Storage helper function (using pBrowser.storage.local directly)
function storageLocalGet(keys) {
    return new Promise(resolve => pBrowser.storage.local.get(keys, resolve));
}

function storageLocalSet(items) {
    return new Promise((resolve, reject) => {
        pBrowser.storage.local.set(items, () => {
            if (pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

// Load settings from storage
export function loadSettings(callback) {
    storageLocalGet(Object.keys(currentSettings)).then((items) => {
        console.log("Items retrieved from storage:", items);
        if (items && Object.keys(items).length > 0) {
            const validItems = Object.entries(items).reduce((acc, [key, value]) => {
                if (value !== undefined) {
                    acc[key] = value;
                }
                return acc;
            }, {});
            currentSettings = { ...currentSettings, ...validItems };
        }
        console.log("Loaded settings:", currentSettings);
        if (callback) callback(currentSettings);
    }).catch(error => {
        console.error("Error loading settings:", error);
        if (callback) callback(currentSettings); // Fallback to default settings
    });
}

// Update settings in storage
export function saveSettings() {
    storageLocalSet(currentSettings).then(() => {
        console.log("Saving settings:", currentSettings);
        if (typeof window.postMessage === 'function') {
            window.postMessage({
                type: 'UPDATE_SETTINGS',
                settings: currentSettings
            }, '*');
        }
    }).catch(error => {
        console.error("Error saving settings:", error);
    });
}

// Update settings object with new values
export function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    console.log("Updated settings object:", currentSettings);
}

// Get current settings
export function getSettings() {
    return { ...currentSettings }; // Return a copy to prevent direct modification
}

// Function to update the cache size display.
export function updateCacheSize() {
    if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
        pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' }, (response) => {
            if (pBrowser.runtime.lastError) {
                console.error("Error getting cache size:", pBrowser.runtime.lastError.message);
                document.getElementById('cache-size').textContent = `Error loading cache size.`;
                return;
            }
            if (response && response.success) {
                const sizeMB = (response.sizeKB / 1024).toFixed(2);
                document.getElementById('cache-size').textContent = `${sizeMB} MB used (${response.cacheCount} songs cached)`;
            } else {
                console.error("Error getting cache size from response:", response ? response.error : "No response");
                document.getElementById('cache-size').textContent = `Could not retrieve cache size.`;
            }
        });
    } else {
        console.warn("pBrowser.runtime.sendMessage is not available. Skipping cache size update.");
        document.getElementById('cache-size').textContent = `Cache info unavailable.`;
    }
}

// Clear cache button logic
export function clearCache() {
    if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
        pBrowser.runtime.sendMessage({ type: 'RESET_CACHE' }, (response) => {
            if (pBrowser.runtime.lastError) {
                console.error("Error resetting cache:", pBrowser.runtime.lastError.message);
                alert('Error clearing cache: ' + pBrowser.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                updateCacheSize();
                alert('Cache cleared successfully!');
            } else {
                console.error("Error resetting cache from response:", response ? response.error : "No response");
                alert('Error clearing cache: ' + (response ? response.error : 'Unknown error'));
            }
        });
    } else {
        console.warn("pBrowser.runtime.sendMessage is not available. Skipping cache clear.");
        alert('Cache clearing feature is unavailable in this context.');
    }
}

// Message listener for updates (e.g., from background script if settings are changed elsewhere)
export function setupSettingsMessageListener(callback) {
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;

            console.log("Received settings update via window message:", event.data.settings);
            updateSettings(event.data.settings); // Update internal state
            if (callback) callback(currentSettings); // Notify UI to update
        });
    }
}
