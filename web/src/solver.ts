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

## 最高原則

你的目標不是「還原回答」，而是「利用問題＋已揭露注音，推測最有助於後續猜出謎底的回答」。

請優先選擇：
1. 最符合問題語意的回答（這是最重要的）
2. 最符合目前已揭露注音
3. 最可能作為靈媒遊戲線索的短語
4. 能與其他題線索形成一致推論的回答

回答不必完全還原原始文字，只要能合理代表該線索即可。

## 注音解讀規則（輔助用）

### 容易搞混的聲母（嚴格遵守）
- **ㄙ = s**（平舌，如「思、四、速」），**不是 ㄕ(sh)**！書/樹/時/水都是ㄕ不是ㄙ。
- **ㄗ = z（資）≠ ㄓ = zh（知）**，**ㄘ = c（雌）≠ ㄔ = ch（吃）**

### 注音發音速查
聲母：ㄅ=b ㄆ=p ㄇ=m ㄈ=f ㄉ=d ㄊ=t ㄋ=n ㄌ=l ㄍ=g ㄎ=k ㄏ=h
　　　ㄐ=j ㄑ=q ㄒ=x ㄓ=zh ㄔ=ch ㄕ=sh ㄖ=r ㄗ=z ㄘ=c ㄙ=s
韻母：ㄚ=a ㄛ=o ㄜ=e ㄝ=ê ㄞ=ai ㄟ=ei ㄠ=ao ㄡ=ou
　　　ㄢ=an ㄣ=en ㄤ=ang ㄥ=eng ㄦ=er
結合韻：ㄧ=y/i  ㄨ=w/u  ㄩ=yü/ü
聲調：ˉ(1) ˊ(2) ˇ(3) ˋ(4) ˙(輕聲)

### 注音僅供排除用
注音只能用來排除不符的候選，不應凌駕於問題語意。
符合問題語意，比符合冷門詞更重要。

## 遊戲背景
- 謎底是一個具體名詞，但**你不知道謎底是什麼**。
- 回答以注音揭露，你看到的是「目前已揭露的注音」，未揭露部分看不到。
- 已揭露注音只是開頭，完整的回答可能是雙字詞或三字詞。
- 注音含聲調，同符號不同聲調視為不同；句號「。」代表回答結束。

## 機率思考（重要）
若同一段注音可能對應多個詞，請依以下優先順序判斷：

1. **是否符合問題語意**（例如問「摸起來如何」→ 柔軟/粗糙，不會是熱血）
2. **是否符合常見生活用語**（優先選一般人會說的詞）
3. **是否能與其他線索共同指向同一個謎底**（整體一致性）
4. **是否符合目前已揭露注音**（用來排除，不是用來決定）

選擇整體機率最高的回答，而不是列舉所有可能。

## 舉例

**例 1：問題語意優先於注音**
Q：它摸起來如何？
注音：ㄖ
→ 柔軟（不是熱血，雖然熱也符合ㄖ，但問題在問觸感）

**例 2：先看問題再對注音**
Q：它由什麼做成？
注音：ㄅ
→ 玻璃 / 布料（不是冰/爸爸，那些不符合「材料」語意）

**例 3：整體線索一致性**
Q：它存放在哪？
注音：ㄐ
若其他題都指向實驗用品 → 架子（不是教室/監獄）

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
  // Stage 1 uses text mode (no json_object, no reasoning_format). Qwen3-32B
  // outputs reasoning text followed by JSON in the content. extractJson pulls
  // the JSON out, structurally avoiding Groq's strict json_validate_failed.
  // maxTokens=4096 gives enough room for thinking (~3k) + JSON (~1k).
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
