// web/src/main.test.ts
import { describe, it, expect } from 'vitest';
import { toGameQuestions, describeGenerationError } from './main';

describe('toGameQuestions', () => {
  it('converts generator output into cell data the game understands, with a trailing period cell', () => {
    const result = toGameQuestions([{ question: '它是何種顏色？', reply: '通常是黑色或白色。' }]);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('它是何種顏色？');
    expect(result[0].cells[result[0].cells.length - 1]).toBe('。');
    expect(result[0].total).toBe(result[0].cells.length);
  });

  it('does not add a period cell when the reply has none', () => {
    const result = toGameQuestions([{ question: 'Q', reply: '沒有句號' }]);
    expect(result[0].cells[result[0].cells.length - 1]).not.toBe('。');
  });
});

describe('describeGenerationError', () => {
  it('shows a CORS-specific fallback message for a generic fetch TypeError', () => {
    // Browsers deliberately hide the real reason a fetch was blocked by CORS from
    // JavaScript — it always surfaces as a bare TypeError with a message like
    // "Failed to fetch" (Chrome) or "NetworkError when attempting to fetch resource." (Firefox).
    const err = new TypeError('Failed to fetch');
    expect(describeGenerationError(err)).toContain('無法直接連線');
  });

  it('passes through a normal Error message unchanged', () => {
    const err = new Error('Groq API error (401): invalid key');
    expect(describeGenerationError(err)).toBe('Groq API error (401): invalid key');
  });

  it('stringifies a non-Error throw value', () => {
    expect(describeGenerationError('boom')).toBe('boom');
  });
});
