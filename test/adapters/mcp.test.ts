import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMcpServer } from '../../src/adapters/mcp.js';
import { defaultConfig } from '../../src/core/config.js';
import { AssayError } from '../../src/core/errors.js';
import { GRADES, type Grade, type Scorecard } from '../../src/core/types.js';
import { gradeArtifact } from '../../src/pipeline.js';

const GOOD_SERVER = fileURLToPath(new URL('../../fixtures/mcp/good-server.ts', import.meta.url));
const BAD_SERVER = fileURLToPath(new URL('../../fixtures/mcp/bad-server.ts', import.meta.url));

// Spawn the TypeScript fixtures directly over real stdio via the local tsx
// hook — never a bare `npx`/`tsx` that depends on PATH.
const stdio = (fixture: string, ...extraArgs: string[]): string[] => [
  process.execPath,
  '--import',
  'tsx',
  fixture,
  ...extraArgs,
];

const allFindings = (card: Scorecard) => card.dimensions.flatMap((d) => d.findings);
const gradeAtMost = (card: Scorecard, grade: Grade): boolean =>
  GRADES.indexOf(card.grade) >= GRADES.indexOf(grade);

describe.sequential('parseMcpServer (live stdio fixtures)', () => {
  const config = defaultConfig();

  it('grades the good fixture A with zero findings', async () => {
    const artifact = await parseMcpServer({ command: stdio(GOOD_SERVER) }, config);

    expect(artifact.type).toBe('mcp-server');
    expect(artifact.transport).toBe('stdio');
    expect(artifact.initialized).toBe(true);
    expect(artifact.initializeError).toBeNull();
    expect(artifact.name).toBe('assay-good-fixture');
    expect(artifact.protocolVersion).toBeTruthy();
    expect(artifact.capabilities).toMatchObject({ tools: expect.anything() });
    expect(artifact.toolsListError).toBeNull();

    expect(artifact.tools.map((t) => t.name)).toEqual([
      'search_files',
      'read_file',
      'get_metadata',
    ]);
    for (const tool of artifact.tools) {
      expect(tool.entryValid).toBe(true);
      expect(tool.tokens).toBeGreaterThan(0);
    }
    expect(artifact.tokens.total).toBe(artifact.tools.reduce((sum, t) => sum + t.tokens, 0));

    const card = gradeArtifact(artifact, config, performance.now());
    expect(allFindings(card)).toEqual([]);
    expect(card.grade).toBe('A+');
  });

  it('follows tools/list pagination and grades the bad fixture at most C', async () => {
    const artifact = await parseMcpServer({ command: stdio(BAD_SERVER) }, config);

    expect(artifact.initialized).toBe(true);
    // The bad server pages 4 tools at a time; seeing all 10 proves the
    // adapter followed nextCursor to exhaustion.
    expect(artifact.tools).toHaveLength(10);
    expect(artifact.tokens.total).toBeGreaterThan(config.budgets.mcpServerTokensWarn);

    const card = gradeArtifact(artifact, config, performance.now());
    const ids = new Set(allFindings(card).map((f) => f.ruleId));
    expect(ids).toContain('MCP101');
    expect(ids).toContain('MCP301');
    expect(ids).toContain('MCP202');
    expect(card.securityCapped || card.compositeRaw <= 79).toBe(true);
    expect(gradeAtMost(card, 'C')).toBe(true);
  });

  it('fires MCP108 when the bad fixture registers its stub catalog', async () => {
    const artifact = await parseMcpServer({ command: stdio(BAD_SERVER, '--many-tools') }, config);
    expect(artifact.tools.length).toBeGreaterThan(config.budgets.mcpMaxTools);

    const card = gradeArtifact(artifact, config, performance.now());
    expect(allFindings(card).some((f) => f.ruleId === 'MCP108')).toBe(true);
  });

  it('throws AssayError for a command that cannot be spawned', async () => {
    await expect(
      parseMcpServer({ command: ['assay-no-such-binary-xyz'] }, config),
    ).rejects.toBeInstanceOf(AssayError);
  });

  it('returns initialized:false (MCP001) when the child exits before speaking MCP', async () => {
    const artifact = await parseMcpServer(
      { command: [process.execPath, '-e', 'process.exit(0)'] },
      config,
    );
    expect(artifact.initialized).toBe(false);
    expect(artifact.initializeError).toBeTruthy();
    expect(artifact.tools).toEqual([]);

    const card = gradeArtifact(artifact, config, performance.now());
    expect(allFindings(card).map((f) => f.ruleId)).toContain('MCP001');
  });
});
