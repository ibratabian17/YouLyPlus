//Universal Browser
const pBrowser = chrome || browser;
console.log('Service Workers Running')

// In‑memory caches for quick access
const lyricsCache = new Map();
const ongoingFetches = new Map();
let currentFetchController = null;

/* =================== IndexedDB Helper Functions =================== */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LyricsCacheDB", 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("lyrics")) {
                db.createObjectStore("lyrics", { keyPath: "key" });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function getLyricsFromDB(key) {
    const db = await openDB();
    return new Promise(async (resolve, reject) => {
        const settings = await storageLocalGet({ 'cacheStrategy': 'aggressive' });
        const cacheStrategy = settings.cacheStrategy;

        if (cacheStrategy === 'none') {
            resolve(null);
            return;
        }

        const transaction = db.transaction(["lyrics"], "readonly");
        const store = transaction.objectStore("lyrics");
        const request = store.get(key);
        request.onsuccess = event => {
            const result = event.target.result;
            if (result) {
                const now = Date.now();
                let expirationTime = 2 * 60 * 60 * 1000; // Default: aggressive (2 hours)

                if (cacheStrategy === 'moderate') {
                    expirationTime = 1 * 60 * 60 * 1000; // Moderate: 1 hour
                }

                const age = now - result.timestamp;
                if (age < expirationTime) {
                    resolve(result.lyrics);
                } else {
                    // If expired, remove from DB
                    deleteLyricsFromDB(key);
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
    const settings = await storageLocalGet({ 'cacheStrategy': 'aggressive' });
    if (settings.cacheStrategy === 'none') {
        return; // Do not save if cache strategy is 'none'
    }
    const cacheStrategy = settings.cacheStrategy;

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.put({ key, lyrics, timestamp: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

async function deleteLyricsFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

// Clear only expired cache entries based on current strategy
async function clearExpiredCache() {
    const db = await openDB();
    return new Promise(async (resolve, reject) => {
        const settings = await storageLocalGet({ 'cacheStrategy': 'aggressive' });
        const cacheStrategy = settings.cacheStrategy;

        if (cacheStrategy === 'none') {
            resolve(); // Nothing to clear if cache is disabled
            return;
        }

        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.getAll();
        request.onsuccess = async event => {
            const now = Date.now();
            let expirationTime = 2 * 60 * 60 * 1000; // Default: aggressive (2 hours)

            if (cacheStrategy === 'moderate') {
                expirationTime = 1 * 60 * 60 * 1000; // Moderate: 1 hour
            }

            const allRecords = event.target.result;
            for (const record of allRecords) {
                if (now - record.timestamp >= expirationTime) {
                    await deleteLyricsFromDB(record.key);
                }
            }
            resolve();
        };
        request.onerror = event => reject(event.target.error);
    });
}


async function clearCacheDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readwrite");
        const store = transaction.objectStore("lyrics");
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}

async function estimateIndexedDBSizeInKB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(["lyrics"], "readonly");
        const store = transaction.objectStore("lyrics");
        const request = store.getAll();
        request.onsuccess = event => {
            const allRecords = event.target.result;
            const totalSizeBytes = allRecords.reduce((acc, record) => {
                // Rough estimation: convert record to a JSON string and get its byte length.
                return acc + new TextEncoder().encode(JSON.stringify(record)).length;
            }, 0);
            // Convert bytes to kilobytes.
            const sizeInKB = totalSizeBytes / 1024;
            resolve(sizeInKB);
        };
        request.onerror = event => reject(event.target.error);
    });
}

/* =================== Local Storage Function =================== */
function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/* =================== Runtime Message Listeners =================== */
pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_LYRICS') {
        try {
            handleLyricsFetch(message.songInfo, sendResponse, message.forceReload);
        } catch (error) {
            sendResponse({ success: false, error: error });
        }
        return true; // Indicates asynchronous response.
    }
    if (message.type === 'RESET_CACHE') {
        (async () => {
            try {
                lyricsCache.clear();
                ongoingFetches.clear();
                await clearCacheDB();
                sendResponse({ success: true, message: "Cache reset successfully" });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    if (message.type === 'GET_CACHED_SIZE') {
        (async () => {
            try {
                const sizeKB = await estimateIndexedDBSizeInKB();
                const db = await openDB();
                const transaction = db.transaction(["lyrics"], "readonly");
                const store = transaction.objectStore("lyrics");
                const countRequest = store.count();
                const cacheCount = await new Promise((resolve, reject) => {
                    countRequest.onsuccess = () => resolve(countRequest.result);
                    countRequest.onerror = () => reject(countRequest.error);
                });
                sendResponse({ success: true, sizeKB, cacheCount });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
    if (message.type === 'TRANSLATE_LYRICS') {
        (async () => {
            try {
                const translatedLyrics = await handleTranslateLyrics(message.songInfo, message.action, message.targetLang, message.forceReload);
                sendResponse({ success: true, translatedLyrics });
            }
            catch (error) {
                console.error("Error handling translation:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

/* =================== Lyrics Fetching Logic =================== */
async function handleLyricsFetch(songInfo, sendResponse, forceReload = false) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;

    // If forceReload is true, bypass all cache checks.
    if (!forceReload) {
        // Check the in‑memory cache first.
        if (lyricsCache.has(cacheKey)) {
            sendResponse({ success: true, lyrics: lyricsCache.get(cacheKey), metadata: songInfo });
            return;
        }

        // Check the persistent IndexedDB cache.
        try {
            const dbCachedLyrics = await getLyricsFromDB(cacheKey);
            if (dbCachedLyrics) {
                lyricsCache.set(cacheKey, dbCachedLyrics);
                sendResponse({ success: true, lyrics: dbCachedLyrics, metadata: songInfo });
                return;
            }
        } catch (error) {
            console.error("Error reading from DB:", error);
        }

        // If an ongoing fetch is present, wait for it.
        if (ongoingFetches.has(cacheKey)) {
            try {
                const lyrics = await ongoingFetches.get(cacheKey);
                sendResponse({ success: true, lyrics, metadata: songInfo });
            } catch (error) {
                sendResponse({ success: false, error: error.message, metadata: songInfo });
            }
            return;
        }
    }

    // Start a new fetch and store its promise.
    const fetchPromise = (async () => {
        try {
            // Determine provider and source order based on settings.
            const settings = await storageLocalGet({ 'lyricsProvider': 'kpoe', 'lyricsSourceOrder': 'apple,lyricsplus,musixmatch,spotify,musixmatch-word' });
            const lyricsProvider = settings.lyricsProvider;
            const lyricsSourceOrder = settings.lyricsSourceOrder;

            let lyrics = null;
            let kpoeForceReload = forceReload;
            if (!forceReload) {
                const cacheSettings = await storageLocalGet({ 'cacheStrategy': 'aggressive' });
                if (cacheSettings.cacheStrategy === 'none') {
                    kpoeForceReload = false;
                }
            }

            // Try the primary provider first.
            if (lyricsProvider === 'kpoe') {
                lyrics = await fetchKPoeLyrics(songInfo, lyricsSourceOrder, kpoeForceReload);
            } else if (lyricsProvider === 'lrclib') {
                lyrics = await fetchLRCLibLyrics(songInfo);
            }

            // If no result from primary, try the other provider as fallback.
            if (isEmptyLyrics(lyrics)) {
                if (lyricsProvider === 'kpoe') {
                    lyrics = await fetchLRCLibLyrics(songInfo);
                } else if (lyricsProvider === 'lrclib') {
                    lyrics = await fetchKPoeLyrics(songInfo, lyricsSourceOrder, kpoeForceReload);
                }
            }

            // If both providers failed, try YouTube subtitles if available
            if (isEmptyLyrics(lyrics) && songInfo.videoId && songInfo.subtitle) {
                lyrics = await fetchYouTubeSubtitles(songInfo);
            }

            if (isEmptyLyrics(lyrics)) {
                throw new Error('No lyrics found');
            }

            lyricsCache.set(cacheKey, lyrics);
            await saveLyricsToDB(cacheKey, lyrics);
            return lyrics;
        } finally {
            // Clean up ongoing fetch record.
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);

    try {
        const lyrics = await fetchPromise;
        sendResponse({ success: true, lyrics, metadata: songInfo });
    } catch (error) {
        sendResponse({ success: false, error: error.message, metadata: songInfo });
    }
}

async function handleTranslateLyrics(songInfo, action, targetLang, forceReload = false) {
    const originalLyricsCacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;
    const translatedLyricsCacheKey = `${originalLyricsCacheKey} - ${action} - ${targetLang}`;

    // Check in-memory cache for translated lyrics first
    if (lyricsCache.has(translatedLyricsCacheKey)) {
        return lyricsCache.get(translatedLyricsCacheKey);
    }

    // Check persistent IndexedDB cache for translated lyrics
    try {
        const dbCachedTranslatedLyrics = await getLyricsFromDB(translatedLyricsCacheKey);
        if (dbCachedTranslatedLyrics) {
            lyricsCache.set(translatedLyricsCacheKey, dbCachedTranslatedLyrics);
            return dbCachedTranslatedLyrics;
        }
    } catch (error) {
        console.error("Error reading translated lyrics from DB:", error);
    }

    const originalLyrics = await getOrFetchLyrics(songInfo, forceReload);

    if (!originalLyrics || !originalLyrics.data || originalLyrics.data.length === 0) {
        throw new Error('Original lyrics not found or empty for translation.');
    }

    const settings = await storageLocalGet({
        'translationProvider': 'google',
        'geminiApiKey': '',
        'geminiModel': 'gemini-pro', // Include geminiModel in settings retrieval
        'overrideTranslateTarget': false,
        'customTranslateTarget': '',
        'overrideGeminiPrompt': false,
        'customGeminiPrompt': ''
    });
    const translationProvider = settings.translationProvider;
    const geminiApiKey = settings.geminiApiKey;
    const geminiModel = settings.geminiModel; // Get the selected Gemini model
    const overrideTranslateTarget = settings.overrideTranslateTarget;
    const customTranslateTarget = settings.customTranslateTarget;
    const overrideGeminiPrompt = settings.overrideGeminiPrompt;
    const customGeminiPrompt = settings.customGeminiPrompt;

    let actualTargetLang = overrideTranslateTarget && customTranslateTarget ? customTranslateTarget : targetLang;

    let translatedTexts = [];

    if (action === 'translate') {
        if (translationProvider === 'gemini') {
            if (!geminiApiKey) {
                throw new Error('Gemini AI API Key is not provided in settings.');
            }
            const textsToTranslate = originalLyrics.data.map(line => line.text);
            translatedTexts = await fetchGeminiTranslate(textsToTranslate, actualTargetLang, geminiApiKey, geminiModel, overrideGeminiPrompt, customGeminiPrompt);
        } else {
            const translationPromises = originalLyrics.data.map(line => fetchGoogleTranslate(line.text, actualTargetLang));
            translatedTexts = await Promise.all(translationPromises);
        }
    } else if (action === 'romanize') {
        // Romanization is typically only available via Google Translate's unofficial API
        // Gemini does not have a direct romanization endpoint.
        // So, we'll always use Google for romanization for now.
        const romanizationPromises = originalLyrics.data.map(line => fetchGoogleRomanize(line.text));
        translatedTexts = await Promise.all(romanizationPromises);
    } else {
        translatedTexts = originalLyrics.data.map(line => line.text); // Return original text if no action
    }

    // Verify translatedTexts array length matches originalLyrics.data length
    if (translatedTexts.length !== originalLyrics.data.length) {
        console.error(`Translation failed: Mismatched array lengths. Original: ${originalLyrics.data.length}, Translated: ${translatedTexts.length}`);
        throw new Error('Translation failed: The number of translated lines does not match the original.');
    }

    const translatedData = originalLyrics.data.map((line, index) => ({
        ...line,
        translatedText: translatedTexts[index] || line.text // Use original text if translation fails for a line
    }));
    const finalTranslatedLyrics = {
        ...originalLyrics,
        data: translatedData,
        metadata: {
            ...originalLyrics.metadata,
            source: `${originalLyrics.metadata.source}`
        }
    };

    lyricsCache.set(translatedLyricsCacheKey, finalTranslatedLyrics);
    const cacheSettings = await storageLocalGet({ 'cacheStrategy': 'aggressive' });
    if (cacheSettings.cacheStrategy !== 'none') {
        await saveLyricsToDB(translatedLyricsCacheKey, finalTranslatedLyrics); // Save translated lyrics to DB
    }
    console.log('song translated and cached');

    return finalTranslatedLyrics;
}

// Helper function to get lyrics from cache/DB or fetch them
async function getOrFetchLyrics(songInfo, forceReload = false) {
    const cacheKey = `${songInfo.title} - ${songInfo.artist} - ${songInfo.album}`;

    // Check in-memory cache
    if (lyricsCache.has(cacheKey)) {
        return lyricsCache.get(cacheKey);
    }

    // Check persistent IndexedDB cache
    try {
        const dbCachedLyrics = await getLyricsFromDB(cacheKey);
        if (dbCachedLyrics) {
            lyricsCache.set(cacheKey, dbCachedLyrics);
            return dbCachedLyrics;
        }
    } catch (error) {
        console.error("Error reading from DB:", error);
    }

    // If an ongoing fetch is present, wait for it.
    if (ongoingFetches.has(cacheKey)) {
        try {
            return await ongoingFetches.get(cacheKey);
        } catch (error) {
            console.error("Error waiting for ongoing fetch:", error);
            return null;
        }
    }

    // Start a new fetch and store its promise.
    const fetchPromise = (async () => {
        try {
            // Determine provider and source order based on settings.
            const settings = await storageLocalGet({ 'lyricsProvider': 'kpoe', 'lyricsSourceOrder': 'apple,lyricsplus,musixmatch,spotify,musixmatch-word', 'cacheStrategy': 'aggressive' });
            const lyricsProvider = settings.lyricsProvider;
            const lyricsSourceOrder = settings.lyricsSourceOrder;
            const cacheStrategy = settings.cacheStrategy;

            let lyrics = null;
            let fetchOptions = {};

            if (cacheStrategy === 'none') {
                fetchOptions = { cache: 'no-cache' };
            }

            // Try the primary provider first.
            if (lyricsProvider === 'kpoe') {
                lyrics = await fetchKPoeLyrics(songInfo, lyricsSourceOrder, forceReload);
            } else if (lyricsProvider === 'lrclib') {
                lyrics = await fetchLRCLibLyrics(songInfo, fetchOptions);
            }

            // If no result from primary, try the other provider as fallback.
            if (isEmptyLyrics(lyrics)) {
                if (lyricsProvider === 'kpoe') {
                    lyrics = await fetchLRCLibLyrics(songInfo, fetchOptions);
                } else if (lyricsProvider === 'lrclib') {
                    lyrics = await fetchKPoeLyrics(songInfo, lyricsSourceOrder, forceReload);
                }
            }

            // If both providers failed, try YouTube subtitles if available
            if (isEmptyLyrics(lyrics) && songInfo.videoId && songInfo.subtitle) {
                lyrics = await fetchYouTubeSubtitles(songInfo);
            }

            if (isEmptyLyrics(lyrics)) {
                throw new Error('No lyrics found');
            }

            lyricsCache.set(cacheKey, lyrics);
            await saveLyricsToDB(cacheKey, lyrics);
            return lyrics;
        } finally {
            // Clean up ongoing fetch record.
            ongoingFetches.delete(cacheKey);
        }
    })();

    ongoingFetches.set(cacheKey, fetchPromise);

    try {
        return await fetchPromise;
    } catch (error) {
        console.error("Error fetching lyrics:", error);
        return null;
    }
}

// This function generates the standard block for lyrics input and JSON output instructions.
// It will be appended to the active translation rules.
const getStandardInputOutputInstructionBlock = (textsArray, targetLangString) => `

---
You will receive the lyrics as a JSON array of strings.
---
LYRICS TO TRANSLATE (each element in the array is one line of lyrics):
\`\`\`json
${JSON.stringify(textsArray)}\`\`\`
---
MANDATORY OUTPUT INSTRUCTIONS (MUST BE FOLLOWED PRECISELY):
Produce ONLY a single, valid JSON string as your output. NO other text, explanation, or markdown formatting (like \`\`\`json) should precede or follow the JSON object.
The JSON object MUST have the following structure:
{
  "translated_lyrics": ["array_of_translated_lines_in_the_same_order_as_input"],
  "detected_source_languages_per_line": ["array_indicating_identified_source_language(s)_for_each_original_line_e.g., 'en', 'es', 'mixed', or an array like ['en', 'fr'] if multiple distinct ones were clear"],
  "target_language": "${targetLangString}"
}
The "translated_lyrics" array MUST contain the translated version of each corresponding input line, maintaining the original order.
The "detected_source_languages_per_line" array should be parallel to "translated_lyrics", indicating the language(s) you identified in each original line.
---
Now, translate the provided lyrics according to all rules and output instructions.
`;


async function fetchGeminiTranslate(texts, targetLang, apiKey, model, overridePrompt, customPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let translationRulesPart;

    if (overridePrompt && customPrompt) {
        // User's custom prompt defines the translation rules.
        // It can use {targetLang} for language-specific instructions.
        translationRulesPart = customPrompt.replace(/{targetLang}/g, targetLang);
    } else {
        // Default "Lyrical Bridge" translation rules part.
        // Note: The explicit "Your output MUST strictly be a JSON object." is removed here
        // as the standardInputOutputInstructionBlock will cover JSON output instructions.
        translationRulesPart = `
You are an expert AI Lyrical Translator and linguist, specializing in preserving the original meaning, emotion, nuance, and natural flow when translating song lyrics into {targetLang}.

CRUCIAL TRANSLATION RULES (MUST BE FOLLOWED FOR EACH LINE OF LYRICS):

1.  **INTERNAL LANGUAGE IDENTIFICATION:** For each line of lyrics received, internally identify all languages present within that line. This is crucial for the subsequent steps.
2.  **TRANSLATE ALL NON-{targetLang} ELEMENTS:** ALL words, phrases, or segments within a line of lyrics that are NOT in {targetLang} MUST be accurately translated into {targetLang}. Ensure no foreign language parts (other than {targetLang}) remain untranslated or are merely romanized without semantic translation. For example, if Arabic, Japanese, or Korean text (not {targetLang}) is present, translate its MEANING into {targetLang}, do not just convert it to Latin characters.
3.  **PRESERVE IF ALREADY {targetLang} (CONDITIONAL):**
    *   If an ENTIRE line of lyrics is ALREADY in {targetLang} and contains NO other languages needing translation, then COPY that line EXACTLY AS IS into the translated output for that line. DO NOT change, DO NOT rephrase, DO NOT re-translate it.
    *   If a line contains a MIX of {targetLang} and other languages, you MUST translate the non-{targetLang} parts into {targetLang} and integrate them naturally with the existing {targetLang} parts of that line.
4.  **NATURALNESS AND CONTEXT:** The final translated line must sound natural and flow well in {targetLang}, as if it were originally written in that language. Maintain contextual continuity with other lines where appropriate.
5.  **ACCURACY IS PARAMOUNT:** Prioritize the accurate conveyance of the original meaning and emotion over strict adherence to rhyme or poetic meter if a conflict arises. However, strive for both if possible without sacrificing meaning or naturalness.
    `.replace(/{targetLang}/g, targetLang);
    }

    // Combine the translation rules with the standard input/output instructions.
    const finalInputOutputBlock = getStandardInputOutputInstructionBlock(texts, targetLang);
    const mainPromptText = translationRulesPart + finalInputOutputBlock;

    const requestBody = {
        contents: [{
            parts: [{
                text: mainPromptText
            }]
        }],
        generation_config: {
            response_mime_type: "application/json",
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        let errorDetails = 'Unknown error';
        try {
            const errorData = await response.json();
            if (errorData.error && errorData.error.message) {
                errorDetails = errorData.error.message;
                if (errorData.error.details) {
                    errorDetails += ` | Details: ${JSON.stringify(errorData.error.details)}`;
                }
            } else {
                errorDetails = JSON.stringify(errorData);
            }
        } catch (e) {
            errorDetails = await response.text();
        }
        throw new Error(`Gemini AI API error: ${response.status} - ${errorDetails}`);
    }

    const data = await response.json();

    if (data.promptFeedback && data.promptFeedback.blockReason) { // Check for blocked content first
        throw new Error(`Gemini AI translation blocked: ${data.promptFeedback.blockReason}. Details: ${JSON.stringify(data.promptFeedback.safetyRatings)}`);
    }

    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
        let rawJsonText = data.candidates[0].content.parts[0].text.trim();

        if (rawJsonText.startsWith('```json') && rawJsonText.endsWith('```')) {
            rawJsonText = rawJsonText.substring(7, rawJsonText.length - 3).trim();
        } else if (rawJsonText.startsWith('```') && rawJsonText.endsWith('```')) {
            rawJsonText = rawJsonText.substring(3, rawJsonText.length - 3).trim();
        }

        try {
            const parsedJson = JSON.parse(rawJsonText);
            if (parsedJson && Array.isArray(parsedJson.translated_lyrics) &&
                parsedJson.target_language === targetLang &&
                (Array.isArray(parsedJson.detected_source_languages_per_line) || parsedJson.detected_source_languages_per_line === undefined)
            ) {
                return parsedJson.translated_lyrics;
            } else {
                console.warn("Gemini AI response JSON structure mismatch or missing vital fields. Expected structure not fully met. Raw:", rawJsonText, "Parsed:", parsedJson);
                throw new Error('Gemini AI translation: Invalid or incomplete JSON structure in response.');
            }
        } catch (e) {
            console.error("Gemini AI response was not valid JSON or failed parsing:", e, "\nRaw text received:", rawJsonText);
            const lines = rawJsonText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length === texts.length && !rawJsonText.includes("{") && !rawJsonText.includes("[")) {
                console.warn("Attempting recovery by splitting lines as JSON parsing failed and response doesn't look like JSON.");
                return lines;
            }
            throw new Error(`Gemini AI translation failed: Response was not valid JSON. ${e.message}`);
        }
    }
    throw new Error('Gemini AI translation failed: No valid content or parts in response candidates.');
}

async function fetchGoogleTranslate(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Google Translate API error: ${response.statusText}`);
    }
    const data = await response.json();
    // The translated text is usually in data[0][0][0]
    return data[0].map(item => item[0]).join('');
}

async function fetchGoogleRomanize(text) {
    // Google Translate's transliteration (romanization) is available via dt=rm
    // We set target language to English (or any Latin-based script) to ensure romanization
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&hl=en&dt=rm&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Google Romanize API error: ${response.statusText}`);
    }
    const data = await response.json();
    // Romanized text is typically in data[0][0][3] for the first segment
    // It's an array of arrays, so we need to map and join
    if (data[0] && data[0][0] && data[0][0][3]) {
        return data[0][0][3];
    }
    return text; // Return original text if romanization fails
}

// Helper function to check if lyrics object is empty
function isEmptyLyrics(lyrics) {
    if (!lyrics) {
        return true;
    }
    if (lyrics.data && Array.isArray(lyrics.data) && lyrics.data.length === 0) {
        return true;
    }
    // Check if all lines have empty text
    if (lyrics.data && Array.isArray(lyrics.data)) {
        return lyrics.data.every(line => !line.text);
    }
    return false;
}

async function fetchKPoeLyrics(songInfo, sourceOrder = '', forceReload = false) {
    const albumParam = (songInfo.album && songInfo.album !== songInfo.title)
        ? `&album=${encodeURIComponent(songInfo.album)}`
        : '';
    const sourceParam = sourceOrder ? `&source=${encodeURIComponent(sourceOrder)}` : '';
    let forceReloadParam = forceReload ? `&forceReload=true` : '';
    let fetchOptions = {};

    if (forceReload) {
        fetchOptions = { cache: 'no-store' };
        forceReloadParam = `&forceReload=true`;
    }

    const url = `https://lyricsplus.prjktla.workers.dev/v2/lyrics/get?title=${encodeURIComponent(songInfo.title)}&artist=${encodeURIComponent(songInfo.artist)}${albumParam}&duration=${songInfo.duration}${sourceParam}${forceReloadParam}`;

    const response = await fetch(url, fetchOptions);
    if (!response.ok) return null;

    const data = await response.json();
    return parseKPoeFormat(data);
}

async function fetchLRCLibLyrics(songInfo) {
    const albumParam = (songInfo.album && songInfo.album !== songInfo.title)
        ? `&album_name=${encodeURIComponent(songInfo.album)}`
        : '';
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(songInfo.artist)}&track_name=${encodeURIComponent(songInfo.title)}${albumParam}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    return parseLRCLibFormat(data);
}

async function fetchYouTubeSubtitles(songInfo) {
    try {
        const subtitleData = songInfo.subtitle;
        if (!subtitleData || !subtitleData.captionTracks || subtitleData.captionTracks.length === 0) {
            return null;
        }

        let selectedTrack = null;
        let fallbackCandidate = null;

        // Look for a default track among one-letter keys, prioritizing isDefault true
        for (const key in subtitleData) {
            if (key.length === 1) { // likely a default track key
                const candidate = subtitleData[key];
                if (
                    candidate &&
                    typeof candidate === 'object' &&
                    candidate.url &&
                    candidate.languageCode &&
                    candidate.kind !== 'asr' &&
                    !(candidate.vssId && candidate.vssId.startsWith('a.'))
                ) {
                    // Prioritize if isDefault true
                    if (candidate.isDefault) {
                        selectedTrack = candidate;
                        break;
                    }
                    // Save candidate as fallback if none marked default yet
                    if (!fallbackCandidate) {
                        fallbackCandidate = candidate;
                    }
                }
            }
        }

        // If no isDefault candidate was found among one-letter keys, use the fallback candidate
        if (!selectedTrack && fallbackCandidate) {
            selectedTrack = fallbackCandidate;
        }

        // Fallback to captionTracks if still not found
        if (!selectedTrack) {
            const validTracks = subtitleData.captionTracks.filter(track =>
                track.kind !== 'asr' &&
                (!track.vssId || !track.vssId.startsWith('a.'))
            );
            if (validTracks.length > 0) {
                // Prefer track with isDefault true
                const defaultTrack = validTracks.find(track => track.isDefault);
                selectedTrack = defaultTrack || validTracks[0];
            }
        }

        if (!selectedTrack) {
            return null;
        }

        // Update the URL to request JSON3 format
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
    if (!data.events || data.events.length === 0) {
        return null;
    }

    const parsedLines = [];

    // Process each subtitle event
    for (let i = 0; i < data.events.length; i++) {
        const event = data.events[i];

        // Skip events without text
        if (!event.segs || !event.segs.length) continue;

        // Combine all segments into one text string
        const text = event.segs.map(seg => seg.utf8).join(' ').trim();
        if (!text) continue;

        // Convert times from milliseconds to seconds
        const startTime = event.tStartMs / 1000;
        const duration = event.dDurationMs / 1000;
        const endTime = startTime + duration;

        parsedLines.push({
            text,
            startTime,
            endTime,
            duration,
            element: { singer: 'v1' }
        });
    }

    if (parsedLines.length === 0) {
        return null;
    }

    return {
        type: 'Line',
        data: parsedLines,
        ignoreSponsorblock: true,
        metadata: {
            title: songInfo.title,
            artist: songInfo.artist,
            album: songInfo.album,
            duration: songInfo.duration,
            instrumental: false,
            source: "YouTube Captions"
        }
    };
}

function parseLRCLibFormat(data) {
    if (!data.syncedLyrics) return null;

    const lines = data.syncedLyrics.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\](.*)/;
    const parsedLines = [];
    const matches = [];

    // Extract timestamps and text.
    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const centiseconds = parseInt(match[3], 10);
            const startTime = minutes * 60 + seconds + centiseconds / 100;
            const text = match[4].trim();
            matches.push({ startTime, text });
        }
    }

    // Calculate end times.
    for (let i = 0; i < matches.length; i++) {
        const { startTime, text } = matches[i];
        const endTime = (i < matches.length - 1)
            ? matches[i + 1].startTime
            : startTime + 4; // Default duration.
        if (text.trim() !== "") parsedLines.push({
            text,
            startTime,
            endTime,
            element: { singer: 'v1' }
        });
    }

    return {
        type: 'Line',
        data: parsedLines,
        metadata: {
            title: data.trackName,
            artist: data.artistName,
            album: data.albumName,
            duration: data.duration,
            instrumental: data.instrumental,
            source: "LRCLIB"
        }
    };
}

function parseKPoeFormat(data) {
    if (!Array.isArray(data.lyrics)) return null;

    // Clone metadata to avoid mutation.
    const metadata = {
        ...data.metadata,
        source: `${data.metadata.source} (KPoe)`
    };

    return {
        type: data.type, // This will be "Word" or "Line"
        data: data.lyrics.map(item => {
            const startTime = Number(item.time) || 0;
            const duration = Number(item.duration) || 0;
            const endTime = startTime + duration;

            // For v2, 'lyrics' array contains lines, and 'syllabus' contains words.
            // Times are already in milliseconds from the API.
            const parsedSyllabus = (item.syllabus || []).map(syllable => ({
                text: syllable.text || '',
                time: Number(syllable.time) || 0,
                duration: Number(syllable.duration) || 0,
                isLineEnding: Boolean(syllable.isLineEnding),
                isBackground: Boolean(syllable.isBackground), // Add this line
                element: syllable.element || {}
            }));

            return {
                text: item.text || '', // Full line text
                startTime: startTime / 1000, // Convert to seconds
                duration: duration / 1000, // Convert to seconds
                endTime: endTime / 1000, // Convert to seconds
                syllabus: parsedSyllabus, // Word-by-word breakdown
                element: item.element || {}
            };
        }),
        metadata
    };
}
