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

function mouseEvent(
  clientX: number,
  clientY: number,
  modifiers: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
): MouseEvent {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as MouseEvent;
}

function interactionContext(
  editor: Editor,
  axes: { h: number; v: number; depth: number } = { h: 0, v: 1, depth: 2 },
  depthCenter = 0,
): Viewport2DInteractionContext {
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
    axisH: axes.h,
    axisV: axes.v,
    axisDepth: axes.depth,
    axisLabels: ['X', 'Y'],
    centerX: 0,
    centerY: 0,
    zoom: 1,
    getDepthCenter: () => depthCenter,
    interaction: createViewport2DInteractionState(),
    screenToWorld: (x, y) => [x, y],
  };
}

describe('2D viewport selection interaction', () => {
  it.each([
    ['XY', { h: 0, v: 1, depth: 2 }],
    ['XZ', { h: 0, v: 2, depth: 1 }],
    ['YZ', { h: 1, v: 2, depth: 0 }],
  ] as const)('centers brushes created in the %s view on the orthogonal view centers', (_name, axes) => {
    const editor = new Editor();
    editor.activeTool = 'create';
    editor.createDepth = 64;
    const ctx = interactionContext(editor, axes, 160);

    handleViewport2DMouseDown(ctx, mouseEvent(16, 32));
    handleViewport2DMouseMove(ctx, mouseEvent(80, 96));
    handleViewport2DMouseUp(ctx, mouseEvent(80, 96));

    const brush = editor.worldspawn.brushes[0];
    expect(brush.mins[axes.depth]).toBe(128);
    expect(brush.maxs[axes.depth]).toBe(192);
  });

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

  it('locks a selected object move to the current dominant direction from mouse-down', () => {
    const editor = new Editor();
    const brush = createBoxBrush([0, 0, 0], [32, 32, 32]);
    editor.worldspawn.brushes.push(brush);
    editor.selectBrush(editor.worldspawn, brush);

    const ctx = interactionContext(editor);
    handleViewport2DMouseDown(ctx, mouseEvent(16, 16, { shiftKey: true }));

    expect(editor.isSelected(brush)).toBe(true);

    handleViewport2DMouseMove(ctx, mouseEvent(40, 24, { shiftKey: true }));
    expect(brush.mins.slice(0, 2)).toEqual([32, 0]);

    // Crossing the diagonal switches the lock while preserving the mouse-down anchor.
    handleViewport2DMouseMove(ctx, mouseEvent(48, 80, { shiftKey: true }));
    expect(brush.mins.slice(0, 2)).toEqual([0, 64]);

    // Releasing Shift removes the constraint during the same drag.
    handleViewport2DMouseMove(ctx, mouseEvent(48, 80));
    expect(brush.mins.slice(0, 2)).toEqual([32, 64]);

    // Reapplying a horizontal lock returns to the Y position from mouse-down.
    handleViewport2DMouseMove(ctx, mouseEvent(96, 40, { shiftKey: true }));
    expect(brush.mins.slice(0, 2)).toEqual([80, 0]);

    handleViewport2DMouseUp(ctx, mouseEvent(96, 40));
  });
});
