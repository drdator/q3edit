import { collectEditorDiagnostics, collectEntityInfo, collectMapInfo } from './diagnostics';
import { Editor, type SelectionItem } from './editor';
import type { Vec3 } from './math';
import type { BridgeToEditorMessage, EditorScreenshotOptions, EditorToBridgeMessage, GamePreviewStatus, GameScreenshot, LiveMapSnapshot, ScreenshotBounds } from './live-bridge-protocol';
import { applyMapOperations } from './map-operations';
import { getEntityClassRegistry } from './entity-definitions';
import { collectCompileModelFiles, compileMap } from './q3map';
import { structureCompilerOutput } from './compile-diagnostics';
import { cloneMapSnapshot } from './history';
import { entityBounds } from './editor-queries';
import { createWorldspawn } from './entity';
import type { Entity } from './entity';
import type { Brush } from './brush';
import type { Patch } from './patch';
import {
  GROUP_HIDDEN_KEY,
  entityGroupId,
  isGroupInfoEntity,
  listNamedGroups,
} from './named-groups';

export type LiveBridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface LiveBridgeEditorControls {
  setCamera(position: Vec3, yaw: number, pitch: number): void;
  frameBounds(bounds: ScreenshotBounds): void;
  captureScreenshot(mode: NonNullable<EditorScreenshotOptions['mode']>, width?: number, height?: number, xray?: boolean): { mimeType: string; data: string; width: number; height: number };
  launchBspPreview(mapName: string, bsp: Uint8Array, noclip: boolean): void;
  gameStatus(): GamePreviewStatus;
  waitForGameReady(timeoutMs: number): Promise<GamePreviewStatus>;
  gameCommand(command: 'noclip' | 'restart'): GamePreviewStatus;
  setGameView(position: Vec3, yaw: number): GamePreviewStatus;
  captureBspPreview(): GameScreenshot;
}

function intersectsBounds(a: ScreenshotBounds, b: ScreenshotBounds): boolean {
  return a.mins.every((value, axis) => value <= b.maxs[axis] && a.maxs[axis] >= b.mins[axis]);
}

function mergeBounds(bounds: ScreenshotBounds[]): ScreenshotBounds | null {
  if (bounds.length === 0) return null;
  return bounds.slice(1).reduce<ScreenshotBounds>((result, item) => ({
    mins: result.mins.map((value, axis) => Math.min(value, item.mins[axis])) as Vec3,
    maxs: result.maxs.map((value, axis) => Math.max(value, item.maxs[axis])) as Vec3,
  }), { mins: [...bounds[0].mins], maxs: [...bounds[0].maxs] });
}

function groupBounds(editor: Editor, requested: string): ScreenshotBounds {
  const query = requested.trim().toLowerCase();
  const group = listNamedGroups(editor.entities).find(item => item.id.toLowerCase() === query || item.name.toLowerCase() === query);
  if (!group) throw new Error(`Named group ${requested} was not found`);
  const bounds: ScreenshotBounds[] = [];
  for (const entity of editor.entities) {
    if (isGroupInfoEntity(entity)) continue;
    if (entityGroupId(entity) === group.id) {
      const entityBox = entityBounds(entity);
      if (entityBox) bounds.push(entityBox);
      continue;
    }
    for (const brush of entity.brushes) if (brush.editorGroupId === group.id) bounds.push({ mins: brush.mins, maxs: brush.maxs });
    for (const patch of entity.patches) if (patch.editorGroupId === group.id) bounds.push({ mins: patch.mins, maxs: patch.maxs });
  }
  const merged = mergeBounds(bounds);
  if (!merged) throw new Error(`Named group ${group.name} has no objects to frame`);
  return merged;
}

