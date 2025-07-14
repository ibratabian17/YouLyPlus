import { loadSettings, saveSettings, updateSettings, getSettings, updateCacheSize, clearCache, setupSettingsMessageListener } from './settingsManager.js';
import { startFullPreviewSync } from './previewManager.js';

let currentSettings = getSettings(); // Initialize with default settings

// Shows a notification bar telling the user to reload their YTM tab
function showReloadNotification() {
    const notification = document.getElementById('reload-notification');
    if (notification) {
        notification.style.display = 'flex'; // Use flex to align items
    }
}

// Hides the notification bar
function hideReloadNotification() {
    const notification = document.getElementById('reload-notification');
    if (notification) {
        notification.style.display = 'none';
    }
}

// Sets up listeners for controls that should save automatically on change
function setupAutoSaveListeners() {
    const autoSaveControls = [
        // General
        { id: 'enabled', key: 'isEnabled', type: 'checkbox' },
        { id: 'default-provider', key: 'lyricsProvider', type: 'value' },
        { id: 'sponsor-block', key: 'useSponsorBlock', type: 'checkbox' },
        { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
        // Appearance
        { id: 'lightweight', key: 'lightweight', type: 'checkbox' },
        { id: 'compability-visibility', key: 'compabilityVisibility', type: 'checkbox' },
        { id: 'compability-wipe', key: 'compabilityWipe', type: 'checkbox' },
        { id: 'blur-inactive', key: 'blurInactive', type: 'checkbox' },
        { id: 'dynamic-player', key: 'dynamicPlayer', type: 'checkbox' },
        { id: 'useSongPaletteFullscreen', key: 'useSongPaletteFullscreen', type: 'checkbox' },
        { id: 'useSongPaletteAllModes', key: 'useSongPaletteAllModes', type: 'checkbox' },
        { id: 'overridePaletteColor', key: 'overridePaletteColor', type: 'value' },
        // Translation
        { id: 'translation-provider', key: 'translationProvider', type: 'value' },
        { id: 'gemini-model', key: 'geminiModel', type: 'value' },
        { id: 'override-translate-target', key: 'overrideTranslateTarget', type: 'checkbox' },
        { id: 'override-gemini-prompt', key: 'overrideGeminiPrompt', type: 'checkbox' },
        // Cache
        { id: 'cache-strategy', key: 'cacheStrategy', type: 'value' },
    ];

    autoSaveControls.forEach(control => {
        const element = document.getElementById(control.id);
        if (element) {
            element.addEventListener('change', (e) => {
                const value = control.type === 'checkbox' ? e.target.checked : e.target.value;
                const newSetting = { [control.key]: value };

                updateSettings(newSetting);
                saveSettings();
                showReloadNotification();
            });
        }
    });
}


// Update UI elements to reflect current settings
function updateUI(settings) {
    currentSettings = settings; // Update local reference
    console.log("Updating UI with settings:", currentSettings);

    // General settings
    document.getElementById('enabled').checked = currentSettings.isEnabled;
    document.getElementById('default-provider').value = currentSettings.lyricsProvider;
    document.getElementById('sponsor-block').checked = currentSettings.useSponsorBlock;
    document.getElementById('lightweight').checked = currentSettings.lightweight;
    document.getElementById('wordByWord').checked = currentSettings.wordByWord;
    document.getElementById('compability-visibility').checked = currentSettings.compabilityVisibility;
    document.getElementById('compability-wipe').checked = currentSettings.compabilityWipe;
    document.getElementById('blur-inactive').checked = currentSettings.blurInactive;
    document.getElementById('dynamic-player').checked = currentSettings.dynamicPlayer;
    document.getElementById('useSongPaletteFullscreen').checked = currentSettings.useSongPaletteFullscreen;
    document.getElementById('useSongPaletteAllModes').checked = currentSettings.useSongPaletteAllModes;
    document.getElementById('overridePaletteColor').value = currentSettings.overridePaletteColor;

    // Translation settings
    document.getElementById('translation-provider').value = currentSettings.translationProvider;
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    geminiApiKeyInput.value = currentSettings.geminiApiKey || '';
    geminiApiKeyInput.type = 'password'; // Ensure it's hidden by default

    document.getElementById('gemini-model').value = currentSettings.geminiModel || 'gemini-2.5-flash'; // Default to gemini-2.5-flash
    document.getElementById('override-translate-target').checked = currentSettings.overrideTranslateTarget;
    document.getElementById('custom-translate-target').value = currentSettings.customTranslateTarget || '';
    document.getElementById('override-gemini-prompt').checked = currentSettings.overrideGeminiPrompt;
    document.getElementById('custom-gemini-prompt').value = currentSettings.customGeminiPrompt || '';
    toggleGeminiSettingsVisibility();
    toggleKpoeSourcesVisibility();
    toggleTranslateTargetVisibility();
    toggleGeminiPromptVisibility();

    // Populate draggable KPoe sources
    populateDraggableSources();

    // Appearance settings
    document.getElementById('custom-css').value = currentSettings.customCSS;

    // Cache settings
    document.getElementById('cache-strategy').value = currentSettings.cacheStrategy;
    updateCacheSize(); // This function is now in settingsManager.js
}

// Tab navigation
document.querySelectorAll('.navigation-drawer .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        // Update active menu item
        document.querySelectorAll('.navigation-drawer .nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Show corresponding section
        const sectionId = item.getAttribute('data-section');
        document.querySelectorAll('.settings-card').forEach(section => section.classList.remove('active'));
        const activeSection = document.getElementById(sectionId);
        if (activeSection) {
            activeSection.classList.add('active');
        } else {
            console.warn(`Section with id "${sectionId}" not found.`);
        }
    });
});

