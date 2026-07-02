import { describe, expect, it } from 'vitest';
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

function artifact(tools: McpToolInfo[]): McpArtifact {
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
  };
}

const config = defaultConfig();
const findingsFor = (tools: McpToolInfo[], ruleId: string): Finding[] =>
  runRules(artifact(tools), mcpRules, config).findings.filter((f) => f.ruleId === ruleId);

describe('MCP101', () => {
  it('fires for a missing, empty, or whitespace description', () => {
    const findings = findingsFor(
      [
        tool({ name: 'no_desc', description: undefined }),
        tool({ name: 'blank_desc', description: '   ' }),
      ],
      'MCP101',
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]!.severity).toBe('error');
    expect(findings.map((f) => f.location?.toolName)).toEqual(['blank_desc', 'no_desc']);
  });

  it('skips malformed entries (MCP002 territory) and passes on described tools', () => {
    expect(findingsFor([tool({ description: undefined, entryValid: false })], 'MCP101')).toEqual(
      [],
    );
    expect(findingsFor([tool()], 'MCP101')).toEqual([]);
  });
});

describe('MCP102', () => {
  it('fires for a too-short description, citing the length', () => {
    const findings = findingsFor([tool({ description: 'Reads it.' })], 'MCP102');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('9 chars');
  });

  it('fires when the description just restates the name', () => {
    const findings = findingsFor(
      [tool({ name: 'read_data_file', description: 'Read Data File.' })],
      'MCP102',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/restates its name/);
  });

  it('fires on placeholder text', () => {
    expect(
      findingsFor(
        [tool({ description: 'A tool for doing various operations on data.' })],
        'MCP102',
      ),
    ).toHaveLength(1);
  });

  it('passes on a purposeful description and defers empties to MCP101', () => {
    expect(findingsFor([tool()], 'MCP102')).toEqual([]);
    expect(findingsFor([tool({ description: undefined })], 'MCP102')).toEqual([]);
  });
});

describe('MCP103', () => {
  it('fires when the description implies parameters but the schema has zero properties', () => {
    const findings = findingsFor(
      [
        tool({
          description: 'Converts the file given the target format and options provided.',
          inputSchema: { type: 'object' },
        }),
      ],
      'MCP103',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.message).toMatch(/given/);
    expect(findings[0]!.message).toMatch(/provided/);
  });

  it('fires when the schema is missing entirely or not type object', () => {
    expect(
      findingsFor(
        [tool({ description: 'Takes a path and reads it.', inputSchema: undefined })],
        'MCP103',
      ),
    ).toHaveLength(1);
    expect(
      findingsFor(
        [tool({ description: 'Takes a path and reads it.', inputSchema: { type: 'string' } })],
        'MCP103',
      ),
    ).toHaveLength(1);
  });

  it('fires when the description quotes a parameter name', () => {
    const findings = findingsFor(
      [
        tool({
          description: 'Reads the `path` and returns its text.',
          inputSchema: { type: 'object', properties: {} },
        }),
      ],
      'MCP103',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/quoted parameter name/);
  });

  it('passes for a genuinely parameterless tool and for populated schemas', () => {
    expect(
      findingsFor(
        [
          tool({
            description: 'Report the current server uptime.',
            inputSchema: { type: 'object', properties: {} },
          }),
        ],
        'MCP103',
      ),
    ).toEqual([]);
    expect(
      findingsFor([tool({ description: 'Reads the file at the given path.' })], 'MCP103'),
    ).toEqual([]);
  });
});

describe('MCP104', () => {
  it('fires per tool, counting and naming the undescribed parameters', () => {
    const findings = findingsFor(
      [
        tool({
          name: 'render_chart',
          description: 'Renders a chart from a data series onto a canvas.',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', description: 'Rendering mode to apply.' },
              data: { type: 'array' },
              title: { type: 'string' },
            },
          },
        }),
      ],
      'MCP104',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('2 of 3');
    expect(findings[0]!.message).toContain('data');
    expect(findings[0]!.message).toContain('title');
  });

  it('truncates long offender lists', () => {
    const properties = Object.fromEntries(
      ['a1', 'b2', 'c3', 'd4', 'e5'].map((n) => [n, { type: 'string' }]),
    );
    const findings = findingsFor([tool({ inputSchema: { type: 'object', properties } })], 'MCP104');
    expect(findings[0]!.message).toContain('5 of 5');
    expect(findings[0]!.message).toContain('+2 more');
  });

  it('passes when every parameter is described', () => {
    expect(findingsFor([tool()], 'MCP104')).toEqual([]);
  });
});

