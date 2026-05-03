loadSettings(() => {
    if (currentSettings.isEnabled) {
        initializeLyricsPlus();
    }
});

// Expose fetchAndDisplayLyrics and t globally for other modules to use
window.LyricsPlusAPI = {
    fetchAndDisplayLyrics: fetchAndDisplayLyrics,
    t: t,
    sendMessageToBackground: (message) => {
        return new Promise((resolve) => {
            const pBrowser = typeof browser !== 'undefined'
                ? browser
                : (typeof chrome !== 'undefined' ? chrome : null);
            pBrowser.runtime.sendMessage(message, (response) => {
                resolve(response);
            });
        });
    }
};

function initializeLyricsPlus() {
    // Start the watchdog, which handles the initial injection AND re-injects if deleted
    startCssWatchdog();
    
    // Inject the DOM script
    injectDOMScript();

    // Listen for messages from the injected script
    window.addEventListener('message', function (event) {
        // Only accept messages from the same frame
        if (event.source !== window) return;

        // Check if the message has our prefix
        if (event.data.type && event.data.type.startsWith('LYPLUS_')) {
            // Handle song info updates
            if (event.data.type === 'LYPLUS_SONG_CHANGED') {
                const songInfo = event.data.songInfo;
                console.log('Song changed (received in extension):', songInfo);

                // Don't fetch lyrics if title or artist is empty
                if (!songInfo.title.trim() || !songInfo.artist.trim()) {
                    console.log('Missing title or artist, skipping lyrics fetch.');
                    return;
                }

                // Call the lyrics fetching function with the new song info and new song flag
                fetchAndDisplayLyrics(songInfo, true);
            }
        }
    });
}

// --- CSS INJECTION & WATCHDOG ---

function injectCssFile() {
    if (document.querySelector('link[data-lyrics-plus-style]')) return;
    
    const pBrowser = typeof browser !== 'undefined'
        ? browser
        : (typeof chrome !== 'undefined' ? chrome : null);
        
    const lyricsElement = document.createElement('link');
    lyricsElement.rel = 'stylesheet';
    lyricsElement.type = 'text/css';
    
    if (!pBrowser?.runtime?.getURL) {
        console.warn('LyricsPlus: runtime.getURL unavailable, skipping CSS inject');
        return;
    }
    lyricsElement.href = pBrowser.runtime.getURL('src/modules/lyrics/lyrics.css');
    lyricsElement.setAttribute('data-lyrics-plus-style', 'true');
    
    if (document.body) {
        document.body.insertBefore(lyricsElement, document.body.firstChild);
    } else {
        document.head.appendChild(lyricsElement);
    }
}

function startCssWatchdog() {
    const ensureStyles = () => {
        injectPlatformCSS();
        injectCssFile();
        if (typeof injectCustomCSS === 'function') {
            injectCustomCSS(currentSettings.customCSS);
        }
    };
    
    if (!document.body) {
        setTimeout(startCssWatchdog, 100);
        return;
    }
    
    ensureStyles();

    const cssObserver = new MutationObserver((mutations) => {
        let missing = false;
        
        if (!document.querySelector('link[data-lyrics-plus-style]') || 
            !document.querySelector('link[data-lyrics-plus-platform-style]')) {
            missing = true;
        }

        if (missing) {
            ensureStyles();
            console.log('LYPLUS: CSS Watchdog restored missing stylesheets.');
        }
    });

    cssObserver.observe(document.body, { 
        childList: true, 
        subtree: false
    });
}