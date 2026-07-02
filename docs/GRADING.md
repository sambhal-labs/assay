# How Assay grades

This document is the human-readable mirror of [`src/constants.ts`](../src/constants.ts) and
[`src/core/scorer.ts`](../src/core/scorer.ts). Every number below is copied from those files;
if this doc and the code ever disagree, the code wins and the doc has a bug — please file an
issue. There is no model in the loop: **the same input produces the same grade, every run, on
every machine.** You can verify all of this by reading ~180 lines of scorer code.

## The pipeline in one paragraph

An adapter reads your artifact (a skill directory, an MCP server, or a context file) and
normalizes it into a plain data object — all I/O happens here. The engine then runs every
applicable rule; rules are pure synchronous functions that turn artifact state into findings.
The scorer converts findings into per-dimension scores, a weighted composite, and a letter
grade. Nothing is random, nothing is sampled, nothing phones home.

## Severity penalties

Each finding subtracts points from the dimension it belongs to. Every dimension starts at 100
and is floored at 0.

| Severity | Penalty    |
| -------- | ---------- |
| error    | −15 points |
| warn     | −5 points  |
| info     | −1 point   |

## Per-rule step-down decay

Repeat findings from the **same rule** (within one dimension) decay, so one systemic mistake
cannot single-handedly zero a dimension while still hurting more the more you repeat it:

| Occurrence     | Multiplier |
| -------------- | ---------- |
| 1st            | ×1         |
| 2nd            | ×0.5       |
| 3rd            | ×0.25      |
| 4th and beyond | ×0.1 each  |

All findings from one rule share a single base penalty — that of the rule's first finding in
deterministic sort order (findings are sorted by rule ID, file, tool name, line, then message).
Findings from _different_ rules never share decay: each rule decays independently.

**Worked example — 40 missing parameter descriptions** (rule `MCP104`, warn, base 5):

```
occurrence  1:            5 × 1.00 =  5.00
occurrence  2:            5 × 0.50 =  2.50
occurrence  3:            5 × 0.25 =  1.25
occurrences 4–40 (×37):   5 × 0.10 = 18.50
                        total      = 27.25
```

The definition dimension scores 100 − 27.25 = **72.75** (a C−). Without decay it would be
40 × 5 = 200 → floored to 0, and fixing 39 of the 40 would appear to accomplish nothing.
With decay, every fix moves the number, and the first three fixes move it most.

### Penalty multipliers

A rule's metadata may declare a `penaltyMultiplier`; the penalty per occurrence is
`base × multiplier × decay`. Context-file security findings (`CTX006`) use ×2 — in a
single-dimension artifact, a security error must hurt like one (15 × 2 = 30 for the first
hit).

## Dimensions and weights

Each artifact type is scored on a fixed set of dimensions. The composite is the weighted mean:
`composite = Σ (dimension score × weight)`, with weights summing to 1.

### Skills

| Dimension           | Weight |
| ------------------- | ------ |
| Trigger quality     | 0.30   |
| Token efficiency    | 0.20   |
| Security            | 0.20   |
| Structure           | 0.15   |
| Instruction quality | 0.15   |

### MCP servers

| Dimension           | Weight | Weight with `--probe` |
| ------------------- | ------ | --------------------- |
| Definition quality  | 0.30   | 0.20                  |
| Security            | 0.30   | 0.30                  |
| Protocol compliance | 0.20   | 0.20                  |
| Token cost          | 0.20   | 0.20                  |
| Reliability         | —      | 0.10                  |

Without `--probe`, Assay never calls your server's tools, so reliability cannot be measured
and carries no weight. With `--probe`, reliability takes 0.10 from definition quality
(0.30 → 0.20); all other weights are unchanged.

### Context files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`)

| Dimension | Weight |
| --------- | ------ |
| Quality   | 1.00   |

One dimension, weight 1 — a context file is a single document, and slicing it into five
sub-scores would be false precision. Security findings in context files carry the ×2 penalty
multiplier described above.

## Grade bands

The first band whose minimum the composite meets wins.

| Grade | Composite  |
| ----- | ---------- |
| A+    | 97 – 100   |
| A     | 93 – 96.99 |
| A−    | 90 – 92.99 |
| B+    | 87 – 89.99 |
| B     | 83 – 86.99 |
| B−    | 80 – 82.99 |
| C+    | 77 – 79.99 |
| C     | 73 – 76.99 |
| C−    | 70 – 72.99 |
| D     | 60 – 69.99 |
| F     | below 60   |

Scores are rounded to two decimals for display; the grade is computed on the unrounded value.

## The security cap

Any **error**-severity finding in the security dimension — or from any rule whose metadata
declares `securityCap` (e.g. `CTX006`, which lives in the quality dimension) — pins the
composite at **79, a C+**, no matter how good everything else is.

Rationale: an injectable A-grade artifact is a lie. A skill with a perfect description and
a prompt-injection payload is not "95% good" — the payload poisons everything downstream, so
the grade must say _not shippable_ louder than the weighted mean ever would.

Two honest details:

- The cap never _raises_ a score. If your composite is already below 79, the cap does nothing.
- The scorecard always shows the uncapped number too (`compositeRaw`, with
  `securityCapped: true`), so you can see exactly what the artifact would score once the
  security finding is fixed.

## Top fixes

The scorecard's "top fixes" section is not a heuristic — it is a rescore. For each rule that
produced findings, the scorer:

