
import type { GroupedQuestion } from './groupPaste';

export interface Settings {
  backend: 'groq' | 'hf';
  apiKey: string;
  model: string;
  answerMode?: 'ai' | 'human';
  humanAnswer?: string;
  numCandidates?: number;
  numQuestions?: number;
  pickedBankQuestions?: string[];
  customQuestions?: string[];
  /** (group, index) tags from the paste-parse feature; used for host commands. */
  groupTags?: GroupedQuestion[];
}

const STORAGE_KEY = 'phantom-ink-settings';

export function loadSettings(): Settings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface QuestionSetupCounts {
  numCandidates: number; // N
  numQuestions: number;  // M
  pickedCount: number;   // X
  customCount: number;   // C
  bankSize: number;      // QUESTION_BANK.length
}

/** Pure validation of the four numeric rules; the UI and tests share it. */
export function validateQuestionSetup(input: QuestionSetupCounts): { ok: boolean; message?: string } {
  const { numCandidates: N, numQuestions: M, pickedCount: X, customCount: C, bankSize } = input;
  const forced = X + C;
  if (![N, M].every(Number.isInteger) || N < 1 || M < 1) {
    return { ok: false, message: '題數必須是正整數' };
  }
  if (M < forced) {
    return { ok: false, message: `使用題數量須大於 勾選(${X})+自訂(${C})=${forced}` };
  }
  if (N <= M) {
    return { ok: false, message: `選題數量(${N})須大於 使用題數量(${M})` };
  }
  if (N > bankSize + C) {
    return { ok: false, message: `選題數量最多為 ${bankSize + C}（題庫 ${bankSize} + 自訂 ${C}）` };
  }
  return { ok: true };
}
