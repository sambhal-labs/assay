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

/** Artifact whose frontmatter description is the given string (or absent). */
function withDescription(description?: string): SkillArtifact {
  const parsed: Record<string, unknown> = { name: 'demo' };
  if (description !== undefined) parsed.description = description;
  return artifact({ frontmatter: { present: true, parsed, error: null } });
}

const findingsFor = (id: string, a: SkillArtifact): Finding[] =>
  runRules(a, skillRules, defaultConfig()).findings.filter((f) => f.ruleId === id);

const GOOD_DESC =
  'Convert, extract, and validate spreadsheet data. Use when the user asks to transform CSV or XLSX files.';

describe('SK101', () => {
  it('fires when the description is under the minimum chars, citing the count', () => {
    const hits = findingsFor('SK101', withDescription('Fills PDFs.'));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('error');
    expect(hits[0]!.message).toContain('11 chars (minimum 20)');
  });

  it('fires on placeholder text regardless of length', () => {
    const hits = findingsFor(
      'SK101',
      withDescription('TODO: describe what this document skill actually does.'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('"TODO"');
  });

  it('fires when the description is essentially just "a skill for X"', () => {
    const hits = findingsFor('SK101', withDescription('A skill for documents.'));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('placeholder');
  });

  it('does not fire on real descriptions that merely contain trigger words', () => {
    expect(
      findingsFor(
        'SK101',
        withDescription(
          "Create, sort, and archive todo items in the project's TODO.md task list. Use when the user asks to add a todo or mark a task done.",
        ),
      ),
    ).toHaveLength(0);
    expect(
      findingsFor(
        'SK101',
        withDescription(
          'A skill for converting Excel spreadsheets to Markdown tables. Use when the user asks to export tabular data.',
        ),
      ),
    ).toHaveLength(0);
  });

  it('skips when the description is missing (SK002 owns that)', () => {
    expect(findingsFor('SK101', withDescription())).toHaveLength(0);
  });

  it('passes a substantive description', () => {
    expect(findingsFor('SK101', withDescription(GOOD_DESC))).toHaveLength(0);
  });
});

describe('SK102', () => {
  it('fires when the description exceeds the budget, citing the count', () => {
    const hits = findingsFor('SK102', withDescription('word '.repeat(300).trim()));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('1499 chars (budget 1024)');
  });

  it('passes a description within budget', () => {
    expect(findingsFor('SK102', withDescription(GOOD_DESC))).toHaveLength(0);
  });
});

describe('SK103', () => {
  it('fires when the description never says when to use the skill', () => {
    const hits = findingsFor(
      'SK103',
      withDescription('Comprehensive helpers and utilities related to spreadsheets and documents.'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('never says when to use');
  });

  it('passes a description with a "use when" clause', () => {
    expect(findingsFor('SK103', withDescription(GOOD_DESC))).toHaveLength(0);
  });

  it('skips descriptions too short to judge for phrasing', () => {
    expect(findingsFor('SK103', withDescription('A test skill for unit tests.'))).toHaveLength(0);
  });
});

describe('SK104', () => {
  it('fires when no lexicon verbs appear', () => {
    const hits = findingsFor(
      'SK104',
      withDescription('Comprehensive helpers and utilities related to spreadsheets and documents.'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('names none');
  });

  it('fires when only one distinct verb appears, naming it', () => {
    const hits = findingsFor(
      'SK104',
      withDescription(
        'Converts documents between several popular layouts for everyday office needs.',
      ),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('only "convert"');
  });

  it('passes with two distinct action verbs (inflections count once)', () => {
    expect(findingsFor('SK104', withDescription(GOOD_DESC))).toHaveLength(0);
  });

  it('skips descriptions too short to judge for phrasing', () => {
    expect(findingsFor('SK104', withDescription('A test skill for unit tests.'))).toHaveLength(0);
  });
});

describe('SK105', () => {
  it('fires on first-person phrasing, quoting it', () => {
    const hits = findingsFor(
      'SK105',
      withDescription('I can help with converting and extracting data from PDF files.'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('info');
    expect(hits[0]!.message).toContain('"I can"');
  });

  it('fires on possessive first person', () => {
    const hits = findingsFor(
      'SK105',
      withDescription('Uses my favorite parser to extract and convert document tables.'),
    );
    expect(hits).toHaveLength(1);
  });

  it('passes third-person descriptions', () => {
    expect(findingsFor('SK105', withDescription(GOOD_DESC))).toHaveLength(0);
  });
});

describe('SK106', () => {
  it('fires per sibling whose description is near-identical, naming it', () => {
    const hits = findingsFor(
      'SK106',
      artifact({
        frontmatter: {
          present: true,
          parsed: { name: 'demo', description: GOOD_DESC },
          error: null,
        },
        siblings: [
          { name: 'spreadsheet-tools', description: GOOD_DESC },
          { name: 'pdf-form-filler', description: 'Fill, flatten, and extract PDF form fields.' },
        ],
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('"spreadsheet-tools"');
  });

  it('passes when no siblings are known (single-skill mode)', () => {
    expect(findingsFor('SK106', artifact({ siblings: [] }))).toHaveLength(0);
  });
});
