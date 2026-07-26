import { describe, expect, it } from 'vitest';
import { createFlatPatch, createTerrainDefGridPatch } from '../src/patch';
import { createPatchMatrix, deformPatch, deletePatchColumns, deletePatchRows, fitPatchUV, insertPatchColumns, insertPatchRows, inspectPatch, invertPatch, redispersePatchColumns, smoothPatchColumns, smoothPatchRows, thickenPatch, transformPatchUV, transposePatch } from '../src/patch-operations';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { parseMap, serializeMap } from '../src/mapfile';

describe('advanced patch operations', () => {
  it('inserts/deletes rows and columns while retaining legal odd dimensions', () => {
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'test');
    insertPatchRows(patch); insertPatchColumns(patch);
    expect([patch.width, patch.height]).toEqual([5, 5]);
    expect(patch.ctrl.every(row => row.length === 5)).toBe(true);
    deletePatchRows(patch); deletePatchColumns(patch);
    expect([patch.width, patch.height]).toEqual([3, 3]);
  });

  it('transposes, inverts, redisperses, and keeps tessellation valid', () => {
    const patch = createPatchMatrix([0, 0, 0], [128, 64, 0], 'test', 5, 3);
    patch.ctrl[1][2].xyz[2] = 32;
    transposePatch(patch); expect([patch.width, patch.height]).toEqual([3, 5]);
    const first = patch.ctrl[0][0].xyz;
    invertPatch(patch); expect(patch.ctrl[patch.height - 1][0].xyz).toEqual(first);
    redispersePatchColumns(patch);
    expect(patch.tessIndices.length).toBeGreaterThan(0);
    expect(() => createPatchMatrix([0,0,0], [1,1,1], 'x', 4, 3)).toThrow(/odd/);
  });

  it('fits and transforms UVs predictably', () => {
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'test');
    fitPatchUV(patch); expect(patch.ctrl[2][2].uv).toEqual([1, 1]);
    transformPatchUV(patch, [1, 2], [2, 2], 0);
    expect(patch.ctrl[2][2].uv).toEqual([2.5, 3.5]);
  });

  it('smooths row/column anchors and deforms on only the requested axis', () => {
    const columns = createPatchMatrix([0, 0, 0], [128, 64, 0], 'test', 5, 3);
    columns.ctrl[1][1].xyz[2] = 10;
    columns.ctrl[1][2].xyz[2] = 99;
    columns.ctrl[1][3].xyz[2] = 30;
    smoothPatchColumns(columns);
    expect(columns.ctrl[1][2].xyz[2]).toBe(20);

    const rows = createPatchMatrix([0, 0, 0], [64, 128, 0], 'test', 3, 5);
    rows.ctrl[1][1].xyz[2] = 8;
    rows.ctrl[2][1].xyz[2] = 99;
    rows.ctrl[3][1].xyz[2] = 24;
    smoothPatchRows(rows);
    expect(rows.ctrl[2][1].xyz[2]).toBe(16);

    const before = [...rows.ctrl[0][0].xyz];
    deformPatch(rows, 12, 2, () => 1);
    expect(rows.ctrl[0][0].xyz).toEqual([before[0], before[1], before[2] + 12]);
  });

  it('thickens into front/back shells and optional closed side caps', () => {
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'test');
    const thickened = thickenPatch(patch, 8, true);
    expect(thickened).toHaveLength(6);
    expect(thickened.every(result => result.tessIndices.length > 0)).toBe(true);
    expect(Math.abs(thickened[0].mins[2] - thickened[1].mins[2])).toBe(8);
    expect(inspectPatch(thickened[0]).controlPoints).toHaveLength(9);
    expect(thickened[2].mins[1]).toBeCloseTo(64);
    expect(thickened[2].maxs[1]).toBeCloseTo(64);
    expect(thickened[3].mins[1]).toBeCloseTo(0);
    expect(thickened[3].maxs[1]).toBeCloseTo(0);
    expect(thickened[4].mins[0]).toBeCloseTo(0);
    expect(thickened[4].maxs[0]).toBeCloseTo(0);
    expect(thickened[5].mins[0]).toBeCloseTo(64);
    expect(thickened[5].maxs[0]).toBeCloseTo(64);
  });

  it('runs operations transactionally and round-trips their control grid', () => {
    const editor = new Editor(); const world = createEntity('worldspawn');
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'textures/test');
    world.patches.push(patch); editor.entities = [world]; editor.selectPatch(world, patch);
    editor.applyPatchOperation('insert-columns');
    expect(patch.width).toBe(5);
    editor.undo(); expect(editor.entities[0].patches[0].width).toBe(3);
    editor.redo(); expect(editor.entities[0].patches[0].width).toBe(5);
    const parsed = parseMap(serializeMap(editor.entities));
    expect(parsed[0].patches[0].width).toBe(5);
    expect(parsed[0].patches[0].ctrl).toHaveLength(3);
  });

  it('requires deliberate terrain conversion before generic patch operations', () => {
    const editor = new Editor(); const world = createEntity('worldspawn');
    const terrain = createTerrainDefGridPatch([0, 0, 0], [64, 64, 0], 'terrain/base', 3, 3);
    world.patches.push(terrain); editor.entities = [world]; editor.selectPatch(world, terrain);

    editor.applyPatchOperation('insert-columns');
    expect(terrain.width).toBe(3);
    expect(editor.statusMessage).toContain('Convert terrain');

    editor.convertSelectedTerrainToPatch();
    expect(terrain.terrainDef).toBeUndefined();
    editor.applyPatchOperation('insert-columns');
    expect(terrain.width).toBe(5);
    editor.undo();
    expect(editor.entities[0].patches[0].width).toBe(3);
  });
});
