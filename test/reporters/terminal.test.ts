import { describe, expect, it } from 'vitest';
import type { Scorecard } from '../../src/core/types.js';
import { renderTerminal } from '../../src/reporters/terminal.js';

// Hand-built scorecard literal so reporter snapshots don't churn while rules
// land. Colors are injected off — snapshots must contain zero ANSI codes.
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
          location: { file: 'SKILL.md' },
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
      fix: 'SKILL.md is 6,412 tokens — split references out',
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

describe('renderTerminal', () => {
  it('renders the scorecard (no color)', () => {
    expect(renderTerminal(card, { color: false })).toMatchSnapshot();
  });

  it('quiet mode drops the findings detail but keeps top fixes', () => {
    const out = renderTerminal(card, { color: false, quiet: true });
    expect(out).toContain('Top fixes');
    expect(out).not.toContain('Findings');
  });

  it('annotates a security-capped grade with the uncapped score', () => {
    const capped: Scorecard = {
      ...card,
      composite: 79,
      compositeRaw: 95.5,
      grade: 'C+',
      securityCapped: true,
    };
    const out = renderTerminal(capped, { color: false });
    expect(out).toContain('security errors cap the grade at C+');
    expect(out).toContain('uncapped: 96');
  });

  it('contains no ANSI escapes with color disabled', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderTerminal(card, { color: false })).not.toMatch(/\[/);
  });

  it('stays within 80 columns', () => {
    const linesOver = renderTerminal(card, { color: false })
      .split('\n')
      .filter((l) => l.length > 80);
    expect(linesOver).toEqual([]);
  });
});