function selectionForRef(editor: Editor, ref: string): SelectionItem {
  const match = /^E(\d+)(?::([BP])(\d+))?(?::F(\d+))?$/.exec(ref);
  if (!match) throw new Error(`Invalid object reference ${ref}`);
  const entity = editor.entities[Number(match[1])];
  if (!entity) throw new Error(`Entity ${ref} does not exist`);
  if (!match[2]) return { type: 'entity', entity };
  const index = Number(match[3]);
  if (match[2] === 'B') {
    const brush = entity.brushes[index];
    if (!brush) throw new Error(`Brush ${ref} does not exist`);
    if (match[4] !== undefined) {
      const face = brush.faces[Number(match[4])];
      if (!face) throw new Error(`Face ${ref} does not exist`);
      return { type: 'face', entity, brush, face };
    }
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

function selectionBounds(item: SelectionItem): { mins: Vec3; maxs: Vec3 } | null {
  if (item.type === 'brush' || item.type === 'face') return { mins: item.brush.mins, maxs: item.brush.maxs };
  if (item.type === 'patch') return { mins: item.patch.mins, maxs: item.patch.maxs };
  return entityBounds(item.entity);
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

const EDITOR_SESSION_STORAGE_KEY = 'q3edit.mcpEditorSessionId';

function stableEditorSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // sessionStorage survives reloads but can be copied into a duplicated tab.
    // A fresh navigation gets a new identity; reload/back-forward keeps routing stable.
    if (existing && navigation?.type !== 'navigate') return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(EDITOR_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() ?? `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class LiveMapBridge {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private suppressDocumentSync = false;
  private stopped = false;
  private compiledBsp: { revision: number; data: Uint8Array } | null = null;
  readonly sessionId = stableEditorSessionId();

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
    const target = new URL(this.url);
    target.searchParams.set('sessionId', this.sessionId);
    const socket = new WebSocket(target);
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

    if (message.type === 'preview_operations') {
      if (message.expectedRevision !== this.editor.documentRevision) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: `Revision conflict: expected ${message.expectedRevision}, current revision is ${this.editor.documentRevision}`,
          revision: this.editor.documentRevision,
        });
        return;
      }
      try {
        const preview = new Editor();
        preview.entities = cloneMapSnapshot(this.editor.entities);
        preview.fileName = this.editor.fileName;
        preview.textureManager = this.editor.textureManager;
        preview.modelManager = this.editor.modelManager;
        preview.textureLock = this.editor.textureLock;
        preview.projectConfiguration = structuredClone(this.editor.projectConfiguration);
        preview.display = structuredClone(this.editor.display);
        const result = applyMapOperations(preview, message.operations, message.label);
        const diagnostics = collectEditorDiagnostics(preview);
        const objects = result.created.map(ref => {
          const item = selectionForRef(preview, ref);
          return { ref, kind: item.type, bounds: selectionBounds(item) };
        });
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: {
            revision: this.editor.documentRevision,
            operationCount: result.operationCount,
            created: result.created,
            changed: result.changed,
            aliases: result.aliases,
            objects,
            mapText: preview.serializeMap(),
            mapInfo: collectMapInfo(preview, diagnostics),
            diagnostics,
          },
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'new_document') {
      if (message.expectedRevision !== this.editor.documentRevision) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: `Revision conflict: expected ${message.expectedRevision}, current revision is ${this.editor.documentRevision}`,
          revision: this.editor.documentRevision,
        });
        return;
      }
      this.suppressDocumentSync = true;
      try {
        const preserved = message.preserveWorldspawn ? { ...this.editor.worldspawn.properties } : {};
        delete preserved.classname;
        this.editor.transact('MCP: New map', () => {
          if (message.template === 'starter') this.editor.createDefaultMap();
          else this.editor.entities = [createWorldspawn()];
          Object.assign(this.editor.worldspawn.properties, preserved, message.worldspawnProperties ?? {}, { classname: 'worldspawn' });
          this.editor.worldspawn.classname = 'worldspawn';
          this.editor.fileName = message.fileName;
          this.editor.mapDiagnostics = [];
          this.editor.unsupportedMapConstructs = [];
          this.editor.selection = [];
          this.editor.regionBounds = null;
          this.editor.clearPointfile(false);
          this.editor.clearHiddenState();
          this.editor.redrawRequested = true;
        });
        this.compiledBsp = null;
        this.editor.statusMessage = `MCP created ${message.template} map ${message.fileName}`;
        this.send({ type: 'document_replaced', requestId: message.requestId, snapshot: this.snapshot() });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
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
          const metadata = manager.getShaderMetadata(name);
          return {
            name,
            archive: asset?.source.archiveName,
            sourcePath: asset?.path,
            overriddenSources: asset?.overriddenSources.length ?? 0,
            shader: manager.isShader(name),
            shaderSourcePath: manager.getShaderSourcePath(name),
            previewAvailable: manager.hasPreviewSource(name),
            semantics: metadata?.semantics ?? null,
            surfaceParms: metadata?.surfaceParms ?? [],
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

    if (message.type === 'texture_inspect') {
      try {
        const manager = this.editor.textureManager;
        if (!manager) throw new Error('Texture assets are still loading');
        const inspection = manager.inspectTexture(message.name);
        if (!(inspection as { found?: boolean }).found) throw new Error(`Texture or shader ${message.name} was not found`);
        this.send({ type: 'capability_result', requestId: message.requestId, result: inspection });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
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

    if (message.type === 'editor_capabilities') {
      const registry = getEntityClassRegistry();
      this.send({
        type: 'capability_result', requestId: message.requestId,
        result: {
          project: {
            name: this.editor.projectConfiguration.name,
            gameDirectory: this.editor.projectConfiguration.game.gameDirectory,
            assetsConfigured: this.editor.projectConfiguration.assets.configured,
            openArenaEnabled: this.editor.projectConfiguration.assets.openArenaEnabled,
            archiveCount: this.editor.projectConfiguration.assets.archives.length,
            searchPathCount: this.editor.projectConfiguration.assets.searchPaths.length,
          },
          assets: {
            texturesLoaded: this.editor.textureManager?.listTextures().length ?? 0,
            entityClassesLoaded: registry.list().length,
          },
          document: { fileName: this.editor.fileName, revision: this.editor.documentRevision },
        },
      });
      return;
    }

    if (message.type === 'editor_screenshot') {
      try {
        const categories = this.editor.display.categories;
        const markers = { entities: categories.entities, lights: categories.lights, paths: categories.paths };
        const addedBrushes = new Set<Brush>();
        const addedPatches = new Set<Patch>();
        const addedEntities = new Set<Entity>();
        const restoredGroups = new Map<Entity, string | undefined>();
        const hiddenGroups = (message.hideGroups ?? []).map(requested => {
          const query = requested.trim().toLowerCase();
          const group = listNamedGroups(this.editor.entities).find(item => item.id.toLowerCase() === query || item.name.toLowerCase() === query);
          if (!group) throw new Error(`Named group ${requested} was not found`);
          return group;
        });
        const frame = message.frameBounds ?? (message.frameGroup ? groupBounds(this.editor, message.frameGroup) : null);
        if (message.hideEntityMarkers) {
          categories.entities = false; categories.lights = false; categories.paths = false;
          this.editor.redrawRequested = true;
        }
        for (const group of hiddenGroups) {
          if (!restoredGroups.has(group.entity)) restoredGroups.set(group.entity, group.entity.properties[GROUP_HIDDEN_KEY]);
          group.entity.properties[GROUP_HIDDEN_KEY] = '1';
        }
        const normalizedTexture = (texture: string): string => {
          return texture.toLowerCase().replace(/^textures\//, '');
        };
        const isSkyTexture = (texture: string): boolean => {
          const normalized = normalizedTexture(texture);
          return normalized.includes('/sky') || normalized.startsWith('skies/');
        };
        const isToolTexture = (texture: string): boolean => {
          const normalized = texture.toLowerCase().replace(/^textures\//, '');
          return normalized.startsWith('common/') || normalized.startsWith('system/');
        };
        for (const { brush } of this.editor.allBrushes()) {
          const outsideSection = message.sectionBounds && !intersectsBounds({ mins: brush.mins, maxs: brush.maxs }, message.sectionBounds);
          const hiddenByTexture = (message.hideSkyBrushes && brush.faces.some(face => isSkyTexture(face.texture))) ||
            (message.hideToolBrushes && brush.faces.length > 0 && brush.faces.every(face => isToolTexture(face.texture)));
          if ((outsideSection || hiddenByTexture) && !this.editor.hiddenBrushes.has(brush)) {
            this.editor.hiddenBrushes.add(brush); addedBrushes.add(brush);
          }
        }
        for (const { patch } of this.editor.allPatches()) {
          const outsideSection = message.sectionBounds && !intersectsBounds({ mins: patch.mins, maxs: patch.maxs }, message.sectionBounds);
          const hiddenByTexture = (message.hideSkyBrushes && isSkyTexture(patch.texture)) ||
            (message.hideToolBrushes && isToolTexture(patch.texture));
          if ((outsideSection || hiddenByTexture) && !this.editor.hiddenPatches.has(patch)) {
            this.editor.hiddenPatches.add(patch); addedPatches.add(patch);
          }
        }
        if (message.sectionBounds) {
          for (const entity of this.editor.entities) {
            if (isGroupInfoEntity(entity) || entity.brushes.length > 0 || entity.patches.length > 0) continue;
            const bounds = entityBounds(entity);
            if (bounds && !intersectsBounds(bounds, message.sectionBounds) && !this.editor.hiddenEntities.has(entity)) {
              this.editor.hiddenEntities.add(entity); addedEntities.add(entity);
            }
          }
        }
        if (frame) this.controls.frameBounds(frame);
        this.editor.redrawRequested = true;
        let screenshot: { mimeType: string; data: string; width: number; height: number };
        try {
          screenshot = this.controls.captureScreenshot(message.mode ?? 'perspective', message.width, message.height, message.xray);
        } finally {
          categories.entities = markers.entities; categories.lights = markers.lights; categories.paths = markers.paths;
          for (const brush of addedBrushes) this.editor.hiddenBrushes.delete(brush);
          for (const patch of addedPatches) this.editor.hiddenPatches.delete(patch);
          for (const entity of addedEntities) this.editor.hiddenEntities.delete(entity);
          for (const [entity, value] of restoredGroups) {
            if (value === undefined) delete entity.properties[GROUP_HIDDEN_KEY];
            else entity.properties[GROUP_HIDDEN_KEY] = value;
          }
          this.editor.redrawRequested = true;
        }
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: screenshot,
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'map_compile') {
      try {
        const assetFiles = collectCompileModelFiles(this.editor.entities, this.editor.modelManager);
        const textureManager = this.editor.textureManager;
        if (textureManager) {
          const usedTextures = new Set<string>();
          for (const entity of this.editor.entities) {
            for (const brush of entity.brushes) for (const face of brush.faces) usedTextures.add(face.texture);
            for (const patch of entity.patches) usedTextures.add(patch.texture);
            if (entity.classname === 'misc_model') {
              const resolved = this.editor.modelManager?.resolveEntity(entity);
              for (const texture of resolved?.surfaceTextures.values() ?? []) usedTextures.add(texture);
            }
          }
          for (const texture of usedTextures) {
            const found = textureManager.findImageFile(texture);
            if (found) assetFiles.set(found[0], found[1]);
          }
        }
        this.editor.statusMessage = `MCP compiling map (${message.quality})`;
        const compile = this.editor.projectConfiguration.compile;
        const result = await compileMap(this.editor.serializeMap(), {
          args: compile.bspArgs.length > 0 ? compile.bspArgs : ['-v'],
          vis: message.quality !== 'fast' && compile.vis,
          visArgs: message.quality === 'full' ? compile.visArgs : ['-fast', ...compile.visArgs],
          light: message.quality !== 'fast' && compile.light,
          lightArgs: compile.lightArgs,
          shaderFiles: textureManager?.getShaderFiles(),
          assetFiles: assetFiles.size > 0 ? assetFiles : undefined,
        });
        const leaked = Boolean(result.pointfileText);
        this.compiledBsp = result.success && result.bsp
          ? { revision: this.editor.documentRevision, data: new Uint8Array(result.bsp) }
          : null;
        const compilerDiagnostics = structureCompilerOutput(
          result.output, this.editor.entities, texture => textureManager?.isShader(texture) ?? false,
        );
        if (leaked) compilerDiagnostics.push({
          severity: 'error', code: 'leak', message: 'The BSP compiler produced a leak pointfile.', refs: [],
        });
        if (result.pointfileText) this.editor.loadPointfileText(result.pointfileText, 'MCP compile leak: loaded pointfile');
        else this.editor.clearPointfile(false);
        this.editor.statusMessage = result.success
          ? leaked ? 'MCP compile succeeded with a leak' : 'MCP compile succeeded'
          : leaked ? 'MCP compile failed with a leak' : 'MCP compile failed';
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: {
            success: result.success,
            quality: message.quality,
            bspBytes: result.bsp?.byteLength ?? 0,
            leaked,
            pointfileLoaded: leaked,
            diagnostics: compilerDiagnostics,
            output: result.output,
          },
        });
      } catch (error) {
        this.editor.statusMessage = 'MCP compile failed';
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'map_play') {
      try {
        if (!this.compiledBsp || this.compiledBsp.revision !== this.editor.documentRevision) {
          throw new Error('The current revision has not been compiled; call map_compile first');
        }
        const mapName = this.editor.fileName.replace(/\.map$/i, '') || 'compile';
        this.controls.launchBspPreview(mapName, this.compiledBsp.data, message.noclip);
        this.send({
          type: 'capability_result', requestId: message.requestId,
          result: { launched: true, mapName, revision: this.editor.documentRevision, noclip: message.noclip },
        });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'game_status') {
      this.send({ type: 'capability_result', requestId: message.requestId, result: this.controls.gameStatus() });
      return;
    }

    if (message.type === 'game_wait_ready') {
      try {
        const status = await this.controls.waitForGameReady(message.timeoutMs);
        this.send({ type: 'capability_result', requestId: message.requestId, result: status });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'game_command') {
      try {
        const status = this.controls.gameCommand(message.command);
        this.send({ type: 'capability_result', requestId: message.requestId, result: status });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'game_set_view') {
      try {
        const status = this.controls.setGameView(message.position, message.yaw);
        this.send({ type: 'capability_result', requestId: message.requestId, result: status });
      } catch (error) {
        this.send({
          type: 'operation_error', requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error), revision: this.editor.documentRevision,
        });
      }
      return;
    }

    if (message.type === 'game_screenshot') {
      try {
        this.send({ type: 'capability_result', requestId: message.requestId, result: this.controls.captureBspPreview() });
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
    element.title = `${this.url}\nEditor session: ${this.sessionId}`;
  }
}

export function connectConfiguredLiveBridge(editor: Editor, controls: LiveBridgeEditorControls): LiveMapBridge | null {
  const url = configuredBridgeUrl();
  if (!url) return null;
  const bridge = new LiveMapBridge(editor, url, controls);
  bridge.connect();
  return bridge;
}
