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

  // Runs in page context to patch Apple's Svelte/Stencil/Sentry/PixiJS bundles
  function initMainWorld() {
    if (window[MAIN_FLAG]) return;
    window[MAIN_FLAG] = true;

    const killedCanvases = new WeakSet();
    const killedContexts = new WeakSet();
    const killedAmpLyrics = new WeakSet();

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

    // Bypass Sentry TryCatch wrapper on rAF so it doesn't allocate a closure every frame
    try {
      const unwrap = (fn) => (typeof fn === 'function' && typeof fn.__sentry_original__ === 'function')
        ? fn.__sentry_original__
        : fn;

      const origRAF = unwrap(window.requestAnimationFrame);
      if (typeof origRAF === 'function' && !origRAF.__lyplusPatched) {
        const raf = function (cb) {
          return origRAF.call(window, unwrap(cb));
        };
        raf.__lyplusPatched = true;
        window.requestAnimationFrame = raf;
      }
    } catch (_) {}

    // Block root full-DOM MutationObservers (Sentry MultiClick/rrweb & RO polyfill)
    // and ignore internal LyricsPlus DOM mutations
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

            // Skip per-item tabindex attribute observers on shelf/nav items
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
            return callback.call(this, mutations, observer);
          };
          instance = new OrigMO(wrapped);
          return instance;
        };
        PatchedMO.prototype = OrigMO.prototype;
        Object.setPrototypeOf(PatchedMO, OrigMO);
        window.MutationObserver = PatchedMO;
      }
    } catch (_) {}

    // Skip ResizeObserver on .multiline-clamp (handled natively by -webkit-line-clamp,
    // avoids synchronous scrollHeight + getComputedStyle on 150+ elements)
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

    // No-op telemetry impressionsObserver and ListKeyboardAccess tabindex thrashing
    try {
      const OrigIO = window.IntersectionObserver;
      if (OrigIO && !OrigIO.__lyplusPatched) {
        const noop = function () {};
        const emptyRecords = function () { return []; };

        const PatchedIO = function (callback, options) {
          if (typeof callback === 'function') {
            const fnStr = Function.prototype.toString.call(callback);

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
          return new OrigIO(callback, options);
        };
        PatchedIO.__lyplusPatched = true;
        PatchedIO.prototype = OrigIO.prototype;
        Object.setPrototypeOf(PatchedIO, OrigIO);
        window.IntersectionObserver = PatchedIO;
      }
    } catch (_) {}

    // Filter noisy capture events, Sentry click/keypress trackers, and LYPLUS postMessages
    try {
      const origAddEventListener = EventTarget.prototype.addEventListener;
      if (origAddEventListener && !origAddEventListener.__lyplusPatched) {
        const roNoisyEvents = new Set([
          'transitionend', 'animationend', 'animationstart', 'animationiteration',
          'keyup', 'keydown', 'mouseup', 'mousedown', 'mouseover', 'mouseout', 'blur', 'focus'
        ]);

        const patchedAddEventListener = function (type, listener, options) {
          if (typeof listener !== 'function') {
            return origAddEventListener.call(this, type, listener, options);
          }

          const clean = typeof listener.__sentry_original__ === 'function'
            ? listener.__sentry_original__
            : listener;

          // Keep Apple's CommerceKit message listener from parsing LYPLUS_ ticks
          if (this === window && type === 'message') {
            const fnStr = Function.prototype.toString.call(clean);
            if (!fnStr.includes('LYPLUS_')) {
              const filtered = function (event) {
                const msgType = event?.data?.type;
                if (typeof msgType === 'string' && msgType.startsWith('LYPLUS_')) return;
                return clean.apply(this, arguments);
              };
              return origAddEventListener.call(this, type, filtered, options);
            }
          }

          if ((this === window || this === document) && options === true && roNoisyEvents.has(type)) {
            const fnStr = Function.prototype.toString.call(clean);
            if (fnStr.includes('.schedule()')) return;
            const wrapped = function (ev) {
              if (ev && isLyplusNode(ev.target)) return;
              return clean.apply(this, arguments);
            };
            return origAddEventListener.call(this, type, wrapped, options);
          }

          if (this === document && (type === 'click' || type === 'keypress') && options === false) {
            const fnStr = Function.prototype.toString.call(clean);
            if (fnStr.includes('keypress') && fnStr.includes('clearTimeout')) return;
          }

          return origAddEventListener.call(this, type, clean, options);
        };
        patchedAddEventListener.__lyplusPatched = true;
        EventTarget.prototype.addEventListener = patchedAddEventListener;
      }
    } catch (_) {}

    // Block Svelte's legacy about:blank resize-sensor iframes inside shelf headers
    try {
      const origAppendChild = Node.prototype.appendChild;
      if (origAppendChild && !origAppendChild.__lyplusPatched) {
        const patchedAppendChild = function (child) {
          if (
            child &&
            child.nodeType === 1 &&
            child.tagName === 'IFRAME' &&
            child.getAttribute('aria-hidden') === 'true' &&
            child.tabIndex === -1 &&
            this instanceof Element &&
            this.classList?.contains('shelf-grid__header')
          ) {
            return child;
          }
          return origAppendChild.call(this, child);
        };
        patchedAppendChild.__lyplusPatched = true;
        Node.prototype.appendChild = patchedAppendChild;
      }
    } catch (_) {}

    // Skip shelf intersection querySelectorAll("a, button") tabindex toggling
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

    // Stop native <amp-lyrics> Stencil component from rendering in its shadowRoot
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

    // Kill Apple's native PixiJS lyrics backdrop canvas & 15fps ticker
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
        'drawRangeElements', 'clear', 'blitFramebuffer', 'texImage2D', 'texSubImage2D',
        'texImage3D', 'texSubImage3D', 'renderbufferStorage', 'renderbufferStorageMultisample',
        'shaderSource', 'compileShader', 'linkProgram', 'flush', 'finish'
      ];
      for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        if (typeof gl[m] === 'function') {
          try { gl[m] = noop; } catch (_) {}
        }
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

  // Manages offscreen media/rows, closed modals, and idle WebGL loops
  function initDOMOptimizer() {
    if (window[DOM_FLAG]) return;
    window[DOM_FLAG] = true;

    const observedNodes = new WeakSet();
    let sweepQueued = false;
    let modalOpenState = false;
    let viewportObserver = null;

    // Avoid `contain: layout/paint` on player-bar, side-panel, or sections so
    // `position: fixed` panels/menus and overflowing radiosity glows never break.
    const CSS_RULES = `
      #lyplus-patch-container {
        contain: strict !important;
      }

      #lyrics-plus-container {
        contain: layout style;
      }

      .songs-list-row[data-testid="track-list-item"][data-lyplus-offscreen="true"]:not(:hover):not(:focus-within),
      .library-track[data-testid="library-track"][data-lyplus-offscreen="true"]:not(:hover):not(:focus-within) {
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
      (document.head || document.documentElement).appendChild(style);
    }

    // Pause animated art <video> when offscreen and resume when back in view
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
          if (!video.paused) {
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

      const targets = root.querySelectorAll(
        '.songs-list-row[data-testid="track-list-item"], ' +
        '.library-track[data-testid="library-track"], ' +
        'amp-ambient-video'
      );

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

    // Remove 300+ redundant hreflang link tags injected on route changes
    function pruneHeadLinks() {
      if (!document.head) return;
      const links = document.head.querySelectorAll('link[rel="alternate"][hreflang]');
      for (let i = 0; i < links.length; i++) {
        links[i].remove();
      }
    }

    // Sync modal/sidebar classes and stop dynamicBkg WebGL rAF when modal is closed
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

      window.postMessage({
        type: 'LYPLUS_SURFACE_VISIBILITY',
        visible: (isModalOpen || isSidebarOpen) && !document.hidden,
        modalOpen: isModalOpen,
        sidebarOpen: isSidebarOpen
      }, '*');
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
        script.onerror = function () {
          this.remove();
          try {
            const inline = document.createElement('script');
            inline.textContent = `(${initMainWorld.toString()})();`;
            (document.head || document.documentElement).appendChild(inline);
            inline.remove();
          } catch (_) {}
        };
        (document.head || document.documentElement).appendChild(script);
      }
    };

    if (document.head || document.documentElement) {
      injectMain();
    } else {
      document.addEventListener('DOMContentLoaded', injectMain, { once: true });
    }
  } else {
    initMainWorld();
    initDOMOptimizer();
  }
})();