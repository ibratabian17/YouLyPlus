// previewManager.js

// Mock lyrics data for preview (same as before)
const mockLyricsData = {
    type: 'Word',
    data: [
        {
            text: 'This is a preview ',
            startTime: 0, endTime: 2.5,
            syllabus: [
                { text: 'This ', time: 0, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'is ', time: 500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'a ', time: 1000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'preview ', time: 1500, duration: 1000, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: 'of how lyrics will look!',
            startTime: 3, endTime: 6,
            syllabus: [
                { text: 'of ', time: 3000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'how ', time: 3500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'lyrics ', time: 4000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'will ', time: 4500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'look!', time: 5000, duration: 1000, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: '(Background) and main',
            startTime: 6.5, endTime: 9.5,
            syllabus: [
                { text: '(Back', time: 6500, duration: 500, isLineEnding: false, isBackground: true, element: { singer: 'v2' } },
                { text: 'ground) ', time: 7000, duration: 500, isLineEnding: true, isBackground: true, element: { singer: 'v2' } },
                { text: 'and ', time: 7500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'main', time: 8000, duration: 500, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: 'Enjoy the example!',
            startTime: 10, endTime: 12,
            syllabus: [
                { text: 'En', time: 10000, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'joy ', time: 10250, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'the ', time: 10500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'ex', time: 11000, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'am', time: 11250, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'ple!', time: 11500, duration: 500, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: 'Supercalifragilisticexpialidocious short',
            startTime: 13, endTime: 17,
            syllabus: [
                { text: 'Su', time: 13000, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'per', time: 13200, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'ca', time: 13400, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'li', time: 13600, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'fra', time: 13800, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'gi', time: 14000, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'lis', time: 14200, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'tic', time: 14400, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'ex', time: 14600, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'pi', time: 14800, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'ali', time: 15000, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'do', time: 15200, duration: 200, isLineEnding: false, isBackground: false, element: { singer: 'v2' } },
                { text: 'cious ', time: 15400, duration: 600, isLineEnding: true, isBackground: false, element: { singer: 'v2' } },
                { text: 'short', time: 16500, duration: 500, isLineEnding: true, isBackground: false, element: { singer: 'v2' } },
            ],
            element: { singer: 'v2' }
        },
        {
            text: 'مرحباً بالعالم', // "Hello World" in Arabic
            startTime: 18, endTime: 20,
            syllabus: [
                { text: 'مرحباً ', time: 18000, duration: 1000, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'بالعالم', time: 19000, duration: 1000, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: '(This is a background vocal line)',
            startTime: 21, endTime: 24,
            syllabus: [
                { text: '(This ', time: 21000, duration: 500, isLineEnding: false, isBackground: true, element: { singer: 'v1' } },
                { text: 'is ', time: 21500, duration: 500, isLineEnding: false, isBackground: true, element: { singer: 'v1' } },
                { text: 'a ', time: 22000, duration: 500, isLineEnding: false, isBackground: true, element: { singer: 'v1' } },
                { text: 'background ', time: 22500, duration: 1000, isLineEnding: false, isBackground: true, element: { singer: 'v1' } },
                { text: 'vocal ', time: 23500, duration: 500, isLineEnding: false, isBackground: true, element: { singer: 'v1' } },
                { text: 'line)', time: 24000, duration: 500, isLineEnding: true, isBackground: true, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: 'This line will be followed by a long gap.',
            startTime: 25, endTime: 28,
            syllabus: [
                { text: 'This ', time: 25000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'line ', time: 25500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'will ', time: 26000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'be ', time: 26500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'followed ', time: 27000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'by ', time: 27500, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'a ', time: 27750, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'long ', time: 28000, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'gap.', time: 28250, duration: 250, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
        {
            text: 'This line appears after a 10-second gap.',
            startTime: 38, endTime: 42,
            syllabus: [
                { text: 'This ', time: 38000, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'line ', time: 38500, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'appears ', time: 39000, duration: 750, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'after ', time: 39750, duration: 500, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'a ', time: 40250, duration: 250, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: '10-second ', time: 40500, duration: 1000, isLineEnding: false, isBackground: false, element: { singer: 'v1' } },
                { text: 'gap.', time: 41500, duration: 500, isLineEnding: true, isBackground: false, element: { singer: 'v1' } },
            ],
            element: { singer: 'v1' }
        },
    ],
    metadata: {
        title: 'Example Song',
        artist: ['YouLy+ Dev'],
        album: 'Settings Preview',
        duration: 45000, // Updated duration to accommodate new lines and gaps
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

// --- START OF COPIED AND ADAPTED LOGIC FROM lyricsRenderer.js ---

// Renamed variables for preview context
let previewLyricsAnimationFrameId = null;
let previewCurrentPrimaryActiveLine = null;
let previewLastTime = 0; // This will be the previous frame's mock time
let previewCurrentTime = 0; // Master mock time for preview playback
let previewPlaybackInterval = null;

// Performance optimization: Cache selectors and calculations
let previewLyricsContainer = null;
let previewCachedLyricsLines = [];
let previewCachedSyllables = [];
let previewActiveLineIds = new Set(); // Kept for structural similarity, might not be as crucial for preview
let previewHighlightedSyllableIds = new Set(); // Kept for structural similarity
// let previewVisibleLineIds = new Set(); // Visibility observer not used in preview
// let previewLastProcessedTime = 0; // Not directly used in preview's simplified loop
let previewFontCache = {};
// let previewTextWidthCanvas = null; // getTextWidth uses a static property on the function itself

// Cached DOM references
const getPreviewContainer = () => {
  if (!previewLyricsContainer) {
    previewLyricsContainer = document.getElementById('lyrics-plus-container-preview');
    // For preview, we assume the container exists and doesn't need creation.
  }
  return previewLyricsContainer;
};

// Performance optimization: Batch DOM manipulations (can be kept if desired, but less critical for limited mock data)
// function batchDOMUpdates(callback) {
//   requestAnimationFrame(() => {
//     const fragment = document.createDocumentFragment();
//     callback(fragment);
//     getPreviewContainer().appendChild(fragment);
//   });
// }

const onPreviewLyricClick = e => {
    const target = e.currentTarget;
    let timeToSeekMs = 0;
    if (target.classList.contains('lyrics-line')) {
        timeToSeekMs = parseFloat(target.dataset.startTime) * 1000; // Line times are in seconds
    } else { // Syllable
        timeToSeekMs = parseFloat(target.dataset.startTime); // Syllable times are in ms
    }
    if (!isNaN(timeToSeekMs)) {
        previewCurrentTime = timeToSeekMs;
        // Force an immediate update and scroll
        updatePreviewLyricsHighlight(previewCurrentTime, true);
    }
};

const isRTL = text => typeof text === 'string' && /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u08A0-\u08FF\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFF]/.test(text);
const isCJK = text => typeof text === 'string' && /[\u4E00-\u9FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);

const GAP_THRESHOLD = 7; // seconds

function createPreviewGapLine(gapStart, gapEnd, classesToInherit = null) {
    const gapDuration = gapEnd - gapStart;
    // const gapLine = elementPool.lines.pop() || document.createElement('div'); // Element pool not used in this simplified preview copy
    const gapLine = document.createElement('div');
    gapLine.className = 'lyrics-line lyrics-gap';
    gapLine.dataset.startTime = gapStart; // Expecting seconds
    gapLine.dataset.endTime = gapEnd;     // Expecting seconds

    // if (!gapLine.hasClickListener) { // Simpler for preview
    gapLine.addEventListener('click', onPreviewLyricClick);
    //   gapLine.hasClickListener = true;
    // }

    if (classesToInherit) {
      if (classesToInherit.includes('rtl-text')) gapLine.classList.add('rtl-text');
      if (classesToInherit.includes('singer-left')) gapLine.classList.add('singer-left');
      if (classesToInherit.includes('singer-right')) gapLine.classList.add('singer-right');
    }

    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-vocal-container';

    for (let i = 0; i < 3; i++) {
    //   const syllableSpan = elementPool.syllables.pop() || document.createElement('span');
      const syllableSpan = document.createElement('span');
      syllableSpan.className = 'lyrics-syllable';
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = ((gapDuration / 3) / 0.9) * 1000;
      syllableSpan.dataset.startTime = syllableStart;
      syllableSpan.dataset.duration = syllableDuration;
      syllableSpan.dataset.endTime = syllableStart + syllableDuration;
      syllableSpan.textContent = "•";
    //   if (!syllableSpan.hasClickListener) {
      syllableSpan.addEventListener('click', onPreviewLyricClick);
    //     syllableSpan.hasClickListener = true;
    //   }
      mainContainer.appendChild(syllableSpan);
    }
    gapLine.appendChild(mainContainer);
    return gapLine;
}


// Adapted displayLyrics - renamed to displayPreviewLyrics
// Removed parameters not used in preview: source (uses mock), type (uses mock), songWriters (uses mock), songInfo, displayMode
function displayPreviewLyrics(lyrics, lightweight = false, currentSettings = {}) {
  const container = getPreviewContainer();
  if (!container) return;

  // Translations / Romanizations not handled in preview, so class removals are enough.
  container.classList.remove('lyrics-translated', 'lyrics-romanized');
  // if (displayMode === 'translate') { // Not applicable to preview
  //   container.classList.add('lyrics-translated');
  // } else if (displayMode === 'romanize') {
  //   container.classList.add('lyrics-romanized');
  // }

  container.innerHTML = ''; // Clear container
  previewFontCache = {}; // Reset font cache for preview

//   const elementPool = { // Element pool simplified/removed for preview
//     lines: [],
//     syllables: [],
//     chars: []
//   };

  const getComputedFont = (element) => { // Copied from lyricsRenderer
    if (!element) return '400 16px sans-serif';
    const cacheKey = element.tagName + (element.className || '');
    if (previewFontCache[cacheKey]) return previewFontCache[cacheKey]; // Use previewFontCache
    const style = getComputedStyle(element);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    previewFontCache[cacheKey] = font; // Use previewFontCache
    return font;
  };

  const fragment = document.createDocumentFragment();
  const isWordByWordMode = lyrics.type === "Word" && (currentSettings.wordByWord !== undefined ? currentSettings.wordByWord : true); // lyricsRenderer uses currentSettings.wordByWord directly

  if (isWordByWordMode) {
    lyrics.data.forEach((line, lineIndex) => {
    //   let currentLine = elementPool.lines.pop() || document.createElement('div');
      let currentLine = document.createElement('div');
      currentLine.className = ''; // Reset class name if reusing from a pool
      currentLine.classList.add('lyrics-line');
      currentLine.dataset.startTime = line.startTime; // Expecting seconds
      currentLine.dataset.endTime = line.endTime;     // Expecting seconds
      currentLine.classList.add(
        (line.element && (line.element.singer === "v2" || line.element.singer === "v2000")) ? 'singer-right' : 'singer-left'
      );
      if (isRTL(line.text)) currentLine.classList.add('rtl-text');
    //   if (!currentLine.hasClickListener) { // Simpler for preview
        currentLine.addEventListener('click', onPreviewLyricClick);
    //     currentLine.hasClickListener = true;
    //   }

      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      currentLine.appendChild(mainContainer);

      // Translated/Romanized text not handled in preview
      
      let backgroundContainer = null;
      let wordBuffer = [];
      let currentWordStartTime = null; // in ms
      let currentWordEndTime = null;   // in ms
      // let currentWordElement = {}; // Not used in lyricsRenderer's flushWordBuffer

      const flushWordBuffer = () => {
        if (!wordBuffer.length) return;
        // const wordSpan = elementPool.syllables.pop() || document.createElement('span'); // Using syllables pool for words in original? Recheck. Assuming new span.
        const wordSpan = document.createElement('span');
        wordSpan.className = ''; // Reset
        wordSpan.classList.add('lyrics-word');
        let referenceFont = mainContainer.firstChild ? getComputedFont(mainContainer.firstChild) : getComputedFont(mainContainer) || '400 16px sans-serif'; // Adapted font reference
        const combinedText = wordBuffer.map(s => s.text).join('');
        const trimmedText = combinedText.trim();
        const totalDuration = currentWordEndTime - currentWordStartTime;
        const shouldEmphasize = !lightweight && !isRTL(combinedText) && !isCJK(combinedText) && trimmedText.length <= 7 && trimmedText.length > 0 && totalDuration >= 1000;
        const durationFactor = Math.min(1.0, Math.max(0.5, (totalDuration - 1000) / 1000));
        let baseMinScale = 1.02;
        let baseMaxScale = 1;
        const durationScaleFactor = durationFactor * 0.15;
        baseMaxScale += durationScaleFactor;
        const maxScale = Math.min(1.2, baseMaxScale);
        const minScale = Math.max(1.0, Math.min(1.06, baseMinScale));
        const shadowIntensity = Math.min(0.8, 0.4 + (durationFactor * 0.4));
        const translateYPeak = -Math.min(3.0, 0.0 + (durationFactor * 3.0));
        
        // --- CORRECTED CSS CUSTOM PROPERTY SETTING ---
        wordSpan.style.setProperty('--max-scale', maxScale);
        wordSpan.style.setProperty('--min-scale', minScale);
        wordSpan.style.setProperty('--shadow-intensity', shadowIntensity);
        wordSpan.style.setProperty('--translate-y-peak', translateYPeak);
        // --- END CORRECTION ---

        wordSpan.dataset.totalDuration = totalDuration;
        let isCurrentWordBackground = wordBuffer[0].isBackground || false;
        const characterData = [];

        wordBuffer.forEach((s, syllableIndex) => {
        //   const sylSpan = elementPool.syllables.pop() || document.createElement('span');
          const sylSpan = document.createElement('span');
          sylSpan.className = ''; // Reset
          sylSpan.classList.add('lyrics-syllable');
          sylSpan.dataset.startTime = s.time;
          sylSpan.dataset.duration = s.duration;
          sylSpan.dataset.endTime = s.time + s.duration;
          sylSpan.dataset.wordDuration = totalDuration;
          sylSpan.dataset.syllableIndex = syllableIndex;
        //   if (!sylSpan.hasClickListener) {
            sylSpan.addEventListener('click', onPreviewLyricClick);
        //     sylSpan.hasClickListener = true;
        //   }
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
                //   const charSpan = elementPool.chars.pop() || document.createElement('span');
                  const charSpan = document.createElement('span');
                  charSpan.textContent = char;
                  charSpan.className = ''; // Reset
                  charSpan.classList.add('char');
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
          const fullWordText = wordSpan.textContent;
          const wordWidth = getTextWidth(fullWordText, referenceFont);
          let cumulativeWidth = 0;
          characterData.forEach((charData) => {
            if (charData.isBackground) return;
            const span = charData.charSpan;
            const charText = span.textContent;
            if (charText.trim().length > 0) {
              const charWidth = getTextWidth(charText, referenceFont);
              const charCenter = cumulativeWidth + (charWidth / 2);
              const position = wordWidth === 0 ? 0 : charCenter / wordWidth; // Avoid division by zero
              const relativePosition = (position - 0.5) * 2;
              const scaleOffset = maxScale - 1.0;
              const horizontalOffsetFactor = scaleOffset * 40;
              const horizontalOffset = Math.sign(relativePosition) * Math.pow(Math.abs(relativePosition), 1.3) * horizontalOffsetFactor;
              span.dataset.horizontalOffset = horizontalOffset; // No toFixed()
              span.dataset.position = position; // No toFixed()
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
        // currentWordElement = {}; // Reset
      };

      if (line.syllabus && line.syllabus.length > 0) {
        line.syllabus.forEach((s, syllableIndex) => {
          if (wordBuffer.length === 0) currentWordStartTime = s.time;
          wordBuffer.push(s);
          currentWordEndTime = s.time + s.duration;
        //   currentWordElement = s.element || {}; // lyricsRenderer stores this

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
  } else { // "Line" mode
    // const lineFragment = document.createDocumentFragment(); // Not needed if appending directly to main fragment
    lyrics.data.forEach(line => {
    //   const lineDiv = elementPool.lines.pop() || document.createElement('div');
      const lineDiv = document.createElement('div');
      lineDiv.className = ''; // Reset
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      lineDiv.classList.add('lyrics-line');
      lineDiv.classList.add((line.element && line.element.singer === "v2") ? 'singer-right' : 'singer-left');
      if (isRTL(line.text)) lineDiv.classList.add('rtl-text');
    //   if (!lineDiv.hasClickListener) {
        lineDiv.addEventListener('click', onPreviewLyricClick);
    //     lineDiv.hasClickListener = true;
    //   }

      const mainContainer = document.createElement('div');
      mainContainer.classList.add('main-vocal-container');
      mainContainer.textContent = line.text;
      lineDiv.appendChild(mainContainer);

      // Translated/Romanized text not handled in preview

      fragment.appendChild(lineDiv);
    });
    // fragment.appendChild(lineFragment); // Append directly
  }

  container.appendChild(fragment);

  // --- GAP INSERTION AND END TIME ADJUSTMENT LOGIC (copied from lyricsRenderer.js) ---
  const originalLines = Array.from(container.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
  if (originalLines.length > 0) {
    const firstLine = originalLines[0];
    const firstStartTime = parseFloat(firstLine.dataset.startTime);
    if (firstStartTime >= GAP_THRESHOLD) {
      const classesToInherit = [];
      if (firstLine.classList.contains('rtl-text')) classesToInherit.push('rtl-text');
      if (firstLine.classList.contains('singer-left')) classesToInherit.push('singer-left');
      if (firstLine.classList.contains('singer-right')) classesToInherit.push('singer-right');
      const beginningGap = createPreviewGapLine(0, firstStartTime - 0.85, classesToInherit);
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
        const gapLine = createPreviewGapLine(currentEnd + 0.4, nextStart - 0.85, classesToInherit);
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
      let newEndTimeStr = line.dataset.endTime; // Keep current string value

      if (gap >= 0 && !isFollowedByGap) {
        const extension = Math.min(0.5, gap); // lyricsRenderer uses Math.min(0.5, gap);
        newEndTimeStr = (currentEnd + extension).toFixed(3);
        line.dataset.endTime = newEndTimeStr;
      } else if (gap < 0) { // Overlap
        newEndTimeStr = nextEnd.toFixed(3);
        line.dataset.endTime = newEndTimeStr;
      }
      // Propagate endTime changes only if it actually changed
      if (line.dataset.endTime !== currentEnd.toFixed(3)) {
        for (let i = 0; i < idx; i++) {
            if (Math.abs(parseFloat(originalLines[i].dataset.endTime) - currentEnd) < 0.001) {
                originalLines[i].dataset.endTime = newEndTimeStr;
            }
        }
      }
    }
  });
  // --- END GAP INSERTION AND END TIME ADJUSTMENT ---


  const metadataFragment = document.createDocumentFragment();
  // Use mock metadata
  if (mockLyricsData.metadata.artist && mockLyricsData.metadata.artist.length > 0) {
    const songWritersDiv = document.createElement('span');
    songWritersDiv.classList.add('lyrics-song-writters');
    songWritersDiv.innerText = `${t("writtenBy")} ${mockLyricsData.metadata.artist.join(', ')}`;
    metadataFragment.appendChild(songWritersDiv);
  }
  const sourceDiv = document.createElement('span');
  sourceDiv.classList.add('lyrics-source-provider');
  sourceDiv.innerText = `${t("source")} ${mockLyricsData.metadata.source}`; // Use mock source
  metadataFragment.appendChild(sourceDiv);
  container.appendChild(metadataFragment);

  previewCachedLyricsLines = Array.from(container.getElementsByClassName('lyrics-line'));
  previewCachedSyllables = Array.from(container.getElementsByClassName('lyrics-syllable'));
  ensurePreviewElementIds(); // Renamed function
  previewActiveLineIds.clear();
  previewHighlightedSyllableIds.clear();
  // previewVisibleLineIds.clear(); // Not used
  previewCurrentPrimaryActiveLine = null;

  if (previewCachedLyricsLines.length !== 0) {
    // lyricsRenderer does: scrollToActiveLine(cachedLyricsLines[0], true);
    // For preview, we'll let the initial highlight call handle scrolling.
    updatePreviewLyricsHighlight(0, true); // Initial state at time 0, force scroll
  }
  // startPreviewLyricsSync(); // This is called by startFullPreviewSync
  // createControlButtons not needed for preview
}


function getTextWidth(text, font) { // Copied from lyricsRenderer
  const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
}

// ensureElementIds -> ensurePreviewElementIds
function ensurePreviewElementIds() {
  if (!previewCachedLyricsLines || !previewCachedSyllables) return;
  previewCachedLyricsLines.forEach((line, i) => {
    if (line && !line.id) line.id = `preview-line-${i}`; // Prefix with preview
  });
  previewCachedSyllables.forEach((syllable, i) => {
    if (syllable && !syllable.id) syllable.id = `preview-syllable-${i}`; // Prefix with preview
  });
}

// updateLyricsHighlight -> updatePreviewLyricsHighlight
// Uses previewCurrentTime (ms) instead of videoElement.currentTime
function updatePreviewLyricsHighlight(currentTimeMs, isForceScroll = false) {
  if (!previewCachedLyricsLines || !previewCachedLyricsLines.length) return;
  // let newActiveLineIds = new Set(); // lyricsRenderer uses this, previewActiveLineIds is updated at the end
  let activeLines = [];

  previewCachedLyricsLines.forEach(line => {
    if (!line) return;
    const lineStart = parseFloat(line.dataset.startTime) * 1000;
    const lineEnd = parseFloat(line.dataset.endTime) * 1000;
    const shouldBeActive = currentTimeMs >= lineStart - 190 && currentTimeMs <= lineEnd - 1;
    if (shouldBeActive) {
    //   newActiveLineIds.add(line.id); // Not directly adding here in lyricsRenderer v2
      activeLines.push(line);
    }
  });

  activeLines.sort((a, b) => parseFloat(b.dataset.startTime) - parseFloat(a.dataset.startTime));
  const allowedActiveLines = activeLines.slice(0, 2);
  const allowedActiveIds = new Set(allowedActiveLines.map(line => line.id));
  
  let primaryLineCandidateForScroll = null;

  previewCachedLyricsLines.forEach(line => {
    if (!line) return;
    const wasActive = line.classList.contains('active');
    const shouldBeActiveNow = allowedActiveIds.has(line.id); // Use the filtered set

    if (shouldBeActiveNow && !wasActive) {
      line.classList.add('active');
      if (!previewCurrentPrimaryActiveLine ||
        (currentTimeMs >= previewLastTime && parseFloat(line.dataset.startTime) > parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime)) ||
        (currentTimeMs < previewLastTime && parseFloat(line.dataset.startTime) < parseFloat(previewCurrentPrimaryActiveLine.dataset.startTime))) {
        // scrollPreviewActiveLine(currentTimeMs, isForceScroll); // lyricsRenderer calls scrollActiveLine here
        // The actual scrolling call is inside scrollPreviewActiveLine, which will determine the line
        primaryLineCandidateForScroll = line; // Mark as candidate
      }
    } else if (!shouldBeActiveNow && wasActive) {
      line.classList.remove('active');
      resetPreviewSyllables(line); // Renamed function
      if (previewCurrentPrimaryActiveLine === line) {
        previewCurrentPrimaryActiveLine = null; // Clear if it was primary
      }
    }
  });

  // If a new primary line candidate was identified or forced, or if no primary and active lines exist.
  if (primaryLineCandidateForScroll || isForceScroll || (!previewCurrentPrimaryActiveLine && allowedActiveLines.length > 0) ) {
    // Pass current time, force flag, and the current set of *allowed* active lines
    scrollPreviewActiveLine(currentTimeMs, isForceScroll, allowedActiveLines);
  }

  previewActiveLineIds = allowedActiveIds; // Update the global set
  updatePreviewSyllables(currentTimeMs); // Renamed function
}

// updateSyllables -> updatePreviewSyllables
function updatePreviewSyllables(currentTimeMs) {
  if (!previewCachedSyllables) return;
  let newHighlightedSyllableIds = new Set(); // lyricsRenderer uses this
  previewCachedSyllables.forEach(syllable => {
    if (!syllable) return;
    const parentLine = syllable.closest('.lyrics-line');
    if (!parentLine || !parentLine.classList.contains('active')) {
      if (syllable.classList.contains('highlight')) resetPreviewSyllable(syllable); // Renamed
      return;
    }
    const startTime = parseFloat(syllable.dataset.startTime);
    const duration = parseFloat(syllable.dataset.duration);
    const endTime = startTime + duration;

    if (currentTimeMs >= startTime && currentTimeMs <= endTime) {
      newHighlightedSyllableIds.add(syllable.id);
      if (!syllable.classList.contains('highlight')) updatePreviewSyllableAnimation(syllable, currentTimeMs); // Renamed
    } else if (currentTimeMs < startTime && syllable.classList.contains('highlight')) {
      resetPreviewSyllable(syllable); // Renamed
    } else if (currentTimeMs > endTime && !syllable.classList.contains('finished')) {
      // --- CORRECTED FINISHED SYLLABLE LOGIC ---
      // lyricsRenderer adds 'finished' but does NOT remove 'highlight' here.
      // 'highlight' is only removed if the line becomes inactive or time rewinds before syllable start.
      syllable.classList.add('finished');
      // --- END CORRECTION ---
    } else if (currentTimeMs > startTime && !syllable.classList.contains('highlight') && !syllable.classList.contains('finished')) {
        // This case handles when the player jumps past a syllable that wasn't highlighted yet.
        // lyricsRenderer calls updateSyllableAnimation with startTime to animate it from the beginning.
        updatePreviewSyllableAnimation(syllable, startTime);
    }
  });
  previewHighlightedSyllableIds = newHighlightedSyllableIds; // Update global set
}


// updateSyllableAnimation -> updatePreviewSyllableAnimation
function updatePreviewSyllableAnimation(syllable, currentTime) { // currentTime is player time in ms
  if (syllable.classList.contains('highlight')) return;

  const startTime = Number(syllable.dataset.startTime);
  const duration = Number(syllable.dataset.duration);
  // const endTime = startTime + duration; // Not used in lyricsRenderer for anim triggering

  let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';
  const charSpans = syllable.querySelectorAll('span.char');

  syllable.classList.add('highlight');

  if (charSpans.length > 0) {
    const charCount = charSpans.length;
    const wordElement = syllable.closest('.lyrics-word');
    const finalDuration = Number(syllable.dataset.wordDuration) || duration; // From lyricsRenderer

    const allCharsInWord = wordElement ? wordElement.querySelectorAll('span.char') : charSpans;
    // const totalChars = allCharsInWord.length; // Not used this way in lyricsRenderer

    const baseDelayPerChar = finalDuration * 0.07;

    for (let i = 0; i < allCharsInWord.length; i++) { // lyricsRenderer uses a for loop
      const span = allCharsInWord[i];
      const spanSyllable = span.closest('.lyrics-syllable');
      const isCurrentSyllable = spanSyllable === syllable;

      const horizontalOffset = span.dataset.horizontalOffset || 0;
      span.style.setProperty('--char-offset-x', horizontalOffset); // No 'px'

      const charIndex = Number(span.dataset.syllableCharIndex || i);
      const growDelay = baseDelayPerChar * charIndex;

      if (isCurrentSyllable) {
        const charIndexInSyllable = Array.from(charSpans).indexOf(span);
        const wipeDelay = (duration / charCount) * charIndexInSyllable;
        const preWipeDelay = (duration / charCount) * (charIndexInSyllable - 1);

        span.style.animation = `pre-wipe-char ${(duration / charCount)}ms linear ${preWipeDelay}ms, ` +
                               `${wipeAnimation} ${duration / charCount}ms linear ${wipeDelay}ms forwards, ` +
                               `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
      } else if (!spanSyllable.classList.contains('highlight')) { // Matched lyricsRenderer's condition
          span.style.animation = `grow-dynamic ${finalDuration * 1.2}ms ease-in-out ${growDelay}ms forwards`;
      }
    }
  } else {
    if (syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
      wipeAnimation = "fade-gap";
    }
    syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
  }
}

// resetSyllable -> resetPreviewSyllable
function resetPreviewSyllable(syllable) {
  if (!syllable) return;
  syllable.style.animation = '';
  syllable.classList.remove('highlight', 'finished');
  const charSpans = syllable.querySelectorAll('span.char');
  charSpans.forEach(span => { span.style.animation = ''; });
}

// resetSyllables -> resetPreviewSyllables
function resetPreviewSyllables(line) {
  if (!line) return;
  const syllables = line.getElementsByClassName('lyrics-syllable');
  for (let i = 0; i < syllables.length; i++) {
    resetPreviewSyllable(syllables[i]);
  }
}

// scrollActiveLine -> scrollPreviewActiveLine
// Takes currentTimeMs and the current set of active lines for decision making
function scrollPreviewActiveLine(currentTimeMs, forceScroll = false, currentActiveLines = []) {
  const container = getPreviewContainer(); // Use preview container
  // const activeLines = container.querySelectorAll('.lyrics-line.active'); // lyricsRenderer gets them from DOM
  // We receive currentActiveLines which is already filtered and sorted
  if (!currentActiveLines.length) return;

  let lineToScroll = currentActiveLines[0]; // Default: latest starting active line
  let activestLine = currentActiveLines[0]; // For styling, usually the same as lineToScroll or latest starting.

  if (currentActiveLines.length > 1) {
    for (const line of currentActiveLines) { // Find line that hasn't ended yet or is ending soon
      const endTime = parseFloat(line.dataset.endTime) * 1000;
      if (endTime - currentTimeMs > 200) { // lyricsRenderer uses 200ms threshold
        lineToScroll = line;
        break; // lyricsRenderer breaks on first suitable future line
      }
    }
  }
  // activestLine remains the one that started most recently among allowedActiveLines for styling.

  // Get all lyrics lines and find index of scroll line
  const allLyricLines = previewCachedLyricsLines; // Use cached array
  const scrollLineIndex = allLyricLines.indexOf(activestLine); // Index of the line getting 'lyrics-activest'

  // Clear previous position classes
  const positionClasses = ['lyrics-activest', 'pre-active-line', 'next-active-line'];
  for (let i = 1; i <= 4; i++) {
    positionClasses.push(`prev-${i}`, `next-${i}`);
  }

  // lyricsRenderer: document.querySelectorAll('.' + positionClasses.join(', .')).forEach(...)
  // More efficient for preview: iterate over cached lines
  allLyricLines.forEach(el => {
    if (el) el.classList.remove(...positionClasses);
  });
  
  if (activestLine) { // Ensure activestLine is valid
    activestLine.classList.add('lyrics-activest');
    previewCurrentPrimaryActiveLine = activestLine; // Set the global primary for preview context
  }


  // Add position classes only to relevant lines
  // scrollLineIndex could be -1 if activestLine is not in allLyricLines (should not happen with good logic)
  if (scrollLineIndex !== -1) {
    for (let i = Math.max(0, scrollLineIndex - 4); i <= Math.min(allLyricLines.length - 1, scrollLineIndex + 4); i++) {
        const position = i - scrollLineIndex;
        const line = allLyricLines[i];
        if (!line) continue;

        if (position === -1) line.classList.add('pre-active-line');
        else if (position === 1) line.classList.add('next-active-line');
        else if (position <= -1 && position >= -4) line.classList.add(`prev-${Math.abs(position)}`); // Corrected logic
        else if (position >= 1 && position <= 4) line.classList.add(`next-${position}`);    // Corrected logic
    }
  }

  scrollToPreviewView(lineToScroll, forceScroll); // Renamed function
}

// scrollToActiveLine -> scrollToPreviewView
function scrollToPreviewView(activeLine, forceScroll = false) {
  if (!activeLine) return;

  const container = getPreviewContainer(); // This is the scrollable element itself for preview
  if (!container) return;

  const computedStyle = getComputedStyle(container);
  if (computedStyle.display !== 'block' && computedStyle.display !== 'flex') return; // lyricsRenderer has 'block'

  // The actual scroll container is the container itself in preview.
  const scrollContainer = container;
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const lineRect = activeLine.getBoundingClientRect();

  // Define the safe area based on the visible scroll container.
  // lyricsRenderer uses container.parentElement, here it's just container.
  const safeAreaTop = scrollContainerRect.top + scrollContainerRect.height * 0.15;
  const safeAreaBottom = scrollContainerRect.top + scrollContainerRect.height * 0.95;

  // Check if the line is outside the safe area (using line's top like lyricsRenderer)
  const lineIsOutsideSafeArea = lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom;
  
  // Correct logic: Scroll if line is outside safe area OR forceScroll is true
  // lyricsRenderer: if (lineIsInsideSafeArea && !forceScroll) return; // This is confusingly named.
  // Correct interpretation: if (!forceScroll && !(lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom)) return;
  // Which simplifies to: if (!forceScroll && lineRect.top >= safeAreaTop && lineRect.top <= safeAreaBottom) return;

  if (!forceScroll && (lineRect.top >= safeAreaTop && lineRect.top <= safeAreaBottom)) {
    // Line is already in the visible safe area and we're not forcing a scroll
    return;
  }

  // Scroll the scroll container to the target position
  activeLine.scrollIntoView({
    behavior: 'smooth',
    block: 'start' // Match lyricsRenderer
  });
}

// cleanupLyrics -> cleanupPreviewLyrics
function cleanupPreviewLyrics() {
  if (previewLyricsAnimationFrameId) {
    cancelAnimationFrame(previewLyricsAnimationFrameId);
    previewLyricsAnimationFrameId = null;
  }
  if (previewPlaybackInterval) {
    clearInterval(previewPlaybackInterval);
    previewPlaybackInterval = null;
  }

  const container = getPreviewContainer();
  if (container) {
    container.innerHTML = `<span class="text-loading">${t("loading")}</span>`;
  }
  previewActiveLineIds.clear();
  previewHighlightedSyllableIds.clear();
  // previewVisibleLineIds.clear(); // Not used
  previewCurrentPrimaryActiveLine = null;
  previewCachedLyricsLines = [];
  previewCachedSyllables = [];
  previewFontCache = {};
}

// --- END OF COPIED AND ADAPTED LOGIC ---


// Preview specific synchronization and main function
function startPreviewLyricsSyncAnimation() {
  stopPreviewLyricsSync(); // Clear any existing sync

  previewLastTime = previewCurrentTime; // Initialize lastTime with current mock time

  function syncPreview() {
    // Check if stopped
    if (previewPlaybackInterval === null && previewLyricsAnimationFrameId === null) {
        if(previewLyricsAnimationFrameId) cancelAnimationFrame(previewLyricsAnimationFrameId);
        previewLyricsAnimationFrameId = null;
        return;
    }

    const timeDeltaMs = Math.abs(previewCurrentTime - previewLastTime);
    const isForceScroll = timeDeltaMs > 1000; // Force scroll if jump is > 1s

    updatePreviewLyricsHighlight(previewCurrentTime, isForceScroll);

    previewLastTime = previewCurrentTime;
    if (previewPlaybackInterval !== null) { // Only request next frame if playback interval is active
        previewLyricsAnimationFrameId = requestAnimationFrame(syncPreview);
    } else {
        if(previewLyricsAnimationFrameId) cancelAnimationFrame(previewLyricsAnimationFrameId);
        previewLyricsAnimationFrameId = null; // Ensure it's cleared if interval stopped
    }
  }
  
  // Start the animation loop immediately if not already running
  if (previewLyricsAnimationFrameId === null) {
     previewLyricsAnimationFrameId = requestAnimationFrame(syncPreview);
  }

  // Start/Restart the time progression interval
  if (previewPlaybackInterval) clearInterval(previewPlaybackInterval);
  previewPlaybackInterval = setInterval(() => {
    previewCurrentTime += 100; // Increment time by 100ms
    const totalDuration = mockLyricsData.metadata.duration || 12000;
    if (previewCurrentTime > totalDuration + 2000) { // Loop after 2s pause
        previewCurrentTime = 0;
        // The isForceScroll in updatePreviewLyricsHighlight will handle the jump
    }
  }, 100);
}

export function startFullPreviewSync(currentSettings) {
    cleanupPreviewLyrics(); // Clean up first
    previewCurrentTime = 0; // Reset time to start

    // Call the adapted display function
    displayPreviewLyrics(
        mockLyricsData, // Pass the whole mock data structure which includes type
        currentSettings.lightweight,
        currentSettings // Pass currentSettings for wordByWord check
    );

    startPreviewLyricsSyncAnimation();
}

function stopPreviewLyricsSync() { // Helper to ensure all timers are cleared
    if (previewLyricsAnimationFrameId) {
        cancelAnimationFrame(previewLyricsAnimationFrameId);
        previewLyricsAnimationFrameId = null;
    }
    if (previewPlaybackInterval) {
        clearInterval(previewPlaybackInterval);
        previewPlaybackInterval = null;
    }
}
