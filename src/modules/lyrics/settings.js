const pBrowser = typeof browser !== 'undefined'
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

const defaultSettings = {
    lyricsProviderOrder: 'kpoe,unison,lrclib',
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
    deeplApiKey: ''
};

let currentSettings = { ...defaultSettings };

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;

    console.log("Received new settings:", event.data.settings);
    updateSettings(event.data.settings);
});

function loadSettings(callback) {
    storageLocalGet(defaultSettings).then((items) => {
        currentSettings = items;
        console.log(currentSettings);
        injectCustomCSS(currentSettings.customCSS);
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };

    applyDynamicPlayerClass();
    if (newSettings.customCSS !== undefined) {
        injectCustomCSS(currentSettings.customCSS);
    }

    window.dispatchEvent(new CustomEvent('YOUPLUS_SETTINGS_UPDATED', {
        detail: {
            settings: currentSettings,
            changedKeys: Object.keys(newSettings)
        }
    }));
}

if (pBrowser && pBrowser.storage) {
    pBrowser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            const changedSettings = {};
            for (let key in changes) {
                changedSettings[key] = changes[key].newValue;
            }
            console.log("Settings updated via storage:", changedSettings);
            updateSettings(changedSettings);
        }
    });
}

function applyDynamicPlayerClass() {
    const layoutElement = document.getElementById('layout');
    if (!layoutElement) return;

    layoutElement.classList.toggle('dynamic-player', currentSettings.dynamicPlayer);
}
function injectCustomCSS(customCSS) {
    let styleTag = document.getElementById('lyrics-plus-custom-css');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'lyrics-plus-custom-css';
        document.head.appendChild(styleTag);
    }
    styleTag.textContent = customCSS || '';
}
