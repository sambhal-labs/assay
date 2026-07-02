import { describe, expect, it } from 'vitest';
import { AssayError } from '../../src/core/errors.js';
import { createProvider, PRICE_PER_MTOK_USD } from '../../src/eval/providers.js';

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

describe('createProvider — key handling', () => {
  it('throws AssayError when ANTHROPIC_API_KEY is missing', () => {
    expect(() => createProvider('anthropic', 'claude-haiku-4-5', { env: {} })).toThrowError(
      AssayError,
    );
    expect(() => createProvider('anthropic', 'claude-haiku-4-5', { env: {} })).toThrowError(
      'ANTHROPIC_API_KEY is not set',
    );
  });

  it('throws AssayError when OPENAI_API_KEY is missing', () => {
    expect(() => createProvider('openai', 'gpt-5-mini', { env: {} })).toThrowError(
      'OPENAI_API_KEY is not set',
    );
  });
});

describe('createProvider — anthropic', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant-test' };

  it('POSTs the messages API shape and returns content[0].text', async () => {
    const { fetch, calls } = fakeFetch(200, { content: [{ type: 'text', text: 'hello' }] });
    const provider = createProvider('anthropic', 'claude-haiku-4-5', { env, fetch });

    const text = await provider.generate('the prompt', { temperature: 0.7 });
    expect(text).toBe('hello');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: 0.7,
      messages: [{ role: 'user', content: 'the prompt' }],
    });
  });

  it('omits temperature when not requested', async () => {
    const { fetch, calls } = fakeFetch(200, { content: [{ text: 'x' }] });
    await createProvider('anthropic', 'claude-haiku-4-5', { env, fetch }).generate('p');
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty('temperature');
  });

  it('turns a non-2xx response into an AssayError with status and trimmed body', async () => {
    const { fetch } = fakeFetch(429, { error: { message: 'rate limited' } });
    const provider = createProvider('anthropic', 'claude-haiku-4-5', { env, fetch });
    await expect(provider.generate('p')).rejects.toThrowError(/anthropic API error 429/);
  });

  it('rejects a 2xx response with no text content', async () => {
    const { fetch } = fakeFetch(200, { content: [] });
    const provider = createProvider('anthropic', 'claude-haiku-4-5', { env, fetch });
    await expect(provider.generate('p')).rejects.toThrowError(AssayError);
  });
});

describe('createProvider — openai', () => {
  const env = { OPENAI_API_KEY: 'sk-oai-test' };

  it('POSTs chat completions with a bearer token and never sends temperature', async () => {
    const { fetch, calls } = fakeFetch(200, { choices: [{ message: { content: 'yo' } }] });
    const provider = createProvider('openai', 'gpt-5-mini', { env, fetch });

    const text = await provider.generate('the prompt', { temperature: 0.7 });
    expect(text).toBe('yo');

    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-oai-test');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-5-mini');
    expect(body).not.toHaveProperty('temperature');
  });

  it('turns a non-2xx response into an AssayError with the status', async () => {
    const { fetch } = fakeFetch(500, 'boom');
    const provider = createProvider('openai', 'gpt-5-mini', { env, fetch });
    await expect(provider.generate('p')).rejects.toThrowError(/openai API error 500/);
  });
});

describe('countCostUSD', () => {
  it('uses the snapshot prices per million tokens', () => {
    const anthropic = createProvider('anthropic', 'claude-haiku-4-5', {
      env: { ANTHROPIC_API_KEY: 'k' },
    });
    // 1M in @ $1 + 1M out @ $5
    expect(anthropic.countCostUSD(1_000_000, 1_000_000)).toBeCloseTo(6, 10);
    expect(anthropic.countCostUSD(10_000, 2_000)).toBeCloseTo(0.02, 10);

    const openai = createProvider('openai', 'gpt-5-mini', { env: { OPENAI_API_KEY: 'k' } });
    expect(openai.countCostUSD(1_000_000, 1_000_000)).toBeCloseTo(2.25, 10);
  });

  it('falls back to the default-model prices for unknown model overrides', () => {
    const provider = createProvider('anthropic', 'claude-nonexistent-9', {
      env: { ANTHROPIC_API_KEY: 'k' },
    });
    const base = PRICE_PER_MTOK_USD['claude-haiku-4-5']!;
    expect(provider.countCostUSD(1_000_000, 0)).toBeCloseTo(base.input, 10);
  });
});
