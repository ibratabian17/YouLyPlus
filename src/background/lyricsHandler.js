//Universal Browser
const pBrowser = chrome || browser;
console.log('Service Workers Running')

// In‑memory caches for quick access
const lyricsCache = new Map();
const ongoingFetches = new Map();
let currentFetchController = null;

/* =================== IndexedDB Helper Functions =================== */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LyricsCacheDB", 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("lyrics")) {
                db.createObjectStore("lyrics", { keyPath: "key" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function getLyricsFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readonly");
        const store = transaction.objectStore("lyrics");
        const request = store.get(key);
        request.onsuccess = event => {
            const result = event.target.result;
            if (result) {
                const now = Date.now();
                const age = now - result.timestamp;
                const twoHours = 2 * 60 * 60 * 1000;
                if (age < twoHours) {
                    resolve(result.lyrics);
                } else {
                    // If expired, remove from DB
                    deleteLyricsFromDB(key);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        };
        request.onerror = event => reject(event.target.error);
    });
}

async function saveLyricsToDB(key, lyrics) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.put({ key, lyrics, timestamp: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

async function deleteLyricsFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

// Clear only expired cache entries
async function clearExpiredCache() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.getAll();
        request.onsuccess = async event => {
            const now = Date.now();
            const twoHours = 2 * 60 * 60 * 1000;
            const allRecords = event.target.result;
            for (const record of allRecords) {
                if (now - record.timestamp >= twoHours) {
                    await deleteLyricsFromDB(record.key);
                }
            }
            resolve();
        };
        request.onerror = event => reject(event.target.error);
    });
}


async function clearCacheDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

async function estimateIndexedDBSizeInKB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readonly");
        const store = transaction.objectStore("lyrics");
        const request = store.getAll();
        request.onsuccess = event => {
            const allRecords = event.target.result;
            const totalSizeBytes = allRecords.reduce((acc, record) => {
                // Rough estimation: convert record to a JSON string and get its byte length.
                return acc + new TextEncoder().encode(JSON.stringify(record)).length;
            }, 0);
            // Convert bytes to kilobytes.
            const sizeInKB = totalSizeBytes / 1024;
            resolve(sizeInKB);
        };
        request.onerror = event => reject(event.target.error);
    });
}

