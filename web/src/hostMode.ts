// web/src/hostMode.ts
//
// Host-mode (出題者) setup page and command-card page. Rendered by main.ts
// when settings.mode === 'host'.
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
}

// ── Mode selection screen ──

/** Two large buttons for host vs player mode. */
export function renderHostModeSelection(root: HTMLElement, onMode: (mode: 'host' | 'player') => void): void {
  const existing = loadSettings();
  const hostSelected = existing?.mode === 'host';
  const playerSelected = existing?.mode === 'player' || !existing?.mode;
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

// ── Setup screen ──

/**
 * Render the host-mode setup screen (simplified: no N/M, no bank picker,
 * no host commands section — just API key, answer source, group paste area,
 * questionId, and cmd prefix).
 */
export function renderHostSetup(root: HTMLElement, existing: Settings | null): void {
  const apiKey = escapeHtml(existing?.apiKey ?? '');
  const model = escapeHtml(existing?.model ?? '');
  const answerMode = existing?.answerMode ?? 'ai';
  const humanAnswer = escapeHtml(existing?.humanAnswer ?? '');
  const hostQuestionId = escapeHtml(existing?.hostQuestionId ?? '');
  const cmdPrefix = existing?.cmdPrefix ?? 'ghostink';
  const aiChecked = answerMode === 'ai' ? 'checked' : '';
  const humanChecked = answerMode === 'human' ? 'checked' : '';
  const humanVisible = answerMode === 'human' ? 'style="display:block"' : 'style="display:none"';

  root.innerHTML = `
    <div class="pi-settings open">
      <div style="text-align:right;font-size:12px;margin-bottom:12px;">
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
        <button id="pi-host-back" class="pi-btn pi-btn-finish">← 返回</button>
      </div>
    </div>
  `;

  // Toggle human answer
  root.querySelectorAll<HTMLInputElement>('input[name="answer-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const area = document.getElementById('pi-human-answer-area');
      if (area) area.style.display = radio.value === 'human' ? 'block' : 'none';
    });
  });

  // Toggle custom prefix field
  const prefixSelect = document.getElementById('pi-cmd-prefix') as HTMLSelectElement | null;
  const prefixCustom = document.getElementById('pi-cmd-prefix-custom') as HTMLInputElement | null;
  prefixSelect?.addEventListener('change', () => {
    if (prefixCustom) {
      prefixCustom.style.display = prefixSelect.value === '__custom__' ? 'block' : 'none';
    }
  });

  // Parse paste area as user types
  const pasteArea = document.getElementById('pi-host-paste') as HTMLTextAreaElement | null;
  const statusEl = document.getElementById('pi-host-parse-status');
  const resultEl = document.getElementById('pi-host-parse-result');
  const genBtn = document.getElementById('pi-host-generate') as HTMLButtonElement | null;

  function updateParseStatus() {
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

  pasteArea?.addEventListener('input', updateParseStatus);
  updateParseStatus();

  // Generate button
  genBtn?.addEventListener('click', () => startHostGeneration(root));

  // Switch mode link — clear mode and reload to mode selection
  document.getElementById('pi-switch-mode')?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = loadSettings();
    if (s) {
      s.mode = undefined;
      saveSettings(s);
    }
    window.location.reload();
  });

  // Back button
  document.getElementById('pi-host-back')?.addEventListener('click', () => {
    const s = loadSettings();
    if (s) {
      s.mode = undefined;
      saveSettings(s);
    }
    window.location.reload();
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
    if (qidInput) { qidInput.style.borderColor = 'var(--pi-danger)'; }
    return;
  }

  // Resolve prefix
  const prefixSelect = document.getElementById('pi-cmd-prefix') as HTMLSelectElement | null;
  let cmdPrefix = prefixSelect?.value ?? 'ghostink';
  if (cmdPrefix === '__custom__') {
    cmdPrefix = (document.getElementById('pi-cmd-prefix-custom') as HTMLInputElement)?.value.trim() || 'ghostink';
  }

  // Parse paste
  const parsed = parseGroupedQuestions(rawPaste);
  if (parsed.items.length === 0) return;

  const matched = matchToBank(parsed.items, QUESTION_BANK);
  const pickedBankQuestions = matched.matched.map((m) => m.bankQuestion);
  const customQuestions = matched.unmatched.map((m) => m.text);

  // Save settings for next visit
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

  // Show loading
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

  // Build backend and generate
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
    renderHostCommands(root, result.questions, result.answer, hostQuestionId, cmdPrefix, parsed.items, usedModel, llm);
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
    document.getElementById('pi-host-retry')?.addEventListener('click', () => renderHostSetup(root, loadSettings()));
    document.getElementById('pi-host-back')?.addEventListener('click', () => renderHostSetup(root, loadSettings()));
  }
}

