import { describe, expect, it } from 'vitest';
import { gradeFor, score, type ScoreInput } from '../../src/core/scorer.js';
import type { Finding, RuleMeta, Severity } from '../../src/core/types.js';

function finding(ruleId: string, severity: Severity, dimension: Finding['dimension']): Finding {
  return { ruleId, severity, dimension, message: `${ruleId} fired`, fix: 'fix it' };
}

const noMeta = (): RuleMeta | undefined => undefined;

function scoreSkill(findings: Finding[], ruleMeta: ScoreInput['ruleMeta'] = noMeta) {
  return score({
    artifact: { type: 'skill', name: 'test-skill', path: '/tmp/test-skill' },
    findings,
    ruleMeta,
    stats: { tokens: 100, durationMs: 5, rulesRun: 30 },
  });
}

describe('gradeFor', () => {
  it.each([
    [100, 'A+'],
    [97, 'A+'],
    [96.99, 'A'],
    [93, 'A'],
    [90, 'A-'],
    [87, 'B+'],
    [83, 'B'],
    [80, 'B-'],
    [79, 'C+'],
    [77, 'C+'],
    [73, 'C'],
    [70, 'C-'],
    [60, 'D'],
    [59.99, 'F'],
    [0, 'F'],
  ])('%d → %s', (n, grade) => {
    expect(gradeFor(n)).toBe(grade);
  });
});

