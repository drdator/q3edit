import { describe, expect, it, vi } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import type { Vec3 } from '../src/math';
import { collectBrushEdges, pickEdge3D, type BrushVertex } from '../src/vertex';
import { selectedVertexEdgeQuadVertices } from '../src/viewport3d-geometry';
import { handleViewport3DDoublePick, handleViewport3DPick, type Viewport3DSelectionContext } from '../src/viewport3d-selection';

function edgeRay(vertices: BrushVertex[], vertexIndices: [number, number]): { rayOrigin: Vec3; rayDir: Vec3 } {
  const a = vertices[vertexIndices[0]].position;
  const b = vertices[vertexIndices[1]].position;
  const midpoint: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const center: Vec3 = [32, 32, 32];
  const outward: Vec3 = [midpoint[0] - center[0], midpoint[1] - center[1], midpoint[2] - center[2]];
  const length = Math.hypot(...outward);
  const normal: Vec3 = outward.map(value => value / length) as Vec3;
  return {
    rayOrigin: midpoint.map((value, axis) => value + normal[axis] * 100) as Vec3,
    rayDir: normal.map(value => -value) as Vec3,
  };
}

function vertexModeContext(editor: Editor, rayOrigin: Vec3, rayDir: Vec3): Viewport3DSelectionContext {
  return {
    editor,
    dragStart: [0, 0],
    getRay: () => ({ rayOrigin, rayDir }),
    pickBrushAt: () => null,
    pickPatchAt: () => null,
    pickEntityAt: () => null,
  };
}

describe('3D vertex edge selection', () => {
  it('picks a brush edge from a ray through the middle of the segment', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    const editor = new Editor();
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.enterVertexMode();
    const data = editor.vertexData[0];
    const edge = collectBrushEdges(data.brush, data.vertices)[0];
    const ray = edgeRay(data.vertices, edge.vertexIndices);

    const hit = pickEdge3D(data.brush, data.vertices, ray.rayOrigin, ray.rayDir, 8);

    expect(new Set(hit?.vertexIndices)).toEqual(new Set(edge.vertexIndices));
  });

  it('selects both edge endpoints while keeping vertex mode active on double-click', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.enterVertexMode();
    const data = editor.vertexData[0];
    const edge = collectBrushEdges(data.brush, data.vertices)[0];
    const ray = edgeRay(data.vertices, edge.vertexIndices);
    const context = vertexModeContext(editor, ray.rayOrigin, ray.rayDir);
    const event = { ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent;

    handleViewport3DPick(context, event);

    expect(editor.vertexSelection).toEqual(edge.vertexIndices.map(vertexIndex => ({ dataIndex: 0, vertexIndex })));
    const requestExit = vi.fn();
    editor.onRequestExitVertexMode = requestExit;
    handleViewport3DDoublePick(context, event);
    expect(requestExit).not.toHaveBeenCalled();
  });

  it('selects every vertex of a face with Option-click in vertex mode', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.enterVertexMode();
    const context = vertexModeContext(editor, [128, 32, 32], [-1, 0, 0]);
    const event = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent;

    handleViewport3DPick(context, event);

    expect(editor.vertexSelection).toHaveLength(4);
    const selectedFaceIndices = editor.vertexSelection.map(selection =>
      editor.vertexData[selection.dataIndex].vertices[selection.vertexIndex].faceIndices,
    );
    expect(selectedFaceIndices.every(faceIndices => faceIndices.some(faceIndex =>
      brush.faces[faceIndex].plane.normal[0] > 0.9,
    ))).toBe(true);
  });

  it('builds a solid highlight only for edges whose endpoints are selected', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.enterVertexMode();
    const data = editor.vertexData[0];
    const edge = collectBrushEdges(data.brush, data.vertices)[0];
    editor.vertexSelection = edge.vertexIndices.map(vertexIndex => ({ dataIndex: 0, vertexIndex }));
    const triangles = selectedVertexEdgeQuadVertices(editor);
    expect(triangles).toHaveLength(6 * 8);
    expect(triangles.filter((_, index) => index % 8 === 6)).toEqual([0, 1, 1, 0, 1, 0]);
    editor.vertexSelection = [{ dataIndex: 0, vertexIndex: edge.vertexIndices[0] }];
    expect(selectedVertexEdgeQuadVertices(editor)).toEqual([]);
  });
});
