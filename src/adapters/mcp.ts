import { basename } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { TOOL_NAME, TOOL_VERSION } from '../constants.js';
import { AssayError } from '../core/errors.js';
import type { McpArtifact, McpToolInfo, ResolvedConfig } from '../core/types.js';
import { countTokens } from '../util/tokens.js';

export interface McpParseTarget {
  url?: string;
  command?: string[];
}

/** Per-page timeout for tools/list — an adapter I/O bound, not a quality budget. */
const TOOLS_LIST_TIMEOUT_MS = 10_000;
/** Hard stop for runaway pagination (a server re-issuing the same cursor). */
const MAX_TOOLS_LIST_PAGES = 100;

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
 */
export async function parseMcpServer(
  target: McpParseTarget,
  config: ResolvedConfig,
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
