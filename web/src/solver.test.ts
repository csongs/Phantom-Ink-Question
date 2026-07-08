// web/src/solver.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseSolveResult,
  solvePuzzle,
  CLUE_SOLVER_SYSTEM_PROMPT,
  FINAL_GUESSER_SYSTEM_PROMPT,
  finalGuesserUserPrompt,
  type PerQuestionGuess,
} from './solver';
import { FakeBackend } from './generator/fakeBackend';

describe('parseSolveResult', () => {
  it('normalizes a well-formed reply', () => {
    const raw = {
      per_question: [{ q: 1, reply_guess: '地面', note: '掉到地上' }],
      final_guesses: [{ answer: '溜冰鞋', reason: '冰上活動相關' }],
      summary: '綜合判斷',
    };
    const out = parseSolveResult(raw);
    expect(out.perQuestion).toEqual([{ q: 1, replyGuess: '地面', note: '掉到地上' }]);
    expect(out.finalGuesses).toEqual([{ answer: '溜冰鞋', reason: '冰上活動相關' }]);
    expect(out.summary).toBe('綜合判斷');
  });

  it('tolerates string final guesses and alternate keys', () => {
    const out = parseSolveResult({
      per_question: [{ question: 2, guess: '冰宮', reason: 'x' }],
      final_guesses: ['溜冰鞋', { guess: '冰刀' }],
    });
    expect(out.perQuestion[0]).toEqual({ q: 2, replyGuess: '冰宮', note: 'x', question: undefined });
    expect(out.finalGuesses.map((f) => f.answer)).toEqual(['溜冰鞋', '冰刀']);
  });

  it('returns empty structures for garbage input', () => {
    const out = parseSolveResult({});
    expect(out.perQuestion).toEqual([]);
    expect(out.finalGuesses).toEqual([]);
    expect(out.summary).toBe('');
  });

  it('keeps all candidate answers without capping', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((answer) => ({ answer, reason: '' }));
    const out = parseSolveResult({ final_guesses: five });
    expect(out.finalGuesses).toHaveLength(5);
  });
});

describe('CLUE_SOLVER_SYSTEM_PROMPT', () => {
  it('emphasises bopomofo decoding and does not ask for final guesses', () => {
    expect(CLUE_SOLVER_SYSTEM_PROMPT).toContain('注音');
    expect(CLUE_SOLVER_SYSTEM_PROMPT).toContain('不知道謎底');
    expect(CLUE_SOLVER_SYSTEM_PROMPT).not.toContain('final_guesses');
  });
});

describe('FINAL_GUESSER_SYSTEM_PROMPT', () => {
  it('asks for 5 ranked answer candidates', () => {
    expect(FINAL_GUESSER_SYSTEM_PROMPT).toContain('5');
    expect(FINAL_GUESSER_SYSTEM_PROMPT).toContain('候選');
  });
});

describe('finalGuesserUserPrompt', () => {
  it('formats deciphered clues without bopomofo', () => {
    const guesses: PerQuestionGuess[] = [
      { q: 1, replyGuess: '地面', note: '掉到地上', question: '它會去哪裡？' },
    ];
    const prompt = finalGuesserUserPrompt(guesses);
    expect(prompt).toContain('它會去哪裡？');
    expect(prompt).toContain('地面');
    expect(prompt).not.toContain('ㄉ');
  });
});

describe('solvePuzzle', () => {
  const CLUES_REPLY = JSON.stringify({
    per_question: [{ q: 1, question: '它會去哪裡？', reply_guess: '地面', note: '掉到地上' }],
  });
  const FINAL_REPLY = JSON.stringify({
    final_guesses: [{ answer: '溜冰鞋', reason: '冰上活動相關' }],
    summary: '整體思路',
  });

  it('sends progress text to stage 1 and deciphered clues to stage 2', async () => {
    const qwenBackend = new FakeBackend([CLUES_REPLY]);
    const llamaBackend = new FakeBackend([FINAL_REPLY]);
    const result = await solvePuzzle(qwenBackend, llamaBackend, 'Q1. 它會去哪裡？\nㄉㄧˋㄇㄧㄢˋ。');

    expect(result.perQuestion[0].replyGuess).toBe('地面');
    expect(result.finalGuesses[0].answer).toBe('溜冰鞋');

    // Stage 1 receives bopomofo
    const stage1Msg = qwenBackend.calls[0].messages.find((m) => m.role === 'user');
    expect(stage1Msg?.content).toContain('ㄉㄧˋㄇㄧㄢˋ。');

    // Stage 2 receives deciphered text, NOT bopomofo
    const stage2Msg = llamaBackend.calls[0].messages.find((m) => m.role === 'user');
    expect(stage2Msg?.content).toContain('地面');
    expect(stage2Msg?.content).not.toContain('ㄉㄧˋ');
  });

  it('avoids json_object on both stages; no reasoning_format on stage 1 (text + extractJson)', async () => {
    const qwenBackend = new FakeBackend([CLUES_REPLY]);
    const llamaBackend = new FakeBackend([FINAL_REPLY]);
    await solvePuzzle(qwenBackend, llamaBackend, 'Q1. 測試？\n（尚未顯示墨水）');

    // Stage 1 (Qwen3-32B, reasoning model) — no json_object to avoid
    // json_validate_failed, no reasoning_format so thinking text appears in
    // content and extractJson pulls the JSON out.
    expect(qwenBackend.calls[0].responseFormat).toBeUndefined();
    expect(qwenBackend.calls[0].reasoningFormat).toBeUndefined();
    expect(qwenBackend.calls[0].maxTokens).toBe(4096);

    // Stage 2 (Llama) — no json_object either
    expect(llamaBackend.calls[0].responseFormat).toBeUndefined();
  });

  it('extracts JSON from a fenced / prose-wrapped stage 1 reply', async () => {
    const qwenBackend = new FakeBackend(['這是分析：\n```json\n' + CLUES_REPLY + '\n```\n完畢']);
    const llamaBackend = new FakeBackend([FINAL_REPLY]);
    const result = await solvePuzzle(qwenBackend, llamaBackend, 'Q1. 測試？\nㄘˋ');
    expect(result.perQuestion[0].replyGuess).toBe('地面');
  });

  it('throws immediately when stage 1 reply is unparseable', async () => {
    const qwenBackend = new FakeBackend(['（模型只講了廢話，沒有 JSON）']);
    const llamaBackend = new FakeBackend(['dummy']);
    await expect(
      solvePuzzle(qwenBackend, llamaBackend, 'Q1. 測試？\nㄘˋ'),
    ).rejects.toThrow(/階段 1/);
    expect(qwenBackend.calls.length).toBe(1);
  });

  it('never receives an answer — stage 1 only gets questions and revealed bopomofo', async () => {
    const qwenBackend = new FakeBackend([CLUES_REPLY]);
    const llamaBackend = new FakeBackend([FINAL_REPLY]);
    await solvePuzzle(qwenBackend, llamaBackend, 'Q1. 它是什麼顏色？\nㄏㄟˉ');

    const allContent = qwenBackend.calls[0].messages.map((m) => m.content).join('\n');
    expect(allContent).toContain('不知道謎底');
  });
});
