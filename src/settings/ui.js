import { loadSettings, saveSettings, updateSettings, getSettings, updateCacheSize, clearCache, setupSettingsMessageListener, uploadLocalLyrics, getLocalLyricsList, deleteLocalLyrics } from './settingsManager.js';
import { parseSyncedLyrics, parseAppleTTML, convertToStandardJson, v1Tov2 } from '../lib/parser.js';

let currentSettings = getSettings();

// SVG icon paths (Material Icons)
const SVG_ICONS = {
    dragIndicator: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    musicNote: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
    arrowDropDown: 'M7 10l5 5 5-5z',
    visibility: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
    visibilityOff: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
    uploadFile: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11z',
    hourglassEmpty: 'M6 2v6l2 2-2 2v6h12v-6l-2-2 2-2V2H6zm10 14.5l-4-2-4 2V17h8v-.5zm0-9l-4 2-4-2V5h8v2.5z',
};

function createSvgIcon(pathD) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon-svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
}

function swapSvgIconPath(svgEl, newPathD) {
    const path = svgEl.querySelector('path');
    if (path) path.setAttribute('d', newPathD);
}

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

            notificationText.innerHTML = msg('msgSettingsSavedRestartPlatform', platformString).replace(platformString, `<strong>${platformString}</strong>`);
            if (reloadBtnText) reloadBtnText.textContent = availablePlatforms.length > 1 ? msg('buttonRestartTabs') : `${msg('buttonRestart')} ${names[0]}`;
        } else {
            notificationText.textContent = msg('msgSettingsSavedRestart');
            if (reloadBtnText) reloadBtnText.textContent = msg('buttonRestart');
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
        { id: 'prefer-unison-video', key: 'preferUnisonVideo', type: 'checkbox' },

        // Sources
        { id: 'custom-kpoe-url', key: 'customKpoeUrl', type: 'value', debounce: 500 },

        // Translation
        { id: 'translation-provider', key: 'translationProvider', type: 'value' },
        { id: 'gemini-api-key', key: 'geminiApiKey', type: 'value', debounce: 500 },
        { id: 'gemini-model', key: 'geminiModel', type: 'value' },
        { id: 'openrouter-api-key', key: 'openRouterApiKey', type: 'value', debounce: 500 },
        { id: 'openrouter-model', key: 'openRouterModel', type: 'value', debounce: 500 },
        { id: 'deepl-api-key', key: 'deeplApiKey', type: 'value', debounce: 500 },
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
        { id: 'hide-phoneticdup', key: 'hidePhoneticDup', type: 'checkbox' },
        { id: 'bkg-overlap', key: 'bkgOverlap', type: 'checkbox' },
        { id: 'lightweight', key: 'lightweight', type: 'checkbox' },
        { id: 'hide-offscreen', key: 'hideOffscreen', type: 'checkbox' },
        { id: 'blur-inactive', key: 'blurInactive', type: 'checkbox' },
        { id: 'dynamic-player', key: 'dynamicPlayer', type: 'checkbox' },
        { id: 'audio-beat-sync', key: 'audioBeatSync', type: 'checkbox' },
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
    setCheck('prefer-unison-video', currentSettings.preferUnisonVideo);

    // Sources
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
    setVal('deepl-api-key', currentSettings.deeplApiKey);
    document.getElementById('deepl-api-key').type = 'password';

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
    setCheck('hide-phoneticdup', currentSettings.hidePhoneticDup);
    setCheck('bkg-overlap', currentSettings.bkgOverlap);
    setCheck('lightweight', currentSettings.lightweight);
    setCheck('hide-offscreen', currentSettings.hideOffscreen);
    setCheck('blur-inactive', currentSettings.blurInactive);
    setCheck('dynamic-player', currentSettings.dynamicPlayer);
    setCheck('audio-beat-sync', currentSettings.audioBeatSync);
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
    toggleDeepLSettingsVisibility();
    toggleTranslateTargetVisibility();
    toggleGeminiPromptVisibility();
    toggleGeminiRomanizePromptVisibility();
    toggleRomanizationModelVisibility();

    populateDraggableProviders();
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
    const sourceKeys = {
        'kpoe': 'sourceNameLyricsPlusProvider',
        'customKpoe': 'sourceNameCustomKpoe',
        'unison': 'sourceNameUnison',
        'lrclib': 'sourceNameLRCLib',
        'lyricsplus': 'sourceNameLyricsPlus',
        'apple': 'sourceNameApple',
        'qq': 'sourceNameQQ',
        'spotify': 'sourceNameSpotify',
        'musixmatch': 'sourceNameMusixmatch',
        'musixmatch-word': 'sourceNameMusixmatchWord',
        'unison': 'sourceNameUnison'
    };
    if (sourceKeys[sourceName]) {
        return msg(sourceKeys[sourceName]) || sourceName;
    }
    return sourceName.charAt(0).toUpperCase() + sourceName.slice(1).replace('-', ' ');
}

