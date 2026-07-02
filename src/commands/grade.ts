import { detectTarget } from '../adapters/detect.js';
import { parseSkill } from '../adapters/skill.js';
import { loadConfig, parseRuleFlags } from '../core/config.js';
import { AssayError } from '../core/errors.js';
import type { Artifact, ResolvedConfig, Scorecard } from '../core/types.js';
import { ScorecardSchema } from '../core/types.js';
import { gradeArtifact } from '../pipeline.js';
import { renderMarkdown } from '../reporters/markdown.js';
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
    process.stdout.write(`${renderMarkdown(card)}\n`);
    return;
  }
  process.stdout.write(
    `${renderTerminal(card, { quiet: opts.quiet, ...(opts.color !== undefined ? { color: opts.color } : {}) })}\n`,
  );
}

/**
 * Grades a single-artifact target (skill dir or context file). Repo targets
 * are the caller's job (runGrade routes them to repo mode; ci/badge collect).
 */
export async function gradeSingleTarget(
  target: string,
  config: ResolvedConfig,
): Promise<Scorecard> {
  const started = performance.now();
  const detected = await detectTarget(target);

  let artifact: Artifact;
  if (detected.kind === 'skill') {
    // Report the path as the user typed it, not the resolved absolute path.
    artifact = { ...(await parseSkill(detected.dir)), path: target };
  } else if (detected.kind === 'context-file') {
    const { parseContextFile } = await import('../adapters/contextfile.js');
    artifact = { ...(await parseContextFile(detected.file)), path: target };
  } else {
    throw new AssayError(
      `${target} is a repository, not a single artifact`,
      'use `assay repo` (or plain `assay <dir>`) for repositories',
    );
  }

  return gradeArtifact(artifact, config, started);
}

/**
 * `assay <path>` — detect, grade, print. A repo target routes to repo mode,
 * which prints its own rollup.
 */
export async function runGrade(target: string, opts: GlobalOptions): Promise<void> {
  const detected = await detectTarget(target);
  if (detected.kind === 'repo') {
    const { runRepo } = await import('./repo.js');
    await runRepo(target, opts);
    return;
  }
  const config = await resolveConfig(opts);
  printScorecard(await gradeSingleTarget(target, config), opts);
}

/**
 * `assay skill <dir>` — explicitly a skill; anything else is a usage error,
 * never a silent fallback to repo/context grading (a typo'd path would
 * otherwise produce a plausible-looking but wrong report).
 */
export async function runGradeSkill(target: string, opts: GlobalOptions): Promise<void> {
  const detected = await detectTarget(target);
  if (detected.kind !== 'skill') {
    throw new AssayError(
      `${target} is not a skill directory (no SKILL.md found)`,
      'use plain `assay <path>` for auto-detection, or `assay repo` for repositories',
    );
  }
  const config = await resolveConfig(opts);
  printScorecard(await gradeSingleTarget(target, config), opts);
}
