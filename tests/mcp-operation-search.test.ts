import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { operationDiscoveryEntries, searchOperations } from '../bridge/mcp/operation-search';

describe('MCP operation discovery', () => {
  test('covers every supported authoring operation with semantic metadata', () => {
    const types = operationDiscoveryEntries().map(entry => entry.type);
    expect(types).toHaveLength(new Set(types).size);
    expect(types).toHaveLength(39);
    expect(operationDiscoveryEntries().every(entry => entry.summary.length >= 24 && entry.keywords.length > 0)).toBe(true);
  });

  test('finds non-boxy geometry and material workflows from natural language', () => {
    expect(searchOperations('curved gothic arch').slice(0, 3).map(entry => entry.type)).toContain('create_patch');
    expect(searchOperations('make a doorway opening').slice(0, 5).map(entry => entry.type)).toContain('csg_subtract');
    expect(searchOperations('fix selected brush texture projection').slice(0, 5).map(entry => entry.type)).toContain('edit_faces');
    expect(searchOperations('radial repeated detail').slice(0, 5).map(entry => entry.type)).toContain('repeat_variation');
  });

  test('keeps direct, indirect, and negative tool-routing prompts under version control', () => {
    const cases = JSON.parse(readFileSync(new URL('./fixtures/mcp-tool-selection-golden.json', import.meta.url), 'utf8')) as Array<{
      kind: string; prompt: string; expected: string[]; forbidden: string[];
    }>;
    expect(new Set(cases.map(item => item.kind))).toEqual(new Set(['direct', 'indirect', 'negative']));
    expect(cases.every(item => item.prompt.length > 0 && Array.isArray(item.expected) && Array.isArray(item.forbidden))).toBe(true);
  });
});
