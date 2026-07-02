import type { Artifact, McpArtifact, McpToolInfo, Rule, RuleHit } from '../../core/types.js';
import { findInjectionPhrases } from '../shared/injection.js';
import { findHiddenUnicode } from '../shared/unicode.js';
import { levenshtein } from '../../util/text.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asMcp = (a: Artifact): McpArtifact => a as McpArtifact;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** [label, description] pairs: the tool description plus each parameter description. */
function describedTexts(tool: McpToolInfo): Array<[label: string, text: string]> {
  const texts: Array<[string, string]> = [];
  if (tool.description) texts.push(['description', tool.description]);
  const props = tool.inputSchema?.properties;
  if (isPlainObject(props)) {
    for (const [paramName, prop] of Object.entries(props)) {
      if (isPlainObject(prop) && typeof prop.description === 'string' && prop.description) {
        texts.push([`parameter "${paramName}" description`, prop.description]);
      }
    }
  }
  return texts;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STEERING_PATTERNS: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['use-this-first', /\buse\s+this\s+(?:tool\s+)?(?:before|instead|first)\b/i],
  ['before-any-other-tool', /\bbefore\s+(?:using|calling|invoking)\s+any\s+other\s+tool\b/i],
  ['always-call-first', /\b(?:always\s+)?call\s+this\s+(?:tool\s+)?first\b/i],
  [
    'instead-of-other-tools',
    /\binstead\s+of\s+(?:using\s+|calling\s+)?(?:any\s+)?other\s+tools?\b/i,
  ],
];

const PRECEDENCE_RE = /\b(?:before|instead\s+of|first|prior\s+to|rather\s+than)\b/i;

