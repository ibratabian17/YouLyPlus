/**
 * Thai Script Romanizer.
 * Implements the standard Royal Thai General System of Transcription (RTGS)
 * without extraneous intra-word hyphens for lyrics, songs, and conversational Thai.
 */

// Common Thai vocabulary dictionary for standard word-level segmentation & RTGS transcription
const THAI_WORD_DICT = {
  // Pronouns & particles
  'ฉัน': 'chan', 'เธอ': 'thoe', 'คุณ': 'khun', 'ผม': 'phom', 'เรา': 'rao',
  'เขา': 'khao', 'มัน': 'man', 'พวกเรา': 'phuakrao', 'พวกเขา': 'phuakkhao', 'พวกเธอ': 'phuakthoe',
  'นะ': 'na', 'ครับ': 'khrap', 'ค่ะ': 'kha', 'คะ': 'kha', 'สิ': 'si', 'จ๊ะ': 'cha',
  'จ๋า': 'cha', 'นะจ๊ะ': 'nacha', 'เถอะ': 'thoe', 'เลย': 'loei', 'เอง': 'eng',
  'ละ': 'la', 'ล่ะ': 'la', 'น่า': 'na', 'หวา': 'wa', 'วะ': 'wa', 'โว้ย': 'woi',

  // Common verbs & feelings
  'รัก': 'rak', 'ชอบ': 'chop', 'คิดถึง': 'khitthueng', 'ห่วง': 'huang', 'คิด': 'khit',
  'รู้': 'ru', 'เห็น': 'hen', 'ฟัง': 'fang', 'ได้ยิน': 'daiyin', 'มอง': 'mong',
  'ดู': 'du', 'ทำ': 'tham', 'เป็น': 'pen', 'อยู่': 'yu', 'มี': 'mi', 'ได้': 'dai',
  'ให้': 'hai', 'ไป': 'pai', 'มา': 'ma', 'เอา': 'ao', 'อยาก': 'yak', 'ต้องการ': 'tongkan',
  'รอ': 'ro', 'พบ': 'phop', 'เจอ': 'choe', 'ลืม': 'luem', 'จำ': 'cham', 'ถาม': 'tham',
  'ตอบ': 'top', 'บอก': 'bok', 'พูด': 'phut', 'ร้อง': 'rong', 'ยิ้ม': 'yim', 'หัวเราะ': 'huaro',
  'ร้องไห้': 'ronghai', 'เจ็บ': 'chep', 'ปวด': 'puat', 'กอด': 'kot', 'จูบ': 'chup',
  'จับ': 'chap', 'ปล่อย': 'phloi', 'ทิ้ง': 'thing', 'หาย': 'hai', 'กลัว': 'klua',
  'เกลียด': 'kliat', 'ยอม': 'yom', 'สู้': 'su', 'หวัง': 'wang', 'ฝัน': 'fan',
  'หวังว่า': 'wangwa', 'เข้าใจ': 'khaochai', 'เสียใจ': 'siachai', 'ดีใจ': 'dichai',
  'เหนื่อย': 'nueai', 'เหงา': 'ngao', 'สุข': 'suk', 'ทุกข์': 'thuk', 'ตาย': 'tai',
  'เกิด': 'koet', 'เดิน': 'doen', 'วิ่ง': 'wing', 'นอน': 'non', 'ตื่น': 'tuen',
  'ช่วย': 'chuai', 'ขอ': 'kho', 'ขอบคุณ': 'khopkhun', 'ขอโทษ': 'khothot',
  'ขอร้อง': 'khorong', 'บอกรัก': 'bokrak', 'ยอมรับ': 'yomrap', 'กลับมา': 'klapma',
  'จากไป': 'chakpai', 'มองดู': 'mongdu', 'พบกัน': 'phopkan', 'เจอกัน': 'choekan',
  'ลืมตา': 'luemta', 'หลับตา': 'lapta', 'ดูแล': 'dulae', 'ห่วงใย': 'huangyai',
  'คิดดู': 'khitdu', 'หลับ': 'lap', 'ตื่นนอน': 'tuennon', 'แอบ': 'aep',
  'แอบรัก': 'aeprak', 'หลอก': 'lok', 'หลง': 'long', 'หลงรัก': 'longrak',

  // Common nouns & themes
  'ใจ': 'chai', 'หัวใจ': 'huachai', 'ดวงใจ': 'duangchai', 'ความรัก': 'khwamrak',
  'ความรู้สึก': 'khwamrusuek', 'ความฝัน': 'khwamfan', 'ความจำ': 'khwamcham',
  'ความลับ': 'khwamlap', 'ความจริง': 'khwamching', 'ความทรงจำ': 'khwamthongcham',
  'คน': 'khon', 'ใคร': 'khrai', 'ทุกคน': 'thukkhon', 'คนเดียว': 'khondiao',
  'คนดี': 'khondi', 'คนรัก': 'khonrak', 'วัน': 'wan', 'คืน': 'khuen', 'เวลา': 'wela',
  'นาที': 'nathi', 'ชั่วโมง': 'chuamong', 'วินาที': 'winathi', 'ฟ้า': 'fa',
  'ท้องฟ้า': 'thongfa', 'ดาว': 'dao', 'เดือน': 'duean', 'พระอาทิตย์': 'phraathit',
  'ตะวัน': 'tawan', 'ดวงดาว': 'duangdao', 'ดวงจันทร์': 'duangchan', 'ลม': 'lom',
  'ฝน': 'fon', 'แดด': 'daet', 'หมอก': 'mok', 'ไฟ': 'fai', 'น้ำ': 'nam', 'ดิน': 'din',
  'ทะเล': 'thale', 'ภูเขา': 'phukhao', 'ดอกไม้': 'dokmai', 'เพลง': 'phleng',
  'เสียง': 'siang', 'ตา': 'ta', 'สายตา': 'saita', 'มือ': 'mue', 'หน้า': 'na',
  'โลก': 'lok', 'ชีวิต': 'chiwit', 'เรื่องราว': 'rueangrao', 'เรื่อง': 'rueang',
  'คำ': 'kham', 'คำพูด': 'khamphut', 'สัญญา': 'sanya', 'ความหลัง': 'khwamlang',
  'ทาง': 'thang', 'เส้นทาง': 'senthang', 'ที่': 'thi', 'ที่นี่': 'thini', 'ที่นั่น': 'thinan',
  'ข้างใน': 'khangnai', 'ข้างนอก': 'khangnok', 'ตรงนี้': 'trongni', 'ตรงนั้น': 'trongnan',
  'ข้างกาย': 'khanggai', 'ข้างใจ': 'khangchai', 'เงา': 'ngao', 'ภาพ': 'phap',
  'ความหวัง': 'khwamwang', 'บทเพลง': 'botphleng', 'เสียงเพลง': 'siangphleng',

  // Modifiers, questions & connectors
  'ไม่': 'mai', 'ไม่ใช่': 'maichai', 'ใช่': 'chai', 'ก็': 'ko', 'และ': 'lae',
  'หรือ': 'rue', 'แต่': 'tae', 'เพราะ': 'phro', 'เพราะว่า': 'phrowa', 'ถ้า': 'tha',
  'หาก': 'hak', 'เมื่อ': 'muea', 'ตอน': 'ton', 'ตอนนี้': 'tonni', 'นี้': 'ni',
  'นั้น': 'nan', 'โน้น': 'non', 'มาก': 'mak', 'มากมาย': 'makmai', 'เกิน': 'koen',
  'ที่สุด': 'thisut', 'สัก': 'sak', 'สักวัน': 'sakwan', 'ตลอด': 'talot',
  'ตลอดไป': 'talotpai', 'เสมอ': 'samoe', 'ทุก': 'thuk', 'ทุกวัน': 'thukwan',
  'ทุกที': 'thukthi', 'อีก': 'ik', 'ยัง': 'yang', 'เพิ่ง': 'phoeng', 'ก่อน': 'kon',
  'หลัง': 'lang', 'แล้ว': 'laeo', 'จะ': 'cha', 'คง': 'khong', 'อาจ': 'at',
  'เหมือน': 'muean', 'อย่าง': 'yang', 'อย่างนี้': 'yangni', 'อย่างไร': 'yangrai',
  'ทำไม': 'thammai', 'อะไร': 'arai', 'เท่าไร': 'thaorai', 'ไหน': 'nai',
  'ที่ไหน': 'thinai', 'เมื่อไร': 'muearai', 'สวัสดี': 'sawatdi', 'ไม่เป็นไร': 'maipenrai',
  'ด้วยกัน': 'duaikan', 'กัน': 'kan', 'ด้วย': 'duai', 'อร่อย': 'aroi', 'สบาย': 'sabai',
  'กรุงเทพ': 'krungthep', 'กรุงเทพฯ': 'krungthep', 'ประเทศไทย': 'prathetthai', 'ไทย': 'thai',
  'สักครั้ง': 'sakkhrang', 'ครั้งหนึ่ง': 'khrangnueng', 'สักหน่อย': 'saknoi', 'นิดหน่อย': 'nitnoi',
  'เท่านั้น': 'thaonan', 'แค่นี้': 'khaeni', 'แค่นั้น': 'khaenan', 'แค่': 'khae',
  'ไม่มี': 'maimi', 'ไม่รู้': 'mairu', 'ไม่เคย': 'maikhoei', 'ไม่อยาก': 'maiyak',
  'ไม่อยู่': 'maiyu', 'ไม่เข้าใจ': 'maikhaochai', 'รักเธอ': 'rakthoe', 'รักฉัน': 'rakchan'
};

