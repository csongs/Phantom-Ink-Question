// web/src/backends/shared.ts

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ResponseFormat {
  type: 'json_object';
}

export interface LLMBackend {
  modelName(): string;
  chat(
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
  ): Promise<string>;
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  const braceStart = text.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return text.slice(braceStart, i + 1).trim();
      }
    }
  }
  return text;
}
