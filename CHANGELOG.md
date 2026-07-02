# Changelog

## 0.1.0 — 2026-07-02

Initial public release. Built in public in a day — every subsystem landed as a reviewed PR (#1–#11).

### Added

- **Skill grading** (`assay skill`, auto-detected by `assay <path>`): 27 rules across structure, trigger quality, token efficiency, instruction quality, and security — including resource-file scanning for smuggled payloads.
- **MCP server grading** (`assay mcp <url>` / `assay mcp -- <cmd>`): 23 rules across protocol compliance, definition quality, token cost (with a dollar translation of your server's context tax), and security; `--probe` adds live reliability checks with a mutation-keyword safe mode.
- **Context-file grading** (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`): token budgets, stale references, phantom commands, contradictions, shared security detectors.
- **Deterministic scoring** with documented math ([docs/GRADING.md](docs/GRADING.md)): severity penalties, per-rule decay, weighted dimensions, the security cap (C+/79) and the foundational cap (F/55).
- **Repo mode** (`assay repo`): grades every artifact, weakest gates the repo; sibling-skill description-collision detection.
- **CI gate** (`assay ci --threshold B+`) with exit codes 0/1/2, **GitHub Action** (composite, self-building, writes the scorecard to the job summary), **SVG badge** (`assay badge`).
- **Reporters**: 80-column terminal scorecard, `--format json` (schemaVersion 1, zod-validated), `--format md` (PR-comment ready).
- **Eval tier** (`assay eval`, opt-in, BYOK Anthropic/OpenAI): trigger-accuracy F1 from a 16-scenario routing eval, cost-guarded (estimate + confirm + hard cap) and cached.
- 56 rules, all generated into [docs/RULES.md](docs/RULES.md) from rule metadata.
- 443 tests: pinned fixture grades, a 100-run determinism check, live MCP fixture-server integration tests, a <3s perf gate, ≥90% coverage on rules and scorer (85% branches).

### Security-notable defaults

- `assay repo` never executes MCP server commands found in config files — MCP grading is always explicit.
- Any security-dimension error caps the composite at C+; unloadable artifacts pin to F.
- Fake credentials and injection payloads in `fixtures/` are synthetic test data and never ship in the npm tarball.
