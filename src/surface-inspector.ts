import { cloneTextureProjection, type BrushFace, type BrushTextureProjection } from './brush';
import type { Editor } from './editor';
import {
  getTextureFaces,
  rotateTexture as rotateFaceTexture,
  scaleTextureFromProjection,
  shiftTexture as shiftFaceTexture,
} from './editor-textures';
import { updateFaceProperties } from './editor-properties';
import {
  faceUvPolygon,
  fitUvViewport,
  screenToUv,
  shortestAngleDelta,
  uvToScreen,
  type UvPoint,
  type UvViewport,
} from './uv-editor';

const SCALE_DRAG_MODES = [
  'scale-left',
  'scale-right',
  'scale-top',
  'scale-bottom',
  'scale-top-left',
  'scale-top-right',
  'scale-bottom-left',
  'scale-bottom-right',
] as const;

type ScaleDragMode = typeof SCALE_DRAG_MODES[number];
type DragMode = 'translate' | 'rotate' | ScaleDragMode;
type ScaleHandleMap = Record<ScaleDragMode, [number, number]>;

function isScaleDrag(mode: DragMode | null): mode is ScaleDragMode {
  return mode !== null && (SCALE_DRAG_MODES as readonly string[]).includes(mode);
}

export const MAX_SURFACE_PREVIEWS = 12;

export function surfaceDragMultiplier(fineControl: boolean, coarseControl = false): number {
  if (fineControl && coarseControl) return 1;
  if (fineControl) return 0.1;
  return coarseControl ? 10 : 1;
}

export function surfaceScaleFactor(startSpan: number, currentSpan: number, sensitivity = 1): number {
  const safeStartSpan = Math.abs(startSpan) >= 1
    ? startSpan
    : (startSpan < 0 ? -1 : 1);
  const rawRatio = currentSpan / safeStartSpan;
  if (rawRatio <= 0) return 0.02;
  const spanRatio = Math.max(0.02, rawRatio);
  return Math.max(0.02, Math.min(50, spanRatio ** sensitivity));
}

export function surfaceSelectionSignature(editor: Editor): string {
  return editor.selection.map(item => {
    const entityIndex = editor.entities.indexOf(item.entity);
    if (item.type === 'entity') return `e${entityIndex}`;
    if (item.type === 'patch') return `e${entityIndex}:p${item.entity.patches.indexOf(item.patch)}`;
    const brushIndex = item.entity.brushes.indexOf(item.brush);
    if (item.type === 'brush') return `e${entityIndex}:b${brushIndex}`;
    return `e${entityIndex}:b${brushIndex}:f${item.brush.faces.indexOf(item.face)}`;
  }).join('|');
}

interface PreviewSurface {
  texture: string;
  points: UvPoint[];
  clipPoints: UvPoint[];
  rows?: UvPoint[][];
  source: boolean;
  face?: BrushFace;
}

interface PreviewTextureImage {
  image: HTMLImageElement | null;
  ready: boolean;
  pattern: CanvasPattern | null;
}

interface PreviewCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewInteraction {
  face: BrushFace;
  center: [number, number];
  rotateHandle: [number, number];
  scaleHandles: ScaleHandleMap;
  viewport: UvViewport;
}

interface PreviewPalette {
  background: string;
  footer: string;
  grid: string;
  accent: string;
  info: string;
  success: string;
}

function scaleHandlesForPoints(points: Array<[number, number]>): ScaleHandleMap {
  const left = Math.min(...points.map(point => point[0]));
  const right = Math.max(...points.map(point => point[0]));
  const top = Math.min(...points.map(point => point[1]));
  const bottom = Math.max(...points.map(point => point[1]));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    'scale-left': [left, centerY],
    'scale-right': [right, centerY],
    'scale-top': [centerX, top],
    'scale-bottom': [centerX, bottom],
    'scale-top-left': [left, top],
    'scale-top-right': [right, top],
    'scale-bottom-left': [left, bottom],
    'scale-bottom-right': [right, bottom],
  };
}

function scaleAnchorForMode(points: UvPoint[], mode: ScaleDragMode): UvPoint {
  const minU = Math.min(...points.map(point => point.u));
  const maxU = Math.max(...points.map(point => point.u));
  const minV = Math.min(...points.map(point => point.v));
  const maxV = Math.max(...points.map(point => point.v));
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  switch (mode) {
    case 'scale-left': return { u: maxU, v: centerV };
    case 'scale-right': return { u: minU, v: centerV };
    case 'scale-top': return { u: centerU, v: maxV };
    case 'scale-bottom': return { u: centerU, v: minV };
    case 'scale-top-left': return { u: maxU, v: maxV };
    case 'scale-top-right': return { u: minU, v: maxV };
    case 'scale-bottom-left': return { u: maxU, v: minV };
    case 'scale-bottom-right': return { u: minU, v: minV };
  }
}

function scaleModeAffectsU(mode: ScaleDragMode): boolean {
  return mode !== 'scale-top' && mode !== 'scale-bottom';
}

function scaleModeAffectsV(mode: ScaleDragMode): boolean {
  return mode !== 'scale-left' && mode !== 'scale-right';
}

function scaleHandleAt(
  point: [number, number],
  handles: ScaleHandleMap,
  threshold: number,
): ScaleDragMode | null {
  const hitOrder: readonly ScaleDragMode[] = [
    'scale-top-left',
    'scale-top-right',
    'scale-bottom-left',
    'scale-bottom-right',
    'scale-left',
    'scale-right',
    'scale-top',
    'scale-bottom',
  ];
  return hitOrder.find(mode => distance(point, handles[mode]) <= threshold) ?? null;
}

function scaleHandleCursor(mode: ScaleDragMode): string {
  if (mode === 'scale-left' || mode === 'scale-right') return 'ew-resize';
  if (mode === 'scale-top' || mode === 'scale-bottom') return 'ns-resize';
  return mode === 'scale-top-left' || mode === 'scale-bottom-right'
    ? 'nwse-resize'
    : 'nesw-resize';
}

function drawScaleHandle(
  context: CanvasRenderingContext2D,
  point: [number, number],
  mode: ScaleDragMode,
  color: string,
  size: number,
): void {
  context.fillStyle = color;
  if (mode === 'scale-left' || mode === 'scale-right') {
    context.fillRect(point[0] - size * 0.35, point[1] - size * 0.65, size * 0.7, size * 1.3);
  } else if (mode === 'scale-top' || mode === 'scale-bottom') {
    context.fillRect(point[0] - size * 0.65, point[1] - size * 0.35, size * 1.3, size * 0.7);
  } else {
    context.fillRect(point[0] - size / 2, point[1] - size / 2, size, size);
  }
}

