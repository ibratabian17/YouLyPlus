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
 * Each segment object typically has a `segment: [startTime, endTime]` property.
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
        // This happens when querying with a hash prefix.
        if (Array.isArray(data) && data.length > 0 && data[0].hasOwnProperty('videoID')) {
            const videoObj = data.find(item => item.videoID === videoID);
            if (videoObj && videoObj.segments) {
                return videoObj.segments;
            }
            return []; // videoID not found in the hashed response, or no segments for it
        }

        // Fallback: if data is already an array of segments, return it.
        // This can happen if videoID was passed as a query param (though less private).
        if (Array.isArray(data)) {
            return data;
        }

        console.warn("SponsorBlock response format not recognized or empty:", data);
        return [];
    } catch (error) {
        console.warn('Error fetching SponsorBlock segments:', error);
        return [];
    }
}

/**
 * Adjusts the timing of lyrics by adding a delay (offset) based on the total duration of the segment
 * SponsorBlock that has started before the lyrics appear. This function merges overlapping segments
 * and calculates the offset for each lyric item (line or syllable).
 * Supports V1 (individual items) and V2 (lines with nested syllables) lyric formats.
 *
 * @param {Array<Object>} lyricsData
 * @param {Array<Object>} segments
 * @param {string} [timeUnit="s"] 
 * @returns {Array<Object>}
 */
function adjustLyricTiming(lyricsData, segments, timeUnit = "s") {
    if (!lyricsData || lyricsData.length === 0) {
        return [];
    }
    // If no segments, return a deep copy of lyricsData without adjustments.
    if (!segments || segments.length === 0) {
        return lyricsData.map(lyric => JSON.parse(JSON.stringify(lyric)));
    }

    // 1. Filter valid segments (start < end) and sort by start time
    const intervals = segments
        .map(s => s.segment)
        .filter(segment =>
            segment && segment.length === 2 &&
            typeof segment[0] === 'number' && typeof segment[1] === 'number' &&
            segment[0] < segment[1] // Ensure start time is less than end time
        )
        .sort((a, b) => a[0] - b[0]);

    // If no valid segments after filtering, return a deep copy.
    if (intervals.length === 0) {
        return lyricsData.map(lyric => JSON.parse(JSON.stringify(lyric)));
    }

    // 2. Merge overlapping or adjacent intervals
    const mergedIntervals = [];
    mergedIntervals.push([...intervals[0]]); // Start with a copy of the first interval

    for (let i = 1; i < intervals.length; i++) {
        const currentInterval = intervals[i];
        const lastMerged = mergedIntervals[mergedIntervals.length - 1];

        if (currentInterval[0] <= lastMerged[1]) { // Overlap or adjacent
            lastMerged[1] = Math.max(lastMerged[1], currentInterval[1]); // Extend the last merged interval
        } else {
            mergedIntervals.push([...currentInterval]); // No overlap, add as a new interval (copy)
        }
    }

    const adjustedLyrics = lyricsData.map(originalLyricItem => {
        // Deep copy each lyric item to prevent modifying original objects
        const lyricItem = JSON.parse(JSON.stringify(originalLyricItem));

        let itemOriginalStartTimeMs;

        // Determine the original start time of the lyric item in milliseconds
        // Prioritize 'time' as it's common in V1/V2 examples, then 'startTime'.
        if (lyricItem.hasOwnProperty('time')) {
            itemOriginalStartTimeMs = (timeUnit === "ms") ? lyricItem.time : Math.round(lyricItem.time * 1000);
        } else if (lyricItem.hasOwnProperty('startTime')) {
            itemOriginalStartTimeMs = (timeUnit === "ms") ? lyricItem.startTime : Math.round(lyricItem.startTime * 1000);
        } else {
            // If no time property, return the item as is (already a copy)
            // console.warn("Lyric item missing 'time' or 'startTime' property:", lyricItem);
            return lyricItem;
        }

        const itemOriginalStartSec = itemOriginalStartTimeMs / 1000;

        // Calculate cumulative offset in seconds
        let cumulativeOffsetSec = 0;
        for (const [segmentStartSec, segmentEndSec] of mergedIntervals) {
            if (itemOriginalStartSec >= segmentStartSec) {
                cumulativeOffsetSec += (segmentEndSec - segmentStartSec);
            } else {
                break; // Intervals sorted, no need to check further
            }
        }

        const cumulativeOffsetMs = Math.round(cumulativeOffsetSec * 1000);

        // Apply offset if there is any
        if (cumulativeOffsetMs !== 0) {
            // Adjust 'time' property if it exists
            if (lyricItem.hasOwnProperty('time')) {
                const originalTimeMs = (timeUnit === "ms") ? lyricItem.time : Math.round(lyricItem.time * 1000);
                const newTimeMs = originalTimeMs + cumulativeOffsetMs;
                lyricItem.time = (timeUnit === "ms") ? newTimeMs : (newTimeMs / 1000);
            }

            // Adjust 'startTime' and 'endTime' properties if they exist
            if (lyricItem.hasOwnProperty('startTime')) {
                const originalStartMs = (timeUnit === "ms") ? lyricItem.startTime : Math.round(lyricItem.startTime * 1000);
                const newStartMs = originalStartMs + cumulativeOffsetMs;
                lyricItem.startTime = (timeUnit === "ms") ? newStartMs : (newStartMs / 1000);

                if (lyricItem.hasOwnProperty('endTime')) {
                    const originalEndMs = (timeUnit === "ms") ? lyricItem.endTime : Math.round(lyricItem.endTime * 1000);
                    const newEndMs = originalEndMs + cumulativeOffsetMs;
                    lyricItem.endTime = (timeUnit === "ms") ? newEndMs : (newEndMs / 1000);
                }
            }

            // Adjust 'syllabus' times if it's a V2 line with a syllabus array
            // Assumption: Syllabus times are always in milliseconds.
            if (lyricItem.hasOwnProperty('syllabus') && Array.isArray(lyricItem.syllabus)) {
                lyricItem.syllabus = lyricItem.syllabus.map(syl => {
                    // newSyl is already a part of the deep-copied lyricItem
                    if (syl.hasOwnProperty('time')) {
                        // Assuming syl.time is in MS
                        syl.time += cumulativeOffsetMs;
                    }
                    return syl; // syl is modified in place from the copied lyricItem
                });
            }
        }
        return lyricItem;
    });

    return adjustedLyrics;
}

