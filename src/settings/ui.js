import { loadSettings, saveSettings, updateSettings, getSettings, updateCacheSize, clearCache, setupSettingsMessageListener, uploadLocalLyrics, getLocalLyricsList, deleteLocalLyrics } from './settingsManager.js';
import { parseSyncedLyrics, parseAppleTTML, convertToStandardJson, v1Tov2 } from '../lib/parser.js';

let currentSettings = getSettings();

const RESTART_REQUIRED_KEYS = [
    'isEnabled',
    'YTSongInfo',
    'dynamicPlayer'
];

const SUPPORTED_PLATFORMS = [
    { name: 'YouTube Music', url: "*://music.youtube.com/*" },
    { name: 'Apple Music', url: "*://music.apple.com/*" },
    { name: 'Tidal', url: "*://listen.tidal.com/*" }
];

async function getAvailableTabs() {
    return new Promise((resolve) => {
        let results = [];
        let checkedCount = 0;

        SUPPORTED_PLATFORMS.forEach(platform => {
            chrome.tabs.query({ url: platform.url }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    results.push({ ...platform, tabs });
                }
                checkedCount++;
                if (checkedCount === SUPPORTED_PLATFORMS.length) {
                    resolve(results);
                }
            });
        });
    });
}

async function showReloadNotification(changedKey) {
    if (changedKey && !RESTART_REQUIRED_KEYS.includes(changedKey)) {
        return;
    }

    const availablePlatforms = await getAvailableTabs();
    const notification = document.getElementById('reload-notification');
    const notificationText = document.getElementById('notification-text');
    const reloadBtnText = document.getElementById('reload-button-text');

    if (notification && notificationText) {
        if (availablePlatforms.length > 0) {
            const names = availablePlatforms.map(p => p.name);
            let platformString = names.length > 1
                ? names.slice(0, -1).join(', ') + ' & ' + names.slice(-1)
                : names[0];

            notificationText.innerHTML = `Settings saved. Restart <strong>${platformString}</strong> for changes to take effect.`;
            if (reloadBtnText) reloadBtnText.textContent = `Restart ${availablePlatforms.length > 1 ? 'Tabs' : names[0]}`;
        } else {
            notificationText.textContent = 'Settings saved. Restart your music tab for changes to take effect.';
            if (reloadBtnText) reloadBtnText.textContent = 'Restart';
        }
        notification.style.display = 'flex';
    }
}

function hideReloadNotification() {
    const notification = document.getElementById('reload-notification');
    if (notification) {
        notification.style.display = 'none';
    }
}

