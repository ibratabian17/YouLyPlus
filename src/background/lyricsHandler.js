// ==================================================================================================
// SERVICE WORKER - MAIN
// ==================================================================================================

import { MessageHandler } from './core/messageHandler.js';

const pBrowser = chrome || browser;

// ==================================================================================================
// INITIALIZATION
// ==================================================================================================

console.log('Service Worker initialized');

pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return MessageHandler.handle(message, sender, sendResponse);
});
