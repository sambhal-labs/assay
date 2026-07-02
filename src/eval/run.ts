import { AssayError } from '../core/errors.js';
import type { EvalResult } from '../core/types.js';
import {
  cacheKey,
  defaultCacheDir,
  readCacheEntry,
  writeCacheEntry,
  type EvalCacheEntry,
} from './cache.js';
import { loadCorpus, type Distractor } from './corpus.js';
import {
  confirmProceed,
  estimateEvalCost,
  formatEstimate,
  POSITIVE_PROMPT_TOKEN_ALLOWANCE,
} from './cost.js';
import { computeMetrics, parsePositives, parseSkillChoice, type ScenarioOutcome } from './judge.js';
import { NEGATIVE_BANK, positivesPrompt, PROMPTS_VERSION, routingPrompt } from './prompts.js';
import { createProvider, type Provider, type ProviderName } from './providers.js';
import { seededRandom, sampleWithoutReplacement } from './random.js';

export const POSITIVE_COUNT = 8;
export const NEGATIVE_COUNT = 8;
export const DISTRACTOR_COUNT = 11;
export const SCENARIO_COUNT = POSITIVE_COUNT + NEGATIVE_COUNT;

export interface TriggerEvalTarget {
  name: string;
  description: string;
}

export interface TriggerEvalOptions {
  providerName: ProviderName;
  model: string;
  maxUSD: number;
  yes: boolean;
}

/** Injection points so the whole pipeline runs in tests with zero network. */
export interface TriggerEvalDeps {
  provider?: Provider;
  corpus?: Distractor[];
  cacheDir?: string;
  confirm?: (question: string) => Promise<boolean>;
  isTTY?: boolean;
  stderr?: (line: string) => void;
}

interface Scenario {
  kind: 'positive' | 'negative';
  /** Seeded index of the target within the 12-skill routing list. */
  targetPosition: number;
}

/**
 * The trigger-accuracy eval: does a judge model load this skill for requests
 * it should serve (recall) and leave it alone for requests aimed at other
 * skills (precision)? Returns null when the user declines the cost prompt.
 */
export async function runTriggerEval(
  target: TriggerEvalTarget,
  options: TriggerEvalOptions,
  deps: TriggerEvalDeps = {},
): Promise<EvalResult | null> {
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const corpus = deps.corpus ?? loadCorpus();
  // An injected provider (tests) is the judge; report and cache what actually ran.
  const providerName = deps.provider?.name ?? options.providerName;
  const model = deps.provider?.model ?? options.model;

  // Reproducible scenario: every random draw comes from one PRNG keyed on
  // sha256 of the skill description.
  const rand = seededRandom(target.description);
  const pool = corpus.filter((c) => c.name !== target.name);
  if (pool.length < DISTRACTOR_COUNT) {
    throw new AssayError(
      `distractor corpus too small: need ${DISTRACTOR_COUNT}, have ${pool.length}`,
    );
  }
  const distractors = sampleWithoutReplacement(pool, DISTRACTOR_COUNT, rand);
  const scenarios: Scenario[] = Array.from({ length: SCENARIO_COUNT }, (_, i) => ({
    kind: i < POSITIVE_COUNT ? 'positive' : 'negative',
    targetPosition: Math.floor(rand() * (DISTRACTOR_COUNT + 1)),
  }));

  const negatives = distractors
    .filter((d) => NEGATIVE_BANK[d.name] !== undefined)
    .slice(0, NEGATIVE_COUNT)
    .map((d) => NEGATIVE_BANK[d.name]!);
  if (negatives.length < NEGATIVE_COUNT) {
    throw new AssayError(
      'negative-request bank does not cover the sampled distractors — this is an assay bug',
    );
  }

  const skillListFor = (scenario: Scenario): Distractor[] => {
    const list = [...distractors];
    list.splice(scenario.targetPosition, 0, { name: target.name, description: target.description });
    return list;
  };

  const key = cacheKey({
    name: target.name,
    description: target.description,
    corpus: distractors,
    model,
    promptsVersion: PROMPTS_VERSION,
  });
  const cacheDir = deps.cacheDir ?? defaultCacheDir();

  let entry = await readCacheEntry(cacheDir, key);
  if (entry && entry.promptsVersion === PROMPTS_VERSION) {
    stderr(`eval: replaying stored judge responses for ${model} (cached)`);
  } else {
    entry = null;
  }

  if (!entry) {
    const provider = deps.provider ?? createProvider(providerName, model);
    entry = await runLive(target, options, provider, scenarios, skillListFor, negatives, {
      stderr,
      isTTY: deps.isTTY ?? process.stdin.isTTY === true,
      confirm: deps.confirm ?? ((q) => confirmProceed(q)),
    });
    if (!entry) return null; // user declined the cost confirmation
    await writeCacheEntry(cacheDir, key, entry);
  }

  const { responses } = entry;
  const outcomes: ScenarioOutcome[] = scenarios.map((scenario, i) => {
    // Unparseable (even after the live retry) counts as a routing miss:
    // nothing was selected.
    const choice = parseSkillChoice(responses[i] ?? '');
    return { kind: scenario.kind, selected: choice?.skill === target.name };
  });

  const metrics = computeMetrics(outcomes);
  return {
    provider: providerName,
    model,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    scenarios: SCENARIO_COUNT,
    runDate: new Date().toISOString().slice(0, 10),
  };
}

