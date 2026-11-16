// src/inject/applemusic/songTracker.js

(function () {
  let mkInstance = null;
  let lastProcessedID = null;
  let playing = false;
  let lyricsSurfaceVisible = false;

  let lastSyncAudioTime = -1;
  let lastSyncPerfTime = null;
  let lastSyncPlaying = null;
  let lastSyncRate = 1;
  let driftCheckTimer = null;
  let settleTimer = null;
  let boundMediaEl = null;
  let cachedSurfaceEl = null;
  let lastSurfaceQueryTime = 0;

  const DRIFT_THRESHOLD_SEC = 0.010;
  const DRIFT_CHECK_INTERVAL_MS = 1000;
  const SETTLE_SYNC_DELAY_MS = 120;

  const killedCanvases = new WeakSet();

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

  function hasActiveLyricsSurface(forceQuery = false) {
    if (document.hidden) return false;
    if (cachedSurfaceEl && cachedSurfaceEl.isConnected) {
      lyricsSurfaceVisible = true;
      return true;
    }
    const now = performance.now();
    if (!forceQuery && now - lastSurfaceQueryTime < 250) {
      return lyricsSurfaceVisible;
    }
    lastSurfaceQueryTime = now;
    cachedSurfaceEl =
      document.querySelector('article[data-testid="lyrics-fullscreen-modal"]') ||
      document.querySelector('[data-testid="lyrics-sidebar"]') ||
      null;
    lyricsSurfaceVisible = !!cachedSurfaceEl;
    return lyricsSurfaceVisible;
  }

  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'LYPLUS_THROTTLE_APPLE_CANVAS') {
      sweepAppleCanvases();
      return;
    }
    if (event.data.type === 'LYPLUS_SURFACE_VISIBILITY') {
      const nextVisible = !!event.data.visible;
      lyricsSurfaceVisible = nextVisible;
      if (!nextVisible) {
        cachedSurfaceEl = null;
        stopTimeUpdater();
      } else {
        hasActiveLyricsSurface(true);
        bindMediaElement();
        playing = isMediaOrPlayerPlaying();
        if (playing) {
          if (!driftCheckTimer) {
            startTimeUpdater();
          } else {
            emitTimeSync(true);
            scheduleSettleCheck();
          }
        } else {
          emitTimeSync(true);
        }
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimeUpdater();
    } else if (hasActiveLyricsSurface(true)) {
      bindMediaElement();
      playing = isMediaOrPlayerPlaying();
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
    return (
      document.getElementById('apple-music-player') ||
      document.querySelector('audio#apple-music-player, audio') ||
      document.querySelector('video:not(amp-ambient-video video):not([data-loop])') ||
      null
    );
  }

  function getPreciseTime() {
    if (!mkInstance) return 0;

    try {
      const player = mkInstance.services?.mediaItemPlayback?._currentPlayer;
      const mediaElement = player?._targetElement;

      if (mediaElement && typeof mediaElement.currentTime === 'number' && Number.isFinite(mediaElement.currentTime)) {
        const rawTime = mediaElement.currentTime;
        const offset = player._buffer?.currentTimestampOffset || 0;
        return rawTime - offset;
      }
    } catch (e) {}

    const mkTime = mkInstance.currentPlaybackTime || 0;
    const el = getMediaElement();
    if (el && typeof el.currentTime === 'number' && Number.isFinite(el.currentTime) && el.currentTime > 0) {
      if (mkTime === 0 || Math.abs(el.currentTime - mkTime) < 2.5) {
        return el.currentTime;
      }
    }

    return mkTime;
  }

  function getPlaybackRate() {
    const el = getMediaElement();
    const rate = el?.playbackRate || mkInstance?.playbackRate || 1;
    return (typeof rate === 'number' && rate > 0) ? rate : 1;
  }

  function isMediaOrPlayerPlaying() {
    if (!mkInstance) return false;
    const el = getMediaElement();
    if (el && typeof el.paused === 'boolean') {
      if (!el.paused && !el.ended && el.readyState >= 2) return true;
      if (el.paused || el.ended) return false;
    }
    return !!mkInstance.isPlaying;
  }

  function isActuallyPlaying() {
    return isMediaOrPlayerPlaying();
  }

  function emitTimeSync(force = false) {
    if (!mkInstance) return;

    const now = performance.now();
    const actualTime = getPreciseTime();
    const rate = getPlaybackRate();
    const activePlaying = isActuallyPlaying();
    playing = activePlaying;

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
      if (mkInstance && isMediaOrPlayerPlaying() && !document.hidden && hasActiveLyricsSurface()) {
        emitTimeSync(false);
      }
    }, SETTLE_SYNC_DELAY_MS);
  }

  const onMediaActiveSync = () => {
    playing = isMediaOrPlayerPlaying();
    emitTimeSync(true);
    if (playing && hasActiveLyricsSurface() && !driftCheckTimer) {
      startTimeUpdater();
    } else {
      scheduleSettleCheck();
    }
  };

  const onMediaStateSync = () => {
    playing = isMediaOrPlayerPlaying();
    emitTimeSync(true);
  };

  const onMediaTimeUpdate = () => {
    if (!mkInstance || document.hidden) return;
    playing = isMediaOrPlayerPlaying();
    if (playing && hasActiveLyricsSurface()) {
      emitTimeSync(false);
    }
  };

  function bindMediaElement() {
    if (boundMediaEl && boundMediaEl.isConnected && boundMediaEl.id === 'apple-music-player') {
      return;
    }
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
      if (mkInstance && !document.hidden && hasActiveLyricsSurface()) {
        bindMediaElement();
        playing = isMediaOrPlayerPlaying();
        if (playing) {
          emitTimeSync(false);
        }
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
      bindMediaElement();
      playing = isMediaOrPlayerPlaying();
      emitTimeSync(true);
      if (playing && hasActiveLyricsSurface(true)) startTimeUpdater();
      else stopTimeUpdater();
      window.postMessage({ type: 'LYPLUS_PLAYBACK_STATE', isPlaying: playing }, '*');
    });

    instance.addEventListener('playbackTimeDidChange', () => {
      if (!document.hidden && hasActiveLyricsSurface()) {
        bindMediaElement();
        playing = isMediaOrPlayerPlaying();
        if (playing) {
          emitTimeSync(false);
        }
      }
    });

    if (mkInstance.nowPlayingItem) handleSongChange();

    if (isMediaOrPlayerPlaying()) {
      playing = true;
      if (hasActiveLyricsSurface(true)) startTimeUpdater();
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