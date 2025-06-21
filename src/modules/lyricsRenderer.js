// lyricsRenderer.js
// Use a variable to store the requestAnimationFrame ID
let lyricsAnimationFrameId = null;
let currentPrimaryActiveLine = null;
let lastTime = 0;
let lastKnownSongInfo = null; // Store last known song info for reload

// Performance optimization: Cache selectors and calculations
let lyricsContainer = null;
let cachedLyricsLines = [];
let cachedSyllables = [];
let activeLineIds = new Set();
let highlightedSyllableIds = new Set();
let visibleLineIds = new Set();
let lastProcessedTime = 0;
let fontCache = {};
let textWidthCanvas = null;
let visibilityObserver = null;
let translationButton = null; // Reference to the translation button
let reloadButton = null; // Reference to the reload button
let dropdownMenu = null; // Reference to the translation dropdown menu

// --- Core DOM Manipulation & Setup ---

// Cached DOM references
const getContainer = () => {
  if (!lyricsContainer) {
    lyricsContainer = document.getElementById('lyrics-plus-container') || createLyricsContainer();
  }
  return lyricsContainer;
};

function createLyricsContainer() {
  const originalLyricsSection = document.querySelector('#tab-renderer');
  if (!originalLyricsSection) {
    // console.log('Lyrics section not found'); // Keep console logs minimal for release
    return null;
  }
  const container = document.createElement('div');
  container.id = 'lyrics-plus-container';
  container.classList.add('lyrics-plus-integrated');
  originalLyricsSection.appendChild(container);
  injectCssFile();
  lyricsContainer = container;
  return container;
}

function injectCssFile() {
  if (document.querySelector('link[data-lyrics-plus-style]')) return;
  const pBrowser = chrome || browser;
  const linkElement = document.createElement('link');
  linkElement.rel = 'stylesheet';
  linkElement.type = 'text/css';
  linkElement.href = pBrowser.runtime.getURL('src/inject/stylesheet.css');
  linkElement.setAttribute('data-lyrics-plus-style', 'true');
  document.head.appendChild(linkElement);
}

// Performance optimization: Batch DOM manipulations
function batchDOMUpdates(callback) {
  requestAnimationFrame(() => {
    const fragment = document.createDocumentFragment();
    callback(fragment);
    getContainer().appendChild(fragment);
  });
}

// --- Lyrics Display & Rendering Logic ---