/** Cost guard + the 17 judge calls. Returns null when the user declines. */
async function runLive(
  target: TriggerEvalTarget,
  options: TriggerEvalOptions,
  provider: Provider,
  scenarios: Scenario[],
  skillListFor: (scenario: Scenario) => Distractor[],
  negatives: string[],
  io: { stderr: (line: string) => void; isTTY: boolean; confirm: (q: string) => Promise<boolean> },
): Promise<EvalCacheEntry | null> {
  const genPrompt = positivesPrompt(target, POSITIVE_COUNT);

  // Known prompt text: the generation prompt, the 8 fully-known negative
  // scenarios, and the routing scaffold (skill list + instructions) of the 8
  // positive scenarios whose user prompt does not exist yet.
  const knownPrompts = [
    genPrompt,
    ...scenarios.map((s, i) =>
      routingPrompt(skillListFor(s), s.kind === 'negative' ? negatives[i - POSITIVE_COUNT]! : ''),
    ),
  ];
  const estimate = await estimateEvalCost(
    knownPrompts,
    POSITIVE_COUNT * POSITIVE_PROMPT_TOKEN_ALLOWANCE,
    1 + SCENARIO_COUNT,
    (inTok, outTok) => provider.countCostUSD(inTok, outTok),
  );
  io.stderr(formatEstimate(estimate, provider.model));

  if (estimate.usd > options.maxUSD) {
    throw new AssayError(
      `estimated eval cost $${estimate.usd.toFixed(4)} exceeds eval.maxUSD ($${options.maxUSD.toFixed(2)})`,
      'raise "eval.maxUSD" in assay.config.json if you accept the cost',
    );
  }
  if (!options.yes) {
    if (!io.isTTY) {
      throw new AssayError(
        'stdin is not a TTY, so the eval cost estimate cannot be confirmed interactively',
        'pass --yes to accept the estimate non-interactively',
      );
    }
    if (!(await io.confirm('Proceed? [y/N] '))) return null;
  }

  // 1 generation call (temperature 0.7 where supported), one retry on
  // unparseable output.
  let genRaw = await provider.generate(genPrompt, { temperature: 0.7 });
  let positives = parsePositives(genRaw, POSITIVE_COUNT);
  if (!positives) {
    genRaw = await provider.generate(genPrompt, { temperature: 0.7 });
    positives = parsePositives(genRaw, POSITIVE_COUNT);
  }
  if (!positives) {
    throw new AssayError(
      `judge model did not return a parseable JSON array of ${POSITIVE_COUNT} user prompts after a retry`,
      'try again, or configure a different eval.model',
    );
  }

  // 16 routing calls (deterministic temperature), one retry each on
  // unparseable output; a still-unparseable answer is stored as-is and
  // scored as a routing miss.
  const responses: string[] = [];
  for (const [i, scenario] of scenarios.entries()) {
    const userPrompt =
      scenario.kind === 'positive' ? positives[i]! : negatives[i - POSITIVE_COUNT]!;
    const prompt = routingPrompt(skillListFor(scenario), userPrompt);
    let raw = await provider.generate(prompt, { temperature: 0 });
    if (!parseSkillChoice(raw)) {
      raw = await provider.generate(prompt, { temperature: 0 });
    }
    responses.push(raw);
  }

  return { promptsVersion: PROMPTS_VERSION, positives, responses };
}
