# Launch notes — Assay v0.1.0

Internal playbook for launch day. Not linked from the README.

## Show HN

Title options (pick one; plain, no superlatives — HN strips editorializing anyway):

1. `Show HN: Assay – Lighthouse for AI agent context (skills, MCP servers, CLAUDE.md)`
2. `Show HN: Assay – Deterministic letter grades for agent skills and MCP servers`

Option 1 leads with the familiar mental model (Lighthouse); option 2 leads with the grading
angle and the determinism claim. Prefer option 1 unless the front page already has a
"Lighthouse for X" post that week.

First comment (post immediately, from the submitting account): what it is in two sentences,
why deterministic-not-LLM-judged, the security-cap rationale, a link to docs/GRADING.md, and
an explicit ask for rule disputes ("if you think a rule is wrong, the rule table is the
contract — open an issue").

## Launch window

- **Tue–Thu, 14:30–16:30 IST** (morning US-East). Avoid Monday (news pile-up) and Friday
  (dead afternoon in the US).
- Reply to **every** comment in hour one — HN ranking is engagement-sensitive early, and
  unanswered skepticism about grading math is the biggest risk. GRADING.md exists precisely
  so replies can be a link plus one sentence.
- Have `npm run gen:docs` output (docs/RULES.md) committed and rendering on GitHub before
  the post goes up.

## Same-day posts

One per community, adapted — do not cross-post identical text:

- **r/ClaudeAI** — angle: grade your CLAUDE.md and skills before you ship them; show a
  before/after grade on a public skill.
- **r/mcp** — angle: definition-quality findings on real servers (missing parameter
  descriptions are the most common defect); mention `--probe` reliability checks.
- **r/LocalLLaMA** — angle: **fully local, no accounts, BYOK** for the optional eval tier;
  the static core makes zero network calls.

## X thread outline

1. Hook + the hero GIF (one command → letter grade → top fixes).
2. Grade of a well-known public skill (good grade — show the tool being fair).
3. Grade of a popular MCP server (mediocre grade — show the findings being specific).
4. Grade of a real-world CLAUDE.md (show the token-budget and dead-reference findings).
5. The security cap: why an injectable A-grade artifact is a lie, with the C+ screenshot.
6. Deterministic math, MIT, no accounts — link to repo + GRADING.md.

Three public grades minimum; every screenshot must show rule IDs so readers can look up why.

## Day 2 content

"**We ran Assay on N public skills/servers**" gist:

- Corpus: top skills from public skill repos + most-installed MCP servers (document the
  selection method in the gist so it's reproducible).
- Report: grade distribution, the five most common rule hits with counts, and the single
  worst security finding class (anonymized — link rules, don't shame maintainers by name
  unless the finding is already public).
- Publish as a gist, post as a follow-up comment on the HN thread and as its own r/mcp post.
- This doubles as a regression corpus for future rule changes.