describe('score', () => {
  it('perfect artifact: all dimensions 100, composite 100, A+', () => {
    const card = scoreSkill([]);
    expect(card.composite).toBe(100);
    expect(card.grade).toBe('A+');
    expect(card.securityCapped).toBe(false);
    expect(card.dimensions).toHaveLength(5);
    expect(card.dimensions.every((d) => d.score === 100)).toBe(true);
  });

  it('single error subtracts 15 from its dimension, weighted into composite', () => {
    const card = scoreSkill([finding('SK101', 'error', 'trigger')]);
    const trigger = card.dimensions.find((d) => d.dimension === 'trigger')!;
    expect(trigger.score).toBe(85);
    // 100 - 15 * 0.30 trigger weight
    expect(card.composite).toBe(95.5);
    expect(card.grade).toBe('A');
  });

  it('repeat findings from one rule decay: full, x0.5, x0.25, then x0.1', () => {
    const five = Array.from({ length: 5 }, () => finding('SK104', 'warn', 'trigger'));
    const card = scoreSkill(five);
    const trigger = card.dimensions.find((d) => d.dimension === 'trigger')!;
    // 5 * (1 + 0.5 + 0.25 + 0.1 + 0.1) = 9.75
    expect(trigger.score).toBe(90.25);
  });

  it('40 repeats of one warn rule do not obliterate the dimension', () => {
    const many = Array.from({ length: 40 }, () => finding('MCP104', 'warn', 'definition'));
    const card = score({
      artifact: { type: 'mcp-server', name: 's', path: 'cmd' },
      findings: many,
      ruleMeta: noMeta,
      stats: { tokens: 0, durationMs: 0, rulesRun: 20 },
    });
    const def = card.dimensions.find((d) => d.dimension === 'definition')!;
    // 5 * (1.75 + 37 * 0.1) = 27.25
    expect(def.score).toBe(72.75);
  });

  it('distinct rules do not decay against each other, dimension floors at 0', () => {
    const findings = Array.from({ length: 7 }, (_, i) => finding(`SK90${i}`, 'error', 'structure'));
    const card = scoreSkill(findings);
    const structure = card.dimensions.find((d) => d.dimension === 'structure')!;
    expect(structure.score).toBe(0); // 7 * 15 = 105 → floor
  });

  it('security error caps composite at 79 / C+ and reports raw score', () => {
    const card = scoreSkill([finding('SK401', 'error', 'security')]);
    expect(card.compositeRaw).toBe(97); // 100 - 15 * 0.20
    expect(card.composite).toBe(79);
    expect(card.grade).toBe('C+');
    expect(card.securityCapped).toBe(true);
  });

  it('securityCap rule meta triggers the cap outside the security dimension', () => {
    const meta: RuleMeta = {
      id: 'CTX006',
      title: 'shared security detectors',
      severity: 'error',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'remove it',
      docs: '',
      securityCap: true,
      penaltyMultiplier: 2,
    };
    const card = score({
      artifact: { type: 'context-file', name: 'CLAUDE.md', path: 'CLAUDE.md' },
      findings: [finding('CTX006', 'error', 'quality')],
      ruleMeta: (id) => (id === 'CTX006' ? meta : undefined),
      stats: { tokens: 0, durationMs: 0, rulesRun: 6 },
    });
    // penaltyMultiplier 2: quality = 100 - 30 = 70; already below cap
    expect(card.dimensions[0]!.score).toBe(70);
    expect(card.composite).toBe(70);
    expect(card.securityCapped).toBe(false); // cap only reported when it changed the score
  });

  it('security warn does not trigger the cap', () => {
    const card = scoreSkill([finding('SK404', 'warn', 'security')]);
    expect(card.securityCapped).toBe(false);
    expect(card.grade).toBe('A+'); // 100 - 5 * 0.2 = 99
  });

  it('probing swaps MCP weights to include reliability', () => {
    const card = score({
      artifact: { type: 'mcp-server', name: 's', path: 'cmd' },
      findings: [],
      ruleMeta: noMeta,
      stats: { tokens: 0, durationMs: 0, rulesRun: 25 },
      probing: true,
    });
    const dims = card.dimensions.map((d) => d.dimension);
    expect(dims).toContain('reliability');
    expect(card.dimensions.find((d) => d.dimension === 'definition')!.weight).toBe(0.2);
  });

  it('topFixes ranks by composite gain, caps at 3, projects grades', () => {
    const findings = [
      finding('SK101', 'error', 'trigger'), // gain 15 * .30 = 4.5
      finding('SK006', 'warn', 'structure'), // gain 5 * .15 = 0.75
      finding('SK202', 'warn', 'token'), // gain 5 * .20 = 1.0
      finding('SK301', 'warn', 'instruction'), // gain 5 * .15 = 0.75
      finding('SK302', 'info', 'instruction'), // gain 1 * .15 = 0.15
    ];
    const card = scoreSkill(findings);
    expect(card.topFixes).toHaveLength(3);
    expect(card.topFixes[0]!.ruleId).toBe('SK101');
    expect(card.topFixes[1]!.ruleId).toBe('SK202');
    expect(card.topFixes[0]!.gain).toBe(4.5);
    expect(card.topFixes[0]!.projectedGrade).toBe(gradeFor(card.composite + 4.5));
    expect(card.topFixes[0]!.count).toBe(1);
  });

  it('fixing the capping security rule shows the un-capping gain', () => {
    const card = scoreSkill([
      finding('SK401', 'error', 'security'),
      finding('SK105', 'info', 'trigger'),
    ]);
    expect(card.composite).toBe(79);
    const securityFix = card.topFixes.find((f) => f.ruleId === 'SK401')!;
    // removing SK401: raw becomes 100 - 1 * 0.30 = 99.7, uncapped
    expect(securityFix.projectedComposite).toBe(99.7);
    expect(securityFix.gain).toBe(20.7);
    expect(card.topFixes[0]!.ruleId).toBe('SK401');
  });

  it('is deterministic across 100 runs', () => {
    const findings = [
      finding('SK101', 'error', 'trigger'),
      finding('SK401', 'error', 'security'),
      ...Array.from({ length: 12 }, () => finding('SK104', 'warn', 'trigger')),
    ];
    const first = JSON.stringify(scoreSkill(findings));
    for (let i = 0; i < 99; i++) {
      expect(JSON.stringify(scoreSkill(findings))).toBe(first);
    }
  });
});
