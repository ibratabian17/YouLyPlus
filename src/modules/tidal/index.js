let lyricsRendererInstance = null;
let pendingSongInfo = null;
let pendingCheckCount = 0;

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
    if (!pBrowser?.runtime?.getURL) {
        console.warn('Tidal: runtime.getURL unavailable, skipping CSS inject');
        return;
    }
    linkElement.href = pBrowser.runtime.getURL('src/modules/tidal/style.css');
    linkElement.setAttribute('data-lyrics-plus-platform-style', 'true');
    document.head.appendChild(linkElement);
}

function injectDOMScript() {
    // Empty for now
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
    lyricsPanel.setAttribute('role', 'tabpanel');
    lyricsPanel.style.display = 'none';
    
    lyricsPanel.innerHTML = `
    `;
    
    panelContainer.appendChild(lyricsPanel);

    if (!lyricsRendererInstance) {
        const uiConfig = {
            player: 'video',
            patchParent: '#lyrics-plus-panel',
            selectors: ['#lyrics-plus-panel']
        };
        if (typeof LyricsPlusRenderer !== 'undefined') {
            lyricsRendererInstance = new LyricsPlusRenderer(uiConfig);
        }
    }

    customLyricsTab.setAttribute('aria-controls', 'lyrics-plus-panel');
    lyricsPanel.setAttribute('aria-labelledby', 'lyrics-plus-tab');
    
    tablist.appendChild(customLyricsTab);

    customLyricsTab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (customLyricsTab.getAttribute('aria-selected') === 'true') {
            return;
        }
        
        tablist.querySelectorAll('[role="tab"]').forEach(tab => {
            tab.setAttribute('aria-selected', 'false');
            tab.classList.remove('_activeTab_f47dafa');
        });
        
        // Hide all original panels (but keep their original display logic intact)
        panelContainer.querySelectorAll('[role="tabpanel"]:not(#lyrics-plus-panel)').forEach(panel => {
            panel.style.display = 'none';
            panel.classList.remove('react-tabs__tab-panel--selected');
        });
        
        customLyricsTab.setAttribute('aria-selected', 'true');
        customLyricsTab.classList.add('_activeTab_f47dafa');
        
        lyricsPanel.style.display = 'block';
        lyricsPanel.classList.add('react-tabs__tab-panel--selected');
        
        console.log('LYPLUS: Lyrics tab activated');
    });

    tablist.querySelectorAll('[role="tab"]:not(#lyrics-plus-tab)').forEach(tab => {
        if (!tab.hasAttribute('data-lyrics-plus-listener')) {
            tab.setAttribute('data-lyrics-plus-listener', 'true');
            
            tab.addEventListener('click', (e) => {
                setTimeout(() => {
                    // Deactivate our lyrics tab
                    customLyricsTab.setAttribute('aria-selected', 'false');
                    customLyricsTab.classList.remove('_activeTab_f47dafa');
                    lyricsPanel.style.display = 'none';
                    lyricsPanel.classList.remove('react-tabs__tab-panel--selected');
                    
                    const selectedTab = tablist.querySelector('[role="tab"][aria-selected="true"]:not(#lyrics-plus-tab)');
                    if (selectedTab) {
                        const panelId = selectedTab.getAttribute('aria-controls');
                        const targetPanel = document.getElementById(panelId);
                        if (targetPanel) {
                            // Remove our forced display:none and let React's logic take over
                            targetPanel.style.display = '';
                            setTimeout(() => {
                                if (targetPanel.style.display === 'none' || 
                                    getComputedStyle(targetPanel).display === 'none') {
                                    targetPanel.style.display = 'block';
                                }
                            }, 50);
                        }
                    }
                }, 10);
            });
        }
    });

    console.log('LYPLUS: Custom lyrics tab created and attached');
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

// --- SONG TRACKING LOGIC ---
let LYPLUS_currentSong = {};

