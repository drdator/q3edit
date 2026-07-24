import { createBoxBrush } from './brush';
import { createEntity, createWorldspawn } from './entity';
import { parseMapWithDiagnostics, serializeMap as serializeEntities } from './mapfile';
import type { Editor } from './editor';
import {
  commitTransaction,
  resetEditorStateAfterDocumentReplacement,
} from './editor-transactions';

export interface OriginalMapSource {
  text: string;
  revision: number;
  unsupportedConstructs: Editor['unsupportedMapConstructs'];
  hasComments: boolean;
}

export interface MapSaveSafety {
  safe: boolean;
  preservesOriginalText: boolean;
  requiresReviewedExport: boolean;
  reasons: string[];
}

type ParsedMapResult = ReturnType<typeof parseMapWithDiagnostics>;

export interface DocumentHistoryAuxiliary {
  fileName: string;
  originalMapSource: OriginalMapSource | null;
  mapDiagnostics: Editor['mapDiagnostics'];
  unsupportedMapConstructs: Editor['unsupportedMapConstructs'];
}

export function captureDocumentHistoryAuxiliary(editor: Editor): DocumentHistoryAuxiliary {
  return {
    fileName: editor.fileName,
    originalMapSource: editor.originalMapSource ? structuredClone(editor.originalMapSource) : null,
    mapDiagnostics: structuredClone(editor.mapDiagnostics),
    unsupportedMapConstructs: structuredClone(editor.unsupportedMapConstructs),
  };
}

function restoreDocumentHistoryAuxiliary(editor: Editor, value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const auxiliary = value as DocumentHistoryAuxiliary;
  editor.fileName = auxiliary.fileName;
  editor.originalMapSource = auxiliary.originalMapSource ? structuredClone(auxiliary.originalMapSource) : null;
  editor.mapDiagnostics = structuredClone(auxiliary.mapDiagnostics);
  editor.unsupportedMapConstructs = structuredClone(auxiliary.unsupportedMapConstructs);
}

function parseMapInWorker(text: string): Promise<ParsedMapResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(parseMapWithDiagnostics(text));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./map-parser-worker.ts', import.meta.url), { type: 'module' });
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    worker.onmessage = (event: MessageEvent<{ requestId: string; result?: ParsedMapResult; error?: string }>) => {
      if (event.data.requestId !== requestId) return;
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result) resolve(event.data.result);
      else reject(new Error('Map parser worker returned no result'));
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Map parser worker failed')); };
    worker.postMessage({ requestId, text });
  });
}

export function analyzeMapSaveSafety(editor: Editor): MapSaveSafety {
  const source = editor.originalMapSource;
  if (!source) {
    return { safe: true, preservesOriginalText: false, requiresReviewedExport: false, reasons: [] };
  }
  if (editor.documentRevision === source.revision) {
    return { safe: true, preservesOriginalText: true, requiresReviewedExport: false, reasons: [] };
  }
  const reasons: string[] = [];
  if (source.unsupportedConstructs.length > 0) {
    reasons.push(`${source.unsupportedConstructs.length} unsupported map block${source.unsupportedConstructs.length === 1 ? '' : 's'} cannot be merged safely after editing`);
  }
  if (source.hasComments) {
    reasons.push('source comments and formatting will be normalized');
  }
  return {
    safe: reasons.length === 0,
    preservesOriginalText: false,
    requiresReviewedExport: reasons.length > 0,
    reasons,
  };
}

export function undo(editor: Editor): void {
  commitTransaction(editor);
  const previousRevision = editor.documentRevision;
  const prev = editor.history.undo(
    editor.entities,
    editor.documentRevision,
    captureDocumentHistoryAuxiliary(editor),
  );
  if (prev) {
    editor.entities = prev.entities;
    restoreDocumentHistoryAuxiliary(editor, prev.auxiliary);
    editor.restoreDocumentRevision(prev.revision);
    resetEditorStateAfterDocumentReplacement(editor);
    editor.statusMessage = `Undo: ${prev.label}`;
    editor.notifyDocumentChanged(`Undo: ${prev.label}`, previousRevision);
  }
}

