class LyricsPlusRenderer {
  /**
   * Static regular expressions and segmenter shared across all instances
   * to eliminate object allocation and compilation overhead.
   */
  static _RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/;
  static _CJK_RE = /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;
  static _LATIN_RE = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u;
  static _BIDI_CHECK_RE = /[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u;
  static _LETTER_OR_NUM_RE = /[\p{L}\p{N}]/u;
  static _TRAILING_PUNCT_RE = /^[!?.,;:~…‥。、！？]/;
  static _FONT_SIZE_RE = /(\d+(?:\.\d+)?)px/;
  static _SEGMENTER = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;
  static _fontSizeCache = new Map();
  static _MASK_LEAD_TRIM = 1;
  static _POSITION_CLASSES = [
    "lyrics-activest", "post-active-line", "next-active-line",
    "prev-1", "prev-2", "prev-3", "prev-4",
    "next-1", "next-2", "next-3", "next-4",
  ];
  static _POSITION_SELECTOR = "." + LyricsPlusRenderer._POSITION_CLASSES.join(", .");

  /**
   * Helper function to segment text into graphemes efficiently.
   * Reuses static Intl.Segmenter instance.
   * @param {string} text - The input text string.
   * @returns {string[]} - Array of graphemes.
   */
  static _segmentGraphemes(text) {
    if (!text) return [];
    const merged = [];
    const punctRe = LyricsPlusRenderer._TRAILING_PUNCT_RE;
    const add = (char) => {
      if (merged.length > 0 && punctRe.test(char)) {
        merged[merged.length - 1] += char;
      } else {
        merged.push(char);
      }
    };
    if (LyricsPlusRenderer._SEGMENTER) {
      for (const s of LyricsPlusRenderer._SEGMENTER.segment(text)) add(s.segment);
    } else {
      for (const ch of text) add(ch);
    }
    return merged;
  }

  /**
   * Helper function to extract numeric font size in pixels from computed font string.
   * Caches results in static map.
   * @param {string} font - Font string (e.g. "700 24px Roboto").
   * @returns {number} - Font size in pixels.
   */
  static _getFontSizePx(font) {
    let size = LyricsPlusRenderer._fontSizeCache.get(font);
    if (size !== undefined) return size;
    const match = font.match(LyricsPlusRenderer._FONT_SIZE_RE);
    size = match ? parseFloat(match[1]) : 16;
    LyricsPlusRenderer._fontSizeCache.set(font, size);
    return size;
  }

  static _SPRING_EASING_CACHE = new Map();

  static _cubicBezierY(t, x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * u + bx) * u + cx) * u - t;
      const dx = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return ((ay * u + by) * u + cy) * u;
  }

  static _getSpringEasing(peakTimeMs, zeta = 0.78, settleTailMs = 400, mass = 1) {
    peakTimeMs = Math.round(peakTimeMs / 10) * 10;
    settleTailMs = Math.round(settleTailMs / 10) * 10;
    const key = `${peakTimeMs}:${zeta}:${settleTailMs}:${mass}`;
    const cached = LyricsPlusRenderer._SPRING_EASING_CACHE.get(key);
    if (cached) return cached;

    const peakTimeS = peakTimeMs / 1000;
    const settleTailS = settleTailMs / 1000;
    const omegaD = Math.PI / peakTimeS;
    const omega0 = omegaD / Math.sqrt(1 - zeta * zeta);
    const decayRate = zeta * omega0;
    const dt = 1 / 120;

    let peakValue = 1;
    for (let t = 0; t <= peakTimeS; t += dt) {
      peakValue = 1 - Math.exp(-decayRate * t) * (Math.cos(omegaD * t) + (decayRate / omegaD) * Math.sin(omegaD * t));
    }

    const points = [];
    for (let t = 0; t <= peakTimeS; t += dt) {
      const u = t / peakTimeS;
      points.push(peakValue * LyricsPlusRenderer._cubicBezierY(u, 0.41, 0, 0.12, 0.99));
    }

    for (let t = dt; t <= settleTailS; t += dt) {
      const u = t / settleTailS;
      points.push(1 + (peakValue - 1) * 0.5 * (1 + Math.cos(Math.PI * u)));
    }

    points.push(1);
    const easing = `linear(${points.map((v) => v.toFixed(4)).join(",")})`;
    const result = { easing, duration: Math.round((peakTimeS + settleTailS) * 1000) };
    const springCache = LyricsPlusRenderer._SPRING_EASING_CACHE;
    if (springCache.size >= 64) springCache.delete(springCache.keys().next().value);
    springCache.set(key, result);
    return result;
  }

  /**
   * Constructor for the LyricsPlusRenderer.
   * Initializes state variables and sets up the initial environment for the lyrics display.
   * @param {object} uiConfig - Configuration for UI element selectors.
   */
  constructor(uiConfig) {
    this.lyricsAnimationFrameId = null;
    this.currentPrimaryActiveLine = null;
    this._resetGapState();
    this.lastPrimaryActiveLine = null;
    this.currentFullscreenFocusedLine = null;
    this.lastTime = 0;
    this.offsetLatency = 0;

    this.uiConfig = uiConfig;
    this.lyricsContainer = null;
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.activeLineIds = new Set();
    this.visibleLineIds = new Set();
    this.fontCache = Object.create(null);
    this._textWidthCache = new Map();

    this.textWidthCanvas = null;
    this.textWidthCtx = null;
    this._lastCtxFont = null;

    this.visibilityObserver = null;
    this.resizeObserver = null;
    this.containerObserver = null;
    this._debouncedResizeHandler = this._debounce(
      this._handleContainerResize,
      1,
      { leading: true, trailing: true }
    );

    this.translationButton = null;
    this.reloadButton = null;
    this.dropdownMenu = null;
    this.optionsDropdown = null;
    this.userOffsetMs = 0;
    this.currentLyrics = null;
    this._userSelectedProvider = null;
    this.availableProviders = new Set();
    this._notFoundProviders = new Set();
    this._saveOffsetTimeout = null;
    this._toastElement = null;
    this._toastTimeout = null;
    this.buttonsWrapper = null;
    this._boundContainerClickHandler = this._onContainerClick.bind(this);

    this.scrollEventHandlerAttached = false;
    this.currentScrollOffset = 0;
    this.userScrollIdleTimer = null;
    this.isUserControllingScroll = false;

    this._boundUserInteractionHandler = this._onUserInteraction.bind(this);
    this._boundTouchStartHandler = this._onTouchStart.bind(this);
    this._boundTouchMoveHandler = this._onTouchMove.bind(this);

    this._touchStartY = 0;
    this._touchStartX = 0;

    this._lastActiveIndex = 0;
    this._tempActiveLines = [];
    this._activeIndices = [];
    this._lineById = new Map();
    this._positionClassedLines = [];
    this._animatingLines = [];
    this._visibilityChanges = [];
    this._springConfigCache = null;
    this._elevationConfigCache = null;

    this.wakeLock = null;

    this._getContainer();
  }

  async _requestWakeLock() {
    // Guard: IntersectionObserver can fire repeatedly; never stack locks.
    if (!('wakeLock' in navigator) || this.wakeLock || this._wakeLockPending) return;
    this._wakeLockPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      this.wakeLock = lock;
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) this.wakeLock = null;
      });
    } catch (err) {
      console.warn(`LYPLUS: Wakelock error: ${err.name}, ${err.message}`);
    } finally {
      this._wakeLockPending = false;
    }
  }

  _releaseWakeLock() {
    const lock = this.wakeLock;
    if (!lock) return;
    this.wakeLock = null;
    lock.release().catch(err => {
      console.warn(`LYPLUS: Wakelock release error: ${err.name}, ${err.message}`);
    });
  }

  _setupContainerObserver() {
    if (!this.lyricsContainer) return;

    if (!this.containerObserver) {
      this.containerObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) {
            this._requestWakeLock();
          } else {
            this._releaseWakeLock();
          }
        }
      }, { threshold: 0.01 });
      this.containerObserver.observe(this.lyricsContainer);
    }
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

    const isRomanizationMode = this.largerTextMode === "romanization";

    if (isOriginal) {
      return isRomanizationMode
        ? normal.romanizedText || normal.text || ""
        : normal.text || "";
    } else {
      return isRomanizationMode
        ? normal.text || ""
        : normal.romanizedText || normal.text || "";
    }
  }

  /**
   * Handles the actual logic for container resize, debounced by _debouncedResizeHandler.
   * @param {HTMLElement} container - The lyrics container element.
   * @private
   */
  _handleContainerResize(container) {
    if (!container) return;

    this._scrollPaddingTopCache = undefined;
    this._containerDisplayCache = undefined;
    this._springConfigCache = null;
    this._elevationConfigCache = null;
    this._positionClassedLines = [];

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
    return LyricsPlusRenderer._RTL_RE.test(text);
  }

  /**
   * A helper method to determine if a text string contains CJK characters.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains CJK characters.
   */
  _isCJK(text) {
    return LyricsPlusRenderer._CJK_RE.test(text);
  }

  /**
   * Helper function to determine if a string is purely Latin script (no non-Latin characters).
   * This is used to prevent rendering romanization for lines already in Latin script.
   * @param {string} text - The text to check.
   * @returns {boolean} - True if the text contains only Latin letters, numbers, punctuation, symbols, or whitespace.
   */
  _isPurelyLatinScript(text) {
    return LyricsPlusRenderer._LATIN_RE.test(text);
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
    if (this.lyricsContainer) {
      this._attachClickDelegate();
      this._attachScrollListeners();
      this._setupContainerObserver();
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
    return this._renderContainer(originalLyricsSection);
  }

  _renderContainer(originalLyricsSection) {
    const container = document.createElement("div");
    container.id = "lyrics-plus-container";
    container.className = "lyrics-plus-integrated blur-inactive-enabled";
    originalLyricsSection.appendChild(container);
    this.lyricsContainer = container;
    this._invalidateSpringConfig();
    this._invalidateElevationConfig();
    return container;
  }

  _attachScrollListeners() {
    const scrollContainer = this.lyricsContainer?.parentElement;
    if (!scrollContainer) return;
    if (this.scrollEventHandlerAttached) return;

    scrollContainer.addEventListener('wheel', this._boundUserInteractionHandler, { passive: true });
    scrollContainer.addEventListener('keydown', this._boundUserInteractionHandler, { passive: true });

    scrollContainer.addEventListener('touchstart', this._boundTouchStartHandler, { passive: true });
    scrollContainer.addEventListener('touchmove', this._boundTouchMoveHandler, { passive: true });

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
   * Records the starting position of a touch.
   */
  _onTouchStart(e) {
    if (e.touches.length > 0) {
      this._touchStartX = e.touches[0].clientX;
      this._touchStartY = e.touches[0].clientY;
    }
  }

  /**
   * checks if the user moved their finger enough to be considered a scroll.
   */
  _onTouchMove(e) {
    if (e.touches.length > 0) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;

      const diffX = Math.abs(currentX - this._touchStartX);
      const diffY = Math.abs(currentY - this._touchStartY);

      if (diffY > 10 || diffX > 10) {
        this._setUserScrolled(true);
      }
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

        this._closeHiddenGaps(false);
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
    if (!originalLines || originalLines.length < 1) return;

    const OVERLAP_THRESHOLD = 0.005;
    const GAP_THRESHOLD = 0.001;
    const MAX_EXTENSION = 1.3;

    const count = originalLines.length;
    const lines = new Array(count);
    for (let idx = 0; idx < count; idx++) {
      const el = originalLines[idx];
      const start = parseFloat(el.dataset.startTime);
      const end = parseFloat(el.dataset.endTime);
      lines[idx] = {
        element: el,
        startTime: start,
        originalEndTime: end,
        newEndTime: end,
      };
    }

    let i = 0;
    while (i < count) {
      let clusterEnd = i;
      let maxEndInRange = lines[i].originalEndTime;

      while (clusterEnd < count - 1) {
        const next = lines[clusterEnd + 1];
        const overlap = maxEndInRange - next.startTime;

        if (overlap > OVERLAP_THRESHOLD) {
          clusterEnd = clusterEnd + 1;
          if (next.originalEndTime > maxEndInRange) {
            maxEndInRange = next.originalEndTime;
          }
        } else {
          break;
        }
      }

      let clusterBaseEnd = lines[i].originalEndTime;
      for (let c = i + 1; c <= clusterEnd; c++) {
        if (lines[c].originalEndTime > clusterBaseEnd) {
          clusterBaseEnd = lines[c].originalEndTime;
        }
      }

      let clusterFinalEnd = clusterBaseEnd;
      const lineAfter = lines[clusterEnd + 1];

      if (lineAfter) {
        const gap = lineAfter.startTime - clusterBaseEnd;
        const nextEl = lines[clusterEnd].element.nextElementSibling;
        const hasManualGapMark = nextEl?.classList.contains("lyrics-gap");

        if (gap > GAP_THRESHOLD && !hasManualGapMark) {
          clusterFinalEnd += Math.min(MAX_EXTENSION, gap);
        }
      }

      for (let j = i; j <= clusterEnd; j++) {
        let cutoff = null;

        for (let k = j + 1; k <= clusterEnd; k++) {
          const jClearsK = lines[j].originalEndTime - lines[k].startTime <= OVERLAP_THRESHOLD;
          const chainBrokenAtK = lines[k - 1].originalEndTime - lines[k].startTime <= OVERLAP_THRESHOLD;

          if (jClearsK || chainBrokenAtK) {
            cutoff = lines[k].startTime;
            break;
          }
        }

        lines[j].newEndTime = cutoff ?? clusterFinalEnd;
      }

      i = clusterEnd + 1;
    }

    for (let l = 0; l < count; l++) {
      const item = lines[l];
      const el = item.element;
      const originalEndTime = item.originalEndTime;
      const newEndTime = item.newEndTime;

      el.dataset.actualEndTime = originalEndTime.toFixed(3);
      el._actualEndTimeMs = originalEndTime * 1000;

      if (Math.abs(newEndTime - originalEndTime) > GAP_THRESHOLD) {
        el.dataset.endTime = newEndTime.toFixed(3);
      }
    }
  }

  /**
   * One delegated listener on the container replaces a listener per line.
   */
  _attachClickDelegate() {
    const c = this.lyricsContainer;
    if (!c || c._lyplusClickBound) return;
    c.addEventListener("click", this._boundContainerClickHandler);
    c._lyplusClickBound = true;
  }

  _onContainerClick(e) {
    const line = e.target && e.target.closest ? e.target.closest(".lyrics-line") : null;
    if (line && this.lyricsContainer && this.lyricsContainer.contains(line)) {
      this._onLyricClick(line);
    }
  }

  /**
   * Seeks the player to the clicked line's start time.
   * @param {HTMLElement} lineEl - The clicked .lyrics-line element.
   */
  _onLyricClick(lineEl) {
    const time = parseFloat(lineEl.dataset.startTime);
    const offsetSec = (this.userOffsetMs || 0) / 1000;
    this._seekPlayerTo(time + offsetSec - 0.05);
    this._scrollToActiveLine(lineEl, true);
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
    const getComputedFont = (element) => {
      if (!element) return "400 16px sans-serif";
      const cacheKey = element.tagName + (element.className || "");
      if (this.fontCache[cacheKey]) return this.fontCache[cacheKey];
      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      this.fontCache[cacheKey] = font;
      return font;
    };

    const calculatePhysicsPreHighlightDelay = (syllable, font, currentDuration) => {
      const textWidthPx = this._getTextWidth(syllable.textContent, font);
      if (textWidthPx <= 0.1 || currentDuration <= 0) return { delay: 0, duration: 0 };

      const fontSizePx = LyricsPlusRenderer._getFontSizePx(font);
      const velocityPxPerMs = textWidthPx / currentDuration;
      const gradientDistancePx = 0.75 * fontSizePx;
      const gradientDurationMs = gradientDistancePx / velocityPxPerMs;

      return {
        delay: currentDuration - gradientDurationMs,
        duration: gradientDurationMs
      };
    };

    lyrics.data.forEach((line) => {
      let currentLine = document.createElement("div");
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

      const mainContainer = document.createElement("p");
      mainContainer.classList.add("main-vocal-container");
      currentLineContainer.appendChild(mainContainer);

      let backgroundContainer = null;
      let isFirstSyllableInMain = true;
      let isFirstSyllableInBg = true;
      let pendingSyllable = null;
      let pendingSyllableFont = null;

      const isLineBiDi = line.text &&
        this._isRTL(line.text) &&
        LyricsPlusRenderer._BIDI_CHECK_RE.test(line.text);

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

      const createSyllableElement = (s, totalDuration, idx, isBg) => {
        const sylSpan = document.createElement("span");
        sylSpan.className = "lyrics-syllable";

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
        sylSpan._syllableIdx = idx;
        sylSpan._isGap = false;
        sylSpan._isGrowable = false;
        sylSpan._state = 0;

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
        const fontSizePx = LyricsPlusRenderer._getFontSizePx(referenceFont);
        const chars = LyricsPlusRenderer._segmentGraphemes(syllableText);
        const charsLen = chars.length;
        const charWidths = new Array(charsLen);
        let totalSyllableWidth = 0;

        for (let i = 0; i < charsLen; i++) {
          const w = this._getTextWidth(chars[i], referenceFont);
          charWidths[i] = w;
          totalSyllableWidth += w;
        }

        const velocityPxPerMs = totalSyllableWidth / s.duration;
        const gradientDurationMs = (0.75 * fontSizePx) / velocityPxPerMs;

        let cumulativeCharWidth = 0;
        const charSpans = [];

        for (let i = 0; i < charsLen; i++) {
          const char = chars[i];
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
              charSpan._wipeStart = startPercent;
              charSpan._wipeDuration = durationPercent;
              charSpan._preWipeArrival = s.duration * startPercent;
              charSpan._preWipeDuration = gradientDurationMs;
            }

            charSpan.dataset.syllableCharIndex = characterData.length;
            charSpan._syllableCharIndex = characterData.length;
            characterData.push({ charSpan, syllableSpan: sylSpan, isBackground: s.isBackground });
            charSpans.push(charSpan);
            sylSpan.appendChild(charSpan);
          }
          cumulativeCharWidth += charWidth;
        }

        if (charSpans.length > 0) {
          sylSpan._cachedCharSpans = charSpans;
          sylSpan.classList.add("has-chars");
        }
      };

      const shouldAllowBreak = (text) =>
        text.trim().length >= 16 || this._isCJK(text.trim());

      const renderWordSpan = (wordBuffer, shouldEmphasize, isLastInContiner = false) => {
        if (!wordBuffer.length) return;

        const currentWordStartTime = wordBuffer[0].time;
        const lastSyllable = wordBuffer[wordBuffer.length - 1];
        const currentWordEndTime = lastSyllable.time + lastSyllable.duration;
        const totalDuration = currentWordEndTime - currentWordStartTime;
        const combinedText = wordBuffer.map((s) => this._getDataText(s)).join("");
        const isBgWord = wordBuffer[0].isBackground || false;

        const wordSpan = document.createElement("span");
        wordSpan.className = "lyrics-word";

        if (shouldAllowBreak(combinedText)) {
          wordSpan.classList.add("allow-break");
        }

        const referenceFont = mainContainer.firstChild
          ? getComputedFont(mainContainer.firstChild)
          : "400 16px sans-serif";

        if (shouldEmphasize) {
          wordSpan.classList.add("growable");
          wordSpan._wordStartMs = currentWordStartTime;
          wordSpan._wordDurationMs = totalDuration;
        }

        const characterData = [];
        const syllableElements = [];

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
        for (let _si = 0; _si < syllableElements.length; _si++) {
          syllableElements[_si]._isGrowable = shouldEmphasize;
        }

        if (shouldEmphasize) {
          wordSpan._cachedChars = characterData.map((cd) => cd.charSpan);
          this._prepareEmphasis(wordSpan, totalDuration);
        }

        const hasText = (el) => el && el.textContent.trim().length > 0;

        if (pendingSyllable && syllableElements.length > 0 && pendingSyllable._isBackground === isBgWord) {
          const firstVisibleSyllable = syllableElements.find(hasText);
          if (firstVisibleSyllable) {
            linkSyllables(pendingSyllable, firstVisibleSyllable, pendingSyllableFont);
          }
        }

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

        const MoveEarlier = currentSettings.bkgOverlap;
        let backgroundInnerWrap = backgroundContainer?.querySelector(".background-vocal-wrap");
        const targetContainer = isBgWord
          ? backgroundInnerWrap ||
          (() => {
            backgroundContainer = document.createElement("p");
            backgroundContainer.className = "background-vocal-container";
            currentLine.classList.add("has-bg-vocal");

            backgroundInnerWrap = document.createElement("span");
            backgroundInnerWrap.className = "background-vocal-wrap";
            backgroundContainer.appendChild(backgroundInnerWrap);
            this._observeBgWrap(backgroundInnerWrap);

            if (MoveEarlier) {
              const firstMainSyllable = mainContainer.querySelector(".lyrics-syllable");
              const mainStartTime = firstMainSyllable ? firstMainSyllable._startTimeMs : Infinity;

              if (currentWordStartTime < mainStartTime) {
                backgroundContainer.classList.add("onTop");
                currentLineContainer.prepend(backgroundContainer);
              } else {
                currentLineContainer.appendChild(backgroundContainer);
              }
            } else {
              currentLineContainer.appendChild(backgroundContainer);
            }

            return backgroundInnerWrap;
          })()
          : mainContainer;

        let actualTarget = targetContainer;

        if (isLineBiDi) {
          const isWordRTL = this._isRTL(combinedText);
          const wrapperClass = isWordRTL ? "bidi-rtl" : "bidi-ltr";
          const wrapperDir = isWordRTL ? "rtl" : "ltr";

          let lastChild = targetContainer.lastElementChild;

          if (lastChild && lastChild.classList.contains(wrapperClass)) {
            actualTarget = lastChild;
          } else {
            actualTarget = document.createElement("span");
            actualTarget.className = wrapperClass;
            actualTarget.setAttribute("dir", wrapperDir);
            targetContainer.appendChild(actualTarget);
          }
        }

        actualTarget.appendChild(wordSpan);

        const trailText = combinedText.match(/\s+$/);
        if (trailText && !isLastInContiner) actualTarget.appendChild(document.createTextNode(trailText[0]));

        pendingSyllable = syllableElements.length > 0 ? syllableElements[syllableElements.length - 1] : null;
        pendingSyllableFont = referenceFont;
      };

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
            LyricsPlusRenderer._segmentGraphemes(groupText.trim()).length <= 7 &&
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

      let applyRtlToLine = this._isRTL(mainContainer.textContent);

      if (applyRtlToLine && isLineBiDi) {
        let firstSyllableText = "";

        if (line.syllabus && line.syllabus.length > 0) {
          const firstValid = line.syllabus.find(s => LyricsPlusRenderer._LETTER_OR_NUM_RE.test(this._getDataText(s)));
          if (firstValid) {
            firstSyllableText = this._getDataText(firstValid);
          }
        }

        if (!firstSyllableText) {
          const fallbackMatch = mainContainer.textContent.match(LyricsPlusRenderer._LETTER_OR_NUM_RE);
          firstSyllableText = fallbackMatch ? fallbackMatch[0] : "";
        }

        if (firstSyllableText && !this._isRTL(firstSyllableText)) {
          applyRtlToLine = false;
        }
      }

      if (applyRtlToLine) {
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
      const lineEl = document.createElement("div");
      lineEl.className = "lyrics-line";
      const lineContainer = document.createElement("div");
      lineContainer.className = "lyrics-line-container";
      lineEl.append(lineContainer);
      lineEl.dataset.startTime = line.startTime;
      lineEl.dataset.endTime = line.endTime;

      const singerClass = line.element?.singer
        ? singerClassMap[line.element.singer] || "singer-left"
        : "singer-left";
      lineEl.classList.add(singerClass);

      const _lineText = this._getDataText(line, true);
      let _lineIsRTL = this._isRTL(_lineText);

      if (_lineIsRTL) {
        const firstCharMatch = _lineText.match(LyricsPlusRenderer._LETTER_OR_NUM_RE);
        if (firstCharMatch) {
          const firstChar = firstCharMatch[0];
          if (!this._isRTL(firstChar)) {
            _lineIsRTL = false;
          }
        }
      }

      if (_lineIsRTL) {
        lineEl.classList.add("rtl-text");
      }

      const mainContainer = document.createElement("div");
      mainContainer.className = "main-vocal-container";
      mainContainer.textContent = this._getDataText(line);

      if (_lineIsRTL) {
        mainContainer.classList.add("rtl-text");
      }

      lineContainer.appendChild(mainContainer);
      this._renderTranslationContainer(lineContainer, line, displayMode);
      lineFragment.appendChild(lineEl);
    });
    fragment.appendChild(lineFragment);
  }

  /**
 * Internal helper to render plain text lyrics as a single text block.
 * @private
 */
  _renderPlainLyrics(lyrics, fragment) {
    const container = document.createElement("div");
    container.className = "lyrics-plain-text-container";

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "lyrics-plain-text-content";

    let fullText = "";
    let currentSongPartIndex = 0;

    lyrics.data.forEach((line) => {
      const lineText = this._getDataText(line, true);

      if (line.element.songPartIndex !== currentSongPartIndex && fullText !== "") {
        fullText += "\n";
      }

      if (!line.text || !line.text.trim()) {
        fullText += "\n";
      } else {
        fullText += lineText + "\n";
      }

      currentSongPartIndex = line.element.songPartIndex || currentSongPartIndex;
    });

    contentWrapper.textContent = fullText;

    container.appendChild(contentWrapper);
    fragment.appendChild(container);
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
      const targetScript = (typeof currentSettings !== 'undefined' && currentSettings.transliterationTargetScript) || 'latin';
      if (targetScript !== 'latin' || !this._isPurelyLatinScript(lineData.text)) {
        const isWordSynced = lineElement.querySelector(".lyrics-syllable-wrap") !== null;

        const hasPerSyllableTransliteration =
          hasSyl &&
          lineData.syllabus.some(s => {
            const orig = (this._getDataText(s, true) || "").trim();
            const trans = (this._getDataText(s, false) || "").trim();
            return trans && orig && trans !== orig;
          });

        if (hasPerSyllableTransliteration && isWordSynced) {
          const translitIsRtl = lineData.syllabus.some(s => {
            const trans = this._getDataText(s, false);
            return trans && this._isRTL(trans) && trans.trim() !== this._getDataText(s, true).trim();
          });

          if (isRTL || translitIsRtl) {
            const cont = document.createElement("div");
            cont.classList.add("lyrics-romanization-container");

            lineData.syllabus.forEach(s => {
              const txt = this._getDataText(s, false);
              if (!txt) return;
              if (txt.trim() === this._getDataText(s, true).trim()) return;

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
              span._isFirstInContainer = true;

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
              let isBackground = false
              if (wrap.parentElement.parentElement.classList.contains("background-vocal-container")) isBackground = true

              const transTxt = ((isBackground ? this._getDataText(s, false).replace(/[()]/g, "") : (this._getDataText(s, false))) || "");
              if (!transTxt) continue;

              const tr = document.createElement("span");
              tr.className = "lyrics-syllable transliteration";
              if (this._isRTL(transTxt)) tr.classList.add("rtl-text");
              wrap.appendChild(tr);
              wrap.classList.add("has-translit");
              if (tr.classList.contains("rtl-text")) wrap.classList.add("has-translit-rtl");
              const wordEl = wrap.parentElement;
              if (wordEl && wordEl.classList.contains("lyrics-word")) wordEl.classList.add("has-translit");

              if (currentSettings.hidePhoneticDup && this._getDataText(s, false).trim() === this._getDataText(s, true).trim()) {
                tr.classList.add("hidden");
              }

              tr.textContent = transTxt;
              tr.dataset.startTime = s.time;
              tr.dataset.duration = s.duration;
              tr.dataset.endTime = s.time + s.duration;
              tr._startTimeMs = s.time;
              tr._durationMs = s.duration;
              tr._endTimeMs = s.time + s.duration;
              tr._isFirstInContainer = true;
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
      if (lineData.translatedText) {
        if (!lineData._normText) lineData._normText = lineData.text.toLowerCase().replaceAll(' ', '').trim();
        if (!lineData._normTranslated) lineData._normTranslated = lineData.translatedText.toLowerCase().replaceAll(' ', '').trim();
      }
      if (lineData.translatedText && lineData._normText !== lineData._normTranslated) {
        const cont = document.createElement("div");
        cont.classList.add("lyrics-translation-container");
        cont.textContent = lineData.translatedText;
        if (this._isRTL(lineData.translatedText)) {
          cont.classList.add("rtl-text");
        }
        lineElement.appendChild(cont);
      }
    }
  }

  /**
   * Builds the writers/source metadata block shared by all render paths.
   * Uses textContent/DOM nodes only (no innerHTML interpolation).
   * @param {object} lyrics
   * @param {boolean} timed - attach start/end times so it takes part in sync.
   */
  _createMetadataContainer(lyrics, timed) {
    const metadataContainer = document.createElement("div");
    metadataContainer.className = "lyrics-plus-metadata";

    if (timed) {
      const lastEnd = lyrics.data[lyrics.data.length - 1]?.endTime;
      if (lastEnd != 0) {
        metadataContainer.dataset.startTime = (lastEnd || 0) + 0.8;
        metadataContainer.dataset.endTime = (lastEnd || 0) + 99999999999999;
      }
    }

    const writers = lyrics.metadata?.songWriters;
    if (writers && writers.length > 0) {
      const songWritersDiv = document.createElement("span");
      songWritersDiv.className = "lyrics-song-writters";
      const label = document.createElement("b");
      label.textContent = t("writtenBy");
      songWritersDiv.append(label, document.createTextNode(" " + writers.join(", ")));
      metadataContainer.appendChild(songWritersDiv);
    }
    if (this._isValidLyricsSource(lyrics.metadata?.source)) {
      const sourceDiv = document.createElement("span");
      sourceDiv.className = "lyrics-source-provider";
      sourceDiv.textContent = `${t("source")} ${lyrics.metadata.source}`;
      metadataContainer.appendChild(sourceDiv);
    }
    return metadataContainer;
  }

  _createTrailingSpacers() {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "lyrics-plus-empty";
    const emptyFixedDiv = document.createElement("div");
    emptyFixedDiv.className = "lyrics-plus-empty-fixed";
    return [emptyDiv, emptyFixedDiv];
  }

  /**
   * Applies palette-related CSS classes and custom properties to the container
   * based on the current settings. Called from both displayLyrics and updateDisplayMode.
   * @param {HTMLElement} container - The lyrics container element.
   * @param {object} currentSettings - The current user settings.
   * @private
   */
  _applyPaletteSettings(container, currentSettings) {
    const prevBgWipe = container.classList.contains("use-background-wipe");

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

    const isBgWipe = this._isBackgroundWipeEnabled(container);
    container.classList.toggle("use-background-wipe", isBgWipe);

    if (prevBgWipe !== isBgWipe) {
      this._invalidateMaskAnimators();
    }
  }

  _isBackgroundWipeEnabled(container) {
    if (!container) return false;
    return (
      container.classList.contains("override-palette-color") ||
      container.classList.contains("use-song-palette-all-modes") ||
      container.classList.contains("use-song-palette-fullscreen") ||
      container.classList.contains("use-background-wipe")
    );
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

    this._applyPaletteSettings(container, currentSettings);

    container.classList.toggle(
      "fullscreen",
      document.body.hasAttribute("player-fullscreened_")
    );

    const isWordByWordMode = lyrics.type === "Word" && currentSettings.wordByWord;
    container.classList.toggle("word-by-word-mode", isWordByWordMode);
    container.classList.toggle("line-by-line-mode", !isWordByWordMode);

    // Re-determine text direction
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


    // Singer Side Assignment Logic (i hope it similiar as apple lmfao)
    // We calculate the specific class for every line index.
    const lineSideAssignments = new Array(lyrics.data.length).fill("");
    const singerClassMap = {};
    let isDualSide = false;

    if (lyrics && lyrics.data && lyrics.data.length > 0) {
      const agents = lyrics.metadata?.agents || {};

      let currentSideIsLeft = true;
      let lastPersonSingerId = null;

      let rightCount = 0;
      let totalCount = 0;

      lyrics.data.forEach((line, index) => {
        const singerId = line.element?.singer;
        let sideClass = "";

        if (singerId) {
          const agentData = agents[singerId];
          // ig we guess default types for v1000/v2000?? idk
          const type = agentData
            ? agentData.type
            : (singerId === "v1000" ? "group" : (singerId === "v2000" ? "other" : "person"));

          if (type === "group") {
            // Groups are positioned Left (Primary)
            // Groups are 'transparent'. They do NOT update 
            // lastPersonSingerId or currentSideIsLeft. 
            // This ensures the A/B conversation flow persists across the chorus.
            sideClass = "singer-left";
          }
          else {
            // Type is "person" or "other" (v2000)

            if (lastPersonSingerId === null) {
              // If the first active singer is "other" (v2000), start on Right.
              if (type === "other") {
                currentSideIsLeft = false;
              } else {
                currentSideIsLeft = true;
              }
            }
            else if (singerId !== lastPersonSingerId) {
              // If the singer is different from the LAST PERSON, we toggle the side.
              currentSideIsLeft = !currentSideIsLeft;
            }

            sideClass = currentSideIsLeft ? "singer-left" : "singer-right";
            lastPersonSingerId = singerId;
          }
        }

        if (sideClass) {
          totalCount++;
          if (sideClass === "singer-right") rightCount++;
        }

        lineSideAssignments[index] = sideClass;
        if (singerId) singerClassMap[singerId] = sideClass;
      });

      // Flip everything if ≥ 85% are on the right
      if (totalCount > 0 && Math.round((rightCount / totalCount) * 100) >= 85) {
        const flip = (s) => s === "singer-left" ? "singer-right" : (s === "singer-right" ? "singer-left" : s);

        for (let i = 0; i < lineSideAssignments.length; i++) {
          lineSideAssignments[i] = flip(lineSideAssignments[i]);
        }

        for (const id in singerClassMap) {
          singerClassMap[id] = flip(singerClassMap[id]);
        }
      }

      let leftCount = 0, rightSideCount = 0;
      for (let i = 0; i < lineSideAssignments.length; i++) {
        const side = lineSideAssignments[i];
        if (side === "singer-left") leftCount++;
        else if (side === "singer-right") rightSideCount++;
      }
      const totalSideLines = leftCount + rightSideCount;
      const leftRatio = totalSideLines > 0 ? (leftCount / totalSideLines) * 100 : 0;

      isDualSide = leftCount > 0 && rightSideCount > 0 && leftRatio <= 90;
    }

    if (isDualSide) container.classList.add("dual-side-lyrics");

    const gapEndLead = 0.8;

    const createGapLine = (gapStart, gapEnd, classesToInherit = null) => {
      const gapDuration = gapEnd - gapStart;
      const gapLine = document.createElement("div");
      gapLine.className = "lyrics-line lyrics-gap";
      gapLine._isGap = true;
      gapLine.dataset.startTime = gapStart;
      gapLine.dataset.endTime = gapEnd;
      if (classesToInherit) {
        if (classesToInherit.includes("rtl-text"))
          gapLine.classList.add("rtl-text");
        if (classesToInherit.includes("singer-left"))
          gapLine.classList.add("singer-left");
        if (classesToInherit.includes("singer-right"))
          gapLine.classList.add("singer-right");
      }
      const mainContainer = document.createElement("div");
      mainContainer.className = "main-vocal-container";
      const lyricsWord = document.createElement("div");
      lyricsWord.className = "lyrics-word";
      for (let i = 0; i < 3; i++) {
        const syllableSpan = document.createElement("span");
        syllableSpan.className = "lyrics-syllable";

        const segmentDurationMs = (gapDuration / 3) * 1000;

        const syllableDuration = segmentDurationMs * 0.7;

        const gapPadding = segmentDurationMs * 0.3;
        const syllableStart = (gapStart * 1000) + (i * segmentDurationMs) + gapPadding;

        syllableSpan.dataset.startTime = syllableStart;
        syllableSpan.dataset.duration = syllableDuration;
        syllableSpan.dataset.endTime = syllableStart + syllableDuration;
        syllableSpan._startTimeMs = syllableStart;
        syllableSpan._durationMs = syllableDuration;
        syllableSpan._endTimeMs = syllableStart + syllableDuration;
        syllableSpan._isGap = true;
        syllableSpan._isGrowable = false;
        syllableSpan._syllableIdx = i;

        syllableSpan.textContent = "•";
        syllableSpan._isGap = true;
        syllableSpan.style.setProperty("--lyplus-gap-duration", `${syllableDuration || 1000}ms`);
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
    if (lineSideAssignments.length > 0) {
      for (let index = 0; index < originalLines.length; index++) {
        const assignedClass = lineSideAssignments[index];
        if (assignedClass) {
          const line = originalLines[index];
          line.classList.remove("singer-left", "singer-right");
          line.classList.add(assignedClass);
        }
      }
    }
    if (originalLines.length > 0) {
      const firstLine = originalLines[0];
      const firstStartTime = parseFloat(firstLine.dataset.startTime);
      if (firstStartTime >= 7.0) {
        const classesToInherit = [...firstLine.classList].filter((c) =>
          ["rtl-text", "singer-left", "singer-right"].includes(c)
        );
        container.insertBefore(
          createGapLine(0, firstStartTime - gapEndLead, classesToInherit),
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
              parseFloat(nextLine.dataset.startTime) - gapEndLead,
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

    container.appendChild(this._createMetadataContainer(lyrics, true));
    container.append(...this._createTrailingSpacers());

    // Single pass: timings, ids and the id->element map. (Syllable timings are
    // already stamped on the elements when they are created.)
    const lineEls = container.querySelectorAll(".lyrics-line, .lyrics-plus-metadata");
    this.cachedLyricsLines = Array.from(lineEls);
    this._lineById = new Map();
    for (let i = 0; i < this.cachedLyricsLines.length; i++) {
      const l = this.cachedLyricsLines[i];
      l._startTimeMs = parseFloat(l.dataset.startTime) * 1000;
      l._endTimeMs = parseFloat(l.dataset.endTime) * 1000;
      if (!l.id) l.id = `line-${i}`;
      this._lineById.set(l.id, l);
    }
    this.cachedSyllables = Array.from(container.getElementsByClassName("lyrics-syllable"));

    this._ensureElementIds();
    this._initMaskResizeObserver();
    this.activeLineIds.clear();
    this.visibleLineIds.clear();
    this.currentPrimaryActiveLine = null;
    this._resetGapState();

    if (this.cachedLyricsLines.length > 0) {
      const currentTime = (this._getCurrentPlayerTime() - this.offsetLatency) * 1000 - (this.userOffsetMs || 0);
      let activeIndex = this._getLineIndexAtTime(currentTime);
      if (activeIndex === -1) activeIndex = 0;

      const activeLine = this.cachedLyricsLines[activeIndex];
      this.currentPrimaryActiveLine = activeLine;
      this.lastPrimaryActiveLine = activeLine;
      this._lastActiveIndex = activeIndex;
      this._setGapOpen(activeLine, true);
      this._updatePositionClassesAndScroll(activeLine, true, 0);
    }

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
    offsetLatency = 0,
    switchLyricsProviderFn = null
  ) {
    if (this.lastKnownSongInfo && songInfo && (this.lastKnownSongInfo.title !== songInfo.title || this.lastKnownSongInfo.artist !== songInfo.artist || this.lastKnownSongInfo.album !== songInfo.album)) {
      this._userSelectedProvider = null;
      if (this.availableProviders) this.availableProviders.clear();
      if (this._notFoundProviders) this._notFoundProviders.clear();
    }
    if (!this.availableProviders) this.availableProviders = new Set();
    if (!this._notFoundProviders) this._notFoundProviders = new Set();
    this.currentLyrics = lyrics;
    this.currentLyricsType = lyrics?.type;
    if (lyrics?.provider) {
      this._userSelectedProvider = lyrics.provider;
      this.availableProviders.add(lyrics.provider.toLowerCase());
    }
    this.lastKnownSongInfo = songInfo;
    this.currentSettings = currentSettings;
    this.fetchAndDisplayLyricsFn = fetchAndDisplayLyricsFn;
    this.setCurrentDisplayModeAndRefetchFn = setCurrentDisplayModeAndRefetchFn;
    this.largerTextMode = largerTextMode;
    this.offsetLatency = offsetLatency;
    if (switchLyricsProviderFn) {
      this.switchLyricsProviderFn = switchLyricsProviderFn;
    }

    if (songInfo && typeof pBrowser !== "undefined" && pBrowser.runtime?.sendMessage) {
      pBrowser.runtime.sendMessage({
        type: 'GET_LYRICS_OFFSET',
        songInfo
      }).then(response => {
        if (response && typeof response.offsetMs === 'number') {
          this.userOffsetMs = response.offsetMs;
          this._updateOffsetDisplay();
        }
      }).catch(err => console.warn('Failed to load lyrics offset:', err));

      pBrowser.runtime.sendMessage({
        type: 'GET_AVAILABLE_PROVIDERS',
        songInfo
      }).then(response => {
        if (response?.success && Array.isArray(response.availableProviders)) {
          this.setAvailableProviders(response.availableProviders);
        }
      }).catch(() => {});
    }

    this.setTranslationLoading(false);

    const container = this._getContainer();
    if (!container) return;

    container.classList.remove("lyrics-plus-message");

    container.classList.toggle(
      "lightweight-mode",
      currentSettings.lightweight
    );

    this._applyPaletteSettings(container, currentSettings);

    container.classList.toggle(
      "fullscreen",
      document.body.hasAttribute("player-fullscreened_")
    );

    const isPlainLyrics = lyrics.type === "None";
    const isWordByWordMode = !isPlainLyrics && (lyrics.type === "Word") && currentSettings.wordByWord;

    const isLineByLineMode = !isPlainLyrics && !isWordByWordMode;

    container.classList.toggle("plain-text-mode", isPlainLyrics);
    container.classList.toggle("word-by-word-mode", isWordByWordMode);
    container.classList.toggle("line-by-line-mode", isLineByLineMode);

    container.classList.toggle(
      "romanized-big-mode",
      largerTextMode != "lyrics"
    );

    if (!isPlainLyrics) {
      this.updateDisplayMode(lyrics, displayMode, currentSettings);
    } else {
      container.innerHTML = "";
      const fragment = document.createDocumentFragment();

      fragment.appendChild(this._createMetadataContainer(lyrics, false));

      this._renderPlainLyrics(lyrics, fragment);

      const [emptyDiv, emptyFixedDiv] = this._createTrailingSpacers();
      fragment.append(emptyDiv);
      container.appendChild(fragment);
      container.appendChild(emptyFixedDiv);

      this.cachedLyricsLines = [];
      this.cachedSyllables = [];
      this.activeLineIds.clear();
      this.visibleLineIds.clear();
      this._lineById = new Map();
    }

    this._createControlButtons();
    container.classList.toggle(
      "blur-inactive-enabled",
      !!currentSettings.blurInactive
    );
    container.classList.toggle(
      "hide-offscreen",
      !!currentSettings.hideOffscreen
    );
    container.classList.toggle(
      "relax-scroll",
      !!currentSettings.relaxScroll
    );
  }

  /**
   * Sets the loading state of the translation button.
   * @param {boolean} active - Whether the loading state is active.
   */
  setTranslationLoading(active) {
    if (!this.translationButton) return;

    if (active) {
      this.translationButton.classList.add("loading");
      this.translationButton.innerHTML = '<div class="loading-loop-m3 small"></div>';
      this.translationButton.disabled = true;
    } else {
      this.translationButton.classList.remove("loading");
      this.translationButton.disabled = false;
      this._updateTranslationButtonText();
    }
  }

  /**
   * Renders a plain status message (e.g. "not found", error) inside the container.
   * @param {string} i18nKey - The translation key for the message text.
   * @private
   */
  _displayMessage(i18nKey) {
    const container = this._getContainer();
    if (container) {
      container.innerHTML = `<span class="text-not-found">${t(i18nKey)}</span>`;
      container.classList.add("lyrics-plus-message");
    }
  }

  /**
   * Displays a "not found" message in the lyrics container.
   */
  displaySongNotFound() {
    this._displayMessage("notFound");
  }

  /**
   * Displays an error message in the lyrics container.
   */
  displaySongError() {
    this._displayMessage("notFoundError");
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
    if (!text) return 0;
    const cacheKey = font + "\0" + text;
    let width = this._textWidthCache.get(cacheKey);
    if (width !== undefined) return width;

    if (!this.textWidthCanvas) {
      this.textWidthCanvas = document.createElement("canvas");
      this.textWidthCtx = this.textWidthCanvas.getContext("2d", { willReadFrequently: true });
      this._lastCtxFont = null;
    }
    if (this._lastCtxFont !== font) {
      this.textWidthCtx.font = font;
      this._lastCtxFont = font;
    }
    width = this.textWidthCtx.measureText(text).width;

    if (this._textWidthCache.size > 2000) {
      this._textWidthCache.clear();
    }
    this._textWidthCache.set(cacheKey, width);
    return width;
  }

  _ensureElementIds() {
    if (!this.cachedLyricsLines || !this.cachedSyllables) return;
    const lines = this.cachedLyricsLines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (!line.id) line.id = `line-${i}`;
      line._idx = i;
    }
  }

  /**
   * Starts the synchronization loop for highlighting lyrics based on video time.
   * @param {object} currentSettings - The current user settings.
   * @returns {Function} - A cleanup function to stop the sync.
   */
  _startLyricsSync(currentSettings = {}) {
    if (this.currentLyricsType === "None") return () => { };

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
    this.lastTime = this._getCurrentPlayerTime() * 1000 - (this.userOffsetMs || 0);
    this._lastPlayerPaused = false;
    if (!this.uiConfig.disableNativeTick) {
      const sync = () => {
        const player = this._getPlayerElement();
        const isPaused = player ? player.paused : false;
        const currentTime = (this._getCurrentPlayerTime() - this.offsetLatency) * 1000 - (this.userOffsetMs || 0);
        if (currentTime !== this.lastTime || isPaused !== this._lastPlayerPaused) {
          const isForceScroll = Math.abs(currentTime - this.lastTime) > 1000;
          this._lastPlayerPaused = isPaused;
          this._updateLyricsHighlight(
            currentTime,
            isForceScroll,
            currentSettings
          );
          this.lastTime = currentTime;
        }
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
    this._updateLyricsHighlight((currentTime - (this.offsetLatency * 1000) - (this.userOffsetMs || 0)), isForceScroll);
    this.lastTime = currentTime;
  }

  /**
   * Updates the highlighted lyrics and syllables based on the current time.
   * @param {number} currentTime - The current video time in milliseconds.
   * @param {boolean} isForceScroll - Whether to force a scroll update.
   */
  _updateLyricsHighlight(
    currentTime,
    isForceScroll = false
  ) {
    if (!this.cachedLyricsLines || this.cachedLyricsLines.length === 0) {
      return;
    }

    let scrollLookAheadMs = 350;
    const currentAudioIndex = this._getLineIndexAtTime(currentTime, this._lastActiveIndex);

    if (currentAudioIndex !== -1 && currentAudioIndex + 1 < this.cachedLyricsLines.length) {
      const currentLine = this.cachedLyricsLines[currentAudioIndex];
      const nextLine = this.cachedLyricsLines[currentAudioIndex + 1];
      const rawEndTime = (currentLine._actualEndTimeMs !== undefined)
        ? currentLine._actualEndTimeMs
        : currentLine._endTimeMs;
      const gap = nextLine._startTimeMs - rawEndTime;
      scrollLookAheadMs = Math.min(500, Math.max(350, gap));
    }

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

    const linesLen = this.cachedLyricsLines.length;
    // Collect all active DOM indices (used by guard later).
    this._activeIndices.length = 0;
    const _windowBase = Math.max(0, (primaryIndex !== -1 ? primaryIndex : this._lastActiveIndex) - 2);
    let _scanStart = _windowBase;
    while (_scanStart > 0 && this.cachedLyricsLines[_scanStart - 1]._endTimeMs + 50 >= predictiveTime) {
      _scanStart--;
    }
    for (let i = _scanStart; i < linesLen; i++) {
      const line = this.cachedLyricsLines[i];
      if (line._startTimeMs > predictiveTime + 50) break;
      if (predictiveTime >= line._startTimeMs && predictiveTime <= line._endTimeMs + 50) {
        this._activeIndices.push(i);
      }
    }

    const activeIndices = this._activeIndices;
    if (primaryIndex !== -1) {

      if (activeIndices.length > 0) {
        let groupEnd = activeIndices.length - 1;
        let groupStart = groupEnd;
        while (groupStart > 0 && activeIndices[groupStart] - activeIndices[groupStart - 1] === 1) {
          groupStart--;
        }

        const candidateIndex = Math.max(activeIndices[groupStart], activeIndices[groupEnd] - 2);

        const lastPrimary = this._lastActiveIndex;
        const lastPrimaryStillActive = lastPrimary >= 0 &&
          lastPrimary < this.cachedLyricsLines.length &&
          activeIndices.includes(lastPrimary);
        primaryIndex = (candidateIndex < lastPrimary && lastPrimaryStillActive)
          ? lastPrimary
          : candidateIndex;
      }
    } else {
      const firstLineStartTime = this.cachedLyricsLines[0]._startTimeMs;
      if (predictiveTime < firstLineStartTime) {
        primaryIndex = 0;
      } else {
        primaryIndex = this._lastActiveIndex;
        if (primaryIndex < 0) primaryIndex = 0;
        const linesLength = this.cachedLyricsLines.length;
        if (primaryIndex >= linesLength) {
          primaryIndex = linesLength - 1;
        }
      }
    }

    const currentPrimaryLine = this.cachedLyricsLines[this._lastActiveIndex];
    const candidateLine = this.cachedLyricsLines[primaryIndex];
    const activeCount = activeIndices.length;
    if (
      primaryIndex > this._lastActiveIndex &&
      candidateLine._endTimeMs === currentPrimaryLine._endTimeMs &&
      activeCount <= 3
    ) {
      primaryIndex = this._lastActiveIndex;
    } else {
      this._lastActiveIndex = primaryIndex;
    }
    const lineToScroll = this.cachedLyricsLines[primaryIndex];

    // reuse array to avoid allocation
    let tempActiveCount = 0;

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
          this._tempActiveLines[tempActiveCount++] = line;
        }
      }
    }

    if (this._tempActiveLines.length > tempActiveCount) {
      this._tempActiveLines.length = tempActiveCount;
    }

    if (tempActiveCount > 1) {
      this._tempActiveLines.sort((a, b) => a._startTimeMs - b._startTimeMs);
    }

    let hasChanged = this.activeLineIds.size !== tempActiveCount;
    if (!hasChanged && tempActiveCount > 0) {
      for (let i = 0; i < tempActiveCount; i++) {
        if (!this.activeLineIds.has(this._tempActiveLines[i].id)) {
          hasChanged = true;
          break;
        }
      }
    }

    if (hasChanged) {
      // Lines whose background vocal opens/closes in this tick (flat [line, expanding, ...]).
      const bgToggled = this._bgToggled || (this._bgToggled = []);
      bgToggled.length = 0;
      // Where the scroll anchor sits before the layout changes (see _animateBgVocalReflow).
      const anchorBefore = this.currentPrimaryActiveLine;
      this._bgAnchorTop = anchorBefore ? 0 : null;

      for (const oldId of this.activeLineIds) {
        let stillActive = false;
        for (let j = 0; j < tempActiveCount; j++) {
          if (this._tempActiveLines[j].id === oldId) {
            stillActive = true;
            break;
          }
        }

        if (!stillActive) {
          const line = (this._lineById && this._lineById.get(oldId)) || document.getElementById(oldId);
          if (line) {
            line.classList.remove("active");
            this._resetSyllables(line);
            if (this._getBgVocalWrap(line)) bgToggled.push(line, false);
          }
          this.activeLineIds.delete(oldId);
        }
      }

      for (let i = 0; i < tempActiveCount; i++) {
        const line = this._tempActiveLines[i];
        if (!this.activeLineIds.has(line.id)) {
          line.classList.add("active");
          this.activeLineIds.add(line.id);
          if (this._getBgVocalWrap(line)) bgToggled.push(line, true);
        }
      }
    }

    let scrolledThisTick = false;
    if (
      lineToScroll &&
      (lineToScroll !== this.currentPrimaryActiveLine || isForceScroll)
    ) {
      if (!this.isUserControllingScroll || isForceScroll) {
        scrolledThisTick = true;
        const gapShifts = this._syncGapLayout(lineToScroll, isForceScroll, this._tempActiveLines, tempActiveCount);
        this._pendingGapShifts = isForceScroll ? null : gapShifts;
        this._updatePositionClassesAndScroll(lineToScroll, isForceScroll, scrollLookAheadMs);
        this._pendingGapShifts = null;
        this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
        this.currentPrimaryActiveLine = lineToScroll;
      } else if (hasChanged) {
        this._openActiveGapsNow(this._tempActiveLines, tempActiveCount);
        this._scheduleHiddenGapCloses();
      }
    } else if (hasChanged) {
      this._openActiveGapsNow(this._tempActiveLines, tempActiveCount);
      if (this.isUserControllingScroll) this._scheduleHiddenGapCloses();
    }

    // After the scroll call: it publishes --scroll-duration/--scroll-easing and the
    // per-line stagger delays that the background vocal reflow follows.
    if (this._bgToggled && this._bgToggled.length) {
      this._animateBgVocalReflow(this._bgToggled, !scrolledThisTick && !this.isUserControllingScroll);
    }

    const mostRecentActiveLine =
      tempActiveCount > 0 ? this._tempActiveLines[tempActiveCount - 1] : null;

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
  }

  /** Cached `.background-vocal-wrap` of a line (null when the line has none). */
  _getBgVocalWrap(line) {
    let wrap = line._bgWrap;
    if (wrap === undefined || (wrap !== null && !wrap.isConnected)) {
      wrap = line.querySelector(".background-vocal-wrap");
      line._bgWrap = wrap;
      // Never toggled back to content-visibility:auto, see .has-bg-vocal in lyrics.css.
      if (wrap) line.classList.add("has-bg-vocal");
    }
    return wrap;
  }

  _observeBgWrap(wrap) {
    if (typeof ResizeObserver === "undefined") return;
    if (!this._bgResizeObserver) {
      this._bgResizeObserver = new ResizeObserver((entries) => {
        for (const e of entries) {
          e.target._bgH = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
        }
      });
    }
    this._bgResizeObserver.observe(wrap);
  }

  _measureBgHeight(wrap) {
    return wrap._bgH > 0.5 ? wrap._bgH : wrap.offsetHeight;
  }

  /**
   * FLIP for background vocals.
   *
   * @param {Array} toggled Flat list [line, expanding, line, expanding, ...]
   * @param {boolean} reanchor Keep the primary line pinned (no scroll call this tick)
   */
  _animateBgVocalReflow(toggled, reanchor = false) {
    const lines = this.cachedLyricsLines;
    const anchorTopBefore = this._bgAnchorTop;
    this._bgAnchorTop = null;
    if (!lines || lines.length === 0 || typeof Element.prototype.animate !== "function") {
      toggled.length = 0;
      return;
    }

    const indexOf = (line) => (line._idx !== undefined && lines[line._idx] === line)
      ? line._idx
      : lines.indexOf(line);

    const events = [];
    for (let i = 0; i < toggled.length; i += 2) {
      const line = toggled[i];
      const wrap = this._getBgVocalWrap(line);
      if (!wrap) continue;
      const h = this._measureBgHeight(wrap);
      if (h < 0.5) continue;
      const idx = indexOf(line);
      if (idx < 0) continue;
      const expanding = toggled[i + 1];
      events.push({ line, wrap, idx, expanding, delta: expanding ? h : -h });
    }
    toggled.length = 0;
    if (events.length === 0) return;
    events.sort((a, b) => a.idx - b.idx);

    // Keep the anchor line where the scroll put it.
    const containerEl = this.lyricsContainer;
    const scroller = containerEl ? containerEl.parentElement : null;
    const anchor = reanchor ? this.currentPrimaryActiveLine : null;
    let applied = 0; // scrollTop change actually applied
    let anchorIdx = -1;
    if (anchor && scroller && anchorTopBefore !== null) {
      anchorIdx = indexOf(anchor);
      let moved = 0;
      for (let e = 0; e < events.length && events[e].idx < anchorIdx; e++) moved += events[e].delta;
      if (anchorIdx >= 0 && Math.abs(moved) >= 0.5) {
        const before = scroller.scrollTop;
        scroller.scrollTo({ top: before + moved, behavior: "instant" });
        applied = scroller.scrollTop - before;
        this.currentScrollOffset = -scroller.scrollTop;
        const st = this._scrollAnimationState;
        if (st && st.pendingUpdate !== null) st.pendingUpdate -= applied;
      }
    }

    // Same clock as the scroll animation (see _animateScroll).
    const cStyle = containerEl ? containerEl.style : null;
    const ms = (cStyle && parseFloat(cStyle.getPropertyValue("--scroll-duration"))) || 400;
    const easing = (cStyle && cStyle.getPropertyValue("--scroll-easing").trim()) ||
      "cubic-bezier(.41, 0, .12, .99)";
    const userScrolling = !!(containerEl && containerEl.classList.contains("user-scrolling"));
    const elapsed = performance.now() - (this._scrollAnimT0 || -1e9);
    const lineDelay = (line) => {
      if (userScrolling || !line.classList.contains("scroll-animate")) return 0;
      const d = parseFloat(line.style.getPropertyValue("--lyrics-line-delay")) || 0;
      return Math.max(0, d - elapsed); // part of the stagger may already be over
    };

    // Only animate what can be seen (+ a small margin).
    let visMin = Infinity;
    let visMax = -1;
    const ids = this.visibleLineIds;
    const byId = this._lineById;
    if (ids && ids.size > 0 && byId) {
      for (const id of ids) {
        const v = byId.get(id)?._idx;
        if (v === undefined) continue;
        if (v < visMin) visMin = v;
        if (v > visMax) visMax = v;
      }
    }
    const lastEvent = events[events.length - 1].idx;
    const last = Math.min(lines.length, Math.max(visMax, lastEvent, anchorIdx) + 2);
    const first = visMin === Infinity ? 0 : Math.max(0, visMin - 1);

    let ei = 0;
    let above = 0;
    for (let i = first; i < last; i++) {
      while (ei < events.length && events[ei].idx < i) above += events[ei++].delta;
      const line = lines[i];
      LyricsPlusRenderer._flipTranslateY(line, applied - above, ms, easing, lineDelay(line));
    }

    for (let e = 0; e < events.length; e++) {
      const ev = events[e];

      // Everything after the background vocal inside its own line
      // (main vocal when it sits on top, translation / romanization).
      const ownDelay = lineDelay(ev.line);
      const bgContainer = ev.wrap.parentElement;
      for (let el = bgContainer && bgContainer.nextElementSibling; el; el = el.nextElementSibling) {
        LyricsPlusRenderer._flipTranslateY(el, -ev.delta, ms, easing, ownDelay);
      }
    }
  }

  static _flipTranslateY(el, px, ms, easing, delay = 0) {
    if (!el || Math.abs(px) < 0.5) return;
    const anim = el.animate(
      [{ transform: `translateY(${px.toFixed(2)}px)` }, { transform: "translateY(0px)" }],
      { duration: ms, delay, easing, fill: "backwards", composite: "add" }
    );
    anim.onfinish = () => anim.cancel();
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
      if (startHintIndex - 1 >= 0) {
        const prevLine = lines[startHintIndex - 1];
        if (timeMs >= prevLine._startTimeMs && timeMs < prevLine._endTimeMs) {
          return startHintIndex - 1;
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
    const changes = this._visibilityChanges;
    if (!changes || changes.length === 0) return;

    for (let i = 0; i < changes.length; i++) {
      const target = changes[i];
      target.classList.toggle("viewport-hidden", !this.visibleLineIds.has(target.id));
    }

    changes.length = 0;
  }

  /**
   * Decides the wipe direction from what is actually displayed in a syllable,
   * not from the line. An LTR transliteration under an RTL line must wipe LTR.
   */
  static _resolveWipeRtl(text, computedDirection) {
    if (LyricsPlusRenderer._RTL_RE.test(text)) return true;
    if (LyricsPlusRenderer._BIDI_CHECK_RE.test(text)) return false;
    return computedDirection === "rtl"; // neutral text (digits, punctuation)
  }

  /**
   * Builds the shared cursor path of a track.
   * @param {Array} entries - Track syllables in logical order.
   * @returns {Array<{t:number,c:number}>} Non-decreasing timeline points.
   */
  static _generateFadeGradient(widthRatio, dir = "to right", isBackground = false) {
    const totalAspect = 2 + widthRatio;
    const halfFadePercent = (widthRatio / totalAspect) * 50;
    const leftPercent = 50 - halfFadePercent;
    const rightPercent = 50 + halfFadePercent;

    if (isBackground) {
      const bright = "var(--lyplus-text-primary, #fff)";
      const dark = "var(--lyplus-text-secondary, rgba(255, 255, 255, 0.333))";
      return [
        `linear-gradient(${dir}, ${bright} ${leftPercent.toFixed(3)}%, ${dark} ${rightPercent.toFixed(3)}%)`,
        totalAspect,
      ];
    }

    const bright = "rgb(0 0 0 / 1)";
    const dark = "rgb(0 0 0 / var(--lyplus-mask-dim-alpha, 0.35))";

    return [
      `linear-gradient(${dir}, ${bright} ${leftPercent.toFixed(3)}%, ${dark} ${rightPercent.toFixed(3)}%)`,
      totalAspect,
    ];
  }
  
  static _buildMaskFrames(words, targetIndex, fadeWidth, lineStartTime, totalFadeDuration, rtl = false, widthBefore, isBackground = false) {
    const targetWord = words[targetIndex];
    if (widthBefore === undefined) {
      widthBefore = 0;
      for (let k = 0; k < targetIndex; k++) widthBefore += words[k].width + (words[k].gapAfter || 0);
    }
    const widthBeforeSelf = widthBefore + (words[0] ? fadeWidth : 0);

    const minOffset = -(targetWord.width + targetWord.padding * 2 + fadeWidth);
    const leadTrim = LyricsPlusRenderer._MASK_LEAD_TRIM *
      Math.max(0, fadeWidth - (words[0] ? words[0].padding : 0));
    const initialPos = -widthBeforeSelf - targetWord.width - targetWord.padding - fadeWidth + leadTrim;

    const cursor = {
      curPos: initialPos,
      lastPos: initialPos,
      timeOffset: 0,
      lastTime: 0,
      lastTimeMs: lineStartTime,
      frames: [],
    };

    const pushClampedKeyframe = () => {
      const time = Math.min(1, Math.max(cursor.lastTime, cursor.timeOffset));
      const moveOffset = cursor.curPos - cursor.lastPos;
      const duration = time - cursor.lastTime;

      if (duration > 0 && moveOffset !== 0) {
        const msPerPixel = Math.abs(duration / moveOffset);

        if (cursor.curPos > minOffset && cursor.lastPos < minOffset) {
          const staticTime = Math.min(duration, Math.max(0, Math.abs(cursor.lastPos - minOffset) * msPerPixel));
          const clamped = minOffset;
          const xPos = (rtl ? minOffset - clamped : clamped).toFixed(2);
          const pos = `${xPos}px 0`;
          cursor.frames.push(
            isBackground
              ? { offset: Math.min(1, Math.max(cursor.lastTime, cursor.lastTime + staticTime)), backgroundPosition: pos }
              : { offset: Math.min(1, Math.max(cursor.lastTime, cursor.lastTime + staticTime)), maskPosition: pos }
          );
        }

        if (cursor.curPos > 0 && cursor.lastPos < 0) {
          const staticTime = Math.min(duration, Math.max(0, Math.abs(cursor.lastPos) * msPerPixel));
          const clamped = 0;
          const xPos = (rtl ? minOffset - clamped : clamped).toFixed(2);
          const pos = `${xPos}px 0`;
          cursor.frames.push(
            isBackground
              ? { offset: Math.min(1, Math.max(cursor.lastTime, cursor.lastTime + staticTime)), backgroundPosition: pos }
              : { offset: Math.min(1, Math.max(cursor.lastTime, cursor.lastTime + staticTime)), maskPosition: pos }
          );
        }
      }

      const clamped = Math.min(Math.max(cursor.curPos, minOffset), 0);
      const xPos = (rtl ? minOffset - clamped : clamped).toFixed(2);
      const pos = `${xPos}px 0`;
      cursor.frames.push(
        isBackground
          ? { offset: time, backgroundPosition: pos }
          : { offset: time, maskPosition: pos }
      );

      cursor.lastPos = cursor.curPos;
      cursor.lastTime = time;
    };

    pushClampedKeyframe();

    for (let j = 0; j < words.length; j++) {
      const otherWord = words[j];
      const effectiveStart = Math.max(cursor.lastTimeMs, otherWord.startTime);
      const effectiveEnd = Math.max(effectiveStart, otherWord.endTime);

      const startOffset = Math.min(1, Math.max(cursor.lastTime, (effectiveStart - lineStartTime) / totalFadeDuration));
      if (startOffset > cursor.lastTime) {
        cursor.timeOffset = startOffset;
        pushClampedKeyframe();
      }

      let movePx = otherWord.width + (otherWord.gapAfter || 0);
      if (j === 0) {
        movePx += fadeWidth * 1.5 - leadTrim;
      }
      if (j === words.length - 1) {
        movePx += fadeWidth * 0.5;
      }

      const nextWord = words[j + 1];
      const nextStartTime = nextWord !== undefined ? nextWord.startTime : Infinity;
      const dur = effectiveEnd - effectiveStart;

      if (dur > 0 && nextStartTime < effectiveEnd) {
        const cutTime = Math.max(effectiveStart, nextStartTime);
        const fraction = (cutTime - effectiveStart) / dur;
        const cutOffset = Math.min(1, Math.max(startOffset, (cutTime - lineStartTime) / totalFadeDuration));

        if (fraction > 0 && cutOffset > startOffset) {
          cursor.timeOffset = cutOffset;
          cursor.curPos += movePx * fraction;
          pushClampedKeyframe();
        }

        cursor.timeOffset = cutOffset;
        cursor.curPos += movePx * (1 - fraction);
        pushClampedKeyframe();

        cursor.lastTimeMs = cutTime;
      } else {
        const endOffset = dur > 0
          ? Math.min(1, Math.max(startOffset, (effectiveEnd - lineStartTime) / totalFadeDuration))
          : startOffset;

        cursor.timeOffset = endOffset;
        cursor.curPos += movePx;
        pushClampedKeyframe();

        cursor.lastTimeMs = effectiveEnd;
      }
    }

    if (cursor.lastTime < 1) {
      cursor.timeOffset = 1;
      pushClampedKeyframe();
    }
    if (cursor.frames.length > 0) {
      cursor.frames[cursor.frames.length - 1].offset = 1;
    }

    return cursor.frames;
  }

  /**
   * Pre-observes syllables across all lines at boot using ResizeObserver.
   */
  _initMaskResizeObserver() {
    if (typeof ResizeObserver === "undefined") return;
    if (this._maskResizeObserver) {
      this._maskResizeObserver.disconnect();
      this._maskResizeObserver = null;
    }

    this._maskResizeObserver = new ResizeObserver((entries) => {
      const invalidatedLines = new Set();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const el = entry.target;
        const newWidth = entry.contentRect ? entry.contentRect.width : 0;
        const newHeight = entry.contentRect ? entry.contentRect.height : 0;
        if (newWidth > 0) {
          const oldWidth = el._roContentWidth;
          el._roContentWidth = newWidth;
          el._roContentHeight = newHeight;
          if (oldWidth !== undefined && Math.abs(oldWidth - newWidth) > 0.5) {
            const owner = el._maskOwnerLine;
            if (owner && owner._maskAnimator) {
              invalidatedLines.add(owner);
            }
          }
        }
      }
      for (const line of invalidatedLines) {
        if (line._maskAnimator) {
          line._maskAnimator.dispose();
        }
      }
    });

    if (this.cachedLyricsLines) {
      for (let i = 0; i < this.cachedLyricsLines.length; i++) {
        const line = this.cachedLyricsLines[i];
        if (line._isGap || line.classList.contains("lyrics-gap")) continue;
        let syllables = line._cachedSyllableElements;
        if (!syllables) {
          syllables = Array.from(line.querySelectorAll(".lyrics-syllable"));
          line._cachedSyllableElements = syllables;
        }
        for (let j = 0; j < syllables.length; j++) {
          const syl = syllables[j];
          syl._maskOwnerLine = line;
          this._maskResizeObserver.observe(syl);
          if (syl._cachedCharSpans) {
            for (let c = 0; c < syl._cachedCharSpans.length; c++) {
              syl._cachedCharSpans[c]._maskOwnerLine = line;
              this._maskResizeObserver.observe(syl._cachedCharSpans[c]);
            }
          }
        }
      }
    }
  }

  _getInterWordSpaceWidth(syl, cs) {
    const wrap = syl.parentElement;
    if (!wrap || !wrap.classList.contains("lyrics-syllable-wrap") || wrap.nextSibling) return 0;
    const wordEl = wrap.parentElement;
    const next = wordEl && wordEl.nextSibling;
    if (!next || next.nodeType !== 3 || !/^\s+$/.test(next.data)) return 0;
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let w = this._getTextWidth(" ", font);
    const letterSpacing = parseFloat(cs.letterSpacing) || 0;
    if (letterSpacing) w += letterSpacing;
    return w;
  }

  /** Drops cached mask animators so they are re-measured on the next frame. */
  _invalidateMaskAnimators() {
    const lines = this.cachedLyricsLines;
    if (!lines) return;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l && l._maskAnimator) l._maskAnimator.dispose();
    }
    this._textWidthCache.clear();
  }

  _getOrCreateLineMaskAnimator(lineElement) {
    if (lineElement._maskAnimator) return lineElement._maskAnimator;
    if (lineElement._isGap || lineElement.classList.contains("lyrics-gap")) return null;

    let syllables = lineElement._cachedSyllableElements;
    if (!syllables) {
      syllables = Array.from(lineElement.querySelectorAll(".lyrics-syllable"));
      lineElement._cachedSyllableElements = syllables;
    }
    if (!syllables || syllables.length === 0) return null;

    const container = this._getContainer();
    const useBackgroundWipe = this._isBackgroundWipeEnabled(container);

    const lineStartTime = lineElement._startTimeMs !== undefined
      ? lineElement._startTimeMs
      : parseFloat(lineElement.dataset.startTime) * 1000;
    const lineEndTime = lineElement._endTimeMs !== undefined
      ? lineElement._endTimeMs
      : parseFloat(lineElement.dataset.endTime) * 1000;
    const totalFadeDuration = Math.max(1, lineEndTime - lineStartTime);

    const containers = [];
    const tracks = new Map();

    for (let i = 0; i < syllables.length; i++) {
      const syl = syllables[i];
      const cs = window.getComputedStyle(syl);
      if (cs.display === "none") continue;

      const text = syl.textContent || "";
      const start = syl._startTimeMs !== undefined ? syl._startTimeMs : (parseFloat(syl.dataset.startTime) || 0);
      const dur = syl._durationMs !== undefined ? syl._durationMs : (parseFloat(syl.dataset.duration) || 0);

      const containerEl = syl.closest(
        ".background-vocal-container, .lyrics-romanization-container, .main-vocal-container"
      ) || lineElement;
      let ci = containers.indexOf(containerEl);
      if (ci < 0) ci = containers.push(containerEl) - 1;
      const key = (syl.classList.contains("transliteration") ? "t" : "m") + ci;

      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;

      let width = syl._roContentWidth;
      if (!width || width <= 0) {
        const domWidth = syl.clientWidth - padLeft - padRight;
        width = domWidth > 0 ? domWidth : (text ? this._getTextWidth(text, `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`) : 0);
      }
      width = Math.max(1, width);
      const gapAfter = this._getInterWordSpaceWidth(syl, cs);

      let height = syl._roContentHeight;
      if (!height || height <= 0) {
        const domHeight = syl.clientHeight - padTop - padBottom;
        height = domHeight > 0 ? domHeight : (parseFloat(cs.fontSize) || 24);
      }

      let wordList = tracks.get(key);
      if (!wordList) {
        wordList = [];
        tracks.set(key, wordList);
      }

      if (useBackgroundWipe && syl._cachedCharSpans && syl._cachedCharSpans.length > 0) {
        const chars = syl._cachedCharSpans;
        for (let c = 0; c < chars.length; c++) {
          const charSpan = chars[c];
          const charCs = window.getComputedStyle(charSpan);
          const charPadLeft = parseFloat(charCs.paddingLeft) || 0;
          const charPadRight = parseFloat(charCs.paddingRight) || 0;
          const charPadTop = parseFloat(charCs.paddingTop) || 0;
          const charPadBottom = parseFloat(charCs.paddingBottom) || 0;

          const cText = charSpan.textContent || "";
          let charWidth = charSpan._roContentWidth;
          if (!charWidth || charWidth <= 0) {
            const domWidth = charSpan.clientWidth - charPadLeft - charPadRight;
            charWidth = domWidth > 0 ? domWidth : (cText ? this._getTextWidth(cText, `${charCs.fontStyle} ${charCs.fontWeight} ${charCs.fontSize} ${charCs.fontFamily}`) : 0);
          }
          charWidth = Math.max(1, charWidth);

          let charHeight = charSpan._roContentHeight;
          if (!charHeight || charHeight <= 0) {
            const domHeight = charSpan.clientHeight - charPadTop - charPadBottom;
            charHeight = domHeight > 0 ? domHeight : (parseFloat(charCs.fontSize) || height);
          }

          const cWipeStart = charSpan._wipeStart !== undefined ? charSpan._wipeStart : parseFloat(charSpan.dataset.wipeStart) || (c / chars.length);
          const cWipeDur = charSpan._wipeDuration !== undefined ? charSpan._wipeDuration : parseFloat(charSpan.dataset.wipeDuration) || (1 / chars.length);
          const cStart = start + cWipeStart * dur;
          const cDur = Math.max(0, cWipeDur * dur);

          wordList.push({
            word: cText,
            startTime: cStart,
            endTime: cStart + cDur,
            mainElement: charSpan,
            width: charWidth,
            height: charHeight,
            padding: charPadLeft,
            gapAfter: c === chars.length - 1 ? gapAfter : 0,
            rtl: LyricsPlusRenderer._resolveWipeRtl(cText, charCs.direction),
          });
        }
      } else {
        wordList.push({
          word: text,
          startTime: start,
          endTime: start + dur,
          mainElement: syl,
          width,
          height,
          padding: padLeft,
          gapAfter,
          rtl: LyricsPlusRenderer._resolveWipeRtl(text, cs.direction),
        });
      }
    }

    const animations = [];
    const styled = [];

    tracks.forEach((words) => {
      if (!words.length) return;
      let widthBefore = 0;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const el = w.mainElement;
        const fadeWidth = w.height * 0.5;
        const totalWordWidth = w.width + w.padding * 2;
        const [gradientImage, totalAspect] = LyricsPlusRenderer._generateFadeGradient(
          fadeWidth / totalWordWidth,
          w.rtl ? "to left" : "to right",
          useBackgroundWipe
        );

        if (useBackgroundWipe) {
          el.style.backgroundImage = gradientImage;
          el.style.backgroundSize = `${(totalAspect * 100).toFixed(3)}% 100%`;
          el.style.backgroundRepeat = "no-repeat";
          el.style.webkitBackgroundClip = "text";
          el.style.backgroundClip = "text";
          el.style.color = "transparent";
        } else {
          el.style.maskImage = gradientImage;
          el.style.webkitMaskImage = gradientImage;
          el.style.maskSize = `${(totalAspect * 100).toFixed(3)}% 100%`;
          el.style.webkitMaskSize = `${(totalAspect * 100).toFixed(3)}% 100%`;
        }
        styled.push(el);

        const frames = LyricsPlusRenderer._buildMaskFrames(
          words, i, fadeWidth, lineStartTime, totalFadeDuration, w.rtl, widthBefore, useBackgroundWipe
        );
        widthBefore += w.width + (w.gapAfter || 0);

        try {
          const anim = el.animate(frames, { duration: totalFadeDuration, fill: "both" });
          anim.pause();
          animations.push(anim);
        } catch (err) {
          console.warn("LYPLUS: WAAPI animation creation error:", err);
        }
      }
    });

    // Ensure any newly attached syllables are registered with the boot ResizeObserver
    if (this._maskResizeObserver) {
      for (let i = 0; i < syllables.length; i++) {
        const syl = syllables[i];
        if (!syl._maskOwnerLine) {
          syl._maskOwnerLine = lineElement;
          this._maskResizeObserver.observe(syl);
        }
        if (syl._cachedCharSpans) {
          for (let c = 0; c < syl._cachedCharSpans.length; c++) {
            const charSpan = syl._cachedCharSpans[c];
            if (!charSpan._maskOwnerLine) {
              charSpan._maskOwnerLine = lineElement;
              this._maskResizeObserver.observe(charSpan);
            }
          }
        }
      }
    }

    const animator = {
      animations,
      totalFadeDuration,
      _lastT: -1,
      setCurrentTime(relativeTime) {
        const t = Math.min(totalFadeDuration, Math.max(0, relativeTime));
        if (t === this._lastT) return;
        this._lastT = t;
        const len = animations.length;
        for (let idx = 0; idx < len; idx++) animations[idx].currentTime = t;
      },
      dispose() {
        for (let idx = 0; idx < animations.length; idx++) {
          animations[idx].cancel();
        }
        animations.length = 0;
        for (let idx = 0; idx < styled.length; idx++) {
          const el = styled[idx];
          el.style.removeProperty("mask-image");
          el.style.removeProperty("-webkit-mask-image");
          el.style.removeProperty("mask-size");
          el.style.removeProperty("-webkit-mask-size");
          el.style.removeProperty("background-image");
          el.style.removeProperty("-webkit-background-image");
          el.style.removeProperty("background-size");
          el.style.removeProperty("-webkit-background-size");
          el.style.removeProperty("background-repeat");
          el.style.removeProperty("-webkit-background-repeat");
          el.style.removeProperty("background-clip");
          el.style.removeProperty("-webkit-background-clip");
          el.style.removeProperty("color");
        }
        styled.length = 0;
        lineElement._maskAnimator = null;
      },
    };

    lineElement._maskAnimator = animator;
    return animator;
  }

  static _springProgress(time, response) {
    if (time <= 0) return 0;
    const phase = (2 * Math.PI * time) / Math.max(0.001, response);
    return 1 - (1 + phase) * Math.exp(-phase);
  }

  static _getEmphasisParams(duration, count) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const delay = Math.min((duration / count) * 0.4, 0.4);
    const hold = (2 * duration) / count;
    const response = Math.min(3, duration);
    const emphasis = clamp(duration - 1, 0, 1);
    const glow = 0.45 * clamp((duration - 1) / 0.5, 0, 1);
    const spanDuration = hold + response * 2;
    return { delay, hold, response, emphasis, glow, spanDuration };
  }

  static _getEmphasisFrames(duration, count, index, elevationNum = -0.05, elevationUnit = "em") {
    const cache = (LyricsPlusRenderer._emphasisFrameCache ||= new Map());
    const key = `${duration}:${count}:${index}:${elevationNum}:${elevationUnit}`;
    let frames = cache.get(key);
    if (frames) return frames;

    const SPREAD_EM = 0.05;
    const LIFT_EM = 0.035;
    const { response, hold, emphasis, spanDuration } =
      LyricsPlusRenderer._getEmphasisParams(duration, count);
    const half = Math.max(1, (count - 1) / 2);
    const side = (index - (count - 1) / 2) / half; // -1 .. 1

    frames = Array.from({ length: 61 }, (_, frame) => {
      const time = (spanDuration * frame) / 60;
      const rise = frame === 60 ? 1 : LyricsPlusRenderer._springProgress(time, response);
      const envelope = frame === 60
        ? 0
        : LyricsPlusRenderer._springProgress(time, response) *
        (1 - LyricsPlusRenderer._springProgress(time - hold, response));
      const x = side * SPREAD_EM * emphasis * envelope;
      const y = elevationNum * rise - LIFT_EM * emphasis * envelope;
      return {
        offset: frame / 60,
        transform: `translate3d(${x.toFixed(4)}em, ${y.toFixed(4)}${elevationUnit}, 1px) scale(${(1 + 0.1 * emphasis * envelope).toFixed(4)})`,
      };
    });
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, frames);
    return frames;
  }

  _prepareEmphasis(wordSpan, durationMs) {
    const chars = wordSpan._cachedChars;
    if (!chars || chars.length === 0) return;
    const duration = Math.max(0.001, durationMs / 1000);
    const count = chars.length;
    const { delay, glow, spanDuration } = LyricsPlusRenderer._getEmphasisParams(duration, count);
    const { num: elevationNum, unit: elevationUnit } = this._getElevationConfig();

    for (let i = 0; i < count; i++) {
      const span = chars[i];
      const startDelay = (i + 1) * delay * 1000;
      span._emphasisFrames = LyricsPlusRenderer._getEmphasisFrames(duration, count, i, elevationNum, elevationUnit);
      span._emphasisTiming = {
        duration: spanDuration * 1000,
        delay: startDelay,
        fill: "both",
        easing: "linear",
      };
      span._emphasisEnd = spanDuration * 1000 + startDelay;
      span._emphasisStartDelay = startDelay;
      span._emphasisElevationNum = elevationNum;
      span._emphasisElevationUnit = elevationUnit;
      span._emphasisGlow = glow > 0;
      span._emphasisResponse = LyricsPlusRenderer._getEmphasisParams(duration, count).response;
      if (glow > 0) {
        span.setAttribute("data-glyph", span.textContent || "");
        span.style.setProperty("--char-glow-max", `${glow}`);
        span.style.setProperty("--char-glow-duration", `${spanDuration * 1000}ms`);
      }
    }
  }

  _clearEmphasis(chars) {
    if (!chars) return;
    for (let i = 0; i < chars.length; i++) {
      const span = chars[i];
      if (span._emphasis) {
        span._emphasis.animation.cancel();
        span._emphasis = null;
      }
      if (span._emphasisFall) {
        span._emphasisFall.cancel();
        span._emphasisFall = null;
      }
      span.classList.remove("emphasis-active");
      span.removeAttribute("data-glow");
    }
  }

  // Playback-time: only starts / resumes the precomputed WAAPI animations.
  _triggerGrowable(syllable, currentTime) {
    const wordElement = syllable.parentElement?.parentElement;
    const chars = wordElement?._cachedChars;
    const isGrowable = (syllable._isGrowable !== undefined)
      ? syllable._isGrowable
      : (wordElement ? wordElement.classList.contains("growable") : false);
    const isFirstSyllable = syllable._syllableIdx !== undefined
      ? syllable._syllableIdx === 0
      : syllable.dataset.syllableIndex === "0";
    if (!isGrowable || !isFirstSyllable || !chars || chars.length === 0) return;

    const startMs = wordElement._wordStartMs ?? syllable._startTimeMs;
    const elapsed = currentTime - startMs;
    if (elapsed < 0) return;

    // A fresh run supersedes any deferred cleanup from a previous deactivation.
    syllable._emphasisCleanupToken = null;

    for (let i = 0; i < chars.length; i++) {
      const span = chars[i];
      if (!span._emphasisFrames) continue;
      if (span._emphasis) span._emphasis.animation.cancel();
      if (span._emphasisFall) { span._emphasisFall.cancel(); span._emphasisFall = null; }

      if (span._emphasisGlow) {
        span.style.setProperty("--char-glow-delay", `${span._emphasisStartDelay - elapsed}ms`);
        span.setAttribute("data-glow", "");
      }
      span.classList.add("emphasis-active");

      const animation = span.animate(span._emphasisFrames, span._emphasisTiming);
      animation.currentTime = Math.min(elapsed, span._emphasisEnd);
      span._emphasis = { animation, end: span._emphasisEnd, startMs, glowEpoch: elapsed };
    }
  }

  // True while at least one char's emphasis animation hasn't reached its end.
  _isEmphasisRunning(chars) {
    if (!chars) return false;
    for (let i = 0; i < chars.length; i++) {
      const e = chars[i]._emphasis;
      if (!e) continue;
      const t = Number(e.animation.currentTime);
      if (e.animation.playState !== "finished" && t < e.end) return true;
    }
    return false;
  }

  // The line was deactivated mid-animation: leave the WAAPI emphasis + CSS glow
  // untouched and only run the normal highlight -> non-highlight cleanup once
  // every char animation has finished.
  _deferEmphasisCleanup(syllable, chars) {
    const token = {};
    syllable._emphasisCleanupToken = token;
    const pending = [];
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i]._emphasis?.animation;
      if (a && a.playState !== "finished") {
        pending.push(a.finished);
        this._startEmphasisFall(chars[i]);
      }
    }
    Promise.allSettled(pending).then(() => {
      if (syllable._emphasisCleanupToken !== token) return; // restarted / force-cleared
      syllable._emphasisCleanupToken = null;
      this._finishDeferredEmphasis(syllable, chars);
    });
  }

  // Layers an independent `translate` animation on top of the running emphasis
  // transform so the lasting -0.05em "rise" is cancelled out. The char still
  // finishes its spread/scale envelope, but ends at 0 (not -0.05em) because the
  // line is no longer active. Uses the same spring as the base animation so the
  // two stay in sync even if the rise hasn't completed yet.
  _startEmphasisFall(span) {
    const e = span._emphasis;
    if (!e) return;
    if (span._emphasisFall) span._emphasisFall.cancel();
    const cur = Number(e.animation.currentTime);
    const remaining = e.end - cur;
    if (!(remaining > 0)) return;

    const response = span._emphasisResponse || 1;
    const delay = span._emphasisStartDelay || 0;
    const elevationNum = span._emphasisElevationNum ?? -0.05;
    const elevationUnit = span._emphasisElevationUnit || "em";
    const fallAmount = -elevationNum;
    const fallMs = Math.min(500, remaining);
    const N = 30;
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const ms = remaining * f;
      const t = (cur + ms - delay) / 1000;
      const rise = i === N ? 1 : LyricsPlusRenderer._springProgress(t, response);
      const r = Math.min(1, ms / fallMs);
      const ramp = r * r * (3 - 2 * r);
      frames.push({ offset: f, translate: `0 ${(fallAmount * rise * ramp).toFixed(4)}${elevationUnit}` });
    }
    span._emphasisFall = span.animate(frames, {
      duration: remaining,
      easing: "linear",
      fill: "forwards",
    });
  }

  _finishDeferredEmphasis(syllable, chars) {
    // Net offset is already 0 here, so just drop the finished layers.
    this._clearEmphasis(chars);
  }

  _scheduleSyllableCleanup(syllable) {
    if (!this._cleanupSet) this._cleanupSet = new Set();
    syllable._cleanupPending = true;
    this._cleanupSet.add(syllable);
    if (!this._cleanupTimer) {
      this._cleanupTimer = setTimeout(() => {
        this._cleanupTimer = null;
        const set = this._cleanupSet;
        if (!set) return;
        for (const syl of set) {
          syl._cleanupPending = false;
          syl.classList.remove("highlight", "finished", "pre-highlight", "cleanup");
          syl._state = 0;
        }
        set.clear();
      }, 16);
    }
  }

  // Corrects seeks/drift on an already running emphasis (cheap: reads one char).
  _syncEmphasis(wordElement, currentTime) {
    const chars = wordElement?._cachedChars;
    const first = chars?.[0];
    const entry = first?._emphasis;
    if (!entry) return;
    const elapsed = currentTime - entry.startMs;
    if (elapsed < 0) return;
    if (Math.abs(Number(entry.animation.currentTime) - Math.min(elapsed, entry.end)) <= 200) return;

    for (let i = 0; i < chars.length; i++) {
      const span = chars[i];
      const e = span._emphasis;
      if (!e) continue;
      e.animation.currentTime = Math.min(elapsed, e.end);
      if (elapsed < e.end && e.animation.playState === "finished") e.animation.play();
      if (span._emphasisGlow) {
        for (const eff of span.getAnimations()) {
          if (eff.animationName === "char-glow") {
            eff.currentTime = Math.max(0, elapsed - e.glowEpoch);
            if (elapsed < e.end) eff.play();
          }
        }
      }
    }
  }

  _updateSyllables(currentTime, activeLines) {
    if (!activeLines || activeLines.length === 0) return;

    const activeLinesLength = activeLines.length;

    for (let i = 0; i < activeLinesLength; i++) {
      const parentLine = activeLines[i];
      if (!parentLine) continue;

      let syllables = parentLine._cachedSyllableElements;
      if (!syllables) {
        syllables = Array.from(parentLine.querySelectorAll(".lyrics-syllable"));
        parentLine._cachedSyllableElements = syllables;
      }
      const syllablesLength = syllables.length;

      // 1. Advance the continuous WAAPI mask gradient
      const lineStartTime = parentLine._startTimeMs !== undefined
        ? parentLine._startTimeMs
        : parseFloat(parentLine.dataset.startTime) * 1000;
      const relativeTime = currentTime - lineStartTime;
      const isGapLine = parentLine._isGap || parentLine.classList.contains("lyrics-gap");
      const animator = isGapLine ? null : this._getOrCreateLineMaskAnimator(parentLine);
      if (animator) {
        if (relativeTime >= animator.totalFadeDuration) {
          // Line has completely finished: release mask surfaces and inline styles
          animator.dispose();
          for (let j = 0; j < syllablesLength; j++) {
            const syl = syllables[j];
            syl.classList.remove("highlight", "pre-highlight");
            syl.classList.add("finished");
            syl._state = 2;
          }
        } else {
          animator.setCurrentTime(relativeTime);
        }
      }

      // 2. Drive syllable state and growable bounce animations
      for (let j = 0; j < syllablesLength; j++) {
        const syllable = syllables[j];
        const startTime = syllable._startTimeMs;
        if (startTime === undefined) continue;

        const classList = syllable.classList;
        const _st = syllable._state || 0;
        const hasHighlight = (_st & 1) !== 0;
        const hasFinished = (_st & 2) !== 0;
        const endTime = syllable._endTimeMs;

        if (currentTime >= startTime && currentTime <= endTime) {
          if (!hasHighlight) {
            classList.add("highlight");
            syllable._state = (_st & ~4) | 1;
            if (!syllable._isGap) this._triggerGrowable(syllable, currentTime);
          }
          if (hasFinished) {
            classList.remove("finished");
            syllable._state &= ~2;
          }
          if (hasHighlight && syllable._isGrowable && syllable._syllableIdx === 0) {
            this._syncEmphasis(syllable.parentElement?.parentElement, currentTime);
          }
        } else if (currentTime > endTime) {
          if (!hasFinished) {
            if (!hasHighlight) {
              classList.add("highlight");
              syllable._state = (_st & ~4) | 1;
              if (!syllable._isGap) {
                this._triggerGrowable(syllable, currentTime);
              }
            }
            classList.add("finished");
            syllable._state |= 2;
          }
        } else {
          if (hasHighlight || hasFinished) {
            this._resetSyllable(syllable);
          }
        }
      }
    }
  }

  _resetSyllable(syllable, noFade = false, deferEmphasis = false) {
    if (!syllable) return;
    if (syllable._cleanupPending) {
      syllable._cleanupPending = false;
      this._cleanupSet?.delete(syllable);
    }

    if (!(syllable._state & 2) && !noFade) {
      syllable.classList.add("finished");
      syllable._state |= 2;
    }
    syllable.classList.add("cleanup");

    if (syllable._isGrowable) {
      if (syllable._syllableIdx === 0) {
        const chars = syllable.parentElement?.parentElement?._cachedChars;
        if (deferEmphasis && !noFade && this._isEmphasisRunning(chars)) {
          this._deferEmphasisCleanup(syllable, chars);
        } else {
          syllable._emphasisCleanupToken = null;
          this._clearEmphasis(chars);
        }
      }
    } else {
      const charSpans = syllable._cachedCharSpans || syllable.querySelectorAll("span.char");
      for (let i = 0; i < charSpans.length; i++) {
        charSpans[i].style.animation = "";
      }
    }

    if (noFade) {
      syllable.classList.remove("highlight", "finished", "pre-highlight", "cleanup");
      syllable._state = 0;
    } else {
      this._scheduleSyllableCleanup(syllable);
    }
  }

  _resetSyllables(line, noFade = false) {
    if (!line) return;
    if (line._maskAnimator) {
      line._maskAnimator.dispose();
    }
    let syllables = line._cachedSyllableElements;
    if (!syllables) {
      syllables = Array.from(line.getElementsByClassName("lyrics-syllable"));
      line._cachedSyllableElements = syllables;
    }

    const syllablesLength = syllables.length;
    for (let i = 0; i < syllablesLength; i++) {
      this._resetSyllable(syllables[i], noFade, true);
    }
  }

  _getScrollPaddingTop() {
    if (this._scrollPaddingTopCache !== undefined) return this._scrollPaddingTopCache;

    const selectors = this.uiConfig.selectors;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const style = window.getComputedStyle(element);
        const paddingTopValue =
          style.getPropertyValue("--lyrics-scroll-padding-top") || "25%";
        const result = paddingTopValue.includes("%")
          ? (element.clientHeight || 0) *
          (parseFloat(paddingTopValue) / 100)
          : parseFloat(paddingTopValue) || 0;
        this._scrollPaddingTopCache = result;
        return result;
      }
    }
    const container = document.querySelector(
      "#lyrics-plus-container"
    )?.parentElement;
    const result = container
      ? parseFloat(
        window
          .getComputedStyle(container)
          .getPropertyValue("scroll-padding-top")
      ) || 0
      : 0;
    this._scrollPaddingTopCache = result;
    return result;
  }

  _resolveSpringConfig() {
    const style = getComputedStyle(this.lyricsContainer);
    const readNum = (prop, fallback) => {
      const v = parseFloat(style.getPropertyValue(prop));
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      enabled: style.getPropertyValue('--lyplus-spring-scroll').trim() !== 'false',
      zeta: readNum('--lyplus-spring-zeta', 0.78),
      settleRatio: readNum('--lyplus-spring-settle-ratio', 1.5),
      zetaRelax: readNum('--lyplus-spring-zeta-relax', 0.8),
      settleRatioRelax: readNum('--lyplus-spring-settle-ratio-relax', 1.5)
    };
  }

  _invalidateSpringConfig() {
    this._springConfigCache = null;
  }

  _resolveElevationConfig() {
    const style = this.lyricsContainer ? getComputedStyle(this.lyricsContainer) : null;
    const raw = style ? style.getPropertyValue('--lyplus-lyrics-elevation').trim() : '';
    const fallbackVal = -0.05;
    const fallbackUnit = 'em';
    if (!raw) {
      return { num: fallbackVal, unit: fallbackUnit };
    }
    const num = parseFloat(raw);
    const unitMatch = raw.match(/[a-z%]+$/i);
    return {
      num: Number.isFinite(num) ? num : fallbackVal,
      unit: unitMatch ? unitMatch[0] : fallbackUnit,
    };
  }

  _getElevationConfig() {
    return this._elevationConfigCache || (this._elevationConfigCache = this._resolveElevationConfig());
  }

  _invalidateElevationConfig() {
    this._elevationConfigCache = null;
  }

  /**
   * Applies the new scroll position with a robust buffer logic.
   * Animation delay is applied to a window of approximately two screen heights
   * starting from the first visible line, guaranteeing smooth transitions for
   * lines scrolling into view.
   *
   * @param {number} newTranslateY - The target Y-axis translation value in pixels.
   * @param {boolean} forceScroll - If true, all animation delays are ignored for instant movement.
   * @param {number} duration - The duration of the scroll animation in milliseconds.
   */
  _animateScroll(newTranslateY, forceScroll = false, duration = 300) {
    if (!this.lyricsContainer) return;
    const parent = this.lyricsContainer.parentElement;
    if (!parent) return;

    if (!this._scrollAnimationState) {
      this._scrollAnimationState = {
        isAnimating: false,
        pendingUpdate: null
      };
      this._animatingLines = [];
    }

    const state = this._scrollAnimationState;

    const hasGapShifts = !!(this._pendingGapShifts && this._pendingGapShifts.length);
    if (state.isAnimating && !forceScroll && !hasGapShifts) {
      state.pendingUpdate = newTranslateY;
      return;
    }

    if (this._scrollUnlockTimeout) {
      clearTimeout(this._scrollUnlockTimeout);
      this._scrollUnlockTimeout = null;
    }

    if (this._scrollAnimationTimeout) {
      clearTimeout(this._scrollAnimationTimeout);
      this._scrollAnimationTimeout = null;
    }

    const isRelaxMode = this.currentSettings && this.currentSettings.relaxScroll;
    duration = Math.min(450, duration);
    duration = isRelaxMode ? duration * 1.5 : duration;

    const cfg = this._springConfigCache || (this._springConfigCache = this._resolveSpringConfig());
    const springEnabled = cfg.enabled;
    const zeta = isRelaxMode ? cfg.zetaRelax : cfg.zeta;
    const settleTail = duration * (isRelaxMode ? cfg.settleRatioRelax : cfg.settleRatio);

    let easing, scrollDuration;
    if (springEnabled) {
      ({ easing, duration: scrollDuration } = LyricsPlusRenderer._getSpringEasing(duration, zeta, settleTail));
    } else {
      easing = null;
      scrollDuration = duration + settleTail;
    }
    const delayIncrement = duration * (isRelaxMode ? 0.05 : 0.1);

    const animatingLines = this._animatingLines;
    if (animatingLines.length > 0) {
      for (let i = 0; i < animatingLines.length; i++) {
        const line = animatingLines[i];
        line.classList.remove('scroll-animate');
        line.style.removeProperty('--scroll-delta');
        line.style.removeProperty('--lyrics-line-delay');
      }
      animatingLines.length = 0;
    }

    // Duration/easing are identical for every line: set once on the container
    // (custom properties inherit) instead of 2 style writes per animated line.
    const containerStyle = this.lyricsContainer.style;
    containerStyle.setProperty('--scroll-duration', `${scrollDuration}ms`);
    if (easing) containerStyle.setProperty('--scroll-easing', easing);
    else containerStyle.removeProperty('--scroll-easing');

    const targetTop = Math.max(0, -newTranslateY);
    const prevOffset = -parent.scrollTop || this.currentScrollOffset || 0;
    const delta = prevOffset - newTranslateY;
    this.currentScrollOffset = newTranslateY;

    if (forceScroll) {
      parent.scrollTo({ top: targetTop, behavior: 'smooth' });
      state.isAnimating = false;
      state.pendingUpdate = null;
      return;
    }

    const referenceLine =
      this.currentPrimaryActiveLine ||
      this.lastPrimaryActiveLine ||
      this.cachedLyricsLines[0];

    if (!referenceLine) return;

    const referenceIndex = (referenceLine === this.cachedLyricsLines[this._lastActiveIndex])
      ? this._lastActiveIndex
      : (referenceLine._idx !== undefined && this.cachedLyricsLines[referenceLine._idx] === referenceLine)
        ? referenceLine._idx
        : this.cachedLyricsLines.indexOf(referenceLine);
    if (referenceIndex === -1) return;

    const lookAhead = 20;
    const len = this.cachedLyricsLines.length;

    let visMin = referenceIndex;
    let visMax = referenceIndex;
    if (this.visibleLineIds.size > 0) {
      const byId = this._lineById;
      let resolved = !!byId;
      if (resolved) {
        for (const id of this.visibleLineIds) {
          const vi = byId.get(id)?._idx;
          if (vi === undefined) { resolved = false; break; }
          if (vi < visMin) visMin = vi;
          if (vi > visMax) visMax = vi;
        }
      }
      if (!resolved) {
        visMin = visMax = referenceIndex;
        const visIds = this.visibleLineIds;
        for (let vi = 0; vi < len; vi++) {
          if (visIds.has(this.cachedLyricsLines[vi].id)) {
            if (vi < visMin) visMin = vi;
            if (vi > visMax) visMax = vi;
          }
        }
      }
    }

    const start = Math.min(visMin, referenceIndex);
    const end = Math.min(len, Math.max(visMax, referenceIndex) + lookAhead);

    let maxAnimationDuration = 0;

    const gapShifts = this._pendingGapShifts;
    const gapShiftAt = (i) => {
      if (!gapShifts) return 0;
      let sh = 0;
      for (let g = 0; g < gapShifts.length; g++) if (i > gapShifts[g].idx) sh += gapShifts[g].shift;
      return sh;
    };

    let totalShift = 0;
    if (gapShifts) for (let g = 0; g < gapShifts.length; g++) totalShift += gapShifts[g].shift;
    const newIndex = this._lastActiveIndex;
    let scrollingDown;
    if (newIndex > referenceIndex) scrollingDown = true;
    else if (newIndex < referenceIndex) scrollingDown = false;
    else scrollingDown = (delta - totalShift) >= 0;

    const applyLine = (line, delay, i) => {
      line.style.setProperty('--scroll-delta', `${delta - gapShiftAt(i)}px`);
      line.style.setProperty('--lyrics-line-delay', `${delay}ms`);
      line.classList.add('scroll-animate');
      animatingLines.push(line);
      const lineDuration = scrollDuration + delay;
      if (lineDuration > maxAnimationDuration) maxAnimationDuration = lineDuration;
    };

    if (scrollingDown) {
      let delayCounter = 0;
      for (let i = start; i < end; i++) {
        const line = this.cachedLyricsLines[i];
        let delay = i >= referenceIndex ? delayCounter * delayIncrement : 0;
        if (i >= referenceIndex && !line._isGap) delayCounter++;
        applyLine(line, delay, i);
      }
    } else {
      let delayCounter = 0;
      for (let i = end - 1; i >= start; i--) {
        const line = this.cachedLyricsLines[i];
        let delay = i <= referenceIndex ? delayCounter * delayIncrement : 0;
        if (i <= referenceIndex && !line._isGap) delayCounter++;
        if (isRelaxMode) delay = delay / 2;
        applyLine(line, delay, i);
      }
    }

    state.isAnimating = true;
    this._scrollAnimT0 = performance.now();
    const BASE_DURATION = 400;

    this._scrollUnlockTimeout = setTimeout(() => {
      state.isAnimating = false;

      if (state.pendingUpdate !== null) {
        let pendingValue = state.pendingUpdate;
        state.pendingUpdate = null;
        const primary = this.currentPrimaryActiveLine;
        if (primary && primary.isConnected && !this.isUserControllingScroll) {
          pendingValue = this._getScrollPaddingTop() - primary.offsetTop;
        }
        this._animateScroll(pendingValue, false);
      }
    }, BASE_DURATION);

    this._scrollAnimationTimeout = setTimeout(() => {
      for (let i = 0; i < animatingLines.length; i++) {
        const line = animatingLines[i];
        line.classList.remove('scroll-animate');
        line.style.removeProperty('--scroll-delta');
        line.style.removeProperty('--lyrics-line-delay');
      }
      animatingLines.length = 0;
      this._scrollAnimationTimeout = null;
    }, maxAnimationDuration + 50);

    parent.scrollTo({ top: targetTop, behavior: 'instant' });
  }


  _resetGapState() {
    if (this._gapCloseTimers) for (const t of this._gapCloseTimers.values()) clearTimeout(t);
    this._gapCloseTimers = new Map();
    this._openGaps = new Set();
    this._pendingGapShifts = null;
  }

  /**
   * Opens/closes the layout box of a gap line (instantly, class 'gap-open'). ye
   * @returns {number} signed change of its height (+h opened, -h closed, 0 when nothing changed)
   */
  _setGapOpen(line, open) {
    if (!line || !line._isGap || line.classList.contains("gap-open") === open) return 0;
    if (!this._openGaps) this._resetGapState();
    const inFlow = () => line.offsetParent !== null && getComputedStyle(line).position !== "absolute";
    if (open) {
      line.classList.add("gap-open");
      this._openGaps.add(line);
      return inFlow() ? line.offsetHeight : 0;
    }
    const h = inFlow() ? line.offsetHeight : 0;
    line.classList.remove("gap-open");
    this._openGaps.delete(line);
    return -h;
  }

  _lineIndex(line) {
    const lines = this.cachedLyricsLines;
    if (!lines) return -1;
    return (line._idx !== undefined && lines[line._idx] === line) ? line._idx : lines.indexOf(line);
  }

  _syncGapLayout(newPrimary, force, activeLines, activeCount) {
    if (!this.cachedLyricsLines) return null;
    if (!this._openGaps) this._resetGapState();
    let out = null;
    const add = (line, shift) => {
      if (!shift) return;
      const idx = this._lineIndex(line);
      if (idx < 0) return;
      (out || (out = [])).push({ idx, shift });
    };

    const needOpen = (l) => {
      this._cancelGapClose(l);
      add(l, this._setGapOpen(l, true));
    };
    if (newPrimary && newPrimary._isGap) needOpen(newPrimary);
    for (let i = 0; i < activeCount; i++) {
      const l = activeLines[i];
      if (l && l._isGap && l !== newPrimary) needOpen(l);
    }

    if (this._openGaps.size > 0) {
      for (const g of Array.from(this._openGaps)) {
        if (g === newPrimary || g.classList.contains("active")) continue;
        if (!g.isConnected) { this._openGaps.delete(g); continue; }
        if (force) this._scheduleGapClose(g);
        else add(g, this._setGapOpen(g, false));
      }
    }
    return out;
  }

  /** Active gap but no scroll tick this frame (user is scrolling): open it without a scroll. */
  _openActiveGapsNow(activeLines, activeCount) {
    for (let i = 0; i < activeCount; i++) {
      const l = activeLines[i];
      if (!l || !l._isGap) continue;
      this._cancelGapClose(l);
      if (!l.classList.contains("gap-open")) this._openGapUnanimated(l);
    }
  }

  _scheduleHiddenGapCloses() {
    if (!this._openGaps) return;
    for (const g of this._openGaps) {
      if (g.classList.contains("active")) continue;
      this._scheduleGapClose(g);
    }
  }

  _openGapUnanimated(line) {
    const h = this._setGapOpen(line, true);
    if (h < 0.5) return;
    const idx = this._lineIndex(line);
    if (idx < 0) return;
    let rest = h;
    const scroller = this.lyricsContainer && this.lyricsContainer.parentElement;
    // Gap above what the user is looking at: scroll by its height so nothing moves.
    if (scroller && line.offsetTop <= scroller.scrollTop) {
      const before = scroller.scrollTop;
      scroller.scrollTo({ top: before + h, behavior: "instant" });
      const applied = scroller.scrollTop - before;
      this.currentScrollOffset = -scroller.scrollTop;
      const st = this._scrollAnimationState;
      if (st && st.pendingUpdate !== null) st.pendingUpdate -= applied;
      rest = h - applied;
    }
    if (Math.abs(rest) >= 0.5) this._flipGapShifts([{ idx, shift: rest }]);
  }

  _cancelGapClose(line) {
    const t = this._gapCloseTimers && this._gapCloseTimers.get(line);
    if (t) {
      clearTimeout(t);
      this._gapCloseTimers.delete(line);
    }
  }

  /** Apple-style: let the dots play their hide animation, then fix the layout. */
  _scheduleGapClose(line) {
    if (!this._gapCloseTimers) this._resetGapState();
    if (this._gapCloseTimers.has(line)) return;
    const HIDE_MS = 850;
    this._gapCloseTimers.set(line, setTimeout(() => {
      this._gapCloseTimers.delete(line);
      this._closeGapAfterHide(line);
    }, HIDE_MS));
  }

  _closeGapAfterHide(line) {
    if (!line.isConnected || !line.classList.contains("gap-open")) return;
    if (line.classList.contains("active")) return;
    if (this.isUserControllingScroll) {
      this._closeGapUnanimated(line);
      return;
    }
    if (line === this.currentPrimaryActiveLine) return;
    const idx = this._lineIndex(line);
    const shift = this._setGapOpen(line, false);
    if (!shift || idx < 0) return;
    const primary = this.currentPrimaryActiveLine;
    if (!primary) return;
    this._pendingGapShifts = [{ idx, shift }];
    this._scrollToActiveLine(primary, false, false, 300);
    this._pendingGapShifts = null;
  }

  _flipGapShifts(shifts) {
    const lines = this.cachedLyricsLines;
    if (!shifts || !lines || typeof Element.prototype.animate !== "function") return;
    let visMin = Infinity;
    let visMax = -1;
    if (this.visibleLineIds.size > 0 && this._lineById) {
      for (const id of this.visibleLineIds) {
        const v = this._lineById.get(id)?._idx;
        if (v === undefined) continue;
        if (v < visMin) visMin = v;
        if (v > visMax) visMax = v;
      }
    }
    if (visMax < 0) return;
    const last = Math.min(lines.length, visMax + 2);
    for (const g of shifts) {
      const stagger = this.isUserControllingScroll || g.shift > 0 ? 0 : 40;
      let n = 0;
      for (let i = Math.max(g.idx + 1, visMin - 1); i < last; i++) {
        const line = lines[i];
        LyricsPlusRenderer._flipTranslateY(line, -g.shift, 350, "cubic-bezier(.41, 0, .12, .99)", n * stagger);
        if (!line._isGap) n++;
      }
    }
  }

  _closeGapUnanimated(line) {
    const idx = this._lineIndex(line);
    const scroller = this.lyricsContainer && this.lyricsContainer.parentElement;
    const topBefore = line.offsetTop;
    const above = scroller ? topBefore <= scroller.scrollTop : false;
    const shift = this._setGapOpen(line, false);
    if (!shift || idx < 0) return;
    let rest = shift;
    if (scroller && above) {
      const before = scroller.scrollTop;
      scroller.scrollTo({ top: before + shift, behavior: "instant" });
      const applied = scroller.scrollTop - before;
      this.currentScrollOffset = -scroller.scrollTop;
      const st = this._scrollAnimationState;
      if (st && st.pendingUpdate !== null) st.pendingUpdate -= applied;
      rest = shift - applied;
    }
    if (Math.abs(rest) >= 0.5) this._flipGapShifts([{ idx, shift: rest }]);
  }

  _closeHiddenGaps(skipPrimary = true) {
    if (!this._openGaps || this._openGaps.size === 0) return;
    for (const g of Array.from(this._openGaps)) {
      if (!g.isConnected) { this._openGaps.delete(g); continue; }
      if (g.classList.contains("active")) continue;
      if (skipPrimary && g === this.currentPrimaryActiveLine) continue;
      this._cancelGapClose(g);
      this._closeGapUnanimated(g);
    }
  }

  _updatePositionClassesAndScroll(lineToScroll, forceScroll = false, durationScroll = 300) {
    if (
      !this.lyricsContainer ||
      !this.cachedLyricsLines ||
      this.cachedLyricsLines.length === 0
    )
      return;
    const scrollLineIndex = (lineToScroll._idx !== undefined && this.cachedLyricsLines[lineToScroll._idx] === lineToScroll)
      ? lineToScroll._idx
      : this.cachedLyricsLines.indexOf(lineToScroll);
    if (scrollLineIndex === -1) return;

    const positionClasses = LyricsPlusRenderer._POSITION_CLASSES;

    if (!this._positionClassedLines) this._positionClassedLines = [];
    const prevClassed = this._positionClassedLines;

    if (forceScroll) {
      this.lyricsContainer
        .querySelectorAll(LyricsPlusRenderer._POSITION_SELECTOR)
        .forEach((el) => { el.classList.remove(...positionClasses); el._posCls = null; });
      prevClassed.length = 0;
    }

    const gen = (this._posGen = (this._posGen || 0) + 1);
    const nextClassed = [];
    const assign = (el, cls) => {
      el._posGen = gen;
      if (el._posCls !== cls) {
        if (el._posCls) el.classList.remove(el._posCls);
        el.classList.add(cls);
        el._posCls = cls;
      }
      nextClassed.push(el);
    };
    assign(lineToScroll, "lyrics-activest");
    const elements = this.cachedLyricsLines;
    for (
      let i = Math.max(0, scrollLineIndex - 4);
      i <= Math.min(elements.length - 1, scrollLineIndex + 4);
      i++
    ) {
      const position = i - scrollLineIndex;
      if (position === 0) continue;
      const element = elements[i];
      assign(
        element,
        position === -1 ? "post-active-line"
          : position === 1 ? "next-active-line"
            : position < 0 ? `prev-${-position}` : `next-${position}`
      );
    }
    for (let _pi = 0; _pi < prevClassed.length; _pi++) {
      const el = prevClassed[_pi];
      if (el._posGen !== gen && el._posCls) {
        el.classList.remove(el._posCls);
        el._posCls = null;
      }
    }
    this._positionClassedLines = nextClassed;

    this._scrollToActiveLine(lineToScroll, forceScroll, false, durationScroll);
  }

  _scrollToActiveLine(activeLine, forceScroll = false, isResize = false, durationScroll = 300) {
    if (!activeLine || !this.lyricsContainer) return;
    if (this._containerDisplayCache === undefined) {
      this._containerDisplayCache = getComputedStyle(this.lyricsContainer).display;
    }
    if (this._containerDisplayCache !== "block") return;
    const scrollContainer = this.lyricsContainer.parentElement;
    if (!scrollContainer) return;

    const paddingTop = this._getScrollPaddingTop();
    const targetTranslateY = paddingTop - activeLine.offsetTop;
    const targetScrollTop = -targetTranslateY;

    if (
      !forceScroll &&
      !(this._pendingGapShifts && this._pendingGapShifts.length) &&
      Math.abs(scrollContainer.scrollTop - targetScrollTop) < 1
    ) {
      return;
    }

    this.lyricsContainer.classList.remove("not-focused", "user-scrolling");
    this.isUserControllingScroll = false;
    clearTimeout(this.userScrollIdleTimer);

    if (isResize) {
      this.currentScrollOffset = targetTranslateY;
      scrollContainer.scrollTo({ top: -targetTranslateY, behavior: 'instant' });
    } else {
      this._animateScroll(targetTranslateY, forceScroll, durationScroll);
    }
  }

  _setupVisibilityTracking() {
    const container = this._getContainer();
    if (!container || !container.parentElement) return null;
    if (this.visibilityObserver) this.visibilityObserver.disconnect();

    if (!this._visibilityChanges) this._visibilityChanges = [];
    else this._visibilityChanges.length = 0;

    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        let hasChanges = false;
        const hideOffscreen = !!(this.lyricsContainer && this.lyricsContainer.classList.contains("hide-offscreen"));
        for (let ei = 0; ei < entries.length; ei++) {
          const entry = entries[ei];
          const target = entry.target;
          const id = target.id;

          if (hideOffscreen) this._visibilityChanges.push(target);

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
        }
        if (hasChanges && hideOffscreen) this._batchUpdateViewportVisibility();
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
    this._setupContainerObserver();

    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    this.visibilityObserver = this._setupVisibilityTracking();

    if (this.resizeObserver) this.resizeObserver.disconnect();
    this._setupResizeObserver();

    this._startLyricsSync(this.currentSettings);
    this._createControlButtons();
  }

  _createControlButtons() {
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

    if (!this._boundDocumentClickHandler) {
      this._boundDocumentClickHandler = (event) => {
        if (
          this.dropdownMenu &&
          !this.dropdownMenu.classList.contains("hidden") &&
          !this.dropdownMenu.contains(event.target) &&
          event.target !== this.translationButton &&
          !this.translationButton?.contains(event.target)
        ) {
          this.dropdownMenu.classList.add("hidden");
        }
        if (
          this.optionsDropdown &&
          !this.optionsDropdown.classList.contains("hidden") &&
          !this.optionsDropdown.contains(event.target) &&
          event.target !== this.reloadButton &&
          !this.reloadButton?.contains(event.target)
        ) {
          this.optionsDropdown.classList.add("hidden");
        }
      };
      document.addEventListener("click", this._boundDocumentClickHandler);
    }

    if (this.setCurrentDisplayModeAndRefetchFn && this.currentLyricsType !== "None") {
      if (!this.translationButton) {
        this.translationButton = document.createElement("button");
        this.translationButton.id = "lyrics-plus-translate-button";
        this.buttonsWrapper.appendChild(this.translationButton);
        this._updateTranslationButtonText();

        this.translationButton.addEventListener("click", (event) => {
          event.stopPropagation();
          if (this.optionsDropdown) this.optionsDropdown.classList.add("hidden");
          this._createDropdownMenu(this.buttonsWrapper);
          if (this.dropdownMenu) this.dropdownMenu.classList.toggle("hidden");
        });
      } else if (!this.buttonsWrapper.contains(this.translationButton)) {
        this.buttonsWrapper.appendChild(this.translationButton);
      }
    }

    if (!this.reloadButton) {
      this.reloadButton = document.createElement("button");
      this.reloadButton.id = "lyrics-plus-reload-button";
      this.reloadButton.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"><path d="M480-192q-120 0-204-84t-84-204q0-120 84-204t204-84q65 0 120.5 27t95.5 72v-99h72v240H528v-72h131q-29-44-76-70t-103-26q-90 0-153 63t-63 153q0 90 63 153t153 63q84 0 144-55.5T693-456h74q-9 112-91 188t-196 76Z"/></svg>';
      this.reloadButton.title = t("lyricsOptions") || t("refreshLyrics") || "Lyrics Options";
      this.buttonsWrapper.appendChild(this.reloadButton);

      this.reloadButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.dropdownMenu) this.dropdownMenu.classList.add("hidden");
        this._createOptionsMenu(this.buttonsWrapper);
        if (this.optionsDropdown) this.optionsDropdown.classList.toggle("hidden");
      });
    } else if (!this.buttonsWrapper.contains(this.reloadButton)) {
      this.buttonsWrapper.appendChild(this.reloadButton);
    }
  }

  /**
   * Creates a single clickable dropdown option element.
   * @param {string} labelKey - The i18n key for the option label.
   * @param {Function} onClick - Click handler; the menu is hidden automatically before it fires.
   * @returns {HTMLDivElement}
   * @private
   */
  _createDropdownOption(labelKey, onClick) {
    const optionDiv = document.createElement("div");
    optionDiv.className = "dropdown-option";
    optionDiv.textContent = t(labelKey);
    optionDiv.addEventListener("click", () => {
      this.dropdownMenu.classList.add("hidden");
      onClick();
    });
    return optionDiv;
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

    const dispatchModeChange = (newMode) => {
      if (this.setCurrentDisplayModeAndRefetchFn && this.lastKnownSongInfo) {
        this.setCurrentDisplayModeAndRefetchFn(newMode, this.lastKnownSongInfo);
      }
    };

    if (!hasTranslation) {
      this.dropdownMenu.appendChild(
        this._createDropdownOption("showTranslation", () => {
          dispatchModeChange(this.currentDisplayMode === "romanize" ? "both" : "translate");
        })
      );
    }

    if (!hasRomanization) {
      const romanizeLabel = this.largerTextMode == "romanization" ? "showOriginal" : "showPronunciation";
      this.dropdownMenu.appendChild(
        this._createDropdownOption(romanizeLabel, () => {
          dispatchModeChange(this.currentDisplayMode === "translate" ? "both" : "romanize");
        })
      );
    }

    const hasShowOptions = !hasTranslation || !hasRomanization;
    const hasHideOptions = hasTranslation || hasRomanization;

    if (hasShowOptions && hasHideOptions) {
      this.dropdownMenu.appendChild(document.createElement("div")).className =
        "dropdown-separator";
    }

    if (hasTranslation) {
      this.dropdownMenu.appendChild(
        this._createDropdownOption("hideTranslation", () => {
          dispatchModeChange(this.currentDisplayMode === "both" ? "romanize" : "none");
        })
      );
    }

    if (hasRomanization) {
      const hideLabel = this.largerTextMode == "romanization" ? "hideOriginal" : "hidePronunciation";
      this.dropdownMenu.appendChild(
        this._createDropdownOption(hideLabel, () => {
          dispatchModeChange(this.currentDisplayMode === "both" ? "translate" : "none");
        })
      );
    }
  }

  _updateTranslationButtonText() {
    if (!this.translationButton) return;
    this.translationButton.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"><path d="m488-96 171-456h82L912-96h-79l-41-117H608L567-96h-79ZM169-216l-50-51 192-190q-36-38-67-79t-54-89h82q18 32 36 54.5t52 60.5q38-42 70-87.5t52-98.5H48v-72h276v-96h72v96h276v72H558q-21 69-61 127.5T409-457l91 90-28 74-112-112-191 189Zm463-63h136l-66-189-70 189Z"/></svg>';
    this.translationButton.title = t("showTranslationOptions") || "Translation";
  }

  _createOptionsMenu(parentWrapper) {
    if (this.optionsDropdown) {
      this.optionsDropdown.innerHTML = "";
    } else {
      this.optionsDropdown = document.createElement("div");
      this.optionsDropdown.id = "lyrics-plus-options-dropdown";
      this.optionsDropdown.className = "lyrics-plus-menu-dropdown hidden";
      parentWrapper?.appendChild(this.optionsDropdown);
    }
    this._renderOptionsMenuMain();
  }

  /**
   * Shared by the main options menu and the source picker.
   * @returns {{providerKeys: string[], activeProvider: string, providerDisplayNames: object}}
   */
  _getProviderContext() {
    const providerOrderStr = this.currentSettings?.lyricsProviderOrder || 'binilyrics,kpoe,unison,lrclib';
    const providerKeys = providerOrderStr.split(',').map(s => s.trim()).filter(Boolean);

    if (this.currentSettings?.customKpoeUrl && !providerKeys.includes('customKpoe')) {
      providerKeys.push('customKpoe');
    }

    const activeProvider = (
      this._userSelectedProvider ||
      this.currentLyrics?.provider ||
      this.currentLyrics?.metadata?.provider ||
      this._detectProviderFromSource(this.currentLyrics?.metadata?.source) ||
      'kpoe'
    ).toLowerCase();

    const info = this.lastKnownSongInfo;
    if ((info?.isVideo || info?.subtitle || activeProvider === 'subtitles') && !providerKeys.includes('subtitles')) {
      providerKeys.push('subtitles');
    }
    if (activeProvider === 'local' && !providerKeys.includes('local')) {
      providerKeys.push('local');
    }
    if ((info?.videoId || activeProvider === 'ytmusic') && !providerKeys.includes('ytmusic')) {
      providerKeys.push('ytmusic');
    }

    const ytMusicDisplay = (activeProvider === 'ytmusic' ? this.currentLyrics?.metadata?.source : null)
      || info?.ytMusicLyrics?.provider
      || 'YouTube Music';
    const providerDisplayNames = {
      'binilyrics': 'BiniLyrics',
      'kpoe': 'Lyrics+',
      'customKpoe': 'Custom Lyrics+',
      'unison': 'Unison',
      'lrclib': 'LRCLib',
      'ytmusic': ytMusicDisplay,
      'local': 'Local Lyrics',
      'subtitles': 'YouTube Subtitles'
    };
    return { providerKeys, activeProvider, providerDisplayNames };
  }

  _renderOptionsMenuMain() {
    if (!this.optionsDropdown) return;
    this.optionsDropdown.innerHTML = "";

    const chevronSvg = '<svg class="dropdown-chevron-svg" width="16" height="16" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';
    const reloadSvg = '<svg class="dropdown-item-icon-svg" width="16" height="16" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';

    const offsetOpt = document.createElement("div");
    offsetOpt.className = "dropdown-option";
    const offsetDisplay = this.userOffsetMs ? `${this.userOffsetMs > 0 ? '+' : ''}${this.userOffsetMs}ms` : '0ms';
    offsetOpt.innerHTML = `
      <span class="dropdown-item-label">${t("offsetLyrics") || "Lyrics Offset"}</span>
      <div class="dropdown-item-right">
        <span class="lyrics-option-value-preview">${offsetDisplay}</span>
        ${chevronSvg}
      </div>
    `;
    offsetOpt.addEventListener("click", (e) => {
      e.stopPropagation();
      this._renderOptionsMenuOffset();
    });
    this.optionsDropdown.appendChild(offsetOpt);

    const { providerKeys, activeProvider, providerDisplayNames } = this._getProviderContext();

    let availableList;
    if (this.availableProviders && this.availableProviders.size > 0) {
      availableList = Array.from(this.availableProviders).filter(p => !this._notFoundProviders?.has(p.toLowerCase()));
    } else {
      availableList = providerKeys.filter(p => !this._notFoundProviders?.has(p.toLowerCase()));
    }

    if (availableList.length > 1) {
      const sourceOpt = document.createElement("div");
      sourceOpt.className = "dropdown-option";
      const activeProviderName = providerDisplayNames[activeProvider] || (activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1));
      sourceOpt.innerHTML = `
        <span class="dropdown-item-label">${t("changeLyricsSource") || "Change Lyrics Source"}</span>
        <div class="dropdown-item-right">
          <span class="lyrics-option-value-preview">${activeProviderName}</span>
          ${chevronSvg}
        </div>
      `;
      sourceOpt.addEventListener("click", (e) => {
        e.stopPropagation();
        this._renderOptionsMenuSources();
      });
      this.optionsDropdown.appendChild(sourceOpt);
    }

    const sep = document.createElement("div");
    sep.className = "dropdown-separator";
    this.optionsDropdown.appendChild(sep);

    const reloadOpt = document.createElement("div");
    reloadOpt.className = "dropdown-option";
    reloadOpt.innerHTML = `
      <span class="dropdown-item-label">${t("reloadLyrics") || t("refreshLyrics") || "Reload Lyrics"}</span>
      ${reloadSvg}
    `;
    reloadOpt.addEventListener("click", () => {
      this.optionsDropdown.classList.add("hidden");
      if (this.lastKnownSongInfo && this.fetchAndDisplayLyricsFn) {
        this.fetchAndDisplayLyricsFn(this.lastKnownSongInfo, true, true);
      }
    });
    this.optionsDropdown.appendChild(reloadOpt);
  }

  _renderOptionsMenuOffset() {
    if (!this.optionsDropdown) return;
    this.optionsDropdown.innerHTML = "";

    const backSvg = '<svg class="dropdown-back-svg" width="18" height="18" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';

    const backOpt = document.createElement("div");
    backOpt.className = "dropdown-header-back";
    backOpt.innerHTML = `${backSvg} <span>${t("offsetLyrics") || "Lyrics Offset"}</span>`;
    backOpt.addEventListener("click", (e) => {
      e.stopPropagation();
      this._renderOptionsMenuMain();
    });
    this.optionsDropdown.appendChild(backOpt);

    const sep = document.createElement("div");
    sep.className = "dropdown-separator";
    this.optionsDropdown.appendChild(sep);

    const panel = document.createElement("div");
    panel.className = "dropdown-offset-panel";

    const ms = this.userOffsetMs || 0;
    const formatted = `${ms > 0 ? '+' : ''}${ms} ms`;

    panel.innerHTML = `
      <div class="offset-display-row">
        <div class="offset-current-value">${formatted}</div>
      </div>
      <div class="offset-stepper-row">
        <button class="offset-step-pill" data-step="-100" type="button">-100ms</button>
        <button class="offset-step-pill" data-step="-10" type="button">-10ms</button>
        <button class="offset-step-pill" data-step="10" type="button">+10ms</button>
        <button class="offset-step-pill" data-step="100" type="button">+100ms</button>
      </div>
      <div class="offset-reset-row" style="${ms === 0 ? 'display: none;' : ''}">
        <button class="offset-reset-link" type="button">${t("reset") || "Reset to 0ms"}</button>
      </div>
    `;

    panel.querySelectorAll(".offset-step-pill").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const step = parseInt(btn.dataset.step, 10) || 0;
        this._adjustOffset((this.userOffsetMs || 0) + step);
      });
    });

    panel.querySelector(".offset-reset-link").addEventListener("click", (e) => {
      e.stopPropagation();
      this._adjustOffset(0);
    });

    this.optionsDropdown.appendChild(panel);
  }

  _isValidLyricsSource(source) {
    if (!source || typeof source !== "string") return false;
    const s = source.trim().toLowerCase();
    if (!s || s === "unknown" || s === "undefined" || s === "null" || s === "none" || s === "youtube music" || s === "ytmusic") return false;

    const knownSources = [
      "lyricsplus", "lyrics+", "apple", "apple music", "qq", "musixmatch", "musixmatch-word",
      "unison", "lrclib", "binilyrics", "subtitles", "youtube captions", "youtube subtitles",
      "local", "local lyrics", "spotify", "kpoe", "customkpoe", "lyricfind"
    ];
    const configuredSources = (this.currentSettings?.lyricsSourceOrder || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
    const configuredProviders = (this.currentSettings?.lyricsProviderOrder || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
    const allValid = new Set([...knownSources, ...configuredSources, ...configuredProviders]);

    if (Array.from(allValid).some(known => s.includes(known) || known.includes(s))) return true;

    if (this.currentLyrics?.provider === 'ytmusic' || this.currentLyrics?.metadata?.provider === 'ytmusic') {
      return true;
    }

    return false;
  }

  setAvailableProviders(providers) {
    if (!this.availableProviders) this.availableProviders = new Set();
    if (Array.isArray(providers)) {
      providers.forEach(p => {
        if (p && !this._notFoundProviders?.has(p.toLowerCase())) {
          this.availableProviders.add(p.toLowerCase());
        }
      });
    }
    const activeProvider = (
      this._userSelectedProvider ||
      this.currentLyrics?.provider ||
      this.currentLyrics?.metadata?.provider ||
      this._detectProviderFromSource(this.currentLyrics?.metadata?.source)
    );
    if (activeProvider) {
      this.availableProviders.add(activeProvider.toLowerCase());
    }

    if (this.optionsDropdown && !this.optionsDropdown.classList.contains("hidden")) {
      const isSubmenu = this.optionsDropdown.querySelector(".dropdown-header-back");
      if (isSubmenu) {
        this._renderOptionsMenuSources();
      } else {
        this._renderOptionsMenuMain();
      }
    }
  }

  _detectProviderFromSource(source) {
    if (!source) return '';
    const s = source.toLowerCase();
    if (s.includes('bini')) return 'binilyrics';
    if (s.includes('unison')) return 'unison';
    if (s.includes('lrclib')) return 'lrclib';
    if (s.includes('local')) return 'local';
    if (s.includes('subtitles') || s.includes('captions')) return 'subtitles';
    if (s.includes('lyricfind')) return 'ytmusic';
    if (s.includes('youtube music') || s.includes('ytmusic')) return 'ytmusic';
    if (s.includes('apple') || s.includes('spotify') || s.includes('musixmatch') || s.includes('qq') || s.includes('kpoe') || s.includes('lyrics+')) return 'kpoe';
    return '';
  }

  _renderOptionsMenuSources() {
    if (!this.optionsDropdown) return;
    this.optionsDropdown.innerHTML = "";

    const backSvg = '<svg class="dropdown-back-svg" width="18" height="18" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
    const checkSvg = '<svg class="dropdown-check-svg" width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

    const backOpt = document.createElement("div");
    backOpt.className = "dropdown-header-back";
    backOpt.innerHTML = `${backSvg} <span>${t("changeLyricsSource") || "Change Lyrics Source"}</span>`;
    backOpt.addEventListener("click", (e) => {
      e.stopPropagation();
      this._renderOptionsMenuMain();
    });
    this.optionsDropdown.appendChild(backOpt);

    const sep = document.createElement("div");
    sep.className = "dropdown-separator";
    this.optionsDropdown.appendChild(sep);

    const { providerKeys, activeProvider, providerDisplayNames } = this._getProviderContext();

    // Filter providers: hide any provider    // Filter providers: hide any provider that is not found on the list of available providers
    const visibleProviders = providerKeys.filter((providerId) => {
      const pLower = providerId.toLowerCase();
      if (this._notFoundProviders?.has(pLower)) return false;
      if (this.availableProviders && this.availableProviders.size > 0) {
        return this.availableProviders.has(pLower) || pLower === activeProvider;
      }
      return true;
    });

    if (visibleProviders.length <= 1) {
      this._renderOptionsMenuMain();
      return;
    }

    visibleProviders.forEach((providerId) => {
      const name = providerDisplayNames[providerId] || (providerId.charAt(0).toUpperCase() + providerId.slice(1));
      const opt = document.createElement("div");
      opt.className = "dropdown-option lyrics-source-option";
      const isSelected = activeProvider === providerId.toLowerCase();

      if (isSelected) opt.classList.add("selected");

      opt.innerHTML = `
        <span class="source-name">${name}</span>
        ${isSelected ? checkSvg : ''}
      `;

      opt.addEventListener("click", async () => {
        if (this.switchLyricsProviderFn) {
          const success = await this.switchLyricsProviderFn(providerId);
          if (success) {
            this._userSelectedProvider = providerId;
            if (!this.availableProviders) this.availableProviders = new Set();
            this.availableProviders.add(providerId.toLowerCase());
            this.optionsDropdown.classList.add("hidden");
          } else {
            if (!this._notFoundProviders) this._notFoundProviders = new Set();
            this._notFoundProviders.add(providerId.toLowerCase());
            if (this.availableProviders) {
              this.availableProviders.delete(providerId.toLowerCase());
            }
            opt.remove();
            const remaining = this.optionsDropdown.querySelectorAll(".lyrics-source-option");
            if (remaining.length <= 1) {
              this._renderOptionsMenuMain();
            }
          }
        }
      });

      this.optionsDropdown.appendChild(opt);
    });
  }

  _adjustOffset(newOffsetMs) {
    this.userOffsetMs = Math.round(newOffsetMs / 10) * 10;
    this._updateOffsetDisplay();
    if (this.lastKnownSongInfo) {
      this._debouncedSaveOffset(this.lastKnownSongInfo, this.userOffsetMs);
    }
    const currentTime = (this._getCurrentPlayerTime() - this.offsetLatency) * 1000 - this.userOffsetMs;
    this._updateLyricsHighlight(currentTime, false);
  }

  _updateOffsetDisplay() {
    const valueEl = this.optionsDropdown?.querySelector(".offset-current-value");
    if (valueEl) {
      const ms = this.userOffsetMs || 0;
      valueEl.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
    }
    const resetRow = this.optionsDropdown?.querySelector(".offset-reset-row");
    if (resetRow) {
      resetRow.style.display = (this.userOffsetMs || 0) === 0 ? "none" : "";
    }
    const previewEl = this.optionsDropdown?.querySelector(".lyrics-option-value-preview");
    if (previewEl) {
      const ms = this.userOffsetMs || 0;
      previewEl.textContent = `${ms > 0 ? '+' : ''}${ms}ms`;
    }
  }

  _debouncedSaveOffset(songInfo, offsetMs) {
    clearTimeout(this._saveOffsetTimeout);
    this._saveOffsetTimeout = setTimeout(() => {
      if (typeof pBrowser !== "undefined" && pBrowser.runtime?.sendMessage) {
        pBrowser.runtime.sendMessage({
          type: 'SAVE_LYRICS_OFFSET',
          songInfo,
          offsetMs
        }).catch(err => console.warn('Failed to save offset:', err));
      }
    }, 400);
  }

  showToast(message, duration = 3000) {
    if (this._toastElement) {
      this._toastElement.remove();
      clearTimeout(this._toastTimeout);
    }
    this._toastElement = document.createElement("div");
    this._toastElement.className = "lyrics-plus-toast";
    this._toastElement.textContent = message;

    const parent = document.querySelector(
      this.uiConfig.buttonParent || this.uiConfig.patchParent
    ) || this.buttonsWrapper?.parentElement || document.body;
    parent.appendChild(this._toastElement);

    this._toastTimeout = setTimeout(() => {
      if (this._toastElement) {
        this._toastElement.classList.add("fade-out");
        setTimeout(() => {
          this._toastElement?.remove();
          this._toastElement = null;
        }, 300);
      }
    }, duration);
  }

  /**
   * Removes a button element from the DOM by cloning it (to strip all event
   * listeners) and then removing it. Nulls the provided ref after removal.
   * @param {'translationButton'|'reloadButton'} buttonProp - The instance property name.
   * @private
   */
  _removeButton(buttonProp) {
    const btn = this[buttonProp];
    if (!btn) return;
    const clone = btn.cloneNode(true);
    if (btn.parentNode) btn.parentNode.replaceChild(clone, btn);
    clone.remove();
    this[buttonProp] = null;
  }

  /**
   * Cleans up the lyrics container and resets the state for the next song.
   */
  cleanupLyrics() {
    const scrollContainer = this.lyricsContainer?.parentElement;
    if (scrollContainer) {
      scrollContainer.removeEventListener('wheel', this._boundUserInteractionHandler);
      scrollContainer.removeEventListener('keydown', this._boundUserInteractionHandler);

      scrollContainer.removeEventListener('touchstart', this._boundTouchStartHandler);
      scrollContainer.removeEventListener('touchmove', this._boundTouchMoveHandler);
    }
    this.scrollEventHandlerAttached = false;
    clearTimeout(this.userScrollIdleTimer);

    if (this.lyricsAnimationFrameId) {
      cancelAnimationFrame(this.lyricsAnimationFrameId);
      this.lyricsAnimationFrameId = null;
    }

    if (this.containerObserver) {
      this.containerObserver.disconnect();
      this.containerObserver = null;
    }
    this._releaseWakeLock();

    if (this._debouncedResizeHandler && this._debouncedResizeHandler.cancel) {
      this._debouncedResizeHandler.cancel();
    }

    if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = null;
    if (this._cleanupSet) this._cleanupSet.clear();
    if (this.userScrollIdleTimer) clearTimeout(this.userScrollIdleTimer);
    if (this._scrollUnlockTimeout) clearTimeout(this._scrollUnlockTimeout);
    if (this._scrollAnimationTimeout) clearTimeout(this._scrollAnimationTimeout);

    this.userScrollIdleTimer = null;
    this._scrollUnlockTimeout = null;
    this._scrollAnimationTimeout = null;

    if (this._maskResizeObserver) {
      this._maskResizeObserver.disconnect();
      this._maskResizeObserver = null;
    }
    if (this._bgResizeObserver) {
      this._bgResizeObserver.disconnect();
      this._bgResizeObserver = null;
    }
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this._boundDocumentClickHandler) {
      document.removeEventListener("click", this._boundDocumentClickHandler);
      this._boundDocumentClickHandler = null;
    }
    this._removeButton("translationButton");
    this._removeButton("reloadButton");
    if (this.dropdownMenu) {
      this.dropdownMenu.remove();
      this.dropdownMenu = null;
    }
    if (this.optionsDropdown) {
      this.optionsDropdown.remove();
      this.optionsDropdown = null;
    }
    if (this._toastElement) {
      this._toastElement.remove();
      this._toastElement = null;
    }
    if (this._saveOffsetTimeout) clearTimeout(this._saveOffsetTimeout);
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._saveOffsetTimeout = null;
    this._toastTimeout = null;
    this._invalidateSpringConfig();
    this._invalidateElevationConfig();
    this.userOffsetMs = 0;
    this.currentLyrics = null;
    this.currentLyricsType = null;
    this._userSelectedProvider = null;
    this.switchLyricsProviderFn = null;
    if (this.availableProviders) this.availableProviders.clear();
    if (this._notFoundProviders) this._notFoundProviders.clear();

    const container = this._getContainer();

    if (this.cachedLyricsLines) {
      for (let i = 0; i < this.cachedLyricsLines.length; i++) {
        const line = this.cachedLyricsLines[i];
        if (line) {
          line._cachedSyllableElements = null;
          line._cachedCharSpans = null;
        }
      }
    }

    if (this.cachedSyllables) {
      for (let i = 0; i < this.cachedSyllables.length; i++) {
        const syl = this.cachedSyllables[i];
        if (syl) {
          syl._cleanupPending = false;
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
      container.style.removeProperty("--scroll-duration");
      container.style.removeProperty("--scroll-easing");
      container.style.removeProperty("--lyplus-override-pallete");
      container.style.removeProperty("--lyplus-song-pallete");
    }

    if (this.textWidthCanvas) {
      this.textWidthCanvas.width = 0;
      this.textWidthCanvas.height = 0;
      this.textWidthCanvas = null;
      this.textWidthCtx = null;
      this._lastCtxFont = null;
    }

    this.currentPrimaryActiveLine = null;
    this._resetGapState();
    this.lastPrimaryActiveLine = null;
    this.currentFullscreenFocusedLine = null;
    this.lastTime = 0;

    this.activeLineIds.clear();
    this.visibleLineIds.clear();
    this.cachedLyricsLines = [];
    this.cachedSyllables = [];
    this.fontCache = {};
    this._textWidthCache.clear();
    this._lineById = null;
    this._positionClassedLines = [];
    this._animatingLines = [];
    this._scrollPaddingTopCache = undefined;
    this._containerDisplayCache = undefined;

    this.currentScrollOffset = 0;
    this.isUserControllingScroll = false;

    this.currentDisplayMode = undefined;
    this.largerTextMode = "lyrics";

    this.lastKnownSongInfo = null;
    this.fetchAndDisplayLyricsFn = null;
    this.setCurrentDisplayModeAndRefetchFn = null;

    this._playerElement = undefined;

    this._lastActiveIndex = 0;
    this._tempActiveLines = [];
    this._activeIndices = [];
  }
}