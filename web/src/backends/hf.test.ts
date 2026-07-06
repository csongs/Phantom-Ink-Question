// web/src/backends/hf.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HFBackend, HF_DEFAULT_MODEL } from './hf';

describe('HFBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the expected request shape and returns the reply text', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello back' } }] }),
    });

    const backend = new HFBackend('hf_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7);

    expect(reply).toBe('hello back');
    expect(fetch).toHaveBeenCalledWith(
      'https://router.huggingface.co/hf-inference/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer hf_test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe(HF_DEFAULT_MODEL);
  });

  it('never sends response_format to the API, but still extracts JSON locally', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"x": 1}\n```' } }],
      }),
    });

    const backend = new HFBackend('hf_test');
    const reply = await backend.chat([{ role: 'user', content: 'hi' }], 0.7, undefined, {
      type: 'json_object',
    });

    expect(reply).toBe('{"x": 1}');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('throws with the response body when the request fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Invalid username or password."}',
    });

    const backend = new HFBackend('bad-key');
    await expect(backend.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
  });
});
