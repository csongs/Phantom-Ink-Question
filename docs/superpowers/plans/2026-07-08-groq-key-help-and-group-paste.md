# 實作計畫：Groq API Key 申請說明 ＋ 題組貼上自動勾選 ＋ 主持指令產生

> 給實作模型的指示：
> - 嚴格照本文件實作，**不要**修改文件未提及的檔案或行為。
> - 所有程式碼為 TypeScript（strict mode），專案在 `web/` 目錄下。
> - 完成後在 `web/` 執行 `npm test`（vitest，約 70 秒）與 `npm run build`（tsc --noEmit + vite build），兩者都必須通過。
> - 文件中的程式碼區塊可直接使用；若與現況有微小出入（如行號），以「插入位置說明」為準。

---

## 背景

這是「幽靈筆跡（Phantom Ink）」出題工具。使用者是遊戲**主持人**：
- 遊戲平台上有機器人接受指令，格式：`/ghostink clue <組編號> <組內題號> <回答注音>`。
- 題目以「組」發布（例：7 組、每組 3 題），主持人要為每一題把回答的注音登錄給機器人。
- 目前設定畫面已有「從題庫勾選強制題目」功能（`web/src/questionSetup.ts`），但 21 題要手動勾選很麻煩，也沒有記錄「這題屬於第幾組第幾題」。

## 需求範圍

- **功能 A**：設定畫面 API Key 欄位下方，加上「如何申請 Groq API Key」摺疊說明。
- **功能 B**：貼上題組文字 → 解析 → 自動勾選題庫（不在題庫的自動加入自訂問題）→ 記住每題的（組, 題號）→ 遊戲生成完成後，輸出可複製的 `/ghostink clue g i <注音>` 指令清單。

貼上文字的格式範例（組標題行 `第 N 組`，其後每行一題，空行分隔）：

```
第 1 組
如果暫時沒有它，可以用什麼替代？
有什麼東西的危險程度與它相仿？
它的重量和什麼相仿？

第 2 組
什麼專有名詞與它相關性最高？
若無外力介入，它的壽命有多長？
您能在哪個大洲或地區找到最多的它？
```

編號規則：第 1 組第 1 題＝`1 1`、第 1 組第 2 題＝`1 2`⋯第 7 組第 3 題＝`7 3`。

---

## 功能 A：Groq API Key 申請說明

### A1. `web/src/main.ts` — 修改 `showSettingsScreen()`

找到 API Key 的 settings-group（現況約在 374–377 行）：

```html
<div class="pi-settings-group">
  <label>API Key</label>
  <input id="pi-apikey" type="password" value="${apiKey}" placeholder="貼上你的 API Key">
</div>
```

改為（在 input 後面加入說明區塊）：

```html
<div class="pi-settings-group">
  <label>API Key</label>
  <input id="pi-apikey" type="password" value="${apiKey}" placeholder="貼上你的 API Key">
  <div class="pi-apikey-help">
    <span class="pi-apikey-help-toggle" tabindex="0" role="button">▶ 如何申請 Groq API Key？</span>
    <div class="pi-apikey-help-body">
      <ol>
        <li>前往 <a href="https://console.groq.com" target="_blank" rel="noopener">console.groq.com</a>，用 Google 或 GitHub 帳號註冊登入（免費）。</li>
        <li>點左側選單的「API Keys」。</li>
        <li>點「Create API Key」，輸入任意名稱後送出。</li>
        <li>複製產生的 Key（<strong>只會顯示這一次</strong>），貼回上方欄位。</li>
      </ol>
      <p>免費方案即可使用、不需信用卡；但有速率限制（每分鐘 token 上限），分析偶爾失敗時稍等再試即可。</p>
    </div>
  </div>
</div>
```

在 `showSettingsScreen()` 內、`document.getElementById('pi-start')?.addEventListener(...)` **之前**加上 toggle 邏輯：

```ts
// API key help toggle
const helpToggle = document.querySelector('.pi-apikey-help-toggle');
helpToggle?.addEventListener('click', () => {
  document.querySelector('.pi-apikey-help')?.classList.toggle('open');
});
```

### A2. `web/src/style.css` — 新增樣式（加在檔案末尾）

顏色請比照既有的 `.pi-privacy-note` / `.pi-log-toggle` 用色，維持整體風格：