/* =================== Local Storage Function =================== */
function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/* =================== Runtime Message Listeners =================== */
pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_LYRICS') {
        try {
            handleLyricsFetch(message.songInfo, sendResponse);
        } catch (error) {
            sendResponse({ success: false, error: error });
        }
        return true; // Indicates asynchronous response.
    }
    if (message.type === 'RESET_CACHE') {
        (async () => {
            try {
                lyricsCache.clear();
                ongoingFetches.clear();
                await clearCacheDB();
                sendResponse({ success: true, message: "Cache reset successfully" });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    if (message.type === 'GET_CACHED_SIZE') {
        (async () => {
            try {
                const sizeKB = await estimateIndexedDBSizeInKB();
                const db = await openDB();
                const transaction = db.transaction(["lyrics"], "readonly"); 
                const store = transaction.objectStore("lyrics");
                const countRequest = store.count();
                const cacheCount = await new Promise((resolve, reject) => {
                    countRequest.onsuccess = () => resolve(countRequest.result);
                    countRequest.onerror = () => reject(countRequest.error);
                });
                sendResponse({ success: true, sizeKB, cacheCount });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

/* =================== Lyrics Fetching Logic =================== */
async function handleLyricsFetch(songInfo, sendResponse) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;

    // Check the in‑memory cache first.
    if (lyricsCache.has(cacheKey)) {
        sendResponse({ success: true, lyrics: lyricsCache.get(cacheKey), metadata: songInfo });
        return;
    }

    // Check the persistent IndexedDB cache.
    try {
        const dbCachedLyrics = await getLyricsFromDB(cacheKey);
        if (dbCachedLyrics) {
            lyricsCache.set(cacheKey, dbCachedLyrics);
            sendResponse({ success: true, lyrics: dbCachedLyrics, metadata: songInfo });
            return;
        }
    } catch (error) {
        console.error("Error reading from DB:", error);
    }

    // If an ongoing fetch is present, wait for it.
    if (ongoingFetches.has(cacheKey)) {
        try {
            const lyrics = await ongoingFetches.get(cacheKey);
            sendResponse({ success: true, lyrics, metadata: songInfo });
        } catch (error) {
            sendResponse({ success: false, error: error.message, metadata: songInfo });
        }
        return;
    }

    // Start a new fetch and store its promise.
    const fetchPromise = (async () => {
        try {
            // Determine provider based on settings.
            const settings = await storageLocalGet({ 'lyricsProvider': 'kpoe' });
            const isPrimaryKPoe = settings.lyricsProvider === 'kpoe';

            // Try the primary provider first.
            let lyrics = isPrimaryKPoe ?
                await fetchKPoeLyrics(songInfo) :
                await fetchLRCLibLyrics(songInfo);

            // If no result, try the secondary provider.
            if (!lyrics) {
                lyrics = isPrimaryKPoe ?
                    await fetchLRCLibLyrics(songInfo) :
                    await fetchKPoeLyrics(songInfo);
            }

            // If both providers failed, try YouTube subtitles if available
            if (!lyrics && songInfo.videoId && songInfo.subtitle) {
                lyrics = await fetchYouTubeSubtitles(songInfo);
            }

            if (!lyrics) {
                throw new Error('No lyrics found');
            }

            lyricsCache.set(cacheKey, lyrics);
            await saveLyricsToDB(cacheKey, lyrics);
            return lyrics;
        } finally {
            // Clean up ongoing fetch record.
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);

    try {
        const lyrics = await fetchPromise;
        sendResponse({ success: true, lyrics, metadata: songInfo });
    } catch (error) {
        sendResponse({ success: false, error: error.message, metadata: songInfo });
    }
}

async function fetchKPoeLyrics(songInfo) {
    const albumParam = (songInfo.album && songInfo.album !== songInfo.title)
        ? `&album=${encodeURIComponent(songInfo.album)}`
        : '';
    const url = `https://lyricsplus.prjktla.workers.dev/v1/lyrics/get?title=${encodeURIComponent(songInfo.title)}&artist=${encodeURIComponent(songInfo.artist)}${albumParam}&duration=${songInfo.duration}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return parseKPoeFormat(data);
}

async function fetchLRCLibLyrics(songInfo) {
    const albumParam = (songInfo.album && songInfo.album !== songInfo.title)
        ? `&album_name=${encodeURIComponent(songInfo.album)}`
        : '';
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(songInfo.artist)}&track_name=${encodeURIComponent(songInfo.title)}${albumParam}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return parseLRCLibFormat(data);
}

async function fetchYouTubeSubtitles(songInfo) {
    try {
        const subtitleData = songInfo.subtitle;
        if (!subtitleData || !subtitleData.captionTracks || subtitleData.captionTracks.length === 0) {
            return null;
        }

        let selectedTrack = null;
        let fallbackCandidate = null;

        // Look for a default track among one-letter keys, prioritizing isDefault true
        for (const key in subtitleData) {
            if (key.length === 1) { // likely a default track key
                const candidate = subtitleData[key];
                if (
                    candidate &&
                    typeof candidate === 'object' &&
                    candidate.url &&
                    candidate.languageCode &&
                    candidate.kind !== 'asr' &&
                    !(candidate.vssId && candidate.vssId.startsWith('a.'))
                ) {
                    // Prioritize if isDefault is true
                    if (candidate.isDefault) {
                        selectedTrack = candidate;
                        break;
                    }
                    // Save candidate as fallback if none marked default yet
                    if (!fallbackCandidate) {
                        fallbackCandidate = candidate;
                    }
                }
            }
        }

        // If no isDefault candidate was found among one-letter keys, use the fallback candidate
        if (!selectedTrack && fallbackCandidate) {
            selectedTrack = fallbackCandidate;
        }

        // Fallback to captionTracks if still not found
        if (!selectedTrack) {
            const validTracks = subtitleData.captionTracks.filter(track =>
                track.kind !== 'asr' &&
                (!track.vssId || !track.vssId.startsWith('a.'))
            );
            if (validTracks.length > 0) {
                // Prefer track with isDefault true
                const defaultTrack = validTracks.find(track => track.isDefault);
                selectedTrack = defaultTrack || validTracks[0];
            }
        }

        if (!selectedTrack) {
            return null;
        }

        // Update the URL to request JSON3 format
        const url = new URL(selectedTrack.url);
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

function parseYouTubeSubtitles(data, songInfo) {
    if (!data.events || data.events.length === 0) {
        return null;
    }
    
    const parsedLines = [];
    
    // Process each subtitle event
    for (let i = 0; i < data.events.length; i++) {
        const event = data.events[i];
        
        // Skip events without text
        if (!event.segs || !event.segs.length) continue;
        
        // Combine all segments into one text string
        const text = event.segs.map(seg => seg.utf8).join(' ').trim();
        if (!text) continue;
        
        // Convert times from milliseconds to seconds
        const startTime = event.tStartMs / 1000;
        const duration = event.dDurationMs / 1000;
        const endTime = startTime + duration;
        
        parsedLines.push({
            text,
            startTime,
            endTime,
            duration,
            element: { singer: 'v1' }
        });
    }
    
    if (parsedLines.length === 0) {
        return null;
    }
    
    return {
        type: 'Line',
        data: parsedLines,
        ignoreSponsorblock: true,
        metadata: {
            title: songInfo.title,
            artist: songInfo.artist,
            album: songInfo.album,
            duration: songInfo.duration,
            instrumental: false,
            source: "YouTube Captions"
        }
    };
}

function parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;

    const lines = data.syncedLyrics.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\](.*)/;
    const parsedLines = [];
    const matches = [];

    // Extract timestamps and text.
    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const centiseconds = parseInt(match[3], 10);
            const startTime = minutes * 60 + seconds + centiseconds / 100;
            const text = match[4].trim();
            if (text) {
                matches.push({ startTime, text });
            }
        }
    }

    // Calculate end times.
    for (let i = 0; i < matches.length; i++) {
        const { startTime, text } = matches[i];
        const endTime = (i < matches.length - 1)
            ? matches[i + 1].startTime
            : startTime + 4; // Default duration.
        parsedLines.push({
            text,
            startTime,
            endTime,
            element: { singer: 'v1' }
        });
    }

    return {
        type: 'Line',
        data: parsedLines,
        metadata: {
            title: data.trackName,
            artist: data.artistName,
            album: data.albumName,
            duration: data.duration,
            instrumental: data.instrumental,
            source: "LRCLIB"
        }
    };
}

function parseKPoeFormat(data) {
    if (!Array.isArray(data.lyrics)) return null;

    const isLineType = data.type === "Line";
    // Clone metadata to avoid mutation.
    const metadata = {
        ...data.metadata,
        source: `${data.metadata.source} (KPoe)`
    };

    return {
        type: data.type,
        data: data.lyrics.map(item => {
            let startTime = Number(item.time) || 0;
            let duration = Number(item.duration) || 0;
            let endTime = startTime + duration;

            // Convert from milliseconds to seconds if needed.
            if (isLineType) {
                startTime /= 1000;
                duration /= 1000;
                endTime /= 1000;
            }

            return {
                text: item.text || '',
                startTime,
                duration,
                endTime,
                isLineEnding: Boolean(item.isLineEnding),
                element: item.element || {}
            };
        }),
        metadata
    };
}