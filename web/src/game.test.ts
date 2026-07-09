import { describe, it, expect, beforeEach } from 'vitest';
import { PhantomInkGame, renderGame, buildSolverProgressText, type GameQuestion } from './game';

function makeQuestions(): GameQuestion[] {
  return [
    { question: 'Q1', reply: '剛。', cells: ['ㄍ', 'ㄤ', 'ˉ'], total: 3 },
    { question: 'Q2', reply: '琴。', cells: ['ㄑ', 'ㄧ', 'ㄣ', 'ˊ'], total: 4 },
    { question: 'Q3', reply: 'ㄅ。', cells: ['ㄅ'], total: 1 },
    { question: 'Q4', reply: 'ㄆ。', cells: ['ㄆ'], total: 1 },
    { question: 'Q5', reply: 'ㄇ。', cells: ['ㄇ'], total: 1 },
  ];
}

describe('PhantomInkGame', () => {
  it('starts with nothing revealed and zero ink/guesses', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    expect(game.state.currentQ).toBe(0);
    expect(game.state.revealed).toEqual([0, 0, 0, 0, 0]);
    expect(game.state.ink).toBe(0);
    expect(game.state.guesses).toBe(0);
  });

  it('revealInk increments both the current question reveal count and ink', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealInk();
    expect(game.state.revealed[0]).toBe(1);
    expect(game.state.ink).toBe(1);
  });

  it('revealInk does nothing once the current question is fully revealed', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealInk();
    game.revealInk();
    game.revealInk(); // question 0 has 3 total cells, this 3rd call fills it
    game.revealInk(); // 4th call should be a no-op
    expect(game.state.revealed[0]).toBe(3);
    expect(game.state.ink).toBe(3);
  });

  it('nextQuestion advances currentQ and marks the previous question visited', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion();
    expect(game.state.currentQ).toBe(1);
    expect(game.state.visited).toEqual([0]);
  });

  it('grants an oracle charge on reaching question 5 (index 4) for the first time', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion(); // -> index 1
    game.nextQuestion(); // -> index 2
    game.nextQuestion(); // -> index 3
    expect(game.state.oracleCharges).toBe(0);
    game.nextQuestion(); // -> index 4, grants a charge
    expect(game.state.oracleCharges).toBe(1);
    game.nextQuestion(); // no further question, no extra charge
    expect(game.state.oracleCharges).toBe(1);
  });

  it('finishClues marks finalRevealed and grants an oracle charge once', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.finishClues();
    expect(game.state.finalRevealed).toBe(true);
    expect(game.state.oracleCharges).toBe(1);
    game.finishClues();
    expect(game.state.oracleCharges).toBe(1);
  });

  it('revealOracle reveals one extra cell on a past question without costing regular ink', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.nextQuestion();
    game.nextQuestion();
    game.nextQuestion();
    game.nextQuestion(); // reaches question index 4, oracleCharges = 1
    game.revealOracle(0);
    expect(game.state.revealed[0]).toBe(1);
    expect(game.state.oracleCharges).toBe(0);
    expect(game.state.oracleUsed).toBe(1);
  });

  it('revealOracle is a no-op with zero charges', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealOracle(0);
    expect(game.state.revealed[0]).toBe(0);
  });

  it('submitAnswer with the correct guess wins and ends the game', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('鋼琴');
    expect(correct).toBe(true);
    expect(game.state.won).toBe(true);
    expect(game.state.gameOver).toBe(true);
    expect(game.state.guesses).toBe(1);
  });

  it('submitAnswer with a wrong guess adds 3 ink and keeps playing', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('小提琴');
    expect(correct).toBe(false);
    expect(game.state.won).toBe(false);
    expect(game.state.gameOver).toBe(false);
    expect(game.state.ink).toBe(3);
    expect(game.state.guesses).toBe(1);
  });

  it('submitAnswer with a blank guess does nothing', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const correct = game.submitAnswer('   ');
    expect(correct).toBe(false);
    expect(game.state.guesses).toBe(0);
  });
});

describe('buildSolverProgressText', () => {
  it('emits seen questions with revealed bopomofo and leaks no answer', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.revealInk(); // Q1: 1 cell
    game.revealInk(); // Q1: 2 cells
    game.nextQuestion(); // visit Q1, move to Q2 (0 revealed)

    const text = buildSolverProgressText(game);

    expect(text).toContain('Q1. Q1\nㄍㄤ');
    expect(text).toContain('Q2. Q2\n（尚未顯示墨水）');
    // Blind: the answer must never appear.
    expect(text).not.toContain('鋼琴');
    // Only seen questions (Q1, Q2) — not later ones.
    expect(text).not.toContain('Q3.');
  });

  it('includes the closing period cell once the reply is fully revealed', () => {
    const game = new PhantomInkGame(
      [{ question: 'Q1', reply: '地面。', cells: ['ㄉ', 'ㄧ', 'ˋ', 'ㄇ', 'ㄧ', 'ㄢ', 'ˋ', '。'], total: 8 }],
      '溜冰鞋',
    );
    for (let i = 0; i < 8; i++) game.revealInk();
    expect(buildSolverProgressText(game)).toBe('Q1. Q1\nㄉㄧˋㄇㄧㄢˋ。');
  });
});

describe('renderGame / answer input layout', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

  it('does NOT render a 🎯 提交謎底 button (input is always visible)', () => {
    // 使用者回報:輸入框+送出按鈕永遠可見,「🎯 提交謎底」多餘。
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const root = document.getElementById('app')!;
    renderGame(root, game, root);
    expect(root.querySelector('[data-action="show-answer"]')).toBeNull();
    expect(root.querySelector('#pi-answer-box.open')).toBeTruthy();
    expect(root.querySelector('#pi-input')).toBeTruthy();
  });

  it('places the answer input above 🏳️ 放棄 button and below the action buttons', () => {
    // 使用者要求:輸入框放在「🏳️ 放棄」正上方,「📜 完成線索 / 👁 老天有眼」下面。
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const root = document.getElementById('app')!;
    renderGame(root, game, root);
    const giveUp = root.querySelector('[data-action="give-up"]') as HTMLElement;
    const input = root.querySelector('#pi-answer-box') as HTMLElement;
    // DOM 順序:inputBox 必須在 give-up 之前。
    expect(giveUp.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('「取消」 clears the input box (since closing is no longer meaningful)', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const root = document.getElementById('app')!;
    renderGame(root, game, root);
    const input = root.querySelector<HTMLInputElement>('#pi-input')!;
    input.value = '小提琴';
    root.querySelector<HTMLButtonElement>('[data-action="hide-answer"]')?.click();
    expect(input.value).toBe('');
  });

  it('「送出」 submits the current input value', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    const root = document.getElementById('app')!;
    renderGame(root, game, root);
    const input = root.querySelector<HTMLInputElement>('#pi-input')!;
    input.value = '小提琴';
    root.querySelector<HTMLButtonElement>('[data-action="submit-answer"]')?.click();
    expect(game.state.guesses).toBe(1);
    expect(game.state.ink).toBe(3); // 猜錯 +3 墨水
  });
});
