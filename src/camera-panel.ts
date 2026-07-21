import { buildCameraPointInspector } from './camera-inspector';
import { cameraPathDuration } from './camera-paths';
import type { Editor } from './editor';
import { entityOrigin } from './entity';

const CAMERA_PANEL_ICON_NAMES = {
  selection: 'selection-plus',
  view: 'camera-plus',
  play: 'play',
  pause: 'pause',
  loop: 'repeat',
};

function actionButton(label: string, icon: string, action: () => void, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn camera-action ${className}`.trim();
  button.innerHTML = `<i class="ph ph-${icon}" aria-hidden="true"></i><span>${label}</span>`;
  button.addEventListener('click', action);
  return button;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 10 && !Number.isInteger(seconds)) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function promptForPathName(editor: Editor, fromSelection: boolean): void {
  const name = globalThis.prompt?.('Camera path name', 'Camera Path');
  if (!name) return;
  if (fromSelection) editor.createCameraPathFromSelection(name);
  else editor.createCameraPathFromCurrentCamera(name);
}

export function buildCameraPanel(container: HTMLElement, editor: Editor): void {
  container.innerHTML = '';
  container.classList.add('camera-paths-panel');

  const selectedPointCount = new Set(editor.selection
    .map(item => item.entity)
    .filter(entity => entity !== editor.worldspawn && entityOrigin(entity))).size;

  const creation = document.createElement('section');
  creation.className = 'camera-create';
  const creationHeading = document.createElement('div');
  creationHeading.className = 'camera-section-heading';
  creationHeading.textContent = 'Create new';
  const creationActions = document.createElement('div');
  creationActions.className = 'camera-create-actions';
  const selectionButton = actionButton('Selected points', CAMERA_PANEL_ICON_NAMES.selection, () => promptForPathName(editor, true));
  selectionButton.disabled = selectedPointCount < 2;
  selectionButton.title = selectedPointCount < 2
    ? 'Select at least two point entities first'
    : `Create a path from ${pluralize(selectedPointCount, 'selected point')}, in selection order`;
  const viewButton = actionButton('3D view', CAMERA_PANEL_ICON_NAMES.view, () => promptForPathName(editor, false));
  viewButton.title = 'Create three points starting at the current 3D camera';
  creationActions.append(selectionButton, viewButton);
  const creationHint = document.createElement('p');
  creationHint.className = 'camera-help';
  creationHint.textContent = selectedPointCount < 2
    ? 'Select 2+ point entities, or start from the current camera.'
    : `${pluralize(selectedPointCount, 'selected point')} will be used in selection order.`;
  creation.append(creationHeading, creationActions, creationHint);
  container.appendChild(creation);

  const paths = editor.cameraPaths();
  if (paths.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'camera-empty';
    empty.innerHTML = '<i class="ph ph-path" aria-hidden="true"></i><span>No camera paths yet</span>';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'camera-path-list';
  for (const path of paths) {
    const duration = cameraPathDuration(path);
    const selected = path.points.some(point => editor.selection.some(item => item.entity === point.entity));
    const active = editor.cameraPlayback?.pathId === path.id;
    const playing = active && !!editor.cameraPlayback?.playing;

    const section = document.createElement('details');
    section.className = 'camera-path-card';
    section.open = paths.length === 1 || selected || active;

    const summary = document.createElement('summary');
    summary.className = 'camera-path-summary';
    const summaryCopy = document.createElement('span');
    summaryCopy.className = 'camera-path-summary-copy';
    const title = document.createElement('strong');
    title.className = 'camera-path-name';
    title.textContent = path.name;
    title.title = `Path ID: ${path.id}`;
    const meta = document.createElement('span');
    meta.className = 'camera-path-meta';
    meta.textContent = `${pluralize(path.points.length, 'point')} · ${formatDuration(duration)} · ${path.closed ? 'Loop' : 'One-way'}`;
    summaryCopy.append(title, meta);
    summary.appendChild(summaryCopy);
    section.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'camera-path-content';
    const controls = document.createElement('div');
    controls.className = 'camera-path-controls';
    const playback = document.createElement('button');
    playback.type = 'button';
    playback.className = 'btn icon-btn camera-transport-button camera-playback-toggle';
    playback.innerHTML = `<i class="ph ph-${playing ? CAMERA_PANEL_ICON_NAMES.pause : CAMERA_PANEL_ICON_NAMES.play}" aria-hidden="true"></i>`;
    playback.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${path.name}`);
    playback.title = playing ? 'Pause preview' : active ? 'Resume preview' : 'Play preview';
    playback.disabled = path.points.length < 2;
    playback.addEventListener('click', () => editor.toggleCameraPlayback(path.id));
    const loop = document.createElement('button');
    loop.type = 'button';
    loop.className = `btn icon-btn camera-transport-button camera-loop-toggle${path.closed ? ' active' : ''}`;
    loop.innerHTML = `<i class="ph ph-${CAMERA_PANEL_ICON_NAMES.loop}" aria-hidden="true"></i>`;
    loop.setAttribute('aria-label', `Loop ${path.name}`);
    loop.setAttribute('aria-pressed', String(path.closed));
    loop.title = path.closed ? 'Loop enabled — make path one-way' : 'Loop path';
    loop.addEventListener('click', () => editor.setCameraPathClosed(path.id, !path.closed));

    const timeline = document.createElement('input');
    timeline.type = 'range';
    timeline.className = 'panel-slider camera-path-timeline';
    timeline.min = '0';
    timeline.max = String(Math.max(0.01, duration));
    timeline.step = '0.01';
    timeline.dataset.cameraPathId = path.id;
    timeline.value = String(active ? editor.cameraPlayback?.elapsed ?? 0 : 0);
    timeline.setAttribute('aria-label', `${path.name} timeline`);
    timeline.title = `Timeline: ${timeline.value}s / ${duration.toFixed(2)}s`;
    timeline.disabled = path.points.length < 2;
    const endScrubbing = () => { delete timeline.dataset.scrubbing; };
    timeline.addEventListener('pointerdown', () => { timeline.dataset.scrubbing = 'true'; });
    timeline.addEventListener('pointerup', endScrubbing);
    timeline.addEventListener('pointercancel', endScrubbing);
    timeline.addEventListener('change', endScrubbing);
    timeline.addEventListener('blur', endScrubbing);
    timeline.addEventListener('input', () => {
      if (editor.cameraPlayback?.pathId !== path.id) editor.startCameraPlayback(path.id);
      editor.seekCameraPlayback(Number(timeline.value));
      timeline.title = `Timeline: ${timeline.value}s / ${duration.toFixed(2)}s`;
    });
    controls.append(timeline, playback, loop);
    content.appendChild(controls);

    const pointsHeading = document.createElement('div');
    pointsHeading.className = 'camera-section-heading camera-points-heading';
    pointsHeading.textContent = 'Waypoints';
    content.appendChild(pointsHeading);
    for (let index = 0; index < path.points.length; index++) {
      buildCameraPointInspector(content, editor, path, path.points[index], index);
    }
    section.appendChild(content);
    list.appendChild(section);
  }
  container.appendChild(list);
}