// Debounce function to limit the frequency of function execution
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function setupAutoSaveListeners() {
    const autoSaveControls = [
        // General
        { id: 'enabled', key: 'isEnabled', type: 'checkbox' },
        { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
        { id: 'ytsonginfo', key: 'YTSongInfo', type: 'checkbox' },
        { id: 'sponsor-block', key: 'useSponsorBlock', type: 'checkbox' },
        { id: 'bypass-apple', key: 'appleMusicTTMLBypass', type: 'checkbox' },

        // Sources
        { id: 'default-provider', key: 'lyricsProvider', type: 'value' },
        { id: 'custom-kpoe-url', key: 'customKpoeUrl', type: 'value', debounce: 500 },

        // Translation
        { id: 'translation-provider', key: 'translationProvider', type: 'value' },
        { id: 'gemini-api-key', key: 'geminiApiKey', type: 'value', debounce: 500 },
        { id: 'gemini-model', key: 'geminiModel', type: 'value' },
        { id: 'openrouter-api-key', key: 'openRouterApiKey', type: 'value', debounce: 500 },
        { id: 'openrouter-model', key: 'openRouterModel', type: 'value', debounce: 500 },
        { id: 'romanization-provider', key: 'romanizationProvider', type: 'value' },
        { id: 'gemini-romanization-model', key: 'geminiRomanizationModel', type: 'value' },
        { id: 'override-translate-target', key: 'overrideTranslateTarget', type: 'checkbox' },
        { id: 'custom-translate-target', key: 'customTranslateTarget', type: 'value', debounce: 500 },
        { id: 'override-gemini-prompt', key: 'overrideGeminiPrompt', type: 'checkbox' },
        { id: 'custom-gemini-prompt', key: 'customGeminiPrompt', type: 'value', debounce: 500 },
        { id: 'override-gemini-romanize-prompt', key: 'overrideGeminiRomanizePrompt', type: 'checkbox' },
        { id: 'custom-gemini-romanize-prompt', key: 'customGeminiRomanizePrompt', type: 'value', debounce: 500 },

        // Appearance
        { id: 'larger-text-mode', key: 'largerTextMode', type: 'value' },
        { id: 'lightweight', key: 'lightweight', type: 'checkbox' },
        { id: 'hide-offscreen', key: 'hideOffscreen', type: 'checkbox' },
        { id: 'blur-inactive', key: 'blurInactive', type: 'checkbox' },
        { id: 'dynamic-player', key: 'dynamicPlayer', type: 'checkbox' },
        { id: 'useSongPaletteFullscreen', key: 'useSongPaletteFullscreen', type: 'checkbox' },
        { id: 'useSongPaletteAllModes', key: 'useSongPaletteAllModes', type: 'checkbox' },
        { id: 'overridePaletteColor', key: 'overridePaletteColor', type: 'value', debounce: 500 },
        { id: 'custom-css', key: 'customCSS', type: 'value', debounce: 800 },

        // Cache
        { id: 'cache-strategy', key: 'cacheStrategy', type: 'value' },
    ];

    autoSaveControls.forEach(control => {
        const element = document.getElementById(control.id);
        if (element) {
            const eventType = (control.type === 'checkbox' || element.tagName === 'SELECT') ? 'change' : 'input';
            const saveHandler = (e) => {
                const value = control.type === 'checkbox' ? e.target.checked : e.target.value;
                updateSettings({ [control.key]: value });
                saveSettings();
                showReloadNotification(control.key);

                // Show a small "Saved" indicator near the element if possible, 
                // or just rely on the reload notification which is prominent properly.
                // For now, we'll just log it.
                console.log(`Auto-saved ${control.key}: ${value}`);
            };

            if (control.debounce) {
                element.addEventListener(eventType, debounce(saveHandler, control.debounce));
            } else {
                element.addEventListener(eventType, saveHandler);
            }
        }
    });
}

function updateUI(settings) {
    currentSettings = settings;
    console.log("Updating UI with settings:", currentSettings);

    // Helper to safely set element value
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val !== undefined ? val : '';
    };
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    };

    // General
    setCheck('enabled', currentSettings.isEnabled);
    setCheck('wordByWord', currentSettings.wordByWord);
    setCheck('ytsonginfo', currentSettings.YTSongInfo);
    setCheck('sponsor-block', currentSettings.useSponsorBlock);
    setCheck('bypass-apple', currentSettings.appleMusicTTMLBypass);

    // Sources
    setVal('default-provider', currentSettings.lyricsProvider);
    updateCustomSelectDisplay('default-provider');
    setVal('custom-kpoe-url', currentSettings.customKpoeUrl);

    // Translation
    setVal('translation-provider', currentSettings.translationProvider);
    updateCustomSelectDisplay('translation-provider');
    setVal('gemini-api-key', currentSettings.geminiApiKey);
    document.getElementById('gemini-api-key').type = 'password';
    setVal('gemini-model', currentSettings.geminiModel || 'gemini-1.5-flash');
    updateCustomSelectDisplay('gemini-model');
    setVal('openrouter-api-key', currentSettings.openRouterApiKey);
    setVal('openrouter-model', currentSettings.openRouterModel);

    setVal('romanization-provider', currentSettings.romanizationProvider);
    updateCustomSelectDisplay('romanization-provider');
    setVal('gemini-romanization-model', currentSettings.geminiRomanizationModel || 'gemini-1.5-pro-latest');
    updateCustomSelectDisplay('gemini-romanization-model');

    setCheck('override-translate-target', currentSettings.overrideTranslateTarget);
    setVal('custom-translate-target', currentSettings.customTranslateTarget);
    setCheck('override-gemini-prompt', currentSettings.overrideGeminiPrompt);
    setVal('custom-gemini-prompt', currentSettings.customGeminiPrompt);
    setCheck('override-gemini-romanize-prompt', currentSettings.overrideGeminiRomanizePrompt);
    setVal('custom-gemini-romanize-prompt', currentSettings.customGeminiRomanizePrompt);

    // Appearance
    setVal('larger-text-mode', currentSettings.largerTextMode);
    updateCustomSelectDisplay('larger-text-mode');
    setCheck('lightweight', currentSettings.lightweight);
    setCheck('hide-offscreen', currentSettings.hideOffscreen);
    setCheck('blur-inactive', currentSettings.blurInactive);
    setCheck('dynamic-player', currentSettings.dynamicPlayer);
    setCheck('useSongPaletteFullscreen', currentSettings.useSongPaletteFullscreen);
    setCheck('useSongPaletteAllModes', currentSettings.useSongPaletteAllModes);
    setVal('overridePaletteColor', currentSettings.overridePaletteColor);
    setVal('custom-css', currentSettings.customCSS);

    // Cache
    setVal('cache-strategy', currentSettings.cacheStrategy);
    updateCustomSelectDisplay('cache-strategy');

    // Visibility Toggles
    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
    toggleGeminiSettingsVisibility();
    toggleOpenRouterSettingsVisibility();
    toggleTranslateTargetVisibility();
    toggleGeminiPromptVisibility();
    toggleGeminiRomanizePromptVisibility();
    toggleRomanizationModelVisibility();

    populateDraggableSources();
    updateCacheSize();
    populateLocalLyricsList();
}

