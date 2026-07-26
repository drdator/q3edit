import type { Editor } from './editor';
import type { BrushFace } from './brush';
import {
  faceUvPolygon,
  fitUvViewport,
  screenToUv,
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

function eventPoint(event: PointerEvent, canvas: HTMLCanvasElement): [number, number] {
  const bounds = canvas.getBoundingClientRect();
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

  const drawBackdrop = (context: CanvasRenderingContext2D) => {
    context.fillStyle = '#151515';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const topLeft = screenToUv(0, 0, viewport);
    const bottomRight = screenToUv(canvas.width, canvas.height, viewport);
    const firstU = Math.floor(Math.min(topLeft.u, bottomRight.u)) - 1;
    const lastU = Math.ceil(Math.max(topLeft.u, bottomRight.u)) + 1;
    const firstV = Math.floor(Math.min(topLeft.v, bottomRight.v)) - 1;
    const lastV = Math.ceil(Math.max(topLeft.v, bottomRight.v)) + 1;
    for (let v = firstV; v < lastV; v++) {
      for (let u = firstU; u < lastU; u++) {
        const [x, y] = uvToScreen({ u, v }, viewport);
        if (image && imageReady) {
          context.drawImage(image, x, y, viewport.scale, viewport.scale);
        } else {
          context.fillStyle = ((u + v) & 1) === 0 ? '#292929' : '#202020';
          context.fillRect(x, y, viewport.scale, viewport.scale);
        }
      }
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
    rotateHandle = [centerScreen[0], topY - 44];
    scaleHandle = [rightX + 24, centerScreen[1]];
    drawBackdrop(context);

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
    context.beginPath(); context.moveTo(centerScreen[0], centerScreen[1]); context.lineTo(rotateHandle[0], rotateHandle[1]); context.stroke();
    context.beginPath(); context.moveTo(centerScreen[0], centerScreen[1]); context.lineTo(scaleHandle[0], scaleHandle[1]); context.stroke();
    context.fillStyle = '#e8a030';
    context.beginPath(); context.arc(centerScreen[0], centerScreen[1], 11, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#151515';
    context.beginPath(); context.arc(centerScreen[0], centerScreen[1], 4, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#67b7d1';
    context.beginPath(); context.arc(rotateHandle[0], rotateHandle[1], 10, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#78c46b';
    context.fillRect(scaleHandle[0] - 9, scaleHandle[1] - 9, 18, 18);
    status.textContent = `${face.texture} · ${textureWidth}×${textureHeight} · ${projectionSummary(face)}`;
  };

  const updateCursor = (point: [number, number]) => {
    if (dragMode) return;
    if (distance(point, rotateHandle) <= 18) canvas.style.cursor = 'crosshair';
    else if (distance(point, scaleHandle) <= 18) canvas.style.cursor = 'nwse-resize';
    else if (distance(point, centerScreen) <= 22) canvas.style.cursor = 'move';
    else canvas.style.cursor = 'default';
  };

  canvas.addEventListener('pointerdown', event => {
    const point = eventPoint(event, canvas);
    if (distance(point, rotateHandle) <= 22) dragMode = 'rotate';
    else if (distance(point, scaleHandle) <= 22) dragMode = 'scale';
    else if (distance(point, centerScreen) <= 28) dragMode = 'translate';
    else return;
    previousPoint = point;
    previousAngle = Math.atan2(point[1] - centerScreen[1], point[0] - centerScreen[0]);
    previousRadius = Math.max(1, distance(point, centerScreen));
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    const point = eventPoint(event, canvas);
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
      const angle = Math.atan2(point[1] - centerScreen[1], point[0] - centerScreen[0]);
      let delta = (angle - previousAngle) * 180 / Math.PI;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      editor.rotateTexture(delta);
      previousAngle = angle;
    } else {
      const radius = Math.max(1, distance(point, centerScreen));
      editor.scaleTexture((radius - previousRadius) / Math.max(80, viewport.scale));
      previousRadius = radius;
    }
    previousPoint = point;
    draw();
  });
  const finishDrag = (event: PointerEvent) => {
    if (!dragMode) return;
    dragMode = null;
    editor.history.breakCoalescing();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateCursor(eventPoint(event, canvas));
  };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);

  const thumbnail = editor.textureManager?.getThumbnailUrl(face.texture);
  if (thumbnail) {
    image = new Image();
    image.onload = () => { imageReady = true; draw(); };
    image.src = thumbnail;
  }

  const close = () => {
    window.removeEventListener('resize', draw);
    overlay.remove();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(
    button('Reset', () => { editor.resetTextureAlignment(); draw(); }),
    button('Fit', () => { editor.fitTexture(); draw(); }),
    button('Fit Width', () => { editor.fitTexture('width'); draw(); }),
    button('Fit Height', () => { editor.fitTexture('height'); draw(); }),
    button('Close', close, true),
  );
  dialog.append(title, description, body, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  window.addEventListener('resize', draw);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      event.stopPropagation();
    }
  });
  requestAnimationFrame(() => {
    draw();
    canvas.focus();
  });
}
