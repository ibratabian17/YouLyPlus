/**
 * Chinese (Hanzi) to Pinyin Romanizer.
 * Covers CJK Unified Ideographs (U+4E00 - U+9FFF) via binary search over ICU boundaries,
 * with polyphonic compound word matching.
 */

const UNIHANS = [
  '\u963F', '\u54CE', '\u5B89', '\u80AE', '\u51F9', '\u516B', '\u6300', '\u6273', '\u90A6', '\u52F9',
  '\u9642', '\u5954', '\u4F3B', '\u5C44', '\u8FB9', '\u706C', '\u618B', '\u6C43', '\u51AB', '\u7676',
  '\u5CEC', '\u5693', '\u5072', '\u53C2', '\u4ED3', '\u64A1', '\u518A', '\u5D7E', '\u66FD', '\u53C9',
  '\u8286', '\u8FBF', '\u4F25', '\u6284', '\u8F66', '\u62BB', '\u9637', '\u5403', '\u5145', '\u62BD',
  '\u51FA', '\u6B3B', '\u63E3', '\u5DDB', '\u5205', '\u5439', '\u65FE', '\u9034', '\u5472', '\u5306',
  '\u51D1', '\u7C97', '\u6C46', '\u5D14', '\u90A8', '\u6413', '\u5491', '\u5446', '\u4E39', '\u5F53',
  '\u5200', '\u561A', '\u6265', '\u706F', '\u6C10', '\u7538', '\u5201', '\u7239', '\u4E01', '\u4E1F',
  '\u4E1C', '\u543A', '\u53BE', '\u8011', '\u5796', '\u5428', '\u591A', '\u59B8', '\u8BF6', '\u5940',
  '\u97A5', '\u513F', '\u53D1', '\u5E06', '\u531A', '\u98DE', '\u5206', '\u4E30', '\u8985', '\u4ECF',
  '\u7D11', '\u592B', '\u65EE', '\u4F85', '\u7518', '\u5188', '\u768B', '\u6208', '\u7ED9', '\u6839',
  '\u522F', '\u5DE5', '\u52FE', '\u4F30', '\u74DC', '\u4E56', '\u5173', '\u5149', '\u5F52', '\u4E28',
  '\u5459', '\u54C8', '\u548D', '\u4F44', '\u592F', '\u8320', '\u8BC3', '\u9ED2', '\u62EB', '\u4EA8',
  '\u5677', '\u53FF', '\u9F41', '\u4E4E', '\u82B1', '\u6000', '\u6B22', '\u5DDF', '\u7070', '\u660F',
  '\u5419', '\u4E0C', '\u52A0', '\u620B', '\u6C5F', '\u827D', '\u9636', '\u5DFE', '\u5755', '\u5182',
  '\u4E29', '\u51E5', '\u59E2', '\u5658', '\u519B', '\u5494', '\u5F00', '\u520A', '\u5FFC', '\u5C3B',
  '\u533C', '\u808E', '\u52A5', '\u7A7A', '\u62A0', '\u625D', '\u5938', '\u84AF', '\u5BBD', '\u5321',
  '\u4E8F', '\u5764', '\u6269', '\u5783', '\u6765', '\u5170', '\u5577', '\u635E', '\u808B', '\u52D2',
  '\u5D1A', '\u54E9', '\u4FE9', '\u5941', '\u826F', '\u64A9', '\u6BDF', '\u62CE', '\u4F36', '\u6E9C',
  '\u56D6', '\u9F99', '\u779C', '\u565C', '\u9A74', '\u5A08', '\u63A0', '\u62A1', '\u7F57', '\u5463',
  '\u5988', '\u57CB', '\u5ADA', '\u7264', '\u732B', '\u4E48', '\u5445', '\u95E8', '\u753F', '\u54AA',
  '\u5B80', '\u55B5', '\u4E5C', '\u6C11', '\u540D', '\u8C2C', '\u6478', '\u54DE', '\u6BEA', '\u55EF',
  '\u62CF', '\u8149', '\u56E1', '\u56D4', '\u5B6C', '\u7592', '\u5A1E', '\u6041', '\u80FD', '\u59AE',
  '\u62C8', '\u5A18', '\u9E1F', '\u634F', '\u56DC', '\u5B81', '\u599E', '\u519C', '\u7FBA', '\u5974',
  '\u5973', '\u597B', '\u759F', '\u9EC1', '\u632A', '\u5594', '\u8BB4', '\u5991', '\u62CD', '\u7705',
  '\u4E53', '\u629B', '\u5478', '\u55B7', '\u5309', '\u4E15', '\u56E8', '\u527D', '\u6C15', '\u59D8',
  '\u4E52', '\u948B', '\u5256', '\u4EC6', '\u4E03', '\u6390', '\u5343', '\u545B', '\u6084', '\u767F',
  '\u4EB2', '\u9751', '\u536D', '\u4E18', '\u533A', '\u5CD1', '\u7F3A', '\u590B', '\u5465', '\u7A63',
  '\u5A06', '\u60F9', '\u4EBA', '\u6254', '\u65E5', '\u8338', '\u53B9', '\u909A', '\u633C', '\u5827',
  '\u5A51', '\u77A4', '\u637C', '\u4EE8', '\u6BE2', '\u4E09', '\u6852', '\u63BB', '\u95AA', '\u68EE',
  '\u50E7', '\u6740', '\u7B5B', '\u5C71', '\u4F24', '\u5F30', '\u5962', '\u7533', '\u5347', '\u5C38',
  '\u53CE', '\u4E66', '\u5237', '\u8870', '\u95E9', '\u53CC', '\u813D', '\u542E', '\u8BF4', '\u53B6',
  '\u5FEA', '\u635C', '\u82CF', '\u72FB', '\u590A', '\u5B59', '\u5506', '\u4ED6', '\u56FC', '\u574D',
  '\u6C64', '\u5932', '\u5FD1', '\u71A5', '\u5254', '\u5929', '\u65EB', '\u5E16', '\u5385', '\u56F2',
  '\u5077', '\u51F8', '\u6E4D', '\u63A8', '\u541E', '\u4E47', '\u7A75', '\u6B6A', '\u5F2F', '\u5C23',
  '\u5371', '\u6637', '\u7FC1', '\u631D', '\u4E4C', '\u5915', '\u8672', '\u4ED9', '\u4E61', '\u7071',
  '\u4E9B', '\u5FC3', '\u661F', '\u51F6', '\u4F11', '\u5401', '\u5405', '\u524A', '\u5743', '\u4E2B',
  '\u6079', '\u592E', '\u5E7A', '\u503B', '\u4E00', '\u56D9', '\u5E94', '\u54DF', '\u4F63', '\u4F18',
  '\u625C', '\u56E6', '\u66F0', '\u6655', '\u5E00', '\u707D', '\u5142', '\u5328', '\u50AE', '\u5219',
  '\u8D3C', '\u600E', '\u5897', '\u624E', '\u635A', '\u6CBE', '\u5F20', '\u4F4B', '\u8707', '\u8D1E',
  '\u4E89', '\u4E4B', '\u4E2D', '\u5DDE', '\u6731', '\u6293', '\u62FD', '\u4E13', '\u5986', '\u96B9',
  '\u5B92', '\u5353', '\u4E72', '\u5B97', '\u90B9', '\u79DF', '\u94BB', '\u539C', '\u5C0A', '\u6628',
  '\u5159'
];

