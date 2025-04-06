const pBrowser = chrome || browser;
//Global
document.addEventListener('DOMContentLoaded', () => {
    const providerSelect = document.getElementById('lyricsProvider');
    const wordByWord = document.getElementById('wordByWord');
    const lightweight = document.getElementById('lightweight');
    const isEnabled = document.getElementById('lyEnabled');
    const status = document.getElementById('status');
    const sponsorBlock = document.getElementById('sponsorblock');
    const clearCacheButton = document.querySelector('.clear-cache');
    const cacheSizeElem = document.querySelector('.cache-size');

    // Tab functionality
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab, .tab-content').forEach(el => {
                el.classList.remove('active');
            });
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // Range input
    /*const fontSizeSlider = document.getElementById('fontSize');
    const rangeValue = document.querySelector('.range-value');
    fontSizeSlider.addEventListener('input', (e) => {
        rangeValue.textContent = `${e.target.value}px`;
        updateSettings({ fontSize: e.target.value });
    });*/

    // Load saved settings
    loadSettings(() => {
        providerSelect.value = currentSettings.lyricsProvider ?? 'kpoe';
        wordByWord.checked = currentSettings.wordByWord ?? true;
        lightweight.checked = currentSettings.lightweight ?? false;
        isEnabled.checked = currentSettings.isEnabled ?? true;
        sponsorBlock.checked = currentSettings.useSponsorBlock ?? false;
    });

    // Save settings and notify tabs
    [providerSelect, wordByWord, lightweight, isEnabled, sponsorBlock].forEach(element => {
        element.addEventListener('change', () => {
            const newSettings = {
                lyricsProvider: providerSelect.value,
                wordByWord: wordByWord.checked,
                lightweight: lightweight.checked,
                isEnabled: isEnabled.checked,
                useSponsorBlock: sponsorBlock.checked
            };

            updateSettings(newSettings);
            storageLocalSet(newSettings).then(() => {
                showStatus();
                notifyTabs(newSettings); // Notify content script
            });
        });
    });

    function showStatus() {
        status.textContent = 'Settings saved! Reload your pages.';
        status.classList.add('show-status');
        setTimeout(() => {
            status.classList.remove('show-status');
        }, 2000);
    }

    function notifyTabs(settings) {
        pBrowser.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                pBrowser.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: (newSettings) => {
                        window.postMessage({ type: 'UPDATE_SETTINGS', settings: newSettings }, '*');
                    },
                    args: [settings]
                });
            });
        });
    }

    // Update the displayed cache size when the popup loads.
    updateCacheSize();

    // Add event listener to the Clear Cache button.
    clearCacheButton.addEventListener('click', () => {
        pBrowser.runtime.sendMessage({ type: 'RESET_CACHE' }, (response) => {
            if (response.success) {
                updateCacheSize(); // Refresh the displayed cache size
            } else {
                console.error("Error resetting cache:", response.error);
            }
        });
    });
});

let currentSettings = {};

// Change loadSettings to use storageLocalGet instead of pBrowser.storage.sync.get
function loadSettings(callback) {
    storageLocalGet({
        lyricsProvider: 'kpoe',
        wordByWord: true,
        lightweight: false,
        isEnabled: true,
        useSponsorBlock: false,
    }).then((items) => {
        currentSettings = items;
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    currentSettings = newSettings;
}

// Function to update the cache size display.
function updateCacheSize() {
    pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' }, (response) => {
        if (response.success) {
            const sizeMB = (response.sizeKB / 1024).toFixed(2);
            document.querySelector('.cache-size').textContent = sizeMB;
            document.querySelector('.cache-count').textContent = response.cacheCount;
        } else {
            console.error("Error getting cache size:", response.error);
        }
    });
}