document.querySelectorAll('.navigation-drawer .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.navigation-drawer .nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const sectionId = item.getAttribute('data-section');
        document.querySelectorAll('.settings-card').forEach(section => section.classList.remove('active'));
        document.getElementById(sectionId)?.classList.add('active');
    });
});

document.getElementById('clear-cache').addEventListener('click', clearCache);

setupSettingsMessageListener(updateUI);

let draggedItem = null;

function getSourceDisplayName(sourceName) {
    switch (sourceName) {
        case 'lyricsplus': return 'Lyrics+ (User Gen.)';
        case 'apple': return 'Apple Music';
        case 'spotify': return 'Musixmatch (Spotify)';
        case 'musixmatch': return 'Musixmatch (Direct)';
        case 'musixmatch-word': return 'Musixmatch (Word)';
        default: return sourceName.charAt(0).toUpperCase() + sourceName.slice(1).replace('-', ' ');
    }
}

function createDraggableSourceItem(sourceName) {
    const item = document.createElement('div');
    item.className = 'draggable-source-item';
    item.setAttribute('draggable', 'true');
    item.dataset.source = sourceName;
    item.innerHTML = `
        <span class="material-symbols-outlined drag-handle">drag_indicator</span>
        <span class="source-name">${getSourceDisplayName(sourceName)}</span>
        <button class="m3-button icon remove-source-button" title="Remove source">
            <span class="material-symbols-outlined">delete</span>
        </button>
    `;
    item.querySelector('.remove-source-button').addEventListener('click', (e) => {
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

    draggableContainer.innerHTML = '';
    availableSourcesDropdown.innerHTML = '<option value="" disabled selected></option>';

    const currentActiveSources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    currentActiveSources.forEach(source => {
        if (allowedSources.includes(source.trim())) {
            draggableContainer.appendChild(createDraggableSourceItem(source.trim()));
        }
    });

    const sourcesToAdd = allowedSources.filter(source => !currentActiveSources.includes(source));
    const addSourceButton = document.getElementById('add-source-button');

    if (sourcesToAdd.length === 0) {
        availableSourcesDropdown.innerHTML = '<option value="" disabled>All sources added</option>';
        if (addSourceButton) addSourceButton.disabled = true;
    } else {
        if (addSourceButton) addSourceButton.disabled = false;
        sourcesToAdd.forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = getSourceDisplayName(source);
            availableSourcesDropdown.appendChild(option);
        });
    }
    updateCustomSelectDisplay('available-sources-dropdown');
    addDragDropListeners();
    addTouchListeners();
}

let statusMessageTimeout = {};