const PINYINS = [
  'a', 'ai', 'an', 'ang', 'ao', 'ba', 'bai', 'ban', 'bang', 'bao',
  'bei', 'ben', 'beng', 'bi', 'bian', 'biao', 'bie', 'bin', 'bing', 'bo',
  'bu', 'ca', 'cai', 'can', 'cang', 'cao', 'ce', 'cen', 'ceng', 'cha',
  'chai', 'chan', 'chang', 'chao', 'che', 'chen', 'cheng', 'chi', 'chong', 'chou',
  'chu', 'chua', 'chuai', 'chuan', 'chuang', 'chui', 'chun', 'chuo', 'ci', 'cong',
  'cou', 'cu', 'cuan', 'cui', 'cun', 'cuo', 'da', 'dai', 'dan', 'dang',
  'dao', 'de', 'deng', 'di', 'dian', 'diao', 'die', 'ding', 'diu', 'dong',
  'dou', 'du', 'duan', 'dui', 'dun', 'duo', 'e', 'en', 'er', 'fa',
  'fan', 'fang', 'fei', 'fen', 'feng', 'fo', 'fou', 'fu', 'ga', 'gai',
  'gan', 'gang', 'gao', 'ge', 'gei', 'gen', 'geng', 'gong', 'gou', 'gu',
  'gua', 'guai', 'guan', 'guang', 'gui', 'gun', 'guo', 'ha', 'hai', 'han',
  'hang', 'hao', 'he', 'hei', 'hen', 'heng', 'hong', 'hou', 'hu', 'hua',
  'huai', 'huan', 'huang', 'hui', 'hun', 'huo', 'ji', 'jia', 'jian', 'jiang',
  'jiao', 'jie', 'jin', 'jing', 'jiong', 'jiu', 'ju', 'juan', 'jue', 'jun',
  'ka', 'kai', 'kan', 'kang', 'kao', 'ke', 'ken', 'keng', 'kong', 'kou',
  'ku', 'kua', 'kuai', 'kuan', 'kuang', 'kui', 'kun', 'kuo', 'la', 'lai',
  'lan', 'lang', 'lao', 'le', 'lei', 'leng', 'li', 'lia', 'lian', 'liang',
  'liao', 'lie', 'lin', 'ling', 'liu', 'long', 'lou', 'lu', 'lv', 'luan',
  'lue', 'lun', 'luo', 'ma', 'mai', 'man', 'mang', 'mao', 'me', 'mei',
  'men', 'meng', 'mi', 'mian', 'miao', 'mie', 'min', 'ming', 'miu', 'mo',
  'mou', 'mu', 'na', 'nai', 'nan', 'nang', 'nao', 'ne', 'nei', 'nen',
  'neng', 'ni', 'nian', 'niang', 'niao', 'nie', 'nin', 'ning', 'niu', 'nong',
  'nu', 'nv', 'nuan', 'nue', 'nuo', 'o', 'ou', 'pa', 'pai', 'pan',
  'pang', 'pao', 'pei', 'pen', 'peng', 'pi', 'pian', 'piao', 'pie', 'pin',
  'ping', 'po', 'pou', 'pu', 'qi', 'qia', 'qian', 'qiang', 'qiao', 'qie',
  'qin', 'qing', 'qiong', 'qiu', 'qu', 'quan', 'que', 'qun', 'ran', 'rang',
  'rao', 're', 'ren', 'reng', 'ri', 'rong', 'rou', 'ru', 'rua', 'ruan',
  'rui', 'run', 'ruo', 'sa', 'sai', 'san', 'sang', 'sao', 'se', 'sen',
  'seng', 'sha', 'shai', 'shan', 'shang', 'shao', 'she', 'shen', 'sheng', 'shi',
  'shou', 'shu', 'shua', 'shuai', 'shuan', 'shuang', 'shui', 'shun', 'shuo', 'si',
  'song', 'sou', 'su', 'suan', 'sui', 'sun', 'suo', 'ta', 'tai', 'tan',
  'tang', 'tao', 'te', 'teng', 'ti', 'tian', 'tiao', 'tie', 'ting', 'tong',
  'tou', 'tu', 'tuan', 'tui', 'tun', 'tuo', 'wa', 'wai', 'wan', 'wang',
  'wei', 'wen', 'weng', 'wo', 'wu', 'xi', 'xia', 'xian', 'xiang', 'xiao',
  'xie', 'xin', 'xing', 'xiong', 'xiu', 'xu', 'xuan', 'xue', 'xun', 'ya',
  'yan', 'yang', 'yao', 'ye', 'yi', 'yin', 'ying', 'yo', 'yong', 'you',
  'yu', 'yuan', 'yue', 'yun', 'za', 'zai', 'zan', 'zang', 'zao', 'ze',
  'zei', 'zen', 'zeng', 'zha', 'zhai', 'zhan', 'zhang', 'zhao', 'zhe', 'zhen',
  'zheng', 'zhi', 'zhong', 'zhou', 'zhu', 'zhua', 'zhuai', 'zhuan', 'zhuang', 'zhui',
  'zhun', 'zhuo', 'zi', 'zong', 'zou', 'zu', 'zuan', 'zui', 'zun', 'zuo',
  ''
];

