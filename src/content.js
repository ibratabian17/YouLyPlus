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
            const pBrowser = chrome || browser;
            pBrowser.runtime.sendMessage(message, (response) => {
                resolve(response);
            });
        });
    }
};

function initializeLyricsPlus() {
    // Inject the DOM script
    injectDOMScript();
    injectCssFile() ;
    
    // Listen for messages from the injected script
    window.addEventListener('message', function(event) {
        // Only accept messages from the same frame
        if (event.source !== window) return;
        
        // Check if the message has our prefix
        if (event.data.type && event.data.type.startsWith('LYPLUS_')) {
            // Handle song info updates
            if (event.data.type === 'LYPLUS_SONG_CHANGED') {
                const songInfo = event.data.songInfo;
                const isNewSong = event.data.isNewSong; // Get the new song flag
                console.log('Song changed (received in extension):', songInfo);
                
                // Don't fetch lyrics if title or artist is empty
                if (!songInfo.title.trim() || !songInfo.artist.trim()) {
                    console.log('Missing title or artist, skipping lyrics fetch.');
                    return;
                }
                
                // Call the lyrics fetching function with the new song info and new song flag
                fetchAndDisplayLyrics(songInfo, isNewSong);
            }
        }
    });
}

// Function to inject the DOM script
function injectDOMScript() {
    const pBrowser = chrome || browser;
    const script = document.createElement('script');
    script.src = pBrowser.runtime.getURL('src/inject/songTracker.js');
    script.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
}


function injectCssFile() {
    if (document.querySelector('link[data-lyrics-plus-style]')) return;
    const pBrowser = chrome || browser;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = pBrowser.runtime.getURL('src/inject/stylesheet.css');
    linkElement.setAttribute('data-lyrics-plus-style', 'true');
    document.head.appendChild(linkElement);
  }