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
    TRANSLATE_LYRICS: 'TRANSLATE_LYRICS'
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

        default:
            console.warn("Received unknown message type:", message.type);
            return false;
    }
});

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
        const provider = settings.romanizationProvider === PROVIDERS.GEMINI && settings.geminiApiKey ? PROVIDERS.GEMINI : PROVIDERS.GOOGLE;
        translatedData = await (provider === PROVIDERS.GEMINI ? romanizeWithGemini(originalLyrics, settings) : romanizeWithGoogle(originalLyrics));
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
                romanizedText: `${romanizedSyllableTexts[index] || s.text} `
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

    const structuredInput = originalLyrics.data.map((line, index) => {
        const lineObject = { original_line_index: index, text: line.text };
        if (line.syllabus?.length) {
            lineObject.totalSyllable = line.syllabus.length;
            lineObject.syllabus = line.syllabus.map((s, sylIndex) => ({
                text: s.text,
                syllableIndex: sylIndex
            }));
        }
        return lineObject;
    });

    const romanizedResult = await fetchGeminiRomanize(structuredInput, settings);
    const romanizedMap = new Map(romanizedResult.map(item => [item.original_line_index, item]));

    return originalLyrics.data.map((originalLine, index) => {
        const romanizedLine = romanizedMap.get(index);
        if (!romanizedLine) {
            console.warn(`No romanized data from Gemini for line index ${index}.`);
            return originalLine;
        }

        const newSyllabus = originalLine.syllabus ? originalLine.syllabus.map((syl, sylIndex) => {
            const romanizedSyllable = romanizedLine.syllabus?.find(rs => rs.syllableIndex === sylIndex);
            return { ...syl, romanizedText: `${romanizedSyllable?.text || syl.text} ` };
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
        console.error("Gemini response parsing failed:", e, "\nRaw response:", data.candidates.content.parts.text);
        throw new Error(`Gemini translation failed: Could not parse valid JSON. ${e.message}`);
    }
}

/**
 * Validates the structural integrity of the Gemini romanization response against the original request.
 * This is the core of the "reflection" feature.
 * @param {Object[]} originalLyrics - The original array of lyric objects sent to the API.
 * @param {Object} geminiResponse - The parsed JSON object received from Gemini.
 * @returns {{isValid: boolean, errors: string[]}} An object indicating if the validation passed and a list of specific errors if it failed.
 */
function validateRomanizationResponse(originalLyrics, geminiResponse) {
    const errors = [];

    if (!geminiResponse || !Array.isArray(geminiResponse.romanized_lyrics)) {
        errors.push("The top-level 'romanized_lyrics' key is missing or not an array.");
        return { isValid: false, errors };
    }

    if (geminiResponse.romanized_lyrics.length !== originalLyrics.length) {
        errors.push(`The number of lines in the response (${geminiResponse.romanized_lyrics.length}) does not match the original request (${originalLyrics.length}).`);
        return { isValid: false, errors }; // Fatal error.
    }

    geminiResponse.romanized_lyrics.forEach((romanizedLine, index) => {
        const originalLine = originalLyrics[index];
        if (romanizedLine.original_line_index !== index) {
            errors.push(`Line ${index}: 'original_line_index' is incorrect. Expected ${index}, got ${romanizedLine.original_line_index}.`);
        }
        if (typeof romanizedLine.text !== 'string') {
            errors.push(`Line ${index}: The required 'text' field is missing or not a string.`);
        }

        const originalHasSyllabus = Array.isArray(originalLine.syllabus) && originalLine.syllabus.length > 0;
        const romanizedHasSyllabus = Array.isArray(romanizedLine.syllabus);

        if (originalHasSyllabus) {
            if (!romanizedHasSyllabus) {
                errors.push(`Line ${index}: A 'syllabus' array was expected but is missing.`);
            } else if (romanizedLine.syllabus.length !== originalLine.syllabus.length) {
                errors.push(`Line ${index}: Syllable count mismatch. Original had ${originalLine.syllabus.length}, response has ${romanizedLine.syllabus.length}.`);
            }
        } else if (romanizedHasSyllabus) {
            errors.push(`Line ${index}: A 'syllabus' array was provided, but the original did not have one.`);
        }
    });

    return { isValid: errors.length === 0, errors };
}

/**
 * Fetches romanizations from Gemini.
 * It uses a proper multi-turn conversation context for the reflection step, showing the model its own
 * previous flawed output and the user's correction.
 * @param {Object[]} lyricsDataArray - Array of structured lyric lines.
 * @param {Object} settings - User settings including API key and custom prompts.
 * @returns {Promise<Object[]>} Array of romanized lyric objects.
 */
async function fetchGeminiRomanize(lyricsDataArray, settings) {
    const { geminiApiKey, geminiRomanizationModel } = settings;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiRomanizationModel}:generateContent?key=${geminiApiKey}`;

    // --- Define the initial user prompt once ---
    const initialUserPrompt = `You are an expert AI Romanizer. Your task is to convert non-Latin script song lyrics into standard Latin script, preserving pronunciation and structure with extreme precision.
    CRUCIAL ROMANIZATION RULES:
    1. PRESERVE LATIN SCRIPT: If any text is ALREADY in Latin script, it MUST be copied EXACTLY AS IS.
    2. PRESERVE STRUCTURE:
        - SYLLABLE-FOR-SYLLABLE MAPPING: If an input line has a "syllabus" array, your output MUST have a "syllabus" array with the EXACT SAME NUMBER OF SYLLABLES. Do not merge or split syllables.
        - OMIT SYLLABLES WHEN ABSENT: If an input line does NOT have a "syllabus" array, your output MUST also NOT have a "syllabus" array.
    3. ACCURATE ROMANIZATION: Convert non-Latin text to its standard romanization.
    4. PRESERVE PUNCTUATION & NUMBERS: All numbers and punctuation must be preserved.

    Now, process the following lyrics based on these strict rules.
    Lyrics to romanize:
    ${JSON.stringify(lyricsDataArray, null, 2)}`;

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
                        original_line_index: { type: "INTEGER", description: "The original index of the line, which must be preserved from the input." },
                        syllabus: {
                            type: "ARRAY",
                            nullable: true,
                            description: "An array of individual romanized syllables. MUST ONLY be present if the corresponding input object had a syllabus. Its length MUST match the input syllabus length.",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    text: { type: "STRING", description: "The text of a single romanized syllable." },
                                    syllableIndex: { type: "INTEGER", description: "The original index of the syllable, which must be preserved." }
                                },
                                required: ["text", "syllableIndex"]
                            }
                        }
                    },
                    required: ["text", "original_line_index"]
                }
            }
        },
        required: ["romanized_lyrics"]
    };

    // --- First Attempt ---
    const firstRequestBody = {
        contents: [{ role: 'user', parts: [{ text: initialUserPrompt }] }],
        generation_config: {
            response_mime_type: "application/json",
            responseSchema: schema
        }
    };
    
    let responseText;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firstRequestBody)
        });
        if (!response.ok) throw new Error(`Initial API call failed with status ${response.status}`);
        const data = await response.json();
        if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
        responseText = data.candidates[0].content.parts[0].text;
    } catch(e) {
        throw new Error(`Gemini romanization failed on initial request: ${e.message}`);
    }

    const parsedJson = JSON.parse(responseText);
    const validationResult = validateRomanizationResponse(lyricsDataArray, parsedJson);

    if (validationResult.isValid) {
        console.log("Gemini romanization succeeded on the first attempt.");
        return parsedJson.romanized_lyrics; // Success!
    }

    // --- Second Attempt (Reflection) ---
    console.warn("First attempt failed validation. Building multi-turn context for reflection...");
    
    const reflectionPrompt = `Your previous response had structural errors and did not adhere to the rules.
    
    Here are the specific errors that you MUST fix:
    - ${validationResult.errors.join('\n- ')}
    
    Please analyze our conversation history, re-read the original rules, and provide a new, corrected JSON object that fixes all the listed errors.
    Here the original lyrics:
    ${JSON.stringify(lyricsDataArray, null, 2)}`;

    // Build the conversational history for the reflection call
    const secondRequestBody = {
        contents: [
            { role: 'user', parts: [{ text: initialUserPrompt }] }, // Turn 1: Original request
            { role: 'model', parts: [{ text: responseText }] },    // Turn 2: Model's flawed response
            { role: 'user', parts: [{ text: reflectionPrompt }] }  // Turn 3: User's correction
        ],
        generation_config: {
            response_mime_type: "application/json",
            responseSchema: schema // Apply the same schema constraint to the correction
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(secondRequestBody)
        });
        if (!response.ok) throw new Error(`Reflection API call failed with status ${response.status}`);
        const data = await response.json();
        if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the reflection request: ${data.promptFeedback.blockReason}`);
        
        const finalResponseText = data.candidates[0].content.parts[0].text;
        const finalParsedJson = JSON.parse(finalResponseText);
        const finalValidation = validateRomanizationResponse(lyricsDataArray, finalParsedJson);

        if (finalValidation.isValid) {
            console.log("Gemini romanization succeeded on the reflection attempt.");
            return finalParsedJson.romanized_lyrics; // Success on the second try!
        } else {
            // If it's still wrong, we give up and report the final errors.
            throw new Error(`Reflection attempt also failed validation. Final errors: ${finalValidation.errors.join(', ')}`);
        }
    } catch(e) {
        throw new Error(`Gemini romanization failed during reflection: ${e.message}`);
    }
}

