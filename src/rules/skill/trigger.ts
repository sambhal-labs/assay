import type { Artifact, Rule, SkillArtifact } from '../../core/types.js';
import { jaccardSimilarity } from '../../util/text.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

/**
 * The frontmatter description, or null when missing/blank — SK002 owns the
 * missing case, so every trigger rule skips it.
 */
function description(skill: SkillArtifact): string | null {
  const value = skill.frontmatter.parsed?.description;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Phrasing heuristics (SK103/SK104) only judge descriptions with enough
 * words to carry routing content; anything terser is SK101 territory.
 */
const MIN_WORDS_FOR_PHRASING = 7;

/**
 * SK103/SK104 are English-only lexicons; docking a flawless German or
 * Japanese description for missing English phrases is unfair. Skip both
 * when the description's letters are mostly non-ASCII.
 */
const NON_ENGLISH_MARKERS =
  /\b(?:der|die|das|und|nicht|wenn|für|eine?[nmr]?|möchte|verwenden|benutzer|oder|dans|pour|une|avec|les|des|cuando|para|los|las|usar|também|quando|não|ou)\b/giu;

function isMostlyEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return true;
  // Non-Latin scripts: the ASCII-letter ratio gives it away.
  const ascii = text.match(/[a-zA-Z]/g)?.length ?? 0;
  if (ascii / letters < 0.66) return false;
  // Latin-script languages (German, French, Spanish…) are mostly ASCII —
  // spot them by common function words instead.
  NON_ENGLISH_MARKERS.lastIndex = 0;
  return (text.match(NON_ENGLISH_MARKERS)?.length ?? 0) < 2;
}

/**
 * A description is placeholder text when it essentially IS the placeholder —
 * starting with a stub marker, or consisting of a stock phrase and little
 * else. "Create, sort, and archive todo items…" is a real description that
 * merely contains the word "todo" and must not fire.
 */
const PLACEHOLDER_RES: ReadonlyArray<RegExp> = [
  /^(?:todo|tbd|fixme|xxx)\b/i,
  /^description (?:goes )?here\b/i,
  /^does stuff\b/i,
  /^a skill(?: for [\w\s-]{0,24})?[.!]?$/i,
];

const USAGE_GUIDANCE_RE =
  /\buse\s+when\b|\buse\s+this\b|\btrigger\b|\bfor\s+tasks\b|\binvoke\s+when\b|\bapplies\s+when\b|\bwhen\s+the\s+user\b/i;

/**
 * Concrete action verbs a routable description should contain (SK104).
 * Word-boundary matched on the lowercased description; common inflections
 * (-s/-es/-ed/-ing) count as the same verb.
 */
const ACTION_VERBS: ReadonlyArray<string> = [
  'analyze',
  'annotate',
  'archive',
  'audit',
  'build',
  'classify',
  'clean',
  'compile',
  'compress',
  'configure',
  'convert',
  'copy',
  'create',
  'debug',
  'decode',
  'decrypt',
  'delete',
  'deploy',
  'diff',
  'download',
  'edit',
  'encode',
  'encrypt',
  'export',
  'extract',
  'fetch',
  'fill',
  'filter',
  'flatten',
  'format',
  'generate',
  'import',
  'index',
  'inspect',
  'install',
  'lint',
  'list',
  'merge',
  'migrate',
  'monitor',
  'optimize',
  'parse',
  'patch',
  'plot',
  'publish',
  'query',
  'read',
  'redact',
  'refactor',
  'rename',
  'render',
  'resize',
  'run',
  'scan',
  'schedule',
  'scrape',
  'search',
  'send',
  'sign',
  'sort',
  'split',
  'summarize',
  'sync',
  'transcribe',
  'transform',
  'translate',
  'update',
  'upload',
  'validate',
  'verify',
  'write',
];

function distinctActionVerbs(text: string): string[] {
  const lower = text.toLowerCase();
  return ACTION_VERBS.filter((verb) => new RegExp(`\\b${verb}(?:s|es|ed|ing)?\\b`).test(lower));
}

const FIRST_PERSON_RE = /\bI\s+(?:can|will|help|am)\b|\bmy\b/i;

