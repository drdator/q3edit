import { describe, expect, it } from 'vitest';
import { computeFaceUV, createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import {
  faceTexelDensity,
  selectedTextureDensityReport,
  setTextureDensity,
  transferFaceProjection,
  wrapTextureSelection,
} from '../src/editor-textures';
import { alignSelectedPatchBoundaries, naturalizeSelectedPatchesByDistance } from '../src/editor-patch';
import { createFlatPatch } from '../src/patch';
import { SurfaceAlignmentSession } from '../src/surface-alignment-session';

function adjacentFaces() {
  const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/metal');
  for (const source of brush.faces) for (const target of brush.faces) {
    if (source === target) continue;
    const shared = source.polygon.filter(point => target.polygon.some(other =>
      Math.hypot(...point.map((value, axis) => value - other[axis])) < 0.01));
    if (shared.length >= 2) return { brush, source, target, shared };
  }
  throw new Error('box fixture has no adjacent faces');
}

describe('advanced surface alignment', () => {
  it('transfers a world projection continuously across adjacent classic faces', () => {
    const editor = new Editor();
    const { source, target, shared } = adjacentFaces();
    if (source.textureProjection.kind !== 'classic') throw new Error('expected classic projection');
    source.textureProjection.offsetX = 23;
    source.textureProjection.offsetY = -11;
    source.textureProjection.scaleX = 0.375;
    source.textureProjection.scaleY = 0.625;
    source.textureProjection.rotation = 17;
    expect(transferFaceProjection(editor, source, target, 'world')).toBe(true);
    for (const point of shared) {
      const expected = computeFaceUV(point, source, 128, 128);
      const actual = computeFaceUV(point, target, 128, 128);
      expect(actual[0]).toBeCloseTo(expected[0], 4);
      expect(actual[1]).toBeCloseTo(expected[1], 4);
    }
    expect(target.textureProjection.kind).toBe('classic');
  });

  it('wraps only a closed face loop from one convex brush', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/metal');
    editor.worldspawn.brushes.push(brush);
    const sideFaces = brush.faces.filter(face => Math.abs(face.plane.normal[2]) < 0.5);
    editor.selection = sideFaces.map(face => ({ type: 'face' as const, entity: editor.worldspawn, brush, face }));
    expect(wrapTextureSelection(editor)).toBe(3);
    editor.selection = editor.selection.slice(0, 3);
    expect(wrapTextureSelection(editor)).toBe(0);
    expect(editor.statusMessage).toMatch(/closed convex loop/i);
  });

  it('sets and reports consistent texel density without changing projection formats', () => {
    const editor = new Editor();
    const { brush, source, target } = adjacentFaces();
    target.textureProjection = { kind: 'brush-primitive', matrix: [[0.01, 0, 0], [0, 0.01, 0]] };
    editor.worldspawn.brushes.push(brush);
    editor.selection = [
      { type: 'face', entity: editor.worldspawn, brush, face: source },
      { type: 'face', entity: editor.worldspawn, brush, face: target },
    ];
    setTextureDensity(editor, 2);
    expect(faceTexelDensity(editor, source)).toBeCloseTo(2, 5);
    expect(faceTexelDensity(editor, target)).toBeCloseTo(2, 5);
    expect(selectedTextureDensityReport(editor)).toMatchObject({ count: 2, inconsistent: 0 });
    expect(target.textureProjection.kind).toBe('brush-primitive');
  });

  it('aligns patch boundary UVs and naturalizes by surface distance', () => {
    const editor = new Editor();
    const first = createFlatPatch([0, 0, 0], [128, 128, 0], 'base_floor/stone');
    const second = createFlatPatch([128, 0, 0], [256, 128, 0], 'base_floor/stone');
    editor.worldspawn.patches.push(first, second);
    first.ctrl.forEach(row => row.forEach((point, col) => { point.uv = [col * 0.25, 3]; }));
    second.ctrl.forEach(row => row.forEach(point => { point.uv = [9, 9]; }));
    editor.selection = [
      { type: 'patch', entity: editor.worldspawn, patch: first },
      { type: 'patch', entity: editor.worldspawn, patch: second },
    ];
    expect(alignSelectedPatchBoundaries(editor)).toBe(true);
    expect(second.ctrl.map(row => row[0].uv)).not.toEqual([[9, 9], [9, 9], [9, 9]]);
    naturalizeSelectedPatchesByDistance(editor, 64);
    expect(first.ctrl[0][first.width - 1].uv[0]).toBeCloseTo(2, 4);
  });

  it('refuses to align unrelated patch boundaries', () => {
    const editor = new Editor();
    const first = createFlatPatch([0, 0, 0], [128, 128, 0], 'base_floor/stone');
    const second = createFlatPatch([1_024, 0, 0], [1_152, 128, 0], 'base_floor/stone');
    editor.worldspawn.patches.push(first, second);
    editor.selection = [
      { type: 'patch', entity: editor.worldspawn, patch: first },
      { type: 'patch', entity: editor.worldspawn, patch: second },
    ];
    expect(alignSelectedPatchBoundaries(editor)).toBe(false);
    expect(editor.statusMessage).toMatch(/units apart/i);
  });

  it('cancels a live alignment preview and restores the face selection', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/metal');
    editor.worldspawn.brushes.push(brush);
    const faceIndex = 4;
    const face = brush.faces[faceIndex];
    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush, face }];
    if (face.textureProjection.kind !== 'classic') throw new Error('expected classic projection');
    const originalOffset = face.textureProjection.offsetX;
    const originalRevision = editor.documentRevision;
    const session = new SurfaceAlignmentSession(editor);

    editor.shiftTexture(32, 0);
    expect(face.textureProjection.offsetX).toBeCloseTo(originalOffset + 32);
    expect(editor.history.undoCount).toBe(0);

    expect(session.cancel()).toBe(true);
    const restoredBrush = editor.worldspawn.brushes[0];
    const restoredFace = restoredBrush.faces[faceIndex];
    expect(restoredFace.textureProjection.kind).toBe('classic');
    if (restoredFace.textureProjection.kind === 'classic') {
      expect(restoredFace.textureProjection.offsetX).toBeCloseTo(originalOffset);
    }
    expect(editor.selection).toEqual([
      { type: 'face', entity: editor.worldspawn, brush: restoredBrush, face: restoredFace },
    ]);
    expect(editor.documentRevision).toBe(originalRevision);
    expect(editor.history.undoCount).toBe(0);
  });

  it('applies all preview changes as one undoable alignment edit', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [128, 128, 128], 'base_wall/metal');
    editor.worldspawn.brushes.push(brush);
    const face = brush.faces[4];
    editor.selection = [{ type: 'face', entity: editor.worldspawn, brush, face }];
    if (face.textureProjection.kind !== 'classic') throw new Error('expected classic projection');
    const originalOffset = face.textureProjection.offsetX;
    const originalRotation = face.textureProjection.rotation;
    const session = new SurfaceAlignmentSession(editor);

    editor.shiftTexture(24, 0);
    editor.rotateTexture(30);

    expect(session.apply()).toBe(true);
    expect(editor.history.undoCount).toBe(1);
    expect(editor.history.undoLabel).toBe('Align surfaces');
    expect(face.textureProjection.offsetX).toBeCloseTo(originalOffset + 24);
    expect(face.textureProjection.rotation).toBeCloseTo(originalRotation + 30);

    editor.undo();
    const restored = editor.worldspawn.brushes[0].faces[4].textureProjection;
    expect(restored.kind).toBe('classic');
    if (restored.kind === 'classic') {
      expect(restored.offsetX).toBeCloseTo(originalOffset);
      expect(restored.rotation).toBeCloseTo(originalRotation);
    }
  });
});
