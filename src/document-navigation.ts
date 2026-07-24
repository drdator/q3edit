import type { Editor } from './editor';
import type { MapDocumentRef } from './map-operations';

export function selectDocumentRef(editor: Editor, ref: MapDocumentRef): boolean {
  const match = /^E(\d+)(?::B(\d+)(?::F(\d+))?|:P(\d+))?$/.exec(ref);
  if (!match) return false;
  const entity = editor.entities[Number(match[1])];
  if (!entity) return false;
  if (match[4] !== undefined) {
    const patch = entity.patches[Number(match[4])];
    if (!patch) return false;
    editor.selectPatchDirect(entity, patch);
  } else if (match[2] !== undefined) {
    const brush = entity.brushes[Number(match[2])];
    if (!brush) return false;
    if (match[3] !== undefined) {
      const face = brush.faces[Number(match[3])];
      if (!face) return false;
      editor.selectFace(entity, brush, face);
    } else editor.selectBrushDirect(entity, brush);
  } else editor.selectEntity(entity);
  editor.centerOnSelection();
  return true;
}
