/**
 * RawiDiacritizer Worker Thread.
 * Executes ONNX Runtime Web inside a dedicated worker context where Atomics.wait is legal.
 */

import * as ort from '../../../lib/ort.bundle.min.mjs';
import { dictionaryDB } from '../../storage/database.js';

ort.env.wasm.wasmPaths = {
  wasm: new URL('../../../lib/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../../../lib/ort-wasm-simd-threaded.mjs', import.meta.url).href
};

let session = null;
let c2i = null;
let i2d = null;
let unk = 1;
let loadPromise = null;

function isSessionReady() {
  return session !== null && c2i !== null;
}

async function createSession(modelBuffer, vocab) {
  c2i = vocab.char_to_idx || {};
  unk = c2i['<UNK>'] !== undefined ? c2i['<UNK>'] : 1;

  i2d = {};
  if (vocab.diac_to_idx) {
    for (const [diac, idx] of Object.entries(vocab.diac_to_idx)) {
      i2d[idx] = diac;
    }
  }

  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm']
  });
}

async function ensureLoaded() {
  if (isSessionReady()) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return false;

      const meta = await dictionaryDB.get('rawi_meta').catch(() => null);
      if (!meta || !meta.installed) return false;

      const cachedModel = await dictionaryDB.get('rawi_model');
      const cachedVocab = await dictionaryDB.get('rawi_vocab');
      if (!cachedModel?.data || !cachedVocab?.data) return false;

      await createSession(cachedModel.data, cachedVocab.data);
      return true;
    } catch (err) {
      console.warn('[RawiDiacritizer] Failed to initialize from IndexedDB:', err);
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

async function diacritize(text) {
  if (!text || !isSessionReady()) return text;

  const nfd = text.normalize('NFD');
  const bareChars = [];
  for (const ch of nfd) {
    if (!/\p{Mn}/u.test(ch)) bareChars.push(ch);
  }

  if (bareChars.length === 0) return text;

  const ids = new BigInt64Array(bareChars.length);
  for (let i = 0; i < bareChars.length; i++) {
    const ch = bareChars[i];
    ids[i] = BigInt(c2i[ch] !== undefined ? c2i[ch] : unk);
  }

  const inputTensor = new ort.Tensor('int64', ids, [1, bareChars.length]);
  const output = await session.run({ input: inputTensor });
  const cls = output.gated_cls.data;

  let result = '';
  for (let i = 0; i < bareChars.length; i++) {
    const ch = bareChars[i];
    const classId = Number(cls[i]);
    const diac = (/\p{L}/u.test(ch) && i2d[classId]) ? i2d[classId] : '';
    result += ch + diac;
  }

  return result.normalize('NFC');
}

let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

self.addEventListener('message', (event) => {
  const { type, id } = event.data || {};
  const send = (payload) => self.postMessage({ type, id, ...payload });

  if (type === 'ensureLoaded' || type === 'init') {
    enqueue(ensureLoaded).then(
      (ok) => send({ ok: !!ok }),
      (err) => send({ err: String(err?.message || err) })
    );
  } else if (type === 'diacritize') {
    const text = event.data.text || '';
    enqueue(() => diacritize(text)).then(
      (result) => send({ result }),
      (err) => send({ err: String(err?.message || err) })
    );
  } else if (type === 'destroy') {
    enqueue(() => {
      session = null;
      c2i = null;
      i2d = null;
    }).then(
      () => send({ ok: true }),
      (err) => send({ err: String(err?.message || err) })
    );
  }
});