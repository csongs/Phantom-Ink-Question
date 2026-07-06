import { describe, it, expect } from 'vitest';
import { toTraditional, convertPunctuation } from './zhconv';

describe('zhconv', () => {
  it('converts simplified characters to traditional', () => {
    expect(toTraditional('乐器行')).toBe('樂器行');
    expect(toTraditional('钢琴')).toBe('鋼琴');
  });

  it('leaves already-traditional text unchanged', () => {
    expect(toTraditional('鋼琴')).toBe('鋼琴');
  });

  it('does not translate vocabulary, only characters (matches zhconv.py scope)', () => {
    // 鼠标 -> 鼠標 (character conversion only), NOT 滑鼠 (that's a vocabulary swap,
    // which is out of scope for this function — it's handled by the LLM prompt instead).
    expect(toTraditional('鼠标')).toBe('鼠標');
  });

  it('converts halfwidth punctuation to fullwidth Chinese punctuation', () => {
    expect(convertPunctuation('你好.')).toBe('你好。');
    expect(convertPunctuation('真的?')).toBe('真的？');
    expect(convertPunctuation('一,二,三')).toBe('一，二，三');
    expect(convertPunctuation('甲:乙')).toBe('甲：乙');
    expect(convertPunctuation('甲;乙')).toBe('甲；乙');
    expect(convertPunctuation('哇!')).toBe('哇！');
  });

  it('leaves text with no matching punctuation unchanged', () => {
    expect(convertPunctuation('鋼琴')).toBe('鋼琴');
  });
});
