import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  ContextCommandRef,
  ContextFileArtifact,
  ContextFileKind,
  ContextFileRef,
} from '../core/types.js';
import { buildLineIndex } from '../util/text.js';
import { countTokens } from '../util/tokens.js';

// ---------------------------------------------------------------------------
// Kind detection
// ---------------------------------------------------------------------------

const KIND_BY_NAME: Record<string, ContextFileKind> = {
  'CLAUDE.md': 'claude-md',
  'AGENTS.md': 'agents-md',
  'GEMINI.md': 'gemini-md',
  '.cursorrules': 'cursorrules',
};

function kindOf(absPath: string): ContextFileKind {
  const named = KIND_BY_NAME[basename(absPath)];
  if (named) return named;
  const parent = dirname(absPath);
  if (basename(parent) === 'rules' && basename(dirname(parent)) === '.cursor') {
    return 'cursor-rules';
  }
  // detectTarget() only routes known context filenames here; treat anything
  // else as generic agent markdown rather than throwing.
  return 'claude-md';
}

// ---------------------------------------------------------------------------
// Region masking — fenced blocks / inline spans / links are extracted in
// order, then masked with spaces (lengths and newlines preserved) so string
// indices from later scans still map onto the original raw text.
// ---------------------------------------------------------------------------

interface Region {
  start: number;
  end: number;
}

