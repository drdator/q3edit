import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const tool = process.argv[2] ?? 'map_status';
const rawArguments = process.argv[3] ?? '{}';
const url = process.env.Q3EDIT_MCP_URL ?? 'http://127.0.0.1:8765/mcp';

async function main(): Promise<void> {
  const client = new Client({ name: 'q3edit-mcp-call', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArguments) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.isError) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
