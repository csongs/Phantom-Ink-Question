// web/src/main.ts
import { loadSettings, saveSettings, type Settings } from './settings';
import { GroqBackend, GROQ_DEFAULT_MODEL } from './backends/groq';
import { HFBackend, HF_DEFAULT_MODEL } from './backends/hf';
import type { LLMBackend } from './backends/shared';
import { PhantomInkGenerator } from './generator/generator';
import { toBopomofoCells } from './bopomofo';
import { PhantomInkGame, renderGame, type GameQuestion } from './game';

export function toGameQuestions(
  questions: { question: string; reply: string }[],
): GameQuestion[] {
  return questions.map(({ question, reply }) => {
    const cells = toBopomofoCells(reply);
    if (reply.trimEnd().endsWith('。')) cells.push('。');
    return { question, cells, total: cells.length };
  });
}

function buildBackend(settings: Settings): LLMBackend {
  return settings.backend === 'groq'
    ? new GroqBackend(settings.apiKey, settings.model || GROQ_DEFAULT_MODEL)
    : new HFBackend(settings.apiKey, settings.model || HF_DEFAULT_MODEL);
}

/**
 * Turns a thrown value into a user-facing message. A same-origin-policy /
 * CORS rejection never reaches JS as a descriptive error — browsers hide the
 * real reason and it always surfaces as a bare `TypeError` (Chrome: "Failed
 * to fetch"; Firefox: "NetworkError when attempting to fetch resource.").
 * Any other Error (e.g. the backends' own "Groq API error (401): ...") is
 * shown as-is, since it's already a specific, useful message.
 */
export function describeGenerationError(err: unknown): string {
  if (err instanceof TypeError) {
    return '此瀏覽器無法直接連線 API（可能是 CORS 或網路問題）。請確認網路連線正常，若持續發生請回報。';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function startGame(root: HTMLElement, settings: Settings): Promise<void> {
  root.innerHTML = '<p class="pi-loading">🎲 正在生成題目...</p>';
  try {
    const generator = new PhantomInkGenerator(buildBackend(settings));
    const result = await generator.generate({ answerMode: 'ai', numQuestions: 10 });
    const gameQuestions = toGameQuestions(result.questions);
    const game = new PhantomInkGame(gameQuestions, result.answer);
    renderGame(root, game);
  } catch (err) {
    const message = describeGenerationError(err);
    root.innerHTML = `<div class="pi-error">
      <p>生成失敗：${message}</p>
      <button id="pi-retry-settings">回到設定畫面</button>
    </div>`;
    document.getElementById('pi-retry-settings')?.addEventListener('click', () => {
      showSettingsScreen(root);
    });
  }
}

function showSettingsScreen(root: HTMLElement): void {
  const existing = loadSettings();
  root.innerHTML = `
    <div class="pi-settings">
      <h2>設定</h2>
      <label>Backend
        <select id="pi-backend">
          <option value="groq" ${existing?.backend === 'hf' ? '' : 'selected'}>Groq</option>
          <option value="hf" ${existing?.backend === 'hf' ? 'selected' : ''}>Hugging Face</option>
        </select>
      </label>
      <label>API Key
        <input id="pi-apikey" type="password" value="${existing?.apiKey ?? ''}" placeholder="貼上你的 API Key">
      </label>
      <label>Model（留空使用預設）
        <input id="pi-model" type="text" value="${existing?.model ?? ''}">
      </label>
      <p class="pi-privacy-note">Key 只存在你目前這台裝置的瀏覽器裡，不會送到任何伺服器。</p>
      <button id="pi-start">開始遊戲</button>
    </div>
  `;
  document.getElementById('pi-start')?.addEventListener('click', () => {
    const backend = (document.getElementById('pi-backend') as HTMLSelectElement).value as 'groq' | 'hf';
    const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement).value.trim();
    const model = (document.getElementById('pi-model') as HTMLInputElement).value.trim();
    if (!apiKey) return;
    const settings: Settings = { backend, apiKey, model };
    saveSettings(settings);
    void startGame(root, settings);
  });
}

function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  const settings = loadSettings();
  if (settings) {
    void startGame(root, settings);
  } else {
    showSettingsScreen(root);
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  main();
}