```css
/* ── API key help ── */
.pi-apikey-help { margin-top: 6px; font-size: 13px; }
.pi-apikey-help-toggle { cursor: pointer; user-select: none; opacity: 0.8; }
.pi-apikey-help-toggle:hover { opacity: 1; }
.pi-apikey-help-body { display: none; margin-top: 6px; line-height: 1.6; }
.pi-apikey-help.open .pi-apikey-help-body { display: block; }
.pi-apikey-help-body ol { padding-left: 20px; margin: 4px 0; }
.pi-apikey-help-body a { color: inherit; text-decoration: underline; }
```

---

## 功能 B：題組貼上 ＋ 主持指令

### B1. 新檔 `web/src/groupPaste.ts` — 解析與題庫比對（純函式，好測試）

```ts
// web/src/groupPaste.ts
//
// Parses pasted "第 N 組" question blocks and matches them against the
// question bank. Each parsed question carries a (group, index) tag that is
// later used to emit host commands like `/ghostink clue 1 3 <bopomofo>`.

export interface GroupedQuestion {
  group: number;
  /** 1-based position within the group. */
  index: number;
  text: string;
}

const GROUP_HEADER = /^第\s*([0-9０-９一二三四五六七八九十]+)\s*組/;

const CN_NUMS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Parses "1" / "１" / "一" / "十" / "十二" / "二十" style group numbers. */
function parseGroupNumber(s: string): number {
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(half)) return Number(half);
  if (half === '十') return 10;
  if (half.length === 2 && half[0] === '十') return 10 + (CN_NUMS[half[1]] ?? NaN);
  if (half.length === 2 && half[1] === '十') return (CN_NUMS[half[0]] ?? NaN) * 10;
  return CN_NUMS[half] ?? NaN;
}

/** Normalization used for bank matching: strip spaces, unify ?→？, drop trailing ？. */
export function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, '').replace(/[?]/g, '？').replace(/？+$/, '');
}

export function parseGroupedQuestions(raw: string): {
  items: GroupedQuestion[];
  errors: string[];
} {
  const items: GroupedQuestion[] = [];
  const errors: string[] = [];
  const seenGroups = new Set<number>();
  let currentGroup = 0;
  let indexInGroup = 0;

  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;

    const m = line.match(GROUP_HEADER);
    if (m) {
      const g = parseGroupNumber(m[1]);
      if (!Number.isFinite(g)) {
        errors.push(`無法解析組編號：「${line}」`);
        continue;
      }
      if (seenGroups.has(g)) errors.push(`第 ${g} 組出現多次`);
      seenGroups.add(g);
      currentGroup = g;
      indexInGroup = 0;
      continue;
    }

    if (currentGroup === 0) {
      errors.push(`「${line}」出現在任何組標題之前，已略過`);
      continue;
    }
    indexInGroup++;
    items.push({ group: currentGroup, index: indexInGroup, text: line });
  }

  if (items.length === 0) errors.push('沒有解析到任何題目');

  // Same question in two groups would make the (group, index) tag ambiguous.
  const seenText = new Map<string, GroupedQuestion>();
  for (const it of items) {
    const key = normalizeQuestion(it.text);
    const prev = seenText.get(key);
    if (prev) {
      errors.push(`「${it.text}」同時出現在第 ${prev.group} 組與第 ${it.group} 組`);
    } else {
      seenText.set(key, it);
    }
  }

  return { items, errors };
}

export interface BankMatchResult {
  /** Questions found in the bank — bankQuestion is the bank's exact text. */
  matched: { bankQuestion: string; tag: GroupedQuestion }[];
  /** Questions not in the bank — become forced custom questions. */
  unmatched: GroupedQuestion[];
}

export function matchToBank(
  items: GroupedQuestion[],
  bank: readonly string[],
): BankMatchResult {
  const byNorm = new Map(bank.map((q) => [normalizeQuestion(q), q]));
  const matched: BankMatchResult['matched'] = [];
  const unmatched: GroupedQuestion[] = [];
  for (const it of items) {
    const bankQ = byNorm.get(normalizeQuestion(it.text));
    if (bankQ) matched.push({ bankQuestion: bankQ, tag: it });
    else unmatched.push(it);
  }
  return { matched, unmatched };
}
```

### B2. 新檔 `web/src/hostCommands.ts` — 產生 `/ghostink clue` 指令

