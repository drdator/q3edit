import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BridgeHub } from '../bridge/bridge-hub';
import { createQ3EditMcpServer } from '../bridge/mcp-server';

const outputPath = resolve('.q3edit/mcp-tools.json');
const server = createQ3EditMcpServer(new BridgeHub());
const client = new Client({ name: 'q3edit-catalog-snapshot', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await mkdir(resolve('.q3edit'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ serverName: 'q3edit-live', tools }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${tools.length} Q3Edit MCP tool definitions to ${outputPath}`);
} finally {
  await client.close();
  await server.close();
}
