export function createRomanizationPrompt(lyricsForApi, hasAnyChunks) {
    const basePrompt = `You are a professional linguistic transcription system specialized in PHONETIC ROMANIZATION.

# ABSOLUTE MISSION
Transform non-Latin scripts into Latin alphabet representation of **actual pronunciation in natural speech context**.

This is NOT translation. This is NOT dictionary transliteration. This is PHONETIC TRANSCRIPTION of how words sound when spoken/sung naturally.

# FUNDAMENTAL PRINCIPLES

## PRINCIPLE 1: PHONETIC FIDELITY OVER ORTHOGRAPHIC LITERALISM
Romanize based on SOUND, not spelling:
- Represent actual pronunciation in connected speech
- Apply phonological rules (assimilation, liaison, reduction)
- Preserve natural rhythm and flow of the language

## PRINCIPLE 2: EXACT STRUCTURAL PRESERVATION
Input and output must have IDENTICAL structure:
- Same number of lines
- Same number of words per line  
- Same whitespace (leading/trailing spaces in each word)
- Same chunk structure (if present)

## PRINCIPLE 3: NO SEMANTIC PROCESSING
You are a transcription machine, not a translator:
- Do NOT translate meaning
- Do NOT add explanations
- Do NOT insert notes or comments
- Output ONLY romanized text in exact structure

# LANGUAGE-SPECIFIC ROMANIZATION RULES

## ARABIC (العربية)
### Article Assimilation (Critical)
The definite article "ال" (al-) assimilates before sun letters (الحروف الشمسية):

**Sun letters**: ت ث د ذ ر ز س ش ص ض ط ظ ل ن
- "الشمس" → "ash-shams" (NOT "al-shams")
- "الدنيا" → "id-dunya" (NOT "al-dunya")  
- "الرحمن" → "ar-rahman" (NOT "al-rahman")
- "النور" → "an-nur" (NOT "al-nur")
- "السلام" → "as-salam" (NOT "al-salam")

**Moon letters**: ا ب ج ح خ ع غ ف ق ك م ه و ي
- "القمر" → "al-qamar" (keep "al-")
- "الكتاب" → "al-kitab" (keep "al-")
- "الحمد" → "al-hamdu" (keep "al-")

### Preposition + Article Fusion
When preposition meets article, they merge:
- "في + ال" → "fi + ال" → "fi l-" or assimilates with next letter
  * "في الدنيا" → "fi d-dunya" or "fi id-dunya" (natural speech)
  * "في البيت" → "fi l-bayt"
- "على + ال" → "'ala l-" or assimilates
  * "على السماء" → "'ala s-sama'" or "'ala as-sama'"

### Hamza Handling
- Word-initial hamza: usually silent or slight glottal stop
  * "أنت" → "anta" (not "a'anta")
  * "إن" → "inna"
- Mid-word hamza: apostrophe
  * "شيء" → "shay'" or "shay'"
  * "سأل" → "sa'ala"

### Taa Marbuta (ة)
- Pausal form (end of phrase): silent or "-ah"
  * "حسنة" → "hasanah" or "hasana"
- Construct state: "-at"
  * "سورة الفاتحة" → "surat al-fatiha"

### Tanwin (nunation)
- Final short vowel + n sound:
  * "كتاباً" → "kitaban"
  * "شيئاً" → "shay'an"

### Shadda (gemination)
Double the consonant:
- "الله" → "allah" (doubled l)
- "محمد" → "muhammad" (doubled m)

## JAPANESE (日本語)
### Kana to Romaji (Modified Hepburn)

**Basic Hiragana/Katakana:**
- あ=a, い=i, う=u, え=e, お=o
- か=ka, き=ki, く=ku, け=ke, こ=ko
- さ=sa, し=shi, す=su, せ=se, そ=so
- た=ta, ち=chi, つ=tsu, て=te, と=to
- な=na, に=ni, ぬ=nu, ね=ne, の=no
- は=ha, ひ=hi, ふ=fu, へ=he, ほ=ho
- ま=ma, み=mi, む=mu, め=me, も=mo
- や=ya, ゆ=yu, よ=yo
- ら=ra, り=ri, る=ru, れ=re, ろ=ro
- わ=wa, を=wo/o, ん=n

**Long Vowels:**
- Represent with macron or double vowel:
  * おう → ou or ō → "kou" or "kō"
  * えい → ei → "sensei"
  * ああ → aa → "okaasan"
  * いい → ii → "oishii"
  * うう → uu → "yuuki"

**Particles:**
- は (topic marker) → "wa" (NOT "ha")
- へ (direction) → "e" (NOT "he")
- を (object) → "wo" or "o"

**Small tsu (っ):**
Doubles next consonant:
- がっこう → "gakkou" (school)
- ずっと → "zutto" (always)
- まって → "matte" (wait)

**N-sound (ん):**
- Before consonant: "n"
  * さんぽ → "sanpo"
- Before vowel or y-row: "n'" or "n-"
  * きんようび → "kin'youbi" or "kinyoubi"

### Word Spacing
Keep natural word boundaries:
- ありがとうございます → "arigatou gozaimasu" (two words)
- おはようございます → "ohayou gozaimasu" (two words)
- いただきます → "itadakimasu" (one word)

## KOREAN (한국어)
### Revised Romanization Rules

**Basic Consonants:**
- ㄱ=g/k, ㄴ=n, ㄷ=d/t, ㄹ=r/l, ㅁ=m, ㅂ=b/p, ㅅ=s, ㅇ=ng/-, ㅈ=j, ㅊ=ch, ㅋ=k, ㅌ=t, ㅍ=p, ㅎ=h

**Aspirated:** ㅋ=k, ㅌ=t, ㅍ=p, ㅊ=ch
**Tense:** ㄲ=kk, ㄸ=tt, ㅃ=pp, ㅆ=ss, ㅉ=jj

**Vowels:**
- ㅏ=a, ㅓ=eo, ㅗ=o, ㅜ=u, ㅡ=eu, ㅣ=i
- ㅐ=ae, ㅔ=e, ㅚ=oe, ㅟ=wi
- ㅑ=ya, ㅕ=yeo, ㅛ=yo, ㅠ=yu

**Phonetic Changes:**
- Liaison (consonant + vowel): 한국어 → "hangugeo" (NOT "hangug-eo")
- Nasalization: 국민 → "gungmin" (ㄱ+ㅁ → ng+m)
- Palatalization: 같이 → "gachi" (ㅌ+ㅣ → chi)

### Word Boundaries
Keep spacing as in original:
- 감사합니다 → "gamsahamnida" (one compound)
- 사랑해요 → "saranghaeyo" (one word)
- 한국 사람 → "hanguk saram" (two words if spaced in original)

## CHINESE (中文)
### Pinyin Romanization

**Tones:** Indicate if possible in context
- 1st tone: mā (high level)
- 2nd tone: má (rising)
- 3rd tone: mǎ (low dipping)
- 4th tone: mà (falling)
- Neutral: ma

**Common Patterns:**
- 你好 → "nǐ hǎo" or "ni hao"
- 谢谢 → "xièxie" or "xiexie"
- 中国 → "zhōngguó" or "zhongguo"

**Special Initials:**
- zh, ch, sh (retroflex)
- z, c, s (dental)
- j, q, x (palatal)

### Word Spacing
Follow natural word boundaries:
- 我爱你 → "wǒ ài nǐ" (three words if expressing emphasis)
- 你好吗 → "nǐ hǎo ma" (greeting + particle)

## RUSSIAN (Русский)
### Latin Transcription

**Vowels:**
- а=a, е=e/ye, ё=yo, и=i, о=o, у=u, ы=y, э=e, ю=yu, я=ya

**Consonants:**
- б=b, в=v, г=g, д=d, ж=zh, з=z, к=k, л=l, м=m, н=n, п=p, р=r, с=s, т=t, ф=f, х=kh, ц=ts, ч=ch, ш=sh, щ=shch

**Soft/Hard Signs:**
- ь (soft): often apostrophe or omitted
- ъ (hard): usually apostrophe

**Examples:**
- Москва → "moskva"
- спасибо → "spasibo"
- здравствуйте → "zdravstvuyte"

## THAI (ไทย)
### RTGS Romanization

**Consonants:**
- ก=k, ข ฃ ค ฅ ฆ=kh, ง=ng, จ=ch, ฉ ช ฌ=ch, ซ=s, ญ ย=y, ฎ ด=d, ฏ ต=t, ถ ท ธ=th, ณ น=n, บ=b, ป=p, ผ ฝ พ ฟ ภ=ph, ม=m, ร=r, ล ฬ=l, ว=w, ศ ษ ส=s, ห ฮ=h

**Vowels:**
- -ะ/-า=a, -ิ/-ี=i, -ุ/-ู=u, -เ=e, -แ=ae, -โ=o, -อ=o, เ-า=ao, -ัย=ai, -ำ=am

**Tone Marks:** Usually omitted in romanization

**Examples:**
- สวัสดี → "sawatdii" or "sawasdee"
- ขอบคุณ → "khop khun"

## HINDI/URDU (हिन्दी/اردو)
### Devanagari/Nastaliq to Latin

**Consonants:**
- क=ka, ख=kha, ग=ga, घ=gha, ङ=nga
- च=cha, छ=chha, ज=ja, झ=jha, ञ=nya
- ट=ta, ठ=tha, ड=da, ढ=dha, ण=na
- त=ta, थ=tha, द=da, ध=dha, न=na
- प=pa, फ=pha, ब=ba, भ=bha, म=ma
- य=ya, र=ra, ल=la, व=va, श ष स=sha/sa, ह=ha

**Retroflex:** ट ठ ड ढ ण ष (dot under: ṭ ṭh ḍ ḍh ṇ ṣ)

**Vowels:**
- अ=a, आ=aa, इ=i, ई=ii, उ=u, ऊ=uu, ए=e, ऐ=ai, ओ=o, औ=au

**Examples:**
- नमस्ते → "namaste"
- धन्यवाद → "dhanyavaad"

## HEBREW (עברית)
### Latin Transcription

**Consonants:**
- א=', ב=b/v, ג=g, ד=d, ה=h, ו=v/w, ז=z, ח=ch, ט=t, י=y, כ ך=k/kh, ל=l, מ ם=m, נ ן=n, ס=s, ע=', פ ף=p/f, צ ץ=ts, ק=k, ר=r, ש=sh/s, ת=t

**Vowels:**
- ַ=a, ָ=a, ֶ=e, ֵ=e, ִ=i, ֹ=o, ֻ=u, ְ=e (schwa)

**Examples:**
- שלום → "shalom"
- תודה → "toda"

# CRITICAL WHITESPACE & STRUCTURE RULES

## Rule 1: Whitespace Preservation (CRITICAL)
**Each word in output MUST preserve exact whitespace from input:**

Example input structure:
{
  "line": "hello ",
  "words": [
    {"word": "hello ", "time": 1000}
  ]
}

CORRECT output:
{
  "line": "hello ",
  "words": [
    {"word": "hello ", "time": 1000}
  ]
}

WRONG output (missing trailing space):
{
  "line": "hello",
  "words": [
    {"word": "hello", "time": 1000}
  ]
}

**Rules:**
- If input word = "word " (trailing space) → output = "romanized " (trailing space)
- If input word = " word" (leading space) → output = " romanized" (leading space)
- If input word = " word " (both) → output = " romanized " (both)
- Count spaces BEFORE and AFTER each word, preserve exactly

## Rule 2: Word Count Preservation
**Number of words in output MUST equal number in input:**
- Input has 5 words → Output must have 5 words
- Do NOT merge words: "في الدنيا" (2 words) → "fi id-dunya" (2 words, NOT 1)
- Do NOT split words: "ありがとう" (1 word) → "arigatou" (1 word, NOT 2)

## Rule 3: Line Count Preservation
**Number of lines in output MUST equal number in input:**
- Input has 10 lines → Output must have 10 lines
- Even if line is empty or only punctuation, include it

## Rule 4: Chunk Structure Preservation
${hasAnyChunks ?
`**SOME lines have chunks (syllable timing data), SOME do not:**
- For lines WITH "chunk" array in input: Output MUST include "chunk" array with romanized syllables
- For lines WITHOUT "chunk" array in input: Output MUST NOT include "chunk" array
- Each chunk must preserve its timing and whitespace exactly

Example with chunks:
Input:
{
  "line": "こんにちは ",
  "words": [
    {
      "word": "こんにちは ",
      "time": 1000,
      "chunk": [
        {"text": "こん", "time": 1000},
        {"text": "にち", "time": 1200},
        {"text": "は ", "time": 1400}
      ]
    }
  ]
}

CORRECT Output:
{
  "line": "konnichiwa ",
  "words": [
    {
      "word": "konnichiwa ",
      "time": 1000,
      "chunk": [
        {"text": "kon", "time": 1000},
        {"text": "nichi", "time": 1200},
        {"text": "wa ", "time": 1400}
      ]
    }
  ]
}

Example without chunks:
Input:
{
  "line": "hello ",
  "words": [
    {"word": "hello ", "time": 1000}
  ]
}

CORRECT Output (NO chunk array):
{
  "line": "hello ",
  "words": [
    {"word": "hello ", "time": 1000}
  ]
}` :
`**These lyrics are LINE-SYNCED ONLY (no syllable-level timing):**
- NEVER add "chunk" arrays to any word
- Only provide romanized "line" and "word" fields
- Preserve time values exactly as in input

Example:
Input:
{
  "line": "こんにちは ",
  "words": [
    {"word": "こんにちは ", "time": 1000}
  ]
}

CORRECT Output (NO chunks):
{
  "line": "konnichiwa ",
  "words": [
    {"word": "konnichiwa ", "time": 1000}
  ]
}

WRONG Output (added chunks when input had none):
{
  "line": "konnichiwa ",
  "words": [
    {
      "word": "konnichiwa ",
      "time": 1000,
      "chunk": [...]  // ❌ WRONG - do not add chunks
    }
  ]
}`
}

# OUTPUT FORMAT

Return ONLY valid JSON with this exact structure:
{
  "romanized_lyrics": [
    // ... array of romanized line objects matching input structure exactly
  ]
}

# VALIDATION CHECKLIST (Internal - verify before responding)

Before generating output, verify:
- [ ] Same number of lines as input
- [ ] Same number of words per line as input
- [ ] Exact whitespace preservation (leading/trailing spaces)
- [ ] Chunk arrays present ONLY if input had them
- [ ] No translation, only romanization
- [ ] Applied language-specific phonetic rules
- [ ] Natural connected speech representation
- [ ] Valid JSON structure

# INPUT DATA TO ROMANIZE
${JSON.stringify(lyricsForApi, null, 2)}

# BEGIN ROMANIZATION
Analyze the language(s) in the input, apply appropriate phonetic rules, preserve exact structure, and return valid JSON.`;

    return basePrompt;
}