const SENSITIVE_LEXICON: ReadonlyArray<readonly [label: string, re: RegExp]> = [
  ['~/.ssh', /(?:~|\$HOME)?\/?\.ssh\b/i],
  ['id_rsa', /\bid_rsa\b/i],
  ['.env', /(?:^|[\s"'`(/])\.env\b/i],
  ['credentials', /\bcredentials?\b/i],
  ['keychain', /\bkeychain\b/i],
  ['.aws/', /\.aws\//i],
  ['/etc/passwd', /\/etc\/passwd\b/i],
  ['private key', /\bprivate\s+key\b/i],
];

/** Tools whose own purpose is credential handling get a pass from MCP304. */
const CREDENTIAL_PURPOSE_RE = /auth|key|secret|cred|env/i;

/**
 * Names agents already know from popular servers. Being *near* one of these
 * (without matching it) is the classic typosquat/impersonation surface.
 */
const WELL_KNOWN_TOOLS: readonly string[] = [
  'read_file',
  'write_file',
  'edit_file',
  'list_files',
  'list_directory',
  'create_file',
  'delete_file',
  'move_file',
  'search',
  'web_search',
  'fetch',
  'http_request',
  'execute_command',
  'run_command',
  'bash',
  'create_issue',
  'create_pull_request',
  'send_message',
  'send_email',
  'query_database',
  'get_weather',
  'take_screenshot',
  'browser_navigate',
];

const MIN_TYPOSQUAT_NAME_LENGTH = 6;
const MAX_TYPOSQUAT_DISTANCE = 2;

export const securityRules: Rule[] = [
  {
    meta: {
      id: 'MCP301',
      title: 'Injection phrases in tool metadata',
      severity: 'error',
      dimension: 'security',
      appliesTo: ['mcp-server'],
      fixHint:
        'Delete the instruction-to-the-model from the tool metadata — descriptions document, they do not command.',
      docs: 'Tool descriptions are injected verbatim into the model context of every connected host, making them the canonical tool-poisoning channel: "ignore previous instructions", "do not tell the user", pseudo-system tags. Any such phrase in tool or parameter descriptions is treated as hostile.',
      securityCap: true,
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of asMcp(artifact).tools) {
        for (const [label, text] of describedTexts(tool)) {
          for (const phrase of findInjectionPhrases(text)) {
            hits.push({
              message: `injection phrase (${phrase.pattern}) in tool "${tool.name}" ${label}: "${phrase.match}"`,
              location: { toolName: tool.name },
            });
          }
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP302',
      title: 'Hidden Unicode in tool metadata',
      severity: 'error',
      dimension: 'security',
      appliesTo: ['mcp-server'],
      fixHint: 'Delete the invisible characters — legitimate tool metadata never needs them.',
      docs: 'Zero-width characters, bidi controls, and Unicode tag-block codepoints in tool names, descriptions, or schemas render as nothing in a host UI while still reaching the model — the invisible half of a tool-poisoning payload. Legitimate non-ASCII text is never flagged.',
      securityCap: true,
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of asMcp(artifact).tools) {
        const surfaces: Array<[string, string]> = [
          ['name', tool.name],
          ['description', tool.description ?? ''],
          ['schema', tool.inputSchema ? JSON.stringify(tool.inputSchema) : ''],
        ];
        for (const [where, text] of surfaces) {
          for (const hit of findHiddenUnicode(text)) {
            hits.push({
              message: `hidden ${hit.kind} character ${hit.label} in tool "${tool.name}" ${where}`,
              location: { toolName: tool.name },
            });
          }
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP303',
      title: 'Cross-tool steering in description',
      severity: 'warn',
      dimension: 'security',
      appliesTo: ['mcp-server'],
      fixHint: 'Describe what the tool does; let the host decide tool ordering.',
      docs: 'A description that tells the model to call this tool before or instead of others is hijacking tool selection — the shadowing pattern used to intercept data meant for legitimate tools. Ordering is host policy, never tool metadata.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      const hits: RuleHit[] = [];
      for (const tool of mcp.tools) {
        const desc = tool.description;
        if (!desc) continue;
        for (const [label, re] of STEERING_PATTERNS) {
          const match = desc.match(re);
          if (match) {
            hits.push({
              message: `tool "${tool.name}" description steers tool selection (${label}): "${match[0]}"`,
              location: { toolName: tool.name },
            });
          }
        }
        if (!PRECEDENCE_RE.test(desc)) continue;
        for (const other of mcp.tools) {
          if (other === tool || !other.entryValid || other.name.length < 4) continue;
          if (new RegExp(`\\b${escapeRegExp(other.name)}\\b`, 'i').test(desc)) {
            hits.push({
              message: `tool "${tool.name}" description names sibling tool "${other.name}" with precedence language`,
              location: { toolName: tool.name },
            });
          }
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP304',
      title: 'References credential files or secrets stores',
      severity: 'warn',
      dimension: 'security',
      appliesTo: ['mcp-server'],
      fixHint:
        'Remove references to key and credential material the tool has no business touching.',
      docs: 'A weather tool whose description mentions ~/.ssh or your .env file is describing exfiltration, not weather. Tools whose own names declare a credential-management purpose (auth/key/secret/cred/env) are exempt.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of asMcp(artifact).tools) {
        if (!tool.description || CREDENTIAL_PURPOSE_RE.test(tool.name)) continue;
        for (const [label, re] of SENSITIVE_LEXICON) {
          if (re.test(tool.description)) {
            hits.push({
              message: `tool "${tool.name}" description references ${label} — unrelated to its stated purpose`,
              location: { toolName: tool.name },
            });
          }
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP305',
      title: 'Tool name near a well-known tool (typosquat surface)',
      severity: 'info',
      dimension: 'security',
      appliesTo: ['mcp-server'],
      fixHint: 'Rename the tool so it is clearly distinct from well-known tools and its siblings.',
      docs: 'A tool named web_serch sits one keystroke from web_search: models mis-route calls to it and reviewers misread it — the same squatting surface as package-name typos. Near-misses against a bundled well-known-tool list or between two tools on the same server are flagged; exact matches are fine.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      const hits: RuleHit[] = [];
      const candidates = mcp.tools.filter(
        (t) => t.entryValid && t.name.length >= MIN_TYPOSQUAT_NAME_LENGTH,
      );
      for (const tool of candidates) {
        const name = tool.name.toLowerCase();
        if (WELL_KNOWN_TOOLS.includes(name)) continue;
        let closest: { known: string; distance: number } | null = null;
        for (const known of WELL_KNOWN_TOOLS) {
          const distance = levenshtein(name, known);
          if (distance >= 1 && distance <= MAX_TYPOSQUAT_DISTANCE) {
            if (!closest || distance < closest.distance) closest = { known, distance };
          }
        }
        if (closest) {
          hits.push({
            message: `tool name "${tool.name}" is edit distance ${closest.distance} from well-known tool "${closest.known}" — impersonation/typosquat surface`,
            location: { toolName: tool.name },
          });
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i]!;
          const b = candidates[j]!;
          const distance = levenshtein(a.name.toLowerCase(), b.name.toLowerCase());
          if (distance >= 1 && distance <= MAX_TYPOSQUAT_DISTANCE) {
            hits.push({
              message: `tool names "${a.name}" and "${b.name}" are edit distance ${distance} apart — easily confused with each other`,
              location: { toolName: b.name },
            });
          }
        }
      }
      return hits;
    },
  },
];
