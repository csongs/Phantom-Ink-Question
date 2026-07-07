# 首頁題目設定 (Question Setup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player control question selection on the web settings screen — candidate pool size, final used count, hand-picked bank questions, and custom questions — and wire those through the generator.

**Architecture:** A pure validation function + persisted settings fields drive a new settings-screen section. The generator builds the AI's candidate pool from forced questions (checked bank + custom) plus random fill, deterministically reconciles the AI's output so every forced question is present, and protects forced questions from being rewritten when their reply is defective.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom environment — `localStorage` and DOM are available in tests).

## Global Constraints

- N = 選題數量 (candidate pool shown to AI). M = 使用題的數量 (final questions in game). X = checked bank questions. C = custom questions. forced = X + C.
- Validation rules (exact): `M > X + C`; `N > M`; `N <= QUESTION_BANK.length + C`; every checked question is an exact `QUESTION_BANK` string; every custom question is non-empty after trim.
- Defaults: `N = 30`, `M = 10`, no checked, no custom (identical to today's behavior).
- Checked bank questions and custom questions are BOTH forced into the final game. Custom questions get replies filled by the AI and are marked `isCustom: true`. Checked bank questions are not custom.
- All four new fields persist to localStorage like existing settings.
- Web-only. Do NOT touch `prompts.py` / `generator.py`.
- `QUESTION_BANK.length` is 112 (asserted by an existing test).

---

### Task 1: Settings fields + `validateQuestionSetup`

**Files:**
- Modify: `web/src/settings.ts`
- Test: `web/src/settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Settings` gains `numCandidates?: number; numQuestions?: number; pickedBankQuestions?: string[]; customQuestions?: string[]`.
  - `interface QuestionSetupCounts { numCandidates: number; numQuestions: number; pickedCount: number; customCount: number; bankSize: number }`
  - `function validateQuestionSetup(input: QuestionSetupCounts): { ok: boolean; message?: string }`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/settings.test.ts`:

```ts
import { loadSettings, saveSettings, clearSettings, validateQuestionSetup } from './settings';

describe('validateQuestionSetup', () => {
  const base = { numCandidates: 30, numQuestions: 10, pickedCount: 0, customCount: 0, bankSize: 112 };

  it('accepts the defaults', () => {
    expect(validateQuestionSetup(base)).toEqual({ ok: true });
  });

  it('rejects when used count does not exceed forced (M <= X+C)', () => {
    const r = validateQuestionSetup({ ...base, numQuestions: 5, pickedCount: 3, customCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('使用題數量');
  });

  it('accepts when used count is exactly one more than forced', () => {
    expect(validateQuestionSetup({ ...base, numQuestions: 6, pickedCount: 3, customCount: 2 }).ok).toBe(true);
  });

  it('rejects when pool does not exceed used (N <= M)', () => {
    const r = validateQuestionSetup({ ...base, numCandidates: 10, numQuestions: 10 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('選題數量');
  });

  it('rejects when pool exceeds available candidates (N > bankSize + C)', () => {
    const r = validateQuestionSetup({ ...base, numCandidates: 113, customCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('選題數量最多');
  });

  it('allows the pool to reach exactly bankSize + C', () => {
    expect(validateQuestionSetup({ ...base, numCandidates: 114, numQuestions: 10, customCount: 2 }).ok).toBe(true);
  });

  it('rejects non-positive or non-integer counts', () => {
    expect(validateQuestionSetup({ ...base, numQuestions: 0 }).ok).toBe(false);
    expect(validateQuestionSetup({ ...base, numCandidates: 2.5 }).ok).toBe(false);
  });
});

describe('settings persistence of question-setup fields', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips the new fields', () => {
    saveSettings({
      backend: 'groq', apiKey: 'k', model: '',
      numCandidates: 20, numQuestions: 8,
      pickedBankQuestions: ['它是何種顏色？'], customQuestions: ['它配什麼飲料？'],
    });
    expect(loadSettings()).toEqual({
      backend: 'groq', apiKey: 'k', model: '',
      numCandidates: 20, numQuestions: 8,
      pickedBankQuestions: ['它是何種顏色？'], customQuestions: ['它配什麼飲料？'],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/settings.test.ts`
Expected: FAIL — `validateQuestionSetup is not a function`.

- [ ] **Step 3: Implement in `web/src/settings.ts`**

Replace the `Settings` interface and append the new export:

```ts
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
}
```

Append at end of file:

```ts
export interface QuestionSetupCounts {
  numCandidates: number; // N
  numQuestions: number;  // M
  pickedCount: number;   // X
  customCount: number;   // C
  bankSize: number;      // QUESTION_BANK.length
}

/** Pure validation of the four numeric rules; the UI and tests share it. */
export function validateQuestionSetup(input: QuestionSetupCounts): { ok: boolean; message?: string } {
  const { numCandidates: N, numQuestions: M, pickedCount: X, customCount: C, bankSize } = input;
  const forced = X + C;
  if (![N, M].every(Number.isInteger) || N < 1 || M < 1) {
    return { ok: false, message: '題數必須是正整數' };
  }
  if (M <= forced) {
    return { ok: false, message: `使用題數量須大於 勾選(${X})+自訂(${C})=${forced}` };
  }
  if (N <= M) {
    return { ok: false, message: `選題數量(${N})須大於 使用題數量(${M})` };
  }
  if (N > bankSize + C) {
    return { ok: false, message: `選題數量最多為 ${bankSize + C}（題庫 ${bankSize} + 自訂 ${C}）` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/settings.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/settings.ts web/src/settings.test.ts
git commit -m "feat(web): add question-setup settings fields and validateQuestionSetup"
```

---

### Task 2: Designer prompt — candidate pool + forced questions

**Files:**
- Modify: `web/src/generator/prompts.ts` (`designerSystemPrompt`, `formatDesignerPrompt`)
- Test: `web/src/generator/prompts.test.ts`

**Interfaces:**
- Consumes: `QUESTION_BANK`, `sampleRandom` (existing, unchanged).
- Produces:
  - `interface DesignerPromptOptions { numQuestions?: number; numCandidates?: number; forcedQuestions?: string[] }`
  - `formatDesignerPrompt(answer: string, opts?: DesignerPromptOptions): { system: string; user: string }` (signature change from `(answer, numQuestions)`).
  - `designerSystemPrompt(numQuestions: number, questionBankText: string, forcedQuestions?: string[]): string` (adds 3rd param).

- [ ] **Step 1: Write the failing tests**

Replace the two positional calls in `web/src/generator/prompts.test.ts` (`formatDesignerPrompt('鋼琴', 10)` → `formatDesignerPrompt('鋼琴', { numQuestions: 10 })`) and add:

```ts
describe('formatDesignerPrompt question-setup options', () => {
  it('sizes the candidate pool to numCandidates', () => {
    const { system } = formatDesignerPrompt('鋼琴', { numQuestions: 8, numCandidates: 12 });
    const poolLines = system.split('\n').filter((l) => l.startsWith('- '));
    // 12 pool lines + however many forced-list lines (0 here).
    expect(poolLines.length).toBe(12);
  });

  it('includes every forced question in both the pool and the mandatory block', () => {
    const forced = ['它是何種顏色？', '我的自訂題目？'];
    const { system } = formatDesignerPrompt('鋼琴', {
      numQuestions: 8, numCandidates: 12, forcedQuestions: forced,
    });
    for (const q of forced) {
      expect(system).toContain(q);
    }
    expect(system).toContain('必須使用的題目');
  });

  it('defaults to a 30-question pool and no mandatory block', () => {
    const { system } = formatDesignerPrompt('鋼琴');
    const poolLines = system.split('\n').filter((l) => l.startsWith('- '));
    expect(poolLines.length).toBe(30);
    expect(system).not.toContain('必須使用的題目');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/generator/prompts.test.ts`
Expected: FAIL — signature/type errors and missing pool/forced text.

- [ ] **Step 3: Implement in `web/src/generator/prompts.ts`**

Change `designerSystemPrompt` to accept forced questions and insert a mandatory block just before the `## 題庫` section:

```ts
export function designerSystemPrompt(
  numQuestions: number,
  questionBankText: string,
  forcedQuestions: string[] = [],
): string {
  const forcedBlock = forcedQuestions.length
    ? `## 必須使用的題目（一定要全部包含，並根據謎底填入回答）\n${forcedQuestions
        .map((q) => `- ${q}`)
        .join('\n')}\n\n以上 ${forcedQuestions.length} 題必須全部出現在你選的 ${numQuestions} 題裡，其餘 ${Math.max(
        0,
        numQuestions - forcedQuestions.length,
      )} 題再從候選題庫挑選。\n\n`
    : '';
  return `你是一位經驗豐富的「靈媒遊戲」出題老師。請全程使用臺灣慣用詞彙（例如：印表機而非打印機、網路而非網絡、滑鼠而非鼠標）。

你的任務是為給定的謎底，從題庫中選出最適合的${numQuestions}個問題，並根據謎底填入對應的回答。

## 遊戲規則
1. 謎底是一個具體名詞（如「鋼琴」「颱風」「相機」）
2. 每題包含一個問題與一個回答
3. 玩家只看到問題，回答會以注音一格一格顯示
4. 玩家可在任何時候猜測謎底

## 核心目標
玩家只靠這${numQuestions}題有限的問答就要猜出謎底。**你的首要任務是讓這組線索「猜得出來」**——七題本身要湊出答案已經很不容易，不需要刻意刁難或增加難度。線索明確、彼此呼應、共同指向同一個謎底，是好事，不是缺點。

## 出題規則（嚴格遵守）
1. 每題回答必須是**一句短語**，不超過六個中文字
2. 回答請盡量精簡，只保留**最具辨識力的核心詞**：不加入「為、去、來、把、被、正在、可以、會」等不影響辨識的功能詞，也不疊加同義字（例如「教導」優於「教導薰陶」、「公義爭辯」優於「為公義爭辯」）。若拿掉某個字後意思不變就該拿掉，但仍須維持答案唯一合理、不產生歧義
3. 回答**不能直接包含謎底**（例如謎底是「鋼琴」，回答不能出現「鋼琴」）
4. 每一題都要是**有效線索**：綜合所有回答，玩家要有辦法推理出謎底
5. 各題可以從不同角度**聚焦同一個核心邏輯**（資訊部分重疊是允許的），只要回答不要一字不差地重複
6. 每個回答必須可以轉成注音
7. 回答必須**唯一合理**（不能讓人有多種解讀）
8. **全中文**，不可出現英文或數字
9. 問題和回答**結尾必須加句號**，讓玩家知道提示結束了

${forcedBlock}## 題庫（從這裡選問題）

${questionBankText}

## 選題原則

1. 根據謎底特質，選最有意義、最能勾起聯想的${numQuestions}題
2. 避開對這個謎底來說太奇怪或無意義的問題
3. 涵蓋多個面向，但每一題都要能幫助玩家指向同一個謎底
4. 以「玩家看完這些線索有辦法猜出來」為最高原則，不要為了增加難度而選無關或誤導的題`;
}
```

Replace `formatDesignerPrompt`:

```ts
export interface DesignerPromptOptions {
  numQuestions?: number;      // M
  numCandidates?: number;     // N
  forcedQuestions?: string[]; // checked bank + custom
}

export function formatDesignerPrompt(
  answer: string,
  opts: DesignerPromptOptions = {},
): { system: string; user: string } {
  const numQuestions = opts.numQuestions ?? 10;
  const numCandidates = opts.numCandidates ?? 30;
  const forced = opts.forcedQuestions ?? [];

  // Pool = forced questions (checked bank + custom) + random fill drawn from the
  // remaining bank questions, up to numCandidates total.
  const forcedInBank = forced.filter((q) => QUESTION_BANK.includes(q));
  const remaining = QUESTION_BANK.filter((q) => !forcedInBank.includes(q));
  const fillCount = Math.max(0, Math.min(numCandidates - forced.length, remaining.length));
  const fill = sampleRandom(remaining, fillCount);
  const pool = [...forced, ...fill];
  const poolText = pool.map((q) => `- ${q}`).join('\n');

  return {
    system: designerSystemPrompt(numQuestions, poolText, forced),
    user: designerUserPrompt(answer, numQuestions),
  };
}
```

Note: the mandatory block lists forced questions with `- ` too, so when `forcedQuestions` is non-empty the total `- ` line count is `numCandidates + forced.length`; the pool-size test uses `forcedQuestions: []` implicitly via the first test to keep the count exact.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/generator/prompts.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/generator/prompts.ts web/src/generator/prompts.test.ts
git commit -m "feat(web): build designer pool from forced questions + numCandidates"
```

---

### Task 3: Generator — options plumbing + forced reconciliation

**Files:**
- Modify: `web/src/generator/generator.ts` (`GenerateOptions`, `designQuestions`, add static `reconcileForced`, `generate` designQuestions call)
- Test: `web/src/generator/generator.test.ts`

**Interfaces:**
- Consumes: `formatDesignerPrompt(answer, { numQuestions, numCandidates, forcedQuestions })` from Task 2.
- Produces:
  - `GenerateOptions` gains `numCandidates?: number; pickedBankQuestions?: string[]; customQuestions?: string[]`.
  - `designQuestions(answer: string, opts?: { numQuestions?: number; numCandidates?: number; forcedQuestions?: string[] }): Promise<QuestionSet>` (signature change from `(answer, numQuestions)`).
  - `static reconcileForced(aiQuestions: QuestionItem[], forced: string[], numQuestions: number): QuestionItem[]`.

- [ ] **Step 1: Write the failing tests**

In `web/src/generator/generator.test.ts`, update the two existing positional `designQuestions` calls: `generator.designQuestions('鋼琴', 2)` → `generator.designQuestions('鋼琴', { numQuestions: 2 })` and `generator.designQuestions('鋼琴', 1)` → `generator.designQuestions('鋼琴', { numQuestions: 1 })`. Then add:

```ts
describe('PhantomInkGenerator.reconcileForced', () => {
  const item = (question: string, reply: string) => ({ question, reply, isCustom: false });

  it('puts forced questions first, reusing the AI reply when present', () => {
    const ai = [item('B', '乙。'), item('A', '甲。'), item('C', '丙。')];
    const out = PhantomInkGenerator.reconcileForced(ai, ['A'], 3);
    expect(out[0]).toEqual(item('A', '甲。'));
    expect(out.map((q) => q.question)).toEqual(['A', 'B', 'C']);
  });

  it('gives a forced question an empty reply when the AI omitted it', () => {
    const ai = [item('B', '乙。'), item('C', '丙。')];
    const out = PhantomInkGenerator.reconcileForced(ai, ['A'], 3);
    expect(out[0]).toEqual({ question: 'A', reply: '', isCustom: false });
    expect(out.map((q) => q.question)).toEqual(['A', 'B', 'C']);
  });

  it('truncates AI extras so total equals numQuestions', () => {
    const ai = [item('B', '乙。'), item('C', '丙。'), item('D', '丁。')];
    const out = PhantomInkGenerator.reconcileForced(ai, ['A'], 2);
    expect(out.map((q) => q.question)).toEqual(['A', 'B']);
  });
});

describe('PhantomInkGenerator.designQuestions forced', () => {
  it('guarantees forced questions are present and marks custom ones', async () => {
    // AI ignores the custom question and returns two bank questions.
    const reply = JSON.stringify({
      answer: '鋼琴',
      questions: [
        { question: '它由什麼材料製成？', reply: '木頭.' },
        { question: '它是何種顏色？', reply: '黑色.' },
      ],
    });
    const backend = new FakeBackend([reply]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', {
      numQuestions: 2,
      forcedQuestions: ['我的自訂題目？'],
    });

    expect(qs.questions.some((q) => q.question === '我的自訂題目？')).toBe(true);
    const custom = qs.questions.find((q) => q.question === '我的自訂題目？');
    expect(custom?.isCustom).toBe(true);
    expect(qs.questions.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/generator/generator.test.ts`
Expected: FAIL — `reconcileForced` undefined and forced question absent.

- [ ] **Step 3: Implement in `web/src/generator/generator.ts`**

Extend `GenerateOptions`:

```ts
export interface GenerateOptions {
  answer?: string;
  skipReview?: boolean;
  skipSimulation?: boolean;
  answerMode?: 'ai' | 'human';
  numQuestions?: number;
  numCandidates?: number;
  pickedBankQuestions?: string[];
  customQuestions?: string[];
  usedAnswers?: string[];
  onProgress?: ProgressCallback;
}
```

Add the static helper (place it near `replyCharCount`):

```ts
/** Guarantees every forced question is present: forced first (reusing the AI's
 *  reply for them when given, else empty), then the AI's other picks, capped at
 *  numQuestions. */
static reconcileForced(
  aiQuestions: QuestionItem[],
  forced: string[],
  numQuestions: number,
): QuestionItem[] {
  const byQuestion = new Map(aiQuestions.map((q) => [q.question, q]));
  const forcedItems: QuestionItem[] = forced.map((q) => ({
    question: q,
    reply: byQuestion.get(q)?.reply ?? '',
    isCustom: false,
  }));
  const forcedSet = new Set(forced);
  const rest = aiQuestions.filter((q) => !forcedSet.has(q.question));
  const slotsLeft = Math.max(0, numQuestions - forcedItems.length);
  return [...forcedItems, ...rest.slice(0, slotsLeft)];
}
```

Replace `designQuestions`'s signature and body head:

```ts
async designQuestions(
  answer: string,
  opts: { numQuestions?: number; numCandidates?: number; forcedQuestions?: string[] } = {},
): Promise<QuestionSet> {
  const numQuestions = opts.numQuestions ?? 10;
  const forced = opts.forcedQuestions ?? [];
  const { system, user } = formatDesignerPrompt(answer, {
    numQuestions,
    numCandidates: opts.numCandidates,
    forcedQuestions: forced,
  });
  const raw = await this.jsonChat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  const questions: QuestionItem[] = raw.questions.map((q: { question: string; reply: string }) => ({
    question: q.question,
    reply: q.reply,
    isCustom: false,
  }));

  let qs: QuestionSet = { answer: raw.answer, questions };
  qs = this.postProcess(qs);

  // Deterministically guarantee forced questions are present.
  if (forced.length) {
    qs.questions = PhantomInkGenerator.reconcileForced(qs.questions, forced, numQuestions);
  }

  for (const q of qs.questions) {
    if (!QUESTION_BANK.includes(q.question)) q.isCustom = true;
  }
  // ...leave the existing unknown/dupes/leak warning blocks unchanged...
```

Update the call inside `generate()` (currently `this.designQuestions(answer, numQuestions)`). First, near the top of `generate()` (right after destructuring `options`), add:

```ts
const forcedQuestions = [
  ...(options.pickedBankQuestions ?? []),
  ...(options.customQuestions ?? []),
];
```

and change the destructuring to also pull `numCandidates`:

```ts
const {
  skipReview = false,
  skipSimulation = true,
  answerMode = 'ai',
  numQuestions = 10,
  numCandidates,
  usedAnswers = [],
  onProgress,
} = options;
```

Then the design call becomes:

```ts
questionSet = await this.designQuestions(answer, {
  numQuestions,
  numCandidates,
  forcedQuestions,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/generator/generator.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/generator/generator.ts web/src/generator/generator.test.ts
git commit -m "feat(web): thread question-setup options and reconcile forced questions"
```

---

### Task 4: Generator — protect forced questions in the fix loop

**Files:**
- Modify: `web/src/generator/generator.ts` (add `fillForcedReplies`, split the fix-loop call)
- Test: `web/src/generator/generator.test.ts`

**Interfaces:**
- Consumes: `forcedQuestions` (computed in Task 3), existing `fixQuestions`.
- Produces: `private async fillForcedReplies(answer: string, items: { index: number; question: string }[]): Promise<Map<number, string>>`.

**Why:** the existing `fixQuestions` rewrites a bad question with a fresh bank pick, which would silently drop a forced question whose reply is defective (empty/duplicate/leak/over-length). Forced questions must keep their exact text and only have their reply regenerated.

- [ ] **Step 1: Write the failing test**

Add to `web/src/generator/generator.test.ts` (inside `describe('PhantomInkGenerator.generate')`):

```ts
it('keeps a forced question and only refills its defective reply', async () => {
  // Design returns the forced question with an EMPTY reply (defect) + one good.
  const design = JSON.stringify({
    answer: '鋼琴',
    questions: [
      { question: '我的自訂題目？', reply: '' },
      { question: '它是何種顏色？', reply: '黑色.' },
    ],
  });
  // fillForcedReplies response (replies only, order matches the forced-bad list).
  const forcedFill = JSON.stringify({ replies: ['木頭製.'] });

  const backend = new FakeBackend([design, forcedFill, PASSING_REVIEW_REPLY]);
  const generator = new PhantomInkGenerator(backend, 3);

  const result = await generator.generate({
    answer: '鋼琴',
    answerMode: 'human',
    numQuestions: 2,
    customQuestions: ['我的自訂題目？'],
    skipReview: false,
    skipSimulation: true,
  });

  const forced = result.questions.find((q) => q.question === '我的自訂題目？');
  expect(forced).toBeTruthy();          // question preserved, not rewritten
  expect(forced?.reply).toBe('木頭製。'); // reply refilled + post-processed
  expect(forced?.isCustom).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/generator/generator.test.ts -t "only refills its defective reply"`
Expected: FAIL — the forced question is rewritten by `fixQuestions` (queue consumed in the wrong order / question changed).

- [ ] **Step 3: Implement in `web/src/generator/generator.ts`**

Add the method (near `fixQuestions`):

```ts
/** Regenerates ONLY the replies for forced questions, keeping their text. */
private async fillForcedReplies(
  answer: string,
  items: { index: number; question: string }[],
): Promise<Map<number, string>> {
  const listText = items.map((it, k) => `${k + 1}. ${it.question}`).join('\n');
  const prompt =
    `謎底是「${answer}」。請為以下固定問題各填入一個回答，問題文字不可更改：\n` +
    `${listText}\n\n` +
    `回答規則：不超過六個中文字、不能出現謎底文字、全中文、語意明確、結尾加句號。\n` +
    `輸出 JSON：{"replies": ["回答1", "回答2", ...]}（順序對應上面題號）`;
  const raw = await this.jsonChat([{ role: 'user', content: prompt }]);
  const replies: string[] = raw.replies ?? [];
  const out = new Map<number, string>();
  items.forEach((it, k) => out.set(it.index, replies[k] ?? ''));
  return out;
}
```

In `generate()`'s fix loop, replace the single `fixQuestions` call at the end of the loop body:

```ts
questionSet = await this.fixQuestions(answer, questionSet, sortedBad, reasonsDict);
```

with a forced-aware split:

```ts
const forcedSet = new Set(forcedQuestions);
const forcedBad = sortedBad.filter((i) => forcedSet.has(questionSet.questions[i].question));
const freeBad = sortedBad.filter((i) => !forcedSet.has(questionSet.questions[i].question));

if (freeBad.length) {
  questionSet = await this.fixQuestions(answer, questionSet, freeBad, reasonsDict);
}
if (forcedBad.length) {
  const items = forcedBad.map((i) => ({ index: i, question: questionSet.questions[i].question }));
  const newReplies = await this.fillForcedReplies(answer, items);
  for (const [i, reply] of newReplies) {
    questionSet.questions[i] = { ...questionSet.questions[i], reply };
  }
  this.postProcess(questionSet);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/generator/generator.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/generator/generator.ts web/src/generator/generator.test.ts
git commit -m "feat(web): refill forced-question replies instead of rewriting them"
```

---

### Task 5: Question-setup UI module

**Files:**
- Create: `web/src/questionSetup.ts`
- Test: `web/src/questionSetup.test.ts`

**Interfaces:**
- Consumes: `QUESTION_BANK` from `./generator/prompts`; `validateQuestionSetup` from `./settings`; `escapeHtml` from `./game`.
- Produces:
  - `interface QuestionSetupValue { numCandidates: number; numQuestions: number; pickedBankQuestions: string[]; customQuestions: string[] }`
  - `function renderQuestionSetup(container: HTMLElement, initial?: Partial<QuestionSetupValue>): void`
  - `function readQuestionSetup(container: HTMLElement): QuestionSetupValue`
  - `function refreshSetupValidity(container: HTMLElement): boolean` — updates the warning line, returns validity.

- [ ] **Step 1: Write the failing tests**

Create `web/src/questionSetup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderQuestionSetup, readQuestionSetup, refreshSetupValidity } from './questionSetup';
import { QUESTION_BANK } from './generator/prompts';

function mount(initial?: Parameters<typeof renderQuestionSetup>[1]): HTMLElement {
  const el = document.createElement('div');
  renderQuestionSetup(el, initial);
  document.body.appendChild(el);
  return el;
}

describe('questionSetup', () => {
  it('renders N and M inputs with defaults', () => {
    const el = mount();
    expect((el.querySelector('#pi-num-candidates') as HTMLInputElement).value).toBe('30');
    expect((el.querySelector('#pi-num-questions') as HTMLInputElement).value).toBe('10');
  });

  it('renders a checkbox for every bank question', () => {
    const el = mount();
    expect(el.querySelectorAll('.pi-bank-item input[type="checkbox"]').length).toBe(QUESTION_BANK.length);
  });

  it('reads only checked bank questions and non-empty custom rows', () => {
    const el = mount({
      pickedBankQuestions: [QUESTION_BANK[0]],
      customQuestions: ['自訂一', ''],
    });
    const value = readQuestionSetup(el);
    expect(value.pickedBankQuestions).toEqual([QUESTION_BANK[0]]);
    expect(value.customQuestions).toEqual(['自訂一']);
  });

  it('marks an invalid config (M <= forced) and returns false', () => {
    const el = mount({ numQuestions: 1, pickedBankQuestions: [QUESTION_BANK[0], QUESTION_BANK[1]] });
    const ok = refreshSetupValidity(el);
    expect(ok).toBe(false);
    expect(el.querySelector('.pi-setup-warning')?.textContent).toContain('使用題數量');
  });

  it('reports valid for the defaults', () => {
    const el = mount();
    expect(refreshSetupValidity(el)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/questionSetup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/questionSetup.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/questionSetup.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/questionSetup.ts web/src/questionSetup.test.ts
git commit -m "feat(web): question-setup UI module (pool/used inputs, bank picker, custom rows)"
```

---

### Task 6: Wire the section into the settings screen + generation

**Files:**
- Modify: `web/src/main.ts` (`showSettingsScreen`, `startGame`)
- Modify: `web/src/style.css` (styles for the new controls)
- Test: `web/src/main.test.ts`

**Interfaces:**
- Consumes: `renderQuestionSetup`, `readQuestionSetup`, `refreshSetupValidity` (Task 5); `validateQuestionSetup` (Task 1); generator options (Tasks 3–4).
- Produces: no new exports; `startGame` gains an optional `setup` argument.

- [ ] **Step 1: Write the failing test**

Add to `web/src/main.test.ts`:

```ts
import { showSettingsScreen } from './main';
// If showSettingsScreen is not yet exported, export it in main.ts.

describe('settings screen question-setup', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; localStorage.clear(); });

  it('renders the question-setup section', () => {
    const root = document.getElementById('app')!;
    showSettingsScreen(root);
    expect(root.querySelector('#pi-num-candidates')).toBeTruthy();
    expect(root.querySelector('#pi-num-questions')).toBeTruthy();
    expect(root.querySelector('.pi-bank-list')).toBeTruthy();
  });

  it('disables 開始遊戲 while the setup is invalid', () => {
    const root = document.getElementById('app')!;
    showSettingsScreen(root);
    (root.querySelector('#pi-apikey') as HTMLInputElement).value = 'k';
    // Make it invalid: used count below forced.
    (root.querySelector('#pi-num-questions') as HTMLInputElement).value = '1';
    root.querySelectorAll<HTMLInputElement>('.pi-bank-item input').forEach((cb, i) => {
      if (i < 2) { cb.checked = true; }
    });
    root.querySelector('.pi-bank-list')?.dispatchEvent(new Event('change', { bubbles: true }));
    const start = root.querySelector('#pi-start') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/main.test.ts`
Expected: FAIL — section absent / `showSettingsScreen` not exported.

- [ ] **Step 3: Implement in `web/src/main.ts`**

Add imports at the top:

```ts
import { renderQuestionSetup, readQuestionSetup, refreshSetupValidity } from './questionSetup';
```

Export `showSettingsScreen` (change `function showSettingsScreen` to `export function showSettingsScreen`).

Inside `showSettingsScreen`, after the existing `root.innerHTML = ...` template, insert a container for the setup section just before `<p class="pi-privacy-note">`. Simplest: add `<div id="pi-question-setup"></div>` inside the settings markup (e.g. right after the 謎底來源 group's closing `</div>`), then after `root.innerHTML` is assigned, render into it:

```ts
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
```

Update the `#pi-start` click handler to read + persist + validate the setup and pass it to `startGame`:

```ts
document.getElementById('pi-start')?.addEventListener('click', () => {
  const backend = (document.getElementById('pi-backend') as HTMLSelectElement).value as 'groq' | 'hf';
  const apiKey = (document.getElementById('pi-apikey') as HTMLInputElement).value.trim();
  const model = (document.getElementById('pi-model') as HTMLInputElement).value.trim();
  const answerModeRadio = document.querySelector<HTMLInputElement>('input[name="answer-mode"]:checked');
  const answerMode = (answerModeRadio?.value as 'ai' | 'human') ?? 'ai';
  const humanAnswer = (document.getElementById('pi-human-answer') as HTMLInputElement).value.trim();
  if (!apiKey) return;
  if (answerMode === 'human' && !humanAnswer) return;

  const setupContainer = document.getElementById('pi-question-setup')!;
  if (!refreshSetupValidity(setupContainer)) return;
  const setup = readQuestionSetup(setupContainer);

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
```

Update `startGame` to pass the fields to the generator (replace the hardcoded `numQuestions: 10`):

```ts
const result = await generator.generate({
  answerMode: settings.answerMode ?? 'ai',
  numQuestions: settings.numQuestions ?? 10,
  numCandidates: settings.numCandidates,
  pickedBankQuestions: settings.pickedBankQuestions,
  customQuestions: settings.customQuestions,
  onProgress: progressLog,
  answer: humanAnswer,
});
```

- [ ] **Step 4: Add styles in `web/src/style.css`**

Append:

```css
.pi-question-setup .pi-bank-body { display: none; }
.pi-question-setup .pi-bank-body.open { display: block; }
.pi-question-setup .pi-bank-list { max-height: 200px; overflow-y: auto; border: 1px solid #4444; border-radius: 6px; padding: 4px; }
.pi-question-setup .pi-bank-item { display: block; padding: 2px 4px; cursor: pointer; }
.pi-question-setup .pi-bank-search { width: 100%; margin-bottom: 6px; }
.pi-question-setup .pi-custom-row { display: flex; gap: 6px; margin-bottom: 4px; }
.pi-question-setup .pi-custom-input { flex: 1; }
.pi-question-setup .pi-setup-warning { color: #e06c6c; min-height: 1.2em; margin-top: 6px; }
.pi-question-setup .pi-bank-count { margin-left: 8px; opacity: 0.75; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/main.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Full suite + manual verification**

Run: `cd web && npx vitest run`
Expected: all tests pass.

Then manually verify with the run/verify flow: start the dev server, open the settings screen, confirm N/M inputs, the collapsible bank picker with search, adding/removing custom rows, the live warning, the disabled 開始遊戲 on an invalid config, and that a valid config generates a game whose questions include the checked + custom questions.

- [ ] **Step 7: Commit**

```bash
git add web/src/main.ts web/src/main.test.ts web/src/style.css
git commit -m "feat(web): wire question-setup section into settings screen and generation"
```

---

## Self-Review

**Spec coverage:**
- 選題數量 (N) → Task 1 (validation), Task 2 (pool size), Task 5/6 (UI input). ✓
- 使用題的數量 (M) → Task 1, Task 3 (reconcile cap), Task 6 (replaces hardcoded 10). ✓
- 從題庫挑題 (checkboxes, forced) → Task 5 (picker), Task 2 (forced in pool), Task 3 (reconcile), Task 4 (reply protection). ✓
- 自訂問題 (forced, AI fills, isCustom) → Task 5 (rows), Task 2/3 (forced + isCustom), Task 4 (reply fill). ✓
- Rules M>X+C, N>M, N<=112+C → Task 1 `validateQuestionSetup`; enforced live in Task 5/6. ✓
- Persistence of all four fields → Task 1 (types), Task 6 (save). ✓
- Deterministic forced guarantee → Task 3 `reconcileForced` + Task 4 forced-reply protection. ✓
- Testing surface (settings, prompts, generator, UI) → Tasks 1–6 each include tests. ✓
- Out of scope (Python, category tags, hand-typed replies) → untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `validateQuestionSetup(QuestionSetupCounts)` consistent across Tasks 1/5/6. `formatDesignerPrompt(answer, DesignerPromptOptions)` consistent Tasks 2/3. `designQuestions(answer, { numQuestions, numCandidates, forcedQuestions })` consistent Tasks 3/4. `reconcileForced` static signature consistent Tasks 3. `readQuestionSetup`/`refreshSetupValidity`/`renderQuestionSetup` consistent Tasks 5/6. `QuestionItem` shape (`question, reply, isCustom`) matches `models.ts`. ✓
