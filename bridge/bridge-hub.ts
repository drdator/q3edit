import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { WebSocket } from 'ws';
import type { BridgeToEditorMessage, EditorScreenshotOptions, EditorToBridgeMessage, GamePreviewStatus, GameScreenshot, LiveMapSnapshot, McpActivityEntry } from '../src/live-bridge-protocol';
import type { MapOperation, MapOperationResult } from '../src/map-operations';

interface PendingRequest {
  resolve: (message: EditorToBridgeMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeStatus {
  sessionId: string;
  editorConnected: boolean;
  activeMapPath: string | null;
  snapshot: Omit<LiveMapSnapshot, 'mapText'> | null;
}

export interface EditorSessionSummary {
  sessionId: string;
  connected: boolean;
  fileName: string | null;
  revision: number | null;
  activeMapPath: string | null;
  connectedAt: string;
  lastActiveAt: string;
}

interface EditorSession {
  id: string;
  socket: WebSocket;
  snapshot: LiveMapSnapshot | null;
  pending: Map<string, PendingRequest>;
  activeMapPath: string | null;
  connectedAt: number;
  lastActiveAt: number;
}

export class BridgeHub {
  private sessions = new Map<string, EditorSession>();
  private activityEntries: McpActivityEntry[] = [];

  constructor(readonly compilerAvailable = false) {}

  attachEditor(socket: WebSocket, requestedSessionId: string = randomUUID()): string {
    const sessionId = requestedSessionId.trim() || randomUUID();
    const previous = this.sessions.get(sessionId);
    const now = Date.now();
    if (previous) {
      for (const [requestId, pending] of previous.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Editor session ${sessionId} reconnected while handling ${requestId}`));
      }
      previous.socket.close(1012, 'This Q3Edit session reconnected');
    }
    const session: EditorSession = {
      id: sessionId,
      socket,
      snapshot: previous?.snapshot ?? null,
      pending: new Map(),
      activeMapPath: previous?.activeMapPath ?? null,
      connectedAt: previous?.connectedAt ?? now,
      lastActiveAt: now,
    };
    this.sessions.set(sessionId, session);
    socket.on('message', data => this.handleEditorMessage(session, String(data)));
    socket.on('close', () => {
      if (this.sessions.get(sessionId)?.socket !== socket) return;
      this.sessions.delete(sessionId);
      for (const [requestId, pending] of session.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Editor session ${sessionId} disconnected while handling ${requestId}`));
      }
      session.pending.clear();
    });
    for (const entry of this.activityEntries) {
      if (entry.editorSessionId === null || entry.editorSessionId === sessionId) {
        socket.send(JSON.stringify({ type: 'mcp_activity', entry } satisfies BridgeToEditorMessage));
      }
    }
    return sessionId;
  }

  publishMcpActivity(entry: McpActivityEntry): void {
    this.activityEntries.push(entry);
    if (this.activityEntries.length > 2_000) this.activityEntries.splice(0, this.activityEntries.length - 2_000);
    const message = JSON.stringify({ type: 'mcp_activity', entry } satisfies BridgeToEditorMessage);
    for (const session of this.sessions.values()) {
      if (entry.editorSessionId !== null && entry.editorSessionId !== session.id) continue;
      if (session.socket.readyState === 1) session.socket.send(message);
    }
  }

  listSessions(): EditorSessionSummary[] {
    return [...this.sessions.values()].map(session => ({
      sessionId: session.id,
      connected: session.socket.readyState === 1,
      fileName: session.snapshot?.fileName ?? null,
      revision: session.snapshot?.revision ?? null,
      activeMapPath: session.activeMapPath,
      connectedAt: new Date(session.connectedAt).toISOString(),
      lastActiveAt: new Date(session.lastActiveAt).toISOString(),
    })).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  }

  resolveSessionId(requestedSessionId?: string): string {
    if (requestedSessionId) {
      if (!this.sessions.has(requestedSessionId)) throw new Error(`Q3Edit editor session ${requestedSessionId} is not connected`);
      return requestedSessionId;
    }
    const connected = [...this.sessions.values()].filter(session => session.socket.readyState === 1);
    if (connected.length === 0) throw new Error('No Q3Edit browser is connected; open the bridge editor URL first');
    if (connected.length > 1) throw new Error(`Multiple Q3Edit editor sessions are connected (${connected.map(session => session.id).join(', ')}); pass sessionId or call editor_session_select`);
    return connected[0].id;
  }

  status(sessionId?: string): BridgeStatus {
    const session = this.session(sessionId);
    const snapshot = session.snapshot;
    return {
      sessionId: session.id,
      editorConnected: session.socket.readyState === 1,
      activeMapPath: session.activeMapPath,
      snapshot: snapshot ? {
        fileName: snapshot.fileName,
        revision: snapshot.revision,
        mapInfo: snapshot.mapInfo,
        entities: snapshot.entities,
        diagnostics: snapshot.diagnostics,
      } : null,
    };
  }

  snapshot(sessionId?: string): LiveMapSnapshot {
    const session = this.session(sessionId);
    if (!session.snapshot) throw new Error(`Q3Edit editor session ${session.id} has not sent its document yet`);
    return session.snapshot;
  }

  async applyOperations(expectedRevision: number, label: string, operations: MapOperation[], sessionId?: string): Promise<{ result: MapOperationResult; snapshot: LiveMapSnapshot }> {
    const message = await this.request(sessionId, {
      type: 'apply_operations',
      requestId: randomUUID(),
      expectedRevision,
      label,
      operations,
    });
    if (message.type !== 'operation_result') throw new Error('Editor returned an unexpected operation response');
    return { result: message.result, snapshot: message.snapshot };
  }

  async previewOperations(expectedRevision: number, label: string, operations: MapOperation[], sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, {
      type: 'preview_operations', requestId: randomUUID(), expectedRevision, label, operations,
    });
  }

  async openMap(path: string, sessionId?: string): Promise<LiveMapSnapshot> {
    const mapText = await readFile(path, 'utf8');
    const session = this.session(sessionId);
    const message = await this.request(session.id, {
      type: 'replace_document',
      requestId: randomUUID(),
      fileName: basename(path),
      mapText,
    });
    if (message.type !== 'document_replaced') throw new Error('Editor returned an unexpected open response');
    session.activeMapPath = path;
    return message.snapshot;
  }

  async newMap(options: {
    expectedRevision: number;
    template: 'empty' | 'starter';
    preserveWorldspawn: boolean;
    worldspawnProperties?: Record<string, string>;
    fileName: string;
  }, sessionId?: string): Promise<LiveMapSnapshot> {
    const session = this.session(sessionId);
    const message = await this.request(session.id, {
      type: 'new_document', requestId: randomUUID(), ...options,
    });
    if (message.type !== 'document_replaced') throw new Error('Editor returned an unexpected new-map response');
    session.activeMapPath = null;
    return message.snapshot;
  }

  async requestSnapshot(sessionId?: string): Promise<LiveMapSnapshot> {
    const message = await this.request(sessionId, { type: 'request_snapshot', requestId: randomUUID() });
    if (message.type !== 'snapshot') throw new Error('Editor returned an unexpected snapshot response');
    return message.snapshot;
  }

  async textureSearch(query: string, limit: number, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'texture_search', requestId: randomUUID(), query, limit });
  }

  async texturePreview(name: string, sessionId?: string): Promise<{ name: string; mimeType: string; data: string }> {
    return await this.capabilityRequest(sessionId, { type: 'texture_preview', requestId: randomUUID(), name }) as { name: string; mimeType: string; data: string };
  }

  async textureInspect(name: string, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'texture_inspect', requestId: randomUUID(), name });
  }

  async texturePreviews(names: string[], sessionId?: string): Promise<Array<{ name: string; mimeType: string; data: string }>> {
    const resolvedSessionId = this.resolveSessionId(sessionId);
    return Promise.all(names.map(name => this.texturePreview(name, resolvedSessionId)));
  }

  async entityClassSearch(query: string, classType: 'point' | 'brush' | undefined, limit: number, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'entity_class_search', requestId: randomUUID(), query, classType, limit });
  }

  async entityClassSchema(classname: string, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'entity_class_schema', requestId: randomUUID(), classname });
  }

  async selectObjects(refs: string[], replace: boolean, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'editor_select', requestId: randomUUID(), refs, replace });
  }

  async frameObjects(refs: string[], sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'editor_frame_objects', requestId: randomUUID(), refs });
  }

  async setCamera(position: [number, number, number], yaw: number, pitch: number, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'editor_set_camera', requestId: randomUUID(), position, yaw, pitch });
  }

  async editorCapabilities(sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'editor_capabilities', requestId: randomUUID() });
  }

  async screenshot(options: EditorScreenshotOptions, sessionId?: string): Promise<{
    mimeType: string; data: string; width: number; height: number;
    gridSize?: number; majorGridSize?: number; axisLabels?: [string, string]; worldUnitsPerPixel?: number;
  }> {
    return await this.capabilityRequest(sessionId, { type: 'editor_screenshot', requestId: randomUUID(), ...options }) as {
      mimeType: string; data: string; width: number; height: number;
      gridSize?: number; majorGridSize?: number; axisLabels?: [string, string]; worldUnitsPerPixel?: number;
    };
  }

  async compileMap(quality: 'fast' | 'normal' | 'full', sessionId?: string, artifactPath?: string): Promise<unknown> {
    const result = await this.capabilityRequest(sessionId, {
      type: 'map_compile', requestId: randomUUID(), quality, includeArtifact: Boolean(artifactPath),
    }, 180_000) as Record<string, unknown>;
    if (!artifactPath) return result;
    const bspBase64 = result.bspBase64;
    if (result.success !== true || typeof bspBase64 !== 'string') {
      const safe = { ...result }; delete safe.bspBase64;
      return safe;
    }
    const temporaryPath = join(dirname(artifactPath), `.${basename(artifactPath)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, Buffer.from(bspBase64, 'base64'));
    await rename(temporaryPath, artifactPath);
    const safe: Record<string, unknown> = { ...result, artifact: { path: artifactPath, bytes: Buffer.byteLength(bspBase64, 'base64') } };
    delete safe.bspBase64;
    return safe;
  }

  async playMap(noclip: boolean, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'map_play', requestId: randomUUID(), noclip });
  }

  async historyAction(action: 'undo' | 'redo', expectedRevision: number, sessionId?: string): Promise<unknown> {
    return this.capabilityRequest(sessionId, { type: 'history_action', requestId: randomUUID(), action, expectedRevision });
  }

  async gameStatus(sessionId?: string): Promise<GamePreviewStatus> {
    return await this.capabilityRequest(sessionId, { type: 'game_status', requestId: randomUUID() }) as GamePreviewStatus;
  }

  async waitForGameReady(timeoutMs: number, sessionId?: string): Promise<GamePreviewStatus> {
    return await this.capabilityRequest(sessionId, {
      type: 'game_wait_ready', requestId: randomUUID(), timeoutMs,
    }, timeoutMs + 5_000) as GamePreviewStatus;
  }

  async gameCommand(command: 'noclip' | 'restart', sessionId?: string): Promise<GamePreviewStatus> {
    return await this.capabilityRequest(sessionId, { type: 'game_command', requestId: randomUUID(), command }) as GamePreviewStatus;
  }

  async setGameView(position: [number, number, number], yaw: number, sessionId?: string): Promise<GamePreviewStatus> {
    return await this.capabilityRequest(sessionId, { type: 'game_set_view', requestId: randomUUID(), position, yaw }) as GamePreviewStatus;
  }

  async gameScreenshot(sessionId?: string): Promise<GameScreenshot> {
    return await this.capabilityRequest(sessionId, { type: 'game_screenshot', requestId: randomUUID() }) as GameScreenshot;
  }

  async saveMap(path?: string, sessionId?: string): Promise<{ path: string; revision: number }> {
    const session = this.session(sessionId);
    path ??= session.activeMapPath ?? undefined;
    if (!path) throw new Error('No map path is active; pass a path to map_save or call map_open first');
    const snapshot = await this.requestSnapshot(session.id);
    const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, snapshot.mapText, 'utf8');
    await rename(temporaryPath, path);
    session.activeMapPath = path;
    const fileName = basename(path);
    session.snapshot = { ...snapshot, fileName };
    this.send(session, { type: 'mark_saved', revision: snapshot.revision, fileName });
    return { path, revision: snapshot.revision };
  }

  private session(sessionId?: string): EditorSession {
    const resolvedSessionId = this.resolveSessionId(sessionId);
    return this.sessions.get(resolvedSessionId)!;
  }

  private request(sessionId: string | undefined, message: BridgeToEditorMessage & { requestId: string }, timeoutMs = 30_000): Promise<EditorToBridgeMessage> {
    const session = this.session(sessionId);
    if (session.socket.readyState !== 1) return Promise.reject(new Error(`Q3Edit editor session ${session.id} is not connected`));
    session.lastActiveAt = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(message.requestId);
        reject(new Error(`Editor session ${session.id} request ${message.requestId} timed out`));
      }, timeoutMs);
      session.pending.set(message.requestId, { resolve, reject, timer });
      this.send(session, message);
    });
  }

  private async capabilityRequest(sessionId: string | undefined, message: BridgeToEditorMessage & { requestId: string }, timeoutMs?: number): Promise<unknown> {
    const response = await this.request(sessionId, message, timeoutMs);
    if (response.type !== 'capability_result') throw new Error('Editor returned an unexpected capability response');
    return response.result;
  }

  private send(session: EditorSession, message: BridgeToEditorMessage): void {
    if (session.socket.readyState !== 1) throw new Error(`Q3Edit editor session ${session.id} is not connected`);
    session.socket.send(JSON.stringify(message));
  }

  private handleEditorMessage(session: EditorSession, raw: string): void {
    let message: EditorToBridgeMessage;
    try {
      message = JSON.parse(raw) as EditorToBridgeMessage;
    } catch {
      console.warn('Ignored malformed message from Q3Edit');
      return;
    }

    session.lastActiveAt = Date.now();
    const previousFileName = session.snapshot?.fileName;
    if ('snapshot' in message && message.snapshot) session.snapshot = message.snapshot;
    if (message.type === 'editor_ready') {
      if (previousFileName && previousFileName !== message.snapshot.fileName) session.activeMapPath = null;
      return;
    }
    if (message.type === 'document_changed') {
      if (previousFileName && previousFileName !== message.snapshot.fileName) session.activeMapPath = null;
      return;
    }

    const requestId = message.requestId;
    const pending = session.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    session.pending.delete(requestId);
    if (message.type === 'operation_error') pending.reject(new Error(`Editor session ${session.id}: ${message.message}`));
    else pending.resolve(message);
  }
}
