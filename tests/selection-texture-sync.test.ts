import { describe, expect, it, vi } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createFlatPatch } from '../src/patch';

describe('selection texture synchronization', () => {
  it('makes a selected face current and locates it without editing the map', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'common/caulk');
    brush.faces[0].texture = 'textures/base_wall/metal';
    editor.worldspawn.brushes.push(brush);
    const before = editor.serializeMap();
    const locate = vi.fn();
    editor.onLocateTexture = locate;

    editor.selectFace(editor.worldspawn, brush, brush.faces[0]);

    expect(editor.currentTexture).toBe('base_wall/metal');
    expect(locate).toHaveBeenCalledWith('base_wall/metal');
    expect(editor.serializeMap()).toBe(before);
    expect(editor.hasUnsavedChanges).toBe(false);
  });

  it('makes the shared texture of a uniform brush current', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'textures/base_floor/tile');
    editor.worldspawn.brushes.push(brush);
    const locate = vi.fn();
    editor.onLocateTexture = locate;

    editor.selectBrush(editor.worldspawn, brush);

    expect(editor.currentTexture).toBe('base_floor/tile');
    expect(locate).toHaveBeenCalledWith('base_floor/tile');
  });

  it('leaves the current texture unchanged for a mixed-texture brush', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64], 'base_wall/metal');
    brush.faces[0].texture = 'base_trim/edge';
    editor.worldspawn.brushes.push(brush);
    editor.currentTexture = 'common/caulk';
    const locate = vi.fn();
    editor.onLocateTexture = locate;

    editor.selectBrush(editor.worldspawn, brush);

    expect(editor.currentTexture).toBe('common/caulk');
    expect(locate).not.toHaveBeenCalled();
  });

  it('makes a selected patch texture current', () => {
    const editor = new Editor();
    const patch = createFlatPatch([0, 0, 0], [64, 64, 0], 'textures/base_trim/edge');
    editor.worldspawn.patches.push(patch);
    const locate = vi.fn();
    editor.onLocateTexture = locate;

    editor.selectPatch(editor.worldspawn, patch);

    expect(editor.currentTexture).toBe('base_trim/edge');
    expect(locate).toHaveBeenCalledWith('base_trim/edge');
  });
});
