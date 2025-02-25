// Use a variable to store the requestAnimationFrame ID
let lyricsAnimationFrameId = null;
let rescroll = false;
let currentPrimaryActiveLine = null;
let lastTime = 0;

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

  const isRTL = text => /[֑-߿יִ-﷽ﹰ-ﻼ]/.test(text);

  // ---------------------------
  // Helper to create a gap line with three dots.
  const GAP_THRESHOLD = 7; // seconds
  function createGapLine(gapStart, gapEnd) {
    const gapDuration = gapEnd - gapStart;
    const gapLine = document.createElement('div');
    gapLine.classList.add('lyrics-line');
    gapLine.dataset.startTime = gapStart;
    gapLine.dataset.endTime = gapEnd;
    gapLine.addEventListener('click', onLyricClick);

    // In syllable mode, create a container and add three syllable spans.
    const mainContainer = document.createElement('div');
    mainContainer.classList.add('main-vocal-container');
    gapLine.appendChild(mainContainer);
    for (let i = 0; i < 3; i++) {
      const syllableSpan = document.createElement('span');
      syllableSpan.classList.add('lyrics-syllable');
      // Distribute the gap evenly among the three dots.
      const syllableStart = (gapStart + (i * gapDuration / 3)) * 1000;
      const syllableDuration = (gapDuration / 3) * 1000;
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

      const applyGlow =
        !lightweight &&
        !isRTL(combinedText) &&
        trimmedText.length <= 7 &&
        avgDuration >= requiredThreshold &&
        firstSyllableDuration >= firstSyllableRequiredThreshold;

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
          sylSpan.textContent = s.text.replace('(', '').replace(')', '');
        }

        if (s.element.isBackground) {
          if (!backgroundContainer) {
            backgroundContainer = document.createElement('div');
            backgroundContainer.classList.add('background-vocal-container');
            currentLine.appendChild(backgroundContainer);
          }
          if (isRTL(s.text)) {
            sylSpan.classList.add('rtl-text');
            backgroundContainer.prepend(sylSpan);
          } else {
            backgroundContainer.appendChild(sylSpan);
          }
        } else {
          if (isRTL(s.text)) {
            sylSpan.classList.add('rtl-text');
            mainContainer.prepend(sylSpan);
          } else {
            mainContainer.appendChild(sylSpan);
          }
        }
      });
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
      lineDiv.textContent = line.text;
      lineDiv.dataset.startTime = line.startTime;
      lineDiv.dataset.endTime = line.endTime;
      lineDiv.classList.add('lyrics-line');
      lineDiv.classList.add(line.element.singer === "v2" ? 'singer-right' : 'singer-left');
      if (isRTL(line.text)) lineDiv.classList.add('rtl-text');
      lineDiv.addEventListener('click', onLyricClick);
      lyricsContainer.appendChild(lineDiv);
    });
  }

  // --- Insert gap lines for long intervals between original lyric lines ---
  const originalLines = Array.from(lyricsContainer.querySelectorAll('.lyrics-line:not(.lyrics-gap)'));
  originalLines.forEach((line, index) => {
    if (index < originalLines.length - 1) {
      const nextLine = originalLines[index + 1];
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextStart = parseFloat(nextLine.dataset.startTime);
      if (nextStart - currentEnd >= GAP_THRESHOLD) {
        const gapLine = createGapLine(currentEnd + 0.5, nextStart - 0.5);
        gapLine.classList.add('lyrics-gap');
        lyricsContainer.insertBefore(gapLine, nextLine);
      }
    }
  });

  originalLines.forEach((line, idx) => {
    if (idx < originalLines.length - 1) {
      const currentEnd = parseFloat(line.dataset.endTime);
      const nextLine = originalLines[idx + 1];
      const nextStart = parseFloat(nextLine.dataset.startTime);
      const gap = nextStart - currentEnd;
      if (gap > 0) {
        const extension = Math.min(0.5, gap);
        line.dataset.endTime = (currentEnd + extension).toFixed(3);
      }
    }
  });
  // -------------------------------------------------------------------------

  if (songWriters) {
    const songWritersDiv = document.createElement('span');
    songWritersDiv.classList.add('lyrics-song-writters');
    songWritersDiv.innerText = `${t("writtenBy")} ${songWriters}`;
    lyricsContainer.appendChild(songWritersDiv);
  }

  const sourceDiv = document.createElement('span');
  sourceDiv.classList.add('lyrics-source-provider');
  sourceDiv.innerText = `${t("source")} ${source}`;
  lyricsContainer.appendChild(sourceDiv);

  // Cache lyrics lines and syllables for performance in the sync loop
  window.cachedLyricsLines = Array.from(lyricsContainer.getElementsByClassName('lyrics-line'));
  window.cachedSyllables = Array.from(lyricsContainer.getElementsByClassName('lyrics-syllable'));
  currentPrimaryActiveLine = null;

  startLyricsSync();
}


