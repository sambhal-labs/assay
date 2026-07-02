import type { Artifact, Rule, RuleHit, SkillArtifact } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

interface FencedBlock {
  /** 1-based line of the opening fence, in body coordinates. */
  openLine: number;
  /** Content lines between the fences. */
  lineCount: number;
}

/** Fenced ``` blocks in the body; an unclosed fence runs to end of file. */
function fencedBlocks(body: string): FencedBlock[] {
  const lines = body.split('\n');
  const blocks: FencedBlock[] = [];
  let openAt: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```/.test(lines[i]!)) continue;
    if (openAt === null) {
      openAt = i;
    } else {
      blocks.push({ openLine: openAt + 1, lineCount: i - openAt - 1 });
      openAt = null;
    }
  }
  if (openAt !== null) {
    blocks.push({ openLine: openAt + 1, lineCount: lines.length - openAt - 1 });
  }
  return blocks;
}

/**
 * Headings that teach the model things it already knows (SK205). The
 * lexicon is deliberately tight — template + well-known technology only —
 * because a false positive here costs more than a miss.
 */
const KNOWN_TECH =
  '(?:git|python|bash|node(?:\\.js)?|nodejs|npm|javascript|typescript|docker|react|linux|sql|html|css|json|yaml)';

const BOILERPLATE_HEADING_RES: ReadonlyArray<RegExp> = [
  new RegExp(`^what is ${KNOWN_TECH}\\b`),
  new RegExp(`^how ${KNOWN_TECH} works\\b`),
  new RegExp(`^intro(?:duction)? to ${KNOWN_TECH}\\b`),
  new RegExp(`^${KNOWN_TECH} basics\\b`),
  new RegExp(`^installing ${KNOWN_TECH}\\b`),
  new RegExp(`^how to install ${KNOWN_TECH}\\b`),
  new RegExp(`^getting started with ${KNOWN_TECH}\\b`),
];

export const tokenRules: Rule[] = [
  {
    meta: {
      id: 'SK201',
      title: 'Body approaching token budget',
      severity: 'info',
      dimension: 'token',
      appliesTo: ['skill'],
      fixHint: 'Move reference detail into companion files loaded on demand.',
      docs: 'The whole SKILL.md body enters context when the skill activates. Past the info budget the skill still works but is trending toward the hard warning threshold — worth splitting before it gets there.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const { skillBodyTokensInfo, skillBodyTokensWarn } = config.budgets;
      if (skill.tokens.body <= skillBodyTokensInfo || skill.tokens.body > skillBodyTokensWarn) {
        return [];
      }
      return [
        {
          message: `body is ~${skill.tokens.body} tokens (info budget ${skillBodyTokensInfo})`,
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK202',
      title: 'Body over token budget',
      severity: 'warn',
      dimension: 'token',
      appliesTo: ['skill'],
      fixHint: 'Split the body: keep the workflow in SKILL.md, push detail to linked files.',
      docs: 'Progressive disclosure is the core design rule for skills: a lean always-loaded body, with depth in companion files opened on demand. A body past the warn budget taxes every activation with tokens the model rarely needs.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const budget = config.budgets.skillBodyTokensWarn;
      if (skill.tokens.body <= budget) return [];
      return [{ message: `body is ~${skill.tokens.body} tokens (budget ${budget})` }];
    },
  },
  {
    meta: {
      id: 'SK203',
      title: 'Monolithic body with no companion files',
      severity: 'warn',
      dimension: 'token',
      appliesTo: ['skill'],
      fixHint: 'Extract reference material into companion files and link them from the body.',
      docs: 'A long body that links to zero companion files is a monolith: every detail is paid for on every activation. Long skills should keep SKILL.md as the map and put the territory in linked files.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const budget = config.budgets.skillBodyMaxLines;
      if (skill.bodyLineCount <= budget || skill.references.length > 0) return [];
      return [
        {
          message: `body is ${skill.bodyLineCount} lines (budget ${budget}) with zero links to companion files`,
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK204',
      title: 'Oversized inline code block',
      severity: 'info',
      dimension: 'token',
      appliesTo: ['skill'],
      fixHint: 'Move the code block into a companion script or reference file.',
      docs: 'Long inline code blocks are usually reference material, not workflow. Shipping them as companion files keeps the always-loaded body lean without losing the code.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const budget = config.budgets.skillCodeBlockMaxLines;
      return fencedBlocks(skill.body)
        .filter((block) => block.lineCount > budget)
        .map((block) => ({
          message: `fenced code block is ${block.lineCount} lines (budget ${budget})`,
          location: { file: 'SKILL.md', line: block.openLine + skill.bodyStartLine - 1 },
        }));
    },
  },
  {
    meta: {
      id: 'SK205',
      title: 'Section teaches what the model already knows',
      severity: 'warn',
      dimension: 'token',
      appliesTo: ['skill'],
      fixHint: 'Delete the tutorial section — the model already knows the basics.',
      docs: 'Sections like "What is Git" or "Installing Python" spend tokens re-teaching material the model already has. Detection is heading-based with a deliberately tight lexicon, so ordinary domain sections are never flagged.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const hits: RuleHit[] = [];
      const lines = skill.body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const heading = /^#{1,6}\s+(.*)$/.exec(lines[i]!);
        if (!heading) continue;
        const text = heading[1]!.trim();
        if (BOILERPLATE_HEADING_RES.some((re) => re.test(text.toLowerCase()))) {
          hits.push({
            message: `section "${text}" teaches basics the model already knows`,
            location: { file: 'SKILL.md', line: i + skill.bodyStartLine },
          });
        }
      }
      return hits;
    },
  },
];
