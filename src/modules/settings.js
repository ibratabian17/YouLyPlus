const pBrowser = chrome || browser;


window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    
    if (event.data.type === 'UPDATE_SETTINGS') {
        console.log("Received new settings:", event.data.settings);
        updateSettings(event.data.settings);
    }
});

let currentSettings = {
    lyricsProvider: 'kpoe', // Can be 'kpoe' or 'lrclib'
    lyricsSourceOrder: 'lyricsplus,apple,musixmatch,spotify,musixmatch-word', // For KPoe provider
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
    // Translation settings
    translationProvider: 'google', // 'google' or 'gemini'
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash', // Default Gemini model updated
    overrideTranslateTarget: false,
    customTranslateTarget: '',
    overrideGeminiPrompt: false,
    customGeminiPrompt: `You are a professional translator for song lyrics.
Translate the following lines into {targetLang}.
Your most important task is to preserve the original meaning, emotion, and tone of each line.
After ensuring the meaning is preserved, try to make the translation sound natural in {targetLang}.`,
    // New settings for translation/romanization toggle
    translationEnabled: false,
    romanizationEnabled: false,
};

function loadSettings(callback) {
    storageLocalGet({
        lyricsProvider: 'kpoe',
        lyricsSourceOrder: 'lyricsplus,apple,musixmatch,spotify,musixmatch-word',
        wordByWord: true,
        lineByLine: true,
        lightweight: false,
        isEnabled: true,
        useSponsorBlock: false,
        autoHideLyrics: false,
        cacheStrategy: 'aggressive',
        fontSize: 16,
        compabilityVisibility: false, // New compatibility setting
        compabilityWipe: false, // New compatibility setting
        // Translation settings
        translationProvider: 'google',
        geminiApiKey: '',
        geminiModel: 'gemini-2.5-flash', // Default Gemini model updated
        overrideTranslateTarget: false,
        customTranslateTarget: '',
        overrideGeminiPrompt: false,
        customGeminiPrompt: `You are a professional translator for song lyrics.
Translate the following lines into {targetLang}.
Your most important task is to preserve the original meaning, emotion, and tone of each line.
After ensuring the meaning is preserved, try to make the translation sound natural in {targetLang}.`,
        translationEnabled: false,
        romanizationEnabled: false,
    }).then((items) => {
        currentSettings = items;
        console.log(currentSettings);
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    currentSettings = newSettings;
}
