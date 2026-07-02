import { describe, expect, it } from 'vitest';
import { ScorecardSchema, type Scorecard } from '../../src/core/types.js';
import { renderJson } from '../../src/reporters/json.js';

// Hand-built scorecard literal so reporter tests never depend on rules.
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
          location: { file: 'SKILL.md', line: 3 },
        },
      ],
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
  ],
  stats: {
    tokens: 6412,
    durationMs: 800,
    rulesRun: 30,
    findings: { error: 0, warn: 1, info: 0 },
  },
};

describe('renderJson', () => {
  it('emits JSON that parses back through ScorecardSchema', () => {
    const parsed: unknown = JSON.parse(renderJson(card));
    expect(ScorecardSchema.parse(parsed)).toEqual(card);
  });

  it('declares schemaVersion 1 at the top level', () => {
    const parsed = JSON.parse(renderJson(card)) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(1);
  });

  it('is byte-identical across calls', () => {
    expect(renderJson(card)).toBe(renderJson(card));
  });

  it('pretty-prints with two-space indentation', () => {
    expect(renderJson(card)).toContain('\n  "schemaVersion": 1');
  });

  it('strips keys that are not part of the schema contract', () => {
    const dirty = { ...card, internalDebug: 'do-not-ship' } as Scorecard;
    expect(renderJson(dirty)).not.toContain('internalDebug');
    expect(renderJson(dirty)).toBe(renderJson(card));
  });

  it('rejects a card that violates the contract', () => {
    const bad = { ...card, schemaVersion: 2 } as unknown as Scorecard;
    expect(() => renderJson(bad)).toThrow();
  });
});
