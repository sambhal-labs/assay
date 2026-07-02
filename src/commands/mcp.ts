import { parseMcpServer } from '../adapters/mcp.js';
import type { ProbeToolResult, Scorecard } from '../core/types.js';
import { gradeArtifact } from '../pipeline.js';
import type { GlobalOptions, McpTarget } from '../program.js';
import { printScorecard, resolveConfig } from './grade.js';

/**
 * Safe-mode transparency: the user must see exactly which tools the probe
 * refused to call and why. stderr, so JSON output stays machine-parseable.
 */
function printSkippedToolReport(probe: ProbeToolResult[]): void {
  const skipped = probe.filter((r) => r.skipped);
  if (skipped.length === 0) return;
  process.stderr.write(
    `probe: skipped ${skipped.length} of ${probe.length} tool${probe.length === 1 ? '' : 's'} (safe mode — pass --unsafe to probe mutation-named tools):\n`,
  );
  for (const r of skipped) {
    process.stderr.write(`  - ${r.toolName}  (${r.skipReason ?? 'unknown reason'})\n`);
  }
}

/** `assay mcp <url>` / `assay mcp -- <cmd> [args...]` — connect, list, grade, print. */
export async function runMcp(target: McpTarget, opts: GlobalOptions): Promise<Scorecard> {
  const config = await resolveConfig(opts);
  const started = performance.now();
  const artifact = await parseMcpServer(
    {
      ...(target.url ? { url: target.url } : {}),
      ...(target.command ? { command: target.command } : {}),
    },
    config,
    { probe: target.probe, unsafe: target.unsafe },
  );
  if (target.probe) printSkippedToolReport(artifact.probe ?? []);
  const card = gradeArtifact(artifact, config, started, { probing: target.probe });
  printScorecard(card, opts);
  return card;
}
