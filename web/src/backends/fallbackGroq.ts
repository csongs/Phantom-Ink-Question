// web/src/backends/fallbackGroq.ts
//
// Model-chain fallback backend for Groq. This file implements the policy in
// docs/LLM-RESILIENCE.md — change that document first, then this file.
//
// Why: Groq rate-limit buckets are PER MODEL (measured 2026-07-09, see
// docs/GROQ-NOTES.md), so on 429 switching to the next model means an
// instantly fresh token bucket. Switching beats waiting — never sleep more
// than QUICK_RETRY_MS on the same model.
import {
  extractJson,
  type ChatMessage,
  type LLMBackend,
  type ReasoningFormat,
  type ResponseFormat,
} from './shared';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export interface ModelConf {
  /** Measured tokens-per-minute limit (free tier, docs/GROQ-NOTES.md). */
  tpm: number;
  /** Reasoning model → hidden thinking tokens count toward TPM/completion. */
  reasoning: boolean;
  /** Auto-add reasoning_format:'hidden' when json_object mode is requested. */
  autoHiddenForJson?: boolean;
  /** Extra body params this model needs (e.g. reasoning_effort for gpt-oss). */
  extraBody?: Record<string, unknown>;
}

export const MODEL_CONF: Record<string, ModelConf> = {
  'qwen/qwen3-32b': { tpm: 6000, reasoning: true, autoHiddenForJson: true },
  'qwen/qwen3.6-27b': { tpm: 8000, reasoning: true, autoHiddenForJson: true },
  'llama-3.3-70b-versatile': { tpm: 12000, reasoning: false },
  'meta-llama/llama-4-scout-17b-16e-instruct': { tpm: 30000, reasoning: false },
  'openai/gpt-oss-120b': { tpm: 8000, reasoning: true, extraBody: { reasoning_effort: 'low' } },
  'openai/gpt-oss-20b': { tpm: 8000, reasoning: true, extraBody: { reasoning_effort: 'low' } },
  'llama-3.1-8b-instant': { tpm: 6000, reasoning: false },
};

/** Ordering rationale: proven-quality model first, then by task-fit × TPM;
 *  non-reasoning models preferred (no think-token burn); 8b only as last
 *  resort. See docs/LLM-RESILIENCE.md §1 before reordering. */