function displayLyrics(lyrics, source = "Unknown", type = "Line", lightweight = false, songWriters, songInfo, displayMode = 'none', currentSettings = {}) {
  const container = getContainer();
  if (!container) return;

  container.classList.remove('lyrics-translated', 'lyrics-romanized');
  if (displayMode === 'translate') {
    container.classList.add('lyrics-translated');
  } else if (displayMode === 'romanize') {
    container.classList.add('lyrics-romanized');
  }

  // Add compatibility classes based on settings
  if (currentSettings.compabilityVisibility) {
    container.classList.add('compability-visibility');
  } else {
    container.classList.remove('compability-visibility');
  }
  if (currentSettings.compabilityWipe) {
    container.classList.add('compability-wipe');
  } else {
    container.classList.remove('compability-wipe');
  }

  lastKnownSongInfo = songInfo;
  container.innerHTML = ''; // Clear container

  const elementPool = {
    lines: [],
    syllables: [],
    chars: [] // Pool for char spans if needed, currently used by flushWordBuffer
  };

  const onLyricClick = e => {
    const time = parseFloat(e.currentTarget.dataset.startTime); // Keep parseFloat here as it's infrequent
    const player = document.querySelector("video");
    if (player) player.currentTime = time;
    scrollToActiveLine(e.currentTarget, true);
  };

  const isRTL = text => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);
  const isCJK = text => /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);

  const GAP_THRESHOLD = 7; // seconds
  function createGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    const gapLine = elementPool.lines.pop() || document.createElement('div');
    gapLine.className = 'lyrics-line lyrics-gap';
    gapLine.dataset.startTime = gapStart;
    gapLine.dataset.endTime = gapEnd;

    if (!gapLine.hasClickListener) {
      gapLine.addEventListener('click', onLyricClick);
      gapLine.hasClickListener = true;
    }

    if (classesToInherit) {
      if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
      if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
      if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    // Clear previous main container if reusing pooled gapLine
    const existingMainContainer = gapLine.querySelector('.main-vocal-container');
    if (existingMainContainer) existingMainContainer.remove();

    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-vocal-container';

    for (let i = 0; i < 3; i++) {
      const syllableSpan = elementPool.syllables.pop() || document.createElement('span');
      syllableSpan.className = 'lyrics-syllable';
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = ((gapDuration / 3) / 0.9) * 1000;
      syllableSpan.dataset.startTime = syllableStart;
      syllableSpan.dataset.duration = syllableDuration;
      syllableSpan.dataset.endTime = syllableStart + syllableDuration;
      syllableSpan.textContent = "•";
      if (!syllableSpan.hasClickListener) {
        syllableSpan.addEventListener('click', onLyricClick);
        syllableSpan.hasClickListener = true;
      }
      mainContainer.appendChild(syllableSpan);
    }
    gapLine.appendChild(mainContainer);
    return gapLine;
  }

  const fragment = document.createDocumentFragment();
  const isWordByWordMode = type === "Word" && currentSettings.wordByWord;

  if (isWordByWordMode) {
    const getComputedFont = (element) => {
      if (!element) return '400 16px sans-serif';
      const cacheKey = element.tagName + (element.className || '');
      if (fontCache[cacheKey]) return fontCache[cacheKey];
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      fontCache[cacheKey] = font;
      return font;
    };

    lyrics.data.forEach((line, lineIndex) => {
      let currentLine = elementPool.lines.pop() || document.createElement('div');
      // Reset classes and content for pooled lines
      currentLine.innerHTML = '';
      currentLine.className = 'lyrics-line';
      currentLine.dataset.startTime = line.startTime; // Expecting seconds
      currentLine.dataset.endTime = line.endTime;     // Expecting seconds
      currentLine.classList.add(
        line.element.singer === "v2" || line.element.singer === "v2000" ? 'singer-right' : 'singer-left'
      );
      if (isRTL(line.text)) currentLine.classList.add('rtl-text');
      if (!currentLine.hasClickListener) {
        currentLine.addEventListener('click', onLyricClick);
        currentLine.hasClickListener = true;
      }

      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      currentLine.appendChild(mainContainer);

      if (line.translatedText &&
        (displayMode === 'translate' || displayMode === 'romanize') &&
        line.text.trim() !== line.translatedText.trim()) {
        const translationContainer = document.createElement('div');
        translationContainer.classList.add('lyrics-translation-container');
        translationContainer.textContent = line.translatedText;
        currentLine.appendChild(translationContainer);
      }

      let backgroundContainer = null;
      let wordBuffer = [];
      let currentWordStartTime = null; // in ms
      let currentWordEndTime = null;   // in ms
      // currentWordElement = {}; // Not used, can be removed

      const flushWordBuffer = () => {
        if (!wordBuffer.length) return;
        const wordSpan = elementPool.syllables.pop() || document.createElement('span'); // Using syllable pool for words too
        wordSpan.innerHTML = ''; // Clear if reusing
        wordSpan.className = 'lyrics-word'; // Reset class

        let referenceFont = mainContainer.firstChild ? getComputedFont(mainContainer.firstChild) : '400 16px sans-serif';
        const combinedText = wordBuffer.map(s => s.text).join('');
        const trimmedText = combinedText.trim();
        const totalDuration = currentWordEndTime - currentWordStartTime; // ms
        const shouldEmphasize = !lightweight && !isRTL(combinedText) && !isCJK(combinedText) && trimmedText.length <= 7 && totalDuration >= 1000;
        const durationFactor = Math.min(1.0, Math.max(0.5, (totalDuration - 1000) / 1000));
        let baseMinScale = 1.02;
        let baseMaxScale = 1;
        const durationScaleFactor = durationFactor * 0.15;
        baseMaxScale += durationScaleFactor;
        const maxScale = Math.min(1.2, baseMaxScale);
        const minScale = Math.max(1.0, Math.min(1.06, baseMinScale));
        const shadowIntensity = Math.min(0.8, 0.4 + (durationFactor * 0.4));
        const translateYPeak = -Math.min(3.0, 0.0 + (durationFactor * 3.0));
        wordSpan.style.setProperty('--max-scale', maxScale);
        wordSpan.style.setProperty('--min-scale', minScale);
        wordSpan.style.setProperty('--shadow-intensity', shadowIntensity);
        wordSpan.style.setProperty('--translate-y-peak', translateYPeak);
        wordSpan.dataset.totalDuration = totalDuration; // This is wordDuration for syllables
        let isCurrentWordBackground = wordBuffer[0].isBackground || false;
        const characterData = [];

        wordBuffer.forEach((s, syllableIndex) => {
          const sylSpan = elementPool.syllables.pop() || document.createElement('span');
          sylSpan.innerHTML = ''; // Clear if reusing
          sylSpan.className = 'lyrics-syllable'; // Reset class

          sylSpan.dataset.startTime = s.time; // ms
          sylSpan.dataset.duration = s.duration; // ms
          sylSpan.dataset.endTime = s.time + s.duration; // ms
          sylSpan.dataset.wordDuration = totalDuration; // ms
          sylSpan.dataset.syllableIndex = syllableIndex;
          if (!sylSpan.hasClickListener) {
            sylSpan.addEventListener('click', onLyricClick);
            sylSpan.hasClickListener = true;
          }
          if (isRTL(s.text)) sylSpan.classList.add('rtl-text');

          if (s.isBackground) {
            sylSpan.textContent = s.text.replace(/[()]/g, '');
          } else {
            if (shouldEmphasize) {
              wordSpan.classList.add('growable');
              let charIndex = 0;
              const textNodes = [];
              for (const char of s.text) {
                if (char === ' ') {
                  textNodes.push(document.createTextNode(' '));
                } else {
                  const charSpan = elementPool.chars.pop() || document.createElement('span');
                  charSpan.textContent = char;
                  charSpan.className = 'char'; // Reset class
                  charSpan.dataset.charIndex = charIndex++;
                  charSpan.dataset.syllableCharIndex = characterData.length;
                  characterData.push({ charSpan, syllableSpan: sylSpan, isBackground: s.isBackground });
                  textNodes.push(charSpan);
                }
              }
              textNodes.forEach(node => sylSpan.appendChild(node));
            } else {
              sylSpan.textContent = s.text;
            }
          }
          wordSpan.appendChild(sylSpan);
        });

        if (shouldEmphasize && characterData.length > 0) {
          const fullWordText = wordSpan.textContent; // This is fine for width calculation
          const wordWidth = getTextWidth(fullWordText, referenceFont);
          let cumulativeWidth = 0;
          characterData.forEach((charData) => {
            if (charData.isBackground) return;
            const span = charData.charSpan;
            const charText = span.textContent;
            if (charText.trim().length > 0) {
              const charWidth = getTextWidth(charText, referenceFont);
              const charCenter = cumulativeWidth + (charWidth / 2);
              const position = charCenter / wordWidth;
              const relativePosition = (position - 0.5) * 2;
              const scaleOffset = maxScale - 1.0;
              const horizontalOffsetFactor = scaleOffset * 40;
              const horizontalOffset = Math.sign(relativePosition) * Math.pow(Math.abs(relativePosition), 1.3) * horizontalOffsetFactor;
              span.dataset.horizontalOffset = horizontalOffset;
              span.dataset.position = position;
              cumulativeWidth += charWidth;
            }
          });
        }

        if (isCurrentWordBackground) {
          if (!backgroundContainer) {
            backgroundContainer = document.createElement('div');
            backgroundContainer.classList.add('background-vocal-container');
            currentLine.appendChild(backgroundContainer);
          }
          backgroundContainer.appendChild(wordSpan);
        } else {
          mainContainer.appendChild(wordSpan);
        }
        wordBuffer = [];
        currentWordStartTime = null;
        currentWordEndTime = null;
        // currentWordElement = {}; // Not used
      };

      if (line.syllabus && line.syllabus.length > 0) {
        line.syllabus.forEach((s, syllableIndex) => { // s.time and s.duration are in ms
          if (wordBuffer.length === 0) currentWordStartTime = s.time;
          wordBuffer.push(s);
          currentWordEndTime = s.time + s.duration;
          // currentWordElement = s.element || {}; // Not used
          const isLastSyllableInLine = syllableIndex === line.syllabus.length - 1;
          const nextSyllable = line.syllabus[syllableIndex + 1];
          const endsWithExplicitDelimiter = s.isLineEnding || /\s$/.test(s.text);
          const isBackgroundStatusChangingWithoutDelimiter = nextSyllable && (s.isBackground !== nextSyllable.isBackground) && !endsWithExplicitDelimiter;
          if (endsWithExplicitDelimiter || isLastSyllableInLine || isBackgroundStatusChangingWithoutDelimiter) {
            flushWordBuffer();
          }
        });
      } else {
        mainContainer.textContent = line.text;
      }
      fragment.appendChild(currentLine);
    });
  } else {
    // "Line" mode
    const lineFragment = document.createDocumentFragment();
    lyrics.data.forEach(line => {
      const lineDiv = elementPool.lines.pop() || document.createElement('div');
      lineDiv.innerHTML = ''; // Clear if reusing
      lineDiv.className = 'lyrics-line'; // Reset class

      lineDiv.dataset.startTime = line.startTime; // Expecting seconds
      lineDiv.dataset.endTime = line.endTime;   // Expecting seconds
      lineDiv.classList.add(line.element.singer === "v2" ? 'singer-right' : 'singer-left');
      if (isRTL(line.text)) lineDiv.classList.add('rtl-text');
      if (!lineDiv.hasClickListener) {
        lineDiv.addEventListener('click', onLyricClick);
        lineDiv.hasClickListener = true;
      }

      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      mainContainer.textContent = line.text;
      lineDiv.appendChild(mainContainer);

      if (line.translatedText &&
        (displayMode === 'translate' || displayMode === 'romanize') &&
        line.text.trim() !== line.translatedText.trim()) {
        const translationContainer = document.createElement('div');
        translationContainer.classList.add('lyrics-translation-container');
        translationContainer.textContent = line.translatedText;
        lineDiv.appendChild(translationContainer);
      }
      lineFragment.appendChild(lineDiv);
    });
    fragment.appendChild(lineFragment);
  }

  container.appendChild(fragment);

  const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
  if (originalLines.length > 0) {
    const firstLine = originalLines[0];
    const firstStartTime = parseFloat(firstLine.dataset.startTime);
    if (firstStartTime >= GAP_THRESHOLD) {
      const classesToInherit = [];
      if (firstLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
      if (firstLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
      if (firstLine.classList.contains('singer-right')) classesToInherit.push('singer-right');
      const beginningGap = createGapLine(0, firstStartTime - 0.85, classesToInherit);
      container.insertBefore(beginningGap, firstLine);
    }
  }

  const gapLinesToInsert = [];
  originalLines.forEach((line, index) => {
    if (index < originalLines.length - 1) {
      const nextLine = originalLines[index + 1];
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextStart = parseFloat(nextLine.dataset.startTime);
      if (nextStart - currentEnd >= GAP_THRESHOLD) {
        const classesToInherit = [];
        if (nextLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
        if (nextLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
        if (nextLine.classList.contains('singer-right')) classesToInherit.push('singer-right');
        const gapLine = createGapLine(currentEnd + 0.4, nextStart - 0.85, classesToInherit);
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
        for (let i = 0; i < idx; i++) {
          if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
            originalLines[i].dataset.endTime = line.dataset.endTime;
          }
        }
      } else if (gap < 0) {
        line.dataset.endTime = nextEnd.toFixed(3);
        for (let i = 0; i < idx; i++) {
          if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
            originalLines[i].dataset.endTime = nextEnd.toFixed(3);
          }
        }
      }
    }
  });

  const metadataFragment = document.createDocumentFragment();
  if (songWriters) {
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

  // Pre-parse times and cache them
  cachedLyricsLines = Array.from(container.getElementsByClassName('lyrics-line')).map(line => {
    if (line) {
      line._startTimeMs = parseFloat(line.dataset.startTime) * 1000;
      line._endTimeMs = parseFloat(line.dataset.endTime) * 1000;
    }
    return line;
  }).filter(Boolean); // Filter out any null/undefined elements

  cachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable')).map(syllable => {
    if (syllable) {
      syllable._startTimeMs = parseFloat(syllable.dataset.startTime);
      syllable._durationMs = parseFloat(syllable.dataset.duration);
      syllable._endTimeMs = syllable._startTimeMs + syllable._durationMs;
      // Pre-parse wordDuration if present
      const wordDuration = parseFloat(syllable.dataset.wordDuration);
      syllable._wordDurationMs = isNaN(wordDuration) ? null : wordDuration;
    }
    return syllable;
  }).filter(Boolean);

  ensureElementIds();
  activeLineIds.clear();
  highlightedSyllableIds.clear();
  visibleLineIds.clear();
  currentPrimaryActiveLine = null;

  if (cachedLyricsLines.length !== 0) {
    scrollToActiveLine(cachedLyricsLines[0], true);
  }
  startLyricsSync(currentSettings); // Pass currentSettings
  createControlButtons(getContainer());
}

