import { describe, it, expect } from 'vitest';
import { renderQuestionSetup, readQuestionSetup, refreshSetupValidity } from './questionSetup';
import { QUESTION_BANK } from './generator/prompts';

function mount(initial?: Parameters<typeof renderQuestionSetup>[1], options?: Parameters<typeof renderQuestionSetup>[2]): HTMLElement {
  const el = document.createElement('div');
  renderQuestionSetup(el, initial, options);
  document.body.appendChild(el);
  return el;
}

describe('questionSetup', () => {
  it('renders N and M inputs with defaults', () => {
    const el = mount();
    expect((el.querySelector('#pi-num-candidates') as HTMLInputElement).value).toBe('30');
    expect((el.querySelector('#pi-num-questions') as HTMLInputElement).value).toBe('10');
  });

  it('renders a checkbox for every bank question', () => {
    const el = mount();
    expect(el.querySelectorAll('.pi-bank-item input[type="checkbox"]').length).toBe(QUESTION_BANK.length);
  });

  it('reads only checked bank questions and non-empty custom rows', () => {
    const el = mount({
      pickedBankQuestions: [QUESTION_BANK[0]],
      customQuestions: ['自訂一', ''],
    });
    const value = readQuestionSetup(el);
    expect(value.pickedBankQuestions).toEqual([QUESTION_BANK[0]]);
    expect(value.customQuestions).toEqual(['自訂一']);
  });

  it('marks an invalid config (M <= forced) and returns false', () => {
    const el = mount({ numQuestions: 1, pickedBankQuestions: [QUESTION_BANK[0], QUESTION_BANK[1]] });
    const ok = refreshSetupValidity(el);
    expect(ok).toBe(false);
    expect(el.querySelector('.pi-setup-warning')?.textContent).toContain('使用題數量');
  });

  it('reports valid for the defaults', () => {
    const el = mount();
    expect(refreshSetupValidity(el)).toBe(true);
  });

  it('清除按鈕 wipes bank checks, custom list, paste textarea, and groupTags', () => {
    // 使用者要求：「清除」必須一鍵把題庫勾選、自訂問題、貼上題組、解析結果全清。
    const el = mount({
      pickedBankQuestions: [QUESTION_BANK[0], QUESTION_BANK[1]],
      customQuestions: ['自訂A', '自訂B'],
      groupTags: [{ group: 1, index: 1, text: QUESTION_BANK[0] }],
    });

    // Sanity:清除前至少有勾選 + 自訂列 + 貼上區內容。
    expect(el.querySelectorAll('.pi-bank-item input:checked').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.pi-custom-row').length).toBeGreaterThan(0);
    const paste = el.querySelector<HTMLTextAreaElement>('.pi-group-paste')!;
    paste.value = '第 1 組\n某題？';
    expect(paste.value).not.toBe('');
    expect(el.dataset.groupTags).toBeDefined();

    // Click 清除。
    el.querySelector<HTMLButtonElement>('.pi-bank-clear')?.click();

    expect(el.querySelectorAll('.pi-bank-item input:checked').length).toBe(0);
    expect(el.querySelectorAll('.pi-custom-row').length).toBe(0);
    expect(paste.value).toBe('');
    expect(el.dataset.groupTags).toBeUndefined();
  });

  it('hides the group-paste area when mode is player', () => {
    // 使用者要求:玩家模式不需要「貼上題組」(那是出題者才需要的)。
    const el = mount({}, { mode: 'player' });
    const pasteArea = el.querySelector('.pi-group-paste-area') as HTMLElement;
    expect(pasteArea).toBeTruthy();
    expect(pasteArea.style.display).toBe('none');
  });

  it('shows the group-paste area when mode is host', () => {
    const el = mount({}, { mode: 'host' });
    const pasteArea = el.querySelector('.pi-group-paste-area') as HTMLElement;
    expect(pasteArea).toBeTruthy();
    expect(pasteArea.style.display).not.toBe('none');
    expect(el.querySelector('.pi-group-paste')).toBeTruthy();
  });
});
