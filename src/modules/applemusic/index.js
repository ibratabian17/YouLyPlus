// src/modules/applemusic/index.js

let lyricsRendererInstance = null;
let portalObserver = null;
let currentSongInfo = {};
let injectionInterval = null;
let cachedAudioElement = null;
let songChangeTimeout = null; 

// --- UI Configuration ---
const uiConfig = {
    player: '#apple-music-player',
    patchParent: '#lyplus-patch-container', 
    selectors: [
        '#lyplus-patch-container',
        '[data-testid="modal"]',
        '[data-testid="lyrics-fullscreen-modal"]'
    ],
    buttonParent: '[data-testid="lyrics-fullscreen-modal"]',
    disableNativeTick: true,
    seekTo: (time) => {
        window.postMessage({ type: 'LYPLUS_SEEK_TO', time: time }, '*');
    }
};

// --- Globals ---
function injectDOMScript() {
    if (!pBrowser?.runtime?.getURL) {
        console.warn('APPLE MUSIC: runtime.getURL unavailable, skipping DOM script inject');
        return;
    }
    const script = document.createElement('script');
    script.src = pBrowser.runtime.getURL('src/inject/applemusic/songTracker.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    const parser = document.createElement('script');
    parser.src = pBrowser.runtime.getURL('src/lib/parser.js');
    parser.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(parser);
}

injectPlatformCSS = function() {
    if (document.querySelector('link[data-lyrics-plus-platform-style]')) return;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    const browserAPI = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (!browserAPI?.runtime?.getURL) return;
    
    linkElement.href = browserAPI.runtime.getURL('src/modules/applemusic/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
};

const LyricsPlusAPI = {
    displayLyrics: (...args) => lyricsRendererInstance?.displayLyrics(...args),
    displaySongNotFound: () => lyricsRendererInstance?.displaySongNotFound(),
    displaySongError: () => lyricsRendererInstance?.displaySongError(),
    cleanupLyrics: () => lyricsRendererInstance?.cleanupLyrics(),
    updateDisplayMode: (...args) => lyricsRendererInstance?.updateDisplayMode(...args),
    updateCurrentTick: (...args) => lyricsRendererInstance?.updateCurrentTick(...args)
};

// --- Injection ---

function tryInject() {
    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    
    if (lyricsArticle) {
        let patchWrapper = document.getElementById('lyplus-patch-container');
        
        if (!patchWrapper) {
            console.log('LyricsPlus: Creating wrapper container...');
            patchWrapper = document.createElement('div');
            patchWrapper.id = 'lyplus-patch-container';
            lyricsArticle.appendChild(patchWrapper);
        }

        if (!document.getElementById('lyrics-plus-container')) {
            console.log('LyricsPlus: Lyrics container missing, checking for reuse...');
            
            if (!lyricsRendererInstance) {
                lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
            }
            
            const canReuse = lyricsRendererInstance.lyricsContainer && 
                             lyricsRendererInstance.lastKnownSongInfo && 
                             currentSongInfo &&
                             lyricsRendererInstance.lastKnownSongInfo.title === currentSongInfo.title &&
                             lyricsRendererInstance.lastKnownSongInfo.artist === currentSongInfo.artist;

            if (canReuse) {
                console.log('LyricsPlus: Reusing existing container');
                patchWrapper.appendChild(lyricsRendererInstance.lyricsContainer);
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.restore();
            } else {
                console.log('LyricsPlus: Injecting new lyrics...');
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.lyricsContainer = null;
                
                if (currentSongInfo && currentSongInfo.title && typeof fetchAndDisplayLyrics === 'function') {
                    fetchAndDisplayLyrics(currentSongInfo, true);
                }
            }
        }
    }
}

function startInjectionWatcher() {
    if (injectionInterval) clearInterval(injectionInterval);
    
    injectionInterval = setInterval(() => {
        const modalExists = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');

        if (modalExists) {
            tryInject();
        } else {
            if (lyricsRendererInstance && document.getElementById('lyrics-plus-container')) {
                lyricsRendererInstance.cleanupLyrics();
            }
        }
    }, 1000);
}


// --- Setup ---

function setupObservers() {
    const portal = document.querySelector('.portal');
    if (portal) {
        portalObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    tryInject();
                }
            }
        });
        portalObserver.observe(portal, { childList: true, subtree: true });
    } else {
        setTimeout(setupObservers, 1000);
    }

    const lyricsButton = document.querySelector('[data-testid="lyrics-button"]');
    if (lyricsButton) {
        lyricsButton.addEventListener('click', () => {
            setTimeout(tryInject, 100);
        });
    }

    startInjectionWatcher();
}

function initialize() {
    console.log('LyricsPlus: Apple Music Module Initialized');
    window.injectPlatformCSS();
    setupObservers();
    tryInject();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
        return;
    }

    if (event.data.type === 'LYPLUS_TIME_UPDATE' && typeof event.data.currentTime === 'number') {
        LyricsPlusAPI.updateCurrentTick(event.data.currentTime)
    }

    if (event.data.type === 'LYPLUS_SONG_CHANGED') {
        currentSongInfo = event.data.songInfo;
    }
});