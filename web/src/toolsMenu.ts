// web/src/toolsMenu.ts
//
// 目錄 / 小工具畫面 — 從首頁進入。
// 內含兩個工具：解謎小幫手、文字轉注音。規則已搬到首頁第一項,這裡不再放。
// 各自點進去後用 onBack() 回到首頁（不再有「切換模式」連結）。
import { toBopomofo } from './bopomofo';
import { escapeHtml } from './game';

export function renderToolsMenu(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-tools-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
      </div>
      <h2 style="margin-bottom:8px;">📂 小工具</h2>
      <p style="font-size:13px;color:var(--pi-text-dim);margin-bottom:24px;">不需進入任何模式也能使用的功能</p>

      <div style="display:flex;flex-direction:column;gap:12px;max-width:320px;">
        <button class="pi-tool-btn" data-tool="solver" style="padding:16px;font-size:15px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="font-size:24px;margin-bottom:4px;">🔍</div>
          <div>解謎小幫手</div>
          <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">貼上解題進度，AI 幫你推測線索、猜謎底</div>
        </button>
        <button class="pi-tool-btn" data-tool="bpmf" style="padding:16px;font-size:15px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="font-size:24px;margin-bottom:4px;">🎵</div>
          <div>文字轉注音（破音字處理）</div>
          <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">把中文轉成注音（ㄅㄆㄇㄈ）字串</div>
        </button>
      </div>
    </div>
  `;
  document.getElementById('pi-tools-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });
  root.querySelectorAll<HTMLButtonElement>('.pi-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      if (tool === 'solver') renderSolver(root, onBack);
      else if (tool === 'bpmf') renderBpmfConverter(root, onBack);
    });
  });
}

function renderSolver(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-tool-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
      </div>
      <h2 style="margin-bottom:8px;">🔍 解謎小幫手</h2>
      <div class="pi-solver-hint">貼上解題進度（題目＋已揭露注音），小幫手不會知道謎底，會先推測各題線索、再綜合猜謎底。</div>
      <textarea class="pi-solver-input" rows="8" placeholder="Q1. 它會造成什麼事故或傷害？&#10;ㄉㄧˋㄇㄧㄢˋ。&#10;&#10;Q2. ..."></textarea>
      <div class="pi-solver-actions">
        <button class="pi-btn pi-btn-share pi-solver-copy">📋 複製</button>
        <button class="pi-btn pi-btn-answer pi-solver-run">🔍 開始分析</button>
      </div>
      <div class="pi-solver-status"></div>
      <div class="pi-solver-results"></div>
    </div>
  `;
  document.getElementById('pi-tool-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });

  const input = root.querySelector<HTMLTextAreaElement>('.pi-solver-input')!;
  const status = root.querySelector<HTMLElement>('.pi-solver-status')!;
  const results = root.querySelector<HTMLElement>('.pi-solver-results')!;

  root.querySelector('.pi-solver-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(input.value).catch(() => {});
    status.textContent = '✅ 已複製';
    setTimeout(() => {
      if (status.textContent === '✅ 已複製') status.textContent = '';
    }, 1400);
  });

  root.querySelector('.pi-solver-run')?.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) {
      status.textContent = '⚠️ 請先貼上解題進度';
      return;
    }
    const { loadSettings } = await import('./settings');
    const { solvePuzzle } = await import('./solver');
    const { GroqFallbackBackend } = await import('./backends/fallbackGroq');
    const { HFBackend, HF_DEFAULT_MODEL } = await import('./backends/hf');

    const saved = loadSettings();
    const apiKey = saved?.apiKey;
    if (!apiKey) {
      status.textContent = '⚠️ 尚未設定 API Key,請先到任一模式（玩家/出題者）的設定畫面設定後再使用。';
      return;
    }
    const backend = (saved?.backend || 'groq') as 'groq' | 'hf';
    const model = saved?.model;
    const runBtn = root.querySelector<HTMLButtonElement>('.pi-solver-run')!;
    runBtn.disabled = true;
    results.innerHTML = '';
    status.innerHTML = '<span class="pi-solver-thinking">🤔 階段 1/2：解讀線索中⋯⋯</span>';
    try {
      const showEvent = (msg: string) => {
        status.innerHTML = `<span class="pi-solver-thinking">${escapeHtml(msg)}</span>`;
      };
      const stage1 = backend === 'groq'
        ? new GroqFallbackBackend(apiKey, 'solverStage1', { onEvent: showEvent })
        : new HFBackend(apiKey, model || HF_DEFAULT_MODEL);
      const stage2 = backend === 'groq'
        ? new GroqFallbackBackend(apiKey, 'solverStage2', { onEvent: showEvent })
        : new HFBackend(apiKey, model || HF_DEFAULT_MODEL);
      const result = await solvePuzzle(stage1, stage2, text, (_stage, msg) => {
        status.innerHTML = `<span class="pi-solver-thinking">🤔 ${escapeHtml(msg)}</span>`;
      });
      status.textContent = '';
      const { describeSolveResultHtml } = await import('./solverTool');
      results.innerHTML = describeSolveResultHtml(result);
    } catch (err) {
      status.textContent = '❌ ' + (err instanceof Error ? err.message : String(err));
    } finally {
      runBtn.disabled = false;
    }
  });
}

