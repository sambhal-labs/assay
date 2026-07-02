import { basename } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOL_NAME, TOOL_VERSION } from '../constants.js';
import { AssayError } from '../core/errors.js';
import type { McpArtifact, McpToolInfo, ProbeToolResult, ResolvedConfig } from '../core/types.js';
import { countTokens } from '../util/tokens.js';

export interface McpParseTarget {
  url?: string;
  command?: string[];
}

export interface McpParseOptions {
  /** Call each listed tool with schema-synthesized args (MCP4xx reliability). */
  probe?: boolean;
  /** Probe even tools whose name/description matches the mutation lexicon. */
  unsafe?: boolean;
}

/** Per-page timeout for tools/list — an adapter I/O bound, not a quality budget. */
const TOOLS_LIST_TIMEOUT_MS = 10_000;
/** Hard stop for runaway pagination (a server re-issuing the same cursor). */
const MAX_TOOLS_LIST_PAGES = 100;
/** Per-call timeout for --probe tool calls. */
const PROBE_CALL_TIMEOUT_MS = 10_000;

/**
 * Mutation safe-mode lexicon: a tool whose name or description contains one
 * of these words (or a simple -s/-es/-d/-ed inflection) is never called by
 * --probe unless the user explicitly passes --unsafe. Probing runs against
 * live servers, and "grade my server" must never mean "send my users email".
 */
export const MUTATION_LEXICON = [
  'delete',
  'remove',
  'destroy',
  'drop',
  'write',
  'create',
  'update',
  'set',
  'send',
  'post',
  'email',
  'message',
  'pay',
  'purchase',
  'buy',
  'order',
  'deploy',
  'publish',
  'push',
  'upload',
  'insert',
  'patch',
  'put',
  'execute',
  'kill',
  'restart',
  'reset',
  'revoke',
  'grant',
] as const;

/**
 * Lax tools/list result: the SDK's own schema rejects the whole response when
 * one entry is malformed. We accept anything array-shaped and validate each
 * entry ourselves so a single bad tool becomes entryValid=false (MCP002)
 * instead of hiding the rest of the catalog.
 */
const LaxToolsListSchema = z.looseObject({
  tools: z.array(z.unknown()).optional(),
  nextCursor: z.string().optional(),
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeToolEntry(entry: unknown): Omit<McpToolInfo, 'tokens'> {
  if (!isPlainObject(entry)) {
    return { name: '', description: undefined, inputSchema: undefined, entryValid: false };
  }
  let entryValid = true;

  const name = typeof entry.name === 'string' ? entry.name : '';
  if (!name.trim()) entryValid = false;

  const description = typeof entry.description === 'string' ? entry.description : undefined;

  let inputSchema: Record<string, unknown> | undefined;
  if (entry.inputSchema !== undefined) {
    if (isPlainObject(entry.inputSchema)) {
      inputSchema = entry.inputSchema;
    } else {
      entryValid = false;
    }
  }

  return { name, description, inputSchema, entryValid };
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Probe (--probe): call tools with schema-synthesized args on the SAME
// connection tools/list used, so we measure the server as a host would see it.
// ---------------------------------------------------------------------------

/** Lowercase word tokens, splitting camelCase, snake_case, and kebab-case. */
function wordsOf(text: string): Set<string> {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set(spaced.split(/[^a-z]+/).filter(Boolean));
}

/** The lexicon word a tool matches, or null when it looks read-only. */
export function mutationKeywordFor(tool: {
  name: string;
  description: string | undefined;
}): string | null {
  const tokens = wordsOf(`${tool.name} ${tool.description ?? ''}`);
  for (const word of MUTATION_LEXICON) {
    if (
      tokens.has(word) ||
      tokens.has(`${word}s`) ||
      tokens.has(`${word}es`) ||
      tokens.has(`${word}d`) ||
      tokens.has(`${word}ed`)
    ) {
      return word;
    }
  }
  return null;
}

/**
 * Minimal schema-valid arguments: only required properties, with the most
 * boring value each type admits. The point is that a well-behaved server must
 * handle these without a protocol-level error (MCP401).
 */
export function synthesizeArgs(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(schema)) return {};
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === 'string')
    : [];
  const args: Record<string, unknown> = {};
  for (const key of required) {
    args[key] = synthesizeValue(properties[key]);
  }
  return args;
}

function synthesizeValue(prop: unknown): unknown {
  if (!isPlainObject(prop)) return 'test';
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum[0];
  const type = typeof prop.type === 'string' ? prop.type : undefined;
  switch (type) {
    case 'string':
      return 'test';
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return synthesizeArgs(prop);
    case 'null':
      return null;
    default:
      // No/unknown type: an object-looking schema recurses, anything else
      // accepts any value, so a string is as schema-valid as it gets.
      return isPlainObject(prop.properties) ? synthesizeArgs(prop) : 'test';
  }
}

/**
 * MCP403's structure test. Only the classic anti-pattern counts as
 * unstructured: a single bare text blob that no program can parse. Anything
 * else (JSON text, multiple content items, non-text content) is treated as
 * machine-readable.
 */
function isStructuredErrorContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return true;
  const item: unknown = content[0];
  if (!isPlainObject(item) || item.type !== 'text' || typeof item.text !== 'string') return true;
  try {
    JSON.parse(item.text);
    return true;
  } catch {
    return false;
  }
}

