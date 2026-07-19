import {
  CAMERA_ACTION_KEY, CAMERA_DURATION_KEY, CAMERA_FOV_KEY, CAMERA_LOOK_TARGET_KEY,
  CAMERA_ORDER_KEY, CAMERA_PATH_KEY, CAMERA_WAIT_KEY,
  type CameraPath, type CameraPathPoint,
} from './camera-paths';
import type { Editor } from './editor';
import type { Entity } from './entity';

export interface CameraPointInspectorModel {
  pathId: string;
  order: number;
  duration: number;
  wait: number;
  lookTarget: string;
  action: string;
  fov: number;
}

export function inspectCameraPoint(entity: Entity): CameraPointInspectorModel | null {
  const pathId = entity.properties[CAMERA_PATH_KEY]; if (!pathId) return null;
  return {
    pathId,
    order: Number(entity.properties[CAMERA_ORDER_KEY] ?? 0),
    duration: Number(entity.properties[CAMERA_DURATION_KEY] ?? 2),
    wait: Number(entity.properties[CAMERA_WAIT_KEY] ?? 0),
    lookTarget: entity.properties[CAMERA_LOOK_TARGET_KEY] ?? '',
    action: entity.properties[CAMERA_ACTION_KEY] ?? '',
    fov: Number(entity.properties[CAMERA_FOV_KEY] ?? 90),
  };
}

function field(container: HTMLElement, labelText: string, value: string | number, type: 'text' | 'number', update: (value: string) => void): void {
  const label = document.createElement('label'); label.textContent = labelText; label.style.fontSize = '11px';
  const input = document.createElement('input'); input.type = type; input.value = String(value); if (type === 'number') input.step = 'any';
  input.addEventListener('change', () => update(input.value)); container.append(label, input);
}

export function buildCameraPointInspector(
  container: HTMLElement,
  editor: Editor,
  path: CameraPath,
  point: CameraPathPoint,
  index: number,
): void {
  const details = document.createElement('details');
  details.open = editor.selection.some(item => item.entity === point.entity);
  const summary = document.createElement('summary');
  summary.textContent = `${index + 1}. ${point.position.join(' ')} · ${point.duration}s + ${point.wait}s wait`;
  details.appendChild(summary);
  const actions = document.createElement('div'); actions.className = 'kv-row';
  for (const [label, action] of [
    ['Select', () => editor.selectEntity(point.entity)],
    ['Up', () => editor.reorderCameraPoint(point.entity, -1)],
    ['Down', () => editor.reorderCameraPoint(point.entity, 1)],
  ] as const) {
    const button = document.createElement('div'); button.className = 'btn'; button.textContent = label; button.addEventListener('mousedown', action); actions.appendChild(button);
  }
  details.appendChild(actions);
  field(details, 'Travel duration', point.duration, 'number', value => editor.updateCameraPoint(point.entity, { duration: Number(value) }));
  field(details, 'Wait', point.wait, 'number', value => editor.updateCameraPoint(point.entity, { wait: Number(value) }));
  field(details, 'FOV', point.fov, 'number', value => editor.updateCameraPoint(point.entity, { fov: Number(value) }));
  field(details, 'Look targetname', point.lookTarget, 'text', value => editor.updateCameraPoint(point.entity, { lookTarget: value }));
  field(details, 'Action', point.action, 'text', value => editor.updateCameraPoint(point.entity, { action: value }));
  if (path.invalidReferences.some(reference => reference.endsWith(` -> ${point.lookTarget}`))) {
    const invalid = document.createElement('label'); invalid.style.color = '#f80'; invalid.textContent = `Missing look target: ${point.lookTarget}`; details.appendChild(invalid);
  }
  container.appendChild(details);
}
