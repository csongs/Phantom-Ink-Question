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
  answerLocaleCheckPrompt,
  formatDesignerPrompt,
  reviewerUserPrompt,
  sampleRandom,
  simulatorUserPrompt,
} from './prompts';
import { convertPunctuation, toTraditional } from '../zhconv';
import { toBopomofoCells } from '../bopomofo';

export type ProgressCallback = (msg: string) => void;

export interface GenerateOptions {
  answer?: string;
  skipReview?: boolean;
  skipSimulation?: boolean;
  answerMode?: 'ai' | 'human';
  numQuestions?: number;
  numCandidates?: number;
  pickedBankQuestions?: string[];
  customQuestions?: string[];
  usedAnswers?: string[];
  onProgress?: ProgressCallback;
}

export class PhantomInkGenerator {
  constructor(
    public readonly llm: LLMBackend,
    private maxRetries = 3,
  ) {}

  private async jsonChat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    onRawReply?: (raw: string) => void,
  ): Promise<any> {
    // reasoning_format 'hidden' is required by Groq when combining json_object
    // mode with reasoning models (e.g. qwen3-32b) — without it, <think> tokens
    // can consume the whole completion before any JSON is produced, which
    // Groq rejects with a json_validate_failed error.
    const reply = await this.llm.chat(messages, temperature, maxTokens, { type: 'json_object' }, 'hidden');
    onRawReply?.(reply);
    return JSON.parse(reply);
  }

  private async postProcess(qs: QuestionSet): Promise<QuestionSet> {
    qs.answer = await toTraditional(qs.answer);
    for (const q of qs.questions) {
      q.question = convertPunctuation(await toTraditional(q.question));
      q.reply = convertPunctuation(await toTraditional(q.reply));
      if (q.reply && !q.reply.trimEnd().endsWith('。')) {
        q.reply = q.reply.trimEnd() + '。';
      }
    }
    return qs;
  }

  /** Number of meaningful characters in a reply, excluding punctuation/space. */
  private static replyCharCount(reply: string): number {
    return reply.replace(/[。，、！？；：「」『』（）()\s]/g, '').length;
  }

  /** Guarantees every forced question is present: forced first (reusing the AI's
   *  reply for them when given, else empty), then the AI's other picks, capped at
   *  numQuestions. */
  static reconcileForced(
    aiQuestions: QuestionItem[],
    forced: string[],
    numQuestions: number,
  ): QuestionItem[] {
    forced = forced.filter((q) => q.trim().length > 0);
    const byQuestion = new Map(aiQuestions.map((q) => [q.question, q]));
    const forcedItems: QuestionItem[] = forced.map((q) => ({
      question: q,
      reply: byQuestion.get(q)?.reply ?? '',
      isCustom: false,
    }));
    const forcedSet = new Set(forced);
    const rest = aiQuestions.filter((q) => !forcedSet.has(q.question));
    const slotsLeft = Math.max(0, numQuestions - forcedItems.length);
    return [...forcedItems, ...rest.slice(0, slotsLeft)];
  }

  // Note: question design is identical for AI- and human-supplied answers —
  // only the answer's *source* differs (see generate()). The AI always fills
  // the replies from the bank-selected questions.
  async designQuestions(
    answer: string,
    opts: { numQuestions?: number; numCandidates?: number; forcedQuestions?: string[] } = {},
  ): Promise<QuestionSet> {
    const numQuestions = opts.numQuestions ?? 10;
    const forced = opts.forcedQuestions ?? [];
    const { system, user } = formatDesignerPrompt(answer, {
      numQuestions,
      numCandidates: opts.numCandidates,
      forcedQuestions: forced,
    });
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
    qs = await this.postProcess(qs);

    // Deterministically guarantee forced questions are present.
    if (forced.length) {
      qs.questions = PhantomInkGenerator.reconcileForced(qs.questions, forced, numQuestions);
    }

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
      const cells = toBopomofoCells(qItem.reply);

      const historyLines = rounds.map(
        (r, j) =>
          `Q${j + 1}: ${r.question}\n回答注音: ${r.inkRevealed}\n你的猜測: ${r.playerGuess || '（尚未猜測）'}`,
      );
      const history = historyLines.length ? historyLines.join('\n\n') : '（尚無歷史）';

      const prompt = simulatorUserPrompt(
        categoryHint,
        roundNum,
        history,
        qItem.question,
        cells,
      );

      // One LLM call per question — the model simulates all reveal steps internally
      // and tells us at which step it would first want to guess.
      const raw = await this.jsonChat(
        [
          { role: 'system', content: SIMULATOR_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        0.5,
      );

      const guessStep: number | null = raw.guess_step ?? null;
      const playerGuess: string = raw.guess ?? '';
      const guessedCorrectly = guessStep != null && playerGuess.trim() === questionSet.answer;

      const revealedCells = guessStep != null
        ? [...cells.slice(0, guessStep), ...Array(cells.length - guessStep).fill('▢')]
        : cells.map(() => '▢');
      const revealedDisplay = revealedCells.join(' ');

      rounds.push({
        roundNumber: roundNum,
        question: qItem.question,
        reply: qItem.reply,
        inkRevealed: revealedDisplay,
        playerGuess,
        guessedCorrectly,
      });

      if (guessedCorrectly) break;
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

  async generateAnswer(usedAnswers: string[] = [], onProgress?: ProgressCallback): Promise<string> {
    const usedHint = usedAnswers.length
      ? `以下謎底已經出過了，請不要重複：${usedAnswers.join('、')}`
      : '不要與之前出過的謎底重複';
    const seed = ANSWER_SEEDS[Math.floor(Math.random() * ANSWER_SEEDS.length)];
    const raw = await this.jsonChat(
      [
        { role: 'system', content: '你只輸出 JSON。不加任何其他文字。' },
        { role: 'user', content: answerGeneratorPrompt(seed, usedHint) },
      ],
      0.7,
      // qwen3-32b has no documented way to fully disable reasoning via Groq
      // (reasoning_effort:'none' is only supported on Qwen 3.6 27B) — hidden
      // reasoning tokens still consume this budget, and 200 was confirmed
      // (via 3 identical retries) to be consistently too tight for this
      // model's thinking length even on a trivial one-word prompt.
      1024,
      (rawReply) => onProgress?.(`🔎 AI 原始回應（謎底）：${rawReply}`),
    );
    return await toTraditional((raw.answer ?? '').trim());
  }

  /** Re-checks a generated answer for Mainland-Chinese wording that character-level zhconv can't catch. */
  async checkAnswerLocale(
    answer: string,
  ): Promise<{ isMainlandTerm: boolean; taiwanTerm: string; reason: string }> {
    const raw = await this.jsonChat(
      [
        { role: 'system', content: '你只輸出 JSON。不加任何其他文字。' },
        { role: 'user', content: answerLocaleCheckPrompt(answer) },
      ],
      0.3,
      // No max_tokens cap — deliberately. This is the only call that asks
      // qwen3-32b to make a *judgment* (cross-strait vocabulary), which makes
      // it reason far more than the trivial "pick a noun" generateAnswer call.
      // Even 1024 was exhausted by hidden reasoning before any JSON appeared
      // (json_validate_failed with an empty failed_generation). designQuestions
      // and fixQuestions send no cap and never hit this, so do the same here
      // and let the reasoning finish.
    );
    return {
      isMainlandTerm: raw.is_mainland_term ?? false,
      taiwanTerm: raw.taiwan_term ?? '',
      reason: raw.reason ?? '',
    };
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

    const bankSample = sampleRandom(QUESTION_BANK, Math.min(30, QUESTION_BANK.length))
      .map((q) => `- ${q}`)
      .join('\n');

    const prompt =
      `謎底是「${answer}」，已經有 ${goodCount} 題合格的題目：\n` +
      `${goodDesc}\n\n` +
      `以下 ${badIndices.length} 題需要重做：\n` +
      `${badDesc}\n\n` +
      `請重新產生這 ${badIndices.length} 題，規則：\n` +
      `1. 問題**必須**從以下題庫原文照抄選出，不可自創：\n${bankSample}\n` +
      `2. 回答根據謎底填入，**不超過六個中文字**、不能出現謎底文字、全中文\n` +
      `3. 不要和上面已合格的題目重複或聚焦同一邏輯\n\n` +
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
    await this.postProcess(qs);
    return qs;
  }

  /** Regenerates ONLY the replies for forced questions, keeping their text. */
  private async fillForcedReplies(
    answer: string,
    items: { index: number; question: string }[],
  ): Promise<Map<number, string>> {
    const listText = items.map((it, k) => `${k + 1}. ${it.question}`).join('\n');
    const prompt =
      `謎底是「${answer}」。請為以下固定問題各填入一個回答，問題文字不可更改：\n` +
      `${listText}\n\n` +
      `回答規則：不超過六個中文字、不能出現謎底文字、全中文、語意明確、結尾加句號。\n` +
      `輸出 JSON：{"replies": ["回答1", "回答2", ...]}（順序對應上面題號）`;
    const raw = await this.jsonChat([{ role: 'user', content: prompt }]);
    const replies: string[] = raw.replies ?? [];
    const out = new Map<number, string>();
    items.forEach((it, k) => out.set(it.index, replies[k] ?? ''));
    return out;
  }

  async generate(options: GenerateOptions = {}): Promise<QuestionSetWithMeta> {
    const {
      skipReview = false,
      skipSimulation = true,
      answerMode = 'ai',
      numQuestions = 10,
      numCandidates,
      usedAnswers = [],
      onProgress,
    } = options;
    const forcedQuestions = [
      ...(options.pickedBankQuestions ?? []).filter((q) => q.trim().length > 0),
      ...(options.customQuestions ?? []).filter((q) => q.trim().length > 0),
    ];
    let answer = options.answer ?? '';

    if (answerMode === 'ai') {
      onProgress?.('🎲 AI 思考謎底中...');
      // Reasoning models can intermittently fail Groq's json_object validation
      // even with reasoning_format set correctly (a known Groq-side gap — see
      // https://community.groq.com/t/get-reasoning-key-when-json-validate-failed/785).
      // Unlike designQuestions below, this call previously had zero retry
      // safety net, so any such failure aborted generation entirely.
      let answerOk = false;
      const rejectedAnswers: string[] = [];
      for (let i = 0; i < this.maxRetries && !answerOk; i++) {
        let candidate: string;
        try {
          candidate = await this.generateAnswer([...usedAnswers, ...rejectedAnswers], onProgress);
          onProgress?.(`🎲 AI 產生的謎底：${candidate}`);
        } catch (err) {
          onProgress?.(`❌ 謎底生成失敗（第 ${i + 1}/${this.maxRetries} 次）：${(err as Error).message}`);
          continue;
        }

        // The locale recheck is an *optional* quality gate. qwen3-32b is a
        // reasoning model whose hidden thinking can exhaust the token budget on
        // this heavier judgment prompt — a failed *check* must never discard an
        // otherwise-good answer, so on error we accept the candidate unchecked.
        let localeCheck: Awaited<ReturnType<PhantomInkGenerator['checkAnswerLocale']>>;
        try {
          localeCheck = await this.checkAnswerLocale(candidate);
        } catch (err) {
          onProgress?.(`⚠️  謎底用語檢查失敗，略過檢查直接採用「${candidate}」：${(err as Error).message}`);
          answer = candidate;
          answerOk = true;
          break;
        }

        if (localeCheck.isMainlandTerm) {
          // If the check already told us the Taiwan equivalent, swap it in
          // instead of paying for a whole new generation round.
          const twTerm = await toTraditional((localeCheck.taiwanTerm ?? '').trim());
          if (twTerm) {
            onProgress?.(`⚠️  「${candidate}」為中國大陸用語，改用臺灣用語「${twTerm}」（${localeCheck.reason}）`);
            answer = twTerm;
            answerOk = true;
          } else {
            onProgress?.(`⚠️  「${candidate}」判斷為中國大陸用語（${localeCheck.reason}），重新產生...`);
            rejectedAnswers.push(candidate);
          }
          continue;
        }

        answer = candidate;
        answerOk = true;
      }
      if (!answerOk) {
        onProgress?.('❌ 謎底生成多次失敗，放棄本次生成');
        return {
          answer: '',
          questions: [{ question: '（生成失敗）', reply: '（生成失敗）', isCustom: false }],
          review: null,
          simulation: null,
          retryCount: 0,
        };
      }
    } else if (!answer) {
      throw new Error('answerMode 為 human 時必須提供謎底');
    }

    let retryCount = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      onProgress?.(`📝 第 ${attempt + 1} 次生成（共 ${this.maxRetries} 次）`);

      let questionSet: QuestionSet;
      try {
        onProgress?.('🤖 AI 出題中...');
        questionSet = await this.designQuestions(answer, {
          numQuestions,
          numCandidates,
          forcedQuestions,
        });
      } catch {
        onProgress?.('❌ 出題失敗，重試中...');
        continue;
      }

      for (let fixAttempt = 0; fixAttempt < 3; fixAttempt++) {
        await this.postProcess(questionSet);

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
        // Hard 6-char cap: this is an ink-reveal game, so long replies break
        // it. The AI reviewer alone let 14-char answers ship, so enforce here.
        questionSet.questions.forEach((q, i) => {
          if (PhantomInkGenerator.replyCharCount(q.reply) > 6) bad.add(i);
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
          if (PhantomInkGenerator.replyCharCount(r) > 6) reasonsDict[i].push('回答過長（超過六字）');
        }
        onProgress?.(`⚠️  發現 ${bad.size} 題不合格（${sortedBad.map(i => `Q${i + 1}`).join('、')}），只重新產生這 ${bad.size} 題...`);

        // Forced questions (checked bank + custom) must keep their exact text;
        // only their reply may be regenerated. Free questions can be rewritten.
        const forcedSet = new Set(forcedQuestions);
        const forcedBad = sortedBad.filter((i) => forcedSet.has(questionSet.questions[i].question));
        const freeBad = sortedBad.filter((i) => !forcedSet.has(questionSet.questions[i].question));

        if (freeBad.length) {
          questionSet = await this.fixQuestions(answer, questionSet, freeBad, reasonsDict);
        }
        if (forcedBad.length) {
          const items = forcedBad.map((i) => ({ index: i, question: questionSet.questions[i].question }));
          const newReplies = await this.fillForcedReplies(answer, items);
          for (const [i, reply] of newReplies) {
            questionSet.questions[i] = { ...questionSet.questions[i], reply };
          }
          await this.postProcess(questionSet);
        }
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

  /** Regenerates ONLY the reply for a single question, keeping its text. */
  async regenerateReply(answer: string, question: string): Promise<string> {
    const prompt =
      `謎底是「${answer}」。\n` +
      `題目：${question}\n\n` +
      `請為這題填入一個新的回答（替代之前的回答），規則：\n` +
      `1. 回答**不超過六個中文字**、不能出現謎底文字、全中文\n` +
      `2. 語意明確、結尾加句號\n` +
      `3. 盡量不同於常見回答，但邏輯上仍合理\n\n` +
      `輸出 JSON：{"reply": "..."}`;
    const raw = await this.jsonChat([{ role: 'user', content: prompt }]);
    let reply = (raw.reply ?? '').trim();
    reply = convertPunctuation(await toTraditional(reply));
    if (reply && !reply.endsWith('。')) reply += '。';
    return reply;
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
