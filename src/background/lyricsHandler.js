// Universal Browser API handle
const pBrowser = chrome || browser;
import { createRomanizationPrompt, createTranslationPrompt } from "./geminiHandler.js"

/* =================================================================
   CONSTANTS
   ================================================================= */

const CACHE_DB_NAME = "LyricsCacheDB";
const CACHE_DB_VERSION = 1;
const LYRICS_OBJECT_STORE = "lyrics";

const TRANSLATIONS_DB_NAME = "TranslationsDB";
const TRANSLATIONS_DB_VERSION = 1;
const TRANSLATIONS_OBJECT_STORE = "translations";

const LOCAL_LYRICS_DB_NAME = "LocalLyricsDB";
const LOCAL_LYRICS_DB_VERSION = 1;
const LOCAL_LYRICS_OBJECT_STORE = "localLyrics";

const MESSAGE_TYPES = {
    FETCH_LYRICS: 'FETCH_LYRICS',
    RESET_CACHE: 'RESET_CACHE',
    GET_CACHED_SIZE: 'GET_CACHED_SIZE',
    TRANSLATE_LYRICS: 'TRANSLATE_LYRICS',
    FETCH_SPONSOR_SEGMENTS: 'FETCH_SPONSOR_SEGMENTS',
    UPLOAD_LOCAL_LYRICS: 'UPLOAD_LOCAL_LYRICS',
    GET_LOCAL_LYRICS_LIST: 'GET_LOCAL_LYRICS_LIST',
    DELETE_LOCAL_LYRICS: 'DELETE_LOCAL_LYRICS',
    FETCH_LOCAL_LYRICS: 'FETCH_LOCAL_LYRICS'
};

const CACHE_STRATEGIES = {
    AGGRESSIVE: 'aggressive',
    MODERATE: 'moderate',
    NONE: 'none'
};

const PROVIDERS = {
    KPOE: 'kpoe',
    CUSTOM_KPOE: 'customKpoe',
    LRCLIB: 'lrclib',
    LOCAL: 'local', // New provider for local lyrics
    GEMINI: 'gemini',
    GOOGLE: 'google'
};

const KPOE_SERVERS = [
    "https://lyricsplus.prjktla.workers.dev",
    "https://lyrics-plus-backend.vercel.app",
    "https://lyricsplus.onrender.com",
    "https://lyricsplus.prjktla.online"
];

/* =================================================================
   IN-MEMORY CACHE
   ================================================================= */

const lyricsCache = new Map();
const ongoingFetches = new Map();

/* =================================================================
   SERVICE WORKER INITIALIZATION & MESSAGE LISTENERS
   ================================================================= */

console.log('Service Worker is active.');

pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case MESSAGE_TYPES.FETCH_LYRICS:
            handleLyricsFetch(message.songInfo, sendResponse, message.forceReload);
            return true;

        case MESSAGE_TYPES.RESET_CACHE:
            handleResetCache(sendResponse);
            return true;

        case MESSAGE_TYPES.GET_CACHED_SIZE:
            handleGetCacheSize(sendResponse);
            return true;

        case MESSAGE_TYPES.TRANSLATE_LYRICS:
            handleTranslateLyrics(message, sendResponse);
            return true;

        case MESSAGE_TYPES.FETCH_SPONSOR_SEGMENTS:
            handleFetchSponsorSegments(message.videoId, sendResponse);
            return true;

        case MESSAGE_TYPES.UPLOAD_LOCAL_LYRICS:
            handleUploadLocalLyrics(message.songInfo, message.jsonLyrics, sendResponse);
            return true;

        case MESSAGE_TYPES.GET_LOCAL_LYRICS_LIST:
            handleGetLocalLyricsList(sendResponse);
            return true;

        case MESSAGE_TYPES.DELETE_LOCAL_LYRICS:
            handleDeleteLocalLyrics(message.songId, sendResponse);
            return true;

        case MESSAGE_TYPES.FETCH_LOCAL_LYRICS:
            handleFetchLocalLyrics(message.songId, sendResponse);
            return true;

        default:
            console.warn("Received unknown message type:", message.type);
            return false;
    }
});

/* =================================================================
   MESSAGE HANDLERS
   ================================================================= */

async function handleLyricsFetch(songInfo, sendResponse, forceReload) {
    try {
        const { lyrics } = await getOrFetchLyrics(songInfo, forceReload);
        sendResponse({ success: true, lyrics, metadata: songInfo });
    } catch (error) {
        console.error(`Failed to fetch lyrics for "${songInfo.title}":`, error);
        sendResponse({ success: false, error: error.message, metadata: songInfo });
    }
}