const INITIAL_CONSONANTS = {
  'ก': 'k',
  'ข': 'kh', 'ฃ': 'kh', 'ค': 'kh', 'ฅ': 'kh', 'ฆ': 'kh',
  'ง': 'ng',
  'จ': 'ch', 'ฉ': 'ch', 'ช': 'ch', 'ฌ': 'ch',
  'ซ': 's', 'ศ': 's', 'ษ': 's', 'ส': 's',
  'ญ': 'y', 'ย': 'y',
  'ฎ': 'd', 'ด': 'd',
  'ฏ': 't', 'ต': 't',
  'ฐ': 'th', 'ฑ': 'th', 'ฒ': 'th', 'ถ': 'th', 'ท': 'th', 'ธ': 'th',
  'ณ': 'n', 'น': 'n',
  'บ': 'b',
  'ป': 'p',
  'ผ': 'ph', 'พ': 'ph', 'ภ': 'ph',
  'ฝ': 'f', 'ฟ': 'f',
  'ม': 'm',
  'ร': 'r',
  'ล': 'l', 'ฬ': 'l',
  'ว': 'w',
  'ห': 'h', 'ฮ': 'h',
  'อ': '',
  'ฤ': 'rue', 'ฦ': 'lue'
};

const FINAL_CONSONANTS = {
  'ก': 'k', 'ข': 'k', 'ค': 'k', 'ฆ': 'k',
  'ง': 'ng',
  'จ': 't', 'ฉ': 't', 'ช': 't', 'ซ': 't', 'ฌ': 't',
  'ฎ': 't', 'ฏ': 't', 'ฐ': 't', 'ฑ': 't', 'ฒ': 't',
  'ด': 't', 'ต': 't', 'ถ': 't', 'ท': 't', 'ธ': 't',
  'ศ': 't', 'ษ': 't', 'ส': 't',
  'ญ': 'n', 'ณ': 'n', 'น': 'n', 'ร': 'n', 'ล': 'n', 'ฬ': 'n',
  'บ': 'p', 'ป': 'p', 'ผ': 'p', 'ฝ': 'p', 'พ': 'p', 'ฟ': 'p', 'ภ': 'p',
  'ม': 'm'
};

