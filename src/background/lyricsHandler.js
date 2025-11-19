// ==================================================================================================
// SERVICE WORKER - MAIN
// ==================================================================================================

import { MessageHandler } from './core/messageHandler.js';

const pBrowser = typeof browser !== 'undefined'
  ? browser
  : (typeof chrome !== 'undefined' ? chrome : null);

// ==================================================================================================
// INITIALIZATION
// ==================================================================================================

console.log('Service Worker initialized');

if (pBrowser?.runtime?.onMessage) {
  pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return MessageHandler.handle(message, sender, sendResponse);
  });
} else {
  console.error('Service Worker: runtime messaging not available');
}
