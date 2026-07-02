import type { Artifact, Rule, RuleHit, SkillArtifact } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

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
];
