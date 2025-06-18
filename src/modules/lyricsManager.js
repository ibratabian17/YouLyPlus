// lyricsManager.js
let currentFetchVideoId = null;

async function fetchAndDisplayLyrics(currentSong) {
  try {
    // Set the latest videoId being processed
    currentFetchVideoId = currentSong.videoId;

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
        videoId: currentSong.videoId,
        subtitle: currentSong.subtitle,
        duration: currentSong.duration,
      }
    });

    // If the videoId changed while fetching, abort displaying lyrics
    if (currentFetchVideoId !== currentSong.videoId) {
      console.warn("Song changed while fetching lyrics. Aborting display.", currentSong);
      return;
    }

    if (!response.success) {
      console.warn('Failed to fetch lyrics:', response.error);
      displaySongNotFound();
      return;
    }

    let lyrics = response.lyrics;

    // If the fetched lyrics are of type "Word" (meaning they have syllabus data)
    // but the user prefers line-by-line display, convert them.
    if (lyrics.type === "Word" && !currentSettings.wordByWord) {
      lyrics = convertWordLyricsToLine(lyrics);
    }

    // If it's an MV, adjust timings using SponsorBlock
    if (currentSong.isVideo && currentSong.videoId && currentSettings.useSponsorBlock && !lyrics.ignoreSponsorblock) {
      const segments = await fetchSponsorSegments(currentSong.videoId);
      // Adjust timing based on whether the lyrics are line-based or word-based (with syllabus)
      lyrics.data = adjustLyricTiming(lyrics.data, segments, lyrics.type === "Line" ? "s" : "s"); // V2 times are always in seconds
    }

    // Ensure the videoId is still the same before displaying lyrics
    if (currentFetchVideoId !== currentSong.videoId) {
      console.warn("Song changed while fetching lyrics. Aborting display.", currentSong);
      return;
    }

    displayLyrics(
      lyrics,
      lyrics.metadata.source,
      lyrics.type === "Line" ? "Line" : "Word",
      currentSettings.lightweight,
      lyrics.metadata.songWriters,
      currentSong // Pass the songInfo here
    );
  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    
    // Ensure the videoId is still the same before displaying error message
    if (currentFetchVideoId === currentSong.videoId) {
      displaySongError();
    }
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
