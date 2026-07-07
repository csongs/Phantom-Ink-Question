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
      numQuestions: 10,
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

function showSettingsScreen(root: HTMLElement): void {
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
      <h2>設定</h2>

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

      <p class="pi-privacy-note">Key 只存在你目前這台裝置的瀏覽器裡，不會送到任何伺服器。</p>

      <div class="pi-settings-actions">
        <button id="pi-start" class="pi-btn pi-btn-answer">開始遊戲</button>
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

  document.getElementById('pi-start')?.addEventListener('click', () => {
    const backend = (document.getElementById('pi-backend') as HTMLSelectElement).value as 'groq' | 'hf';
    const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement).value.trim();
    const model = (document.getElementById('pi-model') as HTMLInputElement).value.trim();
    const answerModeRadio = document.querySelector<HTMLInputElement>('input[name="answer-mode"]:checked');
    const answerMode = (answerModeRadio?.value as 'ai' | 'human') ?? 'ai';
    const humanAnswer = (document.getElementById('pi-human-answer') as HTMLInputElement).value.trim();
    if (!apiKey) return;
    if (answerMode === 'human' && !humanAnswer) return;
    const settings: Settings = { backend, apiKey, model, answerMode, humanAnswer };
    saveSettings(settings);
    void startGame(root, settings, humanAnswer);
  });

  document.getElementById('pi-rules-btn')?.addEventListener('click', () => {
    showRules(root);
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
