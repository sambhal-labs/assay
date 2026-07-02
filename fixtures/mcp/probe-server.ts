/**
 * assay test fixture: an MCP stdio server engineered for the --probe
 * reliability checks (MCP4xx). Its four tools cover the probe matrix:
 *
 * - echo_text          well-behaved; returns its input (no findings)
 * - fail_unstructured  isError with a bare stack-trace string (MCP403)
 * - fail_protocol      reply violates the MCP result shape (MCP401)
 * - delete_everything  well-described but mutation-named — safe mode must
 *                      skip it unless --unsafe
 *
 * Run with: node --import tsx fixtures/mcp/probe-server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const server = new McpServer({ name: 'assay-probe-fixture', version: '0.1.0' });

server.registerTool(
  'echo_text',
  {
    description:
      'Echo the provided text back unchanged. Use to check round-trip connectivity and encoding through the tool pipeline.',
    inputSchema: {
      text: z.string().describe('Text to echo back verbatim.'),
    },
  },
  ({ text }) => ({ content: [{ type: 'text', text }] }),
);

server.registerTool(
  'fail_unstructured',
  {
    description:
      'Look up a record that never exists, so the reply is always a tool-level error whose only content is a bare stack-trace string.',
    inputSchema: {
      record_id: z.string().describe('Identifier of the record to look up; any value fails.'),
    },
  },
  ({ record_id }) => ({
    isError: true,
    content: [
      {
        type: 'text',
        text: [
          `TypeError: Cannot read properties of undefined (reading '${record_id}')`,
          '    at lookupRecord (/srv/fixture/store.js:42:17)',
          '    at handleToolCall (/srv/fixture/server.js:118:9)',
          '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
        ].join('\n'),
      },
    ],
  }),
);

server.registerTool(
  'fail_protocol',
  {
    description:
      'Advertise a permissive input schema, then reply with a payload that violates the MCP result shape — every call fails at the protocol level.',
    inputSchema: {
      query: z.string().describe('Free-text query; any value triggers the malformed reply.'),
    },
  },
  // A text content item whose `text` is a number fails CallToolResultSchema
  // on the client side, which is exactly the protocol-level failure MCP401
  // grades. The cast is the point: this fixture lies about its wire shape.
  () => ({ content: [{ type: 'text', text: 1234 }] }) as unknown as CallToolResult,
);

server.registerTool(
  'delete_everything',
  {
    description:
      'Permanently delete every record in the fixture workspace. Schema-complete and well described, but mutation-named: the probe must skip it unless --unsafe.',
    inputSchema: {
      confirm: z.boolean().describe('Must be true to acknowledge the destructive intent.'),
    },
  },
  () => ({
    content: [{ type: 'text', text: 'nothing was deleted — this is a fixture' }],
  }),
);

// Orphan protection: when the client goes away, so do we.
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
