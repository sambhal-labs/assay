import { stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AssayError } from '../core/errors.js';

export type DetectedTarget =
  | { kind: 'skill'; dir: string }
  | { kind: 'context-file'; file: string }
  | { kind: 'repo'; dir: string };

const CONTEXT_FILENAMES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules']);

/** CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, or .cursor/rules/*(.md|.mdc). */
export function isContextFileName(path: string): boolean {
  const name = basename(path);
  if (CONTEXT_FILENAMES.has(name)) return true;
  const parent = dirname(path);
  return (
    basename(parent) === 'rules' &&
    basename(dirname(parent)) === '.cursor' &&
    (name.endsWith('.md') || name.endsWith('.mdc'))
  );
}

/**
 * Maps a filesystem path to an artifact kind: a directory containing SKILL.md
 * is a skill, a known context filename is a context file, any other directory
 * is a repo scan. Anything else is a user error (exit 2), never a crash.
 */
export async function detectTarget(path: string): Promise<DetectedTarget> {
  const abs = resolve(path);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new AssayError(`path not found: ${path}`);
  }

  if (info.isFile()) {
    if (basename(abs) === 'SKILL.md') return { kind: 'skill', dir: dirname(abs) };
    if (isContextFileName(abs)) return { kind: 'context-file', file: abs };
    throw new AssayError(
      `unrecognized artifact: ${path}`,
      'expected a skill directory (containing SKILL.md), a context file (CLAUDE.md, AGENTS.md, .cursorrules, GEMINI.md), or a repo directory',
    );
  }

  try {
    const skillFile = await stat(join(abs, 'SKILL.md'));
    if (skillFile.isFile()) return { kind: 'skill', dir: abs };
  } catch {
    // no SKILL.md — fall through to repo
  }
  return { kind: 'repo', dir: abs };
}
