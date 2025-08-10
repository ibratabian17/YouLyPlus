let lyricsRendererInstance = null;

const LyricsPlusAPI = {
  displayLyrics: (...args) => lyricsRendererInstance?.displayLyrics(...args),
  displaySongNotFound: () => lyricsRendererInstance?.displaySongNotFound(),
  displaySongError: () => lyricsRendererInstance?.displaySongError(),
  cleanupLyrics: () => lyricsRendererInstance?.cleanupLyrics(),
  updateDisplayMode: (...args) => lyricsRendererInstance?.updateDisplayMode(...args)
};

function injectPlatformCSS() {
    if (document.querySelector('link[data-lyrics-plus-platform-style]')) return;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = (chrome || browser).runtime.getURL('src/modules/tidal/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
}

function injectDOMScript() {
    
}

// --- UI LOGIC ---
function ensureLyricsTab() {
    const tablist = document.querySelector('[role="tablist"]');
    const firstPanel = document.querySelector('div[role="tabpanel"]');
    const panelContainer = firstPanel ? firstPanel.parentNode : null;

    if (!tablist || !panelContainer) return;

    const originalLyricsTab = tablist.querySelector('[data-test="tabs-lyrics"]');
    if (originalLyricsTab) {
        originalLyricsTab.style.display = 'none';
    }

    if (document.getElementById('lyrics-plus-tab')) return;

    const customLyricsTab = document.createElement('li');
    customLyricsTab.className = '_tabItem_8436610';
    customLyricsTab.dataset.test = 'tabs-lyrics-plus';
    customLyricsTab.id = 'lyrics-plus-tab';
    customLyricsTab.setAttribute('role', 'tab');
    customLyricsTab.setAttribute('aria-selected', 'false');
    customLyricsTab.setAttribute('aria-disabled', 'false');
    customLyricsTab.setAttribute('data-rttab', 'true');
    customLyricsTab.innerHTML = `<svg class="_icon_77f3f89" viewBox="0 0 20 20"><use href="#general__lyrics"></use></svg><span data-wave-color="textDefault" class="wave-text-description-demi">Lyrics</span>`;

    const lyricsPanel = document.createElement('div');
    lyricsPanel.id = 'lyrics-plus-panel';
    lyricsPanel.className = firstPanel.className;
    lyricsPanel.style.display = 'none';
    panelContainer.appendChild(lyricsPanel);

    if (!lyricsRendererInstance) {
        const uiConfig = {
            player: 'video',
            patchParent: '#lyrics-plus-panel',
            selectors: ['#lyrics-plus-panel']
        };
        lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
    }

    customLyricsTab.setAttribute('aria-controls', 'lyrics-plus-panel');
    tablist.appendChild(customLyricsTab);

    customLyricsTab.addEventListener('click', () => {
        tablist.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', 'false'));
        customLyricsTab.setAttribute('aria-selected', 'true');
        panelContainer.querySelectorAll('[role="tabpanel"]').forEach(p => { p.style.display = 'none'; });
        lyricsPanel.style.display = 'block';
    });

    tablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(tab => {
        tab.addEventListener('click', () => {
            const controlledPanelId = tab.getAttribute('aria-controls');
            if (controlledPanelId) {
                const controlledPanel = document.getElementById(controlledPanelId);
                if (controlledPanel) controlledPanel.style.display = 'block';
            }
            customLyricsTab.setAttribute('aria-selected', 'false');
            lyricsPanel.style.display = 'none';
        });
    });
}

const uiObserver = new MutationObserver(ensureLyricsTab);
const uiObserverConfig = { childList: true, subtree: true };

function startUiObserver() {
    const appRoot = document.getElementById('wimp');
    if (appRoot) {
        uiObserver.observe(appRoot, uiObserverConfig);
    } else {
        setTimeout(startUiObserver, 500);
    }
}

// --- SONG TRACKING LOGIC ---
let LYPLUS_currentSong = {};

function setupSongTracker() {
    const targetNode = document.querySelector('div[data-test="left-column-footer-player"]');
    if (targetNode) {
        const songTrackerObserver = new MutationObserver(debounceCheckForSongChange);
        const observerOptions = { characterData: true, childList: true, subtree: true };
        songTrackerObserver.observe(targetNode, observerOptions);
    } else {
        const nowPlayingNode = document.getElementById('nowPlaying');
        if(nowPlayingNode) {
            const songTrackerObserver = new MutationObserver(debounceCheckForSongChange);
            const observerOptions = { characterData: true, childList: true, subtree: true };
            songTrackerObserver.observe(nowPlayingNode, observerOptions);
        } else {
             setTimeout(setupSongTracker, 1000);
        }
    }
    setInterval(checkForSongChange, 5000);
}

let debounceTimer = null;
function debounceCheckForSongChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForSongChange, 500);
}

function checkForSongChange() {
    const newSongInfo = getSongInfo();
    // console.log('LYPLUS_TRACKER: Checking for song change. New info found:', newSongInfo, 'Current song:', LYPLUS_currentSong);

    if (!newSongInfo || !newSongInfo.title.trim() || !newSongInfo.artist.trim()) return;

    if (newSongInfo.title !== LYPLUS_currentSong.title || newSongInfo.artist !== LYPLUS_currentSong.artist || newSongInfo.duration !== LYPLUS_currentSong.duration) {
        console.log('LYPLUS_TRACKER: Song change detected!', newSongInfo);
        LYPLUS_currentSong = newSongInfo;
        window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: LYPLUS_currentSong }, '*');
        window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
    }
}

function getSongInfo() {
    // console.log('LYPLUS_TRACKER: getSongInfo called.');
    const selectors = [
        { title: 'div[data-test="left-column-footer-player"] div[data-test="footer-track-title"] a span', artist: 'div[data-test="left-column-footer-player"] a[data-test="grid-item-detail-text-title-artist"]' }, // Mini-player
        { title: 'div[data-test="now-playing-title"]', artist: 'a[data-test="now-playing-artist"]' } // Full-screen player (still a guess)
    ];
    for (let i = 0; i < selectors.length; i++) {
        const s = selectors[i];
        const titleElement = document.querySelector(s.title);
        const artistElement = document.querySelector(s.artist);

        if (titleElement && artistElement) {
            const durationElement = document.querySelector('video').duration;
            const songInfo = {
                title: titleElement.textContent.trim(),
                artist: artistElement.textContent.trim(),
                album: '',
                duration: durationElement,
                cover: '',
                isVideo: false
            };
            if(songInfo.title != "" && songInfo.artist != "" && !Number.isNaN(songInfo.duration))
            return songInfo;
        }
    }
    // console.log('LYPLUS_TRACKER: No song info found with any selector set.');
    return null;
}

// --- INITIALIZATION ---
startUiObserver();
setupSongTracker();