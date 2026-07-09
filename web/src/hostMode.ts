// web/src/hostMode.ts
//
// Host-mode (出題者) setup page and command-card page. Rendered by main.ts
// when settings.mode === 'host'.
//
// R3/R5/R6 architecture:
// - Single source of truth: cards[i].tag is always the current value
//   (parse-paste or user-typed); never re-read from DOM.
// - Event delegation: one click + one input listener per page, dispatched
//   by class. No re-attach after innerHTML re-render.
// - Local updates: editing a card updates only that card's cmd-line/reply/bpmf;
//   editing questionId/prefix updates all cmd-line-X in place. focus is never
//   moved by our code.
import { escapeHtml } from './game';
import { loadSettings, saveSettings, type Settings } from './settings';
import { parseGroupedQuestions, matchToBank, normalizeQuestion } from './groupPaste';
import { toBopomofoCells } from './bopomofo';
import { buildClueCommand } from './hostCommands';
import type { LLMBackend } from './backends/shared';
import { QUESTION_BANK } from './generator/prompts';
import { GroqFallbackBackend } from './backends/fallbackGroq';
import { HFBackend, HF_DEFAULT_MODEL } from './backends/hf';
import { PhantomInkGenerator } from './generator/generator';

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

// ── Mode selection screen ──

/** Two large buttons for host vs player mode. */
export function renderHostModeSelection(root: HTMLElement, onMode: (mode: 'host' | 'player') => void): void {
  const existing = loadSettings();
  // Only mark a card "selected" when mode is explicitly set. With no mode yet
  // (first-time visitor, or just cleared via 切換模式) both buttons should look
  // equally clickable — otherwise the player card looks pre-selected and the
  // host card looks disabled, which misleads new users into tapping player.
  const hostSelected = existing?.mode === 'host';
  const playerSelected = existing?.mode === 'player';
  root.innerHTML = `
    <div class="pi-settings open" style="text-align:center;">
      <h2 style="margin-bottom:8px;">幽靈筆跡 👻</h2>
      <p style="font-size:13px;color:var(--pi-text-dim);margin-bottom:24px;">選擇你的角色</p>
      <div style="display:flex;flex-direction:column;gap:12px;max-width:320px;margin:0 auto;">
        <button class="pi-mode-btn${hostSelected ? ' pi-mode-selected' : ''}" data-mode="host" style="padding:20px;font-size:16px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid ${hostSelected ? 'var(--pi-green-bright)' : 'var(--pi-border)'};border-radius:12px;cursor:pointer;">
          <div style="font-size:32px;margin-bottom:6px;">🎙️</div>
          <div>出題者</div>
          <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:4px;">生成題組、取得 BOT 指令</div>
        </button>
        <button class="pi-mode-btn${playerSelected ? ' pi-mode-selected' : ''}" data-mode="player" style="padding:20px;font-size:16px;font-weight:700;background:var(--pi-card-bg);color:var(--pi-text);border:2px solid ${playerSelected ? 'var(--pi-green-bright)' : 'var(--pi-border)'};border-radius:12px;cursor:pointer;">
          <div style="font-size:32px;margin-bottom:6px;">🎮</div>
          <div>玩家</div>
          <div style="font-size:12px;font-weight:400;color:var(--pi-text-dim);margin-top:4px;">出題生成、進行遊戲</div>
        </button>
      </div>
    </div>
  `;

  root.querySelectorAll('.pi-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode') as 'host' | 'player';
      onMode(mode);
    });
  });
}

/** Click to clear `settings.mode` and reload — the only path that resets the mode. */
function clearModeAndReload(): void {
  const s = loadSettings();
  if (s) {
    s.mode = undefined;
    saveSettings(s);
  }
  window.location.reload();
}

// ── Setup screen ──

/**
 * Render the host-mode setup screen (simplified: no N/M, no bank picker).
 * `pasteText` (optional) pre-fills the group-paste textarea — used by R7 to
 * restore the user's last paste when they hit "🔄 重新生成整組" on the
 * command page.
 */
