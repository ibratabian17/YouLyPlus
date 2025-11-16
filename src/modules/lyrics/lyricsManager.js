/* =================================================================
   STATE VARIABLES
   ================================================================= */

let currentFetchMediaId = null;
let currentDisplayMode = 'none'; // User's intended display mode ('none', 'translate', 'romanize', 'both')
let lastProcessedDisplayMode = 'none'; // The mode that was actually rendered

let lastKnownSongInfo = null;
let lastFetchedLyrics = null;

// Debouncing to prevent rapid-fire requests
let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200;


/* =================================================================
   HELPER FUNCTIONS
   ================================================================= */

/**
 * Merges translation and romanization data into a base lyrics object.
 * @param {object} baseLyrics - The original lyrics object.
 * @param {object|null} translation - The translation lyrics object.
 * @param {object|null} romanization - The romanization lyrics object.
 * @returns {object} The merged lyrics object.
 */
function combineLyricsData(baseLyrics, translation, romanization) {
  const combinedLyrics = JSON.parse(JSON.stringify(baseLyrics)); // Deep copy

  const translationData = translation?.data;
  const romanizationData = romanization?.data;

  combinedLyrics.data = combinedLyrics.data.map((line, index) => {
    const translatedLine = translationData?.[index];
    const romanizedLine = romanizationData?.[index];
    let updatedLine = { ...line };

    if (translatedLine?.translatedText) {
      updatedLine.translatedText = translatedLine.translatedText;
    }

    if (romanizedLine) {
      if (baseLyrics.type === "Word" && romanizedLine.chunk?.length > 0 && updatedLine.syllabus?.length > 0) {
        updatedLine.syllabus = updatedLine.syllabus.map((syllable, sylIndex) => {
          const romanizedSyllable = romanizedLine.chunk[sylIndex];
          return {
            ...syllable,
            romanizedText: romanizedSyllable?.text || syllable.text
          };
        });
      }
      else if (romanizedLine.text) {
         updatedLine.romanizedText = romanizedLine.text;
      }
    }
    return updatedLine;
  });

  return combinedLyrics;
}

/**
 * Determines the final display mode for the renderer based on user's intent and available data.
 * @param {string} intendedMode - The mode the user wants ('none', 'translate', 'romanize', 'both').
 * @param {boolean} hasTranslation - Whether translation data was successfully fetched.
 * @param {boolean} hasRomanization - Whether romanization data was successfully fetched.
 * @returns {string} The final display mode.
 */
function determineFinalDisplayMode(intendedMode, hasTranslation, hasRomanization) {
  if (intendedMode === 'both') {
    if (hasTranslation && hasRomanization) return 'both';
    if (hasTranslation) return 'translate';
    if (hasRomanization) return 'romanize';
  }
  if (intendedMode === 'translate' && hasTranslation) {
    return 'translate';
  }
  if (intendedMode === 'romanize' && hasRomanization) {
    return 'romanize';
  }
  return 'none'; // Default fallback
}


