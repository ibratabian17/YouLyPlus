/**
 * Japanese Kana and Kanji Romanizer (Modified Hepburn).
 * Supports syllable-by-syllable processing for word-synced lyrics.
 */

const KANA_DIGRAPHS = {
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'ぢゃ': 'ja', 'ぢゅ': 'ju', 'ぢょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  'くゎ': 'kwa', 'ぐゎ': 'gwa',

  'キャ': 'kya', 'キュ': 'kyu', 'キョ': 'kyo',
  'シャ': 'sha', 'シュ': 'shu', 'ショ': 'sho',
  'チャ': 'cha', 'チュ': 'chu', 'チョ': 'cho',
  'ニャ': 'nya', 'ニュ': 'nyu', 'ニョ': 'nyo',
  'ヒャ': 'hya', 'ヒュ': 'hyu', 'ヒョ': 'hyo',
  'ミャ': 'mya', 'ミュ': 'myu', 'ミョ': 'myo',
  'リャ': 'rya', 'リュ': 'ryu', 'リョ': 'ryo',
  'ギャ': 'gya', 'ギュ': 'gyu', 'ギョ': 'gyo',
  'ジャ': 'ja', 'ジュ': 'ju', 'ジョ': 'jo',
  'ヂャ': 'ja', 'ヂュ': 'ju', 'ヂョ': 'jo',
  'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
  'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',
  'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo',
  'ティ': 'ti', 'ディ': 'di', 'トゥ': 'tu', 'ドゥ': 'du',
  'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo',
  'ヴァ': 'va', 'ヴィ': 'vi', 'ヴェ': 've', 'ヴォ': 'vo',
  'シェ': 'she', 'ジェ': 'je', 'チェ': 'che', 'ツァ': 'tsa'
};

const KANA_SINGLES = {
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'o', 'ん': 'n',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'де': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
  'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'ゎ': 'wa',

  'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
  'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
  'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
  'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
  'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
  'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
  'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
  'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
  'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
  'ワ': 'wa', 'ヰ': 'wi', 'ヱ': 'we', 'ヲ': 'o', 'ン': 'n',
  'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
  'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
  'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
  'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
  'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
  'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o',
  'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ヮ': 'wa', 'ヴ': 'vu'
};

const COMMON_KANJI = {
  '愛': 'ai', '私': 'watashi', '僕': 'boku', '君': 'kimi', '今': 'ima',
  '心': 'kokoro', '夢': 'yume', '涙': 'namida', '恋': 'koi', '夜': 'yoru',
  '空': 'sora', '声': 'koe', '手': 'te', '目': 'me', '時': 'toki',
  '歌': 'uta', '風': 'kaze', '日': 'hi', '人': 'hito', '誰': 'dare',
  '友': 'tomo', '道': 'michi', '生': 'i', '行': 'i', '見': 'mi',
  '言': 'i', '思': 'omo', '知': 'shi', '待': 'ma', '忘': 'wasure',
  '抱': 'daki', '笑': 'wara', '泣': 'naki', '離': 'hanare', '響': 'hibiki',
  '届': 'todoke', '咲': 'saki', '終': 'owari', '始': 'hajimari', '光': 'hikari',
  '影': 'kage', '星': 'hoshi', '月': 'tsuki', '太陽': 'taiyou', '海': 'umi',
  '雨': 'ame', '雪': 'yuki', '花': 'hana', '色': 'iro', '世界': 'sekai',
  '未来': 'mirai', '過去': 'kako', '記憶': 'kioku', '永遠': 'eien', '奇跡': 'kiseki',
  '希望': 'kibou', '明日': 'ashita', '今日': 'kyou', '昨日': 'kinou', '一緒': 'issho',
  '一人': 'hitori', '二度': 'nido', '信': 'shinji', '越': 'koe', '願': 'negai',
  '痛': 'itami', '強': 'tsuyo', '優': 'yasa', '悲': 'kanashi', '寂': 'sabishi',
  '嬉': 'ureshii', '温': 'atataka', '冷': 'tsumeta', '深': 'fuka', '遠': 'too',
  '近': 'chika', '高': 'taka', '暗': 'kura', '白': 'shiro', '黒': 'kuro',
  '赤': 'aka', '青': 'ao', '春': 'haru', '夏': 'natsu', '秋': 'aki',
  '冬': 'fuyu', '朝': 'asa', '夕': 'yuu', '音': 'oto', '言葉': 'kotoba',
  '物語': 'monogatari', '命': 'inochi', '胸': 'mune', '指': 'yubi', '瞳': 'hitomi',
  '歩': 'aruki', '走': 'hashiri', '飛': 'tobi', '落': 'ochi', '消': 'kie',
  '変': 'kawa', '続': 'tsuzuki', '止': 'tome', '生きて': 'ikite', '本当': 'hontou',
  '約束': 'yakusoku', '出逢': 'deai', '出会': 'deai', '別れ': 'wakare', '旅': 'tabi',
  '扉': 'tobira', '羽': 'hane', '翼': 'tsubasa', '空腹': 'kuufuku', '神': 'kami',
  '自由': 'jiyuu', '魔法': 'mahou', '秘密': 'himitsu', '答え': 'kotae', '理由': 'riyuu',
  '場所': 'basho', '時間': 'jikan', '瞬間': 'shunkan', '大切': 'taisetsu', '大丈夫': 'daijoubu',
  '絶対': 'zettai', '何': 'nani', '前': 'mae', '後': 'ato', '中': 'naka',
  '上': 'ue', '下': 'shita', '横': 'yoko', '側': 'soba', '傍': 'soba',
  '向': 'muka', '開': 'hira', '閉': 'toji', '描': 'egaki', '探': 'sagashi',
  '隠': 'kaku', '許': 'yuru', '伝': 'tsutae', '燃': 'moe', '奪': 'uba',
  '守': 'mamori', '壊': 'kowa', '救': 'suku', '繋': 'tsunagi', '結': 'musubi'
};