function setupSongTracker() {
    // Try multiple possible selectors for the player with better coverage
    const possibleSelectors = [
        'div[data-test="left-column-footer-player"]',
        '#nowPlaying',
        '[data-test="footer-track-title"]',
        '[data-test="now-playing-title"]',
        '.player-controls',
        'main', // Fallback to main content area
        'body' // Ultimate fallback
    ];
    
    let targetNode = null;
    for (const selector of possibleSelectors) {
        targetNode = document.querySelector(selector);
        if (targetNode) {
            console.log(`LYPLUS: Song tracker targeting: ${selector}`);
            break;
        }
    }
    
    if (targetNode) {
        const songTrackerObserver = new MutationObserver(debounceCheckForSongChange);
        const observerOptions = { 
            characterData: true, 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['title', 'aria-label', 'src', 'data-test']
        };
        songTrackerObserver.observe(targetNode, observerOptions);
        console.log('LYPLUS: Song tracker observer attached to:', targetNode);
        
        // Also observe for URL changes (for SPA navigation)
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                console.log('LYPLUS: URL changed, checking for song change');
                setTimeout(checkForSongChange, 500); // Delay to let page load
            }
        });
        urlObserver.observe(document, { subtree: true, childList: true });
        
    } else {
        console.log('LYPLUS: No suitable target found for song tracking, retrying...');
        setTimeout(setupSongTracker, 2000);
        return;
    }
    
    // More frequent periodic checks for better detection
    setInterval(checkForSongChange, 3000);
    
    // Multiple initial checks with delays
    setTimeout(checkForSongChange, 500);
    setTimeout(checkForSongChange, 1500);
    setTimeout(checkForSongChange, 3000);
}

let debounceTimer = null;
function debounceCheckForSongChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForSongChange, 300);
}

function checkForSongChange() {
    const newSongInfo = getSongInfo();
    
    if (!newSongInfo || !newSongInfo.title.trim() || !newSongInfo.artist.trim()) {
        return;
    }

    // Check if current src has changed (for video/audio elements)
    const videoElement = document.querySelector('video');
    const audioElement = document.querySelector('audio');
    const currentSrc = videoElement?.currentSrc || audioElement?.currentSrc || '';

    const hasChanged = (
        newSongInfo.title !== LYPLUS_currentSong.title || 
        newSongInfo.artist !== LYPLUS_currentSong.artist || 
        currentSrc !== LYPLUS_currentSong.currentSrc
    );

    if (hasChanged) {
        if (!pendingSongInfo) {
            pendingSongInfo = { ...newSongInfo, currentSrc };
            pendingCheckCount = 0;
            return;
        }

        if (
            pendingSongInfo.title === newSongInfo.title &&
            pendingSongInfo.artist === newSongInfo.artist &&
            pendingSongInfo.currentSrc === currentSrc
        ) {
            pendingCheckCount++;

            const validDuration = newSongInfo.duration && !isNaN(newSongInfo.duration) && newSongInfo.duration > 0;
            const differentFromOld = newSongInfo.duration !== LYPLUS_currentSong.duration;

            if (validDuration && differentFromOld) {
                LYPLUS_currentSong = { ...newSongInfo, currentSrc };
                pendingSongInfo = null;
                pendingCheckCount = 0;

                window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: LYPLUS_currentSong }, '*');
                window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
            } 
            else if (pendingCheckCount >= 3) {
                LYPLUS_currentSong = { ...newSongInfo, currentSrc };
                pendingSongInfo = null;
                pendingCheckCount = 0;

                window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: LYPLUS_currentSong }, '*');
                window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
            }
        } else {
            pendingSongInfo = { ...newSongInfo, currentSrc };
            pendingCheckCount = 0;
            console.log('LYPLUS: New pending song', pendingSongInfo);
        }
    }
}


