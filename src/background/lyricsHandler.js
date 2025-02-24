//Universal Browser
const pBrowser = chrome || browser;
console.log('Service Workers Running')

// background.js
const lyricsCache = new Map();
const ongoingFetches = new Map();
let currentFetchController = null;


function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

// Listen for messages from content scripts
pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_LYRICS') {
        // We need to return true to indicate we'll respond asynchronously
        try {
            handleLyricsFetch(message.songInfo, sendResponse);
        }
        catch (error) {
            sendResponse({ success: false, error: error });
        }
        return true;
    }
});

async function handleLyricsFetch(songInfo, sendResponse) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist}`;

    // Return cached lyrics if available
    if (lyricsCache.has(cacheKey)) {
        sendResponse({ success: true, lyrics: lyricsCache.get(cacheKey) });
        return;
    }

    // If there's an ongoing fetch for this song, wait for it instead of starting a new one
    if (ongoingFetches.has(cacheKey)) {
        try {
            const lyrics = await ongoingFetches.get(cacheKey);
            sendResponse({ success: true, lyrics });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return;
    }

    // Start a new fetch and store its promise
    const fetchPromise = (async () => {
        try {
            // Determine provider based on settings
            const settings = await storageLocalGet({ 'lyricsProvider': 'kpoe' });
            const isPrimaryKPoe = settings.lyricsProvider === 'kpoe';

            // Try the primary provider first
            let lyrics = isPrimaryKPoe ?
                await fetchKPoeLyrics(songInfo) :
                await fetchLRCLibLyrics(songInfo);

            // If no result, try the secondary provider
            if (!lyrics) {
                lyrics = isPrimaryKPoe ?
                    await fetchLRCLibLyrics(songInfo) :
                    await fetchKPoeLyrics(songInfo);
            }

            if (!lyrics) {
                throw new Error('No lyrics found');
            }

            lyricsCache.set(cacheKey, lyrics);
            return lyrics;
        } finally {
            // Clean up the ongoing fetch record regardless of outcome
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);

    try {
        const lyrics = await fetchPromise;
        sendResponse({ success: true, lyrics });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function fetchKPoeLyrics(songInfo) {
    const albumParam = (songInfo.album && songInfo.album !== songInfo.title)
        ? `&album=${encodeURIComponent(songInfo.album)}`
        : '';
    const url = `https://lyricsplus.prjktla.workers.dev/v1/lyrics/get?title=${encodeURIComponent(songInfo.title)}&artist=${encodeURIComponent(songInfo.artist)}${albumParam}`;

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


function parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;

    const lines = data.syncedLyrics.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\](.*)/;
    const parsedLines = [];
    const matches = [];

    // Extract timestamps and text for each line.
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

    // Calculate end times for each lyric line.
    for (let i = 0; i < matches.length; i++) {
        const { startTime, text } = matches[i];
        const endTime = (i < matches.length - 1)
            ? matches[i + 1].startTime
            : startTime + 4; // Default duration if no following timestamp.
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
    // Clone metadata to avoid mutating the original object.
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

