# Assay

> **The open-source quality gate for everything you feed an AI agent** — skills, MCP servers, and context files. Lighthouse-style grades, actionable fixes, CI gating, and README badges. Fully local, zero accounts, MIT.

A $125M company says skills are the new code. Code gets linters, tests, and CI gates. **Assay is that — for skills, MCP servers, and agent context files.** Free, local, open source.

```bash
npx assaydev .
```

<!-- hero terminal output lands here once the CLI is wired -->

## Why

Developers ship three kinds of agent context artifacts at explosive rates — agent skills (`SKILL.md` packages), MCP servers (tool schemas), and repo context files (`CLAUDE.md` / `AGENTS.md` / `.cursorrules`) — with no local, open, deterministic way to check quality before shipping. Arcade's ToolBench index found only ~0.5% of 218k analyzed MCP tools earn an A grade, with missing descriptions the single most common defect.

Assay is the `eslint` / `lighthouse` equivalent: one command, a letter grade, and the exact fixes to reach the next grade — every deduction traceable to a documented rule.

## Quickstart

```bash
# Grade anything — auto-detects skills, context files, or a whole repo
npx assaydev .

# Grade a skill directory
npx assaydev skill ./my-skill

# Grade an MCP server (stdio or streamable HTTP)
npx assaydev mcp -- npx -y @me/my-server
npx assaydev mcp https://example.com/mcp

# Gate CI: exit 1 below threshold
npx assaydev ci --threshold B+
```

- **Fully local.** No accounts, no telemetry, no network calls — except MCP servers you explicitly connect to, and opt-in model-graded evals with your own keys.
- **Deterministic.** Same input → same grade, every run. The static core never calls a model.
- **Actionable.** Every finding has a rule ID, a one-line fix, and its grade impact.

## Status

🚧 v0.1.0 is being built in public — this repo goes from empty to launched today. Watch the PRs.

## How grading works

Every dimension starts at 100; findings subtract points by severity with step-down decay for repeats. Weighted dimensions roll up to a letter grade. Any security-dimension error caps the composite at C+ — an injectable A-grade artifact is a lie.

Full math: [docs/GRADING.md](docs/GRADING.md) · Every rule: [docs/RULES.md](docs/RULES.md)

## License

[MIT](LICENSE)
