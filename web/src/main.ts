// web/src/main.ts
import { loadSettings, saveSettings, type Settings } from './settings';
import { GroqBackend, GROQ_DEFAULT_MODEL } from './backends/groq';
import { HFBackend, HF_DEFAULT_MODEL } from './backends/hf';
import type { LLMBackend } from './backends/shared';
import { PhantomInkGenerator } from './generator/generator';
import { toBopomofoCells } from './bopomofo';
import {
  PhantomInkGame,
  renderGame,
  escapeHtml,
  type GameQuestion,
} from './game';
import { renderQuestionSetup, readQuestionSetup, refreshSetupValidity } from './questionSetup';
import { solvePuzzle, type SolveResult } from './solver';

export function toGameQuestions(
  questions: { question: string; reply: string }[],
): GameQuestion[] {
  return questions.map(({ question, reply }) => {
    const cells = toBopomofoCells(reply);
    if (reply.trimEnd().endsWith('。')) cells.push('。');
    return { question, reply, cells, total: cells.length };
  });
}

function buildBackend(settings: Settings): LLMBackend {
  return settings.backend === 'groq'
    ? new GroqBackend(settings.apiKey, settings.model || GROQ_DEFAULT_MODEL)
    : new HFBackend(settings.apiKey, settings.model || HF_DEFAULT_MODEL);
}

