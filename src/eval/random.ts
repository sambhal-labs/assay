import { createHash } from 'node:crypto';

/**
 * Deterministic PRNG (mulberry32) seeded from sha256 of a text key. The eval
 * uses it to sample distractors and position the target skill, so the same
 * skill description always yields the same routing scenario.
 */
export function seededRandom(seedText: string): () => number {
  const digest = createHash('sha256').update(seedText, 'utf8').digest();
  let a = digest.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** First `count` items of a seeded Fisher–Yates shuffle (no mutation). */
export function sampleWithoutReplacement<T>(items: T[], count: number, rand: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