function getSongInfo() {
    // Try to get song info from multiple sources with improved reliability
    let title = '';
    let artist = '';
    let album = '';
    
    // Method 1: Try footer player area (most common)
    const footerPlayer = document.querySelector('div[data-test="left-column-footer-player"]');
    if (footerPlayer) {
        // Get title - try multiple selectors
        const titleSelectors = [
            'div[data-test="footer-track-title"] a span',
            'div[data-test="footer-track-title"] span',
            '[data-test="footer-track-title"] *:last-child'
        ];
        
        for (const selector of titleSelectors) {
            const titleEl = footerPlayer.querySelector(selector);
            if (titleEl && titleEl.textContent.trim()) {
                title = titleEl.textContent.trim();
                break;
            }
        }
        
        // Get artist - try multiple selectors
        const artistSelectors = [
            'a[data-test="grid-item-detail-text-title-artist"]',
            '[data-test="grid-item-detail-text-title-artist"]',
            'a[href*="/artist/"]'
        ];
        
        for (const selector of artistSelectors) {
            const artistEl = footerPlayer.querySelector(selector);
            if (artistEl && artistEl.textContent.trim()) {
                artist = artistEl.textContent.trim();
                break;
            }
        }
    }
    
    // Method 2: Try current page if footer didn't work
    if (!title || !artist) {
        const pageSelectors = [
            {
                title: 'h1[data-test="entity-title"]',
                artist: '[data-test="grid-item-detail-text-title-artist"]:first-of-type'
            },
            {
                title: '[data-test="now-playing-title"]',
                artist: '[data-test="now-playing-artist"]'
            },
            {
                title: '.track-title, .song-title',
                artist: '.track-artist, .song-artist'
            }
        ];
        
        for (const selectors of pageSelectors) {
            const titleEl = document.querySelector(selectors.title);
            const artistEl = document.querySelector(selectors.artist);
            
            if (titleEl && artistEl && titleEl.textContent.trim() && artistEl.textContent.trim()) {
                title = title || titleEl.textContent.trim();
                artist = artist || artistEl.textContent.trim();
                break;
            }
        }
    }
    
    // Method 3: Try to get from document title as last resort
    if (!title && !artist && document.title) {
        const titleParts = document.title.split(' - ');
        if (titleParts.length >= 2) {
            title = titleParts[0].trim();
            artist = titleParts[1].split(' | ')[0].trim(); // Remove " | TIDAL" part
        }
    }
    
    // Clean up extracted data
    title = title.replace(/^["']|["']$/g, ''); // Remove quotes
    artist = artist.replace(/^["']|["']$/g, '');
    
    // Don't return if we don't have both title and artist
    if (!title || !artist || title.length < 2 || artist.length < 2) {
        return null;
    }
    
    // Try to get album info
    const albumSelectors = [
        '.react-tabs div[role="tabpanel"] a[href*="/album/"]',
    ];
    
    for (const selector of albumSelectors) {
        const albumEl = document.querySelector(selector);
        if (albumEl && albumEl.textContent.trim() && albumEl.textContent.trim() !== title) {
            album = albumEl.textContent.trim();
            break;
        }
    }
    
    // Try to get duration from media element
    let duration = 0;
    const mediaElements = [
        document.querySelector('video'),
        document.querySelector('audio'),
        document.querySelector('[data-test="duration"]')
    ];
    
    for (const element of mediaElements) {
        if (element) {
            if (element.duration && !isNaN(element.duration) && element.duration > 0) {
                duration = Math.round(element.duration);
                break;
            }
            // Try to parse duration from text content
            if (element.textContent && /\d+:\d+/.test(element.textContent)) {
                const timeMatch = element.textContent.match(/(\d+):(\d+)/);
                if (timeMatch) {
                    duration = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
                    break;
                }
            }
        }
    }
    
    // Try to get cover art
    let cover = '';
    const coverSelectors = [
        'img[data-test="current-media-imagery"]',
        'img[data-test="entity-image"]',
        '.player-image img',
        '.album-cover img'
    ];
    
    for (const selector of coverSelectors) {
        const coverEl = document.querySelector(selector);
        if (coverEl && coverEl.src) {
            cover = coverEl.src;
            break;
        }
    }
    
    const songInfo = {
        title,
        artist,
        album,
        duration,
        cover,
        isVideo: !!document.querySelector('video')
    };
    
    return songInfo;
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
    
    // Start observers
    startUiObserver();
    setupSongTracker();
    
    console.log('LYPLUS: Tidal injector initialized');
}

// Start initialization
initialize();