export function renderHostSetup(
  root: HTMLElement,
  existing: Settings | null,
  pasteText?: string,
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
  // R7: prefer the paste passed in (regen-all → same session); otherwise
  // rebuild from saved groupTags so the textarea is never blank after a regen.
  const initialPaste = pasteText
    ?? (existing?.groupTags && existing.groupTags.length > 0
      ? rebuildPasteText(existing.groupTags)
      : '');

  root.innerHTML = `
    <div class="pi-settings open">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
        <a href="#" id="pi-host-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回設定</a>
        <a href="#" id="pi-switch-mode" style="color:var(--pi-text-dim);text-decoration:none;">⇄ 切換模式</a>
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

      <div class="pi-settings-group">
        <label>貼上題組（出題者模式的主要輸入方式）</label>
        <p style="font-size:12px;color:var(--pi-text-faint);margin:4px 0 8px;">格式：一組一行「第 N 組」標題，以下逐行列題目文字。</p>
        <div id="pi-host-parse-status" style="font-size:13px;color:var(--pi-text-dim);margin-bottom:4px;"></div>
        <textarea id="pi-host-paste" class="pi-group-paste" rows="6" placeholder="第 1 組&#10;它會去哪裡？&#10;它存放在哪裡？&#10;&#10;第 2 組&#10;它的重量和什麼相仿？"></textarea>
        <div id="pi-host-parse-result" style="font-size:13px;margin-top:4px;"></div>
      </div>

      <p class="pi-privacy-note">Key 只存在你目前這台裝置的瀏覽器裡，不會送到任何伺服器。</p>

      <div class="pi-settings-actions">
        <button id="pi-host-generate" class="pi-btn pi-btn-answer" disabled>🎙️ 生成題組</button>
      </div>
    </div>
  `;

  // Pre-fill paste (R7) BEFORE wiring updateParseStatus so the initial status reflects it.
  if (initialPaste) {
    const pasteArea = document.getElementById('pi-host-paste') as HTMLTextAreaElement | null;
    if (pasteArea) pasteArea.value = initialPaste;
  }

  function updateParseStatus() {
    const pasteArea = document.getElementById('pi-host-paste') as HTMLTextAreaElement | null;
    const statusEl = document.getElementById('pi-host-parse-status');
    const resultEl = document.getElementById('pi-host-parse-result');
    const genBtn = document.getElementById('pi-host-generate') as HTMLButtonElement | null;
    if (!pasteArea || !statusEl || !resultEl || !genBtn) return;
    const raw = pasteArea.value.trim();
    if (!raw) {
      statusEl.textContent = '';
      resultEl.innerHTML = '';
      genBtn.disabled = true;
      return;
    }
    const parsed = parseGroupedQuestions(raw);
    const matched = matchToBank(parsed.items, QUESTION_BANK);
    const total = parsed.items.length;
    const matchedCount = matched.matched.length;
    const errors = parsed.errors;
    let html = '';
    if (errors.length) {
      html += `<div style="color:var(--pi-danger);font-size:12px;">${errors.join('<br>')}</div>`;
    }
    html += `<div style="font-size:12px;color:var(--pi-text-dim);">解析到 ${total} 題，${matchedCount} 題匹配題庫，${total - matchedCount} 題自訂</div>`;
    resultEl.innerHTML = html;
    statusEl.textContent = total > 0 ? `✅ ${total} 題` : '⚠️ 尚未貼上題組';
    genBtn.disabled = total === 0;
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

  document.getElementById('pi-host-paste')?.addEventListener('input', updateParseStatus);
  updateParseStatus();

  document.getElementById('pi-host-generate')?.addEventListener('click', () => startHostGeneration(root));
  document.getElementById('pi-switch-mode')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearModeAndReload();
  });
  // 「← 返回設定」 in hostSetup itself: the only "back" here would be to the
  // mode-selection screen. Same intent as the mode switch — but this entry
  // point is named to match the convention. (Caller is in the same mode.)
  document.getElementById('pi-host-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearModeAndReload();
  });
}

// ── Generation ──

