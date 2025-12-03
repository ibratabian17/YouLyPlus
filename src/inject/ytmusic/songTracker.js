// inject/songTracker.js

(function() {
    let currentSong = {};
    let timeUpdateFrame = null;
    let debounceTimer = null;
    let playerInstance = null;

    console.log('LYPLUS: Tracker injected.');

    function init() {
        setupMutationObserver();
        setupSeekListener();
    }

    function getPlayer() {
        if (!playerInstance) {
            playerInstance = document.getElementById("movie_player");
        }
        return playerInstance;
    }

    // --- Observers & Listeners ---

    function setupMutationObserver() {
        const contentBar = document.querySelector('ytmusic-player-bar');
        
        if (contentBar) {
            const observer = new MutationObserver(handleMutations);
            observer.observe(contentBar, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
        } else {
            setTimeout(setupMutationObserver, 1000);
        }
    }

    function handleMutations() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkForSongChange, 500);
    }

    function setupSeekListener() {
        window.addEventListener('LYPLUS_SEEK_TO', (event) => {
            const player = getPlayer();
            if (player && event.detail && typeof event.detail.time === 'number') {
                player.seekTo(event.detail.time, true);
            }
        });
    }

    function startTimeUpdater() {
        stopTimeUpdater(); 
        
        let lastSentTime = 0;

        function loop() {
            const player = getPlayer();
            
            if (player && player.getCurrentTime) {
                try {
                    const currentTime = player.getCurrentTime();
                    
                    if (Math.abs(currentTime - lastSentTime) > 0.01) {
                        window.postMessage({ 
                            type: 'LYPLUS_TIME_UPDATE', 
                            currentTime: currentTime 
                        }, '*');
                        lastSentTime = currentTime;
                    }
                } catch (e) {
                }
            }
            
            timeUpdateFrame = requestAnimationFrame(loop);
        }
        
        timeUpdateFrame = requestAnimationFrame(loop);
    }

    function stopTimeUpdater() {
        if (timeUpdateFrame) {
            cancelAnimationFrame(timeUpdateFrame);
            timeUpdateFrame = null;
        }
    }

    // --- Metadata Extraction ---

    function getMetadataFromDOM() {
        const titleEl = document.querySelector('.title.style-scope.ytmusic-player-bar');
        const bylineEl = document.querySelector('.subtitle.style-scope.ytmusic-player-bar');
        
        if (!titleEl || !bylineEl) return null;

        const title = titleEl.textContent.trim();
        const bylineText = bylineEl.textContent.trim(); 
        
        // 1. Extract Artist
        let artist = "";
        const artistLinks = Array.from(bylineEl.querySelectorAll('a[href*="channel/"], a[href*="browse/UC"]'));
        
        if (artistLinks.length > 0) {
            artist = artistLinks.map(link => link.textContent.trim()).join(", ");
        } else {
            artist = bylineText.split('•')[0]?.trim() || "";
        }

        // 2. Extract Album
        let album = "";
        const albumLink = bylineEl.querySelector('a[href*="browse/MPREb"]');
        
        if (albumLink) {
            album = albumLink.textContent.trim();
        } else if (bylineText.includes('•')) {
            const parts = bylineText.split('•');
            // Standard format: Artist • Album • Year
            if (parts.length >= 2) {
                album = parts[1].trim();
            }
        }

        // Clean up common false positives for albums
        const isVideo = album === "Video" || /^\d{4}$/.test(album) || album.toLowerCase().includes("views");
        if (isVideo) album = "";

        return { title, artist, album, isVideo };
    }

    function checkForSongChange() {
        const player = getPlayer();
        const domInfo = getMetadataFromDOM();
        
        if (!player || !domInfo) return;

        let duration = 0;
        let videoId = "";
        
        if (player.getVideoData) {
            const data = player.getVideoData();
            videoId = data.video_id;
        }
        if (player.getDuration) {
            duration = player.getDuration();
        }

        if (!domInfo.title || !domInfo.artist) return;

        const hasChanged = videoId !== currentSong.videoId || 
                           domInfo.title !== currentSong.title;

        if (hasChanged) {
            currentSong = {
                title: domInfo.title,
                artist: domInfo.artist,
                album: domInfo.album,
                duration: duration,
                videoId: videoId,
                isVideo: domInfo.isVideo
            };

            startTimeUpdater();

            window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: currentSong }, '*');
            window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
        }
    }

    // Start
    init();

})();