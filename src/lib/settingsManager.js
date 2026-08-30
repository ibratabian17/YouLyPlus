// ==========================================================================
// Settings Manager - Centralized storage and configuration management
// ==========================================================================

export const pBrowser = typeof browser !== 'undefined'
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

export const defaultSettings = {
    lyricsProviderOrder: 'binilyrics,kpoe,unison,lrclib',
    lyricsSourceOrder: 'apple,lyricsplus,qq,musixmatch,musixmatch-word',
    wordByWord: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    autoHideLyrics: false,
    cacheStrategy: 'aggressive',
    fontSize: 16,
    hideOffscreen: true,
    blurInactive: false,
    dynamicPlayer: false,
    audioBeatSync: false,
    relaxScroll: false,
    customCSS: '',
    translationProvider: 'google',
    geminiApiKey: '',
    geminiModel: 'gemini-flash-lite-latest',
    overrideTranslateTarget: false,
    customTranslateTarget: '',
    overrideGeminiPrompt: false,
    customGeminiPrompt: '',
    overrideGeminiRomanizePrompt: false,
    customGeminiRomanizePrompt: '',
    romanizationProvider: 'google',
    geminiRomanizationModel: 'gemini-flash-latest',
    useSongPaletteFullscreen: false,
    useSongPaletteAllModes: false,
    overridePaletteColor: '',
    largerTextMode: 'lyrics', // 'lyrics' or 'romanization'
    hidePhoneticDup: false,
    bkgOverlap: true,
    customKpoeUrl: '',
    appleMusicTTMLBypass: false,
    YTSongInfo: false,
    openRouterApiKey: '',
    openRouterModel: 'google/gemma-3n-e2b-it:free',
    deeplApiKey: '',
    preferUnisonVideo: false
};

let currentSettings = { ...defaultSettings };

export function storageLocalGet(keys) {
    return new Promise((resolve, reject) => {
        if (!pBrowser || !pBrowser.storage) {
            console.warn("YouLy+: pBrowser.storage not available. Using mock storage fallback.");
            try {
                const mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                const result = {};
                const targetKeys = keys || defaultSettings;
                Object.keys(targetKeys).forEach(key => {
                    if (Object.prototype.hasOwnProperty.call(mockStorage, key)) {
                        result[key] = mockStorage[key];
                    } else {
                        result[key] = targetKeys[key];
                    }
                });
                resolve(result);
            } catch (err) {
                resolve({ ...defaultSettings });
            }
            return;
        }

        pBrowser.storage.local.get(keys, (result) => {
            if (pBrowser.runtime && pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve(result || {});
            }
        });
    });
}

