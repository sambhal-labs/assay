import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ARTIFACT_TYPES = ['skill', 'mcp-server', 'context-file'] as const;
export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const SEVERITIES = ['error', 'warn', 'info'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const DIMENSIONS = [
  'structure',
  'trigger',
  'token',
  'instruction',
  'security',
  'protocol',
  'definition',
  'reliability',
  'quality',
] as const;
export const DimensionSchema = z.enum(DIMENSIONS);
export type Dimension = z.infer<typeof DimensionSchema>;

export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] as const;
export const GradeSchema = z.enum(GRADES);
export type Grade = z.infer<typeof GradeSchema>;

// ---------------------------------------------------------------------------
// Findings & scorecard (JSON output boundary — zod-validated)
// ---------------------------------------------------------------------------

export const FindingLocationSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().optional(),
  toolName: z.string().optional(),
});
export type FindingLocation = z.infer<typeof FindingLocationSchema>;

export const FindingSchema = z.object({
  ruleId: z.string(),
  severity: SeveritySchema,
  dimension: DimensionSchema,
  message: z.string(),
  fix: z.string(),
  location: FindingLocationSchema.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DimensionScoreSchema = z.object({
  dimension: DimensionSchema,
  label: z.string(),
  score: z.number(),
  grade: GradeSchema,
  weight: z.number(),
  findings: z.array(FindingSchema),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export const TopFixSchema = z.object({
  ruleId: z.string(),
  severity: SeveritySchema,
  dimension: DimensionSchema,
  message: z.string(),
  fix: z.string(),
  count: z.number().int(),
  gain: z.number(),
  projectedComposite: z.number(),
  projectedGrade: GradeSchema,
});
export type TopFix = z.infer<typeof TopFixSchema>;

export const EvalResultSchema = z.object({
  provider: z.string(),
  model: z.string(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  scenarios: z.number().int(),
  runDate: z.string(),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export const ScorecardSchema = z.object({
  schemaVersion: z.literal(1),
  assayVersion: z.string(),
  deterministic: z.boolean(),
  artifact: z.object({
    type: ArtifactTypeSchema,
    name: z.string(),
    path: z.string(),
  }),
  dimensions: z.array(DimensionScoreSchema),
  composite: z.number(),
  compositeRaw: z.number(),
  grade: GradeSchema,
  securityCapped: z.boolean(),
  topFixes: z.array(TopFixSchema),
  stats: z.object({
    tokens: z.number().int(),
    durationMs: z.number(),
    rulesRun: z.number().int(),
    findings: z.object({
      error: z.number().int(),
      warn: z.number().int(),
      info: z.number().int(),
    }),
  }),
  eval: EvalResultSchema.optional(),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

// ---------------------------------------------------------------------------
// Config (assay.config.json boundary — zod-validated)
// ---------------------------------------------------------------------------

export const RuleOverrideSchema = z.union([z.literal('off'), SeveritySchema]);
export type RuleOverride = z.infer<typeof RuleOverrideSchema>;

/** Every tunable numeric threshold. All values are config-overridable. */
export interface BudgetValues {
  descriptionMinChars: number;
  descriptionMaxChars: number;
  skillBodyTokensInfo: number;
  skillBodyTokensWarn: number;
  skillBodyMaxLines: number;
  skillCodeBlockMaxLines: number;
  similarityJaccard: number;
  base64MinLength: number;
  mcpConnectTimeoutMs: number;
  mcpToolTokensInfo: number;
  mcpToolTokensWarn: number;
  mcpServerTokensWarn: number;
  mcpMaxTools: number;
  probeLatencyP95Ms: number;
  ctxTokensInfo: number;
  ctxTokensWarn: number;
}

export const BudgetsSchema = z
  .object({
    descriptionMinChars: z.number().int().positive(),
    descriptionMaxChars: z.number().int().positive(),
    skillBodyTokensInfo: z.number().int().positive(),
    skillBodyTokensWarn: z.number().int().positive(),
    skillBodyMaxLines: z.number().int().positive(),
    skillCodeBlockMaxLines: z.number().int().positive(),
    similarityJaccard: z.number().min(0).max(1),
    base64MinLength: z.number().int().positive(),
    mcpConnectTimeoutMs: z.number().int().positive(),
    mcpToolTokensInfo: z.number().int().positive(),
    mcpToolTokensWarn: z.number().int().positive(),
    mcpServerTokensWarn: z.number().int().positive(),
    mcpMaxTools: z.number().int().positive(),
    probeLatencyP95Ms: z.number().int().positive(),
    ctxTokensInfo: z.number().int().positive(),
    ctxTokensWarn: z.number().int().positive(),
  })
  .partial();

export const AssayConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  rules: z.record(z.string(), RuleOverrideSchema).optional(),
  threshold: GradeSchema.optional(),
  exclude: z.array(z.string()).optional(),
  budgets: BudgetsSchema.optional(),
  eval: z
    .strictObject({
      maxUSD: z.number().positive().optional(),
      provider: z.enum(['anthropic', 'openai']).optional(),
      model: z.string().optional(),
    })
    .optional(),
});
export type AssayConfig = z.infer<typeof AssayConfigSchema>;

/** Config after merging user input with defaults — what rules and commands consume. */
export interface ResolvedConfig {
  rules: Record<string, RuleOverride>;
  threshold?: Grade;
  exclude: string[];
  budgets: BudgetValues;
  eval: { maxUSD: number; provider: 'anthropic' | 'openai'; model?: string };
}

// ---------------------------------------------------------------------------
// Normalized artifacts (internal — adapters produce these, rules consume them)
// Rules are synchronous pure functions: every fact a rule needs (file
// existence, token counts, sibling skills) is precomputed here by the adapter.
// ---------------------------------------------------------------------------

interface ArtifactBase {
  type: ArtifactType;
  /** Human-readable name (frontmatter name, server name, or file basename). */
  name: string;
  /** The path or target the user pointed us at. */
  path: string;
}

export interface SkillReference {
  link: string;
  exists: boolean;
  line: number;
}

/** name+description of other skills in the same repo scope (for SK106). */
export interface SkillSibling {
  name: string;
  description: string;
}

export interface SkillArtifact extends ArtifactBase {
  type: 'skill';
  skillFilePath: string;
  skillFileExists: boolean;
  raw: string;
  frontmatter: {
    present: boolean;
    parsed: Record<string, unknown> | null;
    error: string | null;
  };
  body: string;
  /** 1-based line where the body starts in SKILL.md (after frontmatter). */
  bodyStartLine: number;
  bodyLineCount: number;
  tokens: { total: number; body: number };
  /** Files in the skill directory other than SKILL.md (relative paths). */
  resourceFiles: string[];
  /** Relative links found in the body, resolved against the skill dir. */
  references: SkillReference[];
  siblings: SkillSibling[];
}

export interface McpToolInfo {
  name: string;
  description: string | undefined;
  inputSchema: Record<string, unknown> | undefined;
  /** Serialized as a host would embed it: name + description + schema. */
  tokens: number;
  /** False when the entry failed MCP spec shape validation (MCP002). */
  entryValid: boolean;
}

export interface ProbeToolResult {
  toolName: string;
  skipped: boolean;
  skipReason?: string;
  latencyMs?: number;
  protocolError?: boolean;
  errorStructured?: boolean;
}

export interface McpArtifact extends ArtifactBase {
  type: 'mcp-server';
  transport: 'stdio' | 'http';
  /** The command line or URL used to reach the server. */
  target: string;
  initialized: boolean;
  initializeError: string | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
  toolsListError: string | null;
  tools: McpToolInfo[];
  tokens: { total: number };
  probe?: ProbeToolResult[];
}

export type ContextFileKind =
  'claude-md' | 'agents-md' | 'cursorrules' | 'cursor-rules' | 'gemini-md';

export interface ContextFileRef {
  ref: string;
  exists: boolean;
  line: number;
}

export interface ContextCommandRef {
  command: string;
  known: boolean;
  line: number;
}

export interface ContextFileArtifact extends ArtifactBase {
  type: 'context-file';
  kind: ContextFileKind;
  raw: string;
  tokens: { total: number };
  /** Repo-relative file paths mentioned in the doc, with existence checks. */
  fileRefs: ContextFileRef[];
  /** Commands mentioned in the doc vs. package.json/Makefile/justfile targets. */
  commandRefs: ContextCommandRef[];
}

export type Artifact = SkillArtifact | McpArtifact | ContextFileArtifact;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * What a rule returns per occurrence. The engine stamps ruleId, effective
 * severity, dimension, and the default fixHint onto each hit to build Findings.
 */
export interface RuleHit {
  message: string;
  fix?: string;
  location?: FindingLocation;
  meta?: Record<string, unknown>;
}

export interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  dimension: Dimension;
  appliesTo: ArtifactType[];
  fixHint: string;
  /** One-paragraph rationale rendered into docs/RULES.md. */
  docs: string;
  /** An error finding from this rule caps the composite at C+. */
  securityCap?: boolean;
  /** Multiplies the severity penalty (CTX security rules use 2). */
  penaltyMultiplier?: number;
}

export interface Rule {
  meta: RuleMeta;
  check: (artifact: Artifact, config: ResolvedConfig) => RuleHit[];
}
