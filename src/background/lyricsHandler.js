// Universal Browser API handle
const pBrowser = chrome || browser;
console.log('Service Worker is active.');

/* =================== CONSTANTS =================== */
const CACHE_DB_NAME = "LyricsCacheDB";
const CACHE_DB_VERSION = 1;
const LYRICS_OBJECT_STORE = "lyrics";

const MESSAGE_TYPES = {
    FETCH_LYRICS: 'FETCH_LYRICS',
    RESET_CACHE: 'RESET_CACHE',
    GET_CACHED_SIZE: 'GET_CACHED_SIZE',
    TRANSLATE_LYRICS: 'TRANSLATE_LYRICS',
    FETCH_SPONSOR_SEGMENTS: 'FETCH_SPONSOR_SEGMENTS'
};

const CACHE_STRATEGIES = {
    AGGRESSIVE: 'aggressive',
    MODERATE: 'moderate',
    NONE: 'none'
};

const PROVIDERS = {
    KPOE: 'kpoe',
    CUSTOM_KPOE: 'customKpoe',
    LRCLIB: 'lrclib',
    GEMINI: 'gemini',
    GOOGLE: 'google'
};

const KPOE_SERVERS = [
    "https://lyricsplus.prjktla.workers.dev",
    "https://lyrics-plus-backend.vercel.app",
    "https://lyricsplus.onrender.com",
    "https://lyricsplus.prjktla.online"
];

/* =================== IN-MEMORY CACHE =================== */
const lyricsCache = new Map();
const ongoingFetches = new Map();


/* =================== INDEXEDDB HELPERS =================== */

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(LYRICS_OBJECT_STORE)) {
                db.createObjectStore(LYRICS_OBJECT_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function getLyricsFromDB(key) {
    const db = await openDB();
    const { cacheStrategy = CACHE_STRATEGIES.AGGRESSIVE } = await storageLocalGet('cacheStrategy');

    if (cacheStrategy === CACHE_STRATEGIES.NONE) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LYRICS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(LYRICS_OBJECT_STORE);
        const request = store.get(key);

        request.onsuccess = event => {
            const result = event.target.result;
            if (result) {
                const now = Date.now();
                const expirationTimes = {
                    [CACHE_STRATEGIES.AGGRESSIVE]: 2 * 60 * 60 * 1000, // 2 hours
                    [CACHE_STRATEGIES.MODERATE]: 1 * 60 * 60 * 1000,   // 1 hour
                };
                const expirationTime = expirationTimes[cacheStrategy];
                const age = now - result.timestamp;

                if (age < expirationTime) {
                    resolve(result.lyrics);
                } else {
                    deleteLyricsFromDB(key); // Stale cache
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        };
        request.onerror = event => reject(event.target.error);
    });
}

async function saveLyricsToDB(key, lyrics) {
    const { cacheStrategy = CACHE_STRATEGIES.AGGRESSIVE } = await storageLocalGet('cacheStrategy');
    if (cacheStrategy === CACHE_STRATEGIES.NONE) {
        return;
    }
    const db = await openDB();
    const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LYRICS_OBJECT_STORE);
    store.put({ key, lyrics, timestamp: Date.now() });
}

async function deleteLyricsFromDB(key) {
    const db = await openDB();
    const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LYRICS_OBJECT_STORE);
    store.delete(key);
}

async function clearCacheDB() {
    const db = await openDB();
    const transaction = db.transaction([LYRICS_OBJECT_STORE], "readwrite");
    const store = transaction.objectStore(LYRICS_OBJECT_STORE);
    store.clear();
}

async function estimateIndexedDBSizeInKB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LYRICS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(LYRICS_OBJECT_STORE);
        const request = store.getAll();
        request.onsuccess = event => {
            const totalSizeBytes = event.target.result.reduce((acc, record) => {
                return acc + new TextEncoder().encode(JSON.stringify(record)).length;
            }, 0);
            resolve(totalSizeBytes / 1024);
        };
        request.onerror = event => reject(event.target.error);
    });
}


/* =================== LOCAL STORAGE HELPER =================== */

function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}


/* =================== RUNTIME MESSAGE LISTENERS =================== */

pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case MESSAGE_TYPES.FETCH_LYRICS:
            handleLyricsFetch(message.songInfo, sendResponse, message.forceReload);
            return true;

        case MESSAGE_TYPES.RESET_CACHE:
            handleResetCache(sendResponse);
            return true;

        case MESSAGE_TYPES.GET_CACHED_SIZE:
            handleGetCacheSize(sendResponse);
            return true;

        case MESSAGE_TYPES.TRANSLATE_LYRICS:
            handleTranslateLyrics(message, sendResponse);
            return true;

        case MESSAGE_TYPES.FETCH_SPONSOR_SEGMENTS:
            handleFetchSponsorSegments(message.videoId, sendResponse);
            return true;

        default:
            console.warn("Received unknown message type:", message.type);
            return false;
    }
});

