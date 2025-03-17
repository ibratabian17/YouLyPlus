// Use a variable to store the requestAnimationFrame ID
let lyricsAnimationFrameId = null;
let rescroll = false;
let currentPrimaryActiveLine = null;
let lastTime = 0;

// Track which lines and syllables are already active/highlighted to minimize DOM operations
let activeLineIds = new Set();
let highlightedSyllableIds = new Set();
let visibleLineIds = new Set();
let lastProcessedTime = 0;

let lyricsContainer = document.getElementById('lyrics-plus-container');
if (!lyricsContainer) {
  lyricsContainer = createLyricsContainer();
}

function displayLyrics(lyrics, source = "Unknown", type = "Line", lightweight = false, songWriters) {
  const lyricsContainer =
    document.getElementById('lyrics-plus-container') || createLyricsContainer();
  if (!lyricsContainer) return;
  lyricsContainer.innerHTML = '';

  const onLyricClick = e => {
    const time = parseFloat(e.currentTarget.dataset.startTime);
    const player = document.querySelector("video");
    if (player) player.currentTime = time;
    scrollToActiveLine(e.currentTarget, true);
  };

  const isRTL = text => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);

  // ---------------------------
  // Helper to create a gap line with three dots.
  const GAP_THRESHOLD = 7; // seconds
  function createGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    const gapLine = document.createElement('div');
    gapLine.classList.add('lyrics-line', 'lyrics-gap');
    gapLine.dataset.startTime = gapStart;
    gapLine.dataset.endTime = gapEnd;
    gapLine.addEventListener('click', onLyricClick);

    // Add inherited classes if provided
    if (classesToInherit) {
      if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
      if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
      if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    // In syllable mode, create a container and add three syllable spans.
    const mainContainer = document.createElement('div');
    mainContainer.classList.add('main-vocal-container');
    gapLine.appendChild(mainContainer);
    for (let i = 0; i < 3; i++) {
      const syllableSpan = document.createElement('span');
      syllableSpan.classList.add('lyrics-syllable');
      // Distribute the gap evenly among the three dots.
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = ((gapDuration / 3) / 0.9) * 1000;
      syllableSpan.dataset.startTime = syllableStart;
      syllableSpan.dataset.duration = syllableDuration;
      syllableSpan.dataset.endTime = syllableStart + syllableDuration;
      syllableSpan.textContent = "•";
      syllableSpan.addEventListener('click', onLyricClick);
      mainContainer.appendChild(syllableSpan);
    }
    return gapLine;
  }
  // ---------------------------

  if (type !== "Line") {
    // Syllable mode with word-by-word glow.
    let currentLine = document.createElement('div');
    currentLine.classList.add('lyrics-line');
    let mainContainer = document.createElement('div');
    mainContainer.classList.add('main-vocal-container');
    currentLine.appendChild(mainContainer);
    let backgroundContainer = null;
    lyricsContainer.appendChild(currentLine);

    let lineSinger = null,
      lineStartTime = null,
      lineEndTime = null,
      wordBuffer = [];

    const flushWordBuffer = () => {
      if (!wordBuffer.length) return;

      // Create word container for main vocals
      const wordSpan = document.createElement('span');
      wordSpan.classList.add('lyrics-word');

      const combinedText = wordBuffer.map(s => s.text).join('');
      const trimmedText = combinedText.trim();
      const textLength = trimmedText.length;
      const totalDuration = wordBuffer.reduce((sum, s) => sum + s.duration, 0);
      const baseThreshold = 170;
      const requiredThreshold = baseThreshold * (7 / textLength) + 7;
      const avgDuration = totalDuration / textLength;

      // Calculate threshold for the first syllable.
      const firstSyllableThreshold = 100;
      const firstSyllableTextLength = wordBuffer[0].text.length;
      const firstSyllableRequiredThreshold = firstSyllableThreshold * (7 / firstSyllableTextLength);
      const firstSyllableDuration = wordBuffer[0].duration;

      // Performance optimization: Only apply character-by-character glow for short text
      const applyGlow =
        !lightweight &&
        !isRTL(combinedText) &&
        trimmedText.length <= 7 &&
        avgDuration >= requiredThreshold &&
        firstSyllableDuration >= firstSyllableRequiredThreshold;

      // Create word container for background vocals if needed
      const backgroundWordSpan = document.createElement('span');
      backgroundWordSpan.classList.add('lyrics-word');
      let hasBackgroundSyllables = false;

      wordBuffer.forEach(s => {
        const sylSpan = document.createElement('span');
        sylSpan.classList.add('lyrics-syllable');
        sylSpan.dataset.startTime = s.startTime;
        sylSpan.dataset.duration = s.duration;
        sylSpan.dataset.endTime = s.startTime + s.duration;
        sylSpan.dataset.wordDuration = totalDuration;
        sylSpan.addEventListener('click', onLyricClick);

        if (applyGlow && !(s.element.isBackground)) {
          for (const char of s.text) {
            sylSpan.appendChild(
              char === ' '
                ? document.createTextNode(' ')
                : (() => {
                  let targetScale = 1 + ((s.duration / 1000) * (8 - s.text.length) * 0.025);
                  targetScale = Math.min(targetScale, 1.2);
                  const charSpan = document.createElement('span');
                  charSpan.textContent = char;
                  charSpan.classList.add('char');
                  charSpan.style.setProperty("--target-scale", targetScale);
                  return charSpan;
                })()
            );
          }
        } else {
          // Only remove parentheses for background vocals
          sylSpan.textContent = s.element.isBackground ? s.text.replace(/[()]/g, '') : s.text;
        }

        if (s.element.isBackground) {
          hasBackgroundSyllables = true;
          if (isRTL(s.text)) {
            sylSpan.classList.add('rtl-text');
          }
          backgroundWordSpan.appendChild(sylSpan);
        } else {
          if (isRTL(s.text)) {
            sylSpan.classList.add('rtl-text');
          }
          wordSpan.appendChild(sylSpan);
        }
      });

      // Add the word span to the main container
      mainContainer.appendChild(wordSpan);

      // Add background word if necessary
      if (hasBackgroundSyllables) {
        if (!backgroundContainer) {
          backgroundContainer = document.createElement('div');
          backgroundContainer.classList.add('background-vocal-container');
          currentLine.appendChild(backgroundContainer);
        }
        backgroundContainer.appendChild(backgroundWordSpan);
      }

      wordBuffer = [];
    };

    lyrics.data.forEach((s, i) => {
      if (lineSinger === null) lineSinger = s.element.singer;
      lineStartTime =
        lineStartTime === null ? s.startTime : Math.min(lineStartTime, s.startTime);
      lineEndTime =
        lineEndTime === null
          ? s.startTime + s.duration
          : Math.max(lineEndTime, s.startTime + s.duration);
      const lineRTL = isRTL(s.text);

      wordBuffer.push(s);
      if (/\s$/.test(s.text) || s.isLineEnding || i === lyrics.data.length - 1) {
        flushWordBuffer();
      }

      if (s.isLineEnding || i === lyrics.data.length - 1) {
        currentLine.dataset.startTime = lineStartTime / 1000;
        currentLine.dataset.endTime = lineEndTime / 1000;
        currentLine.addEventListener('click', onLyricClick);
        currentLine.classList.add(
          lineSinger === "v2" || lineSinger === "v2000" ? 'singer-right' : 'singer-left'
        );
        if (lineRTL) currentLine.classList.add('rtl-text');

        if (i !== lyrics.data.length - 1) {
          currentLine = document.createElement('div');
          currentLine.classList.add('lyrics-line');
          mainContainer = document.createElement('div');
          mainContainer.classList.add('main-vocal-container');
          currentLine.appendChild(mainContainer);
          backgroundContainer = null;
          lyricsContainer.appendChild(currentLine);
          lineSinger = null;
        }
        lineStartTime = lineEndTime = null;
      }
    });
    flushWordBuffer();

    const lines = Array.from(lyricsContainer.querySelectorAll('.lyrics-line'));
    if (lines.length && !lines[lines.length - 1].dataset.startTime) {
      lines.pop().remove();
    }
  } else {
    // "Line" mode: each lyrics.data entry is a full line.
    lyrics.data.forEach(line => {
      const lineDiv = document.createElement('div');
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      lineDiv.classList.add('lyrics-line');
      lineDiv.classList.add(line.element.singer === "v2" ? 'singer-right' : 'singer-left');
      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      mainContainer.textContent = line.text;
      lineDiv.appendChild(mainContainer);
      if (isRTL(line.text)) lineDiv.classList.add('rtl-text');
      lineDiv.addEventListener('click', onLyricClick);
      lyricsContainer.appendChild(lineDiv);
    });
  }

  // --- Add a gap line at the beginning if needed ---
  const originalLines = Array.from(lyricsContainer.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
  if (originalLines.length > 0) {
    const firstLine = originalLines[0];
    const firstStartTime = parseFloat(firstLine.dataset.startTime);

    if (firstStartTime >= GAP_THRESHOLD) {
      // Create classes to inherit based on the first line
      const classesToInherit = [];
      if (firstLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
      if (firstLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
      if (firstLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

      const beginningGap = createGapLine(0, firstStartTime - 0.85, classesToInherit);
      lyricsContainer.insertBefore(beginningGap, firstLine);
    }
  }

  // --- Insert gap lines for long intervals between original lyric lines ---
  originalLines.forEach((line, index) => {
    if (index < originalLines.length - 1) {
      const nextLine = originalLines[index + 1];
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextStart = parseFloat(nextLine.dataset.startTime);
      if (nextStart - currentEnd >= GAP_THRESHOLD) {
        // Create classes to inherit based on the next line
        const classesToInherit = [];
        if (nextLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
        if (nextLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
        if (nextLine.classList.contains('singer-right')) classesToInherit.push('singer-right');

        const gapLine = createGapLine(currentEnd + 0.4, nextStart - 0.85, classesToInherit);
        lyricsContainer.insertBefore(gapLine, nextLine);
      }
    }
  });

  // Only apply extension to lines that are not followed by gap lines
  originalLines.forEach((line, idx) => {
    if (idx < originalLines.length - 1) {
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextLine = originalLines[idx + 1];
      const nextStart = parseFloat(nextLine.dataset.startTime);
      const gap = nextStart - currentEnd;

      // Check if the next element is not a gap line
      const nextElement = line.nextElementSibling;
      const isFollowedByGap = nextElement && nextElement.classList.contains('lyrics-gap');

      if (gap > 0 && !isFollowedByGap) {
        const extension = Math.min(0.5, gap);
        line.dataset.endTime = (currentEnd + extension).toFixed(3);
      }
    }
  });
  // -------------------------------------------------------------------------

  if (songWriters) {
    const songWritersDiv = document.createElement('span');
    songWritersDiv.classList.add('lyrics-song-writters');
    songWritersDiv.innerText = `${t("writtenBy")} ${songWriters.join(', ')}`;
    lyricsContainer.appendChild(songWritersDiv);
  }

  const sourceDiv = document.createElement('span');
  sourceDiv.classList.add('lyrics-source-provider');
  sourceDiv.innerText = `${t("source")} ${source}`;
  lyricsContainer.appendChild(sourceDiv);

  // Cache lyrics lines and syllables for performance in the sync loop
  window.cachedLyricsLines = Array.from(lyricsContainer.getElementsByClassName('lyrics-line'));
  window.cachedSyllables = Array.from(lyricsContainer.getElementsByClassName('lyrics-syllable'));

  // Add unique IDs to all lyric elements for tracking
  ensureElementIds();

  // Reset tracking variables
  activeLineIds = new Set();
  highlightedSyllableIds = new Set();
  visibleLineIds = new Set();
  currentPrimaryActiveLine = null;

  if (window.cachedLyricsLines.length != 0) {
    scrollToActiveLine(window.cachedLyricsLines[0], true);
  }

  startLyricsSync();
}

function displaySongNotFound() {
  let lyricsContainer = document.getElementById('lyrics-plus-container');
  if (lyricsContainer) {
    lyricsContainer.innerHTML = `<span class="text-not-found">${t("notFound")}</span>`;
  }
}

function displaySongError() {
  let lyricsContainer = document.getElementById('lyrics-plus-container');
  if (lyricsContainer) {
    lyricsContainer.innerHTML = `<span class="text-not-found">${t("notFoundError")}</span>`;
  }
}

function createLyricsContainer() {
  // Find the original lyrics section
  const originalLyricsSection = document.querySelector('#tab-renderer');
  if (!originalLyricsSection) {
    console.log('Lyrics section not found');
    return null;
  }

  // Create new container
  const container = document.createElement('div');
  container.id = 'lyrics-plus-container';
  container.classList.add('lyrics-plus-integrated');

  originalLyricsSection.appendChild(container);
  injectCssFile();

  return container;
}

function injectCssFile() {
  // Create a new <link> element
  const pBrowser = chrome || browser;
  const linkElement = document.createElement('link');
  linkElement.rel = 'stylesheet';
  linkElement.type = 'text/css';
  // Replace 'css/your-styles.css' with the path to your CSS file relative to your extension's root
  linkElement.href = pBrowser.runtime.getURL('src/inject/stylesheet.css');

  // Append the <link> element to the document head
  document.head.appendChild(linkElement);
}

// Add unique IDs to elements if they don't have them
function ensureElementIds() {
  if (!window.cachedLyricsLines || !window.cachedSyllables) return;

  window.cachedLyricsLines.forEach((line, i) => {
    if (!line.id) line.id = `line-${i}`;
  });

  window.cachedSyllables.forEach((syllable, i) => {
    if (!syllable.id) syllable.id = `syllable-${i}`;
  });
}

// Setup IntersectionObserver to track which lines are visible
function setupVisibilityTracking() {
  const container = document.getElementById('lyrics-plus-container');
  if (!container || !container.parentElement) return null;

  // Create an observer with margins to include elements close to the viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          visibleLineIds.add(entry.target.id);
        } else {
          visibleLineIds.delete(entry.target.id);
        }
      });
    },
    {
      root: container.parentElement,
      rootMargin: '200px 0px' // 200px buffer above and below visible area
    }
  );

  // Observe all lyric lines
  if (window.cachedLyricsLines) {
    window.cachedLyricsLines.forEach(line => {
      if (line) observer.observe(line);
    });
  }

  return observer;
}

