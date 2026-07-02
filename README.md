# Assay

> Deterministic quality grades for everything you feed an AI agent — skills, MCP servers, and context files. One command, a letter grade, and the exact fixes to reach the next one.

A $125M company says skills are the new code. Code gets linters, tests, and CI gates. **Assay is that — for skills, MCP servers, and agent context files.** Free, local, open source.

<!-- HERO: terminal screenshot / GIF of `npx assaydev ./my-skill` goes here -->

## Quickstart (30 seconds)

The package is `assaydev`; the command it installs is `assay`.

```bash
# Grade anything — auto-detects a skill dir, context file, or repo
npx assaydev .

# Grade a skill directory (SKILL.md + resources)
npx assaydev skill ./my-skill

# Grade an MCP server — stdio or streamable HTTP
npx assaydev mcp -- npx -y @yourorg/your-server
npx assaydev mcp https://example.com/mcp

# Gate CI: exit 1 below the threshold (plain runs always exit 0)
npx assaydev ci --threshold B+

# Write an SVG grade badge + the README snippet to paste
npx assaydev badge
```

- **Fully local.** No accounts, no telemetry, no network calls — except MCP servers you explicitly point it at, and the opt-in eval tier with your own API keys.
- **Deterministic.** Same input → same grade, every run. The static core never calls a model.
- **Actionable.** Every deduction has a rule ID, a one-line fix, and its exact grade impact.

## What it checks

**Skills** (`SKILL.md` packages) — five dimensions:
structure (`SK001` missing SKILL.md, `SK005` dead resource references), trigger quality (`SK101` description too short to ever fire, `SK106` description collides with a sibling skill), token efficiency (`SK202` body over token budget, `SK203` monolith with zero companion files), instruction quality (`SK304` contradictory absolute rules), and security (`SK401` prompt-injection phrases, `SK402` hidden Unicode, `SK403` secret-shaped strings).

**MCP servers** (stdio or streamable HTTP) — protocol compliance (`MCP001` initialize fails), definition quality (`MCP101` tools with no description, `MCP104` parameters with no descriptions — the single most common defect in public servers), token cost (`MCP202` translates your server's context tax into dollars), security (`MCP301` tool poisoning, `MCP303` cross-tool steering), and — with `--probe` — reliability (`MCP401` protocol errors on schema-valid calls).

**Context files** (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`) — token budget (`CTX001`), references to files that don't exist (`CTX002`), commands that aren't in your package scripts (`CTX003`), contradictory rules (`CTX004`), filler sections (`CTX005`), and the shared security detectors (`CTX006`).

Every rule: [docs/RULES.md](docs/RULES.md).

## How grading works

Each dimension starts at 100. Findings subtract severity penalties (error −15, warn −5, info −1) with per-rule step-down decay, so 40 copies of the same mistake don't zero a dimension — but each fix still moves the number. Dimensions roll up through fixed weights into a composite and a letter grade (A+ … F).

One override: **any security error caps the composite at 79 (C+)**, because an injectable A-grade artifact is a lie. The scorecard always shows the uncapped number too.

The "top fixes" section is a rescore, not a guess: remove all instances of a rule, recompute the grade, rank by gain.

Full math with worked examples: [docs/GRADING.md](docs/GRADING.md).

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | Graded successfully — plain runs always exit 0, even for an F        |
| 1    | `assay ci` only: grade below threshold                               |
| 2    | Operational error (unreachable target, invalid config, internal bug) |

## Configuration

Zero-config works. To tune, drop an `assay.config.json` next to where you run:

```json
{
  "rules": { "SK105": "off", "MCP201": "error" },
  "budgets": { "skillBodyTokensWarn": 8000, "mcpMaxTools": 50 },
  "exclude": ["fixtures/**", "vendor/**"]
}
```

Rule overrides also work inline: `npx assaydev . --rules SK101=off,MCP201=error`.

## GitHub Action

After the v1 tag lands:

```yaml
# after v1 tag: uses: sambhal-labs/assay@v1
- uses: sambhal-labs/assay@v1
  with:
    path: .
    threshold: B+
```

Until then, the plain CLI gates just as well:

```yaml
- run: npx assaydev ci --threshold B+
```

## How it compares

Honest table — these tools solve overlapping but different problems. As of July 2026; corrections welcome, open an issue.

|                     | Assay  | Tessl                   | MCPJam                                | Arcade ToolBench |
| ------------------- | ------ | ----------------------- | ------------------------------------- | ---------------- |
| Fully local         | ✅     | ❌ server-side scoring  | ✅ inspector runs locally             | ❌ hosted index  |
| Open source         | ✅ MIT | ❌ proprietary scoring  | ⚠️ evals module commercially licensed | ❌               |
| No account required | ✅     | ❌                      | ✅                                    | ✅ for browsing  |
| Skills              | ✅     | ✅ registry with scores | ❌                                    | ❌               |
| MCP servers         | ✅     | ❌                      | ✅ testing/evals focus                | ✅ quality index |
| Context files       | ✅     | ❌                      | ❌                                    | ❌               |
| CI gate             | ✅     | ❌                      | ⚠️ via its eval runner                | ❌               |
| README badge        | ✅     | ❌                      | ❌                                    | ❌               |

## FAQ

**Why is my grade low?**
Nothing is opaque: every deduction has a rule ID in the output. Look it up in [docs/RULES.md](docs/RULES.md) — each rule documents why it exists and the one-line fix. The "top fixes" section tells you which fix buys the most points.

**Is an LLM judging my code?**
No. The static core is fully deterministic — pure functions over parsed artifacts, no model calls, no network. There is an optional eval tier (`assay eval`) that uses a model to test trigger accuracy; it is opt-in, bring-your-own-key, cost-capped, and clearly labeled non-deterministic in the output.

**Why is my A-grade artifact capped at C+?**
A security-severity error tripped the cap: an artifact carrying a prompt injection, hidden Unicode payload, or leaked credential is not shippable regardless of how well-written it is. The scorecard shows the uncapped score too — fix the security finding and the rest of your grade is waiting for you.

## Status

**v0.1.0 — built in public.** The core pipeline, skill rules, MCP rules, context-file rules, reporters, CI gate, and badge generator are landing as reviewable PRs in this repo. Watch the PRs, file issues, disagree with a rule — the rule table is the contract and it's all open.

## License

[MIT](LICENSE)
