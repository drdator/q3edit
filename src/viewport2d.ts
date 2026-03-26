import { Editor } from './editor';
import { createViewport2DInteractionState, setupViewport2DInteraction } from './viewport2d-interaction';
import { renderViewport2D } from './viewport2d-render';

export type ViewAxis = 'xy' | 'xz' | 'yz';

const AXIS_MAP: Record<ViewAxis, { h: number; v: number; depth: number; labels: [string, string] }> = {
  xy: { h: 0, v: 1, depth: 2, labels: ['X', 'Y'] },
  xz: { h: 0, v: 2, depth: 1, labels: ['X', 'Z'] },
  yz: { h: 1, v: 2, depth: 0, labels: ['Y', 'Z'] },
};

export class Viewport2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  editor: Editor;
  axis: ViewAxis;
  axisH: number;
  axisV: number;
  axisDepth: number;
  axisLabels: [string, string];

  centerX = 256;
  centerY = 128;
  zoom = 1;

  interaction = createViewport2DInteractionState();

  constructor(canvas: HTMLCanvasElement, editor: Editor, axis: ViewAxis) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.editor = editor;
    this.axis = axis;
    const info = AXIS_MAP[axis];
    this.axisH = info.h;
    this.axisV = info.v;
    this.axisDepth = info.depth;
    this.axisLabels = info.labels;

    setupViewport2DInteraction(this);
    this.editor.onCenterOnSelection(() => this.centerOnSelection());
    this.editor.onLocatePoint((point) => {
      this.centerX = point[this.axisH];
      this.centerY = point[this.axisV];
    });
  }

  centerOnSelection(): void {
    const bounds = this.editor.selectionBounds();
    if (!bounds) return;
    this.centerX = (bounds.mins[this.axisH] + bounds.maxs[this.axisH]) / 2;
    this.centerY = (bounds.mins[this.axisV] + bounds.maxs[this.axisV]) / 2;
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    return [
      cx + (wx - this.centerX) * this.zoom,
      cy - (wy - this.centerY) * this.zoom,
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    return [
      (sx - cx) / this.zoom + this.centerX,
      -(sy - cy) / this.zoom + this.centerY,
    ];
  }

  render(): void {
    renderViewport2D({
      canvas: this.canvas,
      ctx: this.ctx,
      editor: this.editor,
      axisH: this.axisH,
      axisV: this.axisV,
      axisDepth: this.axisDepth,
      centerX: this.centerX,
      centerY: this.centerY,
      zoom: this.zoom,
      rotating: this.interaction.rotating,
      rotateStartAngle: this.interaction.rotateStartAngle,
      rotateAppliedAngle: this.interaction.rotateAppliedAngle,
      geoSnapLines: this.interaction.geoSnapLines,
      rubberBanding: this.interaction.rubberBanding,
      rubberBandStart: this.interaction.rubberBandStart,
      rubberBandEnd: this.interaction.rubberBandEnd,
      worldToScreen: (wx, wy) => this.worldToScreen(wx, wy),
      screenToWorld: (sx, sy) => this.screenToWorld(sx, sy),
    });
  }
}
