// Holds the current song information
let LYPLUS_currentSong = {};

// Initialize when the script is loaded
(function() {
    console.log('LYPLUS: DOM script injected successfully');
    LYPLUS_setupMutationObserver();
    LYPLUS_setupBlurEffect();
})();

// Initialize the observer to watch for changes in the player state
function LYPLUS_setupMutationObserver() {
    // We'll still keep the DOM observer as a fallback
    const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const subtitleElement = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');

    if (titleElement || subtitleElement) {
        const observer = new MutationObserver(LYPLUS_handleMutations);
        const observerOptions = { characterData: true, childList: true, subtree: true };

        if (titleElement) {
            observer.observe(titleElement, observerOptions);
        }

        if (subtitleElement) {
            observer.observe(subtitleElement, observerOptions);
        }
    }
  
    // Also check for song changes periodically using the player API
    setInterval(LYPLUS_checkForSongChange, 2000);
}

// Callback for MutationObserver: checks if mutations affect the song title or subtitle
function LYPLUS_handleMutations(mutations) {
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
        LYPLUS_debounceCheckForSongChange();
    }
}

// Debounce timer to prevent rapid consecutive calls
let LYPLUS_debounceTimer = null;
function LYPLUS_debounceCheckForSongChange() {
    clearTimeout(LYPLUS_debounceTimer);
    LYPLUS_debounceTimer = setTimeout(() => {
        LYPLUS_checkForSongChange();
    }, 500); // Adjust delay as needed
}

// Get player instance using the new method
function LYPLUS_getPlayer() {
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

// Checks for song changes and sends a message to the extension if needed
function LYPLUS_checkForSongChange() {
    const newSongInfo = LYPLUS_getSongInfo();
    if (!newSongInfo) return;

    // Do nothing if title or artist is an empty string
    if (!newSongInfo.title.trim() || !newSongInfo.artist.trim()) {
        console.log('LYPLUS: Missing title or artist, skipping notification.');
        return;
    }

    // Notify extension only if the song title or artist has changed
    if (newSongInfo.title !== LYPLUS_currentSong.title || newSongInfo.artist !== LYPLUS_currentSong.artist || newSongInfo.duration !== LYPLUS_currentSong.duration || newSongInfo.videoId !== LYPLUS_currentSong.videoId) {
        LYPLUS_currentSong = newSongInfo;
        
        // Update blur background when song changes
        LYPLUS_updateBlurBackground();
        
        // Send message to the extension script
        window.postMessage({
            type: 'LYPLUS_SONG_CHANGED',
            songInfo: LYPLUS_currentSong
        }, '*');
    }
}

// Extracts song information using both the player API and DOM fallbacks
function LYPLUS_getSongInfo() {
    // Try to get data using the player API first
    const player = LYPLUS_getPlayer();
  
    if (player) {
        try {
            // Wait until the video is fully loaded: check if getDuration exists and returns a nonzero value
            if (!player.getDuration || typeof player.getDuration !== 'function' || player.getDuration() === 0) {
                console.log('LYPLUS: Duration not available yet, waiting for video to load.');
                return null;
            }
      
            const videoData = player.getVideoData();
            if (!videoData || !videoData.title || !videoData.author) {
                return null;
            }
      
            const { video_id, title, author } = videoData;
            // Only get subtitle if the method is available
            let audioTrackData = null;
            if (player.getAudioTrack && typeof player.getAudioTrack === 'function') {
                audioTrackData = player.getAudioTrack();
            }
            //author uses Localized style, so let's use LYPLUS_getArtistFromDOM
            let artistCurrent = LYPLUS_getArtistFromDOM() != "" ? LYPLUS_getArtistFromDOM() : author || author
      
            const duration = player.getDuration();
      
            return {
                title: title,
                artist: artistCurrent,
                album: LYPLUS_getAlbumFromDOM(), // Still get album from DOM as it's not in API
                duration: duration,
                videoId: video_id,
                isVideo: LYPLUS_getAlbumFromDOM() == "",
                subtitle: audioTrackData // Store subtitle info if available
            };
        } catch (error) {
            // Continue to fallback method if an error occurs
            console.error('LYPLUS: Error retrieving song info from player API', error);
        }
    }
  
    // Fallback to the original DOM method if player API failed
    return LYPLUS_getDOMSongInfo();
}

function LYPLUS_getAlbumFromDOM() {
    const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!byline) return "";
  
    // Find all <a> elements in the byline
    const links = byline.querySelectorAll('a');
  
    // Iterate over them: if any link's href starts with "browse/", that's our album
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith("browse/")) {
            return link.textContent.trim();
        }
    }
  
    return "";
}