export class JapaneseRomanizer {
  /**
   * Romanizes Japanese Kana string (Hiragana, Katakana, digraphs, chōonpu, sokuon).
   * @param {string} text
   * @returns {string}
   */
  static romanizeKana(text) {
    if (!text) return '';
    let result = '';
    let i = 0;

    while (i < text.length) {
      const currentChar = text[i];
      if (currentChar === 'っ' || currentChar === 'ッ') {
        const nextChar = i + 1 < text.length ? text[i + 1] : '';
        const nextNext = i + 2 < text.length ? text.substring(i + 1, i + 3) : '';
        const nextRom = KANA_DIGRAPHS[nextNext] || KANA_SINGLES[nextChar] || '';
        if (nextRom) {
          const firstLetter = nextRom[0];
          // In Hepburn romanization: 'ch' geminates to 'tch'
          result += (firstLetter === 'c') ? 't' : firstLetter;
          i++;
          continue;
        } else {
          result += 'ッ';
          i++;
          continue;
        }
      }

      if (currentChar === 'ー') {
        const lastChar = result.length > 0 ? result[result.length - 1].toLowerCase() : '';
        if (['a', 'i', 'u', 'e', 'o'].includes(lastChar)) {
          result += lastChar;
        } else {
          result += '-';
        }
        i++;
        continue;
      }

      if (i + 1 < text.length) {
        const dig = text.substring(i, i + 2);
        if (KANA_DIGRAPHS[dig]) {
          result += KANA_DIGRAPHS[dig];
          i += 2;
          continue;
        }
      }

      if (KANA_SINGLES[currentChar]) {
        result += KANA_SINGLES[currentChar];
        i++;
        continue;
      }

      result += currentChar;
      i++;
    }

    return result;
  }

