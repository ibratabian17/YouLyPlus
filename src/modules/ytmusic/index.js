// This script is the bridge between the generic renderer and the YouTube Music UI

// 1. Platform-specific implementations
const uiConfig = {
    player: 'video',
    patchParent: '#tab-renderer',
    selectors: [
            'ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
            'ytmusic-app-layout[is-mweb-modernization-enabled] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
            'ytmusic-player-page:not([is-video-truncation-fix-enabled])[player-fullscreened] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])'
        ]
};

// 2. Create the renderer instance
const lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);

// 3. Create the global API for other modules to use
const LyricsPlusAPI = {
  displayLyrics: (...args) => lyricsRendererInstance.displayLyrics(...args),
  displaySongNotFound: () => lyricsRendererInstance.displaySongNotFound(),
  displaySongError: () => lyricsRendererInstance.displaySongError(),
  cleanupLyrics: () => lyricsRendererInstance.cleanupLyrics(),
  updateDisplayMode: (...args) => lyricsRendererInstance.updateDisplayMode(...args)
};

function injectPlatformCSS() {
    if (document.querySelector('link[data-lyrics-plus-platform-style]')) return;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = pBrowser.runtime.getURL('src/modules/ytmusic/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
}

// Function to inject the DOM script
function injectDOMScript() {
    const pBrowser = chrome || browser;
    const script = document.createElement('script');
    script.src = pBrowser.runtime.getURL('src/inject/ytmusic/songTracker.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
}