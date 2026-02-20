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

// --- UI LOGIC ---
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
        customLyricsTab.className = '_tabItem_8436610';
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

            if (customLyricsTab.getAttribute('aria-selected') === 'true') {
                return;
            }

            const currentTablist = document.querySelector('[role="tablist"]');
            if (currentTablist) {
                currentTablist.querySelectorAll('[role="tab"]').forEach(tab => {
                    tab.setAttribute('aria-selected', 'false');
                    tab.classList.remove('_activeTab_f47dafa');
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
            customLyricsTab.classList.add('_activeTab_f47dafa');

            const currentLyricsPanel = document.getElementById('lyrics-plus-panel');
            if (currentLyricsPanel) {
                currentLyricsPanel.style.display = 'block';
                currentLyricsPanel.classList.add('react-tabs__tab-panel--selected');
            }

            console.log('LYPLUS: Lyrics tab activated');
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
        lyricsPanel.className = firstPanel ? firstPanel.className : '_tabPanelStyles_d7b9f59';
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
        console.log('LyricsPlus: Creating wrapper container...');
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';
    }

    if (!lyricsPanel.contains(patchWrapper)) {
        lyricsPanel.appendChild(patchWrapper);
    }

    if (!document.getElementById('lyrics-plus-container')) {
        console.log('LyricsPlus: Lyrics container missing, checking for reuse...');
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
                console.log('LyricsPlus: Reusing existing container');
                patchWrapper.appendChild(lyricsRendererInstance.lyricsContainer);
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.restore();
            } else {
                console.log('LyricsPlus: Injecting new lyrics instance (resetting container)...');
                lyricsRendererInstance.uiConfig.patchParent = '#lyplus-patch-container';
                lyricsRendererInstance.lyricsContainer = null;

                if (LYPLUS_currentSong && LYPLUS_currentSong.title && typeof fetchAndDisplayLyrics === 'function') {
                    fetchAndDisplayLyrics(LYPLUS_currentSong, true);
                }
            }
        }
    }

    if (lyricsRendererInstance && !lyricsRendererInstance.lyricsContainer && LYPLUS_currentSong && LYPLUS_currentSong.title && typeof fetchAndDisplayLyrics === 'function') {
        fetchAndDisplayLyrics(LYPLUS_currentSong, true);
    }

    tablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(tab => {
        if (!tab.hasAttribute('data-lyrics-plus-listener')) {
            tab.setAttribute('data-lyrics-plus-listener', 'true');

            tab.addEventListener('click', (e) => {
                setTimeout(() => {
                    const lTab = document.getElementById('lyrics-plus-tab');
                    const lPanel = document.getElementById('lyrics-plus-panel');

                    // 1. Hide our custom tab stuff
                    if (lTab) {
                        lTab.setAttribute('aria-selected', 'false');
                        lTab.classList.remove('_activeTab_f47dafa');
                    }
                    if (lPanel) {
                        lPanel.style.display = 'none';
                        lPanel.classList.remove('react-tabs__tab-panel--selected');
                    }

                    // 2. Clear all native tabs to ensure no duplicates
                    const currentTablist = document.querySelector('[role="tablist"]');
                    if (currentTablist) {
                        currentTablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(t => {
                            t.setAttribute('aria-selected', 'false');
                            t.classList.remove('_activeTab_f47dafa');
                        });
                    }

                    // 3. Clear our inline overrides from all native panels
                    if (currentTablist && currentTablist.parentNode) {
                        currentTablist.parentNode.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
                            panel.style.display = '';
                            panel.classList.remove('react-tabs__tab-panel--selected');
                        });
                    }

                    // 4. Forcefully select the clicked tab incase React desynced
                    tab.setAttribute('aria-selected', 'true');
                    tab.classList.add('_activeTab_f47dafa');

                    // 5. Forcefully display the clicked tab's panel
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

    // Make sure our tabpanel is correctly selected if the tab is active
    if (customLyricsTab.getAttribute('aria-selected') === 'true') {
        lyricsPanel.style.display = 'block';
    }

    console.log('LYPLUS: Custom lyrics tab verified and attached');
}

const uiObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;
    mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
            const addedNodes = Array.from(mutation.addedNodes);
            const hasRelevantChanges = addedNodes.some(node =>
                node.nodeType === 1 && (
                    node.querySelector?.('[role="tablist"]') ||
                    node.querySelector?.('[role="tabpanel"]') ||
                    node.matches?.('[role="tablist"]') ||
                    node.matches?.('[role="tabpanel"]')
                )
            );
            if (hasRelevantChanges) {
                shouldCheck = true;
            }
        }
    });

    if (shouldCheck) {
        setTimeout(ensureLyricsTab, 100);
    }
});

const uiObserverConfig = {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
};

function startUiObserver() {
    const appRoot = document.getElementById('wimp') || document.body;
    if (appRoot) {
        uiObserver.observe(appRoot, uiObserverConfig);
        // Initial check
        setTimeout(ensureLyricsTab, 500);
        console.log('LYPLUS: UI Observer started');
    } else {
        setTimeout(startUiObserver, 1000);
    }
}

// --- INITIALIZATION ---
function initialize() {
    console.log('LYPLUS: Initializing Tidal injector...');

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
        return;
    }

    // Inject CSS
    // injectPlatformCSS();
    injectDOMScript();

    setupObservers();

    console.log('LYPLUS: Tidal injector initialized');
}

// --- Setup ---
let LYPLUS_currentSong = null;

function setupObservers() {
    startUiObserver();
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
        return;
    }

    if (event.data.type === 'LYPLUS_SONG_CHANGED') {
        LYPLUS_currentSong = event.data.songInfo;
    }
});

// Start initialization
initialize();