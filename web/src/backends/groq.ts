// web/src/backends/groq.ts
import {
  extractJson,
  type ChatMessage,
  type LLMBackend,
  type ReasoningFormat,
  type ResponseFormat,
} from './shared';

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3-32b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_429_RETRIES = 3;

/**
 * Minimum interval (ms) between successive API calls to proactively avoid
 * Groq's 6000 TPM rate limit. Each request typically consumes 800–1300 tokens,
 * so ~3s keeps us well under 20 req/min (~60s / 3s = 20 calls, each ~1k tokens = 20k TPM).  */
const MIN_INTERVAL_MS = 3000;

let lastCallTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS && lastCallTime > 0) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
}

/**
 * Parse "try again in X.XXs" from a Groq 429 error body. Returns milliseconds,
 * or null if parsing fails.
 */
function parseRetryAfter(body: string): number | null {
  const m = body.match(/try again in ([\d.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 1000; // +1s buffer
  return null;
}

export class GroqBackend implements LLMBackend {
  constructor(
    private apiKey: string,
    private model: string = GROQ_DEFAULT_MODEL,
  ) {}

  modelName(): string {
    return this.model;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
    reasoningFormat?: ReasoningFormat,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    if (responseFormat) body.response_format = responseFormat;
    if (reasoningFormat) body.reasoning_format = reasoningFormat;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      await throttle();

      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        let reply: string = data.choices[0].message.content;
        if (responseFormat?.type === 'json_object') {
          reply = extractJson(reply);
        }
        return reply;
      }

      if (res.status !== 429 || attempt >= MAX_429_RETRIES) {
        const errText = await res.text();
        throw new Error(`Groq API error (${res.status}): ${errText}`);
      }

      // 429 rate limit — parse suggested delay and retry
      const errBody = await res.text();
      const delay = parseRetryAfter(errBody) ?? 5000 * (attempt + 1);
      console.warn(`Groq 429 (attempt ${attempt + 1}/${MAX_429_RETRIES}): waiting ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error('Groq API: max retries exceeded (429)');
  }
}
