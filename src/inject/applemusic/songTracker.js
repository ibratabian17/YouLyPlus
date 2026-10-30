// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let timeUpdateFrame = null;
  let playing = false;
  let lyricsSurfaceVisible = true;

  const killedCanvases = new WeakSet();

  function isAppleLyricsCanvas(canvas) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return false;
    if (canvas.id === 'lyplus-webgl-canvas') return false;
    if (killedCanvases.has(canvas)) return true;
    if (
      canvas.closest?.('[data-testid="now-playing-backdrop"]') ||
      canvas.closest?.('.dt-lyrics__platter') ||
      canvas.closest?.('article[data-testid="lyrics-fullscreen-modal"]')
    ) {
      killedCanvases.add(canvas);
      return true;
    }
    return false;
  }

  function sweepAppleCanvases() {
    const canvases = document.querySelectorAll(
      '[data-testid="now-playing-backdrop"] canvas:not(#lyplus-webgl-canvas), ' +
      '.dt-lyrics__platter canvas:not(#lyplus-webgl-canvas), ' +
      'article[data-testid="lyrics-fullscreen-modal"] canvas:not(#lyplus-webgl-canvas)'
    );
    canvases.forEach((canvas) => {
      killedCanvases.add(canvas);
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
    });
  }

  function hasActiveLyricsSurface() {
    if (document.hidden) return false;
    return !!(
      document.querySelector('article[data-testid="lyrics-fullscreen-modal"]') ||
      document.querySelector('[data-testid="lyrics-sidebar"]')
    );
  }

  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'LYPLUS_THROTTLE_APPLE_CANVAS') {
      sweepAppleCanvases();
      return;
    }
    if (event.data.type === 'LYPLUS_SURFACE_VISIBILITY') {
      const nextVisible = !!event.data.visible;
      if (nextVisible !== lyricsSurfaceVisible) {
        lyricsSurfaceVisible = nextVisible;
        if (playing && lyricsSurfaceVisible) {
          startTimeUpdater();
        } else if (!lyricsSurfaceVisible) {
          stopTimeUpdater();
        }
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimeUpdater();
    } else if (playing && hasActiveLyricsSurface()) {
      lyricsSurfaceVisible = true;
      startTimeUpdater();
    }
  }, { passive: true });

  sweepAppleCanvases();

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
      // ignore internal player structure changes
    }

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
      } catch (e) {}

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
      artwork: artworkUrl,
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
          songInfo.appleMusicTTML = ttmlData;
        }
      } catch (e) {}
    }

    window.postMessage({
      type: 'LYPLUS_SONG_CHANGED',
      songInfo
    }, '*');

    // Only wake the WebGL background renderer if the fullscreen modal is actually open
    if (document.querySelector('article[data-testid="lyrics-fullscreen-modal"]')) {
      window.postMessage({
        type: 'LYPLUS_updateFullScreenAnimatedBg',
        artworkUrl
      }, '*');
    }
  }

  function setupSeekListener() {
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'LYPLUS_SEEK_TO') return;
      if (mkInstance && typeof event.data.time === 'number') {
        try {
          mkInstance.seekToTime(event.data.time);
        } catch (e) {}
      }
    });
  }

  function startTimeUpdater() {
    stopTimeUpdater();

    function loop() {
      if (mkInstance && playing && !document.hidden && hasActiveLyricsSurface()) {
        window.postMessage({
          type: 'LYPLUS_TIME_UPDATE',
          currentTime: getPreciseTime()
        }, '*');

        timeUpdateFrame = requestAnimationFrame(loop);
      } else {
        timeUpdateFrame = null;
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
      if (playing && hasActiveLyricsSurface()) startTimeUpdater();
      else stopTimeUpdater();
      window.postMessage({ type: 'LYPLUS_PLAYBACK_STATE', isPlaying: playing }, '*');
    });

    if (mkInstance.nowPlayingItem) handleSongChange();

    if (mkInstance.isPlaying) {
      playing = true;
      if (hasActiveLyricsSurface()) startTimeUpdater();
      window.postMessage({ type: 'LYPLUS_PLAYBACK_STATE', isPlaying: true }, '*');
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