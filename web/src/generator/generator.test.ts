// web/src/generator/generator.test.ts
import { describe, it, expect } from 'vitest';
import { PhantomInkGenerator } from './generator';
import { FakeBackend } from './fakeBackend';

// Both replies are within the 6-char limit (木頭與金屬弦 = 6, 黑色或白色 = 5).
const GOOD_DESIGN_REPLY = JSON.stringify({
  answer: '鋼琴',
  questions: [
    { question: '它由什麼材料製成？', reply: '木頭與金屬弦.' },
    { question: '它是何種顏色？', reply: '黑色或白色.' },
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

    const qs = await generator.designQuestions('鋼琴', { numQuestions: 2 });

    expect(qs.answer).toBe('鋼琴');
    expect(qs.questions[0].reply).toBe('木頭與金屬弦。');
    expect(qs.questions[1].reply).toBe('黑色或白色。');
  });

  it('converts a simplified-Chinese answer to traditional during post-processing', async () => {
    const simplifiedAnswerReply = JSON.stringify({
      answer: '贝壳',
      questions: [{ question: '它由什麼材料製成？', reply: '碳酸鈣.' }],
    });
    const backend = new FakeBackend([simplifiedAnswerReply]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('贝壳', { numQuestions: 1 });

    expect(qs.answer).toBe('貝殼');
  });

  it('marks questions not present in QUESTION_BANK as custom', async () => {
    const madeUpQuestion = JSON.stringify({
      answer: '鋼琴',
      questions: [{ question: '這是我自己編的問題？', reply: '測試回答.' }],
    });
    const backend = new FakeBackend([madeUpQuestion]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', { numQuestions: 1 });

    expect(qs.questions[0].isCustom).toBe(true);
  });

  it('keeps the AI-filled replies regardless of answer source (no human-mode wipe)', async () => {
    // Question design is identical whether the answer is AI- or human-supplied;
    // only the answer's source differs. Replies must never be blanked here —
    // doing so previously routed every question through fixQuestions and
    // produced off-bank questions and over-long replies.
    const backend = new FakeBackend([GOOD_DESIGN_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const qs = await generator.designQuestions('鋼琴', { numQuestions: 2 });

    expect(qs.questions.every((q) => q.reply !== '')).toBe(true);
  });
});

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

describe('PhantomInkGenerator.generateAnswer', () => {
  it('parses the answer out of a JSON reply', async () => {
    const backend = new FakeBackend([JSON.stringify({ answer: '鋼琴' })]);
    const generator = new PhantomInkGenerator(backend);

    const answer = await generator.generateAnswer();

    expect(answer).toBe('鋼琴');
  });

  it('requests json_object mode so the model cannot return free-text reasoning', async () => {
    const backend = new FakeBackend([JSON.stringify({ answer: '鋼琴' })]);
    const generator = new PhantomInkGenerator(backend);

    await generator.generateAnswer();

    expect(backend.calls[0].responseFormat).toEqual({ type: 'json_object' });
  });

  it('hides reasoning tokens so a thinking model cannot exhaust the budget before emitting JSON', async () => {
    const backend = new FakeBackend([JSON.stringify({ answer: '鋼琴' })]);
    const generator = new PhantomInkGenerator(backend);

    await generator.generateAnswer();

    expect(backend.calls[0].reasoningFormat).toBe('hidden');
  });

  it('reports the raw reply via onProgress before parsing it', async () => {
    const rawReply = JSON.stringify({ answer: '鋼琴' });
    const backend = new FakeBackend([rawReply]);
    const generator = new PhantomInkGenerator(backend);
    const messages: string[] = [];

    await generator.generateAnswer([], (msg) => messages.push(msg));

    expect(messages.some((m) => m.includes(rawReply))).toBe(true);
  });

  it('converts a simplified-Chinese answer to traditional', async () => {
    const backend = new FakeBackend([JSON.stringify({ answer: '贝壳' })]);
    const generator = new PhantomInkGenerator(backend);

    const answer = await generator.generateAnswer();

    expect(answer).toBe('貝殼');
  });
});

describe('PhantomInkGenerator.checkAnswerLocale', () => {
  it('parses is_mainland_term/taiwan_term/reason from the reply', async () => {
    const backend = new FakeBackend([
      JSON.stringify({ is_mainland_term: true, taiwan_term: '滑鼠', reason: '大陸慣用語' }),
    ]);
    const generator = new PhantomInkGenerator(backend);

    const result = await generator.checkAnswerLocale('鼠標');

    expect(result).toEqual({ isMainlandTerm: true, taiwanTerm: '滑鼠', reason: '大陸慣用語' });
  });

  it('sends no max_tokens cap so qwen3-32b judgment reasoning cannot exhaust the budget (regression: even 1024 caused json_validate_failed)', async () => {
    const backend = new FakeBackend([JSON.stringify({ is_mainland_term: false })]);
    const generator = new PhantomInkGenerator(backend);

    await generator.checkAnswerLocale('鋼琴');

    expect(backend.calls[0].maxTokens).toBeUndefined();
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

  it('regenerates replies that exceed the 6-character limit', async () => {
    const longDesign = JSON.stringify({
      answer: '鋼琴',
      questions: [
        { question: '它由什麼材料製成？', reply: '這是一種非常長而且明顯超過六個字的回答.' },
        { question: '它是何種顏色？', reply: '黑色.' },
      ],
    });
    const fixedOne = JSON.stringify({
      questions: [{ question: '它由什麼材料製成？', reply: '木頭.' }],
    });

    const backend = new FakeBackend([longDesign, fixedOne, PASSING_REVIEW_REPLY]);
    const generator = new PhantomInkGenerator(backend);

    const result = await generator.generate({
      answer: '鋼琴',
      answerMode: 'human',
      numQuestions: 2,
      skipReview: false,
      skipSimulation: true,
    });

    const charCount = (r: string) => r.replace(/[。，、！？；：「」『』（）()\s]/g, '').length;
    expect(result.questions.every((q) => charCount(q.reply) <= 6)).toBe(true);
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

  it('retries a failed generateAnswer (e.g. Groq json_validate_failed) and still completes', async () => {
    const backend = new FakeBackend([
      'not valid json',
      JSON.stringify({ answer: '鋼琴' }),
      JSON.stringify({ is_mainland_term: false }),
      GOOD_DESIGN_REPLY,
      PASSING_REVIEW_REPLY,
    ]);
    const generator = new PhantomInkGenerator(backend, 3);

    const result = await generator.generate({
      answerMode: 'ai',
      numQuestions: 2,
      skipReview: false,
      skipSimulation: true,
    });

    expect(result.answer).toBe('鋼琴');
    expect(result.questions.length).toBe(2);
  });

  it('returns the failure placeholder if generateAnswer exhausts every retry', async () => {
    const backend = new FakeBackend(['not json', 'still not json']);
    const generator = new PhantomInkGenerator(backend, 2);

    const result = await generator.generate({ answerMode: 'ai', numQuestions: 2 });

    expect(result.questions).toEqual([
      { question: '（生成失敗）', reply: '（生成失敗）', isCustom: false },
    ]);
  });

  it('swaps a Mainland-flagged answer to the provided Taiwan term without regenerating', async () => {
    const swappedDesign = JSON.stringify({
      answer: '滑鼠',
      questions: [
        { question: '它由什麼材料製成？', reply: '塑膠外殼.' },
        { question: '它是何種顏色？', reply: '黑色.' },
      ],
    });
    const backend = new FakeBackend([
      JSON.stringify({ answer: '鼠标' }),
      JSON.stringify({ is_mainland_term: true, taiwan_term: '滑鼠', reason: '大陸慣用語' }),
      swappedDesign,
      PASSING_REVIEW_REPLY,
    ]);
    const generator = new PhantomInkGenerator(backend, 3);

    const result = await generator.generate({
      answerMode: 'ai',
      numQuestions: 2,
      skipReview: false,
      skipSimulation: true,
    });

    // The Taiwan term is used directly — designQuestions runs on 滑鼠.
    expect(result.answer).toBe('滑鼠');
    // Crucially, no second answer was generated: only one call carries the
    // answer-generator prompt.
    const genCalls = backend.calls.filter((c) =>
      c.messages.some((m) => m.content.includes('產生一個適合當作謎底')),
    );
    expect(genCalls.length).toBe(1);
  });

  it('regenerates only when a Mainland-flagged answer has no Taiwan equivalent', async () => {
    const backend = new FakeBackend([
      JSON.stringify({ answer: '鼠标' }),
      JSON.stringify({ is_mainland_term: true, taiwan_term: '', reason: '大陸慣用語' }),
      JSON.stringify({ answer: '视频' }),
      JSON.stringify({ is_mainland_term: true, taiwan_term: '', reason: '大陸慣用語' }),
    ]);
    const generator = new PhantomInkGenerator(backend, 2);

    const result = await generator.generate({ answerMode: 'ai', numQuestions: 2 });

    // Both flagged, neither offered a Taiwan term → exhaust retries → placeholder.
    expect(result.questions).toEqual([
      { question: '（生成失敗）', reply: '（生成失敗）', isCustom: false },
    ]);
    // The regeneration's usedHint must mention the first rejected candidate.
    const secondGen = backend.calls[2];
    expect(secondGen.messages.some((m) => m.content.includes('鼠標'))).toBe(true);
  });

  it('accepts the candidate answer when the locale check itself throws (optional gate)', async () => {
    // Regression: a token-exhausted locale check on qwen3-32b must not discard
    // an otherwise-good Taiwan answer — the flow proceeds with it unchecked.
    const design = JSON.stringify({
      answer: '急診',
      questions: [
        { question: '它由什麼材料製成？', reply: '無形服務.' },
        { question: '它是何種顏色？', reply: '白色.' },
      ],
    });
    const backend = new FakeBackend([
      JSON.stringify({ answer: '急診' }),
      'not valid json', // checkAnswerLocale throws
      design,
      PASSING_REVIEW_REPLY,
    ]);
    const generator = new PhantomInkGenerator(backend, 3);
    const messages: string[] = [];

    const result = await generator.generate({
      answerMode: 'ai',
      numQuestions: 2,
      skipReview: false,
      skipSimulation: true,
      onProgress: (m) => messages.push(m),
    });

    expect(result.answer).toBe('急診');
    expect(messages.some((m) => m.includes('謎底用語檢查失敗'))).toBe(true);
    // A failed *check* is a warning, not a fatal 謎底生成失敗.
    expect(messages.some((m) => m.startsWith('❌ 謎底生成失敗'))).toBe(false);
  });
});
