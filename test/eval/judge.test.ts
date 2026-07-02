import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  parsePositives,
  parseSkillChoice,
  type ScenarioOutcome,
} from '../../src/eval/judge.js';

describe('parseSkillChoice', () => {
  it('parses a selection and a null selection', () => {
    expect(parseSkillChoice('{"skill": "pdf-form-filler"}')).toEqual({
      skill: 'pdf-form-filler',
    });
    expect(parseSkillChoice('{"skill": null}')).toEqual({ skill: null });
  });

  it('tolerates surrounding whitespace and a json code fence', () => {
    expect(parseSkillChoice('  \n{"skill": "x"}\n')).toEqual({ skill: 'x' });
    expect(parseSkillChoice('```json\n{"skill": "x"}\n```')).toEqual({ skill: 'x' });
    expect(parseSkillChoice('```\n{"skill": null}\n```')).toEqual({ skill: null });
  });

  it('rejects prose, wrong shapes, and empty names', () => {
    expect(parseSkillChoice('I would load the pdf skill.')).toBeNull();
    expect(parseSkillChoice('{"skill": "x"} because it fits')).toBeNull();
    expect(parseSkillChoice('{"tool": "x"}')).toBeNull();
    expect(parseSkillChoice('{"skill": 42}')).toBeNull();
    expect(parseSkillChoice('{"skill": "  "}')).toBeNull();
    expect(parseSkillChoice('["skill"]')).toBeNull();
    expect(parseSkillChoice('')).toBeNull();
  });
});

describe('parsePositives', () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('parses a JSON array of prompts, dropping extras', () => {
    expect(parsePositives(JSON.stringify(eight), 8)).toEqual(eight);
    expect(parsePositives(JSON.stringify([...eight, 'extra']), 8)).toEqual(eight);
  });

  it('tolerates code fences', () => {
    expect(parsePositives(`\`\`\`json\n${JSON.stringify(eight)}\n\`\`\``, 8)).toEqual(eight);
  });

  it('rejects short arrays, non-arrays, and non-string entries', () => {
    expect(parsePositives(JSON.stringify(eight.slice(0, 7)), 8)).toBeNull();
    expect(parsePositives('{"prompts": []}', 8)).toBeNull();
    expect(parsePositives(JSON.stringify([...eight.slice(0, 7), 42]), 8)).toBeNull();
    expect(parsePositives('not json', 8)).toBeNull();
  });
});

const outcomes = (selectedPositives: number, selectedNegatives: number): ScenarioOutcome[] => [
  ...Array.from({ length: 8 }, (_, i): ScenarioOutcome => ({
    kind: 'positive',
    selected: i < selectedPositives,
  })),
  ...Array.from({ length: 8 }, (_, i): ScenarioOutcome => ({
    kind: 'negative',
    selected: i < selectedNegatives,
  })),
];

describe('computeMetrics', () => {
  it('perfect 8/8 positives and 0/8 negatives is F1 1', () => {
    expect(computeMetrics(outcomes(8, 0))).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('misses reduce recall, not precision', () => {
    const m = computeMetrics(outcomes(6, 0));
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.75);
    expect(m.f1).toBeCloseTo((2 * 1 * 0.75) / 1.75, 4);
  });

  it('false claims reduce precision, not recall', () => {
    const m = computeMetrics(outcomes(8, 2));
    expect(m.precision).toBe(0.8);
    expect(m.recall).toBe(1);
    expect(m.f1).toBeCloseTo((2 * 0.8) / 1.8, 4);
  });

  it('a judge that never selects the target scores 0 across the board', () => {
    expect(computeMetrics(outcomes(0, 0))).toEqual({ precision: 0, recall: 0, f1: 0 });
  });
});
