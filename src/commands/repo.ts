import { dirname, join, resolve } from 'node:path';
import fg from 'fast-glob';
import pc from 'picocolors';
import { parseSkill } from '../adapters/skill.js';
import { AssayError } from '../core/errors.js';
import { gradeMinScore } from '../core/scorer.js';
import type { Grade, ResolvedConfig, Scorecard, SkillSibling } from '../core/types.js';
import { GRADES, ScorecardSchema } from '../core/types.js';
import { gradeArtifact } from '../pipeline.js';
import type { GlobalOptions } from '../program.js';
import { resolveConfig } from './grade.js';

const CONTEXT_GLOBS = [
  '**/CLAUDE.md',
  '**/AGENTS.md',
  '**/GEMINI.md',
  '**/.cursorrules',
  '**/.cursor/rules/*.md',
  '**/.cursor/rules/*.mdc',
];

const ALWAYS_IGNORED = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'];

export interface RepoResult {
  cards: Scorecard[];
  overall: Grade;
}

/** The weakest artifact gates the repo. */
export function worstGrade(cards: Scorecard[]): Grade {
  const worstIndex = Math.max(...cards.map((c) => GRADES.indexOf(c.grade)));
  return GRADES[worstIndex]!;
}

/**
 * Discovers and grades every skill and context file under `dir`. MCP servers
 * are never auto-discovered — spawning commands found in config files is a
 * side effect the user didn't ask for; `assay mcp` is always explicit.
 */
export async function gradeRepo(dir: string, config: ResolvedConfig): Promise<RepoResult> {
  const root = resolve(dir);
  const ignore = [...ALWAYS_IGNORED, ...config.exclude];

  const skillFiles = (
    await fg('**/SKILL.md', { cwd: root, ignore, dot: true, followSymbolicLinks: false })
  ).sort();
  const contextFiles = (
    await fg(CONTEXT_GLOBS, { cwd: root, ignore, dot: true, followSymbolicLinks: false })
  ).sort();

  if (skillFiles.length === 0 && contextFiles.length === 0) {
    throw new AssayError(
      `no skills or context files found under ${dir}`,
      'assay repo looks for SKILL.md directories and CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules files',
    );
  }

  // Parse every skill first so each gets the others as siblings (SK106).
  const parsedSkills: Array<{
    artifact: Awaited<ReturnType<typeof parseSkill>>;
    rel: string;
    started: number;
  }> = [];
  for (const rel of skillFiles) {
    const started = performance.now();
    const artifact = await parseSkill(join(root, dirname(rel)));
    parsedSkills.push({ artifact, rel: dirname(rel), started });
  }
  const siblingsOf = (index: number): SkillSibling[] =>
    parsedSkills
      .filter((_, i) => i !== index)
      .map(({ artifact }) => ({
        name: artifact.name,
        description: String(artifact.frontmatter.parsed?.description ?? ''),
      }));

  const cards: Scorecard[] = [];
  for (const [i, { artifact, rel, started }] of parsedSkills.entries()) {
    cards.push(gradeArtifact({ ...artifact, path: rel, siblings: siblingsOf(i) }, config, started));
  }

  const { parseContextFile } = await import('../adapters/contextfile.js');
  for (const rel of contextFiles) {
    const started = performance.now();
    const artifact = await parseContextFile(join(root, rel));
    cards.push(gradeArtifact({ ...artifact, path: rel }, config, started));
  }

  return { cards, overall: worstGrade(cards) };
}

function gradeColored(grade: Grade, text: string): string {
  if (grade.startsWith('A')) return pc.green(text);
  if (grade.startsWith('B')) return pc.cyan(text);
  if (grade.startsWith('C')) return pc.yellow(text);
  return pc.red(text);
}

export function renderRepoTerminal(result: RepoResult): string {
  const { cards, overall } = result;
  const worstScore = Math.min(...cards.map((c) => c.composite));
  const pathWidth = Math.min(48, Math.max(8, ...cards.map((c) => c.artifact.path.length)));

  const lines: string[] = [''];
  lines.push(
    `  ${pc.bold('ARTIFACT'.padEnd(pathWidth))}  ${'TYPE'.padEnd(12)} GRADE  SCORE  WORST OFFENDER`,
  );
  for (const card of cards) {
    const worstRule = card.topFixes[0] ? `${card.topFixes[0].ruleId} ${card.topFixes[0].fix}` : '—';
    const marker = card.composite === worstScore && cards.length > 1 ? pc.red('▸ ') : '  ';
    const row = `${marker}${card.artifact.path.padEnd(pathWidth)}  ${card.artifact.type.padEnd(12)} ${gradeColored(card.grade, card.grade.padEnd(5))}  ${String(Math.round(card.composite)).padStart(3)}   ${worstRule}`;
    lines.push(row.length > 110 ? `${row.slice(0, 107)}…` : row);
  }
  lines.push('');
  lines.push(
    `  ${pc.bold(`Overall: ${gradeColored(overall, overall)}`)} ${pc.dim(`· ${cards.length} artifact${cards.length === 1 ? '' : 's'} · the weakest artifact gates the repo`)}`,
  );
  lines.push('');
  return lines.join('\n');
}

export function renderRepoMarkdown(result: RepoResult): string {
  const { cards, overall } = result;
  const lines: string[] = [];
  lines.push(`## assay repo scorecard — overall **${overall}**`);
  lines.push('');
  lines.push('| Artifact | Type | Grade | Score | Worst offender |');
  lines.push('| --- | --- | --- | ---: | --- |');
  for (const card of cards) {
    const worst = card.topFixes[0] ? `\`${card.topFixes[0].ruleId}\` ${card.topFixes[0].fix}` : '—';
    lines.push(
      `| ${card.artifact.path} | ${card.artifact.type} | **${card.grade}** | ${Math.round(card.composite)} | ${worst} |`,
    );
  }
  lines.push('');
  lines.push('_The weakest artifact gates the repo. Full math: docs/GRADING.md._');
  return lines.join('\n');
}

export function printRepoResult(result: RepoResult, opts: GlobalOptions): void {
  if (opts.format === 'json') {
    const payload = {
      schemaVersion: 1,
      overall: result.overall,
      artifacts: result.cards.map((c) => ScorecardSchema.parse(c)),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (opts.format === 'md') {
    process.stdout.write(`${renderRepoMarkdown(result)}\n`);
    return;
  }
  process.stdout.write(`${renderRepoTerminal(result)}\n`);
}

/** `assay repo [dir]` — rollup of every artifact in the repository. */
export async function runRepo(dir: string, opts: GlobalOptions): Promise<RepoResult> {
  const config = await resolveConfig(opts);
  const result = await gradeRepo(dir, config);
  printRepoResult(result, opts);
  return result;
}

/** Grade comparison helper shared with the ci gate. */
export function meetsThreshold(grade: Grade, threshold: Grade): boolean {
  return gradeMinScore(grade) >= gradeMinScore(threshold);
}