async function probeTools(
  client: Client,
  tools: McpToolInfo[],
  unsafe: boolean,
): Promise<ProbeToolResult[]> {
  const results: ProbeToolResult[] = [];
  for (const tool of tools) {
    if (!tool.entryValid || !tool.name.trim()) {
      results.push({
        toolName: tool.name.trim() ? tool.name : '(unnamed tool)',
        skipped: true,
        skipReason: 'invalid tool entry (see MCP002)',
      });
      continue;
    }
    const keyword = mutationKeywordFor(tool);
    if (keyword && !unsafe) {
      results.push({
        toolName: tool.name,
        skipped: true,
        skipReason: `mutation-keyword: ${keyword}`,
      });
      continue;
    }
    const args = synthesizeArgs(tool.inputSchema);
    const startedAt = performance.now();
    try {
      const result = await client.callTool(
        { name: tool.name, arguments: args },
        CallToolResultSchema,
        { timeout: PROBE_CALL_TIMEOUT_MS },
      );
      const record: ProbeToolResult = {
        toolName: tool.name,
        skipped: false,
        latencyMs: Math.round(performance.now() - startedAt),
        protocolError: false,
      };
      if (result.isError) {
        record.errorStructured = isStructuredErrorContent(result.content);
      }
      results.push(record);
    } catch {
      // Timeout, JSON-RPC error, or a result failing MCP shape validation:
      // schema-valid args must never surface as a protocol-level failure.
      results.push({
        toolName: tool.name,
        skipped: false,
        latencyMs: Math.round(performance.now() - startedAt),
        protocolError: true,
      });
    }
  }
  return results;
}

class ConnectTimeoutError extends Error {}

/**
 * True for failures where we never reached a speaking MCP server: those throw
 * AssayError (exit 2). Anything the server itself answered wrongly is graded
 * instead (initialized:false → MCP001).
 */
