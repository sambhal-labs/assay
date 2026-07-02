import { PRICE_SNAPSHOT } from '../../constants.js';
import type { Artifact, McpArtifact, Rule, RuleHit } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asMcp = (a: Artifact): McpArtifact => a as McpArtifact;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const MAX_WALK_DEPTH = 64;

/** Deepest nesting of anyOf/oneOf combinators anywhere in the schema. */
function maxCombinatorDepth(node: unknown, guard = 0): number {
  if (guard > MAX_WALK_DEPTH || typeof node !== 'object' || node === null) return 0;
  let max = 0;
  if (Array.isArray(node)) {
    for (const item of node) max = Math.max(max, maxCombinatorDepth(item, guard + 1));
    return max;
  }
  for (const [key, value] of Object.entries(node)) {
    const child = maxCombinatorDepth(value, guard + 1);
    const isCombinator = (key === 'anyOf' || key === 'oneOf') && Array.isArray(value);
    max = Math.max(max, isCombinator ? child + 1 : child);
  }
  return max;
}

/** Property names whose "title" merely repeats the property name. */
function collectDuplicateTitles(node: unknown, out: string[], guard = 0): void {
  if (guard > MAX_WALK_DEPTH || typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectDuplicateTitles(item, out, guard + 1);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isPlainObject(value)) {
      for (const [propName, propSchema] of Object.entries(value)) {
        if (
          isPlainObject(propSchema) &&
          typeof propSchema.title === 'string' &&
          propSchema.title.trim().toLowerCase() === propName.trim().toLowerCase()
        ) {
          out.push(propName);
        }
        collectDuplicateTitles(propSchema, out, guard + 1);
      }
    } else {
      collectDuplicateTitles(value, out, guard + 1);
    }
  }
}

export const tokenRules: Rule[] = [
  {
    meta: {
      id: 'MCP201',
      title: 'Per-tool token cost over budget',
      severity: 'info', // banded: hits carry info or warn per threshold crossed
      dimension: 'token',
      appliesTo: ['mcp-server'],
      fixHint:
        'Trim the description and schema to what the model needs to choose and call the tool.',
      docs: 'Every tool definition is re-sent in model context on every conversation turn that exposes the server. A single bloated tool taxes all of them; budgets bound what one tool may cost before it needs a trim.',
    },
    check: (artifact, config) => {
      const { mcpToolTokensInfo, mcpToolTokensWarn } = config.budgets;
      const hits: RuleHit[] = [];
      for (const tool of asMcp(artifact).tools) {
        if (tool.tokens <= mcpToolTokensInfo) continue;
        const severity = tool.tokens > mcpToolTokensWarn ? 'warn' : 'info';
        hits.push({
          severity,
          message: `tool "${tool.name}" costs ~${tool.tokens} tokens in the catalog (info > ${mcpToolTokensInfo}, warn > ${mcpToolTokensWarn})`,
          location: { toolName: tool.name },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP202',
      title: 'Total server context tax over budget',
      severity: 'warn',
      dimension: 'token',
      appliesTo: ['mcp-server'],
      fixHint: 'Cut catalog size: shorter descriptions, leaner schemas, fewer always-on tools.',
      docs: "The whole tool catalog rides along in every conversation that connects the server — a context tax paid before the user types a word. The dollar translation uses assay's bundled price snapshot to make the tax concrete.",
    },
    check: (artifact, config) => {
      const total = asMcp(artifact).tokens.total;
      const budget = config.budgets.mcpServerTokensWarn;
      if (total <= budget) return [];
      const usdPerThousandConversations = (total / 1e6) * PRICE_SNAPSHOT.inputUSDPerMTok * 1000;
      return [
        {
          message:
            `tool catalog totals ~${total} tokens (budget: ${budget}) ` +
            `≈ $${usdPerThousandConversations.toFixed(2)} per 1,000 conversations at ` +
            `$${PRICE_SNAPSHOT.inputUSDPerMTok}/MTok input (${PRICE_SNAPSHOT.model}, snapshot ${PRICE_SNAPSHOT.date})`,
        },
      ];
    },
  },
  {
    meta: {
      id: 'MCP203',
      title: 'Verbose JSON-Schema anti-patterns',
      severity: 'info',
      dimension: 'token',
      appliesTo: ['mcp-server'],
      fixHint: 'Flatten nested anyOf/oneOf unions and drop titles that repeat the property name.',
      docs: 'Deeply nested anyOf/oneOf unions and titles that repeat the property name add tokens without adding information the model can use. They usually come from mechanical schema generation and flatten losslessly.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of asMcp(artifact).tools) {
        if (!tool.inputSchema) continue;
        const parts: string[] = [];
        const depth = maxCombinatorDepth(tool.inputSchema);
        if (depth >= 3) parts.push(`anyOf/oneOf nested ${depth} levels deep`);
        const dupTitles: string[] = [];
        collectDuplicateTitles(tool.inputSchema, dupTitles);
        if (dupTitles.length > 0) {
          const shown = dupTitles.slice(0, 3).join(', ');
          const more = dupTitles.length > 3 ? `, +${dupTitles.length - 3} more` : '';
          parts.push(
            `${dupTitles.length} property title(s) duplicating the property name (${shown}${more})`,
          );
        }
        if (parts.length === 0) continue;
        hits.push({
          message: `tool "${tool.name}" schema has verbose patterns: ${parts.join('; ')}`,
          location: { toolName: tool.name },
        });
      }
      return hits;
    },
  },
];
