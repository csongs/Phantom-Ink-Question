import { describe, it, expect } from 'vitest';
import { answerLocaleCheckPrompt, formatDesignerPrompt, QUESTION_BANK } from './prompts';

describe('formatDesignerPrompt', () => {
  it('builds a solvability-first designer prompt without difficulty-ramp rules', () => {
    const { system, user } = formatDesignerPrompt('鋼琴', { numQuestions: 10 });
    expect(system).toContain('選出最適合的10個問題');
    // Difficulty-ramp language was intentionally removed — clues should be
    // solvable, not artificially hard.
    expect(system).not.toContain('由難到易');
    expect(system).not.toContain('不能讓一般人直接猜出');
    expect(system).toContain('有效線索');
    expect(user).toContain('謎底：鋼琴');
  });

  it('samples at most 30 questions from the bank into the system prompt', () => {
    const { system } = formatDesignerPrompt('鋼琴', { numQuestions: 10 });
    const bankLines = system.split('\n').filter((line) => line.startsWith('- '));
    expect(bankLines.length).toBeLessThanOrEqual(30);
    expect(bankLines.length).toBeGreaterThan(0);
  });

  it('every sampled question actually comes from QUESTION_BANK', () => {
    const { system } = formatDesignerPrompt('鋼琴', { numQuestions: 10 });
    const bankLines = system
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    for (const line of bankLines) {
      expect(QUESTION_BANK).toContain(line);
    }
  });

  it('has 112 entries in the question bank, matching the Python source', () => {
    expect(QUESTION_BANK.length).toBe(112);
  });
});

describe('formatDesignerPrompt question-setup options', () => {
  it('sizes the candidate pool to numCandidates', () => {
    const { system } = formatDesignerPrompt('鋼琴', { numQuestions: 8, numCandidates: 12 });
    const poolLines = system.split('\n').filter((l) => l.startsWith('- '));
    // 12 pool lines + however many forced-list lines (0 here).
    expect(poolLines.length).toBe(12);
  });

  it('includes every forced question in both the pool and the mandatory block', () => {
    const forced = ['它是何種顏色？', '我的自訂題目？'];
    const { system } = formatDesignerPrompt('鋼琴', {
      numQuestions: 8, numCandidates: 12, forcedQuestions: forced,
    });
    for (const q of forced) {
      expect(system).toContain(q);
    }
    expect(system).toContain('必須使用的題目');
  });

  it('defaults to a 30-question pool and no mandatory block', () => {
    const { system } = formatDesignerPrompt('鋼琴');
    const poolLines = system.split('\n').filter((l) => l.startsWith('- '));
    expect(poolLines.length).toBe(30);
    expect(system).not.toContain('必須使用的題目');
  });
});

describe('answerLocaleCheckPrompt', () => {
  it('asks whether the given answer is Mainland-Chinese wording and includes it in the prompt', () => {
    const prompt = answerLocaleCheckPrompt('鼠標');
    expect(prompt).toContain('鼠標');
    expect(prompt).toContain('中國大陸');
    expect(prompt).toContain('is_mainland_term');
  });
});
