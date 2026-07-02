import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config.js';
import { runRules } from '../../../src/core/engine.js';
import type { McpArtifact, ProbeToolResult } from '../../../src/core/types.js';
import { p95, reliabilityRules } from '../../../src/rules/mcp/reliability.js';

function artifact(probe?: ProbeToolResult[]): McpArtifact {
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
    tools: [],
    tokens: { total: 0 },
    ...(probe !== undefined ? { probe } : {}),
  };
}

const ok = (name: string, latencyMs = 20): ProbeToolResult => ({
  toolName: name,
  skipped: false,
  latencyMs,
  protocolError: false,
});

const findingsOf = (a: McpArtifact) => runRules(a, reliabilityRules, defaultConfig()).findings;

describe('MCP4xx no-op guarantees', () => {
  it('every reliability rule is silent when artifact.probe is undefined', () => {
    expect(findingsOf(artifact())).toEqual([]);
  });

  it('skipped tools are never graded', () => {
    const findings = findingsOf(
      artifact([
        { toolName: 'delete_everything', skipped: true, skipReason: 'mutation-keyword: delete' },
      ]),
    );
    expect(findings).toEqual([]);
  });
});

describe('MCP401', () => {
  it('fires once per probed tool with a protocol error', () => {
    const findings = findingsOf(
      artifact([
        ok('echo_text'),
        { toolName: 'fail_protocol', skipped: false, latencyMs: 12, protocolError: true },
        { toolName: 'also_broken', skipped: false, latencyMs: 30, protocolError: true },
      ]),
    );
    const hits = findings.filter((f) => f.ruleId === 'MCP401');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.severity).toBe('warn');
    expect(hits.map((f) => f.location?.toolName).sort()).toEqual(['also_broken', 'fail_protocol']);
  });

  it('does not fire for structured tool-level errors', () => {
    const findings = findingsOf(
      artifact([
        {
          toolName: 'lookup',
          skipped: false,
          latencyMs: 8,
          protocolError: false,
          errorStructured: true,
        },
      ]),
    );
    expect(findings.filter((f) => f.ruleId === 'MCP401')).toEqual([]);
  });
});

describe('MCP402', () => {
  it('cites the p95 when it exceeds budgets.probeLatencyP95Ms', () => {
    const latencies = [100, 200, 300, 6200];
    const findings = findingsOf(artifact(latencies.map((ms, i) => ok(`tool_${i}`, ms))));
    const hits = findings.filter((f) => f.ruleId === 'MCP402');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('info');
    expect(hits[0]!.message).toContain('6200ms');
    expect(hits[0]!.message).toContain('5000ms');
  });

  it('stays silent at or under the budget', () => {
    const findings = findingsOf(artifact([ok('a', 4000), ok('b', 5000)]));
    expect(findings.filter((f) => f.ruleId === 'MCP402')).toEqual([]);
  });

  it('respects a config override of the budget', () => {
    const config = defaultConfig();
    config.budgets.probeLatencyP95Ms = 100;
    const { findings } = runRules(artifact([ok('a', 150)]), reliabilityRules, config);
    expect(findings.some((f) => f.ruleId === 'MCP402')).toBe(true);
  });

  it('p95 uses the nearest-rank method', () => {
    expect(p95([10])).toBe(10);
    expect(p95([1, 2, 3, 4])).toBe(4);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(p95(twenty)).toBe(19);
  });
});

describe('MCP403', () => {
  it('fires per tool whose errors lack machine-readable structure', () => {
    const findings = findingsOf(
      artifact([
        ok('echo_text'),
        {
          toolName: 'fail_unstructured',
          skipped: false,
          latencyMs: 5,
          protocolError: false,
          errorStructured: false,
        },
        {
          toolName: 'fails_nicely',
          skipped: false,
          latencyMs: 5,
          protocolError: false,
          errorStructured: true,
        },
      ]),
    );
    const hits = findings.filter((f) => f.ruleId === 'MCP403');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('warn');
    expect(hits[0]!.location?.toolName).toBe('fail_unstructured');
  });

  it('does not fire for tools that never errored', () => {
    const findings = findingsOf(artifact([ok('a'), ok('b')]));
    expect(findings.filter((f) => f.ruleId === 'MCP403')).toEqual([]);
  });
});
