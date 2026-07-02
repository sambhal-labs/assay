import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config.js';
import { runRules } from '../../../src/core/engine.js';
import type { SkillArtifact } from '../../../src/core/types.js';
import { skillRules } from '../../../src/rules/skill/index.js';

function artifact(overrides: Partial<SkillArtifact> = {}): SkillArtifact {
  return {
    type: 'skill',
    name: 'demo',
    path: 'demo',
    skillFilePath: 'demo/SKILL.md',
    skillFileExists: true,
    raw: '---\nname: demo\ndescription: A test skill for unit tests.\n---\nbody',
    frontmatter: {
      present: true,
      parsed: { name: 'demo', description: 'A test skill for unit tests.' },
      error: null,
    },
    body: 'body',
    bodyStartLine: 5,
    bodyLineCount: 1,
    tokens: { total: 20, body: 2 },
    resourceFiles: [],
    references: [],
    siblings: [],
    ...overrides,
  };
}

const ruleIds = (a: SkillArtifact): string[] =>
  runRules(a, skillRules, defaultConfig()).findings.map((f) => f.ruleId);

describe('SK001', () => {
  it('fires when SKILL.md is missing and suppresses SK002', () => {
    const ids = ruleIds(
      artifact({
        skillFileExists: false,
        raw: '',
        body: '',
        frontmatter: { present: false, parsed: null, error: null },
      }),
    );
    expect(ids).toEqual(['SK001']);
  });

  it('passes on a healthy skill', () => {
    expect(ruleIds(artifact())).toEqual([]);
  });
});

describe('SK002', () => {
  it('fires when frontmatter is absent', () => {
    expect(
      ruleIds(artifact({ frontmatter: { present: false, parsed: null, error: null } })),
    ).toEqual(['SK002']);
  });

  it('fires when YAML is invalid', () => {
    expect(
      ruleIds(artifact({ frontmatter: { present: true, parsed: null, error: 'unclosed quote' } })),
    ).toEqual(['SK002']);
  });

  it('fires once per missing required field', () => {
    const findings = runRules(
      artifact({ frontmatter: { present: true, parsed: { author: 'x' }, error: null } }),
      skillRules,
      defaultConfig(),
    ).findings;
    expect(findings.filter((f) => f.ruleId === 'SK002')).toHaveLength(2);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/name/);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/description/);
  });

  it('treats an empty description as missing', () => {
    expect(
      ruleIds(
        artifact({
          frontmatter: { present: true, parsed: { name: 'demo', description: '  ' }, error: null },
        }),
      ),
    ).toEqual(['SK002']);
  });
});

describe('SK402', () => {
  it('fires with a line number for hidden unicode anywhere in the file', () => {
    const findings = runRules(
      artifact({ raw: '---\nname: demo\n---\nline one\nbad​line' }),
      skillRules,
      defaultConfig(),
    ).findings.filter((f) => f.ruleId === 'SK402');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.location).toMatchObject({ file: 'SKILL.md', line: 5 });
  });

  it('stays silent on legitimate non-ASCII prose', () => {
    expect(ruleIds(artifact({ raw: '---\nname: demo\n---\n日本語 Grüße 🎉' }))).toEqual([]);
  });
});