function startLyricsSync() {
  const videoElement = document.querySelector('video');
  if (!videoElement) return;

  // Initialize element IDs and visibility tracking
  ensureElementIds();
  const visibilityObserver = setupVisibilityTracking();

  // Clear any existing animation frame
  if (lyricsAnimationFrameId) {
    cancelAnimationFrame(lyricsAnimationFrameId);
  }

  // Reset tracking variables
  lastTime = videoElement.currentTime * 1000;

  function sync() {
    // Get current video time in milliseconds
    const currentTime = videoElement.currentTime * 1000;
    const timeDelta = Math.abs(currentTime - lastTime);

    // Determine if we need a force scroll
    const isForceScroll = timeDelta > 1000;

    // Always update lines for accurate sync
    updateLyricsHighlight(currentTime, isForceScroll);

    lastTime = currentTime;
    lyricsAnimationFrameId = requestAnimationFrame(sync);
  }

  lyricsAnimationFrameId = requestAnimationFrame(sync);

  // Return cleanup function
  return () => {
    if (visibilityObserver) {
      visibilityObserver.disconnect();
    }
    if (lyricsAnimationFrameId) {
      cancelAnimationFrame(lyricsAnimationFrameId);
      lyricsAnimationFrameId = null;
    }
  };
}

function cleanupLyrics() {
  if (lyricsAnimationFrameId) {
    cancelAnimationFrame(lyricsAnimationFrameId);
    lyricsAnimationFrameId = null;
  }
  const lyricsContainer = document.getElementById('lyrics-plus-container');
  if (lyricsContainer) {
    lyricsContainer.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
  }

  // Clear tracking sets
  activeLineIds.clear();
  highlightedSyllableIds.clear();
  visibleLineIds.clear();
  currentPrimaryActiveLine = null;
}

