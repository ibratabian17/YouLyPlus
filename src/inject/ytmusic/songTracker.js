// inject/songTracker.js

// Holds the current song information
let LYPLUS_currentSong = {};
let LYPLUS_timeUpdateInterval = null;

// Initialize when the script is loaded
(function() {
    console.log('LYPLUS: DOM script injected successfully');
    LYPLUS_setupMutationObserver();
    LYPLUS_setupSeekListener();
})();

// Initialize the observer to watch for changes in the player state
function LYPLUS_setupMutationObserver() {
    const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const subtitleElement = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');

    if (titleElement || subtitleElement) {
        const observer = new MutationObserver(LYPLUS_handleMutations);
        const observerOptions = { characterData: true, childList: true, subtree: true };

        if (titleElement) observer.observe(titleElement, observerOptions);
        if (subtitleElement) observer.observe(subtitleElement, observerOptions);
    }

    setInterval(LYPLUS_checkForSongChange, 2000);
}

function LYPLUS_setupSeekListener() {
    window.addEventListener('LYPLUS_SEEK_TO', (event) => {
        const player = LYPLUS_getPlayer();
        if (player && event.detail && typeof event.detail.time === 'number') {
            player.seekTo(event.detail.time, true);
        }
    });
}

function stopTimeUpdater() {
    clearInterval(LYPLUS_timeUpdateInterval);
    LYPLUS_timeUpdateInterval = null;
}

function startTimeUpdater() {
    stopTimeUpdater();

    LYPLUS_timeUpdateInterval = setInterval(() => {
        const player = LYPLUS_getPlayer();
        if (player) {
            try {
                const currentTime = player.getCurrentTime();
                window.postMessage({ type: 'LYPLUS_TIME_UPDATE', currentTime: currentTime }, '*');
            } catch (e) {
                console.error("LYPLUS: Error getting current time.", e);
                stopTimeUpdater();
            }
        }
    }, 16); //60FPS timing
}

// Callback for MutationObserver
function LYPLUS_handleMutations(mutations) {
    let songChanged = false;
    mutations.forEach((mutation) => {
        if (mutation.target.nodeType === Node.TEXT_NODE) {
            const parent = mutation.target.parentNode;
            if (parent && (parent.classList.contains('title') || parent.classList.contains('subtitle'))) {
                songChanged = true;
            }
        } else if (mutation.target.classList && (mutation.target.classList.contains('title') || mutation.target.classList.contains('subtitle'))) {
            songChanged = true;
        }
    });

    if (songChanged) {
        LYPLUS_debounceCheckForSongChange();
    }
}

let LYPLUS_debounceTimer = null;
function LYPLUS_debounceCheckForSongChange() {
    clearTimeout(LYPLUS_debounceTimer);
    LYPLUS_debounceTimer = setTimeout(LYPLUS_checkForSongChange, 500);
}

function LYPLUS_getPlayer() {
    let player = document.getElementById("movie_player");
    if (!player) {
        player = document.querySelector('ytmusic-player');
        if (player && !player.getCurrentTime) {
            if (player.playerApi) player = player.playerApi;
            else if (window.ytmusic && ytmusic.player) player = ytmusic.player;
        }
    }
    return player;
}

function LYPLUS_checkForSongChange() {
    const newSongInfo = LYPLUS_getSongInfo();
    if (!newSongInfo || !newSongInfo.title.trim() || !newSongInfo.artist.trim()) {
        return;
    }

    const hasChanged = (newSongInfo.title !== LYPLUS_currentSong.title || 
                       newSongInfo.artist !== LYPLUS_currentSong.artist || 
                       Math.round(newSongInfo.duration) !== Math.round(LYPLUS_currentSong.duration)) && 
                       newSongInfo.videoId !== LYPLUS_currentSong.videoId;

    if (hasChanged) {
        LYPLUS_currentSong = newSongInfo;
        
        // Start sending high-frequency time updates for the new song
        startTimeUpdater();
        
        window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: LYPLUS_currentSong }, '*');
        window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
    }
}

function LYPLUS_getSongInfo() {
    const player = LYPLUS_getPlayer();
    if (player) {
        try {
            if (!player.getDuration || typeof player.getDuration !== 'function' || player.getDuration() === 0) {
                return null;
            }
            const videoData = player.getVideoData();
            if (!videoData || !videoData.title || !videoData.author) {
                return null;
            }
            const { video_id, title, author } = videoData;
            let audioTrackData = null;
            if (player.getAudioTrack && typeof player.getAudioTrack === 'function') {
                audioTrackData = player.getAudioTrack();
            }
            const artistCurrent = LYPLUS_getArtistFromDOM() || author;
            return {
                title: title,
                artist: artistCurrent,
                album: LYPLUS_getAlbumFromDOM(),
                duration: player.getDuration(),
                videoId: video_id,
                isVideo: LYPLUS_getAlbumFromDOM() === "",
                subtitle: audioTrackData
            };
        } catch (error) {
            console.error('LYPLUS: Error retrieving song info from player API', error);
        }
    }
    return LYPLUS_getDOMSongInfo();
}

function LYPLUS_getAlbumFromDOM() {
    const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!byline) return "";
    const links = byline.querySelectorAll('a');
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
    const links = byline.querySelectorAll('a');
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith("channel/")) {
            artists.push(link.textContent.trim());
        }
    }
    if (artists.length === 0) return "";
    if (artists.length === 1) return artists[0];
    if (artists.length === 2) return artists.join(" & ");
    return artists.slice(0, -1).join(", ") + ", & " + artists[artists.length - 1];
}

function LYPLUS_getDOMSongInfo() {
    const titleElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const byline = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    const videoElement = document.querySelector('video');
    const playerBar = document.querySelector('ytmusic-player-bar');

    if (!titleElement || !byline || !videoElement || !videoElement.duration) {
        return null;
    }
    
    const artist = LYPLUS_getArtistFromDOM();
    const album = LYPLUS_getAlbumFromDOM();
    let videoId = new URLSearchParams(window.location.search).get('v') || playerBar?.getAttribute('video-id') || "";

    return {
        title: titleElement.textContent.trim(),
        artist,
        album,
        duration: videoElement.duration,
        isVideo: album === "",
        videoId
    };
}