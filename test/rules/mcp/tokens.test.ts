import { describe, expect, it } from 'vitest';
import { PRICE_SNAPSHOT } from '../../../src/constants.js';
import { defaultConfig } from '../../../src/core/config.js';
import { runRules } from '../../../src/core/engine.js';
import type { Finding, McpArtifact, McpToolInfo } from '../../../src/core/types.js';
import { mcpRules } from '../../../src/rules/mcp/index.js';

function tool(overrides: Partial<McpToolInfo> = {}): McpToolInfo {
  return {
    name: 'demo_tool',
    description: 'Fetch demo data for a workspace entry by its identifier.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifier of the entry to fetch.' } },
      required: ['id'],
    },
    tokens: 40,
    entryValid: true,
    ...overrides,
  };
}

function artifact(overrides: Partial<McpArtifact> = {}): McpArtifact {
  const tools = overrides.tools ?? [tool()];
  return {
    type: 'mcp-server',
    name: 'demo-server',
    path: 'node server.js',
    transport: 'stdio',
    target: 'node server.js',
    initialized: true,
    initializeError: null,
    protocolVersion: '2025-06-18',
    capabilities: { tools: {} },
    toolsListError: null,
    tools,
    tokens: { total: tools.reduce((sum, t) => sum + t.tokens, 0) },
    ...overrides,
  };
}

const config = defaultConfig();
const findingsFor = (a: McpArtifact, ruleId: string): Finding[] =>
  runRules(a, mcpRules, config).findings.filter((f) => f.ruleId === ruleId);

describe('MCP201 (banded)', () => {
  it('fires info between the info and warn budgets, citing the number', () => {
    const findings = findingsFor(artifact({ tools: [tool({ tokens: 500 })] }), 'MCP201');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.message).toContain('~500 tokens');
  });

  it('escalates to warn above the warn budget', () => {
    const findings = findingsFor(artifact({ tools: [tool({ tokens: 900 })] }), 'MCP201');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.location?.toolName).toBe('demo_tool');
  });

  it('stays silent at the info budget', () => {
    expect(findingsFor(artifact({ tools: [tool({ tokens: 400 })] }), 'MCP201')).toEqual([]);
  });
});

describe('MCP202', () => {
  it('fires over the server budget with the total and a dollar translation', () => {
    const findings = findingsFor(artifact({ tokens: { total: 10_000 } }), 'MCP202');
    expect(findings).toHaveLength(1);
    // (10000 / 1e6) * $3/MTok * 1000 conversations = $30.00
    expect(findings[0]!.message).toContain('~10000 tokens');
    expect(findings[0]!.message).toContain('$30.00 per 1,000 conversations');
    expect(findings[0]!.message).toContain(`$${PRICE_SNAPSHOT.inputUSDPerMTok}/MTok`);
    expect(findings[0]!.message).toContain(PRICE_SNAPSHOT.model);
    expect(findings[0]!.message).toContain(PRICE_SNAPSHOT.date);
  });

  it('stays silent at the budget', () => {
    expect(findingsFor(artifact({ tokens: { total: 8000 } }), 'MCP202')).toEqual([]);
  });
});

describe('MCP203', () => {
  it('fires for anyOf/oneOf nested three deep, citing the depth', () => {
    const findings = findingsFor(
      artifact({
        tools: [
          tool({
            inputSchema: {
              type: 'object',
              properties: {
                value: {
                  description: 'Value in one of several shapes.',
                  anyOf: [
                    { oneOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }] },
                    { type: 'null' },
                  ],
                },
              },
              required: ['value'],
            },
          }),
        ],
      }),
      'MCP203',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('nested 3 levels deep');
  });

  it('fires for titles duplicating the property name, naming offenders', () => {
    const findings = findingsFor(
      artifact({
        tools: [
          tool({
            inputSchema: {
              type: 'object',
              properties: {
                alpha: { type: 'string', title: 'Alpha', description: 'First knob to turn.' },
                beta: { type: 'string', title: 'beta', description: 'Second knob to turn.' },
              },
              required: ['alpha', 'beta'],
            },
          }),
        ],
      }),
      'MCP203',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('alpha');
    expect(findings[0]!.message).toContain('beta');
  });

  it('passes shallow unions and meaningful titles', () => {
    expect(
      findingsFor(
        artifact({
          tools: [
            tool({
              inputSchema: {
                type: 'object',
                properties: {
                  value: {
                    description: 'Value as text or number.',
                    anyOf: [{ type: 'string' }, { anyOf: [{ type: 'number' }] }],
                  },
                  path: { type: 'string', title: 'File location', description: 'Path to read.' },
                },
                required: ['value'],
              },
            }),
          ],
        }),
        'MCP203',
      ),
    ).toEqual([]);
  });
});
