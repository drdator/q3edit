import { collectEditorDiagnostics, collectEntityInfo, collectMapInfo } from './diagnostics';
import type { Editor } from './editor';
import type { SelectionItem } from './editor';
import type { Vec3 } from './math';
import type { BridgeToEditorMessage, EditorToBridgeMessage, LiveMapSnapshot } from './live-bridge-protocol';
import { applyMapOperations } from './map-operations';
import { getEntityClassRegistry } from './entity-definitions';

export type LiveBridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface LiveBridgeEditorControls {
  setCamera(position: Vec3, yaw: number, pitch: number): void;
  captureScreenshot(width?: number, height?: number): { mimeType: string; data: string; width: number; height: number };
}

function selectionForRef(editor: Editor, ref: string): SelectionItem {
  const match = /^E(\d+)(?::([BP])(\d+))?$/.exec(ref);
  if (!match) throw new Error(`Invalid object reference ${ref}`);
  const entity = editor.entities[Number(match[1])];
  if (!entity) throw new Error(`Entity ${ref} does not exist`);
  if (!match[2]) return { type: 'entity', entity };
  const index = Number(match[3]);
  if (match[2] === 'B') {
    const brush = entity.brushes[index];
    if (!brush) throw new Error(`Brush ${ref} does not exist`);
    return { type: 'brush', entity, brush };
  }
  const patch = entity.patches[index];
  if (!patch) throw new Error(`Patch ${ref} does not exist`);
  return { type: 'patch', entity, patch };
}

function selectionKey(item: SelectionItem): object {
  if (item.type === 'brush' || item.type === 'face') return item.brush;
  if (item.type === 'patch') return item.patch;
  return item.entity;
}

function configuredBridgeUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('bridge');
  if (!value) return null;
  if (value === '1' || value === 'true') {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/editor`;
  }
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url.toString();
  } catch {
    return null;
  }
}

export class LiveMapBridge {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private suppressDocumentSync = false;
  private stopped = false;

  constructor(
    private readonly editor: Editor,
    private readonly url: string,
    private readonly controls: LiveBridgeEditorControls,
  ) {
    editor.subscribeDocumentChanges(change => {
      if (this.suppressDocumentSync || this.socket?.readyState !== WebSocket.OPEN) return;
      try {
        this.send({ type: 'document_changed', label: change.label, snapshot: this.snapshot() });
      } catch (error) {
        console.warn('Could not synchronize editor document with the live bridge', error);
      }
    });
  }

  connect(): void {
    if (this.stopped || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.setStatus('connecting', 'MCP connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.setStatus('connected', 'MCP connected');
      this.send({ type: 'editor_ready', snapshot: this.snapshot() });
    });
    socket.addEventListener('message', event => { void this.handleMessage(String(event.data)); });
    socket.addEventListener('error', () => this.setStatus('error', 'MCP connection error'));
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.setStatus('disconnected', 'MCP disconnected');
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
    });
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected', 'MCP disconnected');
  }

  private snapshot(): LiveMapSnapshot {
    const diagnostics = collectEditorDiagnostics(this.editor);
    return {
      fileName: this.editor.fileName,
      mapText: this.editor.serializeMap(),
      revision: this.editor.documentRevision,
      mapInfo: collectMapInfo(this.editor, diagnostics),
      entities: collectEntityInfo(this.editor, diagnostics),
      diagnostics,
    };
  }

  private send(message: EditorToBridgeMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: BridgeToEditorMessage;
    try {
      message = JSON.parse(raw) as BridgeToEditorMessage;
    } catch {
      console.warn('Ignored malformed live bridge message');
      return;
    }

    if (message.type === 'apply_operations') {
      if (message.expectedRevision !== this.editor.documentRevision) {
        this.send({
          type: 'operation_error',
          requestId: message.requestId,
          message: `Revision conflict: expected ${message.expectedRevision}, current revision is ${this.editor.documentRevision}`,
          revision: this.editor.documentRevision,
        });
        return;
      }
      this.suppressDocumentSync = true;
      try {
        const result = applyMapOperations(this.editor, message.operations, message.label);
        this.editor.statusMessage = `${message.label}: ${result.summary}`;
        this.send({ type: 'operation_result', requestId: message.requestId, result, snapshot: this.snapshot() });
      } catch (error) {
        this.send({
          type: 'operation_error',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
          revision: this.editor.documentRevision,
        });
      } finally {
        this.suppressDocumentSync = false;
      }
      return;
    }

    if (message.type === 'replace_document') {
      this.suppressDocumentSync = true;
      try {
        this.editor.fileName = message.fileName;
        this.editor.loadMap(message.mapText);
        this.editor.markDocumentSaved();
        this.editor.statusMessage = `MCP opened ${message.fileName}`;
        this.send({ type: 'document_replaced', requestId: message.requestId, snapshot: this.snapshot() });
      } catch (error) {
        this.send({
          type: 'operation_error',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
          revision: this.editor.documentRevision,
        });
      } finally {
        this.suppressDocumentSync = false;
      }
      return;
    }

    if (message.type === 'request_snapshot') {
      this.send({ type: 'snapshot', requestId: message.requestId, snapshot: this.snapshot() });
      return;
    }

    if (message.type === 'texture_search') {
      const manager = this.editor.textureManager;
      if (!manager) {
        this.send({ type: 'operation_error', requestId: message.requestId, message: 'Texture assets are still loading', revision: this.editor.documentRevision });
        return;
      }
      const query = message.query.trim().toLowerCase();
      const matches = manager.listTextures()
        .filter(name => !query || name.toLowerCase().includes(query))
        .slice(0, message.limit)
        .map(name => {
          const asset = manager.getTextureAsset(name);
          return {
            name,
            archive: asset?.source.archiveName,
            sourcePath: asset?.path,
            overriddenSources: asset?.overriddenSources.length ?? 0,
          };
        });
      this.send({ type: 'capability_result', requestId: message.requestId, result: { query: message.query, matches } });
      return;
    }

    if (message.type === 'texture_preview') {
      try {
        const manager = this.editor.textureManager;
        if (!manager) throw new Error('Texture assets are still loading');
        const url = manager.getThumbnailUrl(message.name);
        if (!url) throw new Error(`Texture ${message.name} was not found`);
        const dataUrl = url.startsWith('data:') ? url : await new Promise<string>((resolve, reject) => {
          fetch(url).then(response => response.blob()).then(blob => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error('Could not read texture preview'));
            reader.readAsDataURL(blob);
          }).catch(reject);
        });
        const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
        if (!match) throw new Error(`Texture ${message.name} could not be encoded for MCP`);
        this.send({
          type: 'capability_result',
          requestId: message.requestId,
          result: { name: message.name, mimeType: match[1], data: match[2] },
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
          revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'entity_class_search') {
      const query = message.query.trim().toLowerCase();
      const matches = getEntityClassRegistry().list()
        .filter(definition => (!message.classType || definition.type === message.classType) && (
          !query || definition.classname.toLowerCase().includes(query) ||
          definition.category.toLowerCase().includes(query) ||
          definition.description.toLowerCase().includes(query)
        ))
        .slice(0, message.limit)
        .map(definition => ({
          classname: definition.classname,
          type: definition.type,
          category: definition.category,
          description: definition.description,
          defaults: definition.defaults,
          propertyKeys: Object.keys(definition.properties),
          spawnflagCount: definition.spawnflags.length,
          source: definition.source,
        }));
      this.send({ type: 'capability_result', requestId: message.requestId, result: { query: message.query, matches } });
      return;
    }

    if (message.type === 'entity_class_schema') {
      const definition = getEntityClassRegistry().get(message.classname);
      if (!definition) {
        this.send({ type: 'operation_error', requestId: message.requestId, message: `Entity class ${message.classname} was not found`, revision: this.editor.documentRevision });
        return;
      }
      this.send({ type: 'capability_result', requestId: message.requestId, result: definition });
      return;
    }

    if (message.type === 'editor_select' || message.type === 'editor_frame_objects') {
      try {
        const requested = message.refs.map(ref => selectionForRef(this.editor, ref));
        const combined = message.type === 'editor_select' && !message.replace
          ? [...this.editor.selection, ...requested]
          : requested;
        const seen = new Set<object>();
        this.editor.selection = combined.filter(item => {
          const key = selectionKey(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (message.type === 'editor_frame_objects') this.editor.centerOnSelection();
        this.editor.redrawRequested = true;
        this.editor.statusMessage = `MCP ${message.type === 'editor_frame_objects' ? 'framed' : 'selected'} ${message.refs.length} object${message.refs.length === 1 ? '' : 's'}`;
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: { refs: message.refs, selectionCount: this.editor.selection.length },
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'editor_set_camera') {
      this.controls.setCamera(message.position, message.yaw, message.pitch);
      this.editor.statusMessage = 'MCP positioned the 3D camera';
      this.send({
        type: 'capability_result', requestId: message.requestId,
        result: { position: message.position, yaw: message.yaw, pitch: message.pitch },
      });
      return;
    }

    if (message.type === 'editor_screenshot') {
      try {
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: this.controls.captureScreenshot(message.width, message.height),
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'mark_saved' && message.revision === this.editor.documentRevision) {
      this.editor.markDocumentSaved();
      this.editor.statusMessage = `MCP saved ${this.editor.fileName}`;
    }
  }

  private setStatus(status: LiveBridgeStatus, label: string): void {
    const element = document.getElementById('status-mcp');
    if (!element) return;
    element.textContent = label;
    element.className = `status-item status-mcp ${status}`;
    element.title = this.url;
  }
}

export function connectConfiguredLiveBridge(editor: Editor, controls: LiveBridgeEditorControls): LiveMapBridge | null {
  const url = configuredBridgeUrl();
  if (!url) return null;
  const bridge = new LiveMapBridge(editor, url, controls);
  bridge.connect();
  return bridge;
}
