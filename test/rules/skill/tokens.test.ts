import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config.js';
import { runRules } from '../../../src/core/engine.js';
import type { Finding, SkillArtifact } from '../../../src/core/types.js';
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

const findingsFor = (id: string, a: SkillArtifact): Finding[] =>
  runRules(a, skillRules, defaultConfig()).findings.filter((f) => f.ruleId === id);

describe('SK201 / SK202', () => {
  it('SK201 fires between the info and warn budgets, citing the count', () => {
    const a = artifact({ tokens: { total: 3100, body: 3000 } });
    const info = findingsFor('SK201', a);
    expect(info).toHaveLength(1);
    expect(info[0]!.severity).toBe('info');
    expect(info[0]!.message).toContain('3000 tokens');
    expect(findingsFor('SK202', a)).toHaveLength(0);
  });

  it('SK202 fires past the warn budget and SK201 stays silent', () => {
    const a = artifact({ tokens: { total: 6100, body: 6000 } });
    const warn = findingsFor('SK202', a);
    expect(warn).toHaveLength(1);
    expect(warn[0]!.severity).toBe('warn');
    expect(warn[0]!.message).toContain('6000 tokens (budget 5000)');
    expect(findingsFor('SK201', a)).toHaveLength(0);
  });

  it('neither fires at or under the info budget', () => {
    const a = artifact({ tokens: { total: 2100, body: 2000 } });
    expect(findingsFor('SK201', a)).toHaveLength(0);
    expect(findingsFor('SK202', a)).toHaveLength(0);
  });
});

describe('SK203', () => {
  it('fires on a long body with zero companion links', () => {
    const hits = findingsFor('SK203', artifact({ bodyLineCount: 400, references: [] }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('400 lines (budget 300)');
  });

  it('passes a long body that links to companion files (even dead ones)', () => {
    expect(
      findingsFor(
        'SK203',
        artifact({
          bodyLineCount: 400,
          references: [{ link: 'reference.md', exists: false, line: 8 }],
        }),
      ),
    ).toHaveLength(0);
  });

  it('passes a short body with no links', () => {
    expect(findingsFor('SK203', artifact({ bodyLineCount: 120, references: [] }))).toHaveLength(0);
  });
});

describe('SK204', () => {
  const fence = (lines: number): string =>
    ['```python', ...Array.from({ length: lines }, (_, i) => `print(${i})`), '```'].join('\n');

  it('fires per oversized fenced block with the opening-fence line', () => {
    const body = `Intro prose.\n\n${fence(85)}\n\nMore prose.\n\n${fence(10)}`;
    const hits = findingsFor('SK204', artifact({ body, bodyStartLine: 5 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('85 lines (budget 80)');
    expect(hits[0]!.location?.line).toBe(7); // body line 3 + bodyStartLine 5 - 1
  });

  it('treats an unclosed fence as running to end of file', () => {
    const openOnly = ['```', ...Array.from({ length: 90 }, () => 'data')].join('\n');
    expect(findingsFor('SK204', artifact({ body: openOnly }))).toHaveLength(1);
  });

  it('passes blocks within budget', () => {
    expect(findingsFor('SK204', artifact({ body: fence(20) }))).toHaveLength(0);
  });
});

describe('SK205', () => {
  it('fires on boilerplate headings, citing the heading and line', () => {
    const body = [
      '# Overview',
      '',
      '## What is Git?',
      '',
      'Git is a version control system.',
      '',
      '### Installing Python',
      '',
      'Download it from the website.',
    ].join('\n');
    const hits = findingsFor('SK205', artifact({ body, bodyStartLine: 5 }));
    expect(hits).toHaveLength(2);
    expect(hits[0]!.message).toContain('"What is Git?"');
    expect(hits[0]!.location?.line).toBe(7); // body line 3 + bodyStartLine 5 - 1
    expect(hits[1]!.message).toContain('"Installing Python"');
  });

  it('never flags domain-specific headings', () => {
    const body = [
      '## What is an AcroForm?',
      '',
      '## Working with git submodules',
      '',
      '## Installing the companion script',
    ].join('\n');
    expect(findingsFor('SK205', artifact({ body }))).toHaveLength(0);
  });
});
