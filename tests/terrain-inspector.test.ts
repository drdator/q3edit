import { describe, expect, it } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { createTerrainDefGridPatch } from '../src/patch';
import { inspectTerrain } from '../src/terrain-inspector';
import { TERRAIN_MODEL_DECISION, validateTerrainMesh } from '../src/terrain-model';

function groupedTerrainEditor(): { editor: Editor; left: ReturnType<typeof createTerrainDefGridPatch>; right: ReturnType<typeof createTerrainDefGridPatch> } {
  const editor = new Editor();
  const world = createEntity('worldspawn');
  const left = createTerrainDefGridPatch([0, 0, 0], [64, 64, 0], 'terrain/base', 3, 3);
  const right = createTerrainDefGridPatch([64, 0, 0], [128, 64, 0], 'terrain/base', 3, 3);
  left.terrainGroupId = right.terrainGroupId = 'terrain-test';
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      left.ctrl[row][column].terrainCoord = [row, column];
      right.ctrl[row][column].terrainCoord = [row, column + 2];
    }
  }
  world.patches.push(left, right);
  editor.entities = [world];
  return { editor, left, right };
}

describe('terrain model and inspector', () => {
  it('uses an explicit unified model adapter and exposes every sample field', () => {
    const terrain = createTerrainDefGridPatch([0, 0, 0], [64, 64, 8], 'terrain/base', 3, 3);
    terrain.terrainDef!.surfaces[1][2] = {
      texture: 'terrain/rock', offsetX: 3, offsetY: -2, rotation: 45,
      scaleX: 0.25, scaleY: 0.75, contentFlags: 4, surfaceFlags: 8, value: 9,
    };
    const model = inspectTerrain(terrain)!;
    expect(TERRAIN_MODEL_DECISION).toBe('unified-patch-with-explicit-terrain-adapter');
    expect(validateTerrainMesh(terrain)).toEqual({ valid: true, issues: [] });
    expect(model.samples).toHaveLength(9);
    expect(model.samples.find(sample => sample.row === 1 && sample.column === 2)).toMatchObject({
      height: 8, texture: 'terrain/rock', offsetX: 3, offsetY: -2, rotation: 45,
      scaleX: 0.25, scaleY: 0.75, contentFlags: 4, surfaceFlags: 8, value: 9,
    });
  });

  it('edits sample metadata transactionally with undo and redo', () => {
    const { editor, left } = groupedTerrainEditor();
    editor.updateTerrainSample(left, 1, 1, { texture: 'terrain/mud', rotation: 30, value: 7 });
    expect(left.terrainDef!.surfaces[1][1]).toMatchObject({ texture: 'terrain/mud', rotation: 30, value: 7 });
    editor.undo();
    expect(editor.entities[0].patches[0].terrainDef!.surfaces[1][1].texture).toBe('terrain/base');
    editor.redo();
    expect(editor.entities[0].patches[0].terrainDef!.surfaces[1][1].texture).toBe('terrain/mud');
  });

  it('keeps grouped seam heights aligned and selects logical rows across tiles', () => {
    const { editor, left, right } = groupedTerrainEditor();
    editor.updateTerrainSample(right, 1, 0, { height: 24 });
    expect(right.ctrl[1][0].xyz[2]).toBe(24);
    expect(left.ctrl[1][2].xyz[2]).toBe(24);

    editor.selectPatch(editor.worldspawn, left);
    editor.enterPatchEditMode();
    editor.patchControlSelection = [{ dataIndex: 0, row: 1, col: 1 }];
    editor.selectTerrainRows();
    expect(editor.patchControlSelection).toHaveLength(6);
    expect(editor.patchControlSelection.every(selection => selection.row === 1)).toBe(true);
  });
});