function LYPLUS_getArtistFromDOM() {
    const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!byline) return "";

    let artists = [];
  
    // Look at all <a> elements within the byline
    const links = byline.querySelectorAll('a');
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href) {
            if (href.startsWith("channel/")) {
                // These are artist links
                artists.push(link.textContent.trim());
            } else if (href.startsWith("browse/")) {
                // This one is the album
                album = link.textContent.trim();
            }
        }
    }

    // Properly format the artist names
    let artist = "";
    if (artists.length === 1) {
        artist = artists[0];
    } else if (artists.length === 2) {
        artist = artists.join(" & ");
    } else if (artists.length > 2) {
        artist = artists.slice(0, -1).join(", ") + ", & " + artists[artists.length - 1];
    }
  
    return artist;
}

function LYPLUS_getDOMSongInfo() {
    const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    const videoElement = document.querySelector('video');
    const playerBar = document.querySelector('ytmusic-player-bar');

    if (!titleElement || !byline || !videoElement) return null;

    // If the video duration is still 0, then the video may not be loaded fully yet
    if (!videoElement.duration || videoElement.duration === 0) {
        console.log('LYPLUS: Video element duration not available yet.');
        return null;
    }

    // Initialize arrays for artists and album variable
    let artists = [];
    let album = "";

    // Look at all <a> elements within the byline
    const links = byline.querySelectorAll('a');
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href) {
            if (href.startsWith("channel/")) {
                // These are artist links
                artists.push(link.textContent.trim());
            } else if (href.startsWith("browse/")) {
                // This one is the album
                album = link.textContent.trim();
            }
        }
    }

    // Properly format the artist names
    let artist = "";
    if (artists.length === 1) {
        artist = artists[0];
    } else if (artists.length === 2) {
        artist = artists.join(" & ");
    } else if (artists.length > 2) {
        artist = artists.slice(0, -1).join(", ") + ", & " + artists[artists.length - 1];
    }

    // In video pages, album info is absent (view count is in spans)
    const isVideo = album === "";

    // Extract videoId from URL parameters or from playerBar attribute
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

function LYPLUS_setupBlurEffect() {
    // Remove existing container if present
    const existingContainer = document.querySelector('.lyplus-blur-container');
    if (existingContainer) {
        existingContainer.remove();
    }

    // Create new containers
    const blurContainer = document.createElement('div');
    blurContainer.classList.add('lyplus-blur-container');

    const blurBackground = document.createElement('div');
    blurBackground.classList.add('lyplus-blur-background');

    const gradientOverlay = document.createElement('div');
    gradientOverlay.classList.add('lyplus-gradient-overlay');

    blurContainer.appendChild(blurBackground);
    blurContainer.appendChild(gradientOverlay);
    document.querySelector('#layout').prepend(blurContainer);

    return blurBackground;
}

// Update blur background with album art
function LYPLUS_updateBlurBackground() {
    const artworkElement = document.querySelector('#song-image>#thumbnail>#img');
    if (!artworkElement) return;

    const blurBackground = document.querySelector('.lyplus-blur-background');
    if (!blurBackground) return;

    const artworkUrl = artworkElement.src;
    if (artworkUrl) {
        blurBackground.style.backgroundImage = `url(${artworkUrl})`;
    }
}