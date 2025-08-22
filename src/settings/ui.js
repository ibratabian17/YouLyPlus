import { loadSettings, saveSettings, updateSettings, getSettings, updateCacheSize, clearCache, setupSettingsMessageListener } from './settingsManager.js';

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
        { id: 'compability-wipe', key: 'compabilityWipe', type: 'checkbox' },
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
    document.getElementById('custom-kpoe-url').value = currentSettings.customKpoeUrl || '';
    document.getElementById('sponsor-block').checked = currentSettings.useSponsorBlock;
    document.getElementById('wordByWord').checked = currentSettings.wordByWord;
    document.getElementById('lightweight').checked = currentSettings.lightweight;
    document.getElementById('hide-offscreen').checked = currentSettings.hideOffscreen;
    document.getElementById('compability-wipe').checked = currentSettings.compabilityWipe;
    document.getElementById('blur-inactive').checked = currentSettings.blurInactive;
    document.getElementById('dynamic-player').checked = currentSettings.dynamicPlayer;
    document.getElementById('useSongPaletteFullscreen').checked = currentSettings.useSongPaletteFullscreen;
    document.getElementById('useSongPaletteAllModes').checked = currentSettings.useSongPaletteAllModes;
    document.getElementById('overridePaletteColor').value = currentSettings.overridePaletteColor;
    document.getElementById('larger-text-mode').value = currentSettings.largerTextMode;
    document.getElementById('romanization-provider').value = currentSettings.romanizationProvider;
    document.getElementById('gemini-romanization-model').value = currentSettings.geminiRomanizationModel || 'gemini-1.5-pro-latest';
    document.getElementById('translation-provider').value = currentSettings.translationProvider;
    document.getElementById('gemini-api-key').value = currentSettings.geminiApiKey || '';
    document.getElementById('gemini-api-key').type = 'password';
    document.getElementById('gemini-model').value = currentSettings.geminiModel || 'gemini-1.5-flash';
    document.getElementById('override-translate-target').checked = currentSettings.overrideTranslateTarget;
    document.getElementById('custom-translate-target').value = currentSettings.customTranslateTarget || '';
    document.getElementById('override-gemini-prompt').checked = currentSettings.overrideGeminiPrompt;
    document.getElementById('custom-gemini-prompt').value = currentSettings.customGeminiPrompt || '';
    document.getElementById('override-gemini-romanize-prompt').checked = currentSettings.overrideGeminiRomanizePrompt;
    document.getElementById('custom-gemini-romanize-prompt').value = currentSettings.customGeminiRomanizePrompt || '';
    document.getElementById('custom-css').value = currentSettings.customCSS;
    document.getElementById('cache-strategy').value = currentSettings.cacheStrategy;

    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
    toggleGeminiSettingsVisibility();
    toggleTranslateTargetVisibility();
    toggleGeminiPromptVisibility();
    toggleGeminiRomanizePromptVisibility();
    toggleRomanizationModelVisibility();

    populateDraggableSources();
    updateCacheSize();
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

    // Switches and dropdowns are auto-saved. This button only saves manually ordered or entered fields.
    updateSettings({
        lyricsSourceOrder: orderedSources.join(','),
        customKpoeUrl: document.getElementById('custom-kpoe-url').value,
    });
    saveSettings();
    showStatusMessage('General settings saved!', false, 'save-general');
});

document.getElementById('save-appearance').addEventListener('click', () => {
    // This button only saves the Custom CSS.
    updateSettings({ customCSS: document.getElementById('custom-css').value });
    saveSettings();
    showStatusMessage('Custom CSS saved!', false, 'save-appearance');
});

document.getElementById('save-translation').addEventListener('click', () => {
    // This button saves text inputs related to translation.
    updateSettings({
        geminiApiKey: document.getElementById('gemini-api-key').value,
        customTranslateTarget: document.getElementById('custom-translate-target').value,
        customGeminiPrompt: document.getElementById('custom-gemini-prompt').value,
        customGeminiRomanizePrompt: document.getElementById('custom-gemini-romanize-prompt').value
    });
    saveSettings();
    showStatusMessage('Translation input fields saved!', false, 'save-translation');
});

document.getElementById('clear-cache').addEventListener('click', clearCache);

setupSettingsMessageListener(updateUI);

let draggedItem = null;

