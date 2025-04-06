// Browser compatibility
const pBrowser = window.chrome || window.browser;
        
// Current settings object
let currentSettings = {
    lyricsProvider: 'kpoe',
    lyricsPlusSource: ['apple', 'lyricsplus', 'musixmatch'],
    wordByWord: true,
    lineByLine: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    fontSize: 16,
    accentColor: '#da7272',
    customCSS: '',
    highlightStyle: 'color',
    syncOffset: 0,
    cacheEnabled: true,
    cacheDuration: 30,
    apiKey: '',
    updateInterval: 2,
    debugMode: false
};

// Storage helper function (simulating browser.storage.local.get)
function storageLocalGet(defaultValues) {
    return new Promise((resolve) => {
        // In a real extension, this would fetch from browser.storage.local
        // For now, we'll just return the default values
        resolve(defaultValues);
    });
}

// Load settings from storage
function loadSettings(callback) {
    storageLocalGet({
        lyricsProvider: 'kpoe',
        lyricsPlusSource: ['apple', 'lyricsplus', 'musixmatch'],
        wordByWord: true,
        lineByLine: true,
        lightweight: false,
        isEnabled: true,
        useSponsorBlock: false,
        fontSize: 16,
        accentColor: '#da7272',
        customCSS: '',
        highlightStyle: 'color',
        syncOffset: 0,
        cacheEnabled: true,
        cacheDuration: 30,
        apiKey: '',
        updateInterval: 2,
        debugMode: false
    }).then((items) => {
        currentSettings = items;
        console.log("Loaded settings:", currentSettings);
        updateUI();
        if (callback) callback();
    });
}

// Update settings in storage
function saveSettings() {
    // In a real extension, this would save to browser.storage.local
    console.log("Saving settings:", currentSettings);
    
    // Notify the main page of updated settings
    window.postMessage({
        type: 'UPDATE_SETTINGS',
        settings: currentSettings
    }, '*');
}

// Update settings object with new values
function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    console.log("Updated settings:", currentSettings);
    updateUI();
}

// Update UI elements to reflect current settings
function updateUI() {
    // General settings
    document.getElementById('enabled').checked = currentSettings.isEnabled;
    document.getElementById('default-provider').value = currentSettings.lyricsProvider;
    document.getElementById('sponsor-block').checked = currentSettings.useSponsorBlock;
    document.getElementById('lightweight').checked = currentSettings.lightweight;
    
    // Sync settings
    document.getElementById('line-sync').checked = currentSettings.lineByLine;
    document.getElementById('word-sync').checked = currentSettings.wordByWord;
    document.getElementById('highlight-style').value = currentSettings.highlightStyle || 'color';
    document.getElementById('sync-offset').value = currentSettings.syncOffset || 0;
    
    // Appearance settings
    document.getElementById('font-size').value = currentSettings.fontSize || 16;
    document.getElementById('accent-color').value = currentSettings.accentColor || '#da7272';
    document.getElementById('custom-css').value = currentSettings.customCSS || '';
    document.getElementById('color-preview').style.backgroundColor = currentSettings.accentColor;
    
    // Cache settings
    document.getElementById('enable-cache').checked = currentSettings.cacheEnabled !== false;
    document.getElementById('cache-duration').value = currentSettings.cacheDuration || 30;
    
    // Advanced settings
    document.getElementById('api-key').value = currentSettings.apiKey || '';
    document.getElementById('update-interval').value = currentSettings.updateInterval || 2;
    document.getElementById('debug-mode').checked = currentSettings.debugMode || false;
    
    // Update source list
    updateSourceList();
}

// Update the displayed source list
function updateSourceList() {
    const sourceList = document.getElementById('source-list');
    sourceList.innerHTML = '';
    
    if (currentSettings.lyricsPlusSource && currentSettings.lyricsPlusSource.length) {
        currentSettings.lyricsPlusSource.forEach((source, index) => {
            const sourceItem = document.createElement('div');
            sourceItem.className = 'source-item';
            sourceItem.innerHTML = `
                <span>${source}</span>
                <div class="source-controls">
                    <button class="btn-icon move-up" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn-icon move-down" ${index === currentSettings.lyricsPlusSource.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="btn-icon secondary remove-source">×</button>
                </div>
            `;
            sourceList.appendChild(sourceItem);
            
            // Add event listeners
            sourceItem.querySelector('.move-up').addEventListener('click', () => moveSource(index, -1));
            sourceItem.querySelector('.move-down').addEventListener('click', () => moveSource(index, 1));
            sourceItem.querySelector('.remove-source').addEventListener('click', () => removeSource(index));
        });
    }
}

