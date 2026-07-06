import { describe, it, expect } from 'vitest';
import { PhantomInkGame, type GameQuestion } from './game';

function makeQuestions(): GameQuestion[] {
  return [
    { question: 'Q1', cells: ['ㄍ', 'ㄤ', 'ˉ'], total: 3 },
    { question: 'Q2', cells: ['ㄑ', 'ㄧ', 'ㄣ', 'ˊ'], total: 4 },
    { question: 'Q3', cells: ['ㄅ'], total: 1 },
    { question: 'Q4', cells: ['ㄆ'], total: 1 },
    { question: 'Q5', cells: ['ㄇ'], total: 1 },
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

  it('showAnswerInput sets answerBoxOpen to true', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    expect(game.state.answerBoxOpen).toBe(false);
    game.showAnswerInput();
    expect(game.state.answerBoxOpen).toBe(true);
  });

  it('hideAnswerInput sets answerBoxOpen back to false', () => {
    const game = new PhantomInkGame(makeQuestions(), '鋼琴');
    game.showAnswerInput();
    expect(game.state.answerBoxOpen).toBe(true);
    game.hideAnswerInput();
    expect(game.state.answerBoxOpen).toBe(false);
  });
});