function isTransportLevelFailure(err: unknown, transport: 'stdio' | 'http'): boolean {
  if (err instanceof ConnectTimeoutError) return true;
  if (!(err instanceof Error)) return false;
  if (transport === 'stdio') {
    const code = (err as NodeJS.ErrnoException).code;
    return (
      code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || /\bspawn\b/i.test(err.message)
    );
  }
  // http: auth rejections and network-level fetch failures.
  if (err.name === 'UnauthorizedError' || err.name === 'StreamableHTTPError') return true;
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|certificate/i.test(err.message)) {
    return true;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (
    cause instanceof Error &&
    /ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test(
      String((cause as NodeJS.ErrnoException).code ?? cause.message),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Connects to an MCP server (stdio command or streamable HTTP URL), lists its
 * tools with full pagination, and normalizes everything into an McpArtifact.
 * All I/O and token counting happens here so rules stay synchronous and pure.
 * Unreachable targets throw AssayError; a reachable server that misbehaves at
 * the protocol level becomes artifact state (initialized:false,
 * toolsListError, entryValid:false) that the MCP0xx rules grade.
 *
 * With options.probe, each listed tool is additionally called (on this same
 * connection) with schema-synthesized arguments; results land on
 * artifact.probe for the MCP4xx reliability rules. Mutation-looking tools are
 * skipped unless options.unsafe.
 */
export async function parseMcpServer(
  target: McpParseTarget,
  config: ResolvedConfig,
  options: McpParseOptions = {},
): Promise<McpArtifact> {
  const { url, command } = target;
  if (!url && (!command || command.length === 0)) {
    throw new AssayError(
      'missing MCP target',
      'pass a streamable HTTP URL or a stdio command with arguments',
    );
  }

  const transportKind: 'stdio' | 'http' = url ? 'http' : 'stdio';
  const targetLabel = url ?? command!.join(' ');

  let transport: Transport;
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AssayError(`invalid MCP server URL: ${url}`);
    }
    transport = new StreamableHTTPClientTransport(parsed);
  } else {
    transport = new StdioClientTransport({
      command: command![0]!,
      args: command!.slice(1),
      stderr: 'pipe',
    });
  }

  // Capture the negotiated protocol version: the Client calls this Transport
  // hook after a successful initialize but exposes no getter of its own.
  let protocolVersion: string | null = null;
  const originalSetProtocolVersion = transport.setProtocolVersion?.bind(transport);
  transport.setProtocolVersion = (version: string) => {
    protocolVersion = version;
    originalSetProtocolVersion?.(version);
  };

  const client = new Client({ name: TOOL_NAME, version: TOOL_VERSION });
  const timeoutMs = config.budgets.mcpConnectTimeoutMs;

  const base: Omit<
    McpArtifact,
    | 'initialized'
    | 'initializeError'
    | 'protocolVersion'
    | 'capabilities'
    | 'toolsListError'
    | 'tools'
    | 'tokens'
    | 'name'
  > = {
    type: 'mcp-server',
    path: targetLabel,
    transport: transportKind,
    target: targetLabel,
  };

  try {
    try {
      let timer: NodeJS.Timeout | undefined;
      const connecting = client.connect(transport, { timeout: timeoutMs });
      // If the race timeout wins, the losing connect rejection must not
      // surface later as an unhandled rejection.
      connecting.catch(() => {});
      try {
        await Promise.race([
          connecting,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ConnectTimeoutError()), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (isTransportLevelFailure(err, transportKind)) {
        if (err instanceof ConnectTimeoutError) {
          throw new AssayError(
            `timed out connecting to MCP server after ${timeoutMs}ms: ${targetLabel}`,
            'check that the server starts and speaks MCP; raise budgets.mcpConnectTimeoutMs if it is just slow',
          );
        }
        throw new AssayError(
          `cannot reach MCP server ${targetLabel}: ${messageOf(err)}`,
          transportKind === 'stdio'
            ? 'check that the command exists and is executable'
            : 'check the URL, network access, and any required auth headers',
        );
      }
      // Reachable but not speaking MCP correctly — grade it (MCP001).
      return {
        ...base,
        name: fallbackName(target),
        initialized: false,
        initializeError: messageOf(err),
        protocolVersion: null,
        capabilities: null,
        toolsListError: null,
        tools: [],
        tokens: { total: 0 },
      };
    }

    const serverInfo = client.getServerVersion();
    const capabilities = client.getServerCapabilities() ?? null;
    const name =
      typeof serverInfo?.name === 'string' && serverInfo.name.trim()
        ? serverInfo.name
        : fallbackName(target);

    let toolsListError: string | null = null;
    const rawEntries: unknown[] = [];
    try {
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      for (let page = 0; ; page++) {
        if (page >= MAX_TOOLS_LIST_PAGES) {
          throw new Error(`pagination did not terminate after ${MAX_TOOLS_LIST_PAGES} pages`);
        }
        const result = await client.request(
          { method: 'tools/list', params: cursor === undefined ? {} : { cursor } },
          LaxToolsListSchema,
          { timeout: TOOLS_LIST_TIMEOUT_MS },
        );
        if (!Array.isArray(result.tools)) {
          throw new Error('tools/list result has no tools array');
        }
        rawEntries.push(...result.tools);
        if (result.nextCursor === undefined) break;
        if (seenCursors.has(result.nextCursor)) {
          throw new Error(`pagination loop: cursor "${result.nextCursor}" repeated`);
        }
        seenCursors.add(result.nextCursor);
        cursor = result.nextCursor;
      }
    } catch (err) {
      toolsListError = messageOf(err);
      rawEntries.length = 0;
    }

    const tools: McpToolInfo[] = [];
    let total = 0;
    for (const raw of rawEntries) {
      const normalized = normalizeToolEntry(raw);
      // Serialized the way a host embeds the tool into model context.
      const tokens = await countTokens(
        JSON.stringify({
          name: normalized.name,
          description: normalized.description,
          inputSchema: normalized.inputSchema,
        }),
      );
      total += tokens;
      tools.push({ ...normalized, tokens });
    }

    let probe: ProbeToolResult[] | undefined;
    if (options.probe && toolsListError === null) {
      probe = await probeTools(client, tools, options.unsafe ?? false);
    }

    return {
      ...base,
      name,
      initialized: true,
      initializeError: null,
      protocolVersion,
      capabilities,
      toolsListError,
      tools,
      tokens: { total },
      ...(probe !== undefined ? { probe } : {}),
    };
  } finally {
    // A leaked stdio child keeps the CLI's event loop alive forever.
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

function fallbackName(target: McpParseTarget): string {
  if (target.url) {
    try {
      return new URL(target.url).host;
    } catch {
      return target.url;
    }
  }
  return basename(target.command![0]!);
}
