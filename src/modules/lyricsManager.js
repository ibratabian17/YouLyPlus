// lyricsManager.js
let currentFetchVideoId = null;
let currentDisplayMode = 'none'; // Manages the active translation/romanization mode

let lastKnownSongInfo = null; // Store last known song info for reload
let lastFetchedLyrics = null; // Store the last successfully fetched lyrics object

// New variables for debouncing/preventing duplicate requests from content script
let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200; // Adjust as needed, a small delay to prevent rapid duplicates

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  const songKey = `${currentSong.title}-${currentSong.artist}-${currentSong.album}`;

  // If a request for the same song is already pending or recently completed, debounce it.
  if (lyricsFetchDebounceTimer && lastRequestedSongKey === songKey && !forceReload) {
    console.log(`Debouncing duplicate fetch request for ${songKey}`);
    return; // Abort this duplicate call
  }

  // Clear any existing debounce timer and set a new one
  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  try {
    const localCurrentFetchVideoId = currentSong.videoId;
    currentFetchVideoId = localCurrentFetchVideoId; // Set the latest videoId being processed globally for this manager

    LyricsPlusAPI.cleanupLyrics();

    let effectiveMode = currentDisplayMode; // Default to existing persisted mode

    if (isNewSong) {
      const translationEnabled = currentSettings.translationEnabled;
      const romanizationEnabled = currentSettings.romanizationEnabled;

      if (translationEnabled && romanizationEnabled) {
        effectiveMode = 'both';
      } else if (translationEnabled) {
        effectiveMode = 'translate';
      } else if (romanizationEnabled) {
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
      let translationResponse = null;
      let romanizationResponse = null;

      if (effectiveMode === 'translate' || effectiveMode === 'both') {
        translationResponse = await pBrowser.runtime.sendMessage({
          type: 'TRANSLATE_LYRICS',
          action: 'translate',
          songInfo: currentSong,
          targetLang: htmlLang
        });
        if (currentFetchVideoId !== localCurrentFetchVideoId) {
          console.warn("Song changed during TRANSLATE_LYRICS (translate). Aborting display.", currentSong);
          return;
        }
      }

      if (effectiveMode === 'romanize' || effectiveMode === 'both') {
        romanizationResponse = await pBrowser.runtime.sendMessage({
          type: 'TRANSLATE_LYRICS',
          action: 'romanize',
          songInfo: currentSong,
          targetLang: htmlLang
        });
        if (currentFetchVideoId !== localCurrentFetchVideoId) {
          console.warn("Song changed during TRANSLATE_LYRICS (romanize). Aborting display.", currentSong);
          return;
        }
      }

      let hasTranslation = translationResponse && translationResponse.success && translationResponse.translatedLyrics;
      let hasRomanization = romanizationResponse && romanizationResponse.success && romanizationResponse.translatedLyrics;

      if (hasTranslation && hasRomanization) {
        lyricsObjectToDisplay = translationResponse.translatedLyrics;
        // Merge romanization into the translation lyrics object, prioritizing syllable-level if available
        lyricsObjectToDisplay.data = lyricsObjectToDisplay.data.map((line, index) => {
          const romanizedLine = romanizationResponse.translatedLyrics.data[index];
          if (romanizedLine) {
            // If romanization response has syllabus (syllable-level romanization)
            if (romanizedLine.syllabus && romanizedLine.syllabus.length > 0) {
              const newSyllabus = line.syllabus ? line.syllabus.map((syllable, sylIndex) => {
                const romanizedSyllable = romanizedLine.syllabus[sylIndex];
                return {
                  ...syllable,
                  romanizedText: romanizedSyllable ? romanizedSyllable.romanizedText : syllable.text
                };
              }) : [];
              return { ...line, syllabus: newSyllabus };
            } else {
              // Fallback to line-level romanization if no syllabus in romanization response
              return { ...line, romanizedText: romanizedLine.romanizedText || romanizedLine.translatedText };
            }
          }
          return line;
        });
        finalDisplayModeForRenderer = 'both';
      } else if (hasTranslation) {
        lyricsObjectToDisplay = translationResponse.translatedLyrics;
        finalDisplayModeForRenderer = 'translate';
      } else if (hasRomanization) {
        // If only romanization is enabled, use the romanized lyrics directly
        lyricsObjectToDisplay = romanizationResponse.translatedLyrics;
        finalDisplayModeForRenderer = 'romanize';
      } else {
        console.warn(`Translation/Romanization failed. Falling back to original lyrics.`);
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
    

    lastFetchedLyrics = lyricsObjectToDisplay; // Store the fetched lyrics

    if (LyricsPlusAPI.displayLyrics) {
        LyricsPlusAPI.displayLyrics(
            lyricsObjectToDisplay,
            lyricsObjectToDisplay.metadata.source,
            lyricsObjectToDisplay.type === "Line" ? "Line" : "Word",
            currentSettings.lightweight,
            lyricsObjectToDisplay.metadata.songWriters,
            currentSong,
            finalDisplayModeForRenderer, // Pass the actual display mode
            currentSettings, // Pass currentSettings
            fetchAndDisplayLyrics, // Pass the function itself
            setCurrentDisplayModeAndRender // Pass the function itself (renamed)
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
setCurrentDisplayModeAndRender = async (mode, songInfoForRefetch) => {
    currentDisplayMode = mode; // Update manager's internal state

    if (lastFetchedLyrics && LyricsPlusAPI.updateDisplayMode) {
        // If lyrics are already fetched, just update the display mode in the renderer
        // No need to re-fetch from the background script
        LyricsPlusAPI.updateDisplayMode(lastFetchedLyrics, mode, currentSettings);
    } else if (songInfoForRefetch) {
        // Fallback: if no lyrics are cached in manager, re-fetch them
        await fetchAndDisplayLyrics(songInfoForRefetch, false, false);
    }
};
