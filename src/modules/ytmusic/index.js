// ytmusic/index.js

if (typeof LYPLUS_setBgConfig === 'function') {
    LYPLUS_setBgConfig({
        dynamicPlayerSelectors: ['#layout'],
        blurContainerParentSelector: '#layout',
        mutationObserverRootSelector: '#layout',
        artworkSelector: '.image.ytmusic-player-bar, img.ytmusicTrackInfoThumbnail, .ytmusicTrackInfoThumbnail'
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
    setTranslationLoading: (...args) => lyricsRendererInstance.setTranslationLoading(...args),
    showToast: (...args) => lyricsRendererInstance?.showToast(...args),
    setAvailableProviders: (...args) => lyricsRendererInstance?.setAvailableProviders(...args)
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

const MARQUEE_GAP = 60;
const MARQUEE_SPEED = 30; // 30px per second for smooth, readable scrolling
const marqueePending = new Set();
const marqueeLastWidth = new WeakMap();
let marqueeFlushQueued = false;

function queueMarqueeMeasure(container) {
    marqueePending.add(container);
    if (marqueeFlushQueued) return;
    marqueeFlushQueued = true;
    requestAnimationFrame(flushMarquee);
}

function flushMarquee() {
    marqueeFlushQueued = false;
    const jobs = [];

    for (const container of marqueePending) {
        const wrapper = container.querySelector('.marquee-wrapper');
        const content = container.querySelector('.marquee-content');
        if (!wrapper || !content) continue;

        const cs = getComputedStyle(container);
        const available =
            container.clientWidth -
            (parseFloat(cs.paddingLeft) || 0) -
            (parseFloat(cs.paddingRight) || 0);
        const contentWidth = Math.ceil(content.getBoundingClientRect().width || content.scrollWidth);
        jobs.push({ container, wrapper, content, available, contentWidth });
    }
    marqueePending.clear();

    for (const { container, wrapper, content, available, contentWidth } of jobs) {
        const text = container.dataset.currentText || '';
        let duplicate = wrapper.querySelector('.marquee-duplicate');

        if (contentWidth > available && available > 0) {
            if (!duplicate) {
                duplicate = content.cloneNode(true);
                duplicate.className = 'marquee-content marquee-duplicate';
                wrapper.appendChild(duplicate);
            } else if (duplicate.textContent !== text) {
                duplicate.textContent = text;
            }

            const scrollDistance = contentWidth + MARQUEE_GAP;
            // 20% pause in CSS keyframe (0% to 20%), so movement takes 80% of totalDuration
            const totalDuration = scrollDistance / MARQUEE_SPEED / 0.8;

            wrapper.style.setProperty('--marquee-distance', `${scrollDistance}px`);
            wrapper.style.setProperty('--total-duration', `${totalDuration.toFixed(2)}s`);
            wrapper.style.setProperty('--gap', `${MARQUEE_GAP}px`);

            container.classList.add('marquee-active');
            wrapper.classList.add('animate');
        } else {
            duplicate?.remove();
            container.classList.remove('marquee-active');
            wrapper.classList.remove('animate');
        }
    }
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
        container.textContent = '';
        wrapper = document.createElement('div');
        wrapper.className = 'marquee-wrapper';

        content = document.createElement('span');
        content.className = 'marquee-content';
        content.textContent = text;

        wrapper.appendChild(content);
        container.appendChild(wrapper);
    } else if (content.textContent !== text) {
        content.textContent = text;
        wrapper.querySelector('.marquee-duplicate')?.remove();
        container.classList.remove('marquee-active');
        wrapper.classList.remove('animate');
    } else if (text === undefined) {
        return;
    }

    queueMarqueeMeasure(container);
}

const marqueeResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (marqueeLastWidth.get(entry.target) === width) continue;
        marqueeLastWidth.set(entry.target, width);
        if (entry.target.dataset.currentText) queueMarqueeMeasure(entry.target);
    }
});

let videoPlaying = true;
let barVisible = true;
let barRunning = null;

function syncProgressBar() {
    if (!progressBar) return;
    const shouldRun = videoPlaying && barVisible && !document.hidden;
    if (shouldRun === barRunning) return;
    barRunning = shouldRun;
    if (shouldRun) progressBar.play();
    else progressBar.pause();
}

document.addEventListener('visibilitychange', syncProgressBar, { passive: true });

function injectSongInfo() {
    const player = document.querySelector('ytmusic-player');
    if (!player || player.querySelector(':scope > .lyrics-song-container')) return;

    const songInfoContainerElem = document.createElement('div');
    songInfoContainerElem.className = 'lyrics-song-container';

    //title
    titleElementElem.id = 'lyrics-song-title';
    titleElementElem.className = 'marquee-container';
    updateTextWithMarquee(titleElementElem, 'Placeholder');

    artistElementElem.id = 'lyrics-song-artist';
    artistElementElem.className = 'marquee-container';
    updateTextWithMarquee(artistElementElem, 'Placeholder');

    songInfoContainerElem.append(titleElementElem, artistElementElem);

    if (!currentSettings.YTSongInfoDisableSeekbar) {
        const progressBarElem = document.createElement('div');
        progressBarElem.id = 'lyrics-song-progressbar';
        progressBarElem.classList.add('progress-container');
        songInfoContainerElem.appendChild(progressBarElem);
        progressBar = new WavyProgressBar(progressBarElem);

        progressBarElem.addEventListener('seek', (e) => {
            if (typeof e.detail?.progress === 'number' && currentSongDuration > 0) {
                window.postMessage({
                    type: 'LYPLUS_SEEK_TO',
                    time: e.detail.progress * currentSongDuration
                }, '*');
            }
        });

        new IntersectionObserver((entries) => {
            barVisible = entries[entries.length - 1].isIntersecting;
            syncProgressBar();
        }).observe(progressBarElem);

        const ytPlayer = document.querySelector('video');
        if (ytPlayer) {
            videoPlaying = !ytPlayer.paused;
            const opts = { passive: true };
            ytPlayer.addEventListener('play', () => { videoPlaying = true; syncProgressBar(); }, opts);
            ytPlayer.addEventListener('pause', () => { videoPlaying = false; syncProgressBar(); }, opts);
            ytPlayer.addEventListener('ended', () => { videoPlaying = false; syncProgressBar(); }, opts);
        }
        syncProgressBar();
    }

    player.appendChild(songInfoContainerElem);

    // Observe for layout changes
    marqueeResizeObserver.observe(titleElementElem);
    marqueeResizeObserver.observe(artistElementElem);
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

    patchTabRenderer();

    //patch ui
    if (currentSettings.YTSongInfo) injectSongInfo();
}

