import { describe, expect, it } from 'vitest';
import { validateBrush } from '../src/brush';
import { createBrushPrimitive } from '../src/brush-primitives';
import { Editor } from '../src/editor';

describe('brush primitive parameters', () => {
  it('supports arbitrary validated cylinder and cone side counts', () => {
    const cylinder = createBrushPrimitive('cylinder', [-32768, -16384, -8192], [32768, 16384, 8192], 'test', 2, 64);
    const cone = createBrushPrimitive('cone', [-128, -96, -64], [128, 96, 256], 'test', 0, 37);
    expect(cylinder.faces).toHaveLength(66);
    expect(cone.faces).toHaveLength(38);
    expect(validateBrush(cylinder)).toEqual({ valid: true, issues: [] });
    expect(validateBrush(cone)).toEqual({ valid: true, issues: [] });
  });

  it('creates exact dimensions and orientation transactionally', () => {
    const editor = new Editor();
    editor.createExactBrushPrimitive({
      primitive: 'cylinder', center: [100, 200, 300], dimensions: [40, 60, 80], axis: 0, sides: 17,
    });
    const brush = editor.worldspawn.brushes[0];
    expect(brush.mins[0]).toBeCloseTo(80); expect(brush.mins[1]).toBeCloseTo(170); expect(brush.mins[2]).toBeCloseTo(260);
    expect(brush.maxs[0]).toBeCloseTo(120); expect(brush.maxs[1]).toBeCloseTo(230); expect(brush.maxs[2]).toBeCloseTo(340);
    expect(brush.faces).toHaveLength(19);
    expect(editor.currentBrushSides).toBe(17);
    expect(editor.rotationAxis).toBe(0);
    editor.undo();
    expect(editor.worldspawn.brushes).toHaveLength(0);
    editor.redo();
    expect(editor.worldspawn.brushes[0].faces).toHaveLength(19);
  });

  it('rejects degenerate bounds and invalid side counts', () => {
    expect(() => createBrushPrimitive('cylinder', [0, 0, 0], [64, 64, 64], 'x', 2, 2)).toThrow(/3 to 64/);
    expect(() => createBrushPrimitive('cylinder', [0, 0, 0], [64, 64, 64], 'x', 2, 65)).toThrow(/3 to 64/);
    expect(() => createBrushPrimitive('sphere', [0, 0, 0], [64, 64, 64], 'x', 2, 33)).toThrow(/4 to 32/);
    expect(() => createBrushPrimitive('cone', [0, 0, 0], [64, 64, 64], 'x', 2, 7.5)).toThrow(/integer/);
    expect(() => createBrushPrimitive('box', [0, 0, 0], [64, 0, 64], 'x', 2, 6)).toThrow(/greater than zero/);
    expect(() => createBrushPrimitive('box', [0, 0, 0], [64, Number.NaN, 64], 'x', 2, 6)).toThrow(/finite/);
  });
});
