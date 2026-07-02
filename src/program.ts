import { Command } from 'commander';
import { PACKAGE_NAME, TOOL_NAME, TOOL_VERSION } from './constants.js';
import { AssayError } from './core/errors.js';

export interface GlobalOptions {
  format: 'terminal' | 'json' | 'md';
  config?: string;
  rules?: string;
  quiet: boolean;
  color?: boolean;
}

export interface McpTarget {
  url?: string;
  command?: string[];
  probe: boolean;
  unsafe: boolean;
}

/**
 * Command handlers are injected so cli.ts stays wiring-only and tests can
 * pass spies. This file owns the full CLI surface; feature batches only swap
 * handler implementations in cli.ts.
 */
export interface CliHandlers {
  grade: (path: string, opts: GlobalOptions) => Promise<void>;
  mcp: (target: McpTarget, opts: GlobalOptions) => Promise<void>;
  repo: (dir: string, opts: GlobalOptions) => Promise<void>;
  ci: (target: string, threshold: string | undefined, opts: GlobalOptions) => Promise<void>;
  badge: (target: string, out: string, opts: GlobalOptions) => Promise<void>;
  evalSkill: (
    dir: string,
    evalOpts: { provider?: string; yes: boolean },
    opts: GlobalOptions,
  ) => Promise<void>;
}

/**
 * The shared flags are declared on the root AND on every subcommand so both
 * `assay --format json skill x` and `assay skill x --format json` work.
 */
function withSharedOptions(cmd: Command): Command {
  return cmd
    .option('--format <format>', 'output format: terminal | json | md', 'terminal')
    .option('--config <file>', 'path to assay.config.json')
    .option('--rules <overrides>', 'rule overrides, e.g. SK101=off,MCP201=error')
    .option('--quiet', 'omit the per-finding detail section', false)
    .option('--no-color', 'disable colored output');
}

/**
 * commander's optsWithGlobals lets ancestor values (including mere defaults)
 * overwrite a subcommand's explicitly passed flags. Merge manually instead:
 * an explicit cli/env value anywhere in the chain beats any default.
 */
function pickOption(cmd: Command, key: string): unknown {
  let fallback: unknown;
  for (let c: Command | null = cmd; c; c = c.parent) {
    const source = c.getOptionValueSource(key);
    if (source === undefined) continue;
    if (source !== 'default') return c.getOptionValue(key);
    fallback ??= c.getOptionValue(key);
  }
  return fallback;
}

function globalOptions(cmd: Command): GlobalOptions {
  const color = pickOption(cmd, 'color');
  return {
    format: (pickOption(cmd, 'format') ?? 'terminal') as GlobalOptions['format'],
    config: pickOption(cmd, 'config') as string | undefined,
    rules: pickOption(cmd, 'rules') as string | undefined,
    quiet: Boolean(pickOption(cmd, 'quiet')),
    // --no-color anywhere in the chain wins; true (the default) = auto-detect
    ...(color === false ? { color: false } : {}),
  };
}

export function buildProgram(handlers: CliHandlers): Command {
  const program = new Command();

  program
    .name(TOOL_NAME)
    .description(
      `the open-source quality gate for AI agent context: skills, MCP servers, and context files (npm: ${PACKAGE_NAME})`,
    )
    .version(TOOL_VERSION)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({ writeErr: (str) => process.stderr.write(str) });
  withSharedOptions(program);

  program
    .argument('[path]', 'skill directory, context file, or repo (auto-detected)', '.')
    .action(async (path: string, _opts, cmd: Command) => {
      await handlers.grade(path, globalOptions(cmd));
    });

  withSharedOptions(program.command('skill <dir>'))
    .description('grade a skill directory (SKILL.md + resources)')
    .action(async (dir: string, _opts, cmd: Command) => {
      await handlers.grade(dir, globalOptions(cmd));
    });

  withSharedOptions(program.command('mcp'))
    .description('grade an MCP server: assay mcp <url> | assay mcp -- <cmd> [args...]')
    .option('--probe', 'call each tool with schema-synthesized args (reliability checks)', false)
    .option('--unsafe', 'probe even tools whose names suggest mutations', false)
    .argument('[target...]', 'streamable HTTP URL, or stdio command after --')
    .passThroughOptions()
    .action(async (target: string[], opts: { probe: boolean; unsafe: boolean }, cmd: Command) => {
      if (target.length === 0) {
        throw new AssayError(
          'missing MCP target',
          'use: assay mcp <url> for streamable HTTP, or assay mcp -- <cmd> [args...] for stdio',
        );
      }
      const isUrl = /^https?:\/\//i.test(target[0]!);
      if (isUrl && target.length > 1) {
        throw new AssayError('a URL target takes no extra arguments');
      }
      await handlers.mcp(
        {
          ...(isUrl ? { url: target[0]! } : { command: target }),
          probe: opts.probe,
          unsafe: opts.unsafe,
        },
        globalOptions(cmd),
      );
    });

  withSharedOptions(program.command('repo [dir]'))
    .description('grade every skill and context file in a repository')
    .action(async (dir: string | undefined, _opts, cmd: Command) => {
      await handlers.repo(dir ?? '.', globalOptions(cmd));
    });

  withSharedOptions(program.command('ci [target]'))
    .description('grade and exit 1 below the threshold (default threshold: B)')
    .option('--threshold <grade>', 'minimum passing grade, e.g. B+')
    .action(async (target: string | undefined, opts: { threshold?: string }, cmd: Command) => {
      await handlers.ci(target ?? '.', opts.threshold, globalOptions(cmd));
    });

  withSharedOptions(program.command('badge [target]'))
    .description('write an SVG grade badge and print the README snippet')
    .option('--out <file>', 'output path', 'assay-badge.svg')
    .action(async (target: string | undefined, opts: { out: string }, cmd: Command) => {
      await handlers.badge(target ?? '.', opts.out, globalOptions(cmd));
    });

  withSharedOptions(program.command('eval <skill-dir>'))
    .description('model-graded trigger-accuracy eval (BYOK, opt-in, not deterministic)')
    .option('--provider <provider>', 'anthropic | openai')
    .option('--yes', 'skip the cost-estimate confirmation', false)
    .action(async (dir: string, opts: { provider?: string; yes: boolean }, cmd: Command) => {
      await handlers.evalSkill(dir, opts, globalOptions(cmd));
    });

  return program;
}