async function handleFetchSponsorSegments(videoId, sendResponse) {
    try {
        const segments = await fetchSponsorSegments(videoId);
        sendResponse({ success: true, segments });
    } catch (error) {
        console.error(`Failed to fetch SponsorBlock segments for videoId "${videoId}":`, error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleLyricsFetch(songInfo, sendResponse, forceReload) {
    try {
        const lyrics = await getOrFetchLyrics(songInfo, forceReload);
        sendResponse({ success: true, lyrics, metadata: songInfo });
    } catch (error) {
        console.error(`Failed to fetch lyrics for "${songInfo.title}":`, error);
        sendResponse({ success: false, error: error.message, metadata: songInfo });
    }
}

async function handleResetCache(sendResponse) {
    try {
        lyricsCache.clear();
        ongoingFetches.clear();
        await clearCacheDB();
        sendResponse({ success: true, message: "Cache reset successfully" });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetCacheSize(sendResponse) {
    try {
        const sizeKB = await estimateIndexedDBSizeInKB();
        const db = await openDB();
        const transaction = db.transaction([LYRICS_OBJECT_STORE], "readonly");
        const store = transaction.objectStore(LYRICS_OBJECT_STORE);
        const countRequest = store.count();
        const cacheCount = await new Promise((resolve, reject) => {
            countRequest.onsuccess = () => resolve(countRequest.result);
            countRequest.onerror = () => reject(countRequest.error);
        });
        sendResponse({ success: true, sizeKB, cacheCount });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleTranslateLyrics({ songInfo, action, targetLang, forceReload }, sendResponse) {
    try {
        const translatedLyrics = await getOrFetchTranslatedLyrics(songInfo, action, targetLang, forceReload);
        sendResponse({ success: true, translatedLyrics });
    } catch (error) {
        console.error("Error handling translation:", error);
        sendResponse({ success: false, error: error.message });
    }
}


/* =================== CORE LYRICS LOGIC =================== */

async function getOrFetchLyrics(songInfo, forceReload = false) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;

    if (!forceReload) {
        if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

        const dbCachedLyrics = await getLyricsFromDB(cacheKey);
        if (dbCachedLyrics) {
            lyricsCache.set(cacheKey, dbCachedLyrics);
            return dbCachedLyrics;
        }
    }

    if (ongoingFetches.has(cacheKey)) {
        return ongoingFetches.get(cacheKey);
    }

    const fetchPromise = (async () => {
        try {
            const settings = await storageLocalGet({
                'lyricsProvider': PROVIDERS.KPOE,
                'lyricsSourceOrder': 'apple,lyricsplus,musixmatch,spotify,musixmatch-word',
                'customKpoeUrl': '',
                'cacheStrategy': CACHE_STRATEGIES.AGGRESSIVE
            });

            const fetchOptions = settings.cacheStrategy === CACHE_STRATEGIES.NONE
                ? { cache: 'no-store' }
                : {};

            const providersInOrder = [
                settings.lyricsProvider,
                ...Object.values(PROVIDERS).filter(p => p !== settings.lyricsProvider && p !== PROVIDERS.GOOGLE && p !== PROVIDERS.GEMINI)
            ];

            let lyrics = null;
            for (const provider of providersInOrder) {
                switch (provider) {
                    case PROVIDERS.KPOE:
                        lyrics = await fetchKPoeLyrics(songInfo, settings.lyricsSourceOrder, forceReload, fetchOptions);
                        break;
                    case PROVIDERS.CUSTOM_KPOE:
                        if (settings.customKpoeUrl) {
                            lyrics = await fetchCustomKPoeLyrics(songInfo, settings.customKpoeUrl, settings.lyricsSourceOrder, forceReload, fetchOptions);
                        }
                        break;
                    case PROVIDERS.LRCLIB:
                        lyrics = await fetchLRCLibLyrics(songInfo, fetchOptions);
                        break;
                }
                if (!isEmptyLyrics(lyrics)) break;
            }

            if (isEmptyLyrics(lyrics) && songInfo.videoId && songInfo.subtitle) {
                lyrics = await fetchYouTubeSubtitles(songInfo);
            }

            if (isEmptyLyrics(lyrics)) {
                throw new Error('No lyrics found from any provider.');
            }

            lyricsCache.set(cacheKey, lyrics);
            await saveLyricsToDB(cacheKey, lyrics);
            return lyrics;

        } finally {
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
}

async function getOrFetchTranslatedLyrics(songInfo, action, targetLang, forceReload = false) {
    const originalLyricsCacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;
    const translatedLyricsCacheKey = `${originalLyricsCacheKey} - ${action} - ${targetLang}`;

    if (!forceReload) {
        if (lyricsCache.has(translatedLyricsCacheKey)) return lyricsCache.get(translatedLyricsCacheKey);
        const dbCached = await getLyricsFromDB(translatedLyricsCacheKey);
        if (dbCached) {
            lyricsCache.set(translatedLyricsCacheKey, dbCached);
            return dbCached;
        }
    }

    const originalLyrics = await getOrFetchLyrics(songInfo, forceReload);
    if (isEmptyLyrics(originalLyrics)) {
        throw new Error('Original lyrics not found or empty, cannot perform translation/romanization.');
    }

    const settings = await storageLocalGet({
        'translationProvider': PROVIDERS.GOOGLE,
        'romanizationProvider': PROVIDERS.GOOGLE,
        'geminiApiKey': '',
        'geminiModel': 'gemini-pro',
        'geminiRomanizationModel': 'gemini-pro',
        'overrideTranslateTarget': false,
        'customTranslateTarget': '',
        'overrideGeminiPrompt': false,
        'customGeminiPrompt': '',
        'overrideGeminiRomanizePrompt': false,
        'customGeminiRomanizePrompt': '',
    });

    let translatedData;
    const actualTargetLang = settings.overrideTranslateTarget && settings.customTranslateTarget ? settings.customTranslateTarget : targetLang;

    if (action === 'translate') {
        const provider = settings.translationProvider === PROVIDERS.GEMINI && settings.geminiApiKey ? PROVIDERS.GEMINI : PROVIDERS.GOOGLE;
        if (provider === PROVIDERS.GEMINI) {
            const textsToTranslate = originalLyrics.data.map(line => line.text);
            const translatedTexts = await fetchGeminiTranslate(textsToTranslate, actualTargetLang, settings);
            translatedData = originalLyrics.data.map((line, index) => ({ ...line, translatedText: translatedTexts[index] || line.text }));
        } else {
            const translationPromises = originalLyrics.data.map(line => fetchGoogleTranslate(line.text, actualTargetLang));
            const translatedTexts = await Promise.all(translationPromises);
            translatedData = originalLyrics.data.map((line, index) => ({ ...line, translatedText: translatedTexts[index] || line.text }));
        }
    } else if (action === 'romanize') {
        // Check if lyrics already contain romanization from backend (applied in parseKPoeFormat)
        const hasPrebuiltRomanization = originalLyrics.data.some(line =>
            line.romanizedText || (line.syllabus && line.syllabus.some(syl => syl.romanizedText))
        );

        if (hasPrebuiltRomanization) {
            console.log("Using prebuilt romanization from backend.");
            translatedData = originalLyrics.data; // Use the lyrics as they are, with prebuilt romanization
        } else {
            // If no prebuilt romanization, proceed with external providers
            const provider = settings.romanizationProvider === PROVIDERS.GEMINI && settings.geminiApiKey ? PROVIDERS.GEMINI : PROVIDERS.GOOGLE;
            translatedData = await (provider === PROVIDERS.GEMINI ? romanizeWithGemini(originalLyrics, settings) : romanizeWithGoogle(originalLyrics));
        }
    } else {
        translatedData = originalLyrics.data;
    }

    const finalTranslatedLyrics = { ...originalLyrics, data: translatedData };

    lyricsCache.set(translatedLyricsCacheKey, finalTranslatedLyrics);
    await saveLyricsToDB(translatedLyricsCacheKey, finalTranslatedLyrics);

    return finalTranslatedLyrics;
}


/* =================== TRANSLATION & ROMANIZATION PROVIDERS =================== */

async function romanizeWithGoogle(originalLyrics) {
    if (originalLyrics.type === "Word") {
        return Promise.all(originalLyrics.data.map(async (line) => {
            if (!line.syllabus?.length) return line;
            const syllableTexts = line.syllabus.map(s => s.text);
            const romanizedSyllableTexts = await fetchGoogleRomanize(syllableTexts);
            const newSyllabus = line.syllabus.map((s, index) => ({
                ...s,
                romanizedText: `${romanizedSyllableTexts[index]} ` || s.text
            }));
            return { ...line, syllabus: newSyllabus };
        }));
    } else {
        const linesToRomanize = originalLyrics.data.map(line => line.text);
        const romanizedLines = await fetchGoogleRomanize(linesToRomanize);
        return originalLyrics.data.map((line, index) => ({
            ...line,
            romanizedText: romanizedLines[index] || line.text
        }));
    }
}

async function romanizeWithGemini(originalLyrics, settings) {
    if (!settings.geminiApiKey) throw new Error('Gemini API Key is not provided.');

    // 1. Prepare data for the API: map 'syllabus' to 'chunk'
    const structuredInput = originalLyrics.data.map((line, index) => {
        const lineObject = { original_line_index: index, text: line.text };
        if (line.syllabus?.length) {
            lineObject.chunk = line.syllabus.map((s, sylIndex) => ({
                text: s.text,
                chunkIndex: sylIndex
            }));
        }
        return lineObject;
    });

    // 2. Fetch the full-length, reconstructed romanized data
    const romanizedResult = await fetchGeminiRomanize(structuredInput, settings);

    // 3. Map the result back to the application's original data structure
    return originalLyrics.data.map((originalLine, index) => {
        const romanizedLine = romanizedResult[index];

        if (!romanizedLine) {
            console.warn(`No romanized data returned for line index ${index}.`);
            return originalLine;
        }

        // Map 'chunk' array from Gemini back to 'syllabus' for internal use.
        const newSyllabus = romanizedLine.chunk ? romanizedLine.chunk.map((chunk, chunkIndex) => {
            const originalSyllable = originalLine.syllabus?.[chunkIndex] || {};
            const romanizedSyllableText = chunk.text || originalSyllable.text || '';
            return {
                ...originalSyllable,
                text: originalSyllable.text,
                romanizedText: romanizedSyllableText
            };
        }) : undefined;

        return {
            ...originalLine,
            romanizedText: romanizedLine.text || originalLine.text,
            syllabus: newSyllabus,
        };
    });
}

/**
 * Fetches translations from Gemini using structured output (`responseSchema`).
 */
async function fetchGeminiTranslate(texts, targetLang, settings) {
    const { geminiApiKey, geminiModel, overrideGeminiPrompt, customGeminiPrompt } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

    const translationRules = (overrideGeminiPrompt && customGeminiPrompt)
        ? customGeminiPrompt
        : `You are an expert AI Lyrical Translator. Your task is to translate song lyrics into {targetLang}, preserving the original meaning, emotion, and natural flow.
        RULES:
        1.  Internally identify the language of each line.
        2.  Translate ALL non-{targetLang} words/phrases into {targetLang}. Do not just romanize them.
        3.  If a line is already entirely in {targetLang}, copy it to the output exactly as is.
        4.  For mixed-language lines, translate the non-{targetLang} parts and integrate them naturally.
        5.  The final output for each line must sound natural in {targetLang}.`;

    const prompt = `
        ${translationRules.replace(/{targetLang}/g, targetLang)}
        
        Now, process the following lyrics based on these rules.
        Lyrics to translate:
        ${JSON.stringify(texts)}
    `;

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generation_config: {
            response_mime_type: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    translated_lyrics: {
                        type: "ARRAY",
                        description: "An array of translated lyric lines, maintaining the original order.",
                        items: { type: "STRING" }
                    },
                    target_language: {
                        type: "STRING",
                        description: "The target language for the translation."
                    }
                },
                required: ["translated_lyrics", "target_language"]
            }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(`Gemini API error: ${response.status} - ${errorData.error.message}`);
    }

    const data = await response.json();

    if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini translation blocked: ${data.promptFeedback.blockReason}`);
    }

    try {
        const parsedJson = JSON.parse(data.candidates[0].content.parts[0].text);
        if (Array.isArray(parsedJson.translated_lyrics)) {
            return parsedJson.translated_lyrics;
        } else {
            throw new Error('Invalid JSON structure in Gemini response.');
        }
    } catch (e) {
        console.error("Gemini response parsing failed:", e, "\nRaw response:", data.candidates[0].content.parts[0].text);
        throw new Error(`Gemini translation failed: Could not parse valid JSON. ${e.message}`);
    }
}


/**
 * Pre-processes lyrics for Gemini:
 * 1. Skips purely Latin lines (which don't need romanization).
 * 2. Compacts repeated non-Latin lines to save API tokens.
 * 3. Creates a plan to reconstruct the full list later.
 * @param {Object[]} structuredInput - The original array of lyric objects.
 * @returns {{lyricsForApi: Object[], reconstructionPlan: Object[]}}
 */
function prepareLyricsForGemini(structuredInput) {
    const lyricsForApi = [];
    const reconstructionPlan = [];
    const contentToApiIndexMap = new Map();

    structuredInput.forEach((line, originalIndex) => {
        if (isPurelyLatinScript(line.text)) {
            reconstructionPlan.push({ type: 'latin', data: line, originalIndex });
            return;
        }

        const contentKey = JSON.stringify({ text: line.text, chunk: line.chunk });
        if (contentToApiIndexMap.has(contentKey)) {
            reconstructionPlan.push({ type: 'api', apiIndex: contentToApiIndexMap.get(contentKey), originalIndex });
        } else {
            const newApiIndex = lyricsForApi.length;
            lyricsForApi.push({ ...line, original_line_index: newApiIndex });
            contentToApiIndexMap.set(contentKey, newApiIndex);
            reconstructionPlan.push({ type: 'api', apiIndex: newApiIndex, originalIndex });
        }
    });

    return { lyricsForApi, reconstructionPlan };
}

/**
 * Reconstructs the full-length romanized lyric array from the API's compacted response
 * and the pre-computed reconstruction plan.
 * @param {Object[]} romanizedApiLyrics - The romanized data from the API (for unique non-Latin lines).
 * @param {Object[]} reconstructionPlan - The plan to rebuild the original list structure.
 * @returns {Object[]} The full-length array of romanized lyrics.
 */
function reconstructRomanizedLyrics(romanizedApiLyrics, reconstructionPlan) {
    const fullList = [];
    reconstructionPlan.forEach(planItem => {
        let reconstructedLine;
        if (planItem.type === 'latin') {
            reconstructedLine = {
                ...planItem.data,
                text: planItem.data.text,
                chunk: planItem.data.chunk ? planItem.data.chunk.map(c => ({ ...c, text: c.text })) : undefined,
                original_line_index: planItem.originalIndex,
            };
        } else {
            const apiResult = romanizedApiLyrics[planItem.apiIndex];
            reconstructedLine = {
                ...apiResult,
                original_line_index: planItem.originalIndex, // Restore original index
            };
        }
        fullList[planItem.originalIndex] = reconstructedLine;
    });
    return fullList;
}

/**
 * Fetches romanizations from Gemini.
 * This version is optimized to skip Latin lines and compact duplicates before calling the API.
 * It uses a multi-turn conversation for a "reflection" step if the first response is invalid.
 * Now supports selective reflection - only asking to fix problematic lines.
 * @param {Object[]} structuredInput - Array of structured lyric lines using 'chunk'.
 * @param {Object} settings - User settings including API key and custom prompts.
 * @returns {Promise<Object[]>} The full-length, reconstructed array of romanized lyric objects.
 */
async function fetchGeminiRomanize(structuredInput, settings) {
    const { geminiApiKey, geminiRomanizationModel, overrideGeminiRomanizePrompt, customGeminiRomanizePrompt } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiRomanizationModel}:generateContent?key=${geminiApiKey}`;

    const { lyricsForApi, reconstructionPlan } = prepareLyricsForGemini(structuredInput);

    if (lyricsForApi.length === 0) {
        return reconstructRomanizedLyrics([], reconstructionPlan);
    }

    const initialUserPrompt = (overrideGeminiRomanizePrompt && customGeminiRomanizePrompt)
        ? customGeminiRomanizePrompt : `You are a linguistic expert AI specializing ONLY in precise **natural phonetic romanization** (NOT translation).
You MUST follow these rules like a strict compiler. Any violation is an error.

# GLOBAL PRINCIPLES
1. **Romanization only** – never translate or explain meaning.
2. **Natural phonetic style for ALL languages**:
   - Arabic → assimilate natural sounds: e.g. "fi al-fasl" → "fil fasl", "al-shams" → "ash shams".
   - Japanese → Hepburn phonetic: "こんにちは" → "konnichiwa".
   - Korean → spoken style Revised Romanization: "안녕하세요" → "annyeong haseyo".
   - Chinese → Pinyin without tone marks, natural spacing: "你好" → "ni hao".
   - Other languages → their most widely recognized **natural phonetic pronunciation**, not academic strict forms.
3. **Preserve original segmentation** – do not merge or drop words.
4. **No extra text** – never add explanations, notes, or translation.
5. **Case & style** – all output in lowercase Latin letters, unless capitalization is required in the source (e.g. names).

# GOLDEN RULE
- Romanize the **entire line** naturally first.  
- THEN split the romanized line into chunks matching the input.  
- Chunks are subdivisions of the final romanized line, NOT independent romanizations.  
- Always preserve final vowel sounds from the original script if they exist.
- Add space if it was a different word, do not trim them.

# CHUNK RULES
1. Chunk count must **exactly** match input.  
2. Every chunk must contain some text (never empty).  
3. Distribute text proportionally. Do not merge all into one chunk.  
4. Preserve \`chunkIndex\` values strictly.  
5. Preserve line order with \`original_line_index\`.  

# VALIDATION CHECKLIST
Before finalizing, you MUST ensure for every line:
- The number of chunks matches input.  
- No chunk has empty text.  
- Romanization is natural, flowing, and phonetically correct.  
- Distribution across chunks is proportional.  

# EXAMPLES

### Arabic (natural phonetic)
Input: ["أَنْتَ ", "فِي ", "الْفَصْلِ"]  
❌ Wrong: ["anta", "fi", "al-fasli"]  
✅ Correct: ["anta", "fil", "fasli"]

Input: ["السلام", "عليكم"]  
❌ Wrong: ["as", "salamualaikum"]  
✅ Correct: ["assalam", "alaikum"]

---

### Japanese (natural phonetic)
Input: ["こん", "にち", "は"]  
❌ Wrong: ["konnichiwa", "", ""]  
✅ Correct: ["kon", "nichi", "wa"]

---

### Korean (natural phonetic)
Input: ["안녕", "하세요"]  
❌ Wrong: ["annyeong haseyo", ""]  
✅ Correct: ["annyeong", "haseyo"]

---

### Chinese (natural phonetic)
Input: ["你", "好"]  
❌ Wrong: ["nihao", ""]  
✅ Correct: ["ni", "hao"]

---

# TASK
Now, romanize the following lyrics **strictly following all rules above**:
${JSON.stringify(lyricsForApi, null, 2)}`;

    const schema = {
        type: "OBJECT",
        properties: {
            romanized_lyrics: {
                type: "ARRAY",
                description: "An array of romanized lyric line objects, matching the input array's order and length.",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: { type: "STRING", description: "The fully romanized text of the entire line." },
                        original_line_index: { type: "INTEGER", description: "The original index of the line from the input, which must be preserved." },
                        chunk: {
                            type: "ARRAY",
                            nullable: true,
                            items: {
                                type: "OBJECT",
                                properties: {
                                    text: { type: "STRING", description: "The text of a single romanized chunk. MUST NOT be empty." },
                                    chunkIndex: { type: "INTEGER", description: "The original index of the chunk, which must be preserved." }
                                },
                                required: ["text", "chunkIndex"]
                            }
                        }
                    },
                    required: ["text", "original_line_index"]
                }
            }
        },
        required: ["romanized_lyrics"]
    };

    const selectiveSchema = {
        type: "OBJECT",
        properties: {
            fixed_lines: {
                type: "ARRAY",
                description: "An array of corrected romanized lyric line objects for only the problematic lines.",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: { type: "STRING", description: "The fully romanized text of the entire line." },
                        original_line_index: { type: "INTEGER", description: "The original index of the line from the input, which must be preserved." },
                        chunk: {
                            type: "ARRAY",
                            nullable: true,
                            items: {
                                type: "OBJECT",
                                properties: {
                                    text: { type: "STRING", description: "The text of a single romanized chunk. MUST NOT be empty." },
                                    chunkIndex: { type: "INTEGER", description: "The original index of the chunk, which must be preserved." }
                                },
                                required: ["text", "chunkIndex"]
                            }
                        }
                    },
                    required: ["text", "original_line_index"]
                }
            }
        },
        required: ["fixed_lines"]
    };

    let currentContents = [{ role: 'user', parts: [{ text: initialUserPrompt }] }];
    let lastValidResponse = null;
    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let responseText;
        const isSelectiveFix = attempt > 1 && lastValidResponse !== null;

        try {
            const requestBody = {
                contents: currentContents,
                generation_config: {
                    response_mime_type: "application/json",
                    responseSchema: isSelectiveFix ? selectiveSchema : schema
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new Error(`Gemini API call failed with status ${response.status}: ${errorData.error.message}`);
            }

            const data = await response.json();

            if (data.promptFeedback?.blockReason) {
                throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
            }

            responseText = data.candidates[0].content.parts[0].text;

        } catch (e) {
            console.error(`Gemini romanization failed on attempt ${attempt}: ${e.message}`);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts: ${e.message}`);
            }
            continue;
        }

        let parsedJson;
        try {
            parsedJson = JSON.parse(responseText);
        } catch (e) {
            console.error(`Attempt ${attempt}: Failed to parse JSON response from Gemini: ${e.message}. Raw response: ${responseText}`);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts: Could not parse valid JSON.`);
            }
            currentContents.push({ role: 'model', parts: [{ text: responseText }] });
            currentContents.push({ role: 'user', parts: [{ text: `Your previous response was not valid JSON. Please provide a corrected JSON response. Error: ${e.message}` }] });
            continue;
        }

        let finalResponse;

        if (isSelectiveFix && parsedJson.fixed_lines) {
            finalResponse = mergeSelectiveFixes(lastValidResponse, parsedJson.fixed_lines);
        } else {
            finalResponse = parsedJson;
            if (attempt === 1) {
                lastValidResponse = parsedJson;
            }
        }

        const validationResult = validateRomanizationResponse(lyricsForApi, finalResponse);

        if (validationResult.isValid) {
            console.log(`Gemini romanization succeeded on attempt ${attempt}.`);
            return reconstructRomanizedLyrics(finalResponse.romanized_lyrics, reconstructionPlan);
        } else {
            console.warn(`Attempt ${attempt} failed validation. Errors: ${validationResult.errors.join(', ')}`);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Gemini romanization failed after ${MAX_RETRIES} attempts. Final validation errors: ${validationResult.errors.join(', ')}`);
            }

            const problematicLines = getProblematicLines(lyricsForApi, finalResponse, validationResult.detailedErrors);

            currentContents.push({ role: 'model', parts: [{ text: responseText }] });

            if (problematicLines.length > 0 && problematicLines.length < lyricsForApi.length * 0.8) {
                // IMPROVED: More specific selective fix prompt
                const selectivePrompt = `CRITICAL ERROR CORRECTION NEEDED: Your previous response had structural errors in ${problematicLines.length} specific lines.

**MOST COMMON ERRORS TO FIX:**
1. Empty chunks - chunks with "" or no text
2. Uneven distribution - one chunk gets all text, others empty  
3. Chunk count mismatch

**SPECIFIC LINES THAT NEED FIXING:**
${JSON.stringify(problematicLines.map(line => ({
                    original_line_index: line.original_line_index,
                    original_text: line.text,
                    required_chunk_count: line.chunk ? line.chunk.length : 0,
                    original_chunks: line.chunk ? line.chunk.map(c => c.text) : null,
                    errors: validationResult.detailedErrors.find(e => e.lineIndex === line.original_line_index)?.errors || []
                })), null, 2)}

**CORRECTION RULES:**
1. Every chunk MUST have non-empty text
2. Distribute text proportionally across chunks
3. Never leave chunks empty while others have all the text
4. Match the exact chunk count specified

PROVIDE ONLY THE CORRECTED LINES in this format:
{
  "fixed_lines": [
    // Only the corrected lines with proper chunk distribution
  ]
}`;

                currentContents.push({ role: 'user', parts: [{ text: selectivePrompt }] });
            } else {
                // Full re-generation prompt with better guidance
                const fullPrompt = `CRITICAL STRUCTURAL ERRORS DETECTED: Your previous response had major issues with chunk distribution and text partitioning.

**MOST SERIOUS ERRORS:**
${validationResult.errors.slice(0, 10).join('\n- ')}${validationResult.errors.length > 10 ? '\n- ... and more' : ''}

**REMEMBER THE GOLDEN RULE:** 
1. Romanize the FULL LINE text first
2. Then intelligently split that romanized text into chunks
3. NEVER leave any chunk empty
4. Distribute text proportionally

**Original lyrics for reference:**
${JSON.stringify(lyricsForApi, null, 2)}

PROVIDE A COMPLETE CORRECTED RESPONSE with proper chunk distribution.`;

                currentContents.push({ role: 'user', parts: [{ text: fullPrompt }] });
            }
        }
    }

    throw new Error("Unexpected error: Gemini romanization process completed without success or explicit failure.");
}

/**
 * Extracts problematic lines based on validation errors
 * @param {Object[]} originalLyricsForApi - The original lyrics sent to API
 * @param {Object} response - The response from Gemini
 * @param {Object[]} detailedErrors - Detailed error information per line
 * @returns {Object[]} Array of problematic lines that need fixing
 */
function getProblematicLines(originalLyricsForApi, response, detailedErrors = []) {
    const problematicLines = [];
    const problematicIndices = new Set();

    // Extract line indices from detailed errors
    if (detailedErrors && detailedErrors.length > 0) {
        detailedErrors.forEach(error => {
            if (error.lineIndex !== undefined) {
                problematicIndices.add(error.lineIndex);
            }
        });
    }

    // validation with specific focus on empty chunks and distribution
    if (response.romanized_lyrics) {
        response.romanized_lyrics.forEach((line, index) => {
            const originalLine = originalLyricsForApi[index];
            if (!originalLine) return;

            let hasIssue = false;
            const issues = [];

            // Check for empty chunks (high priority issue)
            if (Array.isArray(line.chunk) && line.chunk.length > 0) {
                const emptyChunks = line.chunk.filter(chunk => !chunk.text || chunk.text.trim() === '');
                if (emptyChunks.length > 0) {
                    hasIssue = true;
                    issues.push(`${emptyChunks.length} empty chunk(s) detected`);
                    console.log(`Line ${index}: Empty chunks detected:`, line.chunk.map(c => `"${c.text}"`));
                }

                // Check for uneven distribution (another high priority issue)
                const nonEmptyChunks = line.chunk.filter(chunk => chunk.text && chunk.text.trim() !== '');
                if (nonEmptyChunks.length === 1 && line.chunk.length > 1) {
                    hasIssue = true;
                    issues.push('text concentrated in single chunk');
                    console.log(`Line ${index}: Uneven distribution:`, line.chunk.map(c => `"${c.text}"`));
                }

                // Check for chunk count mismatch
                if (originalLine.chunk && originalLine.chunk.length !== line.chunk.length) {
                    hasIssue = true;
                    issues.push(`chunk count mismatch (expected ${originalLine.chunk.length}, got ${line.chunk.length})`);
                }
            }

            // Add other validation checks...
            if (line.original_line_index !== index) {
                hasIssue = true;
                issues.push(`incorrect line index`);
            }

            if (typeof line.text !== 'string') {
                hasIssue = true;
                issues.push('missing or invalid text field');
            }

            if (hasIssue) {
                problematicIndices.add(index);
                console.log(`Line ${index} flagged as problematic: ${issues.join(', ')}`);
            }
        });
    }

    // Create problematic lines array
    problematicIndices.forEach(index => {
        if (originalLyricsForApi[index]) {
            problematicLines.push({
                ...originalLyricsForApi[index],
                original_line_index: index
            });
        }
    });

    console.log(`Found ${problematicLines.length} problematic lines out of ${originalLyricsForApi.length} total lines`);
    return problematicLines;
}

/**
 * Merges selective fixes into the last valid response
 * @param {Object} lastValidResponse - The last response that was mostly correct
 * @param {Object[]} fixedLines - Array of corrected lines
 * @returns {Object} Merged response with fixes applied
 */
function mergeSelectiveFixes(lastValidResponse, fixedLines) {
    if (!lastValidResponse || !lastValidResponse.romanized_lyrics) {
        console.warn('No valid previous response to merge with, using fixed lines as base');
        return { romanized_lyrics: fixedLines };
    }

    const mergedResponse = JSON.parse(JSON.stringify(lastValidResponse)); // Deep copy

    console.log(`Merging ${fixedLines.length} selective fixes into previous response`);

    fixedLines.forEach(fixedLine => {
        const index = fixedLine.original_line_index;
        if (mergedResponse.romanized_lyrics &&
            mergedResponse.romanized_lyrics[index] &&
            index >= 0 &&
            index < mergedResponse.romanized_lyrics.length) {

            console.log(`Applying fix for line ${index}`);
            mergedResponse.romanized_lyrics[index] = fixedLine;
        } else {
            console.warn(`Could not apply fix for line ${index}: index out of bounds or invalid structure`);
        }
    });

    return mergedResponse;
}

/**
 * Validates the structural integrity of the Gemini romanization response.
 * Enhanced version that provides detailed error information per line.
 * @param {Object[]} originalLyricsForApi - The compacted array of lyric objects sent to the API.
 * @param {Object} geminiResponse - The parsed JSON object received from Gemini.
 * @returns {{isValid: boolean, errors: string[], detailedErrors: Object[]}} Validation result.
 */
function validateRomanizationResponse(originalLyricsForApi, geminiResponse) {
    const errors = [];
    const detailedErrors = [];

    if (!geminiResponse || !Array.isArray(geminiResponse.romanized_lyrics)) {
        errors.push("The top-level 'romanized_lyrics' key is missing or not an array.");
        return { isValid: false, errors, detailedErrors };
    }

    if (geminiResponse.romanized_lyrics.length !== originalLyricsForApi.length) {
        errors.push(`The number of lines in the response (${geminiResponse.romanized_lyrics.length}) does not match the request (${originalLyricsForApi.length}).`);
        return { isValid: false, errors, detailedErrors };
    }

    geminiResponse.romanized_lyrics.forEach((romanizedLine, index) => {
        const originalLine = originalLyricsForApi[index];
        const lineErrors = [];

        // Basic validation
        if (romanizedLine.original_line_index !== index) {
            const error = `Line ${index}: 'original_line_index' is incorrect. Expected ${index}, got ${romanizedLine.original_line_index}.`;
            errors.push(error);
            lineErrors.push(error);
        }

        if (typeof romanizedLine.text !== 'string') {
            const error = `Line ${index}: The required 'text' field is missing or not a string.`;
            errors.push(error);
            lineErrors.push(error);
        }

        const originalHasChunks = Array.isArray(originalLine.chunk) && originalLine.chunk.length > 0;
        const romanizedHasChunks = Array.isArray(romanizedLine.chunk);

        if (originalHasChunks) {
            if (!romanizedHasChunks) {
                const error = `Line ${index}: A 'chunk' array was expected but is missing.`;
                errors.push(error);
                lineErrors.push(error);
            } else if (romanizedLine.chunk.length !== originalLine.chunk.length) {
                const error = `Line ${index}: Chunk count mismatch. Original had ${originalLine.chunk.length}, response has ${romanizedLine.chunk.length}.`;
                errors.push(error);
                lineErrors.push(error);
            } else {
                const chunkValidationResult = validateChunkDistribution(originalLine, romanizedLine, index);
                if (!chunkValidationResult.isValid) {
                    errors.push(...chunkValidationResult.errors);
                    lineErrors.push(...chunkValidationResult.errors);
                }
            }
        } else if (romanizedHasChunks) {
            const error = `Line ${index}: A 'chunk' array was provided, but the original did not have one.`;
            errors.push(error);
            lineErrors.push(error);
        }

        if (lineErrors.length > 0) {
            detailedErrors.push({
                lineIndex: index,
                errors: lineErrors
            });
        }
    });

    return { isValid: errors.length === 0, errors, detailedErrors };
}

function validateChunkDistribution(originalLine, romanizedLine, lineIndex) {
    const errors = [];

    // Check for empty chunks
    const emptyChunks = romanizedLine.chunk.filter((chunk, idx) =>
        !chunk.text || chunk.text.trim() === ''
    );

    if (emptyChunks.length > 0) {
        errors.push(`Line ${lineIndex}: Found ${emptyChunks.length} empty chunk(s)`);
    }

    // Check for uneven distribution (one chunk gets all text, others empty)
    const nonEmptyChunks = romanizedLine.chunk.filter(chunk =>
        chunk.text && chunk.text.trim() !== ''
    );

    if (nonEmptyChunks.length === 1 && romanizedLine.chunk.length > 1) {
        errors.push(`Line ${lineIndex}: All text concentrated in one chunk while others are empty`);
    }

    // Advanced text coherence check with better algorithm
    const coherenceResult = validateTextCoherence(romanizedLine, lineIndex);
    if (!coherenceResult.isValid) {
        errors.push(...coherenceResult.errors);
    }

    return { isValid: errors.length === 0, errors };
}

function validateTextCoherence(romanizedLine, lineIndex) {
    const errors = [];

    // Get texts
    const mergedChunkText = romanizedLine.chunk.map(c => c.text || '').join('');
    const lineText = romanizedLine.text || '';

    // Normalize for comparison (remove extra spaces, convert to lowercase)
    const normalizedMerged = normalizeTextForComparison(mergedChunkText);
    const normalizedLine = normalizeTextForComparison(lineText);

    if (normalizedMerged !== normalizedLine) {
        // Calculate similarity using multiple metrics
        const distance = levenshteinDistance(normalizedMerged, normalizedLine);
        const maxLength = Math.max(normalizedMerged.length, normalizedLine.length);
        const percentageDifference = (maxLength === 0) ? 0 : (distance / maxLength) * 100;

        // More lenient threshold for romanization differences
        if (percentageDifference > 20) {
            errors.push(`Line ${lineIndex}: Significant text mismatch (${percentageDifference.toFixed(1)}% difference)`);
            console.log(`Text mismatch details:
                Merged chunks: "${mergedChunkText}"
                Line text: "${lineText}"
                Normalized merged: "${normalizedMerged}"
                Normalized line: "${normalizedLine}"`);
        }
    }

    return { isValid: errors.length === 0, errors };
}

function normalizeTextForComparison(text) {
    return text
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, ''); // Remove punctuation for better comparison
}



async function fetchGoogleTranslate(text, targetLang) {
    if (!text.trim()) return "";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Translate API error: ${response.statusText}`);
    const data = await response.json();
    return data?.[0]?.map(segment => segment?.[0]).join('') || text;
}

async function fetchGoogleRomanize(texts) {
    const contextText = texts.join(' ');
    if (isPurelyLatinScript(contextText)) return texts;

    let sourceLang = 'auto';
    try {
        const detectUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(contextText)}`;
        const detectResponse = await fetch(detectUrl);
        if (detectResponse.ok) {
            const detectData = await detectResponse.json();
            sourceLang = detectData[2] || 'auto';
        }
    } catch (e) {
        console.error("Language detection for romanization failed, falling back to 'auto'.", e);
    }

    const romanizedTexts = [];
    for (const text of texts) {
        if (isPurelyLatinScript(text)) {
            romanizedTexts.push(text);
            continue;
        }
        try {
            const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&hl=en&dt=rm&q=${encodeURIComponent(text)}`;
            const romanizeResponse = await fetch(romanizeUrl);
            const romanizeData = await romanizeResponse.json();
            romanizedTexts.push(romanizeData?.[0]?.[0]?.[3] || text);
        } catch (error) {
            console.error(`Error romanizing text "${text}":`, error);
            romanizedTexts.push(text);
        }
    }
    return romanizedTexts;
}


