import { describe, expect, test } from 'vitest';
import { createBoxBrush, validateBrush } from '../src/brush';
import { Editor } from '../src/editor';
import {
  enterVertexMode,
  moveSelectedVertices,
  selectFaceVertices,
  splitSelectedVertexEdge,
  weldSelectedVertices,
} from '../src/editor-vertex';
import { createEntity } from '../src/entity';
import {
  collectBrushEdges,
  collectBrushVertices,
  pickFaceBoundary2D,
  splitBrushEdge,
} from '../src/vertex';

function editorWithBox(): Editor {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/concrete');
  worldspawn.brushes.push(brush);
  editor.entities = [worldspawn];
  editor.selection = [{ type: 'brush', entity: worldspawn, brush }];
  enterVertexMode(editor);
  return editor;
}

describe('face and edge editing', () => {
  test('picks a projected face boundary and returns all face vertices', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const vertices = collectBrushVertices(brush);
    const hit = pickFaceBoundary2D(brush, vertices, 64, 32, 0, 1, 2, 2);

    expect(hit?.faceIndex).toBe(0);
    expect(hit?.vertexIndices).toHaveLength(4);
  });

  test('moves a complete face while keeping the brush convex and closed', () => {
    const editor = editorWithBox();
    const brush = editor.vertexData[0].brush;
    expect(selectFaceVertices(editor, 0, 0)).toHaveLength(4);

    moveSelectedVertices(editor, [16, 0, 0]);

    expect(brush.maxs[0]).toBeCloseTo(80);
    expect(validateBrush(brush).valid).toBe(true);
  });

  test('inserts and selects a midpoint on a connected edge', () => {
    const editor = editorWithBox();
    const data = editor.vertexData[0];
    const edge = collectBrushEdges(data.brush, data.vertices)[0];
    editor.vertexSelection = edge.vertexIndices.map(vertexIndex => ({ dataIndex: 0, vertexIndex }));

    expect(splitSelectedVertexEdge(editor)).toBe(true);
    expect(editor.vertexSelection).toHaveLength(1);
    expect(data.vertices).toHaveLength(9);
    expect(editor.history.undoLabel).toBe('Split brush edge');
  });

  test('rejects splitting disconnected vertices', () => {
    const editor = editorWithBox();
    const data = editor.vertexData[0];
    const edges = collectBrushEdges(data.brush, data.vertices);
    const connected = new Set(edges.flatMap(edge => [`${edge.vertexIndices[0]}:${edge.vertexIndices[1]}`, `${edge.vertexIndices[1]}:${edge.vertexIndices[0]}`]));
    let pair: [number, number] = [0, 1];
    outer: for (let a = 0; a < data.vertices.length; a++) {
      for (let b = a + 1; b < data.vertices.length; b++) {
        if (!connected.has(`${a}:${b}`)) {
          pair = [a, b];
          break outer;
        }
      }
    }
    editor.vertexSelection = pair.map(vertexIndex => ({ dataIndex: 0, vertexIndex }));

    expect(splitSelectedVertexEdge(editor)).toBe(false);
    expect(editor.history.canUndo).toBe(false);
  });

  test('keeps an edge split as polygon-only topology until it is dragged', () => {
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    const vertices = collectBrushVertices(brush);
    const edge = collectBrushEdges(brush, vertices)[0];
    const beforeFaces = brush.faces.map(face => face.polygon.length);

    const midpoint = splitBrushEdge(brush, vertices, edge.vertexIndices);

    expect(midpoint).not.toBeNull();
    expect(brush.faces.some((face, index) => face.polygon.length > beforeFaces[index])).toBe(true);
    expect(validateBrush(brush).valid).toBe(true);
  });

  test('welds selected edge vertices to a snapped shared point', () => {
    const editor = editorWithBox();
    const data = editor.vertexData[0];
    const edge = collectBrushEdges(data.brush, data.vertices)[0];
    editor.vertexSelection = edge.vertexIndices.map(vertexIndex => ({ dataIndex: 0, vertexIndex }));

    expect(weldSelectedVertices(editor)).toBe(true);
    expect(data.vertices).toHaveLength(7);
    expect(editor.vertexSelection).toHaveLength(1);
    expect(validateBrush(data.brush).valid).toBe(true);
    expect(editor.history.undoLabel).toBe('Weld brush vertices');
  });
});
