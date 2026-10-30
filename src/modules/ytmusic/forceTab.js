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

  function setLyricsVisibility(visible) {
    window.__lyplusLyricsVisible = visible;

    const lyricsElement = document.querySelector(SELECTORS.LYRICS) || document.getElementById('lyrics-plus-container');
    if (lyricsElement) {
      lyricsElement.classList.toggle('is-visible', visible);
      lyricsElement.style.display = visible ? 'block' : 'none';
    }

    const patchContainer = document.getElementById('lyplus-patch-container');
    if (patchContainer) {
      patchContainer.classList.toggle('is-visible', visible);
    }

    const tabRenderer = document.querySelector(SELECTORS.SCROLL_CONTAINER) || document.querySelector('ytmusic-tab-renderer');
    if (tabRenderer) {
      tabRenderer.classList.toggle('is-visible', visible);
    }

    const playerPage = document.querySelector('ytmusic-player-page') || document.querySelector('#player-page');
    if (playerPage) {
      playerPage.classList.toggle('is-visible', visible);
    }

    const playerPageSlot = document.querySelector('ytmusic-app-layout > [slot="player-page"]');
    if (playerPageSlot && playerPageSlot !== playerPage) {
      playerPageSlot.classList.toggle('is-visible', visible);
    }

    const appLayout = document.querySelector(SELECTORS.APP_LAYOUT) || document.getElementById('layout');
    if (appLayout) {
      appLayout.classList.toggle('is-visible', visible);
    }
  }

  window.__lyplusSetLyricsVisibility = setLyricsVisibility;

  function handleTabInteraction(clickedIndex, middleIndex) {
    const isLyricsTab = clickedIndex === middleIndex;
    setLyricsVisibility(isLyricsTab);

    if (!isLyricsTab) return;

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

  function syncPlayerState() {
    const player = document.querySelector('ytmusic-player');
    const mode = player?.getAttribute('playback-mode');
    const playerPage = document.querySelector('ytmusic-player-page') || document.querySelector('#player-page');
    const appLayout = document.querySelector(SELECTORS.APP_LAYOUT) || document.getElementById('layout');

    if (playerPage) {
      if (mode) playerPage.setAttribute('playback-mode', mode);
      else playerPage.removeAttribute('playback-mode');

      const pageState = playerPage.getAttribute('player-page-ui-state');
      if (appLayout) {
        if (pageState) appLayout.setAttribute('player-page-ui-state', pageState);
        else appLayout.removeAttribute('player-page-ui-state');
      }
    }
    if (appLayout && mode) {
      appLayout.setAttribute('playback-mode', mode);
    }

    const docEl = document.documentElement;
    const body = document.body;
    const themeSong = document.getElementById('ThemeSong-MainContainer');
    docEl.classList.toggle('has-themesong', !!themeSong);
    if (body) {
      body.classList.toggle('has-themesong-dynamic-light', !!(themeSong && themeSong.querySelector('#DynamicLight')));
      body.classList.toggle('has-themesong-static-light', !!(themeSong && themeSong.querySelector('#StaticLight')));
    }
    const kawarp = document.getElementById('better-lyrics-kawarp-player');
    docEl.classList.toggle('has-kawarp-player', !!kawarp);
  }

  function sync() {
    syncQueued = false;
    syncPlayerState();

    const container = findContainer();
    if (!container) return;

    const list = container.querySelectorAll(SELECTORS.TAB);
    if (list.length < 3) return;

    state.tabs = Array.from(list);
    const middleTab = state.tabs[Math.floor(state.tabs.length / 3)];

    if (middleTab !== state.middleTab) {
      middleTabObserver?.disconnect();
      state.middleTab = middleTab;
      middleTabObserver = new MutationObserver(() => {
        queueActivate();
        checkActiveTab();
      });
      middleTabObserver.observe(middleTab, {
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'aria-selected', 'class']
      });
    }
    queueActivate();
    checkActiveTab();

    bindContainer(container);

    if (containerObserver?.__target !== container) {
      containerObserver?.disconnect();
      containerObserver = new MutationObserver(queueSync);
      containerObserver.__target = container;
      containerObserver.observe(container, { childList: true, subtree: true });
    }

    initSidePanelObserver();
  }

  function checkActiveTab() {
    const middleTab = state.middleTab;
    if (!middleTab) return;
    const isSelected = middleTab.getAttribute('aria-selected') === 'true' ||
      middleTab.classList.contains('iron-selected');
    if (isSelected && !window.__lyplusLyricsVisible) {
      setLyricsVisibility(true);
    }
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
      const lyrics = document.querySelector(SELECTORS.LYRICS) || document.getElementById('lyrics-plus-container');
      if (!lyrics || (!lyrics.classList.contains('is-visible') && lyrics.style.display !== 'block')) return;
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
      const m = mutations[i];
      if (m.type === 'attributes') {
        queueSync();
        return;
      }
      const added = m.addedNodes;
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
    rootObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['playback-mode', 'player-page-ui-state', 'video-mode']
    });

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