function fencedRegions(raw: string): Region[] {
  const regions: Region[] = [];
  let openStart: number | null = null;
  let openMarker = '';
  let offset = 0;
  for (const line of raw.split('\n')) {
    const m = line.trimStart().match(/^(```+|~~~+)/);
    if (m) {
      const marker = m[1]![0]!;
      if (openStart === null) {
        openStart = offset;
        openMarker = marker;
      } else if (marker === openMarker) {
        regions.push({ start: openStart, end: offset + line.length });
        openStart = null;
      }
    }
    offset += line.length + 1;
  }
  // An unclosed fence swallows the rest of the file — conservative for refs.
  if (openStart !== null) regions.push({ start: openStart, end: raw.length });
  return regions;
}

function maskRegions(raw: string, regions: Region[]): string {
  if (regions.length === 0) return raw;
  const chars = raw.split('');
  for (const { start, end } of regions) {
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}

const inAnyRegion = (index: number, regions: Region[]): boolean =>
  regions.some((r) => index >= r.start && index < r.end);

// ---------------------------------------------------------------------------
// File references (CTX002)
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  'ts',
  'js',
  'tsx',
  'jsx',
  'py',
  'md',
  'json',
  'yaml',
  'yml',
  'toml',
  'sh',
  'go',
  'rs',
  'java',
  'rb',
  'css',
  'html',
]);

/** Runtime/framework names that look like `*.js` files but never are. */
const FRAMEWORK_NAMES = new Set([
  'node.js',
  'deno.js',
  'react.js',
  'next.js',
  'vue.js',
  'nuxt.js',
  'angular.js',
  'express.js',
  'nest.js',
  'ember.js',
  'backbone.js',
  'alpine.js',
  'three.js',
  'd3.js',
  'chart.js',
]);

/** Markdown links whose targets may be relative paths (same as skill adapter). */
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const INLINE_CODE_RE = /`([^`\n]+)`/g;

/** Prose tokens; wrapping punctuation is excluded so paths come out clean. */
const BARE_TOKEN_RE = /[^\s|()[\]"'`,;=]+/g;

type RefSource = 'code' | 'link' | 'bare';

interface RefCandidate {
  token: string;
  index: number;
  source: RefSource;
}

/**
 * Normalizes a candidate token and rejects everything that is clearly not a
 * repo path: URLs/schemes, globs, placeholders, node_modules, absolute and
 * home paths, scoped packages, and CLI flags. Returns null to skip.
 */
function cleanCandidate(rawToken: string, source: RefSource): string | null {
  let token = rawToken.trim();
  if (!token || /\s/.test(token)) return null;
  if (token.includes('...') || token.includes('…')) return null;
  // Drop anchors (and query strings on link targets), then trailing prose
  // punctuation and `:line[:col]` suffixes.
  token = source === 'link' ? token.split(/[#?]/)[0]! : token.split('#')[0]!;
  token = token.replace(/[.,:;!]+$/, '').replace(/:\d+(?::\d+)?$/, '');
  if (!token) return null;
  if (token.includes('//')) return null; // URLs, protocol-relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(token)) return null; // any scheme
  if (/[*?<>{}$%]/.test(token)) return null; // globs and placeholders
  if (token.includes('node_modules')) return null;
  if (/^(?:[/\\~]|[A-Za-z]:[\\/])/.test(token)) return null; // absolute/home
  if (token.startsWith('@') || token.startsWith('-')) return null;
  return token;
}

function extensionOf(token: string): string | null {
  const m = token.match(/[^./]\.([A-Za-z0-9]+)$/);
  return m ? m[1]!.toLowerCase() : null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts path-like references from inline code spans, markdown link
 * targets, and bare prose tokens. Deliberately conservative — a false
 * "stale reference" is worse than a miss:
 * - extension-less tokens with a `/` (e.g. `origin/main`, "and/or") are only
 *   recorded when they resolve on disk or explicitly start with ./ or ../,
 *   except link targets, which are always deliberate references;
 * - fenced code blocks are never scanned for file references (import paths
 *   in samples resolve against source files, not the context file).
 */
async function extractFileRefs(raw: string, dir: string): Promise<ContextFileRef[]> {
  if (!raw) return [];
  const lineOf = buildLineIndex(raw);
  const noFences = maskRegions(raw, fencedRegions(raw));

  const candidates: RefCandidate[] = [];

  const spanRegions: Region[] = [];
  for (const m of noFences.matchAll(INLINE_CODE_RE)) {
    spanRegions.push({ start: m.index, end: m.index + m[0].length });
    candidates.push({ token: m[1]!, index: m.index + 1, source: 'code' });
  }
  const noCode = maskRegions(noFences, spanRegions);

  const linkRegions: Region[] = [];
  for (const m of noCode.matchAll(MD_LINK_RE)) {
    linkRegions.push({ start: m.index, end: m.index + m[0].length });
    candidates.push({ token: m[1]!, index: m.index, source: 'link' });
  }
  const noLinks = maskRegions(noCode, linkRegions);

  for (const m of noLinks.matchAll(BARE_TOKEN_RE)) {
    candidates.push({ token: m[0], index: m.index, source: 'bare' });
  }

  candidates.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const refs: ContextFileRef[] = [];
  for (const candidate of candidates) {
    const token = cleanCandidate(candidate.token, candidate.source);
    if (!token || seen.has(token)) continue;

    const ext = extensionOf(token);
    const hasKnownExt = ext !== null && SOURCE_EXTENSIONS.has(ext);
    const hasSlash = token.includes('/');
    if (!hasKnownExt && !hasSlash) continue;
    if (hasKnownExt && !hasSlash && FRAMEWORK_NAMES.has(token.toLowerCase())) continue;
    // Schemeless URLs ("api.acme.dev/v1/hook.json"): a hostname-shaped first
    // segment is a network location, not a repo path. Dotfiles (".claude/…")
    // stay.
    const firstSegment = token.split('/')[0]!;
    if (hasSlash && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(firstSegment)) continue;

    const exists = await pathExists(join(dir, token));
    const explicitRelative = token.startsWith('./') || token.startsWith('../');
    // A bare basename in prose or code ("config.ts", "settings.json") often
    // names a file living elsewhere in the tree — only a resolving one is a
    // reference. Link targets and pathed tokens stay strict.
    const include =
      candidate.source === 'link' || explicitRelative || exists || (hasKnownExt && hasSlash);
    if (!include) continue;

    seen.add(token);
    refs.push({ ref: token, exists, line: lineOf(candidate.index) });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Command references (CTX003)
// ---------------------------------------------------------------------------

/**
 * pnpm/yarn subcommands that are package-manager builtins, not project
 * scripts. `test`, `start`, and `build` style names are intentionally NOT
 * here — `yarn test` runs the "test" script.
 */
const PM_BUILTINS = new Set([
  'add',
  'audit',
  'bin',
  'cache',
  'config',
  'create',
  'dedupe',
  'dlx',
  'env',
  'exec',
  'global',
  'help',
  'i',
  'import',
  'info',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'login',
  'logout',
  'ls',
  'node',
  'outdated',
  'pack',
  'patch',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'rm',
  'run',
  'setup',
  'store',
  'uninstall',
  'unlink',
  'up',
  'update',
  'upgrade',
  'version',
  'whoami',
  'why',
  'workspace',
  'workspaces',
]);

// [ \t] only — a command never spans lines, and \s would let the optional
// second token swallow the first word of the next line's command.
const COMMAND_RE =
  /\b(npm|pnpm|yarn|make|just)[ \t]+([A-Za-z0-9_:.-]+)(?:[ \t]+([A-Za-z0-9_:.-]+))?/g;

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** null means "no package.json / unparseable" — best effort, don't guess. */
async function readPackageScripts(dir: string): Promise<Set<string> | null> {
  const raw = await readTextIfExists(join(dir, 'package.json'));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) {
      return new Set(); // valid manifest, provably no scripts
    }
    return new Set(Object.keys(scripts));
  } catch {
    return null;
  }
}

async function readMakeTargets(dir: string): Promise<Set<string> | null> {
  const raw =
    (await readTextIfExists(join(dir, 'Makefile'))) ??
    (await readTextIfExists(join(dir, 'makefile'))) ??
    (await readTextIfExists(join(dir, 'GNUmakefile')));
  if (raw === null) return null;
  const targets = new Set<string>();
  for (const line of raw.split('\n')) {
    if (line.startsWith('\t') || line.startsWith('#')) continue;
    const m = line.match(/^([^\s:=][^:=]*):(?!=)/);
    if (!m) continue;
    for (const target of m[1]!.trim().split(/\s+/)) if (target) targets.add(target);
  }
  return targets;
}

async function readJustRecipes(dir: string): Promise<Set<string> | null> {
  const raw =
    (await readTextIfExists(join(dir, 'justfile'))) ??
    (await readTextIfExists(join(dir, 'Justfile'))) ??
    (await readTextIfExists(join(dir, '.justfile')));
  if (raw === null) return null;
  const recipes = new Set<string>();
  for (const line of raw.split('\n')) {
    const m = line.match(/^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:=\n]*)?:(?!=)/);
    if (m) recipes.add(m[1]!);
  }
  return recipes;
}

/**
 * Finds `npm run X` / `pnpm [run] X` / `yarn [run] X` / `make X` / `just X`
 * occurrences and checks X against the manifest in the SAME directory as the
 * context file. Guards against English-prose false positives ("make sure",
 * "just run", "use yarn or npm"): bare `pnpm X` / `yarn X` / `make X` /
 * `just X` forms only count inside inline code spans or fenced code blocks,
 * while explicit `<pm> run X` forms count anywhere. If the corresponding
 * manifest does not exist (or cannot be parsed), refs are marked known=true.
 */
async function extractCommandRefs(raw: string, dir: string): Promise<ContextCommandRef[]> {
  if (!raw) return [];
  const lineOf = buildLineIndex(raw);
  const fenced = fencedRegions(raw);
  const noFences = maskRegions(raw, fenced);
  const spans: Region[] = [];
  for (const m of noFences.matchAll(INLINE_CODE_RE)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  const inCodeContext = (index: number): boolean =>
    inAnyRegion(index, fenced) || inAnyRegion(index, spans);

  const [packageScripts, makeTargets, justRecipes] = await Promise.all([
    readPackageScripts(dir),
    readMakeTargets(dir),
    readJustRecipes(dir),
  ]);

  const seen = new Set<string>();
  const refs: ContextCommandRef[] = [];
  const lineStarts = [0, ...[...raw.matchAll(/\n/g)].map((m) => m.index + 1)];
  for (const m of raw.matchAll(COMMAND_RE)) {
    const tool = m[1]!;
    const first = m[2]!;
    const second = m[3];

    // `cd packages/web && npm run dev` runs against another directory's
    // manifest — best effort means not guessing, so skip it entirely.
    const lineStart = lineStarts.filter((i) => i <= m.index).pop() ?? 0;
    if (/\bcd\s+\S+\s*(?:&&|;)/.test(raw.slice(lineStart, m.index))) continue;

    let script: string;
    let command: string;
    if ((tool === 'npm' || tool === 'pnpm' || tool === 'yarn') && first === 'run') {
      if (!second || second.startsWith('-')) continue;
      script = second;
      command = `${tool} run ${second}`;
    } else if (tool === 'npm') {
      continue; // only the explicit `npm run <script>` form is a script ref
    } else {
      if (first.startsWith('-')) continue;
      if ((tool === 'pnpm' || tool === 'yarn') && PM_BUILTINS.has(first)) continue;
      if (!inCodeContext(m.index)) continue;
      script = first;
      command = `${tool} ${first}`;
    }

    const targets = tool === 'make' ? makeTargets : tool === 'just' ? justRecipes : packageScripts;
    const known = targets === null ? true : targets.has(script);
    if (seen.has(command)) continue;
    seen.add(command);
    refs.push({ command, known, line: lineOf(m.index) });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Adapter entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a context file (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules,
 * .cursor/rules/*) into a ContextFileArtifact. All I/O — reading the file,
 * existence checks for referenced paths, sibling manifest parsing, token
 * counting — happens here so rules stay synchronous and pure. An unreadable
 * file never throws; it becomes an empty artifact (detectTarget already
 * guards reachability of user-supplied paths).
 */
export async function parseContextFile(file: string): Promise<ContextFileArtifact> {
  const abs = resolve(file);
  const dir = dirname(abs);

  let raw = '';
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    // Unreadable/missing file — empty artifact state, never a throw.
  }

  const [fileRefs, commandRefs, total] = await Promise.all([
    extractFileRefs(raw, dir),
    extractCommandRefs(raw, dir),
    countTokens(raw),
  ]);

  return {
    type: 'context-file',
    name: basename(abs),
    path: file,
    kind: kindOf(abs),
    raw,
    tokens: { total },
    fileRefs,
    commandRefs,
  };
}
