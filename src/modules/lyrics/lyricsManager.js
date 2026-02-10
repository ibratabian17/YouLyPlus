/* =================================================================
   STATE VARIABLES
   ================================================================= */

const audioCtx = new AudioContext();

let currentFetchMediaId = null;
let currentDisplayMode = 'none'; // User's intended display mode ('none', 'translate', 'romanize', 'both')
let lastProcessedDisplayMode = 'none'; // The mode that was actually rendered

let lastKnownSongInfo = null;
let lastFetchedLyrics = null;
let lastBaseLyrics = null;
let lastTranslationResponse = null;
let lastRomanizationResponse = null;

// Debouncing to prevent rapid-fire requests
let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200;


/* =================================================================
   HELPER FUNCTIONS - DATA PROCESSING
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

/**
 * Converts Word-synced lyrics to Line-synced if the setting is disabled.
 */
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


/* =================================================================
   HELPER FUNCTIONS - FETCHING LOGIC
   ================================================================= */

function shouldFetchLyrics(songKey, forceReload) {
  if (lyricsFetchDebounceTimer && lastRequestedSongKey === songKey && !forceReload && currentDisplayMode === lastProcessedDisplayMode) {
    return false;
  }
  return true;
}

function resolveEffectiveMode(isNewSong) {
  if (!isNewSong) return currentDisplayMode;

  if (lastKnownSongInfo) {
    return currentDisplayMode;
  }

  const { translationEnabled, romanizationEnabled } = currentSettings;
  if (translationEnabled && romanizationEnabled) return 'both';
  if (translationEnabled) return 'translate';
  if (romanizationEnabled) return 'romanize';
  return 'none';
}

async function fetchBaseLyrics(currentSong, isNewSong, forceReload, localCurrentFetchMediaId) {
  if (!isNewSong && !forceReload && lastBaseLyrics && lastKnownSongInfo && lastKnownSongInfo.title === currentSong.title && lastKnownSongInfo.artist === currentSong.artist) {
    if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
    return lastBaseLyrics;
  }

  LyricsPlusAPI.cleanupLyrics();

  lastTranslationResponse = null;
  lastRomanizationResponse = null;

  const originalLyricsResponse = await pBrowser.runtime.sendMessage({
    type: 'FETCH_LYRICS',
    songInfo: currentSong,
    forceReload: forceReload
  });

  if (currentFetchMediaId !== localCurrentFetchMediaId) {
    console.warn("Song changed during initial lyrics fetch. Aborting.", currentSong);
    return null;
  }

  if (!originalLyricsResponse.success) {
    console.warn('Failed to fetch original lyrics:', originalLyricsResponse.error);
    if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
    return null;
  }

  const baseLyrics = originalLyricsResponse.lyrics;
  lastBaseLyrics = baseLyrics;
  return baseLyrics;
}

async function fetchAdditionalData(currentSong, effectiveMode, htmlLang) {
  const promises = [];

  const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
  const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

  if (needsTranslation) {
    if (lastTranslationResponse) {
      promises.push(Promise.resolve(lastTranslationResponse));
    } else {
      promises.push(pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS', action: 'translate', songInfo: currentSong, targetLang: htmlLang
      }).then(response => {
        if (response && response.success) lastTranslationResponse = response;
        return response;
      }));
    }
  } else {
    promises.push(Promise.resolve(null));
  }

  if (needsRomanization) {
    if (lastRomanizationResponse) {
      promises.push(Promise.resolve(lastRomanizationResponse));
    } else {
      promises.push(pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS', action: 'romanize', songInfo: currentSong, targetLang: htmlLang
      }).then(response => {
        if (response && response.success) lastRomanizationResponse = response;
        return response;
      }));
    }
  } else {
    promises.push(Promise.resolve(null));
  }

  return Promise.all(promises);
}

async function applySponsorBlock(lyricsObject, currentSong, localCurrentFetchMediaId) {
  if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock && !lyricsObject.ignoreSponsorblock && !lyricsObject.metadata.ignoreSponsorblock) {
    const sponsorBlockResponse = await pBrowser.runtime.sendMessage({
      type: 'FETCH_SPONSOR_SEGMENTS',
      videoId: currentSong.videoId
    });

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
      console.warn("Song changed during SponsorBlock fetch. Aborting.", currentSong);
      return null;
    }

    if (sponsorBlockResponse.success) {
      console.log(lyricsObject.data)
      return adjustLyricTiming(lyricsObject.data, sponsorBlockResponse.segments, lyricsObject.type === "Line" ? "s" : "s");
    }
  }
  return lyricsObject.data;
}