const EXCEPTIONS = {
  '\u66FE': 'zeng', '\u6C88': 'shen', '\u55F2': 'dia', '\u78A1': 'zhou',
  '\u8052': 'guo', '\u7094': 'que', '\u86B5': 'ke', '\u7809': 'hua',
  '\u5B24': 'mo', '\u5B37': 'mo', '\u8E52': 'pan', '\u8E4A': 'xi',
  '\u4E2C': 'pan', '\u9730': 'xian', '\u8398': 'xin', '\u8C49': 'chi',
  '\u9967': 'xing', '\u7B60': 'jun', '\u957F': 'chang', '\u5E27': 'zhen',
  '\u5CD9': 'shi', '\u90CD': 'na', '\u828E': 'xiong', '\u8C01': 'shui',
  '了': 'le', '的': 'de', '着': 'zhe', '著': 'zhe', '都': 'dou', '有': 'you',
  '会': 'hui', '會': 'hui', '为': 'wei', '為': 'wei', '以': 'yi', '与': 'yu',
  '與': 'yu', '只': 'zhi', '差': 'cha', '没': 'mei', '沒': 'mei', '说': 'shuo',
  '說': 'shuo', '话': 'hua', '話': 'hua', '行': 'xing', '乐': 'le', '樂': 'le',
  '给': 'gei', '給': 'gei', '得': 'de', '还': 'hai', '還': 'hai', '底': 'di',
  '么': 'me', '麼': 'me', '什': 'shen', '哪': 'na', '那': 'na', '这': 'zhe',
  '這': 'zhe', '看': 'kan', '见': 'jian', '見': 'jian', '爱': 'ai', '愛': 'ai',
  '心': 'xin', '梦': 'meng', '夢': 'meng', '风': 'feng', '風': 'feng',
  '雨': 'yu', '雪': 'xue', '海': 'hai', '天': 'tian', '地': 'de', '歌': 'ge',
  '声': 'sheng', '聲': 'sheng', '音': 'yin', '泪': 'lei', '淚': 'lei'
};

