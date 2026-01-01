import { loadSettings, saveSettings, updateSettings, getSettings, updateCacheSize, clearCache, setupSettingsMessageListener, uploadLocalLyrics, getLocalLyricsList, deleteLocalLyrics } from './settingsManager.js';
import { parseSyncedLyrics, parseAppleTTML, convertToStandardJson, v1Tov2 } from './parser.js';

let currentSettings = getSettings();

function showReloadNotification() {
    const notification = document.getElementById('reload-notification');
    if (notification) {
        notification.style.display = 'flex';
    }
}

function hideReloadNotification() {
    const notification = document.getElementById('reload-notification');
    if (notification) {
        notification.style.display = 'none';
    }
}

function setupAutoSaveListeners() {
    const autoSaveControls = [
        { id: 'enabled', key: 'isEnabled', type: 'checkbox' },
        { id: 'default-provider', key: 'lyricsProvider', type: 'value' },
        { id: 'custom-kpoe-url', key: 'customKpoeUrl', type: 'value' },
        { id: 'sponsor-block', key: 'useSponsorBlock', type: 'checkbox' },
        { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
        { id: 'lightweight', key: 'lightweight', type: 'checkbox' },
        { id: 'hide-offscreen', key: 'hideOffscreen', type: 'checkbox' },
        { id: 'blur-inactive', key: 'blurInactive', type: 'checkbox' },
        { id: 'dynamic-player', key: 'dynamicPlayer', type: 'checkbox' },
        { id: 'useSongPaletteFullscreen', key: 'useSongPaletteFullscreen', type: 'checkbox' },
        { id: 'useSongPaletteAllModes', key: 'useSongPaletteAllModes', type: 'checkbox' },
        { id: 'overridePaletteColor', key: 'overridePaletteColor', type: 'value' },
        { id: 'larger-text-mode', key: 'largerTextMode', type: 'value' },
        { id: 'translation-provider', key: 'translationProvider', type: 'value' },
        { id: 'gemini-model', key: 'geminiModel', type: 'value' },
        { id: 'override-translate-target', key: 'overrideTranslateTarget', type: 'checkbox' },
        { id: 'override-gemini-prompt', key: 'overrideGeminiPrompt', type: 'checkbox' },
        { id: 'override-gemini-romanize-prompt', key: 'overrideGeminiRomanizePrompt', type: 'checkbox' },
        { id: 'romanization-provider', key: 'romanizationProvider', type: 'value' },
        { id: 'gemini-romanization-model', key: 'geminiRomanizationModel', type: 'value' },
        { id: 'cache-strategy', key: 'cacheStrategy', type: 'value' },
        { id: 'bypass-apple', key: 'appleMusicTTMLBypass', type: 'checkbox' },
        { id: 'ytsonginfo', key: 'YTSongInfo', type: 'checkbox' },
    ];

    autoSaveControls.forEach(control => {
        const element = document.getElementById(control.id);
        if (element) {
            element.addEventListener('change', (e) => {
                const value = control.type === 'checkbox' ? e.target.checked : e.target.value;
                updateSettings({ [control.key]: value });
                saveSettings();
                showReloadNotification();
            });
        }
    });
}

function updateUI(settings) {
    currentSettings = settings;
    console.log("Updating UI with settings:", currentSettings);

    document.getElementById('enabled').checked = currentSettings.isEnabled;
    document.getElementById('default-provider').value = currentSettings.lyricsProvider;
    updateCustomSelectDisplay('default-provider');
    document.getElementById('custom-kpoe-url').value = currentSettings.customKpoeUrl || '';
    document.getElementById('sponsor-block').checked = currentSettings.useSponsorBlock;
    document.getElementById('wordByWord').checked = currentSettings.wordByWord;
    document.getElementById('lightweight').checked = currentSettings.lightweight;
    document.getElementById('hide-offscreen').checked = currentSettings.hideOffscreen;
    document.getElementById('blur-inactive').checked = currentSettings.blurInactive;
    document.getElementById('dynamic-player').checked = currentSettings.dynamicPlayer;
    document.getElementById('useSongPaletteFullscreen').checked = currentSettings.useSongPaletteFullscreen;
    document.getElementById('useSongPaletteAllModes').checked = currentSettings.useSongPaletteAllModes;
    document.getElementById('overridePaletteColor').value = currentSettings.overridePaletteColor;
    document.getElementById('larger-text-mode').value = currentSettings.largerTextMode;
    updateCustomSelectDisplay('larger-text-mode');
    document.getElementById('romanization-provider').value = currentSettings.romanizationProvider;
    updateCustomSelectDisplay('romanization-provider');
    document.getElementById('gemini-romanization-model').value = currentSettings.geminiRomanizationModel || 'gemini-1.5-pro-latest';
    updateCustomSelectDisplay('gemini-romanization-model');
    document.getElementById('translation-provider').value = currentSettings.translationProvider;
    updateCustomSelectDisplay('translation-provider');
    document.getElementById('gemini-api-key').value = currentSettings.geminiApiKey || '';
    document.getElementById('gemini-api-key').type = 'password';
    document.getElementById('gemini-model').value = currentSettings.geminiModel || 'gemini-1.5-flash';
    updateCustomSelectDisplay('gemini-model');
    document.getElementById('override-translate-target').checked = currentSettings.overrideTranslateTarget;
    document.getElementById('custom-translate-target').value = currentSettings.customTranslateTarget || '';
    document.getElementById('override-gemini-prompt').checked = currentSettings.overrideGeminiPrompt;
    document.getElementById('custom-gemini-prompt').value = currentSettings.customGeminiPrompt || '';
    document.getElementById('override-gemini-romanize-prompt').checked = currentSettings.overrideGeminiRomanizePrompt;
    document.getElementById('custom-gemini-romanize-prompt').value = currentSettings.customGeminiRomanizePrompt || '';
    document.getElementById('custom-css').value = currentSettings.customCSS;
    document.getElementById('cache-strategy').value = currentSettings.cacheStrategy;
    document.getElementById('bypass-apple').checked = currentSettings.appleMusicTTMLBypass;
    document.getElementById('ytsonginfo').checked = currentSettings.YTSongInfo;
    updateCustomSelectDisplay('cache-strategy');

    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
    toggleGeminiSettingsVisibility();
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

document.getElementById('save-general').addEventListener('click', () => {
    const orderedSources = Array.from(document.getElementById('lyrics-source-order-draggable').children)
        .map(item => item.dataset.source);

    updateSettings({
        lyricsSourceOrder: orderedSources.join(','),
        customKpoeUrl: document.getElementById('custom-kpoe-url').value,
    });
    saveSettings();
    showStatusMessage('general-save-status', 'General settings saved!', false);
});

document.getElementById('save-appearance').addEventListener('click', () => {
    updateSettings({ customCSS: document.getElementById('custom-css').value });
    saveSettings();
    showStatusMessage('appearance-save-status', 'Custom CSS saved!', false);
});

document.getElementById('save-translation').addEventListener('click', () => {
    updateSettings({
        geminiApiKey: document.getElementById('gemini-api-key').value,
        customTranslateTarget: document.getElementById('custom-translate-target').value,
        customGeminiPrompt: document.getElementById('custom-gemini-prompt').value,
        customGeminiRomanizePrompt: document.getElementById('custom-gemini-romanize-prompt').value
    });
    saveSettings();
    showStatusMessage('translation-save-status', 'Translation input fields saved!', false);
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
    populateDraggableSources();
    showStatusMessage('add-source-status', `"${getSourceDisplayName(sourceName)}" added. Save to apply.`, false);
}

function removeSource(sourceName) {
    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    currentSettings.lyricsSourceOrder = sources.filter(s => s !== sourceName).join(',');
    populateDraggableSources();
    showStatusMessage('add-source-status', `"${getSourceDisplayName(sourceName)}" removed. Save to apply.`, false);
}

function addDragDropListeners() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer) return;

    const onDragEnd = () => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
        const orderedSources = Array.from(draggableContainer.children).map(item => item.dataset.source);
        currentSettings.lyricsSourceOrder = orderedSources.join(',');
        showStatusMessage('add-source-status', 'Source order updated. Save to apply.', false);
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
});

