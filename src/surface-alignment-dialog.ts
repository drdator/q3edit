import type { Editor } from './editor';
import { getTextureFaces } from './editor-textures';
import { SurfaceAlignmentSession } from './surface-alignment-session';
import { faceUvPolygon, fitUvViewport, uvToScreen, type UvPoint } from './uv-editor';

let cancelActiveDialog: (() => void) | null = null;

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = primary ? 'btn primary' : 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function numberInput(value: number, min?: number): HTMLInputElement {
  const result = document.createElement('input');
  result.type = 'number'; result.step = 'any'; result.value = String(value);
  if (min !== undefined) result.min = String(min);
  return result;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const result = document.createElement('label');
  result.className = 'surface-alignment-field';
  result.append(Object.assign(document.createElement('span'), { textContent: label }), control);
  return result;
}

interface PreviewSurface {
  points: UvPoint[];
  rows?: UvPoint[][];
  source: boolean;
}

function collectPreviewSurfaces(editor: Editor, textureWidth: number, textureHeight: number): PreviewSurface[] {
  const faces = getTextureFaces(editor);
  const patches = editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
  const result: PreviewSurface[] = faces.map((face, index) => ({
    points: faceUvPolygon(face, textureWidth, textureHeight),
    source: index === 0,
  }));
  for (const patch of patches) {
    const rows = patch.ctrl.map(row => row.map(point => ({ u: point.uv[0], v: point.uv[1] })));
    result.push({ points: rows.flat(), rows, source: result.length === 0 });
  }
  return result;
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: UvPoint[],
  viewport: ReturnType<typeof fitUvViewport>,
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

export function openSurfaceAlignmentDialog(editor: Editor): void {
  cancelActiveDialog?.();
  document.getElementById('surface-alignment-dialog')?.remove();
  const session = new SurfaceAlignmentSession(editor);
  const overlay = document.createElement('div');
  overlay.id = 'surface-alignment-dialog'; overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog surface-alignment-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title'; title.textContent = 'Surface Alignment';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'The first selected face or patch is the source. Changes are previewed live and become one undoable edit when applied.';
  const content = document.createElement('div');
  content.className = 'surface-alignment-content';
  const body = document.createElement('div');
  body.className = 'surface-alignment-body';
  const preview = document.createElement('section');
  preview.className = 'surface-alignment-preview';
  const previewHeader = document.createElement('div');
  previewHeader.className = 'surface-alignment-preview-header';
  const previewTitle = document.createElement('strong');
  previewTitle.textContent = 'Texture preview';
  const previewLegend = document.createElement('span');
  previewLegend.innerHTML = '<i class="source"></i>Source <i class="target"></i>Targets';
  previewHeader.append(previewTitle, previewLegend);
  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'surface-alignment-preview-canvas';
  const previewStatus = document.createElement('div');
  previewStatus.className = 'surface-alignment-preview-status';
  preview.append(previewHeader, previewCanvas, previewStatus);
  const status = document.createElement('div');
  status.className = 'surface-alignment-status';
  let drawFrame: number | null = null;
  let previewImage: HTMLImageElement | null = null;
  let imageReady = false;
  let imagePattern: CanvasPattern | null = null;
  let closed = false;
  const selectedPatches = () => editor.selection.filter(item => item.type === 'patch').map(item => item.patch);
  const sourceTexture = () => getTextureFaces(editor)[0]?.texture ?? selectedPatches()[0]?.texture ?? '';
  const textureSize = (): [number, number] => {
    const loaded = editor.textureManager?.getIfLoaded(sourceTexture());
    return [loaded?.width ?? previewImage?.naturalWidth ?? 128, loaded?.height ?? previewImage?.naturalHeight ?? 128];
  };
  const resizePreview = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const bounds = previewCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(bounds.width * ratio));
    const height = Math.max(280, Math.round(bounds.height * ratio));
    if (previewCanvas.width !== width || previewCanvas.height !== height) {
      previewCanvas.width = width;
      previewCanvas.height = height;
      imagePattern = null;
    }
  };
  const drawPreview = () => {
    drawFrame = null;
    resizePreview();
    const context = previewCanvas.getContext('2d');
    if (!context) return;
    const [textureWidth, textureHeight] = textureSize();
    const surfaces = collectPreviewSurfaces(editor, textureWidth, textureHeight);
    const points = surfaces.flatMap(surface => surface.points);
    const viewport = fitUvViewport(points, previewCanvas.width, previewCanvas.height, 44);
    context.fillStyle = '#121212';
    context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (previewImage && imageReady) {
      imagePattern ??= context.createPattern(previewImage, 'repeat');
      if (imagePattern) {
        imagePattern.setTransform(new DOMMatrix([
          viewport.scale / Math.max(1, previewImage.naturalWidth), 0,
          0, viewport.scale / Math.max(1, previewImage.naturalHeight),
          viewport.offsetX, viewport.offsetY,
        ]));
        context.fillStyle = imagePattern;
        context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      }
    }

    const topLeft = {
      u: -viewport.offsetX / viewport.scale,
      v: -viewport.offsetY / viewport.scale,
    };
    const bottomRight = {
      u: (previewCanvas.width - viewport.offsetX) / viewport.scale,
      v: (previewCanvas.height - viewport.offsetY) / viewport.scale,
    };
    context.strokeStyle = 'rgba(255,255,255,.12)';
    context.lineWidth = 1;
    for (let u = Math.floor(topLeft.u); u <= Math.ceil(bottomRight.u); u++) {
      const [x] = uvToScreen({ u, v: 0 }, viewport);
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, previewCanvas.height); context.stroke();
    }
    for (let v = Math.floor(topLeft.v); v <= Math.ceil(bottomRight.v); v++) {
      const [, y] = uvToScreen({ u: 0, v }, viewport);
      context.beginPath(); context.moveTo(0, y); context.lineTo(previewCanvas.width, y); context.stroke();
    }

    for (const surface of [...surfaces].sort((left, right) => Number(left.source) - Number(right.source))) {
      context.strokeStyle = surface.source ? '#e8a030' : '#67b7d1';
      context.fillStyle = surface.source ? 'rgba(232,160,48,.18)' : 'rgba(103,183,209,.10)';
      context.lineWidth = surface.source ? 3 : 2;
      if (surface.rows) {
        for (const row of surface.rows) drawPolyline(context, row, viewport);
        const columnCount = surface.rows[0]?.length ?? 0;
        for (let column = 0; column < columnCount; column++) {
          drawPolyline(context, surface.rows.map(row => row[column]).filter(Boolean), viewport);
        }
      } else {
        const screenPoints = surface.points.map(point => uvToScreen(point, viewport));
        if (screenPoints.length > 0) {
          context.beginPath();
          context.moveTo(screenPoints[0][0], screenPoints[0][1]);
          for (const point of screenPoints.slice(1)) context.lineTo(point[0], point[1]);
          context.closePath();
          context.fill();
          context.stroke();
        }
      }
    }
    const faceCount = getTextureFaces(editor).length;
    const patchCount = selectedPatches().length;
    previewStatus.textContent = `${sourceTexture() || 'No texture'} · ${faceCount} face${faceCount === 1 ? '' : 's'}${patchCount ? ` · ${patchCount} patch${patchCount === 1 ? '' : 'es'}` : ''}`;
  };
  const schedulePreview = () => {
    if (drawFrame !== null || closed) return;
    drawFrame = window.requestAnimationFrame(drawPreview);
  };
  const updateStatus = () => {
    editor.updateTextureAxisOverlay();
    const report = editor.textureDensityReport();
    status.textContent = report
      ? `${report.count} faces · ${report.minimum.toFixed(3)}–${report.maximum.toFixed(3)} texels/unit · median ${report.median.toFixed(3)}${report.inconsistent ? ` · ${report.inconsistent} inconsistent` : ''}`
      : `${editor.selection.filter(item => item.type === 'patch').length} patches selected`;
    schedulePreview();
  };
  const run = (action: () => void) => {
    action();
    updateStatus();
  };
  editor.updateTextureAxisOverlay();

  if (editor.textureDensityReport() !== null) {
    const transfer = document.createElement('section');
    transfer.innerHTML = '<h3>Projection transfer and continuity</h3>';
    const projectionMode = document.createElement('select');
    projectionMode.append(
      Object.assign(document.createElement('option'), { value: 'world', textContent: 'World-aligned / continuous' }),
      Object.assign(document.createElement('option'), { value: 'local', textContent: 'Local projection values' }),
    );
    const transferActions = document.createElement('div');
    transferActions.className = 'surface-alignment-actions';
    transferActions.append(
      field('Transfer mode', projectionMode),
      button('Copy Source Projection', () => run(() => editor.copyTextureProjection(projectionMode.value as 'world' | 'local')), true),
      button('Align Adjacent Chain', () => run(() => editor.alignTextureFaceChain())),
      button('Wrap Convex Loop', () => run(() => editor.wrapTextureSelection())),
      button('Fit Current Bounds', () => run(() => editor.fitTexture())),
      button('Fit Width', () => run(() => editor.fitTexture('width'))),
      button('Fit Height', () => run(() => editor.fitTexture('height'))),
    );
    transfer.appendChild(transferActions);

    const projection = document.createElement('section');
    projection.innerHTML = '<h3>Projection basis</h3>';
    const basisMode = document.createElement('select');
    basisMode.className = 'app-select';
    basisMode.append(
      Object.assign(document.createElement('option'), { value: 'axial', textContent: 'Axial (face canonical)' }),
      Object.assign(document.createElement('option'), { value: 'camera', textContent: 'Current 3D camera' }),
      Object.assign(document.createElement('option'), { value: 'top', textContent: 'Top orthographic (XY)' }),
      Object.assign(document.createElement('option'), { value: 'front', textContent: 'Front orthographic (XZ)' }),
      Object.assign(document.createElement('option'), { value: 'side', textContent: 'Side orthographic (YZ)' }),
    );
    const projectionActions = document.createElement('div');
    projectionActions.className = 'surface-alignment-actions';
    projectionActions.append(
      field('Basis', basisMode),
      button('Project Selected Faces', () => run(() =>
        editor.projectTexture(basisMode.value as 'axial' | 'camera' | 'top' | 'front' | 'side')), true),
    );
    projection.appendChild(projectionActions);

    const manipulator = document.createElement('section');
    manipulator.innerHTML = '<h3>Live projection controls</h3>';
    const sliderGrid = document.createElement('div');
    sliderGrid.className = 'surface-slider-grid';
    const shiftU = document.createElement('input'); shiftU.type = 'range'; shiftU.min = '-128'; shiftU.max = '128'; shiftU.step = '1'; shiftU.value = '0';
    const shiftV = shiftU.cloneNode() as HTMLInputElement;
    const scale = document.createElement('input'); scale.type = 'range'; scale.min = '-100'; scale.max = '100'; scale.step = '1'; scale.value = '0';
    const rotate = document.createElement('input'); rotate.type = 'range'; rotate.min = '-180'; rotate.max = '180'; rotate.step = '1'; rotate.value = '0';
    let previousU = 0; let previousV = 0; let previousScale = 0; let previousRotate = 0;
    shiftU.oninput = () => { const value = Number(shiftU.value); run(() => editor.shiftTexture(value - previousU, 0)); previousU = value; };
    shiftV.oninput = () => { const value = Number(shiftV.value); run(() => editor.shiftTexture(0, value - previousV)); previousV = value; };
    scale.oninput = () => { const value = Number(scale.value); run(() => editor.scaleTexture((value - previousScale) * 0.005)); previousScale = value; };
    rotate.oninput = () => { const value = Number(rotate.value); run(() => editor.rotateTexture(value - previousRotate)); previousRotate = value; };
    sliderGrid.append(field('Shift U', shiftU), field('Shift V', shiftV), field('Scale', scale), field('Rotation', rotate));
    manipulator.appendChild(sliderGrid);

    const density = document.createElement('section');
    density.innerHTML = '<h3>Texel density and real-world fit</h3>';
    const densityInput = numberInput(editor.textureDensityReport()?.median ?? 2, 0.001);
    const unitsInput = numberInput(128, 0.001);
    const densityActions = document.createElement('div');
    densityActions.className = 'surface-alignment-actions';
    densityActions.append(
      field('Texels per map unit', densityInput),
      button('Set Density', () => run(() => editor.setTextureDensity(Number(densityInput.value)))),
      field('Map units per repeat', unitsInput),
      button('Fit by Map Units', () => run(() => editor.fitTextureByMapUnits(Number(unitsInput.value)))),
    );
    density.appendChild(densityActions);
    body.append(transfer, projection, manipulator, density);
  }

  if (editor.selection.some(item => item.type === 'patch')) {
    const patches = document.createElement('section');
    patches.innerHTML = '<h3>Patch UV seams and direction</h3>';
    const units = numberInput(128, 0.001);
    const actions = document.createElement('div');
    actions.className = 'surface-alignment-actions';
    actions.append(
      button('Align Closest Boundaries', () => run(() => editor.alignPatchBoundaries()), true),
      button('Copy Source UV Grid', () => run(() => editor.copyPatchUV())),
      field('Natural repeat units', units),
      button('Naturalize by Surface Distance', () => run(() => editor.naturalizePatchesByDistance(Number(units.value)))),
    );
    patches.appendChild(actions);
    body.appendChild(patches);
  }
  body.appendChild(status);
  content.append(body, preview);
  updateStatus();
  const finish = (apply: boolean) => {
    if (closed) return;
    closed = true;
    const changed = apply ? session.apply() : (session.cancel(), false);
    editor.textureAxisOverlayLines = [];
    editor.redrawRequested = true;
    if (drawFrame !== null) window.cancelAnimationFrame(drawFrame);
    window.removeEventListener('resize', schedulePreview);
    cancelActiveDialog = null;
    overlay.remove();
    editor.statusMessage = apply
      ? changed ? 'Surface alignment applied' : 'No surface alignment changes'
      : 'Surface alignment cancelled';
  };
  cancelActiveDialog = () => finish(false);
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(button('Cancel', () => finish(false)), button('Apply', () => finish(true), true));
  dialog.append(title, description, content, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  window.addEventListener('resize', schedulePreview);
  const thumbnail = editor.textureManager?.getThumbnailUrl(sourceTexture());
  if (thumbnail) {
    previewImage = new Image();
    previewImage.onload = () => {
      imageReady = true;
      imagePattern = null;
      schedulePreview();
    };
    previewImage.src = thumbnail;
  }
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { finish(false); event.stopPropagation(); } });
  schedulePreview();
}
