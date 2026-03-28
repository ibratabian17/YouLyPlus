document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const lyEnabledSwitchInput = document.getElementById('lyEnabled');
    const sponsorBlockSwitchInput = document.getElementById('sponsorblock');

    // Appearance - Readability
    const largerTextModeSelect = document.getElementById('largerTextMode');
    const wordByWordSwitchInput = document.getElementById('wordByWord');
    const hidePhoneticDupSwitchInput = document.getElementById('hidePhoneticDup');
    const bkgOverlapSwitchInput = document.getElementById('bkgOverlap');

    // Advanced - Performance
    const lightweightSwitchInput = document.getElementById('lightweight');
    const hideOffscreenSwitchInput = document.getElementById('hideOffscreen');
    const blurInactiveSwitchInput = document.getElementById('blurInactive');

    const clearCacheButton = document.getElementById('clearCache');
    const refreshCacheButton = document.getElementById('refreshCache');
    const cacheSizeElement = document.querySelector('.cache-size-value');
    const cacheCountElement = document.querySelector('.cache-count-value');

    const snackbar = document.getElementById('statusSnackbar');
    const snackbarText = snackbar.querySelector('.snackbar-text');
    let snackbarTimeout;

    // --- Tabs ---
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

    document.querySelectorAll('.m3-switch').forEach(switchContainer => {
        switchContainer.addEventListener('click', function() {
            const checkbox = this.querySelector('.m3-switch-input');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        switchContainer.addEventListener('keydown', function(event) {
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                const checkbox = this.querySelector('.m3-switch-input');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
        switchContainer.setAttribute('tabindex', '0');
    });


    // --- Settings Object ---
    let currentSettings = {};

    // --- Storage Functions ---
    const storageLocalGet = (keys) => {
        return new Promise((resolve, reject) => {
            if (typeof pBrowser === 'undefined' || !pBrowser.storage) {
                console.warn("pBrowser.storage not available. Using mock storage.");
                // Mock for environments without extension APIs
                const mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                const result = {};
                Object.keys(keys).forEach(key => {
                    if (mockStorage.hasOwnProperty(key)) result[key] = mockStorage[key];
                    else result[key] = keys[key];
                });
                resolve(result);
                return;
            }
            pBrowser.storage.local.get(keys, (result) => {
                if (pBrowser.runtime.lastError) {
                    reject(pBrowser.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
    };
    const storageLocalSet = (items) => {
        return new Promise((resolve, reject) => {
             if (typeof pBrowser === 'undefined' || !pBrowser.storage) {
                console.warn("pBrowser.storage not available. Using mock storage.");
                let mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                mockStorage = {...mockStorage, ...items};
                localStorage.setItem('youly_mock_storage', JSON.stringify(mockStorage));
                resolve();
                return;
            }
            pBrowser.storage.local.set(items, () => {
                if (pBrowser.runtime.lastError) {
                    reject(pBrowser.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    };

    // --- Load Settings ---
    function loadSettingsUI() {
        lyEnabledSwitchInput.checked = currentSettings.isEnabled;
        sponsorBlockSwitchInput.checked = currentSettings.useSponsorBlock;

        // Appearance - Readability
        largerTextModeSelect.value = currentSettings.largerTextMode;
        wordByWordSwitchInput.checked = currentSettings.wordByWord;
        hidePhoneticDupSwitchInput.checked = currentSettings.hidePhoneticDup;
        bkgOverlapSwitchInput.checked = currentSettings.bkgOverlap;

        // Advanced - Performance
        lightweightSwitchInput.checked = currentSettings.lightweight;
        hideOffscreenSwitchInput.checked = currentSettings.hideOffscreen;
        blurInactiveSwitchInput.checked = currentSettings.blurInactive;
    }

    async function fetchAndLoadSettings() {
        try {
            const items = await storageLocalGet(defaultSettings);
            currentSettings = items;
            loadSettingsUI();
        } catch (error) {
            console.error("YouLy+: Error loading settings:", error);
            currentSettings = { ...defaultSettings };
            loadSettingsUI();
        }
    }

    // --- Save Settings ---
    async function saveAndApplySettings() {
        const newSettings = {
            isEnabled: lyEnabledSwitchInput.checked,
            useSponsorBlock: sponsorBlockSwitchInput.checked,
            // Readability
            largerTextMode: largerTextModeSelect.value,
            wordByWord: wordByWordSwitchInput.checked,
            hidePhoneticDup: hidePhoneticDupSwitchInput.checked,
            bkgOverlap: bkgOverlapSwitchInput.checked,
            // Performance
            lightweight: lightweightSwitchInput.checked,
            hideOffscreen: hideOffscreenSwitchInput.checked,
            blurInactive: blurInactiveSwitchInput.checked,
        };
        currentSettings = { ...currentSettings, ...newSettings };

        try {
            await storageLocalSet(currentSettings);
            showSnackbar(msg('msgSettingsSaved'));
            notifyContentScripts(currentSettings);
        } catch (error) {
            console.error("YouLy+: Error saving settings:", error);
            showSnackbar(msg('msgErrorSavingSettings'), true);
        }
    }

    // --- Event Listeners for Settings ---
    largerTextModeSelect.addEventListener('change', saveAndApplySettings);
    // For switches, the 'change' event is dispatched manually by the .m3-switch click handler
    [lyEnabledSwitchInput, sponsorBlockSwitchInput, wordByWordSwitchInput, hidePhoneticDupSwitchInput, bkgOverlapSwitchInput, lightweightSwitchInput, hideOffscreenSwitchInput, blurInactiveSwitchInput].forEach(input => {
        input.addEventListener('change', saveAndApplySettings);
    });


    // --- Snackbar ---
    function showSnackbar(message, isError = false) {
        if (snackbarTimeout) clearTimeout(snackbarTimeout);
        snackbarText.textContent = message;
        snackbar.style.backgroundColor = isError ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-inverse-surface)';
        snackbar.style.color = isError ? 'var(--md-sys-color-on-error-container)' : 'var(--md-sys-color-inverse-on-surface)';

        snackbar.classList.add('show');
        snackbarTimeout = setTimeout(() => {
            snackbar.classList.remove('show');
        }, 3500);
    }

    // --- Notify Content Scripts ---
    function notifyContentScripts(settings) {
        if (typeof pBrowser !== 'undefined' && pBrowser.tabs && pBrowser.tabs.query) {
            pBrowser.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
                if (pBrowser.runtime.lastError) {
                    console.warn("YouLy+: Error querying tabs:", pBrowser.runtime.lastError.message);
                    return;
                }
                tabs.forEach(tab => {
                    if (tab.id) {
                        pBrowser.tabs.sendMessage(tab.id, {
                            type: 'YOUPLUS_SETTINGS_UPDATED',
                            settings: settings
                        }).catch(err => console.warn(`YouLy+: Could not send message to tab ${tab.id}: ${err.message}.`));
                    }
                });
            });
        } else {
            console.warn("YouLy+: pBrowser.tabs.query not available. Skipping content script notification.");
        }
    }

    // --- Cache Management ---
    async function updateCacheDisplay() {
        if (typeof pBrowser === 'undefined' || !pBrowser.runtime || !pBrowser.runtime.sendMessage) {
            console.warn("YouLy+: pBrowser.runtime.sendMessage not available for cache display.");
            cacheSizeElement.textContent = 'N/A';
            cacheCountElement.textContent = 'N/A';
            return;
        }
        try {
            const response = await pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' });
            if (response && response.success) {
                const sizeMB = (response.sizeKB / 1024).toFixed(2);
                cacheSizeElement.textContent = `${sizeMB} MB`;
                cacheCountElement.textContent = response.cacheCount.toString();
            } else {
                cacheSizeElement.textContent = 'N/A';
                cacheCountElement.textContent = 'N/A';
                console.error("YouLy+: Error getting cache size:", response ? response.error : "No response");
            }
        } catch (error) {
            cacheSizeElement.textContent = 'Error';
            cacheCountElement.textContent = 'Error';
            console.error("YouLy+: Failed to send GET_CACHED_SIZE message:", error);
        }
    }

    clearCacheButton.addEventListener('click', async () => {
        if (typeof pBrowser === 'undefined' || !pBrowser.runtime || !pBrowser.runtime.sendMessage) {
            showSnackbar(msg('msgCacheClearApiUnavailable'), true);
            return;
        }
        try {
            const response = await pBrowser.runtime.sendMessage({ type: 'RESET_CACHE' });
            if (response && response.success) {
                showSnackbar(msg('msgCacheCleared'));
                updateCacheDisplay();
            } else {
                showSnackbar(msg('msgCacheClearFailed'), true);
                console.error("YouLy+: Error resetting cache:", response ? response.error : "No response");
            }
        } catch (error) {
            showSnackbar(msg('msgCacheClearError'), true);
            console.error("YouLy+: Failed to send RESET_CACHE message:", error);
        }
    });

    refreshCacheButton.addEventListener('click', () => {
        updateCacheDisplay();
        showSnackbar(msg('msgCacheRefreshed'));
    });

    // --- Initial Load ---
    fetchAndLoadSettings();
    updateCacheDisplay();
});

document.addEventListener('click', function (e) {
    const target = e.target.closest('.m3-button, .nav-item, .draggable-source-item, .tab');
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