import { parseGroupedQuestions, matchToBank, type GroupedQuestion } from './groupPaste';
import { QUESTION_BANK } from './generator/prompts';
import { validateQuestionSetup } from './settings';
import { escapeHtml } from './game';

export interface QuestionSetupValue {
  numCandidates: number;
  numQuestions: number;
  pickedBankQuestions: string[];
  customQuestions: string[];
  groupTags?: GroupedQuestion[];
}

export interface QuestionSetupOptions {
  /** 出題者模式才需要「貼上題組」功能(自動勾題庫+記組別編號);玩家模式跳過。 */
  mode?: 'host' | 'player';
}

export function renderQuestionSetup(
  container: HTMLElement,
  initial: Partial<QuestionSetupValue> = {},
  options: QuestionSetupOptions = {},
): void {
  const N = initial.numCandidates ?? 30;
  const M = initial.numQuestions ?? 10;
  const picked = new Set(initial.pickedBankQuestions ?? []);
  const customs = initial.customQuestions ?? [];
  const showGroupPaste = options.mode === 'host';

  const bankItems = QUESTION_BANK.map(
    (q) =>
      `<label class="pi-bank-item"><input type="checkbox" value="${escapeHtml(q)}" ${
        picked.has(q) ? 'checked' : ''
      }> ${escapeHtml(q)}</label>`,
  ).join('');

  const customRows = customs.map((c) => customRowHtml(c)).join('');

  container.innerHTML = `
    <div class="pi-settings-group pi-question-setup">
      <label>選題數量（給AI挑的候選池）</label>
      <input id="pi-num-candidates" type="number" min="1" value="${N}">
      <label>使用題數量（遊戲最終題數）</label>
      <input id="pi-num-questions" type="number" min="1" value="${M}">

      <div class="pi-group-paste-area"${showGroupPaste ? '' : ' style="display:none"'}>
        <label>貼上題組（自動勾選題庫並記住組別編號）</label>
        <textarea class="pi-group-paste" rows="5" placeholder="第 1 組&#10;如果暫時沒有它，可以用什麼替代？&#10;有什麼東西的危險程度與它相仿？&#10;⋯"></textarea>
        <button type="button" class="pi-group-parse">解析並勾選</button>
        <div class="pi-group-result"></div>
      </div>

      <div class="pi-bank-header">
        <span class="pi-bank-toggle" tabindex="0" role="button">▶ 從題庫挑題（勾選=強制使用）</span>
        <span class="pi-bank-count"></span>
        <button type="button" class="pi-bank-clear" style="display:none">清除</button>
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

  if (initial.groupTags?.length) {
    container.dataset.groupTags = JSON.stringify(initial.groupTags);
  }

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

  // Clear all bank selections + paste + custom list (one button to wipe it all).
  container.querySelector('.pi-bank-clear')?.addEventListener('click', () => {
    container.querySelectorAll<HTMLInputElement>('.pi-bank-item input').forEach((cb) => {
      cb.checked = false;
    });
    container.querySelector('.pi-custom-list')!.innerHTML = '';
    const paste = container.querySelector<HTMLTextAreaElement>('.pi-group-paste');
    if (paste) paste.value = '';
    const result = container.querySelector<HTMLElement>('.pi-group-result');
    if (result) result.textContent = '';
    delete container.dataset.groupTags;
    updateBankCount(container);
    revalidate();
  });
  container.querySelector('.pi-group-parse')?.addEventListener('click', () => {
    const ta = container.querySelector<HTMLTextAreaElement>('.pi-group-paste')!;
    const resultEl = container.querySelector<HTMLElement>('.pi-group-result')!;
    const { items, errors } = parseGroupedQuestions(ta.value);
    if (!items.length) {
      resultEl.textContent = `⚠ ${errors.join('；')}`;
      return;
    }
    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);

    // 以貼上內容為準：清空原本的勾選與自訂問題
    container.querySelectorAll<HTMLInputElement>('.pi-bank-item input').forEach((cb) => {
      cb.checked = false;
    });
    const customList = container.querySelector('.pi-custom-list')!;
    customList.innerHTML = '';

    // 勾選題庫符合項
    const matchedSet = new Set(matched.map((m) => m.bankQuestion));
    container.querySelectorAll<HTMLInputElement>('.pi-bank-item input').forEach((cb) => {
      if (matchedSet.has(cb.value)) cb.checked = true;
    });

    // 不在題庫的加入自訂問題（同樣強制使用，AI 填回答）
    for (const u of unmatched) {
      customList.insertAdjacentHTML('beforeend', customRowHtml(u.text));
    }

    // 自動調整題數：使用題數 = 全部貼上題數；候選池至少要比它大 1
    (container.querySelector('#pi-num-questions') as HTMLInputElement).value = String(items.length);
    const nInput = container.querySelector('#pi-num-candidates') as HTMLInputElement;
    if (Number(nInput.value) <= items.length) nInput.value = String(items.length + 1);

    // 記住 (group, index) 編號，readQuestionSetup 會讀回
    container.dataset.groupTags = JSON.stringify(items);

    const groupCount = new Set(items.map((i) => i.group)).size;
    const parts = [`✅ 已解析 ${groupCount} 組、共 ${items.length} 題，勾選題庫 ${matched.length} 題`];
    if (unmatched.length) {
      parts.push(`不在題庫、已加入自訂問題：${unmatched.map((u) => u.text).join('、')}`);
    }
    if (errors.length) parts.push(`⚠ ${errors.join('；')}`);
    resultEl.textContent = parts.join('；');

    updateBankCount(container);
    refreshSetupValidity(container);
  });
}

function updateBankCount(container: HTMLElement): void {
  const n = container.querySelectorAll<HTMLInputElement>('.pi-bank-item input:checked').length;
  const el = container.querySelector('.pi-bank-count');
  if (el) el.textContent = `已選 ${n}`;
  const clearBtn = container.querySelector<HTMLElement>('.pi-bank-clear');
  if (clearBtn) clearBtn.style.display = n > 0 ? '' : 'none';
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

  let groupTags: GroupedQuestion[] | undefined;
  try {
    const rawTags = container.dataset.groupTags;
    if (rawTags) groupTags = JSON.parse(rawTags) as GroupedQuestion[];
  } catch {
    groupTags = undefined;
  }

  return { numCandidates, numQuestions, pickedBankQuestions, customQuestions, groupTags };
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
