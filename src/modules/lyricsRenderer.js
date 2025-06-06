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

// Cached DOM references
const getContainer = () => {
  if (!lyricsContainer) {
    lyricsContainer = document.getElementById('lyrics-plus-container') || createLyricsContainer();
  }
  return lyricsContainer;
};

// Performance optimization: Batch DOM manipulations
function batchDOMUpdates(callback) {
  requestAnimationFrame(() => {
    const fragment = document.createDocumentFragment();
    callback(fragment);
    getContainer().appendChild(fragment);
  });
}

function displayLyrics(lyrics, source = "Unknown", type = "Line", lightweight = false, songWriters) {
  const container = getContainer();
  if (!container) return;
  
  // Performance optimization: Clear container once
  container.innerHTML = '';
  
  // Performance optimization: Create element pool for reuse
  const elementPool = {
    lines: [],
    syllables: [],
    chars: []
  };
  
  // Cache the onLyricClick handler to avoid recreating it for each element
  const onLyricClick = e => {
    const time = parseFloat(e.currentTarget.dataset.startTime);
    const player = document.querySelector("video");
    if (player) player.currentTime = time;
    scrollToActiveLine(e.currentTarget, true);
  };

  const isRTL = text => /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);
  const isCJK = text => /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);

  // ---------------------------
  // Helper to create a gap line with three dots - optimized
  const GAP_THRESHOLD = 7; // seconds
  function createGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    // Performance optimization: Reuse elements from pool if available
    const gapLine = elementPool.lines.pop() || document.createElement('div');
    gapLine.className = 'lyrics-line lyrics-gap';
    gapLine.dataset.startTime = gapStart;
    gapLine.dataset.endTime = gapEnd;
    
    // Performance optimization: Use single event listener
    if (!gapLine.hasClickListener) {
      gapLine.addEventListener('click', onLyricClick);
      gapLine.hasClickListener = true;
    }

    // Add inherited classes if provided
    if (classesToInherit) {
      if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
      if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
      if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    // Performance optimization: Minimize DOM operations
    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-vocal-container';
    
    // Create all syllables at once
    for (let i = 0; i < 3; i++) {
      const syllableSpan = elementPool.syllables.pop() || document.createElement('span');
      syllableSpan.className = 'lyrics-syllable';
      
      // Distribute the gap evenly among the three dots
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = ((gapDuration / 3) / 0.9) * 1000;
      syllableSpan.dataset.startTime = syllableStart;
      syllableSpan.dataset.duration = syllableDuration;
      syllableSpan.dataset.endTime = syllableStart + syllableDuration;
      syllableSpan.textContent = "•";
      
      // Performance optimization: Use single event listener
      if (!syllableSpan.hasClickListener) {
        syllableSpan.addEventListener('click', onLyricClick);
        syllableSpan.hasClickListener = true;
      }
      
      mainContainer.appendChild(syllableSpan);
    }
    
    gapLine.appendChild(mainContainer);
    return gapLine;
  }
  // ---------------------------

  // Performance optimization: Process lines in batches using DocumentFragment
  const fragment = document.createDocumentFragment();
  
  if (type !== "Line") {
    // Syllable mode with word-by-word glow.
    let currentLine = document.createElement('div');
    currentLine.classList.add('lyrics-line');
    let mainContainer = document.createElement('div');
    mainContainer.classList.add('main-vocal-container');
    currentLine.appendChild(mainContainer);
    let backgroundContainer = null;
    fragment.appendChild(currentLine);

    let lineSinger = null,
      lineStartTime = null,
      lineEndTime = null,
      wordBuffer = [];

    // Performance optimization: Move function outside loop and optimize DOM operations
    const flushWordBuffer = () => {
      if (!wordBuffer.length) return;
    
      // Performance optimization: Cache font computation
      const getComputedFont = (element) => {
        if (!element) return '400 16px sans-serif';
        const cacheKey = element.tagName + (element.className || '');
        if (fontCache[cacheKey]) return fontCache[cacheKey];
        
        const style = getComputedStyle(element);
        const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        fontCache[cacheKey] = font;
        return font;
      };
    
      // Create word container for main vocals
      const wordSpan = document.createElement('span');
      wordSpan.classList.add('lyrics-word');
      
      // Get the font from a reference element (or use defaults if not available)
      let referenceFont = mainContainer.firstChild ? 
                         getComputedFont(mainContainer.firstChild) : 
                         '400 16px sans-serif';
    
      const combinedText = wordBuffer.map(s => s.text).join('');
      const trimmedText = combinedText.trim();
      const textLength = trimmedText.length;
      const totalDuration = wordBuffer.reduce((sum, s) => sum + s.duration, 0);
    
      // Performance optimization: Only apply character-by-character glow for short text
      const shouldEmphasize = !lightweight &&
        !isRTL(combinedText) &&
        !isCJK(combinedText) &&
        trimmedText.length <= 7 &&
        totalDuration >= 1000;
    
      // Pre-calculate animation parameters up front
      const durationFactor = Math.min(1.0, Math.max(0.5, (totalDuration - 1000) / 1000));
      
      // Calculate scale values based on word properties
      let baseMinScale = 1.02;
      let baseMaxScale = 1;
    
      const durationScaleFactor = durationFactor * 0.15;
      baseMaxScale += durationScaleFactor;
    
      const maxScale = Math.min(1.2, baseMaxScale);
      const minScale = Math.max(1.0, Math.min(1.06, baseMinScale));
    
      const shadowIntensity = Math.min(0.8, 0.4 + (durationFactor * 0.4));
      const translateYPeak = -Math.min(3.0, 0.0 + (durationFactor * 3.0));
    
      // Store these pre-calculated values as data attributes for later use
      wordSpan.style.setProperty('--max-scale', maxScale);
      wordSpan.style.setProperty('--min-scale', minScale);
      wordSpan.style.setProperty('--shadow-intensity', shadowIntensity);
      wordSpan.style.setProperty('--translate-y-peak', translateYPeak);
      wordSpan.dataset.totalDuration = totalDuration;
    
      // Create word container for background vocals if needed
      const backgroundWordSpan = document.createElement('span');
      backgroundWordSpan.classList.add('lyrics-word');
    
      let hasBackgroundSyllables = false;
      const characterData = [];
    
      // Performance optimization: Batch syllable creation
      const syllableFragment = document.createDocumentFragment();
      const backgroundSyllableFragment = document.createDocumentFragment();
      
      wordBuffer.forEach((s, syllableIndex) => {
        const sylSpan = document.createElement('span');
        sylSpan.classList.add('lyrics-syllable');
        sylSpan.dataset.startTime = s.startTime;
        sylSpan.dataset.duration = s.duration;
        sylSpan.dataset.endTime = s.startTime + s.duration;
        sylSpan.dataset.wordDuration = totalDuration;
        sylSpan.dataset.syllableIndex = syllableIndex;
        
        // Performance optimization: Single event listener attachment
        if (!sylSpan.hasClickListener) {
          sylSpan.addEventListener('click', onLyricClick);
          sylSpan.hasClickListener = true;
        }
    
        const isRtlText = isRTL(s.text);
        if (isRtlText) {
          sylSpan.classList.add('rtl-text');
        }
    
        if (shouldEmphasize && !(s.element.isBackground)) {
          wordSpan.classList.add('growable');
          let charIndex = 0;
          
          // Performance optimization: Create text nodes first
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
                isBackground: s.element.isBackground
              });
              
              textNodes.push(charSpan);
            }
          }
          
          // Performance optimization: Append all nodes at once
          textNodes.forEach(node => sylSpan.appendChild(node));
        } else {
          sylSpan.textContent = s.element.isBackground ? s.text.replace(/[()]/g, '') : s.text;
        }
    
        if (s.element.isBackground) {
          hasBackgroundSyllables = true;
          backgroundSyllableFragment.appendChild(sylSpan);
        } else {
          syllableFragment.appendChild(sylSpan);
        }
      });
      
      // Append all syllables at once
      wordSpan.appendChild(syllableFragment);
      mainContainer.appendChild(wordSpan);
      
      // Performance optimization: Only calculate text widths for chars if needed
      if (shouldEmphasize && characterData.length > 0) {
          // First get the full word width
          const fullWordText = wordSpan.textContent;
          const wordWidth = getTextWidth(fullWordText, referenceFont);
      
          // Calculate positions for each character
          let cumulativeWidth = 0;
          characterData.forEach((charData) => {
            if (charData.isBackground) return;
      
            const span = charData.charSpan;
            const charText = span.textContent;
            
            // Only calculate text widths for chars if needed to trim the space
            if (charText.trim().length > 0) {
              const charWidth = getTextWidth(charText, referenceFont);
              const charCenter = cumulativeWidth + (charWidth / 2);
              const position = charCenter / wordWidth;
        
              // Calculate position-based offset
              const relativePosition = (position - 0.5) * 2;
              const scaleOffset = maxScale - 1.0;
              const horizontalOffsetFactor = scaleOffset * 40;
              const horizontalOffset = Math.sign(relativePosition) *
                Math.pow(Math.abs(relativePosition), 1.3) *
                horizontalOffsetFactor;
        
              // Store these pre-calculated values
              span.dataset.horizontalOffset = horizontalOffset;
              span.dataset.position = position;
        
              cumulativeWidth += charWidth;
            }
          });
        }
    
      // Add background word if necessary - only create container if needed
      if (hasBackgroundSyllables) {
        if (!backgroundContainer) {
          backgroundContainer = document.createElement('div');
          backgroundContainer.classList.add('background-vocal-container');
          currentLine.appendChild(backgroundContainer);
        }
        backgroundWordSpan.appendChild(backgroundSyllableFragment);
        backgroundContainer.appendChild(backgroundWordSpan);
      }
    
      wordBuffer = [];
    };

    // Performance optimization: Process lyrics data in chunks
    const CHUNK_SIZE = 50; // Process 50 items at a time
    for (let i = 0; i < lyrics.data.length; i += CHUNK_SIZE) {
      const chunk = lyrics.data.slice(i, i + CHUNK_SIZE);
      
      chunk.forEach((s, chunkIndex) => {
        const dataIndex = i + chunkIndex;
        
        if (lineSinger === null) lineSinger = s.element.singer;
        lineStartTime =
          lineStartTime === null ? s.startTime : Math.min(lineStartTime, s.startTime);
        lineEndTime =
          lineEndTime === null
            ? s.startTime + s.duration
            : Math.max(lineEndTime, s.startTime + s.duration);
        const lineRTL = isRTL(s.text);
  
        wordBuffer.push(s);
        if (/\s$/.test(s.text) || s.isLineEnding || dataIndex === lyrics.data.length - 1) {
          flushWordBuffer();
        }
  
        if (s.isLineEnding || dataIndex === lyrics.data.length - 1) {
          currentLine.dataset.startTime = lineStartTime / 1000;
          currentLine.dataset.endTime = lineEndTime / 1000;
          
          // Performance optimization: Single event listener attachment
          if (!currentLine.hasClickListener) {
            currentLine.addEventListener('click', onLyricClick);
            currentLine.hasClickListener = true;
          }
          
          currentLine.classList.add(
            lineSinger === "v2" || lineSinger === "v2000" ? 'singer-right' : 'singer-left'
          );
          if (lineRTL) currentLine.classList.add('rtl-text');
  
          if (dataIndex !== lyrics.data.length - 1) {
            // Create new line for next set of lyrics
            currentLine = document.createElement('div');
            currentLine.classList.add('lyrics-line');
            mainContainer = document.createElement('div');
            mainContainer.classList.add('main-vocal-container');
            currentLine.appendChild(mainContainer);
            backgroundContainer = null;
            fragment.appendChild(currentLine);
            lineSinger = null;
          }
          lineStartTime = lineEndTime = null;
        }
      });
    }
    
    flushWordBuffer();

    // Performance optimization: Remove empty lines once
    const lines = Array.from(fragment.querySelectorAll('.lyrics-line'));
    if (lines.length && !lines[lines.length - 1].dataset.startTime) {
      const lastLine = lines[lines.length - 1];
      if (lastLine.parentNode === fragment) {
        fragment.removeChild(lastLine);
      }
    }
  } else {
    // "Line" mode: each lyrics.data entry is a full line.
    // Performance optimization: Batch creation of lines
    const lineFragment = document.createDocumentFragment();
    
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
      
      // Performance optimization: Single event listener attachment
      lineDiv.addEventListener('click', onLyricClick);
      
      lineFragment.appendChild(lineDiv);
    });
    
    fragment.appendChild(lineFragment);
  }

  // Add the created elements to the container
  container.appendChild(fragment);

  // --- Add a gap line at the beginning if needed ---
  // Performance optimization: Get lines once
  const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
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
      container.insertBefore(beginningGap, firstLine);
    }
  }

  // --- Insert gap lines for long intervals between original lyric lines ---
  // Performance optimization: Batch gap line creation
  const gapLinesFragment = document.createDocumentFragment();
  const gapLinesToInsert = [];
  
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
        gapLinesToInsert.push({ gapLine, nextLine });
      }
    }
  });
  
  // Insert all gap lines at once
  gapLinesToInsert.forEach(({ gapLine, nextLine }) => {
    container.insertBefore(gapLine, nextLine);
  });

  // Performance optimization: Batch line extension updates
  originalLines.forEach((line, idx) => {
    if (idx < originalLines.length - 1) {
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextLine = originalLines[idx + 1];
      const nextStart = parseFloat(nextLine.dataset.startTime);
      const nextEnd = parseFloat(nextLine.dataset.endTime);
      const gap = nextStart - currentEnd;

      // Check if the next element is not a gap line
      const nextElement = line.nextElementSibling;
      const isFollowedByGap = nextElement && nextElement.classList.contains('lyrics-gap');

      if (gap >= 0 && !isFollowedByGap) {
        // Normal case: add a small extension if there's a positive gap
        const extension = Math.min(0.5, gap);
        line.dataset.endTime = (currentEnd + extension).toFixed(3);

        // Update any previous lines that end at the same time
        for (let i = 0; i < idx; i++) {
          if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
            originalLines[i].dataset.endTime = line.dataset.endTime;
          }
        }
      } else if (gap < 0) {
        // Set end time to next line's end time
        line.dataset.endTime = nextEnd.toFixed(3);

        // Update any previous lines that end at the same time 
        for (let i = 0; i < idx; i++) {
          if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
            originalLines[i].dataset.endTime = nextEnd.toFixed(3);
          }
        }
      }
    }
  });
  // -------------------------------------------------------------------------

  // Performance optimization: Append metadata in batch
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

  // Cache lyrics lines and syllables for performance in the sync loop
  cachedLyricsLines = Array.from(container.getElementsByClassName('lyrics-line'));
  cachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable'));

  // Add unique IDs to all lyric elements for tracking
  ensureElementIds();

  // Reset tracking variables
  activeLineIds.clear();
  highlightedSyllableIds.clear();
  visibleLineIds.clear();
  currentPrimaryActiveLine = null;

  if (cachedLyricsLines.length !== 0) {
    scrollToActiveLine(cachedLyricsLines[0], true);
  }

  startLyricsSync();
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

  lyricsContainer = container;
  return container;
}

