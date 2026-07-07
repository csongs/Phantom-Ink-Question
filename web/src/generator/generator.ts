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

export type ProgressCallback = (msg: string) => void;

export interface GenerateOptions {
  answer?: string;
  skipReview?: boolean;
  skipSimulation?: boolean;
  answerMode?: 'ai' | 'human';
  numQuestions?: number;
  usedAnswers?: string[];
  onProgress?: ProgressCallback;
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
      onProgress,
    } = options;
    let answer = options.answer ?? '';

    if (answerMode === 'ai') {
      onProgress?.('🎲 AI 思考謎底中...');
      answer = await this.generateAnswer(usedAnswers);
      onProgress?.(`🎲 AI 產生的謎底：${answer}`);
    } else if (!answer) {
      throw new Error('answerMode 為 human 時必須提供謎底');
    }

    let retryCount = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      onProgress?.(`📝 第 ${attempt + 1} 次生成（共 ${this.maxRetries} 次）`);

      let questionSet: QuestionSet;
      try {
        onProgress?.('🤖 AI 出題中...');
        questionSet = await this.designQuestions(answer, answerMode, numQuestions);
      } catch {
        onProgress?.('❌ 出題失敗，重試中...');
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
        onProgress?.(`⚠️  發現 ${bad.size} 題不合格（${sortedBad.map(i => `Q${i + 1}`).join('、')}），只重新產生這 ${bad.size} 題...`);

        questionSet = await this.fixQuestions(answer, questionSet, sortedBad, reasonsDict);
      }

      // Log the final (post-fix) questions
      const qaLines = questionSet.questions
        .map((q, i) => `  Q${i + 1}. ${q.question}\n  A${i + 1}. ${q.reply}`)
        .join('\n');
      onProgress?.(`✅ 出題完成（${questionSet.questions.length} 題）\n${qaLines}`);

      let review: ReviewResult | null = null;
      if (!skipReview) {
        onProgress?.('🔍 AI 驗題中...');
        try {
          review = await this.reviewQuestions(questionSet);
          const commentsStr = review.comments.length
            ? '\n' + review.comments.map((c) => `  • ${c}`).join('\n')
            : '';
          onProgress?.(`🔍 評分：${review.score}/100 — ${review.passed ? '✅ 通過' : '❌ 未通過'}${commentsStr}`);
        } catch {
          onProgress?.('❌ 驗題失敗，重試中...');
          continue;
        }
        if (!review.passed) {
          retryCount++;
          continue;
        }
      }

      let simulation: SimulationResult | null = null;
      if (!skipSimulation) {
        onProgress?.('🎮 AI 模擬玩家中...');
        try {
          simulation = await this.simulatePlayer(questionSet);
          onProgress?.(
            `🎮 在第 ${simulation.guessRound} 題猜出（${simulation.inkUsed} 格注音，信心 ${simulation.confidence}）`,
          );
        } catch {
          onProgress?.('⚠️  模擬失敗（跳過）');
          simulation = null;
        }
      }

      onProgress?.('✅ 題組生成成功！');
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
