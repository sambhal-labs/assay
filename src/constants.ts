import type { ArtifactType, BudgetValues, Dimension, Grade, Severity } from './core/types.js';

export const TOOL_NAME = 'assay';
export const PACKAGE_NAME = 'assaydev';
export const TOOL_VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/sambhal-labs/assay';
export const RULES_DOCS_URL = `${REPO_URL}/blob/main/docs/RULES.md`;

export const EXIT = {
  OK: 0,
  BELOW_THRESHOLD: 1,
  ERROR: 2,
} as const;

// ---------------------------------------------------------------------------
// Scoring (docs/GRADING.md is the human-readable mirror of this section)
// ---------------------------------------------------------------------------

export const SEVERITY_PENALTY: Record<Severity, number> = {
  error: 15,
  warn: 5,
  info: 1,
};

/** Repeat findings from one rule decay: full, x0.5, x0.25, then x0.1 each. */
export const DECAY_STEPS = [1, 0.5, 0.25] as const;
export const DECAY_TAIL = 0.1;

/** Ordered high→low; first band whose minimum the score meets wins. */
export const GRADE_BANDS: ReadonlyArray<readonly [number, Grade]> = [
  [97, 'A+'],
  [93, 'A'],
  [90, 'A-'],
  [87, 'B+'],
  [83, 'B'],
  [80, 'B-'],
  [77, 'C+'],
  [73, 'C'],
  [70, 'C-'],
  [60, 'D'],
];

/**
 * Any error finding from a security-capped rule pins the composite to at most
 * the top of the C+ band. An injectable A-grade artifact is a lie.
 */
export const SECURITY_CAP_SCORE = 79;

export const DIMENSION_WEIGHTS: Record<ArtifactType, Partial<Record<Dimension, number>>> = {
  skill: { structure: 0.15, trigger: 0.3, token: 0.2, instruction: 0.15, security: 0.2 },
  'mcp-server': { protocol: 0.2, definition: 0.3, token: 0.2, security: 0.3 },
  'context-file': { quality: 1 },
};

/** With --probe, reliability takes 0.10 of definition's weight. */
export const MCP_PROBE_WEIGHTS: Partial<Record<Dimension, number>> = {
  protocol: 0.2,
  definition: 0.2,
  token: 0.2,
  security: 0.3,
  reliability: 0.1,
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  structure: 'Structure',
  trigger: 'Trigger quality',
  token: 'Token efficiency',
  instruction: 'Instruction quality',
  security: 'Security',
  protocol: 'Protocol compliance',
  definition: 'Definition quality',
  reliability: 'Reliability',
  quality: 'Quality',
};

// ---------------------------------------------------------------------------
// Budgets (config-overridable via assay.config.json "budgets")
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGETS: BudgetValues = {
  descriptionMinChars: 20,
  descriptionMaxChars: 1024,
  skillBodyTokensInfo: 2000,
  skillBodyTokensWarn: 5000,
  skillBodyMaxLines: 300,
  skillCodeBlockMaxLines: 80,
  similarityJaccard: 0.6,
  base64MinLength: 200,
  mcpConnectTimeoutMs: 15_000,
  mcpToolTokensInfo: 400,
  mcpToolTokensWarn: 800,
  mcpServerTokensWarn: 8000,
  mcpMaxTools: 30,
  probeLatencyP95Ms: 5000,
  ctxTokensInfo: 1500,
  ctxTokensWarn: 4000,
};

export const DEFAULT_EVAL = { maxUSD: 0.5, provider: 'anthropic' } as const;

/** Default judge models per provider; overridable via config `eval.model`. */
export const EVAL_MODELS: Record<'anthropic' | 'openai', string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
};

/**
 * Used by MCP202 to translate a server's context tax into dollars.
 * Snapshot values — verify against the provider pricing page when bumping.
 */
export const PRICE_SNAPSHOT = {
  model: 'claude-sonnet-5',
  inputUSDPerMTok: 3,
  date: '2026-07-02',
};