// Event listeners for save buttons (now only for manual input fields)
document.getElementById('save-general').addEventListener('click', () => {
    const draggableList = document.getElementById('lyrics-source-order-draggable');
    const orderedSources = Array.from(draggableList.children)
        .map(item => item.dataset.source);

    const newGeneralSettings = {
        // Switches and dropdowns are auto-saved. This button only saves the source order.
        lyricsSourceOrder: orderedSources.join(','),
    };
    updateSettings(newGeneralSettings);
    saveSettings();
    showStatusMessage('Lyrics+ source order saved!', false, 'save-general');
});

document.getElementById('save-appearance').addEventListener('click', () => {
    const newAppearanceSettings = {
        // Switches are auto-saved. This button only saves the Custom CSS.
        customCSS: document.getElementById('custom-css').value,
    };
    updateSettings(newAppearanceSettings);
    saveSettings();
    showStatusMessage('Custom CSS saved!', false, 'save-appearance');
});

document.getElementById('save-translation').addEventListener('click', () => {
    const newTranslationSettings = {
        // Switches and dropdowns are auto-saved. This saves text inputs.
        geminiApiKey: document.getElementById('gemini-api-key').value,
        customTranslateTarget: document.getElementById('custom-translate-target').value,
        customGeminiPrompt: document.getElementById('custom-gemini-prompt').value
    };
    updateSettings(newTranslationSettings);
    saveSettings();
    showStatusMessage('Translation input fields saved!', false, 'save-translation');
});

// REMOVED: save-cache event listener is no longer needed.

// Clear cache button
document.getElementById('clear-cache').addEventListener('click', clearCache);

// Message listener for updates (e.g., from background script if settings are changed elsewhere)
setupSettingsMessageListener(updateUI);


// --- Drag and Drop Functionality for KPoe Sources ---
let draggedItem = null;

