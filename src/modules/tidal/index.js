if (typeof LYPLUS_setBgConfig === 'function') {
    LYPLUS_setBgConfig({
        dynamicPlayerSelectors: ['#wimp'],
        blurContainerParentSelector: '#wimp [data-test="new-now-playing"]',
        mutationObserverRootSelector: '#wimp',
        artworkSelector: '[data-test="current-media-imagery"] img'
    });
}

let lyricsRendererInstance = null;
let pendingSongInfo = null;
let pendingCheckCount = 0;

const LyricsPlusAPI = {
    displayLyrics: (...args) => lyricsRendererInstance?.displayLyrics(...args),
    displaySongNotFound: () => lyricsRendererInstance?.displaySongNotFound(),
    displaySongError: () => lyricsRendererInstance?.displaySongError(),
    cleanupLyrics: () => lyricsRendererInstance?.cleanupLyrics(),
    updateDisplayMode: (...args) => lyricsRendererInstance?.updateDisplayMode(...args),
    setTranslationLoading: (...args) => lyricsRendererInstance?.setTranslationLoading(...args)
};

function injectPlatformCSS() {
    if (document.querySelector('link[data-lyrics-plus-platform-style]')) return;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    const pBrowser = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (!pBrowser?.runtime?.getURL) {
        console.warn('Tidal: runtime.getURL unavailable, skipping CSS inject');
        return;
    }
    linkElement.href = pBrowser.runtime.getURL('src/modules/tidal/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
}

function injectDOMScript() {
    const pBrowser = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (!pBrowser?.runtime?.getURL) {
        console.warn('TIDAL: runtime.getURL unavailable, skipping DOM script inject');
        return;
    }
    const script = document.createElement('script');
    script.src = pBrowser.runtime.getURL('src/inject/tidal/songTracker.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);

    const parser = document.createElement('script');
    parser.src = pBrowser.runtime.getURL('src/lib/parser.js');
    parser.type = 'module';
    parser.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(parser);
}

// --- Detect which UI version is active ---
function isNewUI() {
    return !!document.querySelector('[data-test="toggle-lyrics"]');
}

// ============================================================
// NEW UI: Button-toggle based now-playing panel (2024+)
// ============================================================

// --- Inject once: CSS that hides native lyrics content and shows our container ---
function injectHiderCSS() {
    if (document.getElementById('lyplus-hider-css')) return;
    const style = document.createElement('style');
    style.id = 'lyplus-hider-css';
    style.textContent = `
        body.lyplus-active [data-test="now-playing-lyrics"] > :not(#lyplus-patch-container) {
            display: none !important;
        }
        body.lyplus-active #lyplus-patch-container {
            display: block !important;
        }
        #lyplus-patch-container {
            display: none;
            width: 100%;
            height: 100%;
            overflow-y: auto;
        }
    `;
    document.head.appendChild(style);
}

// --- Inject our custom lyrics button once ---
function ensureCustomButton(nativeLyricsBtn, buttonsContainer) {
    if (document.getElementById('lyrics-plus-btn')) return;

    const customBtn = document.createElement('button');
    customBtn.id = 'lyrics-plus-btn';
    customBtn.setAttribute('type', 'button');
    customBtn.innerHTML = nativeLyricsBtn.innerHTML;
    buttonsContainer.insertBefore(customBtn, nativeLyricsBtn);

    customBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nativeLyricsBtn.click();
    });
}

