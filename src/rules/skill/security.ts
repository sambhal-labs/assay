import type { Artifact, Rule, RuleHit, SkillArtifact } from '../../core/types.js';
import { findFetchExecute, findBase64Blobs, findInjectionPhrases } from '../shared/injection.js';
import { findSecrets } from '../shared/secrets.js';
import { findHiddenUnicode } from '../shared/unicode.js';
import { buildLineIndex } from '../../util/text.js';

const asSkill = (a: Artifact): SkillArtifact => a as SkillArtifact;

const truncate = (text: string, max = 60): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

/**
 * Major well-known domains (SK406). Everything else is surfaced for human
 * review — an unknown domain is not a finding of malice, just a fact the
 * reviewer should see. Subdomains of allowlisted domains are allowed.
 */
const MAJOR_DOMAINS: ReadonlyArray<string> = [
  'github.com',
  'npmjs.com',
  'pypi.org',
  'anthropic.com',
  'openai.com',
  'google.com',
  'microsoft.com',
  'wikipedia.org',
  'stackoverflow.com',
  'mozilla.org',
  'modelcontextprotocol.io',
  'docs.python.org',
  'nodejs.org',
];

const isMajorDomain = (domain: string): boolean =>
  MAJOR_DOMAINS.some((major) => domain === major || domain.endsWith(`.${major}`));

const URL_RE = /https?:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi;

export const securityRules: Rule[] = [
  {
    meta: {
      id: 'SK401',
      title: 'Prompt-injection phrasing',
      severity: 'error',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint:
        'Remove the instruction — skills must never override the host or hide from the user.',
      docs: 'Phrases like "ignore previous instructions" or "do not tell the user" are the signature of tool poisoning: content addressed to the model rather than describing the task. Detection is lexical and documented as such.',
      securityCap: true,
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.raw) return [];
      const lineOf = buildLineIndex(skill.raw);
      return findInjectionPhrases(skill.raw).map((hit) => ({
        message: `injection phrase (${hit.pattern}): "${truncate(hit.match)}"`,
        location: { file: 'SKILL.md', line: lineOf(hit.index) },
      }));
    },
  },
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
  {
    meta: {
      id: 'SK403',
      title: 'Secret-shaped string',
      severity: 'error',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint: 'Remove the credential and rotate it; reference secrets via environment variables.',
      docs: 'A skill is copied, shared, and committed — any embedded credential shape (AWS keys, GitHub tokens, API keys, private key blocks) is either a live leak or a pattern that teaches users to hardcode secrets. Matches are redacted in reports.',
      securityCap: true,
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.raw) return [];
      const lineOf = buildLineIndex(skill.raw);
      return findSecrets(skill.raw).map((hit) => ({
        message: `${hit.kind} detected: ${hit.match}`,
        location: { file: 'SKILL.md', line: lineOf(hit.index) },
      }));
    },
  },
  {
    meta: {
      id: 'SK404',
      title: 'Fetch-and-execute instruction',
      severity: 'warn',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint: 'Pin and ship the script with the skill instead of piping a download into a shell.',
      docs: 'Instructions like "curl … | sh" make the model execute whatever a remote server serves at run time — content the skill author no longer controls and the user never reviews.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const lineOf = buildLineIndex(skill.body);
      return findFetchExecute(skill.body).map((hit) => ({
        message: `fetch-and-execute pattern (${hit.pattern}): "${truncate(hit.match)}"`,
        location: { file: 'SKILL.md', line: lineOf(hit.index) + skill.bodyStartLine - 1 },
      }));
    },
  },
  {
    meta: {
      id: 'SK405',
      title: 'Base64 blob in instructions',
      severity: 'warn',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint: 'Replace the encoded blob with plaintext content or a reviewable companion file.',
      docs: 'Long base64 runs in instructions are unreviewable payloads: neither the user nor a code reviewer can see what the model is being told to decode and act on.',
    },
    check: (artifact, config) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const lineOf = buildLineIndex(skill.body);
      return findBase64Blobs(skill.body, config.budgets.base64MinLength).map((hit) => ({
        message: `base64-looking blob ${hit.match}`,
        location: { file: 'SKILL.md', line: lineOf(hit.index) + skill.bodyStartLine - 1 },
      }));
    },
  },
  {
    meta: {
      id: 'SK406',
      title: 'Link to non-major external domain',
      severity: 'info',
      dimension: 'security',
      appliesTo: ['skill'],
      fixHint: 'Confirm the domain is intentional and trustworthy before shipping the skill.',
      docs: 'URLs outside a short list of major domains are surfaced for review, not judged — most are fine, but an unfamiliar domain in agent instructions is exactly what a human should glance at once.',
    },
    check: (artifact) => {
      const skill = asSkill(artifact);
      if (!skill.body) return [];
      const lineOf = buildLineIndex(skill.body);
      const seen = new Set<string>();
      const hits: RuleHit[] = [];
      for (const m of skill.body.matchAll(URL_RE)) {
        const domain = m[1]!.toLowerCase();
        if (isMajorDomain(domain) || seen.has(domain)) continue;
        seen.add(domain);
        hits.push({
          message: `links to external domain "${domain}" — surfaced for review, not judged`,
          location: { file: 'SKILL.md', line: lineOf(m.index) + skill.bodyStartLine - 1 },
        });
      }
      return hits;
    },
  },
];
