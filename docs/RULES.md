<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Regenerate with: npm run gen:docs
  Source of truth: rule metadata in src/rules/**
-->

# Assay rules

56 built-in rules. Severities and thresholds shown are defaults; both are
overridable via `assay.config.json` ("rules", "budgets") or the `--rules` flag.
Scoring math: [GRADING.md](GRADING.md).

## Skills (SK)

### Dimension: Structure

#### SK001 — SKILL.md missing or unreadable

**Severity:** error · **Dimension:** Structure

A skill is defined by its SKILL.md. Without one, no host can load the skill at all — every other check is moot.

**Fix:** Create a SKILL.md with YAML frontmatter (name, description) at the skill root.

#### SK002 — Frontmatter missing, invalid, or incomplete

**Severity:** error · **Dimension:** Structure

Hosts route skills by the frontmatter name and description. Missing or unparseable frontmatter means the skill can never be selected.

**Fix:** Start SKILL.md with a YAML frontmatter block declaring name and description.

#### SK003 — Skill name malformed or mismatched

**Severity:** warn · **Dimension:** Structure

Hosts key skills by name. A name that is not kebab-case, exceeds 64 characters, or differs from the directory basename breaks lookup conventions and confuses discovery tooling.

**Fix:** Rename the skill to a kebab-case name (max 64 chars) that matches its directory.

#### SK004 — Unknown frontmatter keys

**Severity:** info · **Dimension:** Structure

Keys outside the commonly recognized set (name, description, version, license, metadata, allowed-tools, compatibility) are surfaced for review, not judged — ecosystems vary, but typos in key names silently drop metadata.

**Fix:** Confirm the key is meaningful to your host, or remove it.

#### SK005 — Dead relative link

**Severity:** warn · **Dimension:** Structure

SKILL.md links to companion files the model is expected to open on demand. A link whose target does not exist on disk sends the model on a dead end at exactly the moment it needs detail.

**Fix:** Fix the link target or add the missing companion file.

#### SK006 — Absolute local filesystem path

**Severity:** warn · **Dimension:** Structure

Paths like /Users/alice/… or C:\projects\… only resolve on the author’s machine. Skills travel between machines and hosts, so instructions must use relative paths. URLs are never flagged.

**Fix:** Replace the absolute path with a path relative to the skill directory.

### Dimension: Trigger quality

#### SK101 — Description too short or placeholder

**Severity:** error · **Dimension:** Trigger quality

The description is the only signal a host has when deciding whether to load a skill. A stub like "TODO" or a description shorter than the configured minimum means the skill effectively cannot be routed to.

**Fix:** Write a real description: what the skill does and when to use it.

#### SK102 — Description too long

**Severity:** warn · **Dimension:** Trigger quality

Every skill description is loaded into context on every turn, whether or not the skill is used. Descriptions past the budget crowd out the very routing signal they exist to provide.

**Fix:** Trim the description to the essentials; move detail into the body.

#### SK103 — No usage guidance in description

**Severity:** warn · **Dimension:** Trigger quality

Descriptions that only say what a skill is — without "use when", "for tasks", or similar phrasing — leave the host guessing about when to invoke it. Explicit trigger conditions measurably improve routing.

**Fix:** Add a "Use when …" clause describing the requests that should route here.

#### SK104 — Description lacks concrete action verbs

**Severity:** warn · **Dimension:** Trigger quality

Hosts match user requests against verbs. A description reading like a table of contents ("PDF utilities and helpers") gives the router nothing to match; naming at least two concrete operations does.

**Fix:** Name the concrete operations the skill performs (e.g. "extract, convert, validate").

#### SK105 — First-person description

**Severity:** info · **Dimension:** Trigger quality

Routers compare descriptions against user requests, which are phrased about tasks, not about the assistant. Third-person, capability-centric descriptions match better than "I can help with…".

**Fix:** Rewrite the description in third person ("Converts…", not "I can convert…").

#### SK106 — Description collides with a sibling skill

**Severity:** warn · **Dimension:** Trigger quality

Two skills in the same repo with near-identical descriptions force the router to pick one arbitrarily. Checked only in repo mode, where sibling descriptions are available.

**Fix:** Differentiate the two descriptions or merge the overlapping skills.

### Dimension: Token efficiency

#### SK201 — Body approaching token budget

**Severity:** info · **Dimension:** Token efficiency

The whole SKILL.md body enters context when the skill activates. Past the info budget the skill still works but is trending toward the hard warning threshold — worth splitting before it gets there.

**Fix:** Move reference detail into companion files loaded on demand.

#### SK202 — Body over token budget

**Severity:** warn · **Dimension:** Token efficiency

Progressive disclosure is the core design rule for skills: a lean always-loaded body, with depth in companion files opened on demand. A body past the warn budget taxes every activation with tokens the model rarely needs.

**Fix:** Split the body: keep the workflow in SKILL.md, push detail to linked files.

#### SK203 — Monolithic body with no companion files

**Severity:** warn · **Dimension:** Token efficiency

A long body that links to zero companion files is a monolith: every detail is paid for on every activation. Long skills should keep SKILL.md as the map and put the territory in linked files.

**Fix:** Extract reference material into companion files and link them from the body.

#### SK204 — Oversized inline code block

**Severity:** info · **Dimension:** Token efficiency

Long inline code blocks are usually reference material, not workflow. Shipping them as companion files keeps the always-loaded body lean without losing the code.

**Fix:** Move the code block into a companion script or reference file.

#### SK205 — Section teaches what the model already knows

**Severity:** warn · **Dimension:** Token efficiency

Sections like "What is Git" or "Installing Python" spend tokens re-teaching material the model already has. Detection is heading-based with a deliberately tight lexicon, so ordinary domain sections are never flagged.

**Fix:** Delete the tutorial section — the model already knows the basics.

### Dimension: Instruction quality

#### SK301 — No step structure

**Severity:** warn · **Dimension:** Instruction quality

Models follow procedures far more reliably when they are ordered steps ("1. Inspect the form") than when buried in descriptive prose. A body with neither an ordered list nor imperative lines reads as documentation, not instructions.

**Fix:** Restructure the workflow as numbered steps with imperative verbs.

#### SK302 — No verification step

**Severity:** info · **Dimension:** Instruction quality

Skills that never ask the model to verify, check, or validate its output produce confident wrong answers. One verification step catches most of them.

**Fix:** Add a step that verifies the output before declaring success.

#### SK303 — No failure-path guidance

**Severity:** info · **Dimension:** Instruction quality

Real runs hit failures. Without "if X fails…" guidance the model improvises its own recovery, which is where skills go off the rails. Even one fallback sentence anchors the failure path.

**Fix:** Describe what to do when a step fails (fallback, error handling, escalation).

#### SK304 — Contradictory absolute modifiers

**Severity:** warn · **Dimension:** Instruction quality

When one line says "always X" and another says "never X", the model obeys whichever it read last — nondeterministically. Absolute modifiers must not overlap on the same object.

**Fix:** Resolve the contradiction: keep one rule or scope each to its context.

### Dimension: Security

#### SK401 — Prompt-injection phrasing

**Severity:** error · **Dimension:** Security · **Security cap** — an error from this rule pins the composite at C+

Phrases like "ignore previous instructions" or "do not tell the user" are the signature of tool poisoning: content addressed to the model rather than describing the task. Detection is lexical and documented as such.

**Fix:** Remove the instruction — skills must never override the host or hide from the user.

#### SK402 — Hidden or obfuscating Unicode

**Severity:** error · **Dimension:** Security · **Security cap** — an error from this rule pins the composite at C+

Zero-width characters, bidi controls, and Unicode tag-block codepoints render as nothing while carrying instructions to the model — the canonical payload-smuggling channel. Legitimate non-ASCII prose is never flagged.

**Fix:** Delete the invisible characters — legitimate instructions never need them.

#### SK403 — Secret-shaped string

**Severity:** error · **Dimension:** Security · **Security cap** — an error from this rule pins the composite at C+

A skill is copied, shared, and committed — any embedded credential shape (AWS keys, GitHub tokens, API keys, private key blocks) is either a live leak or a pattern that teaches users to hardcode secrets. Matches are redacted in reports.

**Fix:** Remove the credential and rotate it; reference secrets via environment variables.

#### SK404 — Fetch-and-execute instruction

**Severity:** warn · **Dimension:** Security

Instructions like "curl … | sh" make the model execute whatever a remote server serves at run time — content the skill author no longer controls and the user never reviews.

**Fix:** Pin and ship the script with the skill instead of piping a download into a shell.

#### SK405 — Base64 blob in instructions

**Severity:** warn · **Dimension:** Security

Long base64 runs in instructions are unreviewable payloads: neither the user nor a code reviewer can see what the model is being told to decode and act on.

**Fix:** Replace the encoded blob with plaintext content or a reviewable companion file.

#### SK406 — Link to non-major external domain

**Severity:** info · **Dimension:** Security

URLs outside a short list of major domains are surfaced for review, not judged — most are fine, but an unfamiliar domain in agent instructions is exactly what a human should glance at once.

**Fix:** Confirm the domain is intentional and trustworthy before shipping the skill.

## MCP servers (MCP)

### Dimension: Token efficiency

#### MCP201 — Per-tool token cost over budget

**Severity:** info · **Dimension:** Token efficiency

Every tool definition is re-sent in model context on every conversation turn that exposes the server. A single bloated tool taxes all of them; budgets bound what one tool may cost before it needs a trim.

**Fix:** Trim the description and schema to what the model needs to choose and call the tool.

#### MCP202 — Total server context tax over budget

**Severity:** warn · **Dimension:** Token efficiency

The whole tool catalog rides along in every conversation that connects the server — a context tax paid before the user types a word. The dollar translation uses assay's bundled price snapshot to make the tax concrete.

**Fix:** Cut catalog size: shorter descriptions, leaner schemas, fewer always-on tools.

#### MCP203 — Verbose JSON-Schema anti-patterns

**Severity:** info · **Dimension:** Token efficiency

Deeply nested anyOf/oneOf unions and titles that repeat the property name add tokens without adding information the model can use. They usually come from mechanical schema generation and flatten losslessly.

**Fix:** Flatten nested anyOf/oneOf unions and drop titles that repeat the property name.

### Dimension: Security

#### MCP301 — Injection phrases in tool metadata

**Severity:** error · **Dimension:** Security · **Security cap** — an error from this rule pins the composite at C+

Tool descriptions are injected verbatim into the model context of every connected host, making them the canonical tool-poisoning channel: "ignore previous instructions", "do not tell the user", pseudo-system tags. Any such phrase in tool or parameter descriptions is treated as hostile.

**Fix:** Delete the instruction-to-the-model from the tool metadata — descriptions document, they do not command.

#### MCP302 — Hidden Unicode in tool metadata

**Severity:** error · **Dimension:** Security · **Security cap** — an error from this rule pins the composite at C+

Zero-width characters, bidi controls, and Unicode tag-block codepoints in tool names, descriptions, or schemas render as nothing in a host UI while still reaching the model — the invisible half of a tool-poisoning payload. Legitimate non-ASCII text is never flagged.

**Fix:** Delete the invisible characters — legitimate tool metadata never needs them.

#### MCP303 — Cross-tool steering in description

**Severity:** warn · **Dimension:** Security

A description that tells the model to call this tool before or instead of others is hijacking tool selection — the shadowing pattern used to intercept data meant for legitimate tools. Ordering is host policy, never tool metadata.

**Fix:** Describe what the tool does; let the host decide tool ordering.

#### MCP304 — References credential files or secrets stores

**Severity:** warn · **Dimension:** Security

A weather tool whose description mentions ~/.ssh or your .env file is describing exfiltration, not weather. Tools whose own names declare a credential-management purpose (auth/key/secret/cred/env) are exempt.

**Fix:** Remove references to key and credential material the tool has no business touching.

#### MCP305 — Tool name near a well-known tool (typosquat surface)

**Severity:** info · **Dimension:** Security

A tool named web_serch sits one keystroke from web_search: models mis-route calls to it and reviewers misread it — the same squatting surface as package-name typos. Near-misses against a bundled well-known-tool list or between two tools on the same server are flagged; exact matches are fine.

**Fix:** Rename the tool so it is clearly distinct from well-known tools and its siblings.

### Dimension: Protocol compliance

#### MCP001 — Server fails MCP initialization

**Severity:** error · **Dimension:** Protocol compliance

The initialize handshake is the front door of the protocol: a server that is reachable but cannot negotiate a session is invisible to every MCP host. Nothing else about the server can be trusted until this passes.

**Fix:** Make the server complete the MCP initialize handshake before anything else.

#### MCP002 — tools/list fails or returns malformed entries

**Severity:** error · **Dimension:** Protocol compliance

tools/list is how hosts discover what a server can do. A failing call or an entry without a valid name/inputSchema shape is dropped (or worse, crashes the host loop), so those tools effectively do not exist.

**Fix:** Return spec-shaped tool entries (non-empty string name, object inputSchema) from tools/list.

#### MCP003 — Protocol version or capabilities incomplete

**Severity:** warn · **Dimension:** Protocol compliance

Hosts gate features (tools, resources, notifications) on the capabilities the server declares during initialize. A server that omits its protocol version or declares no capabilities forces hosts to guess, which usually means features silently disabled.

**Fix:** Report a protocol version and a non-empty capabilities object during initialize.

#### MCP004 — Deprecated SSE transport endpoint

**Severity:** info · **Dimension:** Protocol compliance

HTTP+SSE was deprecated in favor of streamable HTTP; an endpoint path ending in /sse signals a server built on the legacy transport, which newer hosts are dropping support for.

**Fix:** Migrate the endpoint to the streamable HTTP transport (spec 2025-03-26 or later).

### Dimension: Definition quality

#### MCP101 — Tool has no description

**Severity:** error · **Dimension:** Definition quality

Missing tool descriptions are ToolBench's #1 observed defect in real-world tool catalogs: the model has nothing but the name to decide whether to call the tool, so selection accuracy collapses. A tool without a description is effectively unusable by an agent.

**Fix:** Write a description stating what the tool does and when the model should call it.

#### MCP102 — Tool description too short or generic

**Severity:** warn · **Dimension:** Definition quality

A description that merely restates the tool name ("read_file: reads a file") or is placeholder text gives the model no basis for choosing between similar tools. Descriptions should state purpose and the situations that call for the tool.

**Fix:** Describe what the tool does and when to use it, not just restate its name.

#### MCP103 — Input schema empty while description implies parameters

**Severity:** error · **Dimension:** Definition quality

When a description says the tool "takes a path" but the schema declares nothing, the model either cannot pass arguments at all or invents unvalidated ones. The schema is the calling contract — prose is not.

**Fix:** Declare the implied parameters as properties of a type:"object" inputSchema.

#### MCP104 — Parameters missing descriptions

**Severity:** warn · **Dimension:** Definition quality

Undescribed parameters force the model to guess argument semantics from the name alone — the top source of malformed tool calls. Every property should say what the value means, its format, and its default.

**Fix:** Add a description to every schema property saying what the value means and its format.

#### MCP105 — Enum described in prose instead of schema

**Severity:** warn · **Dimension:** Definition quality

A description like "must be one of: fast, slow" is a soft constraint the model will eventually violate; an enum array is validated by every host and shown in structured form. Prose enums are the schema equivalent of a comment instead of a type.

**Fix:** Move the allowed values from the description prose into an enum array on the property.

#### MCP106 — No required array despite mandatory-sounding parameters

**Severity:** warn · **Dimension:** Definition quality

If the description says a parameter must be provided but the schema marks nothing required, hosts will happily send calls without it and the failure surfaces at runtime instead of validation time.

**Fix:** List the mandatory parameters in the schema "required" array.

#### MCP107 — Tool name style, length, or collision

**Severity:** info · **Dimension:** Definition quality

Models tokenize and match tool names; unconventional casing, very long names, and names that collide once separators and case are stripped all measurably hurt selection. snake_case and kebab-case are the de-facto conventions across hosts.

**Fix:** Use short snake_case or kebab-case names that stay distinct after normalization.

#### MCP108 — Too many tools for reliable selection

**Severity:** warn · **Dimension:** Definition quality

Tool-selection accuracy degrades as the catalog grows: every extra tool is another distractor in the model context. Servers past the budget should be split by domain or expose a smaller routed surface.

**Fix:** Split the catalog into focused servers or namespace tools behind fewer entry points.

### Dimension: Reliability

#### MCP401 — Tool call fails at the protocol level

**Severity:** warn · **Dimension:** Reliability

The probe calls each tool with minimal arguments that satisfy the tool's own advertised inputSchema. A protocol-level failure on such a call (a JSON-RPC error, a timeout, or a reply that violates the MCP result shape) means the contract the server publishes is not the contract it enforces — hosts retry, mis-handle, or drop the tool entirely. Expected failures belong in a structured tool-level error result, not at the protocol layer.

**Fix:** Handle any input the advertised inputSchema admits; report tool failures as an isError result, never a protocol error.

#### MCP402 — Probe p95 latency over budget

**Severity:** info · **Dimension:** Reliability

Agents call tools in loops, and every slow call multiplies across a session while the host (and the user) waits. The p95 across probed calls is compared against budgets.probeLatencyP95Ms; one slow outlier is fine, a slow 95th percentile is the server, not the network.

**Fix:** Cut cold-start and per-call overhead, or raise budgets.probeLatencyP95Ms if slow calls are inherent to the domain.

#### MCP403 — Error responses lack machine-readable structure

**Severity:** warn · **Dimension:** Reliability

When a tool fails, the model reads the error and decides what to do next: retry, change arguments, or give up. A bare text blob — typically a stack trace — gives it nothing to reason over and often leaks implementation detail. A machine-readable error (JSON with a code/message, or multiple typed content items) turns failures into something an agent can actually recover from.

**Fix:** Return errors as structured content (e.g. a JSON body with a code and message) instead of a bare prose or stack-trace string.

## Context files (CTX)

### Dimension: Quality

#### CTX001 — Context file exceeds its token budget

**Severity:** info · **Dimension:** Quality

A context file is prepended to every conversation an agent has in the repo, so its token count is a per-conversation tax paid before any work begins. Banded: info above the soft budget, warn above the hard budget.

**Fix:** Trim the file to durable project-specific facts and move reference material into linked docs.

#### CTX002 — References files that do not exist

**Severity:** warn · **Dimension:** Quality

A context file that points at paths which no longer exist is stale documentation: the agent wastes turns hunting for missing files or, worse, recreates them. Only conservatively-matched path references are checked, so every hit is a real broken pointer.

**Fix:** Update the path to the file’s current location or delete the stale reference.

#### CTX003 — References commands the project does not define

**Severity:** warn · **Dimension:** Quality

Telling the agent to run a script that package.json, the Makefile, or the justfile does not define sends it down a failing path on its very first action. Commands are only flagged when the corresponding manifest exists and provably lacks the target.

**Fix:** Fix the command name or add the missing script to the project manifest.

#### CTX004 — Contradictory absolute rules

**Severity:** warn · **Dimension:** Quality

When one line says "always X" and another says "never X", the agent cannot satisfy both and will pick one unpredictably — usually the one closest to the end of the file. Objects are compared by normalized token prefix, so only genuinely opposing pairs are flagged.

**Fix:** Keep whichever rule is correct and delete the contradicting one.

#### CTX005 — Generic filler sections

**Severity:** info · **Dimension:** Quality

Sections like "What is React" or "Git basics" restate training data: they cost tokens on every conversation and teach the model nothing. Context files should carry only what is specific to this project.

**Fix:** Delete the section — the model already knows this background.

#### CTX006 — Injection phrases, hidden Unicode, or secrets

**Severity:** error · **Dimension:** Quality · **Security cap** — an error from this rule pins the composite at C+ · **Penalty multiplier:** ×2

A context file is injected into every conversation, which makes it the highest-leverage place to hide prompt-injection phrases, invisible Unicode payloads, or leaked credentials. Any hit is weighted double (penaltyMultiplier 2) and caps the composite at C+ — the spec’s "security errors weighted x2".

**Fix:** Remove the injected instruction, hidden character, or secret from the file.
