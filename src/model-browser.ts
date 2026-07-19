import type { Editor } from './editor';
import type { Md3Model } from './md3';
import { ModelPreviewRenderer } from './model-preview-renderer';

export interface PreviewLine { from: [number, number]; to: [number, number] }

export function filterModelPaths(paths: readonly string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  return paths.filter(path => !normalized || path.toLowerCase().includes(normalized));
}

export function projectModelPreview(model: Md3Model, width: number, height: number): PreviewLine[] {
  const frame = model.frames[0];
  if (!frame) return [];
  const center = frame.mins.map((value, axis) => (value + frame.maxs[axis]) / 2);
  const extent = Math.max(...frame.maxs.map((value, axis) => value - frame.mins[axis]), 1);
  const scale = Math.min(width, height) * 0.72 / extent;
  const project = (point: [number, number, number]): [number, number] => {
    const x = point[0] - center[0]; const y = point[1] - center[1]; const z = point[2] - center[2];
    return [width / 2 + (x - y) * scale * 0.7, height / 2 - (z + (x + y) * 0.35) * scale];
  };
  const lines: PreviewLine[] = [];
  for (const surface of model.surfaces) {
    const vertices = surface.frames[0] ?? [];
    for (const triangle of surface.triangles) {
      for (let edge = 0; edge < 3; edge++) {
        const from = vertices[triangle[edge]]?.position;
        const to = vertices[triangle[(edge + 1) % 3]]?.position;
        if (from && to) lines.push({ from: project(from), to: project(to) });
      }
    }
  }
  return lines;
}

