// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let playing = false;
  let lyricsSurfaceVisible = true;

  let lastSyncAudioTime = -1;
  let lastSyncPerfTime = null;
  let lastSyncPlaying = null;
  let lastSyncRate = 1;
  let driftCheckTimer = null;
  let settleTimer = null;
  let boundMediaEl = null;

  const DRIFT_THRESHOLD_SEC = 0.010;
  const DRIFT_CHECK_INTERVAL_MS = 1000;
  const SETTLE_SYNC_DELAY_MS = 120;

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
      } else if (nextVisible) {
        emitTimeSync(true);
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimeUpdater();
    } else if (hasActiveLyricsSurface()) {
      lyricsSurfaceVisible = true;
      if (playing) {
        startTimeUpdater();
      } else {
        emitTimeSync(true);
      }
    }
  }, { passive: true });

  sweepAppleCanvases();

  function getMediaElement() {
    try {
      const el = mkInstance?.services?.mediaItemPlayback?._currentPlayer?._targetElement;
      if (el) return el;
    } catch (e) {}
    return document.querySelector('#apple-music-player, audio, video') || null;
  }

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

  function getPlaybackRate() {
    const el = getMediaElement();
    const rate = el?.playbackRate || mkInstance?.playbackRate || 1;
    return (typeof rate === 'number' && rate > 0) ? rate : 1;
  }

  function isActuallyPlaying() {
    if (!mkInstance || !playing) return false;
    const el = getMediaElement();
    if (el && typeof el.paused === 'boolean') {
      return !el.paused && !el.ended && el.readyState >= 2;
    }
    return true;
  }

  function emitTimeSync(force = false) {
    if (!mkInstance) return;

    const now = performance.now();
    const actualTime = getPreciseTime();
    const rate = getPlaybackRate();
    const activePlaying = isActuallyPlaying();

    const expectedTime = (lastSyncPlaying && lastSyncPerfTime !== null)
      ? lastSyncAudioTime + ((now - lastSyncPerfTime) / 1000) * lastSyncRate
      : lastSyncAudioTime;
    const drift = Math.abs(actualTime - expectedTime);

    if (
      force ||
      activePlaying !== lastSyncPlaying ||
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
    }
  }

  function scheduleSettleCheck() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (mkInstance && playing && !document.hidden && hasActiveLyricsSurface()) {
        emitTimeSync(false);
      }
    }, SETTLE_SYNC_DELAY_MS);
  }

  const onMediaActiveSync = () => {
    playing = !!(mkInstance && mkInstance.isPlaying);
    emitTimeSync(true);
    scheduleSettleCheck();
  };

  const onMediaStateSync = () => {
    playing = !!(mkInstance && mkInstance.isPlaying);
    emitTimeSync(true);
  };

  const onMediaTimeUpdate = () => {
    if (mkInstance && playing && !document.hidden && hasActiveLyricsSurface()) {
      emitTimeSync(false);
    }
  };

  function bindMediaElement() {
    const el = getMediaElement();
    if (el === boundMediaEl) return;

    if (boundMediaEl) {
      const opts = { passive: true };
      boundMediaEl.removeEventListener('play', onMediaActiveSync, opts);
      boundMediaEl.removeEventListener('playing', onMediaActiveSync, opts);
      boundMediaEl.removeEventListener('seeked', onMediaActiveSync, opts);
      boundMediaEl.removeEventListener('ratechange', onMediaActiveSync, opts);
      boundMediaEl.removeEventListener('pause', onMediaStateSync, opts);
      boundMediaEl.removeEventListener('waiting', onMediaStateSync, opts);
      boundMediaEl.removeEventListener('stalled', onMediaStateSync, opts);
      boundMediaEl.removeEventListener('seeking', onMediaStateSync, opts);
      boundMediaEl.removeEventListener('ended', onMediaStateSync, opts);
      boundMediaEl.removeEventListener('timeupdate', onMediaTimeUpdate, opts);
    }

    boundMediaEl = el;
    if (boundMediaEl) {
      const opts = { passive: true };
      boundMediaEl.addEventListener('play', onMediaActiveSync, opts);
      boundMediaEl.addEventListener('playing', onMediaActiveSync, opts);
      boundMediaEl.addEventListener('seeked', onMediaActiveSync, opts);
      boundMediaEl.addEventListener('ratechange', onMediaActiveSync, opts);
      boundMediaEl.addEventListener('pause', onMediaStateSync, opts);
      boundMediaEl.addEventListener('waiting', onMediaStateSync, opts);
      boundMediaEl.addEventListener('stalled', onMediaStateSync, opts);
      boundMediaEl.addEventListener('seeking', onMediaStateSync, opts);
      boundMediaEl.addEventListener('ended', onMediaStateSync, opts);
      boundMediaEl.addEventListener('timeupdate', onMediaTimeUpdate, opts);
    }
  }

  async function fetchSyllableLyrics(songId, storefront, isMusicVideo = false) {
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

      const headers = {
        'Authorization': `Bearer ${developerToken}`,
        'Accept': 'application/json',
        'Origin': window.location.origin
      };

      if (mkInstance.musicUserToken) headers['Music-User-Token'] = mkInstance.musicUserToken;

      const entityType = isMusicVideo ? 'music-videos' : 'songs';
      const primaryUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/${entityType}/${songId}/syllable-lyrics?${queryParams.toString()}`;

      let res = await fetch(primaryUrl, { headers });
      if (!res.ok && isMusicVideo) {
        const fallbackUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}/syllable-lyrics?${queryParams.toString()}`;
        res = await fetch(fallbackUrl, { headers });
      }
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
    lastSyncAudioTime = 0;
    lastSyncPerfTime = null;
    bindMediaElement();

    const attrs = item.attributes;
    const artworkUrl = attrs.artwork?.url ? attrs.artwork.url.replace('{w}', '800').replace('{h}', '800') : '';
    const durationSec = (attrs.durationInMillis || 0) / 1000;
    const songId = attrs.playParams?.catalogId || attrs.playParams?.id || item.id;

    const isMusicVideo = attrs.playParams?.kind === 'music-videos';
    const songInfo = {
      title: attrs.name || '',
      artist: attrs.artistName || '',
      album: attrs.albumName || '',
      duration: durationSec,
      artwork: artworkUrl,
      appleId: songId,
      adamId: songId,
      isVideo: isMusicVideo,
      lyricsJSON: null
    };

    const storefront = mkInstance.storefrontId || 'us';

    if (attrs.hasLyrics) {
      const lyricsData = await fetchSyllableLyrics(songId, storefront, isMusicVideo);
      try {
        if (lyricsData?.data?.[0]) {
          const entry = lyricsData.data[0];
          const ttmlData = entry.attributes?.ttmlLocalizations || entry.attributes?.ttml;
          songInfo.appleMusicTTML = ttmlData;
          if (entry.id) songInfo.lyricsId = entry.id;
        }
      } catch (e) {}
    }

    window.postMessage({
      type: 'LYPLUS_SONG_CHANGED',
      songInfo
    }, '*');

    emitTimeSync(true);

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
          const targetTime = event.data.time;
          mkInstance.seekToTime(targetTime);
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
        } catch (e) {}
      }
    });
  }

  function startTimeUpdater() {
    stopTimeUpdater();
    bindMediaElement();
    emitTimeSync(true);
    scheduleSettleCheck();

    driftCheckTimer = setInterval(() => {
      if (mkInstance && playing && !document.hidden && hasActiveLyricsSurface()) {
        bindMediaElement();
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

  function init(instance) {
    mkInstance = instance;
    bindMediaElement();

    instance.addEventListener('nowPlayingItemDidChange', () => {
      handleSongChange();
    });

    instance.addEventListener('playbackStateDidChange', () => {
      playing = mkInstance.isPlaying;
      bindMediaElement();
      emitTimeSync(true);
      if (playing && hasActiveLyricsSurface()) startTimeUpdater();
      else stopTimeUpdater();
      window.postMessage({ type: 'LYPLUS_PLAYBACK_STATE', isPlaying: playing }, '*');
    });

    instance.addEventListener('playbackTimeDidChange', () => {
      if (playing && !document.hidden && hasActiveLyricsSurface()) {
        bindMediaElement();
        emitTimeSync(false);
      }
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