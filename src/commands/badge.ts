import { writeFile } from 'node:fs/promises';
import { detectTarget } from '../adapters/detect.js';
import type { Grade } from '../core/types.js';
import type { GlobalOptions } from '../program.js';
import { badgeSnippet, renderBadge } from '../reporters/badge.js';
import { gradeSingleTarget, resolveConfig } from './grade.js';
import { gradeRepo } from './repo.js';

/** `assay badge [target] --out assay-badge.svg` — grade-colored SVG + snippet. */
export async function runBadge(target: string, out: string, opts: GlobalOptions): Promise<void> {
  const config = await resolveConfig(opts);
  const detected = await detectTarget(target);

  let grade: Grade;
  if (detected.kind === 'repo') {
    grade = (await gradeRepo(target, config)).overall;
  } else {
    grade = (await gradeSingleTarget(target, config)).grade;
  }

  await writeFile(out, renderBadge(grade), 'utf8');
  process.stderr.write(`wrote ${out} (grade ${grade})\n`);
  process.stdout.write(`${badgeSnippet(out)}\n`);
}