async function handleTranslateLyrics({ songInfo, action, targetLang, forceReload }, sendResponse) {
    try {
        const translatedLyrics = await getOrFetchTranslatedLyrics(songInfo, action, targetLang, forceReload);
        sendResponse({ success: true, translatedLyrics });
    } catch (error) {
        console.error("Error handling translation:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleFetchSponsorSegments(videoId, sendResponse) {
    try {
        const segments = await fetchSponsorSegments(videoId);
        sendResponse({ success: true, segments });
    } catch (error) {
        console.error(`Failed to fetch SponsorBlock segments for videoId "${videoId}":`, error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleResetCache(sendResponse) {
    try {
        lyricsCache.clear();
        ongoingFetches.clear();
        await clearCacheDB();
        await clearTranslationsDB();
        sendResponse({ success: true, message: "Cache reset successfully" });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetCacheSize(sendResponse) {
    try {
        const lyricsStats = await estimateDBSizeInKB(CACHE_DB_NAME, LYRICS_OBJECT_STORE);
        const translationsStats = await estimateDBSizeInKB(TRANSLATIONS_DB_NAME, TRANSLATIONS_OBJECT_STORE);
        const sizeKB = lyricsStats.sizeKB + translationsStats.sizeKB;
        const cacheCount = lyricsStats.count + translationsStats.count;
        sendResponse({ success: true, sizeKB, cacheCount });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleUploadLocalLyrics(songInfo, jsonLyrics, sendResponse) {
    try {
        const songId = `${songInfo.title}-${songInfo.artist}-${Date.now()}`; // Unique ID for local songs
        await saveLocalLyricsToDB(songId, songInfo, jsonLyrics);
        sendResponse({ success: true, message: "Local lyrics uploaded successfully.", songId });
    } catch (error) {
        console.error("Error uploading local lyrics:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetLocalLyricsList(sendResponse) {
    try {
        const lyricsList = await getLocalLyricsListFromDB();
        sendResponse({ success: true, lyricsList });
    } catch (error) {
        console.error("Error getting local lyrics list:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleDeleteLocalLyrics(songId, sendResponse) {
    try {
        await deleteLocalLyricsFromDB(songId);
        sendResponse({ success: true, message: "Local lyrics deleted successfully." });
    } catch (error) {
        console.error("Error deleting local lyrics:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleFetchLocalLyrics(songId, sendResponse) {
    try {
        const localLyrics = await getLocalLyricsFromDB(songId);
        if (localLyrics) {
            sendResponse({ success: true, lyrics: localLyrics.lyrics, metadata: localLyrics.songInfo });
        } else {
            sendResponse({ success: false, error: "Local lyrics not found." });
        }
    } catch (error) {
        console.error("Error fetching local lyrics:", error);
        sendResponse({ success: false, error: error.message });
    }
}

/* =================================================================
   CORE LYRICS & TRANSLATION LOGIC
   ================================================================= */

async function getOrFetchLyrics(songInfo, forceReload = false) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;

    if (!forceReload) {
        if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

        const dbCacheRecord = await getLyricsFromDB(cacheKey);
        if (dbCacheRecord) {
            const result = { lyrics: dbCacheRecord.lyrics, version: dbCacheRecord.version };
            lyricsCache.set(cacheKey, result);
            return result;
        }

        const localLyricsList = await getLocalLyricsListFromDB();
        const matchedLocalSong = localLyricsList.find(item =>
            item.songInfo.title === songInfo.title && item.songInfo.artist === songInfo.artist
        );
        if (matchedLocalSong) {
            const fetchedLocalLyrics = await getLocalLyricsFromDB(matchedLocalSong.songId);
            if (fetchedLocalLyrics) {
                console.log(`Found and returning local lyrics for "${songInfo.title}"`);
                const lyrics = parseKPoeFormat(fetchedLocalLyrics.lyrics);
                const version = fetchedLocalLyrics.timestamp || matchedLocalSong.songId;
                const result = { lyrics, version };
                lyricsCache.set(cacheKey, result);
                return result;
            }
        }
    }

    if (ongoingFetches.has(cacheKey)) {
        return ongoingFetches.get(cacheKey);
    }

    const fetchPromise = (async () => {
        try {
            const settings = await storageLocalGet({
                'lyricsProvider': PROVIDERS.KPOE,
                'lyricsSourceOrder': 'apple,lyricsplus,musixmatch,spotify,musixmatch-word',
                'customKpoeUrl': '',
                'cacheStrategy': CACHE_STRATEGIES.AGGRESSIVE
            });

            const fetchOptions = settings.cacheStrategy === CACHE_STRATEGIES.NONE ? { cache: 'no-store' } : {};

            const providersInOrder = [
                settings.lyricsProvider,
                ...Object.values(PROVIDERS).filter(p => p !== settings.lyricsProvider && p !== PROVIDERS.GOOGLE && p !== PROVIDERS.GEMINI)
            ];

            let lyrics = null;
            for (const provider of providersInOrder) {
                switch (provider) {
                    case PROVIDERS.KPOE:
                        lyrics = await fetchKPoeLyrics(songInfo, settings.lyricsSourceOrder, forceReload, fetchOptions);
                        break;
                    case PROVIDERS.CUSTOM_KPOE:
                        if (settings.customKpoeUrl) {
                            lyrics = await fetchCustomKPoeLyrics(songInfo, settings.customKpoeUrl, settings.lyricsSourceOrder, forceReload, fetchOptions);
                        }
                        break;
                    case PROVIDERS.LRCLIB:
                        lyrics = await fetchLRCLibLyrics(songInfo, fetchOptions);
                        break;
                    case PROVIDERS.LOCAL:
                        const localLyricsList = await getLocalLyricsListFromDB();
                        const matchedLocalSong = localLyricsList.find(item =>
                            item.songInfo.title === songInfo.title && item.songInfo.artist === songInfo.artist
                        );
                        if (matchedLocalSong) {
                            const fetchedLocalLyrics = await getLocalLyricsFromDB(matchedLocalSong.songId);
                            if (fetchedLocalLyrics) {
                                lyrics = fetchedLocalLyrics.lyrics;
                            }
                        }
                        break;
                }
                if (!isEmptyLyrics(lyrics)) break;
            }

            if (isEmptyLyrics(lyrics) && songInfo.videoId && songInfo.subtitle) {
                lyrics = await fetchYouTubeSubtitles(songInfo);
            }

            if (isEmptyLyrics(lyrics)) {
                throw new Error('No lyrics found from any provider.');
            }

            const version = Date.now();
            const result = { lyrics, version };

            lyricsCache.set(cacheKey, result);
            await saveLyricsToDB(cacheKey, lyrics, version);
            return result;

        } finally {
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
}

async function getOrFetchTranslatedLyrics(songInfo, action, targetLang, forceReload = false) {
    const originalLyricsCacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;
    const translatedLyricsCacheKey = `${originalLyricsCacheKey} - ${action} - ${targetLang}`;

    const { lyrics: originalLyrics, version: originalLyricsVersion } = await getOrFetchLyrics(songInfo, forceReload);
    if (isEmptyLyrics(originalLyrics)) {
        throw new Error('Original lyrics not found or empty, cannot perform translation/romanization.');
    }

    if (!forceReload) {
        if (lyricsCache.has(translatedLyricsCacheKey)) {
            const cached = lyricsCache.get(translatedLyricsCacheKey);
            if (cached.originalVersion === originalLyricsVersion) {
                return cached.translatedLyrics;
            }
        }
        const dbCached = await getTranslationFromDB(translatedLyricsCacheKey);
        if (dbCached && dbCached.originalVersion === originalLyricsVersion) {
            const resultForMemoryCache = { translatedLyrics: dbCached.translatedLyrics, originalVersion: dbCached.originalVersion };
            lyricsCache.set(translatedLyricsCacheKey, resultForMemoryCache);
            return dbCached.translatedLyrics;
        } else if (dbCached) {
            await deleteTranslationFromDB(translatedLyricsCacheKey);
        }
    }

    const settings = await storageLocalGet({
        'translationProvider': PROVIDERS.GOOGLE,
        'romanizationProvider': PROVIDERS.GOOGLE,
        'geminiApiKey': '',
        'geminiModel': 'gemini-pro',
        'geminiRomanizationModel': 'gemini-pro',
        'overrideTranslateTarget': false,
        'customTranslateTarget': '',
        'overrideGeminiPrompt': false,
        'customGeminiPrompt': '',
        'overrideGeminiRomanizePrompt': false,
        'customGeminiRomanizePrompt': '',
    });

    let translatedData;
    const actualTargetLang = settings.overrideTranslateTarget && settings.customTranslateTarget ? settings.customTranslateTarget : targetLang;

    if (action === 'translate') {
        const provider = settings.translationProvider === PROVIDERS.GEMINI && settings.geminiApiKey ? PROVIDERS.GEMINI : PROVIDERS.GOOGLE;
        if (provider === PROVIDERS.GEMINI) {
            const textsToTranslate = originalLyrics.data.map(line => line.text);
            const translatedTexts = await fetchGeminiTranslate(textsToTranslate, actualTargetLang, settings);
            translatedData = originalLyrics.data.map((line, index) => ({ ...line, translatedText: translatedTexts[index] || line.text }));
        } else {
            const translationPromises = originalLyrics.data.map(line => fetchGoogleTranslate(line.text, actualTargetLang));
            const translatedTexts = await Promise.all(translationPromises);
            translatedData = originalLyrics.data.map((line, index) => ({ ...line, translatedText: translatedTexts[index] || line.text }));
        }
    } else if (action === 'romanize') {
        const hasPrebuiltRomanization = originalLyrics.data.some(line =>
            line.romanizedText || (line.syllabus && line.syllabus.some(syl => syl.romanizedText))
        );

        if (hasPrebuiltRomanization) {
            console.log("Using prebuilt romanization from backend.");
            translatedData = originalLyrics.data;
        } else {
            const provider = settings.romanizationProvider === PROVIDERS.GEMINI && settings.geminiApiKey ? PROVIDERS.GEMINI : PROVIDERS.GOOGLE;
            translatedData = await (provider === PROVIDERS.GEMINI ? romanizeWithGemini(originalLyrics, settings) : romanizeWithGoogle(originalLyrics));
        }
    } else {
        translatedData = originalLyrics.data;
    }

    const finalTranslatedLyrics = { ...originalLyrics, data: translatedData };

    const resultForMemoryCache = { translatedLyrics: finalTranslatedLyrics, originalVersion: originalLyricsVersion };
    lyricsCache.set(translatedLyricsCacheKey, resultForMemoryCache);
    await saveTranslationToDB(translatedLyricsCacheKey, finalTranslatedLyrics, originalLyricsVersion);

    return finalTranslatedLyrics;
}

/* =================================================================
   INDEXEDDB CACHE MANAGEMENT
   ================================================================= */

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(LYRICS_OBJECT_STORE)) {
                db.createObjectStore(LYRICS_OBJECT_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

function openTranslationsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(TRANSLATIONS_DB_NAME, TRANSLATIONS_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(TRANSLATIONS_OBJECT_STORE)) {
                db.createObjectStore(TRANSLATIONS_OBJECT_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

function openLocalLyricsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCAL_LYRICS_DB_NAME, LOCAL_LYRICS_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(LOCAL_LYRICS_OBJECT_STORE)) {
                db.createObjectStore(LOCAL_LYRICS_OBJECT_STORE, { keyPath: "songId" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function saveLocalLyricsToDB(songId, songInfo, lyrics) {
    const db = await openLocalLyricsDB();
    const transaction = db.transaction([LOCAL_LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LOCAL_LYRICS_OBJECT_STORE);
    store.put({ songId, songInfo, lyrics, timestamp: Date.now() });
}

async function getLocalLyricsFromDB(songId) {
    const db = await openLocalLyricsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LOCAL_LYRICS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(LOCAL_LYRICS_OBJECT_STORE);
        const request = store.get(songId);
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function getLocalLyricsListFromDB() {
    const db = await openLocalLyricsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LOCAL_LYRICS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(LOCAL_LYRICS_OBJECT_STORE);
        const request = store.getAll();
        request.onsuccess = event => resolve(event.target.result.map(item => ({
            songId: item.songId,
            songInfo: item.songInfo,
            timestamp: item.timestamp
        })));
        request.onerror = event => reject(event.target.error);
    });
}

async function deleteLocalLyricsFromDB(songId) {
    const db = await openLocalLyricsDB();
    const transaction = db.transaction([LOCAL_LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LOCAL_LYRICS_OBJECT_STORE);
    store.delete(songId);
}

async function getLyricsFromDB(key) {
    const db = await openDB();
    const { cacheStrategy = CACHE_STRATEGIES.AGGRESSIVE } = await storageLocalGet('cacheStrategy');

    if (cacheStrategy === CACHE_STRATEGIES.NONE) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
        const store = transaction.objectStore(LYRICS_OBJECT_STORE);
        const request = store.get(key);

        request.onsuccess = event => {
            const result = event.target.result;
            if (result) {
                const now = Date.now();
                const expirationTimes = {
                    [CACHE_STRATEGIES.AGGRESSIVE]: 2 * 60 * 60 * 1000,
                    [CACHE_STRATEGIES.MODERATE]: 1 * 60 * 60 * 1000,
                };
                const expirationTime = expirationTimes[cacheStrategy];
                const age = now - result.timestamp;

                if (age < expirationTime) {
                    resolve(result);
                } else {
                    store.delete(key);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        };
        request.onerror = event => reject(event.target.error);
    });
}

async function saveLyricsToDB(key, lyrics, version) {
    const { cacheStrategy = CACHE_STRATEGIES.AGGRESSIVE } = await storageLocalGet('cacheStrategy');
    if (cacheStrategy === CACHE_STRATEGIES.NONE) {
        return;
    }
    const db = await openDB();
    const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LYRICS_OBJECT_STORE);
    store.put({ key, lyrics, version, timestamp: Date.now() });
}

async function getTranslationFromDB(key) {
    const db = await openTranslationsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([TRANSLATIONS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(TRANSLATIONS_OBJECT_STORE);
        const request = store.get(key);
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function saveTranslationToDB(key, translatedLyrics, originalVersion) {
    const db = await openTranslationsDB();
    const transaction = db.transaction([TRANSLATIONS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(TRANSLATIONS_OBJECT_STORE);
    store.put({ key, translatedLyrics, originalVersion });
}

async function deleteTranslationFromDB(key) {
    const db = await openTranslationsDB();
    const transaction = db.transaction([TRANSLATIONS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(TRANSLATIONS_OBJECT_STORE);
    store.delete(key);
}

async function clearCacheDB() {
    const db = await openDB();
    const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LYRICS_OBJECT_STORE);
    store.clear();
}

async function clearTranslationsDB() {
    const db = await openTranslationsDB();
    const transaction = db.transaction([TRANSLATIONS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(TRANSLATIONS_OBJECT_STORE);
    store.clear();
}

async function estimateDBSizeInKB(dbName, storeName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve({ sizeKB: 0, count: 0 });
                return;
            }
            const transaction = db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const getAllRequest = store.getAll();
            const countRequest = store.count();

            let sizeKB = 0;
            let count = 0;
            let completed = 0;

            const checkCompletion = () => {
                if (++completed === 2) {
                    db.close();
                    resolve({ sizeKB, count });
                }
            };

            getAllRequest.onsuccess = event => {
                const totalSizeBytes = event.target.result.reduce((acc, record) => {
                    return acc + new TextEncoder().encode(JSON.stringify(record)).length;
                }, 0);
                sizeKB = totalSizeBytes / 1024;
                checkCompletion();
            };
            getAllRequest.onerror = event => reject(event.target.error);

            countRequest.onsuccess = () => {
                count = countRequest.result;
                checkCompletion();
            };
            countRequest.onerror = () => reject(countRequest.error);
        };
        request.onerror = event => {
            if (event.target.error.name === 'InvalidStateError' || event.target.error.name === 'NotFoundError') {
                resolve({ sizeKB: 0, count: 0 });
            } else {
                reject(event.target.error);
            }
        };
    });
}

/* =================================================================
   EXTERNAL API PROVIDERS - LYRICS & SUBTITLES
   ================================================================= */

async function fetchKPoeLyrics(songInfo, sourceOrder, forceReload, fetchOptions) {
    for (const baseUrl of KPOE_SERVERS) {
        const lyrics = await fetchFromKPoeAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions);
        if (lyrics) return lyrics;
    }
    return null;
}

async function fetchCustomKPoeLyrics(songInfo, customUrl, sourceOrder, forceReload, fetchOptions) {
    if (!customUrl) return null;
    return fetchFromKPoeAPI(customUrl, songInfo, sourceOrder, forceReload, fetchOptions);
}

async function fetchFromKPoeAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions) {
    const { title, artist, album, duration } = songInfo;
    const params = new URLSearchParams({ title, artist, duration });
    if (album) params.append('album', album);
    if (sourceOrder) params.append('source', sourceOrder);
    if (forceReload) params.append('forceReload', 'true');

    const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}v2/lyrics/get?${params.toString()}`;

    try {
        const response = await fetch(url, forceReload ? { cache: 'no-store' } : fetchOptions);
        if (response.ok) {
            const data = await response.json();
            return parseKPoeFormat(data);
        }
        if (response.status == 404 || response.status == 403) {
            return null;
        }
        console.warn(`Failed to fetch from ${baseUrl} (${response.status}): ${response.statusText}`);
        return null;
    } catch (error) {
        console.error(`Network error fetching from ${baseUrl}:`, error);
        return null;
    }
}

async function fetchLRCLibLyrics(songInfo, fetchOptions = {}) {
    const params = new URLSearchParams({ artist_name: songInfo.artist, track_name: songInfo.title });
    if (songInfo.album) params.append('album_name', songInfo.album);

    const url = `https://lrclib.net/api/get?${params.toString()}`;

    try {
        const response = await fetch(url, fetchOptions);
        if (!response.ok) return null;
        const data = await response.json();
        return parseLRCLibFormat(data);
    } catch (error) {
        console.error("Error fetching from LRCLIB:", error);
        return null;
    }
}

async function fetchYouTubeSubtitles(songInfo) {
    try {
        const subtitleInfo = songInfo.subtitle;
        if (!subtitleInfo?.captionTracks?.length) return null;

        const validTracks = subtitleInfo.captionTracks.filter(t => t.kind !== 'asr' && !t.vssId?.startsWith('a.'));
        const selectedTrack = validTracks.find(t => t.isDefault) || validTracks[0];

        if (!selectedTrack) return null;

        const url = new URL(selectedTrack.baseUrl || selectedTrack.url);
        url.searchParams.set('fmt', 'json3');

        const response = await fetch(url.toString());
        if (!response.ok) return null;

        const data = await response.json();
        return parseYouTubeSubtitles(data, songInfo);
    } catch (error) {
        console.error("Error fetching YouTube subtitles:", error);
        return null;
    }
}

/* =================================================================
   EXTERNAL API PROVIDERS - TRANSLATION & ROMANIZATION
   ================================================================= */

async function romanizeWithGoogle(originalLyrics) {
    if (originalLyrics.type === "Word") {
        return Promise.all(originalLyrics.data.map(async (line) => {
            if (!line.syllabus?.length) return line;
            const syllableTexts = line.syllabus.map(s => s.text);
            const romanizedSyllableTexts = await fetchGoogleRomanize(syllableTexts);
            const newSyllabus = line.syllabus.map((s, index) => ({
                ...s,
                romanizedText: `${romanizedSyllableTexts[index]} ` || s.text
            }));
            return { ...line, syllabus: newSyllabus };
        }));
    } else {
        const linesToRomanize = originalLyrics.data.map(line => line.text);
        const romanizedLines = await fetchGoogleRomanize(linesToRomanize);
        return originalLyrics.data.map((line, index) => ({
            ...line,
            romanizedText: romanizedLines[index] || line.text
        }));
    }
}

async function romanizeWithGemini(originalLyrics, settings) {
    if (!settings.geminiApiKey) throw new Error('Gemini API Key is not provided.');

    const structuredInput = originalLyrics.data.map((line, index) => {
        const lineObject = { original_line_index: index, text: line.text };
        if (line.syllabus?.length) {
            lineObject.chunk = line.syllabus.map((s, sylIndex) => ({
                text: s.text,
                chunkIndex: sylIndex
            }));
        }
        return lineObject;
    });

    const romanizedResult = await fetchGeminiRomanize(structuredInput, settings);

    return originalLyrics.data.map((originalLine, index) => {
        const romanizedLine = romanizedResult[index];

        if (!romanizedLine) {
            console.warn(`No romanized data returned for line index ${index}.`);
            return originalLine;
        }

        const newSyllabus = romanizedLine.chunk ? romanizedLine.chunk.map((chunk, chunkIndex) => {
            const originalSyllable = originalLine.syllabus?.[chunkIndex] || {};
            const romanizedSyllableText = chunk.text || originalSyllable.text || '';
            return {
                ...originalSyllable,
                text: originalSyllable.text,
                romanizedText: romanizedSyllableText
            };
        }) : undefined;

        return {
            ...originalLine,
            romanizedText: romanizedLine.text || originalLine.text,
            syllabus: newSyllabus,
        };
    });
}

async function fetchGeminiTranslate(texts, targetLang, settings) {
    const { geminiApiKey, geminiModel } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

    const prompt = createTranslationPrompt(settings, texts, targetLang);

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generation_config: {
            temperature: 0.0,
            response_mime_type: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    translated_lyrics: {
                        type: "ARRAY",
                        description: "An array of translated lyric lines, maintaining the original order and count.",
                        items: { type: "STRING" }
                    },
                    target_language: {
                        type: "STRING",
                        description: "The target language for the translation."
                    }
                },
                required: ["translated_lyrics", "target_language"]
            }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`Gemini API error: ${response.status} - ${errorData.error.message}`);
    }

    const data = await response.json();

    if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini translation blocked: ${data.promptFeedback.blockReason}`);
    }

    try {
        const parsedJson = JSON.parse(data.candidates[0].content.parts[0].text);
        
        if (!Array.isArray(parsedJson.translated_lyrics)) {
            throw new Error('Invalid JSON structure: translated_lyrics is not an array.');
        }
        
        if (parsedJson.translated_lyrics.length !== texts.length) {
            throw new Error(`Length mismatch: expected ${texts.length} lines, got ${parsedJson.translated_lyrics.length}`);
        }
        
        return parsedJson.translated_lyrics;
    } catch (e) {
        console.error("Gemini response parsing failed:", e, "\nRaw response:", data.candidates[0].content.parts[0].text);
        throw new Error(`Gemini translation failed: Could not parse valid JSON. ${e.message}`);
    }
}

async function fetchGoogleTranslate(text, targetLang) {
    if (!text.trim()) return "";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Translate API error: ${response.statusText}`);
    const data = await response.json();
    return data?.[0]?.map(segment => segment?.[0]).join('') || text;
}

async function fetchGoogleRomanize(texts) {
    const contextText = texts.join(' ');
    if (isPurelyLatinScript(contextText)) return texts;

    let sourceLang = 'auto';
    try {
        const detectUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(contextText)}`;
        const detectResponse = await fetch(detectUrl);
        if (detectResponse.ok) {
            const detectData = await detectResponse.json();
            sourceLang = detectData[2] || 'auto';
        }
    } catch (e) {
        console.error("Language detection for romanization failed, falling back to 'auto'.", e);
    }

    const romanizedTexts = [];
    for (const text of texts) {
        if (isPurelyLatinScript(text)) {
            romanizedTexts.push(text);
            continue;
        }
        try {
            const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&hl=en&dt=rm&q=${encodeURIComponent(text)}`;
            const romanizeResponse = await fetch(romanizeUrl);
            const romanizeData = await romanizeResponse.json();
            romanizedTexts.push(romanizeData?.[0]?.[0]?.[3] || text);
        } catch (error) {
            console.error(`Error romanizing text "${text}":`, error);
            romanizedTexts.push(text);
        }
    }
    return romanizedTexts;
}


/* =================================================================
   EXTERNAL API PROVIDERS - SPONSORBLOCK
   ================================================================= */

async function fetchSponsorSegments(videoId) {
    const SPONSORBLOCK_API = "https://sponsor.ajay.app/api/skipSegments";
    const categories = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler", "music_offtopic"];
    const url = `${SPONSORBLOCK_API}?videoID=${videoId}&categories=[${categories.map(c => `"${c}"`).join(',')}]`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.log(`SponsorBlock segments not found for videoId: ${videoId}`);
                return [];
            }
            throw new Error(`SponsorBlock API error: ${response.statusText}`);
        }
        const segments = await response.json();
        return segments;
    } catch (error) {
        console.error("Error fetching SponsorBlock segments:", error);
        return [];
    }
}

/* =================================================================
   GEMINI ROMANIZATION - PREPARATION, VALIDATION & HELPERS
   ================================================================= */

function prepareLyricsForGemini(structuredInput) {
    const lyricsForApi = [];
    const reconstructionPlan = [];
    const contentToApiIndexMap = new Map();

    structuredInput.forEach((line, originalIndex) => {
        if (isPurelyLatinScript(line.text)) {
            reconstructionPlan.push({ type: 'latin', data: line, originalIndex });
            return;
        }

        const contentKey = JSON.stringify({ text: line.text, chunk: line.chunk });
        if (contentToApiIndexMap.has(contentKey)) {
            reconstructionPlan.push({ type: 'api', apiIndex: contentToApiIndexMap.get(contentKey), originalIndex });
        } else {
            const newApiIndex = lyricsForApi.length;
            // Only include chunk if it exists and has content
            const apiLine = { text: line.text, original_line_index: newApiIndex };
            if (line.chunk && line.chunk.length > 0) {
                apiLine.chunk = line.chunk;
            }
            lyricsForApi.push(apiLine);
            contentToApiIndexMap.set(contentKey, newApiIndex);
            reconstructionPlan.push({ type: 'api', apiIndex: newApiIndex, originalIndex });
        }
    });

    return { lyricsForApi, reconstructionPlan };
}

function reconstructRomanizedLyrics(romanizedApiLyrics, reconstructionPlan, hasAnyChunks = false) {
    const fullList = [];
    reconstructionPlan.forEach(planItem => {
        let reconstructedLine;
        if (planItem.type === 'latin') {
            reconstructedLine = {
                ...planItem.data,
                text: planItem.data.text,
                chunk: hasAnyChunks && planItem.data.chunk ? planItem.data.chunk.map(c => ({ ...c, text: c.text })) : undefined,
                original_line_index: planItem.originalIndex,
            };
        } else {
            const apiResult = romanizedApiLyrics[planItem.apiIndex];
            reconstructedLine = {
                ...apiResult,
                original_line_index: planItem.originalIndex,
            };
        }
        fullList[planItem.originalIndex] = reconstructedLine;
    });
    return fullList;
}

async function fetchGeminiRomanize(structuredInput, settings) {
    const { geminiApiKey, geminiRomanizationModel, overrideGeminiRomanizePrompt, customGeminiRomanizePrompt } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiRomanizationModel}:generateContent?key=${geminiApiKey}`;

    const { lyricsForApi, reconstructionPlan } = prepareLyricsForGemini(structuredInput);

    // Check if any lines have chunks to determine schema type
    const hasAnyChunks = lyricsForApi.some(line => line.chunk && line.chunk.length > 0);

    if (lyricsForApi.length === 0) {
        return reconstructRomanizedLyrics([], reconstructionPlan, hasAnyChunks);
    }

    const initialUserPrompt = (overrideGeminiRomanizePrompt && customGeminiRomanizePrompt) ?
        customGeminiRomanizePrompt :
        createRomanizationPrompt(lyricsForApi, hasAnyChunks);

    const schema = createRomanizationSchema(hasAnyChunks);
    const selectiveSchema = createSelectiveRomanizationSchema(hasAnyChunks);

    let currentContents = [{ role: 'user', parts: [{ text: initialUserPrompt }] }];
    let lastValidResponse = null;
    const MAX_RETRIES = 5;
    let sameErrorCount = 0;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let responseText;
        const isSelectiveFix = attempt > 1 && lastValidResponse !== null && sameErrorCount < 3;

        try {
            const requestBody = {
                contents: currentContents,
                generation_config: {
                    temperature: 0.0,
                    response_mime_type: "application/json",
                    responseSchema: isSelectiveFix ? selectiveSchema : schema
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new Error(`Gemini API call failed with status ${response.status}: ${errorData.error.message}`);
            }

            const data = await response.json();

            if (data.promptFeedback?.blockReason) {
                throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
            }

            responseText = data.candidates[0].content.parts[0].text;

        } catch (e) {
            console.error(`Gemini romanization failed on attempt ${attempt}: ${e.message}`);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts: ${e.message}`);
            }
            continue;
        }

        let parsedJson;
        try {
            parsedJson = JSON.parse(responseText);
        } catch (e) {
            console.error(`Attempt ${attempt}: Failed to parse JSON response from Gemini: ${e.message}. Raw response: ${responseText}`);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts: Could not parse valid JSON.`);
            }
            currentContents.push({ role: 'model', parts: [{ text: responseText }] });
            currentContents.push({ role: 'user', parts: [{ text: `Your previous response was not valid JSON. Please provide a corrected JSON response. Error: ${e.message}` }] });
            continue;
        }

        let finalResponse;

        if (isSelectiveFix && parsedJson.fixed_lines) {
            finalResponse = mergeSelectiveFixes(lastValidResponse, parsedJson.fixed_lines);
        } else {
            finalResponse = parsedJson;
            if (attempt === 1) {
                lastValidResponse = parsedJson;
            }
        }

        const validationResult = validateRomanizationResponse(lyricsForApi, finalResponse);

        if (validationResult.isValid) {
            console.log(`Gemini romanization succeeded on attempt ${attempt}.`);
            return reconstructRomanizedLyrics(finalResponse.romanized_lyrics, reconstructionPlan, hasAnyChunks);
        } else {
            console.warn(`Attempt ${attempt} failed validation. Errors: ${validationResult.errors.join(', ')}`);

            // Check if same error is repeating
            const currentError = validationResult.errors[0];
            if (currentError === lastError) {
                sameErrorCount++;
            } else {
                sameErrorCount = 1;
                lastError = currentError;
            }

            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts. Final validation errors: ${validationResult.errors.join(', ')}`);
            }

            // If same error repeating, start fresh conversation
            if (sameErrorCount >= 3) {
                console.log("Same error repeating, starting fresh conversation");
                currentContents = [{ role: 'user', parts: [{ text: initialUserPrompt }] }];
                sameErrorCount = 0;
                lastValidResponse = null;
                continue;
            }

            const problematicLines = getProblematicLines(lyricsForApi, finalResponse, validationResult.detailedErrors);

            currentContents.push({ role: 'model', parts: [{ text: responseText }] });

            if (problematicLines.length > 0 && problematicLines.length < lyricsForApi.length * 0.8) {
                const selectivePrompt = createSelectiveFixPrompt(problematicLines, validationResult, hasAnyChunks);
                currentContents.push({ role: 'user', parts: [{ text: selectivePrompt }] });
            } else {
                const fullPrompt = createFullRetryPrompt(validationResult, lyricsForApi, hasAnyChunks);
                currentContents.push({ role: 'user', parts: [{ text: fullPrompt }] });
            }
        }
    }

    throw new Error("Unexpected error: Gemini romanization process completed without success or explicit failure.");
}


function createRomanizationSchema(hasAnyChunks) {
    const baseSchema = {
        type: "OBJECT",
        properties: {
            romanized_lyrics: {
                type: "ARRAY",
                description: "An array of romanized lyric line objects, matching the input array's order and length.",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: { type: "STRING", description: "The fully romanized text of the entire line." },
                        original_line_index: { type: "INTEGER", description: "The original index of the line from the input, which must be preserved." }
                    },
                    required: ["text", "original_line_index"]
                }
            }
        },
        required: ["romanized_lyrics"]
    };

    if (hasAnyChunks) {
        baseSchema.properties.romanized_lyrics.items.properties.chunk = {
            type: "ARRAY",
            nullable: true,
            description: "ONLY include if the original line had chunks. Otherwise omit entirely.",
            items: {
                type: "OBJECT",
                properties: {
                    text: { type: "STRING", description: "The text of a single romanized chunk. MUST NOT be empty." },
                    chunkIndex: { type: "INTEGER", description: "The original index of the chunk, which must be preserved." }
                },
                required: ["text", "chunkIndex"]
            }
        };
    }

    return baseSchema;
}

function createSelectiveRomanizationSchema(hasAnyChunks) {
    const baseSchema = {
        type: "OBJECT",
        properties: {
            fixed_lines: {
                type: "ARRAY",
                description: "An array of corrected romanized lyric line objects for only the problematic lines.",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: { type: "STRING", description: "The fully romanized text of the entire line." },
                        original_line_index: { type: "INTEGER", description: "The original index of the line from the input, which must be preserved." }
                    },
                    required: ["text", "original_line_index"]
                }
            }
        },
        required: ["fixed_lines"]
    };

    if (hasAnyChunks) {
        baseSchema.properties.fixed_lines.items.properties.chunk = {
            type: "ARRAY",
            nullable: true,
            description: "ONLY include if the original line had chunks. Otherwise omit entirely.",
            items: {
                type: "OBJECT",
                properties: {
                    text: { type: "STRING", description: "The text of a single romanized chunk. MUST NOT be empty." },
                    chunkIndex: { type: "INTEGER", description: "The original index of the chunk, which must be preserved." }
                },
                required: ["text", "chunkIndex"]
            }
        };
    }

    return baseSchema;
}

function createSelectiveFixPrompt(problematicLines, validationResult, hasAnyChunks) {
    return `CRITICAL ERROR CORRECTION NEEDED: Your previous response had structural errors.

**MOST CRITICAL RULE**: ${hasAnyChunks ?
            'Only add chunk arrays to lines that originally had them. Do not add chunks to line-only lyrics.' :
            'These are LINE-SYNCED lyrics only. DO NOT add any chunk arrays to any lines.'
        }

**SPECIFIC LINES THAT NEED FIXING:**
${JSON.stringify(problematicLines.map(line => ({
            original_line_index: line.original_line_index,
            original_text: line.text,
            had_chunks: !!(line.chunk && line.chunk.length > 0),
            errors: validationResult.detailedErrors.find(e => e.lineIndex === line.original_line_index)?.errors || []
        })), null, 2)}

PROVIDE ONLY THE CORRECTED LINES in the proper format.`;
}

function createFullRetryPrompt(validationResult, lyricsForApi, hasAnyChunks) {
    return `CRITICAL STRUCTURAL ERRORS DETECTED: Your previous response had major structural issues.

**MOST SERIOUS ERROR**: ${hasAnyChunks ?
            'You are adding chunk arrays to lines that should not have them. Only lines that originally had chunks should have chunk arrays in the output.' :
            'You are adding chunk arrays when these lyrics are LINE-SYNCED only. DO NOT add any chunk arrays.'
        }

**Original lyrics structure for reference:**
${JSON.stringify(lyricsForApi, null, 2)}

PROVIDE A COMPLETE CORRECTED RESPONSE respecting the original structure.`;
}

function getProblematicLines(originalLyricsForApi, response, detailedErrors = []) {
    const problematicLines = [];
    const problematicIndices = new Set();

    if (detailedErrors && detailedErrors.length > 0) {
        detailedErrors.forEach(error => {
            if (error.lineIndex !== undefined) {
                problematicIndices.add(error.lineIndex);
            }
        });
    }

    if (response.romanized_lyrics) {
        response.romanized_lyrics.forEach((line, index) => {
            const originalLine = originalLyricsForApi[index];
            if (!originalLine) return;

            let hasIssue = false;
            const issues = [];

            // Check for unwanted chunk arrays
            const originalHasChunks = Array.isArray(originalLine.chunk) && originalLine.chunk.length > 0;

            if (originalHasChunks && Array.isArray(line.chunk) && line.chunk.length > 0) {
                const emptyChunks = line.chunk.filter(chunk => !chunk.text || chunk.text.trim() === '');
                if (emptyChunks.length > 0) {
                    hasIssue = true;
                    issues.push(`${emptyChunks.length} empty chunk(s) detected`);
                    console.log(`Line ${index}: Empty chunks detected:`, line.chunk.map(c => `"${c.text}"`));
                }

                const nonEmptyChunks = line.chunk.filter(chunk => chunk.text && chunk.text.trim() !== '');
                if (nonEmptyChunks.length === 1 && line.chunk.length > 1) {
                    hasIssue = true;
                    issues.push('text concentrated in single chunk');
                    console.log(`Line ${index}: Uneven distribution:`, line.chunk.map(c => `"${c.text}"`));
                }

                if (originalLine.chunk && originalLine.chunk.length !== line.chunk.length) {
                    hasIssue = true;
                    issues.push(`chunk count mismatch (expected ${originalLine.chunk.length}, got ${line.chunk.length})`);
                }
            }

            if (line.original_line_index !== index) {
                hasIssue = true;
                issues.push(`incorrect line index`);
            }

            if (typeof line.text !== 'string') {
                hasIssue = true;
                issues.push('missing or invalid text field');
            }

            if (hasIssue) {
                problematicIndices.add(index);
                console.log(`Line ${index} flagged as problematic: ${issues.join(', ')}`);
            }
        });
    }

    problematicIndices.forEach(index => {
        if (originalLyricsForApi[index]) {
            problematicLines.push({
                ...originalLyricsForApi[index],
                original_line_index: index
            });
        }
    });

    console.log(`Found ${problematicLines.length} problematic lines out of ${originalLyricsForApi.length} total lines`);
    return problematicLines;
}

function mergeSelectiveFixes(lastValidResponse, fixedLines) {
    if (!lastValidResponse || !lastValidResponse.romanized_lyrics) {
        console.warn('No valid previous response to merge with, using fixed lines as base');
        return { romanized_lyrics: fixedLines };
    }

    const mergedResponse = JSON.parse(JSON.stringify(lastValidResponse));

    console.log(`Merging ${fixedLines.length} selective fixes into previous response`);

    fixedLines.forEach(fixedLine => {
        const index = fixedLine.original_line_index;
        if (mergedResponse.romanized_lyrics &&
            mergedResponse.romanized_lyrics[index] &&
            index >= 0 &&
            index < mergedResponse.romanized_lyrics.length) {

            console.log(`Applying fix for line ${index}`);
            mergedResponse.romanized_lyrics[index] = fixedLine;
        } else {
            console.warn(`Could not apply fix for line ${index}: index out of bounds or invalid structure`);
        }
    });

    return mergedResponse;
}

function validateRomanizationResponse(originalLyricsForApi, geminiResponse) {
    const errors = [];
    const detailedErrors = [];

    if (!geminiResponse || !Array.isArray(geminiResponse.romanized_lyrics)) {
        errors.push("The top-level 'romanized_lyrics' key is missing or not an array.");
        return { isValid: false, errors, detailedErrors };
    }

    if (geminiResponse.romanized_lyrics.length !== originalLyricsForApi.length) {
        errors.push(`The number of lines in the response (${geminiResponse.romanized_lyrics.length}) does not match the request (${originalLyricsForApi.length}).`);
        return { isValid: false, errors, detailedErrors };
    }

    geminiResponse.romanized_lyrics.forEach((romanizedLine, index) => {
        const originalLine = originalLyricsForApi[index];
        const lineErrors = [];

        if (romanizedLine.original_line_index !== index) {
            const error = `Line ${index}: 'original_line_index' is incorrect. Expected ${index}, got ${romanizedLine.original_line_index}.`;
            errors.push(error);
            lineErrors.push(error);
        }

        if (typeof romanizedLine.text !== 'string') {
            const error = `Line ${index}: The required 'text' field is missing or not a string.`;
            errors.push(error);
            lineErrors.push(error);
        }

        const originalHasChunks = Array.isArray(originalLine.chunk) && originalLine.chunk.length > 0;
        const romanizedHasChunks = Array.isArray(romanizedLine.chunk);

        // Key fix: Check for unwanted chunk arrays
        if (!originalHasChunks && romanizedHasChunks) {
            const error = `Line ${index}: A 'chunk' array was provided, but the original did not have one.`;
            errors.push(error);
            lineErrors.push(error);
        } else if (originalHasChunks) {
            if (!romanizedHasChunks) {
                const error = `Line ${index}: A 'chunk' array was expected but is missing.`;
                errors.push(error);
                lineErrors.push(error);
            } else if (romanizedLine.chunk.length !== originalLine.chunk.length) {
                const error = `Line ${index}: Chunk count mismatch. Original had ${originalLine.chunk.length}, response has ${romanizedLine.chunk.length}.`;
                errors.push(error);
                lineErrors.push(error);
            } else {
                const chunkValidationResult = validateChunkDistribution(originalLine, romanizedLine, index);
                if (!chunkValidationResult.isValid) {
                    errors.push(...chunkValidationResult.errors);
                    lineErrors.push(...chunkValidationResult.errors);
                }
            }
        }

        if (lineErrors.length > 0) {
            detailedErrors.push({
                lineIndex: index,
                errors: lineErrors
            });
        }
    });

    return { isValid: errors.length === 0, errors, detailedErrors };
}

function validateChunkDistribution(originalLine, romanizedLine, lineIndex) {
    const errors = [];

    const emptyChunks = romanizedLine.chunk.filter((chunk, idx) =>
        !chunk.text || chunk.text.trim() === ''
    );

    if (emptyChunks.length > 0) {
        errors.push(`Line ${lineIndex}: Found ${emptyChunks.length} empty chunk(s)`);
    }

    const nonEmptyChunks = romanizedLine.chunk.filter(chunk =>
        chunk.text && chunk.text.trim() !== ''
    );

    if (nonEmptyChunks.length === 1 && romanizedLine.chunk.length > 1) {
        errors.push(`Line ${lineIndex}: All text concentrated in one chunk while others are empty`);
    }

    const coherenceResult = validateTextCoherence(romanizedLine, lineIndex);
    if (!coherenceResult.isValid) {
        errors.push(...coherenceResult.errors);
    }

    return { isValid: errors.length === 0, errors };
}

function validateTextCoherence(romanizedLine, lineIndex) {
    const errors = [];

    const mergedChunkText = romanizedLine.chunk.map(c => c.text || '').join('');
    const lineText = romanizedLine.text || '';

    const normalizedMerged = normalizeTextForComparison(mergedChunkText);
    const normalizedLine = normalizeTextForComparison(lineText);

    if (normalizedMerged !== normalizedLine) {
        const distance = levenshteinDistance(normalizedMerged, normalizedLine);
        const maxLength = Math.max(normalizedMerged.length, normalizedLine.length);
        const percentageDifference = (maxLength === 0) ? 0 : (distance / maxLength) * 100;

        if (percentageDifference > 20) {
            errors.push(`Line ${lineIndex}: Significant text mismatch (${percentageDifference.toFixed(1)}% difference)`);
            console.log(`Text mismatch details:
                Merged chunks: "${mergedChunkText}"
                Line text: "${lineText}"
                Normalized merged: "${normalizedMerged}"
                Normalized line: "${normalizedLine}"`);
        }
    }

    return { isValid: errors.length === 0, errors };
}

/* =================================================================
   DATA PARSERS
   ================================================================= */

function parseKPoeFormat(data) {
    if (!data?.lyrics || !Array.isArray(data.lyrics) || data.lyrics.length === 0) return null;
    return {
        type: data.type,
        data: data.lyrics.map(item => {
            const startTime = Number(item.time || 0) / 1000;
            const duration = Number(item.duration || 0) / 1000;
            const syllabus = (item.syllabus || []).map(syl => ({
                text: syl.text || '',
                time: Number(syl.time || 0),
                duration: Number(syl.duration || 0),
                isBackground: syl.isBackground || false
            }));
            const element = item.element || [];

            let lineRomanizedText = undefined;
            let romanizedSyllabus = undefined;

            if (item.transliteration) {
                if (item.transliteration.syllabus && item.transliteration.syllabus.length === syllabus.length) {
                    romanizedSyllabus = syllabus.map((syl, index) => ({
                        ...syl,
                        romanizedText: item.transliteration.syllabus[index].text || syl.text
                    }));
                    lineRomanizedText = item.transliteration.text || item.text;
                } else if (item.transliteration.text) {
                    lineRomanizedText = item.transliteration.text;
                }
            }

            return {
                text: item.text || '',
                startTime,
                duration,
                endTime: startTime + duration,
                syllabus: romanizedSyllabus || syllabus,
                element,
                romanizedText: lineRomanizedText
            };
        }),
        metadata: { ...data.metadata, source: `${data.metadata.source} (KPoe)` },
        ignoreSponsorblock: data.ignoreSponsorblock || data.metadata.ignoreSponsorblock
    };
}

function parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const lines = data.syncedLyrics.split('\n');
    const matches = lines
        .map(line => timeRegex.exec(line))
        .filter(Boolean)
        .map(match => ({
            startTime: parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3], 10) / (match[3].length === 2 ? 100 : 1000),
            text: match[4].trim()
        }));

    if (matches.length === 0) return null;

    const parsedLines = matches.map((current, i) => {
        const endTime = (i < matches.length - 1) ? matches[i + 1].startTime : current.startTime + 5;
        return { ...current, endTime, duration: endTime - current.startTime };
    }).filter(line => !(line.text.trim() == "♪" || line.text.trim() == ""));

    return {
        type: 'Line',
        data: parsedLines,
        metadata: { title: data.trackName, artist: data.artistName, album: data.albumName, duration: data.duration, source: "LRCLIB" }
    };
}

