// Browser compatibility
const pBrowser = window.chrome || window.browser;
        
// Current settings object
let currentSettings = {
    lyricsProvider: 'kpoe', // Can be 'kpoe' or 'lrclib'
    lyricsSourceOrder: 'apple,musixmatch,spotify,musixmatch-word', // For KPoe provider
    wordByWord: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    autoHideLyrics: false,
    cacheStrategy: 'aggressive',
    fontSize: 16,
    customCSS: '',
};

// Storage helper function (using pBrowser.storage.local directly)
function storageLocalGet(keys) {
    return new Promise(resolve => pBrowser.storage.local.get(keys, resolve));
}

function storageLocalSet(items) {
    return new Promise((resolve, reject) => {
        pBrowser.storage.local.set(items, () => {
            if (pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

// Load settings from storage
function loadSettings(callback) {
    storageLocalGet(currentSettings).then((items) => { // Use currentSettings as default
        currentSettings = items;
        console.log("Loaded settings:", currentSettings);
        updateUI();
        if (callback) callback();
    });
}

// Update settings in storage
function saveSettings() {
    storageLocalSet(currentSettings).then(() => {
        console.log("Saving settings:", currentSettings);
        // Notify the main page of updated settings
        window.postMessage({
            type: 'UPDATE_SETTINGS',
            settings: currentSettings
        }, '*');
    });
}

// Update settings object with new values
function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    console.log("Updated settings:", currentSettings);
    updateUI();
}

// Function to update the cache size display.
function updateCacheSize() {
    pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' }, (response) => {
        if (response.success) {
            const sizeMB = (response.sizeKB / 1024).toFixed(2);
            document.getElementById('cache-size').textContent = `${sizeMB} MB used (${response.cacheCount} songs cached)`;
        } else {
            console.error("Error getting cache size:", response.error);
        }
    });
}

// Update UI elements to reflect current settings
function updateUI() {
    // General settings
    document.getElementById('enabled').checked = currentSettings.isEnabled;
    document.getElementById('default-provider').value = currentSettings.lyricsProvider;
    document.getElementById('sponsor-block').checked = currentSettings.useSponsorBlock;
    document.getElementById('lightweight').checked = currentSettings.lightweight;
    document.getElementById('wordByWord').checked = currentSettings.wordByWord;

    // Populate draggable KPoe sources
    populateDraggableSources();

    // Appearance settings
    document.getElementById('custom-css').value = currentSettings.customCSS;
    document.getElementById('fontSize').value = currentSettings.fontSize;
    document.getElementById('autoHideLyrics').checked = currentSettings.autoHideLyrics;
    // Cache settings
    document.getElementById('cache-strategy').value = currentSettings.cacheStrategy;
    updateCacheSize(); // Update cache size display on UI load
}

// Tab navigation
document.querySelectorAll('.sidebar-menu li').forEach(item => {
    item.addEventListener('click', () => {
        // Update active menu item
        document.querySelectorAll('.sidebar-menu li').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Show corresponding section
        const sectionId = item.getAttribute('data-section');
        document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
        document.getElementById(sectionId).classList.add('active');
    });
});

// Event listeners for save buttons
document.getElementById('save-general').addEventListener('click', () => {
    // Get the current order of draggable items
    const draggableList = document.getElementById('lyrics-source-order-draggable');
    const orderedSources = Array.from(draggableList.children)
                                .map(item => item.dataset.source);

    updateSettings({
        isEnabled: document.getElementById('enabled').checked,
        lyricsProvider: document.getElementById('default-provider').value,
        lyricsSourceOrder: orderedSources.join(','), // Save the new order
        useSponsorBlock: document.getElementById('sponsor-block').checked,
        lightweight: document.getElementById('lightweight').checked,
        wordByWord: document.getElementById('wordByWord').checked
    });
    saveSettings();
});

document.getElementById('save-appearance').addEventListener('click', () => {
    updateSettings({
        customCSS: document.getElementById('custom-css').value,
        fontSize: parseInt(document.getElementById('fontSize').value, 10),
        autoHideLyrics: document.getElementById('autoHideLyrics').checked
    });
    saveSettings();
});

document.getElementById('save-cache').addEventListener('click', () => {
    updateSettings({
        cacheStrategy: document.getElementById('cache-strategy').value
    });
    saveSettings();
});


// Clear cache button
document.getElementById('clear-cache').addEventListener('click', () => {
    pBrowser.runtime.sendMessage({ type: 'RESET_CACHE' }, (response) => {
        if (response.success) {
            updateCacheSize(); // Refresh the displayed cache size
            alert('Cache cleared successfully!');
        } else {
            console.error("Error resetting cache:", response.error);
            alert('Error clearing cache: ' + response.error);
        }
    });
});

// Message listener for updates from main page
window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'UPDATE_SETTINGS') {
        console.log("Received new settings:", event.data.settings);
        updateSettings(event.data.settings);
    }
});

