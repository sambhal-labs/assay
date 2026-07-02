import { PACKAGE_NAME, TOOL_NAME } from '../constants.js';
import type { Grade } from '../core/types.js';

/**
 * Text widths precomputed from Verdana 11px character advances, so rendering
 * needs no font measurement at runtime (and stays byte-deterministic on every
 * platform). Advances used (px at 11px, Verdana advance width / 2048 upem):
 *
 *   a 6.61 · s 5.81 · y 6.60
 *   A 7.52 · B 7.55 · C 7.68 · D 8.47 · F 6.55 · '+' 8.96 · '-' 4.88
 *
 * label "assay" = 6.61 + 5.81 + 5.81 + 6.61 + 6.60 = 31.44 → 31
 */
const LABEL_TEXT_WIDTH = 31;

const GRADE_TEXT_WIDTH: Record<Grade, number> = {
  'A+': 16, // 7.52 + 8.96 = 16.48
  A: 8, //    7.52
  'A-': 12, // 7.52 + 4.88 = 12.40
  'B+': 17, // 7.55 + 8.96 = 16.51
  B: 8, //    7.55
  'B-': 12, // 7.55 + 4.88 = 12.43
  'C+': 17, // 7.68 + 8.96 = 16.64
  C: 8, //    7.68
  'C-': 13, // 7.68 + 4.88 = 12.56
  D: 8, //    8.47
  F: 7, //    6.55
};

/** Shields color ramp mapped onto assay's 11 grades. */
export const GRADE_COLORS: Record<Grade, string> = {
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

const LABEL_COLOR = '#555';
const HORIZ_PADDING = 5; // px each side of a segment's text, like shields.
const HEIGHT = 20;

/**
 * Hand-rolled shields-style "flat" badge: label segment ("assay") + grade
 * segment, 3px rounded corners, the standard plastic-gloss gradient overlay,
 * and shadowed Verdana text. Zero timestamps or randomness — the same grade
 * always produces byte-identical SVG, so committing the badge never churns.
 */
export function renderBadge(grade: Grade): string {
  const labelWidth = LABEL_TEXT_WIDTH + 2 * HORIZ_PADDING;
  const valueWidth = GRADE_TEXT_WIDTH[grade] + 2 * HORIZ_PADDING;
  const width = labelWidth + valueWidth;
  const color = GRADE_COLORS[grade];
  const title = `${TOOL_NAME}: ${grade}`;

  // Shields text trick: font-size 110 inside scale(.1) for sub-pixel
  // positioning, with textLength pinning the run to the precomputed width.
  const labelX = labelWidth * 5;
  const labelLen = LABEL_TEXT_WIDTH * 10;
  const valueX = labelWidth * 10 + valueWidth * 5;
  const valueLen = GRADE_TEXT_WIDTH[grade] * 10;
  const font = 'Verdana,Geneva,DejaVu Sans,sans-serif';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    '<linearGradient id="s" x2="0" y2="100%">',
    '<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>',
    '<stop offset="1" stop-opacity=".1"/>',
    '</linearGradient>',
    `<clipPath id="r"><rect width="${width}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>`,
    '<g clip-path="url(#r)">',
    `<rect width="${labelWidth}" height="${HEIGHT}" fill="${LABEL_COLOR}"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${color}"/>`,
    `<rect width="${width}" height="${HEIGHT}" fill="url(#s)"/>`,
    '</g>',
    `<g fill="#fff" text-anchor="middle" font-family="${font}" text-rendering="geometricPrecision" font-size="110">`,
    `<text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelLen}">${TOOL_NAME}</text>`,
    `<text x="${labelX}" y="140" transform="scale(.1)" textLength="${labelLen}">${TOOL_NAME}</text>`,
    `<text aria-hidden="true" x="${valueX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${valueLen}">${grade}</text>`,
    `<text x="${valueX}" y="140" transform="scale(.1)" textLength="${valueLen}">${grade}</text>`,
    '</g>',
    '</svg>',
  ].join('');
}

/** The README embed for a written badge file. */
export function badgeSnippet(svgPath: string): string {
  return [
    `![assay grade](${svgPath})`,
    `<!-- regenerate with \`npx ${PACKAGE_NAME} badge\` after grading -->`,
  ].join('\n');
}
