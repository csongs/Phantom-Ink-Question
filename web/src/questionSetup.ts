import { QUESTION_BANK } from './generator/prompts';
import { validateQuestionSetup } from './settings';
import { escapeHtml } from './game';

export interface QuestionSetupValue {
  numCandidates: number;
  numQuestions: number;
  pickedBankQuestions: string[];
  customQuestions: string[];
}

export function renderQuestionSetup(
  container: HTMLElement,
  initial: Partial<QuestionSetupValue> = {},
): void {
  const N = initial.numCandidates ?? 30;
  const M = initial.numQuestions ?? 10;
  const picked = new Set(initial.pickedBankQuestions ?? []);
  const customs = initial.customQuestions ?? [];

  const bankItems = QUESTION_BANK.map(
    (q) =>
      `<label class="pi-bank-item"><input type="checkbox" value="${escapeHtml(q)}" ${
        picked.has(q) ? 'checked' : ''
      }> ${escapeHtml(q)}</label>`,
  ).join('');

  const customRows = (customs.length ? customs : [''])
    .map((c) => customRowHtml(c))
    .join('');

  container.innerHTML = `
    <div class="pi-settings-group pi-question-setup">
      <label>選題數量（給AI挑的候選池）</label>
      <input id="pi-num-candidates" type="number" min="1" value="${N}">
      <label>使用題數量（遊戲最終題數）</label>
      <input id="pi-num-questions" type="number" min="1" value="${M}">

      <div class="pi-bank-header">
        <span class="pi-bank-toggle" tabindex="0" role="button">▶ 從題庫挑題（勾選=強制使用）</span>
        <span class="pi-bank-count"></span>
      </div>
      <div class="pi-bank-body">
        <input class="pi-bank-search" type="text" placeholder="🔍 搜尋題目...">
        <div class="pi-bank-list">${bankItems}</div>
      </div>

      <label>自訂問題（強制使用，AI 填答案）</label>
      <div class="pi-custom-list">${customRows}</div>
      <button type="button" class="pi-custom-add">＋ 新增自訂問題</button>

      <div class="pi-setup-warning"></div>
    </div>
  `;

  wire(container);
  updateBankCount(container);
  refreshSetupValidity(container);
}

function customRowHtml(value: string): string {
  return `<div class="pi-custom-row"><input type="text" class="pi-custom-input" value="${escapeHtml(
    value,
  )}" placeholder="輸入自訂問題"><button type="button" class="pi-custom-remove">✕</button></div>`;
}

function wire(container: HTMLElement): void {
  const revalidate = () => refreshSetupValidity(container);

  container.querySelector('#pi-num-candidates')?.addEventListener('input', revalidate);
  container.querySelector('#pi-num-questions')?.addEventListener('input', revalidate);

  const toggle = container.querySelector('.pi-bank-toggle');
  const body = container.querySelector<HTMLElement>('.pi-bank-body');
  toggle?.addEventListener('click', () => body?.classList.toggle('open'));

  container.querySelector('.pi-bank-search')?.addEventListener('input', (e) => {
    const term = (e.target as HTMLInputElement).value.trim();
    container.querySelectorAll<HTMLElement>('.pi-bank-item').forEach((item) => {
      item.style.display = item.textContent?.includes(term) ? '' : 'none';
    });
  });

  container.querySelector('.pi-bank-list')?.addEventListener('change', () => {
    updateBankCount(container);
    revalidate();
  });

  container.querySelector('.pi-custom-add')?.addEventListener('click', () => {
    const list = container.querySelector('.pi-custom-list');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', customRowHtml(''));
    revalidate();
  });

  container.querySelector('.pi-custom-list')?.addEventListener('input', revalidate);
  container.querySelector('.pi-custom-list')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.pi-custom-remove');
    if (btn) {
      btn.closest('.pi-custom-row')?.remove();
      revalidate();
    }
  });
}

function updateBankCount(container: HTMLElement): void {
  const n = container.querySelectorAll<HTMLInputElement>('.pi-bank-item input:checked').length;
  const el = container.querySelector('.pi-bank-count');
  if (el) el.textContent = `已選 ${n}`;
}

export function readQuestionSetup(container: HTMLElement): QuestionSetupValue {
  const numCandidates = Number(
    (container.querySelector('#pi-num-candidates') as HTMLInputElement).value,
  );
  const numQuestions = Number(
    (container.querySelector('#pi-num-questions') as HTMLInputElement).value,
  );
  const pickedBankQuestions = [
    ...container.querySelectorAll<HTMLInputElement>('.pi-bank-item input:checked'),
  ].map((cb) => cb.value);
  const customQuestions = [
    ...container.querySelectorAll<HTMLInputElement>('.pi-custom-input'),
  ]
    .map((inp) => inp.value.trim())
    .filter((v) => v.length > 0);
  return { numCandidates, numQuestions, pickedBankQuestions, customQuestions };
}

export function refreshSetupValidity(container: HTMLElement): boolean {
  const v = readQuestionSetup(container);
  const result = validateQuestionSetup({
    numCandidates: v.numCandidates,
    numQuestions: v.numQuestions,
    pickedCount: v.pickedBankQuestions.length,
    customCount: v.customQuestions.length,
    bankSize: QUESTION_BANK.length,
  });
  const warn = container.querySelector('.pi-setup-warning');
  if (warn) warn.textContent = result.ok ? '' : `⚠ ${result.message}`;
  return result.ok;
}