function createDraggableProviderItem(providerName) {
    const li = document.createElement('div');
    li.className = 'draggable-source-item';
    li.dataset.provider = providerName;
    li.setAttribute('draggable', true);

    const dragHandle = createSvgIcon(SVG_ICONS.dragIndicator);
    dragHandle.classList.add('drag-handle');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'source-name';
    nameSpan.textContent = getSourceDisplayName(providerName);

    // Add subtitle for fast path indicator on the first item
    const subtitle = document.createElement('span');
    subtitle.className = 'provider-fast-path-indicator';
    subtitle.textContent = ' (Fast Path)';
    subtitle.style.fontSize = '0.8em';
    subtitle.style.opacity = '0.7';
    subtitle.style.marginLeft = '8px';
    nameSpan.appendChild(subtitle);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'm3-button icon remove-source-button';
    removeBtn.title = msg('titleRemoveSource') || 'Remove';

    const deleteIcon = createSvgIcon(SVG_ICONS.delete);
    deleteIcon.classList.add('icon-svg');

    removeBtn.appendChild(deleteIcon);
    removeBtn.onclick = () => removeProvider(providerName);

    li.appendChild(dragHandle);
    li.appendChild(nameSpan);
    li.appendChild(removeBtn);

    return li;
}

function populateDraggableProviders() {
    const draggableContainer = document.getElementById('provider-order-draggable');
    const availableProvidersDropdown = document.getElementById('available-providers-dropdown');
    const allowedProviders = ['kpoe', 'customKpoe', 'unison', 'lrclib'];

    if (!draggableContainer || !availableProvidersDropdown) return;

    draggableContainer.innerHTML = '';
    availableProvidersDropdown.innerHTML = '<option value="" disabled selected></option>';

    const currentActiveProviders = (currentSettings.lyricsProviderOrder || 'kpoe,unison,lrclib').split(',').filter(s => s?.trim());
    currentActiveProviders.forEach(provider => {
        if (allowedProviders.includes(provider.trim())) {
            draggableContainer.appendChild(createDraggableProviderItem(provider.trim()));
        }
    });

    updateFastPathIndicators();

    const providersToAdd = allowedProviders.filter(provider => !currentActiveProviders.includes(provider));
    const addProviderButton = document.getElementById('add-provider-button');

    if (providersToAdd.length === 0) {
        availableProvidersDropdown.innerHTML = `<option value="" disabled>${msg('msgAllSourcesAdded')}</option>`;
        if (addProviderButton) addProviderButton.disabled = true;
    } else {
        if (addProviderButton) addProviderButton.disabled = false;
        providersToAdd.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider;
            option.textContent = getSourceDisplayName(provider);
            availableProvidersDropdown.appendChild(option);
        });
    }
    updateCustomSelectDisplay('available-providers-dropdown');
    addProviderDragDropListeners();
    addProviderTouchListeners();
}

function updateFastPathIndicators() {
    const draggableContainer = document.getElementById('provider-order-draggable');
    if (!draggableContainer) return;

    Array.from(draggableContainer.children).forEach((child, index) => {
        const indicator = child.querySelector('.provider-fast-path-indicator');
        if (indicator) {
            indicator.style.display = index === 0 ? 'inline' : 'none';
        }
    });
}

function saveProviderOrder() {
    const draggableContainer = document.getElementById('provider-order-draggable');
    if (!draggableContainer) return;

    const orderedProviders = Array.from(draggableContainer.children)
        .map(item => item.dataset.provider);

    updateSettings({
        lyricsProviderOrder: orderedProviders.join(',')
    });
    saveSettings();
    updateFastPathIndicators();
    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
    showReloadNotification('lyricsProviderOrder');
}

