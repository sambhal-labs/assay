import type { Tiktoken } from 'js-tiktoken/lite';

let encoder: Tiktoken | null = null;

/**
 * Counts o200k_base tokens (labeled "approx." in reports — hosts vary).
 * The 2.3 MB rank table is loaded lazily on first use so `assay --help`
 * and non-token commands never pay the parse cost; the encoder is built
 * exactly once per process.
 */
export async function countTokens(text: string): Promise<number> {
  if (!encoder) {
    const [{ Tiktoken }, ranks] = await Promise.all([
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/o200k_base'),
    ]);
    encoder = new Tiktoken(ranks.default);
  }
  return encoder.encode(text).length;
}
