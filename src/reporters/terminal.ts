import pc from 'picocolors';
import { RULES_DOCS_URL, TOOL_NAME, TOOL_VERSION } from '../constants.js';
import type { Finding, Grade, Scorecard } from '../core/types.js';

const WIDTH = 78;
const BAR_SLOTS = 20;

export interface TerminalOptions {
  /** Force colors on/off; undefined = picocolors auto-detection. */
  color?: boolean;
  /** Suppress the per-finding detail section. */
  quiet?: boolean;
}

type Colors = ReturnType<typeof pc.createColors>;

function gradeColor(c: Colors, grade: Grade, text: string): string {
  if (grade.startsWith('A')) return c.green(text);
  if (grade.startsWith('B')) return c.cyan(text);
  if (grade.startsWith('C')) return c.yellow(text);
  return c.red(text);
}

function severityGlyph(c: Colors, f: Finding): string {
  if (f.severity === 'error') return c.red('✖');
  if (f.severity === 'warn') return c.yellow('▲');
  return c.dim('ℹ');
}

/** The Lighthouse-style scorecard — designed to be screenshot-able at 80 cols. */
export function renderTerminal(card: Scorecard, opts: TerminalOptions = {}): string {
  const c = opts.color === undefined ? pc : pc.createColors(opts.color);
  const lines: string[] = [];

  // Pad from plain text lengths, then colorize — ANSI codes have no width.
  const headerLeft = `${TOOL_NAME.toUpperCase()} v${TOOL_VERSION}`;
  const headerRight = `${card.artifact.type} · ${card.artifact.path}`;
  const headerPad = Math.max(1, WIDTH - headerLeft.length - headerRight.length);
  lines.push('');
  lines.push(`  ${c.bold(headerLeft)}${' '.repeat(headerPad)}${c.dim(headerRight)}`);
  lines.push('');

  for (const dim of card.dimensions) {
    const filled = Math.round((dim.score / 100) * BAR_SLOTS);
    const bar =
      gradeColor(c, dim.grade, '█'.repeat(filled)) + c.dim('░'.repeat(BAR_SLOTS - filled));
    const scoreText = String(Math.round(dim.score)).padStart(3);
    const issueCount = dim.findings.length;
    const issues =
      issueCount > 0 ? c.dim(`   ${issueCount} issue${issueCount === 1 ? '' : 's'}`) : '';
    lines.push(
      `  ${dim.label.padEnd(20)}${bar}  ${scoreText}  ${gradeColor(c, dim.grade, dim.grade.padEnd(2))}${issues}`,
    );
  }

  lines.push('');
  const gradeText = `── Grade: ${card.grade} (${Math.round(card.composite)}) `;
  lines.push(
    `  ${gradeColor(c, card.grade, gradeText)}${c.dim('─'.repeat(Math.max(0, WIDTH - gradeText.length)))}`,
  );
  if (card.securityCapped) {
    lines.push(
      `  ${c.red('▲ security errors cap the grade at C+')} ${c.dim(`(uncapped: ${Math.round(card.compositeRaw)})`)}`,
    );
  }

  if (card.topFixes.length > 0) {
    lines.push('');
    lines.push(`  ${c.bold(`Top fixes → ${card.topFixes[0]!.projectedGrade}`)}`);
    card.topFixes.forEach((fix, i) => {
      const gain = c.green(`(+${Math.round(fix.gain)})`);
      const count = fix.count > 1 ? c.dim(` ×${fix.count}`) : '';
      lines.push(`   ${i + 1}. ${c.bold(fix.ruleId)}${count}  ${fix.fix}  ${gain}`);
    });
  }

  const detailFindings = card.dimensions.flatMap((d) => d.findings);
  if (!opts.quiet && detailFindings.length > 0) {
    lines.push('');
    lines.push(`  ${c.bold('Findings')}`);
    for (const dim of card.dimensions) {
      for (const f of dim.findings) {
        const loc =
          f.location?.toolName ??
          (f.location?.file
            ? `${f.location.file}${f.location.line ? `:${f.location.line}` : ''}`
            : '');
        lines.push(
          `   ${severityGlyph(c, f)} ${f.ruleId}  ${f.message}${loc ? c.dim(`  ${loc}`) : ''}`,
        );
      }
    }
  }

  lines.push('');
  const seconds = (card.stats.durationMs / 1000).toFixed(1);
  lines.push(
    `  ${c.dim(
      `${card.stats.rulesRun} rules · ${detailFindings.length} finding${detailFindings.length === 1 ? '' : 's'} · ~${card.stats.tokens} tokens · ${seconds}s`,
    )}`,
  );
  lines.push(`  ${c.dim(`docs: ${RULES_DOCS_URL}`)}`);
  if (card.eval) {
    lines.push(
      `  ${c.dim(`eval: ${card.eval.provider}/${card.eval.model} F1 ${card.eval.f1.toFixed(2)} · not deterministic`)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
