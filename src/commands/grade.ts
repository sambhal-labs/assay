import { detectTarget } from '../adapters/detect.js';
import { parseSkill } from '../adapters/skill.js';
import { loadConfig, parseRuleFlags } from '../core/config.js';
import { AssayError } from '../core/errors.js';
import type { Artifact, ResolvedConfig, Scorecard } from '../core/types.js';
import { ScorecardSchema } from '../core/types.js';
import { gradeArtifact } from '../pipeline.js';
import { renderTerminal } from '../reporters/terminal.js';
import type { GlobalOptions } from '../program.js';

export async function resolveConfig(opts: GlobalOptions): Promise<ResolvedConfig> {
  const config = await loadConfig(opts.config);
  if (opts.rules) Object.assign(config.rules, parseRuleFlags(opts.rules));
  return config;
}

export function printScorecard(card: Scorecard, opts: GlobalOptions): void {
  if (opts.format === 'json') {
    // Validate on the way out — the schema is the public contract.
    process.stdout.write(`${JSON.stringify(ScorecardSchema.parse(card), null, 2)}\n`);
    return;
  }
  if (opts.format === 'md') {
    throw new AssayError(
      'the markdown reporter lands in an upcoming PR — use --format terminal or json',
    );
  }
  process.stdout.write(
    `${renderTerminal(card, { quiet: opts.quiet, ...(opts.color !== undefined ? { color: opts.color } : {}) })}\n`,
  );
}

/** `assay <path>` / `assay skill <dir>` — detect, parse, grade, print. */
export async function runGrade(target: string, opts: GlobalOptions): Promise<Scorecard> {
  const config = await resolveConfig(opts);
  const started = performance.now();
  const detected = await detectTarget(target);

  let artifact: Artifact;
  if (detected.kind === 'skill') {
    // Report the path as the user typed it, not the resolved absolute path.
    artifact = { ...(await parseSkill(detected.dir)), path: target };
  } else if (detected.kind === 'context-file') {
    throw new AssayError('context-file grading lands in an upcoming PR');
  } else {
    throw new AssayError(
      'repo mode lands in an upcoming PR',
      'point assay at a skill directory (containing SKILL.md) for now',
    );
  }

  const card = gradeArtifact(artifact, config, started);
  printScorecard(card, opts);
  return card;
}
