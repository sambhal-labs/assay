import type { Artifact, Finding, ResolvedConfig, Rule } from './types.js';

export interface EngineResult {
  findings: Finding[];
  rulesRun: number;
}

/**
 * Runs every applicable rule against the artifact. Rules are pure and
 * synchronous; adapters have already done all I/O. Output ordering is
 * deterministic regardless of registration order.
 */
export function runRules(artifact: Artifact, rules: Rule[], config: ResolvedConfig): EngineResult {
  const findings: Finding[] = [];
  let rulesRun = 0;

  const ordered = [...rules].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  for (const rule of ordered) {
    if (!rule.meta.appliesTo.includes(artifact.type)) continue;
    const override = config.rules[rule.meta.id];
    if (override === 'off') continue;
    rulesRun += 1;

    let hits;
    try {
      hits = rule.check(artifact, config);
    } catch (err) {
      // Rules must never throw on any input — a throw here is an assay bug.
      throw new Error(
        `rule ${rule.meta.id} crashed on ${artifact.path}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    for (const hit of hits) {
      findings.push({
        ruleId: rule.meta.id,
        severity: override ?? rule.meta.severity,
        dimension: rule.meta.dimension,
        message: hit.message,
        fix: hit.fix ?? rule.meta.fixHint,
        ...(hit.location ? { location: hit.location } : {}),
        ...(hit.meta ? { meta: hit.meta } : {}),
      });
    }
  }

  findings.sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      (a.location?.file ?? '').localeCompare(b.location?.file ?? '') ||
      (a.location?.toolName ?? '').localeCompare(b.location?.toolName ?? '') ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0) ||
      a.message.localeCompare(b.message),
  );

  return { findings, rulesRun };
}
