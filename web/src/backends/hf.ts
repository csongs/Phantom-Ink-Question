// web/src/backends/hf.ts
import { extractJson, type ChatMessage, type LLMBackend, type ResponseFormat } from './shared';

export const HF_DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const HF_ENDPOINT = 'https://router.huggingface.co/hf-inference/v1/chat/completions';
const MAX_RETRIES = 3;

export class HFBackend implements LLMBackend {
  constructor(
    private apiKey: string,
    private model: string = HF_DEFAULT_MODEL,
  ) {}

  modelName(): string {
    return this.model;
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
    _reasoningFormat?: unknown,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature,
    };
    if (maxTokens) body.max_tokens = maxTokens;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(HF_ENDPOINT, {
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

      if (res.status === 429 && attempt + 1 < MAX_RETRIES) {
        const retryAfter = res.headers.get('Retry-After');
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      const errText = await res.text();
      throw new Error(`HF Inference API error (${res.status}): ${errText}`);
    }

    throw new Error(`HF Inference API: exhausted ${MAX_RETRIES} retries`);
  }
}
