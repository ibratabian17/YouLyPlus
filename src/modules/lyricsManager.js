// lyricsManager.js

async function fetchAndDisplayLyrics() {
  try {
    // Remove any existing lyrics from the UI
    cleanupLyrics();

    // Request lyrics from the background service worker
    const response = await pBrowser.runtime.sendMessage({
      type: 'FETCH_LYRICS',
      songInfo: {
        title: currentSong.title,
        artist: currentSong.artist,
        album: currentSong.album,
        isVideo: currentSong.isVideo,
        videoId: currentSong.videoId
      }
    });

    if (!response.success) {
      console.warn('Failed to fetch lyrics:', response.error);
      displaySongNotFound();
      return;
    }

    let lyrics = response.lyrics;

    // Convert word-by-word lyrics to line if needed
    if (!currentSettings.wordByWord && lyrics.type !== "Line") {
      lyrics = convertWordLyricsToLine(lyrics);
    }

    // If it's an MV, adjust timings using SponsorBlock
    if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock) {
      const segments = await fetchSponsorSegments(currentSong.videoId);
      lyrics.data = adjustLyricTiming(lyrics.data, segments, lyrics.type === "Line" ? "s" : "ms");
    }

    displayLyrics(
      lyrics,
      lyrics.metadata.source,
      lyrics.type === "Line" ? "Line" : "Word",
      currentSettings.lightweight,
      lyrics.metadata.songWriters
    );
  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    displaySongError();
  }
}

function convertWordLyricsToLine(lyrics) {
  if (lyrics.type === "Line") return lyrics; // Already line-based

  const words = lyrics.data;
  const lines = [];
  let currentLineWords = [];
  let lineStartTime = null;
  let lineEndTime = null;
  let element = {}

  words.forEach((word, index) => {
      if (currentLineWords.length === 0) {
          // Start a new line.
          lineStartTime = word.startTime;
      }
      currentLineWords.push(word.text);
      // Update end time for the current line.
      lineEndTime = word.endTime;

      //element
      element = word.element || {}
      element.isBackground = false

      // If this word marks the end of a line or it's the last word, form a line.
      if (word.isLineEnding || index === words.length - 1) {
          const lineText = currentLineWords.join('');
          lines.push({
              text: lineText,
              startTime: lineStartTime / 1000,
              endTime: lineEndTime / 1000,
              element: element
          });
          // Reset for the next line.
          currentLineWords = [];
          lineStartTime = null;
          lineEndTime = null;
      }
  });

  return {
      type: "Line",
      data: lines,
      metadata: lyrics.metadata
  };
}