const COMPOUND_WORDS = {
  '音乐': ['yin', 'yue'], '音樂': ['yin', 'yue'], '乐曲': ['yue', 'qu'], '樂曲': ['yue', 'qu'],
  '乐队': ['yue', 'dui'], '樂隊': ['yue', 'dui'], '乐器': ['yue', 'qi'], '樂器': ['yue', 'qi'],
  '奏乐': ['zou', 'yue'], '奏樂': ['zou', 'yue'], '乐谱': ['yue', 'pu'], '樂譜': ['yue', 'pu'],
  '快乐': ['kuai', 'le'], '快樂': ['kuai', 'le'], '乐观': ['le', 'guan'], '樂觀': ['le', 'guan'],
  '乐趣': ['le', 'qu'], '樂趣': ['le', 'qu'], '可乐': ['ke', 'le'], '可樂': ['ke', 'le'],

  '重新': ['chong', 'xin'], '重复': ['chong', 'fu'], '重複': ['chong', 'fu'],
  '重来': ['chong', 'lai'], '重來': ['chong', 'lai'], '重逢': ['chong', 'feng'],
  '重温': ['chong', 'wen'], '重溫': ['chong', 'wen'], '重现': ['chong', 'xian'], '重現': ['chong', 'xian'],
  '重要': ['zhong', 'yao'], '沉重': ['chen', 'zhong'], '沈重': ['chen', 'zhong'],
  '重点': ['zhong', 'dian'], '重點': ['zhong', 'dian'], '重量': ['zhong', 'liang'],

  '长大': ['zhang', 'da'], '長大': ['zhang', 'da'], '成长': ['cheng', 'zhang'], '成長': ['cheng', 'zhang'],
  '长辈': ['zhang', 'bei'], '長輩': ['zhang', 'bei'], '长相': ['zhang', 'xiang'], '長相': ['zhang', 'xiang'],
  '很长': ['hen', 'chang'], '很長': ['hen', 'chang'], '长江': ['chang', 'jiang'], '長江': ['chang', 'jiang'],
  '长久': ['chang', 'jiu'], '長久': ['chang', 'jiu'], '长夜': ['chang', 'ye'], '長夜': ['chang', 'ye'],

  '银行': ['yin', 'hang'], '銀行': ['yin', 'hang'], '行业': ['hang', 'ye'], '行業': ['hang', 'ye'],
  '行列': ['hang', 'lie'], '行动': ['xing', 'dong'], '行動': ['xing', 'dong'],
  '行人': ['xing', 'ren'], '行走': ['xing', 'zou'], '流行': ['liu', 'xing'], '旅行': ['lv', 'xing'],

  '睡着': ['shui', 'zhao'], '睡著': ['shui', 'zhao'], '着急': ['zhao', 'ji'], '著急': ['zhao', 'ji'],
  '着迷': ['zhao', 'mi'], '著迷': ['zhao', 'mi'], '看着': ['kan', 'zhe'], '看著': ['kan', 'zhe'],
  '听着': ['ting', 'zhe'], '聽著': ['ting', 'zhe'], '笑着': ['xiao', 'zhe'], '笑著': ['xiao', 'zhe'],
  '走着': ['zou', 'zhe'], '走著': ['zou', 'zhe'], '跟着': ['gen', 'zhe'], '跟著': ['gen', 'zhe'],

  '觉得': ['jue', 'de'], '覺得': ['jue', 'de'], '记得': ['ji', 'de'], '記得': ['ji', 'de'],
  '懂得': ['dong', 'de'], '舍不得': ['she', 'bu', 'de'], '捨不得': ['she', 'bu', 'de'],
  '得到': ['de', 'dao'], '获得': ['huo', 'de'], '獲得': ['huo', 'de'],

  '睡觉': ['shui', 'jiao'], '睡覺': ['shui', 'jiao'], '午觉': ['wu', 'jiao'], '午覺': ['wu', 'jiao'],
  '感觉': ['gan', 'jue'], '感覺': ['gan', 'jue'], '发觉': ['fa', 'jue'], '發覺': ['fa', 'jue'],

  '还有': ['hai', 'you'], '還有': ['hai', 'you'], '还是': ['hai', 'shi'], '還是': ['hai', 'shi'],
  '还要': ['hai', 'yao'], '還要': ['hai', 'yao'], '还好': ['hai', 'hao'], '還好': ['hai', 'hao'],
  '归还': ['gui', 'huan'], '歸還': ['gui', 'huan'], '还钱': ['huan', 'qian'], '還錢': ['huan', 'qian'],

  '头发': ['tou', 'fa'], '頭髮': ['tou', 'fa'], '理发': ['li', 'fa'], '理髮': ['li', 'fa'],
  '白发': ['bai', 'fa'], '白髮': ['bai', 'fa'], '出发': ['chu', 'fa'], '出發': ['chu', 'fa'],
  '发生': ['fa', 'sheng'], '發生': ['fa', 'sheng'], '发现': ['fa', 'xian'], '發現': ['fa', 'xian'],

  '方便': ['fang', 'bian'], '随便': ['sui', 'bian'], '隨便': ['sui', 'bian'], '便宜': ['pian', 'yi'],

  '因为': ['yin', 'wei'], '因為': ['yin', 'wei'], '为了': ['wei', 'le'], '為了': ['wei', 'le'],
  '为什么': ['wei', 'shen', 'me'], '為什麼': ['wei', 'shen', 'me'], '成为': ['cheng', 'wei'], '成為': ['cheng', 'wei']
};