function addProvider() {
    const providerName = document.getElementById('available-providers-dropdown').value;
    if (!providerName) {
        showStatusMessage('add-provider-status', msg('msgSelectSource'), true);
        return;
    }

    const providers = (currentSettings.lyricsProviderOrder || 'kpoe,unison,lrclib').split(',').filter(s => s?.trim());
    if (providers.includes(providerName)) {
        showStatusMessage('add-provider-status', msg('msgSourceExists', getSourceDisplayName(providerName)), true);
        return;
    }

    providers.push(providerName);
    currentSettings.lyricsProviderOrder = providers.join(',');
    updateSettings({ lyricsProviderOrder: currentSettings.lyricsProviderOrder });
    saveSettings();
    showReloadNotification('lyricsProviderOrder');

    populateDraggableProviders();
    showStatusMessage('add-provider-status', msg('msgSourceAdded', getSourceDisplayName(providerName)), false);
}

function removeProvider(providerName) {
    const providers = (currentSettings.lyricsProviderOrder || 'kpoe,unison,lrclib').split(',').filter(s => s?.trim());

    if (providers.length <= 1) {
        showStatusMessage('add-provider-status', "Cannot remove last provider", true);
        return;
    }

    currentSettings.lyricsProviderOrder = providers.filter(s => s !== providerName).join(',');

    updateSettings({ lyricsProviderOrder: currentSettings.lyricsProviderOrder });
    saveSettings();
    showReloadNotification('lyricsProviderOrder');

    populateDraggableProviders();
    toggleKpoeSourcesVisibility();
    toggleCustomKpoeUrlVisibility();
    showStatusMessage('add-provider-status', msg('msgSourceRemoved', getSourceDisplayName(providerName)), false);
}

function addProviderDragDropListeners() {
    const draggableContainer = document.getElementById('provider-order-draggable');
    if (!draggableContainer || draggableContainer.dataset.dragListenersAttached) return;

    const onDragEnd = () => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
        saveProviderOrder();
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
        if (currentDraggable && currentDraggable.parentNode === draggableContainer) {
            if (afterElement) {
                draggableContainer.insertBefore(currentDraggable, afterElement);
            } else {
                draggableContainer.appendChild(currentDraggable);
            }
            updateFastPathIndicators();
        }
    });

    draggableContainer.addEventListener('dragend', onDragEnd);
    draggableContainer.dataset.dragListenersAttached = 'true';
}

function addProviderTouchListeners() {
    const draggableContainer = document.getElementById('provider-order-draggable');
    if (!draggableContainer || draggableContainer.dataset.touchListenersAttached) return;

    let touchDraggedItem = null;

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
        if (!touchDraggedItem || touchDraggedItem.parentNode !== draggableContainer) return;
        e.preventDefault();

        const touchLocation = e.targetTouches[0];
        const afterElement = getDragAfterElement(draggableContainer, touchLocation.clientY);

        if (afterElement) {
            draggableContainer.insertBefore(touchDraggedItem, afterElement);
        } else {
            draggableContainer.appendChild(touchDraggedItem);
        }
        updateFastPathIndicators();
    }, { passive: false });

    draggableContainer.addEventListener('touchend', (e) => {
        if (touchDraggedItem) {
            touchDraggedItem.classList.remove('dragging');
            touchDraggedItem.style.opacity = '1';
            touchDraggedItem = null;
            saveProviderOrder();
        }
    });
    draggableContainer.dataset.touchListenersAttached = 'true';
}

function createDraggableSourceItem(sourceName) {
    const item = document.createElement('div');
    item.className = 'draggable-source-item';
    item.setAttribute('draggable', 'true');
    item.dataset.source = sourceName;
    const dragHandle = createSvgIcon(SVG_ICONS.dragIndicator);
    dragHandle.classList.add('drag-handle');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'source-name';
    nameSpan.textContent = getSourceDisplayName(sourceName);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'm3-button icon remove-source-button';
    removeBtn.title = 'Remove source';
    removeBtn.appendChild(createSvgIcon(SVG_ICONS.delete));

    item.appendChild(dragHandle);
    item.appendChild(nameSpan);
    item.appendChild(removeBtn);

    item.querySelector('.remove-source-button').addEventListener('click', (e) => {
        e.stopPropagation();
        removeSource(sourceName);
    });
    return item;
}

