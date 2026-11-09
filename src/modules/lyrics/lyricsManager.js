/* =================================================================
   STATE VARIABLES
   ================================================================= */

const audioCtx = new AudioContext();

let currentFetchMediaId = null;
let fetchSessionCounter = 0;
let currentDisplayMode = 'none';     // User's intended display mode ('none', 'translate', 'romanize', 'both')
let lastProcessedDisplayMode = 'none'; // The mode that was actually rendered
let lastRenderedHasTranslation = false;
let lastRenderedHasRomanization = false;
let forceNextRender = false;

let lastKnownSongInfo = null;
let lastBaseLyrics = null;
let lastLyricsNotFound = false;
let lastTranslationResponse = null;
let lastRomanizationResponse = null;

let userOffsetMs = 0;
let saveOffsetTimeout = null;
let userSelectedProvider = null;
const availableProviders = new Set();
const notFoundProviders = new Set();

// Debouncing to prevent rapid-fire requests
let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200;

// Microtask coalescing for concurrent translation + romanization completions
let pendingCombinedRenderFetchId = null;

// Settings keys that affect which cached responses to invalidate
const TRANSLATION_SETTING_KEYS = [
  'translationProvider',
  'geminiApiKey',
  'geminiModel',
  'openRouterApiKey',
  'openRouterModel',
  'deeplApiKey',
  'overrideTranslateTarget',
  'customTranslateTarget',
  'targetLang',
  'overrideGeminiPrompt',
  'customGeminiPrompt'
];
const ROMANIZATION_SETTING_KEYS = [
  'romanizationProvider',
  'geminiRomanizationModel',
  'transliterationTargetScript',
  'overrideGeminiRomanizePrompt',
  'customGeminiRomanizePrompt'
];
const RESTART_REQUIRED_KEYS = ['isEnabled', 'YTSongInfo', 'YTSongInfoDisableSeekbar', 'dynamicPlayer'];

const TRANSLATION_SETTING_SET = new Set(TRANSLATION_SETTING_KEYS);
const ROMANIZATION_SETTING_SET = new Set(ROMANIZATION_SETTING_KEYS);
const NON_RENDERING_KEY_SET = new Set([
  ...TRANSLATION_SETTING_KEYS,
  ...ROMANIZATION_SETTING_KEYS,
  ...RESTART_REQUIRED_KEYS
]);

const KNOWN_LYRICS_SOURCES = [
  'lyrics+', 'apple', 'apple music', 'qq', 'musixmatch', 'musixmatch-word',
  'unison', 'lrclib', 'lrcred', 'lrc.red', 'lrc-red', 'binilyrics', 'subtitles', 'youtube captions', 'youtube subtitles',
  'local', 'local lyrics', 'spotify', 'kpoe', 'customkpoe', 'lyricfind'
];
let _cachedSourceKey = null;
let _cachedValidSources = null;


/* =================================================================
   LANGUAGE, SCRIPT & EMBEDDED DATA RESOLUTION
   ================================================================= */

function getPrimaryLanguageCode(code) {
  if (!code || typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (!trimmed) return '';
  return trimmed.split(/[-_]/)[0] || '';
}

function getLanguageScript(tag) {
  if (!tag || typeof tag !== 'string') return '';
  const lower = tag.toLowerCase().replace(/_/g, '-');
  if (lower.includes('hant') || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'Hant';
  if (lower.includes('hans') || lower === 'zh-cn' || lower === 'zh-sg') return 'Hans';
  const parts = lower.split('-');
  if (parts.length > 1 && parts[1].length === 4) {
    return parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
  }
  return '';
}

function findFallbackLanguage(availableLanguages, requestedLanguage) {
  if (!Array.isArray(availableLanguages) || availableLanguages.length === 0 || !requestedLanguage) {
    return '';
  }

  const reqList = Array.isArray(requestedLanguage)
    ? requestedLanguage
    : [requestedLanguage];

  for (const req of reqList) {
    if (!req) continue;
    const reqTrimmed = String(req).trim();
    if (!reqTrimmed) continue;

    const exactIdx = availableLanguages.indexOf(reqTrimmed);
    if (exactIdx !== -1) return availableLanguages[exactIdx];

    const reqLower = reqTrimmed.toLowerCase();
    for (const candidate of availableLanguages) {
      if (String(candidate).toLowerCase() === reqLower) {
        return candidate;
      }
    }

    const reqScript = getLanguageScript(reqTrimmed);
    const primaryReq = getPrimaryLanguageCode(reqTrimmed).toLowerCase();

    if (reqScript && primaryReq) {
      for (const candidate of availableLanguages) {
        if (getPrimaryLanguageCode(candidate).toLowerCase() === primaryReq) {
          const candidateScript = getLanguageScript(candidate);
          if (candidateScript && candidateScript === reqScript) {
            return candidate;
          }
        }
      }
    }

    if (primaryReq) {
      for (const candidate of availableLanguages) {
        if (getPrimaryLanguageCode(candidate).toLowerCase() === primaryReq) {
          const candidateScript = getLanguageScript(candidate);
          if (!reqScript || !candidateScript || reqScript === candidateScript) {
            return candidate;
          }
        }
      }
    }
  }

  return '';
}

/**
 * Resolves the user's intended target language without using web native language.
 * Checks user settings override (customTranslateTarget) first,
 * then falls back to user system/browser languages (navigator.languages || navigator.language).
 */
function getResolvedLyricsLanguage(settings = currentSettings) {
  if (settings?.overrideTranslateTarget && settings?.customTranslateTarget?.trim()) {
    return settings.customTranslateTarget.trim();
  }
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return navigator.languages;
    }
    if (navigator.language) {
      return navigator.language;
    }
  }
  return 'en';
}

function getPrimaryTargetLanguage(settings = currentSettings) {
  const resolved = getResolvedLyricsLanguage(settings);
  if (Array.isArray(resolved)) {
    return resolved[0] || 'en';
  }
  return resolved || 'en';
}

