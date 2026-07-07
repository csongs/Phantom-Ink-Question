# 首頁題目設定 (Question Setup) — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan

## Overview

Add a "題目設定" section to the web settings screen letting the player control
how questions are chosen before a game is generated. Today the pipeline shows
the AI a fixed random sample of 30 bank questions and asks it to pick 10
(`numQuestions` is hardcoded to `10` in `startGame`). This feature exposes four
controls on the homepage and wires them through the generator.

The four controls:

1. **選題數量 (N)** — size of the candidate pool shown to the AI.
2. **使用題的數量 (M)** — number of questions in the final game.
3. **從題庫挑題** — hand-pick specific `QUESTION_BANK` questions (checkboxes),
   which are *forced* into the final game.
4. **自訂問題** — user-authored questions (one or many), also *forced* into the
   final game, with replies filled by the AI.

## Terminology

- **N** = 選題數量 = candidate pool shown to the AI.
- **M** = 使用題的數量 = questions in the final game.
- **X** = number of checked bank questions (forced).
- **C** = number of custom questions (forced).
- **forced** = X + C — questions guaranteed to appear in the final game.

## Validation rules (authoritative)

These hold on the settings screen (live) and are the contract the generator
relies on:

1. `M > X + C` — the used count must strictly exceed all forced questions, so
   the AI always picks at least one question of its own.
2. `N > M` — the candidate pool must be strictly larger than the used count, so
   the AI has real choice.
3. `N <= QUESTION_BANK.length + C` — cannot show more candidates than exist
   (112 bank questions + the C custom ones).
4. Every checked bank question must be an exact string present in
   `QUESTION_BANK`; every custom question must be non-empty after trimming.

When any rule is violated, the settings screen shows an inline message and
disables the 開始遊戲 button.

Defaults: `N = 30`, `M = 10`, no checked questions, no custom questions — i.e.
identical behavior to today.

## Data model

Extend the persisted `Settings` interface (`web/src/settings.ts`), stored in
localStorage exactly like existing fields:

```ts
interface Settings {
  // ...existing: backend, apiKey, model, answerMode, humanAnswer...
  numCandidates?: number;         // N — pool shown to AI (default 30)
  numQuestions?: number;          // M — final used in game (default 10)
  pickedBankQuestions?: string[]; // exact QUESTION_BANK strings, forced
  customQuestions?: string[];     // user-authored, forced, AI fills replies
}
```

All four persist ("都持久化"). `numQuestions` replaces the hardcoded `10` in
`startGame`.

## Settings-screen UI

A new "題目設定" section, added below the existing 謎底來源 group:

```
┌─ 題目設定 ───────────────────────────────┐
│ 選題數量 (給AI挑的候選池)   [ 30 ]        │
│ 使用題數量 (遊戲最終題數)   [ 10 ]        │
│                                          │
│ 從題庫挑題 (勾選=強制使用)  ▼ 已選 3      │
│  ┌ [🔍 搜尋...]                    ┐     │
│  │ ☑ 它由什麼材料製成？            │     │
│  │ ☐ 它是何種顏色？                │  ↕  │
│  │ ☑ 哪個節日與它相關性最高？      │     │
│  │ ... (scrollable, all 112)      │     │
│  └────────────────────────────────┘     │
│                                          │
│ 自訂問題 (強制使用，AI填答案)            │
│  [它最適合配什麼飲料？        ] [✕]      │
│  [＋ 新增自訂問題]                       │
│                                          │
│ ⚠ 使用題數量須 > 勾選(3)+自訂(1)=4       │
└──────────────────────────────────────────┘
```

- **N, M**: number inputs.
- **Bank picker**: a collapsible, scrollable checklist of all 112 questions
  with a search box that filters by substring. A header shows the checked count
  ("已選 N"). No extra libraries.
- **Custom questions**: add/remove rows; empty rows are ignored on save.
- **Live validation**: an inline warning line reflects the current rule
  violation (if any); the 開始遊戲 button is disabled while invalid.

The validation lives in a **pure function** (see below) so both the UI and tests
call the same logic.

## Generator changes

`web/src/generator/`:

- `GenerateOptions` gains `numCandidates?: number`, `pickedBankQuestions?:
  string[]`, `customQuestions?: string[]`.
- `formatDesignerPrompt(answer, opts)` changes so the designer prompt:
  - builds the candidate pool = **forced questions (X checked + C custom)** +
    random fill drawn from the remaining bank questions, up to total size **N**;
  - instructs the AI that the forced questions **must all be used** and their
    replies filled, then it picks **(M − forced)** more from the pool, for **M**
    total.
- `designQuestions` passes the new options through.
- In `generate()`'s existing per-question fix loop, add a defect check: **any
  forced question missing from the AI's output** is treated like other defects
  and regenerated via the existing retry machinery. Custom questions are marked
  `isCustom: true` (checked bank questions are not custom).

Deterministic guarantee: forced questions appearing in the output is verified in
code, not left to the model's goodwill — a missing forced question fails the
check and retries.

## Components & boundaries

- **`settings.ts`** — types + localStorage round-trip (unchanged shape, new
  optional fields). One new pure exported function
  `validateQuestionSetup({ numCandidates, numQuestions, pickedBankQuestions,
  customQuestions })` returning `{ ok: boolean; message?: string }`. No DOM.
- **`main.ts`** — renders the new section, wires inputs, calls
  `validateQuestionSetup` live, passes fields into `startGame` →
  `generator.generate`.
- **`prompts.ts`** — `formatDesignerPrompt` gains pool/forced construction. Pure.
- **`generator.ts`** — options plumbing + forced-present defect check.

## Testing

- `settings.test.ts`: persistence round-trip of the four new fields;
  `validateQuestionSetup` covering each rule (`M > X+C`, `N > M`,
  `N ≤ 112+C`, invalid bank string, empty custom) — pass and fail cases.
- `prompts.test.ts`: `formatDesignerPrompt` includes all forced questions in the
  prompt and sizes the pool to N; forced list surfaced to the model.
- `generator.test.ts`: forced questions guaranteed present in the returned set;
  an AI output that omits a forced question triggers the fix path; custom
  questions come back `isCustom: true`.

## Out of scope (YAGNI)

- Categorizing the 112 bank questions (no category metadata today).
- Editing/persisting reply text for custom questions by hand (AI fills them).
- Changing the Python (`prompts.py` / `generator.py`) path — this feature is
  web-only, matching where the settings screen lives.