/* =================== LYRICS SOURCE PROVIDERS & PARSERS =================== */

async function fetchFromKPoeAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions) {
    const { title, artist, album, duration } = songInfo;
    const params = new URLSearchParams({ title, artist, duration });
    if (album) params.append('album', album);
    if (sourceOrder) params.append('source', sourceOrder);
    if (forceReload) params.append('forceReload', 'true');

    const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}v2/lyrics/get?${params.toString()}`;

    try {
        const response = await fetch(url, forceReload ? { cache: 'no-store' } : fetchOptions);
        if (response.ok) {
            const data = await response.json();
            return parseKPoeFormat(data);
        }
        if (response.status == 404 || response.status == 403) {
            return null;
        }
        console.warn(`Failed to fetch from ${baseUrl} (${response.status}): ${response.statusText}`);
        return null;
    } catch (error) {
        console.error(`Network error fetching from ${baseUrl}:`, error);
        return null;
    }
}

async function fetchKPoeLyrics(songInfo, sourceOrder, forceReload, fetchOptions) {
    for (const baseUrl of KPOE_SERVERS) {
        const lyrics = await fetchFromKPoeAPI(baseUrl, songInfo, sourceOrder, forceReload, fetchOptions);
        if (lyrics) return lyrics;
    }
    return null;
}

async function fetchCustomKPoeLyrics(songInfo, customUrl, sourceOrder, forceReload, fetchOptions) {
    if (!customUrl) return null;
    return fetchFromKPoeAPI(customUrl, songInfo, sourceOrder, forceReload, fetchOptions);
}

async function fetchLRCLibLyrics(songInfo, fetchOptions = {}) {
    const params = new URLSearchParams({ artist_name: songInfo.artist, track_name: songInfo.title });
    if (songInfo.album) params.append('album_name', songInfo.album);

    const url = `https://lrclib.net/api/get?${params.toString()}`;

    try {
        const response = await fetch(url, fetchOptions);
        if (!response.ok) return null;
        const data = await response.json();
        return parseLRCLibFormat(data);
    } catch (error) {
        console.error("Error fetching from LRCLIB:", error);
        return null;
    }
}