export function describeGenerationError(err: unknown): string {
  if (err instanceof TypeError) {
    return '此瀏覽器無法直接連線 API（可能是 CORS 或網路問題）。請確認網路連線正常，若持續發生請回報。';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── Rules modal ──────────────────────────

const RULES_TEXT = `
**靈媒遊戲 Phantom Ink — 遊戲說明**

**🎯 目標**
猜出謎底（一個詞語或事物）。

**🖋 顯示墨水**
每按一次會顯示當前題目回答中的一個注音符號。
每顯示一格消耗 1 點墨水。

**🎯 提交謎底**
隨時可以輸入答案猜測。猜錯 +3 墨水，不限次數。

**➡ 下一題**
揭露部分線索後可跳到下一題。
跳過後無法再回頭顯示該題的墨水。

**👁 老天有眼**
第 5 題開始獲得一次。
全部線索揭露完後可再獲得一次。
可選擇任意一題多揭露一格。

**📜 完成線索**
最後一題揭露完後可「完成線索」。
之後不能再顯示墨水，但可提交謎底或使用老天有眼。

**🏳️ 放棄／公布答案**
直接結束遊戲並公布謎底。

**⭐ 評價**
根據墨水用量和猜測次數給予 1-5 星評價。
`.trim();

function showRules(root: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'pi-overlay open';
  overlay.innerHTML = `
    <div class="pi-dialog pi-rules-dialog">
      <div class="pi-dialog-title">📖 遊戲說明</div>
      <div class="pi-rules-body">${RULES_TEXT.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
      <button class="pi-dialog-close pi-rules-close">關閉</button>
    </div>
  `;
  root.appendChild(overlay);
  overlay.querySelector('.pi-rules-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Solving helper (解題小幫手) ──────────────
//
// A standalone assistant that reasons from a pasted BLIND progress snapshot.
// It never receives the answer, so it works on the current game or on progress
// copied from any other puzzle.

function solveResultHtml(result: SolveResult): string {
  const perQ = result.perQuestion.length
    ? `<h4>各題線索推測</h4><ul class="pi-solver-perq">${result.perQuestion
        .map(
          (p) =>
            `<li><span class="pi-solver-q">Q${p.q}</span> → <strong>${escapeHtml(
              p.replyGuess || '？',
            )}</strong>${p.note ? `<div class="pi-solver-note">${escapeHtml(p.note)}</div>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';

  const finals = result.finalGuesses.length
    ? `<h4>謎底候選（最可能在前）</h4><ol class="pi-solver-finals">${result.finalGuesses
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.answer)}</strong>${
              f.reason ? `<div class="pi-solver-note">${escapeHtml(f.reason)}</div>` : ''
            }</li>`,
        )
        .join('')}</ol>`
    : '<p class="pi-solver-empty">（沒有得到謎底候選，可再多開一些注音後重試）</p>';

  const summary = result.summary
    ? `<h4>整體思路</h4><p class="pi-solver-summary">${escapeHtml(result.summary)}</p>`
    : '';

  return perQ + finals + summary;
}

export function renderSolverHelper(root: HTMLElement, initialText = ''): void {
  const overlay = document.createElement('div');
  overlay.className = 'pi-overlay open';
  overlay.innerHTML = `
    <div class="pi-dialog pi-solver-dialog">
      <div class="pi-solver-header">
        <div class="pi-dialog-title">🔍 解題小幫手</div>
        <button class="pi-solver-x" data-action="solver-close" aria-label="關閉" title="關閉">✕</button>
      </div>
      <div class="pi-solver-hint">貼上解題進度（題目＋已揭露注音），小幫手不會知道謎底，會先推測各題線索、再綜合猜謎底。</div>
      <textarea class="pi-solver-input" rows="8" placeholder="Q1. 它會造成什麼事故或傷害？&#10;ㄉㄧˋㄇㄧㄢˋ。&#10;&#10;Q2. ...">${escapeHtml(
        initialText,
      )}</textarea>
      <div class="pi-solver-actions">
        <button class="pi-btn pi-btn-share" data-action="solver-copy">📋 複製</button>
        <button class="pi-btn pi-btn-answer" data-action="solver-run">🔍 開始分析</button>
        <button class="pi-btn pi-btn-next" data-action="solver-close">關閉</button>
      </div>
      <div class="pi-solver-status"></div>
      <div class="pi-solver-results"></div>
    </div>
  `;
  root.appendChild(overlay);

  const input = overlay.querySelector<HTMLTextAreaElement>('.pi-solver-input')!;
  const status = overlay.querySelector<HTMLElement>('.pi-solver-status')!;
  const results = overlay.querySelector<HTMLElement>('.pi-solver-results')!;
  const runBtn = overlay.querySelector<HTMLButtonElement>('[data-action="solver-run"]')!;

  // Close only via the ✕ or 關閉 buttons — NOT by clicking the backdrop, so a
  // stray click outside can't wipe pasted text or analysis results.
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-action="solver-close"]').forEach((btn) => {
    btn.addEventListener('click', close);
  });

  overlay.querySelector('[data-action="solver-copy"]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(input.value).catch(() => {});
    status.textContent = '✅ 已複製';
    setTimeout(() => {
      if (status.textContent === '✅ 已複製') status.textContent = '';
    }, 1400);
  });

  /** Read a form field by id, or return undefined if the element is missing. */
  const formVal = (id: string): string | undefined =>
    (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value?.trim() || undefined;

  runBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) {
      status.textContent = '⚠️ 請先貼上解題進度';
      return;
    }

    // Try saved settings first; if none (e.g. opened from settings screen before
    // clicking "開始遊戲"), read directly from the DOM form as a fallback.
    const saved = loadSettings();
    const apiKey = saved?.apiKey || formVal('pi-apikey');
    if (!apiKey) {
      status.textContent = '⚠️ 尚未設定 API Key，請先到設定畫面設定後再使用。';
      return;
    }
    const backend = (saved?.backend || formVal('pi-backend') || 'groq') as 'groq' | 'hf';
    const model = saved?.model || formVal('pi-model') || undefined;

    runBtn.disabled = true;
    results.innerHTML = '';
    status.innerHTML = '<span class="pi-solver-thinking">🤔 階段 1/2：解讀線索中⋯⋯（使用 Qwen）</span>';
    try {
      // Stage 1: Qwen for bopomofo-to-text decoding (strong bopomofo understanding)
      const qwenBackend = backend === 'groq'
        ? new GroqBackend(apiKey, 'qwen/qwen3.6-27b')
        : new HFBackend(apiKey, model || HF_DEFAULT_MODEL);
      // Stage 2: Llama for final answer guessing (avoids reasoning token exhaustion)
      const llamaBackend = backend === 'groq'
        ? new GroqBackend(apiKey, 'llama-3.3-70b-versatile')
        : new HFBackend(apiKey, model || HF_DEFAULT_MODEL);

      const result = await solvePuzzle(qwenBackend, llamaBackend, text, (stage, msg) => {
        status.innerHTML = `<span class="pi-solver-thinking">🤔 ${escapeHtml(msg)}</span>`;
      });

      status.textContent = '';
      results.innerHTML = solveResultHtml(result);
    } catch (err) {
      status.textContent = '❌ 分析失敗：' + describeGenerationError(err);
    } finally {
      runBtn.disabled = false;
    }
  });

  input.focus();
}

// ── Loading screen (log is masked during generation) ──

function renderLoading(root: HTMLElement, statusMsg = ''): void {
  const statusHtml = statusMsg
    ? `<div class="pi-think-status">${escapeHtml(statusMsg)}</div>`
    : '';
  root.innerHTML = `
    <div class="pi-loading open">
      <div class="pi-think">
        <div class="pi-think-indicator">
          <span class="pi-think-dot"></span>
          <span class="pi-think-dot"></span>
          <span class="pi-think-dot"></span>
        </div>
        <div class="pi-think-label">思考中</div>
      </div>
      ${statusHtml}
    </div>
  `;
}

