(async function () {
  async function waitForDOMReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      return;
    }
    await new Promise((resolve) =>
      document.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }

  await waitForDOMReady();

  let middleTabObserver = null;
  let isUpdating = false;
  let sidePanelObserver = null;
  let tabContainerObserver = null;
  let observedSidePanelEl = null;
  let observedTabContainerEl = null;
  let rafId = null;
  let lastMiddleTab = null;
  let currentMiddleIndex = -1;

  function forceActivateMiddleTab(tabElement) {
    if (!tabElement || isUpdating) return;

    const hasDisabledAttr = tabElement.hasAttribute('disabled');
    const ariaDisabled = tabElement.getAttribute('aria-disabled');
    const tabindex = tabElement.getAttribute('tabindex');
    const ariaSelected = tabElement.getAttribute('aria-selected');
    const pointerEvents = tabElement.style.pointerEvents;
    const hasIronSelected = tabElement.classList.contains('iron-selected');

    const isActive =
      !hasDisabledAttr &&
      ariaDisabled === 'false' &&
      tabindex === '0' &&
      ariaSelected === 'true' &&
      pointerEvents === 'auto' &&
      hasIronSelected;

    if (isActive) return;

    isUpdating = true;

    requestAnimationFrame(() => {
      tabElement.removeAttribute('disabled');

      tabElement.setAttribute('aria-disabled', 'false');
      tabElement.setAttribute('tabindex', '0');
      tabElement.setAttribute('aria-selected', 'true');

      tabElement.classList.add('iron-selected');

      tabElement.style.pointerEvents = 'auto';

      isUpdating = false;
    });
  }

  function observeMiddleTab(tabElement) {
    if (!tabElement) return;

    if (!document.contains(tabElement)) {
      if (middleTabObserver) {
        middleTabObserver.disconnect();
        middleTabObserver = null;
      }
      lastMiddleTab = null;
      return;
    }

    if (middleTabObserver && lastMiddleTab === tabElement) return;

    if (middleTabObserver) middleTabObserver.disconnect();

    middleTabObserver = new MutationObserver((mutations) => {
      if (isUpdating) return;

      if (!document.contains(tabElement)) {
        middleTabObserver.disconnect();
        middleTabObserver = null;
        lastMiddleTab = null;
        checkAndApplyTabLogic();
        return;
      }

      const needsUpdate = mutations.some(m => {
        if (m.type === 'attributes') {
          const attrName = m.attributeName;
          if (attrName === 'disabled') return tabElement.hasAttribute('disabled');
          if (attrName === 'aria-disabled') return tabElement.getAttribute('aria-disabled') !== 'false';
          if (attrName === 'tabindex') return tabElement.getAttribute('tabindex') !== '0';
          if (attrName === 'aria-selected') return tabElement.getAttribute('aria-selected') !== 'true';
          if (attrName === 'style') return tabElement.style.pointerEvents !== 'auto';
          if (attrName === 'class') return !tabElement.classList.contains('iron-selected');
        }
        return false;
      });

      if (!needsUpdate) return;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        forceActivateMiddleTab(tabElement);
        rafId = null;
      });
    });

    middleTabObserver.observe(tabElement, {
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'tabindex', 'aria-selected', 'style', 'class']
    });

    lastMiddleTab = tabElement;
  }

  function enhanceTouchHandling(tabs, middleIndex) {
    const MOVE_THRESHOLD = 10;

    tabs.forEach((tab, index) => {
      if (tab.dataset.touchEnhanced && document.contains(tab)) return;

      let startX, startY;

      tab.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
      }, { passive: true, once: false });

      tab.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        if (Math.abs(t.clientX - startX) < MOVE_THRESHOLD &&
          Math.abs(t.clientY - startY) < MOVE_THRESHOLD) {
          handleTabInteraction(index, middleIndex);
        }
      }, { passive: true });

      tab.dataset.touchEnhanced = 'true';
    });
  }

  function handleTabInteraction(tabIndex, middleIndex) {
    const lyricsElement = document.querySelector('.lyrics-plus-integrated');
    if (!lyricsElement) return;

    const shouldShow = tabIndex === middleIndex;
    const currentDisplay = lyricsElement.style.display;

    // Avoid unnecessary reflows
    if ((shouldShow && currentDisplay === 'block') ||
      (!shouldShow && currentDisplay === 'none')) {
      return;
    }

    lyricsElement.style.display = shouldShow ? 'block' : 'none';

    if (shouldShow) {
      document.querySelector("#tab-renderer").scrollTop = 0;
      const videoElement = document.querySelector('video');
      if (videoElement && typeof scrollActiveLine === 'function') {
        try {
          scrollActiveLine(videoElement.currentTime, true);
        } catch (e) {
          console.warn('scrollActiveLine failed:', e);
        }
      }
    }
  }

  function checkAndApplyTabLogic() {
    const tabs = document.querySelectorAll(
      'tp-yt-paper-tab.tab-header.style-scope.ytmusic-player-page'
    );

    if (tabs.length >= 3) {
      const middleIndex = Math.floor(tabs.length / 2);
      const middleTab = tabs[middleIndex];

      const needsReinit = currentMiddleIndex !== middleIndex ||
        !lastMiddleTab ||
        !document.contains(lastMiddleTab) ||
        lastMiddleTab !== middleTab;

      if (needsReinit) {
        currentMiddleIndex = middleIndex;

        forceActivateMiddleTab(middleTab);

        observeMiddleTab(middleTab);

        enhanceTouchHandling(tabs, middleIndex);

        tabs.forEach((tab, index) => {
          if (!tab.dataset.clickEnhanced || !document.contains(tab)) {
            tab.addEventListener('click', () => handleTabInteraction(index, middleIndex), { passive: true });
            tab.dataset.clickEnhanced = 'true';
          }
        });
      } else {
        forceActivateMiddleTab(middleTab);
      }
    } else if (tabs.length < 3) {
      currentMiddleIndex = -1;
      if (middleTabObserver) {
        middleTabObserver.disconnect();
        middleTabObserver = null;
      }
      lastMiddleTab = null;
    }
  }

  function ensureSidePanelActive() {
    const sidePanel = document.querySelector('#side-panel');
    if (sidePanel?.hasAttribute('inert')) {
      sidePanel.removeAttribute('inert');
    }
  }

  function maintainObservers() {
    const currentSidePanel = document.querySelector('#side-panel');

    if (currentSidePanel) {
      if (currentSidePanel !== observedSidePanelEl) {
        if (sidePanelObserver) sidePanelObserver.disconnect();

        ensureSidePanelActive();

        sidePanelObserver = new MutationObserver((mutations) => {
          if (mutations.some(m => m.type === 'attributes' && m.attributeName === 'inert')) {
            ensureSidePanelActive();
          }
        });

        sidePanelObserver.observe(currentSidePanel, {
          attributes: true,
          attributeFilter: ['inert']
        });
        observedSidePanelEl = currentSidePanel;
      }
    } else if (observedSidePanelEl) {
      if (sidePanelObserver) {
        sidePanelObserver.disconnect();
        sidePanelObserver = null;
      }
      observedSidePanelEl = null;
    }

    const sampleTab = document.querySelector('tp-yt-paper-tab.tab-header.style-scope.ytmusic-player-page');
    const currentContainer = sampleTab?.parentElement;

    if (currentContainer) {
      if (currentContainer !== observedTabContainerEl) {
        if (tabContainerObserver) tabContainerObserver.disconnect();

        checkAndApplyTabLogic();

        tabContainerObserver = new MutationObserver(() => {
          checkAndApplyTabLogic();
        });

        tabContainerObserver.observe(currentContainer, {
          childList: true,
          subtree: false
        });
        observedTabContainerEl = currentContainer;
      }

      // Periodically verify middle tab state
      if (lastMiddleTab && document.contains(lastMiddleTab)) {
        forceActivateMiddleTab(lastMiddleTab);
      } else if (lastMiddleTab && !document.contains(lastMiddleTab)) {
        checkAndApplyTabLogic();
      }
    } else if (observedTabContainerEl) {
      if (tabContainerObserver) {
        tabContainerObserver.disconnect();
        tabContainerObserver = null;
      }
      observedTabContainerEl = null;
      currentMiddleIndex = -1;
      lastMiddleTab = null;
    }
  }

  // Initial setup
  maintainObservers();

  const intervalId = setInterval(maintainObservers, 3000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      maintainObservers();
    }
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(intervalId);
    if (rafId) cancelAnimationFrame(rafId);
    middleTabObserver?.disconnect();
    sidePanelObserver?.disconnect();
    tabContainerObserver?.disconnect();
  }, { once: true });

})();