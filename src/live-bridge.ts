import { collectEditorDiagnostics, collectEntityInfo, collectMapInfo } from './diagnostics';
import type { Editor } from './editor';
import type { BridgeToEditorMessage, EditorToBridgeMessage, LiveMapSnapshot } from './live-bridge-protocol';
import { applyMapOperations } from './map-operations';

export type LiveBridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

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

  constructor(private readonly editor: Editor, private readonly url: string) {
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
    socket.addEventListener('message', event => this.handleMessage(String(event.data)));
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

  private handleMessage(raw: string): void {
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

export function connectConfiguredLiveBridge(editor: Editor): LiveMapBridge | null {
  const url = configuredBridgeUrl();
  if (!url) return null;
  const bridge = new LiveMapBridge(editor, url);
  bridge.connect();
  return bridge;
}
