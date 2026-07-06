// web/src/generator/models.ts

export interface QuestionItem {
  question: string;
  reply: string;
  isCustom: boolean;
}

export interface QuestionSet {
  answer: string;
  questions: QuestionItem[];
}

export interface ReviewResult {
  score: number;
  passed: boolean;
  comments: string[];
}

export interface SimulationRound {
  roundNumber: number;
  question: string;
  reply: string;
  inkRevealed: string;
  playerGuess: string;
  guessedCorrectly: boolean;
}

export interface SimulationResult {
  guessRound: number;
  inkUsed: number;
  confidence: number;
  tooEasy: boolean;
  tooHard: boolean;
  reason: string;
  rounds: SimulationRound[];
}

export interface QuestionSetWithMeta {
  answer: string;
  questions: QuestionItem[];
  review: ReviewResult | null;
  simulation: SimulationResult | null;
  retryCount: number;
}
