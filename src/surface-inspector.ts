import type { BrushFace } from './brush';
import type { Editor } from './editor';
import {
  getTextureFaces,
  rotateTexture as rotateFaceTexture,
  scaleTexture as scaleFaceTexture,
  shiftTexture as shiftFaceTexture,
} from './editor-textures';
import { updateFaceProperties } from './editor-properties';
import {
  faceUvPolygon,
  fitUvViewport,
  screenToUv,
  shortestAngleDelta,
  uvPolygonCenter,
  uvToScreen,
  type UvPoint,
  type UvViewport,
} from './uv-editor';

type DragMode = 'translate' | 'rotate' | 'scale';

export const MAX_SURFACE_PREVIEWS = 12;

export function surfaceDragMultiplier(fineControl: boolean, coarseControl = false): number {
  if (fineControl && coarseControl) return 1;
  if (fineControl) return 0.1;
  return coarseControl ? 10 : 1;
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
  scaleHandle: [number, number];
  viewport: UvViewport;
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
  private readonly overlaySurfaces: HTMLInputElement;
  private readonly overlayOption: HTMLLabelElement;
  private previewInteractions: PreviewInteraction[] = [];
  private drawFrame: number | null = null;
  private lastSelectionSignature = '';
  private readonly previewTextureImages = new Map<string, PreviewTextureImage>();
  private checkerPattern: CanvasPattern | null = null;
  private uvViewport: UvViewport = { scale: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
  private uvPolygon: UvPoint[] = [];
  private uvCenterScreen: [number, number] = [0, 0];
  private rotateHandle: [number, number] = [0, 0];
  private scaleHandle: [number, number] = [0, 0];
  private dragMode: DragMode | null = null;
  private dragCanvasBounds: DOMRect | null = null;
  private dragCenterScreen: [number, number] | null = null;
  private dragPointerPoint: [number, number] | null = null;
  private dragPointerOffset: [number, number] = [0, 0];
  private previousPoint: [number, number] = [0, 0];
  private previousAngle = 0;
  private previousRadius = 0;
  private dragViewportScale = 1;
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
    this.interactiveHint.innerHTML = '<span><i class="uv-handle-swatch translate"></i>Shift</span><span><i class="uv-handle-swatch rotate"></i>Rotate</span><span><i class="uv-handle-swatch scale"></i>Scale</span><span class="surface-inspector-fine-hint">Shift: fine · Alt: coarse</span>';
    const uvControls = document.createElement('div');
    uvControls.className = 'surface-inspector-uv-controls';
    const clip = document.createElement('label');
    clip.className = 'uv-editor-option surface-inspector-clip';
    this.clipTexture = document.createElement('input');
    this.clipTexture.type = 'checkbox';
    this.clipTexture.checked = true;
    this.clipTexture.setAttribute('aria-label', 'Clip texture previews to selected surfaces');
    clip.append(this.clipTexture, document.createTextNode('Clip'));
    this.overlayOption = document.createElement('label');
    this.overlayOption.className = 'uv-editor-option surface-inspector-overlay';
    this.overlaySurfaces = document.createElement('input');
    this.overlaySurfaces.type = 'checkbox';
    this.overlaySurfaces.checked = false;
    this.overlaySurfaces.setAttribute('aria-label', 'Overlay selected surfaces in shared UV space');
    this.overlayOption.append(this.overlaySurfaces, document.createTextNode('Overlay'));
    uvControls.append(this.interactiveHint, this.overlayOption, clip);

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
    if (separate) {
      this.drawSeparatedPreview(context, surfaces, columns, allSurfaces.length, totalTextureCount);
      return;
    }
    const points = surfaces.flatMap(surface => surface.points);
    this.uvViewport = fitUvViewport(
      points,
      this.uvCanvas.width,
      this.uvCanvas.height,
      this.clipTexture.checked ? 20 : 30,
      this.clipTexture.checked ? 'surface' : 'texture',
    );
    const ordered = [...surfaces].sort((left, right) => Number(left.source) - Number(right.source));
    const textureCount = new Set(surfaces.map(surface => surface.texture.toLowerCase())).size;

    context.fillStyle = '#151515';
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
    context.fillStyle = '#151515';
    context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
    const cells = surfacePreviewCells(surfaces.length, this.uvCanvas.width, this.uvCanvas.height, columns);
    surfaces.forEach((surface, index) => {
      const cell = cells[index];
      const local = fitUvViewport(
        surface.points,
        cell.width,
        cell.height,
        this.clipTexture.checked ? (surface.face ? 32 : 18) : (surface.face ? 48 : 24),
        this.clipTexture.checked ? 'surface' : 'texture',
      );
      const viewport: UvViewport = {
        ...local,
        offsetX: local.offsetX + cell.x,
        offsetY: local.offsetY + cell.y,
        width: this.uvCanvas.width,
        height: this.uvCanvas.height,
      };
      const clipPoints = this.clipTexture.checked
        ? surface.clipPoints.map(point => uvToScreen(point, viewport))
        : null;
      this.drawTexturePattern(context, surface.texture, clipPoints, viewport, cell);
      this.drawUvGrid(context, viewport, cell);
      this.drawPreviewSurfaceOutline(context, surface, viewport, true);
      const interaction = this.drawPreviewHandles(context, surface, viewport);
      if (interaction) this.previewInteractions.push(interaction);

      context.strokeStyle = '#e8a030';
      context.lineWidth = 1;
      context.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
      const labelHeight = 18 * displayScale;
      const labelTop = cell.y + cell.height - labelHeight - displayScale;
      context.fillStyle = 'rgba(15,15,15,.84)';
      context.fillRect(
        cell.x + displayScale,
        labelTop,
        cell.width - displayScale * 2,
        labelHeight,
      );
      context.fillStyle = '#67b7d1';
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
    const points = surface.points.map(point => uvToScreen(point, viewport));
    if (points.length === 0) return null;
    const center = uvToScreen(uvPolygonCenter(surface.points), viewport);
    const topY = Math.min(...points.map(point => point[1]));
    const rightX = Math.max(...points.map(point => point[0]));
    const active = this.dragFace === surface.face && this.dragMode !== null;
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
    const scaleHandle: [number, number] = active && this.dragMode === 'scale' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [rightX + 14, center[1]];

    context.strokeStyle = 'rgba(232,160,48,.65)';
    context.lineWidth = 1.5;
    if (!(active && (this.dragMode === 'scale' || this.dragMode === 'translate'))) {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(rotateHandle[0], rotateHandle[1]);
      context.stroke();
    }
    if (!(active && (this.dragMode === 'rotate' || this.dragMode === 'translate'))) {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(scaleHandle[0], scaleHandle[1]);
      context.stroke();
    }
    context.fillStyle = '#e8a030';
    context.beginPath();
    context.arc(interactionCenter[0], interactionCenter[1], 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#151515';
    context.beginPath();
    context.arc(interactionCenter[0], interactionCenter[1], 2, 0, Math.PI * 2);
    context.fill();
    if (!(active && (this.dragMode === 'scale' || this.dragMode === 'translate'))) {
      context.fillStyle = '#67b7d1';
      context.beginPath();
      context.arc(rotateHandle[0], rotateHandle[1], 7, 0, Math.PI * 2);
      context.fill();
    }
    if (!(active && (this.dragMode === 'rotate' || this.dragMode === 'translate'))) {
      context.fillStyle = '#78c46b';
      context.fillRect(scaleHandle[0] - 6, scaleHandle[1] - 6, 12, 12);
    }
    return { face: surface.face, center, rotateHandle, scaleHandle, viewport };
  }

  private drawPreviewSurfaceOutline(
    context: CanvasRenderingContext2D,
    surface: PreviewSurface,
    viewport: UvViewport,
    uniform = false,
  ): void {
    const source = surface.source && !uniform;
    context.strokeStyle = source ? '#e8a030' : '#67b7d1';
    context.fillStyle = source ? 'rgba(232,160,48,.16)' : 'rgba(103,183,209,.10)';
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
    context.fill();
    context.stroke();
  }

  private updatePreviewStatus(
    surfaces: PreviewSurface[],
    totalSurfaceCount = surfaces.length,
    totalTextureCount = new Set(surfaces.map(surface => surface.texture.toLowerCase())).size,
  ): void {
    const report = this.editor.textureDensityReport();
    const mode = surfaces.length > 1 && !this.overlaySurfaces.checked ? 'separate' : 'overlaid';
    const count = totalSurfaceCount > surfaces.length
      ? `${surfaces.length} of ${totalSurfaceCount} surfaces shown`
      : `${surfaces.length} surface${surfaces.length === 1 ? '' : 's'}`;
    const summary = `${count} · ${totalTextureCount} texture${totalTextureCount === 1 ? '' : 's'} · ${mode}`;
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
    context.fillStyle = '#151515';
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
      if (!this.checkerPattern) {
        const checker = document.createElement('canvas');
        checker.width = checker.height = 2;
        const checkerContext = checker.getContext('2d');
        if (checkerContext) {
          checkerContext.fillStyle = '#292929';
          checkerContext.fillRect(0, 0, 2, 2);
          checkerContext.fillStyle = '#202020';
          checkerContext.fillRect(1, 0, 1, 1);
          checkerContext.fillRect(0, 1, 1, 1);
          this.checkerPattern = context.createPattern(checker, 'repeat');
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
    const topLeft = screenToUv(bounds.x, bounds.y, viewport);
    const bottomRight = screenToUv(bounds.x + bounds.width, bounds.y + bounds.height, viewport);
    context.save();
    context.beginPath();
    context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.clip();
    context.strokeStyle = 'rgba(255,255,255,.08)';
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
    const [textureWidth, textureHeight] = this.textureSize(face.texture);
    this.uvPolygon = faceUvPolygon(face, textureWidth, textureHeight);
    this.uvViewport = fitUvViewport(
      this.uvPolygon,
      this.uvCanvas.width,
      this.uvCanvas.height,
      this.clipTexture.checked ? 32 : 58,
      this.clipTexture.checked ? 'surface' : 'texture',
    );
    const center = uvPolygonCenter(this.uvPolygon);
    this.uvCenterScreen = uvToScreen(center, this.uvViewport);
    const points = this.uvPolygon.map(point => uvToScreen(point, this.uvViewport));
    const topY = Math.min(...points.map(point => point[1]));
    const rightX = Math.max(...points.map(point => point[0]));
    const interactionCenter: [number, number] = this.dragMode === 'translate' && this.dragPointerPoint
      ? [
          this.dragPointerPoint[0] + this.dragPointerOffset[0],
          this.dragPointerPoint[1] + this.dragPointerOffset[1],
        ]
      : (this.dragMode === 'rotate' || this.dragMode === 'scale') && this.dragCenterScreen
        ? this.dragCenterScreen
        : this.uvCenterScreen;
    this.rotateHandle = this.dragMode === 'rotate' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [this.uvCenterScreen[0], topY - (this.clipTexture.checked ? 24 : 34)];
    this.scaleHandle = this.dragMode === 'scale' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [rightX + 20, this.uvCenterScreen[1]];
    this.drawUvBackdrop(context, face.texture, this.clipTexture.checked ? points : null);

    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.fillStyle = 'rgba(232,160,48,.10)';
    context.fill();
    context.strokeStyle = '#e8a030';
    context.lineWidth = 3;
    context.stroke();

    context.strokeStyle = 'rgba(232,160,48,.65)';
    context.lineWidth = 2;
    if (this.dragMode !== 'scale' && this.dragMode !== 'translate') {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(this.rotateHandle[0], this.rotateHandle[1]);
      context.stroke();
    }
    if (this.dragMode !== 'rotate' && this.dragMode !== 'translate') {
      context.beginPath();
      context.moveTo(interactionCenter[0], interactionCenter[1]);
      context.lineTo(this.scaleHandle[0], this.scaleHandle[1]);
      context.stroke();
    }
    context.fillStyle = '#e8a030';
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 9, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#151515';
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 3, 0, Math.PI * 2); context.fill();
    if (this.dragMode !== 'scale' && this.dragMode !== 'translate') {
      context.fillStyle = '#67b7d1';
      context.beginPath(); context.arc(this.rotateHandle[0], this.rotateHandle[1], 8, 0, Math.PI * 2); context.fill();
    }
    if (this.dragMode !== 'rotate' && this.dragMode !== 'translate') {
      context.fillStyle = '#78c46b';
      context.fillRect(this.scaleHandle[0] - 7, this.scaleHandle[1] - 7, 14, 14);
    }
    this.uvStatus.textContent = `${face.texture} · ${textureWidth}×${textureHeight} · ${projectionSummary(face)}`;
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
            scaleHandle: this.scaleHandle,
            viewport: this.uvViewport,
          }
        : this.previewInteractions.find(candidate =>
            distance(point, candidate.rotateHandle) <= 16
            || distance(point, candidate.scaleHandle) <= 16
            || distance(point, candidate.center) <= 18) ?? null;
      if (!interaction) {
        this.dragCanvasBounds = null;
        return;
      }
      if (distance(point, interaction.rotateHandle) <= 16) this.dragMode = 'rotate';
      else if (distance(point, interaction.scaleHandle) <= 16) this.dragMode = 'scale';
      else if (distance(point, interaction.center) <= 18) this.dragMode = 'translate';
      else {
        this.dragCanvasBounds = null;
        return;
      }
      this.dragFace = interaction.face;
      this.editor.beginTransaction(
        this.dragMode === 'translate' ? 'Shift texture' : this.dragMode === 'rotate' ? 'Rotate texture' : 'Scale texture',
      );
      this.dragTransactionOpen = true;
      this.previousPoint = point;
      this.dragCenterScreen = [...interaction.center];
      this.dragPointerPoint = [...point];
      this.dragPointerOffset = this.dragMode === 'translate'
        ? [interaction.center[0] - point[0], interaction.center[1] - point[1]]
        : [0, 0];
      this.dragViewportScale = interaction.viewport.scale;
      this.previousAngle = Math.atan2(point[1] - this.dragCenterScreen[1], point[0] - this.dragCenterScreen[0]);
      this.previousRadius = Math.max(1, distance(point, this.dragCenterScreen));
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
              scaleHandle: this.scaleHandle,
              viewport: this.uvViewport,
            }]
          : this.previewInteractions;
        if (interactions.some(candidate => distance(point, candidate.rotateHandle) <= 15)) {
          this.uvCanvas.style.cursor = 'crosshair';
        } else if (interactions.some(candidate => distance(point, candidate.scaleHandle) <= 15)) {
          this.uvCanvas.style.cursor = 'nwse-resize';
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
      } else {
        const center = this.dragCenterScreen ?? this.uvCenterScreen;
        const radius = Math.max(1, distance(point, center));
        const radiusDelta = radius - this.previousRadius;
        scaleFaceTexture(this.editor, radiusDelta / Math.max(80, this.dragViewportScale) * multiplier, [face]);
        this.previousRadius = radius;
        const visual = this.dragPointerPoint ?? point;
        const visualRadius = Math.max(1, distance(visual, center) + radiusDelta * multiplier);
        const pointerAngle = Math.atan2(point[1] - center[1], point[0] - center[0]);
        this.dragPointerPoint = [
          center[0] + Math.cos(pointerAngle) * visualRadius,
          center[1] + Math.sin(pointerAngle) * visualRadius,
        ];
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