document.getElementById('translation-provider').addEventListener('change', (e) => {
    currentSettings.translationProvider = e.target.value;
    toggleGeminiSettingsVisibility();
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
    toggleElementVisibility('override-gemini-prompt-group', isGemini);
    toggleElementVisibility('override-gemini-romanize-prompt-group', isGemini);
    toggleGeminiPromptVisibility();
    toggleGeminiRomanizePromptVisibility();
}

function toggleTranslateTargetVisibility() {
    const isVisible = document.getElementById('override-translate-target').checked;
    toggleElementVisibility('custom-translate-target-group', isVisible);
}

function toggleGeminiPromptVisibility() {
    const isVisible = document.getElementById('translation-provider').value === 'gemini' && document.getElementById('override-gemini-prompt').checked;
    toggleElementVisibility('custom-gemini-prompt-group', isVisible);
}

function toggleGeminiRomanizePromptVisibility() {
    const isVisible = document.getElementById('translation-provider').value === 'gemini' && document.getElementById('override-gemini-romanize-prompt').checked;
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

    document.getElementById('reload-button')?.addEventListener('click', () => {
        chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.reload(tabs[0].id, () => {
                    hideReloadNotification();
                    showStatusMessage('general-save-status', 'YouTube Music tab reloaded!', false);
                });
            } else {
                alert("No YouTube Music tab found.");
            }
        });
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