function showStatusMessage(elementId, message, isError = false) {
    const targetStatusElement = document.getElementById(elementId);
    if (!targetStatusElement) return;

    clearTimeout(statusMessageTimeout[elementId]);
    targetStatusElement.textContent = message;
    targetStatusElement.style.color = isError ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)';
    targetStatusElement.style.opacity = '1';

    statusMessageTimeout[elementId] = setTimeout(() => {
        targetStatusElement.style.opacity = '0';
        setTimeout(() => { targetStatusElement.textContent = ''; }, 300);
    }, 3000);
}

function saveSourceOrder() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer) return;

    const orderedSources = Array.from(draggableContainer.children)
        .map(item => item.dataset.source);

    updateSettings({
        lyricsSourceOrder: orderedSources.join(',')
    });
    saveSettings();
    showReloadNotification('lyricsSourceOrder');
}

function addSource() {
    const sourceName = document.getElementById('available-sources-dropdown').value;
    if (!sourceName) {
        showStatusMessage('add-source-status', 'Please select a source to add.', true);
        return;
    }

    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    if (sources.includes(sourceName)) {
        showStatusMessage('add-source-status', `Source "${getSourceDisplayName(sourceName)}" already exists.`, true);
        return;
    }

    sources.push(sourceName);
    currentSettings.lyricsSourceOrder = sources.join(',');
    updateSettings({ lyricsSourceOrder: currentSettings.lyricsSourceOrder });
    saveSettings();
    showReloadNotification('lyricsSourceOrder');

    populateDraggableSources();
    showStatusMessage('add-source-status', `"${getSourceDisplayName(sourceName)}" added.`, false);
}

function removeSource(sourceName) {
    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    currentSettings.lyricsSourceOrder = sources.filter(s => s !== sourceName).join(',');

    // Auto-save immediately
    updateSettings({ lyricsSourceOrder: currentSettings.lyricsSourceOrder });
    saveSettings();
    showReloadNotification('lyricsSourceOrder');

    populateDraggableSources();
    showStatusMessage('add-source-status', `"${getSourceDisplayName(sourceName)}" removed.`, false);
}

function addDragDropListeners() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer || draggableContainer.dataset.dragListenersAttached) return;

    const onDragEnd = () => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
        saveSourceOrder();
    };

    draggableContainer.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('draggable-source-item')) {
            draggedItem = e.target;
            setTimeout(() => draggedItem?.classList.add('dragging'), 0);
        }
    });

    draggableContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(draggableContainer, e.clientY);
        const currentDraggable = document.querySelector('.draggable-source-item.dragging');
        if (currentDraggable) {
            if (afterElement) {
                draggableContainer.insertBefore(currentDraggable, afterElement);
            } else {
                draggableContainer.appendChild(currentDraggable);
            }
        }
    });

    draggableContainer.addEventListener('dragend', onDragEnd);
    draggableContainer.dataset.dragListenersAttached = 'true';
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

function addTouchListeners() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer || draggableContainer.dataset.touchListenersAttached) return;

    let touchDraggedItem = null;
    let initialY = 0;
    let currentY = 0;
    let yOffset = 0;

    draggableContainer.addEventListener('touchstart', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;

        const item = handle.closest('.draggable-source-item');
        if (!item) return;

        e.preventDefault();

        touchDraggedItem = item;
        touchDraggedItem.classList.add('dragging');

        touchDraggedItem.style.opacity = '0.5';
    }, { passive: false });

    draggableContainer.addEventListener('touchmove', (e) => {
        if (!touchDraggedItem) return;
        e.preventDefault();

        const touchLocation = e.targetTouches[0];
        const afterElement = getDragAfterElement(draggableContainer, touchLocation.clientY);

        if (afterElement) {
            draggableContainer.insertBefore(touchDraggedItem, afterElement);
        } else {
            draggableContainer.appendChild(touchDraggedItem);
        }
    }, { passive: false });

    draggableContainer.addEventListener('touchend', (e) => {
        if (touchDraggedItem) {
            touchDraggedItem.classList.remove('dragging');
            touchDraggedItem.style.opacity = '1';
            touchDraggedItem = null;
            saveSourceOrder();
        }
    });
    draggableContainer.dataset.touchListenersAttached = 'true';
}

