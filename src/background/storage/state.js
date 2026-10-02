// ==================================================================================================
// STATE MANAGEMENT
// ==================================================================================================

class StateManager {
  constructor() {
    this.lyricsCache = new Map();
    this.ongoingFetches = new Map();
  }

  getCached(key) {
    return this.lyricsCache.get(key);
  }

  setCached(key, value) {
    this.lyricsCache.set(key, value);
  }

  hasCached(key) {
    return this.lyricsCache.has(key);
  }

  getOngoingFetch(key) {
    return this.ongoingFetches.get(key);
  }

  setOngoingFetch(key, promise) {
    this.ongoingFetches.set(key, promise);
  }

  deleteOngoingFetch(key) {
    this.ongoingFetches.delete(key);
  }

  hasOngoingFetch(key) {
    return this.ongoingFetches.has(key);
  }

  clear(target = 'all') {
    if (target === 'lyrics') {
      for (const key of this.lyricsCache.keys()) {
        if (!key.includes(' - translate - ') && !key.includes(' - romanize - ')) {
          this.lyricsCache.delete(key);
        }
      }
      this.ongoingFetches.clear();
    } else if (target === 'translations') {
      for (const key of this.lyricsCache.keys()) {
        if (key.includes(' - translate - ')) {
          this.lyricsCache.delete(key);
        }
      }
    } else if (target === 'romanization' || target === 'transliteration') {
      for (const key of this.lyricsCache.keys()) {
        if (key.includes(' - romanize - ')) {
          this.lyricsCache.delete(key);
        }
      }
    } else {
      this.lyricsCache.clear();
      this.ongoingFetches.clear();
    }
  }
}

export const state = new StateManager();
