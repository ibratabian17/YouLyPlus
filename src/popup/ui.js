const pBrowser = chrome || pBrowser;

document.addEventListener('DOMContentLoaded', () => {
    const providerSelect = document.getElementById('lyricsProvider');
    const wordByWord = document.getElementById('wordByWord');
    const lightweight = document.getElementById('lightweight');
    const isEnabled = document.getElementById('lyEnabled');
    const status = document.getElementById('status');
    const sponsorBlock = document.getElementById('sponsorblock');

    // Load saved settings
    loadSettings(() => {
        providerSelect.value = currentSettings.lyricsProvider ?? 'kpoe';
        wordByWord.checked = currentSettings.wordByWord ?? true;
        lightweight.checked = currentSettings.lightweight ?? false;
        isEnabled.checked = currentSettings.isEnabled ?? true;
        sponsorBlock.checked = currentSettings.useSponsorBlock ?? false;
    });

    // Save settings and notify tabs
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
            // Use storageLocalSet instead of pBrowser.storage.sync.set
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
