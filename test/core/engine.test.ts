import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { runRules } from '../../src/core/engine.js';
import type { Rule, SkillArtifact } from '../../src/core/types.js';

function skillArtifact(): SkillArtifact {
  return {
    type: 'skill',
    name: 'demo',
    path: '/tmp/demo',
    skillFilePath: '/tmp/demo/SKILL.md',
    skillFileExists: true,
    raw: '',
    frontmatter: { present: true, parsed: { name: 'demo' }, error: null },
    body: '',
    bodyStartLine: 1,
    bodyLineCount: 0,
    tokens: { total: 0, body: 0 },
    resourceFiles: [],
    references: [],
    siblings: [],
  };
}

function rule(id: string, overrides: Partial<Rule['meta']> = {}, hits = 1): Rule {
  return {
    meta: {
      id,
      title: id,
      severity: 'warn',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: `default fix for ${id}`,
      docs: '',
      ...overrides,
    },
    check: () => Array.from({ length: hits }, (_, i) => ({ message: `${id} hit ${i}` })),
  };
}

describe('runRules', () => {
  it('skips rules that do not apply to the artifact type', () => {
    const { findings, rulesRun } = runRules(
      skillArtifact(),
      [rule('SK001'), rule('MCP101', { appliesTo: ['mcp-server'] })],
      defaultConfig(),
    );
    expect(rulesRun).toBe(1);
    expect(findings.map((f) => f.ruleId)).toEqual(['SK001']);
  });

  it('honors "off" overrides and excludes them from rulesRun', () => {
    const config = { ...defaultConfig(), rules: { SK001: 'off' as const } };
    const { findings, rulesRun } = runRules(
      skillArtifact(),
      [rule('SK001'), rule('SK002')],
      config,
    );
    expect(rulesRun).toBe(1);
    expect(findings.map((f) => f.ruleId)).toEqual(['SK002']);
  });

  it('applies severity overrides from config', () => {
    const config = { ...defaultConfig(), rules: { SK001: 'error' as const } };
    const { findings } = runRules(skillArtifact(), [rule('SK001')], config);
    expect(findings[0]!.severity).toBe('error');
  });

  it('falls back to the rule fixHint when a hit has no fix', () => {
    const withFix: Rule = {
      ...rule('SK002'),
      check: () => [{ message: 'm', fix: 'specific fix' }],
    };
    const { findings } = runRules(skillArtifact(), [rule('SK001'), withFix], defaultConfig());
    expect(findings.find((f) => f.ruleId === 'SK001')!.fix).toBe('default fix for SK001');
    expect(findings.find((f) => f.ruleId === 'SK002')!.fix).toBe('specific fix');
  });

  it('sorts findings deterministically regardless of registration order', () => {
    const rules = [rule('SK005'), rule('SK001', {}, 2), rule('SK003')];
    const a = runRules(skillArtifact(), rules, defaultConfig());
    const b = runRules(skillArtifact(), [...rules].reverse(), defaultConfig());
    expect(a.findings).toEqual(b.findings);
    expect(a.findings.map((f) => f.ruleId)).toEqual(['SK001', 'SK001', 'SK003', 'SK005']);
  });

  it('sorts by file, tool, then line within a rule', () => {
    const locRule: Rule = {
      ...rule('SK005'),
      check: () => [
        { message: 'z', location: { file: 'b.md', line: 9 } },
        { message: 'y', location: { file: 'a.md', line: 5 } },
        { message: 'x', location: { file: 'a.md', line: 2 } },
      ],
    };
    const { findings } = runRules(skillArtifact(), [locRule], defaultConfig());
    expect(findings.map((f) => f.location?.line)).toEqual([2, 5, 9]);
  });

  it('honors per-hit severity for banded rules, config override still wins', () => {
    const banded: Rule = {
      ...rule('SK098'),
      check: () => [
        { message: 'over info budget', severity: 'info' },
        { message: 'over warn budget' },
      ],
    };
    const { findings } = runRules(skillArtifact(), [banded], defaultConfig());
    expect(findings.map((f) => f.severity)).toEqual(['info', 'warn']);

    const overridden = runRules(skillArtifact(), [banded], {
      ...defaultConfig(),
      rules: { SK098: 'error' as const },
    });
    expect(overridden.findings.map((f) => f.severity)).toEqual(['error', 'error']);
  });

  it('wraps a crashing rule in an error naming the rule — rules must never throw', () => {
    const crashing: Rule = {
      ...rule('SK099'),
      check: () => {
        throw new Error('boom');
      },
    };
    expect(() => runRules(skillArtifact(), [crashing], defaultConfig())).toThrow(/SK099/);
  });
});
