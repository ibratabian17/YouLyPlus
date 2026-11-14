// inject/ytmusic/songTracker.js

(function () {
    let currentSong = {};
    let debounceTimer = null;
    let playerInstance = null;
    let boundVideoEl = null;

      let lastSyncAudioTime = -1;
    let lastSyncPerfTime = null;
    let lastSyncPlaying = null;
    let lastSyncRate = 1;
    let driftCheckTimer = null;
    let settleTimer = null;

    const DRIFT_THRESHOLD_SEC = 0.010;
    const DRIFT_CHECK_INTERVAL_MS = 1000;
    const SETTLE_SYNC_DELAY_MS = 120;

    console.log('LYPLUS: Tracker injected.');

    function init() {
        setupMutationObserver();
        setupSeekListener();
        bindMediaEvents();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopTimeUpdater();
            } else {
                bindMediaEvents();
                emitTimeSync(true);
                if (isActuallyPlaying()) startTimeUpdater();
            }
        }, { passive: true });
        checkForSongChange();
    }

    function getPlayer() {
        if (playerInstance && playerInstance.isConnected) {
            return playerInstance;
        }
        playerInstance = document.getElementById("movie_player");
        return playerInstance;
    }

    function getVideoElement() {
        if (boundVideoEl && boundVideoEl.isConnected) {
            return boundVideoEl;
        }
        const player = getPlayer();
        return player?.querySelector?.('video') || document.querySelector('video') || null;
    }

    function getPreciseTime() {
        const player = getPlayer();
        if (player && typeof player.getCurrentTime === 'function') {
            try {
                const t = player.getCurrentTime();
                if (typeof t === 'number' && Number.isFinite(t)) return t;
            } catch (e) {}
        }
        const video = getVideoElement();
        return (video && Number.isFinite(video.currentTime)) ? video.currentTime : 0;
    }

    function getPlaybackRate() {
        const video = getVideoElement();
        if (video && typeof video.playbackRate === 'number' && video.playbackRate > 0) {
            return video.playbackRate;
        }
        const player = getPlayer();
        if (player && typeof player.getPlaybackRate === 'function') {
            try {
                const r = player.getPlaybackRate();
                if (typeof r === 'number' && r > 0) return r;
            } catch (e) {}
        }
        return 1;
    }

    function isActuallyPlaying() {
        const video = getVideoElement();
        if (video && typeof video.paused === 'boolean') {
            if (video.paused || video.ended || video.readyState < 2) return false;
        }
        const player = getPlayer();
        if (player && typeof player.getPlayerState === 'function') {
            try {
                return player.getPlayerState() === 1;
            } catch (e) {}
        }
        return video ? (!video.paused && !video.ended) : false;
    }

    function emitTimeSync(force = false) {
        const now = performance.now();
        const actualTime = getPreciseTime();
        const rate = getPlaybackRate();
        const activePlaying = isActuallyPlaying();

        const stateChanged = activePlaying !== lastSyncPlaying;
        const expectedTime = (lastSyncPlaying && lastSyncPerfTime !== null)
            ? lastSyncAudioTime + ((now - lastSyncPerfTime) / 1000) * lastSyncRate
            : lastSyncAudioTime;
        const drift = Math.abs(actualTime - expectedTime);

        if (
            force ||
            stateChanged ||
            rate !== lastSyncRate ||
            lastSyncPerfTime === null ||
            drift > DRIFT_THRESHOLD_SEC
        ) {
            lastSyncAudioTime = actualTime;
            lastSyncPerfTime = now;
            lastSyncPlaying = activePlaying;
            lastSyncRate = rate;

            window.postMessage({
                type: 'LYPLUS_TIME_UPDATE',
                currentTime: actualTime,
                timestamp: now,
                isPlaying: activePlaying,
                playbackRate: rate
            }, '*');

            if (stateChanged) {
                window.postMessage({
                    type: 'LYPLUS_PLAYBACK_STATE',
                    isPlaying: activePlaying
                }, '*');
            }
        }
    }

    function scheduleSettleCheck() {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            settleTimer = null;
            if (!document.hidden && isActuallyPlaying()) {
                emitTimeSync(false);
            }
        }, SETTLE_SYNC_DELAY_MS);
    }

    const onVideoActiveEvent = () => {
        emitTimeSync(true);
        scheduleSettleCheck();
        if (!document.hidden && isActuallyPlaying()) {
            startTimeUpdater();
        }
    };

    const onVideoStateEvent = () => {
        emitTimeSync(true);
        if (!isActuallyPlaying()) {
            stopTimeUpdater();
        }
    };

    const onVideoTimeUpdate = () => {
        if (!document.hidden && isActuallyPlaying()) {
            emitTimeSync(false);
        }
    };

    function bindMediaEvents() {
        const video = getPlayer()?.querySelector?.('video') || document.querySelector('video') || null;
        if (video === boundVideoEl) return;

        if (boundVideoEl) {
            const opts = { passive: true };
            boundVideoEl.removeEventListener('play', onVideoActiveEvent, opts);
            boundVideoEl.removeEventListener('playing', onVideoActiveEvent, opts);
            boundVideoEl.removeEventListener('seeked', onVideoActiveEvent, opts);
            boundVideoEl.removeEventListener('ratechange', onVideoActiveEvent, opts);
            boundVideoEl.removeEventListener('pause', onVideoStateEvent, opts);
            boundVideoEl.removeEventListener('waiting', onVideoStateEvent, opts);
            boundVideoEl.removeEventListener('stalled', onVideoStateEvent, opts);
            boundVideoEl.removeEventListener('seeking', onVideoStateEvent, opts);
            boundVideoEl.removeEventListener('ended', onVideoStateEvent, opts);
            boundVideoEl.removeEventListener('timeupdate', onVideoTimeUpdate, opts);
        }

        boundVideoEl = video;
        if (boundVideoEl) {
            const opts = { passive: true };
            boundVideoEl.addEventListener('play', onVideoActiveEvent, opts);
            boundVideoEl.addEventListener('playing', onVideoActiveEvent, opts);
            boundVideoEl.addEventListener('seeked', onVideoActiveEvent, opts);
            boundVideoEl.addEventListener('ratechange', onVideoActiveEvent, opts);
            boundVideoEl.addEventListener('pause', onVideoStateEvent, opts);
            boundVideoEl.addEventListener('waiting', onVideoStateEvent, opts);
            boundVideoEl.addEventListener('stalled', onVideoStateEvent, opts);
            boundVideoEl.addEventListener('seeking', onVideoStateEvent, opts);
            boundVideoEl.addEventListener('ended', onVideoStateEvent, opts);
            boundVideoEl.addEventListener('timeupdate', onVideoTimeUpdate, opts);
        }
    }

    function setupMutationObserver() {
        const metadataContainer = document.querySelector('ytmusic-player-bar .content-info-wrapper')
            || document.querySelector('ytmusic-player-bar .left-controls')
            || document.querySelector('ytmusic-miniplayer .ytmusicTrackInfoContentInfoWrapper')
            || document.querySelector('ytmusic-miniplayer ytmusic-track-info')
            || document.querySelector('ytmusic-miniplayer .ytMusicMiniPlayerLeftSection')
            || document.querySelector('[slot="player-bar"] .ytmusicTrackInfoContentInfoWrapper')
            || document.querySelector('[slot="player-bar"] .content-info-wrapper')
            || document.querySelector('[slot="player-bar"]');

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
                const targetTime = event.data.time;
                player.seekTo(targetTime, true);
                const now = performance.now();
                lastSyncAudioTime = targetTime;
                lastSyncPerfTime = now;
                window.postMessage({
                    type: 'LYPLUS_TIME_UPDATE',
                    currentTime: targetTime,
                    timestamp: now,
                    isPlaying: isActuallyPlaying(),
                    playbackRate: getPlaybackRate()
                }, '*');
                scheduleSettleCheck();
            }
        });
    }

    function startTimeUpdater() {
        stopTimeUpdater();
        bindMediaEvents();
        emitTimeSync(true);
        scheduleSettleCheck();

        driftCheckTimer = setInterval(() => {
            if (!document.hidden && isActuallyPlaying()) {
                bindMediaEvents();
                emitTimeSync(false);
            } else {
                stopTimeUpdater();
            }
        }, DRIFT_CHECK_INTERVAL_MS);
    }

    function stopTimeUpdater() {
        if (driftCheckTimer) {
            clearInterval(driftCheckTimer);
            driftCheckTimer = null;
        }
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
    }

    function getMetadataFromDOM() {
        const bar = document.querySelector('ytmusic-player-bar, ytmusic-miniplayer, [slot="player-bar"]');
        if (!bar) return null;

        const titleEl = bar.querySelector('.ytmusicTrackInfoTitle') || bar.querySelector('.title');
        const bylineEl = bar.querySelector('.ytmusicTrackInfoByline') || bar.querySelector('.subtitle') || bar.querySelector('.byline');

        if (!titleEl || !bylineEl) return null;

        const title = titleEl.textContent.trim();
        const bylineText = bylineEl.textContent.trim();
        const allLinks = Array.from(bylineEl.querySelectorAll('a'));

        let artistNames = [];
        let albumName = "";

        allLinks.forEach((link, idx) => {
            const href = link.getAttribute('href');
            const text = link.textContent.trim();
            if (!text) return;

            if (href) {
                const isArtist = href.includes('channel/') ||
                    href.includes('browse/UC') ||
                    href.includes('artist_detail');

                if (isArtist) {
                    artistNames.push(text);
                } else {
                    if (!albumName) albumName = text;
                }
            } else {
                // For new miniplayer buttons or links without href
                if (idx === 0) {
                    artistNames.push(text);
                } else if (!albumName && !text.toLowerCase().includes('view') && !text.toLowerCase().includes('like')) {
                    albumName = text;
                }
            }
        });

        const artist = artistNames.length > 0
            ? artistNames.join(", ")
            : (bylineText.split('•')[0]?.trim() || "");

        return { title, artist, album: albumName, isVideo: albumName === "" };
    }

    function getMediaSession() {
        return navigator.mediaSession?.metadata || null;
    }

    function extractAlbumFromDescription(description, title) {
        if (!description) return null;

        const lines = description.split('\n')
                                 .map(l => l.trim())
                                 .filter(l => l.length > 0);

        const providedIndex = lines.findIndex(line => line.startsWith('Provided to YouTube'));

        if (providedIndex !== -1 && lines.length > providedIndex + 2) {
            const potentialAlbum = lines[providedIndex + 2];
            if (!isMetadataLine(potentialAlbum)) return potentialAlbum;
        }

        if (title) {
            const titleIndex = lines.findIndex(line =>
                line.includes(' · ') && (line.startsWith(title) || line.includes(title))
            );

            if (titleIndex !== -1 && lines.length > titleIndex + 1) {
                const potentialAlbum = lines[titleIndex + 1];
                if (!isMetadataLine(potentialAlbum)) return potentialAlbum;
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

    async function fetchFromYouTube(videoId, clientName, clientVersion) {
        try {
            const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "accept-language": "en-US,en;q=0.9"
                },
                body: JSON.stringify({
                    context: { client: { clientName, clientVersion } },
                    videoId
                })
            });
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            console.error(`LYPLUS: Fetch failed for ${clientName}`, e);
            return null;
        }
    }

    let activeFetchVideoId = null;

    async function fetchMetadataDual(videoId) {

        const [remixData, legacyData] = await Promise.all([
            fetchFromYouTube(videoId, "WEB_REMIX", getWebClientVersion()),
            fetchFromYouTube(videoId, "WEB", "2.20230327.07.00")
        ]);

        if (!remixData && !legacyData) return null;

        const rDetails = remixData?.videoDetails || {};
        const rMicro = remixData?.microformat?.microformatDataRenderer || {};
        const lDetails = legacyData?.videoDetails || {};
        const lMicro = legacyData?.microformat?.playerMicroformatRenderer || {};

        const title = rDetails.title || rMicro.title || "";
        const artist = rDetails.author || "";
        const thumbnails = rDetails.thumbnail?.thumbnails || rMicro.thumbnail?.thumbnails || [];
        const artwork = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : "";
        const duration = parseInt(rDetails.lengthSeconds || 0);
        const fullDescription = lDetails.shortDescription || lMicro.description?.simpleText || "";
        const album = extractAlbumFromDescription(fullDescription, title);
        const captions = remixData?.captions?.playerCaptionsTracklistRenderer ||
                         legacyData?.captions?.playerCaptionsTracklistRenderer || null;

        return { title, artist, album, artwork, duration, videoId, captions };
    }

    function getWebClientVersion() {
        const fromCfg = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION') ||
                        window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION ||
                        window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.clientVersion;
        if (fromCfg) return fromCfg;

        const d = new Date();
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `1.${y}${m}${day}.01.00`;
    }

    const YT_CLIENTS = {
        web: {
            clientName: "WEB_REMIX",
            get clientVersion() { return getWebClientVersion(); }
        },
        android: { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50", androidSdkVersion: 30 }
    };

    function ytCtx(c, hl = "en", gl = "US") {
        const client = c === "web"
            ? { clientName: "WEB_REMIX", clientVersion: getWebClientVersion(), hl, gl }
            : { ...YT_CLIENTS[c], hl, gl };
        return { context: { client } };
    }

    async function ytRequest(path, body) {
        try {
            const clientVer = getWebClientVersion();
            const res = await fetch(`/youtubei/v1/${path}?prettyPrint=false`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept-Language": "en-US,en;q=0.9",
                    "X-YouTube-Client-Name": "67",
                    "X-YouTube-Client-Version": clientVer
                },
                body: JSON.stringify(body)
            });
            if (res.ok) return await res.json();
            return null;
        } catch (e) {
            return null;
        }
    }

    function findLyricsBrowseId(next) {
        const tabs = next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
        if (Array.isArray(tabs)) {
            for (const tab of tabs) {
                const tr = tab?.tabRenderer;
                if (!tr) continue;
                if (tr.unselectable) return null;
                const browseId = tr.endpoint?.browseEndpoint?.browseId;
                if (typeof browseId === "string" && browseId.startsWith("MPLYt")) {
                    return browseId;
                }
            }
        }
        let found = null;
        let isUnselectable = false;
        (function walk(o) {
            if (!o || typeof o !== "object" || found) return;
            if (o.tabRenderer && o.tabRenderer.unselectable) {
                const bId = o.tabRenderer.endpoint?.browseEndpoint?.browseId;
                if (typeof bId === "string" && bId.startsWith("MPLYt")) {
                    isUnselectable = true;
                    return;
                }
            }
            if (typeof o.browseId === "string" && o.browseId.startsWith("MPLYt")) {
                found = o.browseId;
                return;
            }
            for (const v of Object.values(o)) walk(v);
        })(next);
        return isUnselectable ? null : found;
    }

    function decodeB64(b64) {
        if (!b64) return null;
        try {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            return new TextDecoder().decode(bytes).replace(/[\x00-\x1f]/g, " ").trim();
        } catch {
            return null;
        }
    }

    function cleanProviderName(value) {
        if (typeof value !== "string") return null;
        const providerName = value.split('\n')[0]
            .replace(/^(source|lyrics provided by|lyrics)\s*:\s*/i, '')
            .trim();
        return providerName && !providerName.toLowerCase().includes("youtube")
            ? providerName
            : null;
    }

    function extractFooterAndProvider(r) {
        let provider = null;
        let trackId = null;
        (function walk(o) {
            if (!o || typeof o !== "object") return;
            const footerText = (
                o.footer?.runs ? o.footer.runs.map(r => r.text || '').join('').trim() :
                o.footer?.simpleText ? o.footer.simpleText.trim() : null
            );
            const providerName = cleanProviderName(o.sourceMessage) || cleanProviderName(footerText);
            if (providerName) provider = providerName;
            if (o.logLyricEventCommand?.serializedLyricInfo) {
                trackId = decodeB64(o.logLyricEventCommand.serializedLyricInfo);
            }
            for (const v of Object.values(o)) walk(v);
        })(r);
        return { provider, trackId };
    }

    function extractPlain(r) {
        let plain = "";
        (function walk(o) {
            if (!o || typeof o !== "object" || plain) return;
            if (o.musicDescriptionShelfRenderer?.description) {
                const desc = o.musicDescriptionShelfRenderer.description;
                if (Array.isArray(desc.runs)) {
                    plain = desc.runs.map(x => x.text || "").join("").trim();
                } else if (desc.simpleText) {
                    plain = desc.simpleText.trim();
                }
            }
            if (!plain) {
                for (const v of Object.values(o)) walk(v);
            }
        })(r);
        return plain;
    }

    function extractTimed(r) {
        const lines = [];
        (function walk(o, parentKey) {
            if (!o || typeof o !== "object") return;
            if (typeof o.lyricLine === "string") {
                if (o.cueRange) {
                    lines.push({
                        text: o.lyricLine,
                        start: parseInt(o.cueRange.startTimeMilliseconds) || 0,
                        end: parseInt(o.cueRange.endTimeMilliseconds) || 0,
                        id: parseInt(o.cueRange.metadata?.id || "0"),
                    });
                } else if (parentKey === "timedLyricsData") {
                    lines.push({
                        text: o.lyricLine,
                        start: 0,
                        end: 0,
                        id: lines.length,
                    });
                }
            }
            if (Array.isArray(o)) {
                for (const v of o) walk(v, parentKey);
                return;
            }
            for (const [k, v] of Object.entries(o)) walk(v, k);
        })(r, undefined);
        return lines;
    }

    async function getLyrics(videoId) {
        if (!videoId) return null;

        try {
            const next = await ytRequest("next", { ...ytCtx("web"), videoId });
            if (!next) return null;

            const browseId = findLyricsBrowseId(next);
            if (!browseId) {
                return null;
            }

            // Fetch web (for plain text and provider footer) and android (for synced timed lyrics)
            const [web, android] = await Promise.all([
                ytRequest("browse", { ...ytCtx("web"), browseId }),
                ytRequest("browse", { ...ytCtx("android"), browseId }),
            ]);

            const metaWeb = extractFooterAndProvider(web);
            const metaAndroid = extractFooterAndProvider(android);
            const provider = metaWeb.provider || metaAndroid.provider || null;
            const trackId = metaWeb.trackId || metaAndroid.trackId || null;

            const webPlain = extractPlain(web);
            const plain = webPlain || extractPlain(android) || "";

            const androidTimed = extractTimed(android);
            const webTimed = extractTimed(web);
            let timed = [];
            let synced = false;

            const hasAndroidSync = androidTimed.some((l) => l.start > 0 || l.end > 0);
            const hasWebSync = webTimed.some((l) => l.start > 0 || l.end > 0);

            if (hasAndroidSync) {
                timed = androidTimed;
                synced = true;
            } else if (hasWebSync) {
                timed = webTimed;
                synced = true;
            } else {
                // For plain text, prefer web remix
                timed = [];
                synced = false;
            }

            const noLyrics = !plain && !timed.length;
            return noLyrics ? null : {
                videoId,
                browseId,
                provider,
                trackId,
                plain: plain || null,
                timed: timed || [],
                synced
            };
        } catch (e) {
            console.error('LYPLUS: getLyrics failed', e);
            return null;
        }
    }

    async function getSongCredits(videoId) {
        if (!videoId) return null;

        try {
            const r = await ytRequest("browse", { ...ytCtx("web"), browseId: "MPTC" + videoId });
            if (!r) {
                return null;
            }
            let writers = [];
            (function walk(o) {
                if (!o || typeof o !== "object") return;
                if (o.dismissableDialogContentSectionRenderer) {
                    const section = o.dismissableDialogContentSectionRenderer;
                    const sectionTitle = section.title?.runs?.map(x => x.text || "").join("").trim().toLowerCase() || "";
                    if (sectionTitle.includes("written by") || sectionTitle.includes("songwriter") || sectionTitle.includes("composer")) {
                        const text = section.subtitle?.runs?.map(x => x.text || "").join("") || section.subtitle?.simpleText || "";
                        if (text) {
                            const list = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
                            writers.push(...list);
                        }
                    }
                }
                for (const v of Object.values(o)) walk(v);
            })(r);
            return writers.length > 0 ? Array.from(new Set(writers)) : null;
        } catch (e) {
            return null;
        }
    }

    async function checkForSongChange() {
        const player = getPlayer();
        const domInfo = getMetadataFromDOM();

        if (!player) return;

        bindMediaEvents();

        let videoId = "";
        let duration = 0;
        let audioTrackData = null;

        try {
            if (player.getVideoData) videoId = player.getVideoData().video_id;
            if (player.getDuration) duration = player.getDuration();
            if (player.getAudioTrack && typeof player.getAudioTrack === 'function') {
                audioTrackData = player.getAudioTrack();
            }
        } catch (e) { return; }

        if (!videoId) {
            setTimeout(checkForSongChange, 250);
            return;
        }

        if (videoId !== currentSong.videoId || (domInfo && domInfo.title !== currentSong.title)) {
            if (activeFetchVideoId === videoId) return;
            activeFetchVideoId = videoId;

            let apiData = null;
            let directLyrics = null;
            let songCredits = null;

            try {
                [apiData, directLyrics, songCredits] = await Promise.all([
                    fetchMetadataDual(videoId),
                    getLyrics(videoId),
                    getSongCredits(videoId)
                ]);
            } finally {
                activeFetchVideoId = null;
            }

            const rawTitle = apiData?.title || domInfo?.title || getMediaSession()?.title;

            const finalTitle = rawTitle;
            const finalArtist =
                apiData?.artist         ||
                domInfo?.artist         ||
                getMediaSession()?.artist ||
                "Unknown Artist";

            const finalArtwork = apiData?.artwork || "";
            const finalDuration = apiData?.duration || duration;

            if (!finalDuration) {
                setTimeout(checkForSongChange, 250);
                return;
            }

            const finalAlbum = apiData?.album || domInfo?.album || "";

            let captionData = apiData?.captions ||
                              player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer;

            if (!captionData?.captionTracks?.length && player?.getOption && typeof player.getOption === 'function') {
                try {
                    const trackList = player.getOption('captions', 'tracklist');
                    if (trackList?.length) {
                        captionData = { captionTracks: trackList };
                    }
                } catch (optErr) {}
            }

            const ytLyrics = directLyrics;
            if (ytLyrics && songCredits?.length) {
                ytLyrics.songWriters = songCredits;
            }

            currentSong = {
                title: finalTitle,
                artist: finalArtist,
                album: finalAlbum,
                duration: finalDuration,
                videoId,
                artwork: finalArtwork,
                isVideo: !finalAlbum,
                subtitle: captionData || audioTrackData,
                ytMusicLyrics: ytLyrics,
                songWriters: songCredits || []
            };

            lastSyncAudioTime = -1;
            lastSyncPerfTime = null;

            window.postMessage({ type: 'LYPLUS_SONG_CHANGED', songInfo: currentSong }, '*');
            window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg', artworkUrl: finalArtwork }, '*');

            startTimeUpdater();
        }
    }

    init();

})();