import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../src/eval/corpus.js';
import { NEGATIVE_BANK } from '../../src/eval/prompts.js';
import { sampleWithoutReplacement, seededRandom } from '../../src/eval/random.js';

describe('distractor corpus', () => {
  const corpus = loadCorpus();

  it('has ~30 diverse entries with unique names', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(30);
    expect(new Set(corpus.map((c) => c.name)).size).toBe(corpus.length);
  });

  it('every entry carries a routable description', () => {
    for (const entry of corpus) {
      expect(entry.name).toMatch(/^[a-z0-9-]+$/);
      expect(entry.description.length).toBeGreaterThan(60);
    }
  });

  it('the negative bank covers every corpus entry (negatives align to any sample)', () => {
    for (const entry of corpus) {
      expect(NEGATIVE_BANK[entry.name], `missing negative for ${entry.name}`).toBeTypeOf('string');
    }
  });
});

describe('seeded sampling', () => {
  it('the same seed reproduces the same sample; different seeds diverge', () => {
    const corpus = loadCorpus();
    const sample = (seed: string) =>
      sampleWithoutReplacement(corpus, 11, seededRandom(seed)).map((c) => c.name);

    expect(sample('fill pdf forms')).toEqual(sample('fill pdf forms'));
    expect(sample('fill pdf forms')).not.toEqual(sample('debug kubernetes'));
  });

  it('samples without replacement', () => {
    const corpus = loadCorpus();
    const picked = sampleWithoutReplacement(corpus, 11, seededRandom('seed'));
    expect(new Set(picked.map((c) => c.name)).size).toBe(11);
  });

  it('seededRandom yields values in [0, 1)', () => {
    const rand = seededRandom('x');
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
