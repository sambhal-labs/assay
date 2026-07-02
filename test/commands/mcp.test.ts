import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMcp } from '../../src/commands/mcp.js';
import type { GlobalOptions } from '../../src/program.js';

const GOOD_SERVER = fileURLToPath(new URL('../../fixtures/mcp/good-server.ts', import.meta.url));
const PROBE_SERVER = fileURLToPath(new URL('../../fixtures/mcp/probe-server.ts', import.meta.url));

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

  it('probes with --probe, prints the skipped-tool report to stderr, and swaps the weight set', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const card = await runMcp(
      {
        command: [process.execPath, '--import', 'tsx', PROBE_SERVER],
        probe: true,
        unsafe: false,
      },
      opts(),
    );

    // Safe mode: the mutation-named tool shows up on stderr with its reason.
    const report = stderrWrites.join('');
    expect(report).toContain('skipped 1 of 4 tools');
    expect(report).toContain('delete_everything');
    expect(report).toContain('mutation-keyword: delete');

    // probing:true reached the scorer — reliability is a graded dimension.
    const reliability = card.dimensions.find((d) => d.dimension === 'reliability');
    expect(reliability).toBeDefined();
    expect(reliability!.weight).toBe(0.1);
    const ids = card.dimensions.flatMap((d) => d.findings).map((f) => f.ruleId);
    expect(ids).toContain('MCP401');
    expect(ids).toContain('MCP403');
  });

  it('prints no skipped-tool report when nothing was skipped', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const card = await runMcp(
      {
        command: [process.execPath, '--import', 'tsx', GOOD_SERVER],
        probe: true,
        unsafe: false,
      },
      opts(),
    );

    expect(stderrWrites.join('')).toBe('');
    expect(card.grade).toBe('A+');
    expect(card.dimensions.some((d) => d.dimension === 'reliability')).toBe(true);
  });
});
