// web/src/backends/fallbackGroq.test.ts
//
// Exercises every row of the decision table in docs/LLM-RESILIENCE.md §2.
// fetch/sleep/now are injected, so no real timers and no network.
import { describe, it, expect, vi } from 'vitest';
import {
  GroqFallbackBackend,
  estimateTokens,
  parseRetryAfterMs,
} from './fallbackGroq';

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  };
}

function errResponse(status: number, body = '', headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => ({}),
    text: async () => body,
  };
}

function makeBackend(chain: string[], fetchImpl: ReturnType<typeof vi.fn>) {
  const sleep = vi.fn(async () => {});
  const onEvent = vi.fn();
  const backend = new GroqFallbackBackend('gsk_test', chain, {
    fetchFn: fetchImpl as unknown as typeof fetch,
    sleep,
    now: () => 1_000_000,
    onEvent,
  });
  return { backend, sleep, onEvent };
}

const HI = [{ role: 'user' as const, content: 'hi' }];

describe('GroqFallbackBackend', () => {
  it('succeeds on the first model and auto-adds reasoning_format for qwen + json_object', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('```json\n{"x": 1}\n```'));
    const { backend } = makeBackend(['qwen/qwen3-32b'], fetchMock);

    const reply = await backend.chat(HI, 0.4, 512, { type: 'json_object' });

    expect(reply).toBe('{"x": 1}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('qwen/qwen3-32b');
    expect(body.reasoning_format).toBe('hidden'); // FL-4 guard
    expect(body.max_tokens).toBe(512);
  });

  it('switches to the next model on 429 with a long retry-after, adapting params', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429, 'Please try again in 30s'))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const { backend, onEvent } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    const reply = await backend.chat(HI, 0.4, 512, { type: 'json_object' }, 'hidden');

    expect(reply).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.model).toBe('llama-3.3-70b-versatile');
    // Non-reasoning model must NOT receive reasoning params (§3).
    expect(second.reasoning_format).toBeUndefined();
    expect(onEvent.mock.calls.some((c) => String(c[0]).includes('改用'))).toBe(true);
  });

  it('quick-retries the SAME model once when retry-after ≤ 2s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429, '', { 'retry-after': '1' }))
      .mockResolvedValueOnce(okResponse('done'));
    const { backend, sleep } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    const reply = await backend.chat(HI);

    expect(reply).toBe('done');
    const models = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model);
    expect(models).toEqual(['qwen/qwen3-32b', 'qwen/qwen3-32b']);
    expect(sleep).toHaveBeenCalledWith(1500); // retry-after 1s + 0.5s buffer
  });

  it('on 413 skips smaller-TPM models and jumps to a larger one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(413, 'Request too large'))
      .mockResolvedValueOnce(okResponse('big model reply'));
    const { backend } = makeBackend(
      [
        'llama-3.3-70b-versatile', // 12000 → 413
        'llama-3.1-8b-instant', // 6000 → must be skipped (smaller than 12000)
        'meta-llama/llama-4-scout-17b-16e-instruct', // 30000 → tried
      ],
      fetchMock,
    );

    const reply = await backend.chat(HI);

    expect(reply).toBe('big model reply');
    const models = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model);
    expect(models).toEqual([
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ]);
  });

  it('throws immediately on 401 without trying other models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(401, 'invalid key'));
    const { backend } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    await expect(backend.chat(HI)).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats empty content as failure and falls through to the next model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(''))
      .mockResolvedValueOnce(okResponse('real reply'));
    const { backend } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    await expect(backend.chat(HI)).resolves.toBe('real reply');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls through on 404 (decommissioned model) with an update hint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(404, 'model not found'))
      .mockResolvedValueOnce(okResponse('ok'));
    const { backend, onEvent } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    await expect(backend.chat(HI)).resolves.toBe('ok');
    expect(onEvent.mock.calls.some((c) => String(c[0]).includes('下架'))).toBe(true);
  });

  it('when every model is limited for long, throws a friendly error naming the shortest wait', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(429, 'Please try again in 120s'));
    const { backend } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    await expect(backend.chat(HI)).rejects.toThrow(/所有模型.*120 秒/s);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no final wait: 120s > 15s cap
  });

  it('when every model is limited briefly, waits once and retries the shortest-wait model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429, 'Please try again in 8s'))
      .mockResolvedValueOnce(errResponse(429, 'Please try again in 5s'))
      .mockResolvedValueOnce(okResponse('after wait'));
    const { backend, sleep } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    await expect(backend.chat(HI)).resolves.toBe('after wait');
    expect(sleep).toHaveBeenCalledWith(5500); // shortest retry-after (5s) + buffer
    const models = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model);
    expect(models[2]).toBe('llama-3.3-70b-versatile'); // the 5s (shortest) one
  });

  it('skips models whose TPM budget cannot even fit the prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    const { backend } = makeBackend(
      ['qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'],
      fetchMock,
    );
    // ~3500 CJK chars ≈ 6000 estimated tokens > qwen's 4800 budget (6000×0.8).
    const bigPrompt = [{ role: 'user' as const, content: '謎'.repeat(3500) }];

    await backend.chat(bigPrompt);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('clamps max_tokens so prompt + completion stays inside the TPM budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    const { backend } = makeBackend(['llama-3.3-70b-versatile'], fetchMock);

    await backend.chat(HI, 0.7, 20000);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const budget = Math.floor(12000 * 0.8);
    expect(body.max_tokens).toBe(budget - estimateTokens('hi'));
  });

  it('gpt-oss gets reasoning_effort low and never reasoning_format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"a":1}'));
    const { backend } = makeBackend(['openai/gpt-oss-120b'], fetchMock);

    await backend.chat(HI, 0.4, 512, { type: 'json_object' }, 'hidden');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe('low');
    expect(body.reasoning_format).toBeUndefined();
  });

  it('rethrows the original network error when ALL models fail to connect', async () => {
    const netErr = new TypeError('Failed to fetch');
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    const { backend } = makeBackend(
      ['qwen/qwen3-32b', 'llama-3.3-70b-versatile'],
      fetchMock,
    );

    // TypeError must surface so main.ts shows the CORS/network message.
    await expect(backend.chat(HI)).rejects.toBe(netErr);
  });
});

