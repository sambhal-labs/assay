import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssayError } from '../../src/core/errors.js';
import type { Provider } from '../../src/eval/providers.js';
import { runTriggerEval, SCENARIO_COUNT } from '../../src/eval/run.js';

const TARGET = {
  name: 'invoice-ocr',
  description:
    'Extract line items, totals, and vendor details from scanned invoices and receipts. Use when the user shares an invoice image or PDF and wants its contents as structured data.',
};

const POSITIVES = [
  'Pull the line items out of this scanned invoice into JSON.',
  'What is the total on this receipt photo?',
  "Here's a vendor invoice PDF — extract the amounts and due date.",
  'Digitize these five scanned receipts into a table.',
  'Read the vendor name and invoice number off this scan.',
  'Turn this photographed invoice into structured data.',
  'Extract every line item and its price from the attached invoice.',
  'Get the tax and grand total from this receipt scan.',
];

const userRequestOf = (prompt: string): string =>
  /User request:\n([\s\S]*?)\n\nWhich skill/.exec(prompt)?.[1] ?? '';

const isGenerationPrompt = (prompt: string): boolean => prompt.includes('JSON array');

interface FakeProvider extends Provider {
  calls: { prompt: string; temperature: number | undefined }[];
}

/**
 * A canned judge: answers the generation prompt with POSITIVES and routes a
 * request to the target exactly when `selects` says so. `overrides` rewires
 * individual responses by 1-based call number to exercise retry paths.
 */
function fakeProvider(
  selects: (userRequest: string) => boolean,
  overrides: Record<number, string> = {},
): FakeProvider {
  const calls: FakeProvider['calls'] = [];
  return {
    name: 'anthropic',
    model: 'fake-judge',
    calls,
    countCostUSD: (inTok, outTok) => (inTok + outTok) / 1_000_000,
    async generate(prompt, opts = {}) {
      calls.push({ prompt, temperature: opts.temperature });
      const canned = overrides[calls.length];
      if (canned !== undefined) return canned;
      if (isGenerationPrompt(prompt)) return JSON.stringify(POSITIVES);
      return JSON.stringify({ skill: selects(userRequestOf(prompt)) ? TARGET.name : null });
    },
  };
}

const perfectJudge = () => fakeProvider((req) => POSITIVES.includes(req));