function applyScriptToLine(line, scriptEntry, lang = '') {
  if (!line || !scriptEntry) return;

  if (!line.original) {
    line.original = {
      text: line.text,
      mainText: line.mainText,
      htmlText: line.htmlText,
      words: line.words ? line.words.slice() : [],
      syllabus: line.syllabus ? line.syllabus.slice() : [],
      backgroundText: line.backgroundText,
      htmlBackgroundText: line.htmlBackgroundText,
      backgroundWords: line.backgroundWords ? line.backgroundWords.slice() : undefined,
      keepParenthesis: line.keepParenthesis
    };
  }

  const hasTimedSpans = (Array.isArray(scriptEntry.words) && scriptEntry.words.length > 0) ||
                        (Array.isArray(scriptEntry.syllabus) && scriptEntry.syllabus.length > 0);

  if (hasTimedSpans) {
    line.words = scriptEntry.words ? scriptEntry.words.slice() : [];
    line.syllabus = scriptEntry.syllabus ? scriptEntry.syllabus.slice() : [];
    line.mainText = (scriptEntry.text || '').trim();
    line.htmlText = (scriptEntry.htmlText || scriptEntry.text || '').trim();

    if (scriptEntry.backgroundText) {
      line.backgroundText = scriptEntry.backgroundText.trim();
      line.htmlBackgroundText = (scriptEntry.htmlBackgroundText || scriptEntry.backgroundText).trim();
      line.text = line.syllabus.length > 0
        ? line.syllabus.map(s => s.text).join('').trim()
        : `${line.mainText} (${line.backgroundText})`;
    } else {
      delete line.backgroundText;
      delete line.htmlBackgroundText;
      line.text = line.syllabus.length > 0
        ? line.syllabus.map(s => s.text).join('').trim()
        : line.mainText;
    }

    if (scriptEntry.backgroundWords && scriptEntry.backgroundWords.length > 0) {
      line.backgroundWords = scriptEntry.backgroundWords.slice();
    } else {
      delete line.backgroundWords;
    }

    if (scriptEntry.keepParenthesis !== undefined) {
      line.keepParenthesis = scriptEntry.keepParenthesis;
    }
  } else {
    // Plain text replacement without spans
    line.mainText = (scriptEntry.text || '').trim();
    line.htmlText = (scriptEntry.htmlText || scriptEntry.text || '').trim();
    line.words = [];
    line.syllabus = [];

    if (scriptEntry.backgroundText) {
      line.backgroundText = scriptEntry.backgroundText.trim();
      line.htmlBackgroundText = (scriptEntry.htmlBackgroundText || scriptEntry.backgroundText).trim();
      line.text = `${line.mainText} (${line.backgroundText})`;
    } else {
      delete line.backgroundText;
      delete line.htmlBackgroundText;
      line.text = line.mainText;
    }

    delete line.backgroundWords;
    if (scriptEntry.keepParenthesis !== undefined) {
      line.keepParenthesis = scriptEntry.keepParenthesis;
    }
  }

  line.appliedScript = lang || scriptEntry.lang || '';
  line.isScriptApplied = true;
}

function restoreOriginalLyrics(lyrics) {
  if (!lyrics || !Array.isArray(lyrics.data)) return;
  for (const line of lyrics.data) {
    if (line.original) {
      line.text = line.original.text;
      line.mainText = line.original.mainText;
      line.htmlText = line.original.htmlText;
      line.words = line.original.words ? line.original.words.slice() : [];
      line.syllabus = line.original.syllabus ? line.original.syllabus.slice() : [];
      if (line.original.backgroundText) {
        line.backgroundText = line.original.backgroundText;
        line.htmlBackgroundText = line.original.htmlBackgroundText;
      } else {
        delete line.backgroundText;
        delete line.htmlBackgroundText;
      }
      if (line.original.backgroundWords) {
        line.backgroundWords = line.original.backgroundWords.slice();
      } else {
        delete line.backgroundWords;
      }
      line.keepParenthesis = line.original.keepParenthesis;
      delete line.appliedScript;
      delete line.isScriptApplied;
    }
  }
  if (lyrics.metadata) delete lyrics.metadata.appliedScript;
  delete lyrics.appliedScript;
}

/**
 * Resolves and applies script replacement on baseLyrics in-place inside LyricsManager.
 */
function applyLyricsScript(lyrics, targetLanguage = null) {
  if (!lyrics || !Array.isArray(lyrics.data) || lyrics.data.length === 0) return null;

  const metadata = lyrics.metadata || {};
  let scriptLanguages = metadata.scriptLanguages;
  if (!Array.isArray(scriptLanguages) || scriptLanguages.length === 0) {
    if (metadata.scriptsByLang && typeof metadata.scriptsByLang === 'object') {
      scriptLanguages = Object.keys(metadata.scriptsByLang);
    } else {
      const set = new Set();
      for (const line of lyrics.data) {
        if (line.scripts && typeof line.scripts === 'object') {
          for (const k of Object.keys(line.scripts)) set.add(k);
        }
      }
      scriptLanguages = Array.from(set);
    }
  }

  if (!scriptLanguages || scriptLanguages.length === 0) {
    if (lyrics.appliedScript) restoreOriginalLyrics(lyrics);
    return null;
  }

  const requested = targetLanguage || getResolvedLyricsLanguage();
  const matchedLang = findFallbackLanguage(scriptLanguages, requested);
  if (!matchedLang) {
    if (lyrics.appliedScript) restoreOriginalLyrics(lyrics);
    return null;
  }

  if (lyrics.appliedScript === matchedLang) {
    return matchedLang;
  }

  restoreOriginalLyrics(lyrics);

  let anyWords = false;
  for (const line of lyrics.data) {
    const key = line.lineKey || line.key;
    const entry = line.scripts?.[matchedLang] || (key && metadata.scriptsByLang?.[matchedLang]?.[key]);
    if (entry) {
      applyScriptToLine(line, entry, matchedLang);
    }
    if (Array.isArray(line.words) && line.words.some(w => !w.isWhitespace)) {
      anyWords = true;
    }
  }

  metadata.appliedScript = matchedLang;
  lyrics.appliedScript = matchedLang;
  if (anyWords) {
    lyrics.type = 'Word';
  }

  return matchedLang;
}

