import { RULES_DOCS_URL, TOOL_NAME, TOOL_VERSION } from '../constants.js';
import type { Finding, Grade, Scorecard } from '../core/types.js';

export interface MarkdownOptions {
  /** When set, a grade-delta line ("B+ → A-") is rendered under the title. */
  previousGrade?: Grade;
}

/** Integer scores render bare; fractional ones keep one decimal. */
const fmtScore = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Pinned locale so thousands separators never depend on the host machine. */
const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** Pipes and newlines would break GFM table rows. */
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function locationText(f: Finding): string {
  if (f.location?.toolName) return `\`${cell(f.location.toolName)}\``;
  if (f.location?.file) {
    const line = f.location.line !== undefined ? `:${f.location.line}` : '';
    return `\`${cell(f.location.file)}${line}\``;
  }
  if (f.location?.line !== undefined) return `line ${f.location.line}`;
  return '—';
}

/**
 * A GitHub PR comment: paste-ready GFM with no ANSI. Sections mirror the
 * terminal reporter — title, optional grade delta, security-cap callout,
 * dimension table, top fixes, findings table, footer.
 */
export function renderMarkdown(card: Scorecard, opts: MarkdownOptions = {}): string {
  const lines: string[] = [];

  lines.push(
    `## ${TOOL_NAME}: ${card.grade} (${fmtScore(card.composite)}) — ${card.artifact.type} \`${card.artifact.path}\``,
  );
  lines.push('');

  if (opts.previousGrade !== undefined) {
    lines.push(
      opts.previousGrade === card.grade
        ? `**Grade:** ${card.grade} (unchanged)`
        : `**Grade:** ${opts.previousGrade} → ${card.grade}`,
    );
    lines.push('');
  }

  if (card.securityCapped) {
    lines.push(
      `> ⚠️ **Security cap applied.** Error-level security findings pin the grade at C+ — this artifact would otherwise score ${fmtScore(card.compositeRaw)}. The cap exists because an artifact with open security findings must not present as production-ready, no matter how polished the rest is.`,
    );
    lines.push('');
  }

  lines.push('| Dimension | Score | Grade | Issues |');
  lines.push('| --- | ---: | :---: | ---: |');
  for (const dim of card.dimensions) {
    lines.push(
      `| ${cell(dim.label)} | ${Math.round(dim.score)} | ${dim.grade} | ${dim.findings.length} |`,
    );
  }

  if (card.topFixes.length > 0) {
    lines.push('');
    lines.push('### Top fixes');
    lines.push('');
    card.topFixes.forEach((fix, i) => {
      const count = fix.count > 1 ? ` ×${fix.count}` : '';
      lines.push(
        `${i + 1}. **${fix.ruleId}**${count} — ${fix.fix} (+${fmtScore(fix.gain)} → ${fix.projectedGrade} ${fmtScore(fix.projectedComposite)})`,
      );
    });
  }

  const findings = card.dimensions.flatMap((d) => d.findings);
  if (findings.length > 0) {
    lines.push('');
    lines.push('### Findings');
    lines.push('');
    lines.push('| Severity | Rule | Message | Location |');
    lines.push('| --- | --- | --- | --- |');
    for (const f of findings) {
      lines.push(`| ${f.severity} | ${f.ruleId} | ${cell(f.message)} | ${locationText(f)} |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  const determinism = card.deterministic ? 'deterministic' : 'not deterministic (includes eval)';
  lines.push(
    `${TOOL_NAME} v${card.assayVersion || TOOL_VERSION} · ${determinism} · ${card.stats.rulesRun} rules run · ~${fmtInt(card.stats.tokens)} tokens · [rule docs](${RULES_DOCS_URL})`,
  );
  lines.push('');
  return lines.join('\n');
}
