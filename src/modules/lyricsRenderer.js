// lyricsRenderer.js
// Use a variable to store the requestAnimationFrame ID
let lyricsAnimationFrameId = null;
let currentPrimaryActiveLine = null;
let lastTime = 0;

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

let isProgrammaticScrolling = false; // True if a scroll was initiated programmatically and is still settling
let endProgrammaticScrollTimer = null; // Timer to manage the end of programmatic scrolling state
let scrollEventHandlerAttached = false;

// --- Core DOM Manipulation & Setup ---

// Cached DOM references
const getContainer = () => {
  if (!lyricsContainer) {
    lyricsContainer = document.getElementById('lyrics-plus-container');
    if (!lyricsContainer) {
      // createLyricsContainer will set the global lyricsContainer
      // and call setupUserScrollListener internally if successful.
      createLyricsContainer(); // This might set lyricsContainer to null if unsuccessful
    }
  }
  // After lyricsContainer is potentially set (either found or created),
  // try to set up the listener if not already done.
  // setupUserScrollListener has internal checks.
  if (lyricsContainer && lyricsContainer.parentElement && !scrollEventHandlerAttached) {
    setupUserScrollListener();
  }
  return lyricsContainer;
};

function createLyricsContainer() {
  const originalLyricsSection = document.querySelector('#tab-renderer');
  if (!originalLyricsSection) {
    // console.log('Lyrics section not found');
    lyricsContainer = null; // Ensure lyricsContainer is null if creation fails
    return null;
  }
  const container = document.createElement('div');
  container.id = 'lyrics-plus-container';
  container.classList.add('lyrics-plus-integrated', 'blur-inactive-enabled');
  originalLyricsSection.appendChild(container);
  injectCssFile();
  lyricsContainer = container; // Set global lyricsContainer
  setupUserScrollListener(); // Call setup after container is in DOM and lyricsContainer is set
  return container;
}

