import type { Editor } from './editor';
import type { Entity } from './entity';
import { serializeMap } from './mapfile';
import {
  buildSelectionTransfer,
  countTransferItems,
  formatTransferCount,
  insertTransferEntities,
  parseTransferEntities,
  transferOffset,
} from './editor-transfer';

function sanitizeFileStem(stem: string): string {
  const sanitized = stem
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized || 'prefab';
}

function selectedPrefabStem(editor: Editor): string | null {
  if (editor.selection.length === 0) return null;

  const entities = new Set<Entity>();
  for (const item of editor.selection) {
    entities.add(item.entity);
  }

  if (entities.size !== 1) return null;
  const [entity] = entities;
  if (!entity || entity === editor.worldspawn) return null;
  return entity.classname;
}

function defaultPrefabFileName(editor: Editor): string {
  const selectionStem = selectedPrefabStem(editor);
  if (selectionStem) return `${sanitizeFileStem(selectionStem)}-prefab.map`;

  const mapStem = editor.fileName.replace(/\.[^.]+$/, '');
  return `${sanitizeFileStem(mapStem)}-prefab.map`;
}

function downloadTextFile(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function describeInsertedPrefab(entityCount: number, brushCount: number, patchCount: number): string {
  const parts: string[] = [];
  if (entityCount > 0) parts.push(`${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}`);
  if (brushCount > 0) parts.push(`${brushCount} brush${brushCount === 1 ? '' : 'es'}`);
  if (patchCount > 0) parts.push(`${patchCount} patch${patchCount === 1 ? '' : 'es'}`);
  return parts.join(', ');
}

export function saveSelectionAsPrefab(editor: Editor): void {
  const { entities, totalItems } = buildSelectionTransfer(editor);
  if (entities.length === 0) {
    editor.statusMessage = 'Nothing to save as prefab';
    return;
  }

  const fileName = defaultPrefabFileName(editor);
  downloadTextFile(serializeMap(entities), fileName);
  editor.statusMessage = `Saved prefab ${fileName} (${formatTransferCount(totalItems)})`;
}

export function importPrefabFromFile(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.map,.pfb,.prefab';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const entities = parseTransferEntities(text);
      if (!entities) {
        editor.statusMessage = 'Prefab file did not contain map data';
        return;
      }

      if (countTransferItems(entities) === 0) {
        editor.statusMessage = 'Prefab file contained no insertable items';
        return;
      }

      const result = editor.transact('Import prefab', () =>
        insertTransferEntities(editor, entities, transferOffset(editor))
      );

      if (result.totalItems === 0) {
        editor.statusMessage = 'Prefab file contained no insertable items';
        return;
      }

      editor.statusMessage = `Imported prefab ${file.name}: ${describeInsertedPrefab(
        result.entityCount,
        result.brushCount,
        result.patchCount
      )}`;
    };
    reader.readAsText(file);
  };
  input.click();
}