1. removes **all** instances of that rule's findings (that is what a human fix does — you fix
   the root cause, not one occurrence),
2. recomputes the composite from scratch, **including re-evaluating the security cap** (so
   fixing the one injection finding correctly shows the jump from 79 back to the raw score),
3. ranks candidates by composite gain (ties broken by rule ID) and reports the top 3, each
   with its instance count, projected composite, and projected grade.

Fixes with zero or negative gain are omitted.

## Documented defaults

### Exit codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Graded successfully — **plain runs always exit 0, even for an F**               |
| 1    | `assay ci` only: the grade is below the threshold                               |
| 2    | Operational error: unreachable target, invalid config, or an internal assay bug |

Only `assay ci` gates. A plain `assay <target>` is a report, not a judgment call in your
shell's exit status.

### Token counts

All token counts use the **o200k_base** encoding (via js-tiktoken) and are labeled
_approximate_ in reports: every host tokenizes and wraps context slightly differently, so
treat the numbers as a consistent measuring stick, not a promise about any one runtime.

### Budgets

Every numeric threshold is config-overridable. Defaults (from `src/constants.ts`):

| Budget key               | Default | What it bounds                                             | Primary rule |
| ------------------------ | ------- | ---------------------------------------------------------- | ------------ |
| `descriptionMinChars`    | 20      | Minimum skill description length                           | SK101        |
| `descriptionMaxChars`    | 1024    | Maximum skill description length                           | SK102        |
| `skillBodyTokensInfo`    | 2000    | Skill body tokens (info threshold)                         | SK201        |
| `skillBodyTokensWarn`    | 5000    | Skill body tokens (warn threshold)                         | SK202        |
| `skillBodyMaxLines`      | 300     | Skill body lines before it counts as a monolith            | SK203        |
| `skillCodeBlockMaxLines` | 80      | Inline code block size in a skill body                     | SK204        |
| `similarityJaccard`      | 0.6     | Description similarity vs sibling skills                   | SK106        |
| `base64MinLength`        | 200     | Base64-looking blob length worth flagging                  | SK405        |
| `mcpConnectTimeoutMs`    | 15000   | MCP initialize timeout                                     | MCP001       |
| `mcpToolTokensInfo`      | 400     | Per-tool schema tokens (info threshold)                    | MCP201       |
| `mcpToolTokensWarn`      | 800     | Per-tool schema tokens (warn threshold)                    | MCP201       |
| `mcpServerTokensWarn`    | 8000    | Total server context tax in tokens                         | MCP202       |
| `mcpMaxTools`            | 30      | Tool count before the server floods the model's tool space | MCP108       |
| `probeLatencyP95Ms`      | 5000    | p95 tool-call latency under `--probe`                      | MCP402       |
| `ctxTokensInfo`          | 1500    | Context-file tokens (info threshold)                       | CTX001       |
| `ctxTokensWarn`          | 4000    | Context-file tokens (warn threshold)                       | CTX001       |

### Overriding defaults

`assay.config.json` in your working directory (or via `--config <file>`):

```json
{
  "budgets": { "skillBodyTokensWarn": 8000, "mcpMaxTools": 50 },
  "rules": { "SK105": "off", "MCP201": "error" }
}
```

- `"budgets"` replaces individual thresholds; anything you omit keeps its default.
- `"rules"` maps a rule ID to `"off"` or a severity (`"info"` / `"warn"` / `"error"`). A
  severity override wins over a banded rule's per-hit severity.
- The `--rules` flag does the same inline and takes precedence over the config file:
  `assay . --rules SK101=off,MCP201=error`.

## A fully worked example

A hypothetical skill produces five findings:

- 1 × **error** from `SK101` (description too short) — trigger dimension
- 3 × **warn** from `SK205` (boilerplate the model already knows) — token dimension
- 1 × **info** from `SK302` (no validation step) — instruction dimension

**Dimension scores:**

| Dimension           | Findings        | Penalty math                | Score |
| ------------------- | --------------- | --------------------------- | ----- |
| Structure           | none            | —                           | 100   |
| Trigger quality     | 1 error (SK101) | 15 × 1 = 15                 | 85    |
| Token efficiency    | 3 warns (SK205) | 5 × (1 + 0.5 + 0.25) = 8.75 | 91.25 |
| Instruction quality | 1 info (SK302)  | 1 × 1 = 1                   | 99    |
| Security            | none            | —                           | 100   |

**Composite:**

```
100   × 0.15 = 15.00   (structure)
 85   × 0.30 = 25.50   (trigger)
 91.25 × 0.20 = 18.25   (token)
 99   × 0.15 = 14.85   (instruction)
100   × 0.20 = 20.00   (security)
               ─────
composite    = 93.60  →  A   (93.60 ≥ 93)
```

No security errors, so no cap: `composite = compositeRaw = 93.6`.

**Top fixes** (remove all of a rule's findings, rescore, rank by gain):

| Fix   | Rescored composite | Gain  | Projected grade |
| ----- | ------------------ | ----- | --------------- |
| SK101 | 98.10              | +4.50 | A+              |
| SK205 | 95.35              | +1.75 | A               |
| SK302 | 93.75              | +0.15 | A               |

The one trigger error is worth more than all three token warns combined — which is exactly
what the weights are telling you: a skill that never triggers is worthless no matter how lean
its body is.
