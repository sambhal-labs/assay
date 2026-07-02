import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config.js';
import { runRules } from '../../../src/core/engine.js';
import type { McpArtifact, McpToolInfo } from '../../../src/core/types.js';
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
    tools: [tool()],
    tokens: { total: 40 },
    ...overrides,
  };
}

const findingsOf = (a: McpArtifact) => runRules(a, mcpRules, defaultConfig()).findings;
const ruleIds = (a: McpArtifact): string[] => findingsOf(a).map((f) => f.ruleId);

describe('MCP001', () => {
  it('fires with the initialize error and suppresses MCP002/MCP003', () => {
    const findings = findingsOf(
      artifact({
        initialized: false,
        initializeError: 'Connection closed',
        protocolVersion: null,
        capabilities: null,
        tools: [],
        tokens: { total: 0 },
      }),
    );
    expect(findings.map((f) => f.ruleId)).toEqual(['MCP001']);
    expect(findings[0]!.message).toContain('Connection closed');
    expect(findings[0]!.message).toContain('node server.js');
  });

  it('passes on an initialized server', () => {
    expect(ruleIds(artifact())).toEqual([]);
  });
});

describe('MCP002', () => {
  it('fires when tools/list failed', () => {
    const findings = findingsOf(
      artifact({ toolsListError: 'request timed out', tools: [], tokens: { total: 0 } }),
    ).filter((f) => f.ruleId === 'MCP002');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('request timed out');
  });

  it('fires once per malformed entry, naming it when possible', () => {
    const findings = findingsOf(
      artifact({
        tools: [
          tool({ name: '', entryValid: false, description: undefined, inputSchema: undefined }),
          tool({ name: 'broken_schema', entryValid: false, inputSchema: undefined }),
          tool(),
        ],
      }),
    ).filter((f) => f.ruleId === 'MCP002');
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.message).join('\n')).toMatch(/#1/);
    expect(findings.some((f) => f.location?.toolName === 'broken_schema')).toBe(true);
  });

  it('passes when every entry is valid', () => {
    expect(ruleIds(artifact()).filter((id) => id === 'MCP002')).toEqual([]);
  });
});

describe('MCP003', () => {
  it('fires when the protocol version is missing', () => {
    const findings = findingsOf(artifact({ protocolVersion: null })).filter(
      (f) => f.ruleId === 'MCP003',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/protocol version/);
  });

  it('fires when capabilities are missing or empty', () => {
    expect(ruleIds(artifact({ capabilities: null }))).toContain('MCP003');
    expect(ruleIds(artifact({ capabilities: {} }))).toContain('MCP003');
  });

  it('fires twice when both are absent', () => {
    const findings = findingsOf(artifact({ protocolVersion: null, capabilities: null })).filter(
      (f) => f.ruleId === 'MCP003',
    );
    expect(findings).toHaveLength(2);
  });

  it('passes with a version and non-empty capabilities', () => {
    expect(ruleIds(artifact())).toEqual([]);
  });
});

describe('MCP004', () => {
  it('fires for an HTTP endpoint whose path ends in /sse', () => {
    const findings = findingsOf(
      artifact({ transport: 'http', target: 'https://example.com/mcp/sse' }),
    ).filter((f) => f.ruleId === 'MCP004');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('/mcp/sse');
    expect(findings[0]!.severity).toBe('info');
  });

  it('passes for streamable HTTP paths and stdio transports', () => {
    expect(ruleIds(artifact({ transport: 'http', target: 'https://example.com/mcp' }))).toEqual([]);
    expect(ruleIds(artifact())).toEqual([]);
  });

  it('never throws on an unparseable target', () => {
    expect(ruleIds(artifact({ transport: 'http', target: 'not a url' }))).toEqual([]);
  });
});
