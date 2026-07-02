// Wiring only — no logic. Handlers lazy-import their modules so `assay
// --help` never pays for tiktoken, the MCP SDK, or fast-glob.
import { CommanderError } from 'commander';
import pc from 'picocolors';
import { EXIT } from './constants.js';
import { AssayError } from './core/errors.js';
import { buildProgram, type CliHandlers } from './program.js';

function notYet(feature: string): () => Promise<never> {
  return () =>
    Promise.reject(new AssayError(`${feature} lands in an upcoming PR — this build predates it`));
}

const handlers: CliHandlers = {
  grade: async (path, opts) => {
    const { runGrade } = await import('./commands/grade.js');
    await runGrade(path, opts);
  },
  mcp: notYet('MCP server grading'),
  repo: notYet('repo mode'),
  ci: notYet('the CI gate'),
  badge: notYet('badge generation'),
  evalSkill: notYet('the trigger-accuracy eval'),
};

async function main(): Promise<void> {
  try {
    await buildProgram(handlers).parseAsync(process.argv);
    process.exitCode ??= EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      // help/version are successful exits; parse errors are usage errors.
      process.exitCode =
        err.code === 'commander.helpDisplayed' || err.code === 'commander.version'
          ? EXIT.OK
          : EXIT.ERROR;
      return;
    }
    if (err instanceof AssayError) {
      process.stderr.write(`${pc.red('error:')} ${err.message}\n`);
      if (err.hint) process.stderr.write(`${pc.dim(`  hint: ${err.hint}`)}\n`);
      process.exitCode = EXIT.ERROR;
      return;
    }
    // Anything else is an assay bug — show the stack so it can be reported.
    console.error(err);
    process.exitCode = EXIT.ERROR;
  }
}

// process.exit() would truncate piped stdout on large JSON reports; setting
// exitCode lets the event loop drain (adapters must close every child).
void main();
