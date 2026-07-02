import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseContextFile } from '../../src/adapters/contextfile.js';

const fixturesDir = fileURLToPath(new URL('../../fixtures', import.meta.url));

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'assay-ctx-'));

describe('parseContextFile', () => {
  it('parses the good fixture end to end', async () => {
    const artifact = await parseContextFile(join(fixturesDir, 'context/good/CLAUDE.md'));
    expect(artifact.type).toBe('context-file');
    expect(artifact.kind).toBe('claude-md');
    expect(artifact.name).toBe('CLAUDE.md');
    expect(artifact.tokens.total).toBeGreaterThan(400);
    expect(artifact.tokens.total).toBeLessThan(1500);
    expect(artifact.fileRefs.length).toBeGreaterThan(3);
    expect(artifact.fileRefs.every((r) => r.exists)).toBe(true);
    expect(artifact.commandRefs.map((c) => c.command)).toEqual([
      'npm run build',
      'npm run test',
      'npm run lint',
      'npm run typecheck',
      'npm run dev',
    ]);
    expect(artifact.commandRefs.every((c) => c.known)).toBe(true);
  });

  it('records stale references and unknown commands in the stale fixture', async () => {
    const artifact = await parseContextFile(join(fixturesDir, 'context/stale/CLAUDE.md'));
    expect(artifact.fileRefs).toContainEqual({ ref: 'src/old/main.py', exists: false, line: 7 });
    expect(artifact.fileRefs).toContainEqual({ ref: 'src/config.py', exists: true, line: 8 });
    expect(artifact.commandRefs).toContainEqual({
      command: 'npm run deploy',
      known: false,
      line: 14,
    });
    expect(artifact.commandRefs).toContainEqual({
      command: 'npm run build',
      known: true,
      line: 12,
    });
  });

  it('exceeds the warn token budget on the bloated fixture', async () => {
    const artifact = await parseContextFile(join(fixturesDir, 'context/bloated/CLAUDE.md'));
    expect(artifact.tokens.total).toBeGreaterThan(4000);
  });

  it('detects the kind for every supported filename', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, '.cursor/rules'), { recursive: true });
    const files: Array<[string, string]> = [
      ['AGENTS.md', 'agents-md'],
      ['GEMINI.md', 'gemini-md'],
      ['.cursorrules', 'cursorrules'],
      ['.cursor/rules/style.md', 'cursor-rules'],
    ];
    for (const [rel, kind] of files) {
      await writeFile(join(dir, rel), 'Some guidance.\n');
      const artifact = await parseContextFile(join(dir, rel));
      expect(artifact.kind).toBe(kind);
    }
    const cursorrules = await parseContextFile(
      join(fixturesDir, 'context/contradictions/.cursorrules'),
    );
    expect(cursorrules.kind).toBe('cursorrules');
  });

  it('extracts path refs from code spans, links, and bare tokens — and skips non-paths', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'src/utils'), { recursive: true });
    await writeFile(join(dir, 'src/app.ts'), 'export {};\n');
    await writeFile(
      join(dir, 'CLAUDE.md'),
      [
        '# CLAUDE.md',
        '',
        'Entry point is `src/app.ts` and helpers live in `src/utils`.',
        'See [the guide](docs/guide.md) plus notes in src/missing/notes.md.',
        'Branch `origin/main` and options like and/or are not paths.',
        'Visit https://example.com/docs/guide.md for the hosted copy.',
        'Ignore `src/**/*.ts` globs, `<your-file>.ts` placeholders, and',
        'files under node_modules/foo/index.js or /etc/config/app.yaml.',
        'We deploy on Node.js every week.',
        'Run `./scripts/setup.sh` once.',
      ].join('\n'),
    );
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.fileRefs).toEqual([
      { ref: 'CLAUDE.md', exists: true, line: 1 },
      { ref: 'src/app.ts', exists: true, line: 3 },
      { ref: 'src/utils', exists: true, line: 3 },
      { ref: 'docs/guide.md', exists: false, line: 4 },
      { ref: 'src/missing/notes.md', exists: false, line: 4 },
      { ref: './scripts/setup.sh', exists: false, line: 10 },
    ]);
  });

  it('never scans fenced code blocks for file references', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'CLAUDE.md'),
      ['Setup:', '', '```bash', 'cat src/inside-fence.md', '```', ''].join('\n'),
    );
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.fileRefs).toEqual([]);
  });

  it('checks commands against sibling manifests and guards against prose', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'x', lint: 'y', ship: 'z' } }),
    );
    await writeFile(join(dir, 'justfile'), 'fmt:\n\techo formatting\n');
    await writeFile(
      join(dir, 'CLAUDE.md'),
      [
        '# Commands',
        '',
        '```bash',
        'npm run build',
        'pnpm lint',
        'yarn typecheck',
        'make docs',
        'just fmt',
        'just missing',
        'pnpm install',
        '```',
        '',
        'Developers should make sure to run the tests and just keep the build green.',
        'You can use yarn or npm here.',
        'Also run `npm run ship` before releasing.',
      ].join('\n'),
    );
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.commandRefs).toEqual([
      { command: 'npm run build', known: true, line: 4 },
      { command: 'pnpm lint', known: true, line: 5 },
      { command: 'yarn typecheck', known: false, line: 6 },
      { command: 'make docs', known: true, line: 7 }, // no Makefile — best effort
      { command: 'just fmt', known: true, line: 8 },
      { command: 'just missing', known: false, line: 9 },
      { command: 'npm run ship', known: true, line: 15 },
    ]);
  });

  it('parses Makefile targets, ignoring variables and recipe lines', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'Makefile'),
      'VAR := x\nbuild:\n\techo build\n.PHONY: clean\nclean: build\n\trm -rf dist\n',
    );
    await writeFile(join(dir, 'CLAUDE.md'), '```sh\nmake build\nmake clean\nmake deploy\n```\n');
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.commandRefs).toEqual([
      { command: 'make build', known: true, line: 2 },
      { command: 'make clean', known: true, line: 3 },
      { command: 'make deploy', known: false, line: 4 },
    ]);
  });

  it('treats a missing or unparseable package.json as best-effort known', async () => {
    const noManifest = await tempDir();
    await writeFile(join(noManifest, 'CLAUDE.md'), 'Run `npm run anything` to start.\n');
    const a = await parseContextFile(join(noManifest, 'CLAUDE.md'));
    expect(a.commandRefs).toEqual([{ command: 'npm run anything', known: true, line: 1 }]);

    const badManifest = await tempDir();
    await writeFile(join(badManifest, 'package.json'), 'not json{{{');
    await writeFile(join(badManifest, 'CLAUDE.md'), 'Run `npm run anything` to start.\n');
    const b = await parseContextFile(join(badManifest, 'CLAUDE.md'));
    expect(b.commandRefs[0]!.known).toBe(true);
  });

  it('flags scripts when package.json exists but declares none', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    await writeFile(join(dir, 'CLAUDE.md'), 'Run `npm run build` to compile.\n');
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.commandRefs).toEqual([{ command: 'npm run build', known: false, line: 1 }]);
  });

  it('deduplicates repeated refs and commands', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'CLAUDE.md'),
      'Run `npm run build`, then `npm run build` again. See `src/a.md` and `src/a.md`.\n',
    );
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.commandRefs).toHaveLength(1);
    expect(artifact.fileRefs).toEqual([{ ref: 'src/a.md', exists: false, line: 1 }]);
  });

  it('turns an unreadable file into empty artifact state, never a throw', async () => {
    const dir = await tempDir();
    const artifact = await parseContextFile(join(dir, 'CLAUDE.md'));
    expect(artifact.raw).toBe('');
    expect(artifact.tokens.total).toBe(0);
    expect(artifact.fileRefs).toEqual([]);
    expect(artifact.commandRefs).toEqual([]);
    expect(artifact.kind).toBe('claude-md');
    expect(artifact.name).toBe('CLAUDE.md');
  });
});