```ts
// web/src/hostCommands.ts
//
// Builds host-side bot commands from generated questions and their
// (group, index) tags. Reply bopomofo is joined without spaces and without
// the trailing 。 cell, e.g. `/ghostink clue 1 3 ㄐㄧㄢˉㄘㄞˋ`.
import { toBopomofoCells } from './bopomofo';
import { normalizeQuestion, type GroupedQuestion } from './groupPaste';

export const CLUE_CMD_PREFIX = '/ghostink clue';

export function buildClueCommands(
  questions: { question: string; reply: string }[],
  tags: GroupedQuestion[],
  prefix: string = CLUE_CMD_PREFIX,
): string[] {
  const tagByNorm = new Map(tags.map((t) => [normalizeQuestion(t.text), t]));
  const rows: { tag: GroupedQuestion; bpmf: string }[] = [];
  for (const q of questions) {
    const tag = tagByNorm.get(normalizeQuestion(q.question));
    if (!tag) continue; // AI 額外挑的題沒有編號，略過
    // toBopomofoCells 只轉漢字，句號「。」不會出現在結果裡
    const bpmf = toBopomofoCells(q.reply).join('');
    if (!bpmf) continue;
    rows.push({ tag, bpmf });
  }
  rows.sort((a, b) => a.tag.group - b.tag.group || a.tag.index - b.tag.index);
  return rows.map((r) => `${prefix} ${r.tag.group} ${r.tag.index} ${r.bpmf}`);
}
```

備註：指令前綴目前固定為 `/ghostink clue`；未來要換機器人指令名，只改 `CLUE_CMD_PREFIX` 一處。

### B3. `web/src/settings.ts` — Settings 增加 groupTags

`Settings` interface 增加一個欄位（放在 `customQuestions` 之後）：

```ts
import type { GroupedQuestion } from './groupPaste';

export interface Settings {
  backend: 'groq' | 'hf';
  apiKey: string;
  model: string;
  answerMode?: 'ai' | 'human';
  humanAnswer?: string;
  numCandidates?: number;
  numQuestions?: number;
  pickedBankQuestions?: string[];
  customQuestions?: string[];
  /** (group, index) tags from the paste-parse feature; used for host commands. */
  groupTags?: GroupedQuestion[];
}
```

注意：`settings.ts` 目前沒有任何 import，加上 `import type` 即可（`groupPaste.ts` 不 import settings，不會循環相依）。其餘函式（load/save/validate）**不變**——`groupTags` 會隨 JSON.stringify 自動存取。

### B4. `web/src/questionSetup.ts` — 貼上區 UI 與解析行為

#### B4-1. import 增加

```ts
import { parseGroupedQuestions, matchToBank, type GroupedQuestion } from './groupPaste';
```

#### B4-2. `QuestionSetupValue` 增加欄位

```ts
export interface QuestionSetupValue {
  numCandidates: number;
  numQuestions: number;
  pickedBankQuestions: string[];
  customQuestions: string[];
  groupTags?: GroupedQuestion[];
}
```

#### B4-3. `renderQuestionSetup()` 的 HTML：在 `.pi-bank-header` 區塊**之前**插入貼上區

在 `<label>使用題數量（遊戲最終題數）</label>...<input id="pi-num-questions" ...>` 之後、`<div class="pi-bank-header">` 之前插入：

```html
<div class="pi-group-paste-area">
  <label>貼上題組（自動勾選題庫並記住組別編號）</label>
  <textarea class="pi-group-paste" rows="5" placeholder="第 1 組&#10;如果暫時沒有它，可以用什麼替代？&#10;有什麼東西的危險程度與它相仿？&#10;⋯"></textarea>
  <button type="button" class="pi-group-parse">📋 解析並勾選</button>
  <div class="pi-group-result"></div>
</div>
```

並且在 `renderQuestionSetup()` 設定完 `container.innerHTML = ...` 之後、呼叫 `wire(container)` 之前，還原既有 tags：

```ts
if (initial.groupTags?.length) {
  container.dataset.groupTags = JSON.stringify(initial.groupTags);
}
```

（`initial` 的型別 `Partial<QuestionSetupValue>` 已涵蓋新欄位，不用改。）

#### B4-4. `wire(container)` 內新增解析按鈕邏輯（加在函式末尾）

