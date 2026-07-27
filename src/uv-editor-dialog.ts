import type { Editor } from './editor';
import type { BrushFace } from './brush';
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

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
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
    return `Classic · shift ${projection.offsetX.toFixed(1)}, ${projection.offsetY.toFixed(1)} · scale ${projection.scaleX.toFixed(3)}, ${projection.scaleY.toFixed(3)} · ${projection.rotation.toFixed(1)}°`;
  }
  return 'Brush primitive · matrix projection';
}

export function openUvEditorDialog(editor: Editor): void {
  document.getElementById('uv-editor-dialog')?.remove();
  const selectedFaces = editor.selectedFaces;
  if (selectedFaces.length !== 1) {
    editor.statusMessage = 'UV Editor requires exactly one selected brush face';
    return;
  }

  const face = selectedFaces[0];
  const faceSelection = editor.selection.find(item => item.type === 'face' && item.face === face);
  if (!faceSelection || faceSelection.type !== 'face') {
    editor.statusMessage = 'UV Editor requires exactly one selected brush face';
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'uv-editor-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog uv-editor-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = 'UV Editor';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Drag the center handle to shift the texture. Drag the round handle to rotate and the square handle to scale.';
  const canvas = document.createElement('canvas');
  canvas.className = 'uv-editor-canvas';
  canvas.tabIndex = 0;
  const status = document.createElement('div');
  status.className = 'uv-editor-status';
  const hint = document.createElement('div');
  hint.className = 'uv-editor-hint';
  hint.innerHTML = '<span><i class="uv-handle-swatch translate"></i>Shift</span><span><i class="uv-handle-swatch rotate"></i>Rotate</span><span><i class="uv-handle-swatch scale"></i>Scale</span>';
  const clipOption = document.createElement('label');
  clipOption.className = 'uv-editor-option';
  const clipTexture = document.createElement('input');
  clipTexture.type = 'checkbox';
  clipTexture.setAttribute('aria-label', 'Clip texture preview to face');
  clipOption.append(clipTexture, document.createTextNode('Clip texture to face'));
  hint.appendChild(clipOption);
  const body = document.createElement('div');
  body.className = 'uv-editor-body';
  body.append(canvas, hint, status);

  let image: HTMLImageElement | null = null;
  let imageReady = false;
  let viewport: UvViewport;
  let polygon: UvPoint[] = [];
  let center: UvPoint = { u: 0, v: 0 };
  let centerScreen: [number, number] = [0, 0];
  let rotateHandle: [number, number] = [0, 0];
  let scaleHandle: [number, number] = [0, 0];
  let dragMode: DragMode | null = null;
  let previousPoint: [number, number] = [0, 0];
  let previousAngle = 0;
  let previousRadius = 0;
  let dragTransactionOpen = false;
  let dragCanvasBounds: DOMRect | null = null;
  let dragCenterScreen: [number, number] | null = null;
  let dragPointerPoint: [number, number] | null = null;
  let dragViewportScale = 1;
  let drawFrame: number | null = null;
  let imagePattern: CanvasPattern | null = null;
  let checkerPattern: CanvasPattern | null = null;
  let close = () => overlay.remove();

  const faceIsCurrent = () =>
    editor.entities.includes(faceSelection.entity)
    && faceSelection.entity.brushes.includes(faceSelection.brush)
    && faceSelection.brush.faces.includes(face);
  const requireCurrentFace = (): boolean => {
    if (faceIsCurrent()) return true;
    editor.statusMessage = 'UV Editor closed because the selected face changed';
    close();
    return false;
  };

  const textureInfo = () => editor.textureManager?.getIfLoaded(face.texture);
  const textureSize = (): [number, number] => {
    const loaded = textureInfo();
    return [loaded?.width ?? image?.naturalWidth ?? 128, loaded?.height ?? image?.naturalHeight ?? 128];
  };

  const resizeCanvas = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(560, Math.round(bounds.width * ratio));
    const height = Math.max(380, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const drawBackdrop = (
    context: CanvasRenderingContext2D,
    clipPoints: Array<[number, number]> | null,
  ) => {
    context.fillStyle = '#151515';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const topLeft = screenToUv(0, 0, viewport);
    const bottomRight = screenToUv(canvas.width, canvas.height, viewport);
    const firstU = Math.floor(Math.min(topLeft.u, bottomRight.u)) - 1;
    const lastU = Math.ceil(Math.max(topLeft.u, bottomRight.u)) + 1;
    const firstV = Math.floor(Math.min(topLeft.v, bottomRight.v)) - 1;
    const lastV = Math.ceil(Math.max(topLeft.v, bottomRight.v)) + 1;
    let pattern: CanvasPattern | null;
    let sourceWidth: number;
    let sourceHeight: number;
    if (image && imageReady) {
      imagePattern ??= context.createPattern(image, 'repeat');
      pattern = imagePattern;
      sourceWidth = Math.max(1, image.naturalWidth);
      sourceHeight = Math.max(1, image.naturalHeight);
    } else {
      if (!checkerPattern) {
        const checker = document.createElement('canvas');
        checker.width = checker.height = 2;
        const checkerContext = checker.getContext('2d');
        if (checkerContext) {
          checkerContext.fillStyle = '#292929';
          checkerContext.fillRect(0, 0, 2, 2);
          checkerContext.fillStyle = '#202020';
          checkerContext.fillRect(1, 0, 1, 1);
          checkerContext.fillRect(0, 1, 1, 1);
          checkerPattern = context.createPattern(checker, 'repeat');
        }
      }
      pattern = checkerPattern;
      sourceWidth = sourceHeight = 1;
    }
    if (pattern) {
      pattern.setTransform(new DOMMatrix([
        viewport.scale / sourceWidth, 0,
        0, viewport.scale / sourceHeight,
        viewport.offsetX, viewport.offsetY,
      ]));
      context.save();
      if (clipPoints && clipPoints.length >= 3) {
        context.beginPath();
        context.moveTo(clipPoints[0][0], clipPoints[0][1]);
        for (let index = 1; index < clipPoints.length; index++) {
          context.lineTo(clipPoints[index][0], clipPoints[index][1]);
        }
        context.closePath();
        context.clip();
      }
      context.fillStyle = pattern;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    context.strokeStyle = 'rgba(255,255,255,.08)';
    context.lineWidth = 1;
    for (let u = firstU; u <= lastU; u++) {
      const [x] = uvToScreen({ u, v: 0 }, viewport);
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
    }
    for (let v = firstV; v <= lastV; v++) {
      const [, y] = uvToScreen({ u: 0, v }, viewport);
      context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
    }
  };

  const draw = () => {
    drawFrame = null;
    resizeCanvas();
    const context = canvas.getContext('2d');
    if (!context) return;
    const [textureWidth, textureHeight] = textureSize();
    polygon = faceUvPolygon(face, textureWidth, textureHeight);
    viewport = fitUvViewport(polygon, canvas.width, canvas.height, 92);
    center = uvPolygonCenter(polygon);
    centerScreen = uvToScreen(center, viewport);
    const screenPoints = polygon.map(point => uvToScreen(point, viewport));
    const topY = Math.min(...screenPoints.map(point => point[1]));
    const rightX = Math.max(...screenPoints.map(point => point[0]));
    const interactionCenter = (dragMode === 'rotate' || dragMode === 'scale') && dragCenterScreen
      ? dragCenterScreen
      : centerScreen;
    rotateHandle = dragMode === 'rotate' && dragPointerPoint
      ? dragPointerPoint
      : [centerScreen[0], topY - 44];
    scaleHandle = dragMode === 'scale' && dragPointerPoint
      ? dragPointerPoint
      : [rightX + 24, centerScreen[1]];
    drawBackdrop(context, clipTexture.checked ? screenPoints : null);

    if (screenPoints.length > 0) {
      context.beginPath();
      context.moveTo(screenPoints[0][0], screenPoints[0][1]);
      for (let index = 1; index < screenPoints.length; index++) context.lineTo(screenPoints[index][0], screenPoints[index][1]);
      context.closePath();
      context.fillStyle = 'rgba(232,160,48,.10)';
      context.fill();
      context.strokeStyle = '#e8a030';
      context.lineWidth = 3;
      context.stroke();
    }

    context.strokeStyle = 'rgba(232,160,48,.65)';
    context.lineWidth = 2;
    if (dragMode !== 'scale') {
      context.beginPath(); context.moveTo(interactionCenter[0], interactionCenter[1]); context.lineTo(rotateHandle[0], rotateHandle[1]); context.stroke();
    }
    if (dragMode !== 'rotate') {
      context.beginPath(); context.moveTo(interactionCenter[0], interactionCenter[1]); context.lineTo(scaleHandle[0], scaleHandle[1]); context.stroke();
    }
    context.fillStyle = '#e8a030';
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 11, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#151515';
    context.beginPath(); context.arc(interactionCenter[0], interactionCenter[1], 4, 0, Math.PI * 2); context.fill();
    if (dragMode !== 'scale') {
      context.fillStyle = '#67b7d1';
      context.beginPath(); context.arc(rotateHandle[0], rotateHandle[1], 10, 0, Math.PI * 2); context.fill();
    }
    if (dragMode !== 'rotate') {
      context.fillStyle = '#78c46b';
      context.fillRect(scaleHandle[0] - 9, scaleHandle[1] - 9, 18, 18);
    }
    status.textContent = `${face.texture} · ${textureWidth}×${textureHeight} · ${projectionSummary(face)}`;
  };
  const scheduleDraw = () => {
    if (drawFrame !== null) return;
    drawFrame = window.requestAnimationFrame(draw);
  };
  clipTexture.onchange = scheduleDraw;

  const updateCursor = (point: [number, number]) => {
    if (dragMode) return;
    if (distance(point, rotateHandle) <= 18) canvas.style.cursor = 'crosshair';
    else if (distance(point, scaleHandle) <= 18) canvas.style.cursor = 'nwse-resize';
    else if (distance(point, centerScreen) <= 22) canvas.style.cursor = 'move';
    else canvas.style.cursor = 'default';
  };

  canvas.addEventListener('pointerdown', event => {
    if (!requireCurrentFace()) return;
    dragCanvasBounds = canvas.getBoundingClientRect();
    const point = eventPoint(event, canvas, dragCanvasBounds);
    if (distance(point, rotateHandle) <= 22) dragMode = 'rotate';
    else if (distance(point, scaleHandle) <= 22) dragMode = 'scale';
    else if (distance(point, centerScreen) <= 28) dragMode = 'translate';
    else {
      dragCanvasBounds = null;
      return;
    }
    editor.beginTransaction(
      dragMode === 'translate'
        ? 'Shift texture'
        : dragMode === 'rotate'
          ? 'Rotate texture'
          : 'Scale texture',
    );
    dragTransactionOpen = true;
    previousPoint = point;
    dragCenterScreen = [...centerScreen];
    dragPointerPoint = [...point];
    dragViewportScale = viewport.scale;
    previousAngle = Math.atan2(point[1] - dragCenterScreen[1], point[0] - dragCenterScreen[0]);
    previousRadius = Math.max(1, distance(point, dragCenterScreen));
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (dragMode && !requireCurrentFace()) return;
    const point = eventPoint(event, canvas, dragCanvasBounds ?? undefined);
    if (!dragMode) {
      updateCursor(point);
      return;
    }
    if (dragMode === 'translate') {
      const [textureWidth, textureHeight] = textureSize();
      const dx = (point[0] - previousPoint[0]) / viewport.scale * textureWidth;
      const dy = (point[1] - previousPoint[1]) / viewport.scale * textureHeight;
      editor.shiftTexture(dx, dy);
    } else if (dragMode === 'rotate') {
      const rotationCenter = dragCenterScreen ?? centerScreen;
      const angle = Math.atan2(point[1] - rotationCenter[1], point[0] - rotationCenter[0]);
      editor.rotateTexture(shortestAngleDelta(previousAngle, angle) * 180 / Math.PI);
      previousAngle = angle;
      dragPointerPoint = [...point];
    } else {
      const scaleCenter = dragCenterScreen ?? centerScreen;
      const radius = Math.max(1, distance(point, scaleCenter));
      editor.scaleTexture((radius - previousRadius) / Math.max(80, dragViewportScale));
      previousRadius = radius;
      dragPointerPoint = [...point];
    }
    previousPoint = point;
    scheduleDraw();
  });
  const finishDrag = (event: PointerEvent) => {
    if (!dragMode) return;
    dragMode = null;
    dragCenterScreen = null;
    dragPointerPoint = null;
    if (dragTransactionOpen) {
      editor.commitTransaction();
      dragTransactionOpen = false;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'default';
    dragCanvasBounds = null;
    scheduleDraw();
  };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);

  const thumbnail = editor.textureManager?.getThumbnailUrl(face.texture);
  if (thumbnail) {
    image = new Image();
    image.onload = () => {
      imageReady = true;
      imagePattern = null;
      scheduleDraw();
    };
    image.src = thumbnail;
  }

  close = () => {
    if (dragTransactionOpen) {
      editor.commitTransaction();
      dragTransactionOpen = false;
    }
    if (drawFrame !== null) window.cancelAnimationFrame(drawFrame);
    window.removeEventListener('resize', scheduleDraw);
    overlay.remove();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(
    button('Reset', () => { if (requireCurrentFace()) { editor.resetTextureAlignment(); scheduleDraw(); } }),
    button('Fit', () => { if (requireCurrentFace()) { editor.fitTexture(); scheduleDraw(); } }),
    button('Fit Width', () => { if (requireCurrentFace()) { editor.fitTexture('width'); scheduleDraw(); } }),
    button('Fit Height', () => { if (requireCurrentFace()) { editor.fitTexture('height'); scheduleDraw(); } }),
    button('Close', close, true),
  );
  dialog.append(title, description, body, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  window.addEventListener('resize', scheduleDraw);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      event.stopPropagation();
    }
  });
  scheduleDraw();
  canvas.focus();
}