const CLUSTERS = {
  'กร': 'kr', 'กล': 'kl', 'กว': 'kw',
  'ขร': 'khr', 'ขล': 'khl', 'ขว': 'khw',
  'คร': 'khr', 'คล': 'khl', 'คว': 'khw',
  'ตร': 'tr',
  'ปร': 'pr', 'ปล': 'pl',
  'ผล': 'phl', 'พร': 'phr', 'พล': 'phl',
  'บร': 'br', 'บล': 'bl',
  'ฟร': 'fr', 'ฟล': 'fl',
  'ดร': 'dr',
  'ทร': 's',
  // Leading Ho Hip (silent tone modifier)
  'หง': 'ng', 'หญ': 'y', 'หน': 'n', 'หม': 'm', 'หย': 'y', 'หร': 'r', 'หล': 'l', 'หว': 'w',
  // Leading O Ang
  'อย': 'y'
};

export class ThaiRomanizer {
  static romanize(text) {
    if (!text) return '';
    return this.romanizeLine(text);
  }

  static romanizeLine(lineText) {
    if (!lineText) return '';

    // Handle Mai Yamok duplication (e.g. จริงๆ -> จริง จริง)
    let processed = lineText.replace(/([\u0E00-\u0E7F]+)\s*ๆ/gu, '$1 $1');

    const tokens = processed.match(/[\u0E00-\u0E7F]+|[^\u0E00-\u0E7F]+/gu) || [processed];
    let result = '';

    for (const token of tokens) {
      if (/[\u0E00-\u0E7F]/u.test(token)) {
        result += this.romanizeSegment(token);
      } else {
        result += token;
      }
    }

    return result
      .replace(/[\u0E00-\u0E7F]/gu, '') // Remove any unparsed Thai marks/characters
      .replace(/[\u0300-\u036F]/gu, '') // Remove combining diacritic marks
      .replace(/[ ]{2,}/g, ' ');
  }

