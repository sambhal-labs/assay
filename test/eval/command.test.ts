import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEval } from '../../src/commands/eval.js';
import { AssayError } from '../../src/core/errors.js';
import type { Scorecard } from '../../src/core/types.js';
import type { Provider } from '../../src/eval/providers.js';
import type { GlobalOptions } from '../../src/program.js';

const EXEMPLARY = fileURLToPath(new URL('../../fixtures/skills/exemplary', import.meta.url));
const BROKEN = fileURLToPath(new URL('../../fixtures/skills/broken', import.meta.url));

const opts = (overrides: Partial<GlobalOptions> = {}): GlobalOptions => ({
  format: 'json',
  quiet: false,
  ...overrides,
});

/** Routes everything containing "pdf" to the target — good enough to merge. */
function cannedProvider(): Provider {
  return {
    name: 'anthropic',
    model: 'fake-judge',
    countCostUSD: (i, o) => (i + o) / 1_000_000,
    async generate(prompt) {
      if (prompt.includes('JSON array')) {
        return JSON.stringify(
          Array.from({ length: 8 }, (_, i) => `please fill pdf form number ${i}`),
        );
      }
      const wantsPdf = /User request:\n[\s\S]*?pdf/i.test(prompt.split('Which skill')[0]!);
      return JSON.stringify({ skill: wantsPdf ? 'pdf-form-filler' : null });
    },
  };
}

describe('runEval (assay eval <skill-dir>)', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'assay-eval-cmd-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('merges eval results into a schema-valid, non-deterministic scorecard', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const card = await runEval(EXEMPLARY, { yes: true }, opts(), {
      provider: cannedProvider(),
      cacheDir,
      stderr: () => {},
    });

    expect(card).not.toBeNull();
    expect(card!.deterministic).toBe(false);
    expect(card!.eval).toMatchObject({
      provider: 'anthropic',
      model: 'fake-judge',
      scenarios: 16,
      recall: 1,
    });
    expect(card!.eval!.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card!.eval!.f1).toBeGreaterThan(0);

    // printScorecard validates against ScorecardSchema on the way out.
    const printed = JSON.parse(writes.join('')) as Scorecard;
    expect(printed.deterministic).toBe(false);
    expect(printed.eval?.model).toBe('fake-judge');
    expect(printed.artifact.name).toBe('pdf-form-filler');
  });

  it('renders the eval line in the terminal reporter', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    await runEval(EXEMPLARY, { yes: true }, opts({ format: 'terminal', color: false }), {
      provider: cannedProvider(),
      cacheDir,
      stderr: () => {},
    });

    expect(writes.join('')).toContain('eval: anthropic/fake-judge F1');
  });

  it('tells the user to fix SK002 first when name/description are unusable', async () => {
    const attempt = runEval(BROKEN, { yes: true }, opts(), {
      provider: cannedProvider(),
      cacheDir,
    });
    await expect(attempt).rejects.toThrowError(AssayError);
    await expect(attempt).rejects.toThrowError(/name and description/);
    await attempt.catch((err: AssayError) => expect(err.hint).toContain('SK002'));
  });

  it('rejects unknown providers', async () => {
    await expect(
      runEval(EXEMPLARY, { provider: 'closedai', yes: true }, opts(), { cacheDir }),
    ).rejects.toThrowError(/unknown eval provider "closedai"/);
  });

  it('returns null (exit 0) and prints nothing to stdout when the user declines', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const card = await runEval(EXEMPLARY, { yes: false }, opts(), {
      provider: cannedProvider(),
      cacheDir,
      isTTY: true,
      confirm: async () => false,
      stderr: () => {},
    });

    expect(card).toBeNull();
    expect(stdout).not.toHaveBeenCalled();
  });
});
