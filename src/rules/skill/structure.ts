import type { Artifact, Rule, RuleHit, SkillArtifact } from '../../core/types.js';
import { buildLineIndex } from '../../util/text.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;

/** Frontmatter keys in common use across skill ecosystems (SK004). */
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'version',
  'license',
  'metadata',
  'allowed-tools',
  'compatibility',
]);

/**
 * Basename of the skill directory, derived from the adapter-resolved
 * skillFilePath (…/<dir>/SKILL.md) so relative user input like "." never
 * yields a bogus mismatch. Returns null when it cannot be determined.
 */
function skillDirBasename(skill: SkillArtifact): string | null {
  const segments = skill.skillFilePath.split(/[\\/]/).filter(Boolean);
  // Last segment is SKILL.md; the one before it is the skill directory.
  const dir = segments.length >= 2 ? segments[segments.length - 2]! : null;
  return dir && dir !== '.' && dir !== '..' ? dir : null;
}

/**
 * Absolute local filesystem paths (SK006). URL paths like
 * https://x.com/home/y are excluded by checking the surrounding token
 * for a scheme separator.
 */
const ABS_PATH_RE = /\/(?:Users|home|var|etc|tmp|opt)\/[^\s"'`)\],;]+|\b[A-Za-z]:\\[^\s"'`)\],;]+/g;

function isInsideUrl(text: string, matchIndex: number): boolean {
  let start = matchIndex;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1;
  return text.slice(start, matchIndex).includes('://');
}

/** Line (1-based, whole-file coordinates) where a frontmatter key sits. */
function frontmatterKeyLine(skill: SkillArtifact, key: string): number {
  const lines = skill.raw.split('\n');
  const end = Math.min(skill.bodyStartLine, lines.length);
  for (let i = 0; i < end; i++) {
    if (lines[i]!.startsWith(`${key}:`)) return i + 1;
  }
  return 1;
}

export const structureRules: Rule[] = [
  {
    meta: {
      id: 'SK001',
      title: 'SKILL.md missing or unreadable',
      severity: 'error',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Create a SKILL.md with YAML frontmatter (name, description) at the skill root.',
      docs: 'A skill is defined by its SKILL.md. Without one, no host can load the skill at all — every other check is moot.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      return skill.skillFileExists
        ? []
        : [{ message: `SKILL.md is missing or unreadable in ${skill.path}` }];
    },
  },
  {
    meta: {
      id: 'SK002',
      title: 'Frontmatter missing, invalid, or incomplete',
      severity: 'error',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Start SKILL.md with a YAML frontmatter block declaring name and description.',
      docs: 'Hosts route skills by the frontmatter name and description. Missing or unparseable frontmatter means the skill can never be selected.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.skillFileExists) return []; // SK001 already covers this
      const hits: RuleHit[] = [];
      const fm = skill.frontmatter;
      if (!fm.present) {
        hits.push({ message: 'SKILL.md has no YAML frontmatter block', location: { line: 1 } });
      } else if (fm.error) {
        hits.push({
          message: `frontmatter is not valid YAML: ${fm.error}`,
          location: { line: 1 },
        });
      } else if (fm.parsed) {
        for (const field of ['name', 'description'] as const) {
          const value = fm.parsed[field];
          if (typeof value !== 'string' || !value.trim()) {
            hits.push({
              message: `frontmatter is missing required "${field}"`,
              location: { line: 1 },
            });
          }
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'SK003',
      title: 'Skill name malformed or mismatched',
      severity: 'warn',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Rename the skill to a kebab-case name (max 64 chars) that matches its directory.',
      docs: 'Hosts key skills by name. A name that is not kebab-case, exceeds 64 characters, or differs from the directory basename breaks lookup conventions and confuses discovery tooling.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      const name = skill.frontmatter.parsed?.name;
      if (typeof name !== 'string' || !name.trim()) return []; // SK002 owns missing name
      const hits: RuleHit[] = [];
      const line = frontmatterKeyLine(skill, 'name');
      if (!KEBAB_CASE_RE.test(name)) {
        hits.push({
          message: `skill name "${name}" is not kebab-case (expected ^[a-z0-9]+(-[a-z0-9]+)*$)`,
          location: { file: 'SKILL.md', line },
        });
      }
      if (name.length > MAX_NAME_LENGTH) {
        hits.push({
          message: `skill name is ${name.length} chars (max ${MAX_NAME_LENGTH})`,
          location: { file: 'SKILL.md', line },
        });
      }
      const dir = skillDirBasename(skill);
      if (dir && name !== dir) {
        hits.push({
          message: `skill name "${name}" differs from its directory basename "${dir}"`,
          location: { file: 'SKILL.md', line },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'SK004',
      title: 'Unknown frontmatter keys',
      severity: 'info',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Confirm the key is meaningful to your host, or remove it.',
      docs: 'Keys outside the commonly recognized set (name, description, version, license, metadata, allowed-tools, compatibility) are surfaced for review, not judged — ecosystems vary, but typos in key names silently drop metadata.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      const parsed = skill.frontmatter.parsed;
      if (!parsed) return [];
      return Object.keys(parsed)
        .filter((key) => !KNOWN_FRONTMATTER_KEYS.has(key))
        .map((key) => ({
          message: `unknown frontmatter key "${key}"`,
          location: { file: 'SKILL.md', line: frontmatterKeyLine(skill, key) },
        }));
    },
  },
  {
    meta: {
      id: 'SK005',
      title: 'Dead relative link',
      severity: 'warn',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Fix the link target or add the missing companion file.',
      docs: 'SKILL.md links to companion files the model is expected to open on demand. A link whose target does not exist on disk sends the model on a dead end at exactly the moment it needs detail.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      return skill.references
        .filter((ref) => !ref.exists)
        .map((ref) => ({
          message: `linked file "${ref.link}" does not exist in the skill directory`,
          location: { file: 'SKILL.md', line: ref.line },
        }));
    },
  },
  {
    meta: {
      id: 'SK006',
      title: 'Absolute local filesystem path',
      severity: 'warn',
      dimension: 'structure',
      appliesTo: ['skill'],
      fixHint: 'Replace the absolute path with a path relative to the skill directory.',
      docs: 'Paths like /Users/alice/… or C:\\projects\\… only resolve on the author’s machine. Skills travel between machines and hosts, so instructions must use relative paths. URLs are never flagged.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const lineOf = buildLineIndex(skill.body);
      const hits: RuleHit[] = [];
      for (const m of skill.body.matchAll(ABS_PATH_RE)) {
        if (isInsideUrl(skill.body, m.index)) continue;
        hits.push({
          message: `absolute local path "${m[0]}" will not resolve on other machines`,
          location: { file: 'SKILL.md', line: lineOf(m.index) + skill.bodyStartLine - 1 },
        });
      }
      return hits;
    },
  },
];
