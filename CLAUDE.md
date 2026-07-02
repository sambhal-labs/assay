# Assay

Deterministic quality grader for AI agent artifacts: skills (SKILL.md), MCP servers, and context files (CLAUDE.md / AGENTS.md / .cursorrules). npm package `assaydev`, bin `assay`. TypeScript strict ESM with NodeNext — every relative import needs an explicit `.js` extension.

## Commands

- `npm ci` — install deps
- `npm run build` — bundle with tsup
- `npm test` — vitest, single run
- `npm run lint` — eslint
- `npm run typecheck` — tsc --noEmit
- `npm run gen:docs` — regenerate docs/RULES.md from rule metadata
- `npx tsx src/cli.ts <target>` — run the CLI from source

Before committing: typecheck, lint, prettier, and tests must all pass.

## Architecture

Pipeline: **adapter → engine → scorer → reporter**.

- `src/adapters/` do ALL I/O and normalize targets into `Artifact` objects. Malformed input never throws out of an adapter — it becomes artifact state that rules turn into findings. Only unreachable targets or auth failures throw `AssayError` (`src/core/errors.ts`).
- `src/rules/` are pure synchronous functions `(artifact, config) => RuleHit[]`. No I/O inside rules. Thresholds come from `config.budgets`, not hardcoded numbers. Rule ID allocation table: `src/rules/index.ts`.
- `src/core/types.ts` is the frozen contract (Artifact / Rule / Finding / Scorecard / config). Do not modify it.
- Scoring weights, penalties, and default budgets live in `src/constants.ts`; the human-readable math is `docs/GRADING.md`.

## Conventions

- Conventional commits.
- Runtime dependency budget: at most 10 entries in package.json `dependencies`.
- `docs/RULES.md` is generated — regenerate it, don't hand-edit it.
- `fixtures/` contains intentional fake secrets and injection payloads; they exist to trigger rules — don't "fix" them.
- Every rule ships with at least one triggering test and one passing test.
