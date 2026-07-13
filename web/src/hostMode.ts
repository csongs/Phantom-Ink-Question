// web/src/hostMode.ts
//
// Host-mode (出題者) setup page and command-card page. Rendered by main.ts
// when settings.mode === 'host'.
//
// 架構（2026-07-09 重新設計）：
// - 首頁（renderHomeMenu）=「目錄」入口，含三顆按鈕：🎙️ 出題者、🎮 玩家、📂 小工具。
// - 「← 返回」= 回到首頁（renderHomeMenu），不用 reload、不清 mode。
//   模式內「← 返回」依然存在但只讓使用者離開到首頁。
// - 「⇄ 切換模式」整段刪除（使用者回饋：多餘）。
// - 出題者設定頁含「從題庫挑題（勾選＝強制使用）」+ 自訂問題 + 貼上題組（兩路並存）。
// - 指令頁的 R3/R5/R6 事件委派架構保留。
//
// 狀態：
// - cards[i].tag 是單一真相來源（永遠從 cards 讀、不讀 DOM）。
// - 編輯 top-bar / 卡片欄位只局部更新對應的 cmd-line-X，focus 不會被吃掉。
import { escapeHtml } from './game';
import { loadSettings, saveSettings, type Settings } from './settings';
import { normalizeQuestion, type GroupedQuestion } from './groupPaste';
import { toBopomofo, toBopomofoCells } from './bopomofo';
import { buildClueCommand } from './hostCommands';
import type { LLMBackend } from './backends/shared';
import { QUESTION_BANK } from './generator/prompts';
import { GroqFallbackBackend } from './backends/fallbackGroq';
import { HFBackend, HF_DEFAULT_MODEL } from './backends/hf';
import { PhantomInkGenerator } from './generator/generator';
import { renderToolsMenu } from './toolsMenu';
import { renderQuestionSetup, readQuestionSetup, type QuestionSetupValue } from './questionSetup';

// ── Host-mode state (ephemeral, not persisted) ──

interface HostCard {
  question: string;
  tag: { group: number; option: number } | null;
  reply: string;
  /** R1b — previous reply (if any) for the "↩ 還原上一個" button. */
  previousReply?: string;
}

interface HostPageState {
  questionId: string;
  prefix: string;
}