// --- Drag and Drop Functionality for KPoe Sources ---
let draggedItem = null;

// Helper to get display name for a source
function getSourceDisplayName(sourceName) {
    switch (sourceName) {
        case 'lyricsplus': return 'Lyrics+ (User Generated)';
        case 'apple': return 'Apple Music';
        case 'spotify': return 'Musixmatch (via Spotify)';
        case 'musixmatch': return 'Musixmatch (Direct)';
        case 'musixmatch-word': return 'Musixmatch (Word-by-Word)';
        default: return sourceName.charAt(0).toUpperCase() + sourceName.slice(1).replace('-', ' ');
    }
}

function createDraggableSourceItem(sourceName) {
    const item = document.createElement('div');
    item.classList.add('draggable-source-item');
    item.setAttribute('draggable', 'true');
    item.dataset.source = sourceName;

    item.innerHTML = `
        <span class="material-symbols-outlined drag-handle">drag_indicator</span>
        <span class="source-name">${getSourceDisplayName(sourceName)}</span>
        <button class="remove-source-button btn-icon" title="Remove source">
            <span class="material-symbols-outlined">close</span>
        </button>
    `;

    const removeButton = item.querySelector('.remove-source-button');
    removeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSource(sourceName);
    });

    return item;
}

function populateDraggableSources() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    const availableSourcesDropdown = document.getElementById('available-sources-dropdown');
    const allowedSources = ['lyricsplus', 'apple', 'spotify', 'musixmatch', 'musixmatch-word'];

    if (!draggableContainer || !availableSourcesDropdown) return;

    draggableContainer.innerHTML = ''; // Clear existing items
    availableSourcesDropdown.innerHTML = ''; // Clear existing options

    const currentActiveSources = currentSettings.lyricsSourceOrder.split(',').filter(s => s.trim() !== '');

    // Populate draggable list
    currentActiveSources.forEach(source => {
        draggableContainer.appendChild(createDraggableSourceItem(source.trim()));
    });

    // Populate available sources dropdown
    const sourcesToAdd = allowedSources.filter(source => !currentActiveSources.includes(source));

    if (sourcesToAdd.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'All sources added';
        option.disabled = true;
        availableSourcesDropdown.appendChild(option);
        document.getElementById('add-source-button').disabled = true;
    } else {
        document.getElementById('add-source-button').disabled = false;
        sourcesToAdd.forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = getSourceDisplayName(source);
            availableSourcesDropdown.appendChild(option);
        });
    }

    addDragDropListeners();
}

function showStatusMessage(message, isError = false) {
    const statusElement = document.getElementById('add-source-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = isError ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)';
        statusElement.style.opacity = '1';
        setTimeout(() => {
            statusElement.style.opacity = '0';
            setTimeout(() => {
                statusElement.textContent = '';
            }, 300); // Clear after fade out
        }, 3000);
    }
}

function addSource() {
    const availableSourcesDropdown = document.getElementById('available-sources-dropdown');
    const sourceName = availableSourcesDropdown.value;

    if (!sourceName) {
        showStatusMessage('Please select a source to add.', true);
        return;
    }

    const sources = currentSettings.lyricsSourceOrder.split(',').filter(s => s !== '');
    if (sources.includes(sourceName)) {
        showStatusMessage(`Source "${getSourceDisplayName(sourceName)}" already exists in your list.`, true);
        return;
    }

    sources.push(sourceName);
    currentSettings.lyricsSourceOrder = sources.join(',');
    saveSettings();
    populateDraggableSources(); // Re-populate to show the new item and update dropdown
    showStatusMessage(`Source "${getSourceDisplayName(sourceName)}" added successfully!`);
}

function removeSource(sourceName) {
    const sources = currentSettings.lyricsSourceOrder.split(',').filter(s => s !== '');
    const updatedSources = sources.filter(s => s !== sourceName);
    currentSettings.lyricsSourceOrder = updatedSources.join(',');
    saveSettings();
    populateDraggableSources(); // Re-populate to remove the item and update dropdown
    showStatusMessage(`Source "${getSourceDisplayName(sourceName)}" removed successfully!`);
}

