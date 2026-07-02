import { describe, expect, it } from 'vitest';
import type { Grade, Scorecard } from '../../src/core/types.js';
import { meetsThreshold, renderRepoMarkdown, worstGrade } from '../../src/commands/repo.js';

function card(path: string, grade: Grade, composite: number): Scorecard {
  return {
    schemaVersion: 1,
    assayVersion: '0.1.0',
    deterministic: true,
    artifact: { type: 'skill', name: path, path },
    dimensions: [],
    composite,
    compositeRaw: composite,
    grade,
    securityCapped: false,
    topFixes: [
      {
        ruleId: 'SK103',
        severity: 'warn',
        dimension: 'trigger',
        message: 'no usage guidance',
        fix: 'Add "Use when…" guidance',
        count: 1,
        gain: 3,
        projectedComposite: composite + 3,
        projectedGrade: grade,
      },
    ],
    stats: { tokens: 100, durationMs: 10, rulesRun: 30, findings: { error: 0, warn: 1, info: 0 } },
  };
}

describe('worstGrade', () => {
  it('returns the weakest grade across artifacts', () => {
    expect(worstGrade([card('a', 'A+', 99), card('b', 'C-', 71), card('c', 'B', 84)])).toBe('C-');
  });

  it('handles a single artifact', () => {
    expect(worstGrade([card('a', 'B+', 88)])).toBe('B+');
  });
});

describe('meetsThreshold', () => {
  it.each([
    ['A', 'B', true],
    ['B', 'B', true],
    ['B-', 'B', false],
    ['C+', 'A', false],
    ['A+', 'A+', true],
    ['D', 'D', true],
    ['F', 'D', false],
  ] as [Grade, Grade, boolean][])('%s vs threshold %s → %s', (grade, threshold, ok) => {
    expect(meetsThreshold(grade, threshold)).toBe(ok);
  });
});

describe('renderRepoMarkdown', () => {
  it('renders the rollup table with overall grade', () => {
    const md = renderRepoMarkdown({
      cards: [card('skills/a', 'A', 95), card('CLAUDE.md', 'C+', 78)],
      overall: 'C+',
    });
    expect(md).toContain('overall **C+**');
    expect(md).toContain('| skills/a | skill | **A** | 95 |');
    expect(md).toContain('`SK103`');
    expect(md).toContain('weakest artifact gates the repo');
  });
});