// ── Game screen ──────────────────────────

async function startGame(
  root: HTMLElement,
  settings: Settings,
  humanAnswer?: string,
): Promise<void> {
  const logLines: string[] = [];
  const progressLog = (msg: string) => {
    logLines.push(msg);
    renderLoading(root, msg);
  };

  renderLoading(root);
  try {
    const generator = new PhantomInkGenerator(buildBackend(settings));
    const result = await generator.generate({
      answerMode: settings.answerMode ?? 'ai',
      numQuestions: settings.numQuestions ?? 10,
      numCandidates: settings.numCandidates,
      pickedBankQuestions: settings.pickedBankQuestions,
      customQuestions: settings.customQuestions,
      onProgress: progressLog,
      answer: humanAnswer,
    });
    const gameQuestions = toGameQuestions(result.questions);
    const game = new PhantomInkGame(gameQuestions, result.answer);

    // Build layout: game container + log section (collapsed)
    const logHtml = logLines.map((l) => `<div class="pi-log-line">${escapeHtml(l)}</div>`).join('');
    root.innerHTML = `
      <div id="pi-game-container"></div>
      <div class="pi-log-below">
        <div class="pi-log-header">
          <div class="pi-log-toggle" tabindex="0" role="button">
            <span class="pi-log-toggle-arrow">▶</span> 生成過程
          </div>
          <button class="pi-log-copy" title="複製 LOG">📋</button>
        </div>
        <div class="pi-log-body">${logHtml}</div>
      </div>
    `;

    // Render game into its container
    const gameContainer = document.getElementById('pi-game-container')!;
    renderGame(gameContainer, game, root);

    // Open the solving helper (pre-filled with current blind progress) when the
    // in-game button asks for it.
    root.addEventListener('pi-open-solver', (e) => {
      renderSolverHelper(root, (e as CustomEvent<string>).detail ?? '');
    });

    // Log toggle
    const logSection = root.querySelector<HTMLElement>('.pi-log-below')!;
    const toggle = logSection.querySelector<HTMLElement>('.pi-log-toggle');
    const body = logSection.querySelector<HTMLElement>('.pi-log-body');
    toggle?.addEventListener('click', () => {
      body?.classList.toggle('open');
      toggle.querySelector('.pi-log-toggle-arrow')?.classList.toggle('open');
    });

    // Copy log
    logSection.querySelector('.pi-log-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(logLines.join('\n')).catch(() => {});
    });
  } catch (err) {
    const message = describeGenerationError(err);
    const logHtml = logLines.map((l) => `<div class="pi-log-line">${escapeHtml(l)}</div>`).join('');

    root.innerHTML = `
      <div class="pi-error open">
        <h2>生成失敗</h2>
        <pre class="pi-error-msg">${escapeHtml(message)}</pre>
        <button id="pi-copy-error" class="pi-btn pi-btn-next">📋 複製錯誤訊息</button>
        <button id="pi-retry-settings" class="pi-btn pi-btn-answer">回到設定畫面</button>
      </div>
      <div class="pi-log-below">
        <div class="pi-log-header">
          <div class="pi-log-toggle" tabindex="0" role="button">
            <span class="pi-log-toggle-arrow open">▶</span> 生成過程
          </div>
          <button class="pi-log-copy" title="複製 LOG">📋</button>
        </div>
        <div class="pi-log-body open">${logHtml}</div>
      </div>
    `;
    document.getElementById('pi-copy-error')?.addEventListener('click', () => {
      navigator.clipboard.writeText(message).catch(() => {});
    });
    document.getElementById('pi-retry-settings')?.addEventListener('click', () => {
      showSettingsScreen(root);
    });

    const logSection = root.querySelector<HTMLElement>('.pi-log-below')!;
    const toggle = logSection.querySelector<HTMLElement>('.pi-log-toggle');
    const body = logSection.querySelector<HTMLElement>('.pi-log-body');
    toggle?.addEventListener('click', () => {
      body?.classList.toggle('open');
      toggle.querySelector('.pi-log-toggle-arrow')?.classList.toggle('open');
    });
    logSection.querySelector('.pi-log-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(logLines.join('\n')).catch(() => {});
    });
  }
}

// ── Settings screen ──────────────────────

