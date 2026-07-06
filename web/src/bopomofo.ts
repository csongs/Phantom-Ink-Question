import { pinyin } from 'pinyin-pro';
import { p2z } from 'pinyin-to-zhuyin';

const HAN_CHAR = /[一-鿿]/;
const TONE_MARKS = new Set(['ˊ', 'ˋ', 'ˇ', '˙']);

function toBopomofoSyllables(text: string): string[] {
  if (!text) return [];
  const chars = Array.from(text);
  const syllables = pinyin(text, { toneType: 'num', type: 'array' }) as string[];
  const result: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (!HAN_CHAR.test(chars[i])) continue;

    let syllable = syllables[i];
    if (syllable.endsWith('0')) {
      syllable = syllable.slice(0, -1) + '5';
    }

    let zhuyin = p2z(syllable, { tonemarks: true });
    if (zhuyin.startsWith('˙')) {
      zhuyin = zhuyin.slice(1) + '˙';
    }
    const lastChar = zhuyin[zhuyin.length - 1];
    if (!TONE_MARKS.has(lastChar)) {
      zhuyin = zhuyin + 'ˉ';
    }

    result.push(zhuyin);
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
