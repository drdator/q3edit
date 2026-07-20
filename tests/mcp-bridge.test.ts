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
      const aliases = Object.fromEntries(request.operations
        .filter((operation: { id?: string }) => operation.id)
        .map((operation: { id: string }) => [`@${operation.id}`, ['E0:B0']]));
      queueMicrotask(() => this.emitMessage({
        type: 'operation_result',
        requestId: request.requestId,
        result: {
          revision: next.revision,
          operationCount: request.operations.length,
          created: ['E0:B0'],
          changed: [],
          aliases,
          summary: '1 operation · 1 object created',
        },
        snapshot: next,
      }));
    } else if (request.type === 'request_snapshot') {
      queueMicrotask(() => this.emitMessage({ type: 'snapshot', requestId: request.requestId, snapshot: snapshot() }));
    } else if (request.type === 'texture_search') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { query: request.query, matches: [{ name: 'base_wall/metal' }] },
      }));
    } else if (request.type === 'texture_preview') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { name: request.name, mimeType: 'image/png', data: 'aW1hZ2U=' },
      }));
    } else if (request.type === 'entity_class_search') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { query: request.query, matches: [{ classname: 'light', type: 'point' }] },
      }));
    } else if (request.type === 'entity_class_schema') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { classname: request.classname, type: 'point', properties: { light: { type: 'number' } } },
      }));
    } else if (request.type === 'editor_select' || request.type === 'editor_frame_objects') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { refs: request.refs, selectionCount: request.refs.length },
      }));
    } else if (request.type === 'editor_set_camera') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { position: request.position, yaw: request.yaw, pitch: request.pitch },
      }));
    } else if (request.type === 'editor_screenshot') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { mimeType: 'image/png', data: 'c2NyZWVuc2hvdA==', width: request.width ?? 800, height: request.height ?? 600 },
      }));
    } else if (request.type === 'map_compile') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { success: true, quality: request.quality, bspBytes: 4096, leaked: false, pointfileLoaded: false, output: ['BSP done'] },
      }));
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
        'map_compile',
        'map_groups',
        'map_query',
        'texture_search',
        'texture_preview',
        'texture_preview_many',
        'entity_class_search',
        'entity_class_schema',
        'editor_select',
        'editor_frame_objects',
        'editor_set_camera',
        'editor_look_at',
        'editor_screenshot',
        'map_apply',
        'map_open',
        'map_save',
      ]);
      const applySchema = tools.tools.find(tool => tool.name === 'map_apply')?.inputSchema;
      expect(JSON.stringify(applySchema)).not.toMatch(/"(?:anyOf|oneOf)"/);
      expect(JSON.stringify(applySchema)).not.toMatch(/"items":\s*\[/);

      const status = await client.callTool({ name: 'map_status', arguments: {} });
      expect(status.structuredContent).toMatchObject({ editorConnected: true, snapshot: { revision: 4 } });

      const compiled = await client.callTool({ name: 'map_compile', arguments: { quality: 'fast' } });
      expect(compiled.structuredContent).toMatchObject({ success: true, quality: 'fast', bspBytes: 4096, leaked: false });

      const groups = await client.callTool({ name: 'map_groups', arguments: {} });
      expect(groups.structuredContent).toMatchObject({ revision: 4, groups: [] });

      const textures = await client.callTool({ name: 'texture_search', arguments: { query: 'metal' } });
      expect(textures.structuredContent).toMatchObject({ matches: [{ name: 'base_wall/metal' }] });

      const preview = await client.callTool({ name: 'texture_preview', arguments: { name: 'base_wall/metal' } });
      expect(preview.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }),
      ]));

      const previews = await client.callTool({
        name: 'texture_preview_many', arguments: { names: ['base_wall/metal', 'base_floor/stone'] },
      });
      expect((previews.content as Array<{ type: string }>).filter(item => item.type === 'image')).toHaveLength(2);

      const entityClasses = await client.callTool({ name: 'entity_class_search', arguments: { query: 'light' } });
      expect(entityClasses.structuredContent).toMatchObject({ matches: [{ classname: 'light' }] });

      const framed = await client.callTool({ name: 'editor_frame_objects', arguments: { refs: ['E0'] } });
      expect(framed.structuredContent).toMatchObject({ refs: ['E0'], selectionCount: 1 });

      const camera = await client.callTool({
        name: 'editor_set_camera',
        arguments: { position: [128, 64, 96], yawDegrees: 90, pitchDegrees: -15 },
      });
      expect(camera.structuredContent).toMatchObject({ position: [128, 64, 96], yawDegrees: 90, pitchDegrees: -15 });

      const lookAt = await client.callTool({
        name: 'editor_look_at', arguments: { position: [0, 0, 0], target: [0, 64, 64] },
      });
      expect(lookAt.structuredContent).toMatchObject({ yawDegrees: 90, pitchDegrees: 45 });

      const screenshot = await client.callTool({ name: 'editor_screenshot', arguments: { width: 640, height: 360 } });
      expect(screenshot.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'image', mimeType: 'image/png', data: 'c2NyZWVuc2hvdA==' }),
      ]));

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

      const richerGeometry = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 5,
          label: 'MCP: Add stairs',
          operations: [{
            type: 'create_stairs', id: 'stairs', mins: [0, 0, 0], maxs: [256, 128, 128],
            direction: 'x+', steps: 8, texture: 'base_floor/stone',
          }],
        },
      });
      expect(richerGeometry.isError).not.toBe(true);
      expect(richerGeometry.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Aliases: {"@stairs"') }),
      ]));

      const faceEdit = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 6,
          label: 'MCP: Texture and classify trim',
          operations: [
            { type: 'edit_faces', targets: ['E0:B0:F4'], texture: 'base_trim/metal', fit: true },
            { type: 'set_brush_classification', targets: ['E0:B0'], classification: 'detail' },
          ],
        },
      });
      expect(faceEdit.isError).not.toBe(true);

      const invalid = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 7,
          label: 'MCP: Invalid box',
          operations: [{ type: 'create_box', mins: [0, 0, 0] }],
        },
      });
      expect(invalid.isError).toBe(true);
      expect(invalid.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Invalid operation 1') }),
      ]));
    } finally {
      await client.close();
      await server.close();
    }
  });
});