describe('withPreferred', () => {
  it('returns the default chain when no model is given', () => {
    expect(GroqFallbackBackend.withPreferred(undefined, 'generator')[0]).toBe('qwen/qwen3-32b');
  });

  it('prepends the user model and dedupes it from the rest', () => {
    const chain = GroqFallbackBackend.withPreferred('llama-3.3-70b-versatile', 'generator');
    expect(chain[0]).toBe('llama-3.3-70b-versatile');
    expect(chain.filter((m) => m === 'llama-3.3-70b-versatile')).toHaveLength(1);
  });

  it('keeps unknown user models at the head of the chain', () => {
    const chain = GroqFallbackBackend.withPreferred('my-custom-model', 'solverStage2');
    expect(chain[0]).toBe('my-custom-model');
    expect(chain).toContain('llama-3.3-70b-versatile');
  });
});

describe('helpers', () => {
  it('estimateTokens weighs CJK chars ~1.7x plus a fixed overhead', () => {
    expect(estimateTokens('謎'.repeat(100))).toBe(Math.ceil(100 * 1.7 + 50));
    expect(estimateTokens('hello world')).toBe(Math.ceil(2 * 1.3 + 50));
  });

  it('parseRetryAfterMs prefers the header and falls back to the body text', () => {
    expect(parseRetryAfterMs({ get: () => '7' }, 'whatever')).toBe(7000);
    expect(parseRetryAfterMs({ get: () => null }, 'Please try again in 7.66s')).toBe(7660);
    expect(parseRetryAfterMs({ get: () => null }, 'no hint here')).toBeNull();
  });
});
