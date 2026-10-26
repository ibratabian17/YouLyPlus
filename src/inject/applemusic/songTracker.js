// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let timeUpdateFrame = null;
  let playing = false;

  // Instead of deleting the <canvas> node (which breaks Svelte's unmount lifecycle
  // when pressing X and leaks RAM), keep the node in the DOM, lock its internal
  // resolution to 1x1, and no-op all draw calls on its rendering context.
  const throttledCanvases = new WeakSet();

  function isAppleBackdropCanvas(canvas) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return false;
    if (canvas.id === 'lyplus-webgl-canvas') return false;
    return !!(
      canvas.closest?.('[data-testid="now-playing-backdrop"]') ||
      canvas.closest?.('.dt-lyrics__platter') ||
      canvas.closest?.('article[data-testid="lyrics-fullscreen-modal"]')
    );
  }

  function neutralizeCanvasContext(ctx) {
    if (!ctx || ctx.__lyplusNeutralized) return ctx;
    ctx.__lyplusNeutralized = true;
    const noop = function () {};
    const drawMethods = [
      // idk wht draw did they use, so guessing them???
      // WebGL / WebGL2
      'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
      'drawRangeElements', 'clear', 'texImage2D', 'texSubImage2D', 'texImage3D',
      'texSubImage3D', 'copyTexImage2D', 'copyTexSubImage2D', 'blitFramebuffer',
      'useProgram', 'bindFramebuffer', ' bindTexture', 'viewport', ' flush', 'finish',
      // 2D Canvas
      'drawImage', 'fillRect', 'clearRect', 'strokeRect', 'putImageData', 'fill', 'stroke'
    ];
    for (let i = 0; i < drawMethods.length; i++) {
      const m = drawMethods[i].trim();
      if (typeof ctx[m] === 'function') {
        try { ctx[m] = noop; } catch (e) {}
      }
    }
    return ctx;
  }

  function throttleAppleCanvas(canvas) {
    if (!canvas || canvas.id === 'lyplus-webgl-canvas') return;

    if (!throttledCanvases.has(canvas)) {
      throttledCanvases.add(canvas);
      canvas.setAttribute('data-lyplus-throttled', 'true');

      try {
        const proto = HTMLCanvasElement.prototype;
        const wDesc = Object.getOwnPropertyDescriptor(proto, 'width');
        const hDesc = Object.getOwnPropertyDescriptor(proto, 'height');
        if (wDesc?.set && hDesc?.set) {
          wDesc.set.call(canvas, 1);
          hDesc.set.call(canvas, 1);
          Object.defineProperty(canvas, 'width', {
            get: () => 1,
            set: () => { try { wDesc.set.call(canvas, 1); } catch (e) {} },
            configurable: true
          });
          Object.defineProperty(canvas, 'height', {
            get: () => 1,
            set: () => { try { hDesc.set.call(canvas, 1); } catch (e) {} },
            configurable: true
          });
        } else {
          canvas.width = 1;
          canvas.height = 1;
        }
      } catch (e) {
        canvas.width = 1;
        canvas.height = 1;
      }

      try {
        const existingCtx =
          canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl') ||
          canvas.getContext('2d');
        if (existingCtx) neutralizeCanvasContext(existingCtx);
      } catch (e) {}
    } else if (canvas.width !== 1 || canvas.height !== 1) {
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (e) {}
    }
  }

  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    if (origGetContext && !origGetContext.__lyplusPatched) {
      const patchedGetContext = function (type, attrs) {
        const ctx = origGetContext.call(this, type, attrs);
        if (this && this.id !== 'lyplus-webgl-canvas' && isAppleBackdropCanvas(this)) {
          throttleAppleCanvas(this);
          neutralizeCanvasContext(ctx);
        }
        return ctx;
      };
      patchedGetContext.__lyplusPatched = true;
      HTMLCanvasElement.prototype.getContext = patchedGetContext;
    }
  } catch (e) {}

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'LYPLUS_THROTTLE_APPLE_CANVAS') return;
    document.querySelectorAll(
      '[data-testid="now-playing-backdrop"] canvas:not(#lyplus-webgl-canvas), ' +
      '.dt-lyrics__platter canvas:not(#lyplus-webgl-canvas), ' +
      'article[data-testid="lyrics-fullscreen-modal"] canvas:not(#lyplus-webgl-canvas)'
    ).forEach(throttleAppleCanvas);
  });

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
          // Send raw TTML data to background for parsing
          songInfo.appleMusicTTML = ttmlData;
        }
      } catch (e) { }
    }

    window.postMessage({
      type: 'LYPLUS_SONG_CHANGED',
      songInfo
    }, '*');

    window.postMessage({
      type: 'LYPLUS_updateFullScreenAnimatedBg',
      artworkUrl
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
      window.postMessage({ type: 'LYPLUS_PLAYBACK_STATE', isPlaying: playing }, '*');
    });

    if (mkInstance.nowPlayingItem) handleSongChange();
    
    if (mkInstance.isPlaying) {
      playing = true;
      startTimeUpdater();
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