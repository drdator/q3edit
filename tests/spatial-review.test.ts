import { describe, expect, test } from 'vitest';
import { reviewSpatialDesign } from '../bridge/spatial-review';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('MCP spatial design review', () => {
  test('passes an empty document without inventing design findings', () => {
    const result = reviewSpatialDesign(emptyEditor().serializeMap());

    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
    expect(result.metrics.geometry).toMatchObject({ brushCount: 0, faceCount: 0, axisAlignedFaceRatio: null });
    expect(result.metrics.levels).toEqual({ count: 0, values: [], heightRange: null });
  });

  test('reports box-dominant, single-level, repetitive construction with actionable suggestions', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, Array.from({ length: 10 }, (_, index) => ({
      type: 'create_box' as const,
      mins: [index * 80, 0, 0] as [number, number, number],
      maxs: [index * 80 + 64, 64, 64] as [number, number, number],
    })));

    const result = reviewSpatialDesign(editor.serializeMap());

    expect(result.status).toBe('needs-attention');
    expect(result.metrics.geometry).toMatchObject({ brushCount: 10, axisAlignedFaceRatio: 1, angledBrushes: 0 });
    expect(result.metrics.levels.count).toBe(1);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'axis-aligned-dominance', severity: 'warning' }),
      expect.objectContaining({ code: 'limited-height-variation', severity: 'warning' }),
      expect.objectContaining({ code: 'repeated-dimensions' }),
      expect.objectContaining({ code: 'weak-landmark-distribution' }),
    ]));
    expect(result.issues.every(issue => issue.suggestions.length > 0)).toBe(true);
  });

  test('measures route topology, spatial rhythm, symmetry, and long walls', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      { type: 'create_box', mins: [-512, -256, 0], maxs: [512, -240, 192] },
      { type: 'create_box', mins: [-512, 240, 0], maxs: [512, 256, 192] },
      { type: 'create_box', mins: [-256, -256, 0], maxs: [-240, 256, 192] },
      { type: 'create_box', mins: [240, -256, 0], maxs: [256, 256, 192] },
      ...Array.from({ length: 6 }, (_, index) => ({
        type: 'create_box' as const,
        mins: [-192 + index * 64, -32, 0] as [number, number, number],
        maxs: [-128 + index * 64, 32, index < 3 ? 32 : 96] as [number, number, number],
      })),
    ]);

    const result = reviewSpatialDesign(editor.serializeMap());

    expect(result.metrics.routes.platformCount).toBeGreaterThan(0);
    expect(result.metrics.rhythm.sampleCount).toBeGreaterThan(0);
    expect(result.metrics.symmetry.xMatchRatio).not.toBeNull();
    expect(result.metrics.longFlatWalls.count).toBeGreaterThan(0);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'long-flat-walls', refs: expect.any(Array) }),
    ]));
  });

  test('compares the persistent semantic graph with realized grouped geometry', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_area', id: 'realized', purpose: 'entry', shape: 'rectangular', center: [0, 0, 0],
        bounds: { mins: [-64, -64, 0], maxs: [64, 64, 128] }, height: 128, geometry: 'floor',
      },
      {
        type: 'create_area', id: 'planned', purpose: 'future upper route', shape: 'radial', center: [512, 0, 128],
        radius: 96, height: 192,
      },
    ]);

    const result = reviewSpatialDesign(editor.serializeMap());

    expect(result.metrics.semanticPlan).toMatchObject({
      areaCount: 2, connectionCount: 0, componentCount: 2, realizedAreas: 1, realizedConnections: 0,
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'semantic-plan-disconnected', severity: 'warning' }),
    ]));
  });

  test('links low-level generated geometry to planned areas and connections', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_area', id: 'court', purpose: 'central fight', shape: 'rectangular', center: [0, 0, 0],
        bounds: { mins: [-128, -128, 0], maxs: [128, 128, 192] }, height: 192,
      },
      {
        type: 'create_area', id: 'ledge', purpose: 'upper route', shape: 'rectangular', center: [384, 0, 96],
        bounds: { mins: [320, -64, 96], maxs: [448, 64, 224] }, height: 128,
      },
      {
        type: 'connect_areas', id: 'flank', fromArea: 'court', toArea: 'ledge', routeType: 'ramp', width: 96,
      },
      { type: 'create_box', mins: [-128, -128, -16], maxs: [128, 128, 0], areaId: 'court' },
      {
        type: 'create_path', id: 'flank_path', kind: 'corridor', points: [[128, 0, 0], [384, 0, 96]],
        width: 96, thickness: 16, connectionId: 'flank',
      },
    ]);
    expect(reviewSpatialDesign(editor.serializeMap()).metrics.semanticPlan).toMatchObject({
      areaCount: 2, connectionCount: 1, realizedAreas: 1, realizedConnections: 1,
    });
  });
});
