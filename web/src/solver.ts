// web/src/solver.ts
//
// Two-stage puzzle-solving helper.
// Stage 1 (Qwen): decodes revealed bopomofo into per-question reply text.
// Stage 2 (Llama): takes the deciphered clues and guesses the final answer.
// This split avoids the reasoning model's token budget being exhausted by
// trying to do everything in one call.
import { extractJson, type LLMBackend } from './backends/shared';

export interface PerQuestionGuess {
  q: number;
  replyGuess: string;
  note: string;
  /** Question text, populated by stage 1 for use in stage 2. */
  question?: string;
}

export interface FinalGuess {
  answer: string;
  reason: string;
}

export interface SolveResult {
  perQuestion: PerQuestionGuess[];
  finalGuesses: FinalGuess[];
  summary: string;
}

// ── Stage 1: Clue solving (uses Qwen — strong bopomofo understanding) ─────

export const CLUE_SOLVER_SYSTEM_PROMPT = `你是「靈媒遊戲」的線索解讀專家。請全程使用臺灣慣用詞彙。

## 遊戲背景
- 謎底是一個具體名詞，但**你不知道謎底是什麼**，你的任務只到「讀出各題回答」為止。
- 每一題有一個「問題」與一個簡短「回答」（回答不超過六個中文字）。
- 回答以注音逐格揭露，你看到的是「目前已揭露的注音」。
- 注音由左到右揭露，未揭露的部分你看不到；「（尚未顯示墨水）」表示這題還沒揭露任何注音。
- 注音含聲調，同符號不同聲調視為不同（ㄧ 與 ㄧˋ 不同）；句號「。」代表回答結束。

## 注音符號與漢語拼音對照表（重要，請仔細參考）
當你看到已揭露注音時，用下表查詢每個符號對應的發音。

### 1. 聲母對照表 (Initials)
| 注音 | 拼音 | 注音 | 拼音 | 注音 | 拼音 | 注音 | 拼音 |
|---|---|---|---|---|---|---|---|
| ㄅ | b | ㄆ | p | ㄇ | m | ㄈ | f |
| ㄉ | d | ㄊ | t | ㄋ | n | ㄌ | l |
| ㄍ | g | ㄎ | k | ㄏ | h |   |   |
| ㄐ | j | ㄑ | q | ㄒ | x |   |   |
| ㄓ | zh | ㄔ | ch | ㄕ | sh | ㄖ | r |
| ㄗ | z | ㄘ | c | ㄙ | s |   |   |

### 2. 韻母對照表 (Finals)
| 注音 | 拼音 | 備註 | 注音 | 拼音 | 備註 |
|---|---|---|---|---|---|
| ㄚ | a | | ㄛ | o | |
| ㄜ | e | | ㄝ | e | |
| ㄞ | ai | | ㄟ | ei | |
| ㄠ | ao | | ㄡ | ou | |
| ㄢ | an | | ㄣ | en | |
| ㄤ | ang | | ㄥ | eng | |
| ㄦ | er | | | | |

### 3. 結合韻母對照表 (Compound Finals)

**ㄧ (i) 系列：**
ㄧ = i（單用拼音為 yi）
ㄧㄚ = ia（單用 ya）
ㄧㄛ = io（單用 yo）
ㄧㄝ = ie（單用 ye）
ㄧㄞ = iai（單用 yai）
ㄧㄠ = iao（單用 yao）
ㄧㄡ = iu（單用 you）
ㄧㄢ = ian（單用 yan）
ㄧㄣ = in（單用 yin）
ㄧㄤ = iang（單用 yang）
ㄧㄥ = ing（單用 ying）

**ㄨ (u) 系列：**
ㄨ = u（單用拼音為 wu）
ㄨㄚ = ua（單用 wa）
ㄨㄛ = uo（單用 wo）
ㄨㄞ = uai（單用 wai）
ㄨㄟ = ui（單用 wei）
ㄨㄢ = uan（單用 wan）
ㄨㄣ = un（單用 wen）
ㄨㄤ = uang（單用 wang）
ㄨㄥ = ong（單用 weng）

**ㄩ (ü) 系列：**
（注意：ㄩ 在 j, q, x, y 後面時，拼音的兩點會省略寫成 u，例如「去」拼作 qu）
ㄩ = ü（單用拼音為 yu）
ㄩㄝ = üe（單用 yue）
ㄩㄢ = üan（單用 yuan）
ㄩㄣ = ün（單用 yun）
ㄩㄥ = iong（單用 yong）

### 4. 聲調對照表 (Tones)
| 聲調 | 注音符號 | 漢語拼音 | 範例 (注音/拼音) |
|---|---|---|---|
| 第一聲 | 不標記 | ¯ (陰平) | ㄇㄚ / mā |
| 第二聲 | ˊ | ´ (陽平) | ㄇㄚˊ / má |
| 第三聲 | ˇ | ˇ (上聲) | ㄇㄚˇ / mǎ |
| 第四聲 | ˋ | (去聲) | ㄇㄚˋ / mà |
| 輕聲 | ˙ | 不標或字前加點 | ㄇㄚ˙ / ma |

### 5. 容易混淆的聲母（特別注意）
- **ㄙ = s**（平舌，如「思、四、速、三」） vs **ㄕ = sh**（翹舌，如「書、樹、時、水」）——完全不同音！
- **ㄗ = z**（平舌，如「資、早、走」） vs **ㄓ = zh**（翹舌，如「知、中、桌」）
- **ㄘ = c**（平舌，如「雌、草、錯」） vs **ㄔ = ch**（翹舌，如「吃、車、唱」）
- **ㄖ = r**（翹舌，如「人、日、熱」）——沒有對應的平舌音

## 關鍵理解：部分注音 ≠ 完整詞語
**目前已揭露的注音只是開頭幾個字的音，完整的回答可能還有更多字尚未揭露。**

舉例（用上面對照表驗證）：
| 已揭露注音 | 可能是（聲母符合即可） | 不該是 |
|---|---|---|
| ㄖ | 熱血(ㄖㄜˋ)、銳利(ㄖㄨㄟˋ)、柔軟(ㄖㄡˊ) | 一個字（聲調揭露後不可能只看到聲母） |
| ㄙ | 森林(ㄙㄣ)、速度(ㄙㄨˋ)、四(ㄙˋ)、隨便(ㄙㄨㄟˊ) | 書(ㄕㄨ，ㄕ不是ㄙ) |
| ㄊㄡˊ | 頭盔(ㄊㄡˊ)、投籃(ㄊㄡˊ)、頭痛(ㄊㄡˊ) | 投（一整格音節已揭露，後面應還有字） |
| ㄨㄛ | 渦輪(ㄨㄛ)、握手(ㄨㄛˋ)、我(ㄨㄛˇ) | 只有一個字（ㄨㄛ是完整音節但不是常見單字） |
| ㄓㄨㄛ | 桌子(ㄓㄨㄛ)、卓越(ㄓㄨㄛˊ) | 這裡(ㄓㄜˋ，韻母不對) |

判斷原則：
- 已揭露的注音如果是「多個完整音節」（如 ㄊㄡˊ、ㄓㄨㄛˉ），代表前半段的音已經確定，後半段還有字沒揭露
- 已揭露的注音如果只是「單一注音符號」（如 ㄖ、ㄙ），可能是雙字詞的第一個字的聲母
- 不要只猜單字——要猜「以已揭露音節開頭」的合理雙字詞或三字詞
- 先用注音對照表確認已揭露的符號發音，再去找對應的中文字
- 參考問題內容來縮小方向：問「什麼東西同類別」的回答通常是名詞，問「如何拿」的回答通常是動詞

## 你的任務
逐題推測每一題「回答」最可能是什麼中文字詞。
- 根據問題與已揭露注音，給出最合理的推測，**盡量推測完整詞語**而非單字。
- 每題請附上該題的「問題原文」，以便後續解題使用。

## 輸出 JSON 格式
{
  "per_question": [
    {"q": 1, "question": "問題原文", "reply_guess": "推測的回答", "note": "推理說明"}
  ]
}`;