document.getElementById('add-source-button').addEventListener('click', addSource);

document.getElementById('default-provider').addEventListener('change', (e) => {
    currentSettings.lyricsProvider = e.target.value;
    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
});

document.getElementById('add-lyrics-fab').addEventListener('click', () => {
    document.getElementById('upload-lyrics-modal').style.display = 'flex';
});

document.querySelector('#upload-lyrics-modal .close-button').addEventListener('click', () => {
    document.getElementById('upload-lyrics-modal').style.display = 'none';
});

document.querySelector('#upload-lyrics-modal .modal-scrim').addEventListener('click', () => {
    document.getElementById('upload-lyrics-modal').style.display = 'none';
});

document.getElementById('modal-upload-lyrics-button').addEventListener('click', handleUploadLocalLyrics);
document.getElementById('refresh-local-lyrics-list').addEventListener('click', populateLocalLyricsList);

document.getElementById('override-translate-target').addEventListener('change', (e) => {
    currentSettings.overrideTranslateTarget = e.target.checked;
    toggleTranslateTargetVisibility();
});

document.getElementById('override-gemini-prompt').addEventListener('change', (e) => {
    currentSettings.overrideGeminiPrompt = e.target.checked;
    toggleGeminiPromptVisibility();
});

document.getElementById('override-gemini-romanize-prompt').addEventListener('change', (e) => {
    currentSettings.overrideGeminiRomanizePrompt = e.target.checked;
    toggleGeminiRomanizePromptVisibility();
});

document.getElementById('romanization-provider').addEventListener('change', () => {
    toggleRomanizationModelVisibility();
    toggleOpenRouterSettingsVisibility();
});

document.getElementById('translation-provider').addEventListener('change', (e) => {
    currentSettings.translationProvider = e.target.value;
    toggleGeminiSettingsVisibility();
    toggleOpenRouterSettingsVisibility();
});

function toggleElementVisibility(elementId, isVisible) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = isVisible ? 'block' : 'none';
    }
}

function toggleKpoeSourcesVisibility() {
    const isVisible = ['kpoe', 'customKpoe'].includes(document.getElementById('default-provider').value);
    toggleElementVisibility('kpoe-sources-group', isVisible);
}

function toggleCustomKpoeUrlVisibility() {
    const isVisible = document.getElementById('default-provider').value === 'customKpoe';
    toggleElementVisibility('custom-kpoe-url-group', isVisible);
}

function toggleGeminiSettingsVisibility() {
    const isGemini = document.getElementById('translation-provider').value === 'gemini';
    toggleElementVisibility('gemini-api-key-group', isGemini);
    toggleElementVisibility('gemini-model-group', isGemini);

    // Prompt overrides are shared with OpenRouter
    const isGeminiOrOpenRouter = isGemini || document.getElementById('translation-provider').value === 'openrouter';
    toggleElementVisibility('override-gemini-prompt-group', isGeminiOrOpenRouter);

    // Romanization prompt override is shared
    const isRomanizationGeminiOrOpenRouter = isGeminiOrOpenRouter || ['gemini', 'openrouter'].includes(document.getElementById('romanization-provider').value);
    toggleElementVisibility('override-gemini-romanize-prompt-group', isRomanizationGeminiOrOpenRouter);
    toggleGeminiPromptVisibility();
    toggleGeminiRomanizePromptVisibility();
}

function toggleOpenRouterSettingsVisibility() {
    const isTranslationOpenRouter = document.getElementById('translation-provider').value === 'openrouter';
    const isRomanizationOpenRouter = document.getElementById('romanization-provider').value === 'openrouter';
    toggleElementVisibility('openrouter-settings-category', isTranslationOpenRouter || isRomanizationOpenRouter);
}

function toggleTranslateTargetVisibility() {
    const isVisible = document.getElementById('override-translate-target').checked;
    toggleElementVisibility('custom-translate-target-group', isVisible);
}

function toggleGeminiPromptVisibility() {
    const isGeminiOrOpenRouter = ['gemini', 'openrouter'].includes(document.getElementById('translation-provider').value);
    const isVisible = isGeminiOrOpenRouter && document.getElementById('override-gemini-prompt').checked;
    toggleElementVisibility('custom-gemini-prompt-group', isVisible);
}