export function redo(editor: Editor): void {
  commitTransaction(editor);
  const previousRevision = editor.documentRevision;
  const next = editor.history.redo(
    editor.entities,
    editor.documentRevision,
    captureDocumentHistoryAuxiliary(editor),
  );
  if (next) {
    editor.entities = next.entities;
    restoreDocumentHistoryAuxiliary(editor, next.auxiliary);
    editor.restoreDocumentRevision(next.revision);
    resetEditorStateAfterDocumentReplacement(editor);
    editor.statusMessage = `Redo: ${next.label}`;
    editor.notifyDocumentChanged(`Redo: ${next.label}`, previousRevision);
  }
}

export function serializeMap(editor: Editor): string {
  if (editor.originalMapSource?.revision === editor.documentRevision) {
    return editor.originalMapSource.text;
  }
  return serializeEntities(editor.entities);
}

export function serializeCompileMap(editor: Editor): string {
  return serializeEntities(editor.entities, { compilerSafe: true });
}

function applyParsedMap(editor: Editor, text: string, result: ParsedMapResult): void {
  editor.transact('Open map', () => {
    editor.entities = result.document.entities.length > 0 ? result.document.entities : [createWorldspawn()];
  });
  editor.mapDiagnostics = result.diagnostics;
  editor.unsupportedMapConstructs = result.unsupportedConstructs;
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearPointfile(false);
  editor.clearHiddenState();
  editor.redrawRequested = true;
  editor.markDocumentSaved();
  editor.originalMapSource = {
    text,
    revision: editor.documentRevision,
    unsupportedConstructs: structuredClone(result.unsupportedConstructs),
    hasComments: /(^|\n)\s*\/\//.test(text),
  };
  editor.beginDocumentSession();
  editor.activityHistory.record({
    source: 'file',
    status: result.diagnostics.some(diagnostic => diagnostic.severity === 'error') ? 'error' : 'success',
    category: 'file',
    title: `Opened ${editor.fileName}`,
    summary: result.diagnostics.length > 0
      ? `${result.errors.length} errors and ${result.warnings.length} warnings`
      : undefined,
    revisionBefore: null,
    revisionAfter: editor.documentRevision,
    undoable: false,
  });
  if (result.diagnostics.length === 0) {
    editor.statusMessage = 'Map loaded';
    return;
  }

  const warnings = result.warnings.length;
  const errors = result.errors.length;
  const counts = [
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : '',
    warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');
  const first = result.diagnostics[0];
  editor.statusMessage = `Map loaded with ${counts} (line ${first.line}, column ${first.column}: ${first.message})`;
  console.warn('Map parse diagnostics', result.diagnostics);
}

export function loadMap(editor: Editor, text: string): void {
  applyParsedMap(editor, text, parseMapWithDiagnostics(text));
}

export async function loadMapAsync(editor: Editor, text: string): Promise<void> {
  editor.statusMessage = 'Parsing map in background…';
  applyParsedMap(editor, text, await parseMapInWorker(text));
}

export function restoreRecoveredMap(
  editor: Editor,
  text: string,
  fileName: string,
  documentRevision: number,
  savedDocumentRevision: number,
  documentSessionStartedAt: number,
  originalMapSource: OriginalMapSource | null = null,
): void {
  const result = parseMapWithDiagnostics(text);
  editor.entities = result.document.entities.length > 0 ? result.document.entities : [createWorldspawn()];
  editor.mapDiagnostics = result.diagnostics;
  editor.unsupportedMapConstructs = result.unsupportedConstructs;
  editor.originalMapSource = originalMapSource ? structuredClone(originalMapSource) : null;
  editor.fileName = fileName;
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearPointfile(false);
  resetEditorStateAfterDocumentReplacement(editor);
  editor.restoreDocumentState(documentRevision, savedDocumentRevision, documentSessionStartedAt);
  editor.statusMessage = editor.hasUnsavedChanges
    ? `Recovered unsaved changes to ${fileName}`
    : `Restored ${fileName}`;
}

export function newMap(editor: Editor): void {
  editor.transact('New map', () => {
    editor.entities = [createWorldspawn()];
  });
  editor.mapDiagnostics = [];
  editor.unsupportedMapConstructs = [];
  editor.originalMapSource = null;
  editor.fileName = 'untitled.map';
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearPointfile(false);
  editor.clearHiddenState();
  editor.redrawRequested = true;
  editor.statusMessage = 'New map';
  editor.beginDocumentSession();
  editor.activityHistory.record({
    source: 'file',
    status: 'success',
    category: 'file',
    title: 'Created new map',
    revisionBefore: null,
    revisionAfter: editor.documentRevision,
    undoable: false,
  });
}

export function saveMapToFile(editor: Editor): void {
  const safety = analyzeMapSaveSafety(editor);
  if (safety.requiresReviewedExport) {
    const constructs = editor.originalMapSource?.unsupportedConstructs
      .map(construct => `• ${construct.keyword} at line ${construct.line}`)
      .join('\n') ?? '';
    const approved = globalThis.confirm?.(
      `This map cannot be saved without normalizing source content:\n\n${safety.reasons.map(reason => `• ${reason}`).join('\n')}` +
      `${constructs ? `\n\nAffected constructs:\n${constructs}` : ''}` +
      '\n\nChoose OK to export the editable content without the unsupported source, or Cancel to keep the original intact.',
    ) ?? false;
    if (!approved) {
      editor.statusMessage = 'Save cancelled to prevent map data loss';
      return;
    }
  }
  const data = serializeMap(editor);
  const blob = new Blob([data], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = editor.fileName;
  link.click();
  URL.revokeObjectURL(url);
  editor.originalMapSource = {
    text: data,
    revision: editor.documentRevision,
    unsupportedConstructs: [],
    hasComments: /(^|\n)\s*\/\//.test(data),
  };
  editor.unsupportedMapConstructs = [];
  editor.markDocumentSaved();
  editor.statusMessage = `Saved ${editor.fileName}`;
  editor.activityHistory.record({
    source: 'file',
    status: 'success',
    category: 'file',
    title: `Saved ${editor.fileName}`,
    revisionBefore: editor.documentRevision,
    revisionAfter: editor.documentRevision,
    undoable: false,
  });
}

export function openMapFromFile(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.map';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    editor.fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      void loadMapAsync(editor, reader.result as string).catch(error => {
        editor.statusMessage = `Could not open map: ${error instanceof Error ? error.message : String(error)}`;
      });
    };
    reader.readAsText(file);
  };
  input.click();
}

