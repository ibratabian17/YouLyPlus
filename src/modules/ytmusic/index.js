// ytmusic/index.js

if (typeof LYPLUS_setBgConfig === 'function') {
    LYPLUS_setBgConfig({
        dynamicPlayerSelectors: ['#layout'],
        blurContainerParentSelector: '#layout',
        mutationObserverRootSelector: '#layout',
        artworkSelector: '.image.ytmusic-player-bar'
    });
}

// This script is the bridge between the generic renderer and the YouTube Music UI

// 1. Platform-specific implementations
const uiConfig = {
    player: 'video',
    patchParent: '#lyplus-patch-container',
    selectors: [
        '#lyplus-patch-container',
        'ytmusic-tab-renderer:has(#lyplus-patch-container)',
        'ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
        'ytmusic-app-layout[is-mweb-modernization-enabled] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
        'ytmusic-player-page:not([is-video-truncation-fix-enabled])[player-fullscreened] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])'
    ],
    buttonParent: 'ytmusic-app-layout',
    disableNativeTick: true,
    seekTo: (time) => {
        window.postMessage({ type: 'LYPLUS_SEEK_TO', time: time }, '*');
    }
};
let lyricsRendererInstance = null;
let progressBar;
let currentSongDuration = 1;
let lastUpdateTimestamp = 0;
const THROTTLE_MS = 33.3;

const titleElementElem = document.createElement('p');
const artistElementElem = document.createElement('p');

function patchTabRenderer() {
    const tabRenderer = document.querySelector('#tab-renderer');

    if (tabRenderer) {
        let patchWrapper = document.getElementById('lyplus-patch-container');

        if (!patchWrapper) {
            console.log('LyricsPlus: Creating wrapper container...');
            patchWrapper = document.createElement('div');
            patchWrapper.id = 'lyplus-patch-container';
            tabRenderer.appendChild(patchWrapper);
        }

        if (!document.getElementById('lyrics-plus-container')) {
            console.log('LyricsPlus: Lyrics container missing, checking for reuse...');

            if (!lyricsRendererInstance) {
                lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
            }
        }
    }
}

//Create the global API for other modules to use
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
    if (text !== undefined) {
        container.dataset.currentText = text;
    } else {
        text = container.dataset.currentText || '';
    }

    let wrapper = container.querySelector('.marquee-wrapper');
    let content = container.querySelector('.marquee-content');

    if (!wrapper || !content) {
        container.innerHTML = '';
        wrapper = document.createElement('div');
        wrapper.className = 'marquee-wrapper';

        content = document.createElement('span');
        content.className = 'marquee-content';
        content.textContent = text;

        wrapper.appendChild(content);
        container.appendChild(wrapper);
    } else if (content.textContent !== text) {
        content.textContent = text;
        const duplicate = wrapper.querySelector('.marquee-duplicate');
        if (duplicate) duplicate.remove();
        container.classList.remove('marquee-active');
        wrapper.classList.remove('animate');
    }

    requestAnimationFrame(() => {
        const containerWidth = container.clientWidth;
        const contentWidth = content.scrollWidth;

        if (contentWidth > containerWidth && containerWidth > 0) {
            const gap = 60;
            let duplicate = wrapper.querySelector('.marquee-duplicate');
            if (!duplicate) {
                duplicate = content.cloneNode(true);
                duplicate.className = 'marquee-content marquee-duplicate';
                wrapper.appendChild(duplicate);
            } else {
                duplicate.textContent = text;
            }

            const scrollDistance = contentWidth + gap;
            const speed = 30; // 30px per second for smooth, readable scrolling
            const scrollDuration = scrollDistance / speed;
            // 20% pause in CSS keyframe (0% to 20%), so movement takes 80% of totalDuration
            const totalDuration = scrollDuration / 0.8;

            wrapper.style.setProperty('--marquee-distance', `${scrollDistance}px`);
            wrapper.style.setProperty('--total-duration', `${totalDuration.toFixed(2)}s`);
            wrapper.style.setProperty('--gap', `${gap}px`);

            container.classList.add('marquee-active');
            wrapper.classList.add('animate');
        } else {
            const duplicate = wrapper.querySelector('.marquee-duplicate');
            if (duplicate) duplicate.remove();
            container.classList.remove('marquee-active');
            wrapper.classList.remove('animate');
        }
    });
}

let marqueeResizeTimeout;
const marqueeResizeObserver = new ResizeObserver(entries => {
    clearTimeout(marqueeResizeTimeout);
    marqueeResizeTimeout = setTimeout(() => {
        for (let entry of entries) {
            if (entry.target.dataset.currentText) {
                updateTextWithMarquee(entry.target);
            }
        }
    }, 100);
});

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

    patchTabRenderer();


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

        progressBarElem.addEventListener('seek', (e) => {
            if (typeof e.detail?.progress === 'number' && currentSongDuration > 0) {
                const seekTime = e.detail.progress * currentSongDuration;
                window.postMessage({ type: 'LYPLUS_SEEK_TO', time: seekTime }, '*');
            }
        });

        const ytPlayer = document.querySelector('video');
        if (ytPlayer) {
            if (!ytPlayer.paused) {
                progressBar.play();
            } else {
                progressBar.pause();
            }
            ytPlayer.addEventListener('play', () => {
                progressBar?.play();
            });
            ytPlayer.addEventListener('pause', () => {
                progressBar?.pause();
            });
            ytPlayer.addEventListener('ended', () => {
                progressBar?.pause();
            });
        } else {
            progressBar.play();
        }

        // Observe for layout changes
        marqueeResizeObserver.observe(titleElementElem);
        marqueeResizeObserver.observe(artistElementElem);
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