import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSkill } from '../src/adapters/skill.js';
import { defaultConfig } from '../src/core/config.js';
import { gradeArtifact } from '../src/pipeline.js';

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url));

async function grade(name: string) {
  const started = performance.now();
  const artifact = await parseSkill(join(fixturesDir, 'skills', name));
  return gradeArtifact(artifact, defaultConfig(), started);
}

/**
 * Pinned expected grades — grade drift fails CI. If a rule change moves
 * these numbers, that's a scoring change: update the pins consciously and
 * say so in the PR, never casually.
 */
describe('pinned fixture grades', () => {
  it('exemplary: A+ 100, zero findings', async () => {
    const card = await grade('exemplary');
    expect(card.grade).toBe('A+');
    expect(card.composite).toBe(100);
    expect(card.stats.findings).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('mediocre: A- 90.09 — warn-only skills bottom out here by design', async () => {
    const card = await grade('mediocre');
    expect(card.grade).toBe('A-');
    expect(card.composite).toBe(90.09);
    expect(card.stats.findings.error).toBe(0);
    expect(card.stats.findings.warn).toBeGreaterThanOrEqual(10);
    expect(card.securityCapped).toBe(false);
  });

  it('broken: F 55 — unloadable frontmatter pins into the F band', async () => {
    const card = await grade('broken');
    expect(card.grade).toBe('F');
    expect(card.composite).toBe(55);
    // the pin, not accumulated penalties, produces the F
    expect(card.compositeRaw).toBeGreaterThan(80);
    const findings = card.dimensions.flatMap((d) => d.findings);
    expect(findings.some((f) => f.foundational)).toBe(true);
  });

  it('malicious: C+ 79, security-capped, otherwise well-written', async () => {
    const card = await grade('malicious');
    expect(card.grade).toBe('C+');
    expect(card.composite).toBe(79);
    expect(card.securityCapped).toBe(true);
    expect(card.compositeRaw).toBeGreaterThan(79); // the cap did real work
    const nonSecurity = card.dimensions
      .filter((d) => d.dimension !== 'security')
      .flatMap((d) => d.findings);
    expect(nonSecurity).toEqual([]); // proves the cap, not general sloppiness
  });
});

describe('determinism', () => {
  it('grading the malicious fixture 100 times yields identical scorecards', async () => {
    const artifact = await parseSkill(join(fixturesDir, 'skills', 'malicious'));
    const render = () => {
      const card = gradeArtifact(artifact, defaultConfig(), 0);
      // durationMs is the one sanctioned nondeterministic field — normalize it.
      return JSON.stringify({ ...card, stats: { ...card.stats, durationMs: 0 } });
    };
    const first = render();
    for (let i = 0; i < 99; i++) expect(render()).toBe(first);
  });
});

describe('performance', () => {
  it('grades a 10-skill repo in under 3 seconds', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'assay-perf-'));
    for (let i = 0; i < 10; i++) {
      await cp(join(fixturesDir, 'skills', 'mediocre'), join(repoDir, `skill-${i}`), {
        recursive: true,
      });
    }
    const { gradeRepo } = await import('../src/commands/repo.js');
    const started = performance.now();
    const result = await gradeRepo(repoDir, defaultConfig());
    const elapsed = performance.now() - started;
    expect(result.cards).toHaveLength(10);
    expect(elapsed).toBeLessThan(3000);
  });
});