/**
 * Resolves embedded subtitle translations directly from the lyrics file without background fetch.
 */
function resolveEmbeddedTranslations(baseLyrics, targetLanguage = null) {
  if (!baseLyrics || !Array.isArray(baseLyrics.data)) return null;

  const lines = baseLyrics.data;
  const metadata = baseLyrics.metadata || {};

  let availableLangs = metadata.translationLanguages;
  if (!Array.isArray(availableLangs) || availableLangs.length === 0) {
    if (metadata.translationsByLang && typeof metadata.translationsByLang === 'object') {
      availableLangs = Object.keys(metadata.translationsByLang);
    } else {
      const set = new Set();
      for (const l of lines) {
        if (l.translations && typeof l.translations === 'object') {
          for (const k of Object.keys(l.translations)) set.add(k);
        }
      }
      availableLangs = Array.from(set);
    }
  }

  const requested = targetLanguage || getResolvedLyricsLanguage();
  let matchedLang = findFallbackLanguage(availableLangs, requested);

  if (!matchedLang) {
    const primaryReq = getPrimaryLanguageCode(Array.isArray(requested) ? requested[0] : requested).toLowerCase();
    const hasLegacyMatch = lines.some(l => {
      if (!l.translation?.text) return false;
      const p = getPrimaryLanguageCode(l.translation.lang || '').toLowerCase();
      return p && p === primaryReq;
    });
    if (!hasLegacyMatch) return null;
  }

  let hasAnyText = false;
  const translatedData = lines.map(line => {
    const key = line.lineKey || line.key;
    const entry = (matchedLang && (line.translations?.[matchedLang] || (key && metadata.translationsByLang?.[matchedLang]?.[key])))
      || line.translation
      || null;

    if (!entry || !entry.text) {
      return {
        ...line,
        translatedText: line.text
      };
    }

    hasAnyText = true;
    let combinedText = entry.text;
    if (entry.backgroundText && !combinedText.includes(entry.backgroundText)) {
      combinedText = `${combinedText} (${entry.backgroundText})`;
    }

    return {
      ...line,
      translation: entry,
      translatedText: combinedText,
      translatedBackgroundText: entry.backgroundText,
      translatedSyllabus: Array.isArray(entry.syllabus) ? entry.syllabus : undefined,
      chunk: Array.isArray(entry.syllabus) ? entry.syllabus : undefined
    };
  });

  if (!hasAnyText) return null;

  return {
    success: true,
    data: translatedData,
    translatedLyrics: {
      ...baseLyrics,
      data: translatedData
    }
  };
}

/**
 * Resolves embedded transliterations/pronunciations directly from the lyrics file without background fetch.
 */
function resolveEmbeddedTransliterations(baseLyrics, targetLanguage = null) {
  if (!baseLyrics || !Array.isArray(baseLyrics.data)) return null;

  const lines = baseLyrics.data;
  const metadata = baseLyrics.metadata || {};

  let availableLangs = metadata.pronunciationLanguages;
  if (!Array.isArray(availableLangs) || availableLangs.length === 0) {
    if (metadata.pronunciationsByLang && typeof metadata.pronunciationsByLang === 'object') {
      availableLangs = Object.keys(metadata.pronunciationsByLang);
    } else {
      const set = new Set();
      for (const l of lines) {
        if (l.transliterations && typeof l.transliterations === 'object') {
          for (const k of Object.keys(l.transliterations)) set.add(k);
        }
      }
      availableLangs = Array.from(set);
    }
  }

  const requested = targetLanguage || getResolvedLyricsLanguage();
  let matchedLang = '';
  if (availableLangs && availableLangs.length > 0) {
    matchedLang = findFallbackLanguage(availableLangs, requested) || availableLangs[0];
  }

  const hasAnyPron = matchedLang || lines.some(l => l.romanizedText || l.transliteration);
  if (!hasAnyPron) return null;

  let hasAnyText = false;
  const romanizedData = lines.map(line => {
    const key = line.lineKey || line.key;
    const entry = (matchedLang && (line.transliterations?.[matchedLang] || (key && metadata.pronunciationsByLang?.[matchedLang]?.[key])))
      || line.transliteration
      || null;

    const romText = entry?.text || line.romanizedText || line.text;
    if (entry?.text || line.romanizedText) hasAnyText = true;

    const romChunk = entry?.syllabus || (line.syllabus?.some(s => s.romanizedText) ? line.syllabus.map(s => ({ text: s.romanizedText || s.text })) : undefined);

    return {
      ...line,
      text: romText,
      romanizedText: romText,
      chunk: romChunk
    };
  });

  if (!hasAnyText) return null;

  return {
    success: true,
    data: romanizedData,
    translatedLyrics: {
      ...baseLyrics,
      data: romanizedData
    }
  };
}

/* =================================================================
   HELPER FUNCTIONS - DATA PROCESSING
   ================================================================= */

/**
 * Shallow-clones a lyrics object and its line array without expensive JSON serialization.
 * @param {object} baseLyrics - The original lyrics object.
 * @returns {object} A shallow copy with cloned line entries.
 */
function cloneLyricsShallow(baseLyrics) {
  return {
    ...baseLyrics,
    data: Array.isArray(baseLyrics.data)
      ? baseLyrics.data.map(line => ({ ...line }))
      : []
  };
}

/**
 * Merges translation and romanization data into a copy of the base lyrics object.
 * @param {object}      baseLyrics     - The original lyrics object.
 * @param {object|null} translation    - The translation lyrics object.
 * @param {object|null} romanization   - The romanization lyrics object.
 * @returns {object} The merged lyrics object.
 */
