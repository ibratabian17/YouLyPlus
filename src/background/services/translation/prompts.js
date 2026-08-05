// Unicode script ranges used to detect which language(s) are actually present
// in the lyrics being romanized, so we only send the relevant ruleset(s) to the model.
const SCRIPT_RANGES = {
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
  japanese: /[\u3040-\u309F\u30A0-\u30FF]/, // hiragana + katakana (kanji alone is ambiguous with Chinese, handled below)
  korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  chinese: /[\u4E00-\u9FFF]/, // CJK unified ideographs
  thai: /[\u0E00-\u0E7F]/,
  hindi: /[\u0900-\u097F]/, // Devanagari
  tamil: /[\u0B80-\u0BFF]/,
  telugu: /[\u0C00-\u0C7F]/,
  russian: /[\u0400-\u04FF]/, // Cyrillic
  hebrew: /[\u0590-\u05FF]/,
  greek: /[\u0370-\u03FF]/,
  punjabi: /[\u0A00-\u0A7F]/, // Gurmukhi
};

const RULESETS = {
  arabic: `## ARABIC (العربية) [CONTEXT & TARGET LANGUAGE ADAPTATION]

### 1. Identify the Cultural Context (CRITICAL)
Before romanizing, look at the artist and target language, AND check whether the source Arabic text carries full harakat/diacritics (fathah, dammah, kasrah, sukun marks like َ ُ ِ ْ ّ) throughout — this is the key signal separating Scenario A (casual undiacritized sholawat pop) from Scenario A2 (fully-vocalized nasheed/Tajwid-style). Also check the artist's specific country/dialect (Egyptian vs. Levantine vs. Gulf) — dialects sound similar in having glottal-stop Qaf, but differ meaningfully in vocabulary, Jeem pronunciation, and suffix vowels, so do not assume all colloquial Arab pop is Egyptian; a Jordanian/Palestinian/Lebanese/Syrian artist calls for Scenario B2, not B. Adapt your spelling rules accordingly:

**SCENARIO A: Indonesian/Malay Islamic Songs (Sholawat/Nasheed) OR targetLang = "id-ID"**
(e.g., Haddad Alwi, Sabyan, Maher Zain)
- **Vowel Shift (Fathah -> o)**: The 'a' sound often becomes 'o' near emphatic consonants (ص, ض, ط, ظ, ق, خ, غ) or the word 'Rabbi'.
  * مصطفى -> Mustofa (NOT Mustafa)
  * رب / يارب -> robbi / yaa robbi
  * مقاصدنا -> maqooshidanaa
- **Specific Consonants**:
  * ش (Shin) -> **sy** (e.g., الشأن -> assyani, شئ -> syai)
  * ث (Tha) -> **ts** (e.g., الثقلين -> tsatsaqolayn)
  * ذ (Dhal) -> **dz** (e.g., ذكر -> dzikir)
  * ض (Dad) -> **dh** (e.g., مضى -> madho / maamadhoyaa)
  * ج (Jeem) -> **j** (e.g., الدرج -> daroji)
  * ق (Qaf) -> **q**
- **Word Merging/Liaisons**: Often merged into one word to reflect sung flow (e.g., "واسع الكرم" -> waasi'al karomi, "رافع الشأن" -> rofi'assyani). Add suffix vowels if sung (e.g., alaik -> alaika/alaikum depending on audio/context).

**SCENARIO A2: Fully-Vocalized Nasheed / Quranic-Recitation Style (Tajwid Convention)**
(Signal: the source Arabic text itself carries full harakat/diacritics — فَتْحَة، ضَمَّة، كَسْرَة، سُكُون — as in classical nasheed, anthem-style Islamic songs, or Quran-adjacent recitation, as opposed to Scenario A's typically undiacritized casual sholawat pop lyrics. This is a DISTINCT convention from Scenario A even though both target id-ID audiences.)
- This scenario follows classical Tajwid-style connected recitation rules for "ال" (al-) far more strictly than Scenario A's looser pop liaison:
  * **Sun letters** (ت ث د ذ ر ز س ش ص ض ط ظ ل ن) after "ال" preceded by another word in the same breath -> FULL assimilation: the "al" vanishes entirely, the sun letter's consonant doubles, and it attaches directly to the end of the preceding word with no visible "al" at all:
    - "فِي الضَّلَامِ" (fi + adh-dhalaam) -> **fidh dhalaami** (NOT "fi al-dhalaam" or "fi dh-dhalaam" as a separate word)
    - "أَشْرَقَتِ الشَّمْسُ" (asyraqati + ash-shams) -> **Asyraqatish syamsu**
    - "فالشَّكْرُ" (fa + ash-shukru) -> **Fasy-syukru**
  * **Moon letters** (ا ب ج ح خ ع غ ف ق ك م ه و ي) after "ال" preceded by another word -> the "al" is RETAINED but its vowel elides and it attaches to the END of the preceding word (not the start of the following word) as one continuous unit:
    - "عَلَى الغُصُوْنِ" ('ala + al-ghusun) -> **'Alal ghushuuni** (the "al" moves onto the end of "'ala", becoming "'Alal", then "ghushuuni" starts clean)
    - "فِيْهِ الْأُمُوْرُ" (fiihi + al-umuur) -> **Fiihil umuuru**
    - "لِلَّهِ الْأَحَدِ" (lillaahi + al-ahad) -> **lillaahil ahadi**
    - "شُكْرًا لَهُ عَلَى الدَّوَامِ" (... 'ala + ad-dawaam, a SUN letter here) -> **... 'alad dawaami** (note: dal د is a sun letter, so this follows the sun-letter full-assimilation pattern instead, landing as "'alad" not "'alal")
  * **Key distinguishing signal for which sub-rule applies**: check the letter immediately after "ال" against the sun/moon list above — sun letter -> letter doubles and "al" disappears entirely; moon letter -> "al" survives but relocates onto the end of the previous word.
  * This liaison is essentially universal in this scenario whenever "ال" follows another word within the same breath/phrase — treat it as the default behavior for this scenario, not an occasional stylistic choice.
  * **These examples show the sung phrase as a whole for clarity, but each is still exactly two separate word slots in the input/output JSON** — never merge them into a single word object. See Rule 2 in the structural rules section below for exactly how to split the fused sound across the two existing slots (e.g., "فِي" stays its own word slot spelled "fidh ", and "الضَّلَامِ" stays its own word slot spelled "dhalaami" — never combine into one "fidh dhalaami" word object).
- **Standard Scenario-A consonant mappings still apply on top of this** (ش -> sy, ث -> ts, ذ -> dz, ض -> dh, ج -> j, ق -> q) — this scenario only changes the cross-word liaison behavior, not the base consonant romanization system.
- **Hamzat al-wasl / connecting hamza** (اَلْ at the start of a breath-group after a pause) keeps a visible "al-"/"a-" since there is no preceding word to attach to in that position — only elide/relocate when a preceding word in the same breath actually precedes it.

**SCENARIO B: Egyptian/Arab Pop (Apple Music Convention)** 
(e.g., Sherine, Amr Diab, Abu — matches the convention used in official Apple Music romanized lyrics)
- **Jeem (ج)** -> **g** (e.g., "جماله" -> gamaloh, "يجن" -> yegann).
- **Qaf (ق)** -> **'** (apostrophe/glottal stop) (e.g., "قلبي" -> albi, "ببقى" -> bab'a, "قليل" -> aleel, "طمع" -> teme').
- **Pronoun suffix (ـه)** -> **oh** (e.g., "حسنه" -> hosnoh, "جماله" -> gamaloh, "غرامه" -> gharamoh).
- **Ayn (ع) & Hamza**:
  * Word-initial -> often omitted/unmarked (e.g., "عيني" -> eineih).
  * Mid-word or word-final -> apostrophe (e.g., "يعني" -> ya'ni, "معاه" -> ma'ah, "طمع" -> teme').
  * When Ayn attaches to a following word for emphasis (as in "القمر" following "اللي") it can appear as a leading apostrophe on that word: "القمر" -> 'amar (e.g., in "اللي القمر" -> "illi el-'amar").
- **Preposition/particle vowels are picked by natural stress, not a fixed rule** — "في" can render as **fe** or **fi** depending on which sounds more natural in that specific line's stress pattern (e.g., "في الغرام" -> fe el-gharam, but "وفي جماله" -> we fi gamaloh); "من" consistently renders as **men** (not "min").
- **Word-final ي**: renders as **-i** in most words (e.g., "عيوني" -> oyooni, "سنيني" -> senini) but as **-ee** when the vowel is long/stressed at the end of a short word (e.g., "ليلي" -> Leeli, "ليل" -> leel) — judge by the natural sung vowel length, matching how Apple Music's own lyric romanization handles these.
- **Ha (ح) preposition "بـ" (with/in)** -> "ben-" or "bi-" depending on context (e.g., "بالنهار" -> ben-nahar).

**SCENARIO B2: Levantine Arab Pop (Jordanian/Palestinian/Lebanese/Syrian — Apple Music Convention)**
(e.g., Issam Alnajjar, Nancy Ajram-adjacent Levantine tracks — distinct dialect and vocabulary from Egyptian Scenario B; check artist nationality/dialect vocabulary, not just script, to pick this over Scenario B)
- **Qaf (ق)** -> **'** (apostrophe/glottal stop), same principle as Egyptian but applied within Levantine vocabulary (e.g., "قدّك" -> 'addik, "قلبي" -> 'albi, "قصة" -> 'essa, "يدق" -> yedo'', "بينقاس" -> byen'as).
- **Jeem (ج)** -> **j** (kept as "j" in Levantine, UNLIKE Egyptian's "g" — e.g., "جنبك" -> janbik, "جوّا" -> Juwwa) — this is a key dialect distinguisher from Scenario B.
- **Gemination/shadda (ّ) is preserved as a doubled consonant** in the romanization, more consistently than in casual Egyptian pop: "أحبّك" -> ahebbik, "ردّك" -> raddik, "ضدّك" -> diddik, "حبّك" -> hobbik/hebbik, "زيّك" -> zayyik.
- **Ta marbuta (ة) at word end** -> **-eh** (not Egyptian's "-ah"): "تعبانة" -> ta'baneh, "المخدّة" -> mkhaddeh.
- **Possessive/object suffix "ـك" (your, masc.)** -> **-ik** (not Egyptian's "-ak/-ok"): "قلبك" -> 'albik/'albik, "جنبك" -> janbik, "حبّك" -> hobbik.
- **"على" (on/onto) + "ال" contraction "عالـ"** -> renders as **'al-** or **al-** attached directly to the noun as one prefix (e.g., "عالمخدّة" -> 'al-mkhaddeh or al-mkhaddeh) — treat the leading apostrophe as optional/context-dependent (present when the line emphasizes the 'ayn sound, absent in faster casual delivery); both are attested in official romanization for the same word across different lines of the same song, so either is acceptable but should be applied consistently within a single repeated phrase where possible.
- **Definite article "الـ" elsewhere** still follows sun/moon assimilation with a hyphen, same mechanism as Scenario B (e.g., "الناس" -> en-nas [sun letter], "الأساس" -> el-asas [moon letter/hamza]).
- **Distinctive Levantine vocabulary/particles to romanize as heard, not as Fusha would spell them**: "هسه"/"هلق" (now) -> hassa, "شو" (what) -> shu, "هون" (here) -> hon, "معاه"/"هو" -> huwwe, "بكيف" -> bkeef, "محدا" (no one) -> Ma hada, "دايماً" -> dayman.
- **"و" (and) as a clitic prefix** -> "we" (e.g., "وأنا" -> We ana, "ولو" -> We law) — matches the general Levantine/Egyptian convention of "we" for the conjunction, not "wa".

**SCENARIO C: Modern Standard Arabic (Fusha)**
- **Jeem (ج)** -> **j**
- **Qaf (ق)** -> **q**
- Strict academic/standard transliteration.

### 2. Definite Article "ال" — Within-Word Assimilation
- **Sun Letters** (ت ث د ذ ر ز س ش ص ض ط ظ ل ن): Assimilate the 'l' (e.g., "الشمس" -> ash-shams / esh-shams / assyamsu depending on context).
- **Moon Letters** (ا ب ج ح خ ع غ ف ق ك م ه و ي): Keep the 'l' (e.g., "القمر" -> al-qamar).
- **Format**: Use a hyphen (e.g., \`el-bahr\`, \`ash-shan\`) UNLESS it's an Indonesian style where they commonly merge them (e.g., \`bil-Mustofa\`, \`waasi'al\`).

### 3. Cross-Word Behavior with "ال" — Convention Depends on Scenario (IMPORTANT: do not default to full fusion)
The correct handling of "ال" after a preceding word (preposition, particle, etc.) DIFFERS by scenario/convention — pick the one matching the artist/style/diacritization level, do not assume one universal rule:
- **Egyptian/Arab Pop (Apple Music convention, Scenario B — the common case for mainstream pop)**: Keep "el-" as its own hyphenated unit attached to the noun, WITHOUT collapsing the preceding word into it. The preceding word keeps its own natural vowel ending:
  * "في الغرام" -> **fe el-gharam** (NOT "filgharam" or "fil-gharam")
  * "من الأغاني" -> **men el-aghani** (NOT "menalaghani")
  * "طمع في سحر الحياة" -> **teme' fi sehr el-hayah**
  * "دي الابتسامة" -> **di el-ebtesamah**
  * This is the DEFAULT for mainstream Arab pop lyrics — "el-" reads as a clearly visible, hyphen-attached prefix on its noun, and the word before it is NOT phonetically merged into it.
- **Indonesian/Malay Islamic Songs, casual sholawat pop (Scenario A)**: Full liaison/fusion IS common, per the Word Merging/Liaisons rule under Scenario A above (e.g., "واسع الكرم" -> waasi'al karomi).
- **Fully-vocalized nasheed / Tajwid-style (Scenario A2)**: Follow the STRICT sun/moon-letter-dependent liaison rules detailed under Scenario A2 above (full assimilation for sun letters, "al" relocating onto the previous word for moon letters) — this is more rigorous and rule-governed than Scenario A's looser pop liaison, and is the correct choice whenever the source text is fully diacritized.
- **When uncertain which convention applies**: default to the Egyptian/Pop convention (keep "el-"/"al-" as a distinct hyphenated unit) for undiacritized text with no other genre signal, since it is the more broadly recognizable pattern; but if the source text is fully diacritized with harakat throughout, that is a strong, reliable signal to use Scenario A2's Tajwid-style liaison instead.`,

  japanese: `## JAPANESE (日本語)
### Kana to Romaji (Modified Hepburn)
- し = shi (en-US) / si (id-ID). 
- Particles: は = wa, へ = e, を = wo/o.
- Long vowels: ou, ei, aa, ii, uu.
- Small tsu (っ): Double the next consonant (e.g., がっこう = gakkou).
- N-sound (ん): 'n', or 'n'' before vowels/y.`,

  korean: `## KOREAN (한국어)
### Revised Romanization Rules
- ㄱ=g/k, ㄷ=d/t, ㅂ=b/p, ㄹ=r/l. 
- Apply phonological changes: Liaison (한국어 -> hangugeo), Nasalization (국민 -> gungmin), Palatalization (같이 -> gachi).`,

  chinese: `## CHINESE (中文)
### Pinyin Romanization
- Follow natural word boundaries (e.g., "我爱你" -> "wǒ ài nǐ" or "wo ai ni").`,

  thai: `## THAI (ภาษาไทย) — Tonal Romanization
- Thai script has no spaces between words within a phrase. If the input JSON already segments text into word objects, respect that segmentation for slot purposes even if native word boundaries would differ — represent pronunciation within each given slot, never merge/split slots to "fix" segmentation (see the structural Rule 2 below, which is a hard requirement).
- **Vowel length is phonemic** — always distinguish short vs. long vowels (e.g., ขาว [khaao, long] vs ขัว [khua, short]); collapsing them is a meaning-changing error. Use doubled vowels for length (aa, ii, uu, ee, oo), matching common karaoke-style Thai lyric romanization.
- **Final stops (ก ด บ) are unreleased** in natural speech — render as plain k/t/p endings without aspiration (e.g., นก -> nok, not nog).
- **Aspirated vs. unaspirated stop pairs must stay distinct**: ก (k, unaspirated) vs ข/ค (kh, aspirated), ต (t) vs ท (th), ป (p) vs พ/ผ (ph) — do not collapse these to a single letter.
- **ร**: rolled/tapped 'r' in formal/classical registers (เพลงไทยเดิม), frequently reduced toward 'l' or dropped in casual Bangkok pop singing — follow the casual convention for mainstream pop, the formal one for traditional genres.
- **Tone is not marked with diacritics** in standard lyric-site romanization — represent tone indirectly through correct vowel length and consonant class rather than adding tone numbers/marks, unless the target explicitly requests IPA-style tone marking.`,

  hindi: `## HINDI / DEVANAGARI (हिन्दी) — Bollywood & Bhajan Conventions
(This ruleset also governs closely related Indic scripts using the same underlying phonological principles — Tamil, Telugu, and other Indic scripts substitute their own phoneme inventory but follow the same governing philosophy below.)
- **Schwa deletion (MANDATORY — the single most common error to avoid)**: the default inherent vowel अ is frequently SILENT word-finally and in many medial positions in natural spoken/sung Hindi. Do not romanize every inherent vowel literally.
  * नमस्ते -> namaste (NOT namasate)
  * कमल -> kamal (NOT kamala)
  * Apply schwa-deletion by default: the final inherent vowel of a word is almost always dropped unless required for pronounceability, or the term is Sanskrit-derived and appears in a formal/liturgical bhajan/shloka context where a fuller vowel may be retained.
- **Nasalization**: ं (anusvara) and ँ (chandrabindu) -> render as n/m before consonants matching place of articulation (पंकज -> pankaj, संभव -> sambhav) — default to plain n/m rather than a nasalized-vowel marker unless explicitly requested.
- **Retroflex vs. dental**: ट/ठ/ड/ढ/ण (retroflex) vs त/थ/द/ध/न (dental) both typically collapse to the same plain t/th/d/dh/n in casual Bollywood-style romanization — use this collapsed form by default; only distinguish them (e.g., with capitals or diacritics) if the target explicitly requests academic/scholarly transliteration.
- **Conjuncts (संयुक्ताक्षर)**: render the full consonant cluster phonetically as pronounced, not each letter in isolation (विद्या -> vidya, NOT vidiya).
- **Long vs. short vowels**: आ/ा = aa, ई/ी = ee/ii, ऊ/ू = oo/uu — preserve the length distinction; collapsing to short forms changes meaning and is incorrect.
- **Register check**: devotional/bhajan lyrics tend to retain more Sanskritized inherent vowels and visarga (ः -> h) than casual Bollywood pop, which elides more aggressively — check genre/artist context to pick the right end of this spectrum, similar in spirit to the Arabic Scenario A vs. A2 distinction above.`,

  tamil: `## TAMIL (தமிழ்) — Devotional & Film-Song Romanization
- Follows the same governing philosophy as Hindi/Devanagari above (schwa-pattern vowel handling, vowel-length preservation, phonetic-not-literal consonant clusters), but Tamil's own phoneme inventory differs:
- **No native aspirated/unaspirated contrast**: a single letter like த can represent t, d, or th depending on its position in the word — resolve by position and surrounding sounds, not a fixed one-to-one letter mapping (e.g., intervocalic த often softens toward "d").
- **Long vs. short vowels are phonemic** — ா, ீ, ூ mark long vowels; preserve as aa, ii, uu rather than collapsing to short forms.
- **Retroflex consonants** (ட, ண, ள, ழ) are phonemically distinct from dental/alveolar counterparts in careful/classical singing, but casual film-song romanization commonly collapses ட/த toward "t/d" and ண/ந toward "n" — default to the casual collapsed form for mainstream film/pop lyrics, the fuller distinction for classical/devotional (Carnatic, temple) contexts.
- ழ (a retroflex approximant unique to Tamil/Malayalam) has no standard Latin letter — render as "zh" (the common lyric-site convention, e.g., "தமிழ்" -> Tamizh).`,

  telugu: `## TELUGU (తెలుగు) — Devotional & Film-Song Romanization
- Follows the same governing philosophy as Hindi/Devanagari above.
- **Retains more Sanskritic retroflex/aspirate distinctions than Tamil**, especially in devotional (భక్తి) contexts — keep aspirated consonants distinct (ఖ kh, ఘ gh, ఛ chh, ఝ jh, etc.) rather than collapsing them, particularly for devotional genres; mainstream film-song pop may simplify these somewhat, so check genre.
- **Long vs. short vowels are phonemic** — ా, ీ, ూ mark long vowels; preserve as aa, ii, uu.
- **Word-final short "u"** is frequently reduced/near-silent in natural fast speech (colloquial film-song delivery) but is usually still written out in casual romanization for readability — include it unless the sung cadence very clearly drops it entirely.`,

  russian: `## RUSSIAN / CYRILLIC (Русский) — Pop & Contemporary Romanization
- Use the practical, fan/lyric-site romanization convention seen on karaoke and lyric platforms, NOT the formal ISO 9 / scholarly transliteration standard, unless the target explicitly requests academic style.
- **Vowel reduction (akanye/ikanye)**: unstressed о sounds close to [a] in standard/Muscovite speech. Represent the actual sung sound where the shift is clearly audible, but default to the more legible orthographic-leaning spelling that fan-lyric conventions actually use, rather than a hyper-precise phonetic transcription that would look unfamiliar to readers.
- **Palatalization**: ь (soft sign) softens the preceding consonant. In casual fan-lyric romanization this is often simplified/dropped (e.g., мать often appears simply as "mat" rather than "mat'") — default to the simplified convention unless a formal target is specified.
- **Key letter mapping**: ж -> zh, х -> kh, ц -> ts, ч -> ch, ш -> sh, щ -> shch, ю -> yu, я -> ya, е -> ye (word-initial or after a vowel) / e (after a consonant), ё -> yo, й -> y.
- **Word-final devoicing**: voiced obstruents devoice in natural speech (город sounds closer to "gorot"), but common fan-lyric convention still writes the orthographic form ("gorod") rather than the devoiced phonetic form — follow that convention for singable, recognizable lyrics.`,

  hebrew: `## HEBREW (עברית) — Modern Israeli Pop vs. Liturgical
### Classify register first: Modern Israeli pop/rock vs. liturgical/piyyut/traditional Mizrahi — weigh artist and song context, then apply consistently.
**Modern Israeli Pop** (e.g., Omer Adam, Eyal Golan, Static & Ben El):
- ח and כ (as fricative) -> both commonly romanized as **kh** (or consistently as **ch**) — Modern Israeli Hebrew has merged their pronunciation for most speakers, so pick one mapping and apply it consistently.
- ע (Ayin) -> generally silent/unmarked in Modern Israeli pronunciation for most speakers — do not render as an apostrophe or "3" unless the artist is clearly singing in a Mizrahi/traditional style.
- ר -> uvular/guttural in Israeli Hebrew, still simply romanized as "r".
- Vowels are rendered close to their full written value (a, e, i, o, u) — Modern Hebrew has much less vowel reduction than Arabic.
- The definite article ה (ha-) prefix and construct-state (סמיכות) forms stay attached to their word as pronounced; hyphenate only if the target convention calls for it.
**Liturgical / Piyyut / Traditional Mizrahi**:
- ע (Ayin) -> often realized as a pharyngeal/guttural sound in Mizrahi and traditional cantorial pronunciation — represent with an apostrophe (e.g., ערב -> 'erev) when this register is clearly signaled by genre/artist.
- ח -> pharyngeal fricative, kept phonetically distinct from כ (rather than merged as in Modern Israeli pop) when the artist/genre signals traditional Mizrahi or Yemenite pronunciation.
- Traditional Sephardic/Mizrahi liturgical singing often preserves fuller vowel quality and gemination (דגש חזק) — reflect doubled consonants where the melody/chant clearly holds them.`,

  greek: `## GREEK (Ελληνικά) — Contemporary Romanization
- Follow common Greek pop/lyric-site romanization, not strict ELOT 743 formal transliteration, unless the target explicitly requests formal/academic style.
- **Digraphs and diphthongs must be romanized by their actual pronunciation, never letter-by-letter** — this is the most common source of error:
  * μπ -> b (word-initial) or mb (medial): μπαμπάς -> babas
  * ντ -> d (word-initial) or nd (medial): ντροπή -> dropi
  * γκ/γγ -> g or ng depending on position
  * αυ -> af (before a voiceless consonant) / av (before a voiced consonant or vowel)
  * ευ -> ef (before a voiceless consonant) / ev (before a voiced consonant or vowel)
  * θ -> th, δ -> dh (voiced, distinct from θ), χ -> ch/kh, ψ -> ps, ξ -> ks
- **Stress placement matters for correct vowel realization**: Modern Greek is stress-timed. If the input marks an accented vowel (ά έ ή ί ό ύ ώ), let that inform which syllable's vowel quality you render most carefully, even though the final Latin output itself doesn't carry an accent mark.`,

  punjabi: `## PUNJABI / GURMUKHI (ਪੰਜਾਬੀ) — Bhangra/Pop Romanization
- **Tone (often missed, but important)**: Punjabi is tonal despite using an alphabetic script. Historically voiced-aspirated consonants (ਘ, ਝ, ਢ, ਧ, ਭ) now function as tone triggers on the following vowel in most modern speech rather than being pronounced as true aspirated stops. Common fan/lyric-site romanization still WRITES the historical letter form (e.g., ਘਰ commonly appears as "ghar") even though the "gh" no longer represents true aspiration for most speakers — follow this established written convention rather than inventing an unfamiliar tone-accurate spelling.
- **Retroflex consonants** (ਟ ਠ ਡ ਢ ਣ) commonly collapse to t/th/d/dh/n in casual romanization, matching the same collapsed convention used for Hindi above, unless a formal target is specified.
- **Nasalization** (tippi ੰ, bindi ਁ) -> n/m before consonants matching place of articulation, same approach as Hindi anusvara.
- **Long vs. short vowels** (ਾ, ੀ, ੂ) must be preserved distinctly as aa/ee/oo — do not collapse to short forms, since length is phonemic here as in Hindi.`,
};