function parseYouTubeSubtitles(data, songInfo) {
    if (!data?.events?.length) return null;
    const parsedLines = data.events
        .map(event => {
            const text = event.segs?.map(seg => seg.utf8).join(' ').trim();
            if (!text) return null;
            const startTime = event.tStartMs / 1000;
            const duration = event.dDurationMs / 1000;
            return { text, startTime, endTime: startTime + duration, duration };
        })
        .filter(Boolean);

    if (parsedLines.length === 0) return null;
    return { type: 'Line', data: parsedLines, metadata: { ...songInfo, source: "YouTube Captions" } };
}

/* =================================================================
   UTILITY FUNCTIONS
   ================================================================= */

function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function isEmptyLyrics(lyrics) {
    return !lyrics || !lyrics.data || lyrics.data.length === 0 || lyrics.data.every(line => !line.text);
}

function isPurelyLatinScript(text) {
    return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text);
}

function normalizeTextForComparison(text) {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, '');
}

function levenshteinDistance(s1, s2) {
    const track = Array(s2.length + 1).fill(null).map(() =>
        Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i++) {
        track[0][i] = i;
    }
    for (let j = 0; j <= s2.length; j++) {
        track[j][0] = j;
    }
    for (let j = 1; j <= s2.length; j++) {
        for (let i = 1; i <= s1.length; i++) {
            const indicator = (s1[i - 1] === s2[j - 1]) ? 0 : 1;
            track[j][i] = Math.min(
                track[j][i - 1] + 1,
                track[j - 1][i] + 1,
                track[j - 1][i - 1] + indicator
            );
        }
    }
    return track[s2.length][s1.length];
}
