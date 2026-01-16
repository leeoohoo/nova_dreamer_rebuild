import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'hello-module',
  version: '0.1.0',
});

server.registerTool(
  'hello',
  {
    title: 'Hello',
    description: 'Return a greeting from the Hello Module template MCP server.',
    inputSchema: z.object({
      name: z.string().optional().describe('Optional name to greet'),
    }),
  },
  async ({ name } = {}) => {
    const who = typeof name === 'string' && name.trim() ? name.trim() : 'world';
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${who}! (from hello-module MCP server)`,
        },
      ],
    };
  }
);

server.registerTool(
  'echo',
  {
    title: 'Echo',
    description: 'Echo back the given text.',
    inputSchema: z.object({
      text: z.string().describe('Text to echo'),
    }),
  },
  async ({ text }) => ({
    content: [
      {
        type: 'text',
        text: String(text ?? ''),
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('MCP server error:', error);
  process.exit(1);
});