async function fetchYouTubeSubtitles(songInfo) {
    try {
        const subtitleInfo = songInfo.subtitle;
        if (!subtitleInfo?.captionTracks?.length) return null;

        const validTracks = subtitleInfo.captionTracks.filter(t => t.kind !== 'asr' && !t.vssId?.startsWith('a.'));
        const selectedTrack = validTracks.find(t => t.isDefault) || validTracks[0];

        if (!selectedTrack) return null;

        const url = new URL(selectedTrack.baseUrl);
        url.searchParams.set('fmt', 'json3');

        const response = await fetch(url.toString());
        if (!response.ok) return null;

        const data = await response.json();
        return parseYouTubeSubtitles(data, songInfo);
    } catch (error) {
        console.error("Error fetching YouTube subtitles:", error);
        return null;
    }
}

function parseYouTubeSubtitles(data, songInfo) {
    if (!data?.events?.length) return null;
    const parsedLines = data.events
        .map(event => {
            const text = event.segs?.map(seg => seg.utf8).join(' ').trim();
            if (!text) return null;
            const startTime = event.tStartMs / 1000;
            const duration = event.dDurationMs / 1000;
            return { text, startTime, endTime: startTime + duration, duration };
        })
        .filter(Boolean);

    if (parsedLines.length === 0) return null;
    return { type: 'Line', data: parsedLines, metadata: { ...songInfo, source: "YouTube Captions" } };
}

function parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const lines = data.syncedLyrics.split('\n');
    const matches = lines
        .map(line => timeRegex.exec(line))
        .filter(Boolean)
        .map(match => ({
            startTime: parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3], 10) / (match[3].length === 2 ? 100 : 1000),
            text: match[4].trim()
        }));

    if (matches.length === 0) return null;

    const parsedLines = matches.map((current, i) => {
        const endTime = (i < matches.length - 1) ? matches[i + 1].startTime : current.startTime + 5;
        return { ...current, endTime, duration: endTime - current.startTime };
    }).filter(line => !(line.text.trim() == "♪" || line.text.trim() == ""));

    return {
        type: 'Line',
        data: parsedLines,
        metadata: { title: data.trackName, artist: data.artistName, album: data.albumName, duration: data.duration, source: "LRCLIB" }
    };
}

function parseKPoeFormat(data) {
    if (!data?.lyrics || !Array.isArray(data.lyrics) || data.lyrics.length === 0) return null;
    return {
        type: data.type,
        data: data.lyrics.map(item => {
            const startTime = Number(item.time || 0) / 1000;
            const duration = Number(item.duration || 0) / 1000;
            const syllabus = (item.syllabus || []).map(syl => ({
                text: syl.text || '',
                time: Number(syl.time || 0),
                duration: Number(syl.duration || 0),
                isBackground: syl.isBackground || false
            }));
            const element = item.element || [];

            let lineRomanizedText = undefined;
            let romanizedSyllabus = undefined;

            // Check for prebuilt transliteration from backend
            if (item.transliteration) {
                // Prioritize syllabus-level transliteration if available and lengths match
                if (item.transliteration.syllabus && item.transliteration.syllabus.length === syllabus.length) {
                    romanizedSyllabus = syllabus.map((syl, index) => ({
                        ...syl,
                        romanizedText: item.transliteration.syllabus[index].text || syl.text
                    }));
                    lineRomanizedText = item.transliteration.text || item.text; // Use line-level transliteration text
                } else if (item.transliteration.text) {
                    // Fallback to line-level transliteration if syllabus doesn't match or is missing
                    lineRomanizedText = item.transliteration.text;
                }
            }

            return {
                text: item.text || '',
                startTime,
                duration,
                endTime: startTime + duration,
                syllabus: romanizedSyllabus || syllabus, // Use romanizedSyllabus if available, otherwise original
                element,
                romanizedText: lineRomanizedText // Add line-level romanized text
            };
        }),
        metadata: { ...data.metadata, source: `${data.metadata.source} (KPoe)` },
        ignoreSponsorblock: data.ignoreSponsorblock || data.metadata.ignoreSponsorblock
    };
}