// Move a source up or down in the list
function moveSource(index, direction) {
    if (!currentSettings.lyricsPlusSource) return;
    
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= currentSettings.lyricsPlusSource.length) return;
    
    const sources = [...currentSettings.lyricsPlusSource];
    const temp = sources[index];
    sources[index] = sources[newIndex];
    sources[newIndex] = temp;
    
    currentSettings.lyricsPlusSource = sources;
    updateSourceList();
}

// Remove a source from the list
function removeSource(index) {
    if (!currentSettings.lyricsPlusSource) return;
    
    const sources = [...currentSettings.lyricsPlusSource];
    sources.splice(index, 1);
    
    currentSettings.lyricsPlusSource = sources;
    updateSourceList();
}

// Add a new source to the list
function addSource(source) {
    if (!source) return;
    
    if (!currentSettings.lyricsPlusSource) {
        currentSettings.lyricsPlusSource = [];
    }
    
    currentSettings.lyricsPlusSource.push(source);
    updateSourceList();
}

// Tab navigation
document.querySelectorAll('.sidebar-menu li').forEach(item => {
    item.addEventListener('click', () => {
        // Update active menu item
        document.querySelectorAll('.sidebar-menu li').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Show corresponding section
        const sectionId = item.getAttribute('data-section');
        document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
        document.getElementById(sectionId).classList.add('active');
    });
});

// Event listeners for all save buttons
document.getElementById('save-general').addEventListener('click', () => {
    updateSettings({
        isEnabled: document.getElementById('enabled').checked,
        lyricsProvider: document.getElementById('default-provider').value,
        useSponsorBlock: document.getElementById('sponsor-block').checked,
        lightweight: document.getElementById('lightweight').checked
    });
    saveSettings();
});

document.getElementById('save-sources').addEventListener('click', () => {
    saveSettings();
});

document.getElementById('save-appearance').addEventListener('click', () => {
    updateSettings({
        fontSize: parseInt(document.getElementById('font-size').value),
        accentColor: document.getElementById('accent-color').value,
        customCSS: document.getElementById('custom-css').value
    });
    saveSettings();
});

document.getElementById('save-sync').addEventListener('click', () => {
    updateSettings({
        lineByLine: document.getElementById('line-sync').checked,
        wordByWord: document.getElementById('word-sync').checked,
        highlightStyle: document.getElementById('highlight-style').value,
        syncOffset: parseInt(document.getElementById('sync-offset').value)
    });
    saveSettings();
});

document.getElementById('save-cache').addEventListener('click', () => {
    updateSettings({
        cacheEnabled: document.getElementById('enable-cache').checked,
        cacheDuration: parseInt(document.getElementById('cache-duration').value)
    });
    saveSettings();
});

// Color preview update
document.getElementById('accent-color').addEventListener('input', (e) => {
    document.getElementById('color-preview').style.backgroundColor = e.target.value;
});

// Add source button
document.querySelector('.add-source button').addEventListener('click', () => {
    const newSource = document.getElementById('new-source').value.trim();
    if (newSource) {
        addSource(newSource);
        document.getElementById('new-source').value = '';
    }
});

// Clear cache button
document.getElementById('clear-cache').addEventListener('click', () => {
    // In a real extension, this would clear the actual cache
    document.getElementById('cache-size').textContent = '0 MB used (0 songs cached)';
});

// Reset to defaults button
document.getElementById('reset-defaults').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
        loadSettings(() => {
            saveSettings();
            alert('Settings reset to defaults');
        });
    }
});

// Export settings button
document.getElementById('export-settings').addEventListener('click', () => {
    const settingsJSON = JSON.stringify(currentSettings, null, 2);
    const blob = new Blob([settingsJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lyrics_plus_settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Message listener for updates from main page
window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'UPDATE_SETTINGS') {
        console.log("Received new settings:", event.data.settings);
        updateSettings(event.data.settings);
    }
});

// Initialize
loadSettings();