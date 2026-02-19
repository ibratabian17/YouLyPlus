/* =================================================================
   STATE VARIABLES
   ================================================================= */

const audioCtx = new AudioContext();

let currentFetchMediaId = null;
let currentDisplayMode = 'none';     // User's intended display mode ('none', 'translate', 'romanize', 'both')
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

// Settings keys that affect which cached responses to invalidate
const TRANSLATION_SETTING_KEYS = ['translationProvider', 'geminiApiKey', 'geminiModel', 'openRouterApiKey', 'openRouterModel', 'targetLang'];
const ROMANIZATION_SETTING_KEYS = ['romanizationProvider', 'geminiRomanizationModel'];
const RESTART_REQUIRED_KEYS = ['isEnabled', 'YTSongInfo', 'dynamicPlayer'];
const LYRICS_SOURCE_KEYS = ['lyricsProvider', 'lyricsSourceOrder', 'customKpoeUrl', 'appleMusicTTMLBypass'];


/* =================================================================
   HELPER FUNCTIONS - DATA PROCESSING
   ================================================================= */

/**
 * Merges translation and romanization data into a deep copy of the base lyrics object.
 * @param {object}      baseLyrics     - The original lyrics object.
 * @param {object|null} translation    - The translation lyrics object.
 * @param {object|null} romanization   - The romanization lyrics object.
 * @returns {object} The merged lyrics object.
 */
function combineLyricsData(baseLyrics, translation, romanization) {
  const combined = JSON.parse(JSON.stringify(baseLyrics)); // Deep copy

  const translationData = translation?.data;
  const romanizationData = romanization?.data;

  combined.data = combined.data.map((line, index) => {
    const translatedLine = translationData?.[index];
    const romanizedLine = romanizationData?.[index];
    let mergedLine = { ...line };

    if (translatedLine?.translatedText) {
      mergedLine.translatedText = translatedLine.translatedText;
    }

    if (romanizedLine) {
      const hasWordSyncedRomanization =
        baseLyrics.type === "Word" &&
        romanizedLine.chunk?.length > 0 &&
        mergedLine.syllables?.length > 0;

      if (hasWordSyncedRomanization) {
        mergedLine.syllables = mergedLine.syllables.map((syllable, sylIndex) => {
          const romanizedSyllable = romanizedLine.chunk[sylIndex];
          return {
            ...syllable,
            romanizedText: romanizedSyllable?.text || syllable.text
          };
        });
      } else if (romanizedLine.text) {
        mergedLine.romanizedText = romanizedLine.text;
      }
    }

    return mergedLine;
  });

  return combined;
}

/**
 * Determines the final display mode for the renderer based on user intent and data availability.
 * Falls back gracefully when the intended data could not be fetched.
 * @param {string}  intendedMode     - The mode the user wants ('none', 'translate', 'romanize', 'both').
 * @param {boolean} hasTranslation   - Whether translation data was successfully fetched.
 * @param {boolean} hasRomanization  - Whether romanization data was successfully fetched.
 * @returns {string} The resolved display mode.
 */
function determineFinalDisplayMode(intendedMode, hasTranslation, hasRomanization) {
  if (intendedMode === 'both') {
    if (hasTranslation && hasRomanization) return 'both';
    if (hasTranslation) return 'translate';
    if (hasRomanization) return 'romanize';
  }
  if (intendedMode === 'translate' && hasTranslation) return 'translate';
  if (intendedMode === 'romanize' && hasRomanization) return 'romanize';
  return 'none';
}

/**
 * Coerces a lyrics type string to one of the three valid values: "None", "Line", or "Word".
 * Any unrecognised value is treated as "Word".
 * @param {string} type - The raw type value.
 * @returns {string} The normalised type.
 */
function normalizeLyricsType(type) {
  if (type === "None" || type === "Line") return type;
  return "Word";
}

/**
 * Converts Word-synced lyrics to Line-synced format.
 * Used when word-by-word display is disabled.
 * @param {object} lyrics - The original lyrics object.
 * @returns {object} A new Line-type lyrics object, or the original if already Line/None.
 */
function convertWordLyricsToLine(lyrics) {
  if (lyrics.type !== "Word") return lyrics;

  return {
    type: "Line",
    data: lyrics.data.map(line => ({ ...line, syllables: [] })),
    metadata: lyrics.metadata,
    ignoreSponsorblock: lyrics.ignoreSponsorblock
  };
}


/* =================================================================
   HELPER FUNCTIONS - FETCHING LOGIC
   ================================================================= */

/**
 * Returns false if an in-flight debounce already covers this exact request,
 * signalling that the fetch can be safely skipped.
 */
function shouldFetchLyrics(songKey, forceReload) {
  return !(
    lyricsFetchDebounceTimer &&
    lastRequestedSongKey === songKey &&
    !forceReload &&
    currentDisplayMode === lastProcessedDisplayMode
  );
}

/**
 * Resolves which display mode should actually be used for this fetch cycle.
 * For new songs with no prior state, the mode is derived from current settings;
 * otherwise the user's existing selection is preserved.
 */
