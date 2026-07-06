// web/src/backends/groq.ts
import { extractJson, type ChatMessage, type LLMBackend, type ResponseFormat } from './shared';

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3-32b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

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
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    if (responseFormat) body.response_format = responseFormat;

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let reply: string = data.choices[0].message.content;
    if (responseFormat?.type === 'json_object') {
      reply = extractJson(reply);
    }
    return reply;
  }
}