function displaySongNotFound() {
  let lyricsContainer = document.getElementById('lyrics-plus-container');
  if (lyricsContainer) {
    lyricsContainer.innerHTML = `<span class="text-not-found">${t("notFound")}</span>`
  }
}

function displaySongError() {
  let lyricsContainer = document.getElementById('lyrics-plus-container');
  if (lyricsContainer) {
    lyricsContainer.innerHTML = `<span class="text-not-found">${t("notFoundError")}</span>`
  }
}


function createLyricsContainer() {
  // Cari elemen lyrics section yang asli
  const originalLyricsSection = document.querySelector('#tab-renderer');
  if (!originalLyricsSection) {
    console.log('Lyrics section not found');
    return null;
  }

  // Buat container baru
  const container = document.createElement('div');
  container.id = 'lyrics-plus-container';
  container.classList.add('lyrics-plus-integrated');

  originalLyricsSection.appendChild(container);
  injectCssFile()

  return container;
}

function injectCssFile() {
  // Create a new <link> element
  const linkElement = document.createElement('link');
  linkElement.rel = 'stylesheet';
  linkElement.type = 'text/css';
  // Replace 'css/your-styles.css' with the path to your CSS file relative to your extension's root
  linkElement.href = chrome.runtime.getURL('src/inject/stylesheet.css');

  // Append the <link> element to the document head
  document.head.appendChild(linkElement);
}

function startLyricsSync() {
  const videoElement = document.querySelector('video');
  if (!videoElement) return;

  function sync() {
    const currentTime = videoElement.currentTime * 1000;
    const gap = currentTime - lastTime
    // Convert currentTime to milliseconds once per frame.
    updateLyricsHighlight(currentTime, Math.abs(gap) > 5000);
    lastTime = currentTime
    lyricsAnimationFrameId = requestAnimationFrame(sync);
  }
  lyricsAnimationFrameId = requestAnimationFrame(sync);
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
}

function updateLyricsHighlight(currentTime, isForceScroll =false) {
  const lines =
    window.cachedLyricsLines || Array.from(document.getElementsByClassName('lyrics-line'));
  let activeLines = [];

  // Kumpulkan baris yang seharusnya aktif berdasarkan currentTime
  lines.forEach(line => {
    const lineStart = parseFloat(line.dataset.startTime) * 1000;
    const lineEnd = parseFloat(line.dataset.endTime) * 1000;
    if (currentTime >= lineStart - 150 && currentTime <= lineEnd) {
      activeLines.push(line);
    }
  });

  // Urutkan baris aktif dari yang paling baru (startTime terbesar)
  activeLines.sort((a, b) => parseFloat(b.dataset.startTime) - parseFloat(a.dataset.startTime));

  // Hanya simpan 2 baris paling baru sebagai active
  const allowedActive = activeLines.slice(0, 2);

  lines.forEach(line => {
    if (allowedActive.includes(line)) {
      if (!line.classList.contains('active')) {
        line.classList.add('active');
        scrollActiveLine(currentTime, isForceScroll);
      }
    } else {
      line.classList.remove('active');
      resetSyllables(line);
    }
  });

  // Update animasi tiap suku kata
  const syllables =
    window.cachedSyllables || Array.from(document.getElementsByClassName('lyrics-syllable'));
  syllables.forEach(syllable => updateSyllableAnimation(syllable, currentTime));
}


