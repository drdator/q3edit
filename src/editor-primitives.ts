import { createBrushPrimitive, type BrushPrimitive } from './brush-primitives';
import type { Editor } from './editor';
import type { Vec3 } from './math';

export interface ExactPrimitiveParameters {
  primitive: BrushPrimitive;
  center: Vec3;
  dimensions: Vec3;
  axis: number;
  sides: number;
}

export function createExactBrushPrimitive(editor: Editor, parameters: ExactPrimitiveParameters): void {
  const half: Vec3 = [parameters.dimensions[0] / 2, parameters.dimensions[1] / 2, parameters.dimensions[2] / 2];
  const mins: Vec3 = [parameters.center[0] - half[0], parameters.center[1] - half[1], parameters.center[2] - half[2]];
  const maxs: Vec3 = [parameters.center[0] + half[0], parameters.center[1] + half[1], parameters.center[2] + half[2]];
  try {
    const brush = createBrushPrimitive(
      parameters.primitive, mins, maxs, editor.currentTexture,
      parameters.axis, parameters.sides,
    );
    editor.transact(`Create exact ${parameters.primitive}`, () => {
      editor.worldspawn.brushes.push(brush);
      editor.selection = [{ type: 'brush', entity: editor.worldspawn, brush }];
      editor.currentBrushPrimitive = parameters.primitive;
      editor.currentBrushSides = parameters.sides;
      editor.rotationAxis = parameters.axis;
      editor.redrawRequested = true;
      editor.statusMessage = `Created exact ${parameters.primitive} (${parameters.dimensions.join(' x ')})`;
    });
  } catch (error) {
    editor.statusMessage = error instanceof Error ? error.message : 'Invalid primitive parameters';
  }
}