function addDragDropListeners() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer) return;

    draggableContainer.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('draggable-source-item')) {
            draggedItem = e.target;
            setTimeout(() => {
                e.target.classList.add('dragging');
            }, 0);
        }
    });

    draggableContainer.addEventListener('dragover', (e) => {
        e.preventDefault(); // Allow drop
        const afterElement = getDragAfterElement(draggableContainer, e.clientY);
        const currentDraggable = document.querySelector('.dragging');
        if (currentDraggable) {
            if (afterElement == null) {
                draggableContainer.appendChild(currentDraggable);
            } else {
                draggableContainer.insertBefore(currentDraggable, afterElement);
            }
        }
    });

    draggableContainer.addEventListener('dragend', () => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
        }
        // Save settings immediately after drag-and-drop
        const orderedSources = Array.from(draggableContainer.children)
                                    .map(item => item.dataset.source);
        currentSettings.lyricsSourceOrder = orderedSources.join(',');
        saveSettings();
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.draggable-source-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: -Infinity }).element;
}

// Initialize
loadSettings();

// Event listener for Add Source button
document.getElementById('add-source-button').addEventListener('click', addSource);

// Event listener for default-provider change to toggle KPoe sources visibility
document.getElementById('default-provider').addEventListener('change', (e) => {
    const kpoeSourcesGroup = document.getElementById('kpoe-sources-group');
    if (e.target.value === 'kpoe') {
        kpoeSourcesGroup.style.display = 'block';
    } else {
        kpoeSourcesGroup.style.display = 'none';
    }
});