// Helper to get display name for a source
function getSourceDisplayName(sourceName) {
    switch (sourceName) {
        case 'lyricsplus': return 'Lyrics+ (User Gen.)'; // Shorter for UI
        case 'apple': return 'Apple Music';
        case 'spotify': return 'Musixmatch (Spotify)'; // Clarified
        case 'musixmatch': return 'Musixmatch (Direct)';
        case 'musixmatch-word': return 'Musixmatch (Word)'; // Shorter
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
        <button class="remove-source-button btn-icon btn-icon-error" title="Remove source">
            <span class="material-symbols-outlined">delete</span>
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

    draggableContainer.innerHTML = '';
    availableSourcesDropdown.innerHTML = '';

    const currentActiveSources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s && s.trim() !== '');

    currentActiveSources.forEach(source => {
        if (allowedSources.includes(source.trim())) { // Only add if it's a known allowed source
            draggableContainer.appendChild(createDraggableSourceItem(source.trim()));
        }
    });

    const sourcesToAdd = allowedSources.filter(source => !currentActiveSources.includes(source));
    const addSourceButton = document.getElementById('add-source-button');

    if (sourcesToAdd.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'All sources added';
        option.disabled = true;
        availableSourcesDropdown.appendChild(option);
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
    const statusElement = document.getElementById('add-source-status'); // General status for draggable list
    let targetStatusElement = statusElement;

    // If a buttonId is provided, try to find a place near that button for more specific feedback
    if (buttonIdToAppendAfter) {
        const button = document.getElementById(buttonIdToAppendAfter);
        if (button && button.parentElement && button.parentElement.classList.contains('card-actions')) {
            let specificStatus = button.parentElement.querySelector('.save-status-message');
            if (!specificStatus) {
                specificStatus = document.createElement('p');
                specificStatus.className = 'status-message save-status-message';
                button.parentElement.insertBefore(specificStatus, button); // Insert before the button
            }
            targetStatusElement = specificStatus;
        }
    }

    if (targetStatusElement) {
        clearTimeout(statusMessageTimeout); // Clear existing timeout
        targetStatusElement.textContent = message;
        targetStatusElement.style.color = isError ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)';
        targetStatusElement.style.opacity = '1';

        statusMessageTimeout = setTimeout(() => {
            targetStatusElement.style.opacity = '0';
            setTimeout(() => { // Ensure text is cleared after fade out
                if (targetStatusElement.classList.contains('save-status-message')) {
                    // Only clear if it's a temporary message, not the general add-source-status
                    targetStatusElement.textContent = '';
                } else if (targetStatusElement === statusElement) {
                    statusElement.textContent = ''; // Clear general add-source-status as well
                }
            }, 300);
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

    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s && s !== '');
    if (sources.includes(sourceName)) {
        showStatusMessage(`Source "${getSourceDisplayName(sourceName)}" already exists.`, true);
        return;
    }

    sources.push(sourceName);
    currentSettings.lyricsSourceOrder = sources.join(',');
    // No saveSettings() here, will be saved with "Save General"
    populateDraggableSources();
    showStatusMessage(`"${getSourceDisplayName(sourceName)}" added. Save general settings to apply.`, false);
}

function removeSource(sourceName) {
    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s && s !== '');
    const updatedSources = sources.filter(s => s !== sourceName);
    currentSettings.lyricsSourceOrder = updatedSources.join(',');
    // No saveSettings() here
    populateDraggableSources();
    showStatusMessage(`"${getSourceDisplayName(sourceName)}" removed. Save general settings to apply.`, false);
}


function addDragDropListeners() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    if (!draggableContainer) return;

    draggableContainer.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('draggable-source-item')) {
            draggedItem = e.target;
            setTimeout(() => {
                if (draggedItem) draggedItem.classList.add('dragging');
            }, 0);
        }
    });

    draggableContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(draggableContainer, e.clientY);
        const currentDraggable = document.querySelector('.draggable-source-item.dragging');
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
        }
        draggedItem = null;
        // Update currentSettings.lyricsSourceOrder immediately but don't save to storage yet
        const orderedSources = Array.from(draggableContainer.children)
            .map(item => item.dataset.source);
        currentSettings.lyricsSourceOrder = orderedSources.join(',');
        // User will click "Save General" to persist this
        showStatusMessage('Source order updated. Save general settings to apply.', false);
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


// Event listener for Add Source button
document.getElementById('add-source-button').addEventListener('click', addSource);

// Function to toggle KPoe sources visibility
function toggleKpoeSourcesVisibility() {
    const kpoeSourcesGroup = document.getElementById('kpoe-sources-group');
    if (kpoeSourcesGroup) {
        if (currentSettings.lyricsProvider === 'kpoe') {
            kpoeSourcesGroup.style.display = 'block';
        } else {
            kpoeSourcesGroup.style.display = 'none';
        }
    }
}

// Event listener for default-provider change
document.getElementById('default-provider').addEventListener('change', (e) => {
    currentSettings.lyricsProvider = e.target.value; // Update setting immediately for visibility toggle
    toggleKpoeSourcesVisibility();
    // actual saving happens automatically via setupAutoSaveListeners
});

// Event listener for override-translate-target change
document.getElementById('override-translate-target').addEventListener('change', (e) => {
    currentSettings.overrideTranslateTarget = e.target.checked;
    toggleTranslateTargetVisibility();
});

// Event listener for override-gemini-prompt change
document.getElementById('override-gemini-prompt').addEventListener('change', (e) => {
    currentSettings.overrideGeminiPrompt = e.target.checked;
    toggleGeminiPromptVisibility();
});

