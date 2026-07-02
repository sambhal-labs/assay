import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectTarget, isContextFileName } from '../../src/adapters/detect.js';
import { AssayError } from '../../src/core/errors.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));

describe('detectTarget', () => {
  it('detects a directory containing SKILL.md as a skill', async () => {
    const result = await detectTarget(join(fixturesDir, 'skills/exemplary'));
    expect(result.kind).toBe('skill');
  });

  it('detects a SKILL.md file path as its parent skill directory', async () => {
    const result = await detectTarget(join(fixturesDir, 'skills/exemplary/SKILL.md'));
    expect(result).toMatchObject({ kind: 'skill' });
  });

  it('detects known context filenames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-detect-'));
    const file = join(dir, 'CLAUDE.md');
    await writeFile(file, '# hi');
    expect(await detectTarget(file)).toMatchObject({ kind: 'context-file' });
  });

  it('treats a directory without SKILL.md as a repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-detect-'));
    expect(await detectTarget(dir)).toMatchObject({ kind: 'repo' });
  });

  it('rejects unknown file types and missing paths with AssayError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-detect-'));
    const file = join(dir, 'notes.txt');
    await writeFile(file, 'hi');
    await expect(detectTarget(file)).rejects.toThrow(AssayError);
    await expect(detectTarget(join(dir, 'nope'))).rejects.toThrow(/not found/);
  });

  it('recognizes .cursor/rules files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-detect-'));
    const rulesDir = join(dir, '.cursor', 'rules');
    await mkdir(rulesDir, { recursive: true });
    expect(isContextFileName(join(rulesDir, 'style.mdc'))).toBe(true);
    expect(isContextFileName(join(dir, 'style.mdc'))).toBe(false);
    expect(isContextFileName(join(dir, '.cursorrules'))).toBe(true);
  });
});