// Mock lyrics data for preview
const mockLyricsData = {
    type: 'Syllable',
    data: [
        { text: 'This ', startTime: 0, duration: 500, element: { singer: 'v1' } },
        { text: 'is ', startTime: 500, duration: 500, element: { singer: 'v1' } },
        { text: 'a ', startTime: 1000, duration: 500, element: { singer: 'v1' } },
        { text: 'preview ', startTime: 1500, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
        { text: 'of ', startTime: 3000, duration: 500, element: { singer: 'v1' } },
        { text: 'how ', startTime: 3500, duration: 500, element: { singer: 'v1' } },
        { text: 'lyrics ', startTime: 4000, duration: 500, element: { singer: 'v1' } },
        { text: 'will ', startTime: 4500, duration: 500, element: { singer: 'v1' } },
        { text: 'look!', startTime: 5000, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
        { text: 'break', startTime: 8000, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
        { text: 'Enjoy ', startTime: 10000, duration: 500, element: { singer: 'v1' } },
        { text: 'the ', startTime: 10500, duration: 500, element: { singer: 'v1' } },
        { text: 'example!', startTime: 11000, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
    ],
    metadata: {
        title: 'Example Song',
        artist: ['YouLy+ Dev'],
        album: 'Settings Preview',
        duration: 12000,
        instrumental: false,
        source: 'Mock Data'
    }
};

function t(key) {
    const translations = {
        "writtenBy": "Written by",
        "source": "Source:",
        "notFound": "Lyrics not found.",
        "notFoundError": "Error fetching lyrics.",
        "loading": "Loading lyrics..."
    };
    return translations[key] || key;
}

// Preview specific variables and functions (adapted from lyricsRenderer.js)
let previewAnimationFrameId = null;
let previewCurrentPrimaryActiveLine = null;
let previewLastTime = 0;
let previewLyricsContainer = null;
let previewCachedLyricsLines = [];
let previewCachedSyllables = [];
let previewActiveLineIds = new Set();
let previewHighlightedSyllableIds = new Set();
let previewVisibleLineIds = new Set();
let previewLastProcessedTime = 0;
let previewFontCache = {};
let previewTextWidthCanvas = null;
let previewVisibilityObserver = null;
let previewCurrentTime = 0; // Mock current time for preview playback
let previewPlaybackInterval = null; // Interval for simulating playback

const getPreviewContainer = () => {
    if (!previewLyricsContainer) {
        previewLyricsContainer = document.getElementById('lyrics-plus-container-preview');
    }
    return previewLyricsContainer;
};

const onPreviewLyricClick = e => {
    const time = parseFloat(e.currentTarget.dataset.startTime);
    previewCurrentTime = time * 1000; // Update mock time
    startPreviewLyricsSync(); // Restart sync from new time
};

const isRTL = text => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);

const GAP_THRESHOLD = 7; // seconds
function createPreviewGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    const gapLine = document.createElement('div');
    gapLine.className = 'lyrics-line lyrics-gap';
    gapLine.dataset.startTime = gapStart;
    gapLine.dataset.endTime = gapEnd;
    
    gapLine.addEventListener('click', onPreviewLyricClick);

    if (classesToInherit) {
      if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
      if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
      if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-vocal-container';
    
    for (let i = 0; i < 3; i++) {
      const syllableSpan = document.createElement('span');
      syllableSpan.className = 'lyrics-syllable';
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = ((gapDuration / 3) / 0.9) * 1000;
      syllableSpan.dataset.startTime = syllableStart;
      syllableSpan.dataset.duration = syllableDuration;
      syllableSpan.dataset.endTime = syllableStart + syllableDuration;
      syllableSpan.textContent = "•";
      syllableSpan.addEventListener('click', onPreviewLyricClick);
      mainContainer.appendChild(syllableSpan);
    }
    
    gapLine.appendChild(mainContainer);
    return gapLine;
}

function displayPreviewLyrics(lyrics, source = "Unknown", type = "Syllable", lightweight = false, songWriters) {
    const container = getPreviewContainer();
    if (!container) return;
    
    container.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    
    if (type !== "Line") {
        let currentLine = document.createElement('div');
        currentLine.classList.add('lyrics-line');
        let mainContainer = document.createElement('div');
        mainContainer.classList.add('main-vocal-container');
        currentLine.appendChild(mainContainer);
        let backgroundContainer = null;
        fragment.appendChild(currentLine);

        let lineSinger = null,
            lineStartTime = null,
            lineEndTime = null,
            wordBuffer = [];

        const flushWordBuffer = () => {
            if (!wordBuffer.length) return;
        
            const getComputedFont = (element) => {
                if (!element) return '400 16px sans-serif';
                const cacheKey = element.tagName + (element.className || '');
                if (previewFontCache[cacheKey]) return previewFontCache[cacheKey];
                
                const style = getComputedStyle(element);
                const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                previewFontCache[cacheKey] = font;
                return font;
            };
        
            const wordSpan = document.createElement('span');
            wordSpan.classList.add('lyrics-word');
            
            let referenceFont = mainContainer.firstChild ? 
                                getComputedFont(mainContainer.firstChild) : 
                                '400 16px sans-serif';
        
            const combinedText = wordBuffer.map(s => s.text).join('');
            const trimmedText = combinedText.trim();
            const textLength = trimmedText.length;
            const totalDuration = wordBuffer.reduce((sum, s) => sum + s.duration, 0);
        
            const shouldEmphasize = !lightweight &&
                !isRTL(combinedText) &&
                trimmedText.length <= 7 &&
                trimmedText.length > 1 &&
                totalDuration >= 1000;
        
            const durationFactor = Math.min(1.0, Math.max(0.5, (totalDuration - 1000) / 1000));
            
            let baseMinScale = 1.02;
            let baseMaxScale = 1;
        
            const durationScaleFactor = durationFactor * 0.15;
            baseMaxScale += durationScaleFactor;
        
            const maxScale = Math.min(1.2, baseMaxScale);
            const minScale = Math.max(1.0, Math.min(1.06, baseMinScale));
        
            const shadowIntensity = Math.min(0.8, 0.4 + (durationFactor * 0.4));
            const translateYPeak = -Math.min(3.0, 0.0 + (durationFactor * 3.0));
        
            wordSpan.style.setProperty('--max-scale', maxScale);
            wordSpan.style.setProperty('--min-scale', minScale);
            wordSpan.style.setProperty('--shadow-intensity', shadowIntensity);
            wordSpan.style.setProperty('--translate-y-peak', translateYPeak);
            wordSpan.dataset.totalDuration = totalDuration;
        
            const backgroundWordSpan = document.createElement('span');
            backgroundWordSpan.classList.add('lyrics-word');
        
            let hasBackgroundSyllables = false;
            const characterData = [];
        
            const syllableFragment = document.createDocumentFragment();
            const backgroundSyllableFragment = document.createDocumentFragment();
            
            wordBuffer.forEach((s, syllableIndex) => {
                const sylSpan = document.createElement('span');
                sylSpan.classList.add('lyrics-syllable');
                sylSpan.dataset.startTime = s.startTime;
                sylSpan.dataset.duration = s.duration;
                sylSpan.dataset.endTime = s.startTime + s.duration;
                sylSpan.dataset.wordDuration = totalDuration;
                sylSpan.dataset.syllableIndex = syllableIndex;
                
                sylSpan.addEventListener('click', onPreviewLyricClick);
            
                const isRtlText = isRTL(s.text);
                if (isRtlText) {
                    sylSpan.classList.add('rtl-text');
                }
            
                if (shouldEmphasize && !(s.element.isBackground)) {
                    wordSpan.classList.add('growable');
                    let charIndex = 0;
                    
                    const textNodes = [];
                    for (const char of s.text) {
                        if (char === ' ') {
                            textNodes.push(document.createTextNode(' '));
                        } else {
                            const charSpan = document.createElement('span');
                            charSpan.textContent = char;
                            charSpan.classList.add('char');
                            charSpan.dataset.charIndex = charIndex++;
                            charSpan.dataset.syllableCharIndex = characterData.length;
                            
                            characterData.push({
                                charSpan,
                                syllableSpan: sylSpan,
                                isBackground: s.element.isBackground
                            });
                            
                            textNodes.push(charSpan);
                        }
                    }
                    
                    textNodes.forEach(node => sylSpan.appendChild(node));
                } else {
                    sylSpan.textContent = s.element.isBackground ? s.text.replace(/[()]/g, '') : s.text;
                }
            
                if (s.element.isBackground) {
                    hasBackgroundSyllables = true;
                    backgroundSyllableFragment.appendChild(sylSpan);
                } else {
                    syllableFragment.appendChild(sylSpan);
                }
            });
            
            wordSpan.appendChild(syllableFragment);
            mainContainer.appendChild(wordSpan);
            
            if (shouldEmphasize && characterData.length > 0) {
                const fullWordText = wordSpan.textContent;
                const wordWidth = getTextWidth(fullWordText, referenceFont);
            
                let cumulativeWidth = 0;
                characterData.forEach((charData) => {
                    if (charData.isBackground) return;
            
                    const span = charData.charSpan;
                    const charText = span.textContent;
                    const charWidth = getTextWidth(charText, referenceFont);
                    const charCenter = cumulativeWidth + (charWidth / 2);
                    const position = charCenter / wordWidth;
            
                    const relativePosition = (position - 0.5) * 2;
                    const scaleOffset = maxScale - 1.0;
                    const horizontalOffsetFactor = scaleOffset * 40;
                    const horizontalOffset = Math.sign(relativePosition) *
                        Math.pow(Math.abs(relativePosition), 1.3) *
                        horizontalOffsetFactor;
            
                    span.dataset.horizontalOffset = horizontalOffset;
                    span.dataset.position = position;
            
                    cumulativeWidth += charWidth;
                });
            }
        
            if (hasBackgroundSyllables) {
                if (!backgroundContainer) {
                    backgroundContainer = document.createElement('div');
                    backgroundContainer.classList.add('background-vocal-container');
                    currentLine.appendChild(backgroundContainer);
                }
                backgroundWordSpan.appendChild(backgroundSyllableFragment);
                backgroundContainer.appendChild(backgroundWordSpan);
            }
        
            wordBuffer = [];
        };

        const CHUNK_SIZE = 50;
        for (let i = 0; i < lyrics.data.length; i += CHUNK_SIZE) {
            const chunk = lyrics.data.slice(i, i + CHUNK_SIZE);
            
            chunk.forEach((s, chunkIndex) => {
                const dataIndex = i + chunkIndex;
                
                if (lineSinger === null) lineSinger = s.element.singer;
                lineStartTime =
                    lineStartTime === null ? s.startTime : Math.min(lineStartTime, s.startTime);
                lineEndTime =
                    lineEndTime === null
                        ? s.startTime + s.duration
                        : Math.max(lineEndTime, s.startTime + s.duration);
                const lineRTL = isRTL(s.text);
        
                wordBuffer.push(s);
                if (/\s$/.test(s.text) || s.isLineEnding || dataIndex === lyrics.data.length - 1) {
                    flushWordBuffer();
                }
        
                if (s.isLineEnding || dataIndex === lyrics.data.length - 1) {
                    currentLine.dataset.startTime = lineStartTime / 1000;
                    currentLine.dataset.endTime = lineEndTime / 1000;
                    
                    currentLine.addEventListener('click', onPreviewLyricClick);
                    
                    currentLine.classList.add(
                        lineSinger === "v2" || lineSinger === "v2000" ? 'singer-right' : 'singer-left'
                    );
                    if (lineRTL) currentLine.classList.add('rtl-text');
        
                    if (dataIndex !== lyrics.data.length - 1) {
                        currentLine = document.createElement('div');
                        currentLine.classList.add('lyrics-line');
                        mainContainer = document.createElement('div');
                        mainContainer.classList.add('main-vocal-container');
                        currentLine.appendChild(mainContainer);
                        backgroundContainer = null;
                        fragment.appendChild(currentLine);
                        lineSinger = null;
                    }
                    lineStartTime = lineEndTime = null;
                }
            });
        }
        
        flushWordBuffer();

        const lines = Array.from(fragment.querySelectorAll('.lyrics-line'));
        if (lines.length && !lines[lines.length - 1].dataset.startTime) {
            const lastLine = lines[lines.length - 1];
            if (lastLine.parentNode === fragment) {
                fragment.removeChild(lastLine);
            }
        }
    } else {
        const lineFragment = document.createDocumentFragment();
        
        lyrics.data.forEach(line => {
            const lineDiv = document.createElement('div');
            lineDiv.dataset.startTime = line.startTime;
            lineDiv.dataset.endTime = line.endTime;
            lineDiv.classList.add('lyrics-line');
            lineDiv.classList.add(line.element.singer === "v2" ? 'singer-right' : 'singer-left');
            
            const mainContainer = document.createElement('div');
            mainContainer.classList.add('main-vocal-container');
            mainContainer.textContent = line.text;
            lineDiv.appendChild(mainContainer);
            
            if (isRTL(line.text)) lineDiv.classList.add('rtl-text');
            
            lineDiv.addEventListener('click', onPreviewLyricClick);
            
            lineFragment.appendChild(lineDiv);
        });
        
        fragment.appendChild(lineFragment);
    }

    container.appendChild(fragment);

    const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
    if (originalLines.length > 0) {
        const firstLine = originalLines[0];
        const firstStartTime = parseFloat(firstLine.dataset.startTime);

        if (firstStartTime >= GAP_THRESHOLD) {
            const classesToInherit = [];
            if (firstLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
            if (firstLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
            if (firstLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

            const beginningGap = createPreviewGapLine(0, firstStartTime - 0.85, classesToInherit);
            container.insertBefore(beginningGap, firstLine);
        }
    }

    const gapLinesToInsert = [];
    
    originalLines.forEach((line, index) => {
        if (index < originalLines.length - 1) {
            const nextLine = originalLines[index + 1];
            const currentEnd = parseFloat(line.dataset.endTime);
            const nextStart = parseFloat(nextLine.dataset.startTime);
            if (nextStart - currentEnd >= GAP_THRESHOLD) {
                const classesToInherit = [];
                if (nextLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
                if (nextLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
                if (nextLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

                const gapLine = createPreviewGapLine(currentEnd + 0.4, nextStart - 0.85, classesToInherit);
                gapLinesToInsert.push({ gapLine, nextLine });
            }
        }
    });
    
    gapLinesToInsert.forEach(({ gapLine, nextLine }) => {
        container.insertBefore(gapLine, nextLine);
    });

    originalLines.forEach((line, idx) => {
        if (idx < originalLines.length - 1) {
            const currentEnd = parseFloat(line.dataset.endTime);
            const nextLine = originalLines[idx + 1];
            const nextStart = parseFloat(nextLine.dataset.startTime);
            const nextEnd = parseFloat(nextLine.dataset.endTime);
            const gap = nextStart - currentEnd;

            const nextElement = line.nextElementSibling;
            const isFollowedByGap = nextElement && nextElement.classList.contains('lyrics-gap');

            if (gap >= 0 && !isFollowedByGap) {
                const extension = Math.min(0.5, gap);
                line.dataset.endTime = (currentEnd + extension).toFixed(3);

                for (let i = 0; i < idx; i++) {
                    if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
                        originalLines[i].dataset.endTime = line.dataset.endTime;
                    }
                }
            } else if (gap < 0) {
                line.dataset.endTime = nextEnd.toFixed(3);

                for (let i = 0; i < idx; i++) {
                    if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
                        originalLines[i].dataset.endTime = nextEnd.toFixed(3);
                    }
                }
            }
        }
    });

    const metadataFragment = document.createDocumentFragment();
    
    if (songWriters) {
        const songWritersDiv = document.createElement('span');
        songWritersDiv.classList.add('lyrics-song-writters');
        songWritersDiv.innerText = `${t("writtenBy")} ${songWriters.join(', ')}`;
        metadataFragment.appendChild(songWritersDiv);
    }

    const sourceDiv = document.createElement('span');
    sourceDiv.classList.add('lyrics-source-provider');
    sourceDiv.innerText = `${t("source")} ${source}`;
    metadataFragment.appendChild(sourceDiv);
    
    container.appendChild(metadataFragment);

    previewCachedLyricsLines = Array.from(container.getElementsByClassName('lyrics-line'));
    previewCachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable'));

    ensurePreviewElementIds();

    previewActiveLineIds.clear();
    previewHighlightedSyllableIds.clear();
    previewVisibleLineIds.clear();
    previewCurrentPrimaryActiveLine = null;

    if (previewCachedLyricsLines.length !== 0) {
        scrollPreviewActiveLine(previewCachedLyricsLines[0], true);
    }


}

function cleanupPreviewLyrics() {
    if (previewAnimationFrameId) {
        cancelAnimationFrame(previewAnimationFrameId);
        previewAnimationFrameId = null;
    }
    if (previewPlaybackInterval) {
        clearInterval(previewPlaybackInterval);
        previewPlaybackInterval = null;
    }
    
    const container = getPreviewContainer();
    if (container) {
        container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
    }

    previewActiveLineIds.clear();
    previewHighlightedSyllableIds.clear();
    previewVisibleLineIds.clear();
    previewCurrentPrimaryActiveLine = null;
    
    if (previewVisibilityObserver) {
        previewVisibilityObserver.disconnect();
    }
}

function updatePreviewLyricsHighlight(currentTime, isForceScroll = false) {
    if (!previewCachedLyricsLines || !previewCachedLyricsLines.length) return;

    let newActiveLineIds = new Set();
    let activeLines = [];

    previewCachedLyricsLines.forEach(line => {
        if (!line) return;

        const lineStart = parseFloat(line.dataset.startTime) * 1000;
        const lineEnd = parseFloat(line.dataset.endTime) * 1000;
        const shouldBeActive = currentTime >= lineStart - 190 && currentTime <= lineEnd - 1;

        if (shouldBeActive) {
            newActiveLineIds.add(line.id);
            activeLines.push(line);
        }
    });

    activeLines.sort((a, b) =>
        parseFloat(b.dataset.startTime) - parseFloat(a.dataset.startTime)
    );

    const allowedActiveLines = activeLines.slice(0, 2);
    const allowedActiveIds = new Set(allowedActiveLines.map(line => line.id));

    previewCachedLyricsLines.forEach(line => {
        if (!line) return;

        const wasActive = line.classList.contains('active');
        const shouldBeActive = allowedActiveIds.has(line.id);

        if (shouldBeActive && !wasActive) {
            line.classList.add('active');

            if (
                !previewCurrentPrimaryActiveLine ||
                (currentTime >= previewLastTime &&
                    parseFloat(line.dataset.startTime) > parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime)) ||
                (currentTime < previewLastTime &&
                    parseFloat(line.dataset.startTime) < parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime))
            ) {
                scrollPreviewActiveLine(line, isForceScroll);
                previewCurrentPrimaryActiveLine = line;
            }
        } else if (!shouldBeActive && wasActive) {
            line.classList.remove('active');
            resetPreviewSyllables(line);
        }
    });

    previewActiveLineIds = allowedActiveIds;

    updatePreviewSyllables(currentTime);
}

function updatePreviewSyllables(currentTime) {
    if (!previewCachedSyllables) return;

    let newHighlightedSyllableIds = new Set();

    previewCachedSyllables.forEach(syllable => {
        if (!syllable) return;

        const parentLine = syllable.closest('.lyrics-line');
        if (!parentLine || !parentLine.classList.contains('active')) {
            if (syllable.classList.contains('highlight')) {
                resetPreviewSyllable(syllable);
            }
            return;
        }

        const startTime = parseFloat(syllable.dataset.startTime);
        const duration = parseFloat(syllable.dataset.duration);
        const endTime = startTime + duration;

        if (currentTime >= startTime && currentTime <= endTime) {
            newHighlightedSyllableIds.add(syllable.id);

            if (!syllable.classList.contains('highlight')) {
                updatePreviewSyllableAnimation(syllable, currentTime);
            }
        } else if (currentTime < startTime && syllable.classList.contains('highlight')) {
            resetPreviewSyllable(syllable);
        } else if (currentTime > startTime && !syllable.classList.contains('finished')) {
            syllable.classList.add('finished');
        } else if (currentTime > startTime && !syllable.classList.contains('highlight')) {
            updatePreviewSyllableAnimation(syllable, startTime);
        }
    });

    previewHighlightedSyllableIds = newHighlightedSyllableIds;
}

function updatePreviewSyllableAnimation(syllable, currentTime) {
    if (syllable.classList.contains('highlight')) return;

    const startTime = Number(syllable.dataset.startTime);
    const duration = Number(syllable.dataset.duration);
    const endTime = startTime + duration;

    if (currentTime < startTime || currentTime > endTime) return;

    let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
    const charSpans = syllable.querySelectorAll('span.char');

    syllable.classList.add('highlight');

    if (charSpans.length > 0) {
        const charCount = charSpans.length;
        const wordElement = syllable.closest('.lyrics-word');
        const finalDuration = Number(syllable.dataset.wordDuration) || duration;

        const allCharsInWord = wordElement ? wordElement.querySelectorAll('span.char') : charSpans;
        const totalChars = allCharsInWord.length;

        if (totalChars > 0) {
            const spans = Array.from(allCharsInWord);
            const baseDelayPerChar = finalDuration * 0.07;

            for (let i = 0; i < spans.length; i++) {
                const span = spans[i];
                const spanSyllable = span.closest('.lyrics-syllable');
                const isCurrentSyllable = spanSyllable === syllable;

                const horizontalOffset = span.dataset.horizontalOffset || 0;
                span.style.setProperty('--char-offset-x', `${horizontalOffset}`);

                const charIndex = Number(span.dataset.syllableCharIndex || i);
                const growDelay = baseDelayPerChar * charIndex;

                if (isCurrentSyllable) {
                    const charIndexInSyllable = Array.from(charSpans).indexOf(span);
                    const wipeDelay = (duration / charCount) * charIndexInSyllable;

                    span.style.animation = `${wipeAnimation} ${duration / charCount}ms linear ${wipeDelay}ms forwards, 
                                            grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
                } else if (!spanSyllable.classList.contains('highlight')) {
                    span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
                }
            }
        }
    } else {
        if (syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
            wipeAnimation = "fade-gap";
        }
        syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
    }
}

function resetPreviewSyllable(syllable) {
    if (!syllable) return;

    syllable.style.animation = '';
    syllable.classList.remove('highlight');
    syllable.classList.remove('finished');

    const charSpans = syllable.querySelectorAll('span.char');
    charSpans.forEach(span => {
        span.style.animation = '';
    });
}

function resetPreviewSyllables(line) {
    if (!line) return;

    const syllables = line.getElementsByClassName('lyrics-syllable');
    for (let i = 0; i < syllables.length; i++) {
        resetPreviewSyllable(syllables[i]);
    }
}

function scrollPreviewActiveLine(activeLine, forceScroll = false) {
    const container = getPreviewContainer();
    if (!container) return;

    const scrollContainer = container; // In preview, the container itself is scrollable
    if (!scrollContainer) return;

    const scrollContainerRect = scrollContainer.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();

    const safeAreaTop = scrollContainerRect.top + scrollContainerRect.height * 0.15;
    const safeAreaBottom = scrollContainerRect.top + scrollContainerRect.height * 0.95;

    if (lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom || forceScroll) {
        activeLine.scrollIntoView({
            behavior: 'smooth',
            block: 'center' // Center the active line in the preview
        });
    }
}

function getTextWidth(text, font) {
    const cacheKey = `${text}_${font}`;
    if (previewFontCache[cacheKey]) return previewFontCache[cacheKey];
    
    if (!previewTextWidthCanvas) {
        previewTextWidthCanvas = document.createElement("canvas");
    }
    
    const context = previewTextWidthCanvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(text);
    
    previewFontCache[cacheKey] = metrics.width;
    return metrics.width;
}

function getCssStyle(element, prop) {
    if (element.style[prop]) return element.style[prop];
    return getComputedStyle(element, null).getPropertyValue(prop);
}

function getCanvasFont(el = document.body) {
    const cacheKey = el.tagName + (el.className || '');
    if (previewFontCache[cacheKey]) return previewFontCache[cacheKey];
    
    const fontWeight = getCssStyle(el, 'font-weight') || 'normal';
    const fontSize = getCssStyle(el, 'font-size') || '16px';
    const fontFamily = getCssStyle(el, 'font-family') || 'Times New Roman';
    
    const font = `${fontWeight} ${fontSize} ${fontFamily}`;
    previewFontCache[cacheKey] = font;
    return font;
}

function ensurePreviewElementIds() {
    if (!previewCachedLyricsLines || !previewCachedSyllables) return;

    previewCachedLyricsLines.forEach((line, i) => {
        if (!line.id) line.id = `preview-line-${i}`;
    });

    previewCachedSyllables.forEach((syllable, i) => {
        if (!syllable.id) syllable.id = `preview-syllable-${i}`;
    });
}

function startPreviewLyricsSync() {
    cleanupPreviewLyrics(); // Stop any existing sync and clear content
    displayPreviewLyrics(mockLyricsData, mockLyricsData.metadata.source, mockLyricsData.type, currentSettings.lightweight, mockLyricsData.metadata.artist);

    previewLastTime = previewCurrentTime;

    if (previewAnimationFrameId) {
        cancelAnimationFrame(previewAnimationFrameId);
    }
    if (previewPlaybackInterval) {
        clearInterval(previewPlaybackInterval);
    }

    function syncPreview() {
        const timeDelta = Math.abs(previewCurrentTime - previewLastTime);
        const isForceScroll = timeDelta > 1000;

        updatePreviewLyricsHighlight(previewCurrentTime, isForceScroll);

        previewLastTime = previewCurrentTime;
        previewAnimationFrameId = requestAnimationFrame(syncPreview);
    }

    previewAnimationFrameId = requestAnimationFrame(syncPreview);

    // Simulate playback
    previewPlaybackInterval = setInterval(() => {
        previewCurrentTime += 100; // Advance time by 100ms
        if (previewCurrentTime > mockLyricsData.metadata.duration * 1000 + 2000) { // Loop after 2 seconds past end
            cleanupPreviewLyrics(); // Stop current playback and clear UI
            previewCurrentTime = 0; // Reset time
            startPreviewLyricsSync(); // Restart the entire preview sync process
        }
    }, 100); // Update every 100ms
}

document.getElementById('play-example').addEventListener('click', () => {
    startPreviewLyricsSync();
});