  static romanizeSyllables(syllables) {
    if (!Array.isArray(syllables)) return [];

    return syllables.map(s => {
      const origText = s.text || '';
      const match = origText.match(/^(\s*)(.*?)(\s*)$/);
      const leadingSpace = match ? match[1] : '';
      const coreText = match ? match[2] : origText;
      const trailingSpace = match ? match[3] : '';

      if (!coreText) return { text: origText };

      const romCore = this.romanizeLine(coreText).trim();
      return { text: leadingSpace + romCore + trailingSpace };
    });
  }

  /**
   * Tokenizes and romanizes a Thai continuous string using longest-match dictionary
   * combined with RTGS syllable phonotactic parsing.
   */
  static romanizeSegment(thaiText) {
    let i = 0;
    const len = thaiText.length;
    const parts = [];

    while (i < len) {
      let matched = false;

      // Try dictionary matching (longest prefix first, up to 20 chars)
      const maxLen = Math.min(20, len - i);
      for (let l = maxLen; l >= 1; l--) {
        const sub = thaiText.substring(i, i + l);
        if (THAI_WORD_DICT[sub]) {
          parts.push(THAI_WORD_DICT[sub]);
          i += l;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // Fallback: Parse single Thai syllable via RTGS pattern
      const [sylRom, charsConsumed] = this.parseSyllable(thaiText, i);
      if (charsConsumed > 0) {
        if (sylRom) parts.push(sylRom);
        i += charsConsumed;
      } else {
        i++;
      }
    }

    return parts.join(' ');
  }

  /**
   * Parses a single Thai syllable starting at position `start` in `text` using RTGS grammar.
   * Returns [romanizedString, charsConsumed].
   */
  static parseSyllable(text, start) {
    const len = text.length;
    let i = start;

    // 1. Check preposed vowel: เ (\u0E40), แ (\u0E41), โ (\u0E42), ใ (\u0E43), ไ (\u0E44)
    let preVowel = '';
    if (i < len && (text[i] === 'เ' || text[i] === 'แ' || text[i] === 'โ' || text[i] === 'ใ' || text[i] === 'ไ')) {
      preVowel = text[i];
      i++;
    }

    if (i >= len) {
      return [preVowel ? this.vowelToRom(preVowel) : '', i - start];
    }

    // 2. Parse Initial Consonant / Cluster
    let initial = '';
    const c1 = text[i];
    const c2 = i + 1 < len ? text[i + 1] : '';

    if (c2 && CLUSTERS[c1 + c2] !== undefined) {
      initial = CLUSTERS[c1 + c2];
      i += 2;
    } else if (INITIAL_CONSONANTS[c1] !== undefined) {
      initial = INITIAL_CONSONANTS[c1];
      i++;
    } else {
      return ['', 1];
    }

    // Helper to skip any tone marks (\u0E48 - \u0E4B)
    const skipTones = () => {
      while (i < len && text[i] >= '\u0E48' && text[i] <= '\u0E4B') {
        i++;
      }
    };

    skipTones();

    // 3. Special Case: Double Ro Han (รร)
    if (i + 1 < len && text[i] === 'ร' && text[i + 1] === 'ร') {
      i += 2;
      skipTones();
      // Check if followed by final consonant
      if (i < len && FINAL_CONSONANTS[text[i]] !== undefined && !this.isFollowedByVowel(text, i)) {
        const fc = FINAL_CONSONANTS[text[i]];
        i++;
        return [initial + 'a' + fc, i - start];
      }
      return [initial + 'an', i - start];
    }

    // 4. Parse Vowel Combinations
    let vowel = '';
    let final = '';

    if (preVowel === 'ใ' || preVowel === 'ไ') {
      vowel = 'ai';
      skipTones();
      if (text.substring(start, start + 3) === 'ไทย') {
        // Handle word ไทย (thai)
        if (i < len && text[i] === 'ย') i++;
      }
    } else if (preVowel === 'เ') {
      skipTones();
      if (i + 1 < len && text[i] === 'า' && text[i + 1] === 'ะ') { // เ-าะ
        vowel = 'o';
        i += 2;
      } else if (i < len && text[i] === 'า') { // เ-า
        vowel = 'ao';
        i++;
      } else if (i < len && (text[i] === 'ี' || text[i] === 'ิ')) {
        const hasTone = i + 1 < len && text[i + 1] >= '\u0E48' && text[i + 1] <= '\u0E4B';
        const nextIdx = hasTone ? i + 2 : i + 1;
        if (nextIdx < len && text[nextIdx] === 'ย') { // เ-ีย
          vowel = 'ia';
          i = nextIdx + 1;
        } else {
          vowel = 'oe'; // เ-ิ- (e.g. เดิน -> doen)
          i = nextIdx;
        }
      } else if (i < len && (text[i] === 'ื' || text[i] === 'ึ')) {
        const hasTone = i + 1 < len && text[i + 1] >= '\u0E48' && text[i + 1] <= '\u0E4B';
        const nextIdx = hasTone ? i + 2 : i + 1;
        if (nextIdx < len && text[nextIdx] === 'อ') { // เ-ือ
          vowel = 'uea';
          i = nextIdx + 1;
        } else {
          vowel = 'ue';
          i = nextIdx;
        }
      } else if (i < len && text[i] === '็') { // เ-็-
        vowel = 'e';
        i++;
      } else if (i + 1 < len && text[i] === 'อ' && text[i + 1] === 'ะ') { // เ-อะ
        vowel = 'oe';
        i += 2;
      } else if (i < len && text[i] === 'ะ') { // เ-ะ
        vowel = 'e';
        i++;
      } else if (i < len && text[i] === 'อ') { // เ-อ
        vowel = 'oe';
        i++;
      } else if (i < len && text[i] === 'ย') { // เ-ย (oei)
        vowel = 'oei';
        i++;
      } else if (i < len && text[i] === 'ว') { // เ-ว (eo)
        vowel = 'eo';
        i++;
      } else {
        vowel = 'e';
      }
    } else if (preVowel === 'แ') {
      skipTones();
      if (i < len && text[i] === 'ะ') { // แ-ะ
        vowel = 'ae';
        i++;
      } else if (i < len && text[i] === '็') { // แ-็
        vowel = 'ae';
        i++;
      } else if (i < len && text[i] === 'ว') { // แ-ว (aeo)
        vowel = 'aeo';
        i++;
      } else {
        vowel = 'ae';
      }
    } else if (preVowel === 'โ') {
      skipTones();
      if (i < len && text[i] === 'ะ') { // โ-ะ
        vowel = 'o';
        i++;
      } else {
        vowel = 'o';
      }
    } else {
      // Non-preposed vowels
      skipTones();
      if (i < len && text[i] === 'ะ') {
        vowel = 'a';
        i++;
      } else if (i < len && text[i] === 'ั') {
        i++;
        skipTones();
        if (i < len && text[i] === 'ว') { // -ัว (ua)
          vowel = 'ua';
          i++;
        } else {
          vowel = 'a';
        }
      } else if (i < len && text[i] === 'า') {
        vowel = 'a';
        i++;
      } else if (i < len && text[i] === 'ำ') {
        vowel = 'am';
        i++;
      } else if (i < len && text[i] === 'ิ') {
        i++;
        skipTones();
        if (i < len && text[i] === 'ว') { // -ิว (io)
          vowel = 'io';
          i++;
        } else {
          vowel = 'i';
        }
      } else if (i < len && text[i] === 'ี') {
        vowel = 'i';
        i++;
      } else if (i < len && text[i] === 'ึ') {
        vowel = 'ue';
        i++;
      } else if (i < len && text[i] === 'ื') {
        i++;
        skipTones();
        if (i < len && text[i] === 'อ') {
          vowel = 'ue';
          i++;
        } else {
          vowel = 'ue';
        }
      } else if (i < len && text[i] === 'ุ') {
        i++;
        skipTones();
        if (i < len && text[i] === 'ย') { // -ุย (ui)
          vowel = 'ui';
          i++;
        } else {
          vowel = 'u';
        }
      } else if (i < len && text[i] === 'ู') {
        vowel = 'u';
        i++;
      } else if (i < len && text[i] === '็') {
        vowel = 'o';
        i++;
      } else if (i < len && text[i] === 'ว') {
        // -ว- medial ua (e.g. พวก, ขวด, สวย, ช่วย, ดวง, ห่วง)
        if (i + 1 < len && (FINAL_CONSONANTS[text[i + 1]] !== undefined || text[i + 1] === 'ย')) {
          vowel = 'ua';
          i++;
        }
      } else if (i < len && text[i] === 'อ') {
        // -อ- medial / final vowel 'o' (e.g. บอก, ของ, มอง, นอน, ตอน, สอน, ชอบ, พ่อ, หมอ, ขอ, รอ)
        vowel = 'o';
        i++;
      }
    }

    skipTones();

    // 5. Parse Final Consonants & Diphthong Endings
    if (i < len) {
      // Check if this consonant is cancelled by Garan (์ \u0E4C)
      const isSilencedByGaran = (i + 1 < len && text[i + 1] === '\u0E4C') ||
                                (i + 2 < len && text[i + 2] === '\u0E4C');

      if (isSilencedByGaran) {
        // Skip silent consonant and garan
        while (i < len && text[i] !== '\u0E4C') i++;
        if (i < len && text[i] === '\u0E4C') i++;
      } else if (!this.isFollowedByVowel(text, i)) {
        const fc = text[i];
        if (fc === 'ย') {
          if (vowel === 'a') {
            vowel = 'ai';
            i++;
          } else if (vowel === 'o') {
            vowel = 'oi';
            i++;
          } else if (vowel === 'u') {
            vowel = 'ui';
            i++;
          } else if (vowel === 'ua') {
            vowel = 'uai';
            i++;
          } else if (vowel === 'uea') {
            vowel = 'ueai';
            i++;
          } else if (vowel === 'oe') {
            vowel = 'oei';
            i++;
          } else if (FINAL_CONSONANTS[fc] !== undefined) {
            final = FINAL_CONSONANTS[fc];
            i++;
          }
        } else if (fc === 'ว') {
          if (vowel === 'a') {
            vowel = 'ao';
            i++;
          } else if (vowel === 'i') {
            vowel = 'io';
            i++;
          } else if (vowel === 'ia') {
            vowel = 'iao';
            i++;
          } else if (FINAL_CONSONANTS[fc] !== undefined) {
            final = FINAL_CONSONANTS[fc];
            i++;
          }
        } else if (FINAL_CONSONANTS[fc] !== undefined) {
          final = FINAL_CONSONANTS[fc];
          i++;
        }
      }
    }

    // 6. Default Inherent Vowels:
    // Closed syllable -> inherent 'o' (e.g. คน -> khon, ลม -> lom, ตก -> tok, ผม -> phom)
    // Open syllable -> inherent 'a' (e.g. จะ -> cha, กะ -> ka)
    if (!vowel) {
      vowel = final ? 'o' : 'a';
    }

    const sylRom = initial + vowel + final;
    return [sylRom, i - start];
  }

  static isFollowedByVowel(text, idx) {
    if (idx + 1 >= text.length) return false;
    const nextChar = text[idx + 1];
    return (
      nextChar === 'ะ' || nextChar === 'ั' || nextChar === 'า' || nextChar === 'ำ' ||
      nextChar === 'ิ' || nextChar === 'ี' || nextChar === 'ึ' || nextChar === 'ื' ||
      nextChar === 'ุ' || nextChar === 'ู' || nextChar === '็' || nextChar === '์' ||
      (nextChar >= '\u0E48' && nextChar <= '\u0E4B')
    );
  }

  static vowelToRom(preVowel) {
    if (preVowel === 'ใ' || preVowel === 'ไ') return 'ai';
    if (preVowel === 'เ') return 'e';
    if (preVowel === 'แ') return 'ae';
    if (preVowel === 'โ') return 'o';
    return '';
  }
}