```ts
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
```

#### B4-5. `readQuestionSetup()` 回傳 tags

在 return 前加：

```ts
let groupTags: GroupedQuestion[] | undefined;
try {
  const rawTags = container.dataset.groupTags;
  if (rawTags) groupTags = JSON.parse(rawTags) as GroupedQuestion[];
} catch {
  groupTags = undefined;
}
```

return 改為：

```ts
return { numCandidates, numQuestions, pickedBankQuestions, customQuestions, groupTags };
```

### B5. `web/src/main.ts` — 傳遞 tags ＋ 生成完成後顯示主持指令

#### B5-1. import 增加

```ts
import { buildClueCommands } from './hostCommands';
```

#### B5-2. `showSettingsScreen()`：renderQuestionSetup 傳入既有 tags

```ts
renderQuestionSetup(setupContainer, {
  numCandidates: existing?.numCandidates,
  numQuestions: existing?.numQuestions,
  pickedBankQuestions: existing?.pickedBankQuestions,
  customQuestions: existing?.customQuestions,
  groupTags: existing?.groupTags,
});
```

#### B5-3. `showSettingsScreen()` 的開始遊戲 handler：settings 帶上 tags

```ts
const settings: Settings = {
  backend, apiKey, model, answerMode, humanAnswer,
  numCandidates: setup.numCandidates,
  numQuestions: setup.numQuestions,
  pickedBankQuestions: setup.pickedBankQuestions,
  customQuestions: setup.customQuestions,
  groupTags: setup.groupTags,
};
```

#### B5-4. `startGame()` 成功分支：加入「主持指令」區塊

現況成功分支的 `root.innerHTML` 是 `#pi-game-container` + `.pi-log-below`。改為在兩者**之間**插入主持指令區（僅在有 tags 且產得出指令時）：

```ts
const clueCommands = settings.groupTags?.length
  ? buildClueCommands(result.questions, settings.groupTags)
  : [];
const hostCmdsHtml = clueCommands.length
  ? `
    <div class="pi-host-cmds">
      <div class="pi-log-header">
        <div class="pi-host-cmds-toggle pi-log-toggle" tabindex="0" role="button">
          <span class="pi-log-toggle-arrow">▶</span> 📢 主持指令（${clueCommands.length} 條）
        </div>
        <button class="pi-host-cmds-copy pi-log-copy" title="複製全部指令">📋</button>
      </div>
      <pre class="pi-host-cmds-body">${escapeHtml(clueCommands.join('\n'))}</pre>
    </div>`
  : '';

root.innerHTML = `
  <div id="pi-game-container"></div>
  ${hostCmdsHtml}
  <div class="pi-log-below">
    ...（原本的 log 區塊不變）...
  </div>
`;
```

在綁定 log toggle 的程式碼附近，加上主持指令區的事件：

```ts
// Host commands: toggle + copy
const hostCmds = root.querySelector<HTMLElement>('.pi-host-cmds');
if (hostCmds) {
  const cmdToggle = hostCmds.querySelector<HTMLElement>('.pi-host-cmds-toggle');
  const cmdBody = hostCmds.querySelector<HTMLElement>('.pi-host-cmds-body');
  cmdToggle?.addEventListener('click', () => {
    cmdBody?.classList.toggle('open');
    cmdToggle.querySelector('.pi-log-toggle-arrow')?.classList.toggle('open');
  });
  hostCmds.querySelector('.pi-host-cmds-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(clueCommands.join('\n')).catch(() => {});
  });
}
```

注意：指令內容含所有回答的注音（等同全部劇透），所以**預設收合**——跟「生成過程」log 一樣的行為。主持人自己展開複製。

### B6. `web/src/style.css` — 新增樣式（加在檔案末尾）

```css
/* ── Group paste area ── */
.pi-group-paste-area { margin: 10px 0; }
.pi-group-paste { width: 100%; box-sizing: border-box; resize: vertical; }
.pi-group-parse { margin-top: 6px; }
.pi-group-result { margin-top: 6px; font-size: 13px; line-height: 1.5; opacity: 0.9; }

/* ── Host commands ── */
.pi-host-cmds { margin-top: 12px; }
.pi-host-cmds-body {
  display: none;
  margin: 6px 0 0;
  padding: 10px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre;
}
.pi-host-cmds-body.open { display: block; }
```

