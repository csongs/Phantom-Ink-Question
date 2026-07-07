import { pinyin } from 'pinyin-pro';
import { p2z } from 'pinyin-to-zhuyin';

const HAN_CHAR = /[一-鿿]/;
const TONE_MARKS = new Set(['ˊ', 'ˋ', 'ˇ', '˙']);

// Polyphonic word disambiguation dictionary.
// Key: multi-character word, Value: correct pinyin (tone-number style).
// Covers common cases where pinyin-pro lacks context awareness.
const POLYPHONIC_WORDS: Record<string, string[]> = {
  // 樂 yuè / lè
  '音樂': ['yin1', 'yue4'],
  '樂器': ['yue4', 'qi4'],
  '樂團': ['yue4', 'tuan2'],
  '樂章': ['yue4', 'zhang1'],
  '樂譜': ['yue4', 'pu3'],
  '樂曲': ['yue4', 'qu3'],
  '聲樂': ['sheng1', 'yue4'],
  '器樂': ['qi4', 'yue4'],
  '民樂': ['min2', 'yue4'],
  '交響樂': ['jiao1', 'xiang3', 'yue4'],
  '管弦樂': ['guan3', 'xian2', 'yue4'],
  '爵士樂': ['jue2', 'shi4', 'yue4'],
  '快樂': ['kuai4', 'le4'],
  '娛樂': ['yu2', 'le4'],
  '樂意': ['le4', 'yi4'],
  '樂觀': ['le4', 'guan1'],
  '樂趣': ['le4', 'qu4'],
  '樂於': ['le4', 'yu2'],
  '享樂': ['xiang3', 'le4'],
  // 行 xíng / háng
  '行動': ['xing2', 'dong4'],
  '行為': ['xing2', 'wei2'],
  '行走': ['xing2', 'zou3'],
  '進行': ['jin4', 'xing2'],
  '自行': ['zi4', 'xing2'],
  '銀行': ['yin2', 'hang2'],
  '行列': ['hang2', 'lie4'],
  '行業': ['hang2', 'ye4'],
  '同行': ['tong2', 'hang2'],
  '本行': ['ben3', 'hang2'],
  '外行': ['wai4', 'hang2'],
  // 重 zhòng / chóng
  '重要': ['zhong4', 'yao4'],
  '重量': ['zhong4', 'liang4'],
  '重點': ['zhong4', 'dian3'],
  '重大': ['zhong4', 'da4'],
  '重新': ['chong2', 'xin1'],
  '重複': ['chong2', 'fu4'],
  '重來': ['chong2', 'lai2'],
  '重現': ['chong2', 'xian4'],
  // 長 cháng / zhǎng
  '長度': ['chang2', 'du4'],
  '長期': ['chang2', 'qi1'],
  '成長': ['cheng2', 'zhang3'],
  '長大': ['zhang3', 'da4'],
  '校長': ['xiao4', 'zhang3'],
  '會長': ['hui4', 'zhang3'],
  '部長': ['bu4', 'zhang3'],
  '市長': ['shi4', 'zhang3'],
  // 了 le / liǎo
  '了解': ['liao3', 'jie3'],
  '了結': ['liao3', 'jie2'],
  '了不起': ['liao3', 'bu5', 'qi3'],
  '受不了': ['shou4', 'bu5', 'liao3'],
  // 覺 jué / jiào
  '感覺': ['gan3', 'jue2'],
  '覺得': ['jue2', 'de5'],
  '知覺': ['zhi1', 'jue2'],
  '視覺': ['shi4', 'jue2'],
  '睡覺': ['shui4', 'jiao4'],
  '午覺': ['wu3', 'jiao4'],
  // 好 hǎo / hào
  '好奇': ['hao4', 'qi2'],
  '愛好': ['ai4', 'hao4'],
  '好學': ['hao4', 'xue2'],
  '好客': ['hao4', 'ke4'],
  // 便 biàn / pián
  '方便': ['fang1', 'bian4'],
  '便利': ['bian4', 'li4'],
  '隨便': ['sui2', 'bian4'],
  '便宜': ['pian2', 'yi5'],
  // 彈 dàn / tán
  '彈琴': ['tan2', 'qin2'],
  '彈鋼琴': ['tan2', 'gang1', 'qin2'],
  '彈性': ['tan2', 'xing4'],
  '彈力': ['tan2', 'li4'],
  '子彈': ['zi3', 'dan4'],
  '炸彈': ['zha4', 'dan4'],
  '導彈': ['dao3', 'dan4'],
  // 興 xīng / xìng
  '興奮': ['xing1', 'fen4'],
  '興起': ['xing1', 'qi3'],
  '復興': ['fu4', 'xing1'],
  '興趣': ['xing4', 'qu4'],
  '興致': ['xing4', 'zhi4'],
  '高興': ['gao1', 'xing4'],
  // 著 zhe / zháo / zhuó
  '看著': ['kan4', 'zhe5'],
  '聽著': ['ting1', 'zhe5'],
  '想著': ['xiang3', 'zhe5'],
  '睡著': ['shui4', 'zhao2'],
  '著急': ['zhao1', 'ji2'],
  '著火': ['zhao2', 'huo3'],
  '著裝': ['zhuo2', 'zhuang1'],
  '衣著': ['yi1', 'zhuo2'],
  '著色': ['zhuo2', 'se4'],
  // 的 de / dí / dì
  '的確': ['di2', 'que4'],
  '目的': ['mu4', 'di4'],
  // 發 fā / fà
  '發現': ['fa1', 'xian4'],
  '發明': ['fa1', 'ming2'],
  '頭髮': ['tou2', 'fa4'],
  '毛髮': ['mao2', 'fa4'],
  // 朝 cháo / zhāo
  '朝代': ['chao2', 'dai4'],
  '朝向': ['chao2', 'xiang4'],
  '朝陽': ['zhao1', 'yang2'],
  '朝夕': ['zhao1', 'xi1'],
  // 間 jiān / jiàn
  '中間': ['zhong1', 'jian1'],
  '空間': ['kong1', 'jian1'],
  '時間': ['shi2', 'jian1'],
  '間接': ['jian4', 'jie1'],
  '間隔': ['jian4', 'ge2'],
  // 降 jiàng / xiáng
  '下降': ['xia4', 'jiang4'],
  '降落': ['jiang4', 'luo4'],
  '降臨': ['jiang4', 'lin2'],
  '投降': ['tou2', 'xiang2'],
  // 會 huì / kuài
  '會計': ['kuai4', 'ji4'],
  '會議': ['hui4', 'yi4'],
  '機會': ['ji1', 'hui4'],
  // 鬥 dòu / dǒu
  '鬥爭': ['dou4', 'zheng1'],
  '戰鬥': ['zhan4', 'dou4'],
  '奮鬥': ['fen4', 'dou4'],
  '北斗': ['bei3', 'dou3'],
  // 背 bèi / bēi
  '背後': ['bei4', 'hou4'],
  '背景': ['bei4', 'jing3'],
  '背包': ['bei1', 'bao1'],
  '背負': ['bei1', 'fu4'],
  // 藏 cáng / zàng
  '收藏': ['shou1', 'cang2'],
  '隱藏': ['yin3', 'cang2'],
  '西藏': ['xi1', 'zang4'],
  '寶藏': ['bao3', 'zang4'],
  // 傳 chuán / zhuàn
  '傳統': ['chuan2', 'tong3'],
  '傳遞': ['chuan2', 'di4'],
  '傳播': ['chuan2', 'bo1'],
  '自傳': ['zi4', 'zhuan4'],
  // 格 gé (most common), but keep for 格格 etc
  '性格': ['xing4', 'ge2'],
  '價格': ['jia4', 'ge2'],
  '格式': ['ge2', 'shi4'],
};