function injectCssFile() {
  // Performance optimization: Check if style is already injected
  if (document.querySelector('link[data-lyrics-plus-style]')) return;
  
  const pBrowser = chrome || browser;

  // Create a new <link> element for the main stylesheet
  const linkElement = document.createElement('link');
  linkElement.rel = 'stylesheet';
  linkElement.type = 'text/css';
  linkElement.href = pBrowser.runtime.getURL('src/inject/stylesheet.css');
  linkElement.setAttribute('data-lyrics-plus-style', 'true');
  document.head.appendChild(linkElement);
}

/**
 * Uses canvas.measureText to compute and return the width of the given text of given font in pixels.
 * Performance optimization: Cache text width measurements
 */
function getTextWidth(text, font) {
// re-use canvas object for better performance
const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
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

// Add unique IDs to elements if they don't have them
function ensureElementIds() {
  if (!cachedLyricsLines || !cachedSyllables) return;

  // Performance optimization: Only add IDs to elements that don't have them
  cachedLyricsLines.forEach((line, i) => {
    if (!line.id) line.id = `line-${i}`;
  });

  cachedSyllables.forEach((syllable, i) => {
    if (!syllable.id) syllable.id = `syllable-${i}`;
  });
}

// Setup IntersectionObserver to track which lines are visible
function setupVisibilityTracking() {
  const container = getContainer();
  if (!container || !container.parentElement) return null;

  // Performance optimization: Reuse existing observer
  if (visibilityObserver) {
    visibilityObserver.disconnect();
  }

  // Create an observer with margins to include elements close to the viewport
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      // Batch updates to visible lines
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
      rootMargin: '200px 0px', // 200px buffer above and below visible area
      threshold: 0.1 // Trigger when at least 10% is visible
    }
  );

  // Performance optimization: Only observe lines that aren't already being observed
  if (cachedLyricsLines) {
    cachedLyricsLines.forEach(line => {
      if (line) visibilityObserver.observe(line);
    });
  }

  return visibilityObserver;
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
  
  // Performance optimization: Clean entire container at once
  const container = getContainer();
  if (container) {
    container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
  }

  // Clear tracking sets
  activeLineIds.clear();
  highlightedSyllableIds.clear();
  visibleLineIds.clear();
  currentPrimaryActiveLine = null;
  
  // Clear observers
  if (visibilityObserver) {
    visibilityObserver.disconnect();
  }
}