export function showSettingsScreen(root: HTMLElement): void {
  const existing = loadSettings();
  const apiKey = escapeHtml(existing?.apiKey ?? '');
  const model = escapeHtml(existing?.model ?? '');
  const answerMode = existing?.answerMode ?? 'ai';
  const humanAnswer = escapeHtml(existing?.humanAnswer ?? '');
  const aiChecked = answerMode === 'ai' ? 'checked' : '';
  const humanChecked = answerMode === 'human' ? 'checked' : '';
  const humanVisible = answerMode === 'human' ? 'style="display:block"' : 'style="display:none"';

  root.innerHTML = `
    <div class="pi-settings open">
      <h2>幽靈筆跡</h2>

      <div class="pi-settings-group">
        <label>Backend</label>
        <select id="pi-backend">
          <option value="groq" ${existing?.backend === 'hf' ? '' : 'selected'}>Groq</option>
          <option value="hf" ${existing?.backend === 'hf' ? 'selected' : ''}>Hugging Face</option>
        </select>
      </div>

      <div class="pi-settings-group">
        <label>API Key</label>
        <input id="pi-apikey" type="password" value="${apiKey}" placeholder="貼上你的 API Key">
      </div>

      <div class="pi-settings-group">
        <label>Model（留空使用預設）</label>
        <input id="pi-model" type="text" value="${model}">
      </div>

      <div class="pi-settings-group">
        <label>謎底來源</label>
        <label class="pi-radio">
          <input type="radio" name="answer-mode" value="ai" ${aiChecked}> AI 自動產生謎底
        </label>
        <label class="pi-radio">
          <input type="radio" name="answer-mode" value="human" ${humanChecked}> 自行輸入謎底（設計題庫）
        </label>
        <div id="pi-human-answer-area" class="pi-settings-sub" ${humanVisible}>
          <input id="pi-human-answer" type="text" value="${humanAnswer}" placeholder="請輸入謎底（如：鋼琴）">
        </div>
      </div>

      <div id="pi-question-setup"></div>

      <p class="pi-privacy-note">Key 只存在你目前這台裝置的瀏覽器裡，不會送到任何伺服器。</p>

      <div class="pi-settings-actions">
        <button id="pi-start" class="pi-btn pi-btn-answer">開始遊戲</button>
        <button id="pi-solver-btn" class="pi-btn pi-btn-finish">🔍 解題小幫手</button>
        <button id="pi-rules-btn" class="pi-btn pi-btn-finish">📖 規則</button>
      </div>
    </div>
  `;

  // Toggle human answer input
  document.querySelectorAll<HTMLInputElement>('input[name="answer-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const area = document.getElementById('pi-human-answer-area');
      if (area) {
        area.style.display = radio.value === 'human' ? 'block' : 'none';
      }
    });
  });

  // Question-setup section: render + gate the start button on its validity.
  const setupContainer = document.getElementById('pi-question-setup');
  if (setupContainer) {
    renderQuestionSetup(setupContainer, {
      numCandidates: existing?.numCandidates,
      numQuestions: existing?.numQuestions,
      pickedBankQuestions: existing?.pickedBankQuestions,
      customQuestions: existing?.customQuestions,
    });
    const startBtn = document.getElementById('pi-start') as HTMLButtonElement | null;
    const syncStart = () => { if (startBtn) startBtn.disabled = !refreshSetupValidity(setupContainer); };
    setupContainer.addEventListener('input', syncStart);
    setupContainer.addEventListener('change', syncStart);
    setupContainer.addEventListener('click', syncStart);
    syncStart();
  }

  document.getElementById('pi-start')?.addEventListener('click', () => {
    const backend = (document.getElementById('pi-backend') as HTMLSelectElement).value as 'groq' | 'hf';
    const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement).value.trim();
    const model = (document.getElementById('pi-model') as HTMLInputElement).value.trim();
    const answerModeRadio = document.querySelector<HTMLInputElement>('input[name="answer-mode"]:checked');
    const answerMode = (answerModeRadio?.value as 'ai' | 'human') ?? 'ai';
    const humanAnswer = (document.getElementById('pi-human-answer') as HTMLInputElement).value.trim();
    if (!apiKey) return;
    if (answerMode === 'human' && !humanAnswer) return;

    const setupEl = document.getElementById('pi-question-setup')!;
    if (!refreshSetupValidity(setupEl)) return;
    const setup = readQuestionSetup(setupEl);

    const settings: Settings = {
      backend, apiKey, model, answerMode, humanAnswer,
      numCandidates: setup.numCandidates,
      numQuestions: setup.numQuestions,
      pickedBankQuestions: setup.pickedBankQuestions,
      customQuestions: setup.customQuestions,
    };
    saveSettings(settings);
    void startGame(root, settings, humanAnswer);
  });

  document.getElementById('pi-rules-btn')?.addEventListener('click', () => {
    showRules(root);
  });

  document.getElementById('pi-solver-btn')?.addEventListener('click', () => {
    renderSolverHelper(root);
  });
}

function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  showSettingsScreen(root);
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  main();
}