// ── Home / 目錄頁 ──
//
// 首頁就是目錄,不再有獨立的「模式選擇」畫面。結構:
// [📖 規則] [🎙️ 出題者] [🎮 玩家] [📂 小工具]
// 「小工具」裡是純工具頁(解謎小幫手/文字轉注音),不含模式入口也不含規則。
export function renderHomeMenu(root: HTMLElement): void {
  root.innerHTML = `
    <div class="pi-settings open" style="text-align:center;">
      <h2 style="margin-bottom:8px;">幽靈筆跡 👻</h2>
      <p style="font-size:13px;color:var(--pi-text-dim);margin-bottom:24px;">選擇你要做什麼</p>
      <div style="display:flex;flex-direction:column;gap:12px;max-width:320px;margin:0 auto;">
        <button class="pi-home-btn" data-action="rules" style="padding:18px;font-size:15px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:28px;">📖</div>
            <div>
              <div>規則</div>
              <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">靈媒遊戲玩法說明</div>
            </div>
          </div>
        </button>
        <button class="pi-home-btn" data-action="host" style="padding:20px;font-size:16px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:32px;">🎙️</div>
            <div>
              <div>出題者</div>
              <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">生成題組、取得 BOT 指令</div>
            </div>
          </div>
        </button>
        <button class="pi-home-btn" data-action="player" style="padding:20px;font-size:16px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:32px;">🎮</div>
            <div>
              <div>玩家</div>
              <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">出題生成、進行遊戲</div>
            </div>
          </div>
        </button>
        <button class="pi-home-btn" data-action="tools" style="padding:18px;font-size:15px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid var(--pi-border);border-radius:12px;cursor:pointer;text-align:left;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:28px;">📂</div>
            <div>
              <div>小工具</div>
              <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:2px;">解謎小幫手・文字轉注音</div>
            </div>
          </div>
        </button>
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>('.pi-home-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const s = loadSettings() ?? { backend: 'groq', apiKey: '', model: '' } as Settings;
      if (action === 'host') {
        s.mode = 'host';
        saveSettings(s);
        renderHostSetup(root, s);
      } else if (action === 'player') {
        s.mode = 'player';
        saveSettings(s);
        renderHomePlayerScreen(root, s);
      } else if (action === 'tools') {
        renderToolsMenu(root, () => renderHomeMenu(root));
      } else if (action === 'rules') {
        renderRulesInline(root, () => renderHomeMenu(root));
      }
    });
  });
}

/** Inline rules view on the home page. Same content as toolsMenu.renderRules
 *  but reachable directly from the home menu. */
function renderRulesInline(root: HTMLElement, onBack: () => void): void {
  import('./toolsMenu').then((m) => m.renderRulesPage(root, onBack));
}

/** Re-render the player-mode settings screen (currently the in-game UI; main.ts
 *  exposed showSettingsScreen for this purpose). */
function renderHomePlayerScreen(root: HTMLElement, _settings: Settings): void {
  // Delegate to main.ts's existing entry — keeps the player's setup-screen
  // unchanged.
  import('./main').then((m) => m.showSettingsScreen(root));
}

// ── Setup screen ──

/**
 * Render the host-mode setup screen.
 *
 * 結構：API Key + Backend/Model + 謎底模式 + 題目id + 指令前綴 +
 *       共用的 `renderQuestionSetup`（題庫挑題 / 自訂問題 / 貼上題組，
 *       與玩家模式共用同一個元件，見 questionSetup.ts）+ 生成鈕。
 *       貼上題組的文字會由 groupTags 自動還原（見 questionSetup.ts），
 *       不需要另外傳遞。
 */
export function renderHostSetup(
  root: HTMLElement,
  existing: Settings | null,
): void {
  const apiKey = escapeHtml(existing?.apiKey ?? '');
  const model = escapeHtml(existing?.model ?? '');
  const answerMode = existing?.answerMode ?? 'ai';
  const humanAnswer = escapeHtml(existing?.humanAnswer ?? '');
  const hostQuestionId = escapeHtml(existing?.hostQuestionId ?? '');
  const cmdPrefix = existing?.cmdPrefix ?? 'ghostink';
  const aiChecked = answerMode === 'ai' ? 'checked' : '';
  const humanChecked = answerMode === 'human' ? 'checked' : '';
  const humanVisible = answerMode === 'human' ? 'style="display:block"' : 'style="display:none"';

  // 合併勾選題庫 + 自訂問題（兩種入口的並集）
  const initialPicked = existing?.pickedBankQuestions ?? [];
  const initialCustom = existing?.customQuestions ?? [];

  // 從現有 groupTags 抽出「未匹配題庫」的自訂題目,確保它們也出現在自訂問題列表
  const customsFromTags = existing?.groupTags
    ? existing.groupTags.filter((t) => !QUESTION_BANK.includes(t.text)).map((t) => t.text)
    : [];
  const allCustoms = Array.from(new Set([...initialCustom, ...customsFromTags]));

  // 題數預設值:以已存在的 groupTags 數量為主(若無則用 10)。
  // 注意:出題者模式所有題目皆為強制使用,這兩個欄位不影響實際生成邏輯
  // (見 startHostGeneration 的 numQuestions = allItems.length),純供共用元件顯示。
  const initialNumQuestions = existing?.groupTags?.length ?? 10;
  const initialNumCandidates = initialPicked.length + allCustoms.length + 5;

  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-host-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
      </div>

      <h2>🎙️ 出題者模式</h2>

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
        <input id="pi-model" type="text" value="${model}" placeholder="例：llama-3.3-70b-versatile">
      </div>

      <div class="pi-settings-group">
        <label>謎底來源</label>
        <label class="pi-radio">
          <input type="radio" name="answer-mode" value="ai" ${aiChecked}> AI 自動產生謎底
        </label>
        <label class="pi-radio">
          <input type="radio" name="answer-mode" value="human" ${humanChecked}> 自行輸入謎底
        </label>
        <div id="pi-human-answer-area" class="pi-settings-sub" ${humanVisible}>
          <input id="pi-human-answer" type="text" value="${humanAnswer}" placeholder="請輸入謎底（如：鋼琴）">
        </div>
      </div>

      <div class="pi-settings-group">
        <label>題目id（BOT 識別用）</label>
        <input id="pi-host-qid" type="text" value="${hostQuestionId}" placeholder="例：5">
      </div>

      <div class="pi-settings-group">
        <label>指令前綴</label>
        <select id="pi-cmd-prefix">
          <option value="ghostink" ${cmdPrefix === 'ghostink' ? 'selected' : ''}>ghostink</option>
          <option value="phantomink" ${cmdPrefix === 'phantomink' ? 'selected' : ''}>phantomink</option>
          <option value="__custom__" ${![ 'ghostink', 'phantomink' ].includes(cmdPrefix) ? 'selected' : ''}>自訂</option>
        </select>
        <input id="pi-cmd-prefix-custom" type="text" placeholder="自訂前綴" style="margin-top:4px;display:${![ 'ghostink', 'phantomink' ].includes(cmdPrefix) ? 'block' : 'none'};" value="${![ 'ghostink', 'phantomink' ].includes(cmdPrefix) ? escapeHtml(cmdPrefix) : ''}">
      </div>

      <div id="pi-host-question-setup"></div>
      <div id="pi-host-warning" class="pi-setup-warning"></div>

      <p class="pi-privacy-note">Key 只存在你目前這台裝置的瀏覽器裡，不會送到任何伺服器。</p>

      <div class="pi-settings-actions">
        <button id="pi-host-generate" class="pi-btn pi-btn-answer">🎙️ 生成題組</button>
      </div>
    </div>
  `;

  const setupContainer = document.getElementById('pi-host-question-setup');
  if (setupContainer) {
    renderQuestionSetup(setupContainer, {
      numCandidates: initialNumCandidates,
      numQuestions: initialNumQuestions,
      pickedBankQuestions: initialPicked,
      customQuestions: allCustoms,
      groupTags: existing?.groupTags,
    }, { mode: 'host' });
  }

  // Delegated handlers — never re-attached after innerHTML changes.
  document.querySelectorAll<HTMLInputElement>('input[name="answer-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const area = document.getElementById('pi-human-answer-area');
      if (area) area.style.display = radio.value === 'human' ? 'block' : 'none';
    });
  });

  const prefixSelect = document.getElementById('pi-cmd-prefix') as HTMLSelectElement | null;
  const prefixCustom = document.getElementById('pi-cmd-prefix-custom') as HTMLInputElement | null;
  prefixSelect?.addEventListener('change', () => {
    if (prefixCustom) prefixCustom.style.display = prefixSelect.value === '__custom__' ? 'block' : 'none';
  });

  document.getElementById('pi-host-generate')?.addEventListener('click', () => {
    if (!setupContainer) return;
    const setup = readQuestionSetup(setupContainer);
    void startHostGeneration(root, setup);
  });

  document.getElementById('pi-host-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderHomeMenu(root);
  });
}