function combineLyricsData(baseLyrics, translation, romanization) {
  const translationData  = translation?.data;
  const romanizationData = romanization?.data;

  if (!translationData && !romanizationData) {
    return cloneLyricsShallow(baseLyrics);
  }

  const isWordLyrics = baseLyrics.type === "Word";

  return {
    ...baseLyrics,
    data: baseLyrics.data.map((line, index) => {
      const translatedLine = translationData?.[index];
      const romanizedLine  = romanizationData?.[index];

      if (!translatedLine && !romanizedLine) {
        return { ...line };
      }

      const mergedLine = { ...line };

      if (translatedLine?.translatedText) {
        mergedLine.translatedText = translatedLine.translatedText;
      }
      if (translatedLine?.translatedBackgroundText) {
        mergedLine.translatedBackgroundText = translatedLine.translatedBackgroundText;
      }
      if (Array.isArray(translatedLine?.translatedSyllabus) && translatedLine.translatedSyllabus.length > 0) {
        mergedLine.translatedSyllabus = translatedLine.translatedSyllabus.map(s => ({ ...s }));
      }

      if (romanizedLine) {
        const hasWordSyncedRomanization =
          isWordLyrics &&
          romanizedLine.chunk?.length > 0 &&
          mergedLine.syllabus?.length > 0;

        if (hasWordSyncedRomanization) {
          mergedLine.syllabus = mergedLine.syllabus.map((syllable, sylIndex) => {
            const romanizedSyllable = romanizedLine.chunk[sylIndex];
            const romSylText = (typeof romanizedSyllable === 'object' && romanizedSyllable !== null)
              ? (romanizedSyllable.romanizedText || romanizedSyllable.text)
              : (typeof romanizedSyllable === 'string' ? romanizedSyllable : (syllable?.text || ''));
            return {
              ...syllable,
              romanizedText: romSylText || syllable?.text || ''
            };
          });
        }
        if (romanizedLine.text || romanizedLine.romanizedText) {
          mergedLine.romanizedText = romanizedLine.text || romanizedLine.romanizedText;
        }
      }

      return mergedLine;
    })
  };
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
    data: lyrics.data.map(line => ({ ...line, syllabus: [], replacementSyllabus: undefined, translatedSyllabus: undefined })),
    metadata: lyrics.metadata,
    ignoreSponsorblock: lyrics.ignoreSponsorblock,
    provider: lyrics.provider,
    byVideoId: lyrics.byVideoId
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
    lastKnownSongInfo &&
    lastKnownSongInfo.title === currentSong.title &&
    lastKnownSongInfo.artist === currentSong.artist &&
    lastKnownSongInfo.album === currentSong.album &&
    Math.abs((lastKnownSongInfo.duration || 0) - (currentSong.duration || 0)) < 2;

  if (!isNewSong && !forceReload && isSameSong) {
    if (lastLyricsNotFound) {
      if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound(currentSong);
      return null;
    }
    if (lastBaseLyrics) {
      return lastBaseLyrics;
    }
  }

  LyricsPlusAPI.cleanupLyrics();
  lastTranslationResponse = null;
  lastRomanizationResponse = null;
  lastRenderedHasTranslation = false;
  lastRenderedHasRomanization = false;
  forceNextRender = true;

  const response = await pBrowser.runtime.sendMessage({
    type: 'FETCH_LYRICS',
    songInfo: currentSong,
    forceReload: forceReload
  });

  if (currentFetchMediaId !== fetchId) {
    console.warn("Song changed during initial lyrics fetch. Aborting.", currentSong);
    return null;
  }

  if (!response?.success) {
    console.warn('Failed to fetch original lyrics:', response?.error || response?.err || 'Unknown error');
    lastKnownSongInfo = currentSong;
    lastLyricsNotFound = true;
    lastBaseLyrics = null;
    if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound(currentSong);
    return null;
  }

  lastLyricsNotFound = false;
  lastBaseLyrics = response.lyrics;
  if (lastBaseLyrics) {
    applyLyricsScript(lastBaseLyrics);
  }
  if (response.availableProviders) {
    setAvailableProviders(response.availableProviders);
  }
  return lastBaseLyrics;
}

let lastSponsorSegments = null;
let lastSponsorVideoId = null;
let lastSubtitleData = null;
let lastSubtitleVideoId = null;

/**
 * Schedules a microtask-coalesced call to updateAndRenderCombinedLyrics so that
 * when both translation and romanization settle in the same tick, the DOM is only rebuilt once.
 */
function scheduleCombinedLyricsRender(currentSong, fetchId) {
  if (pendingCombinedRenderFetchId === fetchId) return;
  pendingCombinedRenderFetchId = fetchId;
  queueMicrotask(() => {
    if (pendingCombinedRenderFetchId === fetchId) {
      pendingCombinedRenderFetchId = null;
    }
    if (currentFetchMediaId === fetchId) {
      updateAndRenderCombinedLyrics(currentSong, fetchId);
    }
  });
}

/**
 * Initiates translation and romanization fetches independently without blocking each other.
 * Checks embedded translations/transliterations from the lyrics file first;
 * falls back to background external providers only when not available in the lyrics file.
 */
function fetchAdditionalData(currentSong, effectiveMode, fetchId) {
  const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
  const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

  if (needsTranslation && !lastTranslationResponse) {
    const embedded = resolveEmbeddedTranslations(lastBaseLyrics);
    if (embedded) {
      lastTranslationResponse = embedded;
      scheduleCombinedLyricsRender(currentSong, fetchId);
    } else {
      const targetLang = getPrimaryTargetLanguage();
      pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS',
        action: 'translate',
        songInfo: currentSong,
        targetLang
      }).then(response => {
        if (currentFetchMediaId === fetchId) {
          lastTranslationResponse = response || { success: false };
          scheduleCombinedLyricsRender(currentSong, fetchId);
        }
      }).catch(error => {
        console.warn("Translation request error:", error);
        if (currentFetchMediaId === fetchId) {
          lastTranslationResponse = { success: false, error: error.message };
          scheduleCombinedLyricsRender(currentSong, fetchId);
        }
      });
    }
  }

  if (needsRomanization && !lastRomanizationResponse) {
    const embedded = resolveEmbeddedTransliterations(lastBaseLyrics);
    if (embedded) {
      lastRomanizationResponse = embedded;
      scheduleCombinedLyricsRender(currentSong, fetchId);
    } else {
      const targetLang = getPrimaryTargetLanguage();
      pBrowser.runtime.sendMessage({
        type: 'TRANSLATE_LYRICS',
        action: 'romanize',
        songInfo: currentSong,
        targetLang
      }).then(response => {
        if (currentFetchMediaId === fetchId) {
          lastRomanizationResponse = response || { success: false };
          scheduleCombinedLyricsRender(currentSong, fetchId);
        }
      }).catch(error => {
        console.warn("Romanization request error:", error);
        if (currentFetchMediaId === fetchId) {
          lastRomanizationResponse = { success: false, error: error.message };
          scheduleCombinedLyricsRender(currentSong, fetchId);
        }
      });
    }
  }
}

