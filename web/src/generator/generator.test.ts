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