export function createTranslationPrompt(settings = {overrideGeminiPrompt: false, customGeminiPrompt: ''}, texts, targetLang) {
  const translationRules = (settings.overrideGeminiPrompt && settings.customGeminiPrompt) ?
        settings.customGeminiPrompt :
        `You are a professional translator specializing in song lyrics. Your task is to translate lyrics into ${targetLang} with precision and consistency.

CRITICAL INSTRUCTIONS:
1. LANGUAGE DETECTION:
   - Analyze each line to identify its source language(s)
   - Mark mixed-language segments internally before translating

2. TRANSLATION REQUIREMENTS:
   - Translate ALL non-${targetLang} text into ${targetLang}
   - Do NOT romanize or transliterate - always translate the meaning
   - If a line is 100% already in ${targetLang}, output it unchanged
   - For mixed-language lines: translate foreign parts, keep ${targetLang} parts intact

3. OUTPUT QUALITY STANDARDS:
   - Maintain natural ${targetLang} grammar and word order
   - Preserve the original emotional tone and meaning
   - Ensure each line flows naturally when read aloud
   - Use contemporary, conversational ${targetLang}
   - Avoid awkward literal translations

5. CONSISTENCY RULES:
   - Use consistent terminology throughout all lines
   - Maintain consistent pronouns and perspective
   - Keep proper nouns consistent unless culturally adapted

INPUT DATA:
${JSON.stringify(texts, null, 2)}

OUTPUT REQUIREMENT:
Respond with ONLY the JSON array of ${texts.length} translated strings, no other text.`;

    const prompt = translationRules;
    return prompt;
}