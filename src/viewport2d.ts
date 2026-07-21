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

  frameBounds(bounds: { mins: [number, number, number]; maxs: [number, number, number] }): void {
    this.centerX = (bounds.mins[this.axisH] + bounds.maxs[this.axisH]) / 2;
    this.centerY = (bounds.mins[this.axisV] + bounds.maxs[this.axisV]) / 2;
    const width = Math.max(1, bounds.maxs[this.axisH] - bounds.mins[this.axisH]);
    const height = Math.max(1, bounds.maxs[this.axisV] - bounds.mins[this.axisV]);
    this.zoom = Math.max(0.01, Math.min(64,
      Math.min(this.canvas.clientWidth / width, this.canvas.clientHeight / height) * 0.82,
    ));
    this.editor.redrawRequested = true;
  }

  capturePng(width?: number, height?: number, layoutOverlay = false): {
    mimeType: string; data: string; width: number; height: number;
    gridSize?: number; majorGridSize?: number; axisLabels?: [string, string]; worldUnitsPerPixel?: number;
  } {
    this.render();
    const sourceWidth = this.canvas.width;
    const sourceHeight = this.canvas.height;
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error('The 2D viewport has no drawable area');
    const outputWidth = Math.max(64, Math.min(Math.round(width ?? sourceWidth), 2048));
    const outputHeight = Math.max(64, Math.min(Math.round(height ?? sourceHeight), 2048));
    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    const outputContext = output.getContext('2d')!;
    outputContext.drawImage(this.canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    const worldUnitsPerPixel = this.canvas.clientWidth / Math.max(1, this.zoom * outputWidth);
    const majorGridSize = Math.max(this.editor.gridSize * 8, 64);
    if (layoutOverlay) this.drawLayoutOverlay(outputContext, outputWidth, outputHeight, worldUnitsPerPixel, majorGridSize);
    const dataUrl = output.toDataURL('image/png');
    return {
      mimeType: 'image/png', data: dataUrl.slice(dataUrl.indexOf(',') + 1), width: outputWidth, height: outputHeight,
      ...(layoutOverlay ? { gridSize: this.editor.gridSize, majorGridSize, axisLabels: this.axisLabels, worldUnitsPerPixel } : {}),
    };
  }

  private drawLayoutOverlay(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    worldUnitsPerPixel: number,
    majorGridSize: number,
  ): void {
    const scaleUnits = Math.max(this.editor.gridSize, 2 ** Math.round(Math.log2(Math.max(1, worldUnitsPerPixel * 140))));
    const scalePixels = scaleUnits / worldUnitsPerPixel;
    context.save();
    context.fillStyle = 'rgba(15, 15, 15, 0.86)';
    context.fillRect(14, height - 58, Math.min(width - 28, Math.max(300, scalePixels + 185)), 44);
    context.fillStyle = '#d0d0d0';
    context.font = '13px monospace';
    context.textBaseline = 'top';
    context.fillText(`${this.axis.toUpperCase()} · ${this.axisLabels[0]}/${this.axisLabels[1]} · grid ${this.editor.gridSize} · major ${majorGridSize}`, 26, height - 50);
    context.strokeStyle = '#f0a020';
    context.fillStyle = '#f0a020';
    context.lineWidth = 2;
    const barX = 26;
    const barY = height - 25;
    context.beginPath();
    context.moveTo(barX, barY - 5); context.lineTo(barX, barY + 5);
    context.moveTo(barX, barY); context.lineTo(barX + scalePixels, barY);
    context.moveTo(barX + scalePixels, barY - 5); context.lineTo(barX + scalePixels, barY + 5);
    context.stroke();
    context.fillText(`${scaleUnits} units`, barX + scalePixels + 10, barY - 8);
    context.textAlign = 'right';
    context.fillText(`${this.axisLabels[0]} →   ${this.axisLabels[1]} ↑`, width - 20, 18);
    context.restore();
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