// ── Generation ──

async function startHostGeneration(root: HTMLElement, setup: QuestionSetupValue): Promise<void> {
  const backend = (document.getElementById('pi-backend') as HTMLSelectElement)?.value as 'groq' | 'hf' || 'groq';
  const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement)?.value.trim();
  const model = (document.getElementById('pi-model') as HTMLInputElement)?.value.trim();
  const answerMode = (document.querySelector<HTMLInputElement>('input[name="answer-mode"]:checked')?.value ?? 'ai') as 'ai' | 'human';
  const humanAnswer = (document.getElementById('pi-human-answer') as HTMLInputElement)?.value.trim();
  const hostQuestionId = (document.getElementById('pi-host-qid') as HTMLInputElement)?.value.trim() || '';

  if (!apiKey) return;

  const prefixSelect = document.getElementById('pi-cmd-prefix') as HTMLSelectElement | null;
  let cmdPrefix = prefixSelect?.value ?? 'ghostink';
  if (cmdPrefix === '__custom__') {
    cmdPrefix = (document.getElementById('pi-cmd-prefix-custom') as HTMLInputElement)?.value.trim() || 'ghostink';
  }

  // 合併三路輸入：
  //   1) 貼上題組解析後的題目（groupTags，含題庫題與自訂題）
  //   2) 題庫勾選中「沒在貼上區出現」的
  //   3) 自訂問題中「沒在貼上區出現」的
  // 貼上題組已由共用元件（questionSetup.ts）解析並記在 groupTags，
  // 不用再重新 parse 一次。
  const allItems: GroupedQuestion[] = [...(setup.groupTags ?? [])];

  let counter = 1;
  for (const q of setup.pickedBankQuestions) {
    if (!allItems.find((it) => normalizeQuestion(it.text) === normalizeQuestion(q))) {
      allItems.push({ group: 0, index: counter++, text: q });
    }
  }
  for (const q of setup.customQuestions) {
    if (!allItems.find((it) => normalizeQuestion(it.text) === normalizeQuestion(q))) {
      allItems.push({ group: 0, index: counter++, text: q });
    }
  }

  if (allItems.length === 0) {
    const warn = document.getElementById('pi-host-warning');
    if (warn) warn.textContent = '⚠️ 請至少勾選題庫、新增自訂題、或貼上題組';
    return;
  }
  if (!hostQuestionId) {
    const qidInput = document.getElementById('pi-host-qid');
    if (qidInput) qidInput.style.borderColor = 'var(--pi-danger)';
    return;
  }

  // 計算給 generator 的題庫題目 + 自訂題目
  const pickedBankQuestions = Array.from(new Set([
    ...setup.pickedBankQuestions,
    ...allItems.filter((it) => QUESTION_BANK.includes(it.text)).map((it) => it.text),
  ]));
  const customQuestions = Array.from(new Set([
    ...setup.customQuestions,
    ...allItems.filter((it) => !QUESTION_BANK.includes(it.text)).map((it) => it.text),
  ]));

  const settings: Settings = {
    backend, apiKey, model,
    answerMode, humanAnswer,
    hostQuestionId, cmdPrefix,
    mode: 'host',
    numQuestions: allItems.length,
    pickedBankQuestions,
    customQuestions,
    groupTags: allItems,
  };
  saveSettings(settings);

  const logLines: string[] = [];
  const progressLog = (msg: string) => {
    logLines.push(msg);
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
        <div class="pi-think-status">${escapeHtml(msg)}</div>
      </div>
    `;
  };

  const llm: LLMBackend = backend === 'groq'
    ? new GroqFallbackBackend(apiKey, GroqFallbackBackend.withPreferred(model || undefined, 'generator'), { onEvent: progressLog })
    : new HFBackend(apiKey, model || HF_DEFAULT_MODEL);

  const generator = new PhantomInkGenerator(llm);

  try {
    const result = await generator.generate({
      answerMode,
      numQuestions: allItems.length,
      pickedBankQuestions: settings.pickedBankQuestions,
      customQuestions: settings.customQuestions,
      onProgress: progressLog,
      answer: humanAnswer || undefined,
    });
    if (result.questions[0]?.reply === '（生成失敗）') {
      throw new Error('生成失敗');
    }
    const usedModel = llm.lastUsedModel;
    if (usedModel) progressLog(`🤖 本次由 ${usedModel} 完成`);
    renderHostCommands(root, result.questions, result.answer, hostQuestionId, cmdPrefix, allItems, usedModel, llm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLines.push(`❌ ${msg}`);
    root.innerHTML = `
      <div class="pi-error open">
        <h2>生成失敗</h2>
        <pre class="pi-error-msg">${escapeHtml(msg)}</pre>
        <button id="pi-host-retry" class="pi-btn pi-btn-answer">重試</button>
        <button id="pi-host-back" class="pi-btn pi-btn-finish">← 返回</button>
      </div>
      <div class="pi-log-below">
        <div class="pi-log-body open">${logLines.map((l) => `<div class="pi-log-line">${escapeHtml(l)}</div>`).join('')}</div>
      </div>
    `;
    document.getElementById('pi-host-retry')?.addEventListener('click', () => renderHostSetup(root, loadSettings()));
    document.getElementById('pi-host-back')?.addEventListener('click', () => renderHomeMenu(root));
  }
}

// ── Command cards page ──

function resolveCmdLine(card: HostCard, state: HostPageState): string {
  const bpmf = toBopomofoCells(card.reply).join('');
  if (!bpmf) return '';
  const g = card.tag?.group ?? 0;
  const o = card.tag?.option ?? 0;
  if (g <= 0 || o <= 0) return '';
  return buildClueCommand({ prefix: state.prefix, questionId: state.questionId, group: g, option: o, zhuyin: bpmf });
}

function renderCardHtml(card: HostCard, qIdx: number, state: HostPageState): string {
  const qLabel = card.tag
    ? `Q（題組 ${card.tag.group}・選項 ${card.tag.option}）`
    : 'Q（⚠️ 無題組編號）';
  const bpmf = toBopomofoCells(card.reply).join('');

  // Tag input — value reflects cards[idx].tag. When null/unset, value="".
  const groupVal = card.tag?.group ?? '';
  const optionVal = card.tag?.option ?? '';
  const tagStyleColor = card.tag ? 'var(--pi-text-faint)' : 'var(--pi-danger)';
  const tagHtml = `
    <span style="font-size:11px;color:${tagStyleColor};">
      題組: <input class="pi-host-edit-group" data-idx="${qIdx}" type="number" value="${groupVal}" style="width:48px;">
      選項: <input class="pi-host-edit-option" data-idx="${qIdx}" type="number" value="${optionVal}" style="width:48px;">
    </span>`;

  const regenerateBtn = `<button class="pi-host-regenerate-one" data-idx="${qIdx}" data-question="${escapeHtml(card.question)}" style="background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:11px;">🔄 再生一個</button>`;
  const restoreBtn = card.previousReply
    ? `<button class="pi-host-restore-one" data-idx="${qIdx}" style="background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:11px;">↩ 還原上一個</button>`
    : '';

  if (!bpmf) {
    return `<div class="pi-q-card" style="opacity:0.6;">
      <div class="pi-q-num">${qLabel}</div>
      <div class="pi-q-text">${escapeHtml(card.question)}</div>
      <div style="color:var(--pi-text-faint);font-size:12px;">⚠️ 此回答無法轉注音</div>
      ${tagHtml}
      <div class="pi-host-cmd-line-${qIdx}" data-cmd-line="${qIdx}"></div>
    </div>`;
  }

  const cmd = resolveCmdLine(card, state);
  const cmdLine = cmd
    ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-family:Consolas,monospace;font-size:12px;background:var(--pi-surface);padding:6px 8px;border-radius:4px;word-break:break-all;">
        <span style="flex:1;color:var(--pi-green-bright);">${escapeHtml(cmd)}</span>
        <button class="pi-host-copy-cmd" data-cmd="${escapeHtml(cmd)}" style="flex-shrink:0;background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:12px;">📋</button>
      </div>`
    : '<div style="color:var(--pi-danger);font-size:12px;margin-top:4px;">請補題組/選項編號</div>';

  const errorSlot = `<div class="pi-host-error-slot-${qIdx}" style="color:var(--pi-danger);font-size:12px;margin-top:4px;"></div>`;

  return `<div class="pi-q-card" data-card-idx="${qIdx}">
    <div class="pi-q-num">${qLabel}</div>
    <div class="pi-q-text">${escapeHtml(card.question)}</div>
    ${tagHtml}
    <div style="margin-top:6px;font-size:12px;color:var(--pi-text-dim);">
      回答：<span class="pi-host-reply-text-${qIdx}">${escapeHtml(card.reply)}</span>　注音：<strong class="pi-host-bpmf-text-${qIdx}" style="color:var(--pi-green-bright);font-family:Consolas,monospace;">${bpmf}</strong>
      <span style="margin-left:8px;">${regenerateBtn}${restoreBtn}</span>
    </div>
    <div class="pi-host-cmd-line-${qIdx}" data-cmd-line="${qIdx}">${cmdLine}</div>
    ${errorSlot}
  </div>`;
}

