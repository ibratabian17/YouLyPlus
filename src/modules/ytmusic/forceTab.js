(async function () {
  async function waitForDOMReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return;
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  await waitForDOMReady();

  let middleTabObserver = null;
  let tabContainerObserver = null;
  let sidePanelObserver = null;
  let currentMiddleTab = null;
  let isUpdating = false;

  const SELECTORS = {
    TAB_CONTAINER: 'ytmusic-player-page .tab-header-container, #tabs-content, tp-yt-paper-tabs',
    TAB: 'tp-yt-paper-tab',
    SIDE_PANEL: '#side-panel',
    LYRICS: '.lyrics-plus-integrated',
    SCROLL_CONTAINER: '#tab-renderer',
    VIDEO: 'video',
    APP_LAYOUT: 'ytmusic-app-layout'
  };

  function forceActivateMiddleTab(tab) {
    if (!tab || isUpdating) return;

    const needsUpdate = 
      tab.hasAttribute('disabled') ||
      tab.getAttribute('aria-selected') !== 'true' ||
      tab.getAttribute('tabindex') !== '0' ||
      !tab.classList.contains('iron-selected') ||
      tab.style.pointerEvents !== 'auto';

    if (!needsUpdate) return;

    isUpdating = true;
    if (middleTabObserver) middleTabObserver.disconnect();

    requestAnimationFrame(() => {
      tab.removeAttribute('disabled');
      tab.setAttribute('aria-disabled', 'false');
      tab.setAttribute('tabindex', '0');
      tab.setAttribute('aria-selected', 'true');
      tab.classList.add('iron-selected');
      tab.style.pointerEvents = 'auto';
      
      setTimeout(() => { 
        isUpdating = false;
        if (middleTabObserver && currentMiddleTab === tab) {
            middleTabObserver.observe(tab, { 
                attributes: true, 
                attributeFilter: ['class', 'aria-selected', 'disabled'] 
            });
        }
      }, 50);
    });
  }

  function handleTabInteraction(clickedIndex, middleIndex) {
    const lyricsElement = document.querySelector(SELECTORS.LYRICS);
    const sidePanel = document.querySelector(SELECTORS.SIDE_PANEL);

    if (!lyricsElement) return;

    const shouldShow = clickedIndex === middleIndex;
    
    if (shouldShow) {
        lyricsElement.style.display = 'block';
        
        if (sidePanel) {
            if (getComputedStyle(sidePanel).display === 'none') {
                sidePanel.style.display = 'flex';
            }
            if (sidePanel.hasAttribute('inert')) sidePanel.removeAttribute('inert');
            if (sidePanel.hasAttribute('hidden')) sidePanel.removeAttribute('hidden');
        }

        const scrollContainer = document.querySelector(SELECTORS.SCROLL_CONTAINER);
        if (scrollContainer) scrollContainer.scrollTop = 0;
        
        const videoElement = document.querySelector(SELECTORS.VIDEO);
        if (videoElement && typeof window.scrollActiveLine === 'function') {
            try { window.scrollActiveLine(videoElement.currentTime, true); } catch (e) {}
        }
    } else {
        lyricsElement.style.display = 'none';
    }
  }

  function attachTouchLogic(tab, index, middleIndex) {
    if (tab.dataset.forceTabEnhanced === 'true') return;

    const MOVE_THRESHOLD = 10;
    let startX = 0, startY = 0;

    tab.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    }, { passive: true });

    tab.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - startX) < MOVE_THRESHOLD &&
          Math.abs(t.clientY - startY) < MOVE_THRESHOLD) {
        handleTabInteraction(index, middleIndex);
      }
    }, { passive: true });

    tab.addEventListener('click', () => {
      handleTabInteraction(index, middleIndex);
    }, { passive: true });

    tab.dataset.forceTabEnhanced = 'true';
  }

  function processTabs(container) {
    const tabs = Array.from(container.querySelectorAll(SELECTORS.TAB));
    if (tabs.length < 3) return;

    const middleIndex = Math.floor(tabs.length / 2);
    const middleTab = tabs[middleIndex];

    forceActivateMiddleTab(middleTab);

    if (currentMiddleTab !== middleTab) {
      if (middleTabObserver) middleTabObserver.disconnect();
      
      currentMiddleTab = middleTab;
      middleTabObserver = new MutationObserver(() => {
         if (!isUpdating) forceActivateMiddleTab(middleTab);
      });
      
      middleTabObserver.observe(middleTab, { 
        attributes: true, 
        attributeFilter: ['class', 'aria-selected', 'disabled'] 
      });
    }

    tabs.forEach((tab, index) => {
      attachTouchLogic(tab, index, middleIndex);
    });
  }

  function initSidePanelObserver() {
    const sidePanel = document.querySelector(SELECTORS.SIDE_PANEL);
    if (!sidePanel) return;
    
    if (sidePanelObserver) sidePanelObserver.disconnect();

    const ensureActive = () => {
      const lyricsElement = document.querySelector(SELECTORS.LYRICS);
      if (lyricsElement && lyricsElement.style.display === 'block') {
          if (sidePanel.hasAttribute('inert')) sidePanel.removeAttribute('inert');
          if (sidePanel.hasAttribute('hidden')) sidePanel.removeAttribute('hidden');
          if (getComputedStyle(sidePanel).display === 'none') sidePanel.style.display = 'flex';
      }
    };
    
    ensureActive();

    sidePanelObserver = new MutationObserver((mutations) => {
        if (mutations.some(m => m.type === 'attributes')) ensureActive();
    });
    
    sidePanelObserver.observe(sidePanel, { 
        attributes: true, 
        attributeFilter: ['inert', 'hidden', 'style'] 
    });
  }

  const mainObserver = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const m of mutations) {
        if (m.target && (
            m.target.id === 'tabs-content' || 
            m.target.classList?.contains('tab-header-container') ||
            m.target.tagName === 'TP-YT-PAPER-TABS'
        )) {
            shouldUpdate = true;
            break;
        }
        if (m.addedNodes.length > 0) {
            shouldUpdate = true;
            break;
        }
    }

    if (!shouldUpdate) return;

    const tabContainer = document.querySelector(SELECTORS.TAB_CONTAINER);

    if (tabContainer) {
      processTabs(tabContainer);

      if (!tabContainerObserver) {
        tabContainerObserver = new MutationObserver(() => {
          processTabs(tabContainer);
        });
        tabContainerObserver.observe(tabContainer, { childList: true, subtree: false });
      }
    }

    initSidePanelObserver();
  });

  const appRoot = document.querySelector(SELECTORS.APP_LAYOUT) || document.body;
  mainObserver.observe(appRoot, { childList: true, subtree: true });

  window.addEventListener('beforeunload', () => {
    mainObserver.disconnect();
    if (tabContainerObserver) tabContainerObserver.disconnect();
    if (middleTabObserver) middleTabObserver.disconnect();
    if (sidePanelObserver) sidePanelObserver.disconnect();
  }, { once: true });

})();