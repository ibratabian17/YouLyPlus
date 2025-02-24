loadSettings(() => {
    initializeLyricsPlus()
});

function initializeLyricsPlus() {
    // Start monitoring for song changes
    setInterval(checkForSongChange, 1000);
    setupMutationObserver();
  }