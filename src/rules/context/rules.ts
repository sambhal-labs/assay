import type { Artifact, ContextFileArtifact, Rule, RuleHit } from '../../core/types.js';
import { buildLineIndex } from '../../util/text.js';
import { findInjectionPhrases } from '../shared/injection.js';
import { findSecrets } from '../shared/secrets.js';
import { findHiddenUnicode } from '../shared/unicode.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asContext = (a: Artifact): ContextFileArtifact => a as ContextFileArtifact;

const fmt = (n: number): string => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// CTX004 — contradictory absolute rules ("always X" vs "never X")
// ---------------------------------------------------------------------------

interface AbsoluteRule {
  /** The matched text, e.g. "Always use tabs for indentation". */
  phrase: string;
  /** Lowercased object words (up to 4) following the modifier. */
  tokens: string[];
  line: number;
}

const ABSOLUTE_RE = /\b(always|never)[ \t]+((?:[A-Za-z0-9'’-]+[ \t]+){0,3}[A-Za-z0-9'’-]+)/gi;

function collectAbsolutes(raw: string): { always: AbsoluteRule[]; never: AbsoluteRule[] } {
  const lineOf = buildLineIndex(raw);
  const always: AbsoluteRule[] = [];
  const never: AbsoluteRule[] = [];
  for (const m of raw.matchAll(ABSOLUTE_RE)) {
    const entry: AbsoluteRule = {
      phrase: `${m[1]!} ${m[2]!}`,
      tokens: m[2]!.toLowerCase().split(/[ \t]+/),
      line: lineOf(m.index),
    };
    (m[1]!.toLowerCase() === 'always' ? always : never).push(entry);
  }
  return { always, never };
}

/**
 * Token-prefix match: "use tabs" contradicts "use tabs for indentation".
 * A single-token object only matches an identical single-token object —
 * anything looser drowns in false positives.
 */
function contradicts(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 0) return false;
  if (shorter.length === 1 && longer.length > 1) return false;
  return shorter.every((token, i) => longer[i] === token);
}

// ---------------------------------------------------------------------------
// CTX005 — generic filler sections
// ---------------------------------------------------------------------------

/** Background a model already knows; heading must match after normalization. */
const FILLER_HEADINGS: ReadonlyArray<RegExp> = [
  /^what is (?:react|git|javascript|typescript|python|node(?:\.js)?|npm|docker)$/,
  /^how (?:git|npm|react|docker|the internet) works$/,
  /^introduction to (?:javascript|typescript|python|git|react|node(?:\.js)?)$/,
  /^(?:git|javascript|typescript|python) basics$/,
];

const HEADING_RE = /^#{1,6}[ \t]+(.+)$/gm;

