import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSkill } from '../../src/adapters/skill.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));

describe('parseSkill', () => {
  it('parses the exemplary fixture end to end', async () => {
    const artifact = await parseSkill(join(fixturesDir, 'skills/exemplary'));
    expect(artifact.skillFileExists).toBe(true);
    expect(artifact.name).toBe('pdf-form-filler');
    expect(artifact.frontmatter.present).toBe(true);
    expect(artifact.frontmatter.error).toBeNull();
    expect(artifact.frontmatter.parsed?.description).toContain('Use when');
    expect(artifact.tokens.total).toBeGreaterThan(artifact.tokens.body);
    expect(artifact.resourceFiles).toEqual(['reference.md']);
    // every reference.md link resolves
    expect(artifact.references.length).toBeGreaterThan(0);
    expect(artifact.references.every((r) => r.exists)).toBe(true);
    expect(artifact.bodyStartLine).toBeGreaterThan(1);
  });

  it('surfaces YAML errors as artifact state, never throws', async () => {
    const artifact = await parseSkill(join(fixturesDir, 'skills/broken'));
    expect(artifact.skillFileExists).toBe(true);
    expect(artifact.frontmatter.present).toBe(true);
    expect(artifact.frontmatter.parsed).toBeNull();
    expect(artifact.frontmatter.error).toBeTruthy();
    // dead link recorded with exists: false
    expect(artifact.references).toContainEqual(
      expect.objectContaining({ link: 'guide.md', exists: false }),
    );
    expect(artifact.name).toBe('broken'); // falls back to dir name
  });

  it('handles a directory with no SKILL.md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-skill-'));
    const artifact = await parseSkill(dir);
    expect(artifact.skillFileExists).toBe(false);
    expect(artifact.raw).toBe('');
    expect(artifact.tokens.total).toBe(0);
  });

  it('tolerates BOM and CRLF frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-skill-'));
    await writeFile(
      join(dir, 'SKILL.md'),
      '﻿---\r\nname: crlf-skill\r\ndescription: Handles Windows line endings for testing.\r\n---\r\n\r\nBody text here.\r\n',
    );
    const artifact = await parseSkill(dir);
    expect(artifact.frontmatter.error).toBeNull();
    expect(artifact.frontmatter.parsed?.name).toBe('crlf-skill');
    expect(artifact.body).toContain('Body text');
  });

  it('treats scalar frontmatter as an error, not a crash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-skill-'));
    await writeFile(join(dir, 'SKILL.md'), '---\njust a string\n---\nbody\n');
    const artifact = await parseSkill(dir);
    expect(artifact.frontmatter.error).toMatch(/not a YAML mapping/);
  });

  it('ignores external and anchor links when resolving references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-skill-'));
    await writeFile(
      join(dir, 'SKILL.md'),
      [
        '---',
        'name: links',
        'description: Reference resolution edge cases for testing purposes.',
        '---',
        '',
        '[web](https://example.com/x) [anchor](#section) [mail](mailto:a@b.c)',
        '[missing](does-not-exist.md)',
      ].join('\n'),
    );
    const artifact = await parseSkill(dir);
    expect(artifact.references).toHaveLength(1);
    expect(artifact.references[0]).toMatchObject({
      link: 'does-not-exist.md',
      exists: false,
      line: 7,
    });
  });
});
