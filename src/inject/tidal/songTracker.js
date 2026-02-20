// src/inject/tidal/songTracker.js

(function () {
    let tidalAuthToken = '';
    let tidalCountryCode = 'US'; // Default
    let currentSongId = null;

    // --- Intercept Fetch to Steal Token ---
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        let url = args[0];
        let options = args[1];

        if (url instanceof Request) {
            options = url;
            url = url.url;
        }

        if (typeof url === 'string') {
            try {
                const urlObj = new URL(url, window.location.origin);
                const countryParam = urlObj.searchParams.get('countryCode');
                if (countryParam) {
                    tidalCountryCode = countryParam;
                }
            } catch (e) { }

            if (options && options.headers) {
                let authHeader = null;

                if (options.headers instanceof Headers) {
                    authHeader = options.headers.get('Authorization');
                } else if (Array.isArray(options.headers)) {
                    authHeader = options.headers.find(h => h[0].toLowerCase() === 'authorization')?.[1];
                } else if (typeof options.headers === 'object') {
                    const key = Object.keys(options.headers).find(k => k.toLowerCase() === 'authorization');
                    if (key) authHeader = options.headers[key];
                }

                if (authHeader && authHeader.startsWith('Bearer ')) {
                    tidalAuthToken = authHeader;
                }
            }
        }

        return originalFetch.apply(this, args);
    };

    // --- Intercept XMLHttpRequest to Steal Token ---
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        if (typeof url === 'string') {
            try {
                const urlObj = new URL(url, window.location.origin);
                const countryParam = urlObj.searchParams.get('countryCode');
                if (countryParam) tidalCountryCode = countryParam;
            } catch (e) { }
        }
        return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (header.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
            tidalAuthToken = value;
        }
        return originalSetRequestHeader.call(this, header, value);
    };

    // --- Metadata Fetch ---
    async function fetchTrackMetadata(trackId) {
        if (!tidalAuthToken) return null;

        const url = `https://api.tidal.com/v1/tracks/${trackId}?countryCode=${tidalCountryCode}`;

        try {
            const res = await originalFetch(url, {
                headers: {
                    'Authorization': tidalAuthToken,
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                return null;
            }

            const data = await res.json();
            if (!data) return null;

            let title = '';
            let finalArtist = 'Unknown Artist';
            let duration = 0;
            let albumId = null;

            if (data.data && data.data.attributes) {
                const attrs = data.data.attributes;
                title = attrs.title || '';
                if (attrs.duration && attrs.duration.startsWith('PT')) {
                    const match = attrs.duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
                    if (match) {
                        const m = parseInt(match[1] || '0');
                        const s = parseInt(match[2] || '0');
                        duration = (m * 60) + s;
                    }
                } else if (typeof attrs.duration === 'number') {
                    duration = attrs.duration;
                }
            } else {
                title = data.title || '';
                duration = data.duration || 0;
                if (data.album && data.album.id) albumId = data.album.id;
                if (data.artist && data.artist.name) finalArtist = data.artist.name;
                if (data.artists && data.artists.length > 0) {
                    finalArtist = data.artists.map(a => a.name).join(', ');
                }
            }

            return {
                title: title,
                artist: finalArtist,
                duration: duration,
                albumId: albumId,
                isVideo: false
            };

        } catch (e) {
            console.error('LYPLUS TIDAL Fetch Error', e);
            return null;
        }
    }

    async function fetchAlbumMetadata(albumId) {
        if (!albumId || !tidalAuthToken) return null;

        const url = `https://api.tidal.com/v1/albums/${albumId}?countryCode=${tidalCountryCode}`;

        try {
            const res = await originalFetch(url, {
                headers: {
                    'Authorization': tidalAuthToken,
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error('LYPLUS TIDAL Fetch Album Error', e);
            return null;
        }
    }

    async function handleSongChange(trackId) {
        if (!tidalAuthToken) {
            setTimeout(() => {
                if (tidalAuthToken) handleSongChange(trackId);
            }, 1000);
            return;
        }

        const songInfo = await fetchTrackMetadata(trackId);
        if (songInfo) {
            const domFooter = document.querySelector('div[data-test="left-column-footer-player"]');

            let albumId = songInfo.albumId;
            let albumName = '';
            let coverUrl = '';

            // If albumId wasn't in track response, check DOM
            if (!albumId && domFooter) {
                const albumEl = domFooter.querySelector('a[href*="/album/"]');
                if (albumEl) {
                    const match = albumEl.getAttribute('href').match(/\/album\/(\d+)/);
                    if (match) albumId = match[1];
                }
            }

            // Subrequest for album
            if (albumId) {
                const albumData = await fetchAlbumMetadata(albumId);
                if (albumData) {
                    albumName = albumData.title || '';
                    if (albumData.cover) {
                        const uuid = albumData.cover.replace(/-/g, '/');
                        coverUrl = `https://resources.tidal.com/images/${uuid}/1280x1280.jpg`;
                    }
                }
            }

            if (domFooter) {
                if (!songInfo.artist || songInfo.artist === 'Unknown Artist') {
                    const artistEl = domFooter.querySelector('a[data-test="grid-item-detail-text-title-artist"], [data-test="grid-item-detail-text-title-artist"]');
                    if (artistEl) songInfo.artist = artistEl.textContent.trim();
                }

                if (!coverUrl) {
                    const coverEl = domFooter.querySelector('img[data-test="current-media-imagery"], .media-imagery img');
                    if (coverEl) {
                        let src = coverEl.src;
                        if (src.includes('/80x80.jpg')) {
                            src = src.replace('/80x80.jpg', '/1280x1280.jpg');
                        }
                        coverUrl = src;
                    }
                }
            }

            const finalSongInfo = {
                title: songInfo.title,
                artist: songInfo.artist,
                album: albumName,
                duration: songInfo.duration,
                artwork: coverUrl,
                isVideo: songInfo.isVideo
            };

            window.postMessage({
                type: 'LYPLUS_SONG_CHANGED',
                songInfo: finalSongInfo
            }, '*');

            window.postMessage({ type: 'LYPLUS_updateFullScreenAnimatedBg' }, '*');
        }
    }

    function checkCurrentTrack() {
        const titleAnchor = document.querySelector('[data-test="footer-player"] [data-test="footer-track-title"] a[href^="/track/"]');
        if (!titleAnchor) return;

        const href = titleAnchor.getAttribute('href');
        const trackIdMatch = href.match(/\/track\/(\d+)/);
        if (!trackIdMatch) return;

        const newTrackId = trackIdMatch[1];
        if (newTrackId !== currentSongId) {
            currentSongId = newTrackId;
            handleSongChange(newTrackId);
        }
    }

    function initObserver() {
        const config = { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'title'] };
        const observer = new MutationObserver(() => {
            clearTimeout(window._lyplusTidalCheckTimer);
            window._lyplusTidalCheckTimer = setTimeout(checkCurrentTrack, 500);
        });

        const targetNode = document.body;
        if (targetNode) observer.observe(targetNode, config);

        setInterval(checkCurrentTrack, 2000);
    }

    console.log('LYPLUS TIDAL: Tracker injected.');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initObserver);
    } else {
        initObserver();
    }

})();