function populateDraggableSources() {
    const draggableContainer = document.getElementById('lyrics-source-order-draggable');
    const availableSourcesDropdown = document.getElementById('available-sources-dropdown');
    const allowedSources = ['lyricsplus', 'apple', 'qq', 'musixmatch', 'musixmatch-word'];

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
        availableSourcesDropdown.innerHTML = `<option value="" disabled>${msg('msgAllSourcesAdded')}</option>`;
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
        showStatusMessage('add-source-status', msg('msgSelectSource'), true);
        return;
    }

    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    if (sources.includes(sourceName)) {
        showStatusMessage('add-source-status', msg('msgSourceExists', getSourceDisplayName(sourceName)), true);
        return;
    }

    sources.push(sourceName);
    currentSettings.lyricsSourceOrder = sources.join(',');
    updateSettings({ lyricsSourceOrder: currentSettings.lyricsSourceOrder });
    saveSettings();
    showReloadNotification('lyricsSourceOrder');

    populateDraggableSources();
    showStatusMessage('add-source-status', msg('msgSourceAdded', getSourceDisplayName(sourceName)), false);
}

function removeSource(sourceName) {
    const sources = (currentSettings.lyricsSourceOrder || '').split(',').filter(s => s?.trim());
    currentSettings.lyricsSourceOrder = sources.filter(s => s !== sourceName).join(',');

    // Auto-save immediately
    updateSettings({ lyricsSourceOrder: currentSettings.lyricsSourceOrder });
    saveSettings();
    showReloadNotification('lyricsSourceOrder');

    populateDraggableSources();
    showStatusMessage('add-source-status', msg('msgSourceRemoved', getSourceDisplayName(sourceName)), false);
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

document.getElementById('add-provider-button').addEventListener('click', addProvider);
document.getElementById('add-source-button').addEventListener('click', addSource);

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
    toggleDeepLSettingsVisibility();
});

function toggleElementVisibility(elementId, isVisible) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = isVisible ? 'block' : 'none';
    }
}

function toggleKpoeSourcesVisibility() {
    const providerOrderStr = currentSettings.lyricsProviderOrder || 'kpoe,unison,lrclib';
    const providers = providerOrderStr.split(',').map(s => s.trim());
    const isVisible = providers.includes('kpoe') || providers.includes('customKpoe');
    const sourceOrderContainer = document.getElementById('setting-source-order');
    if (sourceOrderContainer) {
        sourceOrderContainer.style.display = isVisible ? 'block' : 'none';
        sourceOrderContainer.style.opacity = isVisible ? '1' : '0';
    }
}

