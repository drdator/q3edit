import { createBoxBrush } from './brush';
import { createEntity, createWorldspawn } from './entity';
import { parseMapWithDiagnostics, serializeMap as serializeEntities } from './mapfile';
import type { Editor } from './editor';
import {
  commitTransaction,
  resetEditorStateAfterDocumentReplacement,
} from './editor-transactions';

export function undo(editor: Editor): void {
  commitTransaction(editor);
  const prev = editor.history.undo(editor.entities, editor.documentRevision);
  if (prev) {
    editor.entities = prev.entities;
    editor.restoreDocumentRevision(prev.revision);
    resetEditorStateAfterDocumentReplacement(editor);
    editor.statusMessage = `Undo: ${prev.label}`;
    editor.notifyDocumentChanged(`Undo: ${prev.label}`);
  }
}

export function redo(editor: Editor): void {
  commitTransaction(editor);
  const next = editor.history.redo(editor.entities, editor.documentRevision);
  if (next) {
    editor.entities = next.entities;
    editor.restoreDocumentRevision(next.revision);
    resetEditorStateAfterDocumentReplacement(editor);
    editor.statusMessage = `Redo: ${next.label}`;
    editor.notifyDocumentChanged(`Redo: ${next.label}`);
  }
}

export function serializeMap(editor: Editor): string {
  return serializeEntities(editor.entities);
}

export function loadMap(editor: Editor, text: string): void {
  const result = parseMapWithDiagnostics(text);
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

export function newMap(editor: Editor): void {
  editor.transact('New map', () => {
    editor.entities = [createWorldspawn()];
  });
  editor.mapDiagnostics = [];
  editor.unsupportedMapConstructs = [];
  editor.fileName = 'untitled.map';
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearPointfile(false);
  editor.clearHiddenState();
  editor.redrawRequested = true;
  editor.statusMessage = 'New map';
}

export function saveMapToFile(editor: Editor): void {
  const data = serializeMap(editor);
  const blob = new Blob([data], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = editor.fileName;
  link.click();
  URL.revokeObjectURL(url);
  editor.markDocumentSaved();
  editor.statusMessage = `Saved ${editor.fileName}`;
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
      loadMap(editor, reader.result as string);
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
