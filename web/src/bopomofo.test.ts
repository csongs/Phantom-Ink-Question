import { describe, it, expect } from 'vitest';
import {
  toBopomofo,
  toBopomofoCells,
  revealBopomofo,
  countBopomofoCells,
  hasBopomofo,
} from './bopomofo';

describe('bopomofo', () => {
  it('converts a basic word, matching known polyphonic readings', () => {
    const result = toBopomofo('乐器行');
    expect(result).toContain('ㄑㄧˋ');
    expect(result).toContain('ㄒㄧㄥˊ');
  });

  it('converts a single character', () => {
    expect(toBopomofo('钢')).toContain('ㄍ');
  });

  it('counts cells correctly for 鋼琴: 3 (first-tone 鋼, incl. explicit ˉ) + 4 (琴) = 7', () => {
    const cells = toBopomofoCells('钢琴');
    expect(cells).toEqual(['ㄍ', 'ㄤ', 'ˉ', 'ㄑ', 'ㄧ', 'ㄣ', 'ˊ']);
  });

  it('reveals a partial set of cells with a placeholder for the rest', () => {
    const revealed = revealBopomofo('钢琴', 3);
    expect(revealed).toContain('▢');
    const firstThree = revealed.split(' ').slice(0, 3);
    expect(firstThree).not.toContain('▢');
  });

  it('reveals all cells with no placeholder left', () => {
    const total = toBopomofoCells('钢琴').length;
    const revealed = revealBopomofo('钢琴', total);
    expect(revealed).not.toContain('▢');
  });

  it('counts cells for a three-character word', () => {
    expect(countBopomofoCells('演奏厅')).toBeGreaterThan(0);
  });

  it('detects text with convertible Chinese characters', () => {
    expect(hasBopomofo('钢琴')).toBe(true);
  });

  it('rejects pure Latin/digit text', () => {
    expect(hasBopomofo('ABC123')).toBe(false);
  });

  it('handles the empty string', () => {
    expect(countBopomofoCells('')).toBe(0);
  });

  it('drops non-Chinese characters from mixed content instead of misreading them', () => {
    expect(hasBopomofo('Hello世界')).toBe(true);
    // Same 7 cells as 钢琴 alone — the ABC suffix contributes nothing.
    expect(toBopomofoCells('钢琴ABC')).toEqual(['ㄍ', 'ㄤ', 'ˉ', 'ㄑ', 'ㄧ', 'ㄣ', 'ˊ']);
  });
});
