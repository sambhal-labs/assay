# Contributing to Assay

Thanks for looking under the hood. This project is deliberately small and boring on the inside — that's what keeps the grades trustworthy.

## Setup

```bash
git clone https://github.com/sambhal-labs/assay
cd assay
npm ci                 # Node >= 20
npm test               # 443 tests should pass before you change anything
npx tsx src/cli.ts fixtures/skills/mediocre   # run the CLI from source
```

## Architecture in four sentences

[`src/core/types.ts`](src/core/types.ts) is the frozen contract — artifacts, findings, scorecards, config. **Adapters** (`src/adapters/`) do every piece of I/O and normalize artifacts; **rules** (`src/rules/`) are pure synchronous functions `(artifact, config) → hits` and are never allowed to read a file or open a socket. The **scorer** (`src/core/scorer.ts`) turns findings into grades with documented math ([docs/GRADING.md](docs/GRADING.md)). **Reporters** are pure functions over the scorecard.

## Writing or changing a rule

1. Pick the ID from the allocation table in [`src/rules/index.ts`](src/rules/index.ts) (or extend it).
2. Add the rule to its family module with complete metadata — `title`, default `severity`, `dimension`, `fixHint` (one imperative sentence), and a `docs` paragraph that says _why the rule exists_. `docs/RULES.md` is generated from this metadata (`npm run gen:docs`); never edit it by hand.
3. Every rule needs **at least one triggering and one passing test**. Rule messages must name the specific thing that tripped them (the count, the file, the phrase) — "description too short" is not a message, "description is 12 chars (minimum 20)" is.
4. Detectors are lexical heuristics by design. If your rule can false-positive on legitimate content, prove it doesn't with a passing test (see `test/review-fixes.test.ts` for the standard we hold these to), and document the limitation in the rule's `docs`.
5. If your change moves the pinned fixture grades (`test/fixtures-grades.test.ts`), that's a scoring change — update the pins deliberately and explain the movement in the PR description.

## Ground rules

- **Determinism is the product.** No `Date.now()`, no randomness, no network in the static path. Sort anything that comes from the filesystem.
- **Runtime dependency budget: ≤ 10.** Justify any addition in the PR description.
- **Malformed input never throws.** Broken YAML, dead servers, empty files — all become findings (or a clean exit-2 `AssayError` for unreachable targets), never stack traces.
- **The fixtures are supposed to be awful.** `fixtures/skills/malicious` contains fake credentials and injection payloads _on purpose_ — don't "fix" them; `test/fixture-integrity.test.ts` will catch you.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Before you push

```bash
npm run typecheck && npm run lint && npx prettier --check . && npm test
```

CI additionally runs the coverage gate (≥ 90% statements, 85% branches, on rules and scorer), grades this repo with itself at threshold A (dogfood), smoke-tests the GitHub Action, and asserts the npm tarball never ships the fixtures.

## Disagreeing with a grade

Best kind of issue. Include the artifact (or a minimal reproduction), the rule ID, and why you think the finding is wrong. Every detector is a documented heuristic — precision bugs are real bugs.