export function openModelBrowser(
  editor: Editor,
  current: string,
  onSelect: (path: string) => void,
  skinPath?: string,
): void {
  document.getElementById('model-browser-dialog')?.remove();
  const manager = editor.modelManager;
  if (!manager) return;
  const overlay = document.createElement('div');
  overlay.id = 'model-browser-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'model-browser-title');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog model-browser';
  const title = document.createElement('div');
  title.id = 'model-browser-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Choose Model';

  const content = document.createElement('div');
  content.className = 'model-browser-content';
  const resultsPane = document.createElement('div');
  resultsPane.className = 'model-browser-results';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'model-browser-search';
  search.placeholder = 'Search models…';
  search.setAttribute('aria-label', 'Search models');
  search.autocomplete = 'off';
  search.spellcheck = false;
  const resultCount = document.createElement('div');
  resultCount.className = 'model-browser-result-count';
  resultCount.setAttribute('aria-live', 'polite');
  const list = document.createElement('select');
  list.className = 'model-browser-list';
  list.setAttribute('aria-label', 'Models');
  list.size = 18;
  resultsPane.append(search, resultCount, list);

  const previewPane = document.createElement('div');
  previewPane.className = 'model-browser-preview-pane';
  const previewHeader = document.createElement('div');
  previewHeader.className = 'model-browser-preview-header';
  const previewLabel = document.createElement('span');
  previewLabel.className = 'model-browser-preview-label';
  previewLabel.textContent = 'Preview';
  const previewPath = document.createElement('span');
  previewPath.className = 'model-browser-preview-path';
  const previewStats = document.createElement('span');
  previewStats.className = 'model-browser-preview-stats';
  previewHeader.append(previewLabel, previewPath, previewStats);
  const previewFrame = document.createElement('div');
  previewFrame.className = 'model-browser-preview-frame';
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  canvas.className = 'model-browser-preview';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Selected textured model preview; drag to rotate');
  const previewEmpty = document.createElement('div');
  previewEmpty.className = 'model-browser-preview-empty';
  const previewHint = document.createElement('div');
  previewHint.className = 'model-browser-preview-hint';
  previewHint.textContent = 'Drag to rotate · Wheel to zoom · Double-click to reset';
  previewFrame.append(canvas, previewEmpty, previewHint);
  previewPane.append(previewHeader, previewFrame);
  content.append(resultsPane, previewPane);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'btn primary';
  use.textContent = 'Use Model';
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(cancel, use);

  let previewRenderer: ModelPreviewRenderer | null = null;
  try {
    previewRenderer = new ModelPreviewRenderer(canvas, editor.textureManager);
  } catch { /* retain the 2D wireframe fallback below */ }
  const allModels = manager.listModels();
  let selected = current;
  const draw = () => {
    previewPath.textContent = selected || 'No model selected';
    previewPath.title = selected;
    const resolved = selected ? manager.resolve(selected, 0, skinPath) : null;
    const model = resolved?.model ?? null;
    if (previewRenderer) previewRenderer.setModel(resolved);
    previewEmpty.hidden = Boolean(model);
    previewEmpty.textContent = selected ? 'No preview available' : 'No matching models';
    if (!model) {
      previewStats.textContent = '';
      if (!previewRenderer) drawWireframeFallback(canvas, null, selected ? 'No preview available' : 'No matching models');
      return;
    }
    const triangleCount = model.surfaces.reduce((sum, surface) => sum + surface.triangles.length, 0);
    const surfaceTextures = resolved
      ? [...new Set(model.surfaces.map(surface =>
        resolved.surfaceTextures.get(surface.name.toLowerCase()) ?? surface.shaders[0] ?? '').filter(Boolean))]
      : [];
    const missingTextures = editor.textureManager
      ? surfaceTextures.filter(texture => !editor.textureManager!.findImageFile(texture)).length
      : 0;
    const missingLabel = missingTextures > 0 ? ` · ${missingTextures} texture${missingTextures === 1 ? '' : 's'} missing` : '';
    previewStats.textContent = `${model.surfaces.length} surface${model.surfaces.length === 1 ? '' : 's'} · ${triangleCount} triangle${triangleCount === 1 ? '' : 's'}${missingLabel}`;
    if (!previewRenderer) drawWireframeFallback(canvas, model);
  };
  const populate = () => {
    list.innerHTML = '';
    const matches = filterModelPaths(allModels, search.value);
    for (const path of matches) {
      const option = new Option(path, path);
      list.appendChild(option);
    }
    selected = matches.includes(selected) ? selected : matches[0] ?? '';
    list.value = selected;
    list.disabled = matches.length === 0;
    use.disabled = !selected;
    resultCount.textContent = `${matches.length} of ${allModels.length} models`;
    draw();
  };
  search.addEventListener('input', populate);
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !list.disabled) {
      list.focus();
      event.preventDefault();
    } else if (event.key === 'Enter' && selected) {
      use.click();
      event.preventDefault();
    }
  });
  list.addEventListener('change', () => { selected = list.value; use.disabled = !selected; draw(); });
  list.addEventListener('dblclick', () => use.click());
  list.addEventListener('keydown', event => {
    if (event.key === 'Enter' && selected) { use.click(); event.preventDefault(); }
  });
  let draggingPointer: number | null = null;
  let previousPointer: [number, number] = [0, 0];
  canvas.addEventListener('pointerdown', event => {
    if (!previewRenderer || event.button !== 0) return;
    draggingPointer = event.pointerId;
    previousPointer = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!previewRenderer || draggingPointer !== event.pointerId) return;
    previewRenderer.rotate(event.clientX - previousPointer[0], event.clientY - previousPointer[1]);
    previousPointer = [event.clientX, event.clientY];
  });
  const finishDrag = (event: PointerEvent) => {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('wheel', event => {
    if (!previewRenderer) return;
    previewRenderer.zoomBy(event.deltaY);
    event.preventDefault();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => previewRenderer?.resetView());
  const resizeObserver = previewRenderer ? new ResizeObserver(() => previewRenderer?.render()) : null;
  resizeObserver?.observe(previewFrame);
  const close = () => {
    resizeObserver?.disconnect();
    previewRenderer?.dispose();
    overlay.remove();
  };
  cancel.onclick = close;
  use.onclick = () => { if (selected) onSelect(selected); close(); };
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); event.stopPropagation(); }
  });
  dialog.append(title, content, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  populate();
  search.focus();
}

function drawWireframeFallback(canvas: HTMLCanvasElement, model: Md3Model | null, message = ''): void {
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#151515';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!model) {
    context.fillStyle = '#888';
    context.font = '20px monospace';
    context.textAlign = 'center';
    context.fillText(message, canvas.width / 2, canvas.height / 2);
    return;
  }
  context.strokeStyle = '#57b9d8';
  context.lineWidth = 1.5;
  context.beginPath();
  for (const line of projectModelPreview(model, canvas.width, canvas.height)) {
    context.moveTo(...line.from); context.lineTo(...line.to);
  }
  context.stroke();
}