function displaySongNotFound() {
  const container = getContainer();
  if (container) {
    container.innerHTML = `<span class="text-not-found">${t("notFound")}</span>`;
  }
}

function displaySongError() {
  const container = getContainer();
  if (container) {
    container.innerHTML = `<span class="text-not-found">${t("notFoundError")}</span>`;
  }
}

// --- Text, Style, and ID Utilities ---

function getTextWidth(text, font) {
  // textWidthCanvas is already cached globally, no change needed here.
  const canvas = textWidthCanvas || (textWidthCanvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
}

function getCssStyle(element, prop) {
  return window.getComputedStyle(element, null).getPropertyValue(prop);
}

function getCanvasFont(el = document.body) {
  const fontWeight = getCssStyle(el, 'font-weight') || 'normal';
  const fontSize = getCssStyle(el, 'font-size') || '16px';
  const fontFamily = getCssStyle(el, 'font-family') || 'Times New Roman';
  return `${fontWeight} ${fontSize} ${fontFamily}`;
}

function ensureElementIds() {
  if (!cachedLyricsLines || !cachedSyllables) return;
  cachedLyricsLines.forEach((line, i) => {
    if (line && !line.id) line.id = `line-${i}`;
  });
  cachedSyllables.forEach((syllable, i) => {
    if (syllable && !syllable.id) syllable.id = `syllable-${i}`;
  });
}

// --- Lyrics Synchronization & Highlighting ---

function startLyricsSync(currentSettings = {}) { // Added default for currentSettings
  const videoElement = document.querySelector('video');
  if (!videoElement) return;
  ensureElementIds(); // Ensure IDs before sync
  const obs = setupVisibilityTracking();
  if (lyricsAnimationFrameId) {
    cancelAnimationFrame(lyricsAnimationFrameId);
  }
  lastTime = videoElement.currentTime * 1000;

  function sync() {
    const currentTime = videoElement.currentTime * 1000;
    const timeDelta = Math.abs(currentTime - lastTime);
    const isForceScroll = timeDelta > 1000; // Threshold for seeking
    // Pass currentSettings to updateLyricsHighlight
    updateLyricsHighlight(currentTime, isForceScroll, currentSettings);
    lastTime = currentTime;
    lyricsAnimationFrameId = requestAnimationFrame(sync);
  }
  lyricsAnimationFrameId = requestAnimationFrame(sync);
  return () => {
    if (obs) obs.disconnect();
    if (lyricsAnimationFrameId) {
      cancelAnimationFrame(lyricsAnimationFrameId);
      lyricsAnimationFrameId = null;
    }
  };
}

function updateLyricsHighlight(currentTime, isForceScroll = false, currentSettings = {}) {
  if (!cachedLyricsLines || !cachedLyricsLines.length) return;

  let activeLines = []; // To store actual line elements
  const container = document.querySelector("#lyrics-plus-container");
  const compabilityVisibilityEnabled = container.classList.contains('compability-visibility');

  // Iterate over cachedLyricsLines, using pre-parsed times
  cachedLyricsLines.forEach(line => {
    if (!line || typeof line._startTimeMs !== 'number' || typeof line._endTimeMs !== 'number') return;
    const lineStart = line._startTimeMs;
    const lineEnd = line._endTimeMs;
    const shouldBeActive = currentTime >= lineStart - 190 && currentTime <= lineEnd - 1;

    if (shouldBeActive) {
      activeLines.push(line);
    }

    if (compabilityVisibilityEnabled) {
      const scrollContainer = container.parentElement;
      if (scrollContainer) {
        const scrollContainerRect = scrollContainer.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        const isOutOfView = lineRect.bottom < scrollContainerRect.top || lineRect.top > scrollContainerRect.bottom;
        if (isOutOfView) {
          line.classList.add('viewport-hidden');
        } else {
          line.classList.remove('viewport-hidden');
        }
      }
    }
  });

  // Sort active lines by start time (most recent first)
  // This sort is on a very small array (max 2 after slice), so performance is fine.
  activeLines.sort((a, b) => b._startTimeMs - a._startTimeMs);
  const allowedActiveLines = activeLines.slice(0, 2);
  const newActiveLineIds = new Set(allowedActiveLines.map(line => line.id));

  cachedLyricsLines.forEach(line => {
    if (!line) return;
    const wasActive = activeLineIds.has(line.id); // Check against old activeLineIds Set
    const shouldBeActive = newActiveLineIds.has(line.id);

    if (shouldBeActive && !wasActive) {
      line.classList.add('active');
      if (!currentPrimaryActiveLine ||
        (currentTime >= lastTime && line._startTimeMs > currentPrimaryActiveLine._startTimeMs) ||
        (currentTime < lastTime && line._startTimeMs < currentPrimaryActiveLine._startTimeMs)) {
        // scrollActiveLine will determine if actual scroll is needed
        scrollActiveLine(currentTime, isForceScroll);
        currentPrimaryActiveLine = line;
      }
    } else if (!shouldBeActive && wasActive) {
      line.classList.remove('active');
      resetSyllables(line);
    }
  });
  activeLineIds = newActiveLineIds; // Update the global set
  updateSyllables(currentTime);
}

function updateSyllables(currentTime) { // currentTime is in ms
  if (!cachedSyllables) return;
  let newHighlightedSyllableIds = new Set();
  cachedSyllables.forEach(syllable => {
    if (!syllable || typeof syllable._startTimeMs !== 'number' || typeof syllable._endTimeMs !== 'number') return;

    const parentLine = syllable.closest('.lyrics-line'); // This is okay, happens per syllable
    if (!parentLine || !activeLineIds.has(parentLine.id)) { // More efficient check using activeLineIds
      if (syllable.classList.contains('highlight')) resetSyllable(syllable);
      return;
    }

    const startTime = syllable._startTimeMs;
    const endTime = syllable._endTimeMs; // Uses pre-parsed _endTimeMs

    if (currentTime >= startTime && currentTime <= endTime) {
      newHighlightedSyllableIds.add(syllable.id);
      if (!syllable.classList.contains('highlight')) updateSyllableAnimation(syllable, currentTime);
    } else if (currentTime < startTime && syllable.classList.contains('highlight')) {
      resetSyllable(syllable);
    } else if (currentTime > startTime && !syllable.classList.contains('finished')) {
      syllable.classList.add('finished');
    } else if (currentTime > startTime && !syllable.classList.contains('highlight')) {
      // This case means the syllable was missed, set it to its fully highlighted start state
      updateSyllableAnimation(syllable, startTime);
    }
  });
  highlightedSyllableIds = newHighlightedSyllableIds;
}

function updateSyllableAnimation(syllable, currentTime) { // currentTime in ms
  if (syllable.classList.contains('highlight')) return;

  const startTime = syllable._startTimeMs;
  const duration = syllable._durationMs; // Pre-parsed
  const endTime = syllable._endTimeMs;   // Pre-parsed

  if (currentTime < startTime || currentTime > endTime) return;

  let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
  const charSpansNodeList = syllable.querySelectorAll('span.char');

  syllable.classList.add('highlight');

  if (charSpansNodeList.length > 0) {
    const wordElement = syllable.closest('.lyrics-word');
    // Use pre-parsed word duration if available, otherwise syllable's duration
    const finalDuration = syllable._wordDurationMs !== null ? syllable._wordDurationMs : duration;

    let spansToAnimate; // All characters in the word for grow animation
    if (wordElement && wordElement.classList.contains('growable')) {
      if (!wordElement._cachedChars) { // Cache char elements on the wordElement
        wordElement._cachedChars = Array.from(wordElement.querySelectorAll('span.char'));
      }
      spansToAnimate = wordElement._cachedChars;
    } else {
      // Fallback: This case should ideally not be hit if charSpans exist,
      // as it implies 'shouldEmphasize' was true during creation.
      // If it is hit, animate only chars in the current syllable.
      spansToAnimate = Array.from(charSpansNodeList);
    }

    const totalCharsInWord = spansToAnimate.length;

    if (totalCharsInWord > 0) {
      const baseDelayPerChar = finalDuration * 0.07;
      // Convert current syllable's charSpansNodeList to array once for indexOf
      const currentSyllableCharSpansArray = Array.from(charSpansNodeList);
      const charCountInCurrentSyllable = currentSyllableCharSpansArray.length;

      for (let i = 0; i < totalCharsInWord; i++) {
        const span = spansToAnimate[i]; // This is a char span from the entire word
        const spanSyllable = span.closest('.lyrics-syllable');
        const isCurrentSyllable = (spanSyllable === syllable);

        const horizontalOffset = parseFloat(span.dataset.horizontalOffset) || 0;
        span.style.setProperty('--char-offset-x', `${horizontalOffset}`);

        // charIndex is the index within the entire word
        const charIndexInWord = parseFloat(span.dataset.syllableCharIndex);
        const growDelay = baseDelayPerChar * charIndexInWord;

        if (isCurrentSyllable) {
          const charIndexInSyllable = currentSyllableCharSpansArray.indexOf(span);

          if (charIndexInSyllable !== -1 && charCountInCurrentSyllable > 0) {
            const wipeDelay = (duration / charCountInCurrentSyllable) * charIndexInSyllable;
            const preWipeDelay = (duration / charCountInCurrentSyllable) * (charIndexInSyllable - 1);

            span.style.animation = `pre-wipe-char ${(duration / charCountInCurrentSyllable)}ms linear ${preWipeDelay}ms,
                                    ${wipeAnimation} ${duration / charCountInCurrentSyllable}ms linear ${wipeDelay}ms forwards,
                                    grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
          } else if (!spanSyllable.classList.contains('highlight')) { // Should be caught by outer if
            span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
          }
        } else if (!spanSyllable.classList.contains('highlight')) { // Char in another syllable of the same word
          span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
        }
      }
    }
  } else {
    // For syllables without character spans
    // syllable.parentElement is wordSpan, syllable.parentElement.parentElement is main/background-vocal-container
    // For gap lines, syllable.parentElement is main-vocal-container, syllable.parentElement.parentElement is lyrics-gap line
    if (syllable.parentElement && syllable.parentElement.parentElement &&
      syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
      wipeAnimation = "fade-gap";
    }
    syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
  }
}

// Reset a single syllable
function resetSyllable(syllable) {
  if (!syllable) return;
  syllable.style.animation = '';
  syllable.classList.remove('highlight', 'finished');
  const charSpans = syllable.querySelectorAll('span.char'); // Query is fine for infrequent reset
  charSpans.forEach(span => { span.style.animation = ''; });
}

function resetSyllables(line) {
  if (!line) return;
  const syllables = line.getElementsByClassName('lyrics-syllable');
  for (let i = 0; i < syllables.length; i++) {
    resetSyllable(syllables[i]);
  }
}

// --- Scrolling Logic ---

function scrollActiveLine(currentTime, forceScroll = false) {
  const container = document.querySelector("#lyrics-plus-container");
  const activeLines = container.querySelectorAll('.lyrics-line.active');
  if (!activeLines.length) return;

  // Find the most relevant active line based on timing
  let lineToScroll = activeLines[0];
  let activestLine = activeLines[activeLines.length - 1];

  if (activeLines.length > 1) {
    // Find line that hasn't ended yet or is ending soon
    for (const line of activeLines) {
      const endTime = parseFloat(line.dataset.endTime) * 1000;
      if (endTime - currentTime > 200) {
        lineToScroll = line;
        break;
      }
    }
  }

  // Get all lyrics lines and find index of scroll line
  const allLyricLines = container.querySelectorAll('.lyrics-line');
  const scrollLineIndex = Array.from(allLyricLines).indexOf(lineToScroll);

  // Clear previous position classes
  const positionClasses = ['lyrics-activest', 'pre-active-line', 'next-active-line'];
  for (let i = 1; i <= 4; i++) {
    positionClasses.push(`prev-${i}`, `next-${i}`);
  }

  container.querySelectorAll('.' + positionClasses.join(', .'))
    .forEach(el => el.classList.remove(...positionClasses));

  // Mark activest line
  activestLine.classList.add('lyrics-activest');

  // Add position classes only to relevant lines
  for (let i = Math.max(0, scrollLineIndex - 4); i <= Math.min(allLyricLines.length - 1, scrollLineIndex + 4); i++) {
    const position = i - scrollLineIndex;
    const line = allLyricLines[i];

    if (position === -1) line.classList.add('pre-active-line');
    else if (position === 1) line.classList.add('next-active-line');
    else if (position <= -1 && position >= -4) line.classList.add(`prev-${Math.abs(position)}`);
    else if (position >= 1 && position <= 4) line.classList.add(`next-${position}`);
  }

  scrollToActiveLine(lineToScroll, forceScroll);
}

function scrollToActiveLine(activeLine, forceScroll = false) {
  if (!activeLine) return;

  // Get the lyrics container element
  const container = document.querySelector("#lyrics-plus-container");
  if (!container) return;

  const compabilityVisibilityEnabled = container.classList.contains('compability-visibility');

  // Only proceed if the container is visible (displayed as block)
  const computedStyle = getComputedStyle(container);
  if (computedStyle.display !== 'block') return;

  // The actual scroll container is the parent element (what the user sees)
  const scrollContainer = container.parentElement;
  if (!scrollContainer) return;

  const scrollContainerRect = scrollContainer.getBoundingClientRect();

  // Get the bounding rectangle of the active line
  const lineRect = activeLine.getBoundingClientRect();

  // Define the safe area based on the visible scroll container.
  const safeAreaTop = scrollContainerRect.top + scrollContainerRect.height * 0.15;
  const safeAreaBottom = scrollContainerRect.top + scrollContainerRect.height * 0.95;

  // Check if the line is outside the safe area
  const lineIsInsideSafeArea = lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom;

  // Correct logic: Scroll if line is outside safe area OR forceScroll is true
  if (lineIsInsideSafeArea && !forceScroll) {
    // Line is already in the visible area and we're not forcing a scroll
    return;
  }

  // Scroll the scroll container to the target position
  activeLine.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

// --- Visibility Tracking ---

function setupVisibilityTracking() {
  const container = getContainer();
  if (!container || !container.parentElement) return null;
  if (visibilityObserver) {
    visibilityObserver.disconnect();
  }
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          visibleLineIds.add(entry.target.id);
        } else {
          visibleLineIds.delete(entry.target.id);
        }
      });
    },
    { root: container.parentElement, rootMargin: '200px 0px', threshold: 0.1 }
  );
  if (cachedLyricsLines) {
    cachedLyricsLines.forEach(line => {
      if (line) visibilityObserver.observe(line);
    });
  }
  return visibilityObserver;
}

// --- Control Buttons & UI ---

function createControlButtons(sourceDivElement) {
  let buttonsWrapper = document.getElementById('lyrics-plus-buttons-wrapper');
  if (!buttonsWrapper) {
    buttonsWrapper = document.createElement('div');
    buttonsWrapper.id = 'lyrics-plus-buttons-wrapper';
    if (sourceDivElement && sourceDivElement.parentNode) {
      sourceDivElement.parentNode.insertBefore(buttonsWrapper, sourceDivElement.nextSibling);
    } else {
      const cont = getContainer();
      if (cont) cont.appendChild(buttonsWrapper); // Fallback
    }
  }

  if (window.LyricsPlusAPI && setCurrentDisplayModeAndRefetch) {
    if (!translationButton) {
      translationButton = document.createElement('button');
      translationButton.id = 'lyrics-plus-translate-button';
      buttonsWrapper.appendChild(translationButton);
      updateTranslationButtonText();

      translationButton.addEventListener('click', (event) => {
        event.stopPropagation();
        createDropdownMenu(buttonsWrapper);
        if (dropdownMenu) dropdownMenu.classList.toggle('hidden');
      });

      document.addEventListener('click', (event) => {
        if (dropdownMenu && !dropdownMenu.classList.contains('hidden') &&
          !dropdownMenu.contains(event.target) && event.target !== translationButton) {
          dropdownMenu.classList.add('hidden');
        }
      });
    }
  } else {
    // console.warn("LyricsPlusAPI.setCurrentDisplayModeAndRefetch not available. Translation controls disabled.");
  }


  if (!reloadButton) {
    reloadButton = document.createElement('button');
    reloadButton.id = 'lyrics-plus-reload-button';
    reloadButton.innerHTML = '↻';
    reloadButton.title = t('Reload Lyrics'); // Assuming t() is available globally
    buttonsWrapper.appendChild(reloadButton);

    reloadButton.addEventListener('click', () => {
      if (lastKnownSongInfo && window.LyricsPlusAPI && fetchAndDisplayLyrics) {
        fetchAndDisplayLyrics(lastKnownSongInfo, true, true);
      } else {
        // console.warn('Cannot reload lyrics: song info or API not available.');
      }
    });
  }
}

function createDropdownMenu(parentWrapper) {
  if (dropdownMenu) {
    dropdownMenu.innerHTML = ''; // Clear existing options
  } else {
    dropdownMenu = document.createElement('div');
    dropdownMenu.id = 'lyrics-plus-translation-dropdown';
    dropdownMenu.classList.add('hidden'); // Initially hidden
    if (parentWrapper) {
      parentWrapper.appendChild(dropdownMenu);
    } else {
      // console.warn("Cannot create dropdown, parent wrapper not found."); // Keep console logs minimal
      return;
    }
  }

  // Use renderer's currentDisplayMode (synced by manager) to build menu
  if (currentDisplayMode !== 'translate') {
    const showTranslateOption = document.createElement('div');
    showTranslateOption.classList.add('dropdown-option');
    showTranslateOption.textContent = t('showTranslation');
    showTranslateOption.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      if (setCurrentDisplayModeAndRefetch) {
        setCurrentDisplayModeAndRefetch('translate', lastKnownSongInfo);
      }
    });
    dropdownMenu.appendChild(showTranslateOption);
  }

  if (currentDisplayMode !== 'romanize') {
    const showRomanizeOption = document.createElement('div');
    showRomanizeOption.classList.add('dropdown-option');
    showRomanizeOption.textContent = t('showPronunciation');
    showRomanizeOption.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      if (setCurrentDisplayModeAndRefetch) {
        setCurrentDisplayModeAndRefetch('romanize', lastKnownSongInfo);
      }
    });
    dropdownMenu.appendChild(showRomanizeOption);
  }

  if (currentDisplayMode !== 'none') {
    const separator = document.createElement('div');
    separator.classList.add('dropdown-separator');
    dropdownMenu.appendChild(separator);

    const hideOption = document.createElement('div');
    hideOption.classList.add('dropdown-option');
    hideOption.textContent = currentDisplayMode === 'translate' ? t('hideTranslation') : t('hidePronunciation');
    hideOption.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      if (setCurrentDisplayModeAndRefetch) {
        setCurrentDisplayModeAndRefetch('none', lastKnownSongInfo);
      }
    });
    dropdownMenu.appendChild(hideOption);
  }
  if (dropdownMenu.children.length === 0) {
    const noOptionsText = document.createElement('div');
    noOptionsText.textContent = "No options available";
    noOptionsText.style.padding = "5px";
    noOptionsText.style.color = "grey";
    dropdownMenu.appendChild(noOptionsText);
  }
}

function updateTranslationButtonText() {
  if (!translationButton) return;
  translationButton.innerHTML = '⋯'; // Ellipsis
  translationButton.title = t('showTranslationOptions');
}

// --- Cleanup ---

function cleanupLyrics() {
  if (lyricsAnimationFrameId) {
    cancelAnimationFrame(lyricsAnimationFrameId);
    lyricsAnimationFrameId = null;
  }
  const container = getContainer();
  if (container) {
    container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
  }
  activeLineIds.clear();
  highlightedSyllableIds.clear();
  visibleLineIds.clear();
  currentPrimaryActiveLine = null;
  if (visibilityObserver) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }
  // Clear cached DOM element arrays
  cachedLyricsLines = [];
  cachedSyllables = [];
}