function resolveEffectiveMode(isNewSong) {
  if (!isNewSong || lastKnownSongInfo) return currentDisplayMode;

  const { translationEnabled, romanizationEnabled } = currentSettings;
  if (translationEnabled && romanizationEnabled) return 'both';
  if (translationEnabled) return 'translate';
  if (romanizationEnabled) return 'romanize';
  return 'none';
}

/**
 * Fetches the base lyrics for the current song, using the cache when appropriate.
 * Returns null if the song changed mid-request or if the fetch failed.
 */
async function fetchBaseLyrics(currentSong, isNewSong, forceReload, fetchId) {
  const isSameSong =
    lastBaseLyrics &&
    lastKnownSongInfo &&
    lastKnownSongInfo.title === currentSong.title &&
    lastKnownSongInfo.artist === currentSong.artist;

  if (!isNewSong && !forceReload && isSameSong) {
    if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
    return lastBaseLyrics;
  }

  LyricsPlusAPI.cleanupLyrics();
  lastTranslationResponse = null;
  lastRomanizationResponse = null;

  const response = await pBrowser.runtime.sendMessage({
    type: 'FETCH_LYRICS',
    songInfo: currentSong,
    forceReload
  });

  if (currentFetchMediaId !== fetchId) {
    console.warn("Song changed during initial lyrics fetch. Aborting.", currentSong);
    return null;
  }

  if (!response.success) {
    console.warn('Failed to fetch original lyrics:', response.error);
    if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
    return null;
  }

  lastBaseLyrics = response.lyrics;
  return lastBaseLyrics;
}

/**
 * Returns a cached response as a resolved promise, or sends a new message to fetch it.
 * Caches the result in `cacheRef` on success.
 */
function getCachedOrFetch(cachedResponse, messagePayload, fetchId, onSuccess) {
  if (cachedResponse) return Promise.resolve(cachedResponse);

  return pBrowser.runtime.sendMessage(messagePayload).then(response => {
    if (currentFetchMediaId === fetchId && response?.success) onSuccess(response);
    return response;
  });
}

/**
 * Fetches translation and romanization data in parallel, reusing cached values when available.
 * Returns a [translationResponse, romanizationResponse] tuple.
 */
async function fetchAdditionalData(currentSong, effectiveMode, htmlLang, fetchId) {
  const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
  const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

  const translationPromise = needsTranslation
    ? getCachedOrFetch(
      lastTranslationResponse,
      { type: 'TRANSLATE_LYRICS', action: 'translate', songInfo: currentSong, targetLang: htmlLang },
      fetchId,
      response => { lastTranslationResponse = response; }
    )
    : Promise.resolve(null);

  const romanizationPromise = needsRomanization
    ? getCachedOrFetch(
      lastRomanizationResponse,
      { type: 'TRANSLATE_LYRICS', action: 'romanize', songInfo: currentSong, targetLang: htmlLang },
      fetchId,
      response => { lastRomanizationResponse = response; }
    )
    : Promise.resolve(null);

  return Promise.all([translationPromise, romanizationPromise]);
}

/**
 * Applies SponsorBlock timing adjustments to lyrics data if applicable.
 * Returns the adjusted data array, the original data array if SponsorBlock is not needed,
 * or null if the song changed mid-request.
 */
async function applySponsorBlock(lyrics, currentSong, fetchId) {
  const shouldApply =
    currentSong.isVideo &&
    currentSong.videoId &&
    currentSettings.useSponsorBlock &&
    !lyrics.ignoreSponsorblock &&
    !lyrics.metadata.ignoreSponsorblock;

  if (!shouldApply) return lyrics.data;

  const response = await pBrowser.runtime.sendMessage({
    type: 'FETCH_SPONSOR_SEGMENTS',
    videoId: currentSong.videoId
  });

  if (currentFetchMediaId !== fetchId) {
    console.warn("Song changed during SponsorBlock fetch. Aborting.", currentSong);
    return null;
  }

  if (response.success) {
    // Both Line and Word types currently use the same "s" unit for timing adjustment
    return adjustLyricTiming(lyrics.data, response.segments, "s");
  }

  return lyrics.data;
}


/* =================================================================
   RENDERING HELPERS
   ================================================================= */

/**
 * Calls the LyricsPlusAPI display function with the standard argument set.
 */
function callDisplayLyricsAPI(lyrics, currentSong, displayMode) {
  LyricsPlusAPI.displayLyrics(
    lyrics,
    currentSong,
    displayMode,
    currentSettings,
    fetchAndDisplayLyrics,
    setCurrentDisplayModeAndRender,
    currentSettings.largerTextMode,
    audioCtx.outputLatency || 0
  );
}

/**
 * Renders the base lyrics immediately as a placeholder while additional data loads.
 * Shown only for new songs to avoid an empty state during async fetches.
 */