// ---- NEW FUNCTION ----
function setupUserScrollListener() {
  // Ensure lyricsContainer and its parent exist, and listener not already attached
  if (scrollEventHandlerAttached || !lyricsContainer || !lyricsContainer.parentElement) {
    return;
  }

  const scrollListeningElement = lyricsContainer.parentElement; // This is the element that scrolls (e.g., #tab-renderer)

  scrollListeningElement.addEventListener('scroll', () => {
    if (isProgrammaticScrolling) {
      // This scroll event is part of a programmatic scroll sequence (e.g., scrollIntoView + animations).
      // We debounce to detect the actual end of this sequence.
      clearTimeout(endProgrammaticScrollTimer);
      endProgrammaticScrollTimer = setTimeout(() => {
        isProgrammaticScrolling = false;
        endProgrammaticScrollTimer = null;
        // console.log('Debounced: Programmatic scroll sequence considered ended.');
      }, 250); // If no scroll events for 250ms, assume the programmatic scroll sequence is over.
      return;
    }

    // If not isProgrammaticScrolling, this scroll is considered user-initiated.
    if (lyricsContainer) {
      lyricsContainer.classList.add('not-focused');
    }
  }, { passive: true });

  scrollEventHandlerAttached = true;
  // console.log('User scroll listener attached to:', scrollListeningElement);
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

  // Handle song palette options
  if (currentSettings.useSongPaletteFullscreen) {
    container.classList.add('use-song-palette-fullscreen');
  } else {
    container.classList.remove('use-song-palette-fullscreen');
  }

  if (currentSettings.useSongPaletteAllModes) {
    container.classList.add('use-song-palette-all-modes');
  } else {
    container.classList.remove('use-song-palette-all-modes');
  }

  // Handle override palette color first
  if (currentSettings.overridePaletteColor) {
    container.classList.add('override-palette-color');
    container.style.setProperty('--lyplus-override-pallete', currentSettings.overridePaletteColor);
    container.style.setProperty('--lyplus-override-pallete-white', `${currentSettings.overridePaletteColor}85`);
    // Ensure song palette classes are removed if override is active
    container.classList.remove('use-song-palette-fullscreen');
    container.classList.remove('use-song-palette-all-modes');
  } else {
    container.classList.remove('override-palette-color');
    // Only apply song palette if override is NOT active
    if (currentSettings.useSongPaletteFullscreen) {
      container.classList.add('use-song-palette-fullscreen');
    } else {
      container.classList.remove('use-song-palette-fullscreen');
    }

    if (currentSettings.useSongPaletteAllModes) {
      container.classList.add('use-song-palette-all-modes');
    } else {
      container.classList.remove('use-song-palette-all-modes');
    }

    if (currentSettings.useSongPaletteFullscreen || currentSettings.useSongPaletteAllModes) {
      if (typeof LYPLUS_getSongPalette === 'function') {
        const songPalette = LYPLUS_getSongPalette();
        if (songPalette) {
          const { r, g, b } = songPalette;
          const color = `rgb(${r}, ${g}, ${b})`;
          container.style.setProperty('--lyplus-song-pallete', color);

          // Blend with #ffffff at 85/255 alpha
          const alpha = 133 / 255;
          const r_blend = Math.round(alpha * 255 + (1 - alpha) * r);
          const g_blend = Math.round(alpha * 255 + (1 - alpha) * g);
          const b_blend = Math.round(alpha * 255 + (1 - alpha) * b);
          const whitePalleteColor = `rgb(${r_blend}, ${g_blend}, ${b_blend})`;
          container.style.setProperty('--lyplus-song-white-pallete', whitePalleteColor);
        }
      }
    }
  }

  container.classList.toggle('fullscreen', document.body.hasAttribute('player-fullscreened_'));
  
  const isWordByWordMode = type === "Word" && currentSettings.wordByWord;
  container.classList.toggle('word-by-word-mode', isWordByWordMode);
  container.classList.toggle('line-by-line-mode', !isWordByWordMode);

  container.classList.remove('lyrics-translated', 'lyrics-romanized');""
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

  container.innerHTML = ''; // Clear container

  // Determine singer alignment based on a hierarchy of singer types present in the song.
  const singerClassMap = {};
  if (lyrics && lyrics.data && lyrics.data.length > 0) {
    const allSingers = [...new Set(lyrics.data.map(line => line.element?.singer).filter(Boolean))];

    // Categorize singers based on their typical role and sort them to establish a consistent hierarchy.
    const leftCandidates = allSingers.filter(s => s === 'v1' || s === 'v1000').sort(); // 'v1' comes before 'v1000'
    const rightCandidates = allSingers.filter(s => s === 'v2' || s === 'v2000').sort(); // 'v2' comes before 'v2000'

    if (leftCandidates.length > 0 && rightCandidates.length > 0) {
      // Standard case: Both left and right singers exist. Assign them to their default sides.
      leftCandidates.forEach(s => singerClassMap[s] = 'singer-left');
      rightCandidates.forEach(s => singerClassMap[s] = 'singer-right');
    } else if (leftCandidates.length > 1) {
      // Only "left" type singers exist. Make the primary one ('v1') left and others right for contrast.
      singerClassMap[leftCandidates[0]] = 'singer-left';
      for (let i = 1; i < leftCandidates.length; i++) {
        singerClassMap[leftCandidates[i]] = 'singer-right';
      }
    } else if (rightCandidates.length > 1) {
      // Only "right" type singers exist. Make the primary one ('v2') left and others right for contrast.
      singerClassMap[rightCandidates[0]] = 'singer-left';
      for (let i = 1; i < rightCandidates.length; i++) {
        singerClassMap[rightCandidates[i]] = 'singer-right';
      }
    }
    // If only one singer type exists in total, the map remains sparse or empty, and the fallback to 'singer-left' will be used.
  }


  const elementPool = {
    lines: [],
    syllables: [],
    chars: [] // Pool for char spans if needed, currently used by flushWordBuffer
  };

  const onLyricClick = e => {
    const time = parseFloat(e.currentTarget.dataset.startTime); // Keep parseFloat here as it's infrequent
    const player = document.querySelector("video");
    if (player) player.currentTime = time - 0.05; // Adjust for resetting animation
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

    const lyricsWord = document.createElement('div');
    lyricsWord.className = 'lyrics-word';

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
      lyricsWord.appendChild(syllableSpan);
    }
    mainContainer.appendChild(lyricsWord);
    gapLine.appendChild(mainContainer);
    return gapLine;
  }

  const fragment = document.createDocumentFragment();

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
      currentLine.dataset.endTime = line.endTime; // Expecting seconds

      const singer = line.element?.singer;
      const singerClass = singer ? (singerClassMap[singer] || 'singer-left') : 'singer-left';
      currentLine.classList.add(singerClass);

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
      let currentWordEndTime = null; // in ms
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
      lineDiv.dataset.endTime = line.endTime; // Expecting seconds

      const singer = line.element?.singer;
      const singerClass = singer ? (singerClassMap[singer] || 'singer-left') : 'singer-left';
      lineDiv.classList.add(singerClass);

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

  if (currentSettings.blurInactive) {
    container.classList.add('blur-inactive-enabled');
  } else {
    container.classList.remove('blur-inactive-enabled');
  }
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
      syllable.parentElement.parentElement.parentElement.classList.contains('lyrics-gap')) {
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

  const container = document.querySelector("#lyrics-plus-container");
  if (!container) return;

  const computedStyle = getComputedStyle(container);
  if (computedStyle.display !== 'block') return;

  const scrollContainer = container.parentElement;
  if (!scrollContainer) return;

  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const lineRect = activeLine.getBoundingClientRect();

  // Determine if scrolling is necessary based on line position and forceScroll flag
  const safeAreaTopLimit = scrollContainerRect.top + scrollContainerRect.height * 0.15;
  // A line is considered too low if its top is past 85% of the scroll container's height from the top.
  const safeAreaBottomLimit = scrollContainerRect.top + scrollContainerRect.height * 0.85;

  const lineIsAboveSafeArea = lineRect.top < safeAreaTopLimit;
  const lineIsBelowSafeArea = lineRect.top > safeAreaBottomLimit;

  const isLyricsFocused = lineIsAboveSafeArea || lineIsBelowSafeArea;

  if (!forceScroll && isLyricsFocused) {
    // If not forcing scroll, AND the line is already within the comfortable safe area, do nothing.
    return;
  }

  // If we proceed, a programmatic scroll is about to happen.
  if (container) {
    container.classList.remove('not-focused');
  }

  isProgrammaticScrolling = true;
  clearTimeout(endProgrammaticScrollTimer); // Clear any existing timer from previous scrolls or safety nets

  activeLine.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  // Fallback: Ensure isProgrammaticScrolling is reset if no scroll events occur
  // (e.g., if element is already in view and scrollIntoView causes no actual scroll).
  // This timer will be cleared by the scroll event handler's debounce if scroll events do occur.
  endProgrammaticScrollTimer = setTimeout(() => {
    isProgrammaticScrolling = false; // Reset state if no scroll events happened to extend it via debounce.
    endProgrammaticScrollTimer = null;
    // console.log('Programmatic scroll state ended by initial/safety timer.');
  }, 500); // This duration should be longer than the debounce period in the scroll listener (250ms).
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
