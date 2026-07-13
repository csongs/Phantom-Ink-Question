// web/src/groupPaste.test.ts
import { describe, it, expect } from 'vitest';
import { parseGroupedQuestions, matchToBank, normalizeQuestion } from './groupPaste';
import { QUESTION_BANK } from './generator/prompts';

const SAMPLE = `第 1 組
如果暫時沒有它，可以用什麼替代？
有什麼東西的危險程度與它相仿？
它的重量和什麼相仿？

第 2 組
什麼專有名詞與它相關性最高？
若無外力介入，它的壽命有多長？
您能在哪個大洲或地區找到最多的它？

第 3 組
它的任何一個字的部首是什麼？
什麼其他物品常和它一起出現？
它屬於何種類別？

第 4 組
它的用途為何？
當它死亡、損壞或不再有用時，會去哪裡？
什麼現象或狀況與它相關性最高？

第 5 組
人們和它產生互動時，常用什麼動詞來描述？
什麼東西可能在它的外層包裝、覆蓋或遮蔽它？
何種課程或科系與它相關性最高？

第 6 組
沒有外物輔助下，您可以單手拿幾個它？
它會引起何種情緒？
什麼會改變它？

第 7 組
什麼狀況可能對它造成威脅或危險？
它存放在哪裡？
它如何移動？`;

describe('parseGroupedQuestions', () => {
  it('parses the 7-group sample into 21 tagged questions', () => {
    const { items, errors } = parseGroupedQuestions(SAMPLE);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(21);
    expect(items[0]).toEqual({ group: 1, index: 1, text: '如果暫時沒有它，可以用什麼替代？' });
    expect(items[8]).toEqual({ group: 3, index: 3, text: '它屬於何種類別？' });
    expect(items[20]).toEqual({ group: 7, index: 3, text: '它如何移動？' });
  });

  it('accepts 第1組 / 第１組 / 第一組 header variants', () => {
    for (const header of ['第1組', '第１組', '第一組']) {
      const { items } = parseGroupedQuestions(`${header}\n它的用途為何？`);
      expect(items).toEqual([{ group: 1, index: 1, text: '它的用途為何？' }]);
    }
  });

  it('reports lines before any group header and empty input', () => {
    const { items, errors } = parseGroupedQuestions('它的用途為何？');
    expect(items).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reports the same question appearing in two groups', () => {
    const { errors } = parseGroupedQuestions('第 1 組\n它的用途為何？\n\n第 2 組\n它的用途為何？');
    expect(errors.some((e) => e.includes('同時出現'))).toBe(true);
  });

  it('strips leading list numbering like "1. " / "1、" / "(1) " so bank matching still works', () => {
    const raw = `第 1 組
1. 它的次要材料是什麼？
2. 您在一天中的何時使用它？
3. 您在何處使用它？

第 2 組
1. 它的別名為何？
2. 它曾出現在什麼書、電影或電視節目中？
3. 您最有可能在何種商店找到它？`;
    const { items, errors } = parseGroupedQuestions(raw);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { group: 1, index: 1, text: '它的次要材料是什麼？' },
      { group: 1, index: 2, text: '您在一天中的何時使用它？' },
      { group: 1, index: 3, text: '您在何處使用它？' },
      { group: 2, index: 1, text: '它的別名為何？' },
      { group: 2, index: 2, text: '它曾出現在什麼書、電影或電視節目中？' },
      { group: 2, index: 3, text: '您最有可能在何種商店找到它？' },
    ]);

    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(6);
  });
});

describe('matchToBank', () => {
  it('matches all 21 sample questions against the bank', () => {
    const { items } = parseGroupedQuestions(SAMPLE);
    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(21);
    // bankQuestion 是題庫原文
    for (const m of matched) expect(QUESTION_BANK).toContain(m.bankQuestion);
  });

  it('matches despite half-width question mark, and routes unknown text to unmatched', () => {
    const { items } = parseGroupedQuestions('第 1 組\n它存放在哪裡?\n這題不在題庫裡？');
    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);
    expect(matched).toHaveLength(1);
    expect(matched[0].bankQuestion).toBe('它存放在哪裡？');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].text).toBe('這題不在題庫裡？');
  });
});

describe('normalizeQuestion', () => {
  it('strips spaces and trailing question marks', () => {
    expect(normalizeQuestion('它 存放在哪裡？')).toBe('它存放在哪裡');
    expect(normalizeQuestion('它存放在哪裡?')).toBe('它存放在哪裡');
  });
});