function toggleGeminiRomanizePromptVisibility() {
    const isGeminiOrOpenRouter = ['gemini', 'openrouter'].includes(document.getElementById('translation-provider').value) ||
        ['gemini', 'openrouter'].includes(document.getElementById('romanization-provider').value);
    const isVisible = isGeminiOrOpenRouter && document.getElementById('override-gemini-romanize-prompt').checked;
    toggleElementVisibility('custom-gemini-romanize-prompt-group', isVisible);
}

function toggleRomanizationModelVisibility() {
    const isVisible = document.getElementById('romanization-provider').value === 'gemini';
    toggleElementVisibility('gemini-romanization-model-group', isVisible);
}

async function handleUploadLocalLyrics() {
    const titleInput = document.getElementById('modal-upload-song-title');
    const artistInput = document.getElementById('modal-upload-artist-name');
    const albumInput = document.getElementById('modal-upload-album-name');
    const lyricsFileInput = document.getElementById('modal-upload-lyrics-file');
    const uploadButton = document.getElementById('modal-upload-lyrics-button');
    const uploadButtonIcon = uploadButton.querySelector('.material-symbols-outlined');

    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();
    const album = albumInput.value.trim();
    const lyricsFile = lyricsFileInput.files[0];

    if (!title || !artist || !lyricsFile) {
        showStatusMessage('modal-upload-status', 'Song Title, Artist Name, and a Lyrics File are required.', true);
        return;
    }

    const getFileExtension = (filename) => filename.split('.').pop().toLowerCase();
    const format = getFileExtension(lyricsFile.name);

    uploadButton.disabled = true;
    uploadButtonIcon.textContent = 'hourglass_empty';
    showStatusMessage('modal-upload-status', 'Uploading lyrics...', false);

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const lyricsContent = e.target.result;
            const songInfo = { title, artist, album };
            let parsedLyrics;
            switch (format) {
                case 'lrc': case 'elrc': parsedLyrics = parseSyncedLyrics(lyricsContent); break;
                case 'ttml': parsedLyrics = parseAppleTTML(lyricsContent); break;
                case 'json':
                    parsedLyrics = JSON.parse(lyricsContent);
                    if (parsedLyrics && (parsedLyrics.KpoeTools && !parsedLyrics.KpoeTools.includes('1.31R2-LPlusBcknd') || !parsedLyrics.KpoeTools && parsedLyrics.lyrics?.[0]?.isLineEnding !== undefined)) {
                        parsedLyrics = v1Tov2(parsedLyrics);
                    }
                    break;
                default: throw new Error('Unsupported lyrics format.');
            }
            const jsonLyrics = format === 'json' ? parsedLyrics : convertToStandardJson(parsedLyrics);
            await uploadLocalLyrics(songInfo, jsonLyrics);
            showStatusMessage('modal-upload-status', 'Lyrics uploaded successfully!', false);
            titleInput.value = ''; artistInput.value = ''; albumInput.value = ''; lyricsFileInput.value = '';
            document.getElementById('upload-lyrics-modal').style.display = 'none';
            populateLocalLyricsList();
        } catch (error) {
            showStatusMessage('modal-upload-status', `Error uploading lyrics: ${error.message || error}`, true);
        } finally {
            uploadButton.disabled = false;
            uploadButtonIcon.textContent = 'upload_file';
        }
    };
    reader.onerror = () => {
        showStatusMessage('modal-upload-status', 'Error reading file.', true);
        uploadButton.disabled = false;
        uploadButtonIcon.textContent = 'upload_file';
    };
    reader.readAsText(lyricsFile);
}

