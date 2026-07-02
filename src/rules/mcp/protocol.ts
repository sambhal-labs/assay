import type { Artifact, McpArtifact, Rule, RuleHit } from '../../core/types.js';

// Engine guarantees appliesTo before check() runs, so the cast is safe.
const asMcp = (a: Artifact): McpArtifact => a as McpArtifact;

export const protocolRules: Rule[] = [
  {
    meta: {
      id: 'MCP001',
      title: 'Server fails MCP initialization',
      severity: 'error',
      dimension: 'protocol',
      appliesTo: ['mcp-server'],
      fixHint: 'Make the server complete the MCP initialize handshake before anything else.',
      docs: 'The initialize handshake is the front door of the protocol: a server that is reachable but cannot negotiate a session is invisible to every MCP host. Nothing else about the server can be trusted until this passes.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      if (mcp.initialized) return [];
      return [
        {
          message: `server at ${mcp.target} failed MCP initialization: ${mcp.initializeError ?? 'unknown error'}`,
        },
      ];
    },
  },
  {
    meta: {
      id: 'MCP002',
      title: 'tools/list fails or returns malformed entries',
      severity: 'error',
      dimension: 'protocol',
      appliesTo: ['mcp-server'],
      fixHint:
        'Return spec-shaped tool entries (non-empty string name, object inputSchema) from tools/list.',
      docs: 'tools/list is how hosts discover what a server can do. A failing call or an entry without a valid name/inputSchema shape is dropped (or worse, crashes the host loop), so those tools effectively do not exist.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      if (!mcp.initialized) return []; // MCP001 already covers this
      const hits: RuleHit[] = [];
      if (mcp.toolsListError) {
        hits.push({ message: `tools/list failed: ${mcp.toolsListError}` });
      }
      mcp.tools.forEach((tool, i) => {
        if (tool.entryValid) return;
        const label = tool.name.trim() ? `"${tool.name}"` : `#${i + 1}`;
        const reason = tool.name.trim()
          ? 'its inputSchema is not an object'
          : 'it has no non-empty string name';
        hits.push({
          message: `tool entry ${label} failed MCP shape validation: ${reason}`,
          ...(tool.name.trim() ? { location: { toolName: tool.name } } : {}),
        });
      });
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP003',
      title: 'Protocol version or capabilities incomplete',
      severity: 'warn',
      dimension: 'protocol',
      appliesTo: ['mcp-server'],
      fixHint: 'Report a protocol version and a non-empty capabilities object during initialize.',
      docs: 'Hosts gate features (tools, resources, notifications) on the capabilities the server declares during initialize. A server that omits its protocol version or declares no capabilities forces hosts to guess, which usually means features silently disabled.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      if (!mcp.initialized) return []; // MCP001 already covers this
      const hits: RuleHit[] = [];
      if (!mcp.protocolVersion) {
        hits.push({ message: 'server negotiated no MCP protocol version' });
      }
      if (!mcp.capabilities || Object.keys(mcp.capabilities).length === 0) {
        hits.push({ message: 'server declared an empty or missing capabilities object' });
      }
      return hits;
    },
  },
  {
    meta: {
      id: 'MCP004',
      title: 'Deprecated SSE transport endpoint',
      severity: 'info',
      dimension: 'protocol',
      appliesTo: ['mcp-server'],
      fixHint: 'Migrate the endpoint to the streamable HTTP transport (spec 2025-03-26 or later).',
      docs: 'HTTP+SSE was deprecated in favor of streamable HTTP; an endpoint path ending in /sse signals a server built on the legacy transport, which newer hosts are dropping support for.',
    },
    check: (artifact) => {
      const mcp = asMcp(artifact);
      if (mcp.transport !== 'http') return [];
      let pathname: string;
      try {
        pathname = new URL(mcp.target).pathname;
      } catch {
        return [];
      }
      if (!/\/sse\/?$/.test(pathname)) return [];
      return [
        {
          message: `endpoint path "${pathname}" ends in /sse — the HTTP+SSE transport is deprecated`,
        },
      ];
    },
  },
];