（textarea/按鈕/pre 的底色與邊框請比照既有 `.pi-solver-input`、`.pi-log-body` 的樣式寫法，維持一致外觀。）

---

## 測試（新檔，必須全部通過）

### T1. `web/src/groupPaste.test.ts`

```ts
// web/src/groupPaste.test.ts
import { describe, it, expect } from 'vitest';
import { parseGroupedQuestions, matchToBank, normalizeQuestion } from './groupPaste';
import { QUESTION_BANK } from './generator/prompts';

const SAMPLE = `第 1 組
如果暫時沒有它，可以用什麼替代？
有什麼東西的危險程度與它相仿？
它的重量和什麼相仿？

第 2 組
什麼專有名詞與它相關性最高？
若無外力介入，它的壽命有多長？
您能在哪個大洲或地區找到最多的它？

第 3 組
它的任何一個字的部首是什麼？
什麼其他物品常和它一起出現？
它屬於何種類別？

第 4 組
它的用途為何？
當它死亡、損壞或不再有用時，會去哪裡？
什麼現象或狀況與它相關性最高？

第 5 組
人們和它產生互動時，常用什麼動詞來描述？
什麼東西可能在它的外層包裝、覆蓋或遮蔽它？
何種課程或科系與它相關性最高？

第 6 組
沒有外物輔助下，您可以單手拿幾個它？
它會引起何種情緒？
什麼會改變它？

第 7 組
什麼狀況可能對它造成威脅或危險？
它存放在哪裡？
它如何移動？`;

describe('parseGroupedQuestions', () => {
  it('parses the 7-group sample into 21 tagged questions', () => {
    const { items, errors } = parseGroupedQuestions(SAMPLE);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(21);
    expect(items[0]).toEqual({ group: 1, index: 1, text: '如果暫時沒有它，可以用什麼替代？' });
    expect(items[8]).toEqual({ group: 3, index: 3, text: '它屬於何種類別？' });
    expect(items[20]).toEqual({ group: 7, index: 3, text: '它如何移動？' });
  });

  it('accepts 第1組 / 第１組 / 第一組 header variants', () => {
    for (const header of ['第1組', '第１組', '第一組']) {
      const { items } = parseGroupedQuestions(`${header}\n它的用途為何？`);
      expect(items).toEqual([{ group: 1, index: 1, text: '它的用途為何？' }]);
    }
  });

  it('reports lines before any group header and empty input', () => {
    const { items, errors } = parseGroupedQuestions('它的用途為何？');
    expect(items).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reports the same question appearing in two groups', () => {
    const { errors } = parseGroupedQuestions('第 1 組\n它的用途為何？\n\n第 2 組\n它的用途為何？');
    expect(errors.some((e) => e.includes('同時出現'))).toBe(true);
  });
});

describe('matchToBank', () => {
  it('matches all 21 sample questions against the bank', () => {
    const { items } = parseGroupedQuestions(SAMPLE);
    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(21);
    // bankQuestion 是題庫原文
    for (const m of matched) expect(QUESTION_BANK).toContain(m.bankQuestion);
  });

  it('matches despite half-width question mark, and routes unknown text to unmatched', () => {
    const { items } = parseGroupedQuestions('第 1 組\n它存放在哪裡?\n這題不在題庫裡？');
    const { matched, unmatched } = matchToBank(items, QUESTION_BANK);
    expect(matched).toHaveLength(1);
    expect(matched[0].bankQuestion).toBe('它存放在哪裡？');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].text).toBe('這題不在題庫裡？');
  });
});

describe('normalizeQuestion', () => {
  it('strips spaces and trailing question marks', () => {
    expect(normalizeQuestion('它 存放在哪裡？')).toBe('它存放在哪裡');
    expect(normalizeQuestion('它存放在哪裡?')).toBe('它存放在哪裡');
  });
});
```

### T2. `web/src/hostCommands.test.ts`

