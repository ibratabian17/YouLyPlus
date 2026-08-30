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
    { id: 'lyEnabled', key: 'isEnabled', type: 'checkbox' },
    { id: 'sponsorblock', key: 'useSponsorBlock', type: 'checkbox' },
    { id: 'largerTextMode', key: 'largerTextMode', type: 'value' },
    { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
    { id: 'hidePhoneticDup', key: 'hidePhoneticDup', type: 'checkbox' },
    { id: 'bkgOverlap', key: 'bkgOverlap', type: 'checkbox' },
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

function initRowClickListeners() {
    document.querySelectorAll('.setting-item.has-switch').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button, a, select, .m3-switch, textarea')) {
                return;
            }
            const switchInput = row.querySelector('.m3-switch input[type="checkbox"]');
            if (switchInput) {
                switchInput.checked = !switchInput.checked;
                switchInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSwitches();
    initCacheControls();
    initRowClickListeners();

    loadSettings((settings) => {
        updatePopupUI(settings);
    });

    bindAutoSave(popupControls, () => {
        showSnackbar(typeof msg === 'function' ? msg('msgSettingsSaved') : 'Settings saved');
    });

    setupSettingsMessageListener(updatePopupUI);
    updateCacheSize();
});

initRipple();