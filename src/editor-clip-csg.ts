import { clipBrush, type Brush } from './brush';
import { hollowBrush, mergeBrushes, subtractBrush } from './csg';
import type { Vec3 } from './math';
import { getSelectedBrushItems } from './editor-selection';
import type { Editor, SelectionItem } from './editor';

export function addClipPoint(editor: Editor, point: Vec3, depthAxis: number): void {
  if (editor.clipPoints.length >= 2) editor.clipPoints = [];
  editor.clipPoints.push(point);
  editor.clipDepthAxis = depthAxis;
  editor.dirty = true;
}

export function cycleClipMode(editor: Editor): void {
  const modes = ['front', 'back', 'both'] as const;
  editor.clipMode = modes[(modes.indexOf(editor.clipMode) + 1) % modes.length];
  editor.dirty = true;
  editor.statusMessage = `Clip: ${editor.clipMode}`;
}

export function cancelClip(editor: Editor): void {
  editor.clipPoints = [];
  editor.dirty = true;
  editor.statusMessage = 'Clip cancelled';
}

export function executeClip(editor: Editor): void {
  if (editor.clipPoints.length < 2 || editor.selection.length === 0) return;

  const p1 = editor.clipPoints[0];
  const p2 = editor.clipPoints[1];
  const depthAxis = editor.clipDepthAxis;

  const p3: Vec3 = [p1[0], p1[1], p1[2]];
  p3[depthAxis] += 1;

  const frontPoints: [Vec3, Vec3, Vec3] = [p1, p2, p3];
  const backPoints: [Vec3, Vec3, Vec3] = [p2, p1, p3];

  editor.snapshot();
  const newSelection: SelectionItem[] = [];
  const brushItems = getSelectedBrushItems(editor);

  for (const item of brushItems) {
    const idx = item.entity.brushes.indexOf(item.brush);
    if (idx < 0) continue;

    const front = clipBrush(item.brush, frontPoints);
    const back = clipBrush(item.brush, backPoints);

    item.entity.brushes.splice(idx, 1);

    if ((editor.clipMode === 'front' || editor.clipMode === 'both') && front) {
      item.entity.brushes.push(front);
      newSelection.push({ type: 'brush', entity: item.entity, brush: front });
    }
    if ((editor.clipMode === 'back' || editor.clipMode === 'both') && back) {
      item.entity.brushes.push(back);
      newSelection.push({ type: 'brush', entity: item.entity, brush: back });
    }
  }

  editor.reconcileHiddenState();
  editor.selection = newSelection;
  editor.clipPoints = [];
  editor.dirty = true;
  editor.statusMessage = `Clipped (${editor.clipMode})`;
}

export function csgSubtract(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'CSG Subtract: select brushes to carve with';
    return;
  }

  editor.snapshot();
  const carverSet = new Set(brushItems.map(item => item.brush));
  const newSelection: SelectionItem[] = [];
  let totalFragments = 0;

  for (const entity of editor.entities) {
    const newBrushes: Brush[] = [];
    for (const brush of entity.brushes) {
      if (carverSet.has(brush)) continue;

      let pieces: Brush[] = [brush];
      for (const carverBrush of carverSet) {
        const next: Brush[] = [];
        for (const piece of pieces) {
          const fragments = subtractBrush(piece, carverBrush);
          if (fragments !== null) {
            next.push(...fragments);
          } else {
            next.push(piece);
          }
        }
        pieces = next;
      }
      newBrushes.push(...pieces);
      if (pieces.length > 1 || (pieces.length === 1 && pieces[0] !== brush)) {
        totalFragments += pieces.length;
        for (const piece of pieces) {
          newSelection.push({ type: 'brush', entity, brush: piece });
        }
      }
    }
    entity.brushes = newBrushes;
  }

  editor.reconcileHiddenState();
  editor.selection = newSelection;
  editor.dirty = true;
  editor.statusMessage = totalFragments > 0
    ? `CSG Subtract: ${totalFragments} fragments created`
    : 'CSG Subtract: no intersections found';
}

export function csgHollow(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'CSG Hollow: select brushes first';
    return;
  }

  editor.snapshot();
  const newSelection: SelectionItem[] = [];

  for (const item of brushItems) {
    const shells = hollowBrush(item.brush, editor.gridSize);
    if (shells.length === 0) continue;

    const idx = item.entity.brushes.indexOf(item.brush);
    if (idx >= 0) item.entity.brushes.splice(idx, 1);

    for (const shell of shells) {
      item.entity.brushes.push(shell);
      newSelection.push({ type: 'brush', entity: item.entity, brush: shell });
    }
  }

  editor.reconcileHiddenState();
  editor.selection = newSelection;
  editor.dirty = true;
  editor.statusMessage = `CSG Hollow: ${newSelection.length} shell pieces (wall thickness: ${editor.gridSize})`;
}

export function csgMerge(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length < 2) {
    editor.statusMessage = 'CSG Merge: select 2+ brushes';
    return;
  }

  const entity = brushItems[0].entity;
  if (!brushItems.every(item => item.entity === entity)) {
    editor.statusMessage = 'CSG Merge: brushes must be in the same entity';
    return;
  }

  const merged = mergeBrushes(brushItems.map(item => item.brush));
  if (!merged) {
    editor.statusMessage = 'CSG Merge: result is not convex — cannot merge';
    return;
  }

  editor.snapshot();
  for (const item of brushItems) {
    const idx = entity.brushes.indexOf(item.brush);
    if (idx >= 0) entity.brushes.splice(idx, 1);
  }

  entity.brushes.push(merged);
  editor.reconcileHiddenState();
  editor.selection = [{ type: 'brush', entity, brush: merged }];
  editor.dirty = true;
  editor.statusMessage = `CSG Merge: ${brushItems.length} brushes merged into 1`;
}
