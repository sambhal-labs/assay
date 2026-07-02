import type { Artifact, Rule, RuleHit, SkillArtifact } from '../../core/types.js';
import { buildLineIndex } from '../../util/text.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

/**
 * Structural instruction checks only judge bodies with real content;
 * tiny bodies are SK101/SK202 territory.
 */
const MIN_NON_EMPTY_LINES = 10;

const nonEmptyLineCount = (body: string): number =>
  body.split('\n').filter((line) => line.trim()).length;

const ORDERED_LIST_RE = /^\s*\d+[.)]\s/m;

/** Verbs that open a second-person imperative line (SK301). */
const IMPERATIVE_LINE_RE =
  /^(?:Run|Use|Create|Check|Verify|Open|Install|Add|Set|Read|Write|Call|Execute|Configure|Update|Remove|Delete|Ensure|Confirm|Inspect|Build|Copy|Move|Start|Stop|Apply|Generate|Choose|Select|Review|Validate|Save|Fill|Extract|Convert)\b/;

const hasImperativeLine = (body: string): boolean =>
  body.split('\n').some((line) => {
    const stripped = line.replace(/^\s*(?:[-*+]\s+|>\s*)?/, '');
    return IMPERATIVE_LINE_RE.test(stripped);
  });

const VERIFICATION_RE = /\b(?:verif\w*|check\w*|confirm\w*|test\w*|validat\w*)\b/i;

const FAILURE_PATH_RES: ReadonlyArray<RegExp> = [
  /\bif\b[^.\n]{0,60}\bfails?\b/i,
  /\bon\s+error\b/i,
  /\botherwise\b/i,
  /\bfallback\b/i,
  /\bin\s+case\b/i,
];

interface ModifierClaim {
  polarity: 'always' | 'never';
  words: string[];
  line: number;
}

/** "\b(always|never)\s+<up to 4 lowercase words>" — punctuation ends the object. */
const MODIFIER_RE = /\b([Aa]lways|[Nn]ever)\s+([A-Za-z`][\w'`-]*(?:[ \t]+[A-Za-z`][\w'`-]*){0,4})/g;

/**
 * Leading verbs too generic to anchor a contradiction: "always use X" vs
 * "never use Y" only contradict when X and Y collide, so the verb itself is
 * dropped before comparison (and a bare verb with no object is skipped).
 */
const GENERIC_LEAD_VERBS = new Set([
  'use',
  'keep',
  'make',
  'write',
  'add',
  'prefer',
  'apply',
  'include',
  'put',
  'run',
]);

/** Filler dropped when normalizing modifier objects for comparison. */
const OBJECT_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'at',
  'with',
  'into',
  'from',
  'by',
  'your',
  'this',
  'that',
  'it',
  'them',
  'all',
  'any',
  'before',
  'after',
  'until',
  'unless',
  'when',
]);

function collectModifierClaims(skill: SkillArtifact): ModifierClaim[] {
  const lineOf = buildLineIndex(skill.body);
  const claims: ModifierClaim[] = [];
  for (const m of skill.body.matchAll(MODIFIER_RE)) {
    let words = m[2]!
      .toLowerCase()
      .replace(/`/g, '')
      .split(/[ \t]+/)
      .filter((w) => w && !OBJECT_STOPWORDS.has(w));
    if (words.length > 0 && GENERIC_LEAD_VERBS.has(words[0]!)) words = words.slice(1);
    if (words.length === 0) continue;
    claims.push({
      polarity: m[1]!.toLowerCase() as 'always' | 'never',
      words,
      line: lineOf(m.index) + skill.bodyStartLine - 1,
    });
  }
  return claims;
}

/**
 * Two normalized objects contradict when one is a word-prefix of the other.
 * Single-word objects must match exactly so "always use tabs" never collides
 * with the unrelated "never use spaces" via the shared first word.
 */
function objectsCollide(a: string[], b: string[]): boolean {
  const len = Math.min(a.length, b.length);
  if (len === 0) return false;
  if (len === 1 && a.length !== b.length) return false;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const instructionRules: Rule[] = [
  {
    meta: {
      id: 'SK301',
      title: 'No step structure',
      severity: 'warn',
      dimension: 'instruction',
      appliesTo: ['skill'],
      fixHint: 'Restructure the workflow as numbered steps with imperative verbs.',
      docs: 'Models follow procedures far more reliably when they are ordered steps ("1. Inspect the form") than when buried in descriptive prose. A body with neither an ordered list nor imperative lines reads as documentation, not instructions.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (nonEmptyLineCount(skill.body) <= MIN_NON_EMPTY_LINES) return [];
      if (ORDERED_LIST_RE.test(skill.body) || hasImperativeLine(skill.body)) return [];
      return [
        {
          message:
            'body has no ordered list and no imperative step lines — the workflow is buried in prose',
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK302',
      title: 'No verification step',
      severity: 'info',
      dimension: 'instruction',
      appliesTo: ['skill'],
      fixHint: 'Add a step that verifies the output before declaring success.',
      docs: 'Skills that never ask the model to verify, check, or validate its output produce confident wrong answers. One verification step catches most of them.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (nonEmptyLineCount(skill.body) <= MIN_NON_EMPTY_LINES) return [];
      if (VERIFICATION_RE.test(skill.body)) return [];
      return [{ message: 'body never tells the model to verify, check, or validate its output' }];
    },
  },
  {
    meta: {
      id: 'SK303',
      title: 'No failure-path guidance',
      severity: 'info',
      dimension: 'instruction',
      appliesTo: ['skill'],
      fixHint: 'Describe what to do when a step fails (fallback, error handling, escalation).',
      docs: 'Real runs hit failures. Without "if X fails…" guidance the model improvises its own recovery, which is where skills go off the rails. Even one fallback sentence anchors the failure path.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (nonEmptyLineCount(skill.body) <= MIN_NON_EMPTY_LINES) return [];
      if (FAILURE_PATH_RES.some((re) => re.test(skill.body))) return [];
      return [
        {
          message: 'body has no failure-path guidance (no "if … fails", "otherwise", or fallback)',
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK304',
      title: 'Contradictory absolute modifiers',
      severity: 'warn',
      dimension: 'instruction',
      appliesTo: ['skill'],
      fixHint: 'Resolve the contradiction: keep one rule or scope each to its context.',
      docs: 'When one line says "always X" and another says "never X", the model obeys whichever it read last — nondeterministically. Absolute modifiers must not overlap on the same object.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const claims = collectModifierClaims(skill);
      const always = claims.filter((c) => c.polarity === 'always');
      const never = claims.filter((c) => c.polarity === 'never');
      const hits: RuleHit[] = [];
      const reported = new Set<string>();
      for (const a of always) {
        for (const n of never) {
          if (!objectsCollide(a.words, n.words)) continue;
          const object = (a.words.length <= n.words.length ? a.words : n.words).join(' ');
          const key = `${object}:${a.line}:${n.line}`;
          if (reported.has(key)) continue;
          reported.add(key);
          hits.push({
            message: `"always ${object}" (line ${a.line}) contradicts "never ${object}" (line ${n.line})`,
            location: { file: 'SKILL.md', line: Math.min(a.line, n.line) },
          });
        }
      }
      return hits;
    },
  },
];
