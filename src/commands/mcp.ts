import { parseMcpServer } from '../adapters/mcp.js';
import { AssayError } from '../core/errors.js';
import type { Scorecard } from '../core/types.js';
import { gradeArtifact } from '../pipeline.js';
import type { GlobalOptions, McpTarget } from '../program.js';
import { printScorecard, resolveConfig } from './grade.js';

/** `assay mcp <url>` / `assay mcp -- <cmd> [args...]` — connect, list, grade, print. */
export async function runMcp(target: McpTarget, opts: GlobalOptions): Promise<Scorecard> {
  if (target.probe) {
    throw new AssayError(
      '--probe (MCP reliability checks) lands in an upcoming PR',
      'run without --probe to grade protocol, definitions, tokens, and security',
    );
  }
  const config = await resolveConfig(opts);
  const started = performance.now();
  const artifact = await parseMcpServer(
    {
      ...(target.url ? { url: target.url } : {}),
      ...(target.command ? { command: target.command } : {}),
    },
    config,
  );
  const card = gradeArtifact(artifact, config, started);
  printScorecard(card, opts);
  return card;
}