function updateLyricsHighlight(currentTime, isForceScroll = false) {
  if (!window.cachedLyricsLines || !window.cachedLyricsLines.length) return;

  let newActiveLineIds = new Set();
  let activeLines = [];

  // First pass: identify active lines
  window.cachedLyricsLines.forEach(line => {
    if (!line) return;

    const lineStart = parseFloat(line.dataset.startTime) * 1000;
    const lineEnd = parseFloat(line.dataset.endTime) * 1000;
    const shouldBeActive = currentTime >= lineStart - 150 && currentTime <= lineEnd;

    if (shouldBeActive) {
      newActiveLineIds.add(line.id);
      activeLines.push(line);
    }
  });

  // Sort active lines by start time (most recent first)
  activeLines.sort((a, b) =>
    parseFloat(b.dataset.startTime) - parseFloat(a.dataset.startTime)
  );

  // Only keep the 2 most recent active lines
  const allowedActiveLines = activeLines.slice(0, 2);
  const allowedActiveIds = new Set(allowedActiveLines.map(line => line.id));

  // Update DOM for lines that changed state
  window.cachedLyricsLines.forEach(line => {
    if (!line) return;

    const wasActive = line.classList.contains('active');
    const shouldBeActive = allowedActiveIds.has(line.id);

    if (shouldBeActive && !wasActive) {
      line.classList.add('active');

      if (
        !currentPrimaryActiveLine ||
        (currentTime >= lastTime &&
          parseFloat(line.dataset.startTime) > parseFloat(currentPrimaryActiveLine.dataset.startTime)) ||
        (currentTime < lastTime &&
          parseFloat(line.dataset.startTime) < parseFloat(currentPrimaryActiveLine.dataset.startTime))
      ) {
        scrollActiveLine(currentTime, isForceScroll);
        currentPrimaryActiveLine = line;
      }
    } else if (!shouldBeActive && wasActive) {
      line.classList.remove('active');
      resetSyllables(line);
    }
  });

  // Update the set of active lines
  activeLineIds = allowedActiveIds;

  // Update syllable animations
  updateSyllables(currentTime);
}

