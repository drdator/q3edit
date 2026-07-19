import type { Editor } from './editor';
import { cloneMapSnapshot, type MapSnapshot } from './history';

export interface TransactionOptions {
  coalesceKey?: string;
  coalesceWindowMs?: number;
}

interface TransactionState {
  label: string;
  before: MapSnapshot;
  depth: number;
  options: TransactionOptions;
}

const activeTransactions = new WeakMap<Editor, TransactionState>();

function documentsEqual(left: MapSnapshot, right: MapSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resetEditorStateAfterReplacement(editor: Editor): void {
  editor.selection = [];
  editor.clearHiddenState();
  editor.exitVertexMode();
  editor.dirty = true;
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

  editor.history.record(active.before, active.label, active.options);
  editor.dirty = true;
  return true;
}

export function cancelTransaction(editor: Editor): boolean {
  const active = activeTransactions.get(editor);
  if (!active) return false;

  activeTransactions.delete(editor);
  editor.entities = active.before;
  resetEditorStateAfterReplacement(editor);
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