export const CHAINS = {
  generator: [
    'qwen/qwen3-32b',
    'llama-3.3-70b-versatile',
    'qwen/qwen3.6-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'openai/gpt-oss-120b',
  ],
  // No 8b here: bopomofo decoding is beyond it, and a wrong decode poisons
  // stage 2. Failing loudly is better.
  solverStage1: [
    'qwen/qwen3-32b',
    'qwen/qwen3.6-27b',
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  solverStage2: [
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-120b',
    'llama-3.1-8b-instant',
  ],
} as const;
export type ChainName = keyof typeof CHAINS;

// Timing/budget rules (docs/LLM-RESILIENCE.md §2/§4/§5).
const QUICK_RETRY_MS = 2000;
const FINAL_WAIT_MS = 15000;
const SAME_MODEL_INTERVAL_MS = 3000;
const GLOBAL_INTERVAL_MS = 300;
const TPM_BUDGET_RATIO = 0.8;
const MIN_USEFUL_MAX_TOKENS = 256;

/** Conservative CJK-aware token estimate (docs/GROQ-NOTES.md「token 估算」). */
export function estimateTokens(text: string): number {
  // U+3000-U+9FFF (CJK ideographs + bopomofo + CJK punct), U+F900-U+FAFF
  // (compat ideographs), U+FF00-U+FFEF (fullwidth forms).
  const cjkRe = /[　-鿿豈-﫿＀-￯]/g;
  const cjk = (text.match(cjkRe) ?? []).length;
  const words = (text.replace(cjkRe, ' ').match(/\S+/g) ?? []).length;
  return Math.ceil(cjk * 1.7 + words * 1.3 + 50);
}

/** retry-after from the HTTP header (seconds, preferred) or Groq's error body
 *  ("Please try again in 7.66s"). Returns milliseconds, or null. */
export function parseRetryAfterMs(
  headers: { get(name: string): string | null } | null | undefined,
  body: string,
): number | null {
  const h = headers?.get('retry-after');
  if (h && !Number.isNaN(Number(h))) return Math.ceil(Number(h) * 1000);
  const m = body.match(/try again in ([\d.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return null;
}

function confFor(model: string): ModelConf {
  return (
    MODEL_CONF[model] ?? {
      // Unknown (user-typed) model: assume the tightest bucket; guess
      // "reasoning" from the name so param adaptation stays safe.
      tpm: 6000,
      reasoning: /qwen|gpt-oss|deepseek|r1\b|think/i.test(model),
      autoHiddenForJson: true,
    }
  );
}

type Outcome =
  | { kind: 'ok'; reply: string }
  | { kind: 'rate'; retryAfterMs: number | null }
  | { kind: 'too_large' }
  | { kind: 'soft'; reason: string }
  | { kind: 'network'; error: unknown }
  | { kind: 'fatal'; error: Error };

export interface FallbackOpts {
  /** Progress hook; main.ts points this at the visible progress log. */
  onEvent?: (msg: string) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class GroqFallbackBackend implements LLMBackend {
  onEvent: (msg: string) => void;
  lastUsedModel?: string;
  private sleep: (ms: number) => Promise<void>;
  private fetchFn: typeof fetch;
  private now: () => number;
  private models: string[];
  private lastCallAt = new Map<string, number>();
  private lastGlobalAt = 0;

  constructor(
    private apiKey: string,
    chain: ChainName | string[],
    opts: FallbackOpts = {},
  ) {
    this.models = Array.isArray(chain) ? [...chain] : [...CHAINS[chain]];
    this.onEvent = opts.onEvent ?? ((msg) => console.warn(`[GroqFallback] ${msg}`));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = opts.now ?? (() => Date.now());
  }

  /** Chain with the user's own model first (deduped). Empty/undefined → default chain. */
  static withPreferred(model: string | undefined, chain: ChainName): string[] {
    const base = [...CHAINS[chain]] as string[];
    if (!model || model === base[0]) return base;
    return [model, ...base.filter((m) => m !== model)];
  }

  modelName(): string {
    return this.models[0];
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.7,
    maxTokens?: number,
    responseFormat?: ResponseFormat,
    reasoningFormat?: ReasoningFormat,
  ): Promise<string> {
    const promptTokens = estimateTokens(messages.map((m) => m.content).join('\n'));
    const largestTpm = Math.max(...this.models.map((m) => confFor(m).tpm));

    let minRetry: { ms: number; model: string } | null = null;
    let requireTpmAbove = 0; // set after a 413: only bigger-TPM models can help
    let sawNonNetworkFailure = false;
    let lastNetworkError: unknown = null;
    const tried: string[] = [];

    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      const conf = confFor(model);
      const budget = Math.floor(conf.tpm * TPM_BUDGET_RATIO);

      if (conf.tpm <= requireTpmAbove) {
        this.onEvent(`⏭️ 跳過 ${model}（TPM ${conf.tpm} 不足以容納本請求）`);
        continue;
      }

      // Token budget (§4): auto-clamp max_tokens; skip models that can't fit.
      let effMaxTokens = maxTokens;
      if (promptTokens > budget && conf.tpm < largestTpm) {
        this.onEvent(`⏭️ 跳過 ${model}（估計 prompt ${promptTokens}t 超過其預算 ${budget}t）`);
        continue;
      }
      if (maxTokens && promptTokens + maxTokens > budget) {
        const allowed = budget - promptTokens;
        if (allowed < MIN_USEFUL_MAX_TOKENS && conf.tpm < largestTpm) {
          this.onEvent(`⏭️ 跳過 ${model}（TPM 預算不足）`);
          continue;
        }
        effMaxTokens = Math.max(allowed, MIN_USEFUL_MAX_TOKENS);
        this.onEvent(`ℹ️ ${model}：max_tokens 由 ${maxTokens} 下修為 ${effMaxTokens}（TPM 預算）`);
      }

      tried.push(model);
      const outcome = await this.tryModel(
        model, conf, messages, temperature, effMaxTokens, responseFormat, reasoningFormat,
      );

      if (outcome.kind === 'ok') {
        this.lastUsedModel = model;
        if (i > 0) this.onEvent(`✅ 已由 ${model} 完成${i >= 2 ? '（備援模型，品質可能略降）' : ''}`);
        return outcome.reply;
      }
      if (outcome.kind === 'fatal') throw outcome.error;
      if (outcome.kind === 'network') {
        lastNetworkError = outcome.error;
        this.onEvent(`⚠️ ${model} 連線失敗，改用下一個模型⋯⋯`);
        continue;
      }
      sawNonNetworkFailure = true;
      if (outcome.kind === 'rate') {
        if (outcome.retryAfterMs != null && (!minRetry || outcome.retryAfterMs < minRetry.ms)) {
          minRetry = { ms: outcome.retryAfterMs, model };
        }
        const next = this.models[i + 1];
        if (next) this.onEvent(`⚠️ ${model} 達到限速，改用 ${next}⋯⋯`);
        continue;
      }
      if (outcome.kind === 'too_large') {
        requireTpmAbove = conf.tpm;
        this.onEvent(`⚠️ ${model} 回報請求過大，改用更大額度的模型⋯⋯`);
        continue;
      }
      this.onEvent(`⚠️ ${model} 失敗（${outcome.reason}），改用下一個模型⋯⋯`);
    }

    // Pure connectivity problem — rethrow so the UI shows the network/CORS
    // message instead of a misleading rate-limit one.
    if (!sawNonNetworkFailure && lastNetworkError) throw lastNetworkError;

    // Whole chain failed. If the shortest wait is small, wait it out once.
    if (minRetry && minRetry.ms <= FINAL_WAIT_MS) {
      this.onEvent(`⏳ 所有模型都在限速中，約 ${Math.ceil(minRetry.ms / 1000)} 秒後自動重試（${minRetry.model}）⋯⋯`);
      await this.sleep(minRetry.ms + 500);
      const conf = confFor(minRetry.model);
      const outcome = await this.tryModel(
        minRetry.model, conf, messages, temperature, maxTokens, responseFormat, reasoningFormat,
      );
      if (outcome.kind === 'ok') { this.lastUsedModel = minRetry.model; return outcome.reply; }
      if (outcome.kind === 'fatal') throw outcome.error;
    }

    if (requireTpmAbove > 0 && !minRetry) {
      throw new Error(
        `單次請求過大（估計 prompt 約 ${promptTokens} tokens），連最大額度的模型都放不下。請縮短輸入內容再試。`,
      );
    }
    throw new Error(
      `所有模型都達到限速上限${
        minRetry ? `，最快約 ${Math.ceil(minRetry.ms / 1000)} 秒後恢復（${minRetry.model}）` : ''
      }。已嘗試：${tried.join('、')}。若持續發生，可到 console.groq.com 升級 Developer tier（綁卡即約 10 倍額度）。`,
    );
  }

  /** One model: build adapted body, throttle, fetch, classify the result.
   *  A 429 with a short retry-after gets ONE quick same-model retry. */
  private async tryModel(
    model: string,
    conf: ModelConf,
    messages: ChatMessage[],
    temperature: number,
    maxTokens: number | undefined,
    responseFormat: ResponseFormat | undefined,
    reasoningFormat: ReasoningFormat | undefined,
  ): Promise<Outcome> {
    const body: Record<string, unknown> = { model, messages, temperature };
    if (maxTokens) body.max_tokens = maxTokens;
    if (responseFormat) body.response_format = responseFormat;
    // Param adaptation (§3): reasoning params only go to reasoning models;
    // models driven by reasoning_effort (gpt-oss) never get reasoning_format.
    if (conf.reasoning && !conf.extraBody?.reasoning_effort) {
      const rf = reasoningFormat ?? (responseFormat && conf.autoHiddenForJson ? 'hidden' : undefined);
      if (rf) body.reasoning_format = rf;
    }
    if (conf.extraBody) Object.assign(body, conf.extraBody);

    for (let attempt = 0; attempt < 2; attempt++) {
      await this.throttle(model);

      let res: Response;
      try {
        res = await this.fetchFn(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return { kind: 'network', error: err };
      }

      if (res.ok) {
        const data = await res.json();
        let reply: string = data?.choices?.[0]?.message?.content ?? '';
        if (!reply || !reply.trim()) {
          console.error(`[GroqFallback] ${model} 回傳空 content：`, JSON.stringify(data));
          return { kind: 'soft', reason: '空回應（可能思考 token 用盡）' };
        }
        if (responseFormat?.type === 'json_object') reply = extractJson(reply);
        return { kind: 'ok', reply };
      }

      const errText = await res.text();

      if (res.status === 401) {
        return { kind: 'fatal', error: new Error('Groq API key 無效（401）。請到設定畫面重新填入正確的 key。') };
      }
      if (res.status === 413 || /request too large/i.test(errText)) {
        console.warn(`[GroqFallback] ${model} 413: ${errText}`);
        return { kind: 'too_large' };
      }
      if (res.status === 429) {
        const retryMs = parseRetryAfterMs(res.headers, errText);
        if (attempt === 0 && retryMs != null && retryMs <= QUICK_RETRY_MS) {
          this.onEvent(`⏳ ${model} 限速中，${(retryMs / 1000).toFixed(1)} 秒後重試⋯⋯`);
          await this.sleep(retryMs + 500);
          continue; // one quick same-model retry
        }
        return { kind: 'rate', retryAfterMs: retryMs };
      }
      console.error(`[GroqFallback] ${model} HTTP ${res.status}: ${errText}`);
      if (res.status === 404) {
        return { kind: 'soft', reason: '模型不存在或已下架（模型鏈需要更新，見 docs/GROQ-NOTES.md 重測方法）' };
      }
      return { kind: 'soft', reason: `HTTP ${res.status}` };
    }
    // Unreachable in practice (the loop always returns), but satisfies TS.
    return { kind: 'soft', reason: 'retry loop exhausted' };
  }

  /** ≥3s between calls to the SAME model (its own bucket), ≥300ms globally. */
  private async throttle(model: string): Promise<void> {
    const now = this.now();
    const modelWait = (this.lastCallAt.get(model) ?? -Infinity) + SAME_MODEL_INTERVAL_MS - now;
    const globalWait = this.lastGlobalAt <= 0 ? 0 : this.lastGlobalAt + GLOBAL_INTERVAL_MS - now;
    const wait = Math.max(modelWait, globalWait, 0);
    if (wait > 0 && Number.isFinite(wait)) await this.sleep(wait);
    const t = this.now();
    this.lastGlobalAt = t;
    this.lastCallAt.set(model, t);
  }
}
