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
    parser.type = 'module';
    parser.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(parser);
}

injectPlatformCSS = function () {
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
    updateCurrentTick: (...args) => lyricsRendererInstance?.updateCurrentTick(...args),
    setTranslationLoading: (...args) => lyricsRendererInstance?.setTranslationLoading(...args)
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

            injectShowHideButton();
            disableNativeLyrics();
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

// src/modules/applemusic/index.js

function injectShowHideButton(retryCount = 0) {
    if (document.getElementById('lyrics-plus-show-hide-btn')) return;

    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    if (!lyricsArticle) return;

    const buttonsWrapper = document.getElementById('lyrics-plus-buttons-wrapper');

    if (!buttonsWrapper) {
        if (retryCount > 60) {
            console.log('LyricsPlus: Button wrapper never appeared.');
            return;
        }

        setTimeout(() => injectShowHideButton(retryCount + 1), 500);
        return;
    }

    const btn = document.createElement('button');
    btn.id = 'lyrics-plus-show-hide-btn';
    btn.className = 'lyrics-plus-button active';
    btn.title = 'Show/Hide Lyrics';
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 18 18" fill-rule="evenodd" clip-rule="evenodd" xml:space="preserve">
            <path d="m9.67 13.982-2.43 2.474c-.472.471-.79.675-1.145.675-.479 0-.623-.314-.623-1.012v-2.137H5.26c-1.406 0-1.915-.146-2.429-.42a2.877 2.877 0 0 1-1.192-1.192c-.274-.514-.421-1.024-.421-2.429V6.464c0-1.405.147-1.915.421-2.428a2.872 2.872 0 0 1 1.192-1.192c.514-.275 1.023-.421 2.429-.421h7.68c1.406 0 1.915.146 2.429.421a2.86 2.86 0 0 1 1.192 1.192c.274.513.421 1.023.421 2.428v3.477c0 1.405-.147 1.915-.421 2.429a2.866 2.866 0 0 1-1.192 1.192c-.514.274-1.023.42-2.429.42H9.67Zm-.974-.957c.257-.261.608-.408.974-.408h3.27c1.076 0 1.426-.068 1.785-.26.276-.147.484-.356.631-.632.192-.358.26-.709.26-1.784V6.464c0-1.075-.068-1.426-.26-1.784a1.49 1.49 0 0 0-.631-.631c-.359-.192-.709-.26-1.785-.26H5.26c-1.075 0-1.425.068-1.785.26a1.5 1.5 0 0 0-.631.631c-.192.358-.26.709-.26 1.784v3.477c0 1.075.068 1.426.26 1.784.148.276.356.485.631.632.36.192.71.26 1.785.26h.212c.754 0 1.365.611 1.365 1.365v.934l1.859-1.891ZM5.422 8.01c0-.821.67-1.383 1.554-1.383.976 0 1.599.726 1.599 1.634 0 1.73-1.46 2.084-2.242 2.084-.222 0-.381-.148-.381-.329 0-.173.084-.294.372-.364.502-.12 1.005.028 1.274-.491h-.056c-.185.208-.483.242-.771.242-.837 0-1.349-.614-1.349-1.393Zm4.204 0c0-.821.669-1.383 1.553-1.383.976 0 1.6.726 1.6 1.634 0 1.73-1.46 2.084-2.242 2.084-.223 0-.381-.148-.381-.329 0-.173.084-.294.372-.364.502-.12 1.004.028 1.274-.491h-.056c-.186.208-.483.242-.772.242-.837 0-1.348-.614-1.348-1.393Z"></path>
        </svg>
    `;

    btn.addEventListener('click', () => {
        const container = document.querySelector(uiConfig.patchParent);
        if (container) {
            container.classList.toggle('lyrics-hidden');
            btn.classList.toggle('active');
        }
    });

    buttonsWrapper.prepend(btn);
}

function disableNativeLyrics() {
    const lyricsArticle = document.querySelector('article.lyrics__container[data-testid="lyrics-fullscreen-modal"]');
    const lyricsToggleBtn = document.querySelector('article.lyrics__container[data-testid="lyrics-fullscreen-modal"] .toggle-button.toggle-button--lyrics.lyrics-button.svelte-tqm8hb');

    if (lyricsArticle && lyricsToggleBtn) {
        // if 'is-lyrics-off' is MISSING, native lyrics are VISIBLE (Active).
        const isNativeLyricsVisible = !lyricsArticle.classList.contains('is-lyrics-off');

        if (isNativeLyricsVisible) {
            console.log('LyricsPlus: Native lyrics detected. toggling off...');
            lyricsToggleBtn.click();
        }
    }
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