/**
 * Checks whether applySubtitleRetiming or applySponsorBlock will need an async IPC call,
 * so we only do a preliminary base render when an async wait will actually occur.
 */
function needsAsyncTimingFetch(lyrics, currentSong) {
  if (!currentSong?.isVideo || !currentSong?.videoId || !lyrics) return false;

  const isSubtitles =
    lyrics.provider === 'subtitles' ||
    lyrics.metadata?.provider === 'subtitles' ||
    lyrics.metadata?.source === 'YouTube Captions' ||
    lyrics.metadata?.source === 'YouTube Subtitles' ||
    lyrics.metadata?.source === 'subtitles';

  if (isSubtitles) return false;

  const isUnison =
    lyrics.provider === 'unison' ||
    lyrics.metadata?.provider === 'unison' ||
    lyrics.metadata?.source?.toLowerCase() === 'unison';

  const isUnisonVideoId =
    isUnison &&
    (lyrics.byVideoId === true ||
     lyrics.metadata?.byVideoId === true ||
     (lyrics.byVideoId === undefined &&
      lyrics.metadata?.byVideoId === undefined &&
      currentSong.isVideo &&
      (lyrics.ignoreSponsorblock || lyrics.metadata?.ignoreSponsorblock)));

  if (!isUnisonVideoId && typeof retimeLyricsWithSubtitles === "function") {
    if (!(lastSubtitleVideoId === currentSong.videoId && lastSubtitleData !== null)) {
      return true;
    }
  }

  const shouldApplySponsorBlock =
    currentSettings.useSponsorBlock &&
    !lyrics.ignoreSponsorblock &&
    !lyrics.metadata?.ignoreSponsorblock;

  if (shouldApplySponsorBlock && !(lastSponsorVideoId === currentSong.videoId && lastSponsorSegments !== null)) {
    return true;
  }

  return false;
}

/**
 * Attempts to retime lyrics using video subtitles for Music Videos.
 * Returns retimed lyrics array on success, or null if subtitles are unavailable/cannot be aligned.
 */
async function applySubtitleRetiming(lyrics, currentSong, fetchId) {
  const isSubtitles =
    lyrics.provider === 'subtitles' ||
    lyrics.metadata?.provider === 'subtitles' ||
    lyrics.metadata?.source === 'YouTube Captions' ||
    lyrics.metadata?.source === 'YouTube Subtitles' ||
    lyrics.metadata?.source === 'subtitles';

  const isUnison =
    lyrics.provider === 'unison' ||
    lyrics.metadata?.provider === 'unison' ||
    lyrics.metadata?.source?.toLowerCase() === 'unison';

  const isUnisonVideoId =
    isUnison &&
    (lyrics.byVideoId === true ||
     lyrics.metadata?.byVideoId === true ||
     (lyrics.byVideoId === undefined &&
      lyrics.metadata?.byVideoId === undefined &&
      currentSong.isVideo &&
      (lyrics.ignoreSponsorblock || lyrics.metadata?.ignoreSponsorblock)));

  const shouldApply =
    currentSong.isVideo &&
    currentSong.videoId &&
    !isSubtitles &&
    !isUnisonVideoId &&
    typeof retimeLyricsWithSubtitles === "function";

  if (!shouldApply) return null;

  try {
    let subtitles = null;
    if (lastSubtitleVideoId === currentSong.videoId && lastSubtitleData !== null) {
      subtitles = lastSubtitleData;
    } else {
      const response = await pBrowser.runtime.sendMessage({
        type: 'FETCH_SUBTITLES',
        songInfo: currentSong
      });

      if (currentFetchMediaId !== fetchId) {
        console.warn("Song changed during Subtitle fetch. Aborting.", currentSong);
        return null;
      }

      if (response?.success && (response.subtitles?.tracks?.length > 0 || response.subtitles?.data?.length > 0)) {
        lastSubtitleVideoId = currentSong.videoId;
        lastSubtitleData = response.subtitles;
        subtitles = response.subtitles;
      }
    }

    if (subtitles) {
      const retimedData = retimeLyricsWithSubtitles(lyrics.data, subtitles, "s");
      if (retimedData && retimedData.length > 0) {
        console.log("Applied Subtitle Timeline retiming for Music Video:", currentSong.title);
        return retimedData;
      }
    }
  } catch (error) {
    console.warn("Subtitle retiming failed:", error);
  }

  return null;
}

/**
 * Applies SponsorBlock timing adjustments to lyrics data if applicable.
 * Returns the adjusted data array, the original data array if SponsorBlock is not needed,
 * or null if the song changed mid-request.
 */
async function applySponsorBlock(lyrics, currentSong, fetchId) {
  const isSubtitles =
    lyrics.provider === 'subtitles' ||
    lyrics.metadata?.provider === 'subtitles' ||
    lyrics.metadata?.source === 'YouTube Captions';

  const shouldApply =
    currentSong.isVideo &&
    currentSong.videoId &&
    currentSettings.useSponsorBlock &&
    !lyrics.ignoreSponsorblock &&
    !lyrics.metadata?.ignoreSponsorblock &&
    !isSubtitles;

  if (!shouldApply) return lyrics.data;

  if (lastSponsorVideoId === currentSong.videoId && lastSponsorSegments !== null) {
    return adjustLyricTiming(lyrics.data, lastSponsorSegments, "s");
  }

  const response = await pBrowser.runtime.sendMessage({
    type: 'FETCH_SPONSOR_SEGMENTS',
    videoId: currentSong.videoId
  });

  if (currentFetchMediaId !== fetchId) {
    console.warn("Song changed during SponsorBlock fetch. Aborting.", currentSong);
    return null;
  }

  if (response.success) {
    lastSponsorVideoId = currentSong.videoId;
    lastSponsorSegments = response.segments;
    return adjustLyricTiming(lyrics.data, response.segments, "s");
  }

  return lyrics.data;
}


