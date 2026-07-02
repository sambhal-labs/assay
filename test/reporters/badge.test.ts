import { describe, expect, it } from 'vitest';
import { GRADES, type Grade } from '../../src/core/types.js';
import { badgeSnippet, renderBadge } from '../../src/reporters/badge.js';

// Independent copy of the color spec so a mapping typo in badge.ts fails here.
const EXPECTED_COLORS: Record<Grade, string> = {
  'A+': '#4c1',
  A: '#4c1',
  'A-': '#4c1',
  'B+': '#97ca00',
  B: '#97ca00',
  'B-': '#a4a61d',
  'C+': '#dfb317',
  C: '#dfb317',
  'C-': '#dfb317',
  D: '#fe7d37',
  F: '#e05d44',
};

/** Stack-based balance check: every open tag is closed in order. */
function openTagStackAfter(svg: string): string[] {
  const tag = /<(\/?)([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tag.exec(svg)) !== null) {
    const closing = m[1] === '/';
    const name = m[2]!;
    const selfClosing = m[4] === '/';
    if (selfClosing) continue;
    if (closing) {
      expect(stack.pop()).toBe(name);
    } else {
      stack.push(name);
    }
  }
  return stack;
}

describe('renderBadge', () => {
  it('covers all 11 grades', () => {
    expect(GRADES).toHaveLength(11);
  });

  it.each(GRADES)('renders byte-identical, balanced SVG for %s', (grade) => {
    const svg = renderBadge(grade);
    expect(renderBadge(grade)).toBe(svg); // deterministic: no timestamps/randomness
    expect(openTagStackAfter(svg)).toEqual([]); // XML balanced
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it.each(GRADES)('colors the %s segment correctly', (grade) => {
    expect(renderBadge(grade)).toContain(`fill="${EXPECTED_COLORS[grade]}"`);
  });

  it.each(GRADES)('is accessible for %s (aria-label and title)', (grade) => {
    const svg = renderBadge(grade);
    expect(svg).toContain(`aria-label="assay: ${grade}"`);
    expect(svg).toContain(`<title>assay: ${grade}</title>`);
    expect(svg).toContain('role="img"');
  });

  it('contains no dates or timestamps', () => {
    for (const grade of GRADES) {
      expect(renderBadge(grade)).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/);
    }
  });

  it('draws the two-segment shields-flat structure', () => {
    const svg = renderBadge('A+');
    expect(svg).toContain('fill="#555"'); // label segment
    expect(svg).toContain('rx="3"'); // rounded corners
    expect(svg).toContain('<linearGradient'); // gloss overlay
    expect(svg).toContain('fill="url(#s)"');
    expect(svg).toContain('>assay</text>');
    expect(svg).toContain('>A+</text>');
  });

  it('sizes the value segment from the width table (A+ wider than A)', () => {
    const widthOf = (grade: Grade): number => Number(/width="(\d+)"/.exec(renderBadge(grade))![1]);
    expect(widthOf('A+')).toBeGreaterThan(widthOf('A'));
  });

  it('matches the A+ snapshot', () => {
    expect(renderBadge('A+')).toMatchSnapshot();
  });
});

describe('badgeSnippet', () => {
  it('returns the README embed plus a regeneration hint', () => {
    const snippet = badgeSnippet('./assay-badge.svg');
    const lines = snippet.split('\n');
    expect(lines[0]).toBe('![assay grade](./assay-badge.svg)');
    expect(lines[1]).toContain('npx assaydev badge');
    expect(lines).toHaveLength(2);
  });
});
