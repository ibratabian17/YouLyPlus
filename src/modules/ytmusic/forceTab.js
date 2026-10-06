(function () {
  'use strict';

  if (window.__lyplusForceTab) return;
  window.__lyplusForceTab = true;

  const SELECTORS = {
    TAB_CONTAINER: 'ytmusic-player-page .tab-header-container, #tabs-content, tp-yt-paper-tabs',
    TAB: 'tp-yt-paper-tab',
    SIDE_PANEL: '#side-panel',
    LYRICS: '.lyrics-plus-integrated',
    SCROLL_CONTAINER: '#tab-renderer',
    VIDEO: 'video',
    APP_LAYOUT: 'ytmusic-app-layout'
  };

  const RELEVANT_TAGS = new Set(['tp-yt-paper-tabs', 'tp-yt-paper-tab']);

  const state = {
    container: null,
    tabs: [],
    middleTab: null,
    sidePanel: null
  };

  let rootObserver = null;
  let containerObserver = null;
  let middleTabObserver = null;
  let sidePanelObserver = null;

  let syncQueued = false;
  let activateQueued = false;

  const ac = new AbortController();
  const boundContainers = new WeakSet();

  const raf = (fn) => requestAnimationFrame(fn);

  function needsActivation(tab) {
    return (
      tab.hasAttribute('disabled') ||
      tab.getAttribute('aria-disabled') === 'true' ||
      tab.style.pointerEvents !== 'auto'
    );
  }

  function queueActivate() {
    if (activateQueued) return;
    activateQueued = true;
    raf(() => {
      activateQueued = false;
      const tab = state.middleTab;
      if (!tab || !tab.isConnected || !needsActivation(tab)) return;
      tab.removeAttribute('disabled');
      tab.setAttribute('aria-disabled', 'false');
      tab.style.pointerEvents = 'auto';
    });
  }

  function handleTabInteraction(clickedIndex, middleIndex) {
    const lyricsElement = document.querySelector(SELECTORS.LYRICS);
    if (!lyricsElement) return;

    if (clickedIndex !== middleIndex) {
      lyricsElement.style.display = 'none';
      return;
    }

    lyricsElement.style.display = 'block';

    const sidePanel = state.sidePanel || document.querySelector(SELECTORS.SIDE_PANEL);
    if (sidePanel) {
      if (getComputedStyle(sidePanel).display === 'none') sidePanel.style.display = 'flex';
      sidePanel.removeAttribute('inert');
      sidePanel.removeAttribute('hidden');
    }

    const scrollContainer = document.querySelector(SELECTORS.SCROLL_CONTAINER);
    if (scrollContainer) scrollContainer.scrollTop = 0;

    const video = document.querySelector(SELECTORS.VIDEO);
    if (video && typeof window.scrollActiveLine === 'function') {
      try { window.scrollActiveLine(video.currentTime, true); } catch (_) {}
    }
  }

  function bindContainer(container) {
    if (boundContainers.has(container)) return;
    boundContainers.add(container);

    container.addEventListener('click', (e) => {
      const tab = e.target.closest?.(SELECTORS.TAB);
      if (!tab) return;
      const index = state.tabs.indexOf(tab);
      if (index === -1) return;
      handleTabInteraction(index, Math.floor(state.tabs.length / 3));
    }, { capture: true, passive: true, signal: ac.signal });
  }

  function findContainer() {
    if (state.container && state.container.isConnected) return state.container;
    state.container = document.querySelector(SELECTORS.TAB_CONTAINER);
    return state.container;
  }

  function sync() {
    syncQueued = false;

    const container = findContainer();
    if (!container) return;

    const list = container.querySelectorAll(SELECTORS.TAB);
    if (list.length < 3) return;

    state.tabs = Array.from(list);
    const middleTab = state.tabs[Math.floor(state.tabs.length / 3)];

    if (middleTab !== state.middleTab) {
      middleTabObserver?.disconnect();
      state.middleTab = middleTab;
      middleTabObserver = new MutationObserver(queueActivate);
      middleTabObserver.observe(middleTab, {
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled']
      });
    }
    queueActivate();

    bindContainer(container);

    if (containerObserver?.__target !== container) {
      containerObserver?.disconnect();
      containerObserver = new MutationObserver(queueSync);
      containerObserver.__target = container;
      containerObserver.observe(container, { childList: true, subtree: true });
    }

    initSidePanelObserver();
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    raf(sync);
  }

  function initSidePanelObserver() {
    const sidePanel = document.querySelector(SELECTORS.SIDE_PANEL);
    if (!sidePanel || sidePanel === state.sidePanel) return;

    sidePanelObserver?.disconnect();
    state.sidePanel = sidePanel;

    const ensureActive = () => {
      const lyrics = document.querySelector(SELECTORS.LYRICS);
      if (!lyrics || lyrics.style.display !== 'block') return;
      sidePanel.removeAttribute('inert');
      sidePanel.removeAttribute('hidden');
      if (getComputedStyle(sidePanel).display === 'none') sidePanel.style.display = 'flex';
    };

    ensureActive();

    sidePanelObserver = new MutationObserver(ensureActive);
    sidePanelObserver.observe(sidePanel, {
      attributes: true,
      attributeFilter: ['inert', 'hidden', 'style']
    });
  }

  function onRootMutations(mutations) {
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeType !== 1) continue;
        const name = n.localName;
        if (name.indexOf('-') !== -1 || RELEVANT_TAGS.has(name)) {
          queueSync();
          return;
        }
      }
    }
  }

  function start() {
    const root = document.querySelector(SELECTORS.APP_LAYOUT) || document.body;
    rootObserver = new MutationObserver(onRootMutations);
    rootObserver.observe(root, { childList: true, subtree: true });

    document.addEventListener('yt-navigate-finish', queueSync, { passive: true, signal: ac.signal });

    queueSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('pagehide', () => {
    ac.abort();
    rootObserver?.disconnect();
    containerObserver?.disconnect();
    middleTabObserver?.disconnect();
    sidePanelObserver?.disconnect();
  }, { once: true });
})();