describe('MCP105', () => {
  it('fires for a string parameter with a prose enum and no enum array', () => {
    const findings = findingsFor(
      [
        tool({
          inputSchema: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description: 'Rendering mode; must be one of: fast, slow, turbo.',
              },
            },
          },
        }),
      ],
      'MCP105',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('"mode"');
    expect(findings[0]!.message).toMatch(/one of/);
  });

  it('passes when the schema declares the enum, and ignores non-string params', () => {
    expect(
      findingsFor(
        [
          tool({
            inputSchema: {
              type: 'object',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['fast', 'slow'],
                  description: 'Rendering mode; must be one of: fast, slow.',
                },
              },
            },
          }),
        ],
        'MCP105',
      ),
    ).toEqual([]);
    expect(
      findingsFor(
        [
          tool({
            inputSchema: {
              type: 'object',
              properties: {
                level: { type: 'integer', description: 'Log level; must be one of: 1, 2, 3.' },
              },
            },
          }),
        ],
        'MCP105',
      ),
    ).toEqual([]);
  });
});

describe('MCP106', () => {
  it('fires when the description implies mandatory params but nothing is required', () => {
    const findings = findingsFor(
      [
        tool({
          description: 'Renders a chart. You must provide the data series.',
          inputSchema: {
            type: 'object',
            properties: { data: { type: 'array', description: 'Series of points to render.' } },
          },
        }),
      ],
      'MCP106',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/must provide/);
  });

  it('passes with a populated required array or no parameters at all', () => {
    expect(
      findingsFor(
        [tool({ description: 'The id parameter is required to fetch an entry.' })],
        'MCP106',
      ),
    ).toEqual([]);
    expect(
      findingsFor(
        [
          tool({
            description: 'Authentication is required before calling this endpoint.',
            inputSchema: { type: 'object', properties: {} },
          }),
        ],
        'MCP106',
      ),
    ).toEqual([]);
  });
});

describe('MCP107', () => {
  it('fires for names that are not snake_case or kebab-case', () => {
    const findings = findingsFor([tool({ name: 'FetchData' })], 'MCP107');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('FetchData');
    expect(findings[0]!.severity).toBe('info');
  });

  it('fires for names over 64 chars', () => {
    const long = `a${'_a'.repeat(40)}`;
    const findings = findingsFor([tool({ name: long })], 'MCP107');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('81 chars');
  });

  it('fires when two names collide after normalization', () => {
    const findings = findingsFor(
      [tool({ name: 'read_file' }), tool({ name: 'Read-File' })],
      'MCP107',
    );
    const collision = findings.filter((f) => f.message.includes('collides'));
    expect(collision).toHaveLength(1);
    expect(collision[0]!.message).toContain('"Read-File"');
    expect(collision[0]!.message).toContain('"read_file"');
  });

  it('passes for conventional distinct names', () => {
    expect(findingsFor([tool(), tool({ name: 'other-tool' })], 'MCP107')).toEqual([]);
  });
});

describe('MCP108', () => {
  const catalog = (n: number): McpToolInfo[] =>
    Array.from({ length: n }, (_, i) => tool({ name: `distinct_capability_number_${i * 7}` }));

  it('fires above the budget, citing count and budget', () => {
    const findings = findingsFor(catalog(31), 'MCP108');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('31 tools');
    expect(findings[0]!.message).toContain('budget: 30');
  });

  it('passes at the budget', () => {
    expect(findingsFor(catalog(30), 'MCP108')).toEqual([]);
  });
});
