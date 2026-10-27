// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let timeUpdateFrame = null;
  let playing = false;

  const killedCanvases = new WeakSet();
  const killedContexts = new WeakSet();

  function isLyricsModalElement(el) {
    if (!el || !(el instanceof Element)) return false;
    return !!(
      el.id === 'lyplus-patch-container' ||
      el.id === 'lyrics-plus-container' ||
      el.classList?.contains('lyplus-blur-container') ||
      el.closest?.('#lyplus-patch-container') ||
      el.closest?.('#lyrics-plus-container') ||
      el.closest?.('.lyplus-blur-container')
    );
  }

  try {
    const origObserve = MutationObserver.prototype.observe;
    if (origObserve && !origObserve.__lyplusPatched) {
      const patchedObserve = function (target, options) {
        if (
          target === document.body &&
          options &&
          options.attributes === true &&
          options.characterData === true &&
          options.childList === true &&
          options.subtree === true &&
          typeof this.__lyplusWrappedCallback === 'function'
        ) {
          this.__lyplusIsPolyfillRO = true;
          return;
        }
        return origObserve.call(this, target, options);
      };
      patchedObserve.__lyplusPatched = true;
      MutationObserver.prototype.observe = patchedObserve;

      const OrigMutationObserver = window.MutationObserver;
      const PatchedMutationObserver = function (callback) {
        let moInstance = null;
        const wrappedCallback = function (mutations, observer) {
          if (moInstance && moInstance.__lyplusIsPolyfillRO) {
            return;
          }
          if (Array.isArray(mutations) && mutations.length > 0) {
            let allInternal = true;
            for (let i = 0; i < mutations.length; i++) {
              if (!isLyricsModalElement(mutations[i].target)) {
                allInternal = false;
                break;
              }
            }
            if (allInternal) return;
          }
          return callback.call(this, mutations, observer);
        };
        moInstance = new OrigMutationObserver(wrappedCallback);
        moInstance.__lyplusWrappedCallback = wrappedCallback;
        return moInstance;
      };
      PatchedMutationObserver.prototype = OrigMutationObserver.prototype;
      Object.setPrototypeOf(PatchedMutationObserver, OrigMutationObserver);
      window.MutationObserver = PatchedMutationObserver;
    }
  } catch (e) {}

  try {
    const origAddEventListener = EventTarget.prototype.addEventListener;
    if (origAddEventListener && !origAddEventListener.__lyplusPatched) {
      const roNoisyEvents = new Set([
        'transitionend',
        'animationend',
        'animationstart',
        'animationiteration',
        'keyup',
        'keydown',
        'mouseup',
        'mousedown',
        'mouseover',
        'mouseout',
        'blur',
        'focus'
      ]);
      const patchedAddEventListener = function (type, listener, options) {
        if (
          (this === window || this === document) &&
          options === true &&
          roNoisyEvents.has(type) &&
          typeof listener === 'function'
        ) {
          const fnStr = listener.toString();
          if (fnStr.includes('.schedule()')) {
            return;
          }
          const wrappedCapture = function (ev) {
            if (ev && isLyricsModalElement(ev.target)) return;
            return listener.apply(this, arguments);
          };
          return origAddEventListener.call(this, type, wrappedCapture, options);
        }
        return origAddEventListener.call(this, type, listener, options);
      };
      patchedAddEventListener.__lyplusPatched = true;
      EventTarget.prototype.addEventListener = patchedAddEventListener;
    }
  } catch (e) {}

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

  try {
    const origGetBCR = HTMLCanvasElement.prototype.getBoundingClientRect;
    if (origGetBCR && !origGetBCR.__lyplusPatched) {
      const patchedGetBCR = function () {
        if (isAppleLyricsCanvas(this)) {
          return new DOMRect(0, 0, 1, 1);
        }
        return origGetBCR.apply(this, arguments);
      };
      patchedGetBCR.__lyplusPatched = true;
      HTMLCanvasElement.prototype.getBoundingClientRect = patchedGetBCR;
    }
  } catch (e) {}

  try {
    if (!Object.getOwnPropertyDescriptor(Object.prototype, 'filters')) {
      const SymFilters = Symbol('lyplus_filters');
      Object.defineProperty(Object.prototype, 'filters', {
        configurable: true,
        enumerable: false,
        get: function () {
          return this[SymFilters];
        },
        set: function (val) {
          if (
            Array.isArray(val) &&
            val.length === 7 &&
            this &&
            Array.isArray(this.children) &&
            typeof this.renderAdvanced === 'function'
          ) {
            for (let i = 0; i < val.length; i++) {
              try {
                if (val[i]) val[i].enabled = false;
              } catch (e) {}
            }
            this[SymFilters] = null;
            this.visible = false;
            this.renderable = false;
            try {
              if (this.parent) {
                this.parent.visible = false;
                this.parent.renderable = false;
                this.parent.render = function () {};
              }
            } catch (e) {}
            return;
          }
          this[SymFilters] = val;
        }
      });
    }
  } catch (e) {}

  try {
    const SymMaxFPS = Symbol('lyplus_maxFPS');
    Object.defineProperty(Object.prototype, 'maxFPS', {
      configurable: true,
      enumerable: false,
      get: function () {
        return this[SymMaxFPS] ?? 0;
      },
      set: function (val) {
        this[SymMaxFPS] = val;
        if (
          val === 15 &&
          this &&
          typeof this._tick === 'function' &&
          typeof this.stop === 'function' &&
          typeof this.add === 'function'
        ) {
          try {
            this.autoStart = false;
            this.stop();
            if (this._requestId) {
              cancelAnimationFrame(this._requestId);
              this._requestId = null;
            }
            this.start = function () {};
            this._requestIfNeeded = function () {};
            this._startIfPossible = function () {};
            this.add = function () { return this; };
            this.addOnce = function () { return this; };
            this.update = function () {};
          } catch (e) {}
        }
      }
    });
  } catch (e) {}

  function neutralizeAppleGLContext(gl) {
    if (!gl || killedContexts.has(gl)) return;
    const canvas = gl.canvas;
    if (!isAppleLyricsCanvas(canvas)) return;

    killedContexts.add(gl);

    try {
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
    } catch (e) {}

    const noop = function () {};
    const heavyMethods = [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
      'drawRangeElements',
      'clear',
      'blitFramebuffer',
      'texImage2D',
      'texSubImage2D',
      'texImage3D',
      'texSubImage3D',
      'renderbufferStorage',
      'renderbufferStorageMultisample',
      'flush',
      'finish'
    ];
    for (let i = 0; i < heavyMethods.length; i++) {
      const m = heavyMethods[i];
      if (typeof gl[m] === 'function') {
        try {
          gl[m] = noop;
        } catch (e) {}
      }
    }
  }

  function hookWebGLPrototype(Proto) {
    if (!Proto || Proto.__lyplusHooked) return;
    Proto.__lyplusHooked = true;

    ['useProgram', 'bindFramebuffer', 'clear'].forEach((methodName) => {
      const orig = Proto[methodName];
      if (typeof orig !== 'function') return;
      Proto[methodName] = function () {
        if (this && this.canvas && this.canvas.id !== 'lyplus-webgl-canvas') {
          if (killedContexts.has(this) || isAppleLyricsCanvas(this.canvas)) {
            neutralizeAppleGLContext(this);
            return;
          }
        }
        return orig.apply(this, arguments);
      };
    });
  }

  try {
    if (typeof WebGL2RenderingContext !== 'undefined') {
      hookWebGLPrototype(WebGL2RenderingContext.prototype);
    }
    if (typeof WebGLRenderingContext !== 'undefined') {
      hookWebGLPrototype(WebGLRenderingContext.prototype);
    }
  } catch (e) {}

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

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'LYPLUS_THROTTLE_APPLE_CANVAS') return;
    sweepAppleCanvases();
  });

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
      // did they changed? for now ighore iwodbiqwabcjwsbcijwsk
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