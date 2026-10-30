const pBrowser = typeof browser !== 'undefined'
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

const defaultSettings = {
    lyricsProviderOrder: 'kpoe,lrcred,unison,lrclib',
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
    romanizationProvider: 'offline',
    transliterationTargetScript: 'latin',
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
    YTSongInfoDisableSeekbar: false,
    openRouterApiKey: '',
    openRouterModel: 'google/gemma-3n-e2b-it:free',
    deeplApiKey: ''
};

let currentSettings = { ...defaultSettings };
let _lastAppliedDynamicPlayer = null;
let _lastInjectedCustomCSS = null;
let _cachedCustomStyleTag = null;

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;

    console.log("Received new settings:", event.data.settings);
    updateSettings(event.data.settings);
});

function loadSettings(callback) {
    storageLocalGet(defaultSettings).then((items) => {
        currentSettings = items;
        console.log(currentSettings);
        applyDynamicPlayerClass(true);
        injectCustomCSS(currentSettings.customCSS);
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') return;

    const changedKeys = [];
    for (const key of Object.keys(newSettings)) {
        if (currentSettings[key] !== newSettings[key]) {
            changedKeys.push(key);
        }
    }

    currentSettings = { ...currentSettings, ...newSettings };

    if (newSettings.dynamicPlayer !== undefined) {
        applyDynamicPlayerClass(false);
    }
    if (newSettings.customCSS !== undefined) {
        injectCustomCSS(currentSettings.customCSS);
    }

    if (changedKeys.length === 0) return;

    window.dispatchEvent(new CustomEvent('YOUPLUS_SETTINGS_UPDATED', {
        detail: {
            settings: currentSettings,
            changedKeys
        }
    }));
}

if (pBrowser && pBrowser.storage) {
    pBrowser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            const changedSettings = {};
            for (const key in changes) {
                changedSettings[key] = changes[key].newValue;
            }
            console.log("Settings updated via storage:", changedSettings);
            updateSettings(changedSettings);
        }
    });
}

function applyDynamicPlayerClass(force = false) {
    const enabled = !!currentSettings.dynamicPlayer;
    if (!force && _lastAppliedDynamicPlayer === enabled) return;
    _lastAppliedDynamicPlayer = enabled;

    const layoutElement = document.getElementById('layout');
    if (layoutElement && layoutElement.classList.contains('dynamic-player') !== enabled) {
        layoutElement.classList.toggle('dynamic-player', enabled);
    }
    if (typeof LYPLUS_bgConfig !== 'undefined' && Array.isArray(LYPLUS_bgConfig.dynamicPlayerSelectors)) {
        for (let i = 0; i < LYPLUS_bgConfig.dynamicPlayerSelectors.length; i++) {
            const el = document.querySelector(LYPLUS_bgConfig.dynamicPlayerSelectors[i]);
            if (el && el.classList.contains('dynamic-player') !== enabled) {
                el.classList.toggle('dynamic-player', enabled);
            }
        }
    }
}

function injectCustomCSS(customCSS) {
    const nextCSS = customCSS || '';
    if (_lastInjectedCustomCSS === nextCSS) return;

    let styleTag = (_cachedCustomStyleTag && _cachedCustomStyleTag.isConnected)
        ? _cachedCustomStyleTag
        : document.getElementById('lyrics-plus-custom-css');

    if (!styleTag) {
        if (!nextCSS) {
            _lastInjectedCustomCSS = '';
            return;
        }
        styleTag = document.createElement('style');
        styleTag.id = 'lyrics-plus-custom-css';
        document.head.appendChild(styleTag);
    }

    _cachedCustomStyleTag = styleTag;
    _lastInjectedCustomCSS = nextCSS;
    if (styleTag.textContent !== nextCSS) {
        styleTag.textContent = nextCSS;
    }
}