async function fetchGoogleTranslate(text, targetLang) {
    if (!text.trim()) return "";
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Translate API error: ${response.statusText}`);
    const data = await response.json();
    return data?.map(item => item).join('') || text;
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
            sourceLang = detectData || 'auto';
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
            romanizedTexts.push(romanizeData?.[0]?.[0]?.[0] || text);
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
        const selectedTrack = validTracks.find(t => t.isDefault) || validTracks;

        if (!selectedTrack) return null;

        const url = new URL(selectedTrack.url);
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
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\](.*)/;
    const matches = data.syncedLyrics.split('\n')
        .map(line => timeRegex.exec(line))
        .filter(Boolean)
        .map(match => ({
            startTime: parseInt(match, 10) * 60 + parseInt(match, 10) + parseInt(match, 10) / 100,
            text: match.trim()
        }));
    
    if (matches.length === 0) return null;
    
    const parsedLines = matches.map((current, i) => {
        const endTime = (i < matches.length - 1) ? matches[i + 1].startTime : current.startTime + 5;
        return { ...current, endTime, duration: endTime - current.startTime };
    }).filter(line => line.text);

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
            }));
            return { text: item.text || '', startTime, duration, endTime: startTime + duration, syllabus };
        }),
        metadata: { ...data.metadata, source: `${data.metadata.source} (KPoe)` }
    };
}


/* =================== UTILITY FUNCTIONS =================== */

function isEmptyLyrics(lyrics) {
    return !lyrics || !lyrics.data || lyrics.data.length === 0 || lyrics.data.every(line => !line.text);
}

function isPurelyLatinScript(text) {
    return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(text);
}
