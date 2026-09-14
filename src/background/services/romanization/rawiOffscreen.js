/**
 * Offscreen document bridge for the Rawi diacritizer in Chrome MV3,
 * hosting the dedicated worker thread and bridging runtime messages.
 */

const WORKER_URL = chrome.runtime.getURL('src/background/services/romanization/rawiDiacritizer.worker.mjs');

let worker = null;
const pending = new Map();

function startWorker() {
  if (worker) return worker;

  worker = new Worker(WORKER_URL, { type: 'module' });

  worker.onmessage = (event) => {
    const { id } = event.data || {};
    const respond = pending.get(id);
    if (!respond) return;
    pending.delete(id);
    respond(event.data);
  };

  worker.onerror = (error) => {
    const payload = { err: error?.message || 'Rawi worker failed' };
    for (const respond of pending.values()) {
      try { respond(payload); } catch (e) { /* ignore */ }
    }
    pending.clear();
    if (worker) {
      try { worker.terminate(); } catch (e) { /* ignore */ }
    }
    worker = null;
  };

  return worker;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.target !== 'rawi-offscreen') return;

  if (!worker) {
    try {
      startWorker();
    } catch (err) {
      sendResponse({ err: String(err?.message || err) });
      return;
    }
  }

  const { id } = message;
  if (id === undefined) {
    sendResponse({ err: 'Missing message id' });
    return;
  }

  pending.set(id, sendResponse);
  try {
    worker.postMessage(message);
  } catch (err) {
    pending.delete(id);
    sendResponse({ err: String(err?.message || err) });
  }

  return true;
});