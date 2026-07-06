import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, clearSettings } from './settings';

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
