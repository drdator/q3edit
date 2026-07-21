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
    } else if (request.type === 'preview_operations') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: {
          revision: request.expectedRevision, operationCount: request.operations.length,
          created: ['E0:B0'], changed: [], aliases: {},
          objects: [{ ref: 'E0:B0', kind: 'brush', bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] } }],
          mapText: '// live map\n',
          diagnostics: [],
        },
      }));
    } else if (request.type === 'new_document') {
      queueMicrotask(() => this.emitMessage({
        type: 'document_replaced', requestId: request.requestId,
        snapshot: { ...snapshot(request.expectedRevision + 1), fileName: request.fileName },
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
    } else if (request.type === 'texture_inspect') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { name: request.name, found: true, shader: true, previewAvailable: true, shaderMetadata: { surfaceParms: ['sky'] } },
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
    } else if (request.type === 'editor_capabilities') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: {
          project: { name: 'Quake III Arena', gameDirectory: 'baseq3', assetsConfigured: true },
          assets: { texturesLoaded: 1200, entityClassesLoaded: 80 },
          document: { fileName: 'live.map', revision: 4 },
        },
      }));
    } else if (request.type === 'map_compile') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { success: true, quality: request.quality, bspBytes: 4096, leaked: false, pointfileLoaded: false, output: ['BSP done'] },
      }));
    } else if (request.type === 'map_play') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: { launched: true, mapName: 'live', revision: 4, noclip: request.noclip },
      }));
    } else if (request.type === 'game_screenshot') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: {
          mimeType: 'image/png', data: 'Z2FtZQ==', width: 1280, height: 720,
          blackFrame: false, meanLuminance: 42,
          status: { state: 'running', message: 'Running live', mapName: 'live', noclip: true, launchedAt: 'now', runningAt: 'now', error: null, consoleTail: [] },
        },
      }));
    } else if (request.type === 'game_status' || request.type === 'game_wait_ready' || request.type === 'game_command' || request.type === 'game_set_view') {
      queueMicrotask(() => this.emitMessage({
        type: 'capability_result', requestId: request.requestId,
        result: {
          state: request.type === 'game_command' || request.type === 'game_set_view' ? 'preparing' : 'running',
          message: 'Running live', mapName: 'live', noclip: true,
          launchedAt: 'now', runningAt: 'now', error: null, consoleTail: [],
        },
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
  hub.attachEditor(socket as unknown as WebSocket, 'editor-a');
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

  test('keeps multiple editor sessions stable and rejects ambiguous routing', async () => {
    const hub = new BridgeHub();
    const first = new FakeEditorSocket();
    const second = new FakeEditorSocket();
    hub.attachEditor(first as unknown as WebSocket, 'editor-a');
    hub.attachEditor(second as unknown as WebSocket, 'editor-b');
    first.emitMessage({ type: 'editor_ready', snapshot: { ...snapshot(4), fileName: 'first.map' } });
    second.emitMessage({ type: 'editor_ready', snapshot: { ...snapshot(10), fileName: 'second.map' } });

    expect(() => hub.status()).toThrow(/Multiple Q3Edit editor sessions/);
    expect(hub.status('editor-a')).toMatchObject({ sessionId: 'editor-a', snapshot: { fileName: 'first.map', revision: 4 } });
    expect(hub.status('editor-b')).toMatchObject({ sessionId: 'editor-b', snapshot: { fileName: 'second.map', revision: 10 } });

    await hub.applyOperations(4, 'MCP: First only', [
      { type: 'create_box', mins: [0, 0, 0], maxs: [32, 32, 32] },
    ], 'editor-a');
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
    expect(hub.status('editor-a').snapshot?.revision).toBe(5);
    expect(hub.status('editor-b').snapshot?.revision).toBe(10);
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
    const { hub, socket } = connectedHub();
    const server = createQ3EditMcpServer(hub);
    const client = new Client({ name: 'q3edit-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual([
        'editor_sessions',
        'editor_session_select',
        'map_status',
        'map_capabilities',
        'operation_schema',
        'map_entities',
        'map_inspect',
        'map_validate',
        'map_gameplay_lint',
        'map_analyze_jump_pad',
        'map_route_lint',
        'map_compile',
        'map_play',
        'map_groups',
        'map_query',
        'texture_search',
        'texture_preview',
        'texture_inspect',
        'texture_preview_many',
        'entity_class_search',
        'entity_class_schema',
        'editor_select',
        'editor_frame_objects',
        'editor_set_camera',
        'editor_look_at',
        'editor_screenshot',
        'game_screenshot',
        'game_status',
        'game_wait_ready',
        'game_command',
        'game_set_view',
        'map_preview',
        'map_create_jump_pad',
        'map_create_teleporter',
        'map_apply',
        'map_new',
        'map_open',
        'map_save',
      ]);
      const applySchema = tools.tools.find(tool => tool.name === 'map_apply')?.inputSchema;
      expect(JSON.stringify(applySchema)).not.toMatch(/"(?:anyOf|oneOf)"/);
      expect(JSON.stringify(applySchema)).not.toMatch(/"items":\s*\[/);

      const status = await client.callTool({ name: 'map_status', arguments: {} });
      expect(status.structuredContent).toMatchObject({ sessionId: 'editor-a', editorConnected: true, snapshot: { revision: 4 } });

      const capabilities = await client.callTool({ name: 'map_capabilities', arguments: {} });
      expect(capabilities.structuredContent).toMatchObject({
        sessionId: 'editor-a', protocolVersion: 2,
        operations: { maxPerBatch: 128 },
        screenshots: { maxWidth: 2048, modes: ['perspective', 'top', 'front', 'side'] },
        compiler: { available: false },
        editor: { project: { gameDirectory: 'baseq3' } },
      });

      const jumpSchema = await client.callTool({ name: 'operation_schema', arguments: { type: 'create_jump_pad' } });
      expect(jumpSchema.structuredContent).toMatchObject({
        type: 'create_jump_pad',
        required: ['type', 'mins', 'maxs', 'apex'],
        notes: expect.arrayContaining([expect.stringContaining('apex is required')]),
      });
      const jumpJson = JSON.stringify((jumpSchema.structuredContent as { jsonSchema: unknown }).jsonSchema);
      expect(jumpJson).toContain('"apex"');
      expect(jumpJson).not.toContain('"destination"');

      const sessions = await client.callTool({ name: 'editor_sessions', arguments: {} });
      expect(sessions.structuredContent).toMatchObject({
        selectedSessionId: null,
        sessions: [{ sessionId: 'editor-a', fileName: 'live.map', revision: 4 }],
      });
      const selected = await client.callTool({ name: 'editor_session_select', arguments: { sessionId: 'editor-a' } });
      expect(selected.structuredContent).toMatchObject({ selectedSessionId: 'editor-a' });

      const lint = await client.callTool({ name: 'map_gameplay_lint', arguments: {} });
      expect(lint.structuredContent).toMatchObject({ revision: 4, issueCount: 0 });

      const jumpAnalysis = await client.callTool({
        name: 'map_analyze_jump_pad',
        arguments: { mins: [0, 0, 0], maxs: [64, 64, 16], apex: [160, 32, 136] },
      });
      expect(jumpAnalysis.structuredContent).toMatchObject({
        sessionId: 'editor-a', revision: 4, gravity: 800,
        launchOrigin: [32, 32, 8], apex: [160, 32, 136],
        landing: { supported: false }, clearance: { clear: true },
      });

      const routes = await client.callTool({ name: 'map_route_lint', arguments: {} });
      expect(routes.structuredContent).toMatchObject({ sessionId: 'editor-a', revision: 4 });

      const compiled = await client.callTool({ name: 'map_compile', arguments: { quality: 'fast' } });
      expect(compiled.structuredContent).toMatchObject({ success: true, quality: 'fast', bspBytes: 4096, leaked: false });

      const played = await client.callTool({ name: 'map_play', arguments: { quality: 'fast', noclip: true } });
      expect(played.structuredContent).toMatchObject({ launch: { launched: true, noclip: true } });

      const gameScreenshot = await client.callTool({ name: 'game_screenshot', arguments: {} });
      expect(gameScreenshot.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'image', data: 'Z2FtZQ==' }),
      ]));
      expect(gameScreenshot.structuredContent).toMatchObject({ blackFrame: false, meanLuminance: 42, status: { state: 'running' } });

      const gameStatus = await client.callTool({ name: 'game_status', arguments: {} });
      expect(gameStatus.structuredContent).toMatchObject({ sessionId: 'editor-a', state: 'running', mapName: 'live' });
      const gameReady = await client.callTool({ name: 'game_wait_ready', arguments: { timeoutMs: 5000 } });
      expect(gameReady.structuredContent).toMatchObject({ state: 'running' });
      const gameView = await client.callTool({
        name: 'game_set_view', arguments: { position: [128, 64, 96], yawDegrees: 90 },
      });
      expect(gameView.structuredContent).toMatchObject({ state: 'preparing', position: [128, 64, 96], yawDegrees: 90 });

      const groups = await client.callTool({ name: 'map_groups', arguments: {} });
      expect(groups.structuredContent).toMatchObject({ revision: 4, groups: [] });

      const previewed = await client.callTool({
        name: 'map_preview',
        arguments: {
          expectedRevision: 4, label: 'MCP: Preview box',
          operations: [{ type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64] }],
        },
      });
      expect(previewed.structuredContent).toMatchObject({
        revision: 4, created: ['E0:B0'], objects: [{ bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] } }],
        gameplayLint: { beforeCount: 0, afterCount: 0, added: [], resolved: [] },
      });
      expect((previewed.structuredContent as Record<string, unknown>).mapText).toBeUndefined();

      const jumpPad = await client.callTool({
        name: 'map_create_jump_pad',
        arguments: { expectedRevision: 4, mins: [0, 0, 0], maxs: [64, 64, 16], apex: [160, 0, 192] },
      });
      expect(jumpPad.structuredContent).toMatchObject({
        sessionId: 'editor-a', revision: 5, operationCount: 1, targetname: 'mcp_jump_4',
        aliases: { '@jump_pad': ['E0:B0'] },
      });

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

      const textureInspection = await client.callTool({ name: 'texture_inspect', arguments: { name: 'skies/space' } });
      expect(textureInspection.structuredContent).toMatchObject({
        sessionId: 'editor-a', name: 'skies/space', shader: true, shaderMetadata: { surfaceParms: ['sky'] },
      });

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

      const screenshot = await client.callTool({
        name: 'editor_screenshot',
        arguments: { mode: 'top', width: 640, height: 360, frameGroup: 'reactor', hideSkyBrushes: true },
      });
      expect(screenshot.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'image', mimeType: 'image/png', data: 'c2NyZWVuc2hvdA==' }),
      ]));
      expect(JSON.parse(socket.sent.find(value => JSON.parse(value).type === 'editor_screenshot')!)).toMatchObject({
        type: 'editor_screenshot', mode: 'top', frameGroup: 'reactor', hideSkyBrushes: true,
      });

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

      const gameplayBatch = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 6,
          label: 'MCP: Add traversal',
          operations: [{
            type: 'create_jump_pad', id: 'rail_jump', mins: [0, 0, 0], maxs: [64, 64, 16],
            apex: [256, 32, 192], group: 'Traversal', groupId: 'traversal',
          }],
        },
      });
      expect(gameplayBatch.isError).not.toBe(true);

      const faceEdit = await client.callTool({
        name: 'map_apply',
        arguments: {
          expectedRevision: 7,
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
          expectedRevision: 8,
          label: 'MCP: Invalid box',
          operations: [{ type: 'create_box', mins: [0, 0, 0] }],
        },
      });
      expect(invalid.isError).toBe(true);
      expect(invalid.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Invalid operation 1') }),
      ]));

      const fresh = await client.callTool({
        name: 'map_new',
        arguments: {
          expectedRevision: 8, template: 'empty', preserveWorldspawn: false,
          worldspawnProperties: { message: 'Agent Arena' }, fileName: 'agent-arena.map',
        },
      });
      expect(fresh.structuredContent).toMatchObject({
        sessionId: 'editor-a', fileName: 'agent-arena.map', revision: 9,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