/* =================================================================
   CORE LOGIC: FETCHING AND PROCESSING
   ================================================================= */

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  const songKey = `${currentSong.title}-${currentSong.artist}-${currentSong.album}`;

  // Debouncing
  if (!shouldFetchLyrics(songKey, forceReload)) return;

  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  const localCurrentFetchMediaId = currentSong.videoId || currentSong.appleId || currentSong.songId || songKey;
  currentFetchMediaId = localCurrentFetchMediaId;


  try {
    const effectiveMode = resolveEffectiveMode(isNewSong);
    currentDisplayMode = effectiveMode;

    const baseLyrics = await fetchBaseLyrics(currentSong, isNewSong, forceReload, localCurrentFetchMediaId);
    if (!baseLyrics) return;

    const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
    const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

    if ((needsTranslation || needsRomanization) && LyricsPlusAPI.displayLyrics) {
      const isMissingData = (needsTranslation && !lastTranslationResponse) || (needsRomanization && !lastRomanizationResponse);
      if (isNewSong) {
        renderPreliminaryBaseLyrics(baseLyrics, currentSong);
      }
      if (isMissingData && LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
    }

    const htmlLang = document.documentElement.getAttribute('lang');
    const [translationResponse, romanizationResponse] = await fetchAdditionalData(currentSong, effectiveMode, htmlLang);

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
      console.warn("Song changed during additional data fetch. Aborting.", currentSong);
      return;
    }

    // Process and Combine Data
    const hasTranslation = translationResponse?.success && translationResponse.translatedLyrics;
    const hasRomanization = romanizationResponse?.success && romanizationResponse.translatedLyrics;

    let lyricsObjectToDisplay = combineLyricsData(
      baseLyrics,
      hasTranslation ? translationResponse.translatedLyrics : null,
      hasRomanization ? romanizationResponse.translatedLyrics : null
    );

    const finalDisplayModeForRenderer = determineFinalDisplayMode(effectiveMode, hasTranslation, hasRomanization);

    if (lyricsObjectToDisplay.type === "Word" && !currentSettings.wordByWord) {
      lyricsObjectToDisplay = convertWordLyricsToLine(lyricsObjectToDisplay);
    }

    const sponsorBlockData = await applySponsorBlock(lyricsObjectToDisplay, currentSong, localCurrentFetchMediaId);
    if (sponsorBlockData) {
      lyricsObjectToDisplay.data = sponsorBlockData;
    } else if (sponsorBlockData === null && currentFetchMediaId !== localCurrentFetchMediaId) {
      return;
    }

    renderFinalLyrics(lyricsObjectToDisplay, currentSong, finalDisplayModeForRenderer);

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

function renderPreliminaryBaseLyrics(baseLyrics, currentSong) {
  let tempLyricsObject = JSON.parse(JSON.stringify(baseLyrics));

  if (tempLyricsObject.type === "Word" && !currentSettings.wordByWord) {
    tempLyricsObject = convertWordLyricsToLine(tempLyricsObject);
  }

  tempLyricsObject.type = (tempLyricsObject.type === "None" ? "None" : (tempLyricsObject.type === "Line" ? "Line" : "Word"));

  LyricsPlusAPI.displayLyrics(
    tempLyricsObject,
    currentSong,
    'none', // Correctly display base lyrics
    currentSettings,
    fetchAndDisplayLyrics,
    setCurrentDisplayModeAndRender,
    currentSettings.largerTextMode,
    audioCtx.outputLatency || 0
  );
}

function renderFinalLyrics(lyricsObjectToDisplay, currentSong, displayMode) {
  lyricsObjectToDisplay.type = (lyricsObjectToDisplay.type === "None" ? "None" : (lyricsObjectToDisplay.type === "Line" ? "Line" : "Word"));
  lastFetchedLyrics = lyricsObjectToDisplay;

  if (LyricsPlusAPI.displayLyrics) {
    LyricsPlusAPI.displayLyrics(
      lyricsObjectToDisplay,
      currentSong,
      displayMode,
      currentSettings,
      fetchAndDisplayLyrics,
      setCurrentDisplayModeAndRender,
      currentSettings.largerTextMode,
      audioCtx.outputLatency || 0
    );
  } else {
    console.error("displayLyrics is not available.");
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
   LIVE SETTINGS UPDATE LISTENER
   ================================================================= */
window.addEventListener('YOUPLUS_SETTINGS_UPDATED', ({ detail }) => {
  const { settings, changedKeys } = detail;
  if (!changedKeys) return;

  if (changedKeys.some(k => ['translationProvider', 'geminiApiKey', 'geminiModel', 'openRouterApiKey', 'openRouterModel', 'targetLang'].includes(k))) {
    lastTranslationResponse = null;
  }

  if (changedKeys.some(k => ['romanizationProvider', 'geminiRomanizationModel'].includes(k))) {
    lastRomanizationResponse = null;
  }

  lastProcessedDisplayMode = 'none';

  if (lastKnownSongInfo) {
    const translationKeys = ['translationProvider', 'geminiApiKey', 'geminiModel', 'openRouterApiKey', 'openRouterModel', 'targetLang', 'romanizationProvider', 'geminiRomanizationModel'];
    const restartRequiredKeys = ['isEnabled', 'YTSongInfo', 'dynamicPlayer'];

    const shouldRender = changedKeys.some(k => !translationKeys.includes(k) && !restartRequiredKeys.includes(k));

    if (shouldRender) {
      console.log("Live settings update received, re-rendering lyrics...", changedKeys);

      const shouldForceReload = changedKeys.some(k => ['lyricsProvider', 'lyricsSourceOrder', 'customKpoeUrl', 'appleMusicTTMLBypass'].includes(k));

      fetchAndDisplayLyrics(lastKnownSongInfo, false, shouldForceReload);
    }
  }
});
