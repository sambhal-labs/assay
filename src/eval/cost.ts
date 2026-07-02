import { createInterface } from 'node:readline';
import { countTokens } from '../util/tokens.js';

/** Output allowance per API call — the judge answers are short JSON. */
export const OUTPUT_TOKENS_PER_CALL = 200;
/** Input allowance per not-yet-generated positive user prompt. */
export const POSITIVE_PROMPT_TOKEN_ALLOWANCE = 100;

export interface CostEstimate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/**
 * Upper-bound-ish estimate for a cold eval run: every prompt we can already
 * construct is token-counted for real; the 8 positives the judge has not
 * written yet are covered by a fixed per-prompt allowance. Estimates, not
 * billing — the price table itself is a snapshot.
 */
export async function estimateEvalCost(
  knownPrompts: string[],
  pendingPromptAllowanceTokens: number,
  calls: number,
  countCostUSD: (inTokens: number, outTokens: number) => number,
): Promise<CostEstimate> {
  let inputTokens = pendingPromptAllowanceTokens;
  for (const prompt of knownPrompts) {
    inputTokens += await countTokens(prompt);
  }
  const outputTokens = calls * OUTPUT_TOKENS_PER_CALL;
  return { calls, inputTokens, outputTokens, usd: countCostUSD(inputTokens, outputTokens) };
}

export function formatEstimate(estimate: CostEstimate, model: string): string {
  return `eval cost estimate: ~$${estimate.usd.toFixed(4)} (${estimate.calls} ${model} calls, ~${estimate.inputTokens} input + ~${estimate.outputTokens} output tokens; snapshot prices, not billing)`;
}

/**
 * Interactive [y/N] confirmation on stderr (stdout stays scorecard-only).
 * Anything but y/Y aborts.
 */
export async function confirmProceed(
  question = 'Proceed? [y/N] ',
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