// Update syllable animations
function updateSyllables(currentTime) {
  if (!window.cachedSyllables) return;

  let newHighlightedSyllableIds = new Set();

  window.cachedSyllables.forEach(syllable => {
    if (!syllable) return;

    // Check if parent line is active
    const parentLine = syllable.closest('.lyrics-line');
    if (!parentLine || !parentLine.classList.contains('active')) {
      // Reset if not in active line but was highlighted
      if (syllable.classList.contains('highlight')) {
        resetSyllable(syllable);
      }
      return;
    }

    // Check timing
    const startTime = parseFloat(syllable.dataset.startTime);
    const duration = parseFloat(syllable.dataset.duration);
    const endTime = startTime + duration;

    if (currentTime >= startTime && currentTime <= endTime) {
      newHighlightedSyllableIds.add(syllable.id);

      if (!syllable.classList.contains('highlight')) {
        updateSyllableAnimation(syllable, currentTime);
      }
    } else if (currentTime < startTime && syllable.classList.contains('highlight')) {
      resetSyllable(syllable);
    } else if (currentTime > startTime && !syllable.classList.contains('highlight')) {
      updateSyllableAnimation(syllable, startTime);
    }
  });

  // Update the set of highlighted syllables
  highlightedSyllableIds = newHighlightedSyllableIds;
}

