// web/src/generator/fakeBackend.ts
import type { ChatMessage, LLMBackend, ReasoningFormat, ResponseFormat } from '../backends/shared';

/** Scriptable LLMBackend for tests: returns queued replies in call order. */
export class FakeBackend implements LLMBackend {
  private queue: string[];
  public calls: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    responseFormat?: ResponseFormat;
    reasoningFormat?: ReasoningFormat;
  }[] = [];

  constructor(replies: string[]) {
    this.queue = [...replies];
  }

  modelName(): string {
    return 'fake-model';
  }

  async chat(
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
    reasoningFormat?: ReasoningFormat,
  ): Promise<string> {
    this.calls.push({ messages, temperature, maxTokens, responseFormat, reasoningFormat });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('FakeBackend: no more scripted replies queued');
    }
    return next;
  }
}
