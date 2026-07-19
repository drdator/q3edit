import type { Editor } from './editor';
import { serializeMap } from './mapfile';
import {
  buildSelectionTransfer,
  formatTransferCount,
  insertTransferEntities,
  parseTransferEntities,
  transferOffset,
} from './editor-transfer';

function browserClipboard(): Clipboard | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
}

export async function copySelection(editor: Editor): Promise<void> {
  const { entities, totalItems } = buildSelectionTransfer(editor);
  if (entities.length === 0) {
    editor.statusMessage = 'Nothing to copy';
    return;
  }

  const text = serializeMap(entities);
  editor.clipboardText = text;

  let wroteSystemClipboard = false;
  const clipboard = browserClipboard();
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      wroteSystemClipboard = true;
    } catch {
      wroteSystemClipboard = false;
    }
  }

  editor.statusMessage = wroteSystemClipboard
    ? `Copied ${formatTransferCount(totalItems)}`
    : `Copied ${formatTransferCount(totalItems)} (internal clipboard)`;
}

export async function pasteClipboard(editor: Editor): Promise<void> {
  let entities = null;
  const clipboard = browserClipboard();

  if (clipboard?.readText) {
    try {
      const text = await clipboard.readText();
      const parsed = parseTransferEntities(text);
      if (parsed) {
        entities = parsed;
        editor.clipboardText = text;
      }
    } catch {
      // Fall back to the in-memory clipboard below.
    }
  }

  if (!entities && editor.clipboardText) {
    entities = parseTransferEntities(editor.clipboardText);
  }

  if (!entities || entities.length === 0) {
    editor.statusMessage = 'Clipboard does not contain map data';
    return;
  }

  const result = editor.transact('Paste', () =>
    insertTransferEntities(editor, entities, transferOffset(editor))
  );

  if (result.totalItems === 0) {
    editor.statusMessage = 'Clipboard contained no pasteable items';
    return;
  }

  const parts: string[] = [];
  if (result.entityCount > 0) parts.push(`${result.entityCount} entit${result.entityCount === 1 ? 'y' : 'ies'}`);
  if (result.brushCount > 0) parts.push(`${result.brushCount} brush${result.brushCount === 1 ? '' : 'es'}`);
  if (result.patchCount > 0) parts.push(`${result.patchCount} patch${result.patchCount === 1 ? '' : 'es'}`);
  editor.statusMessage = `Pasted ${parts.join(', ')}`;
}
