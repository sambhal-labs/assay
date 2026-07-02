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

describe('SK003', () => {
  it('fires on a non-kebab-case name', () => {
    const hits = findingsFor(
      'SK003',
      artifact({
        frontmatter: {
          present: true,
          parsed: { name: 'My_Skill', description: 'A test skill for unit tests.' },
          error: null,
        },
      }),
    );
    // My_Skill is both non-kebab and different from the directory basename.
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.message).join(' ')).toContain('"My_Skill" is not kebab-case');
  });

  it('fires when the name exceeds 64 chars', () => {
    const long = 'a'.repeat(70);
    const hits = findingsFor(
      'SK003',
      artifact({
        skillFilePath: `${long}/SKILL.md`,
        frontmatter: {
          present: true,
          parsed: { name: long, description: 'A test skill for unit tests.' },
          error: null,
        },
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('70 chars (max 64)');
  });

  it('fires when the name differs from the directory basename', () => {
    const hits = findingsFor(
      'SK003',
      artifact({
        frontmatter: {
          present: true,
          parsed: { name: 'other-name', description: 'A test skill for unit tests.' },
          error: null,
        },
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('differs from its directory basename "demo"');
  });

  it('passes a kebab-case name matching the directory', () => {
    expect(findingsFor('SK003', artifact())).toHaveLength(0);
  });

  it('skips when the name is missing (SK002 owns that)', () => {
    expect(
      findingsFor(
        'SK003',
        artifact({
          frontmatter: {
            present: true,
            parsed: { description: 'A test skill for unit tests.' },
            error: null,
          },
        }),
      ),
    ).toHaveLength(0);
  });
});

describe('SK004', () => {
  it('fires once per unknown frontmatter key', () => {
    const hits = findingsFor(
      'SK004',
      artifact({
        raw: '---\nname: demo\ndescription: A test skill for unit tests.\nauthor: someone\ntags: [a]\n---\nbody',
        frontmatter: {
          present: true,
          parsed: {
            name: 'demo',
            description: 'A test skill for unit tests.',
            author: 'someone',
            tags: ['a'],
          },
          error: null,
        },
      }),
    );
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.message).join(' ')).toContain('"author"');
    expect(hits.map((h) => h.message).join(' ')).toContain('"tags"');
    expect(hits[0]!.severity).toBe('info');
    expect(hits[0]!.location?.line).toBe(4);
  });

  it('passes when every key is a known ecosystem key', () => {
    expect(
      findingsFor(
        'SK004',
        artifact({
          frontmatter: {
            present: true,
            parsed: {
              name: 'demo',
              description: 'A test skill for unit tests.',
              version: '1.0.0',
              license: 'MIT',
              metadata: {},
              'allowed-tools': ['Bash'],
              compatibility: 'claude',
            },
            error: null,
          },
        }),
      ),
    ).toHaveLength(0);
  });
});

describe('SK005', () => {
  it('fires per dead relative link with its line', () => {
    const hits = findingsFor(
      'SK005',
      artifact({
        references: [
          { link: 'guide.md', exists: false, line: 12 },
          { link: 'reference.md', exists: true, line: 14 },
        ],
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('"guide.md"');
    expect(hits[0]!.location?.line).toBe(12);
  });

  it('passes when every referenced file exists', () => {
    expect(
      findingsFor('SK005', artifact({ references: [{ link: 'ref.md', exists: true, line: 3 }] })),
    ).toHaveLength(0);
  });
});

describe('SK006', () => {
  it('fires on unix and windows absolute paths with body-relative line numbers', () => {
    const body = [
      'Some intro prose.',
      'Load the data from /Users/alice/projects/data.csv into memory.',
      'On Windows the tool lives at C:\\Tools\\bin\\convert.exe for now.',
    ].join('\n');
    const hits = findingsFor('SK006', artifact({ body, bodyStartLine: 5 }));
    expect(hits).toHaveLength(2);
    expect(hits[0]!.message).toContain('/Users/alice/projects/data.csv');
    expect(hits[0]!.location?.line).toBe(6); // body line 2 + bodyStartLine 5 - 1
    expect(hits[1]!.message).toContain('C:\\Tools\\bin\\convert.exe');
    expect(hits[1]!.location?.line).toBe(7);
  });

  it('never flags URL paths that merely contain /home/', () => {
    expect(
      findingsFor(
        'SK006',
        artifact({ body: 'See https://example.com/home/alice/docs for details.' }),
      ),
    ).toHaveLength(0);
  });

  it('passes relative paths', () => {
    expect(
      findingsFor('SK006', artifact({ body: 'Open scripts/convert.py and data/input.csv.' })),
    ).toHaveLength(0);
  });
});
