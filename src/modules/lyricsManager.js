// lyricsManager.js
let currentFetchVideoId = null;
let currentDisplayMode = 'none'; // Manages the active translation/romanization mode

let lastKnownSongInfo = null; // Store last known song info for reload


async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  try {
    const localCurrentFetchVideoId = currentSong.videoId;
    currentFetchVideoId = localCurrentFetchVideoId; // Set the latest videoId being processed globally for this manager

    LyricsPlusAPI.cleanupLyrics();

    let effectiveMode = currentDisplayMode; // Default to existing persisted mode

    if (isNewSong) {
      if (currentSettings.translationEnabled) {
        effectiveMode = 'translate';
      } else if (currentSettings.romanizationEnabled) {
        effectiveMode = 'romanize';
      } else {
        effectiveMode = 'none';
      }
      currentDisplayMode = effectiveMode; // Persist auto-applied mode for this song session
    }

    let lyricsObjectToDisplay;
    let finalDisplayModeForRenderer = 'none';
    const htmlLang = document.documentElement.getAttribute('lang');

    if (effectiveMode !== 'none') {
      const translationResponse = await pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS',
        action: effectiveMode,
        songInfo: currentSong,
        targetLang: htmlLang
      });

      if (currentFetchVideoId !== localCurrentFetchVideoId) {
        console.warn("Song changed during TRANSLATE_LYRICS. Aborting display.", currentSong);
        return;
      }

      if (translationResponse.success && translationResponse.translatedLyrics) {
        lyricsObjectToDisplay = translationResponse.translatedLyrics;
        finalDisplayModeForRenderer = effectiveMode;
      } else {
        console.warn(`${effectiveMode === 'translate' ? 'Translation' : 'Romanization'} failed: ${translationResponse.error}. Falling back to original lyrics.`);
        // Fallback to fetching original lyrics
        const originalLyricsResponse = await pBrowser.runtime.sendMessage({
          type: 'FETCH_LYRICS',
          songInfo: currentSong,
          forceReload: forceReload // Pass forceReload to background script
        });

        if (currentFetchVideoId !== localCurrentFetchVideoId) {
          console.warn("Song changed during FETCH_LYRICS (fallback). Aborting display.", currentSong);
          return;
        }

        if (originalLyricsResponse.success) {
          lyricsObjectToDisplay = originalLyricsResponse.lyrics;
          // finalDisplayModeForRenderer remains 'none'
        } else {
          console.warn('Failed to fetch original lyrics after translation/romanization fallback:', originalLyricsResponse.error);
          if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
          currentDisplayMode = 'none'; // Reset mode
          return;
        }
      }
    } else {
      // No translation/romanization mode active, fetch original lyrics
      const originalLyricsResponse = await pBrowser.runtime.sendMessage({
        type: 'FETCH_LYRICS',
        songInfo: currentSong,
        forceReload: forceReload // Pass forceReload to background script
      });

      if (currentFetchVideoId !== localCurrentFetchVideoId) {
        console.warn("Song changed during FETCH_LYRICS. Aborting display.", currentSong);
        return;
      }

      if (originalLyricsResponse.success) {
        lyricsObjectToDisplay = originalLyricsResponse.lyrics;
        // finalDisplayModeForRenderer remains 'none'
      } else {
        console.warn('Failed to fetch lyrics:', originalLyricsResponse.error);
        if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
        currentDisplayMode = 'none'; // Reset mode
        return;
      }
    }

    // If the videoId changed at any point during async operations, abort.
    if (currentFetchVideoId !== localCurrentFetchVideoId) {
      console.warn("Song changed while fetching lyrics. Aborting display.", currentSong);
      return;
    }

    // Process lyrics (convert, adjust timing)
    if (lyricsObjectToDisplay.type === "Word" && !currentSettings.wordByWord) {
      lyricsObjectToDisplay = convertWordLyricsToLine(lyricsObjectToDisplay);
    }

    if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock && !lyricsObjectToDisplay.ignoreSponsorblock && !lyricsObjectToDisplay.metadata.ignoreSponsorblock) {
      const segments = await fetchSponsorSegments(currentSong.videoId);
      if (currentFetchVideoId !== localCurrentFetchVideoId) { // Check again after await
          console.warn("Song changed during SponsorBlock fetch. Aborting display.", currentSong);
          return;
      }
      lyricsObjectToDisplay.data = adjustLyricTiming(lyricsObjectToDisplay.data, segments, lyricsObjectToDisplay.type === "Line" ? "s" : "s");
    }

    // Ensure the videoId is still the same before displaying lyrics
    if (currentFetchVideoId !== localCurrentFetchVideoId) {
      console.warn("Song changed just before displaying lyrics. Aborting display.", currentSong);
      return;
    }
    

    if (LyricsPlusAPI.displayLyrics) {
        LyricsPlusAPI.displayLyrics(
            lyricsObjectToDisplay,
            lyricsObjectToDisplay.metadata.source,
            lyricsObjectToDisplay.type === "Line" ? "Line" : "Word",
            currentSettings.lightweight,
            lyricsObjectToDisplay.metadata.songWriters,
            currentSong,
            finalDisplayModeForRenderer, // Pass the actual display mode
            currentSettings // Pass currentSettings
        );
    } else {
        console.error("displayLyrics is not available.");
    }

    lastKnownSongInfo = currentSong; // Update last known song info

  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    currentDisplayMode = 'none'; // Reset manager's mode on error
    
    if (currentFetchVideoId === (currentSong ? currentSong.videoId : null)) { // Check if error is for current song
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
}

function convertWordLyricsToLine(lyrics) {
  if (lyrics.type === "Line") return lyrics; 

  const words = lyrics.data;
  const lines = [];
  let currentLineWords = [];
  let lineStartTime = null;
  let lineEndTime = null;
  let element = {};
  // Capture translatedText if present from the first word of the line
  let lineTranslatedText = null; 

  words.forEach((word, index) => {
      if (currentLineWords.length === 0) {
          lineStartTime = word.startTime;
          if (word.translatedText) { 
              lineTranslatedText = word.translatedText;
          }
      }
      currentLineWords.push(word.text);
      lineEndTime = word.endTime;
      element = word.element || {};
      element.isBackground = false;

      if (word.isLineEnding || index === words.length - 1) {
          const lineText = currentLineWords.join('');
          const lineEntry = {
              text: lineText,
              startTime: lineStartTime / 1000,
              endTime: lineEndTime / 1000,
              element: element
          };
          if (lineTranslatedText) { // Add translatedText to the converted line
              lineEntry.translatedText = lineTranslatedText;
          }
          lines.push(lineEntry);
          currentLineWords = [];
          lineStartTime = null;
          lineEndTime = null;
          lineTranslatedText = null; // Reset for next line
      }
  });

  return {
      type: "Line",
      data: lines,
      metadata: lyrics.metadata,
      // Carry over other potential top-level properties if necessary
      ignoreSponsorblock: lyrics.ignoreSponsorblock 
  };
}

// New API function for renderer to call
setCurrentDisplayModeAndRefetch = async (mode, songInfoForRefetch) => {
    currentDisplayMode = mode; // Update manager's internal state

    // Immediately update renderer's UI state if possible

    if (songInfoForRefetch) {
        // Call fetchAndDisplayLyrics, isNewSong will be false.
        // fetchAndDisplayLyrics will use the new `currentDisplayMode`.
        // When called from translation/romanization buttons, forceReload should be false.
        await fetchAndDisplayLyrics(songInfoForRefetch, false, false);
    } else {
    }
};
