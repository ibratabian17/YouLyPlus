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

    const fnToString = Function.prototype.toString;
    const origDateNow = Date.now.bind(Date);

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

          return origRAF.call(window, clean);
        };
        raf.__lyplusPatched = true;
        lockPatchedMethod(window, 'requestAnimationFrame', raf);
      }

      const origSetTimeout = unwrapSentry(window.setTimeout);
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
      const OrigMO = window.MutationObserver;
      const origObserve = OrigMO?.prototype?.observe;

      if (OrigMO && origObserve && !origObserve.__lyplusPatched) {
        const patchedObserve = function (target, options) {
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

    try {
      const origAddEventListener = unwrapSentry(EventTarget.prototype.addEventListener);
      const origRemoveEventListener = unwrapSentry(EventTarget.prototype.removeEventListener);
      if (origAddEventListener && !origAddEventListener.__lyplusPatched) {
        const roNoisyEvents = new Set([
          'load', 'transitionend', 'animationend', 'animationstart', 'animationiteration',
          'keyup', 'keydown', 'mouseup', 'mousedown', 'mouseover', 'mouseout', 'blur', 'focus'
        ]);

        const patchedAddEventListener = function (type, listener, options) {
          if (typeof listener !== 'function') {
            return origAddEventListener.call(this, type, listener, options);
          }

          const clean = unwrapSentry(listener);

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
              (fnStr.length < 120 && /\b[a-zA-Z_$][\w$]*\.run\(/.test(fnStr))
            ) {
              return;
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
          if (!video.paused && video.readyState >= 2) {
            video.setAttribute('data-lyplus-was-playing', 'true');
            try { video.pause(); } catch (_) {}
          }
        } else {
          const wantsPlay =
            ampVideo.getAttribute('data-playing') === 'true' ||
            ampVideo.hasAttribute('playing') ||
            video.getAttribute('data-lyplus-was-playing') === 'true';

          if (wantsPlay && video.paused && video.readyState >= 2) {
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
        rootMargin: '300px 0px 300px 0px',
        threshold: 0
      });
    }

    function observeTargets(root = document) {
      ensureViewportObserver();
      if (!viewportObserver) return;

      const targets = root.querySelectorAll('amp-ambient-video');
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        if (!observedNodes.has(el)) {
          observedNodes.add(el);
          viewportObserver.observe(el);
        }
        syncAmbientVideo(el);
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
      if (surfaceVisible !== lastPostedSurfaceVisible) {
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
