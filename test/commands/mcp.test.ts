import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMcp } from '../../src/commands/mcp.js';
import { AssayError } from '../../src/core/errors.js';
import type { GlobalOptions } from '../../src/program.js';

const GOOD_SERVER = fileURLToPath(new URL('../../fixtures/mcp/good-server.ts', import.meta.url));

const opts = (overrides: Partial<GlobalOptions> = {}): GlobalOptions => ({
  format: 'json',
  quiet: false,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.sequential('runMcp', () => {
  it('grades a live stdio server and prints a schema-valid scorecard', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const card = await runMcp(
      {
        command: [process.execPath, '--import', 'tsx', GOOD_SERVER],
        probe: false,
        unsafe: false,
      },
      opts(),
    );

    expect(card.artifact.type).toBe('mcp-server');
    expect(card.artifact.name).toBe('assay-good-fixture');
    expect(card.grade).toBe('A+');
    expect(card.stats.rulesRun).toBeGreaterThan(0);
    expect(card.stats.tokens).toBeGreaterThan(0);

    const printed: unknown = JSON.parse(writes.join(''));
    expect(printed).toMatchObject({
      schemaVersion: 1,
      artifact: { type: 'mcp-server', name: 'assay-good-fixture' },
      grade: 'A+',
    });
  });

  it('rejects --probe until the reliability rules land', async () => {
    await expect(
      runMcp({ command: ['whatever'], probe: true, unsafe: false }, opts()),
    ).rejects.toBeInstanceOf(AssayError);
  });
});