function drawScaleBox(
  context: CanvasRenderingContext2D,
  handles: ScaleHandleMap,
  color: string,
  size: number,
  activeMode: ScaleDragMode | null,
): void {
  const left = handles['scale-left'][0];
  const right = handles['scale-right'][0];
  const top = handles['scale-top'][1];
  const bottom = handles['scale-bottom'][1];
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.setLineDash([3, 3]);
  context.strokeRect(left, top, right - left, bottom - top);
  context.restore();
  for (const mode of SCALE_DRAG_MODES) {
    drawScaleHandle(context, handles[mode], mode, color, mode === activeMode ? size * 1.25 : size);
  }
}

export function surfacePreviewCells(
  count: number,
  width: number,
  height: number,
  columns = width >= 360 ? 2 : 1,
): PreviewCell[] {
  if (count <= 0) return [];
  const gap = 8;
  const columnCount = Math.max(1, Math.min(count, columns));
  const rowCount = Math.ceil(count / columnCount);
  const cellWidth = Math.max(1, (width - gap * (columnCount + 1)) / columnCount);
  const cellHeight = Math.max(1, (height - gap * (rowCount + 1)) / rowCount);
  return Array.from({ length: count }, (_, index) => ({
    x: gap + (index % columnCount) * (cellWidth + gap),
    y: gap + Math.floor(index / columnCount) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight,
  }));
}

export function surfacePreviewLimit(columns: number): number {
  return Math.min(MAX_SURFACE_PREVIEWS, Math.max(1, columns) * 6);
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.addEventListener('click', action);
  return result;
}

function option(value: string, label: string): HTMLOptionElement {
  return Object.assign(document.createElement('option'), { value, textContent: label });
}

function numberInput(value: number, min?: number): HTMLInputElement {
  const result = document.createElement('input');
  result.type = 'number';
  result.step = 'any';
  result.value = String(value);
  if (min !== undefined) result.min = String(min);
  return result;
}

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const result = document.createElement('label');
  result.className = 'surface-inspector-field';
  result.append(Object.assign(document.createElement('span'), { textContent: label }), control);
  return result;
}

function section(title: string): { root: HTMLElement; content: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'surface-inspector-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const content = document.createElement('div');
  content.className = 'surface-inspector-section-content';
  root.append(heading, content);
  return { root, content };
}

function eventPoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  bounds = canvas.getBoundingClientRect(),
): [number, number] {
  return [
    (event.clientX - bounds.left) * canvas.width / Math.max(1, bounds.width),
    (event.clientY - bounds.top) * canvas.height / Math.max(1, bounds.height),
  ];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function projectionSummary(face: BrushFace): string {
  if (face.textureProjection.kind === 'classic') {
    const projection = face.textureProjection;
    return `Shift ${projection.offsetX.toFixed(1)}, ${projection.offsetY.toFixed(1)} · Scale ${projection.scaleX.toFixed(3)}, ${projection.scaleY.toFixed(3)} · ${projection.rotation.toFixed(1)}°`;
  }
  return 'Brush primitive matrix projection';
}

function resizeCanvas(canvas: HTMLCanvasElement, minimumWidth: number, minimumHeight: number): boolean {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(minimumWidth, Math.round(bounds.width * ratio));
  const height = Math.max(minimumHeight, Math.round(bounds.height * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function canvasDisplayScale(canvas: HTMLCanvasElement): number {
  const cssWidth = canvas.getBoundingClientRect().width;
  return cssWidth > 0 ? canvas.width / cssWidth : 1;
}

function previewPalette(): PreviewPalette {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: color('--bg-darker', '#1a1a1a'),
    footer: color('--bg-dark', '#191919'),
    grid: color('--grid-minor', 'rgba(255,255,255,.08)'),
    accent: color('--accent', '#e8a030'),
    info: color('--info', '#67b7d1'),
    success: color('--success', '#78c46b'),
  };
}

export function patchClipPolygon(rows: UvPoint[][]): UvPoint[] {
  if (rows.length === 0 || (rows[0]?.length ?? 0) === 0) return [];
  const lastRow = rows.length - 1;
  const lastColumn = rows[0].length - 1;
  return [
    ...rows[0],
    ...rows.slice(1).map(row => row[lastColumn]),
    ...rows[lastRow].slice(0, lastColumn).reverse(),
    ...rows.slice(1, lastRow).reverse().map(row => row[0]),
  ];
}

function collectPreviewSurfaces(editor: Editor): PreviewSurface[] {
  const result: PreviewSurface[] = getTextureFaces(editor).map((face, index) => {
    const loaded = editor.textureManager?.getIfLoaded(face.texture);
    const points = faceUvPolygon(face, loaded?.width ?? 128, loaded?.height ?? 128);
    return {
      texture: face.texture,
      points,
      clipPoints: points,
      source: index === 0,
      face,
    };
  });
  const patches = editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
  for (const patch of patches) {
    const rows = patch.ctrl.map(row => row.map(point => ({ u: point.uv[0], v: point.uv[1] })));
    result.push({
      texture: patch.texture,
      points: rows.flat(),
      clipPoints: patchClipPolygon(rows),
      rows,
      source: result.length === 0,
    });
  }
  return result;
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: UvPoint[],
  viewport: UvViewport,
  close = false,
): void {
  if (points.length === 0) return;
  const first = uvToScreen(points[0], viewport);
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (const point of points.slice(1)) {
    const screen = uvToScreen(point, viewport);
    context.lineTo(screen[0], screen[1]);
  }
  if (close) context.closePath();
  context.stroke();
}

function commonNumber(values: number[]): number | null {
  return values.length > 0 && values.every(value => Math.abs(value - values[0]) < 1e-9) ? values[0] : null;
}

function setNumericInput(input: HTMLInputElement, value: number | null): void {
  if (document.activeElement === input) return;
  input.value = value === null ? '' : String(Number(value.toFixed(6)));
  input.placeholder = value === null ? 'mixed' : '';
}

export class SurfaceInspector {
  private readonly empty: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly workspace: HTMLElement;
  private readonly interactiveHint: HTMLElement;
  private readonly previewLegend: HTMLElement;
  private readonly faceSections: HTMLElement[];
  private readonly projectionValuesSection: HTMLElement;
  private readonly offsetU: HTMLInputElement;
  private readonly offsetV: HTMLInputElement;
  private readonly scaleU: HTMLInputElement;
  private readonly scaleV: HTMLInputElement;
  private readonly rotation: HTMLInputElement;
  private readonly density: HTMLInputElement;
  private readonly mapUnits: HTMLInputElement;
  private readonly patchSection: HTMLElement;
  private readonly patchUnits: HTMLInputElement;
  private readonly uvCanvas: HTMLCanvasElement;
  private readonly uvStatus: HTMLElement;
  private readonly clipTexture: HTMLInputElement;
  private readonly autoFitSurface: HTMLInputElement;
  private readonly overlaySurfaces: HTMLInputElement;
  private readonly overlayOption: HTMLLabelElement;
  private previewInteractions: PreviewInteraction[] = [];
  private drawFrame: number | null = null;
  private lastSelectionSignature = '';
  private readonly previewTextureImages = new Map<string, PreviewTextureImage>();
  private checkerPattern: CanvasPattern | null = null;
  private checkerPatternKey = '';
  private uvViewport: UvViewport = { scale: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
  private uvPolygon: UvPoint[] = [];
  private uvCenterScreen: [number, number] = [0, 0];
  private rotateHandle: [number, number] = [0, 0];
  private scaleHandles: ScaleHandleMap = scaleHandlesForPoints([[0, 0]]);
  private dragMode: DragMode | null = null;
  private dragCanvasBounds: DOMRect | null = null;
  private dragCenterScreen: [number, number] | null = null;
  private dragPointerPoint: [number, number] | null = null;
  private dragPointerOffset: [number, number] = [0, 0];
  private dragPointerStart: [number, number] = [0, 0];
  private dragScaleStartHandle: [number, number] = [0, 0];
  private dragScaleAnchorScreen: [number, number] = [0, 0];
  private previousPoint: [number, number] = [0, 0];
  private previousAngle = 0;
  private dragViewportScale = 1;
  private dragLockedViewport: UvViewport | null = null;
  private dragStartProjection: BrushTextureProjection | null = null;
  private dragScaleAnchor: UvPoint | null = null;
  private dragTransactionOpen = false;
  private dragFace: BrushFace | null = null;

  constructor(private readonly editor: Editor, private readonly body: HTMLElement) {
    body.innerHTML = '';
    body.classList.add('surface-inspector');

    this.empty = document.createElement('div');
    this.empty.className = 'surface-inspector-empty';

    this.summary = document.createElement('div');
    this.summary.className = 'surface-inspector-summary';

    const uv = section('UV');
    this.workspace = uv.root;
    this.workspace.classList.add('surface-inspector-workspace');
    this.uvCanvas = document.createElement('canvas');
    this.uvCanvas.className = 'surface-inspector-uv-canvas';
    this.uvCanvas.tabIndex = 0;

    this.interactiveHint = document.createElement('div');
    this.interactiveHint.className = 'surface-inspector-uv-hint';
    this.interactiveHint.innerHTML = '<span><i class="uv-handle-swatch translate"></i>Shift</span><span><i class="uv-handle-swatch rotate"></i>Rotate</span><span><i class="uv-handle-swatch scale"></i>Scale edges / corners</span><span class="surface-inspector-fine-hint">Shift: fine · Alt: coarse</span>';
    const uvControls = document.createElement('div');
    uvControls.className = 'surface-inspector-uv-controls';
    const clip = document.createElement('label');
    clip.className = 'uv-editor-option surface-inspector-clip';
    this.clipTexture = document.createElement('input');
    this.clipTexture.type = 'checkbox';
    this.clipTexture.checked = true;
    this.clipTexture.setAttribute('aria-label', 'Clip texture previews to selected surfaces');
    clip.append(this.clipTexture, document.createTextNode('Clip'));
    const autoFit = document.createElement('label');
    autoFit.className = 'uv-editor-option surface-inspector-auto-fit';
    this.autoFitSurface = document.createElement('input');
    this.autoFitSurface.type = 'checkbox';
    this.autoFitSurface.checked = true;
    this.autoFitSurface.setAttribute('aria-label', 'Automatically fit selected surfaces in the UV preview');
    autoFit.append(this.autoFitSurface, document.createTextNode('Auto-fit'));
    this.overlayOption = document.createElement('label');
    this.overlayOption.className = 'uv-editor-option surface-inspector-overlay';
    this.overlaySurfaces = document.createElement('input');
    this.overlaySurfaces.type = 'checkbox';
    this.overlaySurfaces.checked = false;
    this.overlaySurfaces.setAttribute('aria-label', 'Overlay selected surfaces in shared UV space');
    this.overlayOption.append(this.overlaySurfaces, document.createTextNode('Overlay'));
    uvControls.append(this.interactiveHint, this.overlayOption, autoFit, clip);

    this.previewLegend = document.createElement('div');
    this.previewLegend.className = 'surface-inspector-preview-legend';
    this.previewLegend.innerHTML = '<span><i class="source"></i>Source</span><span><i class="target"></i>Targets</span>';
    this.uvStatus = document.createElement('div');
    this.uvStatus.className = 'surface-inspector-canvas-status';
    uv.content.append(this.uvCanvas, uvControls, this.previewLegend, this.uvStatus);

    const quick = section('Quick alignment');
    const quickActions = document.createElement('div');
    quickActions.className = 'surface-inspector-actions';
    quickActions.append(
      button('Fit', () => this.run(() => this.editor.fitTexture()), true),
      button('Width', () => this.run(() => this.editor.fitTexture('width'))),
      button('Height', () => this.run(() => this.editor.fitTexture('height'))),
      button('Reset', () => this.run(() => this.editor.resetTextureAlignment())),
    );
    quick.content.appendChild(quickActions);

    const values = section('Projection values');
    this.projectionValuesSection = values.root;
    const classicFields = document.createElement('div');
    classicFields.className = 'surface-inspector-value-grid';
    this.offsetU = numberInput(0);
    this.offsetV = numberInput(0);
    this.scaleU = numberInput(0.5);
    this.scaleV = numberInput(0.5);
    this.rotation = numberInput(0);
    classicFields.append(
      labelled('Shift U', this.offsetU),
      labelled('Shift V', this.offsetV),
      labelled('Scale U', this.scaleU),
      labelled('Scale V', this.scaleV),
      labelled('Rotation', this.rotation),
    );
    values.content.appendChild(classicFields);
    this.bindProjectionField(this.offsetU, 'offsetX', 'Edit face offset');
    this.bindProjectionField(this.offsetV, 'offsetY', 'Edit face offset');
    this.bindProjectionField(this.scaleU, 'scaleX', 'Edit face scale');
    this.bindProjectionField(this.scaleV, 'scaleY', 'Edit face scale');
    this.bindProjectionField(this.rotation, 'rotation', 'Edit face rotation');

    const transfer = section('Continuity');
    const transferMode = document.createElement('select');
    transferMode.className = 'app-select';
    transferMode.append(option('world', 'World-aligned'), option('local', 'Local values'));
    const transferActions = document.createElement('div');
    transferActions.className = 'surface-inspector-actions';
    transferActions.append(
      labelled('Transfer mode', transferMode),
      button('Copy Source', () => this.run(() => this.editor.copyTextureProjection(transferMode.value as 'world' | 'local')), true),
      button('Align Chain', () => this.run(() => this.editor.alignTextureFaceChain())),
      button('Wrap Loop', () => this.run(() => this.editor.wrapTextureSelection())),
    );
    transfer.content.appendChild(transferActions);

    const projection = section('Projection basis');
    const basis = document.createElement('select');
    basis.className = 'app-select';
    basis.append(
      option('axial', 'Axial'),
      option('camera', '3D camera'),
      option('top', 'Top (XY)'),
      option('front', 'Front (XZ)'),
      option('side', 'Side (YZ)'),
    );
    const projectionActions = document.createElement('div');
    projectionActions.className = 'surface-inspector-actions inline';
    projectionActions.append(
      labelled('Basis', basis),
      button('Project', () => this.run(() =>
        this.editor.projectTexture(basis.value as 'axial' | 'camera' | 'top' | 'front' | 'side')), true),
    );
    projection.content.appendChild(projectionActions);

    const densitySection = section('Texture scale');
    this.density = numberInput(2, 0.001);
    this.mapUnits = numberInput(128, 0.001);
    const densityActions = document.createElement('div');
    densityActions.className = 'surface-inspector-actions';
    densityActions.append(
      labelled('Texels / unit', this.density),
      button('Set Density', () => this.run(() => this.editor.setTextureDensity(Number(this.density.value)))),
      labelled('Units / repeat', this.mapUnits),
      button('Fit Units', () => this.run(() => this.editor.fitTextureByMapUnits(Number(this.mapUnits.value)))),
    );
    densitySection.content.appendChild(densityActions);

    const patch = section('Patch UVs');
    this.patchSection = patch.root;
    this.patchUnits = numberInput(128, 0.001);
    const patchActions = document.createElement('div');
    patchActions.className = 'surface-inspector-actions';
    patchActions.append(
      button('Align Boundaries', () => this.run(() => this.editor.alignPatchBoundaries()), true),
      button('Copy UV Grid', () => this.run(() => this.editor.copyPatchUV())),
      labelled('Repeat units', this.patchUnits),
      button('Naturalize', () => this.run(() =>
        this.editor.naturalizePatchesByDistance(Number(this.patchUnits.value)))),
    );
    patch.content.appendChild(patchActions);

    this.faceSections = [
      quick.root,
      values.root,
      transfer.root,
      projection.root,
      densitySection.root,
    ];

    body.append(
      this.empty,
      this.summary,
      quick.root,
      this.workspace,
      values.root,
      transfer.root,
      projection.root,
      densitySection.root,
      patch.root,
    );
    this.bindUvCanvas();
    this.clipTexture.addEventListener('change', () => this.scheduleDraw());
    this.autoFitSurface.addEventListener('change', () => this.scheduleDraw());
    this.overlaySurfaces.addEventListener('change', () => this.update(true));
    window.addEventListener('resize', () => this.scheduleDraw());
    this.update(true);
  }

  update(force = false): void {
    const faces = getTextureFaces(this.editor);
    const explicitFaces = this.editor.selectedFaces;
    const patches = this.editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
    const panelCollapsed = this.body.closest('.panel')?.classList.contains('collapsed') ?? false;
    const signature = [
      this.editor.documentRevision,
      surfaceSelectionSignature(this.editor),
      panelCollapsed ? 'collapsed' : 'expanded',
      faces.length,
      explicitFaces.length,
      patches.length,
      faces.map(face => `${face.texture}:${face.textureProjection.kind}`).join('|'),
    ].join(':');
    if (!force && signature === this.lastSelectionSignature && !this.editor.redrawRequested) return;
    this.lastSelectionSignature = signature;

    const hasSurfaces = faces.length > 0 || patches.length > 0;
    this.empty.hidden = hasSurfaces;
    this.empty.textContent = 'Select one or more brush faces, brushes, or patches to edit their surface alignment.';
    this.summary.hidden = !hasSurfaces;
    this.workspace.hidden = !hasSurfaces;
    for (const faceSection of this.faceSections) faceSection.hidden = faces.length === 0;

    const textures = [...new Set([
      ...faces.map(face => face.texture),
      ...patches.map(patch => patch.texture),
    ])];
    if (hasSurfaces) {
      const parts: string[] = [];
      if (faces.length > 0) parts.push(`${faces.length} face${faces.length === 1 ? '' : 's'}`);
      if (patches.length > 0) parts.push(`${patches.length} patch${patches.length === 1 ? '' : 'es'}`);
      this.summary.textContent = `${parts.join(' · ')} · ${textures.length === 1 ? textures[0] : `${textures.length} textures`}`;
    }

    const classic = faces.map(face => face.textureProjection.kind === 'classic' ? face.textureProjection : null);
    const allClassic = classic.length > 0 && classic.every(value => value !== null);
    this.projectionValuesSection.hidden = !allClassic;
    if (allClassic) {
      const projections = classic.filter(value => value !== null);
      setNumericInput(this.offsetU, commonNumber(projections.map(value => value.offsetX)));
      setNumericInput(this.offsetV, commonNumber(projections.map(value => value.offsetY)));
      setNumericInput(this.scaleU, commonNumber(projections.map(value => value.scaleX)));
      setNumericInput(this.scaleV, commonNumber(projections.map(value => value.scaleY)));
      setNumericInput(this.rotation, commonNumber(projections.map(value => value.rotation)));
    }
    const density = this.editor.textureDensityReport();
    if (density && document.activeElement !== this.density) {
      this.density.value = String(Number(density.median.toFixed(4)));
    }
    this.patchSection.hidden = patches.length === 0;

    const interactive = this.currentUvFace() !== null;
    const separateInteractive = !this.overlaySurfaces.checked
      && faces.length > 0
      && faces.length + patches.length > 1;
    this.interactiveHint.hidden = !(interactive || separateInteractive);
    this.overlayOption.hidden = interactive || faces.length + patches.length < 2;
    this.previewLegend.hidden = interactive || separateInteractive;
    if (!interactive && !separateInteractive) {
      this.previewLegend.innerHTML = faces.length + patches.length > 1
        ? '<span><i class="source"></i>Source</span><span><i class="target"></i>Targets</span>'
        : '<span><i class="source"></i>Surface preview</span>';
    }
    this.uvCanvas.title = interactive
      ? 'Drag the handles to edit this face. Hold Shift for fine control or Alt for coarse control.'
      : separateInteractive
        ? 'Drag the handles in any face preview to edit that face. Hold Shift for fine control or Alt for coarse control.'
        : 'Turn off Overlay to edit selected brush faces individually.';

    this.updateTextureImages(textures);
    if (hasSurfaces && this.editor.display.categories.textureAxes) {
      this.editor.updateTextureAxisOverlay();
    } else if (this.editor.textureAxisOverlayLines.length > 0) {
      this.editor.textureAxisOverlayLines = [];
      this.editor.redrawRequested = true;
    }
    this.scheduleDraw();
  }

  private run(action: () => void): void {
    action();
    this.lastSelectionSignature = '';
    this.update(true);
  }

  private bindProjectionField(
    input: HTMLInputElement,
    field: 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation',
    label: string,
  ): void {
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        this.update(true);
        return;
      }
      const faces = getTextureFaces(this.editor);
      updateFaceProperties(this.editor, faces, label, { [field]: value });
      this.run(() => undefined);
    });
  }

  private updateTextureImages(textures: string[]): void {
    for (const texture of textures) {
      const key = texture.toLowerCase();
      const entry = this.previewTextureImages.get(key)
        ?? { image: null, ready: false, pattern: null };
      this.previewTextureImages.set(key, entry);
      if (entry.image) continue;
      const thumbnail = this.editor.textureManager?.getThumbnailUrl(texture);
      if (!thumbnail) continue;
      const image = new Image();
      entry.image = image;
      image.onload = () => {
        entry.ready = true;
        entry.pattern = null;
        this.scheduleDraw();
      };
      image.src = thumbnail;
    }
  }

  private textureImage(texture: string): PreviewTextureImage | null {
    return this.previewTextureImages.get(texture.toLowerCase()) ?? null;
  }

  private textureSize(texture: string): [number, number] {
    const loaded = this.editor.textureManager?.getIfLoaded(texture);
    const image = this.textureImage(texture)?.image;
    return [
      loaded?.width ?? (image?.naturalWidth || 128),
      loaded?.height ?? (image?.naturalHeight || 128),
    ];
  }

  private scheduleDraw(): void {
    if (this.drawFrame !== null) return;
    this.drawFrame = window.requestAnimationFrame(() => {
      this.drawFrame = null;
      if (this.currentUvFace()) this.drawUvEditor();
      else this.drawAlignmentPreview();
    });
  }

  private drawAlignmentPreview(): void {
    if (this.workspace.hidden || this.empty.hidden === false) return;
    const allSurfaces = collectPreviewSurfaces(this.editor);
    const columns = this.body.clientWidth >= 360 ? 2 : 1;
    const previewLimit = surfacePreviewLimit(columns);
    const surfaces = allSurfaces.slice(0, previewLimit);
    const totalTextureCount = new Set(allSurfaces.map(surface => surface.texture.toLowerCase())).size;
    this.previewInteractions = [];
    const separate = surfaces.length > 1 && !this.overlaySurfaces.checked;
    const rows = Math.ceil(surfaces.length / columns);
    this.uvCanvas.style.height = separate
      ? `${Math.min(1200, Math.max(220, rows * 180 + (rows + 1) * 8))}px`
      : '';
    if (resizeCanvas(this.uvCanvas, 1, 1)) {
      for (const entry of this.previewTextureImages.values()) entry.pattern = null;
      this.checkerPattern = null;
    }
    const context = this.uvCanvas.getContext('2d');
    if (!context) return;
    const palette = previewPalette();
    if (separate) {
      this.drawSeparatedPreview(context, surfaces, columns, allSurfaces.length, totalTextureCount);
      return;
    }
    const points = surfaces.flatMap(surface => surface.points);
    this.uvViewport = fitUvViewport(
      points,
      this.uvCanvas.width,
      this.uvCanvas.height,
      this.autoFitSurface.checked ? 20 : 30,
      this.autoFitSurface.checked ? 'surface' : 'texture',
    );
    const ordered = [...surfaces].sort((left, right) => Number(left.source) - Number(right.source));
    const textureCount = new Set(surfaces.map(surface => surface.texture.toLowerCase())).size;

    context.fillStyle = palette.background;
    context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
    if (!this.clipTexture.checked && surfaces[0]) {
      this.drawTexturePattern(context, surfaces[0].texture, null);
    }
    for (const surface of ordered) {
      if (!this.clipTexture.checked && surface.texture.toLowerCase() === surfaces[0]?.texture.toLowerCase()) continue;
      const clipPoints = surface.clipPoints.map(point => uvToScreen(point, this.uvViewport));
      context.globalAlpha = textureCount > 1 ? 0.82 : 1;
      this.drawTexturePattern(context, surface.texture, clipPoints);
    }
    context.globalAlpha = 1;
    this.drawUvGrid(context);

    for (const surface of ordered) this.drawPreviewSurfaceOutline(context, surface, this.uvViewport);
    this.updatePreviewStatus(surfaces, allSurfaces.length, totalTextureCount);
  }

  private drawSeparatedPreview(
    context: CanvasRenderingContext2D,
    surfaces: PreviewSurface[],
    columns: number,
    totalSurfaceCount = surfaces.length,
    totalTextureCount?: number,
  ): void {
    const displayScale = canvasDisplayScale(this.uvCanvas);
    const palette = previewPalette();
    context.fillStyle = palette.background;
    context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
    const cells = surfacePreviewCells(surfaces.length, this.uvCanvas.width, this.uvCanvas.height, columns);
    surfaces.forEach((surface, index) => {
      const cell = cells[index];
      const local = fitUvViewport(
        surface.points,
        cell.width,
        cell.height,
        this.autoFitSurface.checked ? (surface.face ? 32 : 18) : (surface.face ? 48 : 24),
        this.autoFitSurface.checked ? 'surface' : 'texture',
      );
      const fittedViewport: UvViewport = {
        ...local,
        offsetX: local.offsetX + cell.x,
        offsetY: local.offsetY + cell.y,
        width: this.uvCanvas.width,
        height: this.uvCanvas.height,
      };
      const viewport = isScaleDrag(this.dragMode)
        && this.dragFace === surface.face
        && this.dragLockedViewport
        ? this.dragLockedViewport
        : fittedViewport;
      const clipPoints = this.clipTexture.checked
        ? surface.clipPoints.map(point => uvToScreen(point, viewport))
        : null;
      this.drawTexturePattern(context, surface.texture, clipPoints, viewport, cell);
      this.drawUvGrid(context, viewport, cell);
      this.drawPreviewSurfaceOutline(context, surface, viewport, true);
      const interaction = this.drawPreviewHandles(context, surface, viewport);
      if (interaction) this.previewInteractions.push(interaction);

      context.strokeStyle = palette.accent;
      context.lineWidth = 1;
      context.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
      const labelHeight = 18 * displayScale;
      const labelTop = cell.y + cell.height - labelHeight - displayScale;
      context.fillStyle = palette.footer;
      context.fillRect(
        cell.x + displayScale,
        labelTop,
        cell.width - displayScale * 2,
        labelHeight,
      );
      context.fillStyle = palette.info;
      context.font = `${9 * displayScale}px monospace`;
      context.textBaseline = 'middle';
      context.fillText(
        `Face ${index + 1} · ${surface.texture}`,
        cell.x + 6 * displayScale,
        labelTop + 10 * displayScale,
        Math.max(1, cell.width - 12 * displayScale),
      );
    });
    this.updatePreviewStatus(surfaces, totalSurfaceCount, totalTextureCount);
  }

  private drawPreviewHandles(
    context: CanvasRenderingContext2D,
    surface: PreviewSurface,
    viewport: UvViewport,
  ): PreviewInteraction | null {
    if (!surface.face) return null;
    const palette = previewPalette();
    const points = surface.points.map(point => uvToScreen(point, viewport));
    if (points.length === 0) return null;
    const scaleHandles = scaleHandlesForPoints(points);
    const center: [number, number] = [
      scaleHandles['scale-top'][0],
      scaleHandles['scale-left'][1],
    ];
    const topY = scaleHandles['scale-top'][1];
    const active = this.dragFace === surface.face && this.dragMode !== null;
    const scaleDrag = active && isScaleDrag(this.dragMode) ? this.dragMode : null;
    const interactionCenter: [number, number] = active && this.dragMode === 'translate' && this.dragPointerPoint
      ? [
          this.dragPointerPoint[0] + this.dragPointerOffset[0],
          this.dragPointerPoint[1] + this.dragPointerOffset[1],
        ]
      : active && this.dragCenterScreen
        ? this.dragCenterScreen
        : center;
    const rotateHandle: [number, number] = active && this.dragMode === 'rotate' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [center[0], topY - 24];

    context.strokeStyle = palette.accent;
    context.globalAlpha = 0.65;
    context.lineWidth = 1.5;
    if (!(active && (isScaleDrag(this.dragMode) || this.dragMode === 'translate'))) {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(rotateHandle[0], rotateHandle[1]);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = palette.accent;
    context.beginPath();
    context.arc(interactionCenter[0], interactionCenter[1], 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.background;
    context.beginPath();
    context.arc(interactionCenter[0], interactionCenter[1], 2, 0, Math.PI * 2);
    context.fill();
    if (!(active && (isScaleDrag(this.dragMode) || this.dragMode === 'translate'))) {
      context.fillStyle = palette.info;
      context.beginPath();
      context.arc(rotateHandle[0], rotateHandle[1], 7, 0, Math.PI * 2);
      context.fill();
    }
    if (!(active && (this.dragMode === 'rotate' || this.dragMode === 'translate'))) {
      drawScaleBox(context, scaleHandles, palette.success, 8, scaleDrag);
    }
    return {
      face: surface.face,
      center,
      rotateHandle,
      scaleHandles,
      viewport,
    };
  }

  private drawPreviewSurfaceOutline(
    context: CanvasRenderingContext2D,
    surface: PreviewSurface,
    viewport: UvViewport,
    uniform = false,
  ): void {
    const source = surface.source && !uniform;
    const palette = previewPalette();
    const color = source ? palette.accent : palette.info;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = source ? 3 : 2;
    if (surface.rows) {
      for (const row of surface.rows) drawPolyline(context, row, viewport);
      const columns = surface.rows[0]?.length ?? 0;
      for (let column = 0; column < columns; column++) {
        drawPolyline(context, surface.rows.map(row => row[column]).filter(Boolean), viewport);
      }
      return;
    }
    const screen = surface.points.map(point => uvToScreen(point, viewport));
    if (screen.length === 0) return;
    context.beginPath();
    context.moveTo(screen[0][0], screen[0][1]);
    for (const point of screen.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.save();
    context.globalAlpha = source ? 0.16 : 0.1;
    context.fill();
    context.restore();
    context.stroke();
  }

  private updatePreviewStatus(
    surfaces: PreviewSurface[],
    totalSurfaceCount = surfaces.length,
    totalTextureCount = new Set(surfaces.map(surface => surface.texture.toLowerCase())).size,
  ): void {
    const report = this.editor.textureDensityReport();
    const mode = surfaces.length > 1 && !this.overlaySurfaces.checked ? 'separate' : 'overlaid';
    const framing = this.autoFitSurface.checked ? 'auto-fit' : 'texture space';
    const count = totalSurfaceCount > surfaces.length
      ? `${surfaces.length} of ${totalSurfaceCount} surfaces shown`
      : `${surfaces.length} surface${surfaces.length === 1 ? '' : 's'}`;
    const summary = `${count} · ${totalTextureCount} texture${totalTextureCount === 1 ? '' : 's'} · ${mode} · ${framing}`;
    this.uvStatus.textContent = report
      ? `${summary} · ${report.minimum.toFixed(3)}–${report.maximum.toFixed(3)} texels/unit · median ${report.median.toFixed(3)}`
      : summary;
  }

  private currentUvFace(): BrushFace | null {
    if (this.editor.selectedFaces.length !== 1) return null;
    if (this.editor.selection.some(item => item.type === 'patch')) return null;
    return getTextureFaces(this.editor).length === 1 ? this.editor.selectedFaces[0] : null;
  }

  private drawUvBackdrop(
    context: CanvasRenderingContext2D,
    texture: string,
    clipPoints: Array<[number, number]> | null,
  ): void {
    context.fillStyle = previewPalette().background;
    context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
    this.drawTexturePattern(context, texture, clipPoints);
    this.drawUvGrid(context);
  }

  private drawTexturePattern(
    context: CanvasRenderingContext2D,
    texture: string,
    clipPoints: Array<[number, number]> | null,
    viewport = this.uvViewport,
    bounds: PreviewCell = { x: 0, y: 0, width: this.uvCanvas.width, height: this.uvCanvas.height },
  ): void {
    const palette = previewPalette();
    const entry = this.textureImage(texture);
    let pattern = entry?.pattern ?? null;
    let sourceWidth = 1;
    let sourceHeight = 1;
    if (entry?.image && entry.ready) {
      pattern ??= context.createPattern(entry.image, 'repeat');
      entry.pattern = pattern;
      sourceWidth = Math.max(1, entry.image.naturalWidth);
      sourceHeight = Math.max(1, entry.image.naturalHeight);
    } else {
      const checkerKey = `${palette.background}|${palette.footer}`;
      if (!this.checkerPattern || this.checkerPatternKey !== checkerKey) {
        const checker = document.createElement('canvas');
        checker.width = checker.height = 2;
        const checkerContext = checker.getContext('2d');
        if (checkerContext) {
          checkerContext.fillStyle = palette.background;
          checkerContext.fillRect(0, 0, 2, 2);
          checkerContext.fillStyle = palette.footer;
          checkerContext.fillRect(1, 0, 1, 1);
          checkerContext.fillRect(0, 1, 1, 1);
          this.checkerPattern = context.createPattern(checker, 'repeat');
          this.checkerPatternKey = checkerKey;
        }
      }
      pattern = this.checkerPattern;
    }
    if (pattern) {
      pattern.setTransform(new DOMMatrix([
        viewport.scale / sourceWidth, 0,
        0, viewport.scale / sourceHeight,
        viewport.offsetX, viewport.offsetY,
      ]));
      context.save();
      context.beginPath();
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.clip();
      if (clipPoints && clipPoints.length >= 3) {
        context.beginPath();
        context.moveTo(clipPoints[0][0], clipPoints[0][1]);
        for (const point of clipPoints.slice(1)) context.lineTo(point[0], point[1]);
        context.closePath();
        context.clip();
      }
      context.fillStyle = pattern;
      context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.restore();
    }
  }

  private drawUvGrid(
    context: CanvasRenderingContext2D,
    viewport = this.uvViewport,
    bounds: PreviewCell = { x: 0, y: 0, width: this.uvCanvas.width, height: this.uvCanvas.height },
  ): void {
    const palette = previewPalette();
    const topLeft = screenToUv(bounds.x, bounds.y, viewport);
    const bottomRight = screenToUv(bounds.x + bounds.width, bounds.y + bounds.height, viewport);
    context.save();
    context.beginPath();
    context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.clip();
    context.strokeStyle = palette.grid;
    context.lineWidth = 1;
    for (let u = Math.floor(Math.min(topLeft.u, bottomRight.u)) - 1; u <= Math.ceil(Math.max(topLeft.u, bottomRight.u)) + 1; u++) {
      const [x] = uvToScreen({ u, v: 0 }, viewport);
      context.beginPath(); context.moveTo(x, bounds.y); context.lineTo(x, bounds.y + bounds.height); context.stroke();
    }
    for (let v = Math.floor(Math.min(topLeft.v, bottomRight.v)) - 1; v <= Math.ceil(Math.max(topLeft.v, bottomRight.v)) + 1; v++) {
      const [, y] = uvToScreen({ u: 0, v }, viewport);
      context.beginPath(); context.moveTo(bounds.x, y); context.lineTo(bounds.x + bounds.width, y); context.stroke();
    }
    context.restore();
  }

  private drawUvEditor(): void {
    if (this.workspace.hidden) return;
    const face = this.currentUvFace();
    if (!face) return;
    this.uvCanvas.style.height = '';
    if (resizeCanvas(this.uvCanvas, 1, 1)) {
      for (const entry of this.previewTextureImages.values()) entry.pattern = null;
      this.checkerPattern = null;
    }
    const context = this.uvCanvas.getContext('2d');
    if (!context) return;
    const palette = previewPalette();
    const [textureWidth, textureHeight] = this.textureSize(face.texture);
    this.uvPolygon = faceUvPolygon(face, textureWidth, textureHeight);
    const fittedViewport = fitUvViewport(
      this.uvPolygon,
      this.uvCanvas.width,
      this.uvCanvas.height,
      this.autoFitSurface.checked ? 32 : 58,
      this.autoFitSurface.checked ? 'surface' : 'texture',
    );
    this.uvViewport = isScaleDrag(this.dragMode) && this.dragLockedViewport
      ? this.dragLockedViewport
      : fittedViewport;
    const points = this.uvPolygon.map(point => uvToScreen(point, this.uvViewport));
    this.scaleHandles = scaleHandlesForPoints(points);
    this.uvCenterScreen = [
      this.scaleHandles['scale-top'][0],
      this.scaleHandles['scale-left'][1],
    ];
    const topY = this.scaleHandles['scale-top'][1];
    const interactionCenter: [number, number] = this.dragMode === 'translate' && this.dragPointerPoint
      ? [
          this.dragPointerPoint[0] + this.dragPointerOffset[0],
          this.dragPointerPoint[1] + this.dragPointerOffset[1],
        ]
      : this.dragMode === 'rotate' && this.dragCenterScreen
        ? this.dragCenterScreen
        : this.uvCenterScreen;
    this.rotateHandle = this.dragMode === 'rotate' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [this.uvCenterScreen[0], topY - (this.autoFitSurface.checked ? 24 : 34)];
    this.drawUvBackdrop(context, face.texture, this.clipTexture.checked ? points : null);

    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.fillStyle = palette.accent;
    context.save();
    context.globalAlpha = 0.1;
    context.fill();
    context.restore();
    context.strokeStyle = palette.accent;
    context.lineWidth = 3;
    context.stroke();

    context.strokeStyle = palette.accent;
    context.globalAlpha = 0.65;
    context.lineWidth = 2;
    if (!isScaleDrag(this.dragMode) && this.dragMode !== 'translate') {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(this.rotateHandle[0], this.rotateHandle[1]);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = palette.accent;
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 9, 0, Math.PI * 2); context.fill();
    context.fillStyle = palette.background;
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 3, 0, Math.PI * 2); context.fill();
    if (!isScaleDrag(this.dragMode) && this.dragMode !== 'translate') {
      context.fillStyle = palette.info;
      context.beginPath(); context.arc(this.rotateHandle[0], this.rotateHandle[1], 8, 0, Math.PI * 2); context.fill();
    }
    if (this.dragMode !== 'rotate' && this.dragMode !== 'translate') {
      drawScaleBox(
        context,
        this.scaleHandles,
        palette.success,
        10,
        isScaleDrag(this.dragMode) ? this.dragMode : null,
      );
    }
    this.uvStatus.textContent = `${face.texture} · ${textureWidth}×${textureHeight} · ${this.autoFitSurface.checked ? 'auto-fit' : 'texture space'} · ${projectionSummary(face)}`;
  }

  private bindUvCanvas(): void {
    this.uvCanvas.addEventListener('pointerdown', event => {
      this.dragCanvasBounds = this.uvCanvas.getBoundingClientRect();
      const point = eventPoint(event, this.uvCanvas, this.dragCanvasBounds);
      const singleFace = this.currentUvFace();
      const interaction: PreviewInteraction | null = singleFace
        ? {
            face: singleFace,
            center: this.uvCenterScreen,
            rotateHandle: this.rotateHandle,
            scaleHandles: this.scaleHandles,
            viewport: this.uvViewport,
          }
        : this.previewInteractions.find(candidate =>
            distance(point, candidate.rotateHandle) <= 16
            || scaleHandleAt(point, candidate.scaleHandles, 13) !== null
            || distance(point, candidate.center) <= 18) ?? null;
      if (!interaction) {
        this.dragCanvasBounds = null;
        return;
      }
      const scaleMode = scaleHandleAt(point, interaction.scaleHandles, 13);
      if (distance(point, interaction.rotateHandle) <= 16) this.dragMode = 'rotate';
      else if (scaleMode) this.dragMode = scaleMode;
      else if (distance(point, interaction.center) <= 18) this.dragMode = 'translate';
      else {
        this.dragCanvasBounds = null;
        return;
      }
      this.dragFace = interaction.face;
      const dragLabel = this.dragMode === 'translate'
        ? 'Shift texture'
        : this.dragMode === 'rotate'
          ? 'Rotate texture'
          : scaleModeAffectsU(this.dragMode) && !scaleModeAffectsV(this.dragMode)
            ? 'Scale texture U'
            : scaleModeAffectsV(this.dragMode) && !scaleModeAffectsU(this.dragMode)
              ? 'Scale texture V'
              : 'Scale texture U/V';
      this.editor.beginTransaction(dragLabel);
      this.dragTransactionOpen = true;
      this.previousPoint = point;
      this.dragPointerStart = [...point];
      this.dragCenterScreen = [...interaction.center];
      this.dragPointerPoint = isScaleDrag(this.dragMode)
        ? [...interaction.scaleHandles[this.dragMode]]
        : [...point];
      this.dragPointerOffset = this.dragMode === 'translate'
        ? [interaction.center[0] - point[0], interaction.center[1] - point[1]]
        : [0, 0];
      this.dragViewportScale = interaction.viewport.scale;
      this.previousAngle = Math.atan2(point[1] - this.dragCenterScreen[1], point[0] - this.dragCenterScreen[0]);
      if (isScaleDrag(this.dragMode)) {
        const [textureWidth, textureHeight] = this.textureSize(interaction.face.texture);
        const facePoints = faceUvPolygon(interaction.face, textureWidth, textureHeight);
        this.dragLockedViewport = { ...interaction.viewport };
        this.dragStartProjection = cloneTextureProjection(interaction.face.textureProjection);
        this.dragScaleAnchor = scaleAnchorForMode(facePoints, this.dragMode);
        this.dragScaleAnchorScreen = uvToScreen(this.dragScaleAnchor, interaction.viewport);
        this.dragScaleStartHandle = [...interaction.scaleHandles[this.dragMode]];
      } else {
        this.dragLockedViewport = null;
        this.dragStartProjection = null;
        this.dragScaleAnchor = null;
      }
      this.uvCanvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.uvCanvas.addEventListener('pointermove', event => {
      const point = eventPoint(event, this.uvCanvas, this.dragCanvasBounds ?? undefined);
      if (!this.dragMode) {
        const singleFace = this.currentUvFace();
        const interactions: PreviewInteraction[] = singleFace
          ? [{
              face: singleFace,
              center: this.uvCenterScreen,
              rotateHandle: this.rotateHandle,
              scaleHandles: this.scaleHandles,
              viewport: this.uvViewport,
            }]
          : this.previewInteractions;
        const scaleHover = interactions
          .map(candidate => scaleHandleAt(point, candidate.scaleHandles, 12))
          .find((mode): mode is ScaleDragMode => mode !== null);
        if (interactions.some(candidate => distance(point, candidate.rotateHandle) <= 15)) {
          this.uvCanvas.style.cursor = 'crosshair';
        } else if (scaleHover) {
          this.uvCanvas.style.cursor = scaleHandleCursor(scaleHover);
        } else if (interactions.some(candidate => distance(point, candidate.center) <= 18)) {
          this.uvCanvas.style.cursor = 'move';
        }
        else this.uvCanvas.style.cursor = 'default';
        return;
      }
      const face = this.dragFace;
      if (!face || !getTextureFaces(this.editor).includes(face)) {
        this.finishUvDrag(event);
        return;
      }
      const multiplier = surfaceDragMultiplier(event.shiftKey, event.altKey);
      if (this.dragMode === 'translate') {
        const [textureWidth, textureHeight] = this.textureSize(face.texture);
        const screenDx = point[0] - this.previousPoint[0];
        const screenDy = point[1] - this.previousPoint[1];
        const dx = screenDx / this.dragViewportScale * textureWidth * multiplier;
        const dy = screenDy / this.dragViewportScale * textureHeight * multiplier;
        shiftFaceTexture(this.editor, dx, dy, [face]);
        const visual = this.dragPointerPoint ?? this.previousPoint;
        this.dragPointerPoint = [
          visual[0] + screenDx * multiplier,
          visual[1] + screenDy * multiplier,
        ];
      } else if (this.dragMode === 'rotate') {
        const center = this.dragCenterScreen ?? this.uvCenterScreen;
        const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
        const angleDelta = shortestAngleDelta(this.previousAngle, angle) * multiplier;
        rotateFaceTexture(this.editor, angleDelta * 180 / Math.PI, [face]);
        this.previousAngle = angle;
        const visual = this.dragPointerPoint ?? point;
        const visualRadius = Math.max(1, distance(visual, center));
        const visualAngle = Math.atan2(visual[1] - center[1], visual[0] - center[0]) + angleDelta;
        this.dragPointerPoint = [
          center[0] + Math.cos(visualAngle) * visualRadius,
          center[1] + Math.sin(visualAngle) * visualRadius,
        ];
      } else if (isScaleDrag(this.dragMode)) {
        const effectivePoint: [number, number] = [
          this.dragScaleStartHandle[0] + point[0] - this.dragPointerStart[0],
          this.dragScaleStartHandle[1] + point[1] - this.dragPointerStart[1],
        ];
        const factorU = scaleModeAffectsU(this.dragMode)
          ? surfaceScaleFactor(
              this.dragScaleStartHandle[0] - this.dragScaleAnchorScreen[0],
              effectivePoint[0] - this.dragScaleAnchorScreen[0],
              multiplier,
            )
          : 1;
        const factorV = scaleModeAffectsV(this.dragMode)
          ? surfaceScaleFactor(
              this.dragScaleStartHandle[1] - this.dragScaleAnchorScreen[1],
              effectivePoint[1] - this.dragScaleAnchorScreen[1],
              multiplier,
            )
          : 1;
        if (this.dragStartProjection && this.dragScaleAnchor) {
          scaleTextureFromProjection(
            this.editor,
            face,
            this.dragStartProjection,
            [factorU, factorV],
            [this.dragScaleAnchor.u, this.dragScaleAnchor.v],
          );
        }
        this.dragPointerPoint = effectivePoint;
      }
      this.previousPoint = point;
      this.scheduleDraw();
    });
    this.uvCanvas.addEventListener('pointerup', event => this.finishUvDrag(event));
    this.uvCanvas.addEventListener('pointercancel', event => this.finishUvDrag(event));
  }

  private finishUvDrag(event: PointerEvent): void {
    if (!this.dragMode) return;
    this.dragMode = null;
    this.dragFace = null;
    this.dragCenterScreen = null;
    this.dragPointerPoint = null;
    this.dragPointerOffset = [0, 0];
    this.dragLockedViewport = null;
    this.dragStartProjection = null;
    this.dragScaleAnchor = null;
    this.dragPointerStart = [0, 0];
    this.dragScaleStartHandle = [0, 0];
    this.dragScaleAnchorScreen = [0, 0];
    if (this.dragTransactionOpen) {
      this.editor.commitTransaction();
      this.dragTransactionOpen = false;
    }
    if (this.uvCanvas.hasPointerCapture(event.pointerId)) this.uvCanvas.releasePointerCapture(event.pointerId);
    this.uvCanvas.style.cursor = 'default';
    this.dragCanvasBounds = null;
    this.lastSelectionSignature = '';
    this.update(true);
  }
}
