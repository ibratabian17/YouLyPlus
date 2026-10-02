/**
 * Dictionary Service for Offline Romanization.
 * Manages the offline Kuromoji morphological dictionary and Rawi model in IndexedDB.
 * Dictionaries are ONLY downloaded upon explicit user action in Settings.
 */

import { dictionaryDB } from '../../storage/database.js';
import { kuromoji } from '../../../lib/kuromoji.js';
import { cattDiacritizer } from './cattDiacritizer.js';

const KUROMOJI_FILES = [
  'base.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_pos.dat.gz', 'tid_map.dat.gz',
  'cc.dat.gz', 'unk.dat.gz', 'unk_pos.dat.gz', 'unk_map.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz'
];

const CATT_ENCODER_URL = 'https://github.com/ibratabian17/download-mirror/releases/download/arabic-roman/arabic_tashkeel_catt_encoder.onnx';
const CATT_DECODER_URL = 'https://github.com/ibratabian17/download-mirror/releases/download/arabic-roman/arabic_tashkeel_catt_decoder.onnx';

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
   * Checks if the CaTT Arabic diacritizer model is installed in IndexedDB.
   */
  async getCattStatus() {
    try {
      const meta = await dictionaryDB.get('catt_meta');
      if (meta && meta.installed) {
        return { installed: true, timestamp: meta.timestamp, sizeMB: meta.sizeMB || '74.3' };
      }
      return { installed: false };
    } catch (e) {
      return { installed: false };
    }
  }

  getRawiStatus() {
    return this.getCattStatus();
  }

  /**
   * Downloads the CaTT ONNX encoder and decoder models upon user confirmation.
   */
  async downloadCatt() {
    const [encoderRes, decoderRes] = await Promise.all([
      fetch(CATT_ENCODER_URL),
      fetch(CATT_DECODER_URL)
    ]);

    if (!encoderRes.ok) throw new Error(`Failed to download CaTT encoder model: HTTP ${encoderRes.status}`);
    if (!decoderRes.ok) throw new Error(`Failed to download CaTT decoder model: HTTP ${decoderRes.status}`);

    const encoderBuffer = await encoderRes.arrayBuffer();
    const decoderBuffer = await decoderRes.arrayBuffer();

    await dictionaryDB.set({ key: 'catt_encoder', data: encoderBuffer });
    await dictionaryDB.set({ key: 'catt_decoder', data: decoderBuffer });

    const totalBytes = encoderBuffer.byteLength + decoderBuffer.byteLength;
    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(1);

    await dictionaryDB.set({
      key: 'catt_meta',
      installed: true,
      timestamp: Date.now(),
      sizeMB
    });

    // Clean up legacy rawi keys if present
    await dictionaryDB.delete('rawi_model').catch(() => {});
    await dictionaryDB.delete('rawi_vocab').catch(() => {});
    await dictionaryDB.delete('rawi_meta').catch(() => {});

    await cattDiacritizer.init();

    return { success: true, sizeMB };
  }

  downloadRawi() {
    return this.downloadCatt();
  }

  /**
   * Deletes the CaTT models from IndexedDB.
   */
  async deleteCatt() {
    await dictionaryDB.delete('catt_encoder').catch(() => {});
    await dictionaryDB.delete('catt_decoder').catch(() => {});
    await dictionaryDB.delete('catt_meta').catch(() => {});
    await dictionaryDB.delete('rawi_model').catch(() => {});
    await dictionaryDB.delete('rawi_vocab').catch(() => {});
    await dictionaryDB.delete('rawi_meta').catch(() => {});
    await cattDiacritizer.destroy();
    return { success: true };
  }

  deleteRawi() {
    return this.deleteCatt();
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
