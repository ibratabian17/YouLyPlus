(async function () {
  async function waitForDOMReady() {
    if (
      document.readyState === 'complete' ||
      document.readyState === 'interactive'
    ) {
      return;
    }
    await new Promise((resolve) =>
      document.addEventListener('DOMContentLoaded', resolve)
    );
  }

  await waitForDOMReady();

  let middleTabObserver = null;
  let updateScheduled = false;
  let isUpdating = false;
  let tabsInitialized = false;

  let sidePanelObserver = null;
  let tabContainerObserver = null;
  let observedSidePanelEl = null;
  let observedTabContainerEl = null;

  function forceActivateMiddleTab(tabElement) {
    if (!tabElement) return;
    if (
      !tabElement.hasAttribute('disabled') &&
      tabElement.getAttribute('aria-disabled') === 'false' &&
      tabElement.getAttribute('tabindex') === '0' &&
      tabElement.getAttribute('aria-selected') === 'true' &&
      tabElement.style.pointerEvents === 'auto'
    ) {
      return;
    }
    if (isUpdating) return;
    isUpdating = true;
    if (middleTabObserver) middleTabObserver.disconnect();

    tabElement.removeAttribute('disabled');
    tabElement.setAttribute('aria-disabled', 'false');
    tabElement.setAttribute('tabindex', '0');
    tabElement.setAttribute('aria-selected', 'true');
    tabElement.style.pointerEvents = 'auto';

    isUpdating = false;
    observeMiddleTab(tabElement);
  }

  function observeMiddleTab(tabElement) {
    if (!tabElement) return;
    if (middleTabObserver) middleTabObserver.disconnect();

    middleTabObserver = new MutationObserver(() => {
      if (!updateScheduled && !isUpdating) {
        updateScheduled = true;
        requestAnimationFrame(() => {
          forceActivateMiddleTab(tabElement);
          updateScheduled = false;
        });
      }
    });

    middleTabObserver.observe(tabElement, {
      attributes: true,
      attributeFilter: [
        'disabled',
        'aria-disabled',
        'tabindex',
        'aria-selected',
        'style'
      ]
    });
  }

  function enhanceTouchHandling(tabs, middleIndex) {
    const MOVE_THRESHOLD_PX = 10;
    tabs.forEach((tab, index) => {
      let startX, startY;
      if (!tab.dataset.touchEnhanced) {
        tab.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            startX = t.clientX;
            startY = t.clientY;
          }, { passive: true });
        tab.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            const dx = Math.abs(t.clientX - startX);
            const dy = Math.abs(t.clientY - startY);
            if (dx < MOVE_THRESHOLD_PX && dy < MOVE_THRESHOLD_PX) {
              handleTabInteraction(index, middleIndex);
            }
          });
        tab.dataset.touchEnhanced = 'true';
      }
    });
  }

  function handleTabInteraction(tabIndex, middleIndex) {
    const lyricsElement = document.querySelector('.lyrics-plus-integrated');
    if (!lyricsElement) return;

    if (tabIndex === middleIndex) {
      lyricsElement.style.display = 'block';
      const videoElement = document.querySelector('video');
      if (videoElement && typeof scrollActiveLine === 'function') {
          try { scrollActiveLine(videoElement.currentTime, true); } 
          catch (e) {}
      }
    } else {
      lyricsElement.style.display = 'none';
    }
  }

  function checkAndApplyTabLogic() {
    const tabs = document.querySelectorAll(
      'tp-yt-paper-tab.tab-header.style-scope.ytmusic-player-page'
    );

    if (tabs.length >= 3 && !tabsInitialized) {
        const middleIndex = Math.floor(tabs.length / 2);
        const middleTab = tabs[middleIndex];
        forceActivateMiddleTab(middleTab);
        observeMiddleTab(middleTab);
        enhanceTouchHandling(tabs, middleIndex);

        tabs.forEach((tab, index) => {
            if (!tab.dataset.clickEnhanced) {
                tab.addEventListener('click', () => handleTabInteraction(index, middleIndex));
                tab.dataset.clickEnhanced = 'true';
            }
        });
        tabsInitialized = true;

    } else if (tabs.length < 3 && tabsInitialized) {
        tabsInitialized = false;
        if (middleTabObserver) {
            middleTabObserver.disconnect();
            middleTabObserver = null;
        }
    }
  }

  function ensureSidePanelActive() {
      const sidePanel = document.querySelector('#side-panel');
      if (sidePanel && sidePanel.hasAttribute('inert')) {
          sidePanel.removeAttribute('inert');
      }
  }

  function maintainObservers() {
    const currentSidePanel = document.querySelector('#side-panel');
    if (currentSidePanel && currentSidePanel !== observedSidePanelEl) {
        if (sidePanelObserver) sidePanelObserver.disconnect();
        
        ensureSidePanelActive();

        sidePanelObserver = new MutationObserver((mutations) => {
             for(const m of mutations) {
                 if (m.type === 'attributes' && m.attributeName === 'inert') {
                     ensureSidePanelActive();
                     break;
                 }
             }
        });
        sidePanelObserver.observe(currentSidePanel, { attributes: true, attributeFilter: ['inert'] });
        observedSidePanelEl = currentSidePanel;
    }

    const sampleTab = document.querySelector('tp-yt-paper-tab.tab-header.style-scope.ytmusic-player-page');
    if (sampleTab && sampleTab.parentElement) {
        const currentContainer = sampleTab.parentElement;
        if (currentContainer !== observedTabContainerEl) {
             if (tabContainerObserver) tabContainerObserver.disconnect();

             checkAndApplyTabLogic();

             tabContainerObserver = new MutationObserver(() => {
                 checkAndApplyTabLogic();
             });
             tabContainerObserver.observe(currentContainer, { childList: true });
             observedTabContainerEl = currentContainer;
        }
    }
  }

  maintainObservers();
  setInterval(maintainObservers, 2000);

})();