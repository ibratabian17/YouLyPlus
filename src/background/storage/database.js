// ==================================================================================================
// DATABASE LAYER
// ==================================================================================================

import { CONFIG } from '../constants.js';

class DatabaseManager {
  constructor(dbConfig) {
    this.config = dbConfig;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.name, this.config.version);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.config.store)) {
          const keyPath = this.config.store === 'localLyrics' ? 'songId' : 'key';
          db.createObjectStore(this.config.store, { keyPath });
        }
      };
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.config.store], "readonly");
      const store = transaction.objectStore(this.config.store);
      const request = store.get(key);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async set(data) {
    const db = await this.open();
    const transaction = db.transaction([this.config.store], "readwrite");
    const store = transaction.objectStore(this.config.store);
    store.put(data);
  }

  async delete(key) {
    const db = await this.open();
    const transaction = db.transaction([this.config.store], "readwrite");
    const store = transaction.objectStore(this.config.store);
    store.delete(key);
  }

  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.config.store], "readonly");
      const store = transaction.objectStore(this.config.store);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    const db = await this.open();
    const transaction = db.transaction([this.config.store], "readwrite");
    const store = transaction.objectStore(this.config.store);
    store.clear();
  }

  async estimateSize() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(this.config.store)) {
        resolve({ sizeKB: 0, count: 0 });
        return;
      }

      const transaction = db.transaction([this.config.store], "readonly");
      const store = transaction.objectStore(this.config.store);
      
      const getAllRequest = store.getAll();
      const countRequest = store.count();

      let sizeKB = 0;
      let count = 0;
      let completed = 0;

      const checkCompletion = () => {
        if (++completed === 2) {
          db.close();
          resolve({ sizeKB, count });
        }
      };

      getAllRequest.onsuccess = () => {
        const totalBytes = getAllRequest.result.reduce((acc, record) => {
          return acc + new TextEncoder().encode(JSON.stringify(record)).length;
        }, 0);
        sizeKB = totalBytes / 1024;
        checkCompletion();
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);

      countRequest.onsuccess = () => {
        count = countRequest.result;
        checkCompletion();
      };

      countRequest.onerror = () => reject(countRequest.error);
    });
  }
}

// Database instances
export const lyricsDB = new DatabaseManager(CONFIG.DB.CACHE);
export const translationsDB = new DatabaseManager(CONFIG.DB.TRANSLATIONS);
export const localLyricsDB = new DatabaseManager(CONFIG.DB.LOCAL);