/* =================================================================
   PROVIDER, SOURCE & OFFSET HELPERS (NON-RENDERING)
   ================================================================= */

function detectLyricsProviderFromSource(source) {
  if (!source) return '';
  const s = source.toLowerCase();
  if (s.includes('lrcred') || s.includes('lrc-red') || s.includes('lrc.red') || s.includes('bini')) return 'lrcred';
  if (s.includes('unison')) return 'unison';
  if (s.includes('lrclib')) return 'lrclib';
  if (s.includes('local')) return 'local';
  if (s.includes('subtitles') || s.includes('captions')) return 'subtitles';
  if (s.includes('lyricfind')) return 'ytmusic';
  if (s.includes('youtube music') || s.includes('ytmusic')) return 'ytmusic';
  if (s.includes('apple') || s.includes('spotify') || s.includes('musixmatch') || s.includes('qq') || s.includes('kpoe') || s.includes('lyrics+')) return 'kpoe';
  return '';
}

function isValidLyricsSource(source, settings = currentSettings, lyrics = lastBaseLyrics) {
  if (!source || typeof source !== 'string') return false;
  const s = source.trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'undefined' || s === 'null' || s === 'none' || s === 'youtube music' || s === 'ytmusic') return false;

  const sourceOrder = settings?.lyricsSourceOrder || '';
  const providerOrder = settings?.lyricsProviderOrder || '';
  const cacheKey = `${sourceOrder}|${providerOrder}`;

  if (_cachedSourceKey !== cacheKey || !_cachedValidSources) {
    const configuredSources = sourceOrder.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const configuredProviders = providerOrder.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    _cachedValidSources = Array.from(new Set([...KNOWN_LYRICS_SOURCES, ...configuredSources, ...configuredProviders]));
    _cachedSourceKey = cacheKey;
  }

  for (let i = 0; i < _cachedValidSources.length; i++) {
    const known = _cachedValidSources[i];
    if (s.includes(known) || known.includes(s)) return true;
  }

  if (lyrics?.provider === 'ytmusic' || lyrics?.metadata?.provider === 'ytmusic') {
    return true;
  }

  return false;
}

function getLyricsProviderContext(songInfo = lastKnownSongInfo, lyrics = lastBaseLyrics, settings = currentSettings, selectedProvider = userSelectedProvider) {
  const providerOrderStr = settings?.lyricsProviderOrder || 'kpoe,lrcred,unison,lrclib';
  const providerKeys = providerOrderStr.split(',').map(s => {
    const trimmed = s.trim();
    return trimmed === 'binilyrics' ? 'lrcred' : trimmed;
  }).filter(Boolean);

  if (settings?.customKpoeUrl && !providerKeys.includes('customKpoe')) {
    providerKeys.push('customKpoe');
  }

  const activeProvider = (
    selectedProvider ||
    lyrics?.provider ||
    lyrics?.metadata?.provider ||
    detectLyricsProviderFromSource(lyrics?.metadata?.source) ||
    'kpoe'
  ).toLowerCase();

  const info = songInfo || lastKnownSongInfo;
  if ((info?.isVideo || info?.subtitle || activeProvider === 'subtitles') && !providerKeys.includes('subtitles')) {
    providerKeys.push('subtitles');
  }
  if (activeProvider === 'local' && !providerKeys.includes('local')) {
    providerKeys.push('local');
  }
  if ((info?.videoId || activeProvider === 'ytmusic') && !providerKeys.includes('ytmusic')) {
    providerKeys.push('ytmusic');
  }

  const ytMusicDisplay = (activeProvider === 'ytmusic' ? lyrics?.metadata?.source : null)
    || info?.ytMusicLyrics?.provider
    || 'YouTube Music';
  const providerDisplayNames = {
    'lrcred': 'lrc.red',
    'binilyrics': 'lrc.red',
    'kpoe': 'Lyrics+',
    'customKpoe': 'Custom Lyrics+',
    'unison': 'Unison',
    'lrclib': 'LRCLib',
    'ytmusic': ytMusicDisplay,
    'local': 'Local Lyrics',
    'subtitles': 'YouTube Subtitles'
  };
  return { providerKeys, activeProvider, providerDisplayNames };
}

function saveLyricsOffset(songInfo, offsetMs) {
  userOffsetMs = offsetMs;
  clearTimeout(saveOffsetTimeout);
  saveOffsetTimeout = setTimeout(() => {
    if (typeof pBrowser !== 'undefined' && pBrowser.runtime?.sendMessage) {
      pBrowser.runtime.sendMessage({
        type: 'SAVE_LYRICS_OFFSET',
        songInfo,
        offsetMs
      }).catch(err => console.warn('Failed to save offset:', err));
    }
  }, 400);
}

async function loadLyricsOffset(songInfo) {
  if (!songInfo || typeof pBrowser === 'undefined' || !pBrowser.runtime?.sendMessage) return 0;
  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'GET_LYRICS_OFFSET',
      songInfo
    });
    if (response && typeof response.offsetMs === 'number') {
      userOffsetMs = response.offsetMs;
      if (LyricsPlusAPI.setUserOffset) {
        LyricsPlusAPI.setUserOffset(response.offsetMs);
      }
      return response.offsetMs;
    }
  } catch (err) {
    console.warn('Failed to load lyrics offset:', err);
  }
  return 0;
}

async function loadAvailableProviders(songInfo) {
  if (!songInfo || typeof pBrowser === 'undefined' || !pBrowser.runtime?.sendMessage) return;
  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'GET_AVAILABLE_PROVIDERS',
      songInfo
    });
    if (response?.success && Array.isArray(response.availableProviders)) {
      setAvailableProviders(response.availableProviders);
    }
  } catch (err) {}
}

