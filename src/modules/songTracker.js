// Initialize the observer to watch for changes in the player state.
function setupMutationObserver() {
  // We'll still keep the DOM observer as a fallback
  const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
  const subtitleElement = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');

  if (titleElement || subtitleElement) {
    const observer = new MutationObserver(handleMutations);
    const observerOptions = { characterData: true, childList: true, subtree: true };

    if (titleElement) {
      observer.observe(titleElement, observerOptions);
    }

    if (subtitleElement) {
      observer.observe(subtitleElement, observerOptions);
    }
  }
  
  // Also check for song changes periodically using the player API
  setInterval(checkForSongChange, 1000);
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

// Get player instance using the new method
function getPlayer() {
  // First try the standard YouTube player
  let player = document.getElementById("movie_player");
  
  // If not found, try the YouTube Music player (which might have a different ID)
  if (!player) {
    // YouTube Music might use a different player implementation
    player = document.querySelector('ytmusic-player');
    
    // If ytmusic-player exists but doesn't have the API methods,
    // try to access the underlying player object
    if (player && !player.getCurrentTime) {
      if (player.playerApi) {
        player = player.playerApi;
      } else if (window.ytmusic && ytmusic.player) {
        player = ytmusic.player;
      }
    }
  }
  
  return player;
}

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

// Extracts song information using both the player API and DOM fallbacks.
function getSongInfo() {
  // Try to get data using the player API first
  const player = getPlayer();
  
  if (player && typeof player.getVideoData === 'function') {
    try {
      // Get basic data from player API
      const currentTime = player.getCurrentTime?.() || 0;
      const { video_id, title, author } = player.getVideoData?.() || {};
      const audioTrackData = player.getAudioTrack?.() || {}; // For subtitles
      const duration = player.getDuration?.() || 0;
      
      // Try to get playing state
      let isPlaying = false;
      if (typeof player.getPlayerState === 'function') {
        isPlaying = player.getPlayerState() === 1; // 1 means playing
      } else if (typeof player.getPlayerStateObject === 'function') {
        const { isPlaying: playerIsPlaying } = player.getPlayerStateObject() || {};
        isPlaying = playerIsPlaying;
      }
      
      // If we got valid data from the player API, use it
      if (title && author) {
        console.log('Song info retrieved via player API');
        return {
          title: title,
          artist: author,
          album: getAlbumFromDOM(), // Still get album from DOM as it's not in API
          duration: duration,
          videoId: video_id,
          subtitle: audioTrackData // Store subtitle info if available
        };
      }
    } catch (error) {
      console.error('Error getting data from player API:', error);
      // Continue to fallback method
    }
  }
  
  // Fallback to the original DOM method if player API failed
  return getDOMSongInfo();
}

function getAlbumFromDOM() {
  const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
  if (!byline) return "";
  
  // Find all <a> elements in the byline.
  const links = byline.querySelectorAll('a');
  
  // Iterate over them: if any link’s href starts with "browse/", that’s our album.
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith("browse/")) {
      return link.textContent.trim();
    }
  }
  
  return "";
}

function getDOMSongInfo() {
  const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
  const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
  const videoElement = document.querySelector('video');
  const playerBar = document.querySelector('ytmusic-player-bar');

  if (!titleElement || !byline || !videoElement) return null;

  // Initialize arrays for artists and album variable.
  let artists = [];
  let album = "";

  // Look at all <a> elements within the byline.
  const links = byline.querySelectorAll('a');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href) {
      if (href.startsWith("channel/")) {
        // These are artist links.
        artists.push(link.textContent.trim());
      } else if (href.startsWith("browse/")) {
        // This one is the album.
        album = link.textContent.trim();
      }
    }
  }
  
  // Combine multiple artist names if necessary.
  const artist = artists.join(" & ");
  
  // In video pages, album info is absent (view count is in spans).
  const isVideo = album === "";
  
  // Extract videoId from URL parameters or from playerBar attribute.
  let videoId = "";
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('v')) {
    videoId = urlParams.get('v');
  } else if (playerBar && playerBar.hasAttribute('video-id')) {
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




// Start observing for changes
setupMutationObserver();