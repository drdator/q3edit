import type { BrushFace } from './brush';
import type { Editor } from './editor';
import { getTextureFaces } from './editor-textures';
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

export type SurfaceInspectorTab = 'align' | 'uv';
type DragMode = 'translate' | 'rotate' | 'scale';

interface PreviewSurface {
  points: UvPoint[];
  rows?: UvPoint[][];
  source: boolean;
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

function collectPreviewSurfaces(editor: Editor, textureWidth: number, textureHeight: number): PreviewSurface[] {
  const result: PreviewSurface[] = getTextureFaces(editor).map((face, index) => ({
    points: faceUvPolygon(face, textureWidth, textureHeight),
    source: index === 0,
  }));
  const patches = editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
  for (const patch of patches) {
    const rows = patch.ctrl.map(row => row.map(point => ({ u: point.uv[0], v: point.uv[1] })));
    result.push({ points: rows.flat(), rows, source: result.length === 0 });
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
  private activeTab: SurfaceInspectorTab = 'align';
  private readonly tabs: Record<SurfaceInspectorTab, HTMLButtonElement>;
  private readonly panes: Record<SurfaceInspectorTab, HTMLElement>;
  private readonly empty: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly classicFields: HTMLElement;
  private readonly offsetU: HTMLInputElement;
  private readonly offsetV: HTMLInputElement;
  private readonly scaleU: HTMLInputElement;
  private readonly scaleV: HTMLInputElement;
  private readonly rotation: HTMLInputElement;
  private readonly density: HTMLInputElement;
  private readonly mapUnits: HTMLInputElement;
  private readonly patchSection: HTMLElement;
  private readonly patchUnits: HTMLInputElement;
  private readonly alignCanvas: HTMLCanvasElement;
  private readonly alignStatus: HTMLElement;
  private readonly uvUnavailable: HTMLElement;
  private readonly uvWorkspace: HTMLElement;
  private readonly uvCanvas: HTMLCanvasElement;
  private readonly uvStatus: HTMLElement;
  private readonly clipTexture: HTMLInputElement;
  private drawFrame: number | null = null;
  private lastSelectionSignature = '';
  private alignImage: HTMLImageElement | null = null;
  private alignImageTexture = '';
  private alignImageReady = false;
  private alignPattern: CanvasPattern | null = null;
  private uvImage: HTMLImageElement | null = null;
  private uvImageTexture = '';
  private uvImageReady = false;
  private uvPattern: CanvasPattern | null = null;
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

  constructor(private readonly editor: Editor, private readonly body: HTMLElement) {
    body.innerHTML = '';
    body.classList.add('surface-inspector');

    const tabList = document.createElement('div');
    tabList.className = 'surface-inspector-tabs';
    tabList.setAttribute('role', 'tablist');
    this.tabs = {
      align: this.createTab('align', 'Align'),
      uv: this.createTab('uv', 'UV'),
    };
    tabList.append(this.tabs.align, this.tabs.uv);

    this.empty = document.createElement('div');
    this.empty.className = 'surface-inspector-empty';

    this.summary = document.createElement('div');
    this.summary.className = 'surface-inspector-summary';

    this.panes = {
      align: document.createElement('div'),
      uv: document.createElement('div'),
    };
    this.panes.align.className = 'surface-inspector-pane';
    this.panes.align.id = 'surface-inspector-align';
    this.panes.align.setAttribute('role', 'tabpanel');
    this.panes.uv.className = 'surface-inspector-pane';
    this.panes.uv.id = 'surface-inspector-uv';
    this.panes.uv.setAttribute('role', 'tabpanel');
    this.tabs.align.setAttribute('aria-controls', this.panes.align.id);
    this.tabs.uv.setAttribute('aria-controls', this.panes.uv.id);

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
    this.classicFields = document.createElement('div');
    this.classicFields.className = 'surface-inspector-value-grid';
    this.offsetU = numberInput(0);
    this.offsetV = numberInput(0);
    this.scaleU = numberInput(0.5);
    this.scaleV = numberInput(0.5);
    this.rotation = numberInput(0);
    this.classicFields.append(
      labelled('Shift U', this.offsetU),
      labelled('Shift V', this.offsetV),
      labelled('Scale U', this.scaleU),
      labelled('Scale V', this.scaleV),
      labelled('Rotation', this.rotation),
    );
    values.content.appendChild(this.classicFields);
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

    const preview = section('Texture preview');
    this.alignCanvas = document.createElement('canvas');
    this.alignCanvas.className = 'surface-inspector-preview';
    this.alignStatus = document.createElement('div');
    this.alignStatus.className = 'surface-inspector-canvas-status';
    preview.content.append(this.alignCanvas, this.alignStatus);

    this.panes.align.append(
      quick.root,
      values.root,
      transfer.root,
      projection.root,
      densitySection.root,
      patch.root,
      preview.root,
    );

    this.uvUnavailable = document.createElement('div');
    this.uvUnavailable.className = 'surface-inspector-empty';
    this.uvWorkspace = document.createElement('div');
    this.uvWorkspace.className = 'surface-inspector-uv-workspace';
    this.uvCanvas = document.createElement('canvas');
    this.uvCanvas.className = 'surface-inspector-uv-canvas';
    this.uvCanvas.tabIndex = 0;
    const hint = document.createElement('div');
    hint.className = 'surface-inspector-uv-hint';
    hint.innerHTML = '<span><i class="uv-handle-swatch translate"></i>Shift</span><span><i class="uv-handle-swatch rotate"></i>Rotate</span><span><i class="uv-handle-swatch scale"></i>Scale</span>';
    const clip = document.createElement('label');
    clip.className = 'uv-editor-option surface-inspector-clip';
    this.clipTexture = document.createElement('input');
    this.clipTexture.type = 'checkbox';
    this.clipTexture.setAttribute('aria-label', 'Clip texture preview to face');
    clip.append(this.clipTexture, document.createTextNode('Clip'));
    hint.appendChild(clip);
    this.uvStatus = document.createElement('div');
    this.uvStatus.className = 'surface-inspector-canvas-status';
    const uvActions = document.createElement('div');
    uvActions.className = 'surface-inspector-actions';
    uvActions.append(
      button('Fit', () => this.run(() => this.editor.fitTexture()), true),
      button('Width', () => this.run(() => this.editor.fitTexture('width'))),
      button('Height', () => this.run(() => this.editor.fitTexture('height'))),
      button('Reset', () => this.run(() => this.editor.resetTextureAlignment())),
    );
    this.uvWorkspace.append(this.uvCanvas, hint, this.uvStatus, uvActions);
    this.panes.uv.append(this.uvUnavailable, this.uvWorkspace);

    body.append(tabList, this.empty, this.summary, this.panes.align, this.panes.uv);
    this.bindUvCanvas();
    this.clipTexture.addEventListener('change', () => this.scheduleDraw());
    window.addEventListener('resize', () => this.scheduleDraw());
    this.setTab('align');
  }

  open(tab: SurfaceInspectorTab): void {
    this.setTab(tab);
    if (tab === 'uv' && this.editor.selectedFaces.length === 1) {
      requestAnimationFrame(() => this.uvCanvas.focus());
    }
  }

  update(force = false): void {
    const faces = getTextureFaces(this.editor);
    const explicitFaces = this.editor.selectedFaces;
    const patches = this.editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
    const signature = [
      this.editor.documentRevision,
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
    this.panes.align.hidden = !hasSurfaces || this.activeTab !== 'align';
    this.panes.uv.hidden = !hasSurfaces || this.activeTab !== 'uv';

    if (hasSurfaces) {
      const parts: string[] = [];
      if (faces.length > 0) parts.push(`${faces.length} face${faces.length === 1 ? '' : 's'}`);
      if (patches.length > 0) parts.push(`${patches.length} patch${patches.length === 1 ? '' : 'es'}`);
      const textures = [...new Set([
        ...faces.map(face => face.texture),
        ...patches.map(patch => patch.texture),
      ])];
      this.summary.textContent = `${parts.join(' · ')} · ${textures.length === 1 ? textures[0] : `${textures.length} textures`}`;
    }

    const classic = faces.map(face => face.textureProjection.kind === 'classic' ? face.textureProjection : null);
    const allClassic = classic.length > 0 && classic.every(value => value !== null);
    this.classicFields.hidden = !allClassic;
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

    const uvAvailable = explicitFaces.length === 1;
    this.tabs.uv.disabled = !uvAvailable;
    this.tabs.uv.title = uvAvailable ? 'Edit the selected face interactively' : 'Select exactly one brush face';
    this.uvUnavailable.hidden = uvAvailable;
    this.uvWorkspace.hidden = !uvAvailable;
    this.uvUnavailable.textContent = explicitFaces.length === 0
      ? 'Select exactly one brush face to use the interactive UV handles.'
      : 'The interactive UV editor supports one selected face at a time.';

    this.updateTextureImages(faces[0]?.texture ?? patches[0]?.texture ?? '', explicitFaces[0]?.texture ?? '');
    const panelVisible = !this.body.closest('.panel')?.classList.contains('collapsed')
      && this.body.offsetParent !== null;
    if (hasSurfaces && panelVisible) {
      this.editor.updateTextureAxisOverlay();
    } else if (this.editor.textureAxisOverlayLines.length > 0) {
      this.editor.textureAxisOverlayLines = [];
      this.editor.redrawRequested = true;
    }
    this.scheduleDraw();
  }

  private createTab(tab: SurfaceInspectorTab, label: string): HTMLButtonElement {
    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'surface-inspector-tab';
    result.textContent = label;
    result.setAttribute('role', 'tab');
    result.addEventListener('click', () => this.setTab(tab));
    return result;
  }

  private setTab(tab: SurfaceInspectorTab): void {
    this.activeTab = tab;
    for (const name of ['align', 'uv'] as const) {
      const active = name === tab;
      this.tabs[name].classList.toggle('active', active);
      this.tabs[name].setAttribute('aria-selected', String(active));
      this.panes[name].hidden = !active;
    }
    this.update(true);
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

  private updateTextureImages(alignTexture: string, uvTexture: string): void {
    if (alignTexture !== this.alignImageTexture) {
      this.alignImageTexture = alignTexture;
      this.alignImageReady = false;
      this.alignImage = this.loadTextureImage(alignTexture, () => {
        this.alignImageReady = true;
        this.alignPattern = null;
        this.scheduleDraw();
      });
    }
    if (uvTexture !== this.uvImageTexture) {
      this.uvImageTexture = uvTexture;
      this.uvImageReady = false;
      this.uvImage = this.loadTextureImage(uvTexture, () => {
        this.uvImageReady = true;
        this.uvPattern = null;
        this.scheduleDraw();
      });
    }
  }

  private loadTextureImage(texture: string, loaded: () => void): HTMLImageElement | null {
    const thumbnail = texture ? this.editor.textureManager?.getThumbnailUrl(texture) : null;
    if (!thumbnail) return null;
    const image = new Image();
    image.onload = loaded;
    image.src = thumbnail;
    return image;
  }

  private textureSize(texture: string, image: HTMLImageElement | null): [number, number] {
    const loaded = this.editor.textureManager?.getIfLoaded(texture);
    return [loaded?.width ?? image?.naturalWidth ?? 128, loaded?.height ?? image?.naturalHeight ?? 128];
  }

  private scheduleDraw(): void {
    if (this.drawFrame !== null) return;
    this.drawFrame = window.requestAnimationFrame(() => {
      this.drawFrame = null;
      if (this.activeTab === 'align') this.drawAlignmentPreview();
      else this.drawUvEditor();
    });
  }

  private drawAlignmentPreview(): void {
    if (this.panes.align.hidden || this.empty.hidden === false) return;
    if (resizeCanvas(this.alignCanvas, 1, 1)) this.alignPattern = null;
    const context = this.alignCanvas.getContext('2d');
    if (!context) return;
    const texture = getTextureFaces(this.editor)[0]?.texture
      ?? this.editor.selection.find(item => item.type === 'patch')?.patch.texture
      ?? '';
    const [textureWidth, textureHeight] = this.textureSize(texture, this.alignImage);
    const surfaces = collectPreviewSurfaces(this.editor, textureWidth, textureHeight);
    const points = surfaces.flatMap(surface => surface.points);
    const viewport = fitUvViewport(points, this.alignCanvas.width, this.alignCanvas.height, 30);
    context.fillStyle = '#151515';
    context.fillRect(0, 0, this.alignCanvas.width, this.alignCanvas.height);

    if (this.alignImage && this.alignImageReady) {
      this.alignPattern ??= context.createPattern(this.alignImage, 'repeat');
      if (this.alignPattern) {
        this.alignPattern.setTransform(new DOMMatrix([
          viewport.scale / Math.max(1, this.alignImage.naturalWidth), 0,
          0, viewport.scale / Math.max(1, this.alignImage.naturalHeight),
          viewport.offsetX, viewport.offsetY,
        ]));
        context.fillStyle = this.alignPattern;
        context.fillRect(0, 0, this.alignCanvas.width, this.alignCanvas.height);
      }
    }

    for (const surface of [...surfaces].sort((left, right) => Number(left.source) - Number(right.source))) {
      context.strokeStyle = surface.source ? '#e8a030' : '#67b7d1';
      context.fillStyle = surface.source ? 'rgba(232,160,48,.16)' : 'rgba(103,183,209,.10)';
      context.lineWidth = surface.source ? 3 : 2;
      if (surface.rows) {
        for (const row of surface.rows) drawPolyline(context, row, viewport);
        const columns = surface.rows[0]?.length ?? 0;
        for (let column = 0; column < columns; column++) {
          drawPolyline(context, surface.rows.map(row => row[column]).filter(Boolean), viewport);
        }
      } else {
        const screen = surface.points.map(point => uvToScreen(point, viewport));
        if (screen.length === 0) continue;
        context.beginPath();
        context.moveTo(screen[0][0], screen[0][1]);
        for (const point of screen.slice(1)) context.lineTo(point[0], point[1]);
        context.closePath();
        context.fill();
        context.stroke();
      }
    }
    const report = this.editor.textureDensityReport();
    this.alignStatus.textContent = report
      ? `${report.minimum.toFixed(3)}–${report.maximum.toFixed(3)} texels/unit · median ${report.median.toFixed(3)}`
      : `${surfaces.length} patch surface${surfaces.length === 1 ? '' : 's'}`;
  }

  private currentUvFace(): BrushFace | null {
    return this.editor.selectedFaces.length === 1 ? this.editor.selectedFaces[0] : null;
  }

  private drawUvBackdrop(
    context: CanvasRenderingContext2D,
    clipPoints: Array<[number, number]> | null,
  ): void {
    context.fillStyle = '#151515';
    context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
    let pattern: CanvasPattern | null;
    let sourceWidth: number;
    let sourceHeight: number;
    if (this.uvImage && this.uvImageReady) {
      this.uvPattern ??= context.createPattern(this.uvImage, 'repeat');
      pattern = this.uvPattern;
      sourceWidth = Math.max(1, this.uvImage.naturalWidth);
      sourceHeight = Math.max(1, this.uvImage.naturalHeight);
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
      sourceWidth = sourceHeight = 1;
    }
    if (pattern) {
      pattern.setTransform(new DOMMatrix([
        this.uvViewport.scale / sourceWidth, 0,
        0, this.uvViewport.scale / sourceHeight,
        this.uvViewport.offsetX, this.uvViewport.offsetY,
      ]));
      context.save();
      if (clipPoints && clipPoints.length >= 3) {
        context.beginPath();
        context.moveTo(clipPoints[0][0], clipPoints[0][1]);
        for (const point of clipPoints.slice(1)) context.lineTo(point[0], point[1]);
        context.closePath();
        context.clip();
      }
      context.fillStyle = pattern;
      context.fillRect(0, 0, this.uvCanvas.width, this.uvCanvas.height);
      context.restore();
    }
    const topLeft = screenToUv(0, 0, this.uvViewport);
    const bottomRight = screenToUv(this.uvCanvas.width, this.uvCanvas.height, this.uvViewport);
    context.strokeStyle = 'rgba(255,255,255,.08)';
    context.lineWidth = 1;
    for (let u = Math.floor(Math.min(topLeft.u, bottomRight.u)) - 1; u <= Math.ceil(Math.max(topLeft.u, bottomRight.u)) + 1; u++) {
      const [x] = uvToScreen({ u, v: 0 }, this.uvViewport);
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, this.uvCanvas.height); context.stroke();
    }
    for (let v = Math.floor(Math.min(topLeft.v, bottomRight.v)) - 1; v <= Math.ceil(Math.max(topLeft.v, bottomRight.v)) + 1; v++) {
      const [, y] = uvToScreen({ u: 0, v }, this.uvViewport);
      context.beginPath(); context.moveTo(0, y); context.lineTo(this.uvCanvas.width, y); context.stroke();
    }
  }

  private drawUvEditor(): void {
    if (this.panes.uv.hidden || this.uvWorkspace.hidden) return;
    const face = this.currentUvFace();
    if (!face) return;
    if (resizeCanvas(this.uvCanvas, 1, 1)) {
      this.uvPattern = null;
      this.checkerPattern = null;
    }
    const context = this.uvCanvas.getContext('2d');
    if (!context) return;
    const [textureWidth, textureHeight] = this.textureSize(face.texture, this.uvImage);
    this.uvPolygon = faceUvPolygon(face, textureWidth, textureHeight);
    this.uvViewport = fitUvViewport(this.uvPolygon, this.uvCanvas.width, this.uvCanvas.height, 58);
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
      : [this.uvCenterScreen[0], topY - 34];
    this.scaleHandle = this.dragMode === 'scale' && this.dragPointerPoint
      ? this.dragPointerPoint
      : [rightX + 20, this.uvCenterScreen[1]];
    this.drawUvBackdrop(context, this.clipTexture.checked ? points : null);

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
      const face = this.currentUvFace();
      if (!face) return;
      this.dragCanvasBounds = this.uvCanvas.getBoundingClientRect();
      const point = eventPoint(event, this.uvCanvas, this.dragCanvasBounds);
      if (distance(point, this.rotateHandle) <= 18) this.dragMode = 'rotate';
      else if (distance(point, this.scaleHandle) <= 18) this.dragMode = 'scale';
      else if (distance(point, this.uvCenterScreen) <= 22) this.dragMode = 'translate';
      else {
        this.dragCanvasBounds = null;
        return;
      }
      this.editor.beginTransaction(
        this.dragMode === 'translate' ? 'Shift texture' : this.dragMode === 'rotate' ? 'Rotate texture' : 'Scale texture',
      );
      this.dragTransactionOpen = true;
      this.previousPoint = point;
      this.dragCenterScreen = [...this.uvCenterScreen];
      this.dragPointerPoint = [...point];
      this.dragPointerOffset = this.dragMode === 'translate'
        ? [this.uvCenterScreen[0] - point[0], this.uvCenterScreen[1] - point[1]]
        : [0, 0];
      this.dragViewportScale = this.uvViewport.scale;
      this.previousAngle = Math.atan2(point[1] - this.dragCenterScreen[1], point[0] - this.dragCenterScreen[0]);
      this.previousRadius = Math.max(1, distance(point, this.dragCenterScreen));
      this.uvCanvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.uvCanvas.addEventListener('pointermove', event => {
      const point = eventPoint(event, this.uvCanvas, this.dragCanvasBounds ?? undefined);
      if (!this.dragMode) {
        if (distance(point, this.rotateHandle) <= 15) this.uvCanvas.style.cursor = 'crosshair';
        else if (distance(point, this.scaleHandle) <= 15) this.uvCanvas.style.cursor = 'nwse-resize';
        else if (distance(point, this.uvCenterScreen) <= 18) this.uvCanvas.style.cursor = 'move';
        else this.uvCanvas.style.cursor = 'default';
        return;
      }
      if (!this.currentUvFace()) {
        this.finishUvDrag(event);
        return;
      }
      if (this.dragMode === 'translate') {
        const face = this.currentUvFace()!;
        const [textureWidth, textureHeight] = this.textureSize(face.texture, this.uvImage);
        const dx = (point[0] - this.previousPoint[0]) / this.dragViewportScale * textureWidth;
        const dy = (point[1] - this.previousPoint[1]) / this.dragViewportScale * textureHeight;
        this.editor.shiftTexture(dx, dy);
        this.dragPointerPoint = [...point];
      } else if (this.dragMode === 'rotate') {
        const center = this.dragCenterScreen ?? this.uvCenterScreen;
        const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
        this.editor.rotateTexture(shortestAngleDelta(this.previousAngle, angle) * 180 / Math.PI);
        this.previousAngle = angle;
        this.dragPointerPoint = [...point];
      } else {
        const center = this.dragCenterScreen ?? this.uvCenterScreen;
        const radius = Math.max(1, distance(point, center));
        this.editor.scaleTexture((radius - this.previousRadius) / Math.max(80, this.dragViewportScale));
        this.previousRadius = radius;
        this.dragPointerPoint = [...point];
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
