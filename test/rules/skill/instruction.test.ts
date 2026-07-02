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

/** 12 non-empty prose lines: no steps, no verification, no failure paths. */
const PROSE_BODY = [
  '# Document helper',
  '',
  'This skill supports a broad range of document workflows.',
  'The main focus is on transformation between common formats.',
  'Documents arrive in many shapes and the skill handles most of them.',
  'There is support for tables, images, and embedded fonts.',
  'Large files are streamed rather than loaded into memory.',
  'Output quality depends heavily on the structure of the input.',
  'The transformation engine preserves styles where possible.',
  'Metadata such as author and title survives the conversion.',
  'Page numbering is recomputed after every structural change.',
  'The final document is written next to the original.',
].join('\n');

describe('SK301', () => {
  it('fires on a prose-only body with no steps or imperative lines', () => {
    const hits = findingsFor('SK301', artifact({ body: PROSE_BODY }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('warn');
    expect(hits[0]!.message).toContain('no ordered list and no imperative step lines');
  });

  it('passes when an ordered list is present', () => {
    expect(
      findingsFor('SK301', artifact({ body: `${PROSE_BODY}\n1. Inspect the input file.` })),
    ).toHaveLength(0);
  });

  it('passes when imperative lines are present (including bulleted ones)', () => {
    expect(
      findingsFor('SK301', artifact({ body: `${PROSE_BODY}\n- Run the conversion script.` })),
    ).toHaveLength(0);
  });

  it('stays silent on tiny bodies', () => {
    expect(findingsFor('SK301', artifact({ body: 'Just one prose line.' }))).toHaveLength(0);
  });
});

describe('SK302', () => {
  it('fires when the body never mentions verifying the output', () => {
    const hits = findingsFor('SK302', artifact({ body: PROSE_BODY }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('info');
  });

  it('passes when a verification step exists', () => {
    expect(
      findingsFor(
        'SK302',
        artifact({ body: `${PROSE_BODY}\nVerify the output opens before finishing.` }),
      ),
    ).toHaveLength(0);
  });

  it('stays silent on tiny bodies', () => {
    expect(findingsFor('SK302', artifact({ body: 'Just one prose line.' }))).toHaveLength(0);
  });
});

describe('SK303', () => {
  it('fires when the body has no failure-path guidance', () => {
    const hits = findingsFor('SK303', artifact({ body: PROSE_BODY }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('info');
  });

  it('passes when a fallback is described', () => {
    expect(
      findingsFor(
        'SK303',
        artifact({ body: `${PROSE_BODY}\nIf the conversion fails, fall back to plain text.` }),
      ),
    ).toHaveLength(0);
  });

  it('stays silent on tiny bodies', () => {
    expect(findingsFor('SK303', artifact({ body: 'Just one prose line.' }))).toHaveLength(0);
  });
});

describe('SK304', () => {
  it('fires when always/never target the same object, naming both lines', () => {
    const body = [
      'Some intro prose about the workflow.',
      'Always flatten the form before delivery.',
      'More prose in the middle of the document.',
      'Never flatten the form until the user approves.',
    ].join('\n');
    const hits = findingsFor('SK304', artifact({ body, bodyStartLine: 5 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('"always flatten form" (line 6)');
    expect(hits[0]!.message).toContain('"never flatten form" (line 8)');
  });

  it('passes when always/never cover different objects', () => {
    const body = [
      'Always write output to a fresh file.',
      'Never overwrite the original document.',
    ].join('\n');
    expect(findingsFor('SK304', artifact({ body }))).toHaveLength(0);
  });

  it('does not collide single-word objects with longer unrelated ones', () => {
    const body = ['Always use tabs for indentation.', 'Never use spaces at line ends.'].join('\n');
    expect(findingsFor('SK304', artifact({ body }))).toHaveLength(0);
  });
});