let COLLATOR = null;
try {
  COLLATOR = new Intl.Collator(['zh-Hans-CN', 'zh-CN']);
} catch (_) {
  COLLATOR = null;
}

const FIRST_PINYIN_UNIHAN = '\u963F';
const LAST_PINYIN_UNIHAN = '\u9FFF';

export class PinyinRomanizer {
  /**
   * Retrieves the Pinyin for a single Chinese character using binary search over ICU boundaries.
   * @param {string} ch
   * @returns {string}
   */
  static getSinglePinyin(ch) {
    if (EXCEPTIONS[ch]) return EXCEPTIONS[ch];
    if (ch.charCodeAt(0) < 256) return ch;
    if (!COLLATOR) return ch;

    let cmp = COLLATOR.compare(ch, FIRST_PINYIN_UNIHAN);
    if (cmp < 0) return ch;
    if (cmp === 0) return PINYINS[0];

    cmp = COLLATOR.compare(ch, LAST_PINYIN_UNIHAN);
    if (cmp > 0) return ch;
    if (cmp === 0) return PINYINS[UNIHANS.length - 1];

    let begin = 0;
    let end = UNIHANS.length - 1;
    let offset = -1;

    while (begin <= end) {
      offset = ~~((begin + end) / 2);
      const unihan = UNIHANS[offset];
      cmp = COLLATOR.compare(ch, unihan);
      if (cmp === 0) break;
      if (cmp > 0) begin = offset + 1;
      else end = offset - 1;
    }

    if (cmp < 0) offset--;
    return PINYINS[offset] || ch;
  }