export function createDefaultMap(editor: Editor): void {
  // Startup/default-map initialization is deliberately non-undoable. The New
  // command establishes its undo entry before invoking this initializer.
  editor.entities = [createWorldspawn()];
  editor.mapDiagnostics = [];
  editor.unsupportedMapConstructs = [];
  editor.originalMapSource = null;
  editor.regionBounds = null;
  editor.clearPointfile(false);
  editor.clearHiddenState();
  const worldspawn = editor.worldspawn;

  const wallTexture = 'base_wall/basewall03';
  const floorTexture = 'base_floor/concrete';
  const ceilingTexture = 'base_floor/concrete';

  worldspawn.brushes.push(createBoxBrush([0, 0, -16], [512, 512, 0], floorTexture));
  worldspawn.brushes.push(createBoxBrush([0, 0, 256], [512, 512, 272], ceilingTexture));
  worldspawn.brushes.push(createBoxBrush([0, 512, 0], [512, 528, 256], wallTexture));
  worldspawn.brushes.push(createBoxBrush([0, -16, 0], [512, 0, 256], wallTexture));
  worldspawn.brushes.push(createBoxBrush([512, 0, 0], [528, 512, 256], wallTexture));
  worldspawn.brushes.push(createBoxBrush([-16, 0, 0], [0, 512, 256], wallTexture));

  const spawn = createEntity('info_player_deathmatch', [256, 256, 32]);
  spawn.properties['angle'] = '0';
  editor.entities.push(spawn);

  const light = createEntity('light', [256, 256, 200]);
  light.properties['light'] = '300';
  editor.entities.push(light);

  editor.redrawRequested = true;
  editor.statusMessage = 'Default map created';
}