let ytTitleEl = null;
let ytBylineEl = null;
const TITLE_SEL = '.title.style-scope.ytmusic-player-bar, .ytmusicTrackInfoTitle';
const BYLINE_SEL = '.byline.style-scope.ytmusic-player-bar, .ytmusicTrackInfoByline';

window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data) return;

    if (data.type === 'LYPLUS_TIME_UPDATE' && typeof data.currentTime === 'number') {
        LyricsPlusAPI.updateCurrentTick(data.currentTime);

        if (progressBar && barVisible && !document.hidden && currentSettings.YTSongInfo) {
            const now = performance.now();
            if (now - lastUpdateTimestamp >= THROTTLE_MS) {
                lastUpdateTimestamp = now;
                progressBar.update(data.currentTime / currentSongDuration);
            }
        }
        return;
    }

    if (data.type === 'LYPLUS_SONG_CHANGED' && data.songInfo?.duration) {
        if (!currentSettings.YTSongInfo) return;

        const songInfo = data.songInfo;
        currentSongDuration = songInfo.duration;

        if (!ytTitleEl?.isConnected) ytTitleEl = document.querySelector(TITLE_SEL);
        if (!ytBylineEl?.isConnected) ytBylineEl = document.querySelector(BYLINE_SEL);

        let titleText = songInfo.title;
        let artistText = songInfo.album ? `${songInfo.artist} • ${songInfo.album}` : songInfo.artist;

        const ytTitle = ytTitleEl?.textContent.trim();
        if (ytTitle) {
            titleText = ytTitle;
            const ytByline = ytBylineEl?.textContent.trim();
            if (ytByline) artistText = ytByline;
        }

        updateTextWithMarquee(titleElementElem, titleText);
        updateTextWithMarquee(artistElementElem, artistText);
    }
});

// --- Fullscreen Cursor Auto-Hide ---
const CURSOR_IDLE_DELAY = 2000;
const FULLSCREEN_SELECTOR = [
    'ytmusic-app-layout[player-fullscreened]',
    'ytmusic-app-layout[player-ui-state="FULLSCREEN"]',
    'ytmusic-player-page[player-fullscreened]',
    '#layout[player-ui-state="FULLSCREEN"]'
].join(',');

let isFullscreen = false;
let cursorHidden = false;
let idleTimer = 0;
let lastActivity = 0;
let activityAbort = null;
let fsCheckQueued = false;

function computeFullscreen() {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.querySelector(FULLSCREEN_SELECTOR)
    );
}

function setCursorHidden(hidden) {
    if (cursorHidden === hidden) return;
    cursorHidden = hidden;
    document.documentElement.classList.toggle('lyplus-hide-cursor', hidden);
    document.body?.classList.toggle('lyplus-hide-cursor', hidden);
}

function checkIdle() {
    idleTimer = 0;
    const remaining = CURSOR_IDLE_DELAY - (performance.now() - lastActivity);
    if (remaining > 16) {
        idleTimer = setTimeout(checkIdle, remaining);
        return;
    }
    if (isFullscreen) setCursorHidden(true);
}

function onActivity() {
    lastActivity = performance.now();
    if (cursorHidden) setCursorHidden(false);
    if (!idleTimer) idleTimer = setTimeout(checkIdle, CURSOR_IDLE_DELAY);
}

function applyFullscreenState() {
    fsCheckQueued = false;
    const next = computeFullscreen();
    if (next === isFullscreen) return;
    isFullscreen = next;

    if (next) {
        activityAbort = new AbortController();
        const opts = { passive: true, signal: activityAbort.signal };
        window.addEventListener('pointermove', onActivity, opts);
        window.addEventListener('pointerdown', onActivity, opts);
        window.addEventListener('keydown', onActivity, opts);
        window.addEventListener('wheel', onActivity, opts);
        window.addEventListener('blur', () => setCursorHidden(false), opts);
        onActivity();
    } else {
        activityAbort?.abort();
        activityAbort = null;
        clearTimeout(idleTimer);
        idleTimer = 0;
        setCursorHidden(false);
    }
}

function queueFullscreenCheck() {
    if (fsCheckQueued) return;
    fsCheckQueued = true;
    requestAnimationFrame(applyFullscreenState);
}

function initFullscreenCursorManager() {
    document.addEventListener('fullscreenchange', queueFullscreenCheck, { passive: true });
    document.addEventListener('webkitfullscreenchange', queueFullscreenCheck, { passive: true });

    new MutationObserver(queueFullscreenCheck).observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ['player-fullscreened', 'player-ui-state']
    });

    applyFullscreenState();
}

initFullscreenCursorManager();