  /**
   * Romanizes Chinese text to Pinyin using polyphonic compound phrases and ICU collation boundaries.
   * @param {string} text
   * @param {string} [lineContext]
   * @returns {string}
   */
  static romanize(text, lineContext = '') {
    if (!text) return '';

    if (text.length === 1 && lineContext && lineContext.length > 1) {
      for (const [word, roms] of Object.entries(COMPOUND_WORDS)) {
        if (word.includes(text) && lineContext.includes(word)) {
          const idx = word.indexOf(text);
          return roms[idx];
        }
      }
    }

    let result = '';
    let i = 0;

    while (i < text.length) {
      let matched = false;
      for (let len = 4; len >= 2; len--) {
        if (i + len <= text.length) {
          const sub = text.substring(i, i + len);
          if (COMPOUND_WORDS[sub]) {
            const roms = COMPOUND_WORDS[sub].join(' ');
            if (result.length > 0 && /[a-zA-Z]$/.test(result)) {
              result += ' ' + roms;
            } else {
              result += roms;
            }
            i += len;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      const ch = text[i];
      const py = this.getSinglePinyin(ch);

      if (result.length > 0 && /[a-zA-Z]$/.test(result) && /[a-zA-Z]/.test(py)) {
        result += ' ' + py;
      } else {
        result += py;
      }
      i++;
    }

    return result;
  }
}
