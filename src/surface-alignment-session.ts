import type { Editor, SelectionItem } from './editor';

type SelectionAddress =
  | { type: 'entity'; entityIndex: number }
  | { type: 'brush'; entityIndex: number; brushIndex: number }
  | { type: 'face'; entityIndex: number; brushIndex: number; faceIndex: number }
  | { type: 'patch'; entityIndex: number; patchIndex: number };

function captureSelection(editor: Editor): SelectionAddress[] {
  const result: SelectionAddress[] = [];
  for (const item of editor.selection) {
    const entityIndex = editor.entities.indexOf(item.entity);
    if (entityIndex < 0) continue;
    if (item.type === 'entity') {
      result.push({ type: 'entity', entityIndex });
      continue;
    }
    if (item.type === 'patch') {
      const patchIndex = item.entity.patches.indexOf(item.patch);
      if (patchIndex >= 0) result.push({ type: 'patch', entityIndex, patchIndex });
      continue;
    }
    const brushIndex = item.entity.brushes.indexOf(item.brush);
    if (brushIndex < 0) continue;
    if (item.type === 'brush') {
      result.push({ type: 'brush', entityIndex, brushIndex });
      continue;
    }
    const faceIndex = item.brush.faces.indexOf(item.face);
    if (faceIndex >= 0) result.push({ type: 'face', entityIndex, brushIndex, faceIndex });
  }
  return result;
}

function restoreSelection(editor: Editor, addresses: SelectionAddress[]): void {
  const selection: SelectionItem[] = [];
  for (const address of addresses) {
    const entity = editor.entities[address.entityIndex];
    if (!entity) continue;
    if (address.type === 'entity') {
      selection.push({ type: 'entity', entity });
      continue;
    }
    if (address.type === 'patch') {
      const patch = entity.patches[address.patchIndex];
      if (patch) selection.push({ type: 'patch', entity, patch });
      continue;
    }
    const brush = entity.brushes[address.brushIndex];
    if (!brush) continue;
    if (address.type === 'brush') {
      selection.push({ type: 'brush', entity, brush });
      continue;
    }
    const face = brush.faces[address.faceIndex];
    if (face) selection.push({ type: 'face', entity, brush, face });
  }
  editor.selection = selection;
  editor.redrawRequested = true;
}

export class SurfaceAlignmentSession {
  private readonly selection: SelectionAddress[];
  private active = true;

  constructor(private readonly editor: Editor) {
    this.selection = captureSelection(editor);
    editor.beginTransaction('Align surfaces');
  }

  apply(): boolean {
    if (!this.active) return false;
    this.active = false;
    return this.editor.commitTransaction();
  }

  cancel(): boolean {
    if (!this.active) return false;
    this.active = false;
    const cancelled = this.editor.cancelTransaction();
    restoreSelection(this.editor, this.selection);
    return cancelled;
  }
}
