import { clipBrush, type Brush } from './brush';
import {
  faceFullyCoveredByOpposingFace,
  hollowBrush,
  intersectBrushes,
  mergeBrushes,
  roomBrushes,
  subtractBrush,
} from './csg';
import { vec3Cross, vec3Length, vec3Sub, type Vec3 } from './math';
import { getSelectedBrushItems } from './editor-selection';
import type { Editor, SelectionItem } from './editor';

export function addClipPoint(editor: Editor, point: Vec3, depthAxis: number): void {
  if (editor.clipPoints.length >= 3) editor.clipPoints = [];
  editor.clipPoints.push([...point]);
  if (editor.clipPoints.length === 1) editor.clipDepthAxis = depthAxis;
  if (editor.clipPoints.length === 3) editor.clipDepthAxis = -1;
  editor.redrawRequested = true;
  editor.statusMessage = editor.clipPoints.length === 2
    ? 'Clip point 2/3 — press Enter for an axial clip or place a third point'
    : `Clip point ${editor.clipPoints.length}/3`;
}

export function cycleClipMode(editor: Editor): void {
  const modes = ['front', 'back', 'both'] as const;
  editor.clipMode = modes[(modes.indexOf(editor.clipMode) + 1) % modes.length];
  editor.redrawRequested = true;
  editor.statusMessage = `Clip: ${editor.clipMode}`;
}

export function cancelClip(editor: Editor): void {
  editor.clipPoints = [];
  editor.redrawRequested = true;
  editor.statusMessage = 'Clip cancelled';
}

export function executeClip(editor: Editor): void {
  if (editor.clipPoints.length < 2) {
    editor.statusMessage = 'Clip: place at least two points';
    return;
  }
  if (editor.selection.length === 0) {
    editor.statusMessage = 'Clip: select brushes first';
    return;
  }

  const p1 = editor.clipPoints[0];
  const p2 = editor.clipPoints[1];
  let p3: Vec3;
  if (editor.clipPoints.length >= 3) {
    p3 = editor.clipPoints[2];
    const cross = vec3Cross(vec3Sub(p2, p1), vec3Sub(p3, p1));
    if (vec3Length(cross) < 1e-6) {
      editor.statusMessage = 'Clip: the three points are collinear';
      return;
    }
  } else {
    const depthAxis = editor.clipDepthAxis;
    if (depthAxis < 0 || depthAxis > 2) {
      editor.statusMessage = 'Clip: add a third point to define the plane in 3D';
      return;
    }
    p3 = [p1[0], p1[1], p1[2]];
    p3[depthAxis] += 1;
  }

  const frontPoints: [Vec3, Vec3, Vec3] = [p1, p2, p3];
  const backPoints: [Vec3, Vec3, Vec3] = [p2, p1, p3];

  editor.transact('Clip selection', () => {
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
    editor.redrawRequested = true;
    editor.statusMessage = `Clipped (${editor.clipMode})`;
  });
}

export function csgSubtract(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'CSG Subtract: select brushes to carve with';
    return;
  }

  editor.transact('CSG subtract', () => {
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
    editor.redrawRequested = true;
    editor.statusMessage = totalFragments > 0
      ? `CSG Subtract: ${totalFragments} fragments created`
      : 'CSG Subtract: no intersections found';
  });
}

export function csgHollow(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'CSG Hollow: select brushes first';
    return;
  }

  editor.transact('CSG hollow', () => {
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
    editor.redrawRequested = true;
    editor.statusMessage = `CSG Hollow: ${newSelection.length} shell pieces (wall thickness: ${editor.gridSize})`;
  });
}

export function csgRoom(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'CSG Room: select brushes first';
    return;
  }

  editor.transact('CSG room', () => {
    const newSelection: SelectionItem[] = [];
    for (const item of brushItems) {
      const shells = roomBrushes(item.brush, editor.gridSize);
      if (shells.length === 0) continue;
      const index = item.entity.brushes.indexOf(item.brush);
      if (index >= 0) item.entity.brushes.splice(index, 1);
      for (const shell of shells) {
        item.entity.brushes.push(shell);
        newSelection.push({ type: 'brush', entity: item.entity, brush: shell });
      }
    }
    editor.reconcileHiddenState();
    editor.selection = newSelection;
    editor.redrawRequested = true;
    editor.statusMessage = `CSG Room: ${newSelection.length} shell pieces (wall thickness: ${editor.gridSize})`;
  });
}

export function autoCaulkSelected(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length === 0) {
    editor.statusMessage = 'Auto Caulk: select brushes first';
    return;
  }
  const allBrushes = [...editor.allBrushes()].map(item => item.brush);
  const changes = brushItems.flatMap(item => item.brush.faces.filter(face => {
    if (face.texture.toLowerCase() === 'common/caulk') return false;
    return allBrushes.some(other => other !== item.brush &&
      other.faces.some(opposing => faceFullyCoveredByOpposingFace(face, opposing)));
  }));
  if (changes.length === 0) {
    editor.statusMessage = 'Auto Caulk: no fully covered coplanar faces found';
    return;
  }
  editor.transact('Auto caulk selected', () => {
    for (const face of changes) face.texture = 'common/caulk';
    editor.redrawRequested = true;
    editor.statusMessage = `Auto Caulk: caulked ${changes.length} fully covered ${changes.length === 1 ? 'face' : 'faces'}`;
  });
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

  editor.transact('CSG merge', () => {
    for (const item of brushItems) {
      const idx = entity.brushes.indexOf(item.brush);
      if (idx >= 0) entity.brushes.splice(idx, 1);
    }

    entity.brushes.push(merged);
    editor.reconcileHiddenState();
    editor.selection = [{ type: 'brush', entity, brush: merged }];
    editor.redrawRequested = true;
    editor.statusMessage = `CSG Merge: ${brushItems.length} brushes merged into 1`;
  });
}

export function csgIntersect(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
  if (brushItems.length < 2) {
    editor.statusMessage = 'CSG Intersect: select 2+ brushes';
    return;
  }

  const entity = brushItems[0].entity;
  if (!brushItems.every(item => item.entity === entity)) {
    editor.statusMessage = 'CSG Intersect: brushes must be in the same entity';
    return;
  }

  const intersection = intersectBrushes(brushItems.map(item => item.brush));
  if (!intersection) {
    editor.statusMessage = 'CSG Intersect: selected brushes have no common volume';
    return;
  }

  editor.transact('CSG intersect', () => {
    for (const item of brushItems) {
      const index = entity.brushes.indexOf(item.brush);
      if (index >= 0) entity.brushes.splice(index, 1);
    }
    entity.brushes.push(intersection);
    editor.reconcileHiddenState();
    editor.selection = [{ type: 'brush', entity, brush: intersection }];
    editor.redrawRequested = true;
    editor.statusMessage = `CSG Intersect: ${brushItems.length} brushes replaced with their common volume`;
  });
}
