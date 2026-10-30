// src/modules/applemusic/index.js

if (typeof LYPLUS_setBgConfig === 'function') {
    LYPLUS_setBgConfig({
        dynamicPlayerSelectors: [
            'article[data-testid="lyrics-fullscreen-modal"]'
        ],
        blurContainerParentSelector: 'body',
        mutationObserverRootSelector: 'body',
        artworkSelector: '.lyrics__artwork-container picture img, .lyrics__artwork-container picture source'
    });
}

let lyricsRendererInstance = null;
let portalObserver = null;
let backdropObserver = null;
let observedBackdropEl = null;
let currentSongInfo = {};
let lastKnownTime = 0;
let injectionInterval = null;
let activeSurface = null;

const uiConfig = {
    player: '#apple-music-player',
    patchParent: '#lyplus-patch-container',
    selectors: [
        '#lyplus-patch-container',
        '[data-testid="modal"]',
        '[data-testid="lyrics-fullscreen-modal"]',
        '[data-testid="lyrics-sidebar"]'
    ],
    buttonParent: '[data-testid="lyrics-fullscreen-modal"]',
    disableNativeTick: true,
    getCurrentTime: () => lastKnownTime,
    isPlaying: () => {
        const audio = document.querySelector('#apple-music-player') || document.querySelector('audio, video');
        return audio ? (!audio.paused && !audio.ended) : false;
    },
    seekTo: (time) => {
        window.postMessage({ type: 'LYPLUS_SEEK_TO', time: time }, '*');
    }
};

function isSidebarSurface() {
    return activeSurface === 'sidebar' || (
        !document.querySelector('article[data-testid="lyrics-fullscreen-modal"]') &&
        !!document.querySelector('[data-testid="lyrics-sidebar"]')
    );
}

function getEffectiveSettings(settings) {
    const base = settings || (typeof currentSettings !== 'undefined' ? currentSettings : {});
    if (isSidebarSurface()) {
        return { ...base, relaxScroll: true };
    }
    return base;
}

function applySurfaceScrollMode(invalidateLayout = false) {
    if (!lyricsRendererInstance) return;
    const forceSidebarRelax = isSidebarSurface();
    if (typeof currentSettings !== 'undefined') {
        lyricsRendererInstance.currentSettings = forceSidebarRelax
            ? { ...currentSettings, relaxScroll: true }
            : currentSettings;
    }
    if (lyricsRendererInstance.lyricsContainer) {
        lyricsRendererInstance.lyricsContainer.style.display = 'block';
        const shouldRelax = forceSidebarRelax || !!(typeof currentSettings !== 'undefined' && currentSettings.relaxScroll);
        lyricsRendererInstance.lyricsContainer.classList.toggle('relax-scroll', shouldRelax);
    }
    if (invalidateLayout) {
        lyricsRendererInstance._containerDisplayCache = undefined;
        lyricsRendererInstance._scrollPaddingTopCache = undefined;
        lyricsRendererInstance._springConfigCache = null;
    }
}

function refreshScrollBindingAndPosition() {
    if (!lyricsRendererInstance || !lyricsRendererInstance.lyricsContainer) return;

    lyricsRendererInstance.lyricsContainer.style.display = 'block';
    lyricsRendererInstance._containerDisplayCache = undefined;
    lyricsRendererInstance._scrollPaddingTopCache = undefined;
    lyricsRendererInstance._springConfigCache = null;

    lyricsRendererInstance.scrollEventHandlerAttached = false;
    lyricsRendererInstance._attachScrollListeners();
    lyricsRendererInstance._setupContainerObserver();

    if (lyricsRendererInstance.visibilityObserver) {
        lyricsRendererInstance.visibilityObserver.disconnect();
    }
    lyricsRendererInstance.visibilityObserver = lyricsRendererInstance._setupVisibilityTracking();

    if (lyricsRendererInstance.resizeObserver) {
        lyricsRendererInstance.resizeObserver.disconnect();
    }
    lyricsRendererInstance._setupResizeObserver();

    requestAnimationFrame(() => {
        if (!lyricsRendererInstance || !lyricsRendererInstance.lyricsContainer) return;
        lyricsRendererInstance._containerDisplayCache = undefined;
        lyricsRendererInstance._scrollPaddingTopCache = undefined;
        const activeLine =
            lyricsRendererInstance.currentPrimaryActiveLine ||
            lyricsRendererInstance.cachedLyricsLines?.[0];
        if (activeLine) {
            lyricsRendererInstance._updatePositionClassesAndScroll(activeLine, true, 0);
            lyricsRendererInstance._scrollToActiveLine(activeLine, true, true, 0);
        }
    });
}

function injectDOMScript() {
    if (!pBrowser?.runtime?.getURL) {
        console.warn('APPLE MUSIC: runtime.getURL unavailable, skipping DOM script inject');
        return;
    }
    if (!document.documentElement?.hasAttribute('data-lyplus-optimizer-main-injected')) {
        document.documentElement?.setAttribute('data-lyplus-optimizer-main-injected', 'true');
        const optimizerScript = document.createElement('script');
        optimizerScript.src = pBrowser.runtime.getURL('src/modules/applemusic/appleUIOptimizer.js');
        optimizerScript.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(optimizerScript);
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
    if (!document.querySelector('link[data-lyrics-plus-platform-style]')) {
        const linkElement = document.createElement('link');
        linkElement.rel = 'stylesheet';
        linkElement.type = 'text/css';
        const browserAPI = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
        if (browserAPI?.runtime?.getURL) {
            linkElement.href = browserAPI.runtime.getURL('src/modules/applemusic/style.css');
            linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
            document.head.appendChild(linkElement);
        }
    }

    if (!document.getElementById('lyplus-applemusic-surface-patches')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'lyplus-applemusic-surface-patches';
        styleEl.textContent = `
            [data-testid="side-panel"]:has([data-testid="lyrics-sidebar"]) {
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                contain: strict !important;
            }
            [data-testid="side-panel"] .side-panel-content:has([data-testid="lyrics-sidebar"]) {
                position: relative !important;
                flex: 1 1 0% !important;
                width: 100% !important;
                height: 100% !important;
                max-height: 100% !important;
                min-height: 0 !important;
                overflow: hidden !important;
                display: flex !important;
                flex-direction: column !important;
                contain: strict !important;
            }
            [data-testid="lyrics-sidebar"] {
                --lyrics-scroll-padding-top: 25%;
                position: relative !important;
                flex: 1 1 0% !important;
                width: 100% !important;
                height: 100% !important;
                max-height: 100% !important;
                min-height: 0 !important;
                overflow: hidden !important;
                display: flex !important;
                flex-direction: column !important;
                contain: strict !important;
            }
            [data-testid="lyrics-sidebar"] [data-testid="lyrics-buttons-container"] {
                position: relative;
                z-index: 5;
                flex-shrink: 0;
            }
            [data-testid="lyrics-sidebar"] #lyplus-patch-container {
                --lyrics-scroll-padding-top: 25%;
                position: absolute !important;
                inset: 0 !important;
                grid-area: unset !important;
                width: 100% !important;
                height: 100% !important;
                max-height: 100% !important;
                min-height: 0 !important;
                overflow-y: scroll !important;
                overflow-x: hidden !important;
                scroll-padding-top: 25%;
                scroll-padding-block-start: 25%;
                overflow-anchor: none;
                scrollbar-width: none;
                will-change: scroll-position;
                scroll-snap-type: y proximity;
                contain: strict !important;
                mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%);
                -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 82%, transparent 100%);
            }
            [data-testid="lyrics-sidebar"] #lyrics-plus-container {
                position: relative;
                display: block !important;
                padding: 0 16px;
                padding-top: calc(1em + 25vh);
                --lyplus-font-size-base: 26px;
                contain: layout style;
            }
            [data-testid="lyrics-sidebar"] #lyrics-plus-container:not(.not-focused) .lyrics-line:not(.lyrics-gap):not(.active):has(~ .lyrics-line.lyrics-activest),
            [data-testid="lyrics-sidebar"] #lyrics-plus-container:not(.not-focused) .lyrics-line:not(.lyrics-gap):not(.active):has(~ .lyrics-plus-metadata.lyrics-activest) {
                opacity: 0.8 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(styleEl);
    }
};

const LyricsPlusAPI = {
    displayLyrics: (lyrics, songInfo, displayMode, settings, ...rest) => {
        const effectiveSettings = getEffectiveSettings(settings);
        const res = lyricsRendererInstance?.displayLyrics(lyrics, songInfo, displayMode, effectiveSettings, ...rest);
        applySurfaceScrollMode(true);
        refreshScrollBindingAndPosition();
        return res;
    },
    displaySongNotFound: () => lyricsRendererInstance?.displaySongNotFound(),
    displaySongError: () => lyricsRendererInstance?.displaySongError(),
    cleanupLyrics: () => lyricsRendererInstance?.cleanupLyrics(),
    updateDisplayMode: (lyrics, displayMode, settings) => {
        const effectiveSettings = getEffectiveSettings(settings);
        const res = lyricsRendererInstance?.updateDisplayMode(lyrics, displayMode, effectiveSettings);
        applySurfaceScrollMode(true);
        refreshScrollBindingAndPosition();
        return res;
    },
    updateCurrentTick: (currentTime, ...args) => {
        if (lyricsRendererInstance) {
            if (lyricsRendererInstance._containerDisplayCache !== 'block' && lyricsRendererInstance.lyricsContainer?.isConnected) {
                lyricsRendererInstance._containerDisplayCache = undefined;
            }
            if (!lyricsRendererInstance._scrollPaddingTopCache) {
                lyricsRendererInstance._scrollPaddingTopCache = undefined;
            }
        }
        return lyricsRendererInstance?.updateCurrentTick(currentTime, ...args);
    },
    setPlaybackState: (...args) => lyricsRendererInstance?.setPlaybackState(...args),
    setTranslationLoading: (...args) => lyricsRendererInstance?.setTranslationLoading(...args),
    showToast: (...args) => lyricsRendererInstance?.showToast(...args),
    setUserOffset: (...args) => lyricsRendererInstance?.setUserOffset(...args),
    setAvailableProviders: (...args) => lyricsRendererInstance?.setAvailableProviders(...args)
};

function resolveArtworkUrlFromDOM() {
    if (currentSongInfo?.artwork) return currentSongInfo.artwork;

    const sourceEl = document.querySelector(
        'article[data-testid="lyrics-fullscreen-modal"] .lyrics__artwork-container picture source[srcset], ' +
        'article[data-testid="lyrics-fullscreen-modal"] .lyrics__artwork-radiosity picture source[srcset]'
    );
    if (sourceEl) {
        const srcset = sourceEl.getAttribute('srcset') || '';
        const candidates = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
        if (candidates.length > 0) {
            return candidates[candidates.length - 1];
        }
    }

    const imgEl = document.querySelector('article[data-testid="lyrics-fullscreen-modal"] .lyrics__artwork-container img');
    if (imgEl && imgEl.src && !imgEl.src.endsWith('/1x1.gif')) {
        return imgEl.src;
    }

    return null;
}

function neutralizeAppleDefaultCanvas(root = document) {
    const nativeCanvases = root.querySelectorAll(
        '[data-testid="now-playing-backdrop"] canvas:not(#lyplus-webgl-canvas), ' +
        '.dt-lyrics__platter canvas:not(#lyplus-webgl-canvas), ' +
        'article[data-testid="lyrics-fullscreen-modal"] canvas:not(#lyplus-webgl-canvas)'
    );

    nativeCanvases.forEach((canvas) => {
        if (canvas.width !== 1) canvas.width = 1;
        if (canvas.height !== 1) canvas.height = 1;

        if (!canvas.hasAttribute('data-lyplus-throttled')) {
            canvas.setAttribute('data-lyplus-throttled', 'true');
            canvas.style.setProperty('width', '1px', 'important');
            canvas.style.setProperty('height', '1px', 'important');
            canvas.style.setProperty('opacity', '0', 'important');
            canvas.style.setProperty('visibility', 'hidden', 'important');
            canvas.style.setProperty('pointer-events', 'none', 'important');
        }
    });

    window.postMessage({ type: 'LYPLUS_THROTTLE_APPLE_CANVAS' }, '*');
}

function parkYouLyBlurContainer() {
    if (backdropObserver) {
        backdropObserver.disconnect();
        backdropObserver = null;
    }
    observedBackdropEl = null;

    // Stop the WebGL animation loop when the fullscreen modal is closed
    try {
        if (typeof globalAnimationId !== 'undefined' && globalAnimationId) {
            cancelAnimationFrame(globalAnimationId);
            globalAnimationId = null;
        }
    } catch (_) {}

    const blurContainer = document.querySelector('.lyplus-blur-container');
    if (blurContainer && blurContainer.parentElement !== document.body && document.body) {
        document.body.prepend(blurContainer);
    }
}

function overrideAppleCanvasWithYouLy() {
    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    if (!lyricsArticle || !lyricsArticle.isConnected) return;

    neutralizeAppleDefaultCanvas(lyricsArticle);

    const backdrop = lyricsArticle.querySelector('[data-testid="now-playing-backdrop"], .dt-lyrics__platter') || lyricsArticle;

    if (observedBackdropEl !== lyricsArticle) {
        if (backdropObserver) backdropObserver.disconnect();
        observedBackdropEl = lyricsArticle;

        backdropObserver = new MutationObserver((mutations) => {
            if (!lyricsArticle.isConnected) {
                parkYouLyBlurContainer();
                return;
            }

            let needsThrottle = false;
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    if (
                        target.tagName === 'CANVAS' &&
                        target.id !== 'lyplus-webgl-canvas' &&
                        (target.width !== 1 || target.height !== 1)
                    ) {
                        needsThrottle = true;
                    }
                } else if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (
                            (node.tagName === 'CANVAS' && node.id !== 'lyplus-webgl-canvas') ||
                            node.querySelector?.('canvas:not(#lyplus-webgl-canvas)')
                        ) {
                            needsThrottle = true;
                        }
                    }
                }
            }

            if (needsThrottle) {
                neutralizeAppleDefaultCanvas(lyricsArticle);
            }

            if (backdrop.isConnected && !backdrop.querySelector('.lyplus-blur-container')) {
                mountYouLyBlurContainer(backdrop);
            }
        });

        backdropObserver.observe(lyricsArticle, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['width', 'height']
        });

        const closeBtn = lyricsArticle.querySelector('[data-testid="lyrics-fullscreen-modal-close-button"]');
        if (closeBtn && !closeBtn.hasAttribute('data-lyplus-close-hooked')) {
            closeBtn.setAttribute('data-lyplus-close-hooked', 'true');
            closeBtn.addEventListener('click', () => {
                parkYouLyBlurContainer();
            }, { passive: true });
        }
    }

    mountYouLyBlurContainer(backdrop);
}

function mountYouLyBlurContainer(backdrop) {
    if (!backdrop || !backdrop.isConnected) return;

    if (typeof LYPLUS_setupBlurEffect === 'function') {
        let blurContainer = document.querySelector('.lyplus-blur-container');
        if (!blurContainer || !document.getElementById('lyplus-webgl-canvas')) {
            blurContainer = LYPLUS_setupBlurEffect();
        }
        if (blurContainer && !backdrop.contains(blurContainer)) {
            backdrop.prepend(blurContainer);
        }
    }

    const artworkUrl = resolveArtworkUrlFromDOM();
    if (artworkUrl) {
        if (typeof LYPLUS_requestProcessNewArtwork === 'function') {
            LYPLUS_requestProcessNewArtwork(artworkUrl);
        } else {
            window.postMessage({
                type: 'LYPLUS_updateFullScreenAnimatedBg',
                artworkUrl
            }, '*');
        }
    }
}

function disableNativeSidebarLyrics(sidebarEl) {
    if (!sidebarEl) return;
    const ampLyrics = sidebarEl.querySelector('amp-lyrics');
    if (ampLyrics && !ampLyrics.hasAttribute('data-lyplus-disabled')) {
        ampLyrics.setAttribute('data-lyplus-disabled', 'true');
        ampLyrics.setAttribute('static-lyrics', 'true');
        ampLyrics.removeAttribute('visible');
        ampLyrics.removeAttribute('catalog-id');
        ampLyrics.style.setProperty('display', 'none', 'important');
        if (ampLyrics.shadowRoot) {
            ampLyrics.shadowRoot.innerHTML = '';
        }
    }
}

function mountLyricsIntoTarget(targetEl, surfaceType) {
    const surfaceChanged = activeSurface !== surfaceType;
    activeSurface = surfaceType;

    uiConfig.buttonParent = surfaceType === 'modal'
        ? '[data-testid="lyrics-fullscreen-modal"]'
        : '[data-testid="lyrics-sidebar"]';

    let patchWrapper = document.getElementById('lyplus-patch-container');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';
    }

    const wrapperMoved = patchWrapper.parentElement !== targetEl;
    if (wrapperMoved) {
        targetEl.appendChild(patchWrapper);
    }

    const buttonsWrapper = document.getElementById('lyrics-plus-buttons-wrapper');
    if (buttonsWrapper && buttonsWrapper.parentElement !== targetEl) {
        targetEl.appendChild(buttonsWrapper);
    }

    const isInitialInstance = !lyricsRendererInstance;
    if (isInitialInstance) {
        lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
    }
    lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
    lyricsRendererInstance.uiConfig.buttonParent = uiConfig.buttonParent;

    const existingContainer = document.getElementById('lyrics-plus-container');
    const hasRenderedLines = !!(lyricsRendererInstance.cachedLyricsLines && lyricsRendererInstance.cachedLyricsLines.length > 0);
    const needsMountOrFetch =
        isInitialInstance ||
        surfaceChanged ||
        wrapperMoved ||
        !existingContainer ||
        !patchWrapper.contains(existingContainer) ||
        !hasRenderedLines;

    if (needsMountOrFetch) {
        const canReuse =
            !isInitialInstance &&
            hasRenderedLines &&
            lyricsRendererInstance.lyricsContainer &&
            lyricsRendererInstance.lastKnownSongInfo &&
            currentSongInfo &&
            lyricsRendererInstance.lastKnownSongInfo.title === currentSongInfo.title &&
            lyricsRendererInstance.lastKnownSongInfo.artist === currentSongInfo.artist &&
            lyricsRendererInstance.lastKnownSongInfo.album === currentSongInfo.album;

        if (canReuse) {
            if (!patchWrapper.contains(lyricsRendererInstance.lyricsContainer)) {
                patchWrapper.appendChild(lyricsRendererInstance.lyricsContainer);
            }
            applySurfaceScrollMode(true);
            lyricsRendererInstance.restore();
            refreshScrollBindingAndPosition();
        } else if (currentSongInfo && currentSongInfo.title && typeof fetchAndDisplayLyrics === 'function') {
            if (!patchWrapper.contains(lyricsRendererInstance.lyricsContainer)) {
                lyricsRendererInstance.lyricsContainer = null;
            }
            applySurfaceScrollMode(true);
            fetchAndDisplayLyrics(currentSongInfo, false);
        }
    }

    if (surfaceType === 'modal') {
        injectShowHideButton();
        disableNativeLyrics();
    }
}

function tryInject() {
    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    const lyricsSidebar = document.querySelector('[data-testid="lyrics-sidebar"]');

    if (lyricsArticle && lyricsArticle.isConnected) {
        document.body?.classList.add('lyplus-fullscreen-modal-open');
        document.body?.classList.remove('lyplus-sidebar-open');
        overrideAppleCanvasWithYouLy();
        mountLyricsIntoTarget(lyricsArticle, 'modal');
    } else if (lyricsSidebar && lyricsSidebar.isConnected) {
        document.body?.classList.remove('lyplus-fullscreen-modal-open');
        document.body?.classList.add('lyplus-sidebar-open');
        parkYouLyBlurContainer();
        disableNativeSidebarLyrics(lyricsSidebar);
        mountLyricsIntoTarget(lyricsSidebar, 'sidebar');
    } else {
        document.body?.classList.remove('lyplus-fullscreen-modal-open', 'lyplus-sidebar-open');
        activeSurface = null;
        parkYouLyBlurContainer();
    }
}

function startInjectionWatcher() {
    if (injectionInterval) clearInterval(injectionInterval);

    injectionInterval = setInterval(() => {
        if (document.hidden) return;
        const modalExists = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
        const sidebarExists = document.querySelector('[data-testid="lyrics-sidebar"]');

        if (modalExists || sidebarExists) {
            tryInject();
        } else if (activeSurface !== null) {
            activeSurface = null;
            parkYouLyBlurContainer();
        }
    }, 1500);
}

function injectShowHideButton(retryCount = 0) {
    if (document.getElementById('lyrics-plus-show-hide-btn')) return;

    const lyricsArticle = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    if (!lyricsArticle) return;

    const buttonsWrapper = document.getElementById('lyrics-plus-buttons-wrapper');

    if (!buttonsWrapper) {
        if (retryCount > 60) {
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
    const lyricsToggleBtn = document.querySelector('article.lyrics__container[data-testid="lyrics-fullscreen-modal"] .toggle-button.toggle-button--lyrics.lyrics-button');

    if (lyricsArticle && lyricsToggleBtn) {
        const isNativeLyricsVisible = !lyricsArticle.classList.contains('is-lyrics-off');

        if (isNativeLyricsVisible) {
            lyricsToggleBtn.click();
        }
    }
}

function setupObservers() {
    const portal = document.body;
    if (portal) {
        portalObserver = new MutationObserver((mutations) => {
            let shouldCheck = false;

            for (const mutation of mutations) {
                if (mutation.type !== 'childList') continue;

                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (
                            node.matches?.('[data-testid="modal"], article[data-testid="lyrics-fullscreen-modal"], [data-testid="side-panel"], [data-testid="lyrics-sidebar"]') ||
                            node.querySelector?.('article[data-testid="lyrics-fullscreen-modal"], [data-testid="lyrics-sidebar"]')
                        ) {
                            shouldCheck = true;
                        }
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1) {
                        if (
                            node.matches?.('[data-testid="modal"], article[data-testid="lyrics-fullscreen-modal"], [data-testid="side-panel"], [data-testid="lyrics-sidebar"]') ||
                            node.querySelector?.('article[data-testid="lyrics-fullscreen-modal"], [data-testid="lyrics-sidebar"]')
                        ) {
                            shouldCheck = true;
                        }
                    }
                }
            }

            if (shouldCheck) {
                tryInject();
                if (
                    !document.querySelector('article[data-testid="lyrics-fullscreen-modal"]') &&
                    !document.querySelector('[data-testid="lyrics-sidebar"]')
                ) {
                    activeSurface = null;
                    parkYouLyBlurContainer();
                }
            }
        });
        portalObserver.observe(portal, { childList: true, subtree: true });
    } else {
        setTimeout(setupObservers, 1000);
    }

    document.addEventListener('click', (e) => {
        if (e.target?.closest?.('[data-testid="lyrics-button"], [data-testid="lyrics-fullscreen-button"], .toggle-button--lyrics')) {
            setTimeout(tryInject, 100);
        }
    }, { passive: true });

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
        lastKnownTime = event.data.currentTime;
        LyricsPlusAPI.updateCurrentTick(event.data.currentTime);
    }

    if (event.data.type === 'LYPLUS_PLAYBACK_STATE' && typeof event.data.isPlaying === 'boolean') {
        LyricsPlusAPI.setPlaybackState(event.data.isPlaying);
    }

    if (event.data.type === 'LYPLUS_SONG_CHANGED') {
        currentSongInfo = event.data.songInfo;
        lastKnownTime = 0;
        if (document.querySelector('article[data-testid="lyrics-fullscreen-modal"]')) {
            const artworkUrl = currentSongInfo?.artwork || resolveArtworkUrlFromDOM();
            if (artworkUrl) {
                if (typeof LYPLUS_requestProcessNewArtwork === 'function') {
                    LYPLUS_requestProcessNewArtwork(artworkUrl);
                } else {
                    window.postMessage({
                        type: 'LYPLUS_updateFullScreenAnimatedBg',
                        artworkUrl
                    }, '*');
                }
            }
        }
    }
});