```ts
// web/src/hostCommands.test.ts
import { describe, it, expect } from 'vitest';
import { buildClueCommands, CLUE_CMD_PREFIX } from './hostCommands';
import type { GroupedQuestion } from './groupPaste';

describe('buildClueCommands', () => {
  const tags: GroupedQuestion[] = [
    { group: 1, index: 2, text: '它會去哪裡？' },
    { group: 1, index: 1, text: '它存放在哪裡？' },
  ];

  it('emits "<prefix> <group> <index> <bopomofo>" sorted by group then index', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: '它存放在哪裡？', reply: '天空。' },
      ],
      tags,
    );
    expect(cmds).toEqual([
      `${CLUE_CMD_PREFIX} 1 1 ㄊㄧㄢˉㄎㄨㄥˉ`,
      `${CLUE_CMD_PREFIX} 1 2 ㄉㄧˋㄇㄧㄢˋ`,
    ]);
  });

  it('excludes the trailing 。 and joins bopomofo without spaces', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 3, index: 1, text: '它會去哪裡？' }],
    );
    expect(cmds).toEqual([`${CLUE_CMD_PREFIX} 3 1 ㄉㄧˋㄇㄧㄢˋ`]);
    expect(cmds[0]).not.toContain('。');
    expect(cmds[0]).not.toMatch(/ㄉ.+\sㄇ/); // 注音之間無空格
  });

  it('skips questions without a tag and questions with empty replies', () => {
    const cmds = buildClueCommands(
      [
        { question: '它會去哪裡？', reply: '地面。' },
        { question: 'AI 額外挑的題？', reply: '某回答。' },
        { question: '它存放在哪裡？', reply: '' },
      ],
      tags,
    );
    expect(cmds).toEqual([`${CLUE_CMD_PREFIX} 1 2 ㄉㄧˋㄇㄧㄢˋ`]);
  });

  it('supports a custom prefix', () => {
    const cmds = buildClueCommands(
      [{ question: '它會去哪裡？', reply: '地面。' }],
      [{ group: 1, index: 1, text: '它會去哪裡？' }],
      '/mybot clue',
    );
    expect(cmds[0].startsWith('/mybot clue 1 1 ')).toBe(true);
  });
});
```

### T3. 既有測試

`web/src/main.test.ts`、`web/src/solver.test.ts` 等既有測試**不可**因本次改動而失敗。若 `main.test.ts` 有對設定畫面 HTML 的 snapshot/字串斷言受影響，僅允許補上新元素的預期，不可刪除原斷言。

---

## 行為備註（實作時的取捨，已決定，不要更改）

1. **解析即重設**：按「解析並勾選」會清空原本所有勾選與自訂問題，以貼上內容為唯一真相（貼上題組就是完整的一場遊戲）。
2. **不在題庫的題目**：自動加入「自訂問題」（同樣強制使用、AI 填回答），並在結果訊息中列出。
3. **題數自動化**：使用題數量 M 自動設為貼上總題數（例 21）；候選池 N 若 ≤ M 則設為 M+1。M == 強制題數是合法的（驗證規則只擋 M < 強制數）。
4. **遊戲內題目順序**可能與組別順序不同（強制題排序 = 勾選題先、自訂題後）；這不影響指令正確性，因為指令帶的是每題自己的（組, 題號）。
5. **指令注音格式**：不含空格、一聲顯式標 `ˉ`、不含句號（與 `toBopomofoCells` 現有行為一致，例：地面。→ `ㄉㄧˋㄇㄧㄢˋ`）。
6. **主持指令區預設收合**（內容是全部答案的注音，屬於劇透）。
7. `CLUE_CMD_PREFIX` 固定 `/ghostink clue`，要換名稱只改常數。

## 驗收清單

- [ ] 設定畫面 API Key 下方有「▶ 如何申請 Groq API Key？」，點擊展開/收合，連結另開新分頁。
- [ ] 貼上範例 7 組 21 題 → 按「解析並勾選」→ 題庫勾選數顯示 21、使用題數自動變 21、候選池 ≥ 22、結果訊息顯示「已解析 7 組、共 21 題」。
- [ ] 重新整理頁面後（localStorage），勾選與 groupTags 仍在。
- [ ] 開始遊戲（自行輸入謎底模式）生成成功後，遊戲畫面下方出現「📢 主持指令（21 條）」收合區；展開後每行格式 `/ghostink clue <組> <題> <注音>`，按 📋 可複製全部。
- [ ] 未使用貼上功能的一般流程完全不受影響（沒有主持指令區）。
- [ ] `cd web && npm test` 全數通過（含新測試 T1、T2）。
- [ ] `cd web && npm run build` 通過（tsc strict 無錯誤）。
