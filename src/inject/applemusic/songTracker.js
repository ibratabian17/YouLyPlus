// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let timeUpdateFrame = null;
  let playing = false;

  function getPreciseTime() {
    if (!mkInstance) return 0;

    try {
      const player = mkInstance.services?.mediaItemPlayback?._currentPlayer;
      const mediaElement = player?._targetElement; 

      if (mediaElement) {
        const rawTime = mediaElement.currentTime;
        const offset = player._buffer?.currentTimestampOffset || 0;

        return rawTime - offset;
      }
    } catch (e) {
      // did they changed? for now ighore iwodbiqwabcjwsbcijwsk
    }

    // Fallback: Use public API (updates approx every 250ms)
    return mkInstance.currentPlaybackTime || 0;
  }

  async function fetchSyllableLyrics(songId, storefront) {
    if (!songId || !mkInstance) return null;
    try {
      const developerToken = mkInstance.developerToken || mkInstance.configuration?.app?.developerToken;
      if (!developerToken) return null;

      const rawLocale = document.documentElement.lang || navigator.language || 'en-US';
      let scriptParam = 'en-Latn';

      try {
        if (window.Intl && Intl.Locale) {
          const loc = new Intl.Locale(rawLocale);
          const baseLang = loc.language;
          const scriptCode = loc.maximize().script;
          if (baseLang && scriptCode) {
            scriptParam = `${baseLang}-${scriptCode}`;
          }
        }
      } catch (e) { }

      const queryParams = new URLSearchParams({
        'l[lyrics]': rawLocale,
        'l[script]': scriptParam,
        'extend': 'ttmlLocalizations'
      });

      const url = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/syllable-lyrics?${queryParams.toString()}`;

      const headers = {
        'Authorization': `Bearer ${developerToken}`,
        'Accept': 'application/json',
        'Origin': window.location.origin
      };

      if (mkInstance.musicUserToken) headers['Music-User-Token'] = mkInstance.musicUserToken;

      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function handleSongChange() {
    if (!mkInstance) return;

    const item = mkInstance.nowPlayingItem;
    if (!item || !item.attributes || !item.id) return;
    if (lastProcessedID === item.id) return;

    lastProcessedID = item.id;

    const attrs = item.attributes;
    const artworkUrl = attrs.artwork?.url ? attrs.artwork.url.replace('{w}', '800').replace('{h}', '800') : '';
    const durationSec = (attrs.durationInMillis || 0) / 1000;
    const songId = attrs.playParams.catalogId || attrs.playParams.id;

    const songInfo = {
      title: attrs.name,
      artist: attrs.artistName,
      album: attrs.albumName,
      duration: durationSec,
      cover: artworkUrl,
      appleId: songId,
      isVideo: attrs.playParams.kind === 'music-videos',
      lyricsJSON: null
    };

    const storefront = mkInstance.storefrontId || 'us';

    if (attrs.hasLyrics) {
      const lyricsData = await fetchSyllableLyrics(songId, storefront);
      try {
        if (lyricsData?.data?.[0]) {
          const ttmlData = lyricsData.data[0].attributes.ttmlLocalizations || lyricsData.data[0].attributes.ttml;
          if (typeof parseAppleTTML === 'function') {
            songInfo.lyricsJSON = parseAppleTTML(ttmlData);
          }
        }
      } catch (e) { }
    }

    window.postMessage({
      type: 'LYPLUS_SONG_CHANGED',
      songInfo
    }, '*');
  }

  function setupSeekListener() {
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'LYPLUS_SEEK_TO') return;
      if (mkInstance && typeof event.data.time === 'number') {
        try {
          mkInstance.seekToTime(event.data.time);
        } catch (e) { }
      }
    });
  }

  function startTimeUpdater() {
    stopTimeUpdater();

    function loop() {
      if (mkInstance && playing) {
        window.postMessage({
          type: 'LYPLUS_TIME_UPDATE',
          currentTime: getPreciseTime() 
        }, '*');

        timeUpdateFrame = requestAnimationFrame(loop);
      }
    }

    timeUpdateFrame = requestAnimationFrame(loop);
  }

  function stopTimeUpdater() {
    if (timeUpdateFrame) {
      cancelAnimationFrame(timeUpdateFrame);
      timeUpdateFrame = null;
    }
  }

  function init(instance) {
    mkInstance = instance;

    instance.addEventListener('nowPlayingItemDidChange', () => {
      handleSongChange();
    });

    instance.addEventListener('playbackStateDidChange', () => {
      playing = mkInstance.isPlaying;
      if (playing) startTimeUpdater();
      else stopTimeUpdater();
    });

    if (mkInstance.nowPlayingItem) handleSongChange();
    
    if (mkInstance.isPlaying) {
      playing = true;
      startTimeUpdater();
    }

    setupSeekListener();
  }

  function waitForMusicKit() {
    if (window.MusicKit && window.MusicKit.getInstance()) {
      init(window.MusicKit.getInstance());
    } else {
      setTimeout(waitForMusicKit, 500);
    }
  }

  waitForMusicKit();
})();