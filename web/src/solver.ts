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

export const CLUE_SOLVER_SYSTEM_PROMPT = `你是靈媒遊戲的線索解讀專家。目標是根據問題與已揭露注音推測各題回答，最終幫助猜出謎底。

## 核心規則

1. **先掃全部，再回頭。** 逐題快速看過，資訊不足先標「暫定」，不要卡在單一題反覆思考。每題最多 3 個候選，選最高機率者。
2. **注音是前綴過濾器。** 只驗證已揭露音節是否與候選前幾字一致，未揭露部分不需驗證。例如 ㄊㄡˊ 可對應「投擲」「頭痛」，不需後續音節已出現。
3. **注音不符就排除。** 語意再合理但第一音節就不符（如 ㄒㄧㄣㄙㄨ ≠ 金屬聲），直接捨棄。
4. **不要百分之百確定。** 信心 >50% 就接受，沒有新線索不要重新思考同一題。
5. **不知道就說不知道。** 無合理候選時輸出「資訊不足」，禁止硬湊。
6. **區分易混聲母：** ㄙ(s)≠ㄕ(sh)，ㄗ(z)≠ㄓ(zh)，ㄘ(c)≠ㄔ(ch)。

## 輸出格式
{
  "per_question": [
    {"q": 1, "question": "問題原文", "reply_guess": "推測的回答", "confidence": 0.7}
  ]
}

confidence 為 0.0~1.0，低於 0.5 代表資訊不足。
`;

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
  // maxTokens=2048 + compact system prompt (~200t) + progress text (~1k) = well under Groq 6000 TPM limit.
  const stage1Reply = await stage1Backend.chat(stage1Messages, 0.4, 2048);
  onRawReply?.(1, stage1Reply);

  if (!stage1Reply || !stage1Reply.trim()) {
    throw new Error('Groq API 回傳了空白內容，可能是思考 token 用盡。請稍後再試。');
  }

  let perQuestion: PerQuestionGuess[];
  try {
    perQuestion = parseClues(JSON.parse(extractJson(stage1Reply)));
  } catch (err) {
    console.error(`[solver/stage1] AI raw reply:\n${stage1Reply}`);
    throw err instanceof Error ? err : new Error(String(err));
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
    throw new Error('Groq API 回傳了空白內容，可能是思考 token 用盡。請稍後再試。');
  }

  let finalGuesses: FinalGuess[];
  let summary: string;
  try {
    const parsed = parseFinal(JSON.parse(extractJson(stage2Reply)));
    finalGuesses = parsed.finalGuesses;
    summary = parsed.summary;
  } catch (err) {
    console.error(`[solver/stage2] AI raw reply:\n${stage2Reply}`);
    throw err instanceof Error ? err : new Error(String(err));
  }

  return { perQuestion, finalGuesses, summary };
}