// ── Command cards page ──

function getPrefixLabel(prefix: string): string {
  return prefix || 'ghostink';
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
  // Build cards from the intersection of generated questions and tags.
  const tagByNorm = new Map(tags.map((t) => [normalizeQuestion(t.text), t]));
  const cards: HostCard[] = questions.map((q) => {
    const tag = tagByNorm.get(normalizeQuestion(q.question)) ?? null;
    return { question: q.question, tag: tag ? { group: tag.group, option: tag.index } : null, reply: q.reply };
  });

  const cmdPrefix = getPrefixLabel(prefix);

  function renderCardHtml(card: HostCard, qIdx: number, currentQid: string, currentPrefix: string): string {
    const qLabel = card.tag
      ? `Q（題組 ${card.tag.group}・選項 ${card.tag.option}）`
      : 'Q（⚠️ 無題組編號）';
    const bpmf = toBopomofoCells(card.reply).join('');
    const tagHtml = card.tag
      ? `
        <span style="font-size:11px;color:var(--pi-text-faint);">
          題組: <input class="pi-host-edit-group" data-idx="${qIdx}" type="number" value="${card.tag.group}" style="width:48px;">
          選項: <input class="pi-host-edit-option" data-idx="${qIdx}" type="number" value="${card.tag.option}" style="width:48px;">
        </span>`
      : `
        <span style="font-size:11px;color:var(--pi-danger);">
          題組: <input class="pi-host-edit-group" data-idx="${qIdx}" type="number" value="" style="width:48px;" placeholder="?">
          選項: <input class="pi-host-edit-option" data-idx="${qIdx}" type="number" value="" style="width:48px;" placeholder="?">
        </span>`;

    const regenerateBtn = llm
      ? `<button class="pi-host-regenerate-one" data-idx="${qIdx}" data-question="${escapeHtml(card.question)}" style="background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:11px;">🔄 再生一個</button>`
      : '';

    if (!bpmf) {
      return `<div class="pi-q-card" style="opacity:0.6;">
        <div class="pi-q-num">${qLabel}</div>
        <div class="pi-q-text">${escapeHtml(card.question)}</div>
        <div style="color:var(--pi-text-faint);font-size:12px;">⚠️ 此回答無法轉注音</div>
        ${tagHtml}
      </div>`;
    }

    // Determine if tag is valid for command generation
    const effectiveGroup = getEffectiveGroup(qIdx);
    const effectiveOption = getEffectiveOption(qIdx);
    const hasValidTag = effectiveGroup > 0 && effectiveOption > 0;

    const cmd = hasValidTag
      ? buildClueCommand({ prefix: currentPrefix, questionId: currentQid, group: effectiveGroup, option: effectiveOption, zhuyin: bpmf })
      : '';

    const cmdLine = cmd
      ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-family:Consolas,monospace;font-size:12px;background:var(--pi-surface);padding:6px 8px;border-radius:4px;word-break:break-all;">
          <span style="flex:1;color:var(--pi-green-bright);">${escapeHtml(cmd)}</span>
          <button class="pi-host-copy-cmd" data-cmd="${escapeHtml(cmd)}" style="flex-shrink:0;background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:12px;">📋</button>
        </div>`
      : '<div style="color:var(--pi-danger);font-size:12px;margin-top:4px;">請補題組/選項編號</div>';

    return `<div class="pi-q-card">
      <div class="pi-q-num">${qLabel}</div>
      <div class="pi-q-text">${escapeHtml(card.question)}</div>
      ${tagHtml}
      <div style="margin-top:6px;font-size:12px;color:var(--pi-text-dim);">
        回答：<span class="pi-host-reply-text-${qIdx}">${escapeHtml(card.reply)}</span>　注音：<strong class="pi-host-bpmf-text-${qIdx}" style="color:var(--pi-green-bright);font-family:Consolas,monospace;">${bpmf}</strong>
        <span style="margin-left:8px;">${regenerateBtn}</span>
      </div>
      <div class="pi-host-cmd-line-${qIdx}">${cmdLine}</div>
    </div>`;
  }

  function getEffectiveGroup(idx: number): number {
    const input = root.querySelector<HTMLInputElement>(`.pi-host-edit-group[data-idx="${idx}"]`);
    return input ? parseInt(input.value, 10) || 0 : cards[idx]?.tag?.group ?? 0;
  }

  function getEffectiveOption(idx: number): number {
    const input = root.querySelector<HTMLInputElement>(`.pi-host-edit-option[data-idx="${idx}"]`);
    return input ? parseInt(input.value, 10) || 0 : cards[idx]?.tag?.option ?? 0;
  }

  function updateAllCards() {
    const currentQid = (document.getElementById('pi-host-qid-display') as HTMLInputElement)?.value || questionId;
    const prefixSelect = document.getElementById('pi-host-prefix-display') as HTMLSelectElement | null;
    let currentPrefix = prefixSelect?.value || cmdPrefix;
    if (currentPrefix === '__custom__') {
      currentPrefix = (document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement)?.value?.trim() || 'ghostink';
    }
    const cardsContainer = document.getElementById('pi-host-cards');
    if (!cardsContainer) return;
    cardsContainer.innerHTML = cards.map((card, i) => renderCardHtml(card, i, currentQid, currentPrefix)).join('');

    // Re-attach copy handlers
    cardsContainer.querySelectorAll('.pi-host-copy-cmd').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd') || '';
        navigator.clipboard.writeText(cmd).catch(() => {});
        const orig = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => { if (btn.textContent === '✅') btn.textContent = orig; }, 1200);
      });
    });

    // Re-attach group/option edit listeners
    cardsContainer.querySelectorAll('.pi-host-edit-group, .pi-host-edit-option').forEach((el) => {
      el.addEventListener('input', () => updateAllCards());
    });

    // Re-attach prefix custom toggle
    const pcSelect = document.getElementById('pi-host-prefix-display') as HTMLSelectElement | null;
    const pcCustom = document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement | null;
    if (pcSelect) {
      pcSelect.onchange = () => {
        if (pcCustom) pcCustom.style.display = pcSelect.value === '__custom__' ? 'inline' : 'none';
        updateAllCards();
      };
    }
  }

  function renderFullPage(currentQid: string, currentPrefix: string) {
    const validCards = cards.filter((c) => {
      const g = getEffectiveGroup(cards.indexOf(c));
      const o = getEffectiveOption(cards.indexOf(c));
      return g > 0 && o > 0;
    });
    const skipped = cards.length - validCards.length;

    const cardsHtml = cards.map((card, i) => renderCardHtml(card, i, currentQid, currentPrefix)).join('');

    root.innerHTML = `
      <div class="pi-settings open">
        <div style="text-align:right;font-size:12px;margin-bottom:12px;">
          <a href="#" id="pi-switch-from-commands" style="color:var(--pi-text-dim);text-decoration:none;">⇄ 切換模式</a>
        </div>

        <h2>🎙️ 指令頁</h2>

        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:10px;background:var(--pi-surface);border-radius:8px;">
          <label style="font-size:13px;color:var(--pi-text-dim);">題目id:</label>
          <input id="pi-host-qid-display" type="text" value="${escapeHtml(currentQid)}" style="width:80px;padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;">

          <label style="font-size:13px;color:var(--pi-text-dim);margin-left:8px;">前綴:</label>
          <select id="pi-host-prefix-display" style="padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;">
            <option value="ghostink" ${currentPrefix === 'ghostink' ? 'selected' : ''}>ghostink</option>
            <option value="phantomink" ${currentPrefix === 'phantomink' ? 'selected' : ''}>phantomink</option>
            <option value="__custom__" ${![ 'ghostink', 'phantomink' ].includes(currentPrefix) ? 'selected' : ''}>自訂</option>
          </select>
          <input id="pi-host-prefix-custom-display" type="text" placeholder="自訂前綴" value="${![ 'ghostink', 'phantomink' ].includes(currentPrefix) ? escapeHtml(currentPrefix) : ''}" style="width:100px;padding:4px 8px;border:1px solid var(--pi-border);border-radius:4px;background:var(--pi-bg);color:var(--pi-text);font-size:13px;display:${![ 'ghostink', 'phantomink' ].includes(currentPrefix) ? 'inline' : 'none'};">

          <button id="pi-host-copy-all" class="pi-btn" style="height:32px;font-size:12px;margin-left:auto;padding:0 12px;background:var(--pi-green);color:#fff;border:none;border-radius:6px;cursor:pointer;">📋 複製全部（${validCards.length}）${skipped > 0 ? `<span style="font-size:10px;opacity:0.7;">（略過 ${skipped} 題）</span>` : ''}</button>
          <button id="pi-host-regenerate" class="pi-btn" style="height:32px;font-size:12px;padding:0 12px;background:var(--pi-key-dark);color:var(--pi-text-dim);border:none;border-radius:6px;cursor:pointer;">🔄 重新生成整組</button>
        </div>

        <div style="margin-bottom:12px;font-size:12px;color:var(--pi-text-dim);">
          謎底：${escapeHtml(answer)}${usedModel ? `　｜　模型：${escapeHtml(usedModel)}` : ''}
        </div>

        <div id="pi-host-cards">
          ${cardsHtml}
        </div>
      </div>
    `;

    // Wire up event handlers
    document.getElementById('pi-host-qid-display')?.addEventListener('input', () => updateAllCards());
    const pcSelect = document.getElementById('pi-host-prefix-display') as HTMLSelectElement | null;
    const pcCustom = document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement | null;
    pcSelect?.addEventListener('change', () => {
      if (pcCustom) pcCustom.style.display = pcSelect.value === '__custom__' ? 'inline' : 'none';
      updateAllCards();
    });
    pcCustom?.addEventListener('input', () => updateAllCards());

    document.getElementById('pi-host-copy-all')?.addEventListener('click', () => {
      const qid = (document.getElementById('pi-host-qid-display') as HTMLInputElement)?.value || questionId;
      let prefix = (document.getElementById('pi-host-prefix-display') as HTMLSelectElement)?.value || cmdPrefix;
      if (prefix === '__custom__') {
        prefix = (document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement)?.value?.trim() || 'ghostink';
      }
      const cmds = cards
        .map((c, i) => {
          const g = getEffectiveGroup(i);
          const o = getEffectiveOption(i);
          if (!(g > 0 && o > 0)) return '';
          const bpmf = toBopomofoCells(c.reply).join('');
          if (!bpmf) return '';
          return buildClueCommand({ prefix, questionId: qid, group: g, option: o, zhuyin: bpmf });
        })
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
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      }
    });

    document.getElementById('pi-host-regenerate')?.addEventListener('click', () => renderHostSetup(root, loadSettings()));

    // Copy individual command handlers
    root.querySelectorAll('.pi-host-copy-cmd').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd') || '';
        navigator.clipboard.writeText(cmd).catch(() => {});
        const orig = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => { if (btn.textContent === '✅') btn.textContent = orig; }, 1200);
      });
    });

    // Group/option edit listeners
    root.querySelectorAll('.pi-host-edit-group, .pi-host-edit-option').forEach((el) => {
      el.addEventListener('input', () => {
        const qid = (document.getElementById('pi-host-qid-display') as HTMLInputElement)?.value || questionId;
        let prefix = (document.getElementById('pi-host-prefix-display') as HTMLSelectElement)?.value || cmdPrefix;
        if (prefix === '__custom__') {
          prefix = (document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement)?.value?.trim() || 'ghostink';
        }
        renderFullPage(qid, prefix);
      });
    });

    // Regenerate one reply
    root.querySelectorAll('.pi-host-regenerate-one').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!llm || !answer) return;
        const idx = parseInt(btn.getAttribute('data-idx') ?? '', 10);
        if (isNaN(idx) || idx >= cards.length) return;
        const question = btn.getAttribute('data-question') ?? cards[idx].question;
        btn.textContent = '⏳';
        (btn as HTMLButtonElement).disabled = true;
        try {
          const generator = new PhantomInkGenerator(llm);
          const newReply = await generator.regenerateReply(answer, question);
          // Update card data
          cards[idx] = { ...cards[idx], reply: newReply };
          // Update the DOM directly without full re-render
          const replySpan = root.querySelector(`.pi-host-reply-text-${idx}`);
          const bpmfSpan = root.querySelector(`.pi-host-bpmf-text-${idx}`);
          const cmdLineDiv = root.querySelector(`.pi-host-cmd-line-${idx}`);
          if (replySpan) replySpan.textContent = newReply;
          const newBpmf = toBopomofoCells(newReply).join('');
          if (bpmfSpan) bpmfSpan.textContent = newBpmf;
          if (cmdLineDiv && newBpmf) {
            const currentQid = (document.getElementById('pi-host-qid-display') as HTMLInputElement)?.value || questionId;
            let cp = (document.getElementById('pi-host-prefix-display') as HTMLSelectElement)?.value || cmdPrefix;
            if (cp === '__custom__') cp = (document.getElementById('pi-host-prefix-custom-display') as HTMLInputElement)?.value?.trim() || 'ghostink';
            const g = getEffectiveGroup(idx);
            const o = getEffectiveOption(idx);
            const newCmd = g > 0 && o > 0 ? buildClueCommand({ prefix: cp, questionId: currentQid, group: g, option: o, zhuyin: newBpmf }) : '';
            cmdLineDiv.innerHTML = newCmd
              ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-family:Consolas,monospace;font-size:12px;background:var(--pi-surface);padding:6px 8px;border-radius:4px;word-break:break-all;">
                  <span style="flex:1;color:var(--pi-green-bright);">${escapeHtml(newCmd)}</span>
                  <button class="pi-host-copy-cmd" data-cmd="${escapeHtml(newCmd)}" style="flex-shrink:0;background:none;border:1px solid var(--pi-border);border-radius:4px;color:var(--pi-text-dim);cursor:pointer;padding:2px 8px;font-size:12px;">📋</button>
                </div>`
              : '<div style="color:var(--pi-danger);font-size:12px;margin-top:4px;">請補題組/選項編號</div>';
          }
          btn.textContent = '✅';
          setTimeout(() => { btn.textContent = '🔄 再生一個'; (btn as HTMLButtonElement).disabled = false; }, 1200);
        } catch {
          btn.textContent = '❌';
          setTimeout(() => { btn.textContent = '🔄 再生一個'; (btn as HTMLButtonElement).disabled = false; }, 1200);
        }
      });
    });
  }

  // Initial render
  renderFullPage(questionId, cmdPrefix);

  // Switch mode link — clear mode and reload to mode selection
  document.getElementById('pi-switch-from-commands')?.addEventListener('click', (e) => {
    e.preventDefault();
    const s = loadSettings();
    if (s) {
      s.mode = undefined;
      saveSettings(s);
    }
    window.location.reload();
  });
}
