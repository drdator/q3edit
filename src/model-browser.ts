import type { Editor } from './editor';
import type { Md3Model } from './md3';

export interface PreviewLine { from: [number, number]; to: [number, number] }

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

export function openModelBrowser(editor: Editor, current: string, onSelect: (path: string) => void): void {
  document.getElementById('model-browser-dialog')?.remove();
  const manager = editor.modelManager;
  if (!manager) return;
  const overlay = document.createElement('div');
  overlay.id = 'model-browser-dialog';
  overlay.className = 'editor-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog model-browser';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title'; title.textContent = 'Choose Model';
  const search = document.createElement('input');
  search.type = 'search'; search.placeholder = 'Search models...';
  const list = document.createElement('select');
  list.size = 14;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240; canvas.className = 'model-browser-preview';
  let selected = current;
  const draw = () => {
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#151515'; context.fillRect(0, 0, canvas.width, canvas.height);
    const model = manager.get(selected);
    if (!model) { context.fillStyle = '#888'; context.fillText('No preview available', 12, 24); return; }
    context.strokeStyle = '#57b9d8'; context.beginPath();
    for (const line of projectModelPreview(model, canvas.width, canvas.height)) {
      context.moveTo(...line.from); context.lineTo(...line.to);
    }
    context.stroke();
  };
  const populate = () => {
    list.innerHTML = '';
    const query = search.value.trim().toLowerCase();
    for (const path of manager.listModels().filter(path => !query || path.includes(query))) {
      const option = new Option(path, path); option.selected = path === selected; list.appendChild(option);
    }
    if (!list.value && list.options.length) list.selectedIndex = 0;
    selected = list.value || selected; draw();
  };
  search.addEventListener('input', populate);
  list.addEventListener('change', () => { selected = list.value; draw(); });
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const use = document.createElement('button'); use.type = 'button'; use.className = 'btn primary'; use.textContent = 'Use Model';
  const close = () => overlay.remove();
  cancel.onclick = close;
  use.onclick = () => { if (selected) onSelect(selected); close(); };
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions'; actions.append(cancel, use);
  dialog.append(title, search, list, canvas, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  populate(); search.focus();
}
