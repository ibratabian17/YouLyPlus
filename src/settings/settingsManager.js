// Browser compatibility
const pBrowser = window.chrome || window.browser;

let currentSettings = {
    lyricsProvider: 'kpoe',
    lyricsSourceOrder: 'apple,lyricsplus,musixmatch,spotify,musixmatch-word',
    wordByWord: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    autoHideLyrics: false,
    cacheStrategy: 'aggressive',
    fontSize: 16,
    hideOffscreen: false,
    compabilityWipe: false,
    blurInactive: false,
    dynamicPlayer: false,
    customCSS: '',
    translationProvider: 'google',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash-lite',
    overrideTranslateTarget: false,
    customTranslateTarget: '',
    overrideGeminiPrompt: false,
    customGeminiPrompt: '',
    overrideGeminiRomanizePrompt: false,
    customGeminiRomanizePrompt: '',
    romanizationProvider: 'google',
    geminiRomanizationModel: 'gemini-2.0-flash',
    useSongPaletteFullscreen: false,
    useSongPaletteAllModes: false,
    overridePaletteColor: '',
    largerTextMode: 'lyrics', // 'lyrics' or 'romanization'
    customKpoeUrl: '',
    localLyrics: [] // New setting for local lyrics list
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
        if (callback) callback(currentSettings);
    });
}

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

export function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    console.log("Updated settings object:", currentSettings);
}

// Get current settings
export function getSettings() {
    return { ...currentSettings };
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

export function uploadLocalLyrics(songInfo, jsonLyrics) {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({
                type: 'UPLOAD_LOCAL_LYRICS',
                songInfo,
                jsonLyrics
            }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("Error uploading local lyrics:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    console.error("Error uploading local lyrics from response:", response ? response.error : "No response");
                    reject(response ? response.error : 'Unknown error');
                }
            });
        } else {
            console.warn("pBrowser.runtime.sendMessage is not available. Skipping local lyrics upload.");
            reject('Local lyrics upload feature is unavailable in this context.');
        }
    });
}

export function getLocalLyricsList() {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_LOCAL_LYRICS_LIST' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("Error getting local lyrics list:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response.lyricsList);
                } else {
                    console.error("Error getting local lyrics list from response:", response ? response.error : "No response");
                    reject(response ? response.error : 'Unknown error');
                }
            });
        } else {
            console.warn("pBrowser.runtime.sendMessage is not available. Skipping local lyrics list retrieval.");
            reject('Local lyrics list feature is unavailable in this context.');
        }
    });
}

export function deleteLocalLyrics(songId) {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'DELETE_LOCAL_LYRICS', songId }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("Error deleting local lyrics:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    console.error("Error deleting local lyrics from response:", response ? response.error : "No response");
                    reject(response ? response.error : 'Unknown error');
                }
            });
        } else {
            console.warn("pBrowser.runtime.sendMessage is not available. Skipping local lyrics deletion.");
            reject('Local lyrics deletion feature is unavailable in this context.');
        }
    });
}

export function setupSettingsMessageListener(callback) {
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;

            console.log("Received settings update via window message:", event.data.settings);
            updateSettings(event.data.settings);
            if (callback) callback(currentSettings);
        });
    }
}