function detectScripts(lyricsForApi) {
  const text = JSON.stringify(lyricsForApi);
  const found = new Set();

  for (const [key, pattern] of Object.entries(SCRIPT_RANGES)) {
    if (pattern.test(text)) {
      found.add(key);
    }
  }

  if (found.size === 0) {
    return Object.keys(RULESETS);
  }

  return Array.from(found);
}

export function createRomanizationPrompt(lyricsForApi, hasAnyChunks, songInfo = {}, targetLang) {
  const songContext = (songInfo.title && songInfo.artist)
    ? `\n# SONG CONTEXT\n- Title: ${songInfo.title}\n- Artist: ${songInfo.artist}\n`
    : '';

  const relevantScripts = detectScripts(lyricsForApi);
  const languageRules = relevantScripts
    .map((key) => RULESETS[key])
    .filter(Boolean)
    .join('\n\n');

  const basePrompt = `You are a professional linguistic transcription system specialized in PHONETIC ROMANIZATION.
${songContext}
# ABSOLUTE MISSION
Transform non-Latin scripts into Latin alphabet representation of **actual pronunciation in natural speech context**.

This is NOT translation. This is NOT dictionary transliteration. This is PHONETIC TRANSCRIPTION of how words sound when spoken/sung naturally.

# FUNDAMENTAL PRINCIPLES

## PRINCIPLE 1: PHONETIC FIDELITY OVER ORTHOGRAPHIC LITERALISM
Romanize based on SOUND, not spelling:
- Represent actual pronunciation in connected speech.
- Apply phonological rules (assimilation, liaison, reduction).
- Preserve natural rhythm and flow of the language.

## PRINCIPLE 2: EXACT STRUCTURAL PRESERVATION
Input and output must have IDENTICAL structure:
- Same number of lines
- Same number of words per line  
- Same whitespace (leading/trailing spaces in each word)
- Same chunk structure (if present)
- **This is a hard technical requirement, not a style preference**: the output is consumed by a parser that maps each output word to its input word slot 1:1. Even when a language's liaison/assimilation rules make two words sound fused in natural speech, you must still output them as two separate word objects — spell the fused sound across the edges of the two existing slots rather than merging them into one. Merging or splitting word objects will corrupt the parser's mapping. See Rule 2 later in this prompt for worked examples.

## PRINCIPLE 3: NO SEMANTIC PROCESSING
You are a transcription machine, not a translator:
- Do NOT translate meaning.
- Output ONLY romanized text in exact structure.

## PRINCIPLE 4: ADAPT TO REGIONAL/CULTURAL TARGET STYLES
Romanization must follow the conventional spelling style used by native speakers of the TARGET LANGUAGE (${targetLang}) and the ARTIST'S CULTURAL CONTEXT.

# LANGUAGE-SPECIFIC ROMANIZATION RULES

${languageRules}

# CRITICAL WHITESPACE & STRUCTURE RULES

## Rule 1: Whitespace Preservation (CRITICAL)
**Each word in output MUST preserve exact whitespace from input:**
- If input word = "word " (trailing space) -> output = "romanized "
- If input word = " word" (leading space) -> output = " romanized"
- If input word = " word " (both) -> output = " romanized "

## Rule 2: Word Count Preservation (ZERO TOLERANCE — breaking this breaks the parser)
**Number of words in output MUST equal number in input, EXACTLY, with no exceptions for any language or liaison rule.**
This is a hard technical constraint, not a stylistic preference: the output JSON is consumed by a parser that maps each output word back to its corresponding input word slot (and its timing/chunk data). Merging two words into one output word, or splitting one word into two, WILL break that mapping and corrupt playback/sync — regardless of how naturally the sounds blend in speech.
- Do NOT merge or split words across JSON objects, even when phonetically they fuse in speech (e.g., Indonesian-style Arabic devotional chant liaison, Scenario A/A2 sun-letter or moon-letter assimilation, Egyptian pop cross-word behavior).
- Instead, represent all liaison/assimilation/fusion PURELY as a spelling change at the edge of each existing word slot — the word count and word order never change, only how each individual slot is spelled.
- **Concrete distribution examples**:
  * Scenario A liaison: word 1 "واسع" -> "waasi'al ", word 2 "الكرم" -> "karomi" (the "al" sound moved to the end of word 1's spelling; word 2 lost its own "al" from its spelling — still exactly 2 words, 2 slots).
  * Scenario A2 sun-letter liaison: word 1 "في" -> "fidh ", word 2 "الضلام" -> "dhalaami" (again exactly 2 words/slots — the fused "dh" sound is spelled at the edge of word 1, word 2 starts clean with its own doubled consonant).
  * Scenario A2 moon-letter liaison: word 1 "على" -> "'Alal ", word 2 "الغصون" -> "ghushuuni" (still 2 words/slots — "al" relocated into word 1's spelling, word 2 starts clean).
  * Scenario B (Egyptian pop): word 1 "في" -> "fe ", word 2 "الغرام" -> "el-gharam" (still 2 words/slots — no liaison needed here since this scenario keeps "el-" attached to its own word normally).
- If you are ever unsure how to split the fused sound between two word slots, err toward keeping each slot's romanization plausible-looking and pronounceable on its own, rather than dropping all the sound into one slot and leaving the other empty or duplicated.
- NEVER output an empty string for a word slot, and NEVER output two Latin words crammed into one slot separated by a space when the input had two separate word objects — each output "word" field corresponds 1:1 to exactly one input "word" field.

## Rule 3: Line Count Preservation
Number of lines in output MUST equal number in input.

## Rule 4: Chunk Structure Preservation
${hasAnyChunks ?
      `**SOME lines have chunks (syllable timing data), SOME do not:**
- For lines WITH "chunk" array in input: Output MUST include "chunk" array with romanized syllables.
- For lines WITHOUT "chunk" array in input: Output MUST NOT include "chunk" array.
- Each chunk must preserve its timing and whitespace exactly.` :
      `**These lyrics are LINE-SYNCED ONLY (no syllable-level timing):**
- NEVER add "chunk" arrays to any word.
- Only provide romanized "line" and "word" fields.`
    }

# OUTPUT FORMAT

Return ONLY valid JSON with this exact structure:
{
  "romanized_lyrics": [
    // ... array of romanized line objects matching input structure exactly
  ]
}

# VALIDATION CHECKLIST
- [ ] Checked song context (Indonesian Sholawat vs. Egyptian Pop vs. other)?
- [ ] Vowels and consonants adapted to target dialect/region?
- [ ] Exact number of lines and words per line?
- [ ] Whitespace preserved perfectly?
- [ ] Valid JSON?

# INPUT DATA TO ROMANIZE
${JSON.stringify(lyricsForApi, null, 2)}

# BEGIN ROMANIZATION
Analyze the language(s) in the input, apply appropriate phonetic rules (considering dialect and regional styles), preserve exact structure, and return valid JSON.`;

  return basePrompt;
}