export const triggerRules: Rule[] = [
  {
    meta: {
      id: 'SK101',
      title: 'Description too short or placeholder',
      severity: 'error',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint: 'Write a real description: what the skill does and when to use it.',
      docs: 'The description is the only signal a host has when deciding whether to load a skill. A stub like "TODO" or a description shorter than the configured minimum means the skill effectively cannot be routed to.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      if (desc === null) return []; // SK002 owns the missing case
      const min = config.budgets.descriptionMinChars;
      if (desc.length < min) {
        return [{ message: `description is ${desc.length} chars (minimum ${min})` }];
      }
      const placeholder = PLACEHOLDER_RES.map((re) => re.exec(desc)?.[0]).find(Boolean);
      if (placeholder) {
        return [{ message: `description contains placeholder text "${placeholder}"` }];
      }
      return [];
    },
  },
  {
    meta: {
      id: 'SK102',
      title: 'Description too long',
      severity: 'warn',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint: 'Trim the description to the essentials; move detail into the body.',
      docs: 'Every skill description is loaded into context on every turn, whether or not the skill is used. Descriptions past the budget crowd out the very routing signal they exist to provide.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      const max = config.budgets.descriptionMaxChars;
      if (desc === null || desc.length <= max) return [];
      return [{ message: `description is ${desc.length} chars (budget ${max})` }];
    },
  },
  {
    meta: {
      id: 'SK103',
      title: 'No usage guidance in description',
      severity: 'warn',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint: 'Add a "Use when …" clause describing the requests that should route here.',
      docs: 'Descriptions that only say what a skill is — without "use when", "for tasks", or similar phrasing — leave the host guessing about when to invoke it. Explicit trigger conditions measurably improve routing.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      if (desc === null || wordCount(desc) < MIN_WORDS_FOR_PHRASING) return [];
      if (!isMostlyEnglish(desc)) return []; // English-only lexicon
      if (USAGE_GUIDANCE_RE.test(desc)) return [];
      return [
        {
          message:
            'description never says when to use the skill (no "use when", "for tasks", "when the user", or similar)',
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK104',
      title: 'Description lacks concrete action verbs',
      severity: 'warn',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint:
        'Name the concrete operations the skill performs (e.g. "extract, convert, validate").',
      docs: 'Hosts match user requests against verbs. A description reading like a table of contents ("PDF utilities and helpers") gives the router nothing to match; naming at least two concrete operations does.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      if (desc === null || wordCount(desc) < MIN_WORDS_FOR_PHRASING) return [];
      if (!isMostlyEnglish(desc)) return []; // English-only lexicon
      const verbs = distinctActionVerbs(desc);
      if (verbs.length >= 2) return [];
      const found = verbs.length === 1 ? `only "${verbs[0]}"` : 'none';
      return [
        {
          message: `description names ${found} of the concrete action verbs hosts route on (need 2+)`,
        },
      ];
    },
  },
  {
    meta: {
      id: 'SK105',
      title: 'First-person description',
      severity: 'info',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint: 'Rewrite the description in third person ("Converts…", not "I can convert…").',
      docs: 'Routers compare descriptions against user requests, which are phrased about tasks, not about the assistant. Third-person, capability-centric descriptions match better than "I can help with…".',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      if (desc === null) return [];
      const m = FIRST_PERSON_RE.exec(desc);
      if (!m) return [];
      return [{ message: `description uses first-person phrasing ("${m[0]}")` }];
    },
  },
  {
    meta: {
      id: 'SK106',
      title: 'Description collides with a sibling skill',
      severity: 'warn',
      dimension: 'trigger',
      appliesTo: ['skill'],
      fixHint: 'Differentiate the two descriptions or merge the overlapping skills.',
      docs: 'Two skills in the same repo with near-identical descriptions force the router to pick one arbitrarily. Checked only in repo mode, where sibling descriptions are available.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      const desc = description(skill);
      if (desc === null) return [];
      const threshold = config.budgets.similarityJaccard;
      return skill.siblings
        .map((sibling) => ({
          sibling,
          similarity: jaccardSimilarity(desc, sibling.description),
        }))
        .filter(({ similarity }) => similarity > threshold)
        .map(({ sibling, similarity }) => ({
          message: `description is ${Math.round(similarity * 100)}% similar to sibling skill "${sibling.name}" (threshold ${Math.round(threshold * 100)}%)`,
        }));
    },
  },
];