function syncCustomButtonState(nativeLyricsBtn, buttonsContainer) {
    const customBtn = document.getElementById('lyrics-plus-btn');
    if (!customBtn) return;

    const siblingButtons = Array.from(buttonsContainer.querySelectorAll('button:not(#lyrics-plus-btn)'));
    let activeClass = '';
    let inactiveClass = '';
    let baseClasses = [];

    siblingButtons.forEach(btn => {
        Array.from(btn.classList).forEach(c => {
            if (c.toLowerCase().includes('primary') || c.toLowerCase().includes('active')) activeClass = c;
            if (c.toLowerCase().includes('secondary') || c.toLowerCase().includes('inactive')) inactiveClass = c;
        });
    });

    const refBtn = siblingButtons[0];
    if (refBtn) {
        baseClasses = Array.from(refBtn.classList).filter(c => c !== activeClass && c !== inactiveClass);
    }

    const isNativeActive = nativeLyricsBtn.getAttribute('aria-pressed') === 'true';
    customBtn.className = baseClasses.join(' ');

    if (isNativeActive && activeClass) {
        customBtn.classList.add(activeClass);
        customBtn.setAttribute('aria-pressed', 'true');
        document.body.classList.add('lyplus-active');
    } else {
        if (inactiveClass) customBtn.classList.add(inactiveClass);
        customBtn.setAttribute('aria-pressed', 'false');
        document.body.classList.remove('lyplus-active');
    }
}
function ensureLyricsPatchContainer() {
    // [data-test="now-playing-lyrics"] only exists in the DOM while lyrics tab is active
    const lyricsPanel = document.querySelector('[data-test="now-playing-lyrics"]');
    if (!lyricsPanel) return;

    let patchWrapper = document.getElementById('lyplus-patch-container');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';
    }

    if (!lyricsPanel.contains(patchWrapper)) {
        lyricsPanel.appendChild(patchWrapper);
    }

    // Init renderer once
    if (!lyricsRendererInstance && typeof LyricsPlusRenderer !== 'undefined') {
        const uiConfig = {
            player: 'video#video-one',
            patchParent: '#lyplus-patch-container',
            selectors: ['#lyplus-patch-container'],
            buttonParent: '#nowPlaying [class*="actionButtons"], #nowPlaying [class*="buttons"]',
        };
        lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
    }

    // Fetch lyrics if the panel is open and we don't have lyrics yet
    if (
        lyricsRendererInstance &&
        !lyricsRendererInstance.lyricsContainer &&
        LYPLUS_currentSong?.title &&
        typeof fetchAndDisplayLyrics === 'function'
    ) {
        fetchAndDisplayLyrics(LYPLUS_currentSong, true);
    }
}

function ensureLyricsNewUI() {
    const nowPlaying = document.getElementById('nowPlaying');
    if (!nowPlaying) return;

    const nativeLyricsBtn = nowPlaying.querySelector('[data-test="toggle-lyrics"]');
    if (!nativeLyricsBtn) return;

    const buttonsContainer = nativeLyricsBtn.parentElement;
    if (!buttonsContainer) return;

    injectHiderCSS();

    nativeLyricsBtn.style.display = 'none';

    ensureCustomButton(nativeLyricsBtn, buttonsContainer);

    syncCustomButtonState(nativeLyricsBtn, buttonsContainer);

    if (!nativeLyricsBtn.hasAttribute('data-lyplus-observed')) {
        nativeLyricsBtn.setAttribute('data-lyplus-observed', 'true');

        const nativeBtnObserver = new MutationObserver(() => {
            syncCustomButtonState(nativeLyricsBtn, buttonsContainer);

            if (nativeLyricsBtn.getAttribute('aria-pressed') === 'true') {
                // Panel is now active — mount our container once it appears in DOM
                // (slight delay to let Tidal's React render the panel element)
                setTimeout(() => ensureLyricsPatchContainer(), 100);
            }
        });
        nativeBtnObserver.observe(nativeLyricsBtn, {
            attributes: true,
            attributeFilter: ['aria-pressed', 'aria-disabled', 'class']
        });
    }

    if (nativeLyricsBtn.getAttribute('aria-pressed') === 'true') {
        ensureLyricsPatchContainer();
    }
}


