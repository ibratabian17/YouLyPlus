// Mock lyrics data for preview
const mockLyricsData = {
    type: 'Syllable',
    data: [
        { text: 'This ', startTime: 0, duration: 500, element: { singer: 'v1' } },
        { text: 'is ', startTime: 500, duration: 500, element: { singer: 'v1' } },
        { text: 'a ', startTime: 1000, duration: 500, element: { singer: 'v1' } },
        { text: 'preview ', startTime: 1500, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
        { text: 'of ', startTime: 3000, duration: 500, element: { singer: 'v1' } },
        { text: 'how ', startTime: 3500, duration: 500, element: { singer: 'v1' } },
        { text: 'lyrics ', startTime: 4000, duration: 500, element: { singer: 'v1' } },
        { text: 'will ', startTime: 4500, duration: 500, element: { singer: 'v1' } },
        { text: 'look!', startTime: 5000, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
        { text: 'Enjoy ', startTime: 10000, duration: 500, element: { singer: 'v1' } },
        { text: 'the ', startTime: 10500, duration: 500, element: { singer: 'v1' } },
        { text: 'example!', startTime: 11000, duration: 1000, isLineEnding: true, element: { singer: 'v1' } },
    ],
    metadata: {
        title: 'Example Song',
        artist: ['YouLy+ Dev'],
        album: 'Settings Preview',
        duration: 12000, // Duration in ms for the whole mock song
        instrumental: false,
        source: 'Mock Data'
    }
};

function t(key) { // Simple translation mock
    const translations = {
        "writtenBy": "Written by:",
        "source": "Source:",
        "notFound": "Lyrics not found.",
        "notFoundError": "Error fetching lyrics.",
        "loading": "Loading lyrics..."
    };
    return translations[key] || key;
}

// Preview specific variables and functions
let previewAnimationFrameId = null;
let previewCurrentPrimaryActiveLine = null;
let previewLastTime = 0;
let previewLyricsContainer = null;
let previewCachedLyricsLines = [];
let previewCachedSyllables = [];
let previewFontCache = {};
let previewTextWidthCanvas = null;
let previewCurrentTime = 0;
let previewPlaybackInterval = null;

const getPreviewContainer = () => {
    if (!previewLyricsContainer) {
        previewLyricsContainer = document.getElementById('lyrics-plus-container-preview');
    }
    return previewLyricsContainer;
};

const onPreviewLyricClick = e => {
    const target = e.currentTarget;
    if (target && target.dataset && target.dataset.startTime) {
        const time = parseFloat(target.dataset.startTime);
        if (!isNaN(time)) {
            previewCurrentTime = target.classList.contains('lyrics-line') ? time * 1000 : time;
        }
    }
};

const isRTL = text => typeof text === 'string' && /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);

const GAP_THRESHOLD = 7; // seconds
function createPreviewGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    const gapLine = document.createElement('div');
    gapLine.className = 'lyrics-line lyrics-gap';
    gapLine.dataset.startTime = gapStart; // in seconds
    gapLine.dataset.endTime = gapEnd; // in seconds

    gapLine.addEventListener('click', onPreviewLyricClick);

    if (classesToInherit) {
        if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
        if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
        if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-vocal-container';

    for (let i = 0; i < 3; i++) {
        const syllableSpan = document.createElement('span');
        syllableSpan.className = 'lyrics-syllable';
        const syllableStart = (gapStart * 1000) + (i * (gapDuration * 1000) / 3);
        const syllableDur = ((gapDuration * 1000) / 3) / 0.9;
        syllableSpan.dataset.startTime = syllableStart;
        syllableSpan.dataset.duration = syllableDur;
        syllableSpan.dataset.endTime = syllableStart + syllableDur;
        syllableSpan.textContent = "•";
        mainContainer.appendChild(syllableSpan);
    }

    gapLine.appendChild(mainContainer);
    return gapLine;
}

function displayPreviewLyrics(lyrics, source = "Unknown", type = "Syllable", lightweight = false, songWriters) {
    const container = getPreviewContainer();
    if (!container) return;

    container.innerHTML = '';
    previewFontCache = {};

    const fragment = document.createDocumentFragment();

    if (type !== "Line" && lyrics.data) {
        let currentLine = document.createElement('div');
        currentLine.classList.add('lyrics-line');
        let mainContainer = document.createElement('div');
        mainContainer.classList.add('main-vocal-container');
        currentLine.appendChild(mainContainer);
        let backgroundContainer = null;

        let lineSinger = null,
            lineStartTimeMs = null,
            lineEndTimeMs = null,
            wordBuffer = [];

        const flushWordBuffer = () => {
            if (!wordBuffer.length) return;

            const getComputedFont = (element) => {
                if (!element) return '400 16px sans-serif';
                const style = getComputedStyle(element);
                const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                return font;
            };

            const wordSpan = document.createElement('span');
            wordSpan.classList.add('lyrics-word');

            let referenceElement = mainContainer.firstChild || mainContainer;
            let referenceFont = getComputedFont(referenceElement);

            const combinedText = wordBuffer.map(s => s.text).join('');
            const trimmedText = combinedText.trim();
            const totalDurationMs = wordBuffer.reduce((sum, s) => sum + s.duration, 0);

            const shouldEmphasize = !lightweight &&
                !isRTL(combinedText) &&
                trimmedText.length <= 7 &&
                trimmedText.length > 1 &&
                totalDurationMs >= 1000;

            const durationFactor = Math.min(1.0, Math.max(0.5, (totalDurationMs - 1000) / 1000));

            let baseMinScale = 1.02;
            let baseMaxScale = 1.0;

            const durationScaleFactor = durationFactor * 0.15;
            baseMaxScale += durationScaleFactor;

            const maxScale = Math.min(1.2, baseMaxScale);
            const minScale = Math.max(1.0, Math.min(1.06, baseMinScale));

            const shadowIntensity = Math.min(0.8, 0.4 + (durationFactor * 0.4));
            const translateYPeak = -Math.min(3.0, 0.0 + (durationFactor * 3.0));

            wordSpan.style.setProperty('--max-scale', maxScale.toFixed(2));
            wordSpan.style.setProperty('--min-scale', minScale.toFixed(2));
            wordSpan.style.setProperty('--shadow-intensity', shadowIntensity.toFixed(2));
            wordSpan.style.setProperty('--translate-y-peak', `${translateYPeak.toFixed(2)}%`);
            wordSpan.dataset.totalDuration = totalDurationMs;

            let hasBackgroundSyllables = false;
            const characterData = [];

            const syllableFragment = document.createDocumentFragment();
            const backgroundSyllableFragment = document.createDocumentFragment();

            wordBuffer.forEach((s, syllableIndex) => {
                const sylSpan = document.createElement('span');
                sylSpan.classList.add('lyrics-syllable');
                sylSpan.dataset.startTime = s.startTime;
                sylSpan.dataset.duration = s.duration;
                sylSpan.dataset.endTime = s.startTime + s.duration;
                sylSpan.dataset.wordDuration = totalDurationMs;
                sylSpan.dataset.syllableIndex = syllableIndex;

                const isRtlTextSyllable = isRTL(s.text);
                if (isRtlTextSyllable) {
                    sylSpan.classList.add('rtl-text');
                }

                if (shouldEmphasize && !(s.element && s.element.isBackground)) {
                    wordSpan.classList.add('growable');
                    let charIndex = 0;

                    const textNodes = [];
                    for (const char of s.text) {
                        if (char === ' ') {
                            textNodes.push(document.createTextNode(' '));
                        } else {
                            const charSpan = document.createElement('span');
                            charSpan.textContent = char;
                            charSpan.classList.add('char');
                            charSpan.dataset.charIndex = charIndex++;
                            charSpan.dataset.syllableCharIndex = characterData.length;

                            characterData.push({
                                charSpan,
                                syllableSpan: sylSpan,
                                isBackground: s.element && s.element.isBackground
                            });

                            textNodes.push(charSpan);
                        }
                    }

                    textNodes.forEach(node => sylSpan.appendChild(node));
                } else {
                    sylSpan.textContent = (s.element && s.element.isBackground) ? s.text.replace(/[()]/g, '') : s.text;
                }

                if (s.element && s.element.isBackground) {
                    hasBackgroundSyllables = true;
                    backgroundSyllableFragment.appendChild(sylSpan);
                } else {
                    syllableFragment.appendChild(sylSpan);
                }
            });

            wordSpan.appendChild(syllableFragment);
            mainContainer.appendChild(wordSpan);

            if (shouldEmphasize && characterData.length > 0) {
                const fullWordText = wordSpan.textContent;
                const wordWidth = getTextWidth(fullWordText, referenceFont);

                let cumulativeWidth = 0;
                characterData.forEach((charData) => {
                    if (charData.isBackground || !wordWidth) return;

                    const span = charData.charSpan;
                    const charText = span.textContent;
                    const charWidth = getTextWidth(charText, referenceFont);
                    const charCenter = cumulativeWidth + (charWidth / 2);
                    const position = charCenter / wordWidth;

                    const relativePosition = (position - 0.5) * 2;
                    const scaleOffset = maxScale - 1.0;
                    const horizontalOffsetFactor = scaleOffset * 40;
                    const horizontalOffset = Math.sign(relativePosition) *
                        Math.pow(Math.abs(relativePosition), 1.3) *
                        horizontalOffsetFactor;

                    span.dataset.horizontalOffset = horizontalOffset.toFixed(2);
                    span.dataset.position = position.toFixed(3);

                    cumulativeWidth += charWidth;
                });
            }

            if (hasBackgroundSyllables) {
                if (!backgroundContainer) {
                    backgroundContainer = document.createElement('div');
                    backgroundContainer.classList.add('background-vocal-container');
                    currentLine.appendChild(backgroundContainer);
                }
                const tempBgWordSpan = document.createElement('span');
                tempBgWordSpan.classList.add('lyrics-word');
                tempBgWordSpan.appendChild(backgroundSyllableFragment);
                backgroundContainer.appendChild(tempBgWordSpan);
            }

            wordBuffer = [];
        };

        const CHUNK_SIZE = lyrics.data.length;
        for (let i = 0; i < lyrics.data.length; i += CHUNK_SIZE) {
            const chunk = lyrics.data.slice(i, i + CHUNK_SIZE);

            chunk.forEach((s, chunkIndex) => {
                const dataIndex = i + chunkIndex;

                if (lineSinger === null && s.element) lineSinger = s.element.singer;
                lineStartTimeMs =
                    lineStartTimeMs === null ? s.startTime : Math.min(lineStartTimeMs, s.startTime);
                lineEndTimeMs =
                    lineEndTimeMs === null
                        ? s.startTime + s.duration
                        : Math.max(lineEndTimeMs, s.startTime + s.duration);
                const lineRTL = isRTL(s.text);

                wordBuffer.push(s);
                if (/\s$/.test(s.text) || s.isLineEnding || dataIndex === lyrics.data.length - 1) {
                    flushWordBuffer();
                }

                if (s.isLineEnding || dataIndex === lyrics.data.length - 1) {
                    if (lineStartTimeMs !== null && lineEndTimeMs !== null) {
                        currentLine.dataset.startTime = (lineStartTimeMs / 1000).toFixed(3);
                        currentLine.dataset.endTime = (lineEndTimeMs / 1000).toFixed(3);

                        currentLine.addEventListener('click', onPreviewLyricClick);

                        currentLine.classList.add(
                            (s.element && (s.element.singer === "v2" || s.element.singer === "v2000")) ? 'singer-right' : 'singer-left'
                        );
                        if (lineRTL) currentLine.classList.add('rtl-text');

                        fragment.appendChild(currentLine);
                    }

                    if (dataIndex !== lyrics.data.length - 1) {
                        currentLine = document.createElement('div');
                        currentLine.classList.add('lyrics-line');
                        mainContainer = document.createElement('div');
                        mainContainer.classList.add('main-vocal-container');
                        currentLine.appendChild(mainContainer);
                        backgroundContainer = null;
                        lineSinger = null;
                        lineStartTimeMs = null;
                        lineEndTimeMs = null;
                    }
                }
            });
        }

        flushWordBuffer();

    } else if (lyrics.data) {
        lyrics.data.forEach(line => {
            const lineDiv = document.createElement('div');
            lineDiv.dataset.startTime = line.startTime;
            lineDiv.dataset.endTime = line.endTime;
            lineDiv.classList.add('lyrics-line');
            if (line.element && line.element.singer) {
                lineDiv.classList.add(line.element.singer === "v2" ? 'singer-right' : 'singer-left');
            } else {
                lineDiv.classList.add('singer-left');
            }

            const mainContainer = document.createElement('div');
            mainContainer.classList.add('main-vocal-container');
            mainContainer.textContent = line.text;
            lineDiv.appendChild(mainContainer);

            if (isRTL(line.text)) lineDiv.classList.add('rtl-text');

            lineDiv.addEventListener('click', onPreviewLyricClick);

            fragment.appendChild(lineDiv);
        });
    }

    container.appendChild(fragment);

    const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
    if (originalLines.length > 0) {
        const firstLine = originalLines[0];
        const firstStartTimeSec = parseFloat(firstLine.dataset.startTime);

        if (firstStartTimeSec >= GAP_THRESHOLD) {
            const classesToInherit = [];
            if (firstLine.classList.contains('rtl-text')) classesToInherhes.push('rtl-text');
            if (firstLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
            if (firstLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

            const beginningGap = createPreviewGapLine(0, firstStartTimeSec - 0.85, classesToInherit);
            container.insertBefore(beginningGap, firstLine);
        }
    }

    const gapLinesToInsert = [];
    originalLines.forEach((line, index) => {
        if (index < originalLines.length - 1) {
            const nextLine = originalLines[index + 1];
            const currentEndSec = parseFloat(line.dataset.endTime);
            const nextStartSec = parseFloat(nextLine.dataset.startTime);
            if (nextStartSec - currentEndSec >= GAP_THRESHOLD) {
                const classesToInherit = [];
                if (nextLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
                if (nextLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
                if (nextLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

                const gapLine = createPreviewGapLine(currentEndSec + 0.4, nextStartSec - 0.85, classesToInherit);
                gapLinesToInsert.push({ gapLine, nextLine });
            }
        }
    });
    gapLinesToInsert.forEach(({ gapLine, nextLine }) => {
        container.insertBefore(gapLine, nextLine);
    });

    originalLines.forEach((line, idx) => {
        if (idx < originalLines.length - 1) {
            const currentEnd = parseFloat(line.dataset.endTime);
            const nextLine = originalLines[idx + 1];
            const nextStart = parseFloat(nextLine.dataset.startTime);
            const nextEnd = parseFloat(nextLine.dataset.endTime);
            const gap = nextStart - currentEnd;

            const nextElement = line.nextElementSibling;
            const isFollowedByGap = nextElement && nextElement.classList.contains('lyrics-gap');

            if (gap >= 0 && !isFollowedByGap) {
                const extension = Math.min(0.5, gap);
                line.dataset.endTime = (currentEnd + extension).toFixed(3);
            } else if (gap < 0) {
                line.dataset.endTime = nextEnd.toFixed(3);
            }
            for (let i = 0; i < idx; i++) {
                if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
                    originalLines[i].dataset.endTime = line.dataset.endTime;
                }
            }
        }
    });

    const metadataFragment = document.createDocumentFragment();
    if (songWriters && songWriters.length > 0) {
        const songWritersDiv = document.createElement('span');
        songWritersDiv.classList.add('lyrics-song-writters');
        songWritersDiv.innerText = `${t("writtenBy")} ${songWriters.join(', ')}`;
        metadataFragment.appendChild(songWritersDiv);
    }
    const sourceDiv = document.createElement('span');
    sourceDiv.classList.add('lyrics-source-provider');
    sourceDiv.innerText = `${t("source")} ${source}`;
    metadataFragment.appendChild(sourceDiv);
    container.appendChild(metadataFragment);

    previewCachedLyricsLines = Array.from(container.getElementsByClassName('lyrics-line'));
    previewCachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable'));

    ensurePreviewElementIds();

    previewCurrentPrimaryActiveLine = null;

    if (previewCachedLyricsLines.length > 0) {
        scrollPreviewActiveLine(previewCachedLyricsLines[0], true);
    }
}

function stopPreviewLyricsSync() {
    if (previewAnimationFrameId) {
        cancelAnimationFrame(previewAnimationFrameId);
        previewAnimationFrameId = null;
    }
    if (previewPlaybackInterval) {
        clearInterval(previewPlaybackInterval);
        previewPlaybackInterval = null;
    }
}

function cleanupPreviewLyrics() {
    stopPreviewLyricsSync();

    const container = getPreviewContainer();
    if (container) {
        container.innerHTML = '';
    }

    previewCachedLyricsLines = [];
    previewCachedSyllables = [];
    previewCurrentPrimaryActiveLine = null;
    previewFontCache = {};
}

function updatePreviewLyricsHighlight(currentTimeMs, isForceScroll = false) {
    if (!previewCachedLyricsLines || !previewCachedLyricsLines.length) return;

    let activeLinesThisFrame = [];

    previewCachedLyricsLines.forEach(line => {
        if (!line || !line.dataset.startTime || !line.dataset.endTime) return;

        const lineStartMs = parseFloat(line.dataset.startTime) * 1000;
        const lineEndMs = parseFloat(line.dataset.endTime) * 1000;

        const shouldBeActive = currentTimeMs >= lineStartMs - 190 && currentTimeMs <= lineEndMs - 1;

        if (shouldBeActive) {
            activeLinesThisFrame.push(line);
        }
    });

    activeLinesThisFrame.sort((a, b) => parseFloat(b.dataset.startTime) - parseFloat(a.dataset.startTime));

    const primaryActiveLines = activeLinesThisFrame.slice(0, 2);
    const primaryActiveLineIds = new Set(primaryActiveLines.map(l => l.id));

    previewCachedLyricsLines.forEach(line => {
        if (!line) return;
        const wasActive = line.classList.contains('active');
        const isNowPrimaryActive = primaryActiveLineIds.has(line.id);

        if (isNowPrimaryActive && !wasActive) {
            line.classList.add('active');
            if (primaryActiveLines.includes(line)) {
                if (!previewCurrentPrimaryActiveLine ||
                    (currentTimeMs >= previewLastTime && parseFloat(line.dataset.startTime) >= parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime)) ||
                    (currentTimeMs < previewLastTime && parseFloat(line.dataset.startTime) <= parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime)) ||
                    isForceScroll) {

                    if (line === primaryActiveLines[0] || isForceScroll) {
                        scrollPreviewActiveLine(line, isForceScroll);
                        previewCurrentPrimaryActiveLine = line;
                    }
                }
            }
        } else if (!isNowPrimaryActive && wasActive) {
            line.classList.remove('active');
            resetPreviewSyllables(line);
            if (previewCurrentPrimaryActiveLine === line) {
                previewCurrentPrimaryActiveLine = null;
            }
        }
    });
    updatePreviewSyllables(currentTimeMs);
}

function updatePreviewSyllables(currentTimeMs) {
    if (!previewCachedSyllables) return;

    previewCachedSyllables.forEach(syllable => {
        if (!syllable || !syllable.dataset.startTime || !syllable.dataset.duration) return;

        const parentLine = syllable.closest('.lyrics-line');
        if (!parentLine || !parentLine.classList.contains('active')) {
            if (syllable.classList.contains('highlight') || syllable.classList.contains('finished')) {
                resetPreviewSyllable(syllable);
            }
            return;
        }

        const startTimeMs = parseFloat(syllable.dataset.startTime);
        const durationMs = parseFloat(syllable.dataset.duration);
        const endTimeMs = startTimeMs + durationMs;

        const shouldBeHighlighted = currentTimeMs >= startTimeMs && currentTimeMs <= endTimeMs;
        const isFinished = currentTimeMs > endTimeMs;

        if (shouldBeHighlighted) {
            if (!syllable.classList.contains('highlight')) {
                updatePreviewSyllableAnimation(syllable, currentTimeMs);
            }
        } else if (isFinished) {
            if (!syllable.classList.contains('finished')) {
                syllable.classList.add('finished');
                if (syllable.classList.contains('highlight')) {
                    resetPreviewSyllable(syllable);
                    syllable.classList.add('finished');
                }
                if (!syllable.classList.contains('lyrics-gap')) {
                    syllable.style.animation = '';
                    const wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
                    syllable.style.animation = `${wipeAnimation} 0.01ms linear forwards`;
                    syllable.style.animationPlayState = 'paused';
                    requestAnimationFrame(() => {
                        syllable.style.backgroundSize = '100% 100%';
                        const charSpans = syllable.querySelectorAll('span.char');
                        charSpans.forEach(span => {
                            span.style.animation = '';
                            span.style.backgroundSize = '100% 100%';
                        });
                    });
                }
            }
        } else {
            if (syllable.classList.contains('highlight') || syllable.classList.contains('finished')) {
                resetPreviewSyllable(syllable);
            }
        }
    });
}

function updatePreviewSyllableAnimation(syllable, currentTimeMs) {
    if (syllable.classList.contains('highlight')) return;

    const startTimeMs = Number(syllable.dataset.startTime);
    const durationMs = Number(syllable.dataset.duration);

    let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
    const charSpans = syllable.querySelectorAll('span.char');

    syllable.classList.add('highlight');

    if (charSpans.length > 0) {
        const wordElement = syllable.closest('.lyrics-word');
        const finalWordDurationMs = Number(wordElement ? wordElement.dataset.totalDuration : null) || durationMs;

        const allCharsInWord = wordElement ? Array.from(wordElement.querySelectorAll('span.char')) : Array.from(charSpans);

        const baseGrowDelayPerCharMs = finalWordDurationMs * 0.07;

        allCharsInWord.forEach((charSpan, globalCharIndex) => {
            const charSyllable = charSpan.closest('.lyrics-syllable');
            const isCurrentSyllableChar = charSyllable === syllable;

            const horizontalOffset = charSpan.dataset.horizontalOffset || '0';
            charSpan.style.setProperty('--char-offset-x', `${horizontalOffset}px`);

            const growAnimationDelayMs = baseGrowDelayPerCharMs * globalCharIndex;

            if (isCurrentSyllableChar) {
                const charsInThisSyllable = Array.from(syllable.querySelectorAll('span.char'));
                const charIndexInSyllable = charsInThisSyllable.indexOf(charSpan);
                const charDurationMs = durationMs / charsInThisSyllable.length;
                const wipeAnimationDelayMs = charDurationMs * charIndexInSyllable;

                charSpan.style.animation =
                    `${wipeAnimation} ${charDurationMs.toFixed(0)}ms linear ${wipeAnimationDelayMs.toFixed(0)}ms forwards, ` +
                    `grow-dynamic ${(finalWordDurationMs * 1.2).toFixed(0)}ms ease-in-out ${growAnimationDelayMs.toFixed(0)}ms forwards`;
            } else if (wordElement && !charSyllable.classList.contains('highlight') && !charSyllable.classList.contains('finished')) {
                charSpan.style.animation = `grow-dynamic ${(finalWordDurationMs * 1.2).toFixed(0)}ms ease-in-out ${growAnimationDelayMs.toFixed(0)}ms forwards`;
            }
        });

    } else {
        if (syllable.parentElement && syllable.parentElement.parentElement && syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
            wipeAnimation = "fade-gap";
        }
        syllable.style.animation = `${wipeAnimation} ${durationMs.toFixed(0)}ms linear forwards`;
    }
}

function resetPreviewSyllable(syllable) {
    if (!syllable) return;

    syllable.style.animation = '';
    syllable.classList.remove('highlight');
    syllable.classList.remove('finished');
    syllable.style.backgroundSize = '0% 100%';

    const charSpans = syllable.querySelectorAll('span.char');
    charSpans.forEach(span => {
        span.style.animation = '';
        span.style.backgroundSize = '0% 100%';
    });
}

function resetPreviewSyllables(line) {
    if (!line) return;
    const syllables = line.getElementsByClassName('lyrics-syllable');
    for (let i = 0; i < syllables.length; i++) {
        resetPreviewSyllable(syllables[i]);
    }
}

function scrollPreviewActiveLine(activeLine, forceScroll = false) {
    const container = getPreviewContainer();
    if (!container || !activeLine) return;

    const scrollContainerRect = container.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();

    const safeZoneRatioTop = 0.25;
    const safeZoneRatioBottom = 0.75;

    const lineTopRelativeToContainer = lineRect.top - scrollContainerRect.top;
    const lineBottomRelativeToContainer = lineRect.bottom - scrollContainerRect.top;

    const shouldScroll = forceScroll ||
        lineTopRelativeToContainer < container.clientHeight * safeZoneRatioTop ||
        lineBottomRelativeToContainer > container.clientHeight * safeZoneRatioBottom;

    if (shouldScroll) {
        const targetScrollTop = container.scrollTop + lineTopRelativeToContainer - (container.clientHeight / 2) + (lineRect.height / 2);

        container.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth'
        });
    }
}

function getTextWidth(text, font) {
    if (!previewTextWidthCanvas) {
        previewTextWidthCanvas = document.createElement("canvas");
    }
    const context = previewTextWidthCanvas.getContext("2d");
    if (font) context.font = font;
    else context.font = getComputedStyle(document.body).font;

    return context.measureText(text).width;
}

function ensurePreviewElementIds() {
    if (!previewCachedLyricsLines || !previewCachedSyllables) return;
    previewCachedLyricsLines.forEach((line, i) => {
        if (line && !line.id) line.id = `preview-line-${i}`;
    });
    previewCachedSyllables.forEach((syllable, i) => {
        if (syllable && !syllable.id) syllable.id = `preview-syllable-${i}`;
    });
}

function startPreviewLyricsSyncAnimation() {
    stopPreviewLyricsSync();

    previewLastTime = previewCurrentTime;

    function syncPreview() {
        if (previewPlaybackInterval === null) return;

        const timeDeltaMs = Math.abs(previewCurrentTime - previewLastTime);
        const isForceScroll = timeDeltaMs > 1000;

        updatePreviewLyricsHighlight(previewCurrentTime, isForceScroll);

        previewLastTime = previewCurrentTime;
        previewAnimationFrameId = requestAnimationFrame(syncPreview);
    }
    previewAnimationFrameId = requestAnimationFrame(syncPreview);

    previewPlaybackInterval = setInterval(() => {
        previewCurrentTime += 100;
        if (previewCurrentTime > mockLyricsData.metadata.duration + 2000) {
            previewCurrentTime = 0;
        }
    }, 100);
}

export function startFullPreviewSync(currentSettings) {
    cleanupPreviewLyrics();
    previewCurrentTime = 0;

    displayPreviewLyrics(
        mockLyricsData,
        mockLyricsData.metadata.source,
        mockLyricsData.type,
        currentSettings.lightweight,
        mockLyricsData.metadata.artist
    );

    startPreviewLyricsSyncAnimation();
}
