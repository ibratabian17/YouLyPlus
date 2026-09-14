/**
 * Dictionary Service for Offline Romanization.
 * Manages the offline Kuromoji morphological dictionary and Rawi model in IndexedDB.
 * Dictionaries are ONLY downloaded upon explicit user action in Settings.
 */

import { dictionaryDB } from '../../storage/database.js';
import { kuromoji } from '../../../lib/kuromoji.js';
import { rawiDiacritizer } from './rawiDiacritizer.js';

const KUROMOJI_FILES = [
  'base.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_pos.dat.gz', 'tid_map.dat.gz',
  'cc.dat.gz', 'unk.dat.gz', 'unk_pos.dat.gz', 'unk_map.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz'
];

class DictionaryService {
  constructor() {
    this.kuromojiTokenizer = null;
    this.ongoingTokenizerInit = null;
  }

  /**
   * Checks if the Kuromoji dictionary is installed in IndexedDB.
   */
  async getKuromojiStatus() {
    try {
      const meta = await dictionaryDB.get('kuromoji_meta');
      if (meta && meta.installed) {
        return { installed: true, timestamp: meta.timestamp, sizeMB: meta.sizeMB || '17' };
      }
      return { installed: false };
    } catch (e) {
      return { installed: false };
    }
  }

  /**
   * Downloads the Kuromoji dictionary files from CDN and stores
   * them decompressed into IndexedDB. Triggered only by user confirmation in Settings.
   */
  async downloadKuromoji() {
    const cdnBase = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';
    let totalBytes = 0;

    for (let i = 0; i < KUROMOJI_FILES.length; i++) {
      const filename = KUROMOJI_FILES[i];
      const res = await fetch(cdnBase + filename);
      if (!res.ok) throw new Error(`Failed to download ${filename}: HTTP ${res.status}`);
      const compressedBuffer = await res.arrayBuffer();
      totalBytes += compressedBuffer.byteLength;

      const ds = new DecompressionStream('gzip');
      const decompressedStream = new Response(compressedBuffer).body.pipeThrough(ds);
      const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();

      await dictionaryDB.set({
        key: 'kuromoji_' + filename,
        data: decompressedBuffer
      });
    }

    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(1);

    await dictionaryDB.set({
      key: 'kuromoji_meta',
      installed: true,
      timestamp: Date.now(),
      sizeMB: sizeMB
    });

    this.kuromojiTokenizer = null;
    await this.getKuromojiTokenizer();

    return { success: true, sizeMB };
  }

  /**
   * Deletes the Kuromoji dictionary from IndexedDB and clears memory cache.
   */
  async deleteKuromoji() {
    for (const filename of KUROMOJI_FILES) {
      await dictionaryDB.delete('kuromoji_' + filename).catch(() => {});
    }
    await dictionaryDB.delete('kuromoji_meta').catch(() => {});
    this.kuromojiTokenizer = null;
    return { success: true };
  }

  /**
   * Checks if the Rawi Arabic diacritizer model is installed in IndexedDB.
   */
  async getRawiStatus() {
    try {
      const meta = await dictionaryDB.get('rawi_meta');
      if (meta && meta.installed) {
        return { installed: true, timestamp: meta.timestamp, sizeMB: meta.sizeMB || '4.9' };
      }
      return { installed: false };
    } catch (e) {
      return { installed: false };
    }
  }

  /**
   * Downloads the Rawi ONNX model and vocab from Hugging Face upon user confirmation.
   */
  async downloadRawi() {
    const modelUrl = 'https://huggingface.co/TigreGotico/rawi-ensemble/resolve/main/rawi_ensemble.int8.onnx';
    const vocabUrl = 'https://huggingface.co/TigreGotico/rawi-ensemble/raw/main/vocab.json';

    const [modelRes, vocabRes] = await Promise.all([
      fetch(modelUrl),
      fetch(vocabUrl)
    ]);

    if (!modelRes.ok) throw new Error(`Failed to download Rawi model: HTTP ${modelRes.status}`);
    if (!vocabRes.ok) throw new Error(`Failed to download Rawi vocab: HTTP ${vocabRes.status}`);

    const modelBuffer = await modelRes.arrayBuffer();
    const vocab = await vocabRes.json();

    await dictionaryDB.set({ key: 'rawi_model', data: modelBuffer });
    await dictionaryDB.set({ key: 'rawi_vocab', data: vocab });

    const sizeMB = (modelBuffer.byteLength / (1024 * 1024)).toFixed(1);

    await dictionaryDB.set({
      key: 'rawi_meta',
      installed: true,
      timestamp: Date.now(),
      sizeMB
    });

    await rawiDiacritizer.init(modelBuffer, vocab);

    return { success: true, sizeMB };
  }

  /**
   * Deletes the Rawi model and vocab from IndexedDB.
   */
  async deleteRawi() {
    await dictionaryDB.delete('rawi_model').catch(() => {});
    await dictionaryDB.delete('rawi_vocab').catch(() => {});
    await dictionaryDB.delete('rawi_meta').catch(() => {});
    await rawiDiacritizer.destroy();
    return { success: true };
  }

  /**
   * Retrieves the Kuromoji tokenizer if installed in IndexedDB (returns null if not installed).
   */
  async getKuromojiTokenizer() {
    if (this.kuromojiTokenizer) return this.kuromojiTokenizer;
    if (this.ongoingTokenizerInit) return this.ongoingTokenizerInit;

    const meta = await dictionaryDB.get('kuromoji_meta').catch(() => null);
    if (!meta || !meta.installed) {
      return null;
    }

    this.ongoingTokenizerInit = (async () => {
      try {
        const memStore = new Map();
        for (const filename of KUROMOJI_FILES) {
          const record = await dictionaryDB.get('kuromoji_' + filename);
          if (!record || !record.data) throw new Error(`Missing local buffer for ${filename}`);
          memStore.set(filename, record.data);
        }

        kuromoji.setCustomLoader((url, callback) => {
          const fn = url.split('/').pop();
          const buf = memStore.get(fn);
          if (buf) {
            callback(null, buf);
          } else {
            callback(new Error(`Kuromoji file not found in local DB: ${fn}`));
          }
        });

        const tokenizer = await new Promise((resolve, reject) => {
          kuromoji.builder({ dicPath: '' }).build((err, tok) => {
            if (err) reject(err);
            else resolve(tok);
          });
        });

        this.kuromojiTokenizer = tokenizer;
        return tokenizer;
      } catch (err) {
        console.warn('[DictionaryService] Could not initialize Kuromoji from IndexedDB:', err);
        return null;
      } finally {
        this.ongoingTokenizerInit = null;
      }
    })();

    return this.ongoingTokenizerInit;
  }
}

export const dictionaryService = new DictionaryService();
