import {
  DECAY_STEPS,
  FOUNDATIONAL_CAP_SCORE,
  DECAY_TAIL,
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  GRADE_BANDS,
  MCP_PROBE_WEIGHTS,
  SECURITY_CAP_SCORE,
  SEVERITY_PENALTY,
  TOOL_VERSION,
} from '../constants.js';
import type {
  ArtifactType,
  Dimension,
  DimensionScore,
  Finding,
  Grade,
  RuleMeta,
  Scorecard,
  TopFix,
} from './types.js';

export function gradeFor(score: number): Grade {
  for (const [min, grade] of GRADE_BANDS) {
    if (score >= min) return grade;
  }
  return 'F';
}

/** Minimum composite score that earns the given grade. */
export function gradeMinScore(grade: Grade): number {
  const band = GRADE_BANDS.find(([, g]) => g === grade);
  return band ? band[0] : 0;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ScoreInput {
  artifact: { type: ArtifactType; name: string; path: string };
  findings: Finding[];
  /** Lookup for penaltyMultiplier / securityCap; unknown rules use defaults. */
  ruleMeta: (id: string) => RuleMeta | undefined;
  stats: { tokens: number; durationMs: number; rulesRun: number };
  /** MCP only: reliability dimension replaces 0.10 of definition's weight. */
  probing?: boolean;
}

function weightsFor(type: ArtifactType, probing: boolean): Partial<Record<Dimension, number>> {
  if (type === 'mcp-server' && probing) return MCP_PROBE_WEIGHTS;
  return DIMENSION_WEIGHTS[type];
}

/**
 * Deterministic scoring: each dimension starts at 100; findings subtract
 * severity penalties with per-rule step-down decay; the composite is the
 * weighted mean; any error from a security-capped rule pins the composite
 * to at most the top of the C+ band. Exact math: docs/GRADING.md.
 */
export function score(input: ScoreInput): Scorecard {
  const { artifact, findings, ruleMeta, stats } = input;
  const weights = weightsFor(artifact.type, input.probing ?? false);

  const { composite: compositeRaw, dimensions } = computeComposite(findings, weights, ruleMeta);

  const foundationalCapped =
    compositeRaw > FOUNDATIONAL_CAP_SCORE && findings.some((f) => f.foundational === true);
  const securityCapped =
    !foundationalCapped &&
    compositeRaw > SECURITY_CAP_SCORE &&
    findings.some((f) => triggersSecurityCap(f, ruleMeta));
  const composite = foundationalCapped
    ? FOUNDATIONAL_CAP_SCORE
    : securityCapped
      ? SECURITY_CAP_SCORE
      : compositeRaw;

  return {
    schemaVersion: 1,
    assayVersion: TOOL_VERSION,
    deterministic: true,
    artifact,
    dimensions,
    composite: round2(composite),
    compositeRaw: round2(compositeRaw),
    grade: gradeFor(composite),
    securityCapped,
    topFixes: computeTopFixes(findings, weights, ruleMeta, composite),
    stats: {
      tokens: stats.tokens,
      durationMs: stats.durationMs,
      rulesRun: stats.rulesRun,
      findings: {
        error: findings.filter((f) => f.severity === 'error').length,
        warn: findings.filter((f) => f.severity === 'warn').length,
        info: findings.filter((f) => f.severity === 'info').length,
      },
    },
  };
}

function triggersSecurityCap(f: Finding, ruleMeta: ScoreInput['ruleMeta']): boolean {
  if (f.severity !== 'error') return false;
  return f.dimension === 'security' || ruleMeta(f.ruleId)?.securityCap === true;
}

/** Foundational cap first (artifact can't load), then the security cap. */
function applyCaps(raw: number, findings: Finding[], ruleMeta: ScoreInput['ruleMeta']): number {
  if (raw > FOUNDATIONAL_CAP_SCORE && findings.some((f) => f.foundational === true)) {
    return FOUNDATIONAL_CAP_SCORE;
  }
  if (raw > SECURITY_CAP_SCORE && findings.some((f) => triggersSecurityCap(f, ruleMeta))) {
    return SECURITY_CAP_SCORE;
  }
  return raw;
}

function computeComposite(
  findings: Finding[],
  weights: Partial<Record<Dimension, number>>,
  ruleMeta: ScoreInput['ruleMeta'],
): { composite: number; dimensions: DimensionScore[] } {
  const dimensions: DimensionScore[] = [];
  let composite = 0;

  for (const [dimension, weight] of Object.entries(weights) as [Dimension, number][]) {
    const dimFindings = findings.filter((f) => f.dimension === dimension);
    const byRule = new Map<string, Finding[]>();
    for (const f of dimFindings) {
      const list = byRule.get(f.ruleId) ?? [];
      list.push(f);
      byRule.set(f.ruleId, list);
    }

    let penalty = 0;
    for (const [ruleId, instances] of byRule) {
      const base = SEVERITY_PENALTY[instances[0]!.severity];
      const multiplier = ruleMeta(ruleId)?.penaltyMultiplier ?? 1;
      instances.forEach((_, i) => {
        const decay = DECAY_STEPS[i] ?? DECAY_TAIL;
        penalty += base * multiplier * decay;
      });
    }

    const dimScore = Math.max(0, 100 - penalty);
    composite += dimScore * weight;
    dimensions.push({
      dimension,
      label: DIMENSION_LABELS[dimension],
      score: round2(dimScore),
      grade: gradeFor(dimScore),
      weight,
      findings: dimFindings,
    });
  }

  return { composite, dimensions };
}

/**
 * Top 3 fixes ranked by composite-score gain if every instance of that rule
 * were fixed (that's what a human fix does), including any un-capping effect.
 */
function computeTopFixes(
  findings: Finding[],
  weights: Partial<Record<Dimension, number>>,
  ruleMeta: ScoreInput['ruleMeta'],
  currentComposite: number,
): TopFix[] {
  const ruleIds = [...new Set(findings.map((f) => f.ruleId))].sort();

  const candidates = ruleIds.map((ruleId) => {
    const remaining = findings.filter((f) => f.ruleId !== ruleId);
    const { composite: raw } = computeComposite(remaining, weights, ruleMeta);
    const projected = applyCaps(raw, remaining, ruleMeta);
    const instances = findings.filter((f) => f.ruleId === ruleId);
    const first = instances[0]!;
    return {
      ruleId,
      severity: first.severity,
      dimension: first.dimension,
      message: first.message,
      fix: first.fix,
      count: instances.length,
      gain: round2(projected - currentComposite),
      projectedComposite: round2(projected),
      projectedGrade: gradeFor(projected),
    };
  });

  return candidates
    .filter((c) => c.gain > 0)
    .sort((a, b) => b.gain - a.gain || a.ruleId.localeCompare(b.ruleId))
    .slice(0, 3);
}
