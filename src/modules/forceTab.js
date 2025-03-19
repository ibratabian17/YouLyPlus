(async function () {
  // Helper: Wait for the DOM to be ready
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

  // Helper: Sleep for a given amount of milliseconds
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Wait for the DOM to be ready before initializing
  await waitForDOMReady();

  let middleTabObserver = null;
  let updateScheduled = false;
  let isUpdating = false;

  // Update the middle tab's attributes if they are not already set correctly.
  function forceActivateMiddleTab(tabElement) {
    if (!tabElement) return;

    // If already active, then skip update.
    if (
      !tabElement.hasAttribute('disabled') &&
      tabElement.getAttribute('aria-disabled') === 'false' &&
      tabElement.getAttribute('tabindex') === '0' &&
      tabElement.getAttribute('aria-selected') === 'true' &&
      tabElement.style.pointerEvents === 'auto'
    ) {
      return;
    }

    // Prevent reentrant calls.
    if (isUpdating) return;
    isUpdating = true;

    // Disconnect observer temporarily to avoid triggering it during update.
    if (middleTabObserver) {
      middleTabObserver.disconnect();
    }

    // Update attributes to force the tab active.
    tabElement.removeAttribute('disabled');
    tabElement.setAttribute('aria-disabled', 'false');
    tabElement.setAttribute('tabindex', '0');
    tabElement.setAttribute('aria-selected', 'true');
    tabElement.style.pointerEvents = 'auto';
    
    console.log('Middle tab forced active');

    isUpdating = false;

    // Reattach the observer.
    observeMiddleTab(tabElement);
  }

  // Create a MutationObserver to monitor attribute changes on the middle tab.
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

  // Enhance touch handling for both mobile and desktop
  function enhanceTouchHandling(tabs, middleIndex) {
    tabs.forEach((tab, index) => {
      // Add touch event listeners for mobile devices
      tab.addEventListener('touchend', (e) => {
        // Handle touch end event for mobile
        handleTabInteraction(index, middleIndex);
      });
    });
  }

  // Handle tab interaction (used for both click and touch)
  function handleTabInteraction(tabIndex, middleIndex) {
    if (tabIndex === middleIndex) {
      const lyricsElement = document.querySelector('.lyrics-plus-integrated');
      if (lyricsElement) {
        lyricsElement.style.display = 'block';
        const videoElement = document.querySelector('video');
        if (videoElement) {
          try {
            if (typeof scrollActiveLine === 'function') {
              scrollActiveLine(videoElement.currentTime, true);
            }
          } catch (error) {
            console.log('Error scrolling to active line:', error);
          }
        }
        console.log('Showing .lyrics-plus-integrated');
      }
    } else {
      const lyricsElement = document.querySelector('.lyrics-plus-integrated');
      if (lyricsElement) {
        lyricsElement.style.display = 'none';
        console.log('Hiding .lyrics-plus-integrated');
      }
    }
  }

  // Function to check if viewport is mobile sized
  function isMobileViewport() {
    return window.innerWidth <= 768;
  }

  // Async initializer: waits for the required tabs to be present, then attaches listeners.
  async function init() {
    let tabs;
    // Poll for the tabs until we have at least 3.
    while (true) {
      tabs = document.querySelectorAll(
        'tp-yt-paper-tab.tab-header.style-scope.ytmusic-player-page'
      );
      if (tabs.length >= 3) break;
      await sleep(100);
    }

    const middleIndex = Math.floor(tabs.length / 2);
    const middleTab = tabs[middleIndex];

    // Force the middle tab active and set up its observer.
    forceActivateMiddleTab(middleTab);
    observeMiddleTab(middleTab);

    // Add enhanced touch handling for all devices
    enhanceTouchHandling(tabs, middleIndex);

    // When the middle tab is clicked, show the ".lyrics-plus-integrated" element.
    middleTab.addEventListener('click', () => {
      handleTabInteraction(middleIndex, middleIndex);
    });

    // For all other tabs, hide the ".lyrics-plus-integrated" element on click.
    tabs.forEach((tab, index) => {
      if (index !== middleIndex) {
        tab.addEventListener('click', () => {
          handleTabInteraction(index, middleIndex);
        });
      }
    });
  }

  // Start the initialization.
  init();
})();