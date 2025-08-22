// lyricsManager.js

/* =================================================================
   VARIABLE
   ================================================================= */

let currentFetchMediaId = null;
let currentDisplayMode = 'none';
let lastProcessedDisplayMode = 'none';

let lastKnownSongInfo = null;
let lastFetchedLyrics = null;

let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200;

/* =================================================================
   FETCHING AND PROCESSIGN 
   ================================================================= */

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  const songKey = `${currentSong.title}-${currentSong.artist}-${currentSong.album}`;

  if (lyricsFetchDebounceTimer && lastRequestedSongKey === songKey && !forceReload && currentDisplayMode === lastProcessedDisplayMode) {
    console.log(`Debouncing duplicate fetch request for ${songKey} with same display mode.`);
    return;
  }

  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  try {
    const localCurrentFetchMediaId = currentSong.videoId || currentSong.songId;
    currentFetchMediaId = localCurrentFetchMediaId;

    LyricsPlusAPI.cleanupLyrics();

    let effectiveMode = currentDisplayMode;

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
      currentDisplayMode = effectiveMode;
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
        if (currentFetchMediaId !== localCurrentFetchMediaId) {
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
        if (currentFetchMediaId !== localCurrentFetchMediaId) {
          console.warn("Song changed during TRANSLATE_LYRICS (romanize). Aborting display.", currentSong);
          return;
        }
      }

      let hasTranslation = translationResponse && translationResponse.success && translationResponse.translatedLyrics;
      let hasRomanization = romanizationResponse && romanizationResponse.success && romanizationResponse.translatedLyrics;

      if (hasTranslation && hasRomanization) {
        lyricsObjectToDisplay = translationResponse.translatedLyrics;
        lyricsObjectToDisplay.data = lyricsObjectToDisplay.data.map((line, index) => {
          const romanizedLine = romanizationResponse.translatedLyrics.data[index];
          if (romanizedLine) {
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
        lyricsObjectToDisplay = romanizationResponse.translatedLyrics;
        finalDisplayModeForRenderer = 'romanize';
      } else {
        console.warn(`Translation/Romanization failed. Falling back to original lyrics.`);
        const originalLyricsResponse = await pBrowser.runtime.sendMessage({
          type: 'FETCH_LYRICS',
          songInfo: currentSong,
          forceReload: forceReload
        });

        if (currentFetchMediaId !== localCurrentFetchMediaId) {
          console.warn("Song changed during FETCH_LYRICS (fallback). Aborting display.", currentSong);
          return;
        }

        if (originalLyricsResponse.success) {
          lyricsObjectToDisplay = originalLyricsResponse.lyrics;
        } else {
          console.warn('Failed to fetch original lyrics after translation/romanization fallback:', originalLyricsResponse.error);
          if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
          currentDisplayMode = 'none';
          return;
        }
      }
    } else {
      const originalLyricsResponse = await pBrowser.runtime.sendMessage({
        type: 'FETCH_LYRICS',
        songInfo: currentSong,
        forceReload: forceReload
      });

      if (currentFetchMediaId !== localCurrentFetchMediaId) {
        console.warn("Song changed during FETCH_LYRICS. Aborting display.", currentSong);
        return;
      }

      if (originalLyricsResponse.success) {
        lyricsObjectToDisplay = originalLyricsResponse.lyrics;
      } else {
        console.warn('Failed to fetch lyrics:', originalLyricsResponse.error);
        if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
        currentDisplayMode = 'none';
        return;
      }
    }

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
      console.warn("Song changed while fetching lyrics. Aborting display.", currentSong);
      return;
    }

    if (lyricsObjectToDisplay.type === "Word" && !currentSettings.wordByWord) {
      lyricsObjectToDisplay = convertWordLyricsToLine(lyricsObjectToDisplay);
    }

    if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock && !lyricsObjectToDisplay.ignoreSponsorblock && !lyricsObjectToDisplay.metadata.ignoreSponsorblock) {
      const sponsorBlockResponse = await pBrowser.runtime.sendMessage({
        type: 'FETCH_SPONSOR_SEGMENTS',
        videoId: currentSong.videoId
      });

      if (currentFetchMediaId !== localCurrentFetchMediaId) {
        console.warn("Song changed during SponsorBlock fetch. Aborting display.", currentSong);
        return;
      }

      if (sponsorBlockResponse.success) {
        lyricsObjectToDisplay.data = adjustLyricTiming(lyricsObjectToDisplay.data, sponsorBlockResponse.segments, lyricsObjectToDisplay.type === "Line" ? "s" : "s");
      } else {
        console.warn('Failed to fetch SponsorBlock segments:', sponsorBlockResponse.error);
      }
    }

    if (currentFetchMediaId !== localCurrentFetchMediaId) {
      console.warn("Song changed just before displaying lyrics. Aborting display.", currentSong);
      return;
    }

    lastFetchedLyrics = lyricsObjectToDisplay;

    if (LyricsPlusAPI.displayLyrics) {
      LyricsPlusAPI.displayLyrics(
        lyricsObjectToDisplay,
        lyricsObjectToDisplay.metadata.source,
        lyricsObjectToDisplay.type === "Line" ? "Line" : "Word",
        currentSettings.lightweight,
        lyricsObjectToDisplay.metadata.songWriters,
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

    if (currentFetchMediaId === (currentSong ? currentSong.videoId : null)) {
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
}

/* =================================================================
   PUBLIC API AND RENDERRR
   ================================================================= */

setCurrentDisplayModeAndRender = async (mode, songInfoForRefetch) => {
  currentDisplayMode = mode;

  if (songInfoForRefetch) {
    await fetchAndDisplayLyrics(songInfoForRefetch, false, false);
  } else {
    if (lastKnownSongInfo) {
      await fetchAndDisplayLyrics(lastKnownSongInfo, false, false);
    } else {
      console.error("Cannot update display mode: No song information available for refetch.");
      currentDisplayMode = 'none';
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
};

/* =================================================================
   UTILITY
   ================================================================= */

function convertWordLyricsToLine(lyrics) {
  if (lyrics.type === "Line") return lyrics;

  const lines = lyrics.data;
  lines.forEach((line, index) => {
    line.syllables = []
  });

  return {
    type: "Line",
    data: lines,
    metadata: lyrics.metadata,
    ignoreSponsorblock: lyrics.ignoreSponsorblock
  };
}
