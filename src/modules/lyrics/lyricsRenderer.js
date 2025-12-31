class LyricsPlusRenderer {
  /**
   * Constructor for the LyricsPlusRenderer.
   * Initializes state variables and sets up the initial environment for the lyrics display.
   * @param {object} uiConfig - Configuration for UI element selectors.
   */
  constructor(uiConfig) {
    this.lyricsAnimationFrameId = null;
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.currentFullscreenFocusedLine = null;
    this.lastTime = 0;
    this.offsetLatency = 0

    this.uiConfig = uiConfig;
    this.lyricsContainer = null;
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.activeLineIds = new Set();
    this.visibleLineIds = new Set();
    this.fontCache = {};

    this.textWidthCanvas = null;
    this.visibilityObserver = null;
    this.resizeObserver = null;
    this._cachedContainerRect = null;
    this._debouncedResizeHandler = this._debounce(
      this._handleContainerResize,
      1,
      { leading: true, trailing: true }
    );

    this.translationButton = null;
    this.reloadButton = null;
    this.dropdownMenu = null;
    this.buttonsWrapper = null;
    this._boundLyricClickHandler = this._onLyricClick.bind(this);

    this.isProgrammaticScrolling = false;
    this.endProgrammaticScrollTimer = null;
    this.scrollEventHandlerAttached = false;
    this._boundParentScrollHandler = null;
    this._boundWheelHandler = null;
    this._boundTouchStartHandler = null;
    this._boundTouchMoveHandler = null;
    this._boundTouchEndHandler = null;
    this._boundTouchCancelHandler = null;
    this.currentScrollOffset = 0;
    this.userScrollIdleTimer = null;
    this.isUserControllingScroll = false;
    this.userScrollRevertTimer = null;

    this._boundParentScrollHandler = this._onParentScroll.bind(this);
    this._boundUserInteractionHandler = this._onUserInteraction.bind(this);

    this._lastActiveIndex = 0;
    this._tempActiveLines = [];

    this._getContainer();
  }

  /**
   * Generic debounce utility.
   * @param {Function} func - The function to debounce.
   * @param {number} delay - The debounce delay in milliseconds.
   * @returns {Function} - The debounced function.
   */
  _debounce(func, delay, { leading = false, trailing = true } = {}) {
    let timeout = null;
    let lastArgs = null;
    let lastThis = null;
    let result;

    const invoke = () => {
      timeout = null;
      if (trailing && lastArgs) {
        result = func.apply(lastThis, lastArgs);
        lastArgs = lastThis = null;
      }
    };

    function debounced(...args) {
      lastArgs = args;
      lastThis = this;

      if (timeout) clearTimeout(timeout);

      const callNow = leading && !timeout;
      timeout = setTimeout(invoke, delay);

      if (callNow) {
        result = func.apply(lastThis, lastArgs);
        lastArgs = lastThis = null;
      }

      return result;
    }

    debounced.cancel = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      lastArgs = lastThis = null;
    };

    debounced.flush = () => {
      if (timeout) {
        clearTimeout(timeout);
        invoke();
      }
      return result;
    };

    return debounced;
  }

  _getDataText(normal, isOriginal = true) {
    if (!normal) return "";

    if (this.largerTextMode === "romanization") {
      if (isOriginal) {
        // Main/background container in romanization mode: show romanized
        return normal.romanizedText || normal.text || "";
      } else {
        // Romanization container in romanization mode: show original
        return normal.text || "";
      }
    } else {
      if (isOriginal) {
        // Main/background container in normal mode: show original
        return normal.text || "";
      } else {
        // Romanization container in normal mode: show romanized (if available)
        return normal.romanizedText || normal.text || "";
      }
    }
  }

  /**
   * Handles the actual logic for container resize, debounced by _debouncedResizeHandler.
   * @param {HTMLElement} container - The lyrics container element.
   * @private
   */
  _handleContainerResize(container, rect) {
    if (!container) return;

    const containerTop =
      rect && typeof rect.top === "number"
        ? rect.top
        : container.getBoundingClientRect().top;

    this._cachedContainerRect = {
      containerTop: containerTop - 50,
      scrollContainerTop: containerTop - 50,
    };

    if (!this.isUserControllingScroll && this.currentPrimaryActiveLine) {
      this._scrollToActiveLine(this.currentPrimaryActiveLine, false, true);
    }
  }

  /**
   * A helper method to determine if a text string contains Right-to-Left characters.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains RTL characters.
   */
  _isRTL(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(
      text
    );
  }

  /**
   * A helper method to determine if a text string contains CJK characters.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains CJK characters.
   */
  _isCJK(text) {
    return /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(
      text
    );
  }

  /**
   * Helper function to determine if a string is purely Latin script (no non-Latin characters).
   * This is used to prevent rendering romanization for lines already in Latin script.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains only Latin letters, numbers, punctuation, symbols, or whitespace.
   */
  _isPurelyLatinScript(text) {
    // This regex checks if the entire string consists ONLY of characters from the Latin Unicode script,
    // numbers, common punctuation, and whitespace.
    return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text);
  }

  /**
   * Gets a reference to the lyrics container, creating it if it doesn't exist.
   * This method ensures the container and its scroll listeners are always ready.
   * @returns {HTMLElement | null} - The lyrics container element.
   */
  _getContainer() {
    if (!this.lyricsContainer) {
      this.lyricsContainer = document.getElementById("lyrics-plus-container");
      if (!this.lyricsContainer) {
        this._createLyricsContainer();
      }
    }
    if (this.lyricsContainer) this._attachScrollListeners();
    return this.lyricsContainer;
  }

  /**
   * Creates the main container for the lyrics and appends it to the DOM.
   * @returns {HTMLElement | null} - The newly created container element.
   */
  _createLyricsContainer() {
    const originalLyricsSection = document.querySelector(
      this.uiConfig.patchParent
    );
    if (!originalLyricsSection) {
      console.log("Unable to find " + this.uiConfig.patchParent);
      this.lyricsContainer = null;
      return null;
    }
    const container = document.createElement("div");
    container.id = "lyrics-plus-container";
    container.classList.add("lyrics-plus-integrated", "blur-inactive-enabled");
    originalLyricsSection.appendChild(container);
    this.lyricsContainer = container;
    return container;
  }

  _attachScrollListeners() {
    const scrollContainer = this.lyricsContainer?.parentElement;
    if (!scrollContainer || this.scrollEventHandlerAttached) return;

    scrollContainer.addEventListener('wheel', this._boundUserInteractionHandler, { passive: true });
    scrollContainer.addEventListener('touchstart', this._boundUserInteractionHandler, { passive: true });
    scrollContainer.addEventListener('keydown', this._boundUserInteractionHandler, { passive: true });

    this.scrollEventHandlerAttached = true;
  }

  /**
   * Fired on wheel, touch, or keydown. 
   * Immediately flags user control.
   */
  _onUserInteraction() {
    this._setUserScrolled(true);
  }

  /**
   * Fired on any scroll movement.
   */
  _onParentScroll() {
    if (!this.isProgrammaticScrolling) {
      this._setUserScrolled(true);
    }
  }

  /**
   * Updates state and manages the "revert to auto-scroll" timer
   */
  _setUserScrolled(isUserScrolling) {
    if (isUserScrolling) {
      this.isUserControllingScroll = true;
      this.lyricsContainer?.classList.add("user-scrolling", 'not-focused');

      clearTimeout(this.userScrollIdleTimer);
      this.userScrollIdleTimer = setTimeout(() => {
        this.isUserControllingScroll = false;
        this.lyricsContainer?.classList.remove("user-scrolling", 'not-focused');

        if (this.currentPrimaryActiveLine) {
          this._scrollToActiveLine(this.currentPrimaryActiveLine, true);
        }
      }, 5000);
    }
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
        const overlap = currentLine.originalEndTime - nextLine.startTime;
        if (overlap >= 0.1) {
          currentLine.newEndTime = nextLine.newEndTime;
        } else {
          currentLine.newEndTime = currentLine.originalEndTime;
        }
      } else {
        const gap = nextLine.startTime - currentLine.originalEndTime;
        const nextElement = currentLine.element.nextElementSibling;
        const isFollowedByManualGap =
          nextElement && nextElement.classList.contains("lyrics-gap");
        if (gap > 0 && !isFollowedByManualGap) {
          const extension = Math.min(1.3, gap);
          currentLine.newEndTime = currentLine.originalEndTime + extension;
        }
      }
    }

    linesData.forEach((lineData) => {
      lineData.element.dataset.actualEndTime =
        lineData.originalEndTime.toFixed(3);
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
    this._seekPlayerTo(time - 0.05);
    this._scrollToActiveLine(e.currentTarget, true);
  }

  /**
   * Internal helper to render word-by-word lyrics.
   * @private
   */
  _renderWordByWordLyrics(
    lyrics,
    displayMode,
    singerClassMap,
    fragment
  ) {
    // --- Helper Functions ---

    const getComputedFont = (element) => {
      if (!element) return "400 16px sans-serif";
      const cacheKey = element.tagName + (element.className || "");
      if (this.fontCache[cacheKey]) return this.fontCache[cacheKey];
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      this.fontCache[cacheKey] = font;
      return font;
    };

    const getFontSizePx = (font) => {
      const match = font.match(/(\d+(?:\.\d+)?)px/);
      return match ? parseFloat(match[1]) : 16;
    };

    const calculatePhysicsPreHighlightDelay = (syllable, font, currentDuration) => {
      const textWidthPx = this._getTextWidth(syllable.textContent, font);
      if (textWidthPx <= 0.1 || currentDuration <= 0) return { delay: 0, duration: 0 };

      const fontSizePx = getFontSizePx(font);
      const velocityPxPerMs = textWidthPx / currentDuration;
      const gradientDistancePx = 0.375 * fontSizePx;
      const gradientDurationMs = gradientDistancePx / velocityPxPerMs;

      return {
        delay: currentDuration - gradientDurationMs,
        duration: gradientDurationMs
      };
    };

    // --- Main Line Loop ---

    lyrics.data.forEach((line) => {
      // 1. Line & Container Setup
      let currentLine = document.createElement("div");
      currentLine.innerHTML = "";
      currentLine.className = "lyrics-line";
      currentLine.dataset.startTime = line.startTime;
      currentLine.dataset.endTime = line.endTime;

      let currentLineContainer = document.createElement("div");
      currentLineContainer.className = "lyrics-line-container";
      currentLine.appendChild(currentLineContainer);

      const singerClass = line.element?.singer
        ? singerClassMap[line.element.singer] || "singer-left"
        : "singer-left";
      currentLine.classList.add(singerClass);

      if (!currentLine._hasSharedListener) {
        currentLine.addEventListener("click", this._boundLyricClickHandler);
        currentLine._hasSharedListener = true;
      }

      const mainContainer = document.createElement("p");
      mainContainer.classList.add("main-vocal-container");
      currentLineContainer.appendChild(mainContainer);

      let backgroundContainer = null;
      let isFirstSyllableInMain = true;
      let isFirstSyllableInBg = true;
      let pendingSyllable = null;
      let pendingSyllableFont = null;

      // --- Inner Logic Helpers ---

      const linkSyllables = (prevSyllable, nextSyllable, font) => {
        const physicsData = calculatePhysicsPreHighlightDelay(
          prevSyllable,
          font,
          prevSyllable._durationMs
        );
        prevSyllable._nextSyllableInWord = nextSyllable;
        prevSyllable._preHighlightDurationMs = physicsData.duration;
        prevSyllable._preHighlightDelayMs = physicsData.delay;
      };

      const calculateEmphasisMetrics = (totalDuration, wordBufferLength, firstDuration) => {
        const minDuration = 1000;
        const maxDuration = 5000;
        const easingPower = 3;

        const progress = Math.min(1, Math.max(0, (totalDuration - minDuration) / (maxDuration - minDuration)));
        const easedProgress = Math.pow(progress, easingPower);

        let penaltyFactor = 1.0;
        if (wordBufferLength > 1) {
          const imbalanceRatio = firstDuration / totalDuration;
          const penaltyThreshold = 0.25;
          if (imbalanceRatio < penaltyThreshold) {
            const minPenaltyFactor = 0.5;
            const penaltyProgress = imbalanceRatio / penaltyThreshold;
            penaltyFactor = minPenaltyFactor + (1.0 - minPenaltyFactor) * penaltyProgress;
          }
        }
        return { easedProgress, penaltyFactor };
      };

      const createSyllableElement = (s, totalDuration, idx, isBg) => {
        const sylSpan = document.createElement("span");
        sylSpan.innerHTML = "";
        sylSpan.className = "lyrics-syllable";

        // Dataset & Props
        sylSpan.dataset.startTime = s.time;
        sylSpan.dataset.duration = s.duration;
        sylSpan.dataset.endTime = s.time + s.duration;
        sylSpan.dataset.wordDuration = totalDuration;
        sylSpan.dataset.syllableIndex = idx;
        sylSpan._startTimeMs = s.time;
        sylSpan._durationMs = s.duration;
        sylSpan._endTimeMs = s.time + s.duration;
        sylSpan._wordDurationMs = totalDuration;
        sylSpan._isBackground = isBg;

        // First-in-container Logic
        if (isBg) {
          if (isFirstSyllableInBg) {
            sylSpan._isFirstInContainer = true;
            isFirstSyllableInBg = false;
          }
        } else {
          if (isFirstSyllableInMain) {
            sylSpan._isFirstInContainer = true;
            isFirstSyllableInMain = false;
          }
        }

        if (this._isRTL(this._getDataText(s, true))) {
          sylSpan.classList.add("rtl-text");
        }

        return sylSpan;
      };

      const renderCharWipes = (s, sylSpan, referenceFont, characterData) => {
        const syllableText = this._getDataText(s);
        const fontSizePx = getFontSizePx(referenceFont);
        const chars = syllableText.split("");
        const charWidths = chars.map(c => this._getTextWidth(c, referenceFont));
        const totalSyllableWidth = charWidths.reduce((a, b) => a + b, 0);

        const velocityPxPerMs = totalSyllableWidth / s.duration;
        const gradientDurationMs = (0.375 * fontSizePx) / velocityPxPerMs;

        let cumulativeCharWidth = 0;
        const charSpans = [];

        chars.forEach((char, i) => {
          const charWidth = charWidths[i];
          if (char === " ") {
            sylSpan.appendChild(document.createTextNode(" "));
          } else {
            const charSpan = document.createElement("span");
            charSpan.textContent = char;
            charSpan.className = "char";

            if (totalSyllableWidth > 0) {
              const startPercent = cumulativeCharWidth / totalSyllableWidth;
              const durationPercent = charWidth / totalSyllableWidth;

              charSpan.dataset.wipeStart = startPercent.toFixed(4);
              charSpan.dataset.wipeDuration = durationPercent.toFixed(4);
              charSpan.dataset.preWipeArrival = (s.duration * startPercent).toFixed(2);
              charSpan.dataset.preWipeDuration = gradientDurationMs.toFixed(2);
            }

            charSpan.dataset.syllableCharIndex = characterData.length;
            characterData.push({ charSpan, syllableSpan: sylSpan, isBackground: s.isBackground });
            charSpans.push(charSpan);
            sylSpan.appendChild(charSpan);
          }
          cumulativeCharWidth += charWidth;
        });

        if (charSpans.length > 0) sylSpan._cachedCharSpans = charSpans;
      };

      const applyGrowthStyles = (wordSpan, referenceFont, combinedText, totalDuration, emphasisMetrics) => {
        if (!wordSpan._cachedChars || wordSpan._cachedChars.length === 0) return;

        const { easedProgress, penaltyFactor } = emphasisMetrics;
        const wordWidth = this._getTextWidth(wordSpan.textContent.trim(), referenceFont);
        const numChars = wordSpan._cachedChars.length;
        const wordLength = combinedText.trim().length;

        let maxDecayRate = 0;
        const isLongWord = wordLength > 5;
        const isShortDuration = totalDuration < 1500;
        const hasUnbalancedSyllables = penaltyFactor < 0.95;

        if (isLongWord || isShortDuration || hasUnbalancedSyllables) {
          let decayStrength = 0;
          if (isLongWord) decayStrength += Math.min((wordLength - 5) / 3, 1.0) * 0.4;
          if (isShortDuration) decayStrength += Math.max(0, 1.0 - (totalDuration - 1000) / 500) * 0.4;
          if (hasUnbalancedSyllables) decayStrength += Math.pow(1.0 - penaltyFactor, 0.7) * 1.2;
          maxDecayRate = Math.min(decayStrength, 0.85);
        }

        let cumulativeWidth = 0;
        wordSpan._cachedChars.forEach((span, index) => {
          const positionInWord = numChars > 1 ? index / (numChars - 1) : 0;
          const decayFactor = 1.0 - positionInWord * maxDecayRate;
          const charProgress = easedProgress * penaltyFactor * decayFactor;

          const baseGrowth = numChars <= 3 ? 0.07 : 0.05;
          const charMaxScale = 1.0 + baseGrowth + charProgress * 0.1;
          const charShadowIntensity = 0.4 + charProgress * 0.4;
          const normalizedGrowth = (charMaxScale - 1.0) / 0.13;
          const charTranslateYPeak = -normalizedGrowth * 2.5;

          span.style.setProperty("--max-scale", charMaxScale.toFixed(3));
          span.style.setProperty("--shadow-intensity", charShadowIntensity.toFixed(3));
          span.style.setProperty("--translate-y-peak", charTranslateYPeak.toFixed(3));

          const charWidth = this._getTextWidth(span.textContent.trim(), referenceFont);
          const position = (cumulativeWidth + charWidth / 2) / wordWidth;
          const horizontalOffset = (position - 0.5) * 2 * ((charMaxScale - 1.0) * 25);

          span.dataset.horizontalOffset = horizontalOffset;
          cumulativeWidth += charWidth;
        });
      };

      const shouldAllowBreak = (text) => {
        text = text.trim();
        if (text.length >= 16) return true;
        return false;
      }

      // --- Core Render Function ---

      const renderWordSpan = (wordBuffer, shouldEmphasize, isLastInContiner = false) => {
        if (!wordBuffer.length) return;

        const currentWordStartTime = wordBuffer[0].time;
        const lastSyllable = wordBuffer[wordBuffer.length - 1];
        const currentWordEndTime = lastSyllable.time + lastSyllable.duration;
        const totalDuration = currentWordEndTime - currentWordStartTime;
        const combinedText = wordBuffer.map((s) => this._getDataText(s)).join("");
        const isBgWord = wordBuffer[0].isBackground || false;

        const wordSpan = document.createElement("span");
        wordSpan.innerHTML = "";
        wordSpan.className = "lyrics-word";

        if (shouldAllowBreak(combinedText)) {
          wordSpan.classList.add("allow-break");
        }

        const referenceFont = mainContainer.firstChild
          ? getComputedFont(mainContainer.firstChild)
          : "400 16px sans-serif";

        let emphasisMetrics = { easedProgress: 0, penaltyFactor: 1.0 };
        if (shouldEmphasize) {
          emphasisMetrics = calculateEmphasisMetrics(totalDuration, wordBuffer.length, wordBuffer[0].duration);
          wordSpan.classList.add("growable");
        }

        const characterData = [];
        const syllableElements = [];

        // Process Syllables
        wordBuffer.forEach((s, idx) => {
          const wrap = document.createElement("span");
          wrap.className = "lyrics-syllable-wrap";

          const sylSpan = createSyllableElement(s, totalDuration, idx, s.isBackground || false);

          let txtContent = "";
          if (s.isBackground) {
            txtContent = this._getDataText(s).replace(/[()]/g, "");
            sylSpan.textContent = txtContent;
          } else if (shouldEmphasize) {
            renderCharWipes(s, sylSpan, referenceFont, characterData);
          } else {
            txtContent = this._getDataText(s);
            sylSpan.textContent = txtContent;
          }

          if (!s.isBackground && !shouldEmphasize) {
            const textWidth = this._getTextWidth(txtContent.trim(), referenceFont);
            const spaceWidth = this._getTextWidth(txtContent, referenceFont);
            if (textWidth > 0) {
              sylSpan._wipeRatio = textWidth / (spaceWidth);
            } else {
              sylSpan._wipeRatio = 1;
            }
          } else {
            sylSpan._wipeRatio = 1;
          }

          wrap.appendChild(sylSpan);
          syllableElements.push(sylSpan);
          wordSpan.appendChild(wrap);
        });

        if (shouldEmphasize) {
          wordSpan._cachedChars = characterData.map((cd) => cd.charSpan);
        }

        const hasText = (el) => el && el.textContent.trim().length > 0;

        if (pendingSyllable && syllableElements.length > 0 && pendingSyllable._isBackground === isBgWord) {
          const firstVisibleSyllable = syllableElements.find(hasText);
          if (firstVisibleSyllable) {
            linkSyllables(pendingSyllable, firstVisibleSyllable, pendingSyllableFont);
          }
        }

        // Intra-word Linking (Syllable -> Syllable)
        syllableElements.forEach((syllable, index) => {
          if (index < syllableElements.length - 1) {
            let nextIndex = index + 1;
            let nextSyllable = syllableElements[nextIndex];

            while (nextSyllable && !hasText(nextSyllable) && nextIndex < syllableElements.length - 1) {
              nextIndex++;
              nextSyllable = syllableElements[nextIndex];
            }

            if (nextSyllable && hasText(nextSyllable)) {
              linkSyllables(syllable, nextSyllable, referenceFont);
            }
          }
        });

        const lastVisible = [...syllableElements].reverse().find(hasText);
        pendingSyllable = lastVisible || (syllableElements.length > 0 ? syllableElements[syllableElements.length - 1] : null);
        pendingSyllableFont = referenceFont;

        // Apply Styling
        if (shouldEmphasize) {
          applyGrowthStyles(wordSpan, referenceFont, combinedText, totalDuration, emphasisMetrics);
        }

        // DOM Insertion
        const targetContainer = isBgWord
          ? backgroundContainer ||
          ((backgroundContainer = document.createElement("p")),
            (backgroundContainer.className = "background-vocal-container"),
            currentLineContainer.appendChild(backgroundContainer))
          : mainContainer;

        targetContainer.appendChild(wordSpan);

        const trailText = combinedText.match(/\s+$/);
        if (trailText && !isLastInContiner) targetContainer.appendChild(document.createTextNode(trailText[0]));

        pendingSyllable = syllableElements.length > 0 ? syllableElements[syllableElements.length - 1] : null;
        pendingSyllableFont = referenceFont;
      };

      // --- Syllabus Processing ---

      if (line.syllabus && line.syllabus.length > 0) {
        const logicalWordGroups = [];
        let currentGroupBuffer = [];

        line.syllabus.forEach((s, idx) => {
          currentGroupBuffer.push(s);
          const syllableText = this._getDataText(s);
          const nextSyllable = line.syllabus[idx + 1];

          const endsWithDelimiter =
            s.isLineEnding ||
            /\s$/.test(syllableText) ||
            (nextSyllable && s.isBackground !== nextSyllable.isBackground);

          if (endsWithDelimiter) {
            logicalWordGroups.push(currentGroupBuffer);
            currentGroupBuffer = [];
          }
        });
        if (currentGroupBuffer.length > 0) {
          logicalWordGroups.push(currentGroupBuffer);
        }

        let lastMainGroupIdx = -1;
        let lastBgGroupIdx = -1;

        for (let i = 0; i < logicalWordGroups.length; i++) {
          const g = logicalWordGroups[i];
          if (g.length > 0) {
            if (g[0].isBackground) {
              lastBgGroupIdx = i;
            } else {
              lastMainGroupIdx = i;
            }
          }
        }

        logicalWordGroups.forEach((group, groupIdx) => {
          const isBg = group.length > 0 && group[0].isBackground;

          const groupText = group.map((s) => this._getDataText(s)).join("");
          const groupDuration = group.reduce((acc, s) => acc + s.duration, 0);

          const isLastGroupInContainer = isBg
            ? groupIdx === lastBgGroupIdx
            : groupIdx === lastMainGroupIdx;


          const isGroupGrowable =
            !isBg &&
            !currentSettings.lightweight &&
            !this._isRTL(groupText) &&
            !this._isCJK(groupText) &&
            groupText.trim().length <= 7 &&
            groupDuration >= 1000;

          if (isGroupGrowable) {
            renderWordSpan(group, true, isLastGroupInContainer);
          } else {
            let visualWordBuffer = [];
            group.forEach((s, idxInGroup) => {
              visualWordBuffer.push(s);
              const syllableText = this._getDataText(s);
              const isLastInGroup = idxInGroup === group.length - 1;

              if (groupText.trim().length >= 12 && syllableText.endsWith("-") || isLastInGroup) {
                renderWordSpan(visualWordBuffer, false, isLastGroupInContainer);
                visualWordBuffer = [];
              }
            });
          }
        });
      } else {
        mainContainer.textContent = line.text;
      }

      // 3. Final Line Cleanup
      if (this._isRTL(mainContainer.textContent)) {
        mainContainer.classList.add("rtl-text");
        currentLine.classList.add("rtl-text");
      }
      fragment.appendChild(currentLine);

      this._renderTranslationContainer(currentLineContainer, line, displayMode);
    });
  }

  /**
   * Internal helper to render line-by-line lyrics.
   * @private
   */
  _renderLineByLineLyrics(
    lyrics,
    displayMode,
    singerClassMap,
    fragment
  ) {
    const lineFragment = document.createDocumentFragment();
    lyrics.data.forEach((line) => {
      const lineDiv = document.createElement("div");
      lineDiv.innerHTML = "";
      lineDiv.className = "lyrics-line";
      const lineDivContainer = document.createElement("div");
      lineDivContainer.innerHTML = "";
      lineDivContainer.className = "lyrics-line-container";
      lineDiv.append(lineDivContainer);
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      const singerClass = line.element?.singer
        ? singerClassMap[line.element.singer] || "singer-left"
        : "singer-left";
      lineDiv.classList.add(singerClass);
      if (this._isRTL(this._getDataText(line, true)))
        lineDiv.classList.add("rtl-text");
      if (!lineDiv._hasSharedListener) {
        lineDiv.addEventListener("click", this._boundLyricClickHandler);
        lineDiv._hasSharedListener = true;
      }
      const mainContainer = document.createElement("div");
      mainContainer.className = "main-vocal-container";
      mainContainer.textContent = this._getDataText(line);
      if (this._isRTL(this._getDataText(line, true)))
        mainContainer.classList.add("rtl-text");
      lineDivContainer.appendChild(mainContainer);
      this._renderTranslationContainer(lineDivContainer, line, displayMode);
      lineFragment.appendChild(lineDiv);
    });
    fragment.appendChild(lineFragment);
  }

  /**
   * Applies the appropriate CSS classes to the container based on the display mode.
   * @param {HTMLElement} container - The lyrics container element.
   * @param {string} displayMode - The current display mode ('none', 'translate', 'romanize').
   * @private
   */
  _applyDisplayModeClasses(container, displayMode) {
    container.classList.remove(
      "lyrics-translated",
      "lyrics-romanized",
      "lyrics-both-modes"
    );
    if (displayMode === "translate")
      container.classList.add("lyrics-translated");
    else if (displayMode === "romanize")
      container.classList.add("lyrics-romanized");
    else if (displayMode === "both")
      container.classList.add("lyrics-both-modes");
  }

  /**
   * Renders the translation/romanization container for a given lyric line.
   * @param {HTMLElement} lineElement - The DOM element for the lyric line.
   * @param {object} lineData - The data object for the lyric line (from lyrics.data).
   * @param {string} displayMode - The current display mode ('none', 'translate', 'romanize', 'both').
   * @private
   */
  _renderTranslationContainer(lineElement, lineData, displayMode) {
    const isRTL = this._isRTL(this._getDataText(lineData, true));
    const hasSyl = Array.isArray(lineData.syllabus) && lineData.syllabus.length > 0;

    if (displayMode === "romanize" || displayMode === "both") {
      if (!this._isPurelyLatinScript(lineData.text)) {
        const isWordSynced = lineElement.querySelector(".lyrics-syllable-wrap") !== null;

        if (hasSyl && lineData.syllabus.some(s => (this._getDataText(s, false) || "").trim()) && isWordSynced) {

          if (isRTL) {
            const cont = document.createElement("div");
            cont.classList.add("lyrics-romanization-container");

            lineData.syllabus.forEach(s => {
              const txt = this._getDataText(s, false);
              if (!txt) return;

              const span = document.createElement("span");
              span.className = "lyrics-syllable";
              span.textContent = txt;
              if (this._isRTL(txt)) span.classList.add("rtl-text");

              span.dataset.startTime = s.time;
              span.dataset.duration = s.duration;
              span.dataset.endTime = s.time + s.duration;
              span._startTimeMs = s.time;
              span._durationMs = s.duration;
              span._endTimeMs = s.time + s.duration;
              span._isFirstInContainer = true; //force fix bleeding?

              cont.appendChild(span);
            });

            if (cont.textContent.trim()) {
              if (this._isRTL(cont.textContent)) cont.classList.add("rtl-text");
              lineElement.appendChild(cont);
            }

          } else {
            const wraps = Array.from(lineElement.querySelectorAll(".lyrics-syllable-wrap"));

            for (let i = 0; i < lineData.syllabus.length && i < wraps.length; i++) {
              const s = lineData.syllabus[i];
              const wrap = wraps[i];

              const transTxt = (this._getDataText(s, false) || "");
              if (!transTxt) continue;


              const tr = document.createElement("span");
              tr.className = "lyrics-syllable transliteration";
              wrap.appendChild(tr);

              tr.textContent = transTxt;
              tr.dataset.startTime = s.time;
              tr.dataset.duration = s.duration;
              tr.dataset.endTime = s.time + s.duration;
              tr._startTimeMs = s.time;
              tr._durationMs = s.duration;
              tr._endTimeMs = s.time + s.duration;
              tr._isFirstInContainer = true; //force fix bleeding?
            }
          }

        } else if (lineData.romanizedText && lineData.text.trim() !== lineData.romanizedText.trim()) {
          const cont = document.createElement("div");
          cont.classList.add("lyrics-romanization-container");
          cont.textContent = this._getDataText(lineData, false);

          if (this._isRTL(cont.textContent)) {
            cont.classList.add("rtl-text");
          }

          lineElement.appendChild(cont);
        }
      }
    }

    if (displayMode === "translate" || displayMode === "both") {
      if (lineData.translatedText &&
        lineData.text.trim() !== lineData.translatedText.trim()) {
        const cont = document.createElement("div");
        cont.classList.add("lyrics-translation-container");
        cont.textContent = lineData.translatedText;
        lineElement.appendChild(cont);
      }
    }
  }

  /**
   * Updates the display of lyrics based on a new display mode (translation/romanization).
   * This method re-renders the lyric lines without re-fetching the entire lyrics data.
   * @param {object} lyrics - The lyrics data object.
   * @param {string} displayMode - The new display mode ('none', 'translate', 'romanize').
   * @param {object} currentSettings - The current user settings.
   */
  updateDisplayMode(lyrics, displayMode, currentSettings) {
    this.currentDisplayMode = displayMode;
    const container = this._getContainer();
    if (!container) return;

    container.innerHTML = "";

    this._applyDisplayModeClasses(container, displayMode);

    container.classList.toggle(
      "use-song-palette-fullscreen",
      !!currentSettings.useSongPaletteFullscreen
    );
    container.classList.toggle(
      "use-song-palette-all-modes",
      !!currentSettings.useSongPaletteAllModes
    );

    if (currentSettings.overridePaletteColor) {
      container.classList.add("override-palette-color");
      container.style.setProperty(
        "--lyplus-override-pallete",
        currentSettings.overridePaletteColor
      );
      container.classList.remove(
        "use-song-palette-fullscreen",
        "use-song-palette-all-modes"
      );
    } else {
      container.classList.remove("override-palette-color");
      if (
        currentSettings.useSongPaletteFullscreen ||
        currentSettings.useSongPaletteAllModes
      ) {
        if (typeof LYPLUS_getSongPalette === "function") {
          const songPalette = LYPLUS_getSongPalette();
          if (songPalette) {
            const { r, g, b } = songPalette;
            container.style.setProperty(
              "--lyplus-song-pallete",
              `rgb(${r}, ${g}, ${b})`
            );
          }
        }
      }
    }

    container.classList.toggle(
      "fullscreen",
      document.body.hasAttribute("player-fullscreened_")
    );
    const isWordByWordMode =
      lyrics.type === "Word" && currentSettings.wordByWord;
    container.classList.toggle("word-by-word-mode", isWordByWordMode);
    container.classList.toggle("line-by-line-mode", !isWordByWordMode);

    // Re-determine text direction and dual-side layout
    let hasRTL = false,
      hasLTR = false;
    if (lyrics && lyrics.data && lyrics.data.length > 0) {
      for (const line of lyrics.data) {
        if (this._isRTL(line.text)) hasRTL = true;
        else hasLTR = true;
        if (hasRTL && hasLTR) break;
      }
    }
    container.classList.remove("mixed-direction-lyrics", "dual-side-lyrics");
    if (hasRTL && hasLTR) container.classList.add("mixed-direction-lyrics");

    const singerClassMap = {};
    let isDualSide = false;

    if (lyrics && lyrics.data && lyrics.data.length > 0) {
      const hasAgentsMetadata = lyrics.metadata?.agents &&
        Object.keys(lyrics.metadata.agents).length > 0;

      if (hasAgentsMetadata) {
        const agents = lyrics.metadata.agents;
        const agentEntries = Object.entries(agents);

        agentEntries.sort((a, b) => a[0].localeCompare(b[0]));

        let leftAgents = [];
        let rightAgents = [];

        const personAgents = agentEntries.filter(([_, agentData]) => agentData.type === "person");

        const personIndexMap = new Map();
        personAgents.forEach(([agentKey, agentData], personIndex) => {
          personIndexMap.set(agentKey, personIndex);
        });

        agentEntries.forEach(([agentKey, agentData]) => {
          if (agentData.type === "group") {
            singerClassMap[agentKey] = "singer-left";
            leftAgents.push(agentKey);
          } else if (agentData.type === "other") {
            singerClassMap[agentKey] = "singer-right";
            rightAgents.push(agentKey);
          } else if (agentData.type === "person") {
            const personIndex = personIndexMap.get(agentKey);
            if (personIndex % 2 === 0) {
              singerClassMap[agentKey] = "singer-left";
              leftAgents.push(agentKey);
            } else {
              singerClassMap[agentKey] = "singer-right";
              rightAgents.push(agentKey);
            }
          }
        });

        const leftCount = lyrics.data.filter(line =>
          line.element?.singer && leftAgents.includes(line.element.singer)
        ).length;

        const rightCount = lyrics.data.filter(line =>
          line.element?.singer && rightAgents.includes(line.element.singer)
        ).length;

        const totalCount = leftCount + rightCount;

        if (totalCount > 0) {
          const rightPercentage = rightCount / totalCount;

          if (rightPercentage >= 0.9) {
            Object.keys(singerClassMap).forEach(key => {
              if (singerClassMap[key] === "singer-left") {
                singerClassMap[key] = "singer-right";
              } else if (singerClassMap[key] === "singer-right") {
                singerClassMap[key] = "singer-left";
              }
            });

            [leftAgents, rightAgents] = [rightAgents, leftAgents];
          }
        }

        isDualSide = leftAgents.length > 0 && rightAgents.length > 0;

      } else {
        const allSingers = [
          ...new Set(
            lyrics.data.map((line) => line.element?.singer).filter(Boolean)
          ),
        ];
        const leftCandidates = [];
        const rightCandidates = [];

        allSingers.forEach((s) => {
          if (!s.startsWith("v")) return;

          const numericPart = s.substring(1);
          if (numericPart.length === 0) return;

          let processedNumericPart = numericPart.replaceAll("0", "");
          if (processedNumericPart === "" && numericPart.length > 0) {
            processedNumericPart = "0";
          }

          const num = parseInt(processedNumericPart, 10);
          if (isNaN(num)) return;

          if (num % 2 !== 0) {
            leftCandidates.push(s);
          } else {
            rightCandidates.push(s);
          }
        });

        const sortByOriginalNumber = (a, b) =>
          parseInt(a.substring(1)) - parseInt(b.substring(1));
        leftCandidates.sort(sortByOriginalNumber);
        rightCandidates.sort(sortByOriginalNumber);

        if (leftCandidates.length > 0 || rightCandidates.length > 0) {
          leftCandidates.forEach((s) => (singerClassMap[s] = "singer-left"));
          rightCandidates.forEach((s) => (singerClassMap[s] = "singer-right"));
          isDualSide = leftCandidates.length > 0 && rightCandidates.length > 0;
        }
      }
    }

    if (isDualSide) container.classList.add("dual-side-lyrics");

    const createGapLine = (gapStart, gapEnd, classesToInherit = null) => {
      const gapDuration = gapEnd - gapStart;
      const gapLine = document.createElement("div");
      gapLine.className = "lyrics-line lyrics-gap";
      gapLine.dataset.startTime = gapStart;
      gapLine.dataset.endTime = gapEnd;
      if (!gapLine._hasSharedListener) {
        gapLine.addEventListener("click", this._boundLyricClickHandler);
        gapLine._hasSharedListener = true;
      }
      if (classesToInherit) {
        if (classesToInherit.includes("rtl-text"))
          gapLine.classList.add("rtl-text");
        if (classesToInherit.includes("singer-left"))
          gapLine.classList.add("singer-left");
        if (classesToInherit.includes("singer-right"))
          gapLine.classList.add("singer-right");
      }
      const existingMainContainer = gapLine.querySelector(
        ".main-vocal-container"
      );
      if (existingMainContainer) existingMainContainer.remove();
      const mainContainer = document.createElement("div");
      mainContainer.className = "main-vocal-container";
      const lyricsWord = document.createElement("div");
      lyricsWord.className = "lyrics-word";
      for (let i = 0; i < 3; i++) {
        const syllableSpan = document.createElement("span");
        syllableSpan.className = "lyrics-syllable";
        const syllableStart = (gapStart + (i * gapDuration) / 3) * 1000;
        const syllableDuration = (gapDuration / 3 / 0.9) * 1000;
        syllableSpan.dataset.startTime = syllableStart;
        syllableSpan.dataset.duration = syllableDuration;
        syllableSpan.dataset.endTime = syllableStart + syllableDuration;
        syllableSpan.textContent = "•";
        lyricsWord.appendChild(syllableSpan);
      }
      mainContainer.appendChild(lyricsWord);
      gapLine.appendChild(mainContainer);
      return gapLine;
    };

    const fragment = document.createDocumentFragment();

    if (isWordByWordMode) {
      this._renderWordByWordLyrics(
        lyrics,
        displayMode,
        singerClassMap,
        fragment
      );
    } else {
      this._renderLineByLineLyrics(
        lyrics,
        displayMode,
        singerClassMap,
        fragment
      );
    }

    container.appendChild(fragment);

    const originalLines = Array.from(
      container.querySelectorAll(".lyrics-line:not(.lyrics-gap)")
    );
    if (originalLines.length > 0) {
      const firstLine = originalLines[0];
      const firstStartTime = parseFloat(firstLine.dataset.startTime);
      if (firstStartTime >= 7.0) {
        const classesToInherit = [...firstLine.classList].filter((c) =>
          ["rtl-text", "singer-left", "singer-right"].includes(c)
        );
        container.insertBefore(
          createGapLine(0, firstStartTime - 0.66, classesToInherit),
          firstLine
        );
      }
    }
    const gapLinesToInsert = [];
    originalLines.forEach((line, index) => {
      if (index < originalLines.length - 1) {
        const nextLine = originalLines[index + 1];
        if (
          parseFloat(nextLine.dataset.startTime) -
          parseFloat(line.dataset.endTime) >=
          7.0
        ) {
          const classesToInherit = [...nextLine.classList].filter((c) =>
            ["rtl-text", "singer-left", "singer-right"].includes(c)
          );
          gapLinesToInsert.push({
            gapLine: createGapLine(
              parseFloat(line.dataset.endTime) + 0.31,
              parseFloat(nextLine.dataset.startTime) - 0.66,
              classesToInherit
            ),
            nextLine,
          });
        }
      }
    });
    gapLinesToInsert.forEach(({ gapLine, nextLine }) =>
      container.insertBefore(gapLine, nextLine)
    );
    this._retimingActiveTimings(originalLines);

    const metadataContainer = document.createElement("div");
    metadataContainer.className = "lyrics-plus-metadata";
    if (lyrics.data[lyrics.data.length - 1]?.endTime != 0) {
      // musixmatch sometimes returning plainText duh
      metadataContainer.dataset.startTime =
        (lyrics.data[lyrics.data.length - 1]?.endTime || 0) + 0.8;
      metadataContainer.dataset.endTime =
        (lyrics.data[lyrics.data.length - 1]?.endTime || 0) + 99999999999999; // soooolonggggg
    }

    // Note: songWriters and source may not be available on subsequent updates.
    // They should ideally be part of the main 'lyrics' object if they can change.
    if (lyrics.metadata.songWriters && lyrics.metadata.songWriters.length > 0) {
      const songWritersDiv = document.createElement("span");
      songWritersDiv.className = "lyrics-song-writters";
      songWritersDiv.innerText = `${t(
        "writtenBy"
      )} ${lyrics.metadata.songWriters.join(", ")}`;
      metadataContainer.appendChild(songWritersDiv);
    }
    const sourceDiv = document.createElement("span");
    sourceDiv.className = "lyrics-source-provider";
    sourceDiv.innerText = `${t("source")} ${lyrics.metadata.source}`;
    metadataContainer.appendChild(sourceDiv);
    container.appendChild(metadataContainer);

    const emptyDiv = document.createElement("div");
    emptyDiv.className = "lyrics-plus-empty";
    container.appendChild(emptyDiv);

    // This fixed div prevents the resize observer from firing due to the main empty div changing size.
    const emptyFixedDiv = document.createElement("div");
    emptyFixedDiv.className = "lyrics-plus-empty-fixed";
    container.appendChild(emptyFixedDiv);

    this.cachedLyricsLines = Array.from(
      container.querySelectorAll(
        ".lyrics-line, .lyrics-plus-metadata"
      )
    )
      .map((line) => {
        if (line) {
          line._startTimeMs = parseFloat(line.dataset.startTime) * 1000;
          line._endTimeMs = parseFloat(line.dataset.endTime) * 1000;
        }
        return line;
      })
      .filter(Boolean);

    this.cachedSyllables = Array.from(
      container.getElementsByClassName("lyrics-syllable")
    )
      .map((syllable) => {
        if (syllable) {
          syllable._startTimeMs = parseFloat(syllable.dataset.startTime);
          syllable._durationMs = parseFloat(syllable.dataset.duration);
          syllable._endTimeMs = syllable._startTimeMs + syllable._durationMs;
          const wordDuration = parseFloat(syllable.dataset.wordDuration);
          syllable._wordDurationMs = isNaN(wordDuration) ? null : wordDuration;
        }
        return syllable;
      })
      .filter(Boolean);

    this._ensureElementIds();
    this.activeLineIds.clear();
    this.visibleLineIds.clear();
    this.currentPrimaryActiveLine = null;

    if (this.cachedLyricsLines.length > 0)
      this._scrollToActiveLine(this.cachedLyricsLines[0], true);

    this._startLyricsSync(currentSettings);
    container.classList.toggle(
      "blur-inactive-enabled",
      !!currentSettings.blurInactive
    );
  }

  /**
   * Renders the lyrics, metadata, and control buttons inside the container.
   * This is the main public method to update the display.
   * @param {object} lyrics - The lyrics data object.
   * @param {string} type - The type of lyrics ("Line" or "Word").
   * @param {object} songInfo - Information about the current song.
   * @param {string} displayMode - The current display mode ('none', 'translate', 'romanize').
   * @param {object} currentSettings - The current user settings.
   * @param {Function} fetchAndDisplayLyricsFn - The function to fetch and display lyrics.
   * @param {Function} setCurrentDisplayModeAndRefetchFn - The function to set display mode and refetch.
   */
  displayLyrics(
    lyrics,
    songInfo,
    displayMode = "none",
    currentSettings = {},
    fetchAndDisplayLyricsFn,
    setCurrentDisplayModeAndRefetchFn,
    largerTextMode = "lyrics",
    offsetLatency = 0
  ) {
    this.lastKnownSongInfo = songInfo;
    this.currentSettings = currentSettings;
    this.fetchAndDisplayLyricsFn = fetchAndDisplayLyricsFn;
    this.setCurrentDisplayModeAndRefetchFn = setCurrentDisplayModeAndRefetchFn;
    this.largerTextMode = largerTextMode;
    this.offsetLatency = offsetLatency

    const container = this._getContainer();
    if (!container) return;

    container.classList.remove("lyrics-plus-message");

    container.classList.toggle(
      "use-song-palette-fullscreen",
      !!currentSettings.useSongPaletteFullscreen
    );
    container.classList.toggle(
      "use-song-palette-all-modes",
      !!currentSettings.useSongPaletteAllModes
    );
    container.classList.toggle(
      "lightweight-mode",
      currentSettings.lightweight
    );

    if (currentSettings.overridePaletteColor) {
      container.classList.add("override-palette-color");
      container.style.setProperty(
        "--lyplus-override-pallete",
        currentSettings.overridePaletteColor
      );
      container.classList.remove(
        "use-song-palette-fullscreen",
        "use-song-palette-all-modes"
      );
    } else {
      container.classList.remove("override-palette-color");
      if (
        currentSettings.useSongPaletteFullscreen ||
        currentSettings.useSongPaletteAllModes
      ) {
        if (typeof LYPLUS_getSongPalette === "function") {
          const songPalette = LYPLUS_getSongPalette();
          if (songPalette) {
            const { r, g, b } = songPalette;
            container.style.setProperty(
              "--lyplus-song-pallete",
              `rgb(${r}, ${g}, ${b})`
            );
          }
        }
      }
    }

    container.classList.toggle(
      "fullscreen",
      document.body.hasAttribute("player-fullscreened_")
    );
    const isWordByWordMode = (lyrics.type === "Word") && currentSettings.wordByWord;
    container.classList.toggle("word-by-word-mode", isWordByWordMode);
    container.classList.toggle("line-by-line-mode", !isWordByWordMode);

    container.classList.toggle(
      "romanized-big-mode",
      largerTextMode != "lyrics"
    );

    this.updateDisplayMode(lyrics, displayMode, currentSettings);

    // Control buttons are created once to avoid re-rendering them.
    this._createControlButtons();
    container.classList.toggle(
      "blur-inactive-enabled",
      !!currentSettings.blurInactive
    );
    container.classList.toggle(
      "hide-offscreen",
      !!currentSettings.hideOffscreen
    );
    this._injectCustomCSS(currentSettings.customCSS);
  }

  /**
   * Displays a "not found" message in the lyrics container.
   */
  displaySongNotFound() {
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-not-found">${t(
        "notFound"
      )}</span>`;
      container.classList.add("lyrics-plus-message");
    }
  }

  /**
   * Displays an error message in the lyrics container.
   */
  displaySongError() {
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-not-found">${t(
        "notFoundError"
      )}</span>`;
      container.classList.add("lyrics-plus-message");
    }
  }

  /**
   * Gets a reference to the player element, caching it for performance.
   * @returns {HTMLVideoElement | null} - The player element.
   * @private
   */
  _getPlayerElement() {
    if (this._playerElement === undefined) {
      this._playerElement =
        document.querySelector(this.uiConfig.player) || null;
    }
    return this._playerElement;
  }

  /**
   * Gets the current playback time, using a custom function from uiConfig if provided, otherwise falling back to the player element.
   * @returns {number} - The current time in seconds.
   * @private
   */
  _getCurrentPlayerTime() {
    if (typeof this.uiConfig.getCurrentTime === "function") {
      return this.uiConfig.getCurrentTime();
    }
    const player = this._getPlayerElement();
    return player ? player.currentTime : 0;
  }

  /**
   * Seeks the player to a specific time, using a custom function from uiConfig if provided.
   * @param {number} time - The time to seek to in seconds.
   * @private
   */
  _seekPlayerTo(time) {
    if (typeof this.uiConfig.seekTo === "function") {
      this.uiConfig.seekTo(time);
      return;
    }
    const player = this._getPlayerElement();
    if (player) {
      player.currentTime = time;
    }
  }

  _getTextWidth(text, font) {
    if (!this.textWidthCanvas) {
      this.textWidthCanvas = document.createElement("canvas");
      this.textWidthCtx = this.textWidthCanvas.getContext("2d", { willReadFrequently: true });
    }
    this.textWidthCtx.font = font;
    return this.textWidthCtx.measureText(text).width;
  }

  _ensureElementIds() {
    if (!this.cachedLyricsLines || !this.cachedSyllables) return;
    this.cachedLyricsLines.forEach((line, i) => {
      if (line && !line.id) line.id = `line-${i}`;
    });
  }

  /**
   * Starts the synchronization loop for highlighting lyrics based on video time.
   * @param {object} currentSettings - The current user settings.
   * @returns {Function} - A cleanup function to stop the sync.
   */
  _startLyricsSync(currentSettings = {}) {
    const canGetTime =
      typeof this.uiConfig.getCurrentTime === "function" ||
      this._getPlayerElement();
    if (!canGetTime) {
      console.warn(
        "LyricsPlusRenderer: Cannot start sync. No player element found and no custom getCurrentTime function provided in uiConfig."
      );
      return () => { };
    }

    this._ensureElementIds();
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = this._setupVisibilityTracking();

    if (this.lyricsAnimationFrameId) {
      if (!this.uiConfig.disableNativeTick)
        cancelAnimationFrame(this.lyricsAnimationFrameId);
    }
    this.lastTime = this._getCurrentPlayerTime() * 1000;
    if (!this.uiConfig.disableNativeTick) {
      const sync = () => {
        const currentTime = (this._getCurrentPlayerTime() - this.offsetLatency) * 1000;
        const isForceScroll = Math.abs(currentTime - this.lastTime) > 1000;
        this._updateLyricsHighlight(
          currentTime,
          isForceScroll,
          currentSettings
        );
        this.lastTime = currentTime;
        this.lyricsAnimationFrameId = requestAnimationFrame(sync);
      };
      this.lyricsAnimationFrameId = requestAnimationFrame(sync);
    }

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
   * Updates the current time
   * @param {number} currentTime - The current video time in seconds.
   */
  updateCurrentTick(currentTime) {
    currentTime = currentTime * 1000;
    const isForceScroll = Math.abs(currentTime - this.lastTime) > 1000;
    this._updateLyricsHighlight((currentTime - this.offsetLatency), isForceScroll, currentSettings);
    this.lastTime = currentTime;
  }

  /**
   * Updates the highlighted lyrics and syllables based on the current time.
   * @param {number} currentTime - The current video time in milliseconds.
   * @param {boolean} isForceScroll - Whether to force a scroll update.
   * @param {object} currentSettings - The current user settings.
   */
  _updateLyricsHighlight(
    currentTime,
    isForceScroll = false,
    currentSettings = {}
  ) {
    if (!this.cachedLyricsLines || this.cachedLyricsLines.length === 0) {
      return;
    }

    const scrollLookAheadMs = 300;
    const highlightLookAheadMs = 190;
    const predictiveTime = currentTime + scrollLookAheadMs;

    // 1. Find Primary Line Index
    const hint = isForceScroll ? 0 : this._lastActiveIndex;
    let primaryIndex = this._getLineIndexAtTime(predictiveTime, hint);

    if (primaryIndex !== -1) {
      const lineToCheck = this.cachedLyricsLines[primaryIndex];
      // Sanity check: if we jumped too far ahead/behind
      if (predictiveTime > lineToCheck._endTimeMs + 10) {
        primaryIndex = -1;
      }
    }

    if (primaryIndex !== -1) {
      let scanIndex = primaryIndex;
      while (scanIndex > 0) {
        const prevLine = this.cachedLyricsLines[scanIndex - 1];
        const isPrevActive =
          predictiveTime >= prevLine._startTimeMs &&
          predictiveTime <= prevLine._endTimeMs + 50;

        if (isPrevActive) {
          scanIndex--;
        } else {
          break;
        }
      }
      primaryIndex = scanIndex;
    } else {
      if (
        this.cachedLyricsLines.length > 0 &&
        predictiveTime < this.cachedLyricsLines[0]._startTimeMs
      ) {
        primaryIndex = 0;
      } else {
        primaryIndex = this._lastActiveIndex;
        if (primaryIndex < 0) primaryIndex = 0;
        if (primaryIndex >= this.cachedLyricsLines.length) {
          primaryIndex = this.cachedLyricsLines.length - 1;
        }
      }
    }

    this._lastActiveIndex = primaryIndex;
    const lineToScroll = this.cachedLyricsLines[primaryIndex];

    // 2. Determine Active Lines
    this._tempActiveLines.length = 0;

    const startSearch = Math.max(0, primaryIndex - 1);
    const endSearch = Math.min(
      this.cachedLyricsLines.length - 1,
      primaryIndex + 2
    );

    for (let i = startSearch; i <= endSearch; i++) {
      const line = this.cachedLyricsLines[i];
      if (this.visibleLineIds.has(line.id)) {
        if (
          currentTime >= line._startTimeMs - highlightLookAheadMs &&
          currentTime <= line._endTimeMs - highlightLookAheadMs
        ) {
          this._tempActiveLines.push(line);
        }
      }
    }

    if (this._tempActiveLines.length > 1) {
      this._tempActiveLines.sort((a, b) => a._startTimeMs - b._startTimeMs);
    }

    // 3. Diffing Active Lines
    let hasChanged = this.activeLineIds.size !== this._tempActiveLines.length;
    if (!hasChanged) {
      for (let i = 0; i < this._tempActiveLines.length; i++) {
        if (!this.activeLineIds.has(this._tempActiveLines[i].id)) {
          hasChanged = true;
          break;
        }
      }
    }

    if (hasChanged) {
      const oldActiveIds = Array.from(this.activeLineIds);

      for (let i = 0; i < oldActiveIds.length; i++) {
        const oldId = oldActiveIds[i];
        let stillActive = false;
        for (let j = 0; j < this._tempActiveLines.length; j++) {
          if (this._tempActiveLines[j].id === oldId) {
            stillActive = true;
            break;
          }
        }

        if (!stillActive) {
          const line = document.getElementById(oldId);
          if (line) {
            line.classList.remove("active");
            this._resetSyllables(line);
          }
          this.activeLineIds.delete(oldId);
        }
      }

      for (let i = 0; i < this._tempActiveLines.length; i++) {
        const line = this._tempActiveLines[i];
        if (!this.activeLineIds.has(line.id)) {
          line.classList.add("active");
          this.activeLineIds.add(line.id);
        }
      }
    }

    // 4. Scrolling Logic
    if (
      lineToScroll &&
      (lineToScroll !== this.currentPrimaryActiveLine || isForceScroll)
    ) {
      if (!this.isUserControllingScroll || isForceScroll) {
        this._updatePositionClassesAndScroll(lineToScroll, isForceScroll);
        this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
        this.currentPrimaryActiveLine = lineToScroll;
      }
    }

    // 5. Focus Logic
    const mostRecentActiveLine =
      this._tempActiveLines.length > 0
        ? this._tempActiveLines[this._tempActiveLines.length - 1]
        : null;

    if (this.currentFullscreenFocusedLine !== mostRecentActiveLine) {
      if (this.currentFullscreenFocusedLine) {
        this.currentFullscreenFocusedLine.classList.remove("fullscreen-focused");
      }
      if (mostRecentActiveLine) {
        mostRecentActiveLine.classList.add("fullscreen-focused");
      }
      this.currentFullscreenFocusedLine = mostRecentActiveLine;
    }

    this._updateSyllables(currentTime, this._tempActiveLines);

    if (this._visibilityHasChanged) {
      if (
        this.lyricsContainer &&
        this.lyricsContainer.classList.contains("hide-offscreen")
      ) {
        this._batchUpdateViewportVisibility();
      } else {
        this._visibilityChanges = [];
      }
      this._visibilityHasChanged = false;
    }
  }

  _getLineIndexAtTime(timeMs, startHintIndex = 0) {
    const lines = this.cachedLyricsLines;
    const len = lines.length;
    if (len === 0) return -1;

    // Sequential Check
    if (startHintIndex >= 0 && startHintIndex < len) {
      const hintLine = lines[startHintIndex];
      if (timeMs >= hintLine._startTimeMs && timeMs < hintLine._endTimeMs) {
        return startHintIndex;
      }
      if (startHintIndex + 1 < len) {
        const nextLine = lines[startHintIndex + 1];
        if (timeMs >= nextLine._startTimeMs && timeMs < nextLine._endTimeMs) {
          return startHintIndex + 1;
        }
      }
    }

    // Binary Search
    let low = 0;
    let high = len - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const line = lines[mid];

      if (timeMs >= line._startTimeMs && timeMs < line._endTimeMs) {
        return mid;
      } else if (timeMs < line._startTimeMs) {
        high = mid - 1;
      } else {
        low = mid + 1;
        result = mid;
      }
    }

    return result;
  }

  /**
   * Batch update viewport visibility
   */
  _batchUpdateViewportVisibility() {
    if (!this._visibilityChanges) return;

    for (let i = 0; i < this._visibilityChanges.length; i++) {
      const change = this._visibilityChanges[i];
      change.target.classList.toggle("viewport-hidden", !change.isIntersecting);
    }

    this._visibilityChanges = [];
  }

  _updateSyllables(currentTime, activeLines) {
    if (!activeLines || activeLines.length === 0) return;

    for (let i = 0; i < activeLines.length; i++) {
      const parentLine = activeLines[i];
      if (!parentLine) continue;

      let syllables = parentLine._cachedSyllableElements;
      if (!syllables) {
        syllables = Array.from(parentLine.querySelectorAll(".lyrics-syllable"));
        parentLine._cachedSyllableElements = syllables;
      }

      for (let j = 0; j < syllables.length; j++) {
        const syllable = syllables[j];
        const startTime = syllable._startTimeMs;
        const endTime = syllable._endTimeMs;

        if (startTime === undefined) continue;

        const classList = syllable.classList;

        const hasHighlight = classList.contains("highlight");
        const hasFinished = classList.contains("finished");
        const hasPreHighlight = classList.contains("pre-highlight");

        if (currentTime >= startTime && currentTime <= endTime) {
          if (!hasHighlight) {
            this._updateSyllableAnimation(syllable);
          }
          if (hasFinished) {
            classList.remove("finished");
          }
        } else if (currentTime > endTime) {
          if (!hasFinished) {
            if (!hasHighlight) {
              this._updateSyllableAnimation(syllable);
            }
            classList.add("finished");
          }
        } else {
          if (hasHighlight || hasFinished) {
            this._resetSyllable(syllable);
          } else if (hasPreHighlight) {
            let shouldReset = true;

            if (j > 0) {
              const prevSyllable = syllables[j - 1];
              if (prevSyllable && prevSyllable.classList.contains("highlight")) {
                shouldReset = false;
              }
            }

            if (shouldReset) {
              this._resetSyllable(syllable, true);
            }
          }
        }
      }
    }
  }

  _updateSyllableAnimation(syllable) {
    // --- READ PHASE ---
    if (syllable.classList.contains("highlight")) return;

    const classList = syllable.classList;
    const isRTL = classList.contains("rtl-text");
    const charSpans = syllable._cachedCharSpans;
    const wordElement = syllable.parentElement.parentElement;
    const allWordCharSpans = wordElement?._cachedChars;
    const isGrowable = wordElement?.classList.contains("growable");
    const isFirstSyllable = syllable.dataset.syllableIndex === "0";
    const isGap =
      syllable.parentElement?.parentElement?.parentElement?.classList.contains(
        "lyrics-gap"
      );
    const nextSyllable = syllable._nextSyllableInWord;
    const isFirstInContainer = syllable._isFirstInContainer || false;

    // --- CALCULATION PHASE ---
    const pendingStyleUpdates = [];
    const charAnimationsMap = new Map();

    // Step 1: Grow Pass.
    if (isGrowable && isFirstSyllable && allWordCharSpans) {
      const finalDuration = syllable._wordDurationMs ?? syllable._durationMs;
      const baseDelayPerChar = finalDuration * 0.09;
      const growDurationMs = finalDuration * 1.5;

      allWordCharSpans.forEach((span) => {
        const horizontalOffset = parseFloat(span.dataset.horizontalOffset) || 0;
        const growDelay =
          baseDelayPerChar * (parseFloat(span.dataset.syllableCharIndex) || 0);
        charAnimationsMap.set(
          span,
          `grow-dynamic ${growDurationMs}ms ease-in-out ${growDelay}ms forwards`
        );
        pendingStyleUpdates.push({
          element: span,
          property: "--char-offset-x",
          value: `${horizontalOffset}`,
        });
      });
    }

    // Step 2: Wipe Pass.
    if (charSpans && charSpans.length > 0) {
      const syllableDuration = syllable._durationMs;

      charSpans.forEach((span, charIndex) => {
        const startPct = parseFloat(span.dataset.wipeStart) || 0;
        const durationPct = parseFloat(span.dataset.wipeDuration) || 0;

        const wipeDelay = syllableDuration * startPct;
        const wipeDuration = syllableDuration * durationPct;

        const useStartAnimation = isFirstInContainer && charIndex === 0;
        const charWipeAnimation = useStartAnimation
          ? isRTL
            ? "start-wipe-rtl"
            : "start-wipe"
          : isRTL
            ? "wipe-rtl"
            : "wipe";

        const existingAnimation =
          charAnimationsMap.get(span) || span.style.animation;
        const animationParts = [];

        if (existingAnimation && existingAnimation.includes("grow-dynamic")) {
          animationParts.push(existingAnimation.split(",")[0].trim());
        }

        if (charIndex > 0) {
          const arrivalTime = parseFloat(span.dataset.preWipeArrival) || 0;
          const constantDuration = parseFloat(span.dataset.preWipeDuration) || 100;

          let animDelay = arrivalTime - constantDuration;

          if (constantDuration > 0) {
            animationParts.push(
              `pre-wipe-char ${constantDuration}ms linear ${animDelay}ms forwards`
            );
          }
        }

        if (wipeDuration > 0) {
          animationParts.push(
            `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`
          );
        }

        charAnimationsMap.set(span, animationParts.join(", "));
      });
    } else {
      const ratio = syllable._wipeRatio || 1;
      const visualDuration = syllable._durationMs * ratio;
      const wipeAnimation = isFirstInContainer
        ? isRTL
          ? "start-wipe-rtl"
          : "start-wipe"
        : isRTL
          ? "wipe-rtl"
          : "wipe";
      const currentWipeAnimation = isGap ? "fade-gap" : wipeAnimation;
      const syllableAnimation = `${currentWipeAnimation} ${visualDuration}ms ${isGap ? 'var(--lyplus-fade-gap-timing-function)' : 'linear'} forwards`;
      pendingStyleUpdates.push({
        element: syllable,
        property: "animation",
        value: syllableAnimation,
      });
    }

    // Step 3: Pre-Wipe Pass (Cross-Syllable).
    if (nextSyllable) {
      const preHighlightDuration = syllable._preHighlightDurationMs;
      const preHighlightDelay = syllable._preHighlightDelayMs;

      pendingStyleUpdates.push({
        element: nextSyllable,
        property: "class",
        action: "add",
        value: "pre-highlight",
      });
      pendingStyleUpdates.push({
        element: nextSyllable,
        property: "--pre-wipe-duration",
        value: `${preHighlightDuration}ms`,
      });
      pendingStyleUpdates.push({
        element: nextSyllable,
        property: "--pre-wipe-delay",
        value: `${preHighlightDelay}ms`,
      });

      const nextCharSpan = nextSyllable._cachedCharSpans?.[0];
      if (nextCharSpan) {
        const preWipeAnim = `pre-wipe-char ${preHighlightDuration}ms linear ${preHighlightDelay}ms forwards`;
        const existingAnimation =
          charAnimationsMap.get(nextCharSpan) ||
          nextCharSpan.style.animation ||
          "";
        const combinedAnimation =
          existingAnimation && !existingAnimation.includes("pre-wipe-char")
            ? `${existingAnimation}, ${preWipeAnim}`
            : preWipeAnim;
        charAnimationsMap.set(nextCharSpan, combinedAnimation);
      }
    }

    // --- WRITE PHASE ---
    classList.remove("pre-highlight");
    classList.add("highlight");

    for (const [span, animationString] of charAnimationsMap.entries()) {
      span.style.animation = animationString;
    }

    for (const update of pendingStyleUpdates) {
      if (update.action === "add") {
        update.element.classList.add(update.value);
      } else if (update.property === "animation") {
        update.element.style.animation = update.value;
      } else {
        update.element.style.setProperty(update.property, update.value);
      }
    }
  }

  _resetSyllable(syllable, noFade = false) {
    if (!syllable) return;
    syllable.style.animation = "";
    if (!syllable.classList.contains("finished") && !noFade) {
      syllable.classList.add("finished");
    }
    requestAnimationFrame(() => {
      setTimeout(() => {
        syllable.classList.remove("highlight", "finished", "pre-highlight");
        syllable.style.removeProperty("--pre-wipe-duration");
        syllable.style.removeProperty("--pre-wipe-delay");
        syllable.querySelectorAll("span.char").forEach((span) => {
          span.style.animation = "";
        });
      }, 16)
    })
  }

  _resetSyllables(line, noFade = false) {
    if (!line) return;
    Array.from(line.getElementsByClassName("lyrics-syllable")).forEach((syllable) =>
      this._resetSyllable(syllable, noFade)
    );
  }

  _getScrollPaddingTop() {
    const selectors = this.uiConfig.selectors;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        const paddingTopValue =
          style.getPropertyValue("--lyrics-scroll-padding-top") || "25%";
        return paddingTopValue.includes("%")
          ? element.getBoundingClientRect().height *
          (parseFloat(paddingTopValue) / 100)
          : parseFloat(paddingTopValue) || 0;
      }
    }
    const container = document.querySelector(
      "#lyrics-plus-container"
    )?.parentElement;
    return container
      ? parseFloat(
        window
          .getComputedStyle(container)
          .getPropertyValue("scroll-padding-top")
      ) || 0
      : 0;
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
    const parent = this.lyricsContainer.parentElement;
    if (!parent) return;

    const targetTop = Math.max(0, -newTranslateY);

    if (!this._scrollAnimationState) {
      this._scrollAnimationState = {
        isAnimating: false,
        startTime: 0,
        startOffset: 0,
        targetOffset: 0,
        duration: 400,
        pendingUpdate: null
      };
    }

    const state = this._scrollAnimationState;

    if (state.isAnimating && !forceScroll) {
      state.pendingUpdate = newTranslateY;
      return;
    }

    let prevOffset = this.currentScrollOffset || 0;

    const delta = prevOffset - newTranslateY;
    this.currentScrollOffset = newTranslateY;

    if (forceScroll) {
      parent.scrollTo({ top: targetTop, behavior: 'smooth' });
      state.isAnimating = false;
      state.pendingUpdate = null;
      return;
    } else {
      const referenceLine =
        this.currentPrimaryActiveLine ||
        this.lastPrimaryActiveLine ||
        this.cachedLyricsLines[0];

      if (!referenceLine) return;

      const referenceIndex = this.cachedLyricsLines.indexOf(referenceLine);
      if (referenceIndex === -1) return;

      const delayIncrement = 30;
      const lookBehind = 5;
      const lookAhead = 20;

      let delayCounter = 0;

      const start = Math.max(0, referenceIndex - lookBehind);
      const end = Math.min(this.cachedLyricsLines.length, referenceIndex + lookAhead);

      let maxAnimationDuration = 0;

      for (let i = start; i < end; i++) {
        const line = this.cachedLyricsLines[i];
        if (!this.visibleLineIds.has(line.id)) continue;

        const delay = i >= referenceIndex ? delayCounter * delayIncrement : 0;
        if (i >= referenceIndex) delayCounter++;

        line.style.setProperty('--scroll-delta', `${delta}px`);
        line.style.setProperty('--lyrics-line-delay', `${delay}ms`);
        line.classList.add('scroll-animate');

        const lineDuration = 400 + delay;
        maxAnimationDuration = Math.max(maxAnimationDuration, lineDuration);
      }

      state.isAnimating = true;
      state.startTime = performance.now();
      state.startOffset = prevOffset;
      state.targetOffset = newTranslateY;
      state.duration = 400;

      if (this._scrollAnimationTimeout) {
        clearTimeout(this._scrollAnimationTimeout);
      }

      this._scrollAnimationTimeout = setTimeout(() => {
        state.isAnimating = false;

        if (state.pendingUpdate !== null) {
          const pendingValue = state.pendingUpdate;
          state.pendingUpdate = null;
          this._animateScroll(pendingValue, false);
        } else {
          this._scrollAnimationTimeout = null;
        }
      }, maxAnimationDuration + 50);

      parent.scrollTo({ top: targetTop, behavior: 'instant' });

      const animations = this.lyricsContainer.getAnimations({ subtree: true });
      for (const anim of animations) {
        if (anim.animationName === 'lyrics-scroll') {
          anim.cancel();
          anim.play();
        }
      }
    }
  }

  _updatePositionClassesAndScroll(lineToScroll, forceScroll = false) {
    if (
      !this.lyricsContainer ||
      !this.cachedLyricsLines ||
      this.cachedLyricsLines.length === 0
    )
      return;
    const scrollLineIndex = this.cachedLyricsLines.indexOf(lineToScroll);
    if (scrollLineIndex === -1) return;

    const positionClasses = [
      "lyrics-activest",
      "post-active-line",
      "next-active-line",
      "prev-1",
      "prev-2",
      "prev-3",
      "prev-4",
      "next-1",
      "next-2",
      "next-3",
      "next-4",
    ];
    this.lyricsContainer
      .querySelectorAll("." + positionClasses.join(", ."))
      .forEach((el) => el.classList.remove(...positionClasses));

    lineToScroll.classList.add("lyrics-activest");
    const elements = this.cachedLyricsLines;
    for (
      let i = Math.max(0, scrollLineIndex - 4);
      i <= Math.min(elements.length - 1, scrollLineIndex + 4);
      i++
    ) {
      const position = i - scrollLineIndex;
      if (position === 0) continue;
      const element = elements[i];
      if (position === -1) element.classList.add("post-active-line");
      else if (position === 1) element.classList.add("next-active-line");
      else if (position < 0)
        element.classList.add(`prev-${Math.abs(position)}`);
      else element.classList.add(`next-${position}`);
    }

    this._scrollToActiveLine(lineToScroll, forceScroll);
  }

  _scrollToActiveLine(activeLine, forceScroll = false, isResize = false) {
    if (
      !activeLine ||
      !this.lyricsContainer ||
      getComputedStyle(this.lyricsContainer).display !== "block"
    )
      return;
    const scrollContainer = this.lyricsContainer.parentElement;
    if (!scrollContainer) return;

    const paddingTop = this._getScrollPaddingTop();
    const targetTranslateY = paddingTop - activeLine.offsetTop;
    const scrollContainerTop = this._cachedContainerRect
      ? this._cachedContainerRect.scrollContainerTop
      : scrollContainer.getBoundingClientRect().top;

    if (
      !forceScroll &&
      Math.abs(
        activeLine.getBoundingClientRect().top - scrollContainerTop - paddingTop
      ) < 1
    ) {
      return;
    }
    this._cachedContainerRect = null;

    this.lyricsContainer.classList.remove("not-focused", "user-scrolling");
    this.isProgrammaticScrolling = true;
    this.isUserControllingScroll = false;
    clearTimeout(this.endProgrammaticScrollTimer);
    clearTimeout(this.userScrollIdleTimer);
    this.endProgrammaticScrollTimer = setTimeout(() => {
      this.isProgrammaticScrolling = false;
      this.endProgrammaticScrollTimer = null;
    }, 250);

    if (isResize) {
      this.currentScrollOffset = targetTranslateY;
      scrollContainer.scrollTo({ top: -targetTranslateY, behavior: 'instant' });

      if (this._scrollAnimationState) {
        this._scrollAnimationState.targetOffset = targetTranslateY;
      }
    } else {
      this._animateScroll(targetTranslateY, forceScroll);
    }
  }

  _setupVisibilityTracking() {
    const container = this._getContainer();
    if (!container || !container.parentElement) return null;
    if (this.visibilityObserver) this.visibilityObserver.disconnect();

    this._visibilityHasChanged = true;
    this._visibilityChanges = [];

    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        let hasChanges = false;
        entries.forEach((entry) => {
          const target = entry.target;
          const id = target.id;

          this._visibilityChanges.push({
            target: target,
            isIntersecting: entry.isIntersecting
          });

          if (entry.isIntersecting) {
            if (!this.visibleLineIds.has(id)) {
              this.visibleLineIds.add(id);
              hasChanges = true;
            }
          } else {
            if (this.visibleLineIds.has(id)) {
              this.visibleLineIds.delete(id);
              hasChanges = true;
            }
          }
        });
        if (hasChanges) {
          this._visibilityHasChanged = true;
        }
      },
      { root: container.parentElement, rootMargin: "200px 0px", threshold: 0.1 }
    );

    if (this.cachedLyricsLines) {
      this.cachedLyricsLines.forEach((line) => {
        if (line) this.visibilityObserver.observe(line);
      });
    }
    return this.visibilityObserver;
  }

  _setupResizeObserver() {
    const container = this._getContainer();
    if (!container) return null;
    if (this.resizeObserver) this.resizeObserver.disconnect();


    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== container) continue;
        this._debouncedResizeHandler(container);
      }
    });

    this.resizeObserver.observe(container);
    return this.resizeObserver;
  }

  restore() {
    if (!this.lyricsContainer) return;

    this._playerElement = undefined;

    this.scrollEventHandlerAttached = false;
    this._attachScrollListeners();

    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = this._setupVisibilityTracking();

    if (this.resizeObserver) this.resizeObserver.disconnect();
    this._setupResizeObserver();

    this._startLyricsSync(this.currentSettings);
    this._createControlButtons();
  }

  _createControlButtons() {
    // Wrapper Management
    this.buttonsWrapper = document.getElementById("lyrics-plus-buttons-wrapper");

    if (!this.buttonsWrapper) {
      this.buttonsWrapper = document.createElement("div");
      this.buttonsWrapper.id = "lyrics-plus-buttons-wrapper";
      const originalLyricsSection = document.querySelector(
        this.uiConfig.buttonParent || this.uiConfig.patchParent
      );
      if (originalLyricsSection) {
        originalLyricsSection.appendChild(this.buttonsWrapper);
      }
    }

    // Translation Button Logic
    if (this.setCurrentDisplayModeAndRefetchFn) {
      if (!this.translationButton) {
        this.translationButton = document.createElement("button");
        this.translationButton.id = "lyrics-plus-translate-button";
        this.buttonsWrapper.appendChild(this.translationButton);
        this._updateTranslationButtonText();

        this.translationButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this._createDropdownMenu(this.buttonsWrapper);
          if (this.dropdownMenu) this.dropdownMenu.classList.toggle("hidden");
        });

        if (!this._boundDocumentClickHandler) {
          this._boundDocumentClickHandler = (event) => {
            if (
              this.dropdownMenu &&
              !this.dropdownMenu.classList.contains("hidden") &&
              !this.dropdownMenu.contains(event.target) &&
              event.target !== this.translationButton
            ) {
              this.dropdownMenu.classList.add("hidden");
            }
          };
          document.addEventListener("click", this._boundDocumentClickHandler);
        }
      } else if (!this.buttonsWrapper.contains(this.translationButton)) {
        this.buttonsWrapper.appendChild(this.translationButton);
      }
    }

    // Reload Button Logic
    if (!this.reloadButton) {
      this.reloadButton = document.createElement("button");
      this.reloadButton.id = "lyrics-plus-reload-button";
      this.reloadButton.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"><path d="M480-192q-120 0-204-84t-84-204q0-120 84-204t204-84q65 0 120.5 27t95.5 72v-99h72v240H528v-72h131q-29-44-76-70t-103-26q-90 0-153 63t-63 153q0 90 63 153t153 63q84 0 144-55.5T693-456h74q-9 112-91 188t-196 76Z"/></svg>';
      this.reloadButton.title = t("RefreshLyrics") || "Refresh Lyrics";
      this.buttonsWrapper.appendChild(this.reloadButton);

      this.reloadButton.addEventListener("click", () => {
        if (this.lastKnownSongInfo && this.fetchAndDisplayLyricsFn) {
          this.fetchAndDisplayLyricsFn(this.lastKnownSongInfo, true, true);
        }
      });
    } else if (!this.buttonsWrapper.contains(this.reloadButton)) {
      this.buttonsWrapper.appendChild(this.reloadButton);
    }
  }

  _createDropdownMenu(parentWrapper) {
    if (this.dropdownMenu) {
      this.dropdownMenu.innerHTML = "";
    } else {
      this.dropdownMenu = document.createElement("div");
      this.dropdownMenu.id = "lyrics-plus-translation-dropdown";
      this.dropdownMenu.classList.add("hidden");
      parentWrapper?.appendChild(this.dropdownMenu);
    }

    if (typeof this.currentDisplayMode === "undefined") return;

    const hasTranslation =
      this.currentDisplayMode === "translate" ||
      this.currentDisplayMode === "both";
    const hasRomanization =
      this.currentDisplayMode === "romanize" ||
      this.currentDisplayMode === "both";

    if (!hasTranslation) {
      const optionDiv = document.createElement("div");
      optionDiv.className = "dropdown-option";
      optionDiv.textContent = t("showTranslation");
      optionDiv.addEventListener("click", () => {
        this.dropdownMenu.classList.add("hidden");
        let newMode = "translate";
        if (this.currentDisplayMode === "romanize") {
          newMode = "both";
        }
        if (this.setCurrentDisplayModeAndRefetchFn && this.lastKnownSongInfo) {
          this.setCurrentDisplayModeAndRefetchFn(
            newMode,
            this.lastKnownSongInfo
          );
        }
      });
      this.dropdownMenu.appendChild(optionDiv);
    }

    if (!hasRomanization) {
      const optionDiv = document.createElement("div");
      optionDiv.className = "dropdown-option";
      optionDiv.textContent =
        this.largerTextMode == "romanization"
          ? t("showOriginal")
          : t("showPronunciation");
      optionDiv.addEventListener("click", () => {
        this.dropdownMenu.classList.add("hidden");
        let newMode = "romanize";
        if (this.currentDisplayMode === "translate") {
          newMode = "both";
        }
        if (this.setCurrentDisplayModeAndRefetchFn && this.lastKnownSongInfo) {
          this.setCurrentDisplayModeAndRefetchFn(
            newMode,
            this.lastKnownSongInfo
          );
        }
      });
      this.dropdownMenu.appendChild(optionDiv);
    }

    const hasShowOptions = !hasTranslation || !hasRomanization;
    const hasHideOptions = hasTranslation || hasRomanization;

    if (hasShowOptions && hasHideOptions) {
      this.dropdownMenu.appendChild(document.createElement("div")).className =
        "dropdown-separator";
    }

    if (hasTranslation) {
      const optionDiv = document.createElement("div");
      optionDiv.className = "dropdown-option";
      optionDiv.textContent = t("hideTranslation");
      optionDiv.addEventListener("click", () => {
        this.dropdownMenu.classList.add("hidden");
        let newMode = "none";
        if (this.currentDisplayMode === "both") {
          newMode = "romanize";
        }
        if (this.setCurrentDisplayModeAndRefetchFn && this.lastKnownSongInfo) {
          this.setCurrentDisplayModeAndRefetchFn(
            newMode,
            this.lastKnownSongInfo
          );
        }
      });
      this.dropdownMenu.appendChild(optionDiv);
    }

    if (hasRomanization) {
      const optionDiv = document.createElement("div");
      optionDiv.className = "dropdown-option";
      optionDiv.textContent =
        this.largerTextMode == "romanization"
          ? t("hideOriginal")
          : t("hidePronunciation");
      optionDiv.addEventListener("click", () => {
        this.dropdownMenu.classList.add("hidden");
        let newMode = "none";
        if (this.currentDisplayMode === "both") {
          newMode = "translate";
        }
        if (this.setCurrentDisplayModeAndRefetchFn && this.lastKnownSongInfo) {
          this.setCurrentDisplayModeAndRefetchFn(
            newMode,
            this.lastKnownSongInfo
          );
        }
      });
      this.dropdownMenu.appendChild(optionDiv);
    }
  }

  _updateTranslationButtonText() {
    if (!this.translationButton) return;
    this.translationButton.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"><path d="m488-96 171-456h82L912-96h-79l-41-117H608L567-96h-79ZM169-216l-50-51 192-190q-36-38-67-79t-54-89h82q18 32 36 54.5t52 60.5q38-42 70-87.5t52-98.5H48v-72h276v-96h72v96h276v72H558q-21 69-61 127.5T409-457l91 90-28 74-112-112-191 189Zm463-63h136l-66-189-70 189Z"/></svg>';
    this.translationButton.title = t("showTranslationOptions") || "Translation";
  }

  /**
   * Cleans up the lyrics container and resets the state for the next song.
   */
  cleanupLyrics() {
    // Event Cleanup
    const scrollContainer = this.lyricsContainer?.parentElement;
    if (scrollContainer) {
      scrollContainer.removeEventListener('wheel', this._boundUserInteractionHandler);
      scrollContainer.removeEventListener('touchstart', this._boundUserInteractionHandler);
      scrollContainer.removeEventListener('keydown', this._boundUserInteractionHandler);
    }
    this.scrollEventHandlerAttached = false;
    clearTimeout(this.userScrollIdleTimer);

    // Animation Frame Cleanup
    if (this.lyricsAnimationFrameId) {
      cancelAnimationFrame(this.lyricsAnimationFrameId);
      this.lyricsAnimationFrameId = null;
    }

    // Cancel Debounced Resize Handler
    if (this._debouncedResizeHandler && this._debouncedResizeHandler.cancel) {
      this._debouncedResizeHandler.cancel();
    }

    // Timer Cleanup
    if (this.endProgrammaticScrollTimer) clearTimeout(this.endProgrammaticScrollTimer);
    if (this.userScrollIdleTimer) clearTimeout(this.userScrollIdleTimer);
    if (this.userScrollRevertTimer) clearTimeout(this.userScrollRevertTimer);

    this.endProgrammaticScrollTimer = null;
    this.userScrollIdleTimer = null;
    this.userScrollRevertTimer = null;

    // Observer Cleanup
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up Control Buttons
    if (this.translationButton) {
      const newBtn = this.translationButton.cloneNode(true);
      if (this.translationButton.parentNode) this.translationButton.parentNode.replaceChild(newBtn, this.translationButton);
      newBtn.remove();
      this.translationButton = null;
    }
    if (this.reloadButton) {
      const newBtn = this.reloadButton.cloneNode(true);
      if (this.reloadButton.parentNode) this.reloadButton.parentNode.replaceChild(newBtn, this.reloadButton);
      newBtn.remove();
      this.reloadButton = null;
    }
    if (this.dropdownMenu) {
      this.dropdownMenu.remove();
      this.dropdownMenu = null;
    }

    // DOM & Cache Cleanup
    const container = this._getContainer();

    if (this.cachedLyricsLines) {
      for (let i = 0; i < this.cachedLyricsLines.length; i++) {
        const line = this.cachedLyricsLines[i];
        if (line) {
          line.removeEventListener("click", this._boundLyricClickHandler);
          line._cachedSyllableElements = null;
          line._cachedCharSpans = null;
          line._hasSharedListener = false;
        }
      }
    }

    if (this.cachedSyllables) {
      for (let i = 0; i < this.cachedSyllables.length; i++) {
        const syl = this.cachedSyllables[i];
        if (syl) {
          syl._cachedCharSpans = null;
          syl._nextSyllableInWord = null;
          syl.style.animation = "";
        }
      }
    }

    if (container) {
      container.innerHTML = `<div class="loading-container"><span class="text-loading">${t("loading")}</span><div class="loading-loop-m3"></div></div>`;
      container.classList.add("lyrics-plus-message");
      container.className = "lyrics-plus-integrated lyrics-plus-message blur-inactive-enabled";

      container.style.removeProperty("--lyrics-scroll-offset");
      container.style.removeProperty("--lyplus-override-pallete");
      container.style.removeProperty("--lyplus-song-pallete");
    }

    // Release Graphics Memory
    if (this.textWidthCanvas) {
      this.textWidthCanvas.width = 0;
      this.textWidthCanvas.height = 0;
      this.textWidthCanvas = null;
    }

    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.currentFullscreenFocusedLine = null;
    this.lastTime = 0;

    this.activeLineIds.clear();
    this.visibleLineIds.clear();
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.fontCache = {};

    this._cachedContainerRect = null;

    this.currentScrollOffset = 0;
    this.isProgrammaticScrolling = false;
    this.isUserControllingScroll = false;

    this.currentDisplayMode = undefined;
    this.largerTextMode = "lyrics";

    this.lastKnownSongInfo = null;
    this.fetchAndDisplayLyricsFn = null;
    this.setCurrentDisplayModeAndRefetchFn = null;

    this._playerElement = undefined;
    this._customCssStyleTag = null;

    this._lastActiveIndex = 0;
    this._tempActiveLines = [];
  }

  /**
   * Injects custom CSS from settings into the document.
   * @param {string} customCSS - The custom CSS string to inject.
   * @private
   */
  _injectCustomCSS(customCSS) {
    if (!this._customCssStyleTag) {
      this._customCssStyleTag = document.createElement('style');
      this._customCssStyleTag.id = 'lyrics-plus-custom-css';
      document.head.appendChild(this._customCssStyleTag);
    }
    this._customCssStyleTag.textContent = customCSS || '';
  }
}
