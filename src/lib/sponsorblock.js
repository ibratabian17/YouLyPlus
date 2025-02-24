//src/lib/sponsorblock.js

/**
 * Compute the SHA‑256 hash prefix for a given video ID.
 * @param {string} videoID - The YouTube video ID.
 * @param {number} prefixLength - How many hex characters to take (default is 4).
 * @returns {Promise<string>} The computed hash prefix.
 */
async function computeHashPrefix(videoID, prefixLength = 4) {
    const encoder = new TextEncoder();
    const data = encoder.encode(videoID);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, prefixLength);
}

/**
 * Build a SponsorBlock query URL with all parameters.
 * If options.sha256HashPrefix is not provided but videoID is,
 * this function will compute the prefix automatically.
 *
 * @param {Object} options - Options for the SponsorBlock query.
 * @param {string} [options.videoID] - The YouTube video ID.
 * @param {string} [options.sha256HashPrefix] - Optional hash prefix; if not provided and videoID is given, it will be computed.
 *
 * // Optional parameters:
 * @param {string|string[]} [options.category] - A single category or an array.
 * @param {string|string[]} [options.categories] - An array of categories.
 * @param {string|string[]} [options.requiredSegment] - A required segment UUID or array.
 * @param {string|string[]} [options.requiredSegments] - An array of required segment UUIDs.
 * @param {string|string[]} [options.actionType] - A single action type or array.
 * @param {string|string[]} [options.actionTypes] - An array of action types.
 * @param {string} [options.service] - Defaults to "YouTube".
 * @param {number|string} [options.trimUUIDs] - Optional trimUUIDs parameter.
 * @param {number} [options.prefixLength] - Number of hex characters to use for the hash prefix (default 4).
 *
 * @returns {Promise<string>} The full URL for the SponsorBlock API query.
 */
async function buildSponsorBlockUrl(options) {
    let baseUrl = 'https://sponsor.ajay.app/api/skipSegments';

    // If no sha256HashPrefix is provided but videoID exists, compute it.
    if (!options.sha256HashPrefix && options.videoID) {
        const prefixLength = options.prefixLength || 4;
        const computedPrefix = await computeHashPrefix(options.videoID, prefixLength);
        options.sha256HashPrefix = computedPrefix;
    }

    if (options.sha256HashPrefix) {
        baseUrl += '/' + encodeURIComponent(options.sha256HashPrefix);
    } else if (options.videoID) {
        // Fallback: use videoID as a query parameter if no prefix is computed.
        // (Not recommended since using the hash prefix is more private.)
    } else {
        throw new Error('Either sha256HashPrefix or videoID must be provided.');
    }

    const params = new URLSearchParams();

    // Only add videoID if prefix is not used (should not happen with our auto-compute).
    if (!options.sha256HashPrefix && options.videoID) {
        params.set('videoID', options.videoID);
    }

    // Combine category/categories.
    const cats = [];
    if (options.category) {
        Array.isArray(options.category)
            ? cats.push(...options.category)
            : cats.push(options.category);
    }
    if (options.categories) {
        Array.isArray(options.categories)
            ? cats.push(...options.categories)
            : cats.push(options.categories);
    }
    // Default to common segment categories if none are provided.
    if (cats.length === 0) {
        cats.push(
            "sponsor", "selfpromo", "exclusive_access", "interaction", "poi_highlight",
            "intro", "outro", "preview", "filler", "chapter", "music_offtopic"
        );
    }
    params.set('categories', JSON.stringify(cats));

    // Combine requiredSegment/requiredSegments.
    const reqSegs = [];
    if (options.requiredSegment) {
        Array.isArray(options.requiredSegment)
            ? reqSegs.push(...options.requiredSegment)
            : reqSegs.push(options.requiredSegment);
    }
    if (options.requiredSegments) {
        Array.isArray(options.requiredSegments)
            ? reqSegs.push(...options.requiredSegments)
            : reqSegs.push(options.requiredSegments);
    }
    if (reqSegs.length) {
        params.set('requiredSegments', JSON.stringify(reqSegs));
    }

    // Combine actionType/actionTypes.
    const actions = [];
    if (options.actionType) {
        Array.isArray(options.actionType)
            ? actions.push(...options.actionType)
            : actions.push(options.actionType);
    }
    if (options.actionTypes) {
        Array.isArray(options.actionTypes)
            ? actions.push(...options.actionTypes)
            : actions.push(options.actionTypes);
    }
    // Default to common action types if none are provided.
    if (actions.length === 0) {
        actions.push("skip", "mute", "chapter", "full", "poi");
    }
    params.set('actionTypes', JSON.stringify(actions));

    // Set service.
    if (options.service) {
        params.set('service', options.service);
    } else {
        params.set('service', 'YouTube');
    }

    // Optional: set trimUUIDs.
    if (options.trimUUIDs !== undefined) {
        params.set('trimUUIDs', options.trimUUIDs.toString());
    }

    return `${baseUrl}?${params.toString()}`;
}

