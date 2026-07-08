// web/src/solver.test.ts
import { describe, it, expect } from 'vitest';
import { parseSolveResult, solvePuzzle, SOLVER_SYSTEM_PROMPT } from './solver';
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
    expect(out.perQuestion[0]).toEqual({ q: 2, replyGuess: '冰宮', note: 'x' });
    expect(out.finalGuesses.map((f) => f.answer)).toEqual(['溜冰鞋', '冰刀']);
  });

  it('returns empty structures for garbage input', () => {
    const out = parseSolveResult({});
    expect(out.perQuestion).toEqual([]);
    expect(out.finalGuesses).toEqual([]);
    expect(out.summary).toBe('');
  });

  it('keeps all candidate answers without capping (rendering shows every guess)', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((answer) => ({ answer, reason: '' }));
    const out = parseSolveResult({ final_guesses: five });
    expect(out.finalGuesses).toHaveLength(5);
  });
});

describe('SOLVER_SYSTEM_PROMPT', () => {
  it('asks for 5 ranked answer candidates', () => {
    expect(SOLVER_SYSTEM_PROMPT).toContain('5');
    expect(SOLVER_SYSTEM_PROMPT).toContain('候選');
  });
});

describe('solvePuzzle', () => {
  const REPLY = JSON.stringify({
    per_question: [{ q: 1, reply_guess: '地面', note: 'n' }],
    final_guesses: [{ answer: '溜冰鞋', reason: 'r' }],
    summary: 's',
  });

  it('sends the progress text and returns a parsed result', async () => {
    const backend = new FakeBackend([REPLY]);
    const result = await solvePuzzle(backend, 'Q1. 它會去哪裡？\nㄉㄧˋㄇㄧㄢˋ。');

    expect(result.finalGuesses[0].answer).toBe('溜冰鞋');
    const userMsg = backend.calls[0].messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('ㄉㄧˋㄇㄧㄢˋ。');
  });

  it('avoids json_object mode (parses text itself) but uses hidden reasoning and a generous token budget', async () => {
    const backend = new FakeBackend([REPLY]);
    await solvePuzzle(backend, 'Q1. 測試？\n（尚未顯示墨水）');

    // No json_object — that strict server-side validation is exactly what
    // produced json_validate_failed on this reasoning-heavy call.
    expect(backend.calls[0].responseFormat).toBeUndefined();
    expect(backend.calls[0].reasoningFormat).toBe('hidden');
    // Must give enough room for reasoning tokens so content isn't empty.
    expect(backend.calls[0].maxTokens).toBe(8192);
  });

  it('extracts JSON from a fenced / prose-wrapped reply', async () => {
    const backend = new FakeBackend(['這是我的分析：\n```json\n' + REPLY + '\n```\n希望有幫助']);
    const result = await solvePuzzle(backend, 'Q1. 測試？\nㄘˋ');
    expect(result.finalGuesses[0].answer).toBe('溜冰鞋');
  });

  it('throws immediately when the reply is unparseable (no retries)', async () => {
    const backend = new FakeBackend(['（模型只講了廢話，沒有 JSON）']);
    await expect(solvePuzzle(backend, 'Q1. 測試？\nㄘˋ')).rejects.toThrow(/無法解析為 JSON/);
    expect(backend.calls.length).toBe(1);
  });

  it('throws a clear error on unparseable reply', async () => {
    const backend = new FakeBackend(['nope']);
    await expect(solvePuzzle(backend, 'Q1. 測試？\nㄘˋ')).rejects.toThrow(/無法解析為 JSON/);
  });

  it('never receives an answer — it only gets questions and revealed bopomofo', async () => {
    const backend = new FakeBackend([REPLY]);
    await solvePuzzle(backend, 'Q1. 它是什麼顏色？\nㄏㄟˉ');
    const allContent = backend.calls[0].messages.map((m) => m.content).join('\n');
    // The system prompt must reinforce that the solver does not know the answer.
    expect(allContent).toContain('不知道謎底');
  });
});
