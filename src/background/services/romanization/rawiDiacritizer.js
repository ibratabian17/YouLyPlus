/**
 * Neural Arabic Diacritizer using Rawi ONNX model.
 * ONNX Runtime runs inside a dedicated worker (rawiDiacritizer.worker.mjs)
 * because the simd-threaded WASM build uses Atomics.wait, which Chrome MV3
 * service workers cannot execute directly. The worker is hosted directly (e.g. Firefox)
 * or bridged via an offscreen document (Chrome MV3).
 */

const WORKER_URL = 'src/background/services/romanization/rawiDiacritizer.worker.mjs';
const OFFSCREEN_URL = 'src/background/services/romanization/rawiOffscreen.html';

export class RawiDiacritizer {
  constructor() {
    this.cache = new Map();
    this._ready = false;
    this._ensurePromise = null;
    this.transport = this._detectTransport();
    this.worker = null;
    this._offscreenReady = false;
    this.pending = new Map();
    this.nextId = 0;

    this.session = null;
    this.c2i = null;
    this.i2d = null;
  }

  _detectTransport() {
    if (typeof Worker === 'function') return 'worker';
    if (typeof chrome !== 'undefined' && chrome.offscreen) return 'offscreen';
    return null;
  }

  _getWorker() {
    if (this.worker) return this.worker;

    const worker = new Worker(chrome.runtime.getURL(WORKER_URL), { type: 'module' });

    worker.onmessage = (event) => {
      const { id } = event.data || {};
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (event.data && event.data.err) {
        entry.reject(new Error(event.data.err));
      } else {
        entry.resolve(event.data);
      }
    };

    worker.onerror = (error) => {
      this._handleWorkerFailure(error);
    };

    this.worker = worker;
    return worker;
  }

  _handleWorkerFailure(error) {
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) { /* ignore */ }
    }
    this.worker = null;
    this._ready = false;
    for (const entry of this.pending.values()) {
      entry.reject(new Error(error?.message || 'RawiDiacritizer worker failed'));
    }
    this.pending.clear();
  }

  async _ensureOffscreen() {
    if (this._offscreenReady) return;

    const offscreen = chrome.offscreen;
    if (!offscreen) throw new Error('chrome.offscreen is not available');

    let hasDocument = false;
    if (typeof offscreen.hasDocument === 'function') {
      hasDocument = await offscreen.hasDocument();
    } else {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      hasDocument = contexts.length > 0;
    }

    if (!hasDocument) {
      await offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_URL),
        reasons: ['WORKERS'],
        justification: 'Run the Rawi ONNX Arabic diacritizer in a worker for offline lyrics romanization.'
      });
    }

    this._offscreenReady = true;
  }

  _postToWorker(msg) {
    msg.id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      try {
        this._getWorker().postMessage(msg);
      } catch (err) {
        this.pending.delete(msg.id);
        reject(err);
      }
    });
  }

  async _postToOffscreen(msg) {
    msg.id = ++this.nextId;
    msg.target = 'rawi-offscreen';
    await this._ensureOffscreen();
    try {
      const res = await chrome.runtime.sendMessage(msg);
      if (!res) throw new Error('No response from Rawi diacritizer offscreen document');
      if (res.err) throw new Error(res.err);
      return res;
    } catch (err) {
      this._offscreenReady = false;
      throw err;
    }
  }

  _post(msg) {
    if (this.transport === 'worker') return this._postToWorker(msg);
    if (this.transport === 'offscreen') return this._postToOffscreen(msg);
    return Promise.reject(new Error('No available transport for RawiDiacritizer'));
  }

  async init() {
    const res = await this._post({ type: 'init' });
    this._ready = !!res.ok;
    return this._ready;
  }

  ensureLoaded() {
    if (this._ready) return Promise.resolve(true);
    if (this._ensurePromise) return this._ensurePromise;

    this._ensurePromise = (async () => {
      try {
        const res = await this._post({ type: 'ensureLoaded' });
        this._ready = !!res.ok;
        return this._ready;
      } catch (err) {
        console.warn('[RawiDiacritizer] Failed to initialize diacritizer:', err);
        return false;
      } finally {
        this._ensurePromise = null;
      }
    })();

    return this._ensurePromise;
  }

  isReady() {
    return this._ready;
  }

  /**
   * Automatically adds Harakat (Tashkeel) to an unvocalized Arabic string.
   */
  async diacritize(text) {
    if (!text) return text;

    if (/[\u064B-\u0652\u0670]/u.test(text)) {
      return text;
    }

    if (!this.isReady()) {
      const ok = await this.ensureLoaded();
      if (!ok) return text;
    }

    if (this.cache.has(text)) {
      return this.cache.get(text);
    }

    try {
      const res = await this._post({ type: 'diacritize', text });
      const vocalized = res.result ?? text;

      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(text, vocalized);

      return vocalized;
    } catch (err) {
      console.warn('[RawiDiacritizer] Diacritization failed, returning original text:', err);
      return text;
    }
  }

  async destroy() {
    this.session = null;
    this.c2i = null;
    this.i2d = null;
    this.cache.clear();
    this._ready = false;
    this._ensurePromise = null;

    if (this.transport === 'worker') {
      if (this.worker) {
        const worker = this.worker;
        worker.onmessage = null;
        worker.onerror = null;
        this.worker = null;
        try { worker.terminate(); } catch (e) { /* ignore */ }
      }
    } else if (this.transport === 'offscreen' && this._offscreenReady) {
      this._offscreenReady = false;
      try { await chrome.offscreen.closeDocument(); } catch (e) { /* ignore */ }
    }

    for (const entry of this.pending.values()) {
      entry.reject(new Error('RawiDiacritizer destroyed'));
    }
    this.pending.clear();
  }
}

export const rawiDiacritizer = new RawiDiacritizer();