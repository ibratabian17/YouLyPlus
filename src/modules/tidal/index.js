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

function isNewUI() {
    return !!document.querySelector('[data-test="toggle-lyrics"]');
}

// ============================================================
// NEW UI (2024+)
//
// Tidal has TWO structurally identical now-playing panels:
//   1. Sidebar  — [data-test="new-now-playing"]
//   2. Fullscreen — #nowPlaying
// Both have their own [data-test="toggle-lyrics"] and
// [data-test="now-playing-lyrics"]. All helpers are scoped to
// a `root` element so both instances work independently.
// ============================================================

function getNowPlayingRoot(btn) {
    return btn.closest('#nowPlaying, [data-test="new-now-playing"]');
}

// Strip Tidal's private _ classes from the lyrics container so their styling
// doesn't conflict with ours — same pattern as Radiant's hideTidalLyrics().
function hideTidalLyricsIn(root) {
    const line = root.querySelector('span[data-test="lyrics-line"]');
    const container = line?.parentElement?.parentElement;
    if (!container) return;
    const tidalClasses = Array.from(container.classList).filter(c => c.startsWith('_'));
    if (!container.dataset.lyplusSavedClasses && tidalClasses.length) {
        container.dataset.lyplusSavedClasses = tidalClasses.join(' ');
    }
    tidalClasses.forEach(c => container.classList.remove(c));
}

function restoreTidalLyricsIn(root) {
    const line = root.querySelector('span[data-test="lyrics-line"]');
    const container = line?.parentElement?.parentElement;
    if (container) {
        const saved = container.dataset.lyplusSavedClasses;
        if (saved) {
            saved.split(' ').forEach(c => { if (c) container.classList.add(c); });
            delete container.dataset.lyplusSavedClasses;
        }
    }
    root.querySelector('[data-lyplus-patch]')?.remove();
}

function ensureCustomButton(nativeLyricsBtn, buttonsContainer) {
    let customBtn = buttonsContainer.querySelector('[data-lyplus-custom-btn]');
    if (customBtn) return customBtn;

    customBtn = document.createElement('button');
    customBtn.setAttribute('type', 'button');
    customBtn.setAttribute('data-lyplus-custom-btn', 'true');
    customBtn.innerHTML = nativeLyricsBtn.innerHTML;
    buttonsContainer.insertBefore(customBtn, nativeLyricsBtn);

    customBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nativeLyricsBtn.click();
    });

    return customBtn;
}

function syncCustomButtonState(nativeLyricsBtn, buttonsContainer) {
    const customBtn = buttonsContainer.querySelector('[data-lyplus-custom-btn]');
    if (!customBtn) return;

    const siblings = Array.from(buttonsContainer.querySelectorAll('button:not([data-lyplus-custom-btn])'));
    let activeClass = '', inactiveClass = '';
    siblings.forEach(btn => {
        Array.from(btn.classList).forEach(c => {
            if (c.toLowerCase().includes('primary') || c.toLowerCase().includes('active')) activeClass = c;
            if (c.toLowerCase().includes('secondary') || c.toLowerCase().includes('inactive')) inactiveClass = c;
        });
    });

    const baseClasses = siblings[0]
        ? Array.from(siblings[0].classList).filter(c => c !== activeClass && c !== inactiveClass)
        : [];

    const isActive = nativeLyricsBtn.getAttribute('aria-pressed') === 'true';
    customBtn.className = baseClasses.join(' ');
    customBtn.setAttribute('data-lyplus-custom-btn', 'true');

    if (isActive && activeClass) {
        customBtn.classList.add(activeClass);
        customBtn.setAttribute('aria-pressed', 'true');
    } else {
        if (inactiveClass) customBtn.classList.add(inactiveClass);
        customBtn.setAttribute('aria-pressed', 'false');
    }
}

function ensureLyricsPatchContainer(root) {
    if (!root) return;

    const lyricsPanel = root.querySelector('[data-test="now-playing-lyrics"]');
    if (!lyricsPanel) return;

    hideTidalLyricsIn(root);

    let patchWrapper = lyricsPanel.querySelector('[data-lyplus-patch]');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.setAttribute('data-lyplus-patch', 'true');
        patchWrapper.style.cssText = 'width:100%;height:100%;overflow-y:auto;';
        lyricsPanel.appendChild(patchWrapper);
    }

    // Give the active patch a stable id so LyricsPlusRenderer can target it.
    // Remove the id from any other instance first.
    document.querySelectorAll('[data-lyplus-patch]').forEach(el => {
        if (el !== patchWrapper) el.removeAttribute('id');
    });
    patchWrapper.id = 'lyplus-active-patch';

    // Same for buttonParent — point to the active panel's button container.
    document.querySelectorAll('[data-lyplus-btn-parent]').forEach(el => el.removeAttribute('data-lyplus-btn-parent'));
    const btnParent = root.querySelector('[class*="actionButtons"], [class*="buttons"]');
    if (btnParent) btnParent.setAttribute('data-lyplus-btn-parent', 'true');

    if (!lyricsRendererInstance && typeof LyricsPlusRenderer !== 'undefined') {
        lyricsRendererInstance = new LyricsPlusRenderer({
            player: 'video#video-one',
            patchParent: '#lyplus-active-patch',
            selectors: ['#lyplus-active-patch'],
            buttonParent: '[data-lyplus-btn-parent]',
        });
    }

    if (
        lyricsRendererInstance &&
        !lyricsRendererInstance.lyricsContainer &&
        LYPLUS_currentSong?.title &&
        typeof fetchAndDisplayLyrics === 'function'
    ) {
        fetchAndDisplayLyrics(LYPLUS_currentSong, true);
    }
}