function renderBpmfConverter(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-tool-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
      </div>
      <h2 style="margin-bottom:8px;">🎵 文字轉注音</h2>
      <p style="font-size:12px;color:var(--pi-text-dim);margin-bottom:8px;">輸入中文,自動轉為注音（破音字會依常用讀音）。</p>
      <textarea class="pi-bpmf-input" rows="4" placeholder="輸入中文文字,例如：音樂、銀行、頭髮"></textarea>
      <div class="pi-settings-actions">
        <button class="pi-btn pi-btn-answer pi-bpmf-convert">轉換</button>
      </div>
      <div class="pi-bpmf-output" style="margin-top:12px;font-size:15px;font-family:Consolas,monospace;background:var(--pi-surface);padding:12px;border-radius:8px;min-height:48px;word-break:break-all;"></div>
    </div>
  `;
  document.getElementById('pi-tool-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });
  const input = root.querySelector<HTMLTextAreaElement>('.pi-bpmf-input')!;
  const output = root.querySelector<HTMLElement>('.pi-bpmf-output')!;
  const run = () => {
    const text = input.value.trim();
    if (!text) {
      output.textContent = '請輸入文字';
      return;
    }
    output.textContent = toBopomofo(text);
  };
  root.querySelector('.pi-bpmf-convert')?.addEventListener('click', run);
  input.addEventListener('input', run);
}

const RULES_TEXT = `
**靈媒遊戲 Phantom Ink — 遊戲說明**

**🎯 目標**
猜出謎底（一個詞語或事物）。

**🖋 顯示墨水**
每按一次會顯示當前題目回答中的一個注音符號。
每顯示一格消耗 1 點墨水。

**🎯 提交謎底**
隨時可以輸入答案猜測。猜錯 +3 墨水,不限次數。

**➡ 下一題**
揭露部分線索後可跳到下一題。
跳過後無法再回頭顯示該題的墨水。

**👁 老天有眼**
第 5 題開始獲得一次。
全部線索揭露完後可再獲得一次。
可選擇任意一題多揭露一格。

**📜 完成線索**
最後一題揭露完後可「完成線索」。
之後不能再顯示墨水,但可提交謎底或使用老天有眼。

**🏳️ 放棄／公布答案**
直接結束遊戲並公布謎底。

**⭐ 評價**
根據墨水用量和猜測次數給予 1-5 星評價。
`.trim();

/** Rules page exported for reuse (首頁第一項進入). */
export function renderRulesPage(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-tool-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
      </div>
      <h2 style="margin-bottom:8px;">📖 規則</h2>
      <div class="pi-rules-body">${RULES_TEXT.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
    </div>
  `;
  document.getElementById('pi-tool-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });
}