function toggleCustomKpoeUrlVisibility() {
    const providerOrderStr = currentSettings.lyricsProviderOrder || 'kpoe,unison,lrclib';
    const providers = providerOrderStr.split(',').map(s => s.trim());
    const isVisible = providers.includes('customKpoe');
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

function toggleDeepLSettingsVisibility() {
    const isDeepL = document.getElementById('translation-provider').value === 'deepl';
    toggleElementVisibility('deepl-settings-category', isDeepL);
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
    const uploadButtonIcon = uploadButton.querySelector('.icon-svg');

    const title = titleInput.value.trim();
    const artist = artistInput.value.trim();
    const album = albumInput.value.trim();
    const lyricsFile = lyricsFileInput.files[0];

    if (!title || !artist || !lyricsFile) {
        showStatusMessage('modal-upload-status', msg('msgUploadRequired'), true);
        return;
    }

    const getFileExtension = (filename) => filename.split('.').pop().toLowerCase();
    const format = getFileExtension(lyricsFile.name);

    uploadButton.disabled = true;
    swapSvgIconPath(uploadButtonIcon, SVG_ICONS.hourglassEmpty);
    showStatusMessage('modal-upload-status', msg('msgUploading'), false);

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
                    const firstItem = parsedLyrics.lyrics?.[0];
                    if (firstItem && firstItem.isLineEnding !== undefined) {
                        parsedLyrics = v1Tov2(parsedLyrics);
                    }
                    break;
                default: throw new Error('Unsupported lyrics format.');
            }
            const jsonLyrics = format === 'json' ? parsedLyrics : convertToStandardJson(parsedLyrics);
            await uploadLocalLyrics(songInfo, jsonLyrics);
            showStatusMessage('modal-upload-status', msg('msgUploadSuccess'), false);
            titleInput.value = ''; artistInput.value = ''; albumInput.value = ''; lyricsFileInput.value = '';
            document.getElementById('upload-lyrics-modal').style.display = 'none';
            populateLocalLyricsList();
        } catch (error) {
            showStatusMessage('modal-upload-status', msg('msgUploadError', String(error.message || error)), true);
        } finally {
            uploadButton.disabled = false;
            swapSvgIconPath(uploadButtonIcon, SVG_ICONS.uploadFile);
        }
    };
    reader.onerror = () => {
        showStatusMessage('modal-upload-status', msg('msgFileReadError'), true);
        uploadButton.disabled = false;
        swapSvgIconPath(uploadButtonIcon, SVG_ICONS.uploadFile);
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
            const musicIcon = createSvgIcon(SVG_ICONS.musicNote);
            musicIcon.classList.add('drag-handle');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'source-name';
            nameSpan.textContent = `${item.songInfo.title} - ${item.songInfo.artist}`;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'm3-button icon remove-source-button';
            removeBtn.title = 'Delete local lyrics';
            removeBtn.appendChild(createSvgIcon(SVG_ICONS.delete));

            listItem.appendChild(musicIcon);
            listItem.appendChild(nameSpan);
            listItem.appendChild(removeBtn);
            listItem.querySelector('.remove-source-button').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(msg('confirmDeleteLyrics', `${item.songInfo.title} - ${item.songInfo.artist}`))) {
                    try {
                        await deleteLocalLyrics(item.songId);
                        showStatusMessage('local-lyrics-status', msg('msgLocalLyricsDeleted'), false);
                        populateLocalLyricsList();
                    } catch (error) {
                        showStatusMessage('local-lyrics-status', msg('msgDeleteError', String(error)), true);
                    }
                }
            });
            listContainer.appendChild(listItem);
        });
    } catch (error) {
        console.error("Failed to load local lyrics list:", error);
        noLyricsMessage.textContent = msg('msgErrorLoadingLocalLyrics', String(error.message || error));
        noLyricsMessage.style.display = 'block';
    }
}

document.getElementById('toggle-gemini-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const iconSvg = document.querySelector('#toggle-gemini-api-key-visibility .icon-svg');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibilityOff);
    } else {
        apiKeyInput.type = 'password';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibility);
    }
});

document.getElementById('toggle-openrouter-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('openrouter-api-key');
    const iconSvg = document.querySelector('#toggle-openrouter-api-key-visibility .icon-svg');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibilityOff);
    } else {
        apiKeyInput.type = 'password';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibility);
    }
});

document.getElementById('toggle-deepl-api-key-visibility').addEventListener('click', () => {
    const apiKeyInput = document.getElementById('deepl-api-key');
    const iconSvg = document.querySelector('#toggle-deepl-api-key-visibility .icon-svg');
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibilityOff);
    } else {
        apiKeyInput.type = 'password';
        swapSvgIconPath(iconSvg, SVG_ICONS.visibility);
    }
});

function setAppVersion() {
    try {
        const version = chrome.runtime.getManifest().version;
        document.querySelector('.version').textContent = msg('labelVersion', version);
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
        showStatusMessage('config-status', msg('msgExportSuccess'), false);
    } catch (error) {
        console.error('Failed to export settings:', error);
        showStatusMessage('config-status', msg('msgExportError', error.message), true);
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
            showStatusMessage('config-status', msg('msgImportSuccess'), false);
            showReloadNotification();
        } catch (error) {
            console.error('Failed to import settings:', error);
            showStatusMessage('config-status', msg('msgImportError', error.message), true);
        } finally {
            event.target.value = '';
        }
    };
    reader.onerror = () => {
        showStatusMessage('config-status', msg('msgFileReadError'), true);
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
            alert(msg('msgNoActiveTabs'));
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

        const arrow = createSvgIcon(SVG_ICONS.arrowDropDown);
        arrow.classList.add('m3-select-arrow');

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