function updateLyricsHighlight(currentTime, isForceScroll = false) {
  if (!cachedLyricsLines || !cachedLyricsLines.length) return;

  let newActiveLineIds = new Set();
  let activeLines = [];

  // First pass: identify active lines
  cachedLyricsLines.forEach(line => {
    if (!line) return;

    const lineStart = parseFloat(line.dataset.startTime) * 1000;
    const lineEnd = parseFloat(line.dataset.endTime) * 1000;
    const shouldBeActive = currentTime >= lineStart - 190 && currentTime <= lineEnd - 1;

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
  cachedLyricsLines.forEach(line => {
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
  if (!cachedSyllables) return;

  let newHighlightedSyllableIds = new Set();

  cachedSyllables.forEach(syllable => {
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
    } else if (currentTime > startTime && !syllable.classList.contains('finished')) {
      syllable.classList.add('finished');
    } else if (currentTime > startTime && !syllable.classList.contains('highlight')) {
      updateSyllableAnimation(syllable, startTime);
    }
  });

  // Update the set of highlighted syllables
  highlightedSyllableIds = newHighlightedSyllableIds;
}

function updateSyllableAnimation(syllable, currentTime) {
  // Only process if not already highlighted
  if (syllable.classList.contains('highlight')) return;

  const startTime = Number(syllable.dataset.startTime);
  const duration = Number(syllable.dataset.duration);
  const endTime = startTime + duration;

  // Only process if we're in the time window
  if (currentTime < startTime || currentTime > endTime) return;

  let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
  const charSpans = syllable.querySelectorAll('span.char');

  // Mark as highlighted immediately to prevent repeated processing
  syllable.classList.add('highlight');

  if (charSpans.length > 0) {
    const charCount = charSpans.length;
    // Cache the word element and related data to avoid repeated DOM traversal
    const wordElement = syllable.closest('.lyrics-word');
    // Get word duration from dataset or default to syllable duration
    const finalDuration = Number(syllable.dataset.wordDuration) || duration;

    // Find all characters in the word - only do this DOM query once
    const allCharsInWord = wordElement ? wordElement.querySelectorAll('span.char') : charSpans;
    const totalChars = allCharsInWord.length;

    if (totalChars > 0) {
      // Process all characters at once
      const spans = Array.from(allCharsInWord);

      // Calculate base delay per character for more linear distribution
      const baseDelayPerChar = finalDuration * 0.07; // 7% of duration per character

      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const spanSyllable = span.closest('.lyrics-syllable');
        const isCurrentSyllable = spanSyllable === syllable;

        // Use pre-computed horizontal offset if available
        const horizontalOffset = span.dataset.horizontalOffset || 0;
        span.style.setProperty('--char-offset-x', `${horizontalOffset}`);

        // Calculate delays based on pre-computed character index
        const charIndex = Number(span.dataset.syllableCharIndex || i);
        const growDelay = baseDelayPerChar * charIndex;

        if (isCurrentSyllable) {
          // For characters in current syllable
          const charIndexInSyllable = Array.from(charSpans).indexOf(span);
          const wipeDelay = (duration / charCount) * charIndexInSyllable;

          // Apply both wipe and grow animations with proper timing
          span.style.animation = `${wipeAnimation} ${duration / charCount}ms linear ${wipeDelay}ms forwards, 
                                  grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
        } else if (!spanSyllable.classList.contains('highlight')) {
          // For characters in other syllables
          span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
        }
      }
    }
  } else {
    // For syllables without character spans
    if (syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
      wipeAnimation = "fade-gap";
    }
    syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
  }
}

// Reset a single syllable
function resetSyllable(syllable) {
  if (!syllable) return;

  syllable.style.animation = '';
  syllable.classList.remove('highlight');
  syllable.classList.remove('finished');

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
  
  document.querySelectorAll('.' + positionClasses.join(', .'))
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
