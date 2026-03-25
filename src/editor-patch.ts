import {
  type Patch,
  createBevelPatch,
  createConePatch,
  createCylinderPatch,
  createEndcapPatch,
  createFlatPatch,
  tessellatePatch,
} from './patch';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import { getSelectedPatchItems } from './editor-selection';
import type { Editor } from './editor';

export function createPatch(
  editor: Editor,
  preset: 'flat' | 'cylinder' | 'cone' | 'bevel' | 'endcap',
): void {
  const bounds = editor.selectionBounds();
  if (!bounds) {
    editor.statusMessage = 'Select a brush first';
    return;
  }
  editor.snapshot();
  const { mins, maxs } = bounds;
  const texture = editor.currentTexture;
  const creators = {
    flat: createFlatPatch,
    cylinder: createCylinderPatch,
    cone: createConePatch,
    bevel: createBevelPatch,
    endcap: createEndcapPatch,
  };
  const patch = creators[preset](mins, maxs, texture);
  editor.worldspawn.patches.push(patch);
  editor.selection = [{ type: 'patch', entity: editor.worldspawn, patch }];
  editor.dirty = true;
  editor.statusMessage = `Created ${preset} patch`;
}

export function changeSubdivisions(editor: Editor, delta: number): void {
  const patchItems = getSelectedPatchItems(editor);
  if (patchItems.length === 0) return;
  editor.snapshot();
  for (const item of patchItems) {
    const subdivisions = Math.max(1, Math.min(24, item.patch.subdivisions + delta));
    item.patch.subdivisions = subdivisions;
    tessellatePatch(item.patch);
  }
  const level = patchItems[0].patch.subdivisions;
  editor.dirty = true;
  editor.statusMessage = `Subdivisions: ${level}`;
}

export function enterPatchEditMode(editor: Editor): void {
  const patchItems = getSelectedPatchItems(editor);
  if (patchItems.length === 0) return;

  editor.patchEditData = [];
  const seen = new Set<Patch>();
  for (const item of patchItems) {
    if (seen.has(item.patch)) continue;
    seen.add(item.patch);
    editor.patchEditData.push({ patch: item.patch, entity: item.entity });
  }

  editor.patchEditMode = true;
  editor.patchControlSelection = [];
  editor.dirty = true;
  editor.statusMessage = 'Patch edit mode';
}

export function exitPatchEditMode(editor: Editor): void {
  if (!editor.patchEditMode) return;
  for (const data of editor.patchEditData) {
    tessellatePatch(data.patch);
  }
  editor.patchEditMode = false;
  editor.patchEditData = [];
  editor.patchControlSelection = [];
  editor.dirty = true;
}

export function selectControlPoint(
  editor: Editor,
  dataIndex: number,
  row: number,
  col: number,
  additive = false,
): void {
  if (!additive) editor.patchControlSelection = [];
  const idx = editor.patchControlSelection.findIndex(
    cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
  );
  if (idx >= 0) {
    if (additive) editor.patchControlSelection.splice(idx, 1);
    return;
  }
  editor.patchControlSelection.push({ dataIndex, row, col });
  editor.dirty = true;
}

export function clearControlPointSelection(editor: Editor): void {
  editor.patchControlSelection = [];
  editor.dirty = true;
}

export function isControlPointSelected(editor: Editor, dataIndex: number, row: number, col: number): boolean {
  return editor.patchControlSelection.some(
    cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
  );
}

export function moveSelectedControlPoints(editor: Editor, delta: Vec3): void {
  if (editor.patchControlSelection.length === 0) return;

  const affectedPatches = new Set<number>();
  for (const controlPoint of editor.patchControlSelection) {
    const data = editor.patchEditData[controlPoint.dataIndex];
    if (!data) continue;
    const point = data.patch.ctrl[controlPoint.row][controlPoint.col];
    point.xyz[0] += delta[0];
    point.xyz[1] += delta[1];
    point.xyz[2] += delta[2];
    affectedPatches.add(controlPoint.dataIndex);
  }

  for (const dataIndex of affectedPatches) {
    tessellatePatch(editor.patchEditData[dataIndex].patch);
  }
  editor.dirty = true;
}

export function patchControlSelectionCenter(editor: Editor): Vec3 | null {
  if (editor.patchControlSelection.length === 0) return null;
  let sum: Vec3 = [0, 0, 0];
  for (const controlPoint of editor.patchControlSelection) {
    const data = editor.patchEditData[controlPoint.dataIndex];
    if (!data) continue;
    const position = data.patch.ctrl[controlPoint.row][controlPoint.col].xyz;
    sum[0] += position[0];
    sum[1] += position[1];
    sum[2] += position[2];
  }
  const count = editor.patchControlSelection.length;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}
