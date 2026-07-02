import pc from 'picocolors';
import { detectTarget } from '../adapters/detect.js';
import { EXIT } from '../constants.js';
import { AssayError } from '../core/errors.js';
import type { Grade, Scorecard } from '../core/types.js';
import { GRADES } from '../core/types.js';
import type { GlobalOptions } from '../program.js';
import { gradeSingleTarget, printScorecard, resolveConfig } from './grade.js';
import { gradeRepo, meetsThreshold, printRepoResult, worstGrade } from './repo.js';

function parseThreshold(value: string): Grade {
  if ((GRADES as readonly string[]).includes(value)) return value as Grade;
  throw new AssayError(
    `invalid threshold "${value}"`,
    `expected one of: ${GRADES.join(' ')}`,
  );
}

/**
 * `assay ci [target] --threshold B+` — grade and gate.
 * Exit 0 = pass; exit 1 = any artifact below the threshold OR graded F;
 * exit 2 = execution error (handled by cli.ts).
 */
export async function runCi(
  target: string,
  thresholdFlag: string | undefined,
  opts: GlobalOptions,
): Promise<void> {
  const config = await resolveConfig(opts);
  const threshold = parseThreshold(thresholdFlag ?? config.threshold ?? 'B');

  const detected = await detectTarget(target);
  let cards: Scorecard[];
  if (detected.kind === 'repo') {
    const result = await gradeRepo(target, config);
    printRepoResult(result, opts);
    cards = result.cards;
  } else {
    const card = await gradeSingleTarget(target, config);
    printScorecard(card, opts);
    cards = [card];
  }

  const overall = worstGrade(cards);
  const failures = cards.filter(
    (c) => !meetsThreshold(c.grade, threshold) || c.grade === 'F',
  );

  // Verdict goes to stderr so --format json output stays machine-parseable.
  if (failures.length === 0) {
    process.stderr.write(
      `${pc.green('✓')} ci gate: ${overall} meets threshold ${threshold}\n`,
    );
    process.exitCode = EXIT.OK;
  } else {
    for (const card of failures) {
      process.stderr.write(
        `${pc.red('✗')} ${card.artifact.path}: ${card.grade} is below threshold ${threshold}\n`,
      );
    }
    process.stderr.write(`${pc.red('✗')} ci gate failed (threshold ${threshold})\n`);
    process.exitCode = EXIT.BELOW_THRESHOLD;
  }
}