import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import {
  createViewport2DInteractionState,
  handleViewport2DMouseDown,
  handleViewport2DMouseMove,
  handleViewport2DMouseUp,
  type Viewport2DInteractionContext,
} from '../src/viewport2d-interaction';

function mouseEvent(clientX: number, clientY: number): MouseEvent {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  } as MouseEvent;
}

function interactionContext(editor: Editor): Viewport2DInteractionContext {
  const parentElement = { style: { cursor: '' } };
  const canvas = {
    clientWidth: 256,
    clientHeight: 256,
    parentElement,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    editor,
    axisH: 0,
    axisV: 1,
    axisDepth: 2,
    axisLabels: ['X', 'Y'],
    centerX: 0,
    centerY: 0,
    zoom: 1,
    interaction: createViewport2DInteractionState(),
    screenToWorld: (x, y) => [x, y],
  };
}

describe('2D viewport selection interaction', () => {
  it('starts a marquee on locked geometry and selects unlocked objects in the dragged area', () => {
    const editor = new Editor();
    const lockedBrush = createBoxBrush([0, 0, 0], [32, 32, 32]);
    const selectableBrush = createBoxBrush([80, 80, 0], [96, 96, 32]);
    editor.worldspawn.brushes.push(lockedBrush, selectableBrush);
    editor.selectBrush(editor.worldspawn, lockedBrush);
    const group = editor.createNamedGroup('Locked geometry')!;
    editor.setNamedGroupLocked(group.id, true);

    const ctx = interactionContext(editor);
    handleViewport2DMouseDown(ctx, mouseEvent(16, 16));

    expect(ctx.interaction.rubberBanding).toBe(true);
    expect(ctx.interaction.dragging).toBe(false);

    handleViewport2DMouseMove(ctx, mouseEvent(110, 110));
    handleViewport2DMouseUp(ctx, mouseEvent(110, 110));

    expect(editor.isSelected(lockedBrush)).toBe(false);
    expect(editor.isSelected(selectableBrush)).toBe(true);
  });
});