async function populateLocalLyricsList() {
    const listContainer = document.getElementById('local-lyrics-list');
    const noLyricsMessage = document.getElementById('no-local-lyrics-message');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    listContainer.appendChild(noLyricsMessage);

    try {
        const lyricsList = await getLocalLyricsList();
        noLyricsMessage.style.display = lyricsList.length === 0 ? 'block' : 'none';

        lyricsList.forEach(item => {
            const listItem = document.createElement('div');
            listItem.className = 'draggable-source-item';
            listItem.dataset.songId = item.songId;
            listItem.innerHTML = `
                <span class="material-symbols-outlined drag-handle">music_note</span>
                <span class="source-name">${item.songInfo.title} - ${item.songInfo.artist}</span>
                <button class="m3-button icon remove-source-button" title="Delete local lyrics">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            `;
            listItem.querySelector('.remove-source-button').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${item.songInfo.title} - ${item.songInfo.artist}"?`)) {
                    try {
                        await deleteLocalLyrics(item.songId);
                        showStatusMessage('local-lyrics-status', 'Local lyrics deleted.', false);
                        populateLocalLyricsList();
                    } catch (error) {
                        showStatusMessage('local-lyrics-status', `Error deleting lyrics: ${error}`, true);
                    }
                }
            });
            listContainer.appendChild(listItem);
        });
    } catch (error) {
        console.error("Failed to load local lyrics list:", error);
        noLyricsMessage.textContent = `Error loading local lyrics: ${error.message || error}`;
        noLyricsMessage.style.display = 'block';
    }
}

document.getElementById('toggle-gemini-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const icon = document.querySelector('#toggle-gemini-api-key-visibility .material-symbols-outlined');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        apiKeyInput.type = 'password';
        icon.textContent = 'visibility';
    }
});

document.getElementById('toggle-openrouter-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('openrouter-api-key');
    const icon = document.querySelector('#toggle-openrouter-api-key-visibility .material-symbols-outlined');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        apiKeyInput.type = 'password';
        icon.textContent = 'visibility';
    }
});

function setAppVersion() {
    try {
        const version = chrome.runtime.getManifest().version;
        document.querySelector('.version').textContent = `Version ${version}`;
    } catch (e) {
        console.error("Could not retrieve extension version:", e);
    }
}

