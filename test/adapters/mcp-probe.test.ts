import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mutationKeywordFor, parseMcpServer, synthesizeArgs } from '../../src/adapters/mcp.js';
import { defaultConfig } from '../../src/core/config.js';
import type { ProbeToolResult, Scorecard } from '../../src/core/types.js';
import { gradeArtifact } from '../../src/pipeline.js';

const PROBE_SERVER = fileURLToPath(new URL('../../fixtures/mcp/probe-server.ts', import.meta.url));
const GOOD_SERVER = fileURLToPath(new URL('../../fixtures/mcp/good-server.ts', import.meta.url));

// Spawn the TypeScript fixtures directly over real stdio via the local tsx
// hook — never a bare `npx`/`tsx` that depends on PATH.
const stdio = (fixture: string): string[] => [process.execPath, '--import', 'tsx', fixture];

const allFindings = (card: Scorecard) => card.dimensions.flatMap((d) => d.findings);
const byName = (probe: ProbeToolResult[] | undefined, name: string): ProbeToolResult => {
  const hit = probe?.find((r) => r.toolName === name);
  if (!hit) throw new Error(`no probe result for ${name}`);
  return hit;
};

describe.sequential('parseMcpServer --probe (live stdio fixtures)', () => {
  const config = defaultConfig();

  it('probes the fixture, skips the mutation-named tool, and fires MCP401/MCP403', async () => {
    const artifact = await parseMcpServer({ command: stdio(PROBE_SERVER) }, config, {
      probe: true,
    });

    expect(artifact.initialized).toBe(true);
    expect(artifact.probe).toBeDefined();
    expect(artifact.probe).toHaveLength(4);

    const echo = byName(artifact.probe, 'echo_text');
    expect(echo.skipped).toBe(false);
    expect(echo.protocolError).toBe(false);
    expect(echo.errorStructured).toBeUndefined();
    expect(echo.latencyMs).toBeGreaterThanOrEqual(0);

    const unstructured = byName(artifact.probe, 'fail_unstructured');
    expect(unstructured.skipped).toBe(false);
    expect(unstructured.protocolError).toBe(false);
    expect(unstructured.errorStructured).toBe(false);

    const protocol = byName(artifact.probe, 'fail_protocol');
    expect(protocol.skipped).toBe(false);
    expect(protocol.protocolError).toBe(true);

    const destructive = byName(artifact.probe, 'delete_everything');
    expect(destructive.skipped).toBe(true);
    expect(destructive.skipReason).toBe('mutation-keyword: delete');

    const card = gradeArtifact(artifact, config, performance.now(), { probing: true });
    const ids = allFindings(card).map((f) => f.ruleId);
    expect(ids).toContain('MCP401');
    expect(ids).toContain('MCP403');
    // Probing swaps in the probe weight set: reliability joins the scorecard.
    const reliability = card.dimensions.find((d) => d.dimension === 'reliability');
    expect(reliability).toBeDefined();
    expect(reliability!.weight).toBe(0.1);
    expect(reliability!.score).toBeLessThan(100);
  });

  it('probes the mutation-named tool when unsafe is set', async () => {
    const artifact = await parseMcpServer({ command: stdio(PROBE_SERVER) }, config, {
      probe: true,
      unsafe: true,
    });
    const destructive = byName(artifact.probe, 'delete_everything');
    expect(destructive.skipped).toBe(false);
    expect(destructive.protocolError).toBe(false);
    expect(destructive.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('does not probe at all without the flag', async () => {
    const artifact = await parseMcpServer({ command: stdio(PROBE_SERVER) }, config);
    expect(artifact.probe).toBeUndefined();
    // And without probing, MCP4xx stay silent even for this misbehaving server.
    const card = gradeArtifact(artifact, config, performance.now());
    expect(allFindings(card).some((f) => f.ruleId.startsWith('MCP4'))).toBe(false);
    expect(card.dimensions.some((d) => d.dimension === 'reliability')).toBe(false);
  });

  it('probing the good fixture yields zero reliability findings', async () => {
    const artifact = await parseMcpServer({ command: stdio(GOOD_SERVER) }, config, {
      probe: true,
    });
    expect(artifact.probe).toHaveLength(3);
    for (const result of artifact.probe!) {
      expect(result.skipped).toBe(false);
      expect(result.protocolError).toBe(false);
      expect(result.errorStructured).toBeUndefined();
    }

    const card = gradeArtifact(artifact, config, performance.now(), { probing: true });
    expect(allFindings(card)).toEqual([]);
    const reliability = card.dimensions.find((d) => d.dimension === 'reliability');
    expect(reliability?.score).toBe(100);
    expect(card.grade).toBe('A+');
  });
});

describe('mutation safe-mode lexicon', () => {
  it('matches snake_case, camelCase, and inflected description words', () => {
    expect(mutationKeywordFor({ name: 'delete_everything', description: undefined })).toBe(
      'delete',
    );
    expect(mutationKeywordFor({ name: 'sendEmail', description: undefined })).toBe('send');
    expect(
      mutationKeywordFor({ name: 'cleanup', description: 'Removes stale entries nightly.' }),
    ).toBe('remove');
  });

  it('does not fire on read-only tools or embedded substrings', () => {
    expect(mutationKeywordFor({ name: 'search_files', description: 'Find files by glob.' })).toBe(
      null,
    );
    // "settings" must not match "set"; "reset" is its own lexicon word.
    expect(mutationKeywordFor({ name: 'get_settings', description: undefined })).toBe(null);
  });
});

describe('synthesizeArgs', () => {
  it('fills only required properties with schema-valid placeholder values', () => {
    expect(
      synthesizeArgs({
        type: 'object',
        properties: {
          s: { type: 'string' },
          n: { type: 'number' },
          i: { type: 'integer' },
          b: { type: 'boolean' },
          e: { enum: ['first', 'second'] },
          a: { type: 'array', items: { type: 'string' } },
          o: {
            type: 'object',
            properties: { inner: { type: 'string' } },
            required: ['inner'],
          },
          optional: { type: 'string' },
        },
        required: ['s', 'n', 'i', 'b', 'e', 'a', 'o'],
      }),
    ).toEqual({
      s: 'test',
      n: 1,
      i: 1,
      b: false,
      e: 'first',
      a: [],
      o: { inner: 'test' },
    });
  });

  it('handles missing schemas and untyped properties', () => {
    expect(synthesizeArgs(undefined)).toEqual({});
    expect(synthesizeArgs({ type: 'object' })).toEqual({});
    expect(synthesizeArgs({ type: 'object', required: ['x'], properties: {} })).toEqual({
      x: 'test',
    });
  });
});
