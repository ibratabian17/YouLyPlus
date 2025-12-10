// ytmusic/index.js

// This script is the bridge between the generic renderer and the YouTube Music UI

// 1. Platform-specific implementations
const uiConfig = {
    player: 'video',
    patchParent: '#tab-renderer',
    selectors: [
        'ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
        'ytmusic-app-layout[is-mweb-modernization-enabled] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
        'ytmusic-player-page:not([is-video-truncation-fix-enabled])[player-fullscreened] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])'
    ],
    disableNativeTick: true,
    seekTo: (time) => {
        window.postMessage({ type: 'LYPLUS_SEEK_TO', time: time }, '*');
    }
};
let progressBar;
let currentSongDuration = 1;

const titleElementElem = document.createElement('p');
const artistElementElem = document.createElement('p');

// 2. Create the renderer instance
const lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);

// 3. Create the global API for other modules to use
const LyricsPlusAPI = {
    displayLyrics: (...args) => lyricsRendererInstance.displayLyrics(...args),
    displaySongNotFound: () => lyricsRendererInstance.displaySongNotFound(),
    displaySongError: () => lyricsRendererInstance.displaySongError(),
    cleanupLyrics: () => lyricsRendererInstance.cleanupLyrics(),
    updateDisplayMode: (...args) => lyricsRendererInstance.updateDisplayMode(...args),
    updateCurrentTick: (...args) => lyricsRendererInstance.updateCurrentTick(...args)
};

function injectPlatformCSS() {
    if (document.querySelector('link[data-lyrics-plus-platform-style]')) return;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    if (!pBrowser?.runtime?.getURL) {
        console.warn('Tidal: runtime.getURL unavailable, skipping CSS inject');
        return;
    }
    linkElement.href = pBrowser.runtime.getURL('src/modules/ytmusic/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
}

// Function to inject the DOM script
function injectDOMScript() {
    if (!pBrowser?.runtime?.getURL) {
        console.warn('YTMusic: runtime.getURL unavailable, skipping DOM script inject');
        return;
    }
    const script = document.createElement('script');
    script.src = pBrowser.runtime.getURL('src/inject/ytmusic/songTracker.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);

    /*
    //patch uiconst player = document.querySelector('ytmusic-player');
    const songInfoContainerElem = document.createElement('div');
    songInfoContainerElem.className = 'lyrics-song-container';

    //title
    titleElementElem.id = 'lyrics-song-title';
    titleElementElem.textContent = "Placeholder"

    artistElementElem.id = 'lyrics-song-artist';
    artistElementElem.textContent = "Placeholder"
    const progressBarElem = document.createElement('div');
    progressBarElem.id = 'lyrics-song-progressbar';
    progressBarElem.classList.add('progress-container');
    songInfoContainerElem.appendChild(titleElementElem);
    songInfoContainerElem.appendChild(artistElementElem);
    songInfoContainerElem.appendChild(progressBarElem);
    player.appendChild(songInfoContainerElem);
    progressBar = new WavyProgressBar(progressBarElem);
    progressBar.play();

    const ytPlayer = document.querySelector('video');
    ytPlayer.addEventListener('play', () => {
        progressBar.play();
    })
    ytPlayer.addEventListener('pause', () => {
        progressBar.pause();
    })
        */
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
        return;
    }

    if (event.data.type === 'LYPLUS_TIME_UPDATE' && typeof event.data.currentTime === 'number') {
        LyricsPlusAPI.updateCurrentTick(event.data.currentTime)

        //const cur = event.data.currentTime;
        //progressBar.update(cur / currentSongDuration);
    }

    /* if (event.data.type === 'LYPLUS_SONG_CHANGED' && event.data.songInfo.duration) {
        const songInfo = event.data.songInfo
        currentSongDuration = songInfo.duration
        const yttitleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
        const ytbyline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
        if (yttitleElement.textContent.trim() != "") {
            titleElementElem.textContent = yttitleElement.textContent
            artistElementElem.textContent = ytbyline.textContent
        }
        else {
            titleElementElem.textContent = songInfo.title
            artistElementElem.textContent = songInfo.artist + ' • ' + songInfo.album
        }
    } */
});