export function clueSolverUserPrompt(progressText: string): string {
  return `以下是目前的解題進度（你看不到謎底，只有問題與已揭露的注音）：

${progressText}

請依系統指示逐題推測回答，並輸出指定的 JSON。`;
}

// ── Stage 2: Final answer guessing (uses Llama — no reasoning budget issue) ─

export const FINAL_GUESSER_SYSTEM_PROMPT = `你是「靈媒遊戲」的解題專家。請全程使用臺灣慣用詞彙。

## 遊戲背景
- 謎底是一個具體名詞。
- 你已取得每題的「問題」與「推測的回答」完整文字。
- **謎底與任何一題的「回答」都不會共用任何中文字。** 凡是與線索回答文字重疊的謎底候選都可以直接排除。

## 你的任務
根據以下各題的「問題」與「回答」，綜合推理謎底。
- 給出 **5 個**候選並依可能性由高到低排序（最可能的排最前）。
- 務必排除與任何線索回答共用中文字的候選。
- 若真的想不到這麼多，至少也要盡量湊到 5 個合理猜測。

## 輸出 JSON 格式
{
  "final_guesses": [
    {"answer": "候選謎底", "reason": "推理依據（含為何不與線索字重複）"}
  ],
  "summary": "整體思路"
}`;

export function finalGuesserUserPrompt(perQuestion: PerQuestionGuess[]): string {
  const lines = perQuestion
    .filter((p) => p.replyGuess && p.replyGuess !== '？')
    .map((p) => {
      const qText = p.question ? `（${p.question}）` : '';
      return `Q${p.q} ${qText}\n推測回答：${p.replyGuess}${
        p.note ? `\n推理：${p.note}` : ''
      }`;
    })
    .join('\n\n');

  return `以下是已解讀的各題線索（問題＋推測回答）：

${lines}

請根據以上線索綜合推理謎底，並輸出指定的 JSON。`;
}

