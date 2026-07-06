# Phantom Ink Firebase Web Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the existing Python "Phantom Ink" riddle-game generator (`generator.py`, `game.py`, `bopomofo.py`, `backends.py`, `models.py`, `prompts.py`) into a static TypeScript web app in `web/`, deployable to Firebase Hosting's free Spark plan with no backend, using a BYOK (bring-your-own-key) architecture where the browser calls Groq/HF directly.

**Architecture:** Vite + TypeScript, no UI framework. Each Python module gets a same-named TypeScript module under `web/src/`. LLM calls go straight from the browser to `https://api.groq.com/openai/v1/chat/completions` (Groq) or `https://router.huggingface.co/hf-inference/v1/chat/completions` (HF) — both confirmed via live `curl` to send `access-control-allow-origin: *`, so no CORS proxy or backend is needed. The existing Python project is untouched; the web app lives alongside it in `web/`.

**Tech Stack:** Vite 5/6, TypeScript, Vitest (+ jsdom environment), `pinyin-pro` + `pinyin-to-zhuyin` (bopomofo conversion), `opencc-js` (simplified→traditional), Firebase Hosting via `firebase-tools` (invoked with `npx`, no global install required).

## Global Constraints

- Do not modify any existing Python file (`generator.py`, `game.py`, `bopomofo.py`, `backends.py`, `models.py`, `prompts.py`, `utils.py`) — the web port lives entirely under `web/` and is additive.
- No backend/server code of any kind (no Cloud Functions, no Cloud Run) — every LLM call is a direct `fetch()` from the browser using a user-supplied API key.
- No persistence beyond `localStorage` for the user's own API key/backend/model choice — no Firestore, no accounts, no saved game history (per approved design).
- Match the *actual* runtime behavior of the Python code, not any incorrect docstring/test expectations — in particular, `to_bopomofo_cells("鋼琴")` really produces **7** cells (verified by running the existing Python code), not the 6 that the pre-existing (and already-broken) `test_bopomofo.py::test_to_bopomofo_cells_count` expects. Do not "fix" that Python test as part of this work; it's out of scope.
- All new source files go under `web/src/`; all new tests go under `web/src/**/*.test.ts` (co-located with the file they test, Vitest convention).
- Every task's commit must leave `npm run build` and `npm test` passing in `web/`.

---

### Task 1: Scaffold the Vite + TypeScript + Vitest project

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.ts`
- Create: `web/src/style.css`
- Create: `web/.gitignore`
- Create: `web/firebase.json`
- Create: `web/.firebaserc`

**Interfaces:**
- Produces: a working `npm run build` (outputs `web/dist/`), `npm test` (runs Vitest with `jsdom` environment), and `npm run dev` in the `web/` directory. All later tasks add files under `web/src/` and rely on this scaffold.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "phantom-ink-web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "opencc-js": "^1.4.0",
    "pinyin-pro": "^3.28.1",
    "pinyin-to-zhuyin": "^1.1.0"
  },
  "devDependencies": {
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>靈媒 Phantom Ink</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/style.css`**

```css
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px 12px;
  background: #121213;
  font-family: 'Noto Sans TC', 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 6: Create a placeholder `web/src/main.ts`**

```typescript
const root = document.getElementById('app');
if (root) {
  root.textContent = '靈媒 Phantom Ink — 建置中';
}
```

- [ ] **Step 7: Create `web/.gitignore`**

```
node_modules
dist
.firebase
```

- [ ] **Step 8: Create `web/firebase.json`**

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

- [ ] **Step 9: Create `web/.firebaserc`**

```json
{
  "projects": {
    "default": "REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID"
  }
}
```

Note: `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` must be replaced by hand once a Firebase project exists (Task 10 covers creating one via `firebase login` + `firebase use --add`, which is inherently an interactive step — it can't be scripted in a plan step).

- [ ] **Step 10: Install dependencies**

Run: `cd web && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 11: Verify build and test runner both work**

Run: `cd web && npm run build`
Expected: exits 0, creates `web/dist/index.html` and `web/dist/assets/*.js`.

Run: `cd web && npm test`
Expected: `No test files found` (or similar) — exits 0 since there are no test files yet. This just confirms Vitest itself runs.

- [ ] **Step 12: Commit**

```bash
git add web/package.json web/tsconfig.json web/vite.config.ts web/index.html web/src/main.ts web/src/style.css web/.gitignore web/firebase.json web/.firebaserc
git commit -m "feat(web): scaffold Vite + TypeScript + Vitest project for Firebase port"
```

---

### Task 2: Port `zhconv.py` (simplified→traditional + punctuation) to `zhconv.ts`

**Files:**
- Create: `web/src/zhconv.ts`
- Test: `web/src/zhconv.test.ts`

**Interfaces:**
- Produces: `toTraditional(text: string): string`, `convertPunctuation(text: string): string` — used by `generator/generator.ts` (Task 6) in its `postProcess` step, matching `generator.py`'s `_post_process` static method (which calls `zhconv.convert(text, "zh-tw")` then `.translate(punct_map)`).

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/zhconv.test.ts
import { describe, it, expect } from 'vitest';
import { toTraditional, convertPunctuation } from './zhconv';