  /**
   * Romanizes a line of Japanese text using Kuromoji if available, or common kanji fallback.
   * @param {string} text
   * @param {Object|null} tokenizer
   * @returns {string}
   */
  static romanize(text, tokenizer = null) {
    if (!text) return '';

    if (/^[\u3040-\u309F\u30A0-\u30FF\s\p{P}]+$/u.test(text)) {
      return this.romanizeKana(text);
    }

    if (tokenizer) {
      try {
        const tokens = tokenizer.tokenize(text);

        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i];
          if (tok.surface_form === 'は' && tok.pos === '助詞') {
            tok.romazi = 'wa';
          } else if (tok.surface_form === 'へ' && tok.pos === '助詞') {
            tok.romazi = 'e';
          } else if (tok.surface_form === 'を' && tok.pos === '助詞') {
            tok.romazi = 'o';
          } else if (tok.reading) {
            tok.romazi = this.romanizeKana(tok.reading);
          } else {
            tok.romazi = tok.surface_form;
          }
        }

        // Handle sokuon gemination across token boundaries (e.g. 向かっ + て -> mukatte)
        for (let i = 0; i < tokens.length - 1; i++) {
          const tok = tokens[i];
          const nextTok = tokens[i + 1];
          if (tok.romazi && tok.romazi.endsWith('ッ')) {
            const nextReading = nextTok.reading ? this.romanizeKana(nextTok.reading) : nextTok.surface_form;
            const nextFirst = (nextReading || '')[0];
            if (nextFirst && /[a-z]/i.test(nextFirst)) {
              tok.romazi = tok.romazi.slice(0, -1) + (nextFirst.toLowerCase() === 'c' ? 't' : nextFirst);
            }
          }
        }

        return this.joinTokensSmart(tokens);
      } catch (err) {
        console.warn('[JapaneseRomanizer] Kuromoji tokenization failed, falling back:', err);
      }
    }

    let result = '';
    let i = 0;

    while (i < text.length) {
      let kanjiMatched = false;
      for (let len = 4; len >= 1; len--) {
        if (i + len <= text.length) {
          const sub = text.substring(i, i + len);
          const rom = COMMON_KANJI[sub];
          if (rom) {
            result += rom;
            i += len;
            kanjiMatched = true;
            break;
          }
        }
      }
      if (kanjiMatched) continue;

      const currentChar = text[i];
      if (currentChar === 'っ' || currentChar === 'ッ') {
        const nextChar = i + 1 < text.length ? text[i + 1] : '';
        const nextNext = i + 2 < text.length ? text.substring(i + 1, i + 3) : '';
        const nextRom = KANA_DIGRAPHS[nextNext] || KANA_SINGLES[nextChar] || '';
        if (nextRom) {
          const firstLetter = nextRom[0];
          result += (firstLetter === 'c') ? 't' : firstLetter;
          i++;
          continue;
        }
      }

      if (currentChar === 'ー') {
        const lastChar = result.length > 0 ? result[result.length - 1].toLowerCase() : '';
        if (['a', 'i', 'u', 'e', 'o'].includes(lastChar)) {
          result += lastChar;
        } else {
          result += '-';
        }
        i++;
        continue;
      }

      if (i + 1 < text.length) {
        const dig = text.substring(i, i + 2);
        if (KANA_DIGRAPHS[dig]) {
          result += KANA_DIGRAPHS[dig];
          i += 2;
          continue;
        }
      }

      if (KANA_SINGLES[currentChar]) {
        result += KANA_SINGLES[currentChar];
        i++;
        continue;
      }

      result += currentChar;
      i++;
    }

    return result;
  }

  /**
   * Evaluates grammatical rules to check whether a token should attach directly
   * to the preceding token without an intervening space.
   */
  static shouldAttachToPrev(tok, prevTok) {
    if (!prevTok) return false;

    if (/^\s+$/.test(tok.surface_form) || /^\s+$/.test(prevTok.surface_form)) return false;
    if (/^[、。，．！？!?.,;:)]+$/.test(tok.surface_form)) return true;
    if (/^[([{"'‘“]+$/.test(prevTok.surface_form)) return true;
    if (/^[、。，．！？!?.,;:)]+$/.test(prevTok.surface_form)) return false;

    // Suffixes (接尾: そう, さ, 的, っぽい, たち, など)
    if (tok.pos_detail_1 === '接尾') {
      return true;
    }
    // Auxiliary verbs (助動詞: た, だ, な, ない, ます, たい, らしい, など)
    if (tok.pos === '助動詞') {
      return true;
    }
    // Conjunctive particles (接続助詞: て, で, たり, たら, ば)
    if (tok.pos === '助詞' && tok.pos_detail_1 === '接続助詞') {
      if (prevTok.pos === '動詞' || prevTok.pos_detail_1 === '接尾' || prevTok.pos === '助動詞') {
        return true;
      }
    }
    // Particle attached to particle (に + は -> niwa, で + は -> dewa)
    if (tok.pos === '助詞' && prevTok.pos === '助詞') {
      return true;
    }
    // Non-independent verbs (非自立: てる, いる, くれる, しまう)
    if (tok.pos_detail_1 === '非自立' && (prevTok.pos === '動詞' || prevTok.pos_detail_1 === '接続助詞' || prevTok.surface_form === 'て' || prevTok.surface_form === 'で')) {
      return true;
    }
    // Indefinite pronouns (何か -> nanika, 誰も -> daremo, どこか -> dokoka, いつも -> itsumo)
    if (tok.surface_form === 'か' && prevTok.surface_form === '何') {
      return true;
    }
    if (tok.surface_form === 'も' && (prevTok.surface_form === '誰' || prevTok.surface_form === '何' || prevTok.surface_form === 'いつ' || prevTok.surface_form === 'どこ')) {
      return true;
    }

    return false;
  }

  /**
   * Intelligently joins Kuromoji morpheme tokens into natural grammatical words (bunsetsu).
   */
  static joinTokensSmart(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return '';

    let lineResult = '';
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prevTok = i > 0 ? tokens[i - 1] : null;

      if (/^\s+$/.test(tok.surface_form)) {
        lineResult += tok.surface_form;
        continue;
      }

      if (!prevTok) {
        lineResult += tok.romazi;
        continue;
      }

      if (/^\s+$/.test(prevTok.surface_form)) {
        lineResult += tok.romazi;
        continue;
      }

      if (this.shouldAttachToPrev(tok, prevTok)) {
        lineResult += tok.romazi;
      } else {
        lineResult += ' ' + tok.romazi;
      }
    }

    return lineResult.replace(/[ ]{2,}/g, ' ').trim();
  }

  /**
   * Splits a token's Katakana reading across its constituent surface characters.
   * Handles kanji compounds (e.g. 運命 -> [ウン, メイ]) and okurigana (e.g. 見つけ -> [ミ, ツ, ケ])
   * so that individual kanji syllables don't duplicate the full word reading.
   */
  static splitTokenReading(surface, reading) {
    if (!surface || !reading) return [];
    if (surface.length === 1) return [reading];

    const isKana = (ch) => /^[\u3040-\u309F\u30A0-\u30FF]$/.test(ch);

    if (/^[\u3040-\u309F\u30A0-\u30FF]+$/.test(surface)) {
      return surface.split('').map(c => {
        const code = c.charCodeAt(0);
        return (code >= 0x3041 && code <= 0x3096) ? String.fromCharCode(code + 0x60) : c;
      });
    }

    const moras = [];
    let i = 0;
    while (i < reading.length) {
      let m = reading[i];
      if (i + 1 < reading.length && /[ァィゥェォャュョヮ]/.test(reading[i + 1])) {
        m += reading[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      moras.push(m);
    }

    // Trailing kana (okurigana, e.g. 見つけ -> 見 + つ + け)
    let trailingKanaCount = 0;
    while (trailingKanaCount < surface.length && isKana(surface[surface.length - 1 - trailingKanaCount])) {
      trailingKanaCount++;
    }

    if (trailingKanaCount > 0) {
      const kanjiPart = surface.slice(0, surface.length - trailingKanaCount);
      const kanaPart = surface.slice(surface.length - trailingKanaCount);
      const kanaPartKata = kanaPart.split('').map(c => {
        const code = c.charCodeAt(0);
        return (code >= 0x3041 && code <= 0x3096) ? String.fromCharCode(code + 0x60) : c;
      });
      const kanaKataStr = kanaPartKata.join('');
      if (reading.endsWith(kanaKataStr)) {
        const kanjiReading = reading.slice(0, reading.length - kanaKataStr.length);
        const kanjiPartSplit = this.splitTokenReading(kanjiPart, kanjiReading);
        return [...kanjiPartSplit, ...kanaPartKata];
      }
    }

    const numKanji = surface.length;
    const numMoras = moras.length;

    if (numKanji === 2) {
      if (numMoras === 2) {
        return [moras[0], moras[1]];
      }
      if (numMoras === 4) {
        return [moras[0] + moras[1], moras[2] + moras[3]];
      }
      if (numMoras === 3) {
        if (['イ', 'ウ', 'ン', 'ツ', 'ク'].includes(moras[2])) {
          return [moras[0], moras[1] + moras[2]];
        } else if (['ン', 'ツ', 'ク', 'ウ'].includes(moras[1])) {
          return [moras[0] + moras[1], moras[2]];
        } else {
          return [moras[0], moras[1] + moras[2]];
        }
      }
    }

    if (numKanji === 3 && numMoras === 6) {
      return [moras[0] + moras[1], moras[2] + moras[3], moras[4] + moras[5]];
    }
    if (numKanji === 3 && numMoras === 3) {
      return [moras[0], moras[1], moras[2]];
    }

    const result = [];
    const morasPerChar = numMoras / numKanji;
    let moraIdx = 0;
    for (let k = 0; k < numKanji; k++) {
      const nextMoraIdx = Math.round((k + 1) * morasPerChar);
      result.push(moras.slice(moraIdx, nextMoraIdx).join(''));
      moraIdx = nextMoraIdx;
    }
    return result;
  }

  /**
   * Romanizes syllables for Word-synced Japanese lyrics.
   * Aligns Kuromoji tokens to individual syllable chunks and attaches
   * natural word-boundary spacing for Latin alphabet display.
   */
  static romanizeSyllables(syllables, lineText, tokenizer = null) {
    if (!Array.isArray(syllables) || syllables.length === 0) return [];

    if (!tokenizer) {
      return syllables.map((s, idx) => {
        let rom = this.romanize(s.text || '');
        const hasTrail = /\s$/.test(s.text || '');
        if (!hasTrail && idx < syllables.length - 1 && rom && !/\s$/.test(rom)) {
          rom += ' ';
        }
        return { text: rom };
      });
    }

    try {
      const tokens = tokenizer.tokenize(lineText || '');
      const charToToken = [];

      for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
        const tok = tokens[tIdx];
        let rom = '';
        if (tok.surface_form === 'は' && tok.pos === '助詞') rom = 'wa';
        else if (tok.surface_form === 'へ' && tok.pos === '助詞') rom = 'e';
        else if (tok.surface_form === 'を' && tok.pos === '助詞') rom = 'o';
        else if (tok.reading) rom = this.romanizeKana(tok.reading);
        else rom = tok.surface_form;

        tok.romazi = rom;

        const prevTok = tIdx > 0 ? tokens[tIdx - 1] : null;
        tok.hasLeadingSpace = (tIdx > 0 && !this.shouldAttachToPrev(tok, prevTok) && !/^\s+$/.test(tok.surface_form));

        let charReadings = [];
        if (tok.reading && tok.surface_form.length > 1) {
          charReadings = this.splitTokenReading(tok.surface_form, tok.reading).map(r => this.romanizeKana(r));
        } else if (tok.surface_form.length === 1) {
          charReadings = [tok.romazi];
        } else {
          charReadings = tok.surface_form.split('');
        }

        for (let c = 0; c < tok.surface_form.length; c++) {
          charToToken.push({
            tokenIndex: tIdx,
            charInToken: c,
            token: tok,
            charRomazi: charReadings[c] !== undefined ? charReadings[c] : tok.surface_form[c]
          });
        }
      }

      for (let i = 0; i < charToToken.length - 1; i++) {
        if (charToToken[i].charRomazi.endsWith('ッ')) {
          let nextRom = '';
          for (let j = i + 1; j < charToToken.length; j++) {
            const r = charToToken[j].charRomazi.trim();
            if (r) { nextRom = r; break; }
          }
          const nextFirst = nextRom[0]?.toLowerCase();
          if (nextFirst && /[a-z]/.test(nextFirst)) {
            charToToken[i].charRomazi = charToToken[i].charRomazi.slice(0, -1) + (nextFirst === 'c' ? 't' : nextFirst);
          }
        }
      }

      let charOffset = 0;
      return syllables.map((syl, sylIdx) => {
        const text = syl.text || '';
        if (!text.trim()) {
          charOffset += text.length;
          return { text };
        }

        const match = text.match(/^(\s*)(.*?)(\s*)$/);
        const leadingSpace = match[1] || '';
        const coreText = match[2] || '';
        let trailingSpace = match[3] || '';

        const foundIdx = lineText.indexOf(coreText, charOffset);
        const startIdx = foundIdx !== -1 ? foundIdx : charOffset + leadingSpace.length;
        const endIdx = startIdx + coreText.length;
        charOffset = endIdx + trailingSpace.length;

        const overlapping = [];
        for (let idx = startIdx; idx < endIdx && idx < charToToken.length; idx++) {
          overlapping.push(charToToken[idx]);
        }

        let sylRom = '';
        if (/^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]*$/u.test(coreText)) {
          sylRom = coreText;
        } else if (overlapping.length > 0 && overlapping.every(o => o.charRomazi !== undefined)) {
          let piece = '';
          for (let i = 0; i < overlapping.length; i++) {
            const item = overlapping[i];
            if (i > 0 && item.charInToken === 0 && item.token.hasLeadingSpace) {
              piece += ' ';
            }
            piece += item.charRomazi;
          }
          sylRom = piece;
        } else {
          sylRom = this.romanize(coreText);
        }

        if (!trailingSpace && sylIdx < syllables.length - 1) {
          if (endIdx < charToToken.length) {
            const nextItem = charToToken[endIdx];
            if (nextItem) {
              if (/^\s+$/.test(nextItem.token.surface_form) || (nextItem.charInToken === 0 && nextItem.token.hasLeadingSpace)) {
                trailingSpace = ' ';
              }
            }
          }
        }

        return {
          text: leadingSpace + sylRom + trailingSpace
        };
      });
    } catch (err) {
      console.warn('[JapaneseRomanizer] Error aligning syllables, falling back:', err);
      return syllables.map(s => ({ text: this.romanize(s.text || '') }));
    }
  }
}