function getSourceDisplayName(sourceName) {
    switch (sourceName) {
        case 'lyricsplus': return 'Lyrics+ (User Gen.)'; // Shorter for UI
        case 'apple': return 'Apple Music';
        case 'spotify': return 'Musixmatch (Spotify)'; // Clarified provider
        case 'musixmatch': return 'Musixmatch (Direct)';
        case 'musixmatch-word': return 'Musixmatch (Word)'; // Shorter
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
        <button class="remove-source-button btn-icon btn-icon-error" title="Remove source">
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
    availableSourcesDropdown.innerHTML = '';

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
    addDragDropListeners();
}

let statusMessageTimeout;
function showStatusMessage(message, isError = false, buttonIdToAppendAfter = null) {
    let targetStatusElement = document.getElementById('add-source-status');

    if (buttonIdToAppendAfter) {
        const button = document.getElementById(buttonIdToAppendAfter);
        const parentActions = button?.parentElement;
        if (parentActions?.classList.contains('card-actions')) {
            let specificStatus = parentActions.querySelector('.save-status-message');
            if (!specificStatus) {
                specificStatus = document.createElement('p');
                specificStatus.className = 'status-message save-status-message';
                parentActions.insertBefore(specificStatus, button);
            }
            targetStatusElement = specificStatus;
        }
    }

    if (!targetStatusElement) return;

    clearTimeout(statusMessageTimeout);
    targetStatusElement.textContent = message;
    targetStatusElement.style.color = isError ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)';
    targetStatusElement.style.opacity = '1';

    statusMessageTimeout = setTimeout(() => {
        targetStatusElement.style.opacity = '0';
        setTimeout(() => { targetStatusElement.textContent = ''; }, 300);
    }, 3000);
}

function addSource() {
    const sourceName = document.getElementById('available-sources-dropdown').value;
    if (!sourceName) {
        showStatusMessage('Please select a source to add.', true);
        return;
    }

    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    if (sources.includes(sourceName)) {
        showStatusMessage(`Source "${getSourceDisplayName(sourceName)}" already exists.`, true);
        return;
    }

    sources.push(sourceName);
    currentSettings.lyricsSourceOrder = sources.join(',');
    populateDraggableSources();
    showStatusMessage(`"${getSourceDisplayName(sourceName)}" added. Save to apply.`, false);
}

function removeSource(sourceName) {
    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    currentSettings.lyricsSourceOrder = sources.filter(s => s !== sourceName).join(',');
    populateDraggableSources();
    showStatusMessage(`"${getSourceDisplayName(sourceName)}" removed. Save to apply.`, false);
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
        showStatusMessage('Source order updated. Save to apply.', false);
    };

    // Mouse Events
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

    // Touch Events for Mobile/Tablet
    draggableContainer.addEventListener('touchstart', (e) => {
        if (e.target.closest('.drag-handle')) {
            draggedItem = e.target.closest('.draggable-source-item');
            draggedItem?.classList.add('dragging');
        }
    }, { passive: true });

    draggableContainer.addEventListener('touchmove', (e) => {
        if (!draggedItem) return;
        e.preventDefault(); // Prevent page scroll while dragging
        const touchY = e.touches[0].clientY;
        const afterElement = getDragAfterElement(draggableContainer, touchY);
        if (afterElement) {
            draggableContainer.insertBefore(draggedItem, afterElement);
        } else {
            draggableContainer.appendChild(draggedItem);
        }
    }, { passive: false });

    draggableContainer.addEventListener('touchend', onDragEnd);
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
        const versionElement = document.querySelector('.version');
        if (versionElement) {
            versionElement.textContent = `Version ${version}`;
        }
    } catch (e) {
        console.error("Could not retrieve extension version from manifest:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings((settings) => {
        updateUI(settings);
        setupAutoSaveListeners();

        const firstNavItem = document.querySelector('.navigation-drawer .nav-item');
        const activeSectionId = firstNavItem?.getAttribute('data-section') || 'general';

        document.querySelectorAll('.navigation-drawer .nav-item').forEach(i => i.classList.remove('active'));
        document.querySelector(`.navigation-drawer .nav-item[data-section="${activeSectionId}"]`)?.classList.add('active');

        document.querySelectorAll('.settings-card').forEach(section => section.classList.remove('active'));
        document.getElementById(activeSectionId)?.classList.add('active');
    });

    setAppVersion();

    document.getElementById('reload-button')?.addEventListener('click', () => {
        chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.reload(tabs[0].id, () => {
                    hideReloadNotification();
                    showStatusMessage('YouTube Music tab reloaded!', false, 'save-general');
                });
            } else {
                alert("No YouTube Music tab found. Please open one and try again.");
            }
        });
    });
});
