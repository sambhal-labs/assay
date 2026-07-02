import { ScorecardSchema, type Scorecard } from '../core/types.js';

/**
 * Machine-readable output. ScorecardSchema (schemaVersion 1) IS the public
 * contract: the card is re-validated through the schema on the way out, so
 * anything assay emits as JSON is guaranteed to parse back through the same
 * schema. Unknown extra keys are stripped, and a card that drifted from the
 * contract fails loudly here instead of surfacing as broken CI parsers.
 */
export function renderJson(card: Scorecard): string {
  const parsed = ScorecardSchema.parse(card);
  return JSON.stringify(parsed, null, 2);
}