/**
 * SponsorBlock helper function that automatically computes the hash prefix
 * and fetches segments for the given video ID.
 *
 * @param {string} videoID - The YouTube video ID.
 * @param {Object} [customOptions] - Optional extra options to override defaults.
 * @returns {Promise<Array>} A promise that resolves to an array of segments.
 */
async function fetchSponsorSegments(videoID, customOptions = {}) {
    try {
        // Merge videoID into options.
        const options = { videoID, ...customOptions };
        // Build the URL, which will auto-compute the sha256HashPrefix.
        const url = await buildSponsorBlockUrl(options);
        const response = await fetch(url);

        if (response.status === 404) {
            console.warn("SponsorBlock returned 404; no segments available for this video.");
            return [];
        }

        if (!response.ok) {
            console.warn(`SponsorBlock fetch failed with status: ${response.status}`);
            return [];
        }

        const data = await response.json();

        // If the API returns an array of objects, search for the one matching our videoID.
        if (Array.isArray(data)) {
            const videoObj = data.find(item => item.videoID === videoID);
            if (videoObj && videoObj.segments) {
                return videoObj.segments;
            }
        }

        // Fallback: if data is already an array of segments, return it.
        return data;
    } catch (error) {
        console.warn('Error fetching SponsorBlock segments:', error);
        return [];
    }
}

/**
 * Menyesuaikan timing lirik dengan menambahkan delay (offset) berdasarkan total durasi segmen
 * SponsorBlock yang sudah dimulai sebelum lirik muncul. Fungsi ini menggabungkan segmen yang tumpang tindih
 * dan langsung menghitung offset untuk setiap lirik.
 *
 * @param {Array} lyricsData - Array objek lirik dengan properti startTime dan endTime.
 *                             (Satuan waktu "s" untuk detik atau "ms" untuk milidetik)
 * @param {Array} segments - Array objek segmen SponsorBlock, masing-masing memiliki properti "segment": [start, end] (dalam detik).
 * @param {string} [timeUnit="s"] - Satuan waktu lirik ("s" untuk detik, "ms" untuk milidetik).
 * @returns {Array} Array lirik dengan timing yang telah disesuaikan.
 */
function adjustLyricTiming(lyricsData, segments, timeUnit = "s") {
    // 1. Buat array interval dari setiap segmen dan urutkan berdasarkan waktu mulai
    const intervals = segments
        .map(s => s.segment)
        .sort((a, b) => a[0] - b[0]);

    // 2. Gabungkan interval yang tumpang tindih agar tidak terjadi perhitungan ganda
    const mergedIntervals = [];
    for (const interval of intervals) {
        if (interval) {
            if (!mergedIntervals.length) {
                mergedIntervals.push(interval.slice());
            } else {
                const last = mergedIntervals[mergedIntervals.length - 1];
                if (interval[0] <= last[1]) {
                    // Tumpang tindih: perbarui waktu akhir interval terakhir
                    last[1] = Math.max(last[1], interval[1]);
                } else {
                    mergedIntervals.push(interval.slice());
                }
            }
        }
    }

    const adjustedLyrics = lyricsData.map(lyric => {
        // Konversi waktu lirik ke detik bila satuan adalah ms
        const lyricStartSec = timeUnit === "ms" ? lyric.startTime / 1000 : lyric.startTime;

        // Hitung offset: jumlah durasi setiap interval yang sudah mulai sebelum lirik muncul
        let offsetSec = 0;
        for (const [start, end] of mergedIntervals) {
            if (lyricStartSec >= start) {
                offsetSec += (end - start);
            } else {
                break;
            }
        }

        // Tambahkan offset ke waktu lirik (konversi ke ms bila diperlukan)
        if (timeUnit === "ms") {
            const offsetMs = offsetSec * 1000;
            return {
                ...lyric,
                startTime: lyric.startTime + offsetMs,
                endTime: lyric.endTime + offsetMs
            };
        } else {
            return {
                ...lyric,
                startTime: lyric.startTime + offsetSec,
                endTime: lyric.endTime + offsetSec
            };
        }
    });

    return adjustedLyrics;
}

