// src/modules/applemusic/appleUIOptimizer.js

(function () {
  'use strict';

  const STYLE_ID = 'lyplus-apple-ui-optimizer-styles';
  const MAIN_FLAG = '__lyplusAppleOptMain';
  const DOM_FLAG = '__lyplusAppleOptDOM';

  const isIsolatedWorld = (() => {
    try {
      const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
      return !!(api && api.runtime && api.runtime.id && typeof api.runtime.getURL === 'function');
    } catch (_) {
      return false;
    }
  })();

  function initMainWorld() {
    if (window[MAIN_FLAG]) return;
    window[MAIN_FLAG] = true;

    if (document.documentElement) {
      document.documentElement.setAttribute('data-lyplus-optimizer-main-injected', 'true');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement?.setAttribute('data-lyplus-optimizer-main-injected', 'true');
      }, { once: true });
    }

    const killedCanvases = new WeakSet();
    const killedContexts = new WeakSet();
    const killedAmpLyrics = new WeakSet();
    const fnKindCache = new WeakMap();
    const activeHlsSessions = new Set();

    const fnToString = Function.prototype.toString;
    const origDateNow = Date.now.bind(Date);
    const origPerfNow = performance.now.bind(performance);
    const origSetTimeout = unwrapSentry(window.setTimeout);

    function safeFnString(fn) {
      if (typeof fn !== 'function') return '';
      try {
        return fnToString.call(fn);
      } catch (_) {
        return '';
      }
    }

    function unwrapSentry(fn) {
      let cur = fn;
      for (let i = 0; i < 4 && typeof cur === 'function'; i++) {
        if (typeof cur.__sentry_original__ === 'function' && cur.__sentry_original__ !== cur) {
          cur = cur.__sentry_original__;
        } else {
          break;
        }
      }
      return cur;
    }

    function isSentryWrapper(fn) {
      if (typeof fn !== 'function') return false;
      if (typeof fn.__sentry_original__ === 'function' || fn.__sentry_wrapped__) return true;
      const s = safeFnString(fn);
      return s.includes('__sentry_') || (s.includes('try{return ') && s.includes('.apply(this,arguments)}catch('));
    }

    function lockPatchedMethod(obj, prop, patchedFn) {
      let current = patchedFn;
      try {
        Object.defineProperty(obj, prop, {
          configurable: true,
          enumerable: true,
          get() {
            return current;
          },
          set(val) {
            if (typeof val === 'function' && !isSentryWrapper(val)) {
              current = val;
            }
          }
        });
      } catch (_) {
        try { obj[prop] = patchedFn; } catch (__) {}
      }
    }

    function isLyplusNode(node) {
      if (!node || !(node instanceof Element)) return false;
      return !!(
        node.id === 'lyplus-patch-container' ||
        node.id === 'lyrics-plus-container' ||
        node.id === 'lyrics-plus-buttons-wrapper' ||
        node.id === 'lyplus-webgl-canvas' ||
        node.classList?.contains('lyplus-blur-container') ||
        node.closest?.('#lyplus-patch-container, #lyrics-plus-container, .lyplus-blur-container, #lyrics-plus-buttons-wrapper')
      );
    }

    function isAppleCanvas(canvas) {
      if (!canvas || !(canvas instanceof HTMLCanvasElement)) return false;
      if (canvas.id === 'lyplus-webgl-canvas') return false;
      if (killedCanvases.has(canvas)) return true;
      if (
        canvas.classList?.contains('svelte-2zgn0e') ||
        canvas.closest?.('[data-testid="now-playing-backdrop"], .dt-lyrics__platter, article[data-testid="lyrics-fullscreen-modal"]')
      ) {
        killedCanvases.add(canvas);
        return true;
      }
      return false;
    }

    function classifyRAFCallback(cb) {
      let kind = fnKindCache.get(cb);
      if (kind !== undefined) return kind;
      const s = safeFnString(cb);
      if (s.includes('_requestId') && s.includes('.started') && s.includes('.update(')) {
        kind = 1;
      } else if (s.includes('activeTargets') && s.includes('skippedTargets')) {
        kind = 2;
      } else if (s.includes('RAF_FN_LIMIT_MS')) {
        kind = 3;
      } else {
        kind = 0;
      }
      fnKindCache.set(cb, kind);
      return kind;
    }

    try {
      const origRAF = unwrapSentry(window.requestAnimationFrame);
      if (typeof origRAF === 'function' && !origRAF.__lyplusPatched) {
        const raf = function (cb) {
          const clean = unwrapSentry(cb);
          if (typeof clean !== 'function') {
            return origRAF.call(window, cb);
          }

          const kind = classifyRAFCallback(clean);
          if (kind === 1) {
            return 0;
          }

          if (kind === 2) {
            return origRAF.call(window, function (ts) {
              let dateCallCount = 0;
              const prevDateNow = Date.now;
              Date.now = function () {
                dateCallCount++;
                if (dateCallCount === 1) {
                  return origDateNow() + 100000;
                }
                return origDateNow();
              };
              try {
                return clean.call(this, ts);
              } finally {
                Date.now = prevDateNow;
              }
            });
          }

          if (kind === 3) {
            return origRAF.call(window, function (ts) {
              let perfCallCount = 0;
              const prevPerfNow = performance.now;
              performance.now = function () {
                perfCallCount++;
                if (perfCallCount >= 2) {
                  return origPerfNow() + 10;
                }
                return origPerfNow();
              };
              try {
                return clean.call(this, ts);
              } finally {
                performance.now = prevPerfNow;
              }
            });
          }

          return origRAF.call(window, clean);
        };
        raf.__lyplusPatched = true;
        lockPatchedMethod(window, 'requestAnimationFrame', raf);
      }

      if (typeof origSetTimeout === 'function' && !origSetTimeout.__lyplusPatched) {
        const patchedSetTimeout = function (cb, delay) {
          const clean = typeof cb === 'function' ? unwrapSentry(cb) : cb;
          if (arguments.length <= 2) {
            return origSetTimeout.call(window, clean, delay);
          }
          const args = Array.prototype.slice.call(arguments);
          args[0] = clean;
          return origSetTimeout.apply(window, args);
        };
        patchedSetTimeout.__lyplusPatched = true;
        lockPatchedMethod(window, 'setTimeout', patchedSetTimeout);
      }

      const origSetInterval = unwrapSentry(window.setInterval);
      if (typeof origSetInterval === 'function' && !origSetInterval.__lyplusPatched) {
        const patchedSetInterval = function (cb, delay) {
          const clean = typeof cb === 'function' ? unwrapSentry(cb) : cb;
          if (arguments.length <= 2) {
            return origSetInterval.call(window, clean, delay);
          }
          const args = Array.prototype.slice.call(arguments);
          args[0] = clean;
          return origSetInterval.apply(window, args);
        };
        patchedSetInterval.__lyplusPatched = true;
        lockPatchedMethod(window, 'setInterval', patchedSetInterval);
      }
    } catch (_) {}

    try {
      const OrigPO = window.PerformanceObserver;
      if (OrigPO && !OrigPO.__lyplusPatched) {
        const noop = function () {};
        const emptyRecords = function () { return []; };
        const PatchedPO = function () {
          return Object.create(OrigPO.prototype, {
            observe: { value: noop },
            disconnect: { value: noop },
            takeRecords: { value: emptyRecords }
          });
        };
        PatchedPO.supportedEntryTypes = OrigPO.supportedEntryTypes || [];
        PatchedPO.__lyplusPatched = true;
        PatchedPO.prototype = OrigPO.prototype;
        window.PerformanceObserver = PatchedPO;
      }
    } catch (_) {}

    try {
      const OrigMO = window.MutationObserver;
      const origObserve = OrigMO?.prototype?.observe;

      if (OrigMO && origObserve && !origObserve.__lyplusPatched) {
        const patchedObserve = function (target, options) {
          if (target && target.nodeType === 3) {
            this.__lyplusTextNodeObserver = true;
            return origObserve.call(this, target, options);
          }
          if (options) {
            const isRoot =
              target === document ||
              target === document.documentElement ||
              target === document.body;

            if (
              isRoot &&
              options.subtree === true &&
              options.attributes === true &&
              (options.characterData === true || options.attributeOldValue === true)
            ) {
              this.__lyplusBlocked = true;
              return;
            }

            if (
              target instanceof Element &&
              options.attributes === true &&
              !options.childList &&
              !options.subtree &&
              !options.attributeFilter &&
              target.matches?.('.shelf-grid__list-item, .navigation-item, [data-testid="track-list-item"]')
            ) {
              this.__lyplusBlocked = true;
              return;
            }
          }
          return origObserve.call(this, target, options);
        };
        patchedObserve.__lyplusPatched = true;
        OrigMO.prototype.observe = patchedObserve;

        const PatchedMO = function (callback) {
          let instance = null;
          const cleanCb = unwrapSentry(callback);
          const wrapped = function (mutations, observer) {
            if (instance && instance.__lyplusBlocked) return;
            if (instance && instance.__lyplusTextNodeObserver) {
              return cleanCb.call(this, mutations, observer);
            }
            if (Array.isArray(mutations) && mutations.length > 0) {
              let hasExternal = false;
              for (let i = 0; i < mutations.length; i++) {
                if (!isLyplusNode(mutations[i].target)) {
                  hasExternal = true;
                  break;
                }
              }
              if (!hasExternal) return;
            }
            return cleanCb.call(this, mutations, observer);
          };
          instance = new OrigMO(wrapped);
          return instance;
        };
        PatchedMO.prototype = OrigMO.prototype;
        Object.setPrototypeOf(PatchedMO, OrigMO);
        window.MutationObserver = PatchedMO;
      }
    } catch (_) {}

    try {
      const OrigRO = window.ResizeObserver;
      const origROObserve = OrigRO?.prototype?.observe;

      if (OrigRO && origROObserve && !origROObserve.__lyplusPatched) {
        const patchedROObserve = function (target, options) {
          if (target instanceof Element && target.classList.contains('multiline-clamp')) {
            return;
          }
          return origROObserve.call(this, target, options);
        };
        patchedROObserve.__lyplusPatched = true;
        OrigRO.prototype.observe = patchedROObserve;
      }
    } catch (_) {}

    try {
      const OrigIO = window.IntersectionObserver;
      if (OrigIO && !OrigIO.__lyplusPatched) {
        const noop = function () {};
        const emptyRecords = function () { return []; };

        const PatchedIO = function (callback, options) {
          const clean = unwrapSentry(callback);
          if (typeof clean === 'function') {
            const fnStr = safeFnString(clean);

            if (
              options?.root === document ||
              fnStr.includes('extractImpressionInfo') ||
              fnStr.includes('snapshotImpressions') ||
              (options && options.threshold === 0.5 && !options.root && fnStr.includes('.isIntersecting)') && fnStr.length < 120)
            ) {
              return Object.create(OrigIO.prototype, {
                observe: { value: noop },
                unobserve: { value: noop },
                disconnect: { value: noop },
                takeRecords: { value: emptyRecords },
                root: { value: options?.root ?? null },
                rootMargin: { value: options?.rootMargin ?? '0px' },
                thresholds: { value: [options?.threshold ?? 0] }
              });
            }
          }
          return new OrigIO(clean, options);
        };
        PatchedIO.__lyplusPatched = true;
        PatchedIO.prototype = OrigIO.prototype;
        Object.setPrototypeOf(PatchedIO, OrigIO);
        window.IntersectionObserver = PatchedIO;
      }
    } catch (_) {}

    function patchBasePlayerListener(listener) {
      if (!listener || typeof listener !== 'object' || typeof listener.handleEvent !== 'function') return;
      const proto = Object.getPrototypeOf(listener);
      const target = (proto && typeof proto.handleEvent === 'function') ? proto : listener;
      if (target.handleEvent.__lyplusPatched) return;

      const origHandleEvent = target.handleEvent;
      const patchedHandleEvent = function (ev) {
        if (ev && ev.type === 'timeupdate') {
          const buf = this._buffer;
          if (buf) {
            buf.currentTime = this.currentPlaybackTime;
          }
          const sec = Math.floor(this.currentPlaybackTime || 0);
          const dur = Math.floor(this.currentPlaybackDuration || 0);
          if (this.__lyplusLastTimeSec === sec && this.__lyplusLastTimeDur === dur) {
            return;
          }
          this.__lyplusLastTimeSec = sec;
          this.__lyplusLastTimeDur = dur;
        } else if (ev && ev.type === 'progress') {
          const now = origDateNow();
          if (this.__lyplusLastProgTs && now - this.__lyplusLastProgTs < 1000) {
            try { this.handleBufferStart?.(); } catch (_) {}
            return;
          }
          this.__lyplusLastProgTs = now;
        } else if (ev && (ev.type === 'seeked' || ev.type === 'playing' || ev.type === 'pause' || ev.type === 'durationchange' || ev.type === 'loadedmetadata')) {
          this.__lyplusLastTimeSec = -1;
        }
        return origHandleEvent.apply(this, arguments);
      };
      patchedHandleEvent.__lyplusPatched = true;
      target.handleEvent = patchedHandleEvent;
    }

    try {
      const origAddEventListener = unwrapSentry(EventTarget.prototype.addEventListener);
      const origRemoveEventListener = unwrapSentry(EventTarget.prototype.removeEventListener);
      if (origAddEventListener && !origAddEventListener.__lyplusPatched) {
        const roNoisyEvents = new Set([
          'load', 'transitionend', 'animationend', 'animationstart', 'animationiteration',
          'keyup', 'keydown', 'mouseup', 'mousedown', 'mouseover', 'mouseout', 'blur', 'focus'
        ]);
        const focusVisibleDedupe = new Set();

        const patchedAddEventListener = function (type, listener, options) {
          if (listener && typeof listener === 'object' && typeof listener.handleEvent === 'function') {
            if (this instanceof HTMLMediaElement) {
              patchBasePlayerListener(listener);
            }
            return origAddEventListener.call(this, type, listener, options);
          }

          if (typeof listener !== 'function') {
            return origAddEventListener.call(this, type, listener, options);
          }

          const clean = unwrapSentry(listener);

          if (this instanceof HTMLVideoElement) {
            if (type === 'pause') {
              const fnStr = safeFnString(clean);
              if (fnStr.includes('syncPlayingState') || fnStr.includes('.paused') || fnStr.includes('bound ')) {
                const guardedPause = function (ev) {
                  if (this.getAttribute('data-lyplus-paused') === 'true') {
                    try { this.__lyplusHls?.stopLoad?.(); } catch (_) {}
                    return;
                  }
                  if (
                    this.hasAttribute('data-loop') &&
                    (this.ended || (this.duration > 0 && this.currentTime >= this.duration - 0.35))
                  ) {
                    return;
                  }
                  return clean.call(this, ev);
                };
                try { clean.__lyplusFilteredMsg = guardedPause; } catch (_) {}
                return origAddEventListener.call(this, type, guardedPause, options);
              }
            } else if (type === 'ended') {
              const guardedEnded = function (ev) {
                if (this.getAttribute('data-lyplus-paused') === 'true') {
                  return;
                }
                const res = clean.call(this, ev);
                if (this.hasAttribute('data-loop') && this.paused && !document.hidden) {
                  try {
                    const p = this.play();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                  } catch (_) {}
                }
                return res;
              };
              try { clean.__lyplusFilteredMsg = guardedEnded; } catch (_) {}
              return origAddEventListener.call(this, type, guardedEnded, options);
            }
          }

          if (this === window && type === 'message') {
            const fnStr = safeFnString(clean);
            if (!fnStr.includes('LYPLUS_') && !isSentryWrapper(clean)) {
              const filtered = function (ev) {
                const d = ev?.data;
                if (d && typeof d.type === 'string' && d.type.startsWith('LYPLUS_')) return;
                return clean.call(this, ev);
              };
              try { clean.__lyplusFilteredMsg = filtered; } catch (_) {}
              return origAddEventListener.call(this, type, filtered, options);
            }
          }

          if (this === window && type === 'blur') {
            const fnStr = safeFnString(clean);
            if (fnStr.includes('focusMethod=void 0')) {
              if (focusVisibleDedupe.has('win_blur')) return;
              focusVisibleDedupe.add('win_blur');
            }
          }

          const isCapture = options === true || (options && typeof options === 'object' && options.capture === true);
          if (
            isCapture &&
            (this === window || this === document || this === document.documentElement || this === document.body) &&
            roNoisyEvents.has(type)
          ) {
            const fnStr = safeFnString(clean);
            if (
              fnStr.includes('repeat(') ||
              fnStr.includes('.run(') ||
              fnStr.includes('.schedule(') ||
              (fnStr.length < 120 && /\b[a-zA-Z_$][\w$]*\.(?:run|schedule)\(/.test(fnStr))
            ) {
              return;
            }
            if (
              this === document.documentElement &&
              (fnStr.includes('focusMethod') || fnStr.includes('removeAttribute(this.attr)'))
            ) {
              const key = 'doc_' + type;
              if (focusVisibleDedupe.has(key)) return;
              focusVisibleDedupe.add(key);
            }
          }

          if (isCapture && this === document && (type === 'mousemove' || type === 'focusin')) {
            const fnStr = safeFnString(clean);
            if (fnStr.includes('setTimeout') && fnStr.includes('clearTimeout')) {
              const guarded = function (ev) {
                const takeover = document.querySelector('amp-window-takeover');
                if (takeover && takeover.getAttribute('aria-hidden') === 'true') return;
                return clean.call(this, ev);
              };
              try { clean.__lyplusFilteredMsg = guarded; } catch (_) {}
              return origAddEventListener.call(this, type, guarded, options);
            }
          }

          if ((type === 'scroll' || type === 'wheel' || type === 'touchstart' || type === 'touchmove') && options === undefined) {
            return origAddEventListener.call(this, type, clean, { passive: true });
          }

          return origAddEventListener.call(this, type, clean, options);
        };
        patchedAddEventListener.__lyplusPatched = true;
        lockPatchedMethod(EventTarget.prototype, 'addEventListener', patchedAddEventListener);

        if (origRemoveEventListener && !origRemoveEventListener.__lyplusPatched) {
          const patchedRemoveEventListener = function (type, listener, options) {
            if (typeof listener === 'function') {
              const clean = unwrapSentry(listener);
              const targetFn = clean.__lyplusFilteredMsg || listener.__lyplusFilteredMsg || clean;
              return origRemoveEventListener.call(this, type, targetFn, options);
            }
            return origRemoveEventListener.call(this, type, listener, options);
          };
          patchedRemoveEventListener.__lyplusPatched = true;
          lockPatchedMethod(EventTarget.prototype, 'removeEventListener', patchedRemoveEventListener);
        }
      }
    } catch (_) {}

    try {
      const origPlay = HTMLMediaElement.prototype.play;
      if (typeof origPlay === 'function' && !origPlay.__lyplusPatched) {
        const patchedPlay = function () {
          if (this instanceof HTMLVideoElement) {
            const isPausedByOpt = this.getAttribute('data-lyplus-paused') === 'true';
            const inModal = !!this.closest?.('article[data-testid="lyrics-fullscreen-modal"]');
            const coveredByModal = document.body?.classList?.contains('lyplus-fullscreen-modal-open') && !inModal && !!this.closest?.('amp-ambient-video');
            if (isPausedByOpt || coveredByModal || document.hidden) {
              this.setAttribute('data-lyplus-paused', 'true');
              this.setAttribute('data-lyplus-was-playing', 'true');
              try { this.__lyplusHls?.stopLoad?.(); } catch (_) {}
              return Promise.resolve();
            }
            try { this.__lyplusHls?.startLoad?.(); } catch (_) {}
            try {
              const p = origPlay.apply(this, arguments);
              if (p && typeof p.catch === 'function' && this.hasAttribute('data-loop')) {
                p.catch(() => {});
              }
              return p;
            } catch (_) {
              return Promise.resolve();
            }
          }
          return origPlay.apply(this, arguments);
        };
        patchedPlay.__lyplusPatched = true;
        HTMLMediaElement.prototype.play = patchedPlay;
      }
    } catch (_) {}

    function patchMseBuffer(mse) {
      if (!mse || typeof mse !== 'object') return mse;
      const proto = Object.getPrototypeOf(mse);
      if (proto && typeof proto.loadSegment === 'function' && !proto.loadSegment.__lyplusPatched) {
        const origLoadSegment = proto.loadSegment;
        const patchedLoadSegment = function () {
          const idx = this.segmentIndexToFetch;
          if (
            typeof idx !== 'number' ||
            idx <= 2 ||
            this.seekResolver ||
            this.seekWhenUpdated ||
            this.isAtEndOfStream
          ) {
            if (this.__lyplusSegmentTimer) {
              clearTimeout(this.__lyplusSegmentTimer);
              this.__lyplusSegmentTimer = 0;
            }
            return origLoadSegment.apply(this, arguments);
          }
          const bufferedEnd = Number(this.endOfBufferTime) || 0;
          const currentTime = Number(this.element?.currentTime) || 0;
          const ahead = bufferedEnd - currentTime;
          if (ahead > 15) {
            if (this.__lyplusSegmentTimer) {
              return Promise.resolve();
            }
            const delay = ahead > 35 ? 220 : 120;
            return new Promise((resolve) => {
              this.__lyplusSegmentTimer = origSetTimeout.call(window, () => {
                this.__lyplusSegmentTimer = 0;
                try {
                  resolve(origLoadSegment.call(this));
                } catch (_) {
                  resolve();
                }
              }, delay);
            });
          }
          return origLoadSegment.apply(this, arguments);
        };
        patchedLoadSegment.__lyplusPatched = true;
        proto.loadSegment = patchedLoadSegment;
      }
      return mse;
    }

    try {
      let currentMseBuffer = window.mseBuffer ? patchMseBuffer(window.mseBuffer) : undefined;
      Object.defineProperty(window, 'mseBuffer', {
        configurable: true,
        enumerable: true,
        get() {
          return currentMseBuffer;
        },
        set(val) {
          currentMseBuffer = patchMseBuffer(val);
        }
      });
    } catch (_) {}

    try {
      const origQSA = Element.prototype.querySelectorAll;
      if (origQSA && !origQSA.__lyplusPatched) {
        const patchedQSA = function (selector) {
          if (
            selector === 'a, button' &&
            (this.classList?.contains('shelf-grid__list-item') ||
             this.parentElement?.classList?.contains('shelf-grid__list-item'))
          ) {
            return [];
          }
          return origQSA.call(this, selector);
        };
        patchedQSA.__lyplusPatched = true;
        Element.prototype.querySelectorAll = patchedQSA;
      }
    } catch (_) {}

    function pruneDisconnectedHls() {
      if (activeHlsSessions.size === 0) return;
      for (const hls of activeHlsSessions) {
        const mediaEl = hls.__lyplusMediaEl;
        if (mediaEl && !mediaEl.isConnected && mediaEl.id !== 'apple-music-player') {
          activeHlsSessions.delete(hls);
          hls.__lyplusDestroyed = true;
          try {
            if (typeof hls.__lyplusOrigDestroy === 'function') {
              hls.__lyplusOrigDestroy.call(hls);
            } else if (typeof hls.destroy === 'function') {
              hls.destroy();
            }
          } catch (_) {}
        }
      }
    }

    function patchHlsClass(HlsCtor) {
      if (typeof HlsCtor !== 'function' || HlsCtor.__lyplusPatched) return HlsCtor;
      HlsCtor.__lyplusPatched = true;

      const proto = HlsCtor.prototype;
      if (proto && !proto.__lyplusPatched) {
        proto.__lyplusPatched = true;
        const origAttachMedia = proto.attachMedia;
        const origLoadSource = proto.loadSource;
        const origDestroy = proto.destroy;

        if (typeof origLoadSource === 'function') {
          proto.loadSource = function (url, opts) {
            this.__lyplusOrigDestroy = origDestroy;
            pruneDisconnectedHls();
            if (opts && opts.appData && opts.appData.serviceName && opts.appData.serviceName !== 'web-static-video') {
              const audioEl = document.getElementById('apple-music-player');
              if (audioEl && audioEl.__lyplusHls && audioEl.__lyplusHls !== this) {
                const prev = audioEl.__lyplusHls;
                activeHlsSessions.delete(prev);
                prev.__lyplusDestroyed = true;
                try { origDestroy.call(prev); } catch (_) {}
              }
              if (audioEl) {
                audioEl.__lyplusHls = this;
                this.__lyplusMediaEl = audioEl;
                activeHlsSessions.add(this);
              }
            }
            return origLoadSource.apply(this, arguments);
          };
        }

        if (typeof origAttachMedia === 'function') {
          proto.attachMedia = function (mediaEl) {
            this.__lyplusOrigDestroy = origDestroy;
            pruneDisconnectedHls();

            if (mediaEl instanceof HTMLMediaElement) {
              if (mediaEl.__lyplusHls && mediaEl.__lyplusHls !== this) {
                const prev = mediaEl.__lyplusHls;
                activeHlsSessions.delete(prev);
                prev.__lyplusDestroyed = true;
                try { origDestroy.call(prev); } catch (_) {}
              }
              mediaEl.__lyplusHls = this;
              this.__lyplusMediaEl = mediaEl;
              activeHlsSessions.add(this);
            }

            const res = origAttachMedia.apply(this, arguments);
            if (mediaEl instanceof HTMLVideoElement && mediaEl.getAttribute('data-lyplus-paused') === 'true') {
              try { this.stopLoad?.(); } catch (_) {}
            }
            return res;
          };
        }

        if (typeof origDestroy === 'function') {
          proto.destroy = function () {
            this.__lyplusDestroyed = true;
            activeHlsSessions.delete(this);
            return origDestroy.apply(this, arguments);
          };
        }
      }

      const WrappedHls = new Proxy(HlsCtor, {
        construct(Target, args, newTarget) {
          const cfg = args[0] && typeof args[0] === 'object' ? Object.assign({}, args[0]) : {};
          cfg.stallCheckIntervalMs = 2500;
          cfg.lowBufferWatchdogPeriod = 5;
          cfg.highBufferWatchdogPeriod = 10;
          cfg.trottleCheckInterval = 60000;
          cfg.abrSamplePeriodMs = 1000;
          cfg.enableCEA708Captions = false;
          cfg.enableWebVTT = false;
          cfg.enableRtcReporting = false;
          cfg.rtcErrStackNumLines = 0;
          cfg.rtcLogHistoryNumLines = 0;
          args[0] = cfg;
          return Reflect.construct(Target, args, newTarget);
        }
      });
      WrappedHls.__lyplusPatched = true;
      return WrappedHls;
    }

    try {
      let currentHls = window.Hls ? patchHlsClass(window.Hls) : undefined;
      Object.defineProperty(window, 'Hls', {
        configurable: true,
        enumerable: true,
        get() {
          return currentHls;
        },
        set(val) {
          currentHls = patchHlsClass(val);
        }
      });
    } catch (_) {}

    window.addEventListener('message', (ev) => {
      const d = ev?.data;
      if (!d || d.type !== 'LYPLUS_SURFACE_VISIBILITY') return;
      if (d.modalOpen) {
        for (const hls of activeHlsSessions) {
          const el = hls.__lyplusMediaEl;
          if (el instanceof HTMLVideoElement && !el.closest?.('article[data-testid="lyrics-fullscreen-modal"]')) {
            el.setAttribute('data-lyplus-paused', 'true');
            if (!el.paused) {
              el.setAttribute('data-lyplus-was-playing', 'true');
              try { el.pause(); } catch (_) {}
            }
            try { hls.stopLoad?.(); } catch (_) {}
          }
        }
      }
    });

    function disableAmpLyrics(el) {
      if (!el || killedAmpLyrics.has(el)) return;
      killedAmpLyrics.add(el);
      try {
        if (typeof el.disconnectedCallback === 'function') {
          try { el.disconnectedCallback(); } catch (_) {}
        }
        if (el.shadowRoot) el.shadowRoot.innerHTML = '';
        const noop = function () {};
        for (const prop of ['visible', 'catalogId', 'catalog-id', 'showTranslation', 'showPronunciation']) {
          try {
            Object.defineProperty(el, prop, { configurable: true, get: () => false, set: noop });
          } catch (_) {}
        }
        el.attributeChangedCallback = noop;
        el.componentShouldUpdate = () => false;
        el.render = () => null;
      } catch (_) {}
    }

    try {
      if (window.customElements?.whenDefined) {
        window.customElements.whenDefined('amp-lyrics').then(() => {
          const Ctor = window.customElements.get('amp-lyrics');
          if (Ctor?.prototype && !Ctor.prototype.__lyplusPatched) {
            Ctor.prototype.__lyplusPatched = true;
            Ctor.prototype.componentShouldUpdate = () => false;
            Ctor.prototype.render = () => null;
            Ctor.prototype.attributeChangedCallback = function () {};
          }
          document.querySelectorAll('amp-lyrics').forEach(disableAmpLyrics);
        }).catch(() => {});

        window.customElements.whenDefined('amp-ambient-video').then(() => {
          const Ctor = window.customElements.get('amp-ambient-video');
          const origDisconnected = Ctor?.prototype?.disconnectedCallback;
          if (typeof origDisconnected === 'function' && !origDisconnected.__lyplusPatched) {
            const patchedDisconnected = function () {
              const res = origDisconnected.apply(this, arguments);
              try {
                const video = this.querySelector?.('video');
                const hls = video?.__lyplusHls;
                if (hls && !hls.__lyplusDestroyed) {
                  activeHlsSessions.delete(hls);
                  hls.__lyplusDestroyed = true;
                  if (typeof hls.__lyplusOrigDestroy === 'function') {
                    hls.__lyplusOrigDestroy.call(hls);
                  } else if (typeof hls.destroy === 'function') {
                    hls.destroy();
                  }
                }
                pruneDisconnectedHls();
              } catch (_) {}
              return res;
            };
            patchedDisconnected.__lyplusPatched = true;
            Ctor.prototype.disconnectedCallback = patchedDisconnected;
          }
        }).catch(() => {});
      }
    } catch (_) {}

    try {
      const origGetBCR = HTMLCanvasElement.prototype.getBoundingClientRect;
      if (origGetBCR && !origGetBCR.__lyplusPatched) {
        const patchedGetBCR = function () {
          if (isAppleCanvas(this)) return new DOMRect(0, 0, 1, 1);
          return origGetBCR.apply(this, arguments);
        };
        patchedGetBCR.__lyplusPatched = true;
        HTMLCanvasElement.prototype.getBoundingClientRect = patchedGetBCR;
      }
    } catch (_) {}

    try {
      if (!Object.getOwnPropertyDescriptor(Object.prototype, 'filters')) {
        const SymFilters = Symbol('lyplus_filters');
        Object.defineProperty(Object.prototype, 'filters', {
          configurable: true,
          enumerable: false,
          get() { return this[SymFilters]; },
          set(val) {
            if (
              Array.isArray(val) &&
              val.length === 7 &&
              this &&
              Array.isArray(this.children) &&
              typeof this.renderAdvanced === 'function'
            ) {
              for (let i = 0; i < val.length; i++) {
                try { if (val[i]) val[i].enabled = false; } catch (_) {}
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
              } catch (_) {}
              return;
            }
            this[SymFilters] = val;
          }
        });
      }
    } catch (_) {}

    try {
      if (!Object.getOwnPropertyDescriptor(Object.prototype, 'maxFPS')) {
        const SymMaxFPS = Symbol('lyplus_maxFPS');
        Object.defineProperty(Object.prototype, 'maxFPS', {
          configurable: true,
          enumerable: false,
          get() { return this[SymMaxFPS] ?? 0; },
          set(val) {
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
              } catch (_) {}
            }
          }
        });
      }
    } catch (_) {}

    function killGL(gl) {
      if (!gl || killedContexts.has(gl)) return;
      const canvas = gl.canvas;
      if (!isAppleCanvas(canvas)) return;

      killedContexts.add(gl);
      try {
        if (canvas.width !== 1) canvas.width = 1;
        if (canvas.height !== 1) canvas.height = 1;
      } catch (_) {}

      const noop = function () {};
      const methods = [
        'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
        'drawRangeElements', 'clear', 'blitFramebuffer', 'flush', 'finish'
      ];
      for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        if (typeof gl[m] === 'function') {
          try { gl[m] = noop; } catch (_) {}
        }
      }

      const origGetShaderParam = gl.getShaderParameter;
      if (typeof origGetShaderParam === 'function') {
        try {
          gl.getShaderParameter = function (shader, pname) {
            if (pname === 0x8B81) return true;
            return origGetShaderParam.call(this, shader, pname);
          };
        } catch (_) {}
      }

      const origGetProgramParam = gl.getProgramParameter;
      if (typeof origGetProgramParam === 'function') {
        try {
          gl.getProgramParameter = function (program, pname) {
            if (pname === 0x8B82) return true;
            return origGetProgramParam.call(this, program, pname);
          };
        } catch (_) {}
      }

      if (typeof gl.checkFramebufferStatus === 'function') {
        try {
          gl.checkFramebufferStatus = function () { return 0x8CD5; };
        } catch (_) {}
      }
    }

    function hookGLProto(Proto) {
      if (!Proto || Proto.__lyplusHooked) return;
      Proto.__lyplusHooked = true;

      ['useProgram', 'bindFramebuffer', 'clear'].forEach((methodName) => {
        const orig = Proto[methodName];
        if (typeof orig !== 'function') return;
        Proto[methodName] = function () {
          if (this && this.canvas && this.canvas.id !== 'lyplus-webgl-canvas') {
            if (killedContexts.has(this) || isAppleCanvas(this.canvas)) {
              killGL(this);
              return;
            }
          }
          return orig.apply(this, arguments);
        };
      });
    }

    try {
      if (typeof WebGL2RenderingContext !== 'undefined') hookGLProto(WebGL2RenderingContext.prototype);
      if (typeof WebGLRenderingContext !== 'undefined') hookGLProto(WebGLRenderingContext.prototype);
    } catch (_) {}
  }

  function initDOMOptimizer() {
    if (window[DOM_FLAG]) return;
    window[DOM_FLAG] = true;

    const observedNodes = new WeakSet();
    const sanitizedSheets = new WeakSet();
    let sweepQueued = false;
    let modalOpenState = false;
    let lastPostedSurfaceVisible = null;
    let viewportObserver = null;

    const CSS_RULES = `
      #lyplus-patch-container {
        contain: strict !important;
      }

      #lyrics-plus-container {
        contain: layout style;
      }

      .chrome-player.svelte-3m7vi0:before {
        transform: translateZ(0);
        backface-visibility: hidden;
      }

      amp-playback-controls-progress.progress--compact {
        contain: size layout style;
        height: 2px;
        width: 100%;
      }

      .chrome-player__lcd.svelte-3m7vi0,
      .player-lcd.svelte-1f9skug,
      .player-lcd__progress.svelte-1f9skug,
      .progress-container.svelte-1iv1zwr,
      .lyrics__controls.svelte-1n2xfan,
      .lyrics__playback-controls.svelte-1n2xfan,
      amp-playback-controls-progress,
      amp-playback-controls-progress-range,
      apple-music-playback-controls,
      amp-chrome-volume,
      amp-lcd-metadata {
        contain: layout style;
      }

      .lyrics__artwork-radiosity-container.svelte-1n2xfan {
        transform: scale(0.92) translateZ(0);
        backface-visibility: hidden;
        contain: layout paint style;
      }

      .lyrics__button.svelte-1idgbrc {
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
      }

      amp-window-takeover[aria-hidden="true"] {
        display: none !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }

      amp-ambient-video.editorial-video {
        -webkit-mask-image: none !important;
        mask-image: none !important;
        contain: layout paint style;
      }

      .artwork__radiosity,
      .singular-content-page__artwork-radiosity,
      .song-header-page__artwork-radiosity,
      .tv-movie-header__radiosity {
        transform: scale(0.88) translateZ(0) !important;
        backface-visibility: hidden;
        contain: layout paint style;
      }

      .playback-bars.svelte-1ky4dn6 {
        contain: strict;
      }

      .playback-bars__svg.svelte-1ky4dn6 {
        overflow: hidden;
      }

      .playback-bars__svg.svelte-1ky4dn6 g[mask] {
        mask: none !important;
        -webkit-mask: none !important;
      }

      .shelf-grid__header > iframe[aria-hidden="true"][tabindex="-1"] {
        display: none !important;
        visibility: hidden !important;
      }

      .play-button--platter .icon,
      .more-button--material,
      .shelf-grid--onhover .shelf-grid-nav__arrow,
      .powerswoosh .powerswoosh__artwork,
      .powerswoosh .powerswoosh__chin,
      .powerswoosh .powerswoosh__chin--legibility-gradient {
        will-change: auto !important;
      }

      .product-lockup.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .product-lockup__controls,
      .powerswoosh.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .powerswoosh__lockup-controls {
        visibility: hidden;
      }

      .product-lockup.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .play-button--platter .icon,
      .product-lockup.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .more-button--material,
      .powerswoosh.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .play-button--platter .icon,
      .powerswoosh.interactive:not(:hover):not(:focus-within):not(.has-open-menu) .more-button--material,
      .shelf-grid--onhover:not(:hover):not(:focus-within) .shelf-grid-nav__arrow {
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        will-change: auto !important;
      }

      [data-testid="section-container"][data-lyplus-offscreen="true"] * {
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        will-change: auto !important;
      }

      .songs-list-row[data-testid="track-list-item"]:not(:hover):not(:focus-within),
      .library-track[data-testid="library-track"]:not(:hover):not(:focus-within) {
        content-visibility: auto;
        contain-intrinsic-size: auto 56px;
      }

      .shelf-grid__list-item.placeholder {
        content-visibility: hidden;
        contain: strict;
      }

      dialog:not([open]) {
        display: none !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }

      body.lyplus-fullscreen-modal-open #scrollable-page,
      body.lyplus-fullscreen-modal-open main,
      body.lyplus-fullscreen-modal-open [data-testid="header"],
      body.lyplus-fullscreen-modal-open [data-testid="player-bar"] {
        display: none !important;
        content-visibility: hidden !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      body:not(.lyplus-fullscreen-modal-open) > .lyplus-blur-container {
        display: none !important;
        visibility: hidden !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }
    `;

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS_RULES;
      (document.head || document.documentElement)?.appendChild(style);
    }

    function sanitizeRuleList(ruleList) {
      if (!ruleList) return;
      for (let i = ruleList.length - 1; i >= 0; i--) {
        const rule = ruleList[i];
        if (!rule) continue;
        const sel = rule.selectorText;
        if (typeof sel === 'string' && sel.includes(':has(')) {
          if (
            sel.includes('--artwork-bg-color') ||
            sel.includes(':root:has(') ||
            sel.includes('.lyrics__sidebar') ||
            sel.includes('.player-bar')
          ) {
            try {
              ruleList.deleteRule ? ruleList.deleteRule(i) : rule.parentStyleSheet?.deleteRule(i);
            } catch (_) {}
            continue;
          }
        }
        if (rule.cssRules && rule.cssRules.length > 0) {
          try { sanitizeRuleList(rule); } catch (_) {}
        }
      }
    }

    function sanitizeAppleStyleSheets() {
      if (!document.styleSheets) return;
      for (let i = 0; i < document.styleSheets.length; i++) {
        const sheet = document.styleSheets[i];
        if (!sheet || sanitizedSheets.has(sheet)) continue;
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          sanitizedSheets.add(sheet);
          sanitizeRuleList(sheet);
        } catch (_) {
          sanitizedSheets.add(sheet);
        }
      }
    }

    function syncAmbientVideo(ampVideo) {
      if (!ampVideo || !(ampVideo instanceof Element)) return;

      const inModal = !!ampVideo.closest('article[data-testid="lyrics-fullscreen-modal"]');
      const coveredByModal = modalOpenState && !inModal;
      const isOffscreen = ampVideo.getAttribute('data-lyplus-offscreen') === 'true';
      const shouldPause = document.hidden || coveredByModal || isOffscreen;

      const videos = ampVideo.querySelectorAll('video');
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        if (shouldPause) {
          video.setAttribute('data-lyplus-paused', 'true');
          if (!video.paused) {
            video.setAttribute('data-lyplus-was-playing', 'true');
            try { video.pause(); } catch (_) {}
          }
        } else {
          video.removeAttribute('data-lyplus-paused');
          const wantsPlay =
            ampVideo.getAttribute('data-playing') === 'true' ||
            ampVideo.hasAttribute('playing') ||
            video.getAttribute('data-lyplus-was-playing') === 'true';

          if (wantsPlay && video.paused) {
            video.removeAttribute('data-lyplus-was-playing');
            try {
              const p = video.play();
              if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (_) {}
          }
        }
      }
    }

    function ensureViewportObserver() {
      if (viewportObserver || typeof IntersectionObserver === 'undefined') return;

      viewportObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const el = entry.target;
          if (entry.isIntersecting) {
            if (el.hasAttribute('data-lyplus-offscreen')) {
              el.removeAttribute('data-lyplus-offscreen');
            }
          } else if (!el.hasAttribute('data-lyplus-offscreen')) {
            el.setAttribute('data-lyplus-offscreen', 'true');
          }

          if (el.tagName === 'AMP-AMBIENT-VIDEO') {
            syncAmbientVideo(el);
          }
        }
      }, {
        root: null,
        rootMargin: '400px 0px 400px 0px',
        threshold: 0
      });
    }

    function observeTargets(root = document) {
      ensureViewportObserver();
      if (!viewportObserver) return;

      const targets = root.querySelectorAll('amp-ambient-video, [data-testid="section-container"]');
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        if (!observedNodes.has(el)) {
          observedNodes.add(el);
          viewportObserver.observe(el);
        }
        if (el.tagName === 'AMP-AMBIENT-VIDEO') {
          syncAmbientVideo(el);
        }
      }
    }

    function pruneHeadLinks() {
      if (!document.head) return;
      const links = document.head.querySelectorAll('link[rel="alternate"][hreflang]');
      for (let i = 0; i < links.length; i++) {
        links[i].remove();
      }
    }

    function syncSurfaces() {
      if (!document.body) return;

      const modalEl = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
      const sidebarEl = document.querySelector('[data-testid="lyrics-sidebar"]');

      const isModalOpen = !!(modalEl && modalEl.isConnected);
      const isSidebarOpen = !!(sidebarEl && sidebarEl.isConnected);

      const modalChanged = modalOpenState !== isModalOpen;
      modalOpenState = isModalOpen;

      document.body.classList.toggle('lyplus-fullscreen-modal-open', isModalOpen);
      document.body.classList.toggle('lyplus-sidebar-open', isSidebarOpen);
      document.body.classList.toggle('has-modal', isModalOpen || !!document.querySelector('[data-testid="modal"]'));

      const sidePanelEl = document.querySelector('[data-testid="side-panel"]');
      if (sidePanelEl) {
        sidePanelEl.classList.toggle('has-lyrics-sidebar', isSidebarOpen);
      }

      const patchEl = document.getElementById('lyplus-patch-container');
      const hasVisiblePatch = patchEl && !patchEl.classList.contains('lyrics-hidden');
      document.querySelectorAll('.lyrics__container').forEach(el => {
        el.classList.toggle('has-lyplus', !!hasVisiblePatch);
      });

      const ampLyricsList = document.querySelectorAll('amp-lyrics');
      for (let i = 0; i < ampLyricsList.length; i++) {
        const amp = ampLyricsList[i];
        if (!amp.hasAttribute('data-lyplus-disabled')) {
          amp.setAttribute('data-lyplus-disabled', 'true');
          amp.setAttribute('static-lyrics', 'true');
          amp.removeAttribute('visible');
          amp.removeAttribute('catalog-id');
          amp.style.setProperty('display', 'none', 'important');
        }
        if (amp.shadowRoot && amp.shadowRoot.innerHTML !== '') {
          amp.shadowRoot.innerHTML = '';
        }
      }

      try {
        if (!isModalOpen || document.hidden) {
          if (typeof globalAnimationId !== 'undefined' && globalAnimationId) {
            cancelAnimationFrame(globalAnimationId);
            globalAnimationId = null;
          }
        } else if (isModalOpen && !document.hidden) {
          if (typeof globalAnimationId !== 'undefined' && !globalAnimationId && typeof animateWebGLBackground === 'function') {
            globalAnimationId = requestAnimationFrame(animateWebGLBackground);
          }
        }
      } catch (_) {}

      if (modalChanged) {
        document.querySelectorAll('amp-ambient-video').forEach(syncAmbientVideo);
      }

      const surfaceVisible = (isModalOpen || isSidebarOpen) && !document.hidden;
      if (surfaceVisible !== lastPostedSurfaceVisible || modalChanged) {
        lastPostedSurfaceVisible = surfaceVisible;
        window.postMessage({
          type: 'LYPLUS_SURFACE_VISIBILITY',
          visible: surfaceVisible,
          modalOpen: isModalOpen,
          sidebarOpen: isSidebarOpen
        }, '*');
      }
    }

    function sweep() {
      sweepQueued = false;
      injectStyles();
      sanitizeAppleStyleSheets();
      syncSurfaces();
      observeTargets();
      pruneHeadLinks();
    }

    function queueSweep() {
      if (sweepQueued) return;
      sweepQueued = true;
      requestAnimationFrame(sweep);
    }

    function start() {
      injectStyles();
      sweep();

      const observer = new MutationObserver((mutations) => {
        let needsSweep = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'attributes') {
            if (m.target instanceof Element && m.target.tagName === 'AMP-AMBIENT-VIDEO') {
              syncAmbientVideo(m.target);
            } else {
              needsSweep = true;
            }
            continue;
          }
          const added = m.addedNodes;
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (node.nodeType !== 1) continue;
            if (
              node.id === 'lyplus-patch-container' ||
              node.id === 'lyrics-plus-container' ||
              node.closest?.('#lyrics-plus-container')
            ) {
              continue;
            }
            needsSweep = true;
            break;
          }
          if (needsSweep) break;
          const removed = m.removedNodes;
          for (let j = 0; j < removed.length; j++) {
            const node = removed[j];
            if (node.nodeType === 1 && (
              node.matches?.('[data-testid="modal"], article[data-testid="lyrics-fullscreen-modal"], [data-testid="side-panel"], [data-testid="lyrics-sidebar"]') ||
              node.querySelector?.('article[data-testid="lyrics-fullscreen-modal"], [data-testid="lyrics-sidebar"]')
            )) {
              needsSweep = true;
              break;
            }
          }
          if (needsSweep) break;
        }
        if (needsSweep) queueSweep();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-playing', 'playing', 'open']
      });

      document.addEventListener('visibilitychange', () => {
        queueSweep();
        document.querySelectorAll('amp-ambient-video').forEach(syncAmbientVideo);
      }, { passive: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  if (isIsolatedWorld) {
    initDOMOptimizer();

    const injectMain = () => {
      if (document.documentElement?.hasAttribute('data-lyplus-optimizer-main-injected')) return;
      document.documentElement?.setAttribute('data-lyplus-optimizer-main-injected', 'true');

      const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
      if (api?.runtime?.getURL) {
        const script = document.createElement('script');
        script.src = api.runtime.getURL('src/modules/applemusic/appleUIOptimizer.js');
        script.onload = function () { this.remove(); };
        script.onerror = function () { this.remove(); };
        (document.head || document.documentElement)?.appendChild(script);
      }
    };

    if (document.head || document.documentElement) {
      injectMain();
    } else {
      document.addEventListener('DOMContentLoaded', injectMain, { once: true });
    }
  } else {
    initMainWorld();
  }
})();
