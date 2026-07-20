import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, test } from 'vitest';
import { BridgeHub } from '../bridge/bridge-hub';
import { createQ3EditMcpServer } from '../bridge/mcp-server';
import type { EditorToBridgeMessage, LiveMapSnapshot } from '../src/live-bridge-protocol';

function snapshot(revision = 4): LiveMapSnapshot {
  return {
    fileName: 'live.map',
    mapText: '// live map\n',
    revision,
    mapInfo: {
      entities: 1,
      brushes: 0,
      patches: 0,
      terrain: 0,
      textures: 0,
      groups: 0,
      unsupportedConstructs: 0,
      diagnostics: { errors: 0, warnings: 0, info: 0 },
      entityClasses: [{ classname: 'worldspawn', count: 1 }],
    },
    entities: [{
      id: 'E0',
      index: 0,
      classname: 'worldspawn',
      propertyCount: 1,
      brushCount: 0,
      patchCount: 0,
      diagnostics: [],
    }],
    diagnostics: [],
  };
}

class FakeEditorSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  autoRespond = true;

  send(data: string): void {
    this.sent.push(data);
    if (!this.autoRespond) return;
    const request = JSON.parse(data);
    if (request.type === 'apply_operations') {
      const next = snapshot(request.expectedRevision + 1);
      queueMicrotask(() => this.emitMessage({
        type: 'operation_result',
        requestId: request.requestId,
        result: {
          revision: next.revision,
          operationCount: request.operations.length,
          created: ['E0:B0'],
          changed: [],
          summary: '1 operation · 1 object created',
        },
        snapshot: next,
      }));
    } else if (request.type === 'request_snapshot') {
      queueMicrotask(() => this.emitMessage({ type: 'snapshot', requestId: request.requestId, snapshot: snapshot() }));
    }
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  emitMessage(message: EditorToBridgeMessage): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

function connectedHub(): { hub: BridgeHub; socket: FakeEditorSocket } {
  const hub = new BridgeHub();
  const socket = new FakeEditorSocket();
  hub.attachEditor(socket as unknown as WebSocket);
  socket.emitMessage({ type: 'editor_ready', snapshot: snapshot() });
  return { hub, socket };
}

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('live MCP bridge', () => {
  test('tracks editor state and resolves forwarded operation requests', async () => {
    const { hub, socket } = connectedHub();

    expect(hub.status()).toMatchObject({ editorConnected: true, snapshot: { revision: 4 } });
    const applied = await hub.applyOperations(4, 'MCP: Add box', [
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] },
    ]);

    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'apply_operations',
      expectedRevision: 4,
      label: 'MCP: Add box',
    });
    expect(applied.result.revision).toBe(5);
    expect(hub.status().snapshot?.revision).toBe(5);
  });

  test('writes a requested browser snapshot to disk', async () => {
    const { hub } = connectedHub();
    const directory = await mkdtemp(join(tmpdir(), 'q3edit-mcp-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'saved.map');

    const result = await hub.saveMap(path);

    expect(result).toEqual({ path, revision: 4 });
    expect(await readFile(path, 'utf8')).toBe('// live map\n');
  });

  test('exposes status and live editing through MCP', async () => {
    const { hub } = connectedHub();
    const server = createQ3EditMcpServer(hub);
    const client = new Client({ name: 'q3edit-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual([
        'map_status',
        'map_entities',
        'map_inspect',
        'map_validate',
        'map_apply',
        'map_open',
        'map_save',
      ]);

      const status = await client.callTool({ name: 'map_status', arguments: {} });
      expect(status.structuredContent).toMatchObject({ editorConnected: true, snapshot: { revision: 4 } });

      const applied = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 4,
          label: 'MCP: Add box',
          operations: [{ type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] }],
        },
      });
      expect(applied.isError).not.toBe(true);
      expect(applied.structuredContent).toMatchObject({ revision: 5, operationCount: 1 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
