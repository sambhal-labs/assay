import { parseSkill } from '../adapters/skill.js';
import { EVAL_MODELS } from '../constants.js';
import { AssayError } from '../core/errors.js';
import type { Scorecard } from '../core/types.js';
import type { TriggerEvalDeps } from '../eval/run.js';
import { runTriggerEval } from '../eval/run.js';
import { gradeArtifact } from '../pipeline.js';
import type { GlobalOptions } from '../program.js';
import { printScorecard, resolveConfig } from './grade.js';

export interface EvalCommandOptions {
  provider?: string;
  yes: boolean;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * `assay eval <skill-dir>` — the one opt-in, model-graded check: would a
 * judge model load this skill at the right time? Grades the skill statically
 * as usual, then merges precision/recall/F1 into the scorecard and marks it
 * non-deterministic. BYOK: keys come only from the environment.
 * Returns null when the user declines the cost confirmation (exit 0).
 */
export async function runEval(
  dir: string,
  evalOpts: EvalCommandOptions,
  opts: GlobalOptions,
  deps: TriggerEvalDeps = {},
): Promise<Scorecard | null> {
  const config = await resolveConfig(opts);

  const providerName = evalOpts.provider ?? config.eval.provider;
  if (providerName !== 'anthropic' && providerName !== 'openai') {
    throw new AssayError(
      `unknown eval provider "${providerName}"`,
      'supported providers: anthropic (ANTHROPIC_API_KEY), openai (OPENAI_API_KEY)',
    );
  }
  const model = config.eval.model ?? EVAL_MODELS[providerName];

  const started = performance.now();
  const artifact = await parseSkill(dir);
  const name = artifact.frontmatter.parsed?.name;
  const description = artifact.frontmatter.parsed?.description;
  if (!nonEmpty(name) || !nonEmpty(description)) {
    throw new AssayError(
      'this skill has no usable name and description to eval',
      `fix SK002 first — run \`assay ${dir}\` and repair the frontmatter, then re-run the eval`,
    );
  }

  const evalResult = await runTriggerEval(
    { name: name.trim(), description: description.trim() },
    { providerName, model, maxUSD: config.eval.maxUSD, yes: evalOpts.yes },
    deps,
  );
  if (evalResult === null) {
    process.stderr.write('eval aborted — no API calls were made\n');
    return null;
  }

  const card = gradeArtifact(artifact, config, started);
  card.eval = evalResult;
  card.deterministic = false; // a model was in the loop; same input may not reproduce
  printScorecard(card, opts);
  return card;
}
