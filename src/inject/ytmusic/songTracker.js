// inject/ytmusic/songTracker.js

(function () {
    let currentSong = {};
    let timeUpdateFrame = null;
    let debounceTimer = null;
    let playerInstance = null;

    const timeUpdateMsg = { type: 'LYPLUS_TIME_UPDATE', currentTime: 0 };
    let lastSentTime = -1;

    console.log('LYPLUS: Tracker injected.');

    function init() {
        setupMutationObserver();
        setupSeekListener();
    }

    function getPlayer() {
        if (playerInstance && playerInstance.isConnected) {
            return playerInstance;
        }
        playerInstance = document.getElementById("movie_player");
        return playerInstance;
    }

    // --- Observers & Listeners ---

    function setupMutationObserver() {
        const metadataContainer = document.querySelector('ytmusic-player-bar .content-info-wrapper')
            || document.querySelector('ytmusic-player-bar .left-controls');

        if (metadataContainer) {
            const observer = new MutationObserver(handleMutations);
            observer.observe(metadataContainer, {
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

            if (player) {
                try {
                    const state = player.getPlayerState();

                    if (state === 1) {
                        const rawTime = player.getCurrentTime();

                        if (Math.abs(rawTime - lastSentTime) > 0.001) {
                            timeUpdateMsg.currentTime = rawTime + 0.11;
                            window.postMessage(timeUpdateMsg, '*');
                            lastSentTime = rawTime;
                        }
                    }
                } catch (e) { }
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

    // --- DOM Metadata Extraction (Fallback) ---

    function getMetadataFromDOM() {
        const bar = document.querySelector('ytmusic-player-bar');
        if (!bar) return null;

        const titleEl = bar.querySelector('.title');
        const bylineEl = bar.querySelector('.subtitle');

        if (!titleEl || !bylineEl) return null;

        const title = titleEl.textContent.trim();
        const bylineText = bylineEl.textContent.trim();

        const allLinks = Array.from(bylineEl.querySelectorAll('a'));

        let artistNames = [];
        let albumName = "";

        allLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            const isArtist = href.includes('channel/') ||
                href.includes('browse/UC') ||
                href.includes('artist_detail');

            if (isArtist) {
                artistNames.push(link.textContent.trim());
            } else {
                if (!albumName) albumName = link.textContent.trim();
            }
        });

        let artist = artistNames.length > 0 ? artistNames.join(", ") : (bylineText.split('•')[0]?.trim() || "");
        let album = albumName;

        return { title, artist, album, isVideo: album === "" };
    }

    // --- API Metadata Extraction ---

    function extractAlbumFromDescription(description, title) {
        if (!description) return null;

        const lines = description.split('\n')
                                 .map(l => l.trim())
                                 .filter(l => l.length > 0);
        
        const providedIndex = lines.findIndex(line => line.startsWith('Provided to YouTube'));
        
        if (providedIndex !== -1 && lines.length > providedIndex + 2) {
            const potentialAlbum = lines[providedIndex + 2];
            
            if (!isMetadataLine(potentialAlbum)) {
                return potentialAlbum;
            }
        }

        if (title) {
            const separator = ' · ';
            const titleIndex = lines.findIndex(line => 
                line.includes(separator) && (line.startsWith(title) || line.includes(title))
            );

            if (titleIndex !== -1 && lines.length > titleIndex + 1) {
                const potentialAlbum = lines[titleIndex + 1];
                if (!isMetadataLine(potentialAlbum)) {
                    return potentialAlbum;
                }
            }
        }

        return null;
    }

    function isMetadataLine(line) {
        return line.startsWith('℗') || 
               line.startsWith('Released on') || 
               line.startsWith('Auto-generated') ||
               line.match(/^Composer:/);
    }
    
    // --- API Helpers ---

    async function fetchFromYouTube(videoId, clientName, clientVersion) {
        try {
            const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "accept-language": "en-US,en;q=0.9"
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: clientName,
                            clientVersion: clientVersion
                        }
                    },
                    videoId: videoId
                })
            });
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            console.error(`LYPLUS: Fetch failed for ${clientName}`, e);
            return null;
        }
    }

    async function fetchMetadataDual(videoId) {
        const [remixData, legacyData] = await Promise.all([
            // Artist list & Titles
            fetchFromYouTube(videoId, "WEB_REMIX", "1.20260204.03.00"),
        
            // Description -> Album
            fetchFromYouTube(videoId, "WEB", "2.20230327.07.00")
        ]);

        if (!remixData && !legacyData) return null;
        const rDetails = remixData?.videoDetails || {};
        const rMicro = remixData?.microformat?.microformatDataRenderer || {};
        
        const title = rDetails.title || rMicro.title || "";
        
        const artist = rDetails.author || "";

        const thumbnails = rDetails.thumbnail?.thumbnails || rMicro.thumbnail?.thumbnails || [];
        const artwork = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : "";

        const duration = parseInt(rDetails.lengthSeconds || 0);

        const lDetails = legacyData?.videoDetails || {};
        const lMicro = legacyData?.microformat?.playerMicroformatRenderer || {};
        
        const fullDescription = lDetails.shortDescription || lMicro.description?.simpleText || "";
        const extractedAlbum = extractAlbumFromDescription(fullDescription, title);

        return {
            title: title,
            artist: artist,
            album: extractedAlbum,
            artwork: artwork,
            duration: duration,
            videoId: videoId
        };
    }

    // --- Main Logic ---

    async function checkForSongChange() {
        const player = getPlayer();
        const domInfo = getMetadataFromDOM(); 

        if (!player) return;

        let videoId = "";
        let duration = 0;

        try {
            if (player.getVideoData) videoId = player.getVideoData().video_id;
            if (player.getDuration) duration = player.getDuration();
        } catch (e) { return; }

        if (!videoId) {
            setTimeout(checkForSongChange, 250);
            return;
        }

        if (videoId !== currentSong.videoId || (domInfo && domInfo.title !== currentSong.title)) {
            
            const apiData = await fetchMetadataDual(videoId);

            let finalTitle = apiData?.title || domInfo?.title || "Unknown Title";
            let finalArtist = apiData?.artist || domInfo?.artist || "Unknown Artist";
            let finalArtwork = apiData?.artwork || "";
            let finalDuration = apiData?.duration || duration;
            
            let finalAlbum = apiData?.album || domInfo?.album || "";

            const isVideo = !finalAlbum;

            currentSong = {
                title: finalTitle,
                artist: finalArtist,
                album: finalAlbum,
                duration: finalDuration,
                videoId: videoId,
                artwork: finalArtwork,
                isVideo: isVideo
            };

            startTimeUpdater();

            window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: currentSong }, '*');
            window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
        }
    }

    // Start
    init();

})();