/* =================== UTILITY FUNCTIONS =================== */

function isEmptyLyrics(lyrics) {
    return !lyrics || !lyrics.data || lyrics.data.length === 0 || lyrics.data.every(line => !line.text);
}

function isPurelyLatinScript(text) {
    return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text);
}

function levenshteinDistance(s1, s2) {
    const track = Array(s2.length + 1).fill(null).map(() =>
        Array(s1.length + 1).fill(null));
    for (let i = 0; i <= s1.length; i++) {
        track[0][i] = i;
    }
    for (let j = 0; j <= s2.length; j++) {
        track[j][0] = j;
    }
    for (let j = 1; j <= s2.length; j++) {
        for (let i = 1; i <= s1.length; i++) {
            const indicator = (s1[i - 1] === s2[j - 1]) ? 0 : 1;
            track[j][i] = Math.min(
                track[j][i - 1] + 1, // deletion
                track[j - 1][i] + 1, // insertion
                track[j - 1][i - 1] + indicator // substitution
            );
        }
    }
    return track[s2.length][s1.length];
}

// SponsorBlock fetching and timing adjustment functions moved from lyricsManager.js
async function fetchSponsorSegments(videoId) {
    const SPONSORBLOCK_API = "https://sponsor.ajay.app/api/skipSegments";
    const categories = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler", "music_offtopic"];
    const url = `${SPONSORBLOCK_API}?videoID=${videoId}&categories=[${categories.map(c => `"${c}"`).join(',')}]`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.log(`SponsorBlock segments not found for videoId: ${videoId}`);
                return [];
            }
            throw new Error(`SponsorBlock API error: ${response.statusText}`);
        }
        const segments = await response.json();
        return segments;
    } catch (error) {
        console.error("Error fetching SponsorBlock segments:", error);
        return [];
    }
}
