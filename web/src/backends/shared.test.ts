// web/src/backends/shared.test.ts
import { describe, it, expect } from 'vitest';
import { extractJson } from './shared';

describe('extractJson', () => {
  it('extracts JSON from a fenced ```json code block', () => {
    const text = 'here you go:\n```json\n{"a": 1}\n```\nthanks';
    expect(extractJson(text)).toBe('{"a": 1}');
  });

  it('extracts JSON from a fenced code block with no language tag', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJson(text)).toBe('{"a": 1}');
  });

  it('extracts a balanced brace object with no fencing', () => {
    const text = 'sure, {"a": {"b": 1}} is the answer';
    expect(extractJson(text)).toBe('{"a": {"b": 1}}');
  });

  it('returns the original text unchanged if no JSON object is found', () => {
    expect(extractJson('no json here')).toBe('no json here');
  });
});