function scrollActiveLine(currentTime, forceScroll = false) {
  const activeLines = Array.from(document.querySelectorAll('.lyrics-line.active'));
  if (!activeLines.length) return;

  let lineToScroll = activeLines[0];
  const firstLineEnd = parseFloat(lineToScroll.dataset.endTime) * 1000;
  if (firstLineEnd - currentTime <= 200 && activeLines[1]) {
    lineToScroll = activeLines[1];
  }
  scrollToActiveLine(lineToScroll, forceScroll);
}

function resetSyllables(line) {
  const syllables = Array.from(line.getElementsByClassName('lyrics-syllable'));
  syllables.forEach(syllable => {
    syllable.style.animation = '';
    syllable.classList.remove('highlight');
    Array.from(syllable.querySelectorAll('span.char')).forEach(span => {
      span.style.animation = '';
    });
  });
}

function updateSyllableAnimation(syllable, currentTime) {
  // Use Number() to convert dataset values to numbers for faster math
  const startTime = Number(syllable.dataset.startTime);
  const duration = Number(syllable.dataset.duration);
  const endTime = startTime + duration;
  let wipeAnimation = syllable.classList.contains('rtl-text') ? 'wipe-rtl' : 'wipe';

  if (currentTime >= startTime && currentTime <= endTime) {
    if (!syllable.classList.contains('highlight')) {
      const charSpans = syllable.querySelectorAll('span.char');
      const wordDuration = Number(syllable.dataset.wordDuration) || duration;
      if (charSpans.length) {
        const charCount = charSpans.length;
        const wipeDur = duration / charCount;
        for (let index = 0; index < charCount; index++) {
          const span = charSpans[index];
          const wipeDelay = wipeDur * index;
          const growDelay = wordDuration > 1000 ? 200 * index : (wordDuration / charCount) * index;
          const growDur = wordDuration * 1.3;
          span.style.animation = `${wipeAnimation} ${wipeDur}ms linear ${wipeDelay}ms forwards, grow-static ${growDur}ms ease-in-out ${growDelay}ms`;
        }
      } else {
        if (syllable.parentElement.parentElement.classList.contains('lyrics-gap')) {
          wipeAnimation = "fade-gap";
        }
        syllable.style.animation = `${wipeAnimation} ${duration}ms linear forwards`;
      }
      syllable.classList.add('highlight');
    }
  } else if (currentTime <= endTime) {
    const charSpans = syllable.querySelectorAll('span.char');
    charSpans.forEach(span => {
      span.style.animation = '';
    });
    syllable.classList.remove('highlight');
    syllable.style.animation = '';
  }
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
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  
  // Get the bounding rectangle of the active line
  const lineRect = activeLine.getBoundingClientRect();
  
  // Define the safe area based on the visible scroll container.
  // Here, we set the safe area as the middle 50% of the scroll container's height.
  const safeAreaTop = scrollContainerRect.top + scrollContainerRect.height * 0.25;
  const safeAreaBottom = scrollContainerRect.top + scrollContainerRect.height * 0.65;
  
  // If the top of the active line is outside the safe area, no scroll is needed.
  if ((lineRect.top < safeAreaTop || lineRect.top > safeAreaBottom)) {
    if(!forceScroll)return;
  }
  
  // Calculate the active line's position relative to the lyrics container
  const containerRect = container.getBoundingClientRect();
  const relativePosition = lineRect.top - containerRect.top;
  const offset = container.clientHeight / 4; // Offset remains the same as before
  
  // Scroll the scroll container to the target position
  scrollContainer.scrollTo({
    top: container.scrollTop + relativePosition - offset,
    behavior: 'smooth'
  });
}
