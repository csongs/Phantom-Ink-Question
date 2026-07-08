// web/src/solver.ts
//
// Standalone puzzle-solving helper. Unlike the generator, this NEVER sees the
// answer — it reasons purely from a pasted progress snapshot (questions plus
// partially-revealed bopomofo), so it works on any puzzle, including someone
// else's copied progress.
import { extractJson, type LLMBackend } from './backends/shared';

export interface PerQuestionGuess {
  q: number;
  replyGuess: string;
  note: string;
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

export const SOLVER_SYSTEM_PROMPT = `你是「靈媒遊戲」的解題小幫手。你**不知道謎底**，只能根據玩家提供的線索推理。請全程使用臺灣慣用詞彙。

## 遊戲背景
- 謎底是一個具體名詞。
- 每一題有一個「問題」與一個簡短「回答」（回答不超過六個中文字）。
- 回答以注音逐格揭露，你看到的是「目前已揭露的注音」。
- 注音由左到右揭露，未揭露的部分你看不到；「（尚未顯示墨水）」表示這題還沒揭露任何注音。
- 注音含聲調，同符號不同聲調視為不同（ㄧ 與 ㄧˋ 不同）；句號「。」代表回答結束。

## 關鍵規則（用來幫助推理）
- **謎底與任何一題的「回答」都不會共用任何中文字。** 例如某題回答是「溜冰」，謎底就不會出現「溜」或「冰」。推測出各題回答後，凡是與這些字重疊的謎底候選都可以直接排除。
- 回答只是「線索」，不是謎底本身；請透過這些線索間接推理出謎底。

## 你的任務
1. **逐題推測**：根據問題與已揭露注音，猜測每一題「回答」最可能是什麼短語。注音只揭露一部分時，給出最合理的推測並說明理由。
2. **綜合猜謎底**：把所有線索合在一起推理謎底，給 **5 個**候選並依可能性由高到低排序（最可能的排最前），且務必排除與線索回答共用文字的候選。若真的想不到這麼多，至少也要盡量湊到 5 個合理猜測。

## 輸出 JSON 格式
{
  "per_question": [
    {"q": 1, "reply_guess": "推測的回答", "note": "推理說明"}
  ],
  "final_guesses": [
    {"answer": "候選謎底", "reason": "推理依據（含為何不與線索字重複）"}
  ],
  "summary": "整體思路"
}`;

export function solverUserPrompt(progressText: string): string {
  return `以下是目前的解題進度（你看不到謎底，只有問題與已揭露的注音）：

${progressText}

請依系統指示逐題推測回答，再綜合猜謎底，並輸出指定的 JSON。`;
}

/** Leniently normalize the model's JSON into a SolveResult, tolerating key drift. */
export function parseSolveResult(raw: any): SolveResult {
  const perQuestion: PerQuestionGuess[] = Array.isArray(raw?.per_question)
    ? raw.per_question.map((p: any) => ({
        q: Number(p?.q ?? p?.question ?? p?.question_number ?? 0),
        replyGuess: String(p?.reply_guess ?? p?.guess ?? p?.answer ?? '').trim(),
        note: String(p?.note ?? p?.reason ?? '').trim(),
      }))
    : [];

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

  return { perQuestion, finalGuesses, summary };
}

/**
 * Analyze a pasted progress snapshot.
 *
 * This is the app's heaviest reasoning call (analyse 7 clues, then cross-
 * reference for 5 candidates), which repeatedly tripped Groq's
 * `json_validate_failed` — the STRICT server-side check that `json_object`
 * mode runs on a reasoning model's output. So instead of json_object we let
 * the model reply as text (reasoning_format 'hidden' keeps <think> out of the
 * content, no max_tokens cap so reasoning can finish) and parse the JSON
 * ourselves with the lenient extractJson + a couple of retries. This
 * structurally avoids that 400 and tolerates minor formatting noise.
 */
export async function solvePuzzle(
  backend: LLMBackend,
  progressText: string,
  onRawReply?: (raw: string) => void,
): Promise<SolveResult> {
  const messages = [
    { role: 'system' as const, content: SOLVER_SYSTEM_PROMPT },
    { role: 'user' as const, content: solverUserPrompt(progressText) },
  ];

  const reply = await backend.chat(messages, 0.4, 8192, undefined, 'hidden');
  onRawReply?.(reply);
  if (!reply || !reply.trim()) {
    throw new Error('AI 回傳了空白回應，請稍後再試。');
  }
  try {
    return parseSolveResult(JSON.parse(extractJson(reply)));
  } catch (err) {
    console.error(`[solver] AI raw reply:\n${reply}`);
    throw new Error(
      `AI 回應無法解析為 JSON。原始錯誤：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
