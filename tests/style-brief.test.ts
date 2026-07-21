import { describe, expect, test } from 'vitest';
import { MAP_STYLE_BRIEF_KEY, readStyleBrief, reviewStyleBrief, serializeStyleBrief } from '../bridge/style-brief';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('persistent MCP map style brief', () => {
  test('round-trips structured style guidance through worldspawn', () => {
    const editor = emptyEditor();
    editor.worldspawn.properties[MAP_STYLE_BRIEF_KEY] = serializeStyleBrief({
      name: 'Industrial arena', theme: 'Weathered steel with orange accents',
      palette: ['base_wall/*', 'base_trim/pewter_shiney'], paletteMode: 'guide',
      modularGrid: 16, targetTexelsPerUnit: 2, lightingMood: 'dramatic', detailDensity: 'rich',
      notes: 'Keep the center readable. "Warm" accents mark routes.',
    });

    expect(readStyleBrief(editor.serializeMap())).toEqual(expect.objectContaining({
      name: 'Industrial arena', modularGrid: 16, lightingMood: 'dramatic',
      notes: 'Keep the center readable. "Warm" accents mark routes.',
    }));
  });

  test('reviews palette, grid, density, and lighting adherence', () => {
    const editor = emptyEditor();
    editor.worldspawn.properties[MAP_STYLE_BRIEF_KEY] = serializeStyleBrief({
      palette: ['base_wall/*'], paletteMode: 'strict', modularGrid: 16,
      targetTexelsPerUnit: 2, lightingMood: 'bright', detailDensity: 'rich',
    });
    applyMapOperations(editor, [
      { type: 'create_box', mins: [8, 0, 0], maxs: [72, 64, 64], texture: 'gothic_wall/stone' },
    ]);

    const review = reviewStyleBrief(editor.serializeMap());
    expect(review.status).toBe('needs-attention');
    expect(review.metrics).toMatchObject({ offGridBrushes: 1, detailRatio: 0, lightCount: 0 });
    expect(review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'style-palette-deviation', severity: 'warning' }),
      expect.objectContaining({ code: 'style-grid-deviation', refs: ['E0:B0'] }),
      expect.objectContaining({ code: 'style-detail-density' }),
      expect.objectContaining({ code: 'style-lighting-mood' }),
    ]));
  });

  test('reports an unconfigured map without inventing constraints', () => {
    const review = reviewStyleBrief(emptyEditor().serializeMap());
    expect(review).toMatchObject({ brief: null, status: 'not-configured', issueCount: 0 });
  });
});
