import type { Editor } from './editor';
import { deduplicateEditorObjectIds } from './editor-object-ids';
import { cloneMapSnapshot, type MapSnapshot } from './history';
import { synchronizeLinkedGroups } from './named-groups';
import {
  cloneTransformDescriptor,
  type TransformDescriptor,
} from './transform-descriptor';

export interface TransactionOptions {
  auxiliary?: unknown;
  coalesceKey?: string;
  coalesceWindowMs?: number;
  /** The mutation is known to change the document, so a full structural comparison is unnecessary. */
  assumeChanged?: boolean;
}

interface TransactionState {
  label: string;
  before: MapSnapshot;
  beforeRevision: number;
  depth: number;
  options: TransactionOptions;
  transform?: TransformDescriptor;
}

const activeTransactions = new WeakMap<Editor, TransactionState>();

function documentsEqual(left: MapSnapshot, right: MapSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resetEditorStateAfterDocumentReplacement(editor: Editor): void {
  editor.selection = [];
  editor.lastTransform = null;
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

  synchronizeLinkedGroups(editor, active.before);
  deduplicateEditorObjectIds(editor.entities);
  if (!active.options.assumeChanged && documentsEqual(active.before, editor.entities)) return false;

  editor.history.recordSnapshot(active.before, active.beforeRevision, active.label, active.options);
  if (active.transform) editor.lastTransform = cloneTransformDescriptor(active.transform);
  editor.commitDocumentRevision();
  editor.redrawRequested = true;
  editor.notifyDocumentChanged(active.label, active.beforeRevision);
  return true;
}

export function recordTransactionTransform(
  editor: Editor,
  transform: TransformDescriptor,
  mode: 'replace' | 'accumulate' = 'replace',
): void {
  const active = activeTransactions.get(editor);
  if (!active) return;

  if (mode === 'accumulate' && transform.kind === 'move' && active.transform?.kind === 'move') {
    active.transform = {
      kind: 'move',
      delta: [
        active.transform.delta[0] + transform.delta[0],
        active.transform.delta[1] + transform.delta[1],
        active.transform.delta[2] + transform.delta[2],
      ],
    };
    return;
  }

  active.transform = cloneTransformDescriptor(transform);
}

export function cancelTransaction(editor: Editor): boolean {
  const active = activeTransactions.get(editor);
  if (!active) return false;

  const lastTransform = editor.lastTransform
    ? cloneTransformDescriptor(editor.lastTransform)
    : null;
  activeTransactions.delete(editor);
  editor.entities = active.before;
  editor.restoreDocumentRevision(active.beforeRevision);
  resetEditorStateAfterDocumentReplacement(editor);
  editor.lastTransform = lastTransform;
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
