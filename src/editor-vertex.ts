import { cloneBrush, type Brush, type BrushValidationResult, rebuildBrush, splitBrushConvex, validateBrush } from './brush';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import { getSelectedBrushItems } from './editor-selection';
import { collectBrushEdges, collectBrushVertices, moveVertices, splitBrushEdge, weldBrushVertices } from './vertex';
import type { Editor } from './editor';
import {
  captureBrushPrimitiveVertexTextureState,
  restoreBrushPrimitiveVertexTextureState,
} from './texture-lock';

export function enterVertexMode(editor: Editor): void {
  const brushItems = getSelectedBrushItems(editor);
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
  editor.redrawRequested = true;
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
  editor.redrawRequested = true;

  if (invalidBrushes.length > 0) {
    return { invalidBrushes };
  }
  return null;
}

export function rebuildBrushes(editor: Editor, brushes: Brush[]): void {
  editor.transact('Rebuild brush geometry', () => {
    for (const brush of brushes) {
      rebuildBrush(brush);
    }
    editor.redrawRequested = true;
  });
}

export function splitBrushesConvex(editor: Editor, invalidBrushes: { brush: Brush; entity: Entity }[]): void {
  editor.transact('Split brushes into convex pieces', () => {
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
    editor.redrawRequested = true;
  });
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
  editor.redrawRequested = true;
}

export function selectFaceVertices(editor: Editor, dataIndex: number, faceIndex: number): number[] {
  const data = editor.vertexData[dataIndex];
  if (!data?.brush.faces[faceIndex]) return [];
  const indices = data.vertices
    .map((vertex, vertexIndex) => vertex.faceIndices.includes(faceIndex) ? vertexIndex : -1)
    .filter(vertexIndex => vertexIndex >= 0);
  editor.vertexSelection = indices.map(vertexIndex => ({ dataIndex, vertexIndex }));
  editor.redrawRequested = true;
  return indices;
}

export function splitSelectedVertexEdge(editor: Editor): boolean {
  if (!editor.vertexMode) return false;
  const dataIndices = [...new Set(editor.vertexSelection.map(selection => selection.dataIndex))];
  if (dataIndices.length !== 1) {
    editor.statusMessage = 'Split Edge requires exactly one selected edge';
    return false;
  }
  const dataIndex = dataIndices[0];
  const selected = editor.vertexSelection
    .filter(selection => selection.dataIndex === dataIndex)
    .map(selection => selection.vertexIndex);
  if (selected.length !== 2) {
    editor.statusMessage = 'Split Edge requires exactly two connected vertices';
    return false;
  }
  const data = editor.vertexData[dataIndex];
  const connected = collectBrushEdges(data.brush, data.vertices).some(edge =>
    edge.vertexIndices.includes(selected[0]) && edge.vertexIndices.includes(selected[1]));
  if (!connected) {
    editor.statusMessage = 'The selected vertices do not form an edge';
    return false;
  }

  let midpoint: Vec3 | null = null;
  editor.transact('Split brush edge', () => {
    midpoint = splitBrushEdge(data.brush, data.vertices, [selected[0], selected[1]]);
    if (!midpoint) return;
    data.vertices = collectBrushVertices(data.brush);
    const midpointIndex = data.vertices.findIndex(vertex =>
      Math.abs(vertex.position[0] - midpoint![0]) < 0.01 &&
      Math.abs(vertex.position[1] - midpoint![1]) < 0.01 &&
      Math.abs(vertex.position[2] - midpoint![2]) < 0.01);
    editor.vertexSelection = midpointIndex >= 0 ? [{ dataIndex, vertexIndex: midpointIndex }] : [];
    editor.redrawRequested = true;
  });
  if (!midpoint) return false;
  editor.statusMessage = 'Edge split; drag the new vertex to refine the brush';
  return true;
}

