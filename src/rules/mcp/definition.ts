import type { Artifact, McpArtifact, McpToolInfo, Rule, RuleHit } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asMcp = (a: Artifact): McpArtifact => a as McpArtifact;

/** Tools that passed shape validation — malformed entries are MCP002's job. */
const validTools = (mcp: McpArtifact): McpToolInfo[] => mcp.tools.filter((t) => t.entryValid);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** inputSchema.properties when it is a usable object, else null. */
function schemaProperties(tool: McpToolInfo): Record<string, unknown> | null {
  const props = tool.inputSchema?.properties;
  return isPlainObject(props) ? props : null;
}

/** Lowercase and strip separators: "Read-File" and "read_file" collide. */
const normalizeName = (name: string): string => name.toLowerCase().replace(/[-_\s]/g, '');

const IMPLIES_PARAMS_RE = /\b(?:with|given|takes|accepts|requires|specified|provided)\b/gi;
const QUOTED_PARAM_RE = /[`"']\w+[`"']/;
const IMPLIES_MANDATORY_RE = /\brequired\b|\bmust provide\b|\bmandatory\b/i;
const ENUM_PROSE_RE = /\bone of\b|\bmust be either\b|\ballowed values\b|\bvalid options\b/i;
const NAME_STYLE_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const PLACEHOLDER_DESCRIPTION_RES = [
  /^does stuff[.!]?$/i,
  /^a tool[.!]?$/i,
  /^(?:(?:this|a|the)\s+)?tool\s+(?:for|to|that)\b/i,
];

export const definitionRules: Rule[] = [
  {
    meta: {
      id: 'MCP101',
      title: 'Tool has no description',
      severity: 'error',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint: 'Write a description stating what the tool does and when the model should call it.',
      docs: "Missing tool descriptions are ToolBench's #1 observed defect in real-world tool catalogs: the model has nothing but the name to decide whether to call the tool, so selection accuracy collapses. A tool without a description is effectively unusable by an agent.",
    },
    check: (artifact) =>
      validTools(asMcp(artifact))
        .filter((t) => !t.description?.trim())
        .map((t) => ({
          message: `tool "${t.name}" has no description`,
          location: { toolName: t.name },
        })),
  },
  {
    meta: {
      id: 'MCP102',
      title: 'Tool description too short or generic',
      severity: 'warn',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint: 'Describe what the tool does and when to use it, not just restate its name.',
      docs: 'A description that merely restates the tool name ("read_file: reads a file") or is placeholder text gives the model no basis for choosing between similar tools. Descriptions should state purpose and the situations that call for the tool.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of validTools(asMcp(artifact))) {
        const desc = tool.description?.trim();
        if (!desc) continue; // MCP101 already covers this
        if (desc.length < 15) {
          hits.push({
            message: `tool "${tool.name}" description is only ${desc.length} chars: "${desc}"`,
            location: { toolName: tool.name },
          });
        } else if (normalizeName(desc.replace(/[.!]$/, '')) === normalizeName(tool.name)) {
          hits.push({
            message: `tool "${tool.name}" description just restates its name`,
            location: { toolName: tool.name },
          });
        } else if (PLACEHOLDER_DESCRIPTION_RES.some((re) => re.test(desc))) {
          hits.push({
            message: `tool "${tool.name}" description is placeholder text: "${desc.slice(0, 60)}"`,
            location: { toolName: tool.name },
          });
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP103',
      title: 'Input schema empty while description implies parameters',
      severity: 'error',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint: 'Declare the implied parameters as properties of a type:"object" inputSchema.',
      docs: 'When a description says the tool "takes a path" but the schema declares nothing, the model either cannot pass arguments at all or invents unvalidated ones. The schema is the calling contract — prose is not.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of validTools(asMcp(artifact))) {
        const desc = tool.description ?? '';
        const schema = tool.inputSchema;
        const schemaEmpty =
          !schema ||
          schema.type !== 'object' ||
          !schemaProperties(tool) ||
          Object.keys(schemaProperties(tool) ?? {}).length === 0;
        if (!schemaEmpty) continue;
        const words = [
          ...new Set([...desc.matchAll(IMPLIES_PARAMS_RE)].map((m) => m[0].toLowerCase())),
        ];
        if (QUOTED_PARAM_RE.test(desc)) words.push('a quoted parameter name');
        if (words.length === 0) continue;
        const problem = !schema
          ? 'has no inputSchema'
          : schema.type !== 'object'
            ? `has inputSchema type "${String(schema.type)}" instead of "object"`
            : 'declares zero schema properties';
        hits.push({
          message: `tool "${tool.name}" ${problem} but its description implies parameters (${words.join(', ')})`,
          location: { toolName: tool.name },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP104',
      title: 'Parameters missing descriptions',
      severity: 'warn',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint:
        'Add a description to every schema property saying what the value means and its format.',
      docs: 'Undescribed parameters force the model to guess argument semantics from the name alone — the top source of malformed tool calls. Every property should say what the value means, its format, and its default.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of validTools(asMcp(artifact))) {
        const props = schemaProperties(tool);
        if (!props) continue;
        const names = Object.keys(props);
        const missing = names.filter((name) => {
          const prop = props[name];
          return (
            !isPlainObject(prop) || typeof prop.description !== 'string' || !prop.description.trim()
          );
        });
        if (missing.length === 0) continue;
        const shown = missing.slice(0, 3).join(', ');
        const more = missing.length > 3 ? ` (+${missing.length - 3} more)` : '';
        hits.push({
          message: `tool "${tool.name}" has ${missing.length} of ${names.length} parameters without descriptions: ${shown}${more}`,
          location: { toolName: tool.name },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP105',
      title: 'Enum described in prose instead of schema',
      severity: 'warn',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint:
        'Move the allowed values from the description prose into an enum array on the property.',
      docs: 'A description like "must be one of: fast, slow" is a soft constraint the model will eventually violate; an enum array is validated by every host and shown in structured form. Prose enums are the schema equivalent of a comment instead of a type.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of validTools(asMcp(artifact))) {
        const props = schemaProperties(tool);
        if (!props) continue;
        for (const [paramName, prop] of Object.entries(props)) {
          if (!isPlainObject(prop)) continue;
          if (prop.type !== undefined && prop.type !== 'string') continue;
          if (Array.isArray(prop.enum)) continue;
          const desc = typeof prop.description === 'string' ? prop.description : '';
          const match = desc.match(ENUM_PROSE_RE);
          if (!match) continue;
          hits.push({
            message: `parameter "${paramName}" of tool "${tool.name}" describes an enum in prose ("${match[0]}") but has no enum array`,
            location: { toolName: tool.name },
          });
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP106',
      title: 'No required array despite mandatory-sounding parameters',
      severity: 'warn',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint: 'List the mandatory parameters in the schema "required" array.',
      docs: 'If the description says a parameter must be provided but the schema marks nothing required, hosts will happily send calls without it and the failure surfaces at runtime instead of validation time.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      for (const tool of validTools(asMcp(artifact))) {
        const props = schemaProperties(tool);
        if (!props || Object.keys(props).length === 0) continue;
        const required = tool.inputSchema?.required;
        if (Array.isArray(required) && required.length > 0) continue;
        const match = (tool.description ?? '').match(IMPLIES_MANDATORY_RE);
        if (!match) continue;
        hits.push({
          message: `tool "${tool.name}" description implies mandatory parameters ("${match[0]}") but the schema has no required array`,
          location: { toolName: tool.name },
        });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP107',
      title: 'Tool name style, length, or collision',
      severity: 'info',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint: 'Use short snake_case or kebab-case names that stay distinct after normalization.',
      docs: 'Models tokenize and match tool names; unconventional casing, very long names, and names that collide once separators and case are stripped all measurably hurt selection. snake_case and kebab-case are the de-facto conventions across hosts.',
    },
    check: (artifact) => {
      const hits: RuleHit[] = [];
      const seen = new Map<string, string>();
      for (const tool of validTools(asMcp(artifact))) {
        if (!NAME_STYLE_RE.test(tool.name)) {
          hits.push({
            message: `tool name "${tool.name}" is not snake_case or kebab-case`,
            location: { toolName: tool.name },
          });
        }
        if (tool.name.length > MAX_NAME_LENGTH) {
          hits.push({
            message: `tool name "${tool.name.slice(0, 40)}…" is ${tool.name.length} chars (max ${MAX_NAME_LENGTH})`,
            location: { toolName: tool.name },
          });
        }
        const norm = normalizeName(tool.name);
        const existing = seen.get(norm);
        if (existing !== undefined) {
          hits.push({
            message: `tool name "${tool.name}" collides with "${existing}" after case/separator normalization`,
            location: { toolName: tool.name },
          });
        } else {
          seen.set(norm, tool.name);
        }
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP108',
      title: 'Too many tools for reliable selection',
      severity: 'warn',
      dimension: 'definition',
      appliesTo: ['mcp-server'],
      fixHint:
        'Split the catalog into focused servers or namespace tools behind fewer entry points.',
      docs: 'Tool-selection accuracy degrades as the catalog grows: every extra tool is another distractor in the model context. Servers past the budget should be split by domain or expose a smaller routed surface.',
    },
    check: (artifact, config) => {
      const mcp = asMcp(artifact);
      const budget = config.budgets.mcpMaxTools;
      if (mcp.tools.length <= budget) return [];
      return [
        {
          message: `server exposes ${mcp.tools.length} tools (budget: ${budget}) — selection accuracy degrades with catalogs this large`,
        },
      ];
    },
  },
];