// Function to toggle Gemini settings visibility (API key, model, prompt override)
function toggleGeminiSettingsVisibility() {
    const translationProvider = document.getElementById('translation-provider').value;
    const geminiApiKeyGroup = document.getElementById('gemini-api-key-group');
    const geminiModelGroup = document.getElementById('gemini-model-group'); // Get the new model group
    const overrideGeminiPromptGroup = document.getElementById('override-gemini-prompt-group');

    if (geminiApiKeyGroup && geminiModelGroup && overrideGeminiPromptGroup) {
        if (translationProvider === 'gemini') {
            geminiApiKeyGroup.style.display = 'block';
            geminiModelGroup.style.display = 'block'; // Show the model group
            overrideGeminiPromptGroup.style.display = 'block';
        } else {
            geminiApiKeyGroup.style.display = 'none';
            geminiModelGroup.style.display = 'none'; // Hide the model group
            overrideGeminiPromptGroup.style.display = 'none';
        }
    }
    toggleGeminiPromptVisibility(); // Re-evaluate prompt visibility based on new provider
}

// Function to toggle custom translate target visibility
function toggleTranslateTargetVisibility() {
    const overrideTranslateTarget = document.getElementById('override-translate-target').checked;
    const customTranslateTargetGroup = document.getElementById('custom-translate-target-group');
    if (customTranslateTargetGroup) {
        if (overrideTranslateTarget) {
            customTranslateTargetGroup.style.display = 'block';
        } else {
            customTranslateTargetGroup.style.display = 'none';
        }
    }
}

// Function to toggle custom Gemini prompt visibility
function toggleGeminiPromptVisibility() {
    const translationProvider = document.getElementById('translation-provider').value;
    const overrideGeminiPrompt = document.getElementById('override-gemini-prompt').checked;
    const customGeminiPromptGroup = document.getElementById('custom-gemini-prompt-group');
    if (customGeminiPromptGroup) {
        if (translationProvider === 'gemini' && overrideGeminiPrompt) {
            customGeminiPromptGroup.style.display = 'block';
        } else {
            customGeminiPromptGroup.style.display = 'none';
        }
    }
}

// Event listener for translation-provider change
document.getElementById('translation-provider').addEventListener('change', (e) => {
    currentSettings.translationProvider = e.target.value; // Update setting immediately
    toggleGeminiSettingsVisibility(); // Call the renamed function
    // actual saving happens automatically via setupAutoSaveListeners
});

document.getElementById('play-example').addEventListener('click', () => {
    startFullPreviewSync(currentSettings);
});

// Event listener for API key visibility toggle button
document.getElementById('toggle-gemini-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const toggleButtonIcon = document.querySelector('#toggle-gemini-api-key-visibility .material-symbols-outlined');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleButtonIcon.textContent = 'visibility_off';
    } else {
        apiKeyInput.type = 'password';
        toggleButtonIcon.textContent = 'visibility';
    }
});
function setAppVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        const version = manifest.version;
        const versionElement = document.querySelector('.version');
        if (versionElement) {
            versionElement.textContent = `Version ${version}`;
        }
    } catch (e) {
        console.error("Could not retrieve extension version from manifest:", e);
        const versionElement = document.querySelector('.version');
        if (versionElement) {
            versionElement.textContent = 'Version unavailable';
        }
    }
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    loadSettings((settings) => {
        currentSettings = settings; // Ensure currentSettings is updated after load
        updateUI(currentSettings);
        setupAutoSaveListeners(); // Setup auto-saving for switches and selects

        const firstNavItem = document.querySelector('.navigation-drawer .nav-item');
        const activeSectionId = firstNavItem ? firstNavItem.getAttribute('data-section') : 'general';

        document.querySelectorAll('.navigation-drawer .nav-item').forEach(i => i.classList.remove('active'));
        document.querySelector(`.navigation-drawer .nav-item[data-section="${activeSectionId}"]`)?.classList.add('active');

        document.querySelectorAll('.settings-card').forEach(section => section.classList.remove('active'));
        document.getElementById(activeSectionId)?.classList.add('active');
    });

    setAppVersion();
    
    // Add event listener for the new reload button
    const reloadButton = document.getElementById('reload-button');
    if (reloadButton) {
        reloadButton.addEventListener('click', () => {
            // Find the YouTube Music tab and reload it
            chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
                if (tabs.length > 0) {
                    const ytmTab = tabs[0];
                    chrome.tabs.reload(ytmTab.id, () => {
                        // After reloading, hide the notification and maybe show a success message
                        hideReloadNotification();
                        // Optionally, show a temporary success message
                        showStatusMessage('YouTube Music tab reloaded!', false, 'save-general');
                    });
                } else {
                    // Handle case where no YTM tab is open
                    alert("No YouTube Music tab found. Please open one and try again.");
                }
            });
        });
    }
});
