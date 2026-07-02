/**
 * Strict parsing of judge-model output and the precision/recall/F1 math.
 * Pure functions — everything here is unit-testable without a provider.
 */

/** Models love fencing JSON even when told not to; tolerate exactly that. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/.exec(trimmed);
  return (match ? match[1]! : trimmed).trim();
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses a routing answer: {"skill": "<name>"} or {"skill": null}.
 * Returns null when the output is not exactly that shape (→ retry, then
 * routing miss).
 */
export function parseSkillChoice(text: string): { skill: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !('skill' in parsed)) return null;
  const skill = parsed.skill;
  if (skill === null) return { skill: null };
  if (typeof skill === 'string' && skill.trim()) return { skill: skill.trim() };
  return null;
}

/**
 * Parses the generated positive prompts: a JSON array of at least `count`
 * non-empty strings (extras are dropped). Returns null when unparseable.
 */
export function parsePositives(text: string, count: number): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const strings = parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  if (strings.length < count) return null;
  return strings.slice(0, count);
}

export interface ScenarioOutcome {
  kind: 'positive' | 'negative';
  /** Whether the judge selected the TARGET skill for this request. */
  selected: boolean;
}

export interface EvalMetrics {
  precision: number;
  recall: number;
  f1: number;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * Precision/recall/F1 over "target selected": positives should select it
 * (misses cost recall), negatives must not (false claims cost precision).
 * Degenerate 0/0 ratios collapse to 0 — a judge that never picks the target
 * has not earned a perfect precision.
 */
export function computeMetrics(outcomes: ScenarioOutcome[]): EvalMetrics {
  const tp = outcomes.filter((o) => o.kind === 'positive' && o.selected).length;
  const fn = outcomes.filter((o) => o.kind === 'positive' && !o.selected).length;
  const fp = outcomes.filter((o) => o.kind === 'negative' && o.selected).length;

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision: round4(precision), recall: round4(recall), f1: round4(f1) };
}
