import { EVAL_MODELS } from '../constants.js';
import { AssayError } from '../core/errors.js';

export type ProviderName = 'anthropic' | 'openai';

export interface GenerateOptions {
  /** Passed through only where the API supports it (gpt-5 family does not). */
  temperature?: number;
  maxTokens?: number;
}

/** The judge model behind `assay eval` — implemented with raw fetch, no SDKs. */
export interface Provider {
  name: ProviderName;
  model: string;
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  countCostUSD(inTokens: number, outTokens: number): number;
}

/**
 * USD per million tokens. Pricing snapshot 2026-07-02 — verify against the
 * provider pricing pages (anthropic.com/pricing, openai.com/api/pricing)
 * before trusting a decimal. These power cost ESTIMATES, never billing.
 */
export const PRICE_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-5-mini': { input: 0.25, output: 2 },
};

const DEFAULT_MAX_TOKENS = 1024;
const ERROR_BODY_MAX_CHARS = 300;

/** Injection points so tests run with zero network and a synthetic env. */
export interface ProviderDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

function requireKey(env: Record<string, string | undefined>, name: string): string {
  const key = env[name];
  if (!key) {
    throw new AssayError(
      `${name} is not set`,
      'assay eval is bring-your-own-key: export the key in your environment (keys are never read from flags or config files)',
    );
  }
  return key;
}

function pricesFor(name: ProviderName, model: string): { input: number; output: number } {
  // Unknown model override: fall back to the provider's default-model prices
  // so the estimate stays an estimate instead of a silent zero.
  return PRICE_PER_MTOK_USD[model] ?? PRICE_PER_MTOK_USD[EVAL_MODELS[name]]!;
}

async function postJSON(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).trim().slice(0, ERROR_BODY_MAX_CHARS);
    throw new AssayError(
      `${label} API error ${res.status}${detail ? `: ${detail}` : ''}`,
      'check the API key, the configured eval.model, and the provider status page',
    );
  }
  return (await res.json()) as unknown;
}

export function createProvider(
  name: ProviderName,
  model: string,
  deps: ProviderDeps = {},
): Provider {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const countCostUSD = (inTokens: number, outTokens: number): number => {
    const p = pricesFor(name, model);
    return (inTokens * p.input + outTokens * p.output) / 1_000_000;
  };

  if (name === 'anthropic') {
    const key = requireKey(env, 'ANTHROPIC_API_KEY');
    return {
      name,
      model,
      countCostUSD,
      async generate(prompt, opts = {}) {
        const json = (await postJSON(
          fetchImpl,
          'anthropic',
          'https://api.anthropic.com/v1/messages',
          { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          {
            model,
            max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            messages: [{ role: 'user', content: prompt }],
          },
        )) as { content?: Array<{ text?: unknown }> };
        const text = json.content?.[0]?.text;
        if (typeof text !== 'string') {
          throw new AssayError('anthropic API response had no text content');
        }
        return text;
      },
    };
  }

  const key = requireKey(env, 'OPENAI_API_KEY');
  return {
    name,
    model,
    countCostUSD,
    async generate(prompt, opts = {}) {
      const json = (await postJSON(
        fetchImpl,
        'openai',
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${key}` },
        {
          model,
          max_completion_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          // temperature intentionally omitted: the gpt-5 family accepts only
          // the API default on chat completions.
          messages: [{ role: 'user', content: prompt }],
        },
      )) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new AssayError('openai API response had no message content');
      }
      return text;
    },
  };
}
