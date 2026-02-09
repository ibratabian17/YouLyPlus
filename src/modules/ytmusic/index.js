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
let lastUpdateTimestamp = 0;
const THROTTLE_MS = 33.3;

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
    updateCurrentTick: (...args) => lyricsRendererInstance.updateCurrentTick(...args),
    setTranslationLoading: (...args) => lyricsRendererInstance.setTranslationLoading(...args)
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

function updateTextWithMarquee(container, text) {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'marquee-wrapper';

    const content = document.createElement('span');
    content.className = 'marquee-content';
    content.textContent = text;

    wrapper.appendChild(content);
    container.appendChild(wrapper);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const containerWidth = container.clientWidth;
            const contentWidth = content.scrollWidth;

            container.classList.remove('marquee-active');
            wrapper.classList.remove('animate');

            if (contentWidth > containerWidth) {
                const gap = 60;

                const duplicate = content.cloneNode(true);
                wrapper.appendChild(duplicate);

                const scrollDistance = contentWidth + gap;

                const scrollDuration = scrollDistance / 60;
                const pauseDuration = 2;
                const totalDuration = scrollDuration + pauseDuration;

                const pausePercent = (pauseDuration / totalDuration) * 100;
                const scrollPercent = 100 - pausePercent;

                wrapper.style.setProperty('--marquee-distance', `${scrollDistance}px`);
                wrapper.style.setProperty('--total-duration', `${totalDuration}s`);
                wrapper.style.setProperty('--pause-percent', pausePercent.toFixed(2));
                wrapper.style.setProperty('--scroll-percent', scrollPercent.toFixed(2));
                wrapper.style.setProperty('--gap', `${gap}px`);

                container.classList.add('marquee-active');
                wrapper.classList.add('animate');
            }
        });
    });
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


    //patch ui
    if (currentSettings.YTSongInfo) {
        const player = document.querySelector('ytmusic-player');
        const songInfoContainerElem = document.createElement('div');
        songInfoContainerElem.className = 'lyrics-song-container';

        //title
        titleElementElem.id = 'lyrics-song-title';
        titleElementElem.className = 'marquee-container';
        updateTextWithMarquee(titleElementElem, "Placeholder");

        artistElementElem.id = 'lyrics-song-artist';
        artistElementElem.className = 'marquee-container';
        updateTextWithMarquee(artistElementElem, "Placeholder");

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
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
        return;
    }

    if (event.data.type === 'LYPLUS_TIME_UPDATE' && typeof event.data.currentTime === 'number') {
        LyricsPlusAPI.updateCurrentTick(event.data.currentTime)

        if (currentSettings.YTSongInfo) {
            const now = performance.now();
            if (now - lastUpdateTimestamp >= THROTTLE_MS) {
                lastUpdateTimestamp = now;

                const cur = event.data.currentTime;
                progressBar.update(cur / currentSongDuration);
            }
        }
    }

    if (event.data.type === 'LYPLUS_SONG_CHANGED' && event.data.songInfo.duration) {
        if (currentSettings.YTSongInfo) {
            const songInfo = event.data.songInfo
            currentSongDuration = songInfo.duration
            const yttitleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
            const ytbyline = document.querySelector('.byline.style-scope.ytmusic-player-bar');

            let titleText = songInfo.title;
            let artistText = songInfo.artist + ' • ' + songInfo.album;

            if (yttitleElement && yttitleElement.textContent.trim() != "") {
                titleText = yttitleElement.textContent;
                artistText = ytbyline.textContent;
            }

            updateTextWithMarquee(titleElementElem, titleText);
            updateTextWithMarquee(artistElementElem, artistText);

        }
    }
});