export function renderHostCommands(
  root: HTMLElement,
  questions: { question: string; reply: string }[],
  answer: string,
  questionId: string,
  prefix: string,
  tags: { group: number; index: number; text: string }[],
  usedModel?: string,
  llm?: LLMBackend,
): void {
  const tagByNorm = new Map(tags.map((t) => [normalizeQuestion(t.text), t]));
  const rawCards: HostCard[] = questions.map((q) => {
    const tag = tagByNorm.get(normalizeQuestion(q.question)) ?? null;
    return { question: q.question, tag: tag ? { group: tag.group, option: tag.index } : null, reply: q.reply };
  });

  // 照題組/選項排序：未配對 group 的（舊資料）排最後，否則 (group, option) 升冪。
  // 排序穩定（Array.sort 是穩定的），所以同組的題目仍維持原本順序。
  const cards = [...rawCards].sort((a, b) => {
    const ga = a.tag?.group ?? Number.MAX_SAFE_INTEGER;
    const gb = b.tag?.group ?? Number.MAX_SAFE_INTEGER;
    if (ga !== gb) return ga - gb;
    const oa = a.tag?.option ?? Number.MAX_SAFE_INTEGER;
    const ob = b.tag?.option ?? Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });

  const initialPrefix = prefix || 'ghostink';
  const state: HostPageState = { questionId, prefix: initialPrefix };

  function renderCards() {
    const cardsContainer = document.getElementById('pi-host-cards');
    if (!cardsContainer) return;
    cardsContainer.innerHTML = cards.map((c, i) => renderCardHtml(c, i, state)).join('');
  }

  function recomputeCmdLine(idx: number) {
    const card = cards[idx];
    if (!card) return;
    const slot = document.querySelector<HTMLElement>(`[data-cmd-line="${idx}"]`);
    if (!slot) return;
    const cmd = resolveCmdLine(card, state);
    slot.innerHTML = cmd
      ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-family:Consolas,monospace;font-size:12px;background:var(--pi-surface);padding:6px 8px;border-radius:4px;word-break:break-all;">
          <span style="flex:1;color:var(--pi-green-bright);">${escapeHtml(cmd)}</span>
          <button class="pi-host-copy-cmd" data-cmd="${escapeHtml(cmd)}" style="flex-shrink:0;background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:12px;">📋</button>
        </div>`
      : '<div style="color:var(--pi-danger);font-size:12px;margin-top:4px;">請補題組/選項編號</div>';
  }

  function recomputeAllCmdLines() {
    cards.forEach((_, i) => recomputeCmdLine(i));
    refreshCopyAllLabel();
  }

  function refreshCopyAllLabel() {
    const btn = document.getElementById('pi-host-copy-all');
    if (!btn) return;
    const validCount = cards.filter((c) => resolveCmdLine(c, state)).length;
    const skipped = cards.length - validCount;
    btn.innerHTML = `📋 複製全部（${validCount}）${skipped > 0 ? `<span style="font-size:10px;opacity:0.7;">（略過 ${skipped} 題）</span>` : ''}`;
  }

  function renderFullPage() {
    root.innerHTML = `
      <div class="pi-settings open">
        <div style="display:flex;align-items:center;font-size:12px;margin-bottom:12px;">
          <a href="#" id="pi-host-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回</a>
        </div>

        <h2>🎙️ 指令頁</h2>

        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:10px;background:var(--pi-surface);border-radius:8px;">
          <label style="font-size:13px;color:var(--pi-text-dim);">題目id:</label>
          <input id="pi-host-qid-display" type="text" value="${escapeHtml(state.questionId)}" style="width:80px;padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;">

          <label style="font-size:13px;color:var(--pi-text-dim);margin-left:8px;">前綴:</label>
          <select id="pi-host-prefix-display" style="padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;">
            <option value="ghostink" ${state.prefix === 'ghostink' ? 'selected' : ''}>ghostink</option>
            <option value="phantomink" ${state.prefix === 'phantomink' ? 'selected' : ''}>phantomink</option>
            <option value="__custom__" ${![ 'ghostink', 'phantomink' ].includes(state.prefix) ? 'selected' : ''}>自訂</option>
          </select>
          <input id="pi-host-prefix-custom-display" type="text" placeholder="自訂前綴" value="${![ 'ghostink', 'phantomink' ].includes(state.prefix) ? escapeHtml(state.prefix) : ''}" style="width:100px;padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;display:${![ 'ghostink', 'phantomink' ].includes(state.prefix) ? 'inline' : 'none'};">

          <button id="pi-host-copy-all" class="pi-btn" style="height:32px;font-size:12px;margin-left:auto;padding:0 12px;background:var(--pi-green);color:#fff;border:none;border-radius:6px;cursor:pointer;"></button>
          <button id="pi-host-regenerate" class="pi-btn" style="height:32px;font-size:12px;padding:0 12px;background:var(--pi-key-dark);color:var(--pi-text-dim);border:none;border-radius:6px;cursor:pointer;">🔄 重新生成整組</button>
        </div>

        <div style="margin-bottom:12px;font-size:12px;color:var(--pi-text-dim);">
          謎底：${escapeHtml(answer)}${usedModel ? `　｜　模型：${escapeHtml(usedModel)}` : ''}
        </div>

        <details class="pi-host-bpmf-tool" style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-size:13px;color:var(--pi-text-dim);padding:6px 0;">🎵 文字轉注音（破音字處理）</summary>
          <div style="padding:6px 0;">
            <textarea class="pi-bpmf-input" rows="2" placeholder="輸入中文文字驗證注音，例如：音樂、銀行" style="width:100%;font-size:13px;"></textarea>
            <div class="pi-bpmf-output" style="margin-top:6px;font-size:14px;font-family:Consolas,monospace;background:var(--pi-surface);padding:8px 10px;border-radius:6px;min-height:32px;word-break:break-all;"></div>
          </div>
        </details>

        <div id="pi-host-cards"></div>
      </div>
    `;
    renderCards();
    refreshCopyAllLabel();
    attachDelegatedHandlers();
    wireHostBpmf();
  }

  // 指令頁的「文字轉注音」inline 工具 — 純本機,只為讓出題者快速驗證
  // 某個回答的注音是否正確(不需切到小工具頁)。
  function wireHostBpmf() {
    const input = root.querySelector<HTMLTextAreaElement>('.pi-host-bpmf-tool .pi-bpmf-input');
    const output = root.querySelector<HTMLElement>('.pi-host-bpmf-tool .pi-bpmf-output');
    if (!input || !output) return;
    const run = () => {
      const text = input.value.trim();
      output.textContent = text ? toBopomofo(text) : '';
    };
    input.addEventListener('input', run);
  }

  // R3/R5/R6: ONE click + ONE input listener per page. Dispatch by class.
  function attachDelegatedHandlers() {
    const cardsContainer = document.getElementById('pi-host-cards');
    if (!cardsContainer) return;

    cardsContainer.addEventListener('click', onCardsClick);
    cardsContainer.addEventListener('input', onCardsInput);
    document.getElementById('pi-host-qid-display')?.addEventListener('input', onQidOrPrefixInput);
    document.getElementById('pi-host-prefix-display')?.addEventListener('change', onQidOrPrefixInput);
    document.getElementById('pi-host-prefix-custom-display')?.addEventListener('input', onQidOrPrefixInput);

    document.getElementById('pi-host-copy-all')?.addEventListener('click', onCopyAll);
    document.getElementById('pi-host-regenerate')?.addEventListener('click', onRegenerateAll);
    document.getElementById('pi-host-back')?.addEventListener('click', onBackToHome);
  }

  function onCardsClick(e: Event) {
    const target = e.target as HTMLElement;
    if (!target) return;
    const copyBtn = target.closest<HTMLElement>('.pi-host-copy-cmd');
    if (copyBtn) {
      const cmd = copyBtn.getAttribute('data-cmd') || '';
      navigator.clipboard.writeText(cmd).catch(() => {});
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✅';
      setTimeout(() => { if (copyBtn.textContent === '✅') copyBtn.textContent = orig; }, 1200);
      return;
    }
    const regenBtn = target.closest<HTMLElement>('.pi-host-regenerate-one');
    if (regenBtn) {
      void handleRegenerate(regenBtn);
      return;
    }
    const restoreBtn = target.closest<HTMLElement>('.pi-host-restore-one');
    if (restoreBtn) {
      handleRestore(restoreBtn);
      return;
    }
  }

  function onCardsInput(e: Event) {
    const target = e.target as HTMLInputElement | null;
    if (!target) return;
    if (!target.classList.contains('pi-host-edit-group') && !target.classList.contains('pi-host-edit-option')) return;
    const idx = parseInt(target.getAttribute('data-idx') ?? '', 10);
    if (isNaN(idx) || idx >= cards.length) return;
    const card = cards[idx];
    const groupVal = parseInt((root.querySelector<HTMLInputElement>(`.pi-host-edit-group[data-idx="${idx}"]`)?.value) || '0', 10);
    const optionVal = parseInt((root.querySelector<HTMLInputElement>(`.pi-host-edit-option[data-idx="${idx}"]`)?.value) || '0', 10);
    const g = Number.isFinite(groupVal) ? groupVal : 0;
    const o = Number.isFinite(optionVal) ? optionVal : 0;
    card.tag = (g > 0 && o > 0) ? { group: g, option: o } : (card.tag ?? null);
    recomputeCmdLine(idx);
    refreshCopyAllLabel();
  }

  function onQidOrPrefixInput() {
    state.questionId = (document.getElementById('pi-host-qid-display') as HTMLInputElement | null)?.value ?? state.questionId;
    const selectVal = (document.getElementById('pi-host-prefix-display') as HTMLSelectElement | null)?.value ?? state.prefix;
    const custom = (document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement | null)?.value?.trim();
    state.prefix = selectVal === '__custom__' ? (custom || 'ghostink') : selectVal;
    recomputeAllCmdLines();
  }

  function onCopyAll() {
    const cmds = cards
      .map((c) => resolveCmdLine(c, state))
      .filter(Boolean)
      .sort((a, b) => {
        const ga = parseInt(a.match(/題組:(\d+)/)?.[1] ?? '0', 10);
        const gb = parseInt(b.match(/題組:(\d+)/)?.[1] ?? '0', 10);
        if (ga !== gb) return ga - gb;
        const oa = parseInt(a.match(/選項:(\d+)/)?.[1] ?? '0', 10);
        const ob = parseInt(b.match(/選項:(\d+)/)?.[1] ?? '0', 10);
        return oa - ob;
      })
      .join('\n');
    navigator.clipboard.writeText(cmds).catch(() => {});
    const btn = document.getElementById('pi-host-copy-all');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ 已複製！';
      setTimeout(() => { btn.innerHTML = orig; refreshCopyAllLabel(); }, 1200);
    }
  }

  function onRegenerateAll() {
    renderHostSetup(root, loadSettings());
  }

  function onBackToHome(e: Event) {
    e.preventDefault();
    renderHomeMenu(root);
  }

  async function handleRegenerate(btn: HTMLElement) {
    if (!llm) return;
    const idx = parseInt(btn.getAttribute('data-idx') ?? '', 10);
    if (isNaN(idx) || idx >= cards.length) return;
    const card = cards[idx];
    const question = btn.getAttribute('data-question') ?? card.question;
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    (btn as HTMLButtonElement).disabled = true;
    const errSlot = root.querySelector(`.pi-host-error-slot-${idx}`);
    if (errSlot) errSlot.textContent = '';

    // BUG FIX: the LLM passed in here was built in startHostGeneration() and
    // has an onEvent that REPLACES root.innerHTML with the loading screen.
    // That onEvent stays attached for the lifetime of the backend, so a
    // single-question fallback (e.g. "改用下一個模型⋯⋯") was wiping out the
    // command-cards page and showing the loading screen — looks like a full
    // re-generation. Swap to a local onEvent that only updates this card's
    // slot, then restore on the way out (success or failure).
    const groqLlm = llm as { onEvent?: (msg: string) => void };
    const previousOnEvent = groqLlm.onEvent;
    if (typeof previousOnEvent === 'function') {
      groqLlm.onEvent = (msg: string) => {
        if (errSlot) errSlot.textContent = `🔄 ${msg}`;
      };
    }

    try {
      const generator = new PhantomInkGenerator(llm);
      const avoid = cards.filter((_, i) => i !== idx).map((c) => c.reply).filter(Boolean);
      const rejected = card.reply ? [card.reply] : [];
      const newReply = await generator.regenerateReply(answer, question, { avoid, rejected });
      // Save the replaced reply so the restore button can swap it back.
      card.previousReply = card.reply;
      card.reply = newReply;
      // Local DOM update — do NOT re-render the whole page (would clobber focus).
      const replySpan = root.querySelector(`.pi-host-reply-text-${idx}`);
      const bpmfSpan = root.querySelector(`.pi-host-bpmf-text-${idx}`);
      const newBpmf = toBopomofoCells(newReply).join('');
      if (replySpan) replySpan.textContent = newReply;
      if (bpmfSpan) bpmfSpan.textContent = newBpmf;
      recomputeCmdLine(idx);
      refreshCopyAllLabel();
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = originalText ?? '🔄 再生一個'; (btn as HTMLButtonElement).disabled = false; }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (errSlot) errSlot.textContent = `❌ ${msg}`;
      btn.textContent = originalText ?? '🔄 再生一個';
      (btn as HTMLButtonElement).disabled = false;
    } finally {
      if (typeof previousOnEvent === 'function') groqLlm.onEvent = previousOnEvent;
    }
  }

  function handleRestore(btn: HTMLElement) {
    const idx = parseInt(btn.getAttribute('data-idx') ?? '', 10);
    if (isNaN(idx) || idx >= cards.length) return;
    const card = cards[idx];
    if (!card.previousReply) return;
    card.reply = card.previousReply;
    card.previousReply = undefined;
    // Local DOM update — same rules as regenerate.
    const replySpan = root.querySelector(`.pi-host-reply-text-${idx}`);
    const bpmfSpan = root.querySelector(`.pi-host-bpmf-text-${idx}`);
    const newBpmf = toBopomofoCells(card.reply).join('');
    if (replySpan) replySpan.textContent = card.reply;
    if (bpmfSpan) bpmfSpan.textContent = newBpmf;
    recomputeCmdLine(idx);
    refreshCopyAllLabel();
    // Re-render the card so the restore button disappears (no previousReply anymore).
    const cardEl = root.querySelector(`.pi-q-card[data-card-idx="${idx}"]`);
    cardEl?.replaceWith((() => {
      const wrap = document.createElement('div');
      wrap.innerHTML = renderCardHtml(card, idx, state);
      return wrap.firstElementChild!;
    })());
  }

  renderFullPage();
}