describe('zhconv', () => {
  it('converts simplified characters to traditional', () => {
    expect(toTraditional('乐器行')).toBe('樂器行');
    expect(toTraditional('钢琴')).toBe('鋼琴');
  });

  it('leaves already-traditional text unchanged', () => {
    expect(toTraditional('鋼琴')).toBe('鋼琴');
  });

  it('does not translate vocabulary, only characters (matches zhconv.py scope)', () => {
    // 鼠标 -> 鼠標 (character conversion only), NOT 滑鼠 (that's a vocabulary swap,
    // which is out of scope for this function — it's handled by the LLM prompt instead).
    expect(toTraditional('鼠标')).toBe('鼠標');
  });

  it('converts halfwidth punctuation to fullwidth Chinese punctuation', () => {
    expect(convertPunctuation('你好.')).toBe('你好。');
    expect(convertPunctuation('真的?')).toBe('真的？');
    expect(convertPunctuation('一,二,三')).toBe('一，二，三');
    expect(convertPunctuation('甲:乙')).toBe('甲：乙');
    expect(convertPunctuation('甲;乙')).toBe('甲；乙');
    expect(convertPunctuation('哇!')).toBe('哇！');
  });

  it('leaves text with no matching punctuation unchanged', () => {
    expect(convertPunctuation('鋼琴')).toBe('鋼琴');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- zhconv`
Expected: FAIL with "Cannot find module './zhconv'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/zhconv.ts
import OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const PUNCT_MAP: Record<string, string> = {
  '.': '。',
  '?': '？',
  ',': '，',
  ':': '：',
  ';': '；',
  '!': '！',
};

export function toTraditional(text: string): string {
  return converter(text);
}

export function convertPunctuation(text: string): string {
  return text.replace(/[.?,:;!]/g, (ch) => PUNCT_MAP[ch] ?? ch);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- zhconv`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/zhconv.ts web/src/zhconv.test.ts
git commit -m "feat(web): port zhconv simplified-to-traditional conversion to TypeScript"
```

---

### Task 3: Port `bopomofo.py` to `bopomofo.ts`

**Files:**
- Create: `web/src/bopomofo.ts`
- Create: `web/src/types/pinyin-to-zhuyin.d.ts` (ambient module declaration — the npm package ships no TypeScript types)
- Test: `web/src/bopomofo.test.ts`

**Interfaces:**
- Produces: `toBopomofo(text: string): string`, `toBopomofoCells(text: string): string[]`, `revealBopomofo(text: string, cellsToReveal: number): string`, `countBopomofoCells(text: string): number`, `hasBopomofo(text: string): boolean` — used by `generator/generator.ts` (Task 6, `simulatePlayer`) and `main.ts` (Task 9, to build the cell data the game UI reveals).

**Verified library behavior (see design doc's "已驗證的函式庫細節" section for the full investigation):** `pinyin-pro` does not output zhuyin directly. Combining `pinyin-pro`'s `toneType: 'num'` output with `pinyin-to-zhuyin`'s `p2z()`, after three normalizations, reproduces `pypinyin`'s `Style.BOPOMOFO` output exactly:
1. Only convert characters that are Han ideographs (`/[一-鿿]/`); everything else is dropped, matching `pypinyin`'s filter behavior (this must be checked against the *original character*, not the zhuyin output — `p2z()` produces spurious zhuyin-looking output for plain Latin letters).
2. `pinyin-pro` marks neutral tone with a trailing `0` (e.g. `de0`); `p2z()` expects `5` — replace a trailing `0` with `5` before calling `p2z()`.
3. `p2z()` places the neutral-tone dot `˙` *before* the syllable; `pypinyin` places it *after* — if the `p2z()` result starts with `˙`, move it to the end.
4. Match `to_bopomofo()`'s behavior of appending `ˉ` to any syllable not already ending in `ˊˋˇ˙` (this is how first-tone syllables get an explicit mark).

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/bopomofo.test.ts
import { describe, it, expect } from 'vitest';
import {
  toBopomofo,
  toBopomofoCells,
  revealBopomofo,
  countBopomofoCells,
  hasBopomofo,
} from './bopomofo';

describe('bopomofo', () => {
  it('converts a basic word, matching known polyphonic readings', () => {
    const result = toBopomofo('乐器行');
    expect(result).toContain('ㄑㄧˋ');
    expect(result).toContain('ㄒㄧㄥˊ');
  });

  it('converts a single character', () => {
    expect(toBopomofo('钢')).toContain('ㄍ');
  });

  it('counts cells correctly for 鋼琴: 3 (first-tone 鋼, incl. explicit ˉ) + 4 (琴) = 7', () => {
    const cells = toBopomofoCells('钢琴');
    expect(cells).toEqual(['ㄍ', 'ㄤ', 'ˉ', 'ㄑ', 'ㄧ', 'ㄣ', 'ˊ']);
  });

  it('reveals a partial set of cells with a placeholder for the rest', () => {
    const revealed = revealBopomofo('钢琴', 3);
    expect(revealed).toContain('▢');
    const firstThree = revealed.split(' ').slice(0, 3);
    expect(firstThree).not.toContain('▢');
  });

  it('reveals all cells with no placeholder left', () => {
    const total = toBopomofoCells('钢琴').length;
    const revealed = revealBopomofo('钢琴', total);
    expect(revealed).not.toContain('▢');
  });

  it('counts cells for a three-character word', () => {
    expect(countBopomofoCells('演奏厅')).toBeGreaterThan(0);
  });

  it('detects text with convertible Chinese characters', () => {
    expect(hasBopomofo('钢琴')).toBe(true);
  });

  it('rejects pure Latin/digit text', () => {
    expect(hasBopomofo('ABC123')).toBe(false);
  });

  it('handles the empty string', () => {
    expect(countBopomofoCells('')).toBe(0);
  });

  it('drops non-Chinese characters from mixed content instead of misreading them', () => {
    expect(hasBopomofo('Hello世界')).toBe(true);
    // Same 7 cells as 钢琴 alone — the ABC suffix contributes nothing.
    expect(toBopomofoCells('钢琴ABC')).toEqual(['ㄍ', 'ㄤ', 'ˉ', 'ㄑ', 'ㄧ', 'ㄣ', 'ˊ']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- bopomofo`
Expected: FAIL with "Cannot find module './bopomofo'".

- [ ] **Step 3: Add the ambient type declaration for `pinyin-to-zhuyin`**

```typescript
// web/src/types/pinyin-to-zhuyin.d.ts
declare module 'pinyin-to-zhuyin' {
  export function p2z(pinyin: string, options?: { tonemarks?: boolean }): string;
  export function z2p(zhuyin: string, options?: Record<string, unknown>): string;
}
```

- [ ] **Step 4: Write the implementation**

```typescript
// web/src/bopomofo.ts
import { pinyin } from 'pinyin-pro';
import { p2z } from 'pinyin-to-zhuyin';

const HAN_CHAR = /[一-鿿]/;
const TONE_MARKS = new Set(['ˊ', 'ˋ', 'ˇ', '˙']);

function toBopomofoSyllables(text: string): string[] {
  if (!text) return [];
  const chars = Array.from(text);
  const syllables = pinyin(text, { toneType: 'num', type: 'array' }) as string[];
  const result: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (!HAN_CHAR.test(chars[i])) continue;

    let syllable = syllables[i];
    if (syllable.endsWith('0')) {
      syllable = syllable.slice(0, -1) + '5';
    }

    let zhuyin = p2z(syllable, { tonemarks: true });
    if (zhuyin.startsWith('˙')) {
      zhuyin = zhuyin.slice(1) + '˙';
    }
    const lastChar = zhuyin[zhuyin.length - 1];
    if (!TONE_MARKS.has(lastChar)) {
      zhuyin = zhuyin + 'ˉ';
    }

    result.push(zhuyin);
  }

  return result;
}

export function toBopomofo(text: string): string {
  return toBopomofoSyllables(text).join(' ');
}

export function toBopomofoCells(text: string): string[] {
  return toBopomofoSyllables(text).join('').split('');
}

export function revealBopomofo(text: string, cellsToReveal: number): string {
  const cells = toBopomofoCells(text);
  const revealedCount = Math.min(cellsToReveal, cells.length);
  return cells.map((cell, i) => (i < revealedCount ? cell : '▢')).join(' ');
}

export function countBopomofoCells(text: string): number {
  return toBopomofoCells(text).length;
}

export function hasBopomofo(text: string): boolean {
  if (!HAN_CHAR.test(text)) return false;
  return toBopomofoCells(text).length > 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npm test -- bopomofo`
Expected: PASS, 10 tests passing.

- [ ] **Step 6: Commit**

```bash
git add web/src/bopomofo.ts web/src/bopomofo.test.ts web/src/types/pinyin-to-zhuyin.d.ts
git commit -m "feat(web): port bopomofo conversion to TypeScript via pinyin-pro + pinyin-to-zhuyin"
```

---

### Task 4: Port `prompts.py` to `prompts.ts`

**Files:**
- Create: `web/src/generator/prompts.ts`
- Test: `web/src/generator/prompts.test.ts`

**Interfaces:**
- Produces: `formatDesignerPrompt(answer: string, numQuestions?: number): { system: string; user: string }`, `REVIEWER_SYSTEM_PROMPT: string`, `reviewerUserPrompt(answer: string, questionsText: string): string`, `SIMULATOR_SYSTEM_PROMPT: string`, `simulatorUserPrompt(categoryHint: string, roundNumber: number, history: string, question: string, revealedBpmf: string, totalCells: number): string`, `answerGeneratorPrompt(seed: string, usedHint: string): string`, `ANSWER_SEEDS: string[]`, `CATEGORY_HINTS: Record<string, string>`, `QUESTION_BANK: string[]` — all consumed by `generator/generator.ts` (Task 6).
- Note: `prompts.py`'s `INK_ESTIMATOR_PROMPT` is not ported — it's defined in the Python file but never imported or called anywhere in `generator.py`. Porting unused code violates YAGNI.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/generator/prompts.test.ts
import { describe, it, expect } from 'vitest';
import { formatDesignerPrompt, QUESTION_BANK } from './prompts';

describe('formatDesignerPrompt', () => {
  it('computes hard/easy counts the same way as the Python version (~40% hard, default 10 questions)', () => {
    const { system, user } = formatDesignerPrompt('鋼琴', 10);
    expect(system).toContain('選出最適合的10個問題');
    expect(system).toContain('前4題不能讓一般人直接猜出');
    expect(system).toContain('第10題必須幾乎可以猜出');
    expect(user).toContain('謎底：鋼琴');
  });

  it('samples at most 30 questions from the bank into the system prompt', () => {
    const { system } = formatDesignerPrompt('鋼琴', 10);
    const bankLines = system.split('\n').filter((line) => line.startsWith('- '));
    expect(bankLines.length).toBeLessThanOrEqual(30);
    expect(bankLines.length).toBeGreaterThan(0);
  });

  it('every sampled question actually comes from QUESTION_BANK', () => {
    const { system } = formatDesignerPrompt('鋼琴', 10);
    const bankLines = system
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    for (const line of bankLines) {
      expect(QUESTION_BANK).toContain(line);
    }
  });

  it('has 112 entries in the question bank, matching the Python source', () => {
    expect(QUESTION_BANK.length).toBe(112);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- prompts`
Expected: FAIL with "Cannot find module './prompts'".

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/generator/prompts.ts

export function designerSystemPrompt(
  numQuestions: number,
  hardCount: number,
  easyCount: number,
  questionBankText: string,
): string {
  return `你是一位經驗豐富的「靈媒遊戲」出題老師。請全程使用臺灣慣用詞彙（例如：印表機而非打印機、網路而非網絡、滑鼠而非鼠標）。

你的任務是為給定的謎底，從題庫中選出最適合的${numQuestions}個問題，並根據謎底填入對應的回答。

## 遊戲規則
- 謎底是一個具體名詞（如「鋼琴」「颱風」「相機」）
- 每題包含一個問題與一個回答
- 玩家只看到問題，回答會以注音一格一格顯示
- 玩家可在任何時候猜測謎底

## 出題規則（嚴格遵守）
1. 每題回答必須是**一句短語**，不超過六個中文字
2. 回答**不能直接包含謎底**（例如謎底是「鋼琴」，回答不能出現「鋼琴」）
3. ${numQuestions}題由**難到易**排列
4. 前${hardCount}題不能讓一般人直接猜出
5. 第${numQuestions}題必須幾乎可以猜出
6. 不可重複詢問同一類資訊
7. 每個回答必須可以轉成注音
8. 回答必須**唯一合理**（不能讓人有多種解讀）
9. **全中文**，不可出現英文或數字
10. 問題和回答**結尾必須加句號**，讓玩家知道提示結束了

## 題庫（從這裡選問題）

${questionBankText}

## 選題原則

1. 根據謎底特質，選最有意義、最能勾起思考的${numQuestions}題
2. 避開對這個謎底來說太奇怪或無意義的問題
3. 確定涵蓋多個面向（不要全部問顏色/形狀/價格）
4. 前${hardCount}題選需要專業知識或間接聯想的
5. 最後${easyCount}題選接近生活經驗的`;
}

export function designerUserPrompt(answer: string, numQuestions: number): string {
  return `請為以下謎底，從題庫選${numQuestions}題，填入對應回答：

謎底：${answer}

請嚴格遵守以下格式輸出 JSON，不要有任何其他文字：

{
  "answer": "${answer}",
  "questions": [
    {"question": "從題庫選的問題1", "reply": "根據謎底填入的回答1"},
    {"question": "從題庫選的問題2", "reply": "根據謎底填入的回答2"},
    ...
  ]
}`;
}

function sampleRandom<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function formatDesignerPrompt(
  answer: string,
  numQuestions = 10,
): { system: string; user: string } {
  const hardCount = Math.max(1, Math.floor((numQuestions * 2) / 5));
  const easyCount = Math.max(2, numQuestions - hardCount - 1);
  const sample = sampleRandom(QUESTION_BANK, Math.min(30, QUESTION_BANK.length));
  const bankText = sample.map((q) => `- ${q}`).join('\n');
  return {
    system: designerSystemPrompt(numQuestions, hardCount, easyCount, bankText),
    user: designerUserPrompt(answer, numQuestions),
  };
}

export const REVIEWER_SYSTEM_PROMPT = `你是一位嚴格的「靈媒遊戲」品質測試員。

你的工作是評估一組題目的品質，確保它們適合實際遊戲。

## 評估項目
1. **暴雷檢查** — 是否有任何一題的回答直接或間接洩漏謎底？
2. **難度遞增** — 是否從難到易？前幾題是否夠難？
3. **重複檢查** — 是否有兩題詢問同一類資訊？
4. **回答包含謎底** — 回答中是否直接包含謎底文字？
5. **回答長度** — 是否有回答超過六個中文字？
6. **回答歧義** — 是否有回答可能有多種解讀？
7. **遊戲適合度** — 整體來說是否適合靈媒遊戲？

## 評分標準
- 90-100：完美，可以直接使用
- 70-89：良好，小幅調整即可
- 50-69：需要大幅修改
- 0-49：不可使用`;

export function reviewerUserPrompt(answer: string, questionsText: string): string {
  return `請評估以下題組：

謎底：${answer}

題目：
${questionsText}

請輸出以下 JSON 格式：
{
  "score": <整數 0-100>,
  "passed": <true 或 false>,
  "comments": [
    "項目1的意見",
    "項目2的意見",
    ...
  ]
}

評分標準：pass 門檻為 70 分。`;
}

export const SIMULATOR_SYSTEM_PROMPT = `你正在玩「靈媒遊戲」。

遊戲規則：
1. 有一個隱藏的謎底（具體名詞）
2. 主持人會逐一展示問題，以及對應回答的注音（一個一個慢慢揭露）
3. 你要根據目前看到的所有資訊來猜測謎底
4. 你可以在任何時候猜測，但猜錯就輸了
5. 你的目標是在看到最少注音的情況下，盡快猜對

注意事項：
- 你只能看到：「問題內容」以及「已揭露的注音」
- 你看不到完整的回答文字
- 注音是逐格揭露的
- 同一個注音符號的不同聲調視為不同格（ㄩ和ㄩˋ是不同的）`;

export function simulatorUserPrompt(
  categoryHint: string,
  roundNumber: number,
  history: string,
  question: string,
  revealedBpmf: string,
  totalCells: number,
): string {
  return `謎底類別提示：${categoryHint}

目前進度 — 第 ${roundNumber} 題：

${history}

本題問題：${question}
本題回答的注音已揭露：${revealedBpmf}
（完整回答共 ${totalCells} 格注音）

---
請輸出你的思考與猜測：

{
  "current_best_guess": "你認為最可能的謎底",
  "confidence": <0.0 到 1.0 的小數>,
  "want_to_guess": <true 或 false>,
  "reason": "為什麼這麼猜"
}

如果你 want_to_guess 為 true，且猜對了，遊戲結束。`;
}

export function answerGeneratorPrompt(seed: string, usedHint: string): string {
  return `你是一位「靈媒遊戲」的題目設計師。
請產生一個適合當作謎底的具體名詞。請使用臺灣慣用詞彙。

要求：
- 必須是具體名詞（不要選太抽象的）
- 提示方向：與「${seed}」有關的事物
- 不能太冷門
- 兩個字或三個字為主
- ${usedHint}
- 不要有標點符號
- 只要輸出一個詞，不要任何其他文字`;
}

export const ANSWER_SEEDS: readonly string[] = [
  '廚房', '戶外', '辦公室', '浴室', '學校', '醫院',
  '公園', '海邊', '山上', '車站', '森林', '沙漠',
  '太空', '海底', '農村', '圖書館', '動物園', '夜市',
  '運動場', '寺廟', '市場', '實驗室', '機場', '港口',
  '音樂廳', '電影院', '遊樂園', '美術館', '體育館',
  '河邊', '地下', '天空', '冬天', '夏天', '夜晚',
];

export const CATEGORY_HINTS: Readonly<Record<string, string>> = {
  樂器: '這是一件樂器',
  動物: '這是一種動物',
  食物: '這是一種食物/飲料',
  地點: '這是一個地點/場所',
  物品: '這是一件日常物品',
  自然: '這是一種自然現象/物體',
  人物: '這是一個人物角色',
  交通工具: '這是一種交通工具',
  工具: '這是一種工具/器具',
  運動: '這是一項運動/體育項目',
};

export const QUESTION_BANK: readonly string[] = [
  '提到它，最先閃過您腦海的是哪個字詞？',
  '哪個形容詞最能描述它？',
  '它的反義詞為何？',
  '它包含什麼幾何圖形？',
  '什麼單位量詞會用來計算它？',
  '哪座城市與它相關性最高？',
  '它與什麼無關（僅為誤導對手）？',
  '您用身體的哪個部位使用它？',
  '如何攜帶或運輸它？',
  '什麼機關或單位會負責管理它？',
  '它會發出何種聲音（擬聲詞）？',
  '離您最近的它在哪裡（以幽靈為準）？',
  '您感覺哪一位海龜板友的家裡會有它？',
  '海龜板友當中誰最喜歡它？',
  '有什麼東西的危險程度與它相仿？',
  '什麼休閒娛樂或活動和它相關性最高？',
  '它有幾個字？',
  '它的別名為何？',
  '它的用途為何？',
  '您最有可能在哪個旅遊景點找到它？',
  '它會造成什麼事故或傷害？',
  '誰或什麼創作、發明或製造了它？',
  '為了使用它，您還需要什麼東西？',
  '您能在哪個大洲或地區找到最多的它？',
  '哪個年齡層的人最喜歡它？',
  '哪個歷史人物擁有或使用它？',
  '它靠什麼驅動？',
  '它裡面有什麼？',
  '它的任何一個字的部首是什麼？',
  '它的重量和什麼相仿？',
  '它存放在哪裡？',
  '哪位虛構人物擁有或使用它？',
  '它解決了什麼問題？',
  '它聞起來如何？',
  '除了最主要的用途，它還有什麼其他用途？',
  '在房子裡的何處可以找到它？',
  '它由什麼材料製成？',
  '哪個國家或城市與它相關性最高？',
  '您在何處使用它？',
  '它會引起何種情緒？',
  '您會用什麼毀滅它？',
  '何種職業會用到它？',
  '它對您哪個人生階段最有幫助？',
  '它最適合出現在哪個童話或哪首兒歌中？',
  '哪個節日與它相關性最高？',
  '它出現在什麼遊戲中？',
  '如果暫時沒有它，可以用什麼替代？',
  '它的常見品牌為何？',
  '它的次要材料是什麼？',
  '什麼事物可以限制、約束或規範它？',
  '什麼會改變它？',
  '什麼其他物品常和它一起出現？',
  '作為武器，您會如何使用它？',
  '它最有可能出現在何種類型的電影或書籍？',
  '如果您只擁有它的一半，會如何使用或處理？',
  '它如何移動？',
  '使用它後，您有何感受？',
  '它的價格和什麼相仿？',
  '人們和它產生互動時，常用什麼動詞來描述？',
  '它和什麼東西相似？',
  '它的局部或某個部分如何稱呼？',
  '哪一句成語與它相關？',
  '它的注音符號與聲調總共有幾個？（一聲也算一個）',
  '若無外力介入，它的壽命有多長？',
  '您會在哪裡買到或獲得它？',
  '您最有可能在何種商店找到它？',
  '您能在何處找到它？',
  '舉出一種使用它的錯誤方式（僅為誤導對手）',
  '哪位名人擁有或使用它？',
  '您能用它製造什麼？',
  '您最喜歡它的哪個型號或種類？',
  '何種課程或科系與它相關性最高？',
  '哪種人擁有或使用它？',
  '它的外觀大致是什麼模樣或形狀？',
  '您如何拿著它？',
  '它屬於何種類別？',
  '它的原料或成分包含什麼？',
  '它的大小和什麼相仿？',
  '人用什麼姿勢或動作和它互動？',
  '您多常使用它？',
  '它是如何製作、創造或形成的？',
  '什麼抽象概念與它相關？',
  '什麼東西可能在它的外層包裝、覆蓋或遮蔽它？',
  '它在使用時會發出什麼聲音？',
  '哪個學術領域研究它？',
  '您為何使用它？',
  '它觸感如何？',
  '您在一天中的何時使用它？',
  '什麼狀況可能對它造成威脅或危險？',
  '您對它有何看法？',
  '它對周遭的事物有何影響？',
  '當它死亡、損壞或不再有用時，會去哪裡？',
  '它曾出現在什麼書、電影或電視節目中？',
  '您今天曾經看到幾個它？',
  '您會將它放在何種容器裡？',
  '它可分為那些款式、品種、口味或種類？',
  '它「不是」由何種材料製成（僅為誤導對手）？',
  '若以它的末字進行同音異字接龍，可以哪一個字？',
  '它可能會造成什麼問題？',
  '它是何種顏色？',
  '當有人送它給您時，您作何感想？',
  '什麼歌曲或樂曲與它相關？',
  '誰不喜歡它？',
  '什麼專有名詞與它相關性最高？',
  '什麼現象或狀況與它相關性最高？',
  '什麼人格特質與它相關？',
  '沒有外物輔助下，您可以單手拿幾個它？',
  '什麼PTT看板可能會討論它？（可虛構）',
  '什麼東西與它同類別或同性質？',
  '當它掉落時，會發出什麼聲音？',
  '何種派對主題最適合它？',
  '人們為何爭奪它？',
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- prompts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/generator/prompts.ts web/src/generator/prompts.test.ts
git commit -m "feat(web): port prompt templates and question bank to TypeScript"
```

---

### Task 5: Port `models.py` and `backends.py` to TypeScript

**Files:**
- Create: `web/src/generator/models.ts`
- Create: `web/src/backends/shared.ts`
- Create: `web/src/backends/groq.ts`
- Create: `web/src/backends/hf.ts`
- Test: `web/src/backends/shared.test.ts`
- Test: `web/src/backends/groq.test.ts`
- Test: `web/src/backends/hf.test.ts`

**Interfaces:**
- Produces: `QuestionItem`, `QuestionSet`, `ReviewResult`, `SimulationRound`, `SimulationResult`, `QuestionSetWithMeta` types (from `models.ts`); `ChatMessage`, `ResponseFormat`, `LLMBackend`, `extractJson(text: string): string` (from `backends/shared.ts`); `GroqBackend` class + `GROQ_DEFAULT_MODEL` (from `backends/groq.ts`); `HFBackend` class + `HF_DEFAULT_MODEL` (from `backends/hf.ts`). Both backend classes implement `LLMBackend`. Consumed by `generator/generator.ts` (Task 6) and `settings.ts`/`main.ts` (Tasks 7–9).
- **Verified endpoints (live `curl` on 2026-07-06, both return `access-control-allow-origin: *` on the preflight `OPTIONS` and the real request):**
  - Groq: `POST https://api.groq.com/openai/v1/chat/completions`, `Authorization: Bearer <key>`, OpenAI-compatible body.
  - HF: `POST https://router.huggingface.co/hf-inference/v1/chat/completions`, `Authorization: Bearer <key>`, OpenAI-compatible body. (This is HF's newer "Inference Providers" router, matching what `huggingface_hub>=0.26`'s `InferenceClient.chat_completion()` uses under the hood.)
- Note: in `backends.py`, only `GroqBackend.chat()` forwards `response_format` to the API call; `HFInferenceBackend.chat()` never sends it to the API (it only uses the flag locally to decide whether to run `_extract_json` on the reply). The TypeScript port preserves this exact asymmetry.

- [ ] **Step 1: Write `models.ts` (plain types, no test needed — there's no runtime behavior to test)**

```typescript
// web/src/generator/models.ts

export interface QuestionItem {
  question: string;
  reply: string;
  isCustom: boolean;
}

export interface QuestionSet {
  answer: string;
  questions: QuestionItem[];
}

export interface ReviewResult {
  score: number;
  passed: boolean;
  comments: string[];
}

export interface SimulationRound {
  roundNumber: number;
  question: string;
  reply: string;
  inkRevealed: string;
  playerGuess: string;
  guessedCorrectly: boolean;
}

export interface SimulationResult {
  guessRound: number;
  inkUsed: number;
  confidence: number;
  tooEasy: boolean;
  tooHard: boolean;
  reason: string;
  rounds: SimulationRound[];
}

export interface QuestionSetWithMeta {
  answer: string;
  questions: QuestionItem[];
  review: ReviewResult | null;
  simulation: SimulationResult | null;
  retryCount: number;
}
```

- [ ] **Step 2: Write the failing test for `backends/shared.ts`**

```typescript
// web/src/backends/shared.test.ts
import { describe, it, expect } from 'vitest';
import { extractJson } from './shared';

describe('extractJson', () => {
  it('extracts JSON from a fenced ```json code block', () => {
    const text = 'here you go:\n```json\n{"a": 1}\n```\nthanks';
    expect(extractJson(text)).toBe('{"a": 1}');
  });

  it('extracts JSON from a fenced code block with no language tag', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJson(text)).toBe('{"a": 1}');
  });

  it('extracts a balanced brace object with no fencing', () => {
    const text = 'sure, {"a": {"b": 1}} is the answer';
    expect(extractJson(text)).toBe('{"a": {"b": 1}}');
  });

  it('returns the original text unchanged if no JSON object is found', () => {
    expect(extractJson('no json here')).toBe('no json here');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npm test -- shared`
Expected: FAIL with "Cannot find module './shared'".

- [ ] **Step 4: Write `backends/shared.ts`**

```typescript
// web/src/backends/shared.ts

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ResponseFormat {
  type: 'json_object';
}

export interface LLMBackend {
  modelName(): string;
  chat(
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
  ): Promise<string>;
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  const braceStart = text.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return text.slice(braceStart, i + 1).trim();
      }
    }
  }
  return text;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npm test -- shared`
Expected: PASS, 4 tests passing.

- [ ] **Step 6: Write the failing test for `backends/groq.ts`**

```typescript
// web/src/backends/groq.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroqBackend, GROQ_DEFAULT_MODEL } from './groq';

describe('GroqBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the expected request shape and returns the reply text', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello back' } }] }),
    });

    const backend = new GroqBackend('gsk_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7);

    expect(reply).toBe('hello back');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe(GROQ_DEFAULT_MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.7);
  });

  it('extracts JSON from the reply when response_format is json_object', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"x": 1}\n```' } }],
      }),
    });

    const backend = new GroqBackend('gsk_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7, undefined, {
      type: 'json_object',
    });

    expect(reply).toBe('{"x": 1}');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('throws with the response body when the request fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid key"}',
    });

    const backend = new GroqBackend('bad-key');
    await expect(backend.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
  });

  it('uses a custom model when provided', () => {
    const backend = new GroqBackend('gsk_test', 'llama-3.3-70b-versatile');
    expect(backend.modelName()).toBe('llama-3.3-70b-versatile');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npm test -- groq`
Expected: FAIL with "Cannot find module './groq'".

- [ ] **Step 8: Write `backends/groq.ts`**

```typescript
// web/src/backends/groq.ts
import { extractJson, type ChatMessage, type LLMBackend, type ResponseFormat } from './shared';

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3-32b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqBackend implements LLMBackend {
  constructor(
    private apiKey: string,
    private model: string = GROQ_DEFAULT_MODEL,
  ) {}

  modelName(): string {
    return this.model;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    if (responseFormat) body.response_format = responseFormat;

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let reply: string = data.choices[0].message.content;
    if (responseFormat?.type === 'json_object') {
      reply = extractJson(reply);
    }
    return reply;
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd web && npm test -- groq`
Expected: PASS, 4 tests passing.

- [ ] **Step 10: Write the failing test for `backends/hf.ts`**

```typescript
// web/src/backends/hf.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HFBackend, HF_DEFAULT_MODEL } from './hf';

describe('HFBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the expected request shape and returns the reply text', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello back' } }] }),
    });

    const backend = new HFBackend('hf_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7);

    expect(reply).toBe('hello back');
    expect(fetch).toHaveBeenCalledWith(
      'https://router.huggingface.co/hf-inference/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer hf_test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe(HF_DEFAULT_MODEL);
  });

  it('never sends response_format to the API, but still extracts JSON locally', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"x": 1}\n```' } }],
      }),
    });

    const backend = new HFBackend('hf_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7, undefined, {
      type: 'json_object',
    });

    expect(reply).toBe('{"x": 1}');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('throws with the response body when the request fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Invalid username or password."}',
    });

    const backend = new HFBackend('bad-key');
    await expect(backend.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `cd web && npm test -- hf`
Expected: FAIL with "Cannot find module './hf'".

- [ ] **Step 12: Write `backends/hf.ts`**

```typescript
// web/src/backends/hf.ts
import { extractJson, type ChatMessage, type LLMBackend, type ResponseFormat } from './shared';

export const HF_DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const HF_ENDPOINT = 'https://router.huggingface.co/hf-inference/v1/chat/completions';

export class HFBackend implements LLMBackend {
  constructor(
    private apiKey: string,
    private model: string = HF_DEFAULT_MODEL,
  ) {}

  modelName(): string {
    return this.model;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;

    const res = await fetch(HF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HF Inference API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let reply: string = data.choices[0].message.content;
    if (responseFormat?.type === 'json_object') {
      reply = extractJson(reply);
    }
    return reply;
  }
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `cd web && npm test -- hf`
Expected: PASS, 3 tests passing.

- [ ] **Step 14: Commit**

```bash
git add web/src/generator/models.ts web/src/backends/
git commit -m "feat(web): port models and Groq/HF backends to TypeScript, verified against live CORS behavior"
```

---

### Task 6: Port `generator.py`'s pipeline to `generator.ts`

**Files:**
- Create: `web/src/generator/generator.ts`
- Create: `web/src/generator/fakeBackend.ts` (test helper — a scriptable `LLMBackend` implementation)
- Test: `web/src/generator/generator.test.ts`

**Interfaces:**
- Consumes: `LLMBackend`, `ChatMessage`, `ResponseFormat` (from `backends/shared.ts`, Task 5); `QuestionItem`, `QuestionSet`, `QuestionSetWithMeta`, `ReviewResult`, `SimulationResult`, `SimulationRound` (from `generator/models.ts`, Task 5); everything from `generator/prompts.ts` (Task 4); `toTraditional`, `convertPunctuation` (from `zhconv.ts`, Task 2); `toBopomofoCells`, `countBopomofoCells` (from `bopomofo.ts`, Task 3).
- Produces: `class PhantomInkGenerator` with methods `designQuestions`, `reviewQuestions`, `simulatePlayer`, `generateAnswer`, `generate` — consumed by `main.ts` (Task 9). (`generator.py`'s `generate_batch` is not ported: it's never called by the web app — `main.ts` only ever runs one game at a time — and in the original Python it's only meaningful when callers override its default `answer_mode` to `"human"`, since the default `"ai"` would silently discard every provided answer. Porting an unused method with a confusing default violates YAGNI; skip it.)
- Note on `generate_answer`'s used-answers history: `generator.py` persists previously-generated answers to a local file (`generated_answers.txt`) to avoid repeats across runs. There's no filesystem in a browser tab, and the approved design has no persistence, so the TypeScript port accepts `usedAnswers: string[]` as a parameter instead of reading/writing a file — the caller (`main.ts`, Task 9) is responsible for keeping a session-only array across repeated calls if it wants that behavior. This is a deliberate scope reduction, not a missing feature: the Python version's file-based history is itself just an in-process convenience, and the approved design explicitly rules out any persistence.

- [ ] **Step 1: Write the `FakeBackend` test helper**

```typescript
// web/src/generator/fakeBackend.ts
import type { ChatMessage, LLMBackend, ResponseFormat } from '../backends/shared';

/** Scriptable LLMBackend for tests: returns queued replies in call order. */
export class FakeBackend implements LLMBackend {
  private queue: string[];
  public calls: { messages: ChatMessage[]; temperature?: number; maxTokens?: number }[] = [];

  constructor(replies: string[]) {
    this.queue = [...replies];
  }

  modelName(): string {
    return 'fake-model';
  }

  async chat(
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
    _responseFormat?: ResponseFormat,
  ): Promise<string> {
    this.calls.push({ messages, temperature, maxTokens });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('FakeBackend: no more scripted replies queued');
    }
    return next;
  }
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// web/src/generator/generator.test.ts
import { describe, it, expect } from 'vitest';
import { PhantomInkGenerator } from './generator';
import { FakeBackend } from './fakeBackend';

const GOOD_DESIGN_REPLY = JSON.stringify({
  answer: '鋼琴',
  questions: [
    { question: '它由什麼材料製成？', reply: '木頭與金屬弦.' },
    { question: '它是何種顏色？', reply: '通常是黑色或白色.' },
  ],
});

const PASSING_REVIEW_REPLY = JSON.stringify({
  score: 88,
  passed: true,
  comments: ['難度合理'],
});

describe('PhantomInkGenerator.designQuestions', () => {
  it('post-processes replies to traditional Chinese with a trailing 。', async () => {
    const backend = new FakeBackend([GOOD_DESIGN_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', 'ai', 2);

    expect(qs.answer).toBe('鋼琴');
    expect(qs.questions[0].reply).toBe('木頭與金屬弦。');
    expect(qs.questions[1].reply).toBe('通常是黑色或白色。');
  });

  it('marks questions not present in QUESTION_BANK as custom', async () => {
    const madeUpQuestion = JSON.stringify({
      answer: '鋼琴',
      questions: [{ question: '這是我自己編的問題？', reply: '測試回答.' }],
    });
    const backend = new FakeBackend([madeUpQuestion]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', 'ai', 1);

    expect(qs.questions[0].isCustom).toBe(true);
  });

  it('empties out replies in human answer mode', async () => {
    const backend = new FakeBackend([GOOD_DESIGN_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', 'human', 2);

    expect(qs.questions.every((q) => q.reply === '')).toBe(true);
  });
});

describe('PhantomInkGenerator.reviewQuestions', () => {
  it('parses score/passed/comments from the reply', async () => {
    const backend = new FakeBackend([PASSING_REVIEW_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const review = await generator.reviewQuestions({
      answer: '鋼琴',
      questions: [{ question: 'Q', reply: 'A。', isCustom: false }],
    });

    expect(review).toEqual({ score: 88, passed: true, comments: ['難度合理'] });
  });
});

describe('PhantomInkGenerator.generate', () => {
  it('retries bad questions (duplicate replies) via fixQuestions before returning', async () => {
    const badDesign = JSON.stringify({
      answer: '鋼琴',
      questions: [
        { question: '它由什麼材料製成？', reply: '重複回答.' },
        { question: '它是何種顏色？', reply: '重複回答.' },
      ],
    });
    const fixedTwo = JSON.stringify({
      questions: [
        { question: '它由什麼材料製成？', reply: '木頭.' },
        { question: '它是何種顏色？', reply: '黑色.' },
      ],
    });

    const backend = new FakeBackend([badDesign, fixedTwo, PASSING_REVIEW_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const result = await generator.generate({
      answer: '鋼琴',
      answerMode: 'human',
      numQuestions: 2,
      skipReview: false,
      skipSimulation: true,
    });

    expect(result.questions.map((q) => q.reply)).toEqual(['木頭。', '黑色。']);
    expect(result.review).toEqual({ score: 88, passed: true, comments: ['難度合理'] });
  });

  it('returns a failure placeholder after exhausting max retries', async () => {
    // Every design_questions call throws (queue runs dry immediately).
    const backend = new FakeBackend([]);
    const generator = new PhantomInkGenerator(backend, 2);

    const result = await generator.generate({
      answer: '鋼琴',
      answerMode: 'human',
      numQuestions: 2,
    });

    expect(result.questions).toEqual([
      { question: '（生成失敗）', reply: '（生成失敗）', isCustom: false },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npm test -- generator`
Expected: FAIL with "Cannot find module './generator'".

- [ ] **Step 4: Write `generator/generator.ts`**

```typescript
// web/src/generator/generator.ts
import type { ChatMessage, LLMBackend } from '../backends/shared';
import type {
  QuestionItem,
  QuestionSet,
  QuestionSetWithMeta,
  ReviewResult,
  SimulationResult,
  SimulationRound,
} from './models';
import {
  ANSWER_SEEDS,
  CATEGORY_HINTS,
  QUESTION_BANK,
  REVIEWER_SYSTEM_PROMPT,
  SIMULATOR_SYSTEM_PROMPT,
  answerGeneratorPrompt,
  formatDesignerPrompt,
  reviewerUserPrompt,
  simulatorUserPrompt,
} from './prompts';
import { convertPunctuation, toTraditional } from '../zhconv';
import { countBopomofoCells, toBopomofoCells } from '../bopomofo';

export interface GenerateOptions {
  answer?: string;
  skipReview?: boolean;
  skipSimulation?: boolean;
  answerMode?: 'ai' | 'human';
  numQuestions?: number;
  usedAnswers?: string[];
}

export class PhantomInkGenerator {
  constructor(
    private llm: LLMBackend,
    private maxRetries = 3,
  ) {}

  private async jsonChat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
  ): Promise<any> {
    const reply = await this.llm.chat(messages, temperature, maxTokens, { type: 'json_object' });
    return JSON.parse(reply);
  }

  private postProcess(qs: QuestionSet): QuestionSet {
    for (const q of qs.questions) {
      q.question = convertPunctuation(toTraditional(q.question));
      q.reply = convertPunctuation(toTraditional(q.reply));
      if (q.reply && !q.reply.trimEnd().endsWith('。')) {
        q.reply = q.reply.trimEnd() + '。';
      }
    }
    return qs;
  }

  async designQuestions(
    answer: string,
    answerMode: 'ai' | 'human' = 'ai',
    numQuestions = 10,
  ): Promise<QuestionSet> {
    const { system, user } = formatDesignerPrompt(answer, numQuestions);
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

    for (const q of qs.questions) {
      if (!QUESTION_BANK.includes(q.question)) q.isCustom = true;
    }

    const unknown = qs.questions.filter((q) => q.isCustom).map((q) => q.question);
    if (unknown.length) {
      console.warn('⚠️ 以下題目不在題庫中（已標記為自創題）：', unknown);
    }

    const replies = qs.questions.map((q) => q.reply);
    const dupes = new Set(replies.filter((r) => replies.filter((x) => x === r).length > 1));
    if (dupes.size) {
      console.warn(`⚠️ 發現重複回答：${[...dupes].join('、')}`);
    }

    const leakReplies: string[] = [];
    for (const q of qs.questions) {
      const leaked = [...qs.answer].filter((c) => q.reply.includes(c));
      if (leaked.length) leakReplies.push(`「${q.reply}」洩漏了「${leaked.join('')}」`);
    }
    if (leakReplies.length) {
      console.warn('⚠️ 回答包含謎底文字（可能太簡單）：', leakReplies);
    }

    if (answerMode === 'human') {
      qs.questions = qs.questions.map((q) => ({ question: q.question, reply: '', isCustom: q.isCustom }));
    }

    return qs;
  }

  async reviewQuestions(questionSet: QuestionSet): Promise<ReviewResult> {
    const questionsText = questionSet.questions
      .map((q, i) => `Q${i + 1}. ${q.question}\nA${i + 1}. ${q.reply}`)
      .join('\n');

    const raw = await this.jsonChat(
      [
        { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
        { role: 'user', content: reviewerUserPrompt(questionSet.answer, questionsText) },
      ],
      0.3,
      1024,
    );

    return {
      score: raw.score ?? 0,
      passed: raw.passed ?? false,
      comments: raw.comments ?? [],
    };
  }

  async simulatePlayer(questionSet: QuestionSet): Promise<SimulationResult> {
    const rounds: SimulationRound[] = [];
    const categoryHint = await this.inferCategory(questionSet.answer);

    for (let i = 0; i < questionSet.questions.length; i++) {
      const qItem = questionSet.questions[i];
      const roundNum = i + 1;
      const totalCells = countBopomofoCells(qItem.reply);
      const cells = toBopomofoCells(qItem.reply);
      let revealedCount = 0;
      let guessed = false;
      let lastRaw: { current_best_guess?: string } = {};

      for (let revealStep = 1; revealStep <= totalCells; revealStep++) {
        revealedCount = revealStep;

        const historyLines = rounds.map(
          (r, j) =>
            `Q${j + 1}: ${r.question}\n回答注音: ${r.inkRevealed}\n你的猜測: ${r.playerGuess || '（尚未猜測）'}`,
        );
        const history = historyLines.length ? historyLines.join('\n\n') : '（尚無歷史）';

        const revealedDisplay = [
          ...cells.slice(0, revealedCount),
          ...Array(totalCells - revealedCount).fill('▢'),
        ].join(' ');

        const prompt = simulatorUserPrompt(
          categoryHint,
          roundNum,
          history,
          qItem.question,
          revealedDisplay,
          totalCells,
        );

        const raw = await this.jsonChat(
          [
            { role: 'system', content: SIMULATOR_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          0.5,
        );
        lastRaw = raw;
        const wantToGuess = raw.want_to_guess ?? false;
        const guess: string = raw.current_best_guess ?? '';

        if (wantToGuess && guess.trim() === questionSet.answer) {
          guessed = true;
          break;
        }
        if (wantToGuess && guess.trim() !== questionSet.answer) {
          guessed = false;
          break;
        }
      }

      const revealedDisplayFinal = [
        ...cells.slice(0, revealedCount),
        ...Array(totalCells - revealedCount).fill('▢'),
      ].join(' ');

      rounds.push({
        roundNumber: roundNum,
        question: qItem.question,
        reply: qItem.reply,
        inkRevealed: revealedDisplayFinal,
        playerGuess: lastRaw.current_best_guess ?? '',
        guessedCorrectly: guessed,
      });

      if (guessed) break;
    }

    const lastCorrect = [...rounds].reverse().find((r) => r.guessedCorrectly);
    const guessRound = lastCorrect ? lastCorrect.roundNumber : rounds.length + 1;
    const inkUsed = rounds.reduce(
      (sum, r) => sum + [...r.inkRevealed].filter((c) => c !== '▢' && c !== ' ').length,
      0,
    );
    const tooEasy = guessRound <= 2;
    const tooHard = guessRound > questionSet.questions.length;
    const confidence = Math.max(0, Math.min(1, 1 - (guessRound - 1) / 7));

    return {
      guessRound,
      inkUsed,
      confidence: Math.round(confidence * 100) / 100,
      tooEasy,
      tooHard,
      reason: this.buildSimulationReason(rounds, guessRound, tooEasy, tooHard),
      rounds,
    };
  }

  async generateAnswer(usedAnswers: string[] = []): Promise<string> {
    const usedHint = usedAnswers.length
      ? `以下謎底已經出過了，請不要重複：${usedAnswers.join('、')}`
      : '不要與之前出過的謎底重複';
    const seed = ANSWER_SEEDS[Math.floor(Math.random() * ANSWER_SEEDS.length)];
    const reply = await this.llm.chat(
      [{ role: 'user', content: answerGeneratorPrompt(seed, usedHint) }],
      0.9,
      20,
    );
    return reply.trim();
  }

  private async fixQuestions(
    answer: string,
    qs: QuestionSet,
    badIndices: number[],
    reasons: Record<number, string[]>,
  ): Promise<QuestionSet> {
    const badDesc = badIndices
      .map((i) => {
        let line = `第 ${i + 1} 題：${qs.questions[i].question} → ${qs.questions[i].reply}`;
        if (reasons[i]) line += `  # 原因：${reasons[i].join('、')}`;
        return line;
      })
      .join('\n');
    const goodCount = qs.questions.length - badIndices.length;
    const goodDesc = qs.questions
      .map((q, i) => ({ q, i }))
      .filter(({ i }) => !badIndices.includes(i))
      .map(({ q, i }) => `第 ${i + 1} 題：${q.question} → ${q.reply}`)
      .join('\n');

    const prompt =
      `謎底是「${answer}」，已經有 ${goodCount} 題合格的題目：\n` +
      `${goodDesc}\n\n` +
      `以下 ${badIndices.length} 題需要重做：\n` +
      `${badDesc}\n\n` +
      `請重新產生這 ${badIndices.length} 題（問題從題庫選，回答根據謎底填入），` +
      `輸出 JSON 格式：\n` +
      `{"questions": [\n` +
      `  {"question": "...", "reply": "..."},\n` +
      `  ...\n` +
      `]}`;

    const raw = await this.jsonChat([{ role: 'user', content: prompt }]);
    const newQuestions: QuestionItem[] = raw.questions.map((q: { question: string; reply: string }) => ({
      question: q.question,
      reply: q.reply,
      isCustom: false,
    }));

    const merged: QuestionItem[] = [];
    let replaceIdx = 0;
    for (let i = 0; i < qs.questions.length; i++) {
      if (badIndices.includes(i)) {
        merged.push(newQuestions[replaceIdx]);
        replaceIdx++;
      } else {
        merged.push(qs.questions[i]);
      }
    }
    qs.questions = merged;
    this.postProcess(qs);
    return qs;
  }

  async generate(options: GenerateOptions = {}): Promise<QuestionSetWithMeta> {
    const {
      skipReview = false,
      skipSimulation = true,
      answerMode = 'ai',
      numQuestions = 10,
      usedAnswers = [],
    } = options;
    let answer = options.answer ?? '';

    if (answerMode === 'ai') {
      answer = await this.generateAnswer(usedAnswers);
    } else if (!answer) {
      throw new Error('answerMode 為 human 時必須提供謎底');
    }

    let retryCount = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      let questionSet: QuestionSet;
      try {
        questionSet = await this.designQuestions(answer, answerMode, numQuestions);
      } catch {
        continue;
      }

      for (let fixAttempt = 0; fixAttempt < 3; fixAttempt++) {
        this.postProcess(questionSet);

        const bad = new Set<number>();
        const replies = questionSet.questions.map((q) => q.reply);
        replies.forEach((r, i) => {
          if (replies.filter((x) => x === r).length > 1) bad.add(i);
        });
        questionSet.questions.forEach((q, i) => {
          if ([...answer].some((c) => q.reply.includes(c))) bad.add(i);
        });
        questionSet.questions.forEach((q, i) => {
          if (!q.reply.trim()) bad.add(i);
        });

        if (bad.size === 0) break;

        const sortedBad = [...bad].sort((a, b) => a - b);
        const reasonsDict: Record<number, string[]> = {};
        for (const i of sortedBad) {
          const r = questionSet.questions[i].reply;
          reasonsDict[i] = [];
          if (!r.trim()) reasonsDict[i].push('空回答');
          if (r.trim() && replies.filter((x) => x === r).length > 1) reasonsDict[i].push('回答重複');
          if ([...answer].some((c) => r.includes(c))) reasonsDict[i].push('洩漏謎底文字');
        }

        questionSet = await this.fixQuestions(answer, questionSet, sortedBad, reasonsDict);
      }

      let review: ReviewResult | null = null;
      if (!skipReview) {
        try {
          review = await this.reviewQuestions(questionSet);
        } catch {
          continue;
        }
        if (!review.passed) {
          retryCount++;
          continue;
        }
      }

      let simulation: SimulationResult | null = null;
      if (!skipSimulation) {
        try {
          simulation = await this.simulatePlayer(questionSet);
        } catch {
          simulation = null;
        }
      }

      return {
        answer: questionSet.answer,
        questions: questionSet.questions,
        review,
        simulation,
        retryCount,
      };
    }

    return {
      answer,
      questions: [{ question: '（生成失敗）', reply: '（生成失敗）', isCustom: false }],
      review: null,
      simulation: null,
      retryCount,
    };
  }

  private async inferCategory(answer: string): Promise<string> {
    const prompt = `請判斷"${answer}"最適合以下哪個類別，只輸出類別名稱：\n${Object.keys(CATEGORY_HINTS).join('、')}`;
    const reply = await this.llm.chat([{ role: 'user', content: prompt }], 0.3, 20);
    const category = reply.trim();
    return CATEGORY_HINTS[category] ?? `這與「${answer}」相關`;
  }

  private buildSimulationReason(
    rounds: SimulationRound[],
    guessRound: number,
    tooEasy: boolean,
    tooHard: boolean,
  ): string {
    if (tooEasy) {
      return `玩家在第 ${guessRound} 題就猜出，表示題目太過簡單。建議增加前面題目的難度。`;
    }
    if (tooHard) {
      return `玩家看完所有 ${rounds.length} 題仍未猜出，表示題目太難。建議增加更多提示性問題。`;
    }
    const inkOnCorrect = rounds
      .filter((r) => r.guessedCorrectly)
      .reduce((sum, r) => sum + r.inkRevealed.split(' ').length, 0);
    return `玩家在第 ${guessRound} 題猜出，難度適中。共使用 ${inkOnCorrect} 格注音，節奏良好。`;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npm test -- generator`
Expected: PASS, 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add web/src/generator/generator.ts web/src/generator/fakeBackend.ts web/src/generator/generator.test.ts
git commit -m "feat(web): port the three-stage generation pipeline (design/review/simulate) to TypeScript"
```

---

### Task 7: Port API key/backend/model settings persistence to `settings.ts`

**Files:**
- Create: `web/src/settings.ts`
- Test: `web/src/settings.test.ts`

**Interfaces:**
- Produces: `interface Settings { backend: 'groq' | 'hf'; apiKey: string; model: string }`, `loadSettings(): Settings | null`, `saveSettings(settings: Settings): void`, `clearSettings(): void` — consumed by `main.ts` (Task 9). Backed by `localStorage`, which is why Task 1 configured Vitest's `environment: 'jsdom'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, clearSettings } from './settings';

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadSettings()).toBeNull();
  });

  it('round-trips saved settings through localStorage', () => {
    saveSettings({ backend: 'groq', apiKey: 'gsk_abc', model: 'qwen/qwen3-32b' });
    expect(loadSettings()).toEqual({ backend: 'groq', apiKey: 'gsk_abc', model: 'qwen/qwen3-32b' });
  });

  it('returns null if the stored value is corrupted JSON', () => {
    localStorage.setItem('phantom-ink-settings', 'not json');
    expect(loadSettings()).toBeNull();
  });

  it('removes the stored settings on clearSettings', () => {
    saveSettings({ backend: 'hf', apiKey: 'hf_abc', model: '' });
    clearSettings();
    expect(loadSettings()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- settings`
Expected: FAIL with "Cannot find module './settings'".

- [ ] **Step 3: Write the implementation**

```typescript
// web/src/settings.ts

export interface Settings {
  backend: 'groq' | 'hf';
  apiKey: string;
  model: string;
}

const STORAGE_KEY = 'phantom-ink-settings';

export function loadSettings(): Settings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- settings`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/settings.ts web/src/settings.test.ts
git commit -m "feat(web): add localStorage-backed settings for API key/backend/model (BYOK)"
```

---

### Task 8: Port the Wordle-style game state machine to `game.ts`

**Files:**
- Create: `web/src/game.ts`
- Test: `web/src/game.test.ts`

**Interfaces:**
- Produces: `interface GameQuestion { question: string; cells: string[]; total: number }`, `class PhantomInkGame` (constructor `(questions: GameQuestion[], answer: string)`, methods `revealInk()`, `nextQuestion()`, `finishClues()`, `revealOracle(questionIndex: number)`, `submitAnswer(value: string): boolean`, readonly `state: GameState`), and `renderGame(container: HTMLElement, game: PhantomInkGame): void` — consumed by `main.ts` (Task 9).
- This task ports the state machine embedded in `game.py`'s `GAME_HTML_TEMPLATE` JS (lines 256–397 of `game.py`, the `state` object and the `window.revealInk` / `window.nextQuestion` / `window.finishClues` / `window.doOracleReveal` / `window.submitAnswer` functions) into a plain class with unit-testable methods, and the HTML/CSS rendering (`game.py` lines 132–254 for the `<style>` block, lines 411–567 for the `render()` function body) into a `renderGame()` function that reads `game.state`/`game.questions`/`game.answer` and wires DOM event listeners to call the class's methods followed by a re-render. The CSS block and the HTML string structure are carried over unchanged (same class names, same layout) — only the data source changes, from "Python f-string interpolation of a JSON blob at Colab-render time" to "TypeScript object properties read directly in the browser."

- [ ] **Step 1: Write the failing tests for the state machine (the DOM-rendering half is not unit tested — see Task 11 for the manual browser check)**

```typescript
// web/src/game.test.ts
import { describe, it, expect } from 'vitest';
import { PhantomInkGame, type GameQuestion } from './game';

function makeQuestions(): GameQuestion[] {
  return [
    { question: 'Q1', cells: ['ㄍ', 'ㄤ', 'ˉ'], total: 3 },
    { question: 'Q2', cells: ['ㄑ', 'ㄧ', 'ㄣ', 'ˊ'], total: 4 },
    { question: 'Q3', cells: ['ㄅ'], total: 1 },
    { question: 'Q4', cells: ['ㄆ'], total: 1 },
    { question: 'Q5', cells: ['ㄇ'], total: 1 },
  ];
}

describe('PhantomInkGame', () => {
  it('starts with nothing revealed and zero ink/guesses', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    expect(game.state.currentQ).toBe(0);
    expect(game.state.revealed).toEqual([0, 0, 0, 0, 0]);
    expect(game.state.ink).toBe(0);
    expect(game.state.guesses).toBe(0);
  });

  it('revealInk increments both the current question reveal count and ink', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealInk();
    expect(game.state.revealed[0]).toBe(1);
    expect(game.state.ink).toBe(1);
  });

  it('revealInk does nothing once the current question is fully revealed', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealInk();
    game.revealInk();
    game.revealInk(); // question 0 has 3 total cells, this 3rd call fills it
    game.revealInk(); // 4th call should be a no-op
    expect(game.state.revealed[0]).toBe(3);
    expect(game.state.ink).toBe(3);
  });

  it('nextQuestion advances currentQ and marks the previous question visited', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion();
    expect(game.state.currentQ).toBe(1);
    expect(game.state.visited).toEqual([0]);
  });

  it('grants an oracle charge on reaching question 5 (index 4) for the first time', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion(); // -> index 1
    game.nextQuestion(); // -> index 2
    game.nextQuestion(); // -> index 3
    expect(game.state.oracleCharges).toBe(0);
    game.nextQuestion(); // -> index 4, grants a charge
    expect(game.state.oracleCharges).toBe(1);
    game.nextQuestion(); // no further question, no extra charge
    expect(game.state.oracleCharges).toBe(1);
  });

  it('finishClues marks finalRevealed and grants an oracle charge once', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.finishClues();
    expect(game.state.finalRevealed).toBe(true);
    expect(game.state.oracleCharges).toBe(1);
    game.finishClues();
    expect(game.state.oracleCharges).toBe(1);
  });

  it('revealOracle reveals one extra cell on a past question without costing regular ink', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion();
    game.nextQuestion();
    game.nextQuestion();
    game.nextQuestion(); // reaches question index 4, oracleCharges = 1
    game.revealOracle(0);
    expect(game.state.revealed[0]).toBe(1);
    expect(game.state.oracleCharges).toBe(0);
    expect(game.state.oracleUsed).toBe(1);
  });

  it('revealOracle is a no-op with zero charges', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealOracle(0);
    expect(game.state.revealed[0]).toBe(0);
  });

  it('submitAnswer with the correct guess wins and ends the game', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('鋼琴');
    expect(correct).toBe(true);
    expect(game.state.won).toBe(true);
    expect(game.state.gameOver).toBe(true);
    expect(game.state.guesses).toBe(1);
  });

  it('submitAnswer with a wrong guess adds 3 ink and keeps playing', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('小提琴');
    expect(correct).toBe(false);
    expect(game.state.won).toBe(false);
    expect(game.state.gameOver).toBe(false);
    expect(game.state.ink).toBe(3);
    expect(game.state.guesses).toBe(1);
  });

  it('submitAnswer with a blank guess does nothing', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('   ');
    expect(correct).toBe(false);
    expect(game.state.guesses).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- game`
Expected: FAIL with "Cannot find module './game'".

- [ ] **Step 3: Write the state machine and the DOM renderer**

```typescript
// web/src/game.ts

export interface GameQuestion {
  question: string;
  cells: string[];
  total: number;
}

export interface GameState {
  currentQ: number;
  revealed: number[];
  visited: number[];
  ink: number;
  guesses: number;
  oracleCharges: number;
  oracleUsed: number;
  won: boolean;
  gameOver: boolean;
  finalRevealed: boolean;
  oracleCells: Record<number, number[]>;
}

export class PhantomInkGame {
  readonly questions: GameQuestion[];
  readonly answer: string;
  state: GameState;
  private oracleQ5Granted = false;
  private oracleFinalGranted = false;

  constructor(questions: GameQuestion[], answer: string) {
    this.questions = questions;
    this.answer = answer;
    this.state = {
      currentQ: 0,
      revealed: questions.map(() => 0),
      visited: [],
      ink: 0,
      guesses: 0,
      oracleCharges: 0,
      oracleUsed: 0,
      won: false,
      gameOver: false,
      finalRevealed: false,
      oracleCells: {},
    };
  }

  revealInk(): void {
    const s = this.state;
    if (s.gameOver || s.won) return;
    const total = this.questions[s.currentQ].total;
    if (s.revealed[s.currentQ] >= total) return;
    s.revealed[s.currentQ]++;
    s.ink++;
  }

  nextQuestion(): void {
    const s = this.state;
    if (s.gameOver) return;
    if (!s.visited.includes(s.currentQ)) s.visited.push(s.currentQ);
    if (s.currentQ + 1 < this.questions.length) {
      s.currentQ++;
      if (s.currentQ >= 4 && !this.oracleQ5Granted) {
        this.oracleQ5Granted = true;
        s.oracleCharges++;
      }
    }
  }

  finishClues(): void {
    const s = this.state;
    s.finalRevealed = true;
    if (!s.visited.includes(s.currentQ)) s.visited.push(s.currentQ);
    if (!this.oracleFinalGranted) {
      this.oracleFinalGranted = true;
      s.oracleCharges++;
    }
  }

  revealOracle(questionIndex: number): void {
    const s = this.state;
    if (s.oracleCharges <= 0) return;
    s.oracleCharges--;
    s.oracleUsed++;
    const pos = s.revealed[questionIndex];
    s.revealed[questionIndex] = Math.min(pos + 1, this.questions[questionIndex].total);
    if (!s.oracleCells[questionIndex]) s.oracleCells[questionIndex] = [];
    s.oracleCells[questionIndex].push(pos);
  }

  submitAnswer(value: string): boolean {
    const s = this.state;
    const val = value.trim();
    if (!val) return false;
    s.guesses++;
    const correct = val === this.answer;
    if (correct) {
      s.won = true;
      s.gameOver = true;
    } else {
      s.ink += 3;
    }
    return correct;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the current game state into `container` and wires up button
 * handlers. Ported from `game.py`'s `GAME_HTML_TEMPLATE` render() function
 * (game.py lines 411-567) — same markup and CSS classes, driven directly by
 * `game.state` instead of a Python-injected JSON blob.
 */
export function renderGame(container: HTMLElement, game: PhantomInkGame): void {
  const s = game.state;
  const cur = s.currentQ;
  const q = game.questions[cur];
  const r = s.revealed[cur];
  const allDone = r >= q.total;
  const isLast = cur === game.questions.length - 1;
  const canNext = !s.gameOver && !s.finalRevealed;
  const showFinish = isLast && canNext;

  let html = '<div class="pi-header">靈媒<small>Phantom Ink</small></div>';

  html += `<div class="pi-stats">
    <div class="pi-stat"><div class="pi-stat-icon">🖋</div><div class="pi-stat-val">${s.ink}</div><div class="pi-stat-lbl">墨水</div></div>
    <div class="pi-stat"><div class="pi-stat-icon">🎯</div><div class="pi-stat-val">${s.guesses}</div><div class="pi-stat-lbl">猜測</div></div>
    <div class="pi-stat"><div class="pi-stat-icon">👁</div><div class="pi-stat-val">${s.oracleCharges}</div><div class="pi-stat-lbl">天眼</div></div>
  </div>`;

  if (!s.gameOver) {
    html += `<div class="pi-q-card">
      <div class="pi-q-num">第 ${cur + 1} / ${game.questions.length} 題</div>
      <div class="pi-q-text">${escapeHtml(q.question)}</div>
      <div class="pi-tiles">`;
    for (let i = 0; i < r; i++) {
      const oracleCls = (s.oracleCells[cur] ?? []).includes(i) ? ' oracle' : '';
      html += `<div class="pi-tile revealed${oracleCls}">${q.cells[i]}</div>`;
    }
    html += '</div>';
    if (r > 0) html += `<div class="pi-ink-label">已揭露 ${r} 格 / 墨水 ${s.ink}</div>`;
    html += '</div>';
  }

  if (!s.gameOver) {
    const inkDisabled = allDone || s.finalRevealed ? 'disabled' : '';
    const nextDisabled = s.finalRevealed ? 'disabled' : '';
    const hasPast = cur > 0 && s.visited.length > 0;
    const oracleDisabled = s.oracleCharges <= 0 || !hasPast ? 'disabled' : '';
    html += `<div class="pi-btns">
      <div class="pi-btns-row"><button class="pi-btn pi-btn-ink" data-action="reveal-ink" ${inkDisabled}>🖋 顯示墨水</button></div>
      <div class="pi-btns-row">`;
    if (showFinish) html += '<button class="pi-btn pi-btn-finish" data-action="finish-clues">📜 完成線索</button>';
    if (!isLast && !s.finalRevealed) {
      html += `<button class="pi-btn pi-btn-next" data-action="next-question" ${nextDisabled}>➡ 下一題</button>`;
    }
    html += `<button class="pi-btn pi-btn-answer" data-action="show-answer">🎯 提交謎底</button>
      <button class="pi-btn pi-btn-oracle" data-action="open-oracle" ${oracleDisabled}>👁 老天有眼</button>
    </div></div>`;
  }

  if (!s.gameOver) {
    html += `<div class="pi-answer-box" id="pi-answer-box">
      <input id="pi-input" placeholder="輸入謎底…">
      <div class="pi-answer-actions">
        <button class="pi-btn pi-btn-answer" data-action="submit-answer">送出</button>
      </div>
    </div>`;
  }

  if (s.gameOver) {
    html += `<div class="pi-result">
      <div class="pi-result-icon">${s.won ? '🎉' : '😢'}</div>
      <div class="pi-result-title">${s.won ? '猜對了！' : '遊戲結束'}</div>
      <div class="pi-result-answer">謎底：<strong>${escapeHtml(game.answer)}</strong></div>
      <button class="pi-restart" data-action="restart">再來一題</button>
    </div>`;
  }

  container.innerHTML = html;

  container.querySelector('[data-action="reveal-ink"]')?.addEventListener('click', () => {
    game.revealInk();
    renderGame(container, game);
  });
  container.querySelector('[data-action="next-question"]')?.addEventListener('click', () => {
    game.nextQuestion();
    renderGame(container, game);
  });
  container.querySelector('[data-action="finish-clues"]')?.addEventListener('click', () => {
    game.finishClues();
    renderGame(container, game);
  });
  container.querySelector('[data-action="show-answer"]')?.addEventListener('click', () => {
    const box = container.querySelector<HTMLElement>('#pi-answer-box');
    box?.classList.add('open');
    container.querySelector<HTMLInputElement>('#pi-input')?.focus();
  });
  container.querySelector('[data-action="submit-answer"]')?.addEventListener('click', () => {
    const input = container.querySelector<HTMLInputElement>('#pi-input');
    if (!input) return;
    game.submitAnswer(input.value);
    renderGame(container, game);
  });
  container.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
    window.location.reload();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- game`
Expected: PASS, 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/game.ts web/src/game.test.ts
git commit -m "feat(web): port Wordle-style game state machine and DOM renderer to TypeScript"
```

---

### Task 9: Wire everything together in `main.ts`

**Files:**
- Modify: `web/src/main.ts`
- Test: `web/src/main.test.ts`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings` (Task 7), `GroqBackend`/`GROQ_DEFAULT_MODEL`, `HFBackend`/`HF_DEFAULT_MODEL` (Task 5), `PhantomInkGenerator` (Task 6), `toBopomofoCells` (Task 3), `PhantomInkGame`/`renderGame`/`GameQuestion` (Task 8).
- Produces: `toGameQuestions` and `describeGenerationError` pure functions (both unit tested) plus DOM wiring for the settings screen and game screen (not unit tested here — covered by the manual check in Task 11).

- [ ] **Step 1: Write the failing test for the one pure, testable piece of `main.ts`**

```typescript
// web/src/main.test.ts
import { describe, it, expect } from 'vitest';
import { toGameQuestions, describeGenerationError } from './main';

describe('toGameQuestions', () => {
  it('converts generator output into cell data the game understands, with a trailing period cell', () => {
    const result = toGameQuestions([{ question: '它是何種顏色？', reply: '通常是黑色或白色。' }]);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('它是何種顏色？');
    expect(result[0].cells[result[0].cells.length - 1]).toBe('。');
    expect(result[0].total).toBe(result[0].cells.length);
  });

  it('does not add a period cell when the reply has none', () => {
    const result = toGameQuestions([{ question: 'Q', reply: '沒有句號' }]);
    expect(result[0].cells[result[0].cells.length - 1]).not.toBe('。');
  });
});

describe('describeGenerationError', () => {
  it('shows a CORS-specific fallback message for a generic fetch TypeError', () => {
    // Browsers deliberately hide the real reason a fetch was blocked by CORS from
    // JavaScript — it always surfaces as a bare TypeError with a message like
    // "Failed to fetch" (Chrome) or "NetworkError when attempting to fetch resource." (Firefox).
    const err = new TypeError('Failed to fetch');
    expect(describeGenerationError(err)).toContain('無法直接連線');
  });

  it('passes through a normal Error message unchanged', () => {
    const err = new Error('Groq API error (401): invalid key');
    expect(describeGenerationError(err)).toBe('Groq API error (401): invalid key');
  });

  it('stringifies a non-Error throw value', () => {
    expect(describeGenerationError('boom')).toBe('boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- main`
Expected: FAIL — `toGameQuestions` is not exported yet (current `main.ts` is just the Task 1 placeholder).

- [ ] **Step 3: Write the full `main.ts`**

```typescript
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
```

Note on the last `if` block: it guards the auto-run `main()` call so that importing `main.ts` from `main.test.ts` (to test `toGameQuestions`) doesn't crash in a test environment where `#app` isn't present in the DOM — this is standard practice for Vite entry points that are also unit-tested.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- main`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Run the full test suite and the build**

Run: `cd web && npm test`
Expected: all test files pass (bopomofo, zhconv, prompts, shared, groq, hf, generator, settings, game, main).

Run: `cd web && npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/main.ts web/src/main.test.ts
git commit -m "feat(web): wire settings, generator, and game screens together in main.ts"
```

---

### Task 10: Firebase Hosting deploy configuration and local verification

**Files:**
- Modify: `web/firebase.json` (already created in Task 1 — verify it's correct, no changes expected)
- Modify: `web/.firebaserc` (fill in the real project ID)

**Interfaces:**
- Produces: a deployable `web/dist/` directory and a working `firebase.json`/`​.firebaserc` pair, ready for `firebase deploy`.

- [ ] **Step 1: Build the production bundle**

Run: `cd web && npm run build`
Expected: `web/dist/index.html` and `web/dist/assets/*.js` exist.

- [ ] **Step 2: Log in to Firebase (interactive — opens a browser)**

Run: `npx firebase-tools login`
Expected: opens a browser window for Google account authentication; CLI prints "✔ Success! Logged in as <email>" on completion.

- [ ] **Step 3: Create or select a Firebase project**

If you don't already have a Firebase project for this app, create one at https://console.firebase.google.com (free Spark plan is enough — no billing account needed, since this app makes no Cloud Functions calls). Note the project ID shown in the console.

- [ ] **Step 4: Point `.firebaserc` at the real project**

Run: `cd web && npx firebase-tools use --add`
Follow the prompt to select your project and give it the alias `default`. This overwrites the `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` placeholder in `web/.firebaserc` with your actual project ID.

- [ ] **Step 5: Serve the build locally through the Firebase emulator to sanity-check `firebase.json` before deploying**

Run: `cd web && npx firebase-tools emulators:start --only hosting`
Expected: prints a local URL (e.g. `http://127.0.0.1:5000`). Open it in a browser — the settings screen should appear (since no `localStorage` settings exist yet in a fresh browser profile).

- [ ] **Step 6: Commit the filled-in `.firebaserc`**

```bash
git add web/.firebaserc
git commit -m "chore(web): point .firebaserc at the real Firebase project"
```

---

### Task 11: Manual end-to-end verification with a real API key

This task cannot be automated — it needs a real, live Groq or HF API key, which is exactly the situation the design's BYOK architecture puts every player in. This is also the only remaining check for the design's one open risk (CORS), which live `curl` testing already de-risked at the HTTP level (Task 5's docstring) — this task confirms the full browser flow works end-to-end, key entry included.

**Files:** none — this is a checklist, not a code change.

- [ ] **Step 1: Get a free API key**

Groq: sign up at https://console.groq.com/keys and create a key (starts with `gsk_`).

- [ ] **Step 2: Run the local dev server**

Run: `cd web && npm run dev`
Expected: prints a local URL (e.g. `http://localhost:5173`).

- [ ] **Step 3: Walk through the settings screen**

Open the URL in a browser. Confirm the settings screen appears with Backend/API Key/Model fields and the privacy note about the key staying local. Select "Groq", paste the key, leave Model blank, click "開始遊戲".

- [ ] **Step 4: Confirm generation completes with no CORS error**

Expected: the "🎲 正在生成題目..." loading message appears, then (after a few seconds, since three LLM calls happen in sequence: design → review → simulate is skipped by default so just design + review) the Wordle-style game screen renders with a real question. Open the browser DevTools Network tab — confirm the requests to `api.groq.com` return `200`, not blocked by CORS (a CORS failure shows as a red network error with "blocked by CORS policy" in the console, not a normal HTTP status).

- [ ] **Step 5: Play through one full round**

Click "🖋 顯示墨水" a few times, click "➡ 下一題", then click "🎯 提交謎底" and submit a wrong guess (confirm ink goes up by 3) followed by the real answer (confirm the win screen appears with "🎉" and the correct answer shown).

- [ ] **Step 6: Reload the page and confirm settings persisted**

Reload the browser tab. Expected: the settings screen is skipped entirely and a new game starts generating immediately, proving `localStorage` round-tripped the API key correctly.

- [ ] **Step 7: Deploy for real**

Run: `cd web && npm run build && npx firebase-tools deploy --only hosting`
Expected: prints a `https://<project-id>.web.app` (or `.firebaseapp.com`) URL. Repeat Steps 3–6 against that live URL instead of localhost to confirm production hosting behaves identically to the dev server.

---

## Post-implementation note (not a task — informational)

While verifying library behavior for Task 3, we discovered the existing `test_bopomofo.py::test_to_bopomofo_cells_count` in the Python codebase is already failing against the current `bopomofo.py` (expects 6 cells for "鋼琴", gets 7). This is unrelated to the Firebase port and out of scope for this plan, but worth mentioning to whoever owns the Python side — it's a one-line fix (either the test's expected count, or the docstring comment above it, is wrong) whenever someone next touches that file.
