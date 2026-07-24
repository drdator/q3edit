import type { Editor } from './editor';
import { cloneMapSnapshot, type MapSnapshot } from './history';

export interface TransactionOptions {
  coalesceKey?: string;
  coalesceWindowMs?: number;
}

interface TransactionState {
  label: string;
  before: MapSnapshot;
  beforeRevision: number;
  depth: number;
  options: TransactionOptions;
}

const activeTransactions = new WeakMap<Editor, TransactionState>();

function documentsEqual(left: MapSnapshot, right: MapSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resetEditorStateAfterDocumentReplacement(editor: Editor): void {
  editor.selection = [];
  editor.clearHiddenState();
  editor.vertexMode = false;
  editor.vertexData = [];
  editor.vertexSelection = [];
  editor.patchEditMode = false;
  editor.patchEditData = [];
  editor.patchControlSelection = [];
  editor.terrainBrushCenter = null;
  editor.terrainBrushAxes = null;
  editor.cameraPlayback = null;
  editor.redrawRequested = true;
}

export function beginTransaction(
  editor: Editor,
  label: string,
  options: TransactionOptions = {},
): void {
  const active = activeTransactions.get(editor);
  if (active) {
    active.depth++;
    return;
  }

  activeTransactions.set(editor, {
    label,
    before: cloneMapSnapshot(editor.entities),
    beforeRevision: editor.documentRevision,
    depth: 1,
    options,
  });
}

export function commitTransaction(editor: Editor): boolean {
  const active = activeTransactions.get(editor);
  if (!active) return false;

  active.depth--;
  if (active.depth > 0) return false;
  activeTransactions.delete(editor);

  if (documentsEqual(active.before, editor.entities)) return false;

  editor.history.record(active.before, active.beforeRevision, active.label, active.options);
  editor.commitDocumentRevision();
  editor.redrawRequested = true;
  editor.notifyDocumentChanged(active.label, active.beforeRevision);
  return true;
}

export function cancelTransaction(editor: Editor): boolean {
  const active = activeTransactions.get(editor);
  if (!active) return false;

  activeTransactions.delete(editor);
  editor.entities = active.before;
  editor.restoreDocumentRevision(active.beforeRevision);
  resetEditorStateAfterDocumentReplacement(editor);
  return true;
}

export function transact<T>(
  editor: Editor,
  label: string,
  mutation: () => T,
  options: TransactionOptions = {},
): T {
  beginTransaction(editor, label, options);
  try {
    const result = mutation();
    commitTransaction(editor);
    return result;
  } catch (error) {
    cancelTransaction(editor);
    throw error;
  }
}

export function hasActiveTransaction(editor: Editor): boolean {
  return activeTransactions.has(editor);
}
