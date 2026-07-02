import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliHandlers } from '../src/program.js';
import { AssayError } from '../src/core/errors.js';

function spies(): CliHandlers {
  return {
    grade: vi.fn().mockResolvedValue(undefined),
    mcp: vi.fn().mockResolvedValue(undefined),
    repo: vi.fn().mockResolvedValue(undefined),
    ci: vi.fn().mockResolvedValue(undefined),
    badge: vi.fn().mockResolvedValue(undefined),
    evalSkill: vi.fn().mockResolvedValue(undefined),
  };
}

async function run(argv: string[], handlers = spies()): Promise<CliHandlers> {
  const program = buildProgram(handlers);
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  await program.parseAsync(argv, { from: 'user' });
  return handlers;
}

describe('assay <path> (default command)', () => {
  it('routes a bare path to grade', async () => {
    const h = await run(['./my-skill']);
    expect(h.grade).toHaveBeenCalledWith(
      './my-skill',
      expect.objectContaining({ format: 'terminal' }),
    );
  });

  it('defaults the path to "."', async () => {
    const h = await run([]);
    expect(h.grade).toHaveBeenCalledWith('.', expect.anything());
  });

  it('passes global flags through', async () => {
    const h = await run(['--format', 'json', '--rules', 'SK101=off', '--quiet', '--no-color', 'x']);
    expect(h.grade).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ format: 'json', rules: 'SK101=off', quiet: true, color: false }),
    );
  });
});

describe('assay skill', () => {
  it('routes to grade with the directory', async () => {
    const h = await run(['skill', './dir']);
    expect(h.grade).toHaveBeenCalledWith('./dir', expect.anything());
  });
});

describe('assay mcp parsing contract', () => {
  it('1: a URL target', async () => {
    const h = await run(['mcp', 'https://example.com/mcp']);
    expect(h.mcp).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/mcp', probe: false, unsafe: false }),
      expect.anything(),
    );
  });

  it('2: a stdio command after -- with its own flags intact', async () => {
    const h = await run(['mcp', '--', 'npx', '-y', '@me/server', '--port', '3000']);
    expect(h.mcp).toHaveBeenCalledWith(
      expect.objectContaining({ command: ['npx', '-y', '@me/server', '--port', '3000'] }),
      expect.anything(),
    );
  });

  it('3: --probe and --unsafe are mcp options, not passthrough', async () => {
    const h = await run(['mcp', '--probe', '--unsafe', '--', 'node', 'server.js']);
    expect(h.mcp).toHaveBeenCalledWith(
      expect.objectContaining({ probe: true, unsafe: true, command: ['node', 'server.js'] }),
      expect.anything(),
    );
  });

  it('4: no target is a usage error', async () => {
    await expect(run(['mcp'])).rejects.toThrow(AssayError);
  });

  it('5: a URL plus extra arguments is a usage error', async () => {
    await expect(run(['mcp', 'https://example.com/mcp', 'extra'])).rejects.toThrow(
      /takes no extra arguments/,
    );
  });
});

describe('other commands', () => {
  it('ci forwards target and threshold', async () => {
    const h = await run(['ci', 'fixtures', '--threshold', 'B+']);
    expect(h.ci).toHaveBeenCalledWith('fixtures', 'B+', expect.anything());
  });

  it('ci defaults target to "."', async () => {
    const h = await run(['ci']);
    expect(h.ci).toHaveBeenCalledWith('.', undefined, expect.anything());
  });

  it('badge forwards --out', async () => {
    const h = await run(['badge', '--out', 'custom.svg']);
    expect(h.badge).toHaveBeenCalledWith('.', 'custom.svg', expect.anything());
  });

  it('repo defaults dir to "."', async () => {
    const h = await run(['repo']);
    expect(h.repo).toHaveBeenCalledWith('.', expect.anything());
  });

  it('eval forwards provider and --yes', async () => {
    const h = await run(['eval', './skill', '--provider', 'openai', '--yes']);
    expect(h.evalSkill).toHaveBeenCalledWith(
      './skill',
      expect.objectContaining({ provider: 'openai', yes: true }),
      expect.anything(),
    );
  });

  it('unknown commands raise a CommanderError (exit 2 in cli.ts)', async () => {
    await expect(run(['definitely-not-a-command', 'x'])).rejects.toMatchObject({
      code: expect.stringContaining('commander'),
    });
  });
});