export function createTranslationPrompt(settings = { overrideGeminiPrompt: false, customGeminiPrompt: '' }, texts, targetLang, songInfo = {}) {
  // 1. Build Context & Metadata
  const songContext = (songInfo.title && songInfo.artist)
    ? `Song Metadata: Title="${songInfo.title}", Artist="${songInfo.artist}"`
    : 'Song Metadata: None';

  const sourceLangHint = songInfo.source_languages
    ? `Source Languages Present: ${songInfo.source_languages.join(', ')}`
    : 'Source Languages: Mixed/Unknown';

  if (settings.overrideGeminiPrompt && settings.customGeminiPrompt) {
    return songContext + '\n' + settings.customGeminiPrompt;
  }

  return `### ROLE
You are an expert, highly precise song lyrics translator. Your task is to translate the provided JSON array of lines into ${targetLang}.

### CONTEXT
${songContext}
${sourceLangHint}

### STRICT RULES (Read Carefully)
1. **Target Language Enforcement:**
   - The FINAL output must be 100% intelligible in ${targetLang}.
   - **CRITICAL:** Translate ALL text that is not ${targetLang}, regardless of script! This includes foreign non-Latin scripts (Cyrillic, Kanji, Hangul, Arabic, etc.) AND Latin-script regional languages or dialects (e.g. Javanese, Sundanese, Malay, Tagalog, Spanish, etc.).
   - EVEN IF the source text uses the Latin alphabet (e.g. Javanese "Apa kowe ra ngerti larane"), if it is not in standard ${targetLang}, you MUST translate it into ${targetLang} (e.g., to Indonesian "id-ID": "Apakah kamu tidak tahu sakitnya").

2. **The "Identity" Logic:**
   - ONLY keep a line UNCHANGED if the line is *already* standard ${targetLang}.
   - Regional languages, dialects, or related tongues (such as Javanese to Indonesian) are DIFFERENT languages and MUST be translated to standard ${targetLang}.

3. **DIRECTNESS & ANTI-HALLUCINATION (CRITICAL FOR ACCURACY):**
   - Translate slang and idioms contextually (e.g., "Aku banyak yang mau" -> "Many people want me"), BUT DO NOT overcomplicate simple structures.
   - **DO NOT invent words or verbs that are not there.** If the source says "[Subject] is [Adjective]", translate it exactly as "[Subject] is [Adjective]". 
   - DO NOT add relational verbs like "you see me as", "you think I am", or "you treat me like" unless they explicitly exist in the original text.

4. **Formatting:**
   - Preserve repetition ("ma-ma", "la-la-la").
   - Preserve punctuation, casing, and parentheses exactly from the source.

### FEW-SHOT EXAMPLES

Input: ["(Screaming)", "Я сошла с ума"]
Target: English
Output: ["(Screaming)", "I've lost my mind"]
(Explanation: Parentheses kept. Cyrillic translated to English.)

Input: ["Apa kowe ra ngerti larane", "Nyatane atimu dudu nggo aku"]
Target: id-ID
Output: ["Apakah kamu tidak tahu sakitnya", "Kenyataannya hatimu bukan untukku"]
(Explanation: Javanese written in Latin script is translated to standard Indonesian id-ID.)

Input: ["Aku banyak yang mau", "Walau aku tampan, kau biasa saja"]
Target: English
Output: ["Many people want me", "Even though I'm handsome, you are just ordinary"]
(Explanation: Slang is translated properly. Direct Subject-Adjective structure is kept WITHOUT hallucinating extra verbs like "see me as" or "think I am".)

### TASK
Input Lyrics:
${JSON.stringify(texts, null, 2)}

IMPORTANT OUTPUT FORMAT:
Respond with ONLY a valid JSON object matching the exact structure below. Do not wrap it in Markdown code blocks (\`\`\`json). Just return the raw JSON string.
{
  "translated_lyrics": [
    "translated line 1",
    "translated line 2"
  ],
  "target_language": "${targetLang}",
  "source_language": ["detected source language(s)"]
}`;
}
