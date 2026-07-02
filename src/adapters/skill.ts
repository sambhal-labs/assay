import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import type { SkillArtifact, SkillReference, SkillSibling } from '../core/types.js';
import { buildLineIndex } from '../util/text.js';
import { countTokens } from '../util/tokens.js';

/** BOM- and CRLF-tolerant frontmatter block at the very start of the file. */
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Markdown links whose targets are relative paths on disk. */
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isRelativeLink(target: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|#|\/|\\|[A-Za-z]:[\\/])/.test(target);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a skill directory into a SkillArtifact. All I/O and token
 * counting happens here so rules stay synchronous and pure. Malformed input
 * (missing SKILL.md, broken YAML) never throws — it becomes artifact state
 * that structure rules turn into findings.
 */
export async function parseSkill(
  dir: string,
  siblings: SkillSibling[] = [],
): Promise<SkillArtifact> {
  const absDir = resolve(dir);
  const skillFilePath = join(absDir, 'SKILL.md');

  let raw = '';
  let skillFileExists = true;
  try {
    raw = await readFile(skillFilePath, 'utf8');
  } catch {
    skillFileExists = false;
  }

  let frontmatter: SkillArtifact['frontmatter'] = { present: false, parsed: null, error: null };
  let body = raw;
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    body = raw.slice(match[0].length);
    try {
      const parsed: unknown = parseYaml(match[1]!);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = { present: true, parsed: parsed as Record<string, unknown>, error: null };
      } else {
        frontmatter = { present: true, parsed: null, error: 'frontmatter is not a YAML mapping' };
      }
    } catch (err) {
      frontmatter = {
        present: true,
        parsed: null,
        error: err instanceof Error ? err.message.split('\n')[0]! : String(err),
      };
    }
  }

  const bodyStartLine = match ? match[0].split('\n').length : 1;

  const resourceFiles = skillFileExists
    ? (await fg('**/*', { cwd: absDir, onlyFiles: true, dot: true, ignore: ['SKILL.md'] })).sort()
    : [];

  const references: SkillReference[] = [];
  if (body) {
    const lineOf = buildLineIndex(body);
    for (const m of body.matchAll(MD_LINK_RE)) {
      const target = m[1]!;
      if (!isRelativeLink(target)) continue;
      const cleaned = target.split(/[#?]/)[0]!;
      if (!cleaned) continue;
      references.push({
        link: target,
        exists: await fileExists(join(absDir, decodeURIComponent(cleaned))),
        line: lineOf(m.index) + bodyStartLine - 1,
      });
    }
  }

  const name =
    typeof frontmatter.parsed?.name === 'string' && frontmatter.parsed.name.trim()
      ? (frontmatter.parsed.name as string)
      : basename(absDir);

  return {
    type: 'skill',
    name,
    path: dir,
    skillFilePath,
    skillFileExists,
    raw,
    frontmatter,
    body,
    bodyStartLine,
    bodyLineCount: body ? body.split('\n').length : 0,
    tokens: { total: await countTokens(raw), body: await countTokens(body) },
    resourceFiles,
    references,
    siblings,
  };
}
