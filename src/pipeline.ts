import { runRules } from './core/engine.js';
import { score } from './core/scorer.js';
import type { Artifact, ResolvedConfig, Scorecard } from './core/types.js';
import { allRules, ruleMetaById } from './rules/index.js';

/**
 * Engine + scorer over the built-in registry. `startedAtMs` comes from the
 * caller (performance.now() before adapter parsing) so durationMs covers the
 * full run, not just rule evaluation.
 */
export function gradeArtifact(
  artifact: Artifact,
  config: ResolvedConfig,
  startedAtMs: number,
  options: { probing?: boolean } = {},
): Scorecard {
  const { findings, rulesRun } = runRules(artifact, allRules, config);
  return score({
    artifact: { type: artifact.type, name: artifact.name, path: artifact.path },
    findings,
    ruleMeta: ruleMetaById,
    stats: {
      tokens: artifact.tokens.total,
      durationMs: Math.round(performance.now() - startedAtMs),
      rulesRun,
    },
    ...(options.probing !== undefined ? { probing: options.probing } : {}),
  });
}
