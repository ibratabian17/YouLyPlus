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
    patchParent: '[data-testid="lyrics-fullscreen-modal"]', 
    selectors: [
        '[data-testid="modal"]',
        '[data-testid="lyrics-fullscreen-modal"]'
    ]
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

// --- Helpers ---

function getSongInfo() {
    const audio = document.getElementById('apple-music-player');

    if (!audio || !audio.src || !audio.duration) {
        return null;
    }

    if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const meta = navigator.mediaSession.metadata;
        const artwork = meta.artwork.length > 0 ? meta.artwork[meta.artwork.length - 1].src : '';
        return {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            duration: audio.duration,
            cover: artwork,
            isVideo: false 
        };
    }
    return null;
}

// --- Injection ---

function tryInject() {
    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    
    if (lyricsArticle && !document.getElementById('lyrics-plus-container')) {
        console.log('LyricsPlus: Lyrics container detected, injecting...');
        
        if (!lyricsRendererInstance) {
            lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
        } else {
            lyricsRendererInstance.uiConfig.patchParent = '[data-testid="lyrics-fullscreen-modal"]';
            lyricsRendererInstance.lyricsContainer = null;
        }

        lyricsRendererInstance._createLyricsContainer();
        
        if (currentSongInfo && currentSongInfo.title && typeof fetchAndDisplayLyrics === 'function') {
            fetchAndDisplayLyrics(currentSongInfo, true);
        }
    }
}

function startInjectionWatcher() {
    if (injectionInterval) clearInterval(injectionInterval);
    
    injectionInterval = setInterval(() => {
        if (document.querySelector('article[data-testid="lyrics-fullscreen-modal"]')) {
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
    console.log('LyricsPlus: Apple Music Module Initialized (Optimized)');
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