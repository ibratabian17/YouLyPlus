// ==========================================================================
// YouLy+ Popup UI Logic
// Uses shared settingsManager and uiUtils
// ==========================================================================

import {
    loadSettings,
    updateSettings,
    getSettings,
    updateCacheSize,
    clearCache,
    setupSettingsMessageListener
} from '../lib/settingsManager.js';

import {
    initRipple,
    initSwitches,
    showSnackbar,
    bindAutoSave
} from '../lib/uiUtils.js';

const popupControls = [
    // General - Core Features
    { id: 'lyEnabled', key: 'isEnabled', type: 'checkbox' },
    // General - Data Sources
    { id: 'sponsorblock', key: 'useSponsorBlock', type: 'checkbox' },
    // Appearance - Readability
    { id: 'largerTextMode', key: 'largerTextMode', type: 'value' },
    { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
    { id: 'hidePhoneticDup', key: 'hidePhoneticDup', type: 'checkbox' },
    { id: 'bkgOverlap', key: 'bkgOverlap', type: 'checkbox' },
    // Advanced - Performance
    { id: 'lightweight', key: 'lightweight', type: 'checkbox' },
    { id: 'hideOffscreen', key: 'hideOffscreen', type: 'checkbox' },
    { id: 'blurInactive', key: 'blurInactive', type: 'checkbox' }
];

function updatePopupUI(settings) {
    if (!settings) return;

    popupControls.forEach(control => {
        const el = document.getElementById(control.id);
        if (!el) return;

        if (control.type === 'checkbox') {
            el.checked = !!settings[control.key];
        } else {
            el.value = settings[control.key] !== undefined ? settings[control.key] : '';
        }
    });
}

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            const targetContentId = tab.dataset.tab;
            document.getElementById(targetContentId)?.classList.add('active');
        });
    });
}

function initCacheControls() {
    const clearCacheButton = document.getElementById('clearCache');
    const refreshCacheButton = document.getElementById('refreshCache');

    clearCacheButton?.addEventListener('click', async () => {
        const res = await clearCache();
        if (res && res.success) {
            showSnackbar(typeof msg === 'function' ? msg('msgCacheCleared') : 'Cache cleared');
            updateCacheSize();
        } else {
            showSnackbar(typeof msg === 'function' ? msg('msgCacheClearFailed') : 'Cache clear failed', true);
        }
    });

    refreshCacheButton?.addEventListener('click', async () => {
        await updateCacheSize();
        showSnackbar(typeof msg === 'function' ? msg('msgCacheRefreshed') : 'Cache refreshed');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSwitches();
    initCacheControls();

    loadSettings((settings) => {
        updatePopupUI(settings);
    });

    bindAutoSave(popupControls, () => {
        showSnackbar(typeof msg === 'function' ? msg('msgSettingsSaved') : 'Settings saved');
    });

    setupSettingsMessageListener(updatePopupUI);
    updateCacheSize();
});

// Initialize global ripple effect
initRipple();