function updateSyllableAnimation(syllable, currentTime) {
  const startTime = Number(syllable.dataset.startTime);
  const duration = Number(syllable.dataset.duration);
  const endTime = startTime + duration;
  let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';

  if (currentTime >= startTime && currentTime <= endTime) {
    if (!syllable.classList.contains('highlight')) {
      const charSpans = syllable.querySelectorAll('span.char');

      if (charSpans.length > 0) {
        const charCount = charSpans.length;
        const wordDuration = Number(syllable.dataset.wordDuration) || duration;

        if (charCount <= 10) {
          const wipeDur = duration / charCount;
          const growDur = wordDuration * 1.3;

          // Find all characters in the word
          const wordElement = syllable.closest('.lyrics-word');
          const allCharsInWord = wordElement ? wordElement.querySelectorAll('span.char') : charSpans;
          const totalChars = allCharsInWord.length;

          // Apply animations based on character position
          allCharsInWord.forEach((span, index) => {
            const growDelay = 200 * index; // 200ms delay between each character
            const spanSyllable = span.closest('.lyrics-syllable');
            const isCurrentSyllable = spanSyllable === syllable;

            if (isCurrentSyllable) {
              const wipeDelay = wipeDur * Array.from(charSpans).indexOf(span);
              span.style.animation = `${wipeAnimation} ${wipeDur}ms linear ${wipeDelay}ms forwards, grow-static ${growDur}ms ease-in-out ${growDelay}ms forwards`;
            } else if (!spanSyllable.classList.contains('highlight')) {
              // Only apply grow animation to non-highlighted syllables
              span.style.animation = `grow-static ${growDur}ms ease-in-out ${growDelay}ms forwards`;
            }
          });
        } else {
          charSpans.forEach(span => {
            span.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
          });
        }
      } else {
        if (syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
          wipeAnimation = "fade-gap";
        }
        syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
      }

      syllable.classList.add('highlight');
    }
  }
}

