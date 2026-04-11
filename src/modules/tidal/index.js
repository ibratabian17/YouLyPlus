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
function ensureLyricsNewUI() {
    const nowPlaying = document.getElementById('nowPlaying');
    if (!nowPlaying) return;

    const lyricsBtn = nowPlaying.querySelector('[data-test="toggle-lyrics"]');
    if (!lyricsBtn) return;

    const buttonsContainer = lyricsBtn.parentElement;
    if (!buttonsContainer) return;

    // Find the panel wrapper — use attribute selector to survive class renames
    const panelWrapper = nowPlaying.querySelector('[class*="panelWrapper"]');
    if (!panelWrapper) return;

    // --- Hide native lyrics button and replace with our own ---
    lyricsBtn.style.display = 'none';

    let customBtn = document.getElementById('lyrics-plus-btn');
    if (!customBtn) {
        customBtn = document.createElement('button');
        customBtn.id = 'lyrics-plus-btn';
        // Copy classes from a sibling to survive updates, strip active/primary markers
        const siblingBtn = buttonsContainer.querySelector('button:not(#lyrics-plus-btn)');
        customBtn.className = siblingBtn
            ? siblingBtn.className.replace(/\b\w*primary\w*\b/gi, '').trim()
            : '';
        customBtn.setAttribute('type', 'button');
        customBtn.setAttribute('aria-pressed', 'false');
        customBtn.innerHTML = `<span>Lyrics</span>`;

        buttonsContainer.insertBefore(customBtn, lyricsBtn);

        customBtn.addEventListener('click', () => {
            activateLyricsPlusPanel(nowPlaying, buttonsContainer, panelWrapper, customBtn);
        });
    }

    // --- Create our patch container inside the panel content ---
    let patchWrapper = document.getElementById('lyplus-patch-container');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';

        // Try to put it inside the panel's inner content div
        const panelContent = panelWrapper.querySelector('[class*="panelContent"]')
            || panelWrapper.querySelector('[class*="wrapper"]')
            || panelWrapper;
        panelContent.appendChild(patchWrapper);
    }

    // --- Init renderer if needed ---
    if (!lyricsRendererInstance && typeof LyricsPlusRenderer !== 'undefined') {
        const uiConfig = {
            player: 'video#video-one',
            patchParent: '#lyplus-patch-container',
            selectors: ['#lyplus-patch-container'],
            buttonParent: '#nowPlaying [class*="actionButtons"], #nowPlaying [class*="buttons"]',
        };
        lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
    }

    // --- Wire up native buttons to hide our panel ---
    buttonsContainer.querySelectorAll('button:not(#lyrics-plus-btn)').forEach(btn => {
        if (!btn.hasAttribute('data-lyplus-listener')) {
            btn.setAttribute('data-lyplus-listener', 'true');
            btn.addEventListener('click', () => {
                deactivateLyricsPlusPanel(nowPlaying, panelWrapper, customBtn);
            });
        }
    });

    // If our button was previously active, re-show the panel
    if (customBtn.getAttribute('aria-pressed') === 'true') {
        activateLyricsPlusPanel(nowPlaying, buttonsContainer, panelWrapper, customBtn);
    }

    // Fetch lyrics if we have a current song and nothing is displayed
    if (
        lyricsRendererInstance &&
        !lyricsRendererInstance.lyricsContainer &&
        LYPLUS_currentSong?.title &&
        typeof fetchAndDisplayLyrics === 'function'
    ) {
        fetchAndDisplayLyrics(LYPLUS_currentSong, true);
    }

    console.log('LYPLUS: New UI lyrics panel verified');
}

function activateLyricsPlusPanel(nowPlaying, buttonsContainer, panelWrapper, customBtn) {
    // Detect the "primary"/"active" class from the currently pressed button
    const primaryClass = getPrimaryClass(buttonsContainer);

    // Deactivate all native buttons
    buttonsContainer.querySelectorAll('button:not(#lyrics-plus-btn)').forEach(b => {
        b.setAttribute('aria-pressed', 'false');
        if (primaryClass) b.classList.remove(primaryClass);
    });

    // Activate ours
    customBtn.setAttribute('aria-pressed', 'true');
    if (primaryClass) customBtn.classList.add(primaryClass);

    // Hide native lyrics content, show ours
    const nativeLyrics = nowPlaying.querySelector('[data-test="now-playing-lyrics"]');
    if (nativeLyrics) nativeLyrics.style.display = 'none';

    const patchWrapper = document.getElementById('lyplus-patch-container');
    if (patchWrapper) patchWrapper.style.display = 'block';

    // Activate panel wrapper if it has an active class mechanism
    const activeClass = getActiveClass(panelWrapper);
    if (activeClass) panelWrapper.classList.add(activeClass);

    console.log('LYPLUS: Lyrics+ panel activated (new UI)');
}

function deactivateLyricsPlusPanel(nowPlaying, panelWrapper, customBtn) {
    customBtn.setAttribute('aria-pressed', 'false');

    const nativeLyrics = nowPlaying.querySelector('[data-test="now-playing-lyrics"]');
    if (nativeLyrics) nativeLyrics.style.display = '';

    const patchWrapper = document.getElementById('lyplus-patch-container');
    if (patchWrapper) patchWrapper.style.display = 'none';
}

function getPrimaryClass(container) {
    const active = container.querySelector('button[aria-pressed="true"]');
    if (!active) return null;
    return Array.from(active.classList).find(c =>
        c.toLowerCase().includes('primary') || c.toLowerCase().includes('active')
    ) || null;
}

function getActiveClass(el) {
    return Array.from(el.classList).find(c => c.toLowerCase().includes('active')) || null;
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

            console.log('LYPLUS: Lyrics tab activated (legacy UI)');
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

    console.log('LYPLUS: Legacy lyrics tab verified');
}

// --- Unified entry point ---
function ensureLyricsUI() {
    if (isNewUI()) {
        ensureLyricsNewUI();
    } else {
        ensureLyricsTab();
    }
}

// --- MutationObserver ---
const uiObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;
    mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
            const addedNodes = Array.from(mutation.addedNodes);
            const hasRelevantChanges = addedNodes.some(node =>
                node.nodeType === 1 && (
                    node.querySelector?.('[role="tablist"]') ||
                    node.querySelector?.('[data-test="toggle-lyrics"]') ||
                    node.querySelector?.('[class*="panelWrapper"]') ||
                    node.matches?.('[role="tablist"]') ||
                    node.matches?.('[data-test="toggle-lyrics"]')
                )
            );
            if (hasRelevantChanges) shouldCheck = true;
        }
    });
    if (shouldCheck) setTimeout(ensureLyricsUI, 100);
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
        console.log('LYPLUS: UI Observer started');
    } else {
        setTimeout(startUiObserver, 1000);
    }
}

// --- INITIALIZATION ---
function initialize() {
    console.log('LYPLUS: Initializing Tidal injector...');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
        return;
    }

    // Inject CSS
    // injectPlatformCSS();
    injectDOMScript();
    startUiObserver();
    console.log('LYPLUS: Tidal injector initialized');
}

let LYPLUS_currentSong = null;

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'LYPLUS_SONG_CHANGED') {
        LYPLUS_currentSong = event.data.songInfo;
    }
});

initialize();