function setupNowPlayingInstance(nativeLyricsBtn) {
    const buttonsContainer = nativeLyricsBtn.parentElement;
    if (!buttonsContainer) return;

    const root = getNowPlayingRoot(nativeLyricsBtn) || buttonsContainer.parentElement;

    nativeLyricsBtn.style.display = 'none';
    ensureCustomButton(nativeLyricsBtn, buttonsContainer);
    syncCustomButtonState(nativeLyricsBtn, buttonsContainer);

    if (!nativeLyricsBtn.hasAttribute('data-lyplus-observed')) {
        nativeLyricsBtn.setAttribute('data-lyplus-observed', 'true');

        new MutationObserver(() => {
            syncCustomButtonState(nativeLyricsBtn, buttonsContainer);
            if (nativeLyricsBtn.getAttribute('aria-pressed') === 'true') {
                setTimeout(() => ensureLyricsPatchContainer(root), 100);
            } else {
                restoreTidalLyricsIn(root);
            }
        }).observe(nativeLyricsBtn, {
            attributes: true,
            attributeFilter: ['aria-pressed', 'aria-disabled', 'class'],
        });
    }

    if (nativeLyricsBtn.getAttribute('aria-pressed') === 'true') {
        ensureLyricsPatchContainer(root);
    }
}

function ensureLyricsNewUI() {
    document.querySelectorAll('[data-test="toggle-lyrics"]').forEach(setupNowPlayingInstance);
}


// ============================================================
// OLD UI (legacy tablist)
// ============================================================
function ensureLyricsTab() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;

    const panelContainer = tablist.parentNode;
    if (!panelContainer) return;

    const originalLyricsTab = tablist.querySelector('[data-test="tabs-lyrics"]');
    if (originalLyricsTab) originalLyricsTab.style.display = 'none';

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

            currentTablist?.querySelectorAll('[role="tab"]').forEach(tab => {
                tab.setAttribute('aria-selected', 'false');
                if (activeClass) tab.classList.remove(activeClass);
            });
            currentTablist?.parentNode?.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
                panel.style.display = 'none';
                panel.classList.remove('react-tabs__tab-panel--selected');
            });

            customLyricsTab.setAttribute('aria-selected', 'true');
            if (activeClass) customLyricsTab.classList.add(activeClass);

            const lyricsPanel = document.getElementById('lyrics-plus-panel');
            if (lyricsPanel) {
                lyricsPanel.style.display = 'block';
                lyricsPanel.classList.add('react-tabs__tab-panel--selected');
            }
        });
    }

    if (!tablist.contains(customLyricsTab)) tablist.appendChild(customLyricsTab);

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

    if (!panelContainer.contains(lyricsPanel)) panelContainer.appendChild(lyricsPanel);

    customLyricsTab.setAttribute('aria-controls', 'lyrics-plus-panel');

    let patchWrapper = document.getElementById('lyplus-patch-container');
    if (!patchWrapper) {
        patchWrapper = document.createElement('div');
        patchWrapper.id = 'lyplus-patch-container';
    }
    if (!lyricsPanel.contains(patchWrapper)) lyricsPanel.appendChild(patchWrapper);

    if (!document.getElementById('lyrics-plus-container')) {
        if (!lyricsRendererInstance) {
            if (typeof LyricsPlusRenderer !== 'undefined') {
                lyricsRendererInstance = new LyricsPlusRenderer({
                    player: 'video#video-one',
                    patchParent: '#lyplus-patch-container',
                    selectors: ['#lyplus-patch-container', '#lyrics-plus-panel'],
                    buttonParent: '#lyrics-plus-panel',
                });
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
                        const activeTab = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
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
                    currentTablist?.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(t => {
                        t.setAttribute('aria-selected', 'false');
                        if (activeClass) t.classList.remove(activeClass);
                    });
                    currentTablist?.parentNode?.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
                        panel.style.display = '';
                        panel.classList.remove('react-tabs__tab-panel--selected');
                    });

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
    const panelRoots = new Set();

    mutations.forEach(mutation => {
        if (mutation.type !== 'childList') return;
        Array.from(mutation.addedNodes).forEach(node => {
            if (node.nodeType !== 1) return;

            if (
                node.querySelector?.('[data-test="toggle-lyrics"]') ||
                node.querySelector?.('[role="tablist"]') ||
                node.matches?.('[data-test="toggle-lyrics"]') ||
                node.matches?.('[role="tablist"]')
            ) {
                shouldCheckUI = true;
            }

            const lyricsPanelNode = node.matches?.('[data-test="now-playing-lyrics"]')
                ? node
                : node.querySelector?.('[data-test="now-playing-lyrics"]');

            if (lyricsPanelNode) {
                const root = lyricsPanelNode.closest('#nowPlaying, [data-test="new-now-playing"]')
                    || lyricsPanelNode.parentElement;
                if (root) panelRoots.add(root);
            }
        });
    });

    if (shouldCheckUI) setTimeout(ensureLyricsUI, 50);
    panelRoots.forEach(root => setTimeout(() => ensureLyricsPatchContainer(root), 50));
});

function startUiObserver() {
    const appRoot = document.getElementById('wimp') || document.body;
    if (appRoot) {
        uiObserver.observe(appRoot, { childList: true, subtree: true });
        setTimeout(ensureLyricsUI, 500);
    } else {
        setTimeout(startUiObserver, 1000);
    }
}

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

        document.querySelectorAll('[data-test="toggle-lyrics"][aria-pressed="true"]').forEach(btn => {
            const root = getNowPlayingRoot(btn) || btn.parentElement?.parentElement;
            if (!root) return;
            if (lyricsRendererInstance) lyricsRendererInstance.lyricsContainer = null;
            setTimeout(() => ensureLyricsPatchContainer(root), 100);
        });
    }
});

initialize();