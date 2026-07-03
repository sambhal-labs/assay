# Assay Cloud

> Status: **planned** — join the waitlist by reacting 👍 on [issue #15](https://github.com/sambhal-labs/assay/issues/15).

The assay CLI is local, deterministic, and MIT-licensed. That never changes: grading, every rule, the CI gate, the GitHub Action, and the badge are free forever, and the CLI will never require an account.

Assay Cloud is the optional hosted layer for teams — the things a local, stateless CLI structurally can't do:

|                   | The CLI (free forever)       | Assay Cloud (planned, paid for private repos)          |
| ----------------- | ---------------------------- | ------------------------------------------------------ |
| Grade an artifact | ✅                           | ✅ same engine, same grades                            |
| Gate a PR in CI   | ✅ exit codes + Action       | ✅ plus sticky PR comments with grade deltas (B+ → A−) |
| Grade **history** | ❌ stateless by design       | 📈 trends over time, across every repo in the org      |
| Org-wide policy   | per-repo `assay.config.json` | 🏢 one policy, every repo, drift alerts                |
| Regressions       | you notice, or you don't     | 🚨 alerts when any artifact drops below threshold      |
| `assay fix`       | BYOK (your API key)          | 🤖 managed remediation, no key juggling                |

Principles, stated up front:

- **The grades are identical.** Cloud runs the same open-source engine — it adds memory and multiplayer, never a different (or paywalled) verdict.
- **Public/OSS repos: free.** The paid tier is for private repos and org features.
- **No lock-in.** Everything Cloud stores is exportable as the same `schemaVersion` JSON the CLI already emits.

Feedback on this scope is exactly what [the waitlist issue](https://github.com/sambhal-labs/assay/issues/15) is for.
