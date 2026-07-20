import { buildCameraPointInspector } from './camera-inspector';
import { cameraPathDuration } from './camera-paths';
import type { Editor } from './editor';

function actionButton(label: string, action: () => void): HTMLElement {
  const button = document.createElement('div'); button.className = 'btn'; button.textContent = label;
  button.addEventListener('mousedown', action); return button;
}

export function buildCameraPanel(container: HTMLElement, editor: Editor): void {
  container.innerHTML = '';
  const creation = document.createElement('div'); creation.className = 'terrain-tools';
  const firstRow = document.createElement('div'); firstRow.className = 'kv-row';
  firstRow.append(
    actionButton('From Selection', () => { const name = globalThis.prompt?.('Camera path name', 'Camera Path'); if (name) editor.createCameraPathFromSelection(name); }),
    actionButton('From View', () => { const name = globalThis.prompt?.('Camera path name', 'Camera Path'); if (name) editor.createCameraPathFromCurrentCamera(name); }),
  );
  const secondRow = document.createElement('div'); secondRow.className = 'kv-row';
  secondRow.append(
    actionButton('Smart Path', () => editor.createSmartPath()),
    actionButton('Train Path', () => editor.createSmartTrainPath()),
  );
  creation.append(firstRow, secondRow); container.appendChild(creation);

  const paths = editor.cameraPaths();
  if (paths.length === 0) {
    const empty = document.createElement('label'); empty.textContent = 'No camera paths'; empty.style.color = '#666'; container.appendChild(empty); return;
  }
  for (const path of paths) {
    const section = document.createElement('div'); section.className = 'terrain-tools';
    const title = document.createElement('label'); title.style.fontWeight = 'bold'; title.textContent = `${path.name} (${path.points.length} points)`; section.appendChild(title);
    const pathActions = document.createElement('div'); pathActions.className = 'kv-row';
    const playing = editor.cameraPlayback?.pathId === path.id && editor.cameraPlayback.playing;
    pathActions.append(
      actionButton(playing ? 'Stop' : 'Play', () => playing ? editor.stopCameraPlayback() : editor.startCameraPlayback(path.id)),
      actionButton(path.closed ? 'Open Path' : 'Close Path', () => editor.setCameraPathClosed(path.id, !path.closed)),
    );
    section.appendChild(pathActions);
    const duration = cameraPathDuration(path);
    const timeline = document.createElement('input'); timeline.type = 'range'; timeline.className = 'panel-slider camera-path-timeline';
    timeline.min = '0'; timeline.max = String(Math.max(0.01, duration)); timeline.step = '0.01';
    timeline.dataset.cameraPathId = path.id;
    timeline.value = String(editor.cameraPlayback?.pathId === path.id ? editor.cameraPlayback.elapsed : 0);
    timeline.setAttribute('aria-label', `${path.name} timeline`);
    timeline.title = `Timeline: ${timeline.value}s / ${duration.toFixed(2)}s`;
    const endScrubbing = () => { delete timeline.dataset.scrubbing; };
    timeline.addEventListener('pointerdown', () => { timeline.dataset.scrubbing = 'true'; });
    timeline.addEventListener('pointerup', endScrubbing);
    timeline.addEventListener('pointercancel', endScrubbing);
    timeline.addEventListener('change', endScrubbing);
    timeline.addEventListener('blur', endScrubbing);
    timeline.addEventListener('input', () => {
      if (editor.cameraPlayback?.pathId !== path.id) editor.startCameraPlayback(path.id);
      const pose = editor.seekCameraPlayback(Number(timeline.value));
      if (pose) editor.camera3d = { position: [...pose.position], yaw: pose.yaw, pitch: pose.pitch };
      timeline.title = `Timeline: ${timeline.value}s / ${duration.toFixed(2)}s`;
    });
    section.appendChild(timeline);
    for (let index = 0; index < path.points.length; index++) buildCameraPointInspector(section, editor, path, path.points[index], index);
    container.appendChild(section);
  }
}