function setAvailableProviders(providers) {
  if (Array.isArray(providers)) {
    providers.forEach(p => {
      if (p && !notFoundProviders.has(p.toLowerCase())) {
        availableProviders.add(p.toLowerCase());
      }
    });
  }
  const activeProvider = (
    userSelectedProvider ||
    lastBaseLyrics?.provider ||
    lastBaseLyrics?.metadata?.provider ||
    detectLyricsProviderFromSource(lastBaseLyrics?.metadata?.source)
  );
  if (activeProvider) {
    availableProviders.add(activeProvider.toLowerCase());
  }

  if (LyricsPlusAPI.setAvailableProviders) {
    LyricsPlusAPI.setAvailableProviders(Array.from(availableProviders));
  }
}

function getProviderDisplayName(provider, lyrics) {
  const map = {
    'lrcred': 'lrc.red',
    'binilyrics': 'lrc.red',
    'kpoe': 'Lyrics+',
    'customKpoe': 'Custom Lyrics+',
    'unison': 'Unison',
    'lrclib': 'LRCLib',
    'ytmusic': lyrics?.metadata?.source || lastKnownSongInfo?.ytMusicLyrics?.provider || 'Lyrics',
    'local': 'Local Lyrics',
    'subtitles': 'YouTube Subtitles'
  };
  return map[provider] || (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Unknown');
}

async function switchLyricsProvider(providerId) {
  if (!lastKnownSongInfo) return false;
  const currentSong = lastKnownSongInfo;
  const baseId = currentSong.videoId || currentSong.appleId || currentSong.songId || `${currentSong.title}-${currentSong.artist}`;
  const fetchId = `${baseId}__${++fetchSessionCounter}`;
  currentFetchMediaId = fetchId;
  const providerName = getProviderDisplayName(providerId, lastBaseLyrics);

  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'SWITCH_LYRICS_PROVIDER',
      songInfo: currentSong,
      provider: providerId
    });

    if (currentFetchMediaId !== fetchId) {
      console.warn("Song changed during lyrics provider switch. Aborting.", currentSong);
      return false;
    }

    if (response?.success && response.lyrics) {
      userSelectedProvider = providerId;
      availableProviders.add(providerId.toLowerCase());
      if (response.availableProviders) {
        setAvailableProviders(response.availableProviders);
      } else if (LyricsPlusAPI.setAvailableProviders) {
        LyricsPlusAPI.setAvailableProviders(Array.from(availableProviders));
      }

      // Clear previous translation and romanization responses as lyrics lines/timing differ
      lastTranslationResponse = null;
      lastRomanizationResponse = null;
      lastRenderedHasTranslation = false;
      lastRenderedHasRomanization = false;
      forceNextRender = true;

      lastBaseLyrics = response.lyrics;
      if (lastBaseLyrics) {
        applyLyricsScript(lastBaseLyrics);
      }
      await updateAndRenderCombinedLyrics(currentSong, fetchId);

      // Re-trigger translation / romanization fetch if enabled
      const needsTranslation = currentDisplayMode === 'translate' || currentDisplayMode === 'both';
      const needsRomanization = currentDisplayMode === 'romanize' || currentDisplayMode === 'both' || currentSettings.largerTextMode === "romanization";
      if (needsTranslation || needsRomanization) {
        if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
        fetchAdditionalData(currentSong, currentDisplayMode, fetchId);
      }

      if (LyricsPlusAPI.showToast) {
        LyricsPlusAPI.showToast(`Switched lyrics to ${providerName}`);
      }
      return true;
    } else {
      notFoundProviders.add(providerId.toLowerCase());
      availableProviders.delete(providerId.toLowerCase());
      if (LyricsPlusAPI.showToast) {
        const notFoundMsg = (typeof t === 'function' && t("sourceNotFound")) || `No lyrics found from ${providerName}`;
        LyricsPlusAPI.showToast(notFoundMsg);
      }
      return false;
    }
  } catch (error) {
    console.warn("Failed to switch lyrics provider:", error);
    if (LyricsPlusAPI.showToast) {
      LyricsPlusAPI.showToast("Failed to switch lyrics provider");
    }
    return false;
  }
}

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
    audioCtx.outputLatency || 0,
    switchLyricsProvider,
    saveLyricsOffset,
    getLyricsProviderContext,
    userOffsetMs
  );
}

/**
 * Renders the base lyrics immediately as a placeholder while additional async timing data loads.
 * Uses shallow cloning instead of JSON.parse(JSON.stringify).
 */
function renderPreliminaryBaseLyrics(baseLyrics, currentSong) {
  let lyrics = cloneLyricsShallow(baseLyrics);

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

  if (LyricsPlusAPI.displayLyrics) {
    callDisplayLyricsAPI(lyrics, currentSong, displayMode);
  } else {
    console.error("displayLyrics is not available.");
  }
}

/**
 * Renders the lyrics with whatever translation and romanization data is currently available.
 * Manages loading indicator state based on whether any required request is still pending.
 */
