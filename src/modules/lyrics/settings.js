const pBrowser = chrome || browser;

const defaultSettings = {
    lyricsProvider: 'kpoe', // Can be 'kpoe' or 'lrclib'
    lyricsSourceOrder: 'lyricsplus,apple,musixmatch,spotify,musixmatch-word', // For KPoe provider
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
    // Translation settings
    translationProvider: 'google', // 'google' or 'gemini'
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    overrideTranslateTarget: false,
    customTranslateTarget: '',
    overrideGeminiPrompt: false,
    customGeminiPrompt: `You are a professional translator for song lyrics.
Translate the following lines into {targetLang}.
Your most important task is to preserve the original meaning, emotion, and tone of each line.
After ensuring the meaning is preserved, try to make the translation sound natural in {targetLang}.`,
    // Settings for translation/romanization toggle
    translationEnabled: false,
    romanizationEnabled: false,
    largerTextMode: "lyrics", // "lyrics" or "romanization"
    useSongPaletteFullscreen: false,
    useSongPaletteAllModes: false,
    overridePaletteColor: '',
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
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    currentSettings = newSettings;
    applyDynamicPlayerClass();
    pBrowser.runtime.sendMessage({
        type: 'SETTINGS_CHANGED',
        settings: currentSettings
    });
}

function applyDynamicPlayerClass() {
    const layoutElement = document.getElementById('layout');
    if (!layoutElement) return;

    layoutElement.classList.toggle('dynamic-player', currentSettings.dynamicPlayer);
}