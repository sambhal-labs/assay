/**
 * assay test fixture: a small, well-behaved MCP stdio server that should grade
 * A with zero MCP findings. Run with: node --import tsx fixtures/mcp/good-server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'assay-good-fixture', version: '0.1.0' });

server.registerTool(
  'search_files',
  {
    description:
      'Search the workspace for files whose paths match a glob pattern. Use when you need to locate source files by name, extension, or directory across the project tree.',
    inputSchema: {
      pattern: z
        .string()
        .describe('Glob pattern matched against workspace-relative paths, e.g. src/**/*.ts.'),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Upper bound on the number of matching paths returned; defaults to 100.'),
    },
  },
  ({ pattern }) => ({
    content: [{ type: 'text', text: `no matches for ${pattern} in this fixture` }],
  }),
);

server.registerTool(
  'read_file',
  {
    description:
      'Read the contents of a single text file at a workspace-relative path. Use when you already know which file you want and need its full text.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path of the file to read, e.g. src/index.ts.'),
      encoding: z
        .enum(['utf8', 'base64'])
        .optional()
        .describe('Encoding for the returned contents; defaults to utf8.'),
    },
  },
  ({ path }) => ({
    content: [{ type: 'text', text: `fixture contents of ${path}` }],
  }),
);

server.registerTool(
  'get_metadata',
  {
    description:
      'Fetch size, modification time, and type information for a file or directory. Use when you need facts about an entry on disk without reading its contents.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path of the file or directory to inspect.'),
    },
  },
  ({ path }) => ({
    content: [{ type: 'text', text: `fixture metadata for ${path}` }],
  }),
);

// Orphan protection: when the client goes away, so do we.
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