async function updateAndRenderCombinedLyrics(currentSong, fetchId, renderedPreliminary = false) {
  if (currentFetchMediaId !== fetchId || !lastBaseLyrics) return;

  const hasTranslation = !!(lastTranslationResponse?.success && lastTranslationResponse.translatedLyrics);
  const hasRomanization = !!(lastRomanizationResponse?.success && lastRomanizationResponse.translatedLyrics);

  let lyrics = combineLyricsData(
    lastBaseLyrics,
    hasTranslation ? lastTranslationResponse.translatedLyrics : null,
    hasRomanization ? lastRomanizationResponse.translatedLyrics : null
  );

  const finalDisplayMode = determineFinalDisplayMode(currentDisplayMode, hasTranslation, hasRomanization);

  if (lyrics.type === "Word" && !currentSettings.wordByWord) {
    lyrics = convertWordLyricsToLine(lyrics);
  }

  const originalDataRef = lyrics.data;
  let adjustedData = await applySubtitleRetiming(lyrics, currentSong, fetchId);
  if (currentFetchMediaId !== fetchId) return; // Song changed mid-fetch

  if (!adjustedData) {
    adjustedData = await applySponsorBlock(lyrics, currentSong, fetchId);
    if (adjustedData === null) return; // Song changed mid-fetch
  }

  const timingChanged = adjustedData !== originalDataRef;
  lyrics.data = adjustedData;

  const needsTranslation = currentDisplayMode === 'translate' || currentDisplayMode === 'both';
  const needsRomanization = currentDisplayMode === 'romanize' || currentDisplayMode === 'both' || currentSettings.largerTextMode === "romanization";
  const isTranslationPending = needsTranslation && !lastTranslationResponse;
  const isRomanizationPending = needsRomanization && !lastRomanizationResponse;

  const isSameSongRendered =
    !forceNextRender &&
    lastKnownSongInfo &&
    lastKnownSongInfo.title === currentSong.title &&
    lastKnownSongInfo.artist === currentSong.artist &&
    lastKnownSongInfo.album === currentSong.album;

  const modeChanged = finalDisplayMode !== lastProcessedDisplayMode;
  const dataChanged =
    hasTranslation !== lastRenderedHasTranslation ||
    hasRomanization !== lastRenderedHasRomanization;

  const skipRedundantPreliminary =
    renderedPreliminary && !timingChanged && !hasTranslation && !hasRomanization && finalDisplayMode === 'none';
  const skipWhilePendingUnchanged =
    !renderedPreliminary && isSameSongRendered && !timingChanged && !modeChanged && !dataChanged;

  if (!skipRedundantPreliminary && !skipWhilePendingUnchanged) {
    renderFinalLyrics(lyrics, currentSong, finalDisplayMode);
    forceNextRender = false;
    lastRenderedHasTranslation = hasTranslation;
    lastRenderedHasRomanization = hasRomanization;
    lastProcessedDisplayMode = finalDisplayMode;
  }

  lastLyricsNotFound = false;
  lastKnownSongInfo = currentSong;

  if (!isTranslationPending && !isRomanizationPending) {
    currentDisplayMode = finalDisplayMode;
  }

  if (LyricsPlusAPI.setTranslationLoading) {
    LyricsPlusAPI.setTranslationLoading(isTranslationPending || isRomanizationPending);
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

  const baseId = currentSong.videoId || currentSong.appleId || currentSong.songId || songKey;
  const fetchId = `${baseId}__${++fetchSessionCounter}`;
  currentFetchMediaId = fetchId;

  try {
    const effectiveMode = resolveEffectiveMode(isNewSong);
    currentDisplayMode = effectiveMode;

    const isDifferentSong =
      !lastKnownSongInfo ||
      lastKnownSongInfo.title !== currentSong.title ||
      lastKnownSongInfo.artist !== currentSong.artist ||
      lastKnownSongInfo.album !== currentSong.album;

    if (isNewSong || isDifferentSong) {
      userSelectedProvider = null;
      availableProviders.clear();
      notFoundProviders.clear();
      userOffsetMs = 0;
      loadLyricsOffset(currentSong);
      loadAvailableProviders(currentSong);
    }

    const baseLyrics = await fetchBaseLyrics(currentSong, isNewSong, forceReload, fetchId);
    if (!baseLyrics) return;

    const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
    const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

    // Eagerly resolve embedded translation / transliteration from lyrics file if available
    if (needsTranslation && !lastTranslationResponse) {
      const embedded = resolveEmbeddedTranslations(baseLyrics);
      if (embedded) lastTranslationResponse = embedded;
    }
    if (needsRomanization && !lastRomanizationResponse) {
      const embedded = resolveEmbeddedTransliterations(baseLyrics);
      if (embedded) lastRomanizationResponse = embedded;
    }

    const isMissingTranslation = needsTranslation && !lastTranslationResponse;
    const isMissingRomanization = needsRomanization && !lastRomanizationResponse;

    let renderedPreliminary = false;
    if (isNewSong && needsAsyncTimingFetch(baseLyrics, currentSong)) {
      renderPreliminaryBaseLyrics(baseLyrics, currentSong);
      renderedPreliminary = true;
    }
    await updateAndRenderCombinedLyrics(currentSong, fetchId, renderedPreliminary);

    if (isMissingTranslation || isMissingRomanization) {
      if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
      fetchAdditionalData(currentSong, effectiveMode, fetchId);
    }

  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    currentDisplayMode = 'none';
    lastProcessedDisplayMode = 'none';
    lastKnownSongInfo = currentSong;
    lastLyricsNotFound = true;
    lastBaseLyrics = null;

    if (currentFetchMediaId === fetchId) {
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError(currentSong);
    }
  }
}


/* =================================================================
   PUBLIC API AND RENDER TRIGGER
   ================================================================= */

function setCurrentDisplayModeAndRender(mode, overrideSongInfo) {
  currentDisplayMode = mode;
  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = null;
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
  if (!changedKeys || changedKeys.length === 0) return;

  const translationInvalidated = changedKeys.some(k => TRANSLATION_SETTING_SET.has(k));
  const romanizationInvalidated = changedKeys.some(k => ROMANIZATION_SETTING_SET.has(k));
  if (translationInvalidated) {
    lastTranslationResponse = null;
    lastRenderedHasTranslation = false;
    if (lastBaseLyrics) {
      applyLyricsScript(lastBaseLyrics);
    }
  }
  if (romanizationInvalidated) {
    lastRomanizationResponse = null;
    lastRenderedHasRomanization = false;
  }

  forceNextRender = true;
  lastProcessedDisplayMode = 'none';

  if (!lastKnownSongInfo) return;

  const shouldRender =
    changedKeys.some(k => !NON_RENDERING_KEY_SET.has(k)) ||
    (translationInvalidated && (currentDisplayMode === 'translate' || currentDisplayMode === 'both')) ||
    (romanizationInvalidated && (currentDisplayMode === 'romanize' || currentDisplayMode === 'both' || currentSettings.largerTextMode === 'romanization'));

  if (shouldRender) {
    console.log("Live settings update received, re-rendering lyrics...", changedKeys);
    fetchAndDisplayLyrics(lastKnownSongInfo, false, false);
  }
});