// Initialize the observer to watch for changes in the song title and subtitle elements.
function setupMutationObserver() {
  const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
  const subtitleElement = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');

  // Exit early if neither element is found.
  if (!titleElement && !subtitleElement) return;

  const observer = new MutationObserver(handleMutations);
  const observerOptions = { characterData: true, childList: true, subtree: true };

  if (titleElement) {
    observer.observe(titleElement, observerOptions);
  }

  if (subtitleElement) {
    observer.observe(subtitleElement, observerOptions);
  }
}

// Callback for MutationObserver: checks if mutations affect the song title or subtitle.
function handleMutations(mutations) {
  let songChanged = false;

  mutations.forEach((mutation) => {
    if (mutation.target.nodeType === Node.TEXT_NODE) {
      const parent = mutation.target.parentNode;
      if (parent && (parent.classList.contains('title') || parent.classList.contains('subtitle'))) {
        songChanged = true;
      }
    } else if (mutation.target.classList) {
      if (mutation.target.classList.contains('title') || mutation.target.classList.contains('subtitle')) {
        songChanged = true;
      }
    }
  });

  if (songChanged) {
    debounceCheckForSongChange();
  }
}

// Debounce timer to prevent rapid consecutive calls.
let debounceTimer = null;
function debounceCheckForSongChange() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    checkForSongChange();
  }, 500); // Adjust delay as needed.
}

// Holds the current song information.
let currentSong = {};

// Checks for song changes and triggers lyric fetching if needed.
async function checkForSongChange() {
  const newSongInfo = getSongInfo();
  if (!newSongInfo) return;

  // Do nothing if title or artist is an empty string.
  if (!newSongInfo.title.trim() || !newSongInfo.artist.trim()) {
    console.log('Missing title or artist, skipping lyrics fetch.');
    return;
  }

  // Trigger lyric fetching only if the song title or artist has changed.
  if (newSongInfo.title !== currentSong.title || newSongInfo.artist !== currentSong.artist) {
    currentSong = newSongInfo;
    console.log('New song detected:', currentSong);
    await fetchAndDisplayLyrics(); // Ensure this function is defined elsewhere.
  }
}

// Extracts song information from the DOM.
function getSongInfo() {
  const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
  const artistElement = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');
  const videoElement = document.querySelector('video');
  const playerBar = document.querySelector('ytmusic-player-bar'); // May contain extra attributes

  if (!titleElement || !artistElement || !videoElement) return null;

  let artist = "";
  let album = "";
  let isVideo = false;
  let videoId = "";

  // Try to extract artist and album using anchor tags.
  const artistLinks = artistElement.querySelectorAll('a');
  if (artistLinks.length > 0) {
    artist = artistLinks[0].textContent.trim();
    if (artistLinks.length > 1) {
      album = artistLinks[1].textContent.trim();
    } else {
      // With only one link, it might be an MV.
      isVideo = true;
    }
  } else {
    // Fallback: split the subtitle text by '•'
    const artistAlbumText = artistElement.textContent.split('•').map(text => text.trim());
    artist = artistAlbumText[0] || "";
  }

  // Primary: Attempt to extract videoId from the URL query parameter.
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('v')) {
    videoId = urlParams.get('v');
  }

  // Fallback: Try to get it from the player bar attribute.
  if (!videoId && playerBar && playerBar.hasAttribute('video-id')) {
    videoId = playerBar.getAttribute('video-id');
  }

  return {
    title: titleElement.textContent.trim(),
    artist,
    album,
    duration: videoElement.duration || 0,
    isVideo,
    videoId
  };
}



// Start observing for changes.
setupMutationObserver();
