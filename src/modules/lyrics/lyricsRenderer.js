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
    this.lastProcessedTime = 0;

    this.uiConfig = uiConfig;
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
    this._cachedContainerRect = null;
    this._debouncedResizeHandler = this._debounce(
      this._handleContainerResize,
      1,
      { leading: true, trailing: true }
    );

    this.translationButton = null;
    this.reloadButton = null;
    this.dropdownMenu = null;

    this.isProgrammaticScrolling = false;
    this.endProgrammaticScrollTimer = null;
    this.scrollEventHandlerAttached = false;
    this.currentScrollOffset = 0;
    this.touchStartY = 0;
    this.isTouching = false;
    this.userScrollIdleTimer = null;
    this.isUserControllingScroll = false;
    this.userScrollRevertTimer = null;

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
      this._scrollToActiveLine(this.currentPrimaryActiveLine, false);
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
    if (
      this.lyricsContainer &&
      this.lyricsContainer.parentElement &&
      !this.scrollEventHandlerAttached
    ) {
      this._setupUserScrollListener();
    }
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

    this.touchState = {
      isActive: false,
      startY: 0,
      lastY: 0,
      velocity: 0,
      lastTime: 0,
      momentum: null,
      samples: [],
      maxSamples: 5,
    };

    if (parentScrollElement) {
      parentScrollElement.addEventListener(
        "scroll",
        () => {
          if (this.isProgrammaticScrolling) {
            clearTimeout(this.endProgrammaticScrollTimer);
            this.endProgrammaticScrollTimer = setTimeout(() => {
              this.isProgrammaticScrolling = false;
              this.endProgrammaticScrollTimer = null;
            }, 250);
            return;
          }
          if (this.lyricsContainer) {
            this.lyricsContainer.classList.add("not-focused");
          }
        },
        { passive: true }
      );
    }

    scrollListeningElement.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.isProgrammaticScrolling = false;
        if (this.lyricsContainer) {
          this.lyricsContainer.classList.add(
            "not-focused",
            "user-scrolling",
            "wheel-scrolling"
          );
          this.lyricsContainer.classList.remove("touch-scrolling");
        }
        const scrollAmount = event.deltaY;
        this._handleUserScroll(scrollAmount);
        clearTimeout(this.userScrollIdleTimer);
        this.userScrollIdleTimer = setTimeout(() => {
          if (this.lyricsContainer) {
            this.lyricsContainer.classList.remove(
              "user-scrolling",
              "wheel-scrolling"
            );
          }
        }, 200);
      },
      { passive: false }
    );

    scrollListeningElement.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.touches[0];
        const now = performance.now();

        if (this.touchState.momentum) {
          cancelAnimationFrame(this.touchState.momentum);
          this.touchState.momentum = null;
        }

        this.touchState.isActive = true;
        this.touchState.startY = touch.clientY;
        this.touchState.lastY = touch.clientY;
        this.touchState.lastTime = now;
        this.touchState.velocity = 0;
        this.touchState.samples = [{ y: touch.clientY, time: now }];

        this.isProgrammaticScrolling = false;
        if (this.lyricsContainer) {
          this.lyricsContainer.classList.add(
            "not-focused",
            "user-scrolling",
            "touch-scrolling"
          );
          this.lyricsContainer.classList.remove("wheel-scrolling");
        }
        clearTimeout(this.userScrollIdleTimer);
      },
      { passive: true }
    );

    scrollListeningElement.addEventListener(
      "touchmove",
      (event) => {
        if (!this.touchState.isActive) return;

        event.preventDefault();
        const touch = event.touches[0];
        const now = performance.now();
        const currentY = touch.clientY;
        const deltaY = this.touchState.lastY - currentY;

        this.touchState.lastY = currentY;

        this.touchState.samples.push({ y: currentY, time: now });
        if (this.touchState.samples.length > this.touchState.maxSamples) {
          this.touchState.samples.shift();
        }

        // Apply immediate scroll with reduced sensitivity for smoother feel
        this._handleUserScroll(deltaY * 0.8);
      },
      { passive: false }
    );

    scrollListeningElement.addEventListener(
      "touchend",
      (event) => {
        if (!this.touchState.isActive) return;

        this.touchState.isActive = false;

        const now = performance.now();
        const samples = this.touchState.samples;

        if (samples.length >= 2) {
          // Use samples from last 100ms for velocity calculation
          const recentSamples = samples.filter(
            (sample) => now - sample.time <= 100
          );

          if (recentSamples.length >= 2) {
            const newest = recentSamples[recentSamples.length - 1];
            const oldest = recentSamples[0];
            const timeDelta = newest.time - oldest.time;
            const yDelta = oldest.y - newest.y;

            if (timeDelta > 0) {
              this.touchState.velocity = yDelta / timeDelta;
            }
          }
        }

        const minVelocity = 0.1;
        if (Math.abs(this.touchState.velocity) > minVelocity) {
          this._startMomentumScroll();
        } else {
          this._endTouchScrolling();
        }
      },
      { passive: true }
    );

    scrollListeningElement.addEventListener(
      "touchcancel",
      () => {
        this.touchState.isActive = false;
        if (this.touchState.momentum) {
          cancelAnimationFrame(this.touchState.momentum);
          this.touchState.momentum = null;
        }
        this._endTouchScrolling();
      },
      { passive: true }
    );

    this.scrollEventHandlerAttached = true;
  }

  /**
   * Starts momentum scrolling after touch end.
   * @private
   */
  _startMomentumScroll() {
    const deceleration = 0.95;
    const minVelocity = 0.01;

    const animate = () => {
      const scrollDelta = this.touchState.velocity * 16;
      this._handleUserScroll(scrollDelta);

      this.touchState.velocity *= deceleration;

      if (Math.abs(this.touchState.velocity) > minVelocity) {
        this.touchState.momentum = requestAnimationFrame(animate);
      } else {
        this.touchState.momentum = null;
        this._endTouchScrolling();
      }
    };

    this.touchState.momentum = requestAnimationFrame(animate);
  }

  /**
   * Cleans up touch scrolling state.
   * @private
   */
  _endTouchScrolling() {
    if (this.lyricsContainer) {
      this.lyricsContainer.classList.remove(
        "user-scrolling",
        "touch-scrolling"
      );
    }

    this.touchState.velocity = 0;
    this.touchState.samples = [];
  }

  /**
   * Handles the logic for manual user scrolling, calculating and clamping the new scroll position.
   * Also sets a timer to automatically resume player-controlled scrolling after a period of user inactivity.
   * @param {number} delta - The amount to scroll by.
   */
  _handleUserScroll(delta) {
    this.isUserControllingScroll = true;
    clearTimeout(this.userScrollRevertTimer);

    this.userScrollRevertTimer = setTimeout(() => {
      this.isUserControllingScroll = false;
      if (this.currentPrimaryActiveLine) {
        this._scrollToActiveLine(this.currentPrimaryActiveLine, true);
      }
    }, 4000);

    const scrollSensitivity = 0.7;
    let newScrollOffset = this.currentScrollOffset - delta * scrollSensitivity;

    const container = this._getContainer();
    if (!container) {
      this._animateScroll(newScrollOffset);
      return;
    }

    const allScrollableElements = Array.from(
      container.querySelectorAll(
        ".lyrics-line, .lyrics-plus-metadata, .lyrics-plus-empty"
      )
    );
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
      const contentTotalHeight =
        lastElement.offsetTop +
        lastElement.offsetHeight -
        firstElement.offsetTop;
      if (contentTotalHeight > containerHeight) {
        maxAllowedScroll =
          containerHeight - (lastElement.offsetTop + lastElement.offsetHeight);
      }
    }

    newScrollOffset = Math.max(newScrollOffset, maxAllowedScroll);
    newScrollOffset = Math.min(newScrollOffset, minAllowedScroll);

    this._animateScroll(newScrollOffset);
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
    lightweight,
    elementPool,
    fragment
  ) {
    const getComputedFont = (element) => {
      if (!element) return "400 16px sans-serif";
      const cacheKey = element.tagName + (element.className || "");
      if (this.fontCache[cacheKey]) return this.fontCache[cacheKey];
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      this.fontCache[cacheKey] = font;
      return font;
    };

    /**
     * Calculate pre-highlight delay based on exact wipe effect positioning.
     * @param {HTMLElement} syllable - The current syllable element.
     * @param {string} font - The computed font string.
     * @param {number} currentDuration - Duration of current syllable in ms.
     * @returns {number} Delay in milliseconds (negative for early start).
     */
    const calculatePreHighlightDelay = (syllable, font, currentDuration) => {
      const syllableWidthPx = this._getTextWidth(syllable.textContent, font);
      const emWidthPx = this._getTextWidth("M", font);
      const syllableWidthEm = syllableWidthPx / emWidthPx;

      const gradientWidth = 0.75;
      const gradientHalfWidth = gradientWidth / 2;
      const initialGradientPosition = -gradientHalfWidth;
      const finalGradientPosition = syllableWidthEm + gradientHalfWidth;
      const totalAnimationDistance =
        finalGradientPosition - initialGradientPosition;

      const triggerPointFromTextEnd = gradientHalfWidth;

      let triggerPosition;
      if (syllableWidthEm <= gradientWidth) {
        triggerPosition = -gradientHalfWidth * 0.5;
      } else {
        triggerPosition = syllableWidthEm - triggerPointFromTextEnd;
      }

      const distanceToTrigger = triggerPosition - initialGradientPosition;

      let triggerTimingFraction = 0;
      if (totalAnimationDistance > 0) {
        triggerTimingFraction = distanceToTrigger / totalAnimationDistance;
      }

      const rawDelayMs = triggerTimingFraction * currentDuration;

      return Math.round(rawDelayMs);
    };

    lyrics.data.forEach((line) => {
      let currentLine =
        elementPool.lines.pop() || document.createElement("div");
      currentLine.innerHTML = "";
      currentLine.className = "lyrics-line";
      currentLine.dataset.startTime = line.startTime;
      currentLine.dataset.endTime = line.endTime;
      const singerClass = line.element?.singer
        ? singerClassMap[line.element.singer] || "singer-left"
        : "singer-left";
      currentLine.classList.add(singerClass);
      if (!currentLine.hasClickListener) {
        currentLine.addEventListener("click", this._onLyricClick.bind(this));
        currentLine.hasClickListener = true;
      }

      const mainContainer = document.createElement("div");
      mainContainer.classList.add("main-vocal-container");
      currentLine.appendChild(mainContainer);

      this._renderTranslationContainer(currentLine, line, displayMode);

      let backgroundContainer = null;
      let wordBuffer = [];
      let currentWordStartTime = null;
      let currentWordEndTime = null;

      // Variables to hold the last syllable of the previous word to link across words
      let pendingSyllable = null;
      let pendingSyllableFont = null;

      const flushWordBuffer = () => {
        if (!wordBuffer.length) return;

        const wordSpan =
          elementPool.syllables.pop() || document.createElement("span");
        wordSpan.innerHTML = "";
        wordSpan.className = "lyrics-word";
        let referenceFont = mainContainer.firstChild
          ? getComputedFont(mainContainer.firstChild)
          : "400 16px sans-serif";
        const combinedText = wordBuffer.map((s) => this._getDataText(s)).join("");
        const totalDuration = currentWordEndTime - currentWordStartTime;
        const shouldEmphasize =
          !lightweight &&
          !this._isRTL(combinedText) &&
          !this._isCJK(combinedText) &&
          combinedText.trim().length <= 7 &&
          totalDuration >= 1000;

        let easedProgress = 0;
        let actualDecayRate = 0;
        let penaltyFactor = 1.0;
        if (shouldEmphasize) {
          const minDuration = 1000;
          const maxDuration = 2000;
          const easingPower = 3.0;

          const progress = Math.min(
            1,
            Math.max(
              0,
              (totalDuration - minDuration) / (maxDuration - minDuration)
            )
          );
          easedProgress = Math.pow(progress, easingPower);

          const durationProgressForDecay = Math.min(1, Math.max(0, (totalDuration - minDuration) / (maxDuration - minDuration)));
          const decayStrength = 1 - durationProgressForDecay;
          const maxDecayRate = 0.75;
          actualDecayRate = maxDecayRate * decayStrength;

          if (wordBuffer.length > 1) {
            const firstSyllableDuration = wordBuffer[0].duration;
            const imbalanceRatio = firstSyllableDuration / totalDuration;

            const penaltyThreshold = 0.25;

            if (imbalanceRatio < penaltyThreshold) {
              const minPenaltyFactor = 0.4;

              const penaltyProgress = imbalanceRatio / penaltyThreshold;
              penaltyFactor = minPenaltyFactor + (1.0 - minPenaltyFactor) * penaltyProgress;
            }
          }
        }

        wordSpan.style.setProperty(
          "--min-scale",
          Math.max(1.0, Math.min(1.06, 1.02))
        );
        wordSpan.dataset.totalDuration = totalDuration;

        let isCurrentWordBackground = wordBuffer[0].isBackground || false;
        const characterData = [];

        const syllableElements = [];

        wordBuffer.forEach((s, syllableIndex) => {
          const sylSpan =
            elementPool.syllables.pop() || document.createElement("span");
          sylSpan.innerHTML = "";
          sylSpan.className = "lyrics-syllable";

          sylSpan.dataset.startTime = s.time;
          sylSpan.dataset.duration = s.duration;
          sylSpan.dataset.endTime = s.time + s.duration;
          sylSpan.dataset.wordDuration = totalDuration;
          sylSpan.dataset.syllableIndex = syllableIndex;

          sylSpan._startTimeMs = s.time;
          sylSpan._durationMs = s.duration;
          sylSpan._endTimeMs = s.time + s.duration;
          sylSpan._wordDurationMs = totalDuration;

          if (this._isRTL(this._getDataText(s, true)))
            sylSpan.classList.add("rtl-text");

          syllableElements.push(sylSpan);

          const charSpansForSyllable = [];

          if (s.isBackground) {
            sylSpan.textContent = this._getDataText(s).replace(/[()]/g, "");
          } else {
            if (shouldEmphasize) {
              wordSpan.classList.add("growable");
              const syllableText = this._getDataText(s);
              const totalSyllableWidth = this._getTextWidth(
                syllableText,
                referenceFont
              );
              let cumulativeCharWidth = 0;
              let charIndex = 0;

              syllableText.split("").forEach((char) => {
                if (char === " ") {
                  sylSpan.appendChild(document.createTextNode(" "));
                } else {
                  const charSpan =
                    elementPool.chars.pop() || document.createElement("span");
                  charSpan.textContent = char;
                  charSpan.className = "char";

                  const charWidth = this._getTextWidth(char, referenceFont);
                  if (totalSyllableWidth > 0) {
                    const startPercent =
                      cumulativeCharWidth / totalSyllableWidth;
                    const durationPercent = charWidth / totalSyllableWidth;
                    charSpan.dataset.wipeStart = startPercent.toFixed(4);
                    charSpan.dataset.wipeDuration = durationPercent.toFixed(4);
                  }
                  cumulativeCharWidth += charWidth;

                  charSpan.dataset.charIndex = charIndex++;
                  charSpan.dataset.syllableCharIndex = characterData.length;
                  characterData.push({
                    charSpan,
                    syllableSpan: sylSpan,
                    isBackground: s.isBackground,
                  });
                  charSpansForSyllable.push(charSpan);
                  sylSpan.appendChild(charSpan);
                }
              });
            } else {
              sylSpan.textContent = this._getDataText(s);
            }
          }
          if (charSpansForSyllable.length > 0) {
            sylSpan._cachedCharSpans = charSpansForSyllable;
          }
          wordSpan.appendChild(sylSpan);
        });

        // Handle pending syllable from previous word (cross-word linking)
        if (pendingSyllable && syllableElements.length > 0) {
          const nextSyllable = syllableElements[0];
          const currentDuration = pendingSyllable._durationMs;

          const delayMs = calculatePreHighlightDelay(
            pendingSyllable,
            pendingSyllableFont,
            currentDuration
          ) * 1.03;

          pendingSyllable._nextSyllableInWord = nextSyllable;
          //avoid bleeding lmao
          pendingSyllable._preHighlightDurationMs = currentDuration - delayMs;
          pendingSyllable._preHighlightDelayMs = delayMs;
        }

        if (shouldEmphasize) {
          wordSpan._cachedChars = characterData.map((cd) => cd.charSpan);
        }

        // Handle syllables within the same word (intra-word linking)
        syllableElements.forEach((syllable, index) => {
          if (index < syllableElements.length - 1) {
            const nextSyllable = syllableElements[index + 1];
            const currentDuration = syllable._durationMs;

            const delayMs = calculatePreHighlightDelay(
              syllable,
              referenceFont,
              currentDuration
            );

            syllable._nextSyllableInWord = nextSyllable;
            syllable._preHighlightDurationMs = currentDuration - delayMs;
            syllable._preHighlightDelayMs = delayMs;
          }
        });

        if (shouldEmphasize && wordSpan._cachedChars?.length > 0) {
          const wordWidth = this._getTextWidth(
            wordSpan.textContent,
            referenceFont
          );
          let cumulativeWidth = 0;

          const numChars = wordSpan._cachedChars.length;
          wordSpan._cachedChars.forEach((span, index) => {
            const powerDecayFactor = 1.0 - (index / (numChars > 1 ? numChars - 1 : 1)) * actualDecayRate;

            const charProgress = easedProgress * powerDecayFactor * penaltyFactor;

            const charMaxScale = 1.0 + 0.05 + charProgress * 0.1;
            const charShadowIntensity = 0.4 + charProgress * 0.4;
            const normalizedGrowth = (charMaxScale - 1.0) / 0.13;
            const charTranslateYPeak = -normalizedGrowth * 2.5;

            span.style.setProperty("--max-scale", charMaxScale.toFixed(3));
            span.style.setProperty("--shadow-intensity", charShadowIntensity.toFixed(3));
            span.style.setProperty("--translate-y-peak", charTranslateYPeak.toFixed(3));

            const charWidth = this._getTextWidth(span.textContent, referenceFont);
            const position = (cumulativeWidth + charWidth / 2) / wordWidth;
            const horizontalOffset = (position - 0.5) * 2 * ((charMaxScale - 1.0) * 25);

            span.dataset.horizontalOffset = horizontalOffset;
            span.dataset.position = position;
            cumulativeWidth += charWidth;
          });
        }

        const targetContainer = isCurrentWordBackground
          ? backgroundContainer ||
          ((backgroundContainer = document.createElement("div")),
            (backgroundContainer.className = "background-vocal-container"),
            currentLine.appendChild(backgroundContainer))
          : mainContainer;
        targetContainer.appendChild(wordSpan);
        const trailText = combinedText.match(/\s+$/)
        if (trailText) targetContainer.appendChild(document.createTextNode(trailText));

        pendingSyllable =
          syllableElements.length > 0
            ? syllableElements[syllableElements.length - 1]
            : null;
        pendingSyllableFont = referenceFont;

        wordBuffer = [];
        currentWordStartTime = null;
        currentWordEndTime = null;
      };

      if (line.syllabus && line.syllabus.length > 0) {
        line.syllabus.forEach((s, syllableIndex) => {
          if (wordBuffer.length === 0) currentWordStartTime = s.time;
          wordBuffer.push(s);
          currentWordEndTime = s.time + s.duration;
          const isLastSyllableInLine =
            syllableIndex === line.syllabus.length - 1;
          const nextSyllable = line.syllabus[syllableIndex + 1];
          const endsWithExplicitDelimiter =
            s.isLineEnding || /\s$/.test(this._getDataText(s));
          const isBackgroundStatusChanging =
            nextSyllable &&
            s.isBackground !== nextSyllable.isBackground &&
            !endsWithExplicitDelimiter;
          if (
            endsWithExplicitDelimiter ||
            isLastSyllableInLine ||
            isBackgroundStatusChanging
          ) {
            flushWordBuffer();
          }
        });
      } else {
        mainContainer.textContent = line.text;
      }
      if (this._isRTL(mainContainer.textContent))
        mainContainer.classList.add("rtl-text");
      if (this._isRTL(mainContainer.textContent))
        currentLine.classList.add("rtl-text");
      fragment.appendChild(currentLine);
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
    elementPool,
    fragment
  ) {
    const lineFragment = document.createDocumentFragment();
    lyrics.data.forEach((line) => {
      const lineDiv = elementPool.lines.pop() || document.createElement("div");
      lineDiv.innerHTML = "";
      lineDiv.className = "lyrics-line";
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      const singerClass = line.element?.singer
        ? singerClassMap[line.element.singer] || "singer-left"
        : "singer-left";
      lineDiv.classList.add(singerClass);
      if (this._isRTL(this._getDataText(line, true)))
        lineDiv.classList.add("rtl-text");
      if (!lineDiv.hasClickListener) {
        lineDiv.addEventListener("click", this._onLyricClick.bind(this));
        lineDiv.hasClickListener = true;
      }
      const mainContainer = document.createElement("div");
      mainContainer.className = "main-vocal-container";
      mainContainer.textContent = this._getDataText(line);
      if (this._isRTL(this._getDataText(line, true)))
        mainContainer.classList.add("rtl-text");
      lineDiv.appendChild(mainContainer);
      this._renderTranslationContainer(lineDiv, line, displayMode);
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
    if (displayMode === "romanize" || displayMode === "both") {
      if (!this._isPurelyLatinScript(lineData.text)) {
        if (
          lineData.syllabus &&
          lineData.syllabus.length > 0 &&
          lineData.syllabus.some((s) => s.romanizedText)
        ) {
          const romanizationContainer = document.createElement("div");
          romanizationContainer.classList.add("lyrics-romanization-container");
          lineData.syllabus.forEach((syllable) => {
            const romanizedText = this._getDataText(syllable, false);
            if (romanizedText) {
              const sylSpan = document.createElement("span");
              sylSpan.className = "lyrics-syllable";
              sylSpan.textContent = romanizedText;
              if (this._isRTL(romanizedText)) sylSpan.classList.add("rtl-text");
              sylSpan.dataset.startTime = syllable.time;
              sylSpan.dataset.duration = syllable.duration;
              sylSpan.dataset.endTime = syllable.time + syllable.duration;
              sylSpan._startTimeMs = syllable.time;
              sylSpan._durationMs = syllable.duration;
              sylSpan._endTimeMs = syllable.time + syllable.duration;
              romanizationContainer.appendChild(sylSpan);
              const trailText = romanizedText.match(/\s+$/)
              if (trailText) romanizationContainer.appendChild(document.createTextNode(trailText));
            }
          });

          if (this._isRTL(romanizationContainer.textContent))
            romanizationContainer.classList.add("rtl-text");
          if (romanizationContainer.children.length > 0) {
            lineElement.appendChild(romanizationContainer);
          }
        } else if (
          lineData.romanizedText &&
          lineData.text.trim() !== lineData.romanizedText.trim()
        ) {
          const romanizationContainer = document.createElement("div");
          romanizationContainer.classList.add("lyrics-romanization-container");
          const romanizedText = this._getDataText(lineData, false);
          romanizationContainer.textContent = romanizedText;
          if (this._isRTL(romanizationContainer.textContent))
            romanizationContainer.classList.add("rtl-text");
          lineElement.appendChild(romanizationContainer);
        }
      }
    }
    if (displayMode === "translate" || displayMode === "both") {
      if (
        lineData.translatedText &&
        lineData.text.trim() !== lineData.translatedText.trim()
      ) {
        const translationContainer = document.createElement("div");
        translationContainer.classList.add("lyrics-translation-container");
        translationContainer.textContent = lineData.translatedText;
        lineElement.appendChild(translationContainer);
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
      container.style.setProperty(
        "--lyplus-override-pallete-white",
        `${currentSettings.overridePaletteColor}85`
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
            const alpha = 133 / 255;
            const r_blend = Math.round(alpha * 255 + (1 - alpha) * r);
            const g_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            const b_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            container.style.setProperty(
              "--lyplus-song-white-pallete",
              `rgb(${r_blend}, ${g_blend}, ${b_blend})`
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
    if (isDualSide) container.classList.add("dual-side-lyrics");

    const elementPool = { lines: [], syllables: [], chars: [] };

    const createGapLine = (gapStart, gapEnd, classesToInherit = null) => {
      const gapDuration = gapEnd - gapStart;
      const gapLine = elementPool.lines.pop() || document.createElement("div");
      gapLine.className = "lyrics-line lyrics-gap";
      gapLine.dataset.startTime = gapStart;
      gapLine.dataset.endTime = gapEnd;
      if (!gapLine.hasClickListener) {
        gapLine.addEventListener("click", this._onLyricClick.bind(this));
        gapLine.hasClickListener = true;
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
        const syllableSpan =
          elementPool.syllables.pop() || document.createElement("span");
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
        currentSettings.lightweight,
        elementPool,
        fragment
      );
    } else {
      this._renderLineByLineLyrics(
        lyrics,
        displayMode,
        singerClassMap,
        elementPool,
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
        (lyrics.data[lyrics.data.length - 1]?.endTime || 0) + 10;
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
        ".lyrics-line, .lyrics-plus-metadata, .lyrics-plus-empty"
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
    this.highlightedSyllableIds.clear();
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
   * @param {string} source - The source of the lyrics.
   * @param {string} type - The type of lyrics ("Line" or "Word").
   * @param {boolean} lightweight - Flag for lightweight mode.
   * @param {string[]} songWriters - Array of songwriters.
   * @param {object} songInfo - Information about the current song.
   * @param {string} displayMode - The current display mode ('none', 'translate', 'romanize').
   * @param {object} currentSettings - The current user settings.
   * @param {Function} fetchAndDisplayLyricsFn - The function to fetch and display lyrics.
   * @param {Function} setCurrentDisplayModeAndRefetchFn - The function to set display mode and refetch.
   */
  displayLyrics(
    lyrics,
    source = "Unknown",
    type = "Line",
    lightweight = false,
    songWriters,
    songInfo,
    displayMode = "none",
    currentSettings = {},
    fetchAndDisplayLyricsFn,
    setCurrentDisplayModeAndRefetchFn,
    largerTextMode = "lyrics"
  ) {
    this.lastKnownSongInfo = songInfo;
    this.fetchAndDisplayLyricsFn = fetchAndDisplayLyricsFn;
    this.setCurrentDisplayModeAndRefetchFn = setCurrentDisplayModeAndRefetchFn;
    this.largerTextMode = largerTextMode;

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
      lightweight
    );

    if (currentSettings.overridePaletteColor) {
      container.classList.add("override-palette-color");
      container.style.setProperty(
        "--lyplus-override-pallete",
        currentSettings.overridePaletteColor
      );
      container.style.setProperty(
        "--lyplus-override-pallete-white",
        `${currentSettings.overridePaletteColor}85`
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
            const alpha = 133 / 255;
            const r_blend = Math.round(alpha * 255 + (1 - alpha) * r);
            const g_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            const b_blend = Math.round(alpha * 255 + (1 - alpha) * b);
            container.style.setProperty(
              "--lyplus-song-white-pallete",
              `rgb(${r_blend}, ${g_blend}, ${b_blend})`
            );
          }
        }
      }
    }

    container.classList.toggle(
      "fullscreen",
      document.body.hasAttribute("player-fullscreened_")
    );
    const isWordByWordMode = type === "Word" && currentSettings.wordByWord;
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
    const canvas =
      this.textWidthCanvas ||
      (this.textWidthCanvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    return context.measureText(text).width;
  }

  _ensureElementIds() {
    if (!this.cachedLyricsLines || !this.cachedSyllables) return;
    this.cachedLyricsLines.forEach((line, i) => {
      if (line && !line.id) line.id = `line-${i}`;
    });
    this.cachedSyllables.forEach((syllable, i) => {
      if (syllable && !syllable.id) syllable.id = `syllable-${i}`;
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
        const currentTime = this._getCurrentPlayerTime() * 1000;
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
    this._updateLyricsHighlight(currentTime, isForceScroll, currentSettings);
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

    let visibleLines = this._cachedVisibleLines;
    const currentVisibilityHash =
      this.visibleLineIds.size > 0
        ? Array.from(this.visibleLineIds).sort().join(",")
        : "";

    if (!visibleLines || this._lastVisibilityHash !== currentVisibilityHash) {
      visibleLines = this.cachedLyricsLines.filter((line) =>
        this.visibleLineIds.has(line.id)
      );
      this._cachedVisibleLines = visibleLines;
      this._lastVisibilityHash = currentVisibilityHash;
    }

    const activeLinesForHighlighting = [];

    for (let i = 0; i < visibleLines.length; i++) {
      const line = visibleLines[i];
      if (
        line &&
        currentTime >= line._startTimeMs - highlightLookAheadMs &&
        currentTime <= line._endTimeMs - highlightLookAheadMs
      ) {
        activeLinesForHighlighting.push(line);
      }
    }

    if (activeLinesForHighlighting.length > 3) {
      activeLinesForHighlighting.splice(
        0,
        activeLinesForHighlighting.length - 3
      );
    }

    if (activeLinesForHighlighting.length > 1) {
      activeLinesForHighlighting.sort(
        (a, b) => a._startTimeMs - b._startTimeMs
      );
    }

    const newActiveLineIds = new Set(
      activeLinesForHighlighting.map((line) => line.id)
    );

    const activeLineIdsChanged =
      this.activeLineIds.size !== newActiveLineIds.size ||
      [...this.activeLineIds].some((id) => !newActiveLineIds.has(id));

    if (activeLineIdsChanged) {
      const toDeactivate = [];
      for (const lineId of this.activeLineIds) {
        if (!newActiveLineIds.has(lineId)) {
          toDeactivate.push(lineId);
        }
      }

      const toActivate = [];
      for (const lineId of newActiveLineIds) {
        if (!this.activeLineIds.has(lineId)) {
          toActivate.push(lineId);
        }
      }

      if (toDeactivate.length > 0) {
        this._batchDeactivateLines(toDeactivate);
      }
      if (toActivate.length > 0) {
        this._batchActivateLines(toActivate);
      }

      this.activeLineIds = newActiveLineIds;
    }

    let candidates = this._findActiveLine(
      predictiveTime,
      currentTime - scrollLookAheadMs
    );

    if (candidates.length > 3) {
      candidates = candidates.slice(-3);
    }

    let lineToScroll = candidates[0];

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

    const mostRecentActiveLine =
      activeLinesForHighlighting.length > 0
        ? activeLinesForHighlighting[activeLinesForHighlighting.length - 1]
        : null;
    if (this.currentFullscreenFocusedLine !== mostRecentActiveLine) {
      if (this.currentFullscreenFocusedLine) {
        this.currentFullscreenFocusedLine.classList.remove(
          "fullscreen-focused"
        );
      }
      if (mostRecentActiveLine) {
        mostRecentActiveLine.classList.add("fullscreen-focused");
      }
      this.currentFullscreenFocusedLine = mostRecentActiveLine;
    }

    this._updateSyllables(currentTime);

    if (
      this.lyricsContainer &&
      this.lyricsContainer.classList.contains("hide-offscreen")
    ) {
      if (this._lastVisibilityUpdateSize !== this.visibleLineIds.size) {
        this._batchUpdateViewportVisibility();
        this._lastVisibilityUpdateSize = this.visibleLineIds.size;
      }
    }
  }

  _findActiveLine(predictiveTime, lookAheadTime) {
    const lines = this.cachedLyricsLines;
    const currentlyActiveAndPredictiveLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line &&
        predictiveTime >= line._startTimeMs &&
        predictiveTime < line._endTimeMs
      ) {
        currentlyActiveAndPredictiveLines.push(line);
      }
    }

    if (currentlyActiveAndPredictiveLines.length > 0) {
      return currentlyActiveAndPredictiveLines;
    }

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line && lookAheadTime >= line._startTimeMs) {
        return [line];
      }
    }

    return lines.length > 0 ? [lines[0]] : [];
  }

  /**
   * Batch deactivate lines to reduce DOM thrashing
   */
  _batchDeactivateLines(lineIds) {
    for (const lineId of lineIds) {
      const line = document.getElementById(lineId);
      if (line) {
        line.classList.remove("active");
        this._resetSyllables(line);
      }
    }
  }

  /**
   * Batch activate lines to reduce DOM thrashing
   */
  _batchActivateLines(lineIds) {
    for (const lineId of lineIds) {
      const line = document.getElementById(lineId);
      if (line) {
        line.classList.add("active");
      }
    }
  }

  /**
   * Batch update viewport visibility
   */
  _batchUpdateViewportVisibility() {
    const lines = this.cachedLyricsLines;
    const visibleIds = this.visibleLineIds;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        const isOutOfView = !visibleIds.has(line.id);
        line.classList.toggle("viewport-hidden", isOutOfView);
      }
    }
  }

  _updateSyllables(currentTime) {
    if (!this.activeLineIds.size) return;

    // Cache syllable queries to avoid repeated DOM lookups
    const activeSyllables = [];

    for (const lineId of this.activeLineIds) {
      const parentLine = document.getElementById(lineId);
      if (!parentLine) continue;

      let syllables = parentLine._cachedSyllableElements;
      if (!syllables) {
        syllables = parentLine.querySelectorAll(".lyrics-syllable");
        parentLine._cachedSyllableElements = syllables;
      }

      for (let j = 0; j < syllables.length; j++) {
        const syllable = syllables[j];
        if (syllable && typeof syllable._startTimeMs === "number") {
          activeSyllables.push(syllable);
        }
      }
    }

    // Process all syllables in batches
    const toHighlight = [];
    const toFinish = [];
    const toReset = [];

    for (const syllable of activeSyllables) {
      const startTime = syllable._startTimeMs;
      const endTime = syllable._endTimeMs;
      const classList = syllable.classList;
      const hasHighlight = classList.contains("highlight");
      const hasFinished = classList.contains("finished");

      if (currentTime >= startTime && currentTime <= endTime) {
        if (!hasHighlight) {
          toHighlight.push(syllable);
        }
        if (hasFinished) {
          classList.remove("finished");
        }
      } else if (currentTime > endTime) {
        if (!hasFinished) {
          if (!hasHighlight) {
            toHighlight.push(syllable);
          }
          toFinish.push(syllable);
        }
      } else {
        if (hasHighlight || hasFinished) {
          toReset.push(syllable);
        }
      }
    }

    // Batch apply changes
    for (const syllable of toHighlight) {
      this._updateSyllableAnimation(syllable);
    }
    for (const syllable of toFinish) {
      syllable.classList.add("finished");
    }
    for (const syllable of toReset) {
      this._resetSyllable(syllable);
    }
  }

  _updateSyllableAnimation(syllable) {
    // --- READ PHASE ---
    if (syllable.classList.contains("highlight")) return;

    const classList = syllable.classList;
    const isRTL = classList.contains("rtl-text");
    const charSpans = syllable._cachedCharSpans;
    const wordElement = syllable.parentElement;
    const allWordCharSpans = wordElement?._cachedChars;
    const isGrowable = wordElement?.classList.contains("growable");
    const isFirstSyllable = syllable.dataset.syllableIndex === "0";
    const isGap =
      syllable.parentElement?.parentElement?.parentElement?.classList.contains(
        "lyrics-gap"
      );
    const nextSyllable = syllable._nextSyllableInWord;

    // --- CALCULATION PHASE ---
    const pendingStyleUpdates = [];
    const charAnimationsMap = new Map();
    const wipeAnimation = isRTL ? "wipe-rtl" : "wipe";

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
        const wipeDelay =
          syllableDuration * (parseFloat(span.dataset.wipeStart) || 0);
        const wipeDuration =
          syllableDuration * (parseFloat(span.dataset.wipeDuration) || 0);

        const existingAnimation =
          charAnimationsMap.get(span) || span.style.animation;
        const animationParts = [];

        if (existingAnimation && existingAnimation.includes("grow-dynamic")) {
          animationParts.push(existingAnimation.split(",")[0].trim());
        }

        if (charIndex > 0) {
          const prevChar = charSpans[charIndex - 1];
          const prevWipeDelay =
            syllableDuration * (parseFloat(prevChar.dataset.wipeStart) || 0);
          const prevWipeDuration =
            syllableDuration * (parseFloat(prevChar.dataset.wipeDuration) || 0);

          if (prevWipeDuration > 0) {
            animationParts.push(
              `pre-wipe-char ${prevWipeDuration}ms linear ${prevWipeDelay}ms`
            );
          }
        }

        if (wipeDuration > 0) {
          animationParts.push(
            `${wipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`
          );
        }

        charAnimationsMap.set(span, animationParts.join(", "));
      });
    } else {
      const currentWipeAnimation = isGap ? "fade-gap" : wipeAnimation;
      const syllableAnimation = `${currentWipeAnimation} ${syllable._durationMs}ms linear forwards`;
      pendingStyleUpdates.push({
        element: syllable,
        property: "animation",
        value: syllableAnimation,
      });
    }

    // Step 3: Pre-Wipe Pass.
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
        const preWipeAnim = `pre-wipe-char ${preHighlightDuration}ms ${preHighlightDelay}ms forwards`;
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

  _resetSyllable(syllable) {
    if (!syllable) return;
    syllable.style.animation = "";
    if (!syllable.classList.contains("finished")) {
      syllable.classList.add("finished");
      syllable.offsetHeight;
    }
    syllable.classList.remove("highlight", "finished", "pre-highlight");
    syllable.style.removeProperty("--pre-wipe-duration");
    syllable.style.removeProperty("--pre-wipe-delay");
    syllable.querySelectorAll("span.char").forEach((span) => {
      span.style.animation = "";
    });
  }

  _resetSyllables(line) {
    if (!line) return;
    Array.from(line.getElementsByClassName("lyrics-syllable")).forEach(
      this._resetSyllable
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

    if (
      !forceScroll &&
      Math.abs(this.currentScrollOffset - newTranslateY) < 0.1
    )
      return;

    this.currentScrollOffset = newTranslateY;

    this.lyricsContainer.style.setProperty(
      "--lyrics-scroll-offset",
      `${newTranslateY}px`
    );

    const isUserScrolling =
      this.lyricsContainer.classList.contains("user-scrolling");

    if (forceScroll || isUserScrolling) {
      // Batch clear delays
      const elements = this.cachedLyricsLines;
      for (let i = 0; i < elements.length; i++) {
        if (elements[i]) {
          elements[i].style.setProperty("--lyrics-line-delay", "0ms");
        }
      }
      return;
    }

    const referenceLine =
      this.currentPrimaryActiveLine ||
      this.lastPrimaryActiveLine ||
      (this.cachedLyricsLines.length > 0 ? this.cachedLyricsLines[0] : null);

    if (!referenceLine) return;

    const referenceLineIndex = this.cachedLyricsLines.indexOf(referenceLine);
    if (referenceLineIndex === -1) return;

    const delayIncrement = 30;
    let delayCounter = 0;
    const elements = this.cachedLyricsLines;
    const visibleIds = this.visibleLineIds;

    // Batch style updates
    const styleUpdates = [];

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (!element) continue;

      if (visibleIds.has(element.id)) {
        const delay =
          i >= referenceLineIndex ? delayCounter * delayIncrement : 0;
        styleUpdates.push({ element, delay: `${delay}ms` });
        if (i >= referenceLineIndex) {
          delayCounter++;
        }
      } else {
        styleUpdates.push({ element, delay: "0ms" });
      }
    }

    for (const update of styleUpdates) {
      update.element.style.setProperty("--lyrics-line-delay", update.delay);
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
      "pre-active-line",
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
      if (position === -1) element.classList.add("pre-active-line");
      else if (position === 1) element.classList.add("next-active-line");
      else if (position < 0)
        element.classList.add(`prev-${Math.abs(position)}`);
      else element.classList.add(`next-${position}`);
    }

    this._scrollToActiveLine(lineToScroll, forceScroll);
  }

  _scrollToActiveLine(activeLine, forceScroll = false) {
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

    const containerTop = this._cachedContainerRect
      ? this._cachedContainerRect.containerTop
      : this.lyricsContainer.getBoundingClientRect().top;
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

    this._animateScroll(targetTranslateY);
  }

  _setupVisibilityTracking() {
    const container = this._getContainer();
    if (!container || !container.parentElement) return null;
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.id;
          if (entry.isIntersecting) this.visibleLineIds.add(id);
          else this.visibleLineIds.delete(id);
        });
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

    this._lastResizeContentRect = null;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== container) continue;
        this._lastResizeContentRect = entry.contentRect || null;
        this._debouncedResizeHandler(container);
      }
    });

    this.resizeObserver.observe(container);
    return this.resizeObserver;
  }

  _createControlButtons() {
    let buttonsWrapper = document.getElementById("lyrics-plus-buttons-wrapper");
    if (!buttonsWrapper) {
      buttonsWrapper = document.createElement("div");
      buttonsWrapper.id = "lyrics-plus-buttons-wrapper";
      const originalLyricsSection = document.querySelector(
        this.uiConfig.patchParent
      );
      if (originalLyricsSection) {
        originalLyricsSection.appendChild(buttonsWrapper);
      }
    }

    if (this.setCurrentDisplayModeAndRefetchFn) {
      if (!this.translationButton) {
        this.translationButton = document.createElement("button");
        this.translationButton.id = "lyrics-plus-translate-button";
        buttonsWrapper.appendChild(this.translationButton);
        this._updateTranslationButtonText();
        this.translationButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this._createDropdownMenu(buttonsWrapper);
          if (this.dropdownMenu) this.dropdownMenu.classList.toggle("hidden");
        });
        document.addEventListener("click", (event) => {
          if (
            this.dropdownMenu &&
            !this.dropdownMenu.classList.contains("hidden") &&
            !this.dropdownMenu.contains(event.target) &&
            event.target !== this.translationButton
          ) {
            this.dropdownMenu.classList.add("hidden");
          }
        });
      }
    }

    if (!this.reloadButton) {
      this.reloadButton = document.createElement("button");
      this.reloadButton.id = "lyrics-plus-reload-button";
      this.reloadButton.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e3e3e3"><path d="M480-192q-120 0-204-84t-84-204q0-120 84-204t204-84q65 0 120.5 27t95.5 72v-99h72v240H528v-72h131q-29-44-76-70t-103-26q-90 0-153 63t-63 153q0 90 63 153t153 63q84 0 144-55.5T693-456h74q-9 112-91 188t-196 76Z"/></svg>';
      this.reloadButton.title = t("RefreshLyrics") || "Refresh Lyrics";
      buttonsWrapper.appendChild(this.reloadButton);
      this.reloadButton.addEventListener("click", () => {
        if (this.lastKnownSongInfo && this.fetchAndDisplayLyricsFn) {
          this.fetchAndDisplayLyricsFn(this.lastKnownSongInfo, true, true);
        }
      });
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
      '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#e3e3e3"><path d="m488-96 171-456h82L912-96h-79l-41-117H608L567-96h-79ZM169-216l-50-51 192-190q-36-38-67-79t-54-89h82q18 32 36 54.5t52 60.5q38-42 70-87.5t52-98.5H48v-72h276v-96h72v96h276v72H558q-21 69-61 127.5T409-457l91 90-28 74-112-112-191 189Zm463-63h136l-66-189-70 189Z"/></svg>';
    this.translationButton.title = t("showTranslationOptions") || "Translation";
  }

  /**
   * Cleans up the lyrics container and resets the state for the next song.
   */
  cleanupLyrics() {
    // --- Animation Frame Cleanup ---
    if (this.lyricsAnimationFrameId) {
      cancelAnimationFrame(this.lyricsAnimationFrameId);
      this.lyricsAnimationFrameId = null;
    }

    // --- Touch State Cleanup ---
    if (this.touchState) {
      if (this.touchState.momentum) {
        cancelAnimationFrame(this.touchState.momentum);
        this.touchState.momentum = null;
      }
      this.touchState.isActive = false;
      this.touchState.startY = 0;
      this.touchState.lastY = 0;
      this.touchState.velocity = 0;
      this.touchState.lastTime = 0;
      this.touchState.samples = [];
    }

    // --- Timer Cleanup ---
    if (this.endProgrammaticScrollTimer)
      clearTimeout(this.endProgrammaticScrollTimer);
    if (this.userScrollIdleTimer) clearTimeout(this.userScrollIdleTimer);
    if (this.userScrollRevertTimer) clearTimeout(this.userScrollRevertTimer);
    this.endProgrammaticScrollTimer = null;
    this.userScrollIdleTimer = null;
    this.userScrollRevertTimer = null;

    // --- Observer Cleanup ---
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.visibilityObserver = null;
    this.resizeObserver = null;

    // --- DOM Elements Cleanup ---
    const container = this._getContainer();
    if (container) {
      if (this.cachedLyricsLines) {
        this.cachedLyricsLines.forEach((line) => {
          if (line && line._cachedSyllableElements) {
            line._cachedSyllableElements = null;
          }
        });
      }

      if (this.cachedSyllables) {
        this.cachedSyllables.forEach((syllable) => {
          if (syllable) {
            syllable._cachedCharSpans = null;
            syllable.style.animation = "";
            syllable.style.removeProperty("--pre-wipe-duration");
            syllable.style.removeProperty("--pre-wipe-delay");
          }
        });
      }

      container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
      container.classList.add("lyrics-plus-message");

      const classesToRemove = [
        "user-scrolling",
        "wheel-scrolling",
        "touch-scrolling",
        "not-focused",
        "lyrics-translated",
        "lyrics-romanized",
        "lyrics-both-modes",
        "word-by-word-mode",
        "line-by-line-mode",
        "mixed-direction-lyrics",
        "dual-side-lyrics",
        "fullscreen",
        "blur-inactive-enabled",
        "use-song-palette-fullscreen",
        "use-song-palette-all-modes",
        "override-palette-color",
        "hide-offscreen",
        "romanized-big-mode",
      ];
      container.classList.remove(...classesToRemove);

      container.style.removeProperty("--lyrics-scroll-offset");
      container.style.removeProperty("--lyplus-override-pallete");
      container.style.removeProperty("--lyplus-override-pallete-white");
      container.style.removeProperty("--lyplus-song-pallete");
      container.style.removeProperty("--lyplus-song-white-pallete");
    }

    // --- State Variables Reset ---
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.currentFullscreenFocusedLine = null;
    this.lastTime = 0;
    this.lastProcessedTime = 0;

    this.activeLineIds.clear();
    this.highlightedSyllableIds.clear();
    this.visibleLineIds.clear();
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];

    this._cachedContainerRect = null;
    this._cachedVisibleLines = null;
    this._lastVisibilityHash = null;
    this._lastVisibilityUpdateSize = null;

    this.currentScrollOffset = 0;
    this.isProgrammaticScrolling = false;
    this.isUserControllingScroll = false;

    this.currentDisplayMode = undefined;
    this.largerTextMode = "lyrics";

    this.lastKnownSongInfo = null;
    this.fetchAndDisplayLyricsFn = null;
    this.setCurrentDisplayModeAndRefetchFn = null;

    this.fontCache = {};

    this._playerElement = undefined;
    this._customCssStyleTag = null;
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