/* =================================================================
   CORE LOGIC: FETCHING AND PROCESSING
   ================================================================= */

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  const songKey = `${currentSong.title}-${currentSong.artist}-${currentSong.album}`;
  
  // --- 1. Debouncing and Race Condition Setup ---
  if (lyricsFetchDebounceTimer && lastRequestedSongKey === songKey && !forceReload && currentDisplayMode === lastProcessedDisplayMode) {
    return;
  }
  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  const localCurrentFetchMediaId = currentSong.videoId || currentSong.songId;
  currentFetchMediaId = localCurrentFetchMediaId;

  LyricsPlusAPI.cleanupLyrics();

  try {
    // --- 2. Determine Effective Mode (User's Intent) ---
    let effectiveMode = currentDisplayMode;
    if (isNewSong) {
      const { translationEnabled, romanizationEnabled } = currentSettings;
      if (translationEnabled && romanizationEnabled) effectiveMode = 'both';
      else if (translationEnabled) effectiveMode = 'translate';
      else if (romanizationEnabled) effectiveMode = 'romanize';
      else effectiveMode = 'none';
      currentDisplayMode = effectiveMode;
    }

    // --- 3. Fetch Base Lyrics ---
    const originalLyricsResponse = await pBrowser.runtime.sendMessage({
      type: 'FETCH_LYRICS',
      songInfo: currentSong,
      forceReload: forceReload
    });

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
      console.warn("Song changed during initial lyrics fetch. Aborting.", currentSong);
      return;
    }

    if (!originalLyricsResponse.success) {
      console.warn('Failed to fetch original lyrics:', originalLyricsResponse.error);
      if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
      return;
    }
    let baseLyrics = originalLyricsResponse.lyrics;

    // --- 4. Fetch Additional Data (Translation/Romanization) in Parallel ---
    const htmlLang = document.documentElement.getAttribute('lang');
    const promises = [];
    
    const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
    const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

    if (needsTranslation) {
      promises.push(pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS', action: 'translate', songInfo: currentSong, targetLang: htmlLang
      }));
    } else {
      promises.push(Promise.resolve(null));
    }

    if (needsRomanization) {
      promises.push(pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS', action: 'romanize', songInfo: currentSong, targetLang: htmlLang
      }));
    } else {
      promises.push(Promise.resolve(null));
    }
    
    const [translationResponse, romanizationResponse] = await Promise.all(promises);

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
        console.warn("Song changed during additional data fetch. Aborting.", currentSong);
        return;
    }

    const hasTranslation = translationResponse?.success && translationResponse.translatedLyrics;
    const hasRomanization = romanizationResponse?.success && romanizationResponse.translatedLyrics;

    // --- 5. Combine Data & Determine Final Display Mode ---
    var lyricsObjectToDisplay = combineLyricsData(
      baseLyrics,
      hasTranslation ? translationResponse.translatedLyrics : null,
      hasRomanization ? romanizationResponse.translatedLyrics : null
    );
    
    const finalDisplayModeForRenderer = determineFinalDisplayMode(effectiveMode, hasTranslation, hasRomanization);

    // --- 6. Post-Processing ---
    if (lyricsObjectToDisplay.type === "Word" && !currentSettings.wordByWord) {
      lyricsObjectToDisplay = convertWordLyricsToLine(lyricsObjectToDisplay);
    }
    
    if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock && !lyricsObjectToDisplay.ignoreSponsorblock && !lyricsObjectToDisplay.metadata.ignoreSponsorblock) {
      const sponsorBlockResponse = await pBrowser.runtime.sendMessage({
        type: 'FETCH_SPONSOR_SEGMENTS',
        videoId: currentSong.videoId
      });

      if (currentFetchMediaId !== localCurrentFetchMediaId) {
        console.warn("Song changed during SponsorBlock fetch. Aborting.", currentSong);
        return;
      }
      
      if (sponsorBlockResponse.success) {
        lyricsObjectToDisplay.data = adjustLyricTiming(lyricsObjectToDisplay.data, sponsorBlockResponse.segments, lyricsObjectToDisplay.type === "Line" ? "s" : "s");
      }
    }
    
    // --- 7. Render Lyrics ---
    lyricsObjectToDisplay.type = lyricsObjectToDisplay.type === "Line" ? "Line" : "Word";
    lastFetchedLyrics = lyricsObjectToDisplay;
    if (LyricsPlusAPI.displayLyrics) {
      LyricsPlusAPI.displayLyrics(
        lyricsObjectToDisplay,
        currentSong,
        finalDisplayModeForRenderer,
        currentSettings,
        fetchAndDisplayLyrics,
        setCurrentDisplayModeAndRender,
        currentSettings.largerTextMode
      );
    } else {
      console.error("displayLyrics is not available.");
    }
    
    lastKnownSongInfo = currentSong;
    lastProcessedDisplayMode = finalDisplayModeForRenderer;

  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    currentDisplayMode = 'none';
    lastProcessedDisplayMode = 'none';

    if (currentFetchMediaId === (currentSong?.videoId || currentSong?.songId)) {
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
}

/* =================================================================
   PUBLIC API AND RENDER TRIGGER
   ================================================================= */

function setCurrentDisplayModeAndRender(mode, songInfoForRefetch) {
  currentDisplayMode = mode;
  const songToRefetch = songInfoForRefetch || lastKnownSongInfo;

  if (songToRefetch) {
    fetchAndDisplayLyrics(songToRefetch, false, false);
  } else {
    console.error("Cannot update display mode: No song information available for refetch.");
    currentDisplayMode = 'none';
    if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
  }
};

/* =================================================================
   UTILITY
   ================================================================= */

function convertWordLyricsToLine(lyrics) {
  if (lyrics.type !== "Word") return lyrics;

  const lines = lyrics.data.map(line => ({ ...line, syllables: [] }));

  return {
    type: "Line",
    data: lines,
    metadata: lyrics.metadata,
    ignoreSponsorblock: lyrics.ignoreSponsorblock
  };
}
