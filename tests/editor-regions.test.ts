import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { REGION_WORLD_LIMIT } from '../src/editor-regions';

describe('region workflows', () => {
  it('sets regions from the current XY view, one brush, and a tall selection', () => {
    const editor = new Editor();
    editor.activeXYViewBounds = { mins: [-320, -200, -REGION_WORLD_LIMIT], maxs: [320, 200, REGION_WORLD_LIMIT] };
    editor.setRegionFromCurrentXYView();
    expect(editor.regionBounds).toEqual(editor.activeXYViewBounds);

    const brush = createBoxBrush([16, 24, 32], [80, 96, 128]);
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);
    editor.setRegionFromSingleBrush();
    expect(editor.regionBounds).toEqual({ mins: [16, 24, 32], maxs: [80, 96, 128] });

    editor.setRegionFromTallSelection();
    expect(editor.regionBounds).toEqual({
      mins: [16, 24, -REGION_WORLD_LIMIT],
      maxs: [80, 96, REGION_WORLD_LIMIT],
    });
  });

  it('exports intersecting geometry and point entities with four compile walls', () => {
    const editor = new Editor();
    const inside = createBoxBrush([0, 0, 0], [32, 32, 32]);
    const outside = createBoxBrush([256, 256, 0], [288, 288, 32]);
    const partialEntity = createEntity('func_door');
    partialEntity.brushes.push(createBoxBrush([48, 48, 0], [96, 96, 64]), createBoxBrush([300, 300, 0], [332, 332, 64]));
    const insideLight = createEntity('light', [24, 24, 16]);
    const outsideLight = createEntity('light', [400, 400, 16]);
    editor.worldspawn.brushes.push(inside, outside);
    editor.entities.push(partialEntity, insideLight, outsideLight);
    editor.regionBounds = { mins: [-64, -64, -128], maxs: [64, 64, 128] };

    const exported = editor.collectRegionEntities(true);
    expect(exported[0].brushes).toHaveLength(5);
    expect(exported.find(entity => entity.classname === 'func_door')?.brushes).toHaveLength(1);
    expect(exported.filter(entity => entity.classname === 'light')).toHaveLength(1);
    const parsed = parseMapWithDiagnostics(editor.serializeRegionMap(true));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.entities[0].brushes).toHaveLength(5);
  });

  it('rejects ambiguous brush-region selection', () => {
    const editor = new Editor();
    const first = createBoxBrush([0, 0, 0], [16, 16, 16]);
    const second = createBoxBrush([32, 0, 0], [48, 16, 16]);
    editor.worldspawn.brushes.push(first, second);
    editor.selection = [
      { type: 'brush', entity: editor.worldspawn, brush: first },
      { type: 'brush', entity: editor.worldspawn, brush: second },
    ];
    editor.setRegionFromSingleBrush();
    expect(editor.regionBounds).toBeNull();
    expect(editor.statusMessage).toContain('exactly one brush');
  });
});