describe('runTriggerEval', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'assay-eval-run-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const options = {
    providerName: 'anthropic' as const,
    model: 'fake-judge',
    maxUSD: 0.5,
    yes: true,
  };
  const deps = (provider: Provider, extra: Record<string, unknown> = {}) => ({
    provider,
    cacheDir,
    stderr: () => {},
    ...extra,
  });

  it('a perfect judge scores F1 1 across 16 scenarios in 17 calls', async () => {
    const provider = perfectJudge();
    const result = await runTriggerEval(TARGET, options, deps(provider));

    expect(result).toEqual({
      provider: 'anthropic',
      model: 'fake-judge',
      precision: 1,
      recall: 1,
      f1: 1,
      scenarios: SCENARIO_COUNT,
      runDate: new Date().toISOString().slice(0, 10),
    });
    expect(provider.calls).toHaveLength(17);

    // Generation runs hot (0.7); routing runs deterministic (0).
    expect(provider.calls[0]!.temperature).toBe(0.7);
    for (const call of provider.calls.slice(1)) expect(call.temperature).toBe(0);

    // Every routing prompt offers exactly 12 skills, target included once.
    for (const call of provider.calls.slice(1)) {
      const listed = call.prompt.split('\n').filter((l) => l.startsWith('- '));
      expect(listed).toHaveLength(12);
      expect(listed.filter((l) => l.startsWith(`- ${TARGET.name}:`))).toHaveLength(1);
    }
  });

  it('routing misses reduce recall; false claims reduce precision', async () => {
    // Judge refuses two positives.
    const missing = new Set([POSITIVES[0]!, POSITIVES[1]!]);
    const missy = fakeProvider((req) => POSITIVES.includes(req) && !missing.has(req));
    const missed = await runTriggerEval(TARGET, options, deps(missy));
    expect(missed!.recall).toBe(0.75);
    expect(missed!.precision).toBe(1);
    expect(missed!.f1).toBeCloseTo((2 * 0.75) / 1.75, 4);

    await rm(cacheDir, { recursive: true, force: true });

    // Judge claims the target for every request, negatives included.
    const greedy = fakeProvider(() => true);
    const claimed = await runTriggerEval(TARGET, options, deps(greedy));
    expect(claimed!.recall).toBe(1);
    expect(claimed!.precision).toBe(0.5);
  });

  it('retries once on unparseable output, then counts a routing miss', async () => {
    // Call 2 (first routing scenario) answers prose, then parses on retry:
    // still 8/8 recall, one extra call.
    const withRetry = fakeProvider((req) => POSITIVES.includes(req), {
      2: 'Hmm, I think the invoice skill fits best here.',
    });
    const result = await runTriggerEval(TARGET, options, deps(withRetry));
    expect(withRetry.calls).toHaveLength(18);
    expect(result!.recall).toBe(1);

    await rm(cacheDir, { recursive: true, force: true });

    // Both attempts unparseable → that positive scenario is a miss.
    const stillBroken = fakeProvider((req) => POSITIVES.includes(req), {
      2: 'no json here',
      3: 'still no json',
    });
    const missed = await runTriggerEval(TARGET, options, deps(stillBroken));
    expect(missed!.recall).toBe(0.875);
    expect(missed!.precision).toBe(1);
  });

  it('retries the positive generation once, then fails with AssayError', async () => {
    const oneBadGen = fakeProvider((req) => POSITIVES.includes(req), { 1: 'not an array' });
    const result = await runTriggerEval(TARGET, options, deps(oneBadGen));
    expect(result!.f1).toBe(1);
    expect(oneBadGen.calls).toHaveLength(18);

    await rm(cacheDir, { recursive: true, force: true });

    const alwaysBadGen = fakeProvider(() => false, { 1: 'nope', 2: 'still nope' });
    await expect(runTriggerEval(TARGET, options, deps(alwaysBadGen))).rejects.toThrowError(
      AssayError,
    );
  });

  it('aborts with AssayError when the estimate exceeds maxUSD, before confirmation', async () => {
    const provider = perfectJudge();
    const confirm = vi.fn(async () => true);
    await expect(
      runTriggerEval(
        TARGET,
        { ...options, yes: false, maxUSD: 0.000001 },
        deps(provider, {
          confirm,
          isTTY: true,
        }),
      ),
    ).rejects.toThrowError(/exceeds eval.maxUSD/);
    expect(confirm).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses to run without --yes when stdin is not a TTY', async () => {
    const provider = perfectJudge();
    await expect(
      runTriggerEval(TARGET, { ...options, yes: false }, deps(provider, { isTTY: false })),
    ).rejects.toThrowError(/--yes|not a TTY/);
    expect(provider.calls).toHaveLength(0);
  });

  it('returns null and makes zero calls when the user declines the estimate', async () => {
    const provider = perfectJudge();
    const confirm = vi.fn(async () => false);
    const result = await runTriggerEval(
      TARGET,
      { ...options, yes: false },
      deps(provider, { confirm, isTTY: true }),
    );
    expect(result).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    expect(provider.calls).toHaveLength(0);
  });

  it('proceeds when the user confirms interactively', async () => {
    const provider = perfectJudge();
    const result = await runTriggerEval(
      TARGET,
      { ...options, yes: false },
      deps(provider, { confirm: async () => true, isTTY: true }),
    );
    expect(result!.f1).toBe(1);
  });

  it('prints the cost estimate to stderr before any call', async () => {
    const lines: string[] = [];
    const provider = perfectJudge();
    await runTriggerEval(TARGET, options, { provider, cacheDir, stderr: (l) => lines.push(l) });
    expect(lines[0]).toMatch(/eval cost estimate: ~\$\d/);
    expect(lines[0]).toContain('fake-judge');
  });

  it('a warm rerun replays the cache: zero provider calls, "(cached)" on stderr', async () => {
    const first = await runTriggerEval(TARGET, options, deps(perfectJudge()));

    const dead: Provider = {
      name: 'anthropic',
      model: 'fake-judge',
      countCostUSD: () => 0,
      generate: async () => {
        throw new Error('network call on a warm cache');
      },
    };
    const lines: string[] = [];
    const second = await runTriggerEval(TARGET, options, {
      provider: dead,
      cacheDir,
      stderr: (l) => lines.push(l),
    });

    expect(second).toEqual(first);
    expect(lines.join('\n')).toContain('(cached)');
  });

  it('the routing scenario is deterministic per skill description', async () => {
    const a = perfectJudge();
    await runTriggerEval(TARGET, options, deps(a));
    await rm(cacheDir, { recursive: true, force: true });
    const b = perfectJudge();
    await runTriggerEval(TARGET, options, deps(b));
    expect(a.calls.map((c) => c.prompt)).toEqual(b.calls.map((c) => c.prompt));
  });

  it('rejects a skill whose description matches too small a corpus', async () => {
    await expect(
      runTriggerEval(TARGET, options, deps(perfectJudge(), { corpus: [] })),
    ).rejects.toThrowError(/corpus too small/);
  });
});