// Reset a single syllable
function resetSyllable(syllable) {
  if (!syllable) return;

  syllable.style.animation = '';
  syllable.classList.remove('highlight');

  const charSpans = syllable.querySelectorAll('span.char');
  charSpans.forEach(span => {
    span.style.animation = '';
  });
}

// Reset all syllables in a line
function resetSyllables(line) {
  if (!line) return;

  const syllables = line.getElementsByClassName('lyrics-syllable');
  for (let i = 0; i < syllables.length; i++) {
    resetSyllable(syllables[i]);
  }
}

function scrollActiveLine(currentTime, forceScroll = false) {
  const activeLines = Array.from(document.querySelectorAll('.lyrics-line.active'));
  if (!activeLines.length) return;

  let lineToScroll = activeLines[0];

  // If we have multiple active lines, prioritize the next one
  // when we're close to the end of the current one
  if (activeLines.length > 1) {
    const firstLineEnd = parseFloat(lineToScroll.dataset.endTime) * 1000;
    if (firstLineEnd - currentTime <= 200) {
      lineToScroll = activeLines[1];
    }
  }

  scrollToActiveLine(lineToScroll, forceScroll);
}

function scrollToActiveLine(activeLine, forceScroll = false) {
  if (!activeLine) return;

  // Get the lyrics container element
  const container = document.querySelector("#lyrics-plus-container");
  if (!container) return;

  // Only proceed if the container is visible (displayed as block)
  const computedStyle = window.getComputedStyle(container);
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
  const lineIsOutsideSafeArea = lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom;

  // Correct logic: Scroll if line is outside safe area OR forceScroll is true
  if (lineIsOutsideSafeArea && !forceScroll) {
    // Line is already in the visible area and we're not forcing a scroll
    return;
  }

  // Calculate the active line's position relative to the lyrics container
  const containerRect = container.getBoundingClientRect();
  const relativePosition = lineRect.top - containerRect.top;
  const offset = container.clientHeight / 4; // Offset for positioning

  // Scroll the scroll container to the target position
  scrollContainer.scrollTo({
    top: container.scrollTop + relativePosition - offset,
    behavior: 'smooth' // Use immediate scrolling for jumps
  });
}