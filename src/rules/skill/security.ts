import type { Artifact, Rule, SkillArtifact } from '../../core/types.js';
import { findHiddenUnicode } from '../shared/unicode.js';
import { buildLineIndex } from '../../util/text.js';

const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

export const securityRules: Rule[] = [
  {
    meta: {
      id: 'SK402',
      title: 'Hidden or obfuscating Unicode',
      severity: 'error',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint: 'Delete the invisible characters — legitimate instructions never need them.',
      docs: 'Zero-width characters, bidi controls, and Unicode tag-block codepoints render as nothing while carrying instructions to the model — the canonical payload-smuggling channel. Legitimate non-ASCII prose is never flagged.',
      securityCap: true,
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.raw) return [];
      const lineOf = buildLineIndex(skill.raw);
      return findHiddenUnicode(skill.raw).map((hit) => ({
        message: `hidden ${hit.kind} character ${hit.label}`,
        location: { file: 'SKILL.md', line: lineOf(hit.index) },
      }));
    },
  },
];