export function storageLocalSet(items) {
    return new Promise((resolve, reject) => {
        if (!pBrowser || !pBrowser.storage) {
            console.warn("YouLy+: pBrowser.storage not available. Using mock storage fallback.");
            try {
                let mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                mockStorage = { ...mockStorage, ...items };
                localStorage.setItem('youly_mock_storage', JSON.stringify(mockStorage));
                resolve();
            } catch (err) {
                reject(err);
            }
            return;
        }

        pBrowser.storage.local.set(items, () => {
            if (pBrowser.runtime && pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

export function loadSettings(callback) {
    return storageLocalGet(defaultSettings).then((items) => {
        currentSettings = { ...defaultSettings, ...items };
        injectCustomCSS(currentSettings.customCSS);
        if (callback) callback(currentSettings);
        return currentSettings;
    }).catch(error => {
        console.error("YouLy+: Error loading settings:", error);
        currentSettings = { ...defaultSettings };
        injectCustomCSS(currentSettings.customCSS);
        if (callback) callback(currentSettings);
        return currentSettings;
    });
}

export function saveSettings() {
    return storageLocalSet(currentSettings).then(() => {
        if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
            window.postMessage({
                type: 'UPDATE_SETTINGS',
                settings: currentSettings
            }, '*');
        }
        return currentSettings;
    }).catch(error => {
        console.error("YouLy+: Error saving settings:", error);
        throw error;
    });
}

export function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    if (newSettings.customCSS !== undefined) {
        injectCustomCSS(currentSettings.customCSS);
    }
    return currentSettings;
}

export function getSettings() {
    return { ...currentSettings };
}

export function updateCacheSize() {
    return new Promise((resolve) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error getting cache size:", pBrowser.runtime.lastError.message);
                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) cacheSizeEl.textContent = `Error loading cache size.`;
                    resolve({ success: false, error: pBrowser.runtime.lastError.message });
                    return;
                }
                if (response && response.success) {
                    const sizeMB = (response.sizeKB / 1024).toFixed(2);
                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) {
                        cacheSizeEl.textContent = `${sizeMB} MB used (${response.cacheCount} songs cached)`;
                    }
                    const popupSizeEl = document.querySelector('.cache-size-value');
                    const popupCountEl = document.querySelector('.cache-count-value');
                    if (popupSizeEl) popupSizeEl.textContent = `${sizeMB} MB`;
                    if (popupCountEl) popupCountEl.textContent = response.cacheCount.toString();
                    resolve({ success: true, sizeMB, sizeKB: response.sizeKB, cacheCount: response.cacheCount });
                } else {
                    const err = response ? response.error : "No response";
                    console.error("YouLy+: Error getting cache size from response:", err);
                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) cacheSizeEl.textContent = `Could not retrieve cache size.`;
                    const popupSizeEl = document.querySelector('.cache-size-value');
                    const popupCountEl = document.querySelector('.cache-count-value');
                    if (popupSizeEl) popupSizeEl.textContent = 'N/A';
                    if (popupCountEl) popupCountEl.textContent = 'N/A';
                    resolve({ success: false, error: err });
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping cache size update.");
            const cacheSizeEl = document.getElementById('cache-size');
            if (cacheSizeEl) cacheSizeEl.textContent = `Cache info unavailable.`;
            const popupSizeEl = document.querySelector('.cache-size-value');
            const popupCountEl = document.querySelector('.cache-count-value');
            if (popupSizeEl) popupSizeEl.textContent = 'N/A';
            if (popupCountEl) popupCountEl.textContent = 'N/A';
            resolve({ success: false, error: 'API unavailable' });
        }
    });
}

export function clearCache() {
    return new Promise((resolve) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'RESET_CACHE' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error resetting cache:", pBrowser.runtime.lastError.message);
                    resolve({ success: false, error: pBrowser.runtime.lastError.message });
                    return;
                }
                if (response && response.success) {
                    updateCacheSize();
                    resolve({ success: true });
                } else {
                    const err = response ? response.error : "No response";
                    console.error("YouLy+: Error resetting cache from response:", err);
                    resolve({ success: false, error: err });
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping cache clear.");
            resolve({ success: false, error: 'API unavailable' });
        }
    });
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
                    console.error("YouLy+: Error uploading local lyrics:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    const err = response ? response.error : 'Unknown error';
                    console.error("YouLy+: Error uploading local lyrics from response:", err);
                    reject(err);
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping local lyrics upload.");
            reject('Local lyrics upload feature is unavailable in this context.');
        }
    });
}

export function getLocalLyricsList() {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_LOCAL_LYRICS_LIST' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error getting local lyrics list:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response.lyricsList);
                } else {
                    const err = response ? response.error : 'Unknown error';
                    console.error("YouLy+: Error getting local lyrics list from response:", err);
                    reject(err);
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping local lyrics list retrieval.");
            reject('Local lyrics list feature is unavailable in this context.');
        }
    });
}

export function deleteLocalLyrics(songId) {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'DELETE_LOCAL_LYRICS', songId }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error deleting local lyrics:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    const err = response ? response.error : 'Unknown error';
                    console.error("YouLy+: Error deleting local lyrics from response:", err);
                    reject(err);
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping local lyrics deletion.");
            reject('Local lyrics deletion feature is unavailable in this context.');
        }
    });
}

export function setupSettingsMessageListener(callback) {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;
            updateSettings(event.data.settings);
            if (callback) callback(currentSettings);
        });
    }
}

// Storage change listener to keep settings in sync across all contexts
if (pBrowser && pBrowser.storage) {
    pBrowser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            const newSettings = {};
            for (let key in changes) {
                newSettings[key] = changes[key].newValue;
            }
            updateSettings(newSettings);
        }
    });
}

export function injectCustomCSS(customCSS) {
    if (typeof document === 'undefined') return;
    let styleTag = document.getElementById('lyrics-plus-custom-css');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'lyrics-plus-custom-css';
        document.head.appendChild(styleTag);
    }
    styleTag.textContent = customCSS || '';
}