function exportSettings() {
    try {
        const settings = getSettings();
        const settingsJson = JSON.stringify(settings, null, 2);
        const blob = new Blob([settingsJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `youlyplus-settings-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatusMessage('config-status', 'Settings exported successfully!', false);
    } catch (error) {
        console.error('Failed to export settings:', error);
        showStatusMessage('config-status', `Error exporting settings: ${error.message}`, true);
    }
}

function importSettings(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedSettings = JSON.parse(e.target.result);

            if (typeof importedSettings !== 'object' || importedSettings === null || typeof importedSettings.isEnabled === 'undefined') {
                throw new Error('Invalid or corrupted settings file.');
            }

            updateSettings(importedSettings);
            saveSettings();
            updateUI(getSettings());
            showStatusMessage('config-status', 'Settings imported successfully! Reload required.', false);
            showReloadNotification();
        } catch (error) {
            console.error('Failed to import settings:', error);
            showStatusMessage('config-status', `Error importing settings: ${error.message}`, true);
        } finally {
            event.target.value = '';
        }
    };
    reader.onerror = () => {
        showStatusMessage('config-status', 'Error reading file.', true);
    };
    reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings((settings) => {
        initCustomSelects(); // Init custom selects first
        updateUI(settings);
        setupAutoSaveListeners();

        const firstNavItem = document.querySelector('.navigation-drawer .nav-item');
        const activeSectionId = firstNavItem?.getAttribute('data-section') || 'general';
        document.querySelector(`.navigation-drawer .nav-item[data-section="${activeSectionId}"]`)?.classList.add('active');
        document.getElementById(activeSectionId)?.classList.add('active');
    });

    setAppVersion();

    document.getElementById('reload-button')?.addEventListener('click', async () => {
        const availablePlatforms = await getAvailableTabs();
        if (availablePlatforms.length > 0) {
            let reloadPromises = [];
            availablePlatforms.forEach(p => {
                p.tabs.forEach(tab => {
                    reloadPromises.push(new Promise(r => chrome.tabs.reload(tab.id, r)));
                });
            });
            await Promise.all(reloadPromises);
            hideReloadNotification();
        } else {
            alert("No active music tabs found. Please reload them manually.");
        }
    });

    document.getElementById('export-settings-button').addEventListener('click', exportSettings);
    document.getElementById('import-settings-button').addEventListener('click', () => {
        document.getElementById('import-settings-file').click();
    });
    document.getElementById('import-settings-file').addEventListener('change', importSettings);
});

function updateCustomSelectDisplay(selectId) {
    const nativeSelect = document.getElementById(selectId);
    if (!nativeSelect || !nativeSelect.customSelect) return;

    const customSelect = nativeSelect.customSelect.container;
    const valueDisplay = nativeSelect.customSelect.valueDisplay;
    const selectedOption = nativeSelect.options[nativeSelect.selectedIndex];

    if (selectedOption && selectedOption.value) {
        valueDisplay.textContent = selectedOption.textContent;
        customSelect.classList.add('has-value');
        const menu = nativeSelect.customSelect.menu;
        menu.querySelector('.selected')?.classList.remove('selected');
        menu.querySelector(`[data-value="${selectedOption.value}"]`)?.classList.add('selected');
    } else {
        valueDisplay.textContent = '';
        customSelect.classList.remove('has-value');
    }
}

function initCustomSelects() {
    document.querySelectorAll('.form-group').forEach(formGroup => {
        const nativeSelect = formGroup.querySelector('select');
        if (!nativeSelect) return;

        const customSelect = document.createElement('div');
        customSelect.className = 'm3-select';

        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'm3-select-value';

        const arrow = document.createElement('span');
        arrow.className = 'material-symbols-outlined m3-select-arrow';
        arrow.textContent = 'arrow_drop_down';

        const menu = document.createElement('div');
        menu.className = 'm3-select-menu';

        customSelect.append(valueDisplay, arrow, menu);

        nativeSelect.customSelect = { container: customSelect, valueDisplay: valueDisplay, menu: menu };

        function populateOptions() {
            menu.innerHTML = '';
            Array.from(nativeSelect.options).forEach(option => {
                if (option.disabled && option.value === '') return;

                const customOption = document.createElement('div');
                customOption.className = 'm3-select-option';
                customOption.dataset.value = option.value;
                customOption.textContent = option.textContent;

                if (option.selected && option.value !== '') {
                    customOption.classList.add('selected');
                    valueDisplay.textContent = option.textContent;
                    customSelect.classList.add('has-value');
                }

                customOption.addEventListener('click', (e) => {
                    e.stopPropagation();
                    nativeSelect.value = option.value;
                    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    customSelect.classList.remove('open');
                    updateCustomSelectDisplay(nativeSelect.id);
                });
                menu.appendChild(customOption);
            });
            updateCustomSelectDisplay(nativeSelect.id);
        }

        populateOptions();

        customSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.m3-select.open').forEach(openSelect => {
                if (openSelect !== customSelect) openSelect.classList.remove('open');
            });
            customSelect.classList.toggle('open');
        });

        nativeSelect.classList.add('m3-select-hidden');
        formGroup.insertBefore(customSelect, nativeSelect);

        new MutationObserver(populateOptions).observe(nativeSelect, { childList: true });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.m3-select.open').forEach(select => select.classList.remove('open'));
    });

    // Mobile Drawer Logic
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const navDrawer = document.querySelector('.navigation-drawer');

    if (mobileMenuButton && drawerOverlay && navDrawer) {
        function toggleDrawer() {
            navDrawer.classList.toggle('open');
            drawerOverlay.classList.toggle('visible');
        }

        function closeDrawer() {
            navDrawer.classList.remove('open');
            drawerOverlay.classList.remove('visible');
        }

        mobileMenuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDrawer();
        });

        drawerOverlay.addEventListener('click', closeDrawer);

        // Close drawer when a nav item is clicked (on mobile)
        document.querySelectorAll('.navigation-drawer .nav-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    closeDrawer();
                }
            });
        });
    }
}

document.addEventListener('click', function (e) {
    const target = e.target.closest('.m3-button, .nav-item, .draggable-source-item');
    if (!target) return;

    const ripple = document.createElement('span');
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.add('ripple');

    const existingRipple = target.querySelector('.ripple');
    if (existingRipple) {
        existingRipple.remove();
    }

    target.appendChild(ripple);

    ripple.addEventListener('animationend', () => {
        ripple.remove();
    });
});
