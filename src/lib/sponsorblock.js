//src/lib/sponsorblock.js

/**
 * Compute the SHA-256 hash prefix for a given video ID.
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
    const params = new URLSearchParams();

    // Handle hash prefix vs direct videoID
    if (options.sha256HashPrefix) {
        baseUrl += '/' + encodeURIComponent(options.sha256HashPrefix);
    } else if (options.videoID) {
        // Compute hash prefix automatically for privacy
        const prefixLength = options.prefixLength || 4;
        const computedPrefix = await computeHashPrefix(options.videoID, prefixLength);
        baseUrl += '/' + encodeURIComponent(computedPrefix);
    } else {
        throw new Error('Either sha256HashPrefix or videoID must be provided.');
    }

    // Combine category/categories with proper validation
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

    // Use more comprehensive default categories
    if (cats.length === 0) {
        cats.push("sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic");
    }

    // Remove duplicates and validate categories
    const uniqueCats = [...new Set(cats)];
    params.set('categories', JSON.stringify(uniqueCats));

    // Combine requiredSegment/requiredSegments
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
        const uniqueReqSegs = [...new Set(reqSegs)];
        params.set('requiredSegments', JSON.stringify(uniqueReqSegs));
    }

    // Combine actionType/actionTypes with proper validation
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

    // Use valid default action types
    if (actions.length === 0) {
        actions.push("skip", "mute", "full");
    }

    const uniqueActions = [...new Set(actions)];
    params.set('actionTypes', JSON.stringify(uniqueActions));

    // Set service (YouTube is default)
    params.set('service', options.service || 'YouTube');

    // Optional: set trimUUIDs
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
        // Validate videoID
        if (!videoID || typeof videoID !== 'string') {
            console.warn('Invalid videoID provided to fetchSponsorSegments');
            return [];
        }

        // Merge videoID into options
        const options = { videoID, ...customOptions };

        // Build the URL, which will auto-compute the sha256HashPrefix
        const url = await buildSponsorBlockUrl(options);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SponsorBlock-Client/1.0'
            }
        });

        if (response.status === 404) {
            console.info("SponsorBlock returned 404; no segments available for this video.");
            return [];
        }

        if (!response.ok) {
            console.warn(`SponsorBlock fetch failed with status: ${response.status} ${response.statusText}`);
            return [];
        }

        const data = await response.json();

        // Handle hash prefix response (array of video objects)
        if (Array.isArray(data) && data.length > 0) {
            // Look for our specific videoID in the response
            const videoObj = data.find(item => item.videoID === videoID);
            if (videoObj && Array.isArray(videoObj.segments)) {
                return videoObj.segments;
            }

            // If no exact match found, return empty array
            console.info(`No segments found for videoID ${videoID} in SponsorBlock response`);
            return [];
        }

        // Handle direct response (when not using hash prefix - shouldn't happen with current implementation)
        if (Array.isArray(data)) {
            return data;
        }

        console.warn("SponsorBlock response format not recognized:", data);
        return [];

    } catch (error) {
        console.error('Error fetching SponsorBlock segments:', error);
        return [];
    }
}

/**
 * Adjusts the timing of lyrics by adding a delay (offset) based on the total duration of
 * SponsorBlock segments that occur before each lyric timestamp. This function merges 
 * overlapping segments and calculates the offset for each lyric item.
 * Supports V1 (individual items) and V2 (lines with nested syllables) lyric formats.
 *
 * @param {Array<Object>} lyricsData - Array of lyric objects with timing information
 * @param {Array<Object>} segments - Array of SponsorBlock segment objects
 * @param {string} [timeUnit="ms"] - Time unit for input/output ("s" for seconds, "ms" for milliseconds)
 * @returns {Array<Object>} Adjusted lyrics data with updated timing
 */
function adjustLyricTiming(lyricsData, segments, timeUnit = "ms") {
    if (!Array.isArray(lyricsData) || lyricsData.length === 0) {
        return [];
    }

    // If no segments, return a deep copy of lyricsData without adjustments
    if (!Array.isArray(segments) || segments.length === 0) {
        return lyricsData.map(lyric => JSON.parse(JSON.stringify(lyric)));
    }

    // 1. Extract and validate segment intervals
    const intervals = segments
        .map(s => s.segment)
        .filter(segment =>
            Array.isArray(segment) &&
            segment.length === 2 &&
            typeof segment[0] === 'number' &&
            typeof segment[1] === 'number' &&
            segment[0] < segment[1] && // Ensure start < end
            segment[0] >= 0 // Ensure non-negative timestamps
        )
        .sort((a, b) => a[0] - b[0]); // Sort by start time

    // If no valid segments after filtering, return a deep copy
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
            lastMerged[1] = Math.max(lastMerged[1], currentInterval[1]);
        } else {
            mergedIntervals.push([...currentInterval]); // No overlap, add as new interval
        }
    }

    // 3. Process each lyric item
    const adjustedLyrics = lyricsData.map(originalLyricItem => {
        // Deep copy each lyric item to prevent modifying original objects
        const lyricItem = JSON.parse(JSON.stringify(originalLyricItem));

        // Determine the original start time of the lyric item
        let itemOriginalStartTime;

        if (lyricItem.hasOwnProperty('time')) {
            itemOriginalStartTime = lyricItem.time;
        } else if (lyricItem.hasOwnProperty('startTime')) {
            itemOriginalStartTime = lyricItem.startTime;
        } else {
            // If no time property, return the item as is
            return lyricItem;
        }

        // Convert to seconds for calculation
        const itemOriginalStartSec = (timeUnit === "ms") ? itemOriginalStartTime / 1000 : itemOriginalStartTime;

        // Calculate cumulative delay from all sponsor segments that start before or at this lyric
        let cumulativeDelaySec = 0;
        for (const [segmentStartSec, segmentEndSec] of mergedIntervals) {
            if (segmentStartSec <= itemOriginalStartSec) {
                // Sponsor segment starts before or at the lyric time - add its duration to delay
                cumulativeDelaySec += (segmentEndSec - segmentStartSec);
            } else {
                // Sponsor segment starts after lyric - no more delays to add
                break;
            }
        }

        // Convert delay back to original time unit
        const cumulativeDelay = (timeUnit === "ms") ? Math.round(cumulativeDelaySec * 1000) : cumulativeDelaySec;

        // Apply delay if there is any
        if (cumulativeDelay !== 0) {
            // Adjust 'time' property if it exists
            if (lyricItem.hasOwnProperty('time')) {
                lyricItem.time += offsetToApply;
            }

            // Adjust 'startTime' and 'endTime' properties if they exist
            if (lyricItem.hasOwnProperty('startTime')) {
                lyricItem.startTime += offsetToApply;

                if (lyricItem.hasOwnProperty('endTime')) {
                    lyricItem.endTime += offsetToApply;
                }
            }

            // Adjust 'syllabus' times if it's a V2 line with syllable data
            if (lyricItem.hasOwnProperty('syllabus') && Array.isArray(lyricItem.syllabus)) {
                lyricItem.syllabus.forEach(syl => {
                    if (syl.hasOwnProperty('time')) {
                        // Assume syllable times are always in milliseconds
                        const syllableOffsetMs = (timeUnit === "ms") ? offsetToApply : Math.round(offsetToApply * 1000);
                        syl.time += syllableOffsetMs;
                    }
                });
            }
        }

        return lyricItem;
    });

    return adjustedLyrics;
}