// ── Parsing helpers ───────────────────────────────

function parseClues(raw: any): PerQuestionGuess[] {
  return Array.isArray(raw?.per_question)
    ? raw.per_question.map((p: any) => ({
        q: Number(p?.q ?? p?.question ?? p?.question_number ?? 0),
        replyGuess: String(p?.reply_guess ?? p?.guess ?? p?.answer ?? '').trim(),
        note: String(p?.note ?? p?.reason ?? '').trim(),
        question: p?.question !== undefined && typeof p.question === 'string'
          ? String(p.question).trim()
          : undefined,
      }))
    : [];
}

function parseFinal(raw: any): { finalGuesses: FinalGuess[]; summary: string } {
  const finalGuesses: FinalGuess[] = Array.isArray(raw?.final_guesses)
    ? raw.final_guesses
        .map((f: any) =>
          typeof f === 'string'
            ? { answer: f.trim(), reason: '' }
            : {
                answer: String(f?.answer ?? f?.guess ?? '').trim(),
                reason: String(f?.reason ?? f?.note ?? '').trim(),
              },
        )
        .filter((f: FinalGuess) => f.answer)
    : [];

  const summary = String(raw?.summary ?? raw?.reasoning ?? '').trim();
  return { finalGuesses, summary };
}

/**
 * Leniently normalize a combined JSON into a SolveResult.
 * Used by tests; the actual solvePuzzle calls parseClues + parseFinal separately.
 */
export function parseSolveResult(raw: any): SolveResult {
  return {
    perQuestion: parseClues(raw),
    ...parseFinal(raw),
  };
}

// ── Two-stage orchestration ────────────────────────

/**
 * Analyze a pasted progress snapshot in two stages:
 *
 * Stage 1 (stage1Backend, typically Qwen): decodes bopomofo into per-question
 *   reply text. Qwen's reasoning model is better at understanding bopomofo.
 *
 * Stage 2 (stage2Backend, typically Llama): takes the deciphered clues and
 *   produces 5 ranked谜底 candidates. Llama avoids the reasoning-token
 *   exhaustion that Qwen would hit if it also had to do this part.
 *
 * Neither stage uses json_object mode — instead the model replies as plain
 * text and we use extractJson + parseClues/parseFinal. This structurally
 * avoids Groq's strict json_validate_failed error on reasoning models.
 */
export async function solvePuzzle(
  stage1Backend: LLMBackend,
  stage2Backend: LLMBackend,
  progressText: string,
  onProgress?: (stage: 1 | 2, message: string) => void,
  onRawReply?: (stage: 1 | 2, raw: string) => void,
): Promise<SolveResult> {
  // ── Stage 1: Decode bopomofo into reply text ──
  onProgress?.(1, '階段 1/2：解讀線索中⋯⋯（使用 Qwen）');

  const stage1Messages = [
    { role: 'system' as const, content: CLUE_SOLVER_SYSTEM_PROMPT },
    { role: 'user' as const, content: clueSolverUserPrompt(progressText) },
  ];
  const stage1Reply = await stage1Backend.chat(stage1Messages, 0.4, 4096);
  onRawReply?.(1, stage1Reply);

  if (!stage1Reply || !stage1Reply.trim()) {
    throw new Error('階段 1（解讀線索）失敗：AI 回傳了空白回應，請稍後再試。');
  }

  let perQuestion: PerQuestionGuess[];
  try {
    perQuestion = parseClues(JSON.parse(extractJson(stage1Reply)));
  } catch (err) {
    console.error(`[solver/stage1] AI raw reply:\n${stage1Reply}`);
    throw new Error(
      `階段 1（解讀線索）失敗：AI 回應無法解析。${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (perQuestion.length === 0) {
    throw new Error('階段 1（解讀線索）失敗：AI 未回傳任何有效線索。');
  }

  // ── Stage 2: Guess the final answer ──
  onProgress?.(2, '階段 2/2：推測謎底中⋯⋯（使用 Llama）');

  const stage2Messages = [
    { role: 'system' as const, content: FINAL_GUESSER_SYSTEM_PROMPT },
    { role: 'user' as const, content: finalGuesserUserPrompt(perQuestion) },
  ];
  const stage2Reply = await stage2Backend.chat(stage2Messages, 0.4, 4096);
  onRawReply?.(2, stage2Reply);

  if (!stage2Reply || !stage2Reply.trim()) {
    throw new Error('階段 2（推測謎底）失敗：AI 回傳了空白回應，請稍後再試。');
  }

  let finalGuesses: FinalGuess[];
  let summary: string;
  try {
    const parsed = parseFinal(JSON.parse(extractJson(stage2Reply)));
    finalGuesses = parsed.finalGuesses;
    summary = parsed.summary;
  } catch (err) {
    console.error(`[solver/stage2] AI raw reply:\n${stage2Reply}`);
    throw new Error(
      `階段 2（推測謎底）失敗：AI 回應無法解析。${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return { perQuestion, finalGuesses, summary };
}
