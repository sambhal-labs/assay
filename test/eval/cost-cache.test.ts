import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheKey,
  readCacheEntry,
  writeCacheEntry,
  type EvalCacheEntry,
} from '../../src/eval/cache.js';
import { estimateEvalCost, OUTPUT_TOKENS_PER_CALL } from '../../src/eval/cost.js';
import { countTokens } from '../../src/util/tokens.js';

describe('estimateEvalCost', () => {
  it('sums real token counts, the pending allowance, and per-call output', async () => {
    const prompts = ['first prompt text', 'a second, rather longer prompt about spreadsheets'];
    let expectedIn = 800;
    for (const p of prompts) expectedIn += await countTokens(p);

    const estimate = await estimateEvalCost(prompts, 800, 17, (i, o) => (i + o) / 1_000_000);

    expect(estimate.calls).toBe(17);
    expect(estimate.inputTokens).toBe(expectedIn);
    expect(estimate.outputTokens).toBe(17 * OUTPUT_TOKENS_PER_CALL);
    expect(estimate.usd).toBeCloseTo((expectedIn + 17 * OUTPUT_TOKENS_PER_CALL) / 1_000_000, 12);
  });
});

describe('eval cache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'assay-eval-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const entry: EvalCacheEntry = {
    promptsVersion: 1,
    positives: ['fill this pdf form'],
    responses: ['{"skill": "pdf-form-filler"}'],
  };

  it('cacheKey is deterministic and input-sensitive', () => {
    expect(cacheKey({ a: 1 })).toBe(cacheKey({ a: 1 }));
    expect(cacheKey({ a: 1 })).not.toBe(cacheKey({ a: 2 }));
    expect(cacheKey({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips an entry, creating the directory lazily', async () => {
    const nested = join(dir, '.assay', 'cache');
    await writeCacheEntry(nested, 'k1', entry);
    expect(await readCacheEntry(nested, 'k1')).toEqual(entry);
    expect(await readdir(nested)).toEqual(['eval-k1.json']);
  });

  it('misses on absent keys', async () => {
    expect(await readCacheEntry(dir, 'nope')).toBeNull();
  });

  it('treats corrupted or wrong-shaped entries as a miss, not a failure', async () => {
    await writeFile(join(dir, 'eval-bad1.json'), '{ not json', 'utf8');
    await writeFile(join(dir, 'eval-bad2.json'), JSON.stringify({ positives: 'x' }), 'utf8');
    expect(await readCacheEntry(dir, 'bad1')).toBeNull();
    expect(await readCacheEntry(dir, 'bad2')).toBeNull();
  });

  it('writes human-inspectable JSON', async () => {
    await writeCacheEntry(dir, 'k2', entry);
    const raw = await readFile(join(dir, 'eval-k2.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(entry);
    expect(raw.endsWith('\n')).toBe(true);
  });
});
