import { describe, it, expect } from 'vitest';
import { formatDesignerPrompt, QUESTION_BANK } from './prompts';

describe('formatDesignerPrompt', () => {
  it('builds a solvability-first designer prompt without difficulty-ramp rules', () => {
    const { system, user } = formatDesignerPrompt('鋼琴', 10);
    expect(system).toContain('選出最適合的10個問題');
    // Difficulty-ramp language was intentionally removed — clues should be
    // solvable, not artificially hard.
    expect(system).not.toContain('由難到易');
    expect(system).not.toContain('不能讓一般人直接猜出');
    expect(system).toContain('有效線索');
    expect(user).toContain('謎底：鋼琴');
  });

  it('samples at most 30 questions from the bank into the system prompt', () => {
    const { system } = formatDesignerPrompt('鋼琴', 10);
    const bankLines = system.split('\n').filter((line) => line.startsWith('- '));
    expect(bankLines.length).toBeLessThanOrEqual(30);
    expect(bankLines.length).toBeGreaterThan(0);
  });

  it('every sampled question actually comes from QUESTION_BANK', () => {
    const { system } = formatDesignerPrompt('鋼琴', 10);
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
