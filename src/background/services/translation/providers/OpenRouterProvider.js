
import { TranslationProvider } from '../TranslationProvider.js';
import { createTranslationPrompt, createRomanizationPrompt } from '../prompts.js';
import { Utilities } from '../../../utils/utilities.js';

export class OpenRouterProvider extends TranslationProvider {
    constructor(settings) {
        super(settings);
        this.apiKey = settings.openRouterApiKey;
        this.model = settings.openRouterModel || 'google/gemini-2.0-flash-001';
    }

    async translate(texts, targetLang, songInfo = {}) {
        if (!this.apiKey) {
            throw new Error('OpenRouter API Key is missing. Please set it in Settings.');
        }

        let prompt = createTranslationPrompt(this.settings, texts, targetLang, songInfo);

        // Append specific instruction for OpenRouter JSON response format
        prompt += `\n\nIMPORTANT OUTPUT FORMAT:
You must return a valid JSON object exactly like this:
{
  "translated_lyrics": [
    "translated line 1",
    "translated line 2",
    ... (one string per input line)
  ],
  "target_language": "${targetLang}"
}
Do not wrap in Markdown code blocks. Just the raw JSON string.`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/ibratabian17/youlyplus", // Site URL for rankings on openrouter.ai.
                "X-Title": "YouLy+" // Site title for rankings on openrouter.ai.
            },
            body: JSON.stringify({
                "model": this.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a helpful assistant that translates song lyrics. You must return only valid JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "response_format": { "type": "json_object" }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`OpenRouter API Error: ${response.status} ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const rawContent = data.choices[0].message.content;

        return this.parseResponse(rawContent, texts.length);
    }

    async romanize(originalLyrics, targetLang, songInfo = {}) {
        if (!this.apiKey) {
            throw new Error('OpenRouter API Key is missing. Please set it in Settings.');
        }

        const { lyricsForApi, reconstructionPlan } = this.prepareLyrics(originalLyrics);
        const hasAnyChunks = lyricsForApi.some(line => line.chunk && line.chunk.length > 0);

        if (lyricsForApi.length === 0) {
            return this.reconstructLyrics([], reconstructionPlan, hasAnyChunks);
        }

        let prompt;
        if (this.settings.overrideGeminiRomanizePrompt && this.settings.customGeminiRomanizePrompt) {
            const songContext = (songInfo.title && songInfo.artist)
                ? `\n# SONG CONTEXT\n- Title: ${songInfo.title}\n- Artist: ${songInfo.artist}\n`
                : '';
            prompt = songContext + this.settings.customGeminiRomanizePrompt;
        } else {
            prompt = createRomanizationPrompt(lyricsForApi, hasAnyChunks, songInfo, targetLang);
        }

        // Add specific instruction for OpenRouter
        const refinedPrompt = prompt + `\n\nIMPORTANT: Return PURE JSON only. No markdown formatting.`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/ibratabian17/youlyplus",
                "X-Title": "YouLy+"
            },
            body: JSON.stringify({
                "model": this.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a helpful assistant that provides phonetic romanization for song lyrics. YOU MUST RETURN VALID JSON."
                    },
                    {
                        "role": "user",
                        "content": refinedPrompt
                    }
                ],
                "response_format": { "type": "json_object" }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`OpenRouter Romanization API Error: ${response.status} ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const rawContent = data.choices[0].message.content;

        const cleanedText = this.cleanJsonOutput(rawContent);
        let parsedJson;
        try {
            parsedJson = JSON.parse(cleanedText);
        } catch (e) {
            throw new Error("Failed to parse OpenRouter romanization response as JSON: " + e.message);
        }

        if (!parsedJson.romanized_lyrics || !Array.isArray(parsedJson.romanized_lyrics)) {
            throw new Error("Invalid response conformation: missing 'romanized_lyrics' array");
        }

        return this.reconstructLyrics(parsedJson.romanized_lyrics, reconstructionPlan, hasAnyChunks);
    }

    parseResponse(rawText, expectedLength) {
        try {
            // Clean up markdown code blocks if present
            const cleanText = this.cleanJsonOutput(rawText);

            const parsed = JSON.parse(cleanText);

            if (!Array.isArray(parsed.translated_lyrics)) {
                throw new Error("Response JSON does not contain 'translated_lyrics' array");
            }

            if (parsed.translated_lyrics.length !== expectedLength) {
                console.warn(`OpenRouter returned ${parsed.translated_lyrics.length} lines, expected ${expectedLength}.`);
            }

            return parsed.translated_lyrics;
        } catch (e) {
            console.error("Failed to parse OpenRouter response:", rawText);
            throw new Error(`Failed to parse translation response: ${e.message}`);
        }
    }

    cleanJsonOutput(text) {
        if (!text) return "";
        return text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/, "");
    }

    prepareLyrics(originalLyrics) {
        const lyricsForApi = [];
        const reconstructionPlan = [];
        const contentToApiIndexMap = new Map();

        // Inspect input structure – originalLyrics usually has a 'data' property array
        const lines = originalLyrics.data || [];

        lines.forEach((line, originalIndex) => {
            if (Utilities.isPurelyLatinScript(line.text)) {
                reconstructionPlan.push({ type: 'latin', data: line, originalIndex });
                return;
            }

            const contentKey = JSON.stringify({ text: line.text, chunk: line.chunk });

            if (contentToApiIndexMap.has(contentKey)) {
                reconstructionPlan.push({
                    type: 'api',
                    apiIndex: contentToApiIndexMap.get(contentKey),
                    originalIndex
                });
            } else {
                const newApiIndex = lyricsForApi.length;
                const apiLine = { text: line.text, original_line_index: newApiIndex };

                // Map syllabus to chunk if present (structure used in GeminiRomanizer)
                // originalLyrics often uses 'syllabus' for chunks, but GeminiRomanizer expects 'chunk' in apiLine
                if (line.syllabus && line.syllabus.length > 0) {
                    apiLine.chunk = line.syllabus.map((s, idx) => ({ text: s.text, chunkIndex: idx }));
                }

                lyricsForApi.push(apiLine);
                contentToApiIndexMap.set(contentKey, newApiIndex);
                reconstructionPlan.push({ type: 'api', apiIndex: newApiIndex, originalIndex });
            }
        });

        return { lyricsForApi, reconstructionPlan };
    }

    reconstructLyrics(romanizedApiLyrics, reconstructionPlan, hasAnyChunks) {
        const fullList = [];

        reconstructionPlan.forEach(planItem => {
            let reconstructedLine;

            if (planItem.type === 'latin') {
                // For already Latin lines, we need to ensure structure matches what the app expects
                // Usually mapping back to 'syllabus' if 'chunk' is used internally
                const chunks = planItem.data.syllabus || [];
                reconstructedLine = {
                    ...planItem.data, // preserves original
                    // ensure we don't accidentally overwrite something wrong, but keep original structure
                };
            } else {
                const apiResult = romanizedApiLyrics[planItem.apiIndex];
                if (!apiResult) {
                    // Fallback if API missed a line
                    reconstructedLine = { text: "", original_line_index: planItem.originalIndex };
                } else {
                    reconstructedLine = {
                        ...apiResult,
                        original_line_index: planItem.originalIndex
                    };
                }
            }

            fullList[planItem.originalIndex] = reconstructedLine;
        });

        return fullList;
    }
}
