
export interface Settings {
  backend: 'groq' | 'hf';
  apiKey: string;
  model: string;
  answerMode?: 'ai' | 'human';
  humanAnswer?: string;
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
