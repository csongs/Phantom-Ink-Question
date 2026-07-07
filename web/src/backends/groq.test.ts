// web/src/backends/groq.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroqBackend, GROQ_DEFAULT_MODEL } from './groq';

describe('GroqBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the expected request shape and returns the reply text', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello back' } }] }),
    });

    const backend = new GroqBackend('gsk_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7);

    expect(reply).toBe('hello back');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe(GROQ_DEFAULT_MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.7);
  });

  it('extracts JSON from the reply when response_format is json_object', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"x": 1}\n```' } }],
      }),
    });

    const backend = new GroqBackend('gsk_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7, undefined, {
      type: 'json_object',
    });

    expect(reply).toBe('{"x": 1}');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('forwards reasoning_format to the request body when provided', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"x": 1}' } }] }),
    });

    const backend = new GroqBackend('gsk_test');
    await backend.chat([{ role: 'user', content: 'hi' }], 0.7, undefined, { type: 'json_object' }, 'hidden');

    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.reasoning_format).toBe('hidden');
  });

  it('throws with the response body when the request fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid key"}',
    });

    const backend = new GroqBackend('bad-key');
    await expect(backend.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
  });

  it('uses a custom model when provided', () => {
    const backend = new GroqBackend('gsk_test', 'llama-3.3-70b-versatile');
    expect(backend.modelName()).toBe('llama-3.3-70b-versatile');
  });
});