export function weldSelectedVertices(editor: Editor): boolean {
  if (!editor.vertexMode || editor.vertexSelection.length < 2) {
    editor.statusMessage = 'Weld Vertices requires at least two selected vertices';
    return false;
  }
  const byData = new Map<number, number[]>();
  for (const selection of editor.vertexSelection) {
    const indices = byData.get(selection.dataIndex) ?? [];
    indices.push(selection.vertexIndex);
    byData.set(selection.dataIndex, indices);
  }
  const candidates: Array<{ dataIndex: number; brush: Brush; target: Vec3 }> = [];
  for (const [dataIndex, indices] of byData) {
    if (indices.length < 2) continue;
    const data = editor.vertexData[dataIndex];
    if (!data) continue;
    const target: Vec3 = [0, 0, 0];
    for (const index of indices) {
      const position = data.vertices[index]?.position;
      if (!position) continue;
      target[0] += position[0];
      target[1] += position[1];
      target[2] += position[2];
    }
    const grid = editor.effectiveGrid();
    target[0] = Math.round((target[0] / indices.length) / grid) * grid;
    target[1] = Math.round((target[1] / indices.length) / grid) * grid;
    target[2] = Math.round((target[2] / indices.length) / grid) * grid;
    const candidate = cloneBrush(data.brush);
    const candidateVertices = collectBrushVertices(candidate);
    const candidateIndices = indices.map(index => {
      const source = data.vertices[index]?.position;
      return source
        ? candidateVertices.findIndex(vertex =>
          Math.abs(vertex.position[0] - source[0]) < 0.01 &&
          Math.abs(vertex.position[1] - source[1]) < 0.01 &&
          Math.abs(vertex.position[2] - source[2]) < 0.01)
        : -1;
    }).filter(index => index >= 0);
    const textureState = editor.textureLock
      ? captureBrushPrimitiveVertexTextureState(candidate)
      : null;
    weldBrushVertices(candidate, candidateVertices, candidateIndices, target);
    if (textureState) restoreBrushPrimitiveVertexTextureState(textureState);
    if (!validateBrush(candidate).valid) {
      editor.statusMessage = 'Weld rejected because it would create an invalid brush';
      return false;
    }
    candidates.push({ dataIndex, brush: candidate, target });
  }
  if (candidates.length === 0) return false;

  editor.transact('Weld brush vertices', () => {
    editor.vertexSelection = [];
    for (const candidate of candidates) {
      const data = editor.vertexData[candidate.dataIndex];
      Object.assign(data.brush, candidate.brush);
      data.vertices = collectBrushVertices(data.brush);
      const vertexIndex = data.vertices.findIndex(vertex =>
        Math.abs(vertex.position[0] - candidate.target[0]) < 0.01 &&
        Math.abs(vertex.position[1] - candidate.target[1]) < 0.01 &&
        Math.abs(vertex.position[2] - candidate.target[2]) < 0.01);
      if (vertexIndex >= 0) editor.vertexSelection.push({ dataIndex: candidate.dataIndex, vertexIndex });
    }
    editor.redrawRequested = true;
  });
  editor.statusMessage = `Welded vertices in ${candidates.length} brush${candidates.length === 1 ? '' : 'es'}`;
  return true;
}

export function clearVertexSelection(editor: Editor): void {
  editor.vertexSelection = [];
  editor.redrawRequested = true;
}

export function isVertexSelected(editor: Editor, dataIndex: number, vertexIndex: number): boolean {
  return editor.vertexSelection.some(
    v => v.dataIndex === dataIndex && v.vertexIndex === vertexIndex
  );
}

export function moveSelectedVertices(editor: Editor, delta: Vec3): void {
  if (editor.vertexSelection.length === 0) return;

  editor.transact('Move brush vertices', () => {
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
      const textureState = editor.textureLock
        ? captureBrushPrimitiveVertexTextureState(data.brush)
        : null;
      moveVertices(data.brush, data.vertices, indices, delta);
      if (textureState) restoreBrushPrimitiveVertexTextureState(textureState);
    }

    refreshVertexData(editor);
    editor.redrawRequested = true;
  }, { coalesceKey: 'move-brush-vertices' });
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
