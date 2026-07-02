import { describe, expect, it } from 'vitest';
import { buildLineIndex, jaccardSimilarity, levenshtein } from '../../src/util/text.js';

describe('buildLineIndex', () => {
  it('maps indices to 1-based lines', () => {
    const text = 'one\ntwo\nthree';
    const lineOf = buildLineIndex(text);
    expect(lineOf(0)).toBe(1);
    expect(lineOf(3)).toBe(1);
    expect(lineOf(4)).toBe(2);
    expect(lineOf(8)).toBe(3);
    expect(lineOf(text.length - 1)).toBe(3);
  });

  it('handles single-line text', () => {
    expect(buildLineIndex('abc')(2)).toBe(1);
  });
});

describe('jaccardSimilarity', () => {
  it('is 1 for identical descriptions and 0 for disjoint ones', () => {
    expect(jaccardSimilarity('convert pdf files', 'convert pdf files')).toBe(1);
    expect(jaccardSimilarity('convert pdf files', 'deploy kubernetes clusters')).toBe(0);
  });

  it('scores overlapping descriptions between 0 and 1', () => {
    const sim = jaccardSimilarity(
      'Extract tables from PDF documents',
      'Extract text from PDF documents',
    );
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });

  it('returns 0 for empty input', () => {
    expect(jaccardSimilarity('', 'anything')).toBe(0);
  });
});

describe('levenshtein', () => {
  it.each([
    ['kitten', 'sitting', 3],
    ['read_file', 'read_file', 0],
    ['web_serch', 'web_search', 1],
    ['', 'abc', 3],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });
});