function syllToZhuyin(syllable: string): string {
  let s = syllable;
  if (s.endsWith('0')) {
    s = s.slice(0, -1) + '5';
  }
  let zhuyin = p2z(s, { tonemarks: true });
  if (zhuyin.startsWith('˙')) {
    zhuyin = zhuyin.slice(1) + '˙';
  }
  const lastChar = zhuyin[zhuyin.length - 1];
  if (!TONE_MARKS.has(lastChar)) {
    zhuyin = zhuyin + 'ˉ';
  }
  return zhuyin;
}

function toBopomofoSyllables(text: string): string[] {
  if (!text) return [];
  const chars = Array.from(text);

  // --- polyphonic-word phase ---
  // Resolve pinyin for each index; null means "use pinyin-pro default"
  const resolved: (string | null)[] = new Array(chars.length).fill(null);

  // Sort polyphonic keys by length descending so longer matches win
  const polyKeys = Object.keys(POLYPHONIC_WORDS).sort((a, b) => b.length - a.length);

  let i = 0;
  while (i < chars.length) {
    if (!HAN_CHAR.test(chars[i])) { i++; continue; }

    let matched = false;
    for (const key of polyKeys) {
      if (text.slice(i, i + key.length) === key) {
        const pinyins = POLYPHONIC_WORDS[key];
        for (let j = 0; j < pinyins.length; j++) {
          resolved[i + j] = pinyins[j];
        }
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      i++;
    }
  }

  // Get default pinyin for any unresolved chars
  const unresolvedIndices: number[] = [];
  for (let j = 0; j < chars.length; j++) {
    if (HAN_CHAR.test(chars[j]) && resolved[j] === null) {
      unresolvedIndices.push(j);
    }
  }

  let defaultPinyins: string[] = [];
  if (unresolvedIndices.length > 0) {
    const sub = unresolvedIndices.map((idx) => chars[idx]).join('');
    defaultPinyins = pinyin(sub, { toneType: 'num', type: 'array' }) as string[];
  }

  // Merge resolved + default
  let di = 0;
  const result: string[] = [];
  for (let j = 0; j < chars.length; j++) {
    if (!HAN_CHAR.test(chars[j])) continue;
    const s = resolved[j] ?? defaultPinyins[di++];
    result.push(syllToZhuyin(s));
  }

  return result;
}

export function toBopomofo(text: string): string {
  return toBopomofoSyllables(text).join(' ');
}

export function toBopomofoCells(text: string): string[] {
  return toBopomofoSyllables(text).join('').split('');
}

export function revealBopomofo(text: string, cellsToReveal: number): string {
  const cells = toBopomofoCells(text);
  const revealedCount = Math.min(cellsToReveal, cells.length);
  return cells.map((cell, i) => (i < revealedCount ? cell : '▢')).join(' ');
}

export function countBopomofoCells(text: string): number {
  return toBopomofoCells(text).length;
}

export function hasBopomofo(text: string): boolean {
  if (!HAN_CHAR.test(text)) return false;
  return toBopomofoCells(text).length > 0;
}
