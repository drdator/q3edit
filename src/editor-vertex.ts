import { type Brush, type BrushValidationResult, rebuildBrush, splitBrushConvex, validateBrush } from './brush';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import { collectBrushVertices, moveVertices } from './vertex';
import type { Editor } from './editor';

export function enterVertexMode(editor: Editor): void {
  const brushItems = editor.selection.filter(s => s.type === 'brush' || s.type === 'face');
  if (brushItems.length === 0) return;

  editor.vertexData = [];
  const seen = new Set<Brush>();
  for (const item of brushItems) {
    if (seen.has(item.brush)) continue;
    seen.add(item.brush);
    editor.vertexData.push({
      brush: item.brush,
      entity: item.entity,
      vertices: collectBrushVertices(item.brush),
    });
  }

  editor.vertexMode = true;
  editor.vertexSelection = [];
  editor.dirty = true;
  editor.statusMessage = 'Vertex mode';
}

export function exitVertexMode(
  editor: Editor,
): { invalidBrushes: { brush: Brush; entity: Entity; result: BrushValidationResult }[] } | null {
  if (!editor.vertexMode) return null;

  const invalidBrushes: { brush: Brush; entity: Entity; result: BrushValidationResult }[] = [];
  for (const data of editor.vertexData) {
    const result = validateBrush(data.brush);
    if (!result.valid) {
      invalidBrushes.push({ brush: data.brush, entity: data.entity, result });
    }
  }

  editor.vertexMode = false;
  editor.vertexData = [];
  editor.vertexSelection = [];
  editor.dirty = true;

  if (invalidBrushes.length > 0) {
    return { invalidBrushes };
  }
  return null;
}

export function rebuildBrushes(editor: Editor, brushes: Brush[]): void {
  for (const brush of brushes) {
    rebuildBrush(brush);
  }
  editor.dirty = true;
}

export function splitBrushesConvex(editor: Editor, invalidBrushes: { brush: Brush; entity: Entity }[]): void {
  for (const { brush, entity } of invalidBrushes) {
    const pieces = splitBrushConvex(brush);
    if (pieces.length <= 1) continue;

    const idx = entity.brushes.indexOf(brush);
    if (idx >= 0) entity.brushes.splice(idx, 1);
    for (const piece of pieces) {
      entity.brushes.push(piece);
    }
  }
  editor.reconcileHiddenState();
  editor.selection = [];
  editor.dirty = true;
}

export function selectVertex(editor: Editor, dataIndex: number, vertexIndex: number, additive = false): void {
  if (!additive) editor.vertexSelection = [];
  const idx = editor.vertexSelection.findIndex(
    v => v.dataIndex === dataIndex && v.vertexIndex === vertexIndex
  );
  if (idx >= 0) {
    if (additive) editor.vertexSelection.splice(idx, 1);
    return;
  }
  editor.vertexSelection.push({ dataIndex, vertexIndex });
  editor.dirty = true;
}

export function clearVertexSelection(editor: Editor): void {
  editor.vertexSelection = [];
  editor.dirty = true;
}

export function isVertexSelected(editor: Editor, dataIndex: number, vertexIndex: number): boolean {
  return editor.vertexSelection.some(
    v => v.dataIndex === dataIndex && v.vertexIndex === vertexIndex
  );
}

export function moveSelectedVertices(editor: Editor, delta: Vec3): void {
  if (editor.vertexSelection.length === 0) return;

  const byBrush = new Map<number, number[]>();
  for (const vertexSelection of editor.vertexSelection) {
    let indices = byBrush.get(vertexSelection.dataIndex);
    if (!indices) {
      indices = [];
      byBrush.set(vertexSelection.dataIndex, indices);
    }
    indices.push(vertexSelection.vertexIndex);
  }

  for (const [dataIndex, indices] of byBrush) {
    const data = editor.vertexData[dataIndex];
    moveVertices(data.brush, data.vertices, indices, delta);
  }

  refreshVertexData(editor);
  editor.dirty = true;
}

export function refreshVertexData(editor: Editor): void {
  editor.vertexSelection = editor.vertexSelection.filter(vertexSelection =>
    vertexSelection.dataIndex < editor.vertexData.length &&
    vertexSelection.vertexIndex < editor.vertexData[vertexSelection.dataIndex].vertices.length
  );
}

export function vertexSelectionCenter(editor: Editor): Vec3 | null {
  if (editor.vertexSelection.length === 0) return null;
  let sum: Vec3 = [0, 0, 0];
  for (const vertexSelection of editor.vertexSelection) {
    const position = editor.vertexData[vertexSelection.dataIndex]?.vertices[vertexSelection.vertexIndex]?.position;
    if (!position) continue;
    sum[0] += position[0];
    sum[1] += position[1];
    sum[2] += position[2];
  }
  const count = editor.vertexSelection.length;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}
