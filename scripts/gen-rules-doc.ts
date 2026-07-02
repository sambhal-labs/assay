/**
 * Generates docs/RULES.md from registered rule metadata.
 *
 * Run with: npm run gen:docs
 *
 * The rule modules are the single source of truth — this script only formats
 * what `allRules` exports. Output is deterministic (fixed section order,
 * rules sorted by ID, no timestamps) so regeneration is diff-stable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIMENSION_LABELS } from '../src/constants.js';
import type { ArtifactType, Dimension, Rule } from '../src/core/types.js';
import { ARTIFACT_TYPES, DIMENSIONS } from '../src/core/types.js';
import { allRules } from '../src/rules/index.js';

const TYPE_HEADINGS: Record<ArtifactType, string> = {
  skill: 'Skills (SK)',
  'mcp-server': 'MCP servers (MCP)',
  'context-file': 'Context files (CTX)',
};

function byId(a: Rule, b: Rule): number {
  return a.meta.id.localeCompare(b.meta.id);
}

function renderRule(rule: Rule): string {
  const m = rule.meta;
  const badges = [
    `**Severity:** ${m.severity}`,
    `**Dimension:** ${DIMENSION_LABELS[m.dimension]}`,
    ...(m.securityCap
      ? ['**Security cap** — an error from this rule pins the composite at C+']
      : []),
    ...(m.penaltyMultiplier !== undefined
      ? [`**Penalty multiplier:** ×${m.penaltyMultiplier}`]
      : []),
  ];
  return [
    `#### ${m.id} — ${m.title}`,
    '',
    badges.join(' · '),
    '',
    m.docs,
    '',
    `**Fix:** ${m.fixHint}`,
  ].join('\n');
}

function renderTypeSection(type: ArtifactType, rules: Rule[]): string {
  const parts: string[] = [`## ${TYPE_HEADINGS[type]}`];
  for (const dimension of DIMENSIONS) {
    const dimRules = rules.filter((r) => r.meta.dimension === dimension).sort(byId);
    if (dimRules.length === 0) continue;
    parts.push(`\n### Dimension: ${DIMENSION_LABELS[dimension as Dimension]}`);
    for (const rule of dimRules) parts.push(`\n${renderRule(rule)}`);
  }
  return parts.join('\n');
}

function generate(): string {
  const sections: string[] = [
    '<!--',
    '  GENERATED FILE — DO NOT EDIT BY HAND.',
    '  Regenerate with: npm run gen:docs',
    '  Source of truth: rule metadata in src/rules/**',
    '-->',
    '',
    '# Assay rules',
    '',
    `${allRules.length} built-in rules. Severities and thresholds shown are defaults; both are`,
    'overridable via `assay.config.json` ("rules", "budgets") or the `--rules` flag.',
    'Scoring math: [GRADING.md](GRADING.md).',
    '',
  ];
  for (const type of ARTIFACT_TYPES) {
    const rules = allRules.filter((r) => r.meta.appliesTo.includes(type));
    if (rules.length === 0) continue;
    sections.push(renderTypeSection(type, rules), '');
  }
  return `${sections.join('\n').trimEnd()}\n`;
}

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'RULES.md');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, generate(), 'utf8');
console.log(`wrote ${outPath} (${allRules.length} rules)`);
