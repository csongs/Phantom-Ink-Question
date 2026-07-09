// web/src/main.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { toGameQuestions, describeGenerationError, showSettingsScreen } from './main';

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

describe('settings screen question-setup', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; localStorage.clear(); });

  it('renders the question-setup section', () => {
    const root = document.getElementById('app')!;
    showSettingsScreen(root);
    expect(root.querySelector('#pi-num-candidates')).toBeTruthy();
    expect(root.querySelector('#pi-num-questions')).toBeTruthy();
    expect(root.querySelector('.pi-bank-list')).toBeTruthy();
  });

  it('disables 開始遊戲 while the setup is invalid', () => {
    const root = document.getElementById('app')!;
    showSettingsScreen(root);
    (root.querySelector('#pi-apikey') as HTMLInputElement).value = 'k';
    // Make it invalid: used count below forced.
    (root.querySelector('#pi-num-questions') as HTMLInputElement).value = '1';
    root.querySelectorAll<HTMLInputElement>('.pi-bank-item input').forEach((cb, i) => {
      if (i < 2) { cb.checked = true; }
    });
    root.querySelector('.pi-bank-list')?.dispatchEvent(new Event('change', { bubbles: true }));
    const start = root.querySelector('#pi-start') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('does NOT render the group-paste area in player mode', () => {
    // 使用者要求:玩家模式不需要「貼上題組」(那是出題者才需要的)。
    const root = document.getElementById('app')!;
    showSettingsScreen(root);
    const pasteArea = root.querySelector('.pi-group-paste-area') as HTMLElement;
    expect(pasteArea).toBeTruthy();
    expect(pasteArea.style.display).toBe('none');
    expect(root.querySelector('.pi-group-paste')).toBeTruthy(); // 元素仍在(只是隱藏)
    expect(root.querySelector('.pi-group-parse')).toBeTruthy();
  });
});
