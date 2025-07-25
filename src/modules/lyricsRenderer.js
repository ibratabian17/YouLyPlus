class LyricsPlusRenderer {

  /**
   * Constructor for the LyricsPlusRenderer.
   * Initializes state variables and sets up the initial environment for the lyrics display.
   */
  constructor() {
    // --- State Variables ---
    this.lyricsAnimationFrameId = null;
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null; // New: To store the last active line for delay calculation
    this.lastTime = 0;
    this.lastProcessedTime = 0;

    // --- DOM & Cache ---
    this.lyricsContainer = null;
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.activeLineIds = new Set();
    this.highlightedSyllableIds = new Set();
    this.visibleLineIds = new Set();
    this.fontCache = {};
    this.textWidthCanvas = null;
    this.visibilityObserver = null;
    this.resizeObserver = null;
    this._cachedContainerRect = null; // New: Cache for container and parent dimensions
    this._debouncedResizeHandler = this._debounce(this._handleContainerResize, 1); // Initialize debounced handler

    // --- UI Elements ---
    this.translationButton = null;
    this.reloadButton = null;
    this.dropdownMenu = null;

    // --- Scrolling & Interaction State ---
    this.isProgrammaticScrolling = false;
    this.endProgrammaticScrollTimer = null;
    this.scrollEventHandlerAttached = false;
    this.currentScrollOffset = 0;
    this.touchStartY = 0;
    this.isTouching = false;
    this.userScrollIdleTimer = null;
    this.isUserControllingScroll = false;
    this.userScrollRevertTimer = null; // Timer to revert control to the player

    // --- Initial Setup ---
    this._injectCssFile();
    // This call ensures the container is found or created and listeners are attached.
    this._getContainer();
  }

  /**
   * Generic debounce utility.
   * @param {Function} func - The function to debounce.
   * @param {number} delay - The debounce delay in milliseconds.
   * @returns {Function} - The debounced function.
   */
  _debounce(func, delay) {
    let timeout;
    return function (...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), delay);
    };
  }

  /**
   * Handles the actual logic for container resize, debounced by _debouncedResizeHandler.
   * @param {HTMLElement} container - The lyrics container element.
   * @private
   */
  _handleContainerResize(container) {
    // Update cached dimensions when the parent container resizes
    this._cachedContainerRect = {
      containerTop: container.getBoundingClientRect().top,
      scrollContainerTop: container.getBoundingClientRect().top
    };

    // Re-evaluate scroll position if not user-controlled
    if (!this.isUserControllingScroll && this.currentPrimaryActiveLine) {
      this._scrollToActiveLine(this.currentPrimaryActiveLine, false);
    }
  }

  // --- Core DOM Manipulation & Setup ---

  /**
   * A helper method to determine if a text string contains Right-to-Left characters.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains RTL characters.
   */
  _isRTL(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);
  }

  /**
   * A helper method to determine if a text string contains CJK characters.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains CJK characters.
   */
  _isCJK(text) {
    return /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);
  }

  /**
   * Gets a reference to the lyrics container, creating it if it doesn't exist.
   * This method ensures the container and its scroll listeners are always ready.
   * @returns {HTMLElement | null} - The lyrics container element.
   */
  _getContainer() {
    if (!this.lyricsContainer) {
      this.lyricsContainer = document.getElementById('lyrics-plus-container');
      if (!this.lyricsContainer) {
        this._createLyricsContainer();
      }
    }
    if (this.lyricsContainer && this.lyricsContainer.parentElement && !this.scrollEventHandlerAttached) {
      this._setupUserScrollListener();
    }
    return this.lyricsContainer;
  }

  /**
   * Creates the main container for the lyrics and appends it to the DOM.
   * @returns {HTMLElement | null} - The newly created container element.
   */
  _createLyricsContainer() {
    const originalLyricsSection = document.querySelector('#tab-renderer');
    if (!originalLyricsSection) {
      this.lyricsContainer = null;
      return null;
    }
    const container = document.createElement('div');
    container.id = 'lyrics-plus-container';
    container.classList.add('lyrics-plus-integrated', 'blur-inactive-enabled');
    originalLyricsSection.appendChild(container);
    this.lyricsContainer = container;
    this._setupUserScrollListener();
    return container;
  }

  /**
   * Sets up custom event listeners for user scrolling (wheel and touch).
   * This allows for custom scroll behavior instead of native browser scrolling.
   */
  _setupUserScrollListener() {
    if (this.scrollEventHandlerAttached || !this.lyricsContainer) {
      return;
    }

    const scrollListeningElement = this.lyricsContainer;
    const parentScrollElement = this.lyricsContainer.parentElement;

    if (parentScrollElement) {
      parentScrollElement.addEventListener('scroll', () => {
        if (this.isProgrammaticScrolling) {
          clearTimeout(this.endProgrammaticScrollTimer);
          this.endProgrammaticScrollTimer = setTimeout(() => {
            this.isProgrammaticScrolling = false;
            this.endProgrammaticScrollTimer = null;
          }, 250);
          return;
        }
        if (this.lyricsContainer) {
          this.lyricsContainer.classList.add('not-focused');
        }
      }, { passive: true });
    }

    scrollListeningElement.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.isProgrammaticScrolling = false;
      if (this.lyricsContainer) {
        this.lyricsContainer.classList.add('not-focused', 'user-scrolling', 'wheel-scrolling');
        this.lyricsContainer.classList.remove('touch-scrolling');
      }
      const scrollAmount = event.deltaY;
      this._handleUserScroll(scrollAmount);
      clearTimeout(this.userScrollIdleTimer);
      this.userScrollIdleTimer = setTimeout(() => {
        if (this.lyricsContainer) {
          this.lyricsContainer.classList.remove('user-scrolling', 'wheel-scrolling');
        }
      }, 200);
    }, { passive: false });

    scrollListeningElement.addEventListener('touchstart', (event) => {
      this.isTouching = true;
      this.touchStartY = event.touches[0].clientY;
      this.isProgrammaticScrolling = false;
      if (this.lyricsContainer) {
        this.lyricsContainer.classList.add('not-focused', 'user-scrolling', 'touch-scrolling');
        this.lyricsContainer.classList.remove('wheel-scrolling');
      }
      clearTimeout(this.userScrollIdleTimer);
    }, { passive: true });

    scrollListeningElement.addEventListener('touchmove', (event) => {
      if (!this.isTouching) return;
      event.preventDefault();
      const currentY = event.touches[0].clientY;
      const deltaY = this.touchStartY - currentY;
      this.touchStartY = currentY;
      this._handleUserScroll(deltaY);
    }, { passive: false });

    scrollListeningElement.addEventListener('touchend', () => {
      this.isTouching = false;
      if (this.lyricsContainer) {
        this.lyricsContainer.classList.remove('user-scrolling', 'touch-scrolling');
      }
    }, { passive: true });

    this.scrollEventHandlerAttached = true;
  }

  /**
   * Handles the logic for manual user scrolling, calculating and clamping the new scroll position.
   * Also sets a timer to automatically resume player-controlled scrolling after a period of user inactivity.
   * @param {number} delta - The amount to scroll by.
   */
  _handleUserScroll(delta) {
    // 1. Set the flag to indicate user is in control.
    this.isUserControllingScroll = true;

    // 2. Clear any existing timer. This ensures the timer resets every time the user scrolls.
    clearTimeout(this.userScrollRevertTimer);

    // 3. Set a new timer. After 4 seconds of inactivity, control will be given back to the player.
    this.userScrollRevertTimer = setTimeout(() => {
      this.isUserControllingScroll = false;
      // When reverting, force a scroll to the currently active line to re-sync the view.
      if (this.currentPrimaryActiveLine) {
        this._scrollToActiveLine(this.currentPrimaryActiveLine, true);
      }
    }, 4000); // 4-second delay before reverting. Adjust as needed.

    // --- The rest of the original function's logic remains the same ---
    const scrollSensitivity = 0.7;
    let newScrollOffset = this.currentScrollOffset - (delta * scrollSensitivity);

    const container = this._getContainer();
    if (!container) {
      this._animateScroll(newScrollOffset);
      return;
    }

    const allScrollableElements = Array.from(container.querySelectorAll('.lyrics-line, .lyrics-plus-metadata, .lyrics-plus-empty'));
    if (allScrollableElements.length === 0) {
      this._animateScroll(newScrollOffset);
      return;
    }

    const scrollContainer = container.parentElement;
    if (!scrollContainer) {
      this._animateScroll(newScrollOffset);
      return;
    }

    const containerHeight = scrollContainer.clientHeight;
    let minAllowedScroll = 0;
    let maxAllowedScroll = 0;

    const firstElement = allScrollableElements[0];
    const lastElement = allScrollableElements[allScrollableElements.length - 1];

    if (firstElement && lastElement) {
      const contentTotalHeight = lastElement.offsetTop + lastElement.offsetHeight - firstElement.offsetTop;
      if (contentTotalHeight > containerHeight) {
        maxAllowedScroll = containerHeight - (lastElement.offsetTop + lastElement.offsetHeight);
      }
    }

    newScrollOffset = Math.max(newScrollOffset, maxAllowedScroll);
    newScrollOffset = Math.min(newScrollOffset, minAllowedScroll);

    this._animateScroll(newScrollOffset);
  }

  /**
   * Injects the necessary CSS file for styling the lyrics container.
   */
  _injectCssFile() {
    if (document.querySelector('link[data-lyrics-plus-style]')) return;
    const pBrowser = chrome || browser;
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    linkElement.href = pBrowser.runtime.getURL('src/inject/stylesheet.css');
    linkElement.setAttribute('data-lyrics-plus-style', 'true');
    document.head.appendChild(linkElement);
  }

  /**
   * Fixes lyric timings by analyzing overlaps and gaps in a multi-pass process.
   * @param {NodeListOf<HTMLElement> | Array<HTMLElement>} originalLines - A list of lyric elements.
   */
  _retimingActiveTimings(originalLines) {
    if (!originalLines || originalLines.length < 2) {
      return;
    }

    const linesData = Array.from(originalLines).map((line) => ({
      element: line,
      startTime: parseFloat(line.dataset.startTime),
      originalEndTime: parseFloat(line.dataset.endTime),
      newEndTime: parseFloat(line.dataset.endTime),
      isHandledByPrecursorPass: false,
    }));

    for (let i = 0; i <= linesData.length - 3; i++) {
      const lineA = linesData[i];
      const lineB = linesData[i + 1];
      const lineC = linesData[i + 2];
      const aOverlapsB = lineB.startTime < lineA.originalEndTime;
      const bOverlapsC = lineC.startTime < lineB.originalEndTime;
      const aDoesNotOverlapC = lineC.startTime >= lineA.originalEndTime;
      if (aOverlapsB && bOverlapsC && aDoesNotOverlapC) {
        lineA.newEndTime = lineC.startTime;
        lineA.isHandledByPrecursorPass = true;
      }
    }

    for (let i = linesData.length - 2; i >= 0; i--) {
      const currentLine = linesData[i];
      const nextLine = linesData[i + 1];
      if (currentLine.isHandledByPrecursorPass) continue;

      if (nextLine.startTime < currentLine.originalEndTime) {
        currentLine.newEndTime = nextLine.newEndTime;
      } else {
        const gap = nextLine.startTime - currentLine.originalEndTime;
        const nextElement = currentLine.element.nextElementSibling;
        const isFollowedByManualGap = nextElement && nextElement.classList.contains('lyrics-gap');
        if (gap > 0 && !isFollowedByManualGap) {
          const extension = Math.min(0.5, gap);
          currentLine.newEndTime = currentLine.originalEndTime + extension;
        }
      }
    }

    linesData.forEach(lineData => {
      lineData.element.dataset.actualEndTime = lineData.originalEndTime.toFixed(3);
      if (Math.abs(lineData.newEndTime - lineData.originalEndTime) > 0.001) {
        lineData.element.dataset.endTime = lineData.newEndTime.toFixed(3);
      }
    });
  }

  /**
   * An internal handler for click events on lyric lines.
   * Seeks the video to the line's start time.
   * @param {Event} e - The click event.
   */
  _onLyricClick(e) {
    const time = parseFloat(e.currentTarget.dataset.startTime);
    const player = document.querySelector("video");
    if (player) player.currentTime = time - 0.05;
    this._scrollToActiveLine(e.currentTarget, true);
  }

  // --- Lyrics Display & Rendering Logic ---

  /**
   * Renders the lyrics, metadata, and control buttons inside the container.
   * This is the main public method to update the display.
   * @param {object} lyrics - The lyrics data object.
   * @param {string} source - The source of the lyrics.
   * @param {string} type - The type of lyrics ("Line" or "Word").
   * @param {boolean} lightweight - Flag for lightweight mode.
   * @param {string[]} songWriters - Array of songwriters.
   * @param {object} songInfo - Information about the current song.
   * @param {string} displayMode - The current display mode ('none', 'translate', 'romanize').
   * @param {object} currentSettings - The current user settings.
   */
  displayLyrics(lyrics, source = "Unknown", type = "Line", lightweight = false, songWriters, songInfo, displayMode = 'none', currentSettings = {}) {
    const container = this._getContainer();
    if (!container) return;

    container.classList.remove('lyrics-plus-message'); // Remove the class when actual lyrics are displayed

    // Apply visual settings
    container.classList.toggle('use-song-palette-fullscreen', !!currentSettings.useSongPaletteFullscreen);
    container.classList.toggle('use-song-palette-all-modes', !!currentSettings.useSongPaletteAllModes);

    if (currentSettings.overridePaletteColor) {
      container.classList.add('override-palette-color');
      container.style.setProperty('--lyplus-override-pallete', currentSettings.overridePaletteColor);
      container.style.setProperty('--lyplus-override-pallete-white', `${currentSettings.overridePaletteColor}85`);
      container.classList.remove('use-song-palette-fullscreen', 'use-song-palette-all-modes');
    } else {
      container.classList.remove('override-palette-color');
      if (currentSettings.useSongPaletteFullscreen || currentSettings.useSongPaletteAllModes) {
        if (typeof LYPLUS_getSongPalette === 'function') {
          const songPalette = LYPLUS_getSongPalette();
          if (songPalette) {
            const { r, g, b } = songPalette;
            container.style.setProperty('--lyplus-song-pallete', `rgb(${r}, ${g}, ${b})`);
            const alpha = 133 / 255;
            const r_blend = Math.round(alpha * 255 + (1 - alpha) * r);
            const g_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            const b_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            container.style.setProperty('--lyplus-song-white-pallete', `rgb(${r_blend}, ${g_blend}, ${b_blend})`);
          }
        }
      }
    }

    container.classList.toggle('fullscreen', document.body.hasAttribute('player-fullscreened_'));
    const isWordByWordMode = type === "Word" && currentSettings.wordByWord;
    container.classList.toggle('word-by-word-mode', isWordByWordMode);
    container.classList.toggle('line-by-line-mode', !isWordByWordMode);

    container.classList.remove('lyrics-translated', 'lyrics-romanized');
    if (displayMode === 'translate') container.classList.add('lyrics-translated');
    else if (displayMode === 'romanize') container.classList.add('lyrics-romanized');

    container.classList.toggle('compability-visibility', !!currentSettings.compabilityVisibility);
    container.classList.toggle('compability-wipe', !!currentSettings.compabilityWipe);

    container.innerHTML = '';

    let hasRTL = false, hasLTR = false;
    if (lyrics && lyrics.data && lyrics.data.length > 0) {
      for (const line of lyrics.data) {
        if (this._isRTL(line.text)) hasRTL = true;
        else hasLTR = true;
        if (hasRTL && hasLTR) break;
      }
    }

    container.classList.remove('mixed-direction-lyrics', 'dual-side-lyrics');
    if (hasRTL && hasLTR) container.classList.add('mixed-direction-lyrics');

    const singerClassMap = {};
    let isDualSide = false;
    if (lyrics && lyrics.data && lyrics.data.length > 0) {
      const allSingers = [...new Set(lyrics.data.map(line => line.element?.singer).filter(Boolean))];
      const leftCandidates = allSingers.filter(s => s === 'v1' || s === 'v1000').sort();
      const rightCandidates = allSingers.filter(s => s === 'v2' || s === 'v2000').sort();
      if (leftCandidates.length > 0 && rightCandidates.length > 0) {
        leftCandidates.forEach(s => singerClassMap[s] = 'singer-left');
        rightCandidates.forEach(s => singerClassMap[s] = 'singer-right');
        isDualSide = true;
      } else if (leftCandidates.length > 1) {
        singerClassMap[leftCandidates[0]] = 'singer-left';
        for (let i = 1; i < leftCandidates.length; i++) singerClassMap[leftCandidates[i]] = 'singer-right';
        isDualSide = true;
      } else if (rightCandidates.length > 1) {
        singerClassMap[rightCandidates[0]] = 'singer-left';
        for (let i = 1; i < rightCandidates.length; i++) singerClassMap[rightCandidates[i]] = 'singer-right';
        isDualSide = true;
      }
    }
    if (isDualSide) container.classList.add('dual-side-lyrics');

    const elementPool = { lines: [], syllables: [], chars: [] };

    const createGapLine = (gapStart, gapEnd, classesToInherit = null) => {
      const gapDuration = gapEnd - gapStart;
      const gapLine = elementPool.lines.pop() || document.createElement('div');
      gapLine.className = 'lyrics-line lyrics-gap';
      gapLine.dataset.startTime = gapStart;
      gapLine.dataset.endTime = gapEnd;
      if (!gapLine.hasClickListener) {
        gapLine.addEventListener('click', this._onLyricClick.bind(this));
        gapLine.hasClickListener = true;
      }
      if (classesToInherit) {
        if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
        if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
        if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
      }
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
          syllableSpan.addEventListener('click', this._onLyricClick.bind(this));
          syllableSpan.hasClickListener = true;
        }
        lyricsWord.appendChild(syllableSpan);
      }
      mainContainer.appendChild(lyricsWord);
      gapLine.appendChild(mainContainer);
      return gapLine;
    };

    const fragment = document.createDocumentFragment();

    if (isWordByWordMode) {
      // Word-by-word rendering logic
      this._renderWordByWordLyrics(lyrics, displayMode, singerClassMap, lightweight, elementPool, fragment);
    } else {
      // Line-by-line rendering logic
      this._renderLineByLineLyrics(lyrics, displayMode, singerClassMap, elementPool, fragment);
    }

    container.appendChild(fragment);

    // Post-rendering logic for gaps and timing adjustments
    const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
    if (originalLines.length > 0) {
      const firstLine = originalLines[0];
      const firstStartTime = parseFloat(firstLine.dataset.startTime);
      if (firstStartTime >= 7.0) {
        const classesToInherit = [...firstLine.classList].filter(c => ['rtl-text', 'singer-left', 'singer-right'].includes(c));
        container.insertBefore(createGapLine(0, firstStartTime - 0.85, classesToInherit), firstLine);
      }
    }
    const gapLinesToInsert = [];
    originalLines.forEach((line, index) => {
      if (index < originalLines.length - 1) {
        const nextLine = originalLines[index + 1];
        if (parseFloat(nextLine.dataset.startTime) - parseFloat(line.dataset.endTime) >= 7.0) {
          const classesToInherit = [...nextLine.classList].filter(c => ['rtl-text', 'singer-left', 'singer-right'].includes(c));
          gapLinesToInsert.push({ gapLine: createGapLine(parseFloat(line.dataset.endTime) + 0.4, parseFloat(nextLine.dataset.startTime) - 0.85, classesToInherit), nextLine });
        }
      }
    });
    gapLinesToInsert.forEach(({ gapLine, nextLine }) => container.insertBefore(gapLine, nextLine));
    this._retimingActiveTimings(originalLines);

    // Render metadata
    const metadataContainer = document.createElement('div');
    metadataContainer.className = 'lyrics-plus-metadata';
    metadataContainer.dataset.startTime = (lyrics.data[lyrics.data.length - 1]?.endTime || 0) + 0.5; // Approximate start time for metadata
    metadataContainer.dataset.endTime = (lyrics.data[lyrics.data.length - 1]?.endTime || 0) + 10; // Approximate end time for metadata

    if (songWriters) {
      const songWritersDiv = document.createElement('span');
      songWritersDiv.className = 'lyrics-song-writters';
      songWritersDiv.innerText = `${t("writtenBy")} ${songWriters.join(', ')}`;
      metadataContainer.appendChild(songWritersDiv);
    }
    const sourceDiv = document.createElement('span');
    sourceDiv.className = 'lyrics-source-provider';
    sourceDiv.innerText = `${t("source")} ${source}`;
    metadataContainer.appendChild(sourceDiv);
    container.appendChild(metadataContainer);

    // Add an empty div at the end for bottom padding
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'lyrics-plus-empty';
    container.appendChild(emptyDiv);

    // Create the fixed empty div for avoiding detected by resizerObserver
    const emptyFixedDiv = document.createElement('div');
    emptyFixedDiv.className = 'lyrics-plus-empty-fixed';
    container.appendChild(emptyFixedDiv);

    // Cache and setup for sync
    this.cachedLyricsLines = Array.from(container.querySelectorAll('.lyrics-line, .lyrics-plus-metadata, .lyrics-plus-empty')).map(line => {
      if (line) {
        line._startTimeMs = parseFloat(line.dataset.startTime) * 1000;
        line._endTimeMs = parseFloat(line.dataset.endTime) * 1000;
      }
      return line;
    }).filter(Boolean);

    this.cachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable')).map(syllable => {
      if (syllable) {
        syllable._startTimeMs = parseFloat(syllable.dataset.startTime);
        syllable._durationMs = parseFloat(syllable.dataset.duration);
        syllable._endTimeMs = syllable._startTimeMs + syllable._durationMs;
        const wordDuration = parseFloat(syllable.dataset.wordDuration);
        syllable._wordDurationMs = isNaN(wordDuration) ? null : wordDuration;
      }
      return syllable;
    }).filter(Boolean);

    this._ensureElementIds();
    this.activeLineIds.clear();
    this.highlightedSyllableIds.clear();
    this.visibleLineIds.clear();
    this.currentPrimaryActiveLine = null;

    if (this.cachedLyricsLines.length > 0) this._scrollToActiveLine(this.cachedLyricsLines[0], true);

    this._startLyricsSync(currentSettings);
    this._createControlButtons(sourceDiv);
    container.classList.toggle('blur-inactive-enabled', !!currentSettings.blurInactive);
  }

  /**
   * Internal helper to render word-by-word lyrics.
   * @private
   */
  _renderWordByWordLyrics(lyrics, displayMode, singerClassMap, lightweight, elementPool, fragment) {
    const getComputedFont = (element) => {
      if (!element) return '400 16px sans-serif';
      const cacheKey = element.tagName + (element.className || '');
      if (this.fontCache[cacheKey]) return this.fontCache[cacheKey];
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      this.fontCache[cacheKey] = font;
      return font;
    };

    lyrics.data.forEach((line) => {
      let currentLine = elementPool.lines.pop() || document.createElement('div');
      currentLine.innerHTML = '';
      currentLine.className = 'lyrics-line';
      currentLine.dataset.startTime = line.startTime;
      currentLine.dataset.endTime = line.endTime;
      const singerClass = line.element?.singer ? (singerClassMap[line.element.singer] || 'singer-left') : 'singer-left';
      currentLine.classList.add(singerClass);
      if (this._isRTL(line.text)) currentLine.classList.add('rtl-text');
      if (!currentLine.hasClickListener) {
        currentLine.addEventListener('click', this._onLyricClick.bind(this));
        currentLine.hasClickListener = true;
      }

      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      currentLine.appendChild(mainContainer);

      if (line.translatedText && (displayMode === 'translate' || displayMode === 'romanize') && line.text.trim() !== line.translatedText.trim()) {
        const translationContainer = document.createElement('div');
        translationContainer.classList.add('lyrics-translation-container');
        translationContainer.textContent = line.translatedText;
        currentLine.appendChild(translationContainer);
      }

      let backgroundContainer = null;
      let wordBuffer = [];
      let currentWordStartTime = null;
      let currentWordEndTime = null;

      const flushWordBuffer = () => {
        if (!wordBuffer.length) return;
        const wordSpan = elementPool.syllables.pop() || document.createElement('span');
        wordSpan.innerHTML = '';
        wordSpan.className = 'lyrics-word';
        let referenceFont = mainContainer.firstChild ? getComputedFont(mainContainer.firstChild) : '400 16px sans-serif';
        const combinedText = wordBuffer.map(s => s.text).join('');
        const totalDuration = currentWordEndTime - currentWordStartTime;
        const shouldEmphasize = !lightweight && !this._isRTL(combinedText) && !this._isCJK(combinedText) && combinedText.trim().length <= 7 && totalDuration >= 1000;

        // Animation property calculations
        const durationFactor = Math.min(1.0, Math.max(0.5, (totalDuration - 1000) / 1000));
        wordSpan.style.setProperty('--max-scale', Math.min(1.2, 1.0 + durationFactor * 0.15));
        wordSpan.style.setProperty('--min-scale', Math.max(1.0, Math.min(1.06, 1.02)));
        wordSpan.style.setProperty('--shadow-intensity', Math.min(0.8, 0.4 + (durationFactor * 0.4)));
        wordSpan.style.setProperty('--translate-y-peak', -Math.min(3.0, 0.0 + (durationFactor * 3.0)));
        wordSpan.dataset.totalDuration = totalDuration;
        let isCurrentWordBackground = wordBuffer[0].isBackground || false;
        const characterData = [];

        // Store syllable elements for pre-highlight calculation
        const syllableElements = [];

        wordBuffer.forEach((s, syllableIndex) => {
          const sylSpan = elementPool.syllables.pop() || document.createElement('span');
          sylSpan.innerHTML = '';
          sylSpan.className = 'lyrics-syllable';
          sylSpan.dataset.startTime = s.time;
          sylSpan.dataset.duration = s.duration;
          sylSpan.dataset.endTime = s.time + s.duration;
          sylSpan.dataset.wordDuration = totalDuration;
          sylSpan.dataset.syllableIndex = syllableIndex;
          if (!sylSpan.hasClickListener) {
            sylSpan.addEventListener('click', this._onLyricClick.bind(this));
            sylSpan.hasClickListener = true;
          }
          if (this._isRTL(s.text)) sylSpan.classList.add('rtl-text');

          // Store syllable for pre-highlight calculation
          syllableElements.push(sylSpan);

          if (s.isBackground) {
            sylSpan.textContent = s.text.replace(/[()]/g, '');
          } else {
            if (shouldEmphasize) {
              wordSpan.classList.add('growable');
              let charIndex = 0;
              s.text.split('').forEach(char => {
                if (char === ' ') {
                  sylSpan.appendChild(document.createTextNode(' '));
                } else {
                  const charSpan = elementPool.chars.pop() || document.createElement('span');
                  charSpan.textContent = char;
                  charSpan.className = 'char';
                  charSpan.dataset.charIndex = charIndex++;
                  charSpan.dataset.syllableCharIndex = characterData.length;
                  characterData.push({ charSpan, syllableSpan: sylSpan, isBackground: s.isBackground });
                  sylSpan.appendChild(charSpan);
                }
              });
            } else {
              sylSpan.textContent = s.text;
            }
          }
          wordSpan.appendChild(sylSpan);
        });

        // Pre-calculate pre-highlight relationships for syllables in the same word
        syllableElements.forEach((syllable, index) => {
          if (index < syllableElements.length - 1) {
            const nextSyllable = syllableElements[index + 1];
            const currentDuration = parseFloat(syllable.dataset.duration);
            const charCount = syllable.querySelectorAll('span.char').length || syllable.textContent.length;

            // Calculate delay factor based on character count
            let charBasedDelay = 0;
            if (charCount > 1) {
              charBasedDelay = (charCount - 1) / charCount;
            }
            const delayPercent = charBasedDelay + 0.07;
            const timingFunction = `cubic-bezier(${delayPercent.toFixed(3)}, 0, 1, 1)`;

            // Store pre-highlight data on the current syllable
            syllable.dataset.nextSyllableId = nextSyllable.id || `syllable-${Date.now()}-${Math.random()}`;
            syllable.dataset.preHighlightDuration = currentDuration;
            syllable.dataset.preHighlightTimingFunction = timingFunction;

            // Ensure next syllable has an ID
            if (!nextSyllable.id) {
              nextSyllable.id = syllable.dataset.nextSyllableId;
            }
          }
        });

        if (shouldEmphasize && characterData.length > 0) {
          const wordWidth = this._getTextWidth(wordSpan.textContent, referenceFont);
          let cumulativeWidth = 0;
          characterData.forEach((charData) => {
            if (charData.isBackground) return;
            const span = charData.charSpan;
            const charWidth = this._getTextWidth(span.textContent, referenceFont);
            const position = (cumulativeWidth + (charWidth / 2)) / wordWidth;
            const horizontalOffset = Math.sign((position - 0.5) * 2) * Math.pow(Math.abs((position - 0.5) * 2), 1.3) * ((Math.min(1.2, 1.0 + durationFactor * 0.15) - 1.0) * 40);
            span.dataset.horizontalOffset = horizontalOffset;
            span.dataset.position = position;
            cumulativeWidth += charWidth;
          });
        }

        const targetContainer = isCurrentWordBackground ? (backgroundContainer || (backgroundContainer = document.createElement('div'), backgroundContainer.className = 'background-vocal-container', currentLine.appendChild(backgroundContainer))) : mainContainer;
        targetContainer.appendChild(wordSpan);

        wordBuffer = [];
        currentWordStartTime = null;
        currentWordEndTime = null;
      };

      if (line.syllabus && line.syllabus.length > 0) {
        line.syllabus.forEach((s, syllableIndex) => {
          if (wordBuffer.length === 0) currentWordStartTime = s.time;
          wordBuffer.push(s);
          currentWordEndTime = s.time + s.duration;
          const isLastSyllableInLine = syllableIndex === line.syllabus.length - 1;
          const nextSyllable = line.syllabus[syllableIndex + 1];
          const endsWithExplicitDelimiter = s.isLineEnding || /\s$/.test(s.text);
          const isBackgroundStatusChanging = nextSyllable && (s.isBackground !== nextSyllable.isBackground) && !endsWithExplicitDelimiter;
          if (endsWithExplicitDelimiter || isLastSyllableInLine || isBackgroundStatusChanging) {
            flushWordBuffer();
          }
        });
      } else {
        mainContainer.textContent = line.text;
      }
      fragment.appendChild(currentLine);
    });
  }

  /**
   * Internal helper to render line-by-line lyrics.
   * @private
   */
  _renderLineByLineLyrics(lyrics, displayMode, singerClassMap, elementPool, fragment) {
    const lineFragment = document.createDocumentFragment();
    lyrics.data.forEach(line => {
      const lineDiv = elementPool.lines.pop() || document.createElement('div');
      lineDiv.innerHTML = '';
      lineDiv.className = 'lyrics-line';
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      const singerClass = line.element?.singer ? (singerClassMap[line.element.singer] || 'singer-left') : 'singer-left';
      lineDiv.classList.add(singerClass);
      if (this._isRTL(line.text)) lineDiv.classList.add('rtl-text');
      if (!lineDiv.hasClickListener) {
        lineDiv.addEventListener('click', this._onLyricClick.bind(this));
        lineDiv.hasClickListener = true;
      }
      const mainContainer = document.createElement('div');
      mainContainer.className = 'main-vocal-container';
      mainContainer.textContent = line.text;
      lineDiv.appendChild(mainContainer);
      if (line.translatedText && (displayMode === 'translate' || displayMode === 'romanize') && line.text.trim() !== line.translatedText.trim()) {
        const translationContainer = document.createElement('div');
        translationContainer.className = 'lyrics-translation-container';
        translationContainer.textContent = line.translatedText;
        lineDiv.appendChild(translationContainer);
      }
      lineFragment.appendChild(lineDiv);
    });
    fragment.appendChild(lineFragment);
  }

  /**
   * Displays a "not found" message in the lyrics container.
   */
  displaySongNotFound() {
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-not-found">${t("notFound")}</span>`;
      container.classList.add('lyrics-plus-message');
    }
  }

  /**
   * Displays an error message in the lyrics container.
   */
  displaySongError() {
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-not-found">${t("notFoundError")}</span>`;
      container.classList.add('lyrics-plus-message');
    }
  }

  // --- Text, Style, and ID Utilities ---

  _getTextWidth(text, font) {
    const canvas = this.textWidthCanvas || (this.textWidthCanvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    return context.measureText(text).width;
  }

  _ensureElementIds() {
    if (!this.cachedLyricsLines || !this.cachedSyllables) return;
    this.cachedLyricsLines.forEach((line, i) => { if (line && !line.id) line.id = `line-${i}`; });
    this.cachedSyllables.forEach((syllable, i) => { if (syllable && !syllable.id) syllable.id = `syllable-${i}`; });
  }

  // --- Lyrics Synchronization & Highlighting ---

  /**
   * Starts the synchronization loop for highlighting lyrics based on video time.
   * @param {object} currentSettings - The current user settings.
   * @returns {Function} - A cleanup function to stop the sync.
   */
  _startLyricsSync(currentSettings = {}) {
    const videoElement = document.querySelector('video');
    if (!videoElement) return () => { };
    this._ensureElementIds();
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = this._setupVisibilityTracking();

    if (this.lyricsAnimationFrameId) {
      cancelAnimationFrame(this.lyricsAnimationFrameId);
    }
    this.lastTime = videoElement.currentTime * 1000;

    const sync = () => {
      const currentTime = videoElement.currentTime * 1000;
      const isForceScroll = Math.abs(currentTime - this.lastTime) > 1000;
      this._updateLyricsHighlight(currentTime, isForceScroll, currentSettings);
      this.lastTime = currentTime;
      this.lyricsAnimationFrameId = requestAnimationFrame(sync);
    };
    this.lyricsAnimationFrameId = requestAnimationFrame(sync);

    this._setupResizeObserver();

    return () => {
      if (this.visibilityObserver) this.visibilityObserver.disconnect();
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.lyricsAnimationFrameId) {
        cancelAnimationFrame(this.lyricsAnimationFrameId);
        this.lyricsAnimationFrameId = null;
      }
    };
  }

  /**
 * Updates the highlighted lyrics and syllables based on the current time.
 * @param {number} currentTime - The current video time in milliseconds.
 * @param {boolean} isForceScroll - Whether to force a scroll update.
 * @param {object} currentSettings - The current user settings.
 */
  _updateLyricsHighlight(currentTime, isForceScroll = false, currentSettings = {}) {
    // Guard clause: Do nothing if lyrics aren't loaded.
    if (!this.cachedLyricsLines || this.cachedLyricsLines.length === 0) {
      return;
    }

    // Constants for predictive timing.
    const scrollLookAheadMs = 300;
    const highlightLookAheadMs = 190; // For adding the '.active' class

    // --- 1. SCROLLING LOGIC (Corrected) ---
    const visibleLines = this.cachedLyricsLines.filter(line => this.visibleLineIds.has(line.id));
    const predictiveTime = currentTime + scrollLookAheadMs;
    let lineToScroll = null;

    // Find all lines that are active during the predictive time window.
    const currentlyActiveAndPredictiveLines = this.cachedLyricsLines.filter(line =>
      line && predictiveTime >= line._startTimeMs && predictiveTime < line._endTimeMs
    );

    if (currentlyActiveAndPredictiveLines.length > 0) {
      // From the set of active lines, find the one that started the earliest.
      // This is our stable anchor for the current overlapping block.
      lineToScroll = currentlyActiveAndPredictiveLines.reduce((earliest, current) => {
        return current._startTimeMs < earliest._startTimeMs ? current : earliest;
      }, currentlyActiveAndPredictiveLines[0]);
    } else {
      // Fallback for gaps: find the most recent line that has passed.
      let latestPastLine = null;
      for (const line of this.cachedLyricsLines) {
        if (currentTime >= line._startTimeMs - scrollLookAheadMs) {
          latestPastLine = line;
        }
      }
      lineToScroll = latestPastLine;
    }

    // Fallback: If song hasn't started, prepare to scroll to the first line.
    if (!lineToScroll && this.cachedLyricsLines.length > 0) {
      lineToScroll = this.cachedLyricsLines[0];
    }


    // --- 2. HIGHLIGHTING LOGIC ---
    // Determine which lines should have the '.active' class based on a 190ms look-ahead.
    const activeLinesForHighlighting = visibleLines
      .filter(line => line && currentTime >= line._startTimeMs - highlightLookAheadMs && currentTime <= line._endTimeMs)
      .sort((a, b) => b._startTimeMs - a._startTimeMs)
      .slice(0, 3);
    const newActiveLineIds = new Set(activeLinesForHighlighting.map(line => line.id));


    // --- 3. DOM & STATE UPDATES ---
    // First, trigger the scroll if the target line has changed. This happens predictively.
    if (lineToScroll && (lineToScroll !== this.currentPrimaryActiveLine || isForceScroll)) {
      if (!this.isUserControllingScroll || isForceScroll) {
        this._updatePositionClassesAndScroll(lineToScroll, isForceScroll);
        this.lastPrimaryActiveLine = this.currentPrimaryActiveLine; // Store the previous active line
        this.currentPrimaryActiveLine = lineToScroll;
      }
    }
    // --- OPTIMIZATION: Update classes only for visible lines ---
    visibleLines.forEach(line => {
      if (!line) return;
      const wasActive = this.activeLineIds.has(line.id);
      const shouldBeActive = newActiveLineIds.has(line.id);
      if (shouldBeActive && !wasActive) {
        line.classList.add('active');
      } else if (!shouldBeActive && wasActive) {
        line.classList.remove('active');
        this._resetSyllables(line);
      }
    });
    this.activeLineIds = newActiveLineIds;

    this._updateSyllables(currentTime);

    if (this.lyricsContainer && this.lyricsContainer.classList.contains('compability-visibility')) {
      this.cachedLyricsLines.forEach(line => {
        if (!line) return;
        const isOutOfView = !this.visibleLineIds.has(line.id);
        line.classList.toggle('viewport-hidden', isOutOfView);
      });
    }
  }

  _updateSyllables(currentTime) {
    if (!this.activeLineIds.size) return;

    let newHighlightedSyllableIds = new Set();
    this.activeLineIds.forEach(lineId => {
      const parentLine = document.getElementById(lineId);
      if (!parentLine) return;

      // It's more efficient to get syllables once per active line
      const syllables = parentLine.querySelectorAll('.lyrics-syllable');

      syllables.forEach(syllable => {
        if (!syllable || typeof syllable._startTimeMs !== 'number' || typeof syllable._endTimeMs !== 'number') return;

        const startTime = syllable._startTimeMs;
        const endTime = syllable._endTimeMs;

        if (currentTime >= startTime && currentTime <= endTime) {
          newHighlightedSyllableIds.add(syllable.id);
          if (!syllable.classList.contains('highlight')) this._updateSyllableAnimation(syllable, currentTime);
        } else if (currentTime < startTime && syllable.classList.contains('highlight')) {
          this._resetSyllable(syllable);
        } else if (currentTime > startTime && !syllable.classList.contains('finished')) {
          syllable.classList.add('finished');
        } else if (currentTime > startTime && !syllable.classList.contains('highlight')) {
          this._updateSyllableAnimation(syllable, startTime);
        }
      });
    });

    this.highlightedSyllableIds = newHighlightedSyllableIds;
  }


  _updateSyllableAnimation(syllable, currentTime) {
    if (syllable.classList.contains('highlight')) return;
    syllable.classList.remove('pre-highlight');
    syllable.classList.add('highlight');

    const wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
    const charSpansNodeList = syllable.querySelectorAll('span.char');

    if (charSpansNodeList.length > 0) {
      const wordElement = syllable.closest('.lyrics-word');

      // --- Apply GROW animation ---
      if (wordElement?.classList.contains('growable') && syllable === wordElement.querySelector('.lyrics-syllable')) {
        const spansToAnimate = wordElement._cachedChars || (wordElement._cachedChars = Array.from(wordElement.querySelectorAll('span.char')));
        const finalDuration = syllable._wordDurationMs ?? syllable._durationMs;
        const baseDelayPerChar = finalDuration * 0.07;

        spansToAnimate.forEach(span => {
          const horizontalOffset = parseFloat(span.dataset.horizontalOffset) || 0;
          span.style.setProperty('--char-offset-x', `${horizontalOffset}`);
          const growDelay = baseDelayPerChar * (parseFloat(span.dataset.syllableCharIndex) || 0);
          span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
        });
      }

      // --- Apply WIPE animation to the CURRENT syllable's characters ---
      const currentSyllableCharSpansArray = Array.from(charSpansNodeList);
      currentSyllableCharSpansArray.forEach((span, charIndexInSyllable) => {
        const wipeDurationPerChar = syllable._durationMs / currentSyllableCharSpansArray.length;
        const wipeDelay = wipeDurationPerChar * charIndexInSyllable;
        const preWipeDelay = wipeDurationPerChar * (charIndexInSyllable - 1);

        const wipeAnims = `pre-wipe-char ${wipeDurationPerChar}ms linear ${preWipeDelay}ms, ${wipeAnimation} ${wipeDurationPerChar}ms linear ${wipeDelay}ms forwards`;
        span.style.animation += `, ${wipeAnims}`;
      });

    } else { // Handle non-char, simple syllables (including gaps)
      let currentWipeAnimation = syllable.parentElement?.parentElement?.parentElement?.classList.contains('lyrics-gap')
        ? "fade-gap"
        : wipeAnimation;
      syllable.style.animation = `${currentWipeAnimation} ${syllable._durationMs}ms linear forwards`;
    }

    // --- Logic for the NEXT syllable using pre-calculated data ---
    const nextSyllableId = syllable.dataset.nextSyllableId;
    if (nextSyllableId) {
      const nextSyllable = document.getElementById(nextSyllableId);
      if (nextSyllable) {
        const preHighlightDuration = parseFloat(syllable.dataset.preHighlightDuration);
        const timingFunction = syllable.dataset.preHighlightTimingFunction;

        const nextCharSpan = nextSyllable.querySelector('span.char');
        if (nextCharSpan) {
          const preWipeAnim = `pre-wipe-char ${preHighlightDuration}ms ${timingFunction} forwards`;

          nextCharSpan.style.animation = (nextCharSpan.style.animation && !nextCharSpan.style.animation.includes('pre-wipe-char'))
            ? `${nextCharSpan.style.animation}, ${preWipeAnim}`
            : preWipeAnim;
        }

        // --- Apply pre-highlight to the SYLLABLE using pre-calculated timing ---
        nextSyllable.style.setProperty('--pre-wipe-duration', `${preHighlightDuration}ms`);
        nextSyllable.style.setProperty('--pre-wipe-timing-function', timingFunction);
        nextSyllable.classList.add('pre-highlight');
      }
    }
  }

  _resetSyllable(syllable) {
    if (!syllable) return;
    syllable.style.animation = '';
    syllable.classList.remove('highlight', 'finished', 'pre-highlight');
    syllable.style.removeProperty('--pre-wipe-duration');
    syllable.style.removeProperty('--pre-wipe-timing-function');
    syllable.querySelectorAll('span.char').forEach(span => { span.style.animation = ''; });
  }

  _resetSyllables(line) {
    if (!line) return;
    Array.from(line.getElementsByClassName('lyrics-syllable')).forEach(this._resetSyllable);
  }

  // --- Scrolling Logic ---

  _getScrollPaddingTop() {
    const selectors = [
      'ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
      'ytmusic-app-layout[is-mweb-modernization-enabled] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])',
      'ytmusic-player-page:not([is-video-truncation-fix-enabled])[player-fullscreened] ytmusic-tab-renderer:has(#lyrics-plus-container[style*="display: block"])'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        const paddingTopValue = style.getPropertyValue('--lyrics-scroll-padding-top') || '25%';
        return paddingTopValue.includes('%') ? element.getBoundingClientRect().height * (parseFloat(paddingTopValue) / 100) : (parseFloat(paddingTopValue) || 0);
      }
    }
    const container = document.querySelector("#lyrics-plus-container")?.parentElement;
    return container ? (parseFloat(window.getComputedStyle(container).getPropertyValue('scroll-padding-top')) || 0) : 0;
  }

  /**
   * Applies the new scroll position with a robust buffer logic.
   * Animation delay is applied to a window of approximately two screen heights
   * starting from the first visible line, guaranteeing smooth transitions for
   * lines scrolling into view.
   *
   * @param {number} newTranslateY - The target Y-axis translation value in pixels.
   * @param {boolean} forceScroll - If true, all animation delays are ignored for instant movement.
   */
  _animateScroll(newTranslateY, forceScroll = false) {
    if (!this.lyricsContainer) return;

    // Set the primary scroll offset for the entire container.
    this.currentScrollOffset = newTranslateY;
    this.lyricsContainer.style.setProperty('--lyrics-scroll-offset', `${newTranslateY}px`);

    // If this is a forced jump (seek/click) or a user-driven scroll,
    // make all line animations instant and exit early.
    if (forceScroll || this.lyricsContainer.classList.contains('user-scrolling')) {
      this.cachedLyricsLines.forEach(element => {
        if (element) element.style.setProperty('--lyrics-line-delay', '0ms');
      });
      return;
    }

    // Leverage the pre-calculated visibility from the IntersectionObserver.
    // This is far more performant than calling getBoundingClientRect() in a loop.
    let delayCounter = 0;
    const delayIncrement = 30; // 30ms stagger per line

    // Determine the reference line for delay calculation.
    // If there's a current active line, use it. Otherwise, use the last active line.
    // If neither, default to the first line in the cache to ensure a delay is applied.
    const referenceLine = this.currentPrimaryActiveLine || this.lastPrimaryActiveLine || (this.cachedLyricsLines.length > 0 ? this.cachedLyricsLines[0] : null);
    const referenceLineIndex = referenceLine ? this.cachedLyricsLines.indexOf(referenceLine) : -1;

    this.cachedLyricsLines.forEach((element, index) => {
      if (!element) return;

      // Check if the element's ID is in the set of currently visible (or nearly visible) elements.
      // The _setupVisibilityTracking() method maintains this set.
      if (this.visibleLineIds.has(element.id)) {
        // Apply a staggered delay to visible elements for a smooth "follow" effect.
        // The delay should only start incrementing from the reference line's position.
        const delay = (index >= referenceLineIndex && referenceLineIndex !== -1) ? delayCounter * delayIncrement : 0;
        element.style.setProperty('--lyrics-line-delay', `${delay}ms`);
        if (index >= referenceLineIndex && referenceLineIndex !== -1) {
          delayCounter++;
        }
      } else {
        // Elements far outside the viewport should move instantly to their new position without animation delay.
        element.style.setProperty('--lyrics-line-delay', '0ms');
      }
    });
  }

  _updatePositionClassesAndScroll(lineToScroll, forceScroll = false) {
    if (!this.lyricsContainer || !this.cachedLyricsLines || this.cachedLyricsLines.length === 0) return;
    const scrollLineIndex = this.cachedLyricsLines.indexOf(lineToScroll);
    if (scrollLineIndex === -1) return;

    const positionClasses = ['lyrics-activest', 'pre-active-line', 'next-active-line', 'prev-1', 'prev-2', 'prev-3', 'prev-4', 'next-1', 'next-2', 'next-3', 'next-4'];
    this.lyricsContainer.querySelectorAll('.' + positionClasses.join(', .')).forEach(el => el.classList.remove(...positionClasses));

    lineToScroll.classList.add('lyrics-activest');
    const elements = this.cachedLyricsLines; // Renamed for clarity, as it now includes metadata/empty divs
    for (let i = Math.max(0, scrollLineIndex - 4); i <= Math.min(elements.length - 1, scrollLineIndex + 4); i++) {
      const position = i - scrollLineIndex;
      if (position === 0) continue;
      const element = elements[i];
      if (position === -1) element.classList.add('pre-active-line');
      else if (position === 1) element.classList.add('next-active-line');
      else if (position < 0) element.classList.add(`prev-${Math.abs(position)}`);
      else element.classList.add(`next-${position}`);
    }

    this._scrollToActiveLine(lineToScroll, forceScroll);
  }

  _scrollToActiveLine(activeLine, forceScroll = false) {
    if (!activeLine || !this.lyricsContainer || getComputedStyle(this.lyricsContainer).display !== 'block') return;
    const scrollContainer = this.lyricsContainer.parentElement;
    if (!scrollContainer) return;

    const paddingTop = this._getScrollPaddingTop();
    const targetTranslateY = paddingTop - activeLine.offsetTop;

    // Use cached values if available, otherwise get them
    const containerTop = this._cachedContainerRect ? this._cachedContainerRect.containerTop : this.lyricsContainer.getBoundingClientRect().top;
    const scrollContainerTop = this._cachedContainerRect ? this._cachedContainerRect.scrollContainerTop : scrollContainer.getBoundingClientRect().top;

    if (!forceScroll && Math.abs((activeLine.getBoundingClientRect().top - scrollContainerTop) - paddingTop) < 5) {
      return;
    }
    // Clear the cache after using it, so it's re-calculated on next resize or forced scroll
    this._cachedContainerRect = null;

    this.lyricsContainer.classList.remove('not-focused', 'user-scrolling');
    this.isProgrammaticScrolling = true;
    this.isUserControllingScroll = false;
    clearTimeout(this.endProgrammaticScrollTimer);
    clearTimeout(this.userScrollIdleTimer);
    this.endProgrammaticScrollTimer = setTimeout(() => {
      this.isProgrammaticScrolling = false;
      this.endProgrammaticScrollTimer = null;
    }, 250);

    this._animateScroll(targetTranslateY);
  }

  // --- Visibility Tracking ---

  _setupVisibilityTracking() {
    const container = this._getContainer();
    if (!container || !container.parentElement) return null;
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const id = entry.target.id;
          if (entry.isIntersecting) this.visibleLineIds.add(id);
          else this.visibleLineIds.delete(id);
        });
      }, { root: container.parentElement, rootMargin: '200px 0px', threshold: 0.1 }
    );
    if (this.cachedLyricsLines) {
      this.cachedLyricsLines.forEach(line => {
        if (line) this.visibilityObserver.observe(line);
      });
    }
    return this.visibilityObserver;
  }

  _setupResizeObserver() {
    const container = this._getContainer();
    if (!container) return null;
    if (this.resizeObserver) this.resizeObserver.disconnect();

    this.resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.target === container) {
          // Call the debounced handler
          this._debouncedResizeHandler(container);
        }
      }
    });
    this.resizeObserver.observe(container);
    return this.resizeObserver;
  }

  // --- Control Buttons & UI ---

  _createControlButtons(sourceDivElement) {
    let buttonsWrapper = document.getElementById('lyrics-plus-buttons-wrapper');
    if (!buttonsWrapper) {
      buttonsWrapper = document.createElement('div');
      buttonsWrapper.id = 'lyrics-plus-buttons-wrapper';
      const parent = sourceDivElement?.parentNode || this._getContainer();
      if (parent) {
        parent.insertBefore(buttonsWrapper, sourceDivElement ? sourceDivElement.nextSibling : null);
      }
    }

    if (window.LyricsPlusAPI && typeof setCurrentDisplayModeAndRefetch === 'function') {
      if (!this.translationButton) {
        this.translationButton = document.createElement('button');
        this.translationButton.id = 'lyrics-plus-translate-button';
        buttonsWrapper.appendChild(this.translationButton);
        this._updateTranslationButtonText();
        this.translationButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this._createDropdownMenu(buttonsWrapper);
          if (this.dropdownMenu) this.dropdownMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', (event) => {
          if (this.dropdownMenu && !this.dropdownMenu.classList.contains('hidden') && !this.dropdownMenu.contains(event.target) && event.target !== this.translationButton) {
            this.dropdownMenu.classList.add('hidden');
          }
        });
      }
    }

    if (!this.reloadButton) {
      this.reloadButton = document.createElement('button');
      this.reloadButton.id = 'lyrics-plus-reload-button';
      this.reloadButton.innerHTML = '↻';
      this.reloadButton.title = t('Reload Lyrics');
      buttonsWrapper.appendChild(this.reloadButton);
      this.reloadButton.addEventListener('click', () => {
        if (typeof lastKnownSongInfo !== 'undefined' && window.LyricsPlusAPI && typeof fetchAndDisplayLyrics === 'function') {
          fetchAndDisplayLyrics(lastKnownSongInfo, true, true);
        }
      });
    }
  }

  _createDropdownMenu(parentWrapper) {
    if (this.dropdownMenu) {
      this.dropdownMenu.innerHTML = '';
    } else {
      this.dropdownMenu = document.createElement('div');
      this.dropdownMenu.id = 'lyrics-plus-translation-dropdown';
      this.dropdownMenu.classList.add('hidden');
      parentWrapper?.appendChild(this.dropdownMenu);
    }

    if (typeof currentDisplayMode === 'undefined') return;

    const options = [];
    if (currentDisplayMode !== 'translate') options.push({ text: t('showTranslation'), mode: 'translate' });
    if (currentDisplayMode !== 'romanize') options.push({ text: t('showPronunciation'), mode: 'romanize' });

    options.forEach(opt => {
      const optionDiv = document.createElement('div');
      optionDiv.className = 'dropdown-option';
      optionDiv.textContent = opt.text;
      optionDiv.addEventListener('click', () => {
        this.dropdownMenu.classList.add('hidden');
        if (typeof setCurrentDisplayModeAndRefetch === 'function' && typeof lastKnownSongInfo !== 'undefined') {
          setCurrentDisplayModeAndRefetch(opt.mode, lastKnownSongInfo);
        }
      });
      this.dropdownMenu.appendChild(optionDiv);
    });

    if (currentDisplayMode !== 'none') {
      if (options.length > 0) this.dropdownMenu.appendChild(document.createElement('div')).className = 'dropdown-separator';
      const hideOption = document.createElement('div');
      hideOption.className = 'dropdown-option';
      hideOption.textContent = currentDisplayMode === 'translate' ? t('hideTranslation') : t('hidePronunciation');
      hideOption.addEventListener('click', () => {
        this.dropdownMenu.classList.add('hidden');
        if (typeof setCurrentDisplayModeAndRefetch === 'function' && typeof lastKnownSongInfo !== 'undefined') {
          setCurrentDisplayModeAndRefetch('none', lastKnownSongInfo);
        }
      });
      this.dropdownMenu.appendChild(hideOption);
    }
  }

  _updateTranslationButtonText() {
    if (!this.translationButton) return;
    this.translationButton.innerHTML = '⋯';
    this.translationButton.title = t('showTranslationOptions');
  }

  // --- Cleanup ---

  /**
   * Cleans up the lyrics container and resets the state for the next song.
   */
  cleanupLyrics() {
    if (this.lyricsAnimationFrameId) {
      cancelAnimationFrame(this.lyricsAnimationFrameId);
      this.lyricsAnimationFrameId = null;
    }
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
      container.classList.add('lyrics-plus-message');
      container.classList.remove('user-scrolling');
    }
    this.activeLineIds.clear();
    this.highlightedSyllableIds.clear();
    this.visibleLineIds.clear();
    this.currentPrimaryActiveLine = null;
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.currentScrollOffset = 0;
    this.isUserControllingScroll = false;
    clearTimeout(this.userScrollIdleTimer);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}

const lyricsRendererInstance = new LyricsPlusRenderer();


// 2. Create a controlled, global API object to bridge the manager and the renderer.
// This is much cleaner than putting many functions on `window` directly. The manager
// will interact with this single `LyricsPlusAPI` object.
const LyricsPlusAPI = {
  /**
   * Forwards the call to the renderer instance's displayLyrics method.
   * The arrow function `(...args) => ...` preserves the correct `this` context.
   */
  displayLyrics: (...args) => lyricsRendererInstance.displayLyrics(...args),

  /**
   * Forwards the call to the renderer instance's method to show a "not found" message.
   */
  displaySongNotFound: () => lyricsRendererInstance.displaySongNotFound(),

  /**
   * Forwards the call to the renderer instance's method to show an error message.
   */
  displaySongError: () => lyricsRendererInstance.displaySongError(),

  /**
   * Forwards the call to the renderer instance's cleanup method.
   */
  cleanupLyrics: () => lyricsRendererInstance.cleanupLyrics()
};
