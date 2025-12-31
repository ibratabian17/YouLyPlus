// inject/ytmusic/songTracker.js

(function () {
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
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.type !== 'LYPLUS_SEEK_TO') return;

            const player = getPlayer();
            if (player && typeof event.data.time === 'number') {
                player.seekTo(event.data.time, true);
            }
        });
    }

    function startTimeUpdater() {
        stopTimeUpdater();

        function loop() {
            const player = getPlayer();
            try {
                const currentTime = player.getCurrentTime() + 0.11;
                window.postMessage({
                    type: 'LYPLUS_TIME_UPDATE',
                    currentTime: currentTime
                }, '*');
                lastSentTime = currentTime;
            } catch (e) {
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

        // Get all links inside the subtitle
        const allLinks = Array.from(bylineEl.querySelectorAll('a'));

        let artistNames = [];
        let albumName = "";

        // Iterate through links to categorize them
        allLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // CHECK FOR ARTIST:
            // 1. "channel/" (Standard artists)
            // 2. "browse/UC" (Standard artists with ID)
            // 3. "artist_detail" (User Uploaded Audio)
            const isArtist = href.includes('channel/') ||
                href.includes('browse/UC') ||
                href.includes('artist_detail');

            if (isArtist) {
                artistNames.push(link.textContent.trim());
            } else {
                // If it is a link, but NOT an artist, it is the Album/Release
                if (!albumName) {
                    albumName = link.textContent.trim();
                }
            }
        });

        // 1. Finalize Artist
        let artist = "";
        if (artistNames.length > 0) {
            artist = artistNames.join(", "); // Handle multiple artists
        } else {
            // Fallback: If absolutely no links exist, split text by bullet
            artist = bylineText.split('•')[0]?.trim() || "";
        }

        // 2. Finalize Album
        let album = albumName;

        return { title, artist, album, isVideo: album === "" };
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

        if (!duration || duration === 0) {
            setTimeout(checkForSongChange, 250);
            return;
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