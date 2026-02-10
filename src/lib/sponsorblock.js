//src/lib/sponsorblock.js



/**
 * Adjusts the timing of lyrics by adding a delay (offset) based on SponsorBlock segments.
 * Calculates offsets independently for start times, end times, and syllables to handle
 * segments that interrupt the middle of a lyric line.
 *
 * @param {Array<Object>} lyricsData - Array of lyric objects
 * @param {Array<Object>} segments - Array of SponsorBlock segment objects
 * @param {string} [timeUnit="ms"] - Time unit for input/output ("s" for seconds, "ms" for milliseconds)
 * @returns {Array<Object>} Adjusted lyrics data
 */
function adjustLyricTiming(lyricsData, segments, timeUnit = "ms") {
    if (!Array.isArray(lyricsData) || lyricsData.length === 0) return [];

    if (!Array.isArray(segments) || segments.length === 0) {
        return JSON.parse(JSON.stringify(lyricsData));
    }

    const rawIntervals = segments
        .map(s => s.segment)
        .filter(seg => Array.isArray(seg) && seg.length === 2 && seg[0] < seg[1] && seg[0] >= 0)
        .sort((a, b) => a[0] - b[0]);

    if (rawIntervals.length === 0) {
        return JSON.parse(JSON.stringify(lyricsData));
    }

    const mergedIntervals = [];
    if (rawIntervals.length > 0) {
        mergedIntervals.push([...rawIntervals[0]]);
        for (let i = 1; i < rawIntervals.length; i++) {
            const current = rawIntervals[i];
            const last = mergedIntervals[mergedIntervals.length - 1];
            if (current[0] <= last[1]) {
                last[1] = Math.max(last[1], current[1]);
            } else {
                mergedIntervals.push([...current]);
            }
        }
    }

    let cumulativeDeduction = 0;
    const adjusters = mergedIntervals.map(interval => {
        const videoStart = interval[0];
        const videoEnd = interval[1];
        const duration = videoEnd - videoStart;
        const songTimeTrigger = videoStart - cumulativeDeduction;
        cumulativeDeduction += duration;

        return {
            triggerPoint: songTimeTrigger,
            offsetAmount: duration
        };
    });

    const calculateShift = (t) => {
        let addedDelay = 0;
        for (const adjuster of adjusters) {
            if (t >= adjuster.triggerPoint) {
                addedDelay += adjuster.offsetAmount;
            }
        }
        return t + addedDelay;
    };

    const getAdjustedTime = (originalTime) => {
        const t = (timeUnit === "ms") ? originalTime / 1000 : originalTime;
        const newTimeSec = calculateShift(t);
        return (timeUnit === "ms") ? Math.round(newTimeSec * 1000) : newTimeSec;
    };

    return lyricsData.map(originalItem => {
        const item = JSON.parse(JSON.stringify(originalItem));

        if (item.hasOwnProperty('time') && typeof item.time === 'number') {
            item.time = getAdjustedTime(item.time);
        }

        if (item.hasOwnProperty('startTime') && typeof item.startTime === 'number') {
            item.startTime = getAdjustedTime(item.startTime);
        }

        if (item.hasOwnProperty('endTime') && typeof item.endTime === 'number') {
            item.endTime = getAdjustedTime(item.endTime);
        }

        const sylKey = item.hasOwnProperty('syllabus') ? 'syllabus' : (item.hasOwnProperty('syllables') ? 'syllables' : null);

        if (sylKey && Array.isArray(item[sylKey])) {
            item[sylKey].forEach(syl => {
                if (syl.hasOwnProperty('time') && typeof syl.time === 'number') {
                    const isMixedUnit = timeUnit === "s" && syl.time > 1000;

                    if (isMixedUnit) {
                        const timeInSeconds = syl.time / 1000;
                        const adjustedSeconds = calculateShift(timeInSeconds);
                        syl.time = Math.round(adjustedSeconds * 1000);
                    } else {
                        syl.time = getAdjustedTime(syl.time);
                    }
                }
            });
        }

        return item;
    });
}