const normalizeHeading = (text: string): string =>
  text
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/[?!.:]+$/, '')
    .toLowerCase();

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const ctxRules: Rule[] = [
  {
    meta: {
      id: 'CTX001',
      title: 'Context file exceeds its token budget',
      severity: 'info',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint:
        'Trim the file to durable project-specific facts and move reference material into linked docs.',
      docs: 'A context file is prepended to every conversation an agent has in the repo, so its token count is a per-conversation tax paid before any work begins. Banded: info above the soft budget, warn above the hard budget.',
    },
    check: (artifact, config) => {
      const ctx = asContext(artifact);
      const total = ctx.tokens.total;
      const { ctxTokensInfo, ctxTokensWarn } = config.budgets;
      if (total <= ctxTokensInfo) return [];
      const severity = total > ctxTokensWarn ? 'warn' : 'info';
      const budget = severity === 'warn' ? ctxTokensWarn : ctxTokensInfo;
      return [
        {
          severity,
          message: `${ctx.name} is ~${fmt(total)} tokens (budget ${fmt(budget)}) — this cost is paid on every conversation, before the agent does any work`,
          meta: { tokens: total, budget },
        },
      ];
    },
  },
  {
    meta: {
      id: 'CTX002',
      title: 'References files that do not exist',
      severity: 'warn',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'Update the path to the file’s current location or delete the stale reference.',
      docs: 'A context file that points at paths which no longer exist is stale documentation: the agent wastes turns hunting for missing files or, worse, recreates them. Only conservatively-matched path references are checked, so every hit is a real broken pointer.',
    },
    check: (artifact) =>
      asContext(artifact)
        .fileRefs.filter((ref) => !ref.exists)
        .map((ref) => ({
          message: `references ${ref.ref}, which does not exist`,
          location: { line: ref.line },
        })),
  },
  {
    meta: {
      id: 'CTX003',
      title: 'References commands the project does not define',
      severity: 'warn',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'Fix the command name or add the missing script to the project manifest.',
      docs: 'Telling the agent to run a script that package.json, the Makefile, or the justfile does not define sends it down a failing path on its very first action. Commands are only flagged when the corresponding manifest exists and provably lacks the target.',
    },
    check: (artifact) =>
      asContext(artifact)
        .commandRefs.filter((cmd) => !cmd.known)
        .map((cmd) => {
          const tool = cmd.command.split(' ')[0]!;
          const manifest =
            tool === 'make' ? 'the Makefile' : tool === 'just' ? 'the justfile' : 'package.json';
          return {
            message: `command "${cmd.command}" does not match any target in ${manifest}`,
            location: { line: cmd.line },
          };
        }),
  },
  {
    meta: {
      id: 'CTX004',
      title: 'Contradictory absolute rules',
      severity: 'warn',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'Keep whichever rule is correct and delete the contradicting one.',
      docs: 'When one line says "always X" and another says "never X", the agent cannot satisfy both and will pick one unpredictably — usually the one closest to the end of the file. Objects are compared by normalized token prefix, so only genuinely opposing pairs are flagged.',
    },
    check: (artifact) => {
      const ctx = asContext(artifact);
      if (!ctx.raw) return [];
      const { always, never } = collectAbsolutes(ctx.raw);
      const hits: RuleHit[] = [];
      const seen = new Set<string>();
      for (const a of always) {
        for (const n of never) {
          if (!contradicts(a.tokens, n.tokens)) continue;
          const key = `${a.tokens.join(' ')}::${n.tokens.join(' ')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            message: `"${a.phrase}" (line ${a.line}) contradicts "${n.phrase}" (line ${n.line})`,
            location: { line: Math.min(a.line, n.line) },
          });
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'CTX005',
      title: 'Generic filler sections',
      severity: 'info',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'Delete the section — the model already knows this background.',
      docs: 'Sections like "What is React" or "Git basics" restate training data: they cost tokens on every conversation and teach the model nothing. Context files should carry only what is specific to this project.',
    },
    check: (artifact) => {
      const ctx = asContext(artifact);
      if (!ctx.raw) return [];
      const lineOf = buildLineIndex(ctx.raw);
      const hits: RuleHit[] = [];
      for (const m of ctx.raw.matchAll(HEADING_RE)) {
        const heading = m[1]!.trim();
        if (!FILLER_HEADINGS.some((re) => re.test(normalizeHeading(heading)))) continue;
        hits.push({
          message: `section "${heading}" is generic background the model already knows`,
          location: { line: lineOf(m.index) },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'CTX006',
      title: 'Injection phrases, hidden Unicode, or secrets',
      severity: 'error',
      dimension: 'quality',
      appliesTo: ['context-file'],
      fixHint: 'Remove the injected instruction, hidden character, or secret from the file.',
      docs: 'A context file is injected into every conversation, which makes it the highest-leverage place to hide prompt-injection phrases, invisible Unicode payloads, or leaked credentials. Any hit is weighted double (penaltyMultiplier 2) and caps the composite at C+ — the spec’s "security errors weighted x2".',
      securityCap: true,
      penaltyMultiplier: 2,
    },
    check: (artifact) => {
      const ctx = asContext(artifact);
      if (!ctx.raw) return [];
      const lineOf = buildLineIndex(ctx.raw);
      const hits: RuleHit[] = [];
      for (const hit of findInjectionPhrases(ctx.raw)) {
        hits.push({
          message: `injection phrase "${hit.match}" (${hit.pattern})`,
          location: { line: lineOf(hit.index) },
        });
      }
      for (const hit of findHiddenUnicode(ctx.raw)) {
        hits.push({
          message: `hidden ${hit.kind} character ${hit.label}`,
          location: { line: lineOf(hit.index) },
        });
      }
      for (const hit of findSecrets(ctx.raw)) {
        // hit.match arrives pre-redacted from the shared detector.
        hits.push({
          message: `${hit.kind} "${hit.match}" committed to context`,
          location: { line: lineOf(hit.index) },
        });
      }
      return hits;
    },
  },
];