async function startHostGeneration(root: HTMLElement): Promise<void> {
  const backend = (document.getElementById('pi-backend') as HTMLSelectElement)?.value as 'groq' | 'hf' || 'groq';
  const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement)?.value.trim();
  const model = (document.getElementById('pi-model') as HTMLInputElement)?.value.trim();
  const answerMode = (document.querySelector<HTMLInputElement>('input[name="answer-mode"]:checked')?.value ?? 'ai') as 'ai' | 'human';
  const humanAnswer = (document.getElementById('pi-human-answer') as HTMLInputElement)?.value.trim();
  const hostQuestionId = (document.getElementById('pi-host-qid') as HTMLInputElement)?.value.trim() || '';
  const rawPaste = (document.getElementById('pi-host-paste') as HTMLTextAreaElement)?.value.trim();

  if (!apiKey) return;
  if (!rawPaste) {
    const status = document.getElementById('pi-host-parse-status');
    if (status) status.innerHTML = '<span style="color:var(--pi-danger);">⚠️ 請先貼上題組</span>';
    return;
  }
  if (!hostQuestionId) {
    const qidInput = document.getElementById('pi-host-qid');
    if (qidInput) qidInput.style.borderColor = 'var(--pi-danger)';
    return;
  }

  const prefixSelect = document.getElementById('pi-cmd-prefix') as HTMLSelectElement | null;
  let cmdPrefix = prefixSelect?.value ?? 'ghostink';
  if (cmdPrefix === '__custom__') {
    cmdPrefix = (document.getElementById('pi-cmd-prefix-custom') as HTMLInputElement)?.value.trim() || 'ghostink';
  }

  const parsed = parseGroupedQuestions(rawPaste);
  if (parsed.items.length === 0) return;

  const matched = matchToBank(parsed.items, QUESTION_BANK);
  const pickedBankQuestions = matched.matched.map((m) => m.bankQuestion);
  const customQuestions = matched.unmatched.map((m) => m.text);

  const settings: Settings = {
    backend, apiKey, model,
    answerMode, humanAnswer,
    hostQuestionId, cmdPrefix,
    mode: 'host',
    numQuestions: parsed.items.length,
    pickedBankQuestions,
    customQuestions,
    groupTags: parsed.items,
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
      numQuestions: parsed.items.length,
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
    renderHostCommands(root, result.questions, result.answer, hostQuestionId, cmdPrefix, parsed.items, usedModel, llm, rawPaste);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLines.push(`❌ ${msg}`);
    root.innerHTML = `
      <div class="pi-error open">
        <h2>生成失敗</h2>
        <pre class="pi-error-msg">${escapeHtml(msg)}</pre>
        <button id="pi-host-retry" class="pi-btn pi-btn-answer">重試</button>
        <button id="pi-host-back" class="pi-btn pi-btn-finish">← 返回設定</button>
      </div>
      <div class="pi-log-below">
        <div class="pi-log-body open">${logLines.map((l) => `<div class="pi-log-line">${escapeHtml(l)}</div>`).join('')}</div>
      </div>
    `;
    document.getElementById('pi-host-retry')?.addEventListener('click', () => renderHostSetup(root, loadSettings(), rawPaste));
    document.getElementById('pi-host-back')?.addEventListener('click', () => renderHostSetup(root, loadSettings(), rawPaste));
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
  /** R7 — paste text to restore if the user later clicks 重新生成整組. */
  pasteText?: string,
): void {
  const tagByNorm = new Map(tags.map((t) => [normalizeQuestion(t.text), t]));
  const cards: HostCard[] = questions.map((q) => {
    const tag = tagByNorm.get(normalizeQuestion(q.question)) ?? null;
    return { question: q.question, tag: tag ? { group: tag.group, option: tag.index } : null, reply: q.reply };
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
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:12px;">
          <a href="#" id="pi-host-back" style="color:var(--pi-text-dim);text-decoration:none;">← 返回設定</a>
          <a href="#" id="pi-switch-from-commands" style="color:var(--pi-text-dim);text-decoration:none;">⇄ 切換模式</a>
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

        <div id="pi-host-cards"></div>
      </div>
    `;
    renderCards();
    refreshCopyAllLabel();
    attachDelegatedHandlers();
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
    document.getElementById('pi-switch-from-commands')?.addEventListener('click', onSwitchMode);
    document.getElementById('pi-host-back')?.addEventListener('click', onBackToSetup);
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
    if (!pasteText) {
      // No paste to restore (e.g. direct call from a test) — go back without prefilling.
      renderHostSetup(root, loadSettings());
      return;
    }
    renderHostSetup(root, loadSettings(), pasteText);
  }

  function onSwitchMode(e: Event) {
    e.preventDefault();
    clearModeAndReload();
  }

  function onBackToSetup(e: Event) {
    e.preventDefault();
    renderHostSetup(root, loadSettings(), pasteText);
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

/** Rebuild the paste-area text from saved groupTags (R7). Group 1 lines, then 2, etc. */
export function rebuildPasteText(groupTags: { group: number; index: number; text: string }[]): string {
  const lines: string[] = [];
  let currentGroup = 0;
  for (const tag of groupTags) {
    if (tag.group !== currentGroup) {
      lines.push(`第 ${tag.group} 組`);
      currentGroup = tag.group;
    }
    const text = tag.text.endsWith('？') || tag.text.endsWith('?') ? tag.text : `${tag.text}？`;
    lines.push(text);
  }
  return lines.join('\n');
}
