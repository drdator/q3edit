import { createBoxBrush } from './brush';
import { createEntity } from './entity';
import { parseMap, serializeMap as serializeEntities } from './mapfile';
import type { Editor } from './editor';

export function snapshot(editor: Editor): void {
  editor.history.snapshot(editor.entities);
}

export function undo(editor: Editor): void {
  const prev = editor.history.undo(editor.entities);
  if (prev) {
    editor.entities = prev;
    editor.selection = [];
    editor.clearHiddenState();
    editor.exitVertexMode();
    editor.dirty = true;
    editor.statusMessage = 'Undo';
  }
}

export function redo(editor: Editor): void {
  const next = editor.history.redo(editor.entities);
  if (next) {
    editor.entities = next;
    editor.selection = [];
    editor.clearHiddenState();
    editor.exitVertexMode();
    editor.dirty = true;
    editor.statusMessage = 'Redo';
  }
}

export function serializeMap(editor: Editor): string {
  return serializeEntities(editor.entities);
}

export function loadMap(editor: Editor, text: string): void {
  snapshot(editor);
  editor.entities = parseMap(text);
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearHiddenState();
  editor.dirty = true;
  editor.statusMessage = 'Map loaded';
}

export function newMap(editor: Editor): void {
  snapshot(editor);
  editor.entities = [];
  editor.selection = [];
  editor.regionBounds = null;
  editor.clearHiddenState();
  editor.dirty = true;
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
  editor.entities = [];
  editor.regionBounds = null;
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

  editor.dirty = true;
  editor.statusMessage = 'Default map created';
}
