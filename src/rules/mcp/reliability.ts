import type { Artifact, McpArtifact, ProbeToolResult, Rule, RuleHit } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asMcp = (a: Artifact): McpArtifact => a as McpArtifact;

/** Probe results for tools that were actually called. */
const probed = (mcp: McpArtifact): ProbeToolResult[] => (mcp.probe ?? []).filter((r) => !r.skipped);

/** Nearest-rank p95 over a non-empty list. */
export function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

// All MCP4xx rules are no-ops when artifact.probe is undefined: they only see
// evidence when the user opted into --probe, and absence of probing must
// never be graded as absence of reliability.
export const reliabilityRules: Rule[] = [
  {
    meta: {
      id: 'MCP401',
      title: 'Tool call fails at the protocol level',
      severity: 'warn',
      dimension: 'reliability',
      appliesTo: ['mcp-server'],
      fixHint:
        'Handle any input the advertised inputSchema admits; report tool failures as an isError result, never a protocol error.',
      docs: "The probe calls each tool with minimal arguments that satisfy the tool's own advertised inputSchema. A protocol-level failure on such a call (a JSON-RPC error, a timeout, or a reply that violates the MCP result shape) means the contract the server publishes is not the contract it enforces — hosts retry, mis-handle, or drop the tool entirely. Expected failures belong in a structured tool-level error result, not at the protocol layer.",
    },
    check: (artifact) =>
      probed(asMcp(artifact))
        .filter((r) => r.protocolError)
        .map((r): RuleHit => ({
          message: `probe call to "${r.toolName}" failed at the protocol level despite schema-valid arguments`,
          location: { toolName: r.toolName },
        })),
  },
  {
    meta: {
      id: 'MCP402',
      title: 'Probe p95 latency over budget',
      severity: 'info',
      dimension: 'reliability',
      appliesTo: ['mcp-server'],
      fixHint:
        'Cut cold-start and per-call overhead, or raise budgets.probeLatencyP95Ms if slow calls are inherent to the domain.',
      docs: 'Agents call tools in loops, and every slow call multiplies across a session while the host (and the user) waits. The p95 across probed calls is compared against budgets.probeLatencyP95Ms; one slow outlier is fine, a slow 95th percentile is the server, not the network.',
    },
    check: (artifact, config) => {
      const latencies = probed(asMcp(artifact))
        .map((r) => r.latencyMs)
        .filter((ms): ms is number => typeof ms === 'number');
      if (latencies.length === 0) return [];
      const p = p95(latencies);
      const budget = config.budgets.probeLatencyP95Ms;
      if (p <= budget) return [];
      return [
        {
          message: `p95 latency across ${latencies.length} probed tool${latencies.length === 1 ? '' : 's'} is ${p}ms (budget: ${budget}ms)`,
          meta: { p95Ms: p, budgetMs: budget },
        },
      ];
    },
  },
  {
    meta: {
      id: 'MCP403',
      title: 'Error responses lack machine-readable structure',
      severity: 'warn',
      dimension: 'reliability',
      appliesTo: ['mcp-server'],
      fixHint:
        'Return errors as structured content (e.g. a JSON body with a code and message) instead of a bare prose or stack-trace string.',
      docs: 'When a tool fails, the model reads the error and decides what to do next: retry, change arguments, or give up. A bare text blob — typically a stack trace — gives it nothing to reason over and often leaks implementation detail. A machine-readable error (JSON with a code/message, or multiple typed content items) turns failures into something an agent can actually recover from.',
    },
    check: (artifact) =>
      probed(asMcp(artifact))
        .filter((r) => r.errorStructured === false)
        .map((r): RuleHit => ({
          message: `"${r.toolName}" reports errors as a bare text blob with no machine-readable structure`,
          location: { toolName: r.toolName },
        })),
  },
];
