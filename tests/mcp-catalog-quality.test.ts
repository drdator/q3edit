import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { BridgeHub } from '../bridge/bridge-hub';
import { createQ3EditMcpServer } from '../bridge/mcp-server';

function parameterDescriptionCounts(schema: unknown): { total: number; described: number } {
  if (!schema || typeof schema !== 'object') return { total: 0, described: 0 };
  const value = schema as Record<string, unknown>;
  let total = 0;
  let described = 0;
  if (value.properties && typeof value.properties === 'object') {
    for (const property of Object.values(value.properties as Record<string, unknown>)) {
      total++;
      if (property && typeof property === 'object' && typeof (property as { description?: unknown }).description === 'string') described++;
      const nested = parameterDescriptionCounts(property);
      total += nested.total;
      described += nested.described;
    }
  }
  if (value.items) {
    const nested = parameterDescriptionCounts(value.items);
    total += nested.total;
    described += nested.described;
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    if (!Array.isArray(value[keyword])) continue;
    for (const branch of value[keyword]) {
      const nested = parameterDescriptionCounts(branch);
      total += nested.total;
      described += nested.described;
    }
  }
  return { total, described };
}

function topLevelProperties(schema: unknown): Array<Record<string, unknown>> {
  if (!schema || typeof schema !== 'object') return [];
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === 'object'
    ? Object.values(properties as Record<string, Record<string, unknown>>)
    : [];
}

describe('MCP catalog quality budgets', () => {
  test('keeps discovery metadata concise, descriptive, and safe to defer', async () => {
    const server = createQ3EditMcpServer(new BridgeHub());
    const client = new Client({ name: 'q3edit-catalog-audit', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools;
      const instructions = client.getInstructions() ?? '';
      expect(instructions.split('\n\n')[0].length).toBeLessThanOrEqual(512);
      expect(instructions.length).toBeLessThanOrEqual(2_000);
      expect(JSON.stringify(tools).length).toBeLessThan(150_000);
      expect(tools).toHaveLength(61);
      expect(tools.every(tool => /^[A-Za-z0-9_.-]{1,128}$/.test(tool.name))).toBe(true);
      expect(tools.every(tool => Boolean(tool.title) && Boolean(tool.description))).toBe(true);
      expect(tools.every(tool => /\b(returns?|responds?|yields?|outputs?|provides|lists?)\b/i.test(tool.description ?? ''))).toBe(true);
      expect(Math.max(...tools.map(tool => tool.description?.length ?? 0))).toBeLessThan(2_000);
      expect(tools.every(tool => tool.annotations?.openWorldHint === false)).toBe(true);
      expect(tools.every(tool => {
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        return !schema.properties || Object.keys(schema.properties).length === 0 || Array.isArray(schema.required);
      })).toBe(true);
      expect(tools.flatMap(tool => topLevelProperties(tool.inputSchema)).every(property => (
        Array.isArray(property.enum) || typeof property.description === 'string'
      ))).toBe(true);

      const applyInputBytes = JSON.stringify(tools.find(tool => tool.name === 'map_apply')?.inputSchema).length;
      const previewInputBytes = JSON.stringify(tools.find(tool => tool.name === 'map_preview')?.inputSchema).length;
      expect(applyInputBytes + previewInputBytes).toBeLessThan(6_000);
      expect(tools.filter(tool => tool.outputSchema).length / tools.length).toBeGreaterThanOrEqual(0.5);

      const coverage = tools.reduce((sum, tool) => {
        const counts = parameterDescriptionCounts(tool.inputSchema);
        return { total: sum.total + counts.total, described: sum.described + counts.described };
      }, { total: 0, described: 0 });
      expect(coverage.described / coverage.total).toBeGreaterThanOrEqual(0.4);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
