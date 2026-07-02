import { describe, expect, it } from 'vitest';
import type { Scorecard } from '../../src/core/types.js';
import { renderMarkdown } from '../../src/reporters/markdown.js';

// Hand-built scorecard literal so reporter snapshots don't churn while rules
// land — same pattern as terminal.test.ts.
const card: Scorecard = {
  schemaVersion: 1,
  assayVersion: '0.1.0',
  deterministic: true,
  artifact: { type: 'skill', name: 'pdf-tools', path: 'skills/pdf-tools' },
  dimensions: [
    {
      dimension: 'structure',
      label: 'Structure',
      score: 100,
      grade: 'A+',
      weight: 0.15,
      findings: [],
    },
    {
      dimension: 'trigger',
      label: 'Trigger quality',
      score: 62,
      grade: 'D',
      weight: 0.3,
      findings: [
        {
          ruleId: 'SK103',
          severity: 'warn',
          dimension: 'trigger',
          message: 'description has no usage guidance',
          fix: 'Add "Use when…" guidance to the description',
        },
        {
          ruleId: 'SK104',
          severity: 'warn',
          dimension: 'trigger',
          message: 'description names no concrete actions',
          fix: 'Name the verbs and objects the skill handles',
        },
      ],
    },
    {
      dimension: 'token',
      label: 'Token efficiency',
      score: 71,
      grade: 'C-',
      weight: 0.2,
      findings: [
        {
          ruleId: 'SK202',
          severity: 'warn',
          dimension: 'token',
          message: 'SKILL.md body is 6,412 tokens',
          fix: 'Split reference material into companion files',
          location: { file: 'SKILL.md', line: 12 },
        },
      ],
    },
    {
      dimension: 'instruction',
      label: 'Instruction quality',
      score: 83,
      grade: 'B',
      weight: 0.15,
      findings: [],
    },
    {
      dimension: 'security',
      label: 'Security',
      score: 100,
      grade: 'A+',
      weight: 0.2,
      findings: [],
    },
  ],
  composite: 74.1,
  compositeRaw: 74.1,
  grade: 'C+',
  securityCapped: false,
  foundationalCapped: false,
  topFixes: [
    {
      ruleId: 'SK103',
      severity: 'warn',
      dimension: 'trigger',
      message: 'description has no usage guidance',
      fix: 'Add "Use when…" guidance to the description',
      count: 1,
      gain: 9,
      projectedComposite: 83.1,
      projectedGrade: 'B',
    },
    {
      ruleId: 'SK202',
      severity: 'warn',
      dimension: 'token',
      message: 'SKILL.md body is 6,412 tokens',
      fix: 'Split reference material into companion files',
      count: 1,
      gain: 5,
      projectedComposite: 79.1,
      projectedGrade: 'C+',
    },
  ],
  stats: {
    tokens: 6412,
    durationMs: 800,
    rulesRun: 30,
    findings: { error: 0, warn: 3, info: 0 },
  },
};

const clean: Scorecard = {
  ...card,
  dimensions: card.dimensions.map((d) => ({ ...d, findings: [] })),
  composite: 98.2,
  compositeRaw: 98.2,
  grade: 'A+',
  topFixes: [],
};

/** Every contiguous block of `|`-rows must have a uniform column count. */
function tableBlocks(md: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('|')) {
      current.push(line);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

const columnCount = (row: string): number => row.replace(/\\\|/g, '').split('|').length - 2; // ignore escaped pipes, outer edges

describe('renderMarkdown', () => {
  it('renders the PR comment (snapshot)', () => {
    expect(renderMarkdown(card)).toMatchSnapshot();
  });

  it('leads with an H2 carrying grade, composite, and artifact type/path', () => {
    const firstLine = renderMarkdown(card).split('\n')[0]!;
    expect(firstLine).toBe('## assay: C+ (74.1) — skill `skills/pdf-tools`');
  });

  it('renders well-formed GFM tables (uniform column counts)', () => {
    const blocks = tableBlocks(renderMarkdown(card));
    expect(blocks).toHaveLength(2); // dimensions + findings
    for (const block of blocks) {
      expect(block.length).toBeGreaterThanOrEqual(3); // header + separator + rows
      const cols = columnCount(block[0]!);
      expect(cols).toBe(4);
      for (const row of block) expect(columnCount(row)).toBe(cols);
    }
  });

  it('escapes pipes inside table cells', () => {
    const piped: Scorecard = {
      ...card,
      dimensions: card.dimensions.map((d) =>
        d.dimension === 'token'
          ? {
              ...d,
              findings: [{ ...d.findings[0]!, message: 'uses `a | b` unquoted' }],
            }
          : d,
      ),
    };
    const out = renderMarkdown(piped);
    expect(out).toContain('uses `a \\| b` unquoted');
    for (const block of tableBlocks(out)) {
      for (const row of block) expect(columnCount(row)).toBe(4);
    }
  });

  it('lists top fixes with projected gain and grade', () => {
    const out = renderMarkdown(card);
    expect(out).toContain('### Top fixes');
    expect(out).toContain(
      '1. **SK103** — Add "Use when…" guidance to the description (+9 → B 83.1)',
    );
    expect(out).toContain('2. **SK202**');
  });

  it('calls out a security-capped grade with the uncapped score', () => {
    const capped: Scorecard = {
      ...card,
      composite: 79,
      compositeRaw: 95.5,
      grade: 'C+',
      securityCapped: true,
      foundationalCapped: false,
    };
    const out = renderMarkdown(capped);
    const callout = out.split('\n').find((l) => l.startsWith('> '));
    expect(callout).toContain('Security cap applied');
    expect(callout).toContain('95.5');
    expect(callout).toContain('C+');
  });

  it('omits the cap callout, findings, and top fixes when clean', () => {
    const out = renderMarkdown(clean);
    expect(out).not.toContain('> ');
    expect(out).not.toContain('### Findings');
    expect(out).not.toContain('### Top fixes');
  });

  it('renders a grade-delta line when previousGrade is given', () => {
    expect(renderMarkdown(card, { previousGrade: 'B+' })).toContain('**Grade:** B+ → C+');
    expect(renderMarkdown(card, { previousGrade: 'C+' })).toContain('**Grade:** C+ (unchanged)');
    expect(renderMarkdown(card)).not.toContain('**Grade:**');
  });

  it('footer carries version, determinism, rules run, tokens, and docs link', () => {
    const out = renderMarkdown(card);
    expect(out).toContain(
      'assay v0.1.0 · deterministic · 30 rules run · ~6,412 tokens · [rule docs](https://github.com/sambhal-labs/assay/blob/main/docs/RULES.md)',
    );
    expect(renderMarkdown({ ...card, deterministic: false })).toContain(
      'not deterministic (includes eval)',
    );
  });

  it('contains no raw ANSI escapes', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderMarkdown(card)).not.toMatch(/\[/);
  });
});
