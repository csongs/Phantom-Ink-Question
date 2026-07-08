import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, clearSettings, validateQuestionSetup } from './settings';

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadSettings()).toBeNull();
  });

  it('round-trips saved settings through localStorage', () => {
    saveSettings({ backend: 'groq', apiKey: 'gsk_abc', model: 'qwen/qwen3-32b' });
    expect(loadSettings()).toEqual({ backend: 'groq', apiKey: 'gsk_abc', model: 'qwen/qwen3-32b' });
  });

  it('returns null if the stored value is corrupted JSON', () => {
    localStorage.setItem('phantom-ink-settings', 'not json');
    expect(loadSettings()).toBeNull();
  });

  it('removes the stored settings on clearSettings', () => {
    saveSettings({ backend: 'hf', apiKey: 'hf_abc', model: '' });
    clearSettings();
    expect(loadSettings()).toBeNull();
  });
});

describe('validateQuestionSetup', () => {
  const base = { numCandidates: 30, numQuestions: 10, pickedCount: 0, customCount: 0, bankSize: 112 };

  it('accepts the defaults', () => {
    expect(validateQuestionSetup(base)).toEqual({ ok: true });
  });

  it('rejects when used count is less than forced (M < X+C)', () => {
    const r = validateQuestionSetup({ ...base, numQuestions: 4, pickedCount: 3, customCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('使用題數量');
  });

  it('accepts when used count equals forced (M = X+C)', () => {
    expect(validateQuestionSetup({ ...base, numQuestions: 5, pickedCount: 3, customCount: 2 }).ok).toBe(true);
  });

  it('accepts when used count is exactly one more than forced', () => {
    expect(validateQuestionSetup({ ...base, numQuestions: 6, pickedCount: 3, customCount: 2 }).ok).toBe(true);
  });

  it('rejects when pool does not exceed used (N <= M)', () => {
    const r = validateQuestionSetup({ ...base, numCandidates: 10, numQuestions: 10 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('選題數量');
  });

  it('rejects when pool exceeds available candidates (N > bankSize + C)', () => {
    const r = validateQuestionSetup({ ...base, numCandidates: 113, customCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('選題數量最多');
  });

  it('allows the pool to reach exactly bankSize + C', () => {
    expect(validateQuestionSetup({ ...base, numCandidates: 114, numQuestions: 10, customCount: 2 }).ok).toBe(true);
  });

  it('rejects non-positive or non-integer counts', () => {
    expect(validateQuestionSetup({ ...base, numQuestions: 0 }).ok).toBe(false);
    expect(validateQuestionSetup({ ...base, numCandidates: 2.5 }).ok).toBe(false);
  });
});

describe('settings persistence of question-setup fields', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips the new fields', () => {
    saveSettings({
      backend: 'groq', apiKey: 'k', model: '',
      numCandidates: 20, numQuestions: 8,
      pickedBankQuestions: ['它是何種顏色？'], customQuestions: ['它配什麼飲料？'],
    });
    expect(loadSettings()).toEqual({
      backend: 'groq', apiKey: 'k', model: '',
      numCandidates: 20, numQuestions: 8,
      pickedBankQuestions: ['它是何種顏色？'], customQuestions: ['它配什麼飲料？'],
    });
  });
});
