/**
 * CaTT (Character-based Arabic Tashkeel Transformer) Diacritizer Worker Thread.
 * Executes ONNX Runtime Web inside a dedicated worker context where Atomics.wait is legal.
 */

import * as ort from '../../../lib/ort.bundle.min.mjs';
import { dictionaryDB } from '../../storage/database.js';

ort.env.wasm.wasmPaths = {
  wasm: new URL('../../../lib/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../../../lib/ort-wasm-simd-threaded.mjs', import.meta.url).href
};

let encoderSession = null;
let decoderSession = null;
let loadPromise = null;

const BUCK2UNI = {
  "'": "\u0621", "|": "\u0622", ">": "\u0623", "&": "\u0624", "<": "\u0625", "}": "\u0626",
  "A": "\u0627", "b": "\u0628", "p": "\u0629", "t": "\u062A", "v": "\u062B", "j": "\u062C",
  "H": "\u062D", "x": "\u062E", "d": "\u062F", "*": "\u0630", "r": "\u0631", "z": "\u0632",
  "s": "\u0633", "$": "\u0634", "S": "\u0635", "D": "\u0636", "T": "\u0637", "Z": "\u0638",
  "E": "\u0639", "g": "\u063A", "_": "\u0640", "f": "\u0641", "q": "\u0642", "k": "\u0643",
  "l": "\u0644", "m": "\u0645", "n": "\u0646", "h": "\u0647", "w": "\u0648", "Y": "\u0649",
  "y": "\u064A", "F": "\u064B", "N": "\u064C", "K": "\u064D", "a": "\u064E", "u": "\u064F",
  "i": "\u0650", "~": "\u0651", "o": "\u0652", "`": "\u0670", "{": "\u0671"
};

const UNI2BUCK = {};
for (const [k, v] of Object.entries(BUCK2UNI)) {
  UNI2BUCK[v] = k;
}
UNI2BUCK["\ufefb"] = "lA";
UNI2BUCK["\ufef7"] = "l>";
UNI2BUCK["\ufef5"] = "l|";
UNI2BUCK["\ufef9"] = "l<";

const LETTERS = [
  '<PAD>', '<BOS>', '<EOS>',
  ' ', '$', '&', "'", '*', '<', '>', 'A', 'D', 'E', 'H', 'S', 'T', 'Y', 'Z',
  'b', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't',
  'v', 'w', 'x', 'y', 'z', '|', '}',
  '<MASK>'
];
const LETTERS_MAP = Object.fromEntries(LETTERS.map((c, i) => [c, i]));

const TASHKEEL_LIST = [
  '<PAD>', '<BOS>', '<EOS>',
  '<NT>', '<SD>', '<SDD>', '<SF>', '<SFF>', '<SK>',
  '<SKK>', 'F', 'K', 'N', 'a', 'i', 'o', 'u', '~'
];

const TAGS = {
  '<SF>': '~a',
  '<SD>': '~u',
  '<SK>': '~i',
  '<SFF>': '~F',
  '<SDD>': '~N',
  '<SKK>': '~K'
};

function ar2bw(text) {
  let out = '';
  for (const c of text) out += UNI2BUCK[c] !== undefined ? UNI2BUCK[c] : c;
  return out;
}

function bw2ar(text) {
  let out = '';
  for (const c of text) out += BUCK2UNI[c] !== undefined ? BUCK2UNI[c] : c;
  return out;
}

function cleanText(text) {
  let t = text.replace(/\u0640/g, '').replace(/\u0671/g, '\u0627');
  t = t.replace(/[\u064B-\u0652\u0670]/g, ''); // strip existing tashkeel
  return t.replace(/[^\u0621-\u063A\u0641-\u064A ]/gu, ' ').trim().replace(/\s+/g, ' ');
}

function isSessionReady() {
  return encoderSession !== null && decoderSession !== null;
}

async function createSessions(encoderBuffer, decoderBuffer) {
  encoderSession = await ort.InferenceSession.create(encoderBuffer, {
    executionProviders: ['wasm']
  });
  decoderSession = await ort.InferenceSession.create(decoderBuffer, {
    executionProviders: ['wasm']
  });
}

async function ensureLoaded() {
  if (isSessionReady()) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return false;

      const meta = await dictionaryDB.get('catt_meta').catch(() => null);
      if (!meta || !meta.installed) return false;

      const cachedEncoder = await dictionaryDB.get('catt_encoder');
      const cachedDecoder = await dictionaryDB.get('catt_decoder');
      if (!cachedEncoder?.data || !cachedDecoder?.data) return false;

      await createSessions(cachedEncoder.data, cachedDecoder.data);
      return true;
    } catch (err) {
      console.warn('[CattDiacritizer] Failed to initialize from IndexedDB:', err);
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

async function diacritizeSegment(arabicText) {
  const cleaned = cleanText(arabicText);
  if (!cleaned) return arabicText;

  const bwText = ar2bw(cleaned);
  const seqLen = bwText.length;
  if (seqLen === 0) return arabicText;

  const srcIds = new BigInt64Array(seqLen);
  for (let i = 0; i < seqLen; i++) {
    const ch = bwText[i];
    srcIds[i] = BigInt(LETTERS_MAP[ch] !== undefined ? LETTERS_MAP[ch] : 0);
  }

  const srcTensor = new ort.Tensor('int64', srcIds, [1, seqLen]);
  const maskData = new Uint8Array(seqLen * seqLen);
  maskData.fill(1);
  const maskTensor = new ort.Tensor('bool', maskData, [1, 1, seqLen, seqLen]);

  const encOutput = await encoderSession.run({ src: srcTensor, src_mask: maskTensor });
  const encSrc = encOutput.encoder_output;

  const decOutput = await decoderSession.run({ enc_src: encSrc });
  const decLogits = decOutput.decoder_output.data;

  let combinedBw = '';
  const numClasses = 18;
  const spaceIdx = LETTERS_MAP[' '];

  for (let i = 0; i < seqLen; i++) {
    const charBw = bwText[i];
    combinedBw += charBw;

    if (srcIds[i] === BigInt(spaceIdx)) {
      continue;
    }

    let maxIdx = 3; // '<NT>'
    let maxVal = -Infinity;
    const offset = i * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const val = decLogits[offset + c];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }

    const tag = TASHKEEL_LIST[maxIdx];
    if (TAGS[tag]) {
      combinedBw += TAGS[tag];
    } else if (tag !== '<NT>' && tag !== '<PAD>' && tag !== '<BOS>' && tag !== '<EOS>') {
      combinedBw += tag;
    }
  }

  return bw2ar(combinedBw);
}

async function diacritize(text) {
  if (!text || !isSessionReady()) return text;

  // Split text by Arabic phrases (+ spaces) and non-Arabic tokens
  const tokens = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]+|[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]+/gu) || [text];

  let result = '';
  for (const token of tokens) {
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(token)) {
      try {
        const vocalized = await diacritizeSegment(token);
        result += vocalized || token;
      } catch (e) {
        result += token;
      }
    } else {
      result += token;
    }
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
      encoderSession = null;
      decoderSession = null;
    }).then(
      () => send({ ok: true }),
      (err) => send({ err: String(err?.message || err) })
    );
  }
});