function renderPreliminaryBaseLyrics(baseLyrics, currentSong) {
  let lyrics = JSON.parse(JSON.stringify(baseLyrics));

  if (lyrics.type === "Word" && !currentSettings.wordByWord) {
    lyrics = convertWordLyricsToLine(lyrics);
  }

  lyrics.type = normalizeLyricsType(lyrics.type);
  callDisplayLyricsAPI(lyrics, currentSong, 'none');
}

/**
 * Renders the fully enriched lyrics with the resolved display mode.
 */
function renderFinalLyrics(lyrics, currentSong, displayMode) {
  lyrics.type = normalizeLyricsType(lyrics.type);
  lastFetchedLyrics = lyrics;

  if (LyricsPlusAPI.displayLyrics) {
    callDisplayLyricsAPI(lyrics, currentSong, displayMode);
  } else {
    console.error("displayLyrics is not available.");
  }
}


/* =================================================================
   CORE LOGIC: FETCHING AND PROCESSING
   ================================================================= */

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  const songKey = `${currentSong.title}-${currentSong.artist}-${currentSong.album}`;

  if (!shouldFetchLyrics(songKey, forceReload)) return;

  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  const fetchId = currentSong.videoId || currentSong.appleId || currentSong.songId || songKey;
  currentFetchMediaId = fetchId;

  try {
    const effectiveMode = resolveEffectiveMode(isNewSong);
    currentDisplayMode = effectiveMode;

    const baseLyrics = await fetchBaseLyrics(currentSong, isNewSong, forceReload, fetchId);
    if (!baseLyrics) return;

    const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
    const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

    if ((needsTranslation || needsRomanization) && LyricsPlusAPI.displayLyrics) {
      const isMissingData =
        (needsTranslation && !lastTranslationResponse) ||
        (needsRomanization && !lastRomanizationResponse);

      if (isNewSong) renderPreliminaryBaseLyrics(baseLyrics, currentSong);
      if (isMissingData && LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
    }

    const htmlLang = document.documentElement.getAttribute('lang');
    const [translationResponse, romanizationResponse] = await fetchAdditionalData(currentSong, effectiveMode, htmlLang, fetchId);

    if (currentFetchMediaId !== fetchId) {
      console.warn("Song changed during additional data fetch. Aborting.", currentSong);
      return;
    }

    const hasTranslation = translationResponse?.success && translationResponse.translatedLyrics;
    const hasRomanization = romanizationResponse?.success && romanizationResponse.translatedLyrics;

    let lyrics = combineLyricsData(
      baseLyrics,
      hasTranslation ? translationResponse.translatedLyrics : null,
      hasRomanization ? romanizationResponse.translatedLyrics : null
    );

    const finalDisplayMode = determineFinalDisplayMode(effectiveMode, hasTranslation, hasRomanization);

    if (lyrics.type === "Word" && !currentSettings.wordByWord) {
      lyrics = convertWordLyricsToLine(lyrics);
    }

    const adjustedData = await applySponsorBlock(lyrics, currentSong, fetchId);
    if (adjustedData === null) return; // Song changed mid-fetch
    lyrics.data = adjustedData;

    renderFinalLyrics(lyrics, currentSong, finalDisplayMode);

    lastKnownSongInfo = currentSong;
    lastProcessedDisplayMode = finalDisplayMode;

  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    currentDisplayMode = 'none';
    lastProcessedDisplayMode = 'none';

    const songMediaId = currentSong?.videoId || currentSong?.songId;
    if (currentFetchMediaId === songMediaId) {
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
}


/* =================================================================
   PUBLIC API AND RENDER TRIGGER
   ================================================================= */

function setCurrentDisplayModeAndRender(mode, overrideSongInfo) {
  currentDisplayMode = mode;
  const song = overrideSongInfo || lastKnownSongInfo;

  if (song) {
    fetchAndDisplayLyrics(song, false, false);
  } else {
    console.error("Cannot update display mode: No song information available for refetch.");
    currentDisplayMode = 'none';
    if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
  }
}


/* =================================================================
   LIVE SETTINGS UPDATE LISTENER
   ================================================================= */

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', ({ detail }) => {
  const { changedKeys } = detail;
  if (!changedKeys) return;

  if (changedKeys.some(k => TRANSLATION_SETTING_KEYS.includes(k))) lastTranslationResponse = null;
  if (changedKeys.some(k => ROMANIZATION_SETTING_KEYS.includes(k))) lastRomanizationResponse = null;

  lastProcessedDisplayMode = 'none';

  if (!lastKnownSongInfo) return;

  const nonRenderingKeys = [...TRANSLATION_SETTING_KEYS, ...ROMANIZATION_SETTING_KEYS, ...RESTART_REQUIRED_KEYS];
  const shouldRender = changedKeys.some(k => !nonRenderingKeys.includes(k));

  if (shouldRender) {
    console.log("Live settings update received, re-rendering lyrics...", changedKeys);
    const shouldForceReload = changedKeys.some(k => LYRICS_SOURCE_KEYS.includes(k));
    fetchAndDisplayLyrics(lastKnownSongInfo, false, shouldForceReload);
  }
});