// ============================================================
// OLD UI: tablist-based now-playing panel (legacy)
// ============================================================
function ensureLyricsTab() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;

    const panelContainer = tablist.parentNode;
    if (!panelContainer) return;

    const originalLyricsTab = tablist.querySelector('[data-test="tabs-lyrics"]');
    if (originalLyricsTab) {
        originalLyricsTab.style.display = 'none';
    }

    let customLyricsTab = document.getElementById('lyrics-plus-tab');
    if (!customLyricsTab) {
        customLyricsTab = document.createElement('li');
        const sibling = tablist.querySelector('[role="tab"]:not(#lyrics-plus-tab)');
        customLyricsTab.className = sibling
            ? sibling.className.replace(/\s*\S*active\S*/gi, '').trim()
            : '';
        customLyricsTab.dataset.test = 'tabs-lyrics-plus';
        customLyricsTab.id = 'lyrics-plus-tab';
        customLyricsTab.setAttribute('role', 'tab');
        customLyricsTab.setAttribute('aria-selected', 'false');
        customLyricsTab.setAttribute('aria-disabled', 'false');
        customLyricsTab.setAttribute('data-rttab', 'true');
        customLyricsTab.innerHTML = `<svg class="_icon_77f3f89" viewBox="0 0 20 20"><use href="#general__lyrics"></use></svg><span data-wave-color="textDefault" class="wave-text-description-demi">Lyrics</span>`;

        customLyricsTab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (customLyricsTab.getAttribute('aria-selected') === 'true') return;

            const currentTablist = document.querySelector('[role="tablist"]');
            const activeClass = (() => {
                const activeTab = currentTablist?.querySelector('[role="tab"][aria-selected="true"]');
                if (!activeTab) return null;
                return Array.from(activeTab.classList).find(c => c.toLowerCase().includes('active'));
            })();

            if (currentTablist) {
                currentTablist.querySelectorAll('[role="tab"]').forEach(tab => {
                    tab.setAttribute('aria-selected', 'false');
                    if (activeClass) tab.classList.remove(activeClass);
                });
            }

            const currentPanelContainer = currentTablist ? currentTablist.parentNode : null;
            if (currentPanelContainer) {
                currentPanelContainer.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
                    panel.style.display = 'none';
                    panel.classList.remove('react-tabs__tab-panel--selected');
                });
            }

            customLyricsTab.setAttribute('aria-selected', 'true');
            if (activeClass) customLyricsTab.classList.add(activeClass);

            const currentLyricsPanel = document.getElementById('lyrics-plus-panel');
            if (currentLyricsPanel) {
                currentLyricsPanel.style.display = 'block';
                currentLyricsPanel.classList.add('react-tabs__tab-panel--selected');
            }
        });
    }

    if (!tablist.contains(customLyricsTab)) {
        tablist.appendChild(customLyricsTab);
    }

    let lyricsPanel = document.getElementById('lyrics-plus-panel');
    if (!lyricsPanel) {
        const firstPanel = panelContainer.querySelector('div[role="tabpanel"]:not(#lyrics-plus-panel)');
        lyricsPanel = document.createElement('div');
        lyricsPanel.id = 'lyrics-plus-panel';
        lyricsPanel.className = firstPanel ? firstPanel.className : '';
        lyricsPanel.setAttribute('role', 'tabpanel');
        lyricsPanel.style.display = 'none';
        lyricsPanel.setAttribute('aria-labelledby', 'lyrics-plus-tab');
    }

    if (!panelContainer.contains(lyricsPanel)) {
        panelContainer.appendChild(lyricsPanel);
    }

    customLyricsTab.setAttribute('aria-controls', 'lyrics-plus-panel');

    let patchWrapper = document.getElementById('lyplus-patch-container');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';
    }

    if (!lyricsPanel.contains(patchWrapper)) {
        lyricsPanel.appendChild(patchWrapper);
    }

    if (!document.getElementById('lyrics-plus-container')) {
        if (!lyricsRendererInstance) {
            const uiConfig = {
                player: 'video#video-one',
                patchParent: '#lyplus-patch-container',
                selectors: ['#lyplus-patch-container', '#lyrics-plus-panel'],
                buttonParent: '#lyrics-plus-panel',
            };
            if (typeof LyricsPlusRenderer !== 'undefined') {
                lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
            }
        } else {
            const canReuse = lyricsRendererInstance.lyricsContainer &&
                lyricsRendererInstance.lastKnownSongInfo &&
                LYPLUS_currentSong &&
                lyricsRendererInstance.lastKnownSongInfo.title === LYPLUS_currentSong.title &&
                lyricsRendererInstance.lastKnownSongInfo.artist === LYPLUS_currentSong.artist;

            if (canReuse) {
                patchWrapper.appendChild(lyricsRendererInstance.lyricsContainer);
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.restore();
            } else {
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.lyricsContainer = null;
                if (LYPLUS_currentSong?.title && typeof fetchAndDisplayLyrics === 'function') {
                    fetchAndDisplayLyrics(LYPLUS_currentSong, true);
                }
            }
        }
    }

    if (
        lyricsRendererInstance &&
        !lyricsRendererInstance.lyricsContainer &&
        LYPLUS_currentSong?.title &&
        typeof fetchAndDisplayLyrics === 'function'
    ) {
        fetchAndDisplayLyrics(LYPLUS_currentSong, true);
    }

    tablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(tab => {
        if (!tab.hasAttribute('data-lyrics-plus-listener')) {
            tab.setAttribute('data-lyrics-plus-listener', 'true');
            tab.addEventListener('click', () => {
                setTimeout(() => {
                    const lTab = document.getElementById('lyrics-plus-tab');
                    const lPanel = document.getElementById('lyrics-plus-panel');
                    const activeClass = (() => {
                        const currentTablist2 = document.querySelector('[role="tablist"]');
                        const activeTab = currentTablist2?.querySelector('[role="tab"][aria-selected="true"]');
                        if (!activeTab) return null;
                        return Array.from(activeTab.classList).find(c => c.toLowerCase().includes('active'));
                    })();

                    if (lTab) {
                        lTab.setAttribute('aria-selected', 'false');
                        if (activeClass) lTab.classList.remove(activeClass);
                    }
                    if (lPanel) {
                        lPanel.style.display = 'none';
                        lPanel.classList.remove('react-tabs__tab-panel--selected');
                    }

                    const currentTablist = document.querySelector('[role="tablist"]');
                    if (currentTablist) {
                        currentTablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(t => {
                            t.setAttribute('aria-selected', 'false');
                            if (activeClass) t.classList.remove(activeClass);
                        });
                    }

                    if (currentTablist?.parentNode) {
                        currentTablist.parentNode.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
                            panel.style.display = '';
                            panel.classList.remove('react-tabs__tab-panel--selected');
                        });
                    }

                    tab.setAttribute('aria-selected', 'true');
                    if (activeClass) tab.classList.add(activeClass);

                    const panelId = tab.getAttribute('aria-controls');
                    if (panelId) {
                        const targetPanel = document.getElementById(panelId);
                        if (targetPanel) {
                            targetPanel.style.display = '';
                            targetPanel.classList.add('react-tabs__tab-panel--selected');
                        }
                    }
                }, 10);
            });
        }
    });

    if (customLyricsTab.getAttribute('aria-selected') === 'true') {
        lyricsPanel.style.display = 'block';
    }
}

