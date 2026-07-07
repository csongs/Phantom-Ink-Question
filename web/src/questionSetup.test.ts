import { describe, it, expect } from 'vitest';
import { renderQuestionSetup, readQuestionSetup, refreshSetupValidity } from './questionSetup';
import { QUESTION_BANK } from './generator/prompts';

function mount(initial?: Parameters<typeof renderQuestionSetup>[1]): HTMLElement {
  const el = document.createElement('div');
  renderQuestionSetup(el, initial);
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
});
