import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { WebSocket } from 'ws';
import type { BridgeToEditorMessage, EditorToBridgeMessage, LiveMapSnapshot } from '../src/live-bridge-protocol';
import type { MapOperation, MapOperationResult } from '../src/map-operations';

interface PendingRequest {
  resolve: (message: EditorToBridgeMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeStatus {
  editorConnected: boolean;
  activeMapPath: string | null;
  snapshot: Omit<LiveMapSnapshot, 'mapText'> | null;
}

export class BridgeHub {
  private editorSocket: WebSocket | null = null;
  private currentSnapshot: LiveMapSnapshot | null = null;
  private pending = new Map<string, PendingRequest>();
  activeMapPath: string | null = null;

  attachEditor(socket: WebSocket): void {
    this.editorSocket?.close(1012, 'A newer Q3Edit connection replaced this editor');
    this.editorSocket = socket;
    socket.on('message', data => this.handleEditorMessage(String(data)));
    socket.on('close', () => {
      if (this.editorSocket !== socket) return;
      this.editorSocket = null;
      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Editor disconnected while handling ${requestId}`));
      }
      this.pending.clear();
    });
  }

  status(): BridgeStatus {
    const snapshot = this.currentSnapshot;
    return {
      editorConnected: this.editorSocket?.readyState === 1,
      activeMapPath: this.activeMapPath,
      snapshot: snapshot ? {
        fileName: snapshot.fileName,
        revision: snapshot.revision,
        mapInfo: snapshot.mapInfo,
        entities: snapshot.entities,
        diagnostics: snapshot.diagnostics,
      } : null,
    };
  }

  snapshot(): LiveMapSnapshot {
    if (!this.currentSnapshot) throw new Error('No Q3Edit browser is connected yet');
    return this.currentSnapshot;
  }

  async applyOperations(expectedRevision: number, label: string, operations: MapOperation[]): Promise<{ result: MapOperationResult; snapshot: LiveMapSnapshot }> {
    const message = await this.request({
      type: 'apply_operations',
      requestId: randomUUID(),
      expectedRevision,
      label,
      operations,
    });
    if (message.type !== 'operation_result') throw new Error('Editor returned an unexpected operation response');
    return { result: message.result, snapshot: message.snapshot };
  }

  async previewOperations(expectedRevision: number, label: string, operations: MapOperation[]): Promise<unknown> {
    return this.capabilityRequest({
      type: 'preview_operations', requestId: randomUUID(), expectedRevision, label, operations,
    });
  }

  async openMap(path: string): Promise<LiveMapSnapshot> {
    const mapText = await readFile(path, 'utf8');
    const message = await this.request({
      type: 'replace_document',
      requestId: randomUUID(),
      fileName: basename(path),
      mapText,
    });
    if (message.type !== 'document_replaced') throw new Error('Editor returned an unexpected open response');
    this.activeMapPath = path;
    return message.snapshot;
  }

  async requestSnapshot(): Promise<LiveMapSnapshot> {
    const message = await this.request({ type: 'request_snapshot', requestId: randomUUID() });
    if (message.type !== 'snapshot') throw new Error('Editor returned an unexpected snapshot response');
    return message.snapshot;
  }

  async textureSearch(query: string, limit: number): Promise<unknown> {
    return this.capabilityRequest({ type: 'texture_search', requestId: randomUUID(), query, limit });
  }

  async texturePreview(name: string): Promise<{ name: string; mimeType: string; data: string }> {
    return await this.capabilityRequest({ type: 'texture_preview', requestId: randomUUID(), name }) as { name: string; mimeType: string; data: string };
  }

  async texturePreviews(names: string[]): Promise<Array<{ name: string; mimeType: string; data: string }>> {
    return Promise.all(names.map(name => this.texturePreview(name)));
  }

  async entityClassSearch(query: string, classType: 'point' | 'brush' | undefined, limit: number): Promise<unknown> {
    return this.capabilityRequest({ type: 'entity_class_search', requestId: randomUUID(), query, classType, limit });
  }

  async entityClassSchema(classname: string): Promise<unknown> {
    return this.capabilityRequest({ type: 'entity_class_schema', requestId: randomUUID(), classname });
  }

  async selectObjects(refs: string[], replace: boolean): Promise<unknown> {
    return this.capabilityRequest({ type: 'editor_select', requestId: randomUUID(), refs, replace });
  }

  async frameObjects(refs: string[]): Promise<unknown> {
    return this.capabilityRequest({ type: 'editor_frame_objects', requestId: randomUUID(), refs });
  }

  async setCamera(position: [number, number, number], yaw: number, pitch: number): Promise<unknown> {
    return this.capabilityRequest({ type: 'editor_set_camera', requestId: randomUUID(), position, yaw, pitch });
  }

  async screenshot(width?: number, height?: number, hideEntityMarkers?: boolean): Promise<{ mimeType: string; data: string; width: number; height: number }> {
    return await this.capabilityRequest({ type: 'editor_screenshot', requestId: randomUUID(), width, height, hideEntityMarkers }) as {
      mimeType: string; data: string; width: number; height: number;
    };
  }

  async compileMap(quality: 'fast' | 'normal' | 'full'): Promise<unknown> {
    return this.capabilityRequest({ type: 'map_compile', requestId: randomUUID(), quality }, 180_000);
  }

  async playMap(noclip: boolean): Promise<unknown> {
    return this.capabilityRequest({ type: 'map_play', requestId: randomUUID(), noclip });
  }

  async gameScreenshot(): Promise<{ mimeType: string; data: string; width: number; height: number }> {
    return await this.capabilityRequest({ type: 'game_screenshot', requestId: randomUUID() }) as {
      mimeType: string; data: string; width: number; height: number;
    };
  }

  async saveMap(path = this.activeMapPath): Promise<{ path: string; revision: number }> {
    if (!path) throw new Error('No map path is active; pass a path to map_save or call map_open first');
    const snapshot = await this.requestSnapshot();
    const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, snapshot.mapText, 'utf8');
    await rename(temporaryPath, path);
    this.activeMapPath = path;
    this.send({ type: 'mark_saved', revision: snapshot.revision });
    return { path, revision: snapshot.revision };
  }

  private request(message: BridgeToEditorMessage & { requestId: string }, timeoutMs = 30_000): Promise<EditorToBridgeMessage> {
    if (!this.editorSocket || this.editorSocket.readyState !== 1) {
      return Promise.reject(new Error('No Q3Edit browser is connected; open the bridge editor URL first'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error(`Editor request ${message.requestId} timed out`));
      }, timeoutMs);
      this.pending.set(message.requestId, { resolve, reject, timer });
      this.send(message);
    });
  }

  private async capabilityRequest(message: BridgeToEditorMessage & { requestId: string }, timeoutMs?: number): Promise<unknown> {
    const response = await this.request(message, timeoutMs);
    if (response.type !== 'capability_result') throw new Error('Editor returned an unexpected capability response');
    return response.result;
  }

  private send(message: BridgeToEditorMessage): void {
    if (!this.editorSocket || this.editorSocket.readyState !== 1) throw new Error('No Q3Edit browser is connected');
    this.editorSocket.send(JSON.stringify(message));
  }

  private handleEditorMessage(raw: string): void {
    let message: EditorToBridgeMessage;
    try {
      message = JSON.parse(raw) as EditorToBridgeMessage;
    } catch {
      console.warn('Ignored malformed message from Q3Edit');
      return;
    }

    if ('snapshot' in message) this.currentSnapshot = message.snapshot;
    if (message.type === 'editor_ready') {
      this.activeMapPath = null;
      return;
    }
    if (message.type === 'document_changed') return;

    const requestId = message.requestId;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (message.type === 'operation_error') pending.reject(new Error(message.message));
    else pending.resolve(message);
  }
}