function ensureLyricsUI() {
    if (isNewUI()) {
        ensureLyricsNewUI();
    } else {
        ensureLyricsTab();
    }
}

const uiObserver = new MutationObserver((mutations) => {
    let shouldCheckUI = false;
    let shouldCheckPanel = false;

    mutations.forEach(mutation => {
        if (mutation.type !== 'childList') return;
        Array.from(mutation.addedNodes).forEach(node => {
            if (node.nodeType !== 1) return;

            if (
                node.querySelector?.('[role="tablist"]') ||
                node.querySelector?.('[data-test="toggle-lyrics"]') ||
                node.querySelector?.('[class*="panelWrapper"]') ||
                node.matches?.('[role="tablist"]') ||
                node.matches?.('[data-test="toggle-lyrics"]')
            ) {
                shouldCheckUI = true;
            }

            if (
                node.matches?.('[data-test="now-playing-lyrics"]') ||
                node.querySelector?.('[data-test="now-playing-lyrics"]')
            ) {
                shouldCheckPanel = true;
            }
        });
    });

    if (shouldCheckUI) setTimeout(ensureLyricsUI, 50);
    if (shouldCheckPanel) setTimeout(ensureLyricsPatchContainer, 50);
});

function startUiObserver() {
    const appRoot = document.getElementById('wimp') || document.body;
    if (appRoot) {
        uiObserver.observe(appRoot, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
        setTimeout(ensureLyricsUI, 500);
    } else {
        setTimeout(startUiObserver, 1000);
    }
}

// --- INITIALIZATION ---
function initialize() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
        return;
    }

    injectPlatformCSS();
    injectDOMScript();
    startUiObserver();
}

let LYPLUS_currentSong = null;

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'LYPLUS_SONG_CHANGED') {
        LYPLUS_currentSong = event.data.songInfo;

        const nativeLyricsBtn = document.querySelector('#nowPlaying [data-test="toggle-lyrics"]');
        if (nativeLyricsBtn?.getAttribute('aria-pressed') === 'true') {
            if (lyricsRendererInstance) {
                lyricsRendererInstance.lyricsContainer = null;
            }
            setTimeout(() => ensureLyricsPatchContainer(), 100);
        }
    }
});

initialize();