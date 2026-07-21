import {
  CAMERA_ACTION_KEY, CAMERA_DURATION_KEY, CAMERA_FOV_KEY, CAMERA_LOOK_TARGET_KEY,
  CAMERA_ORDER_KEY, CAMERA_PATH_KEY, CAMERA_WAIT_KEY,
  type CameraPath, type CameraPathPoint,
} from './camera-paths';
import type { Editor } from './editor';
import type { Entity } from './entity';

const CAMERA_POINT_ICON_NAMES = {
  earlier: 'arrow-up',
  later: 'arrow-down',
  expand: 'caret-right',
};

const cameraPointExpansion = new WeakMap<Entity, boolean>();

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

interface NumberFieldOptions {
  min?: number;
  max?: number;
  step?: number | 'any';
}

function field(
  container: HTMLElement,
  labelText: string,
  value: string | number,
  type: 'text' | 'number',
  update: (value: string) => void,
  options: NumberFieldOptions = {},
): void {
  const label = document.createElement('label');
  label.className = 'camera-point-field';
  const caption = document.createElement('span');
  caption.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value);
  if (type === 'number') {
    input.step = String(options.step ?? 'any');
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
  }
  input.addEventListener('change', () => update(input.value));
  label.append(caption, input);
  container.appendChild(label);
}

function iconButton(icon: string, label: string, action: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn icon-btn camera-point-icon-button';
  button.innerHTML = `<i class="ph ph-${icon}" aria-hidden="true"></i>`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  return button;
}

function compactCoordinate(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1).replace(/\.0$/, '');
}

function compactSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

export function buildCameraPointInspector(
  container: HTMLElement,
  editor: Editor,
  path: CameraPath,
  point: CameraPathPoint,
  index: number,
): void {
  const selected = editor.selection.some(item => item.entity === point.entity);
  const firstSelectedIndex = path.points.findIndex(candidate =>
    editor.selection.some(item => item.entity === candidate.entity));
  const expanded = cameraPointExpansion.get(point.entity) ?? (selected && index === firstSelectedIndex);
  if (!cameraPointExpansion.has(point.entity)) cameraPointExpansion.set(point.entity, expanded);
  const item = document.createElement('div');
  item.className = `camera-point${selected ? ' selected' : ''}${expanded ? ' open' : ''}`;
  item.dataset.selected = String(selected);

  const header = document.createElement('div');
  header.className = 'camera-point-summary';
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'camera-point-header-select';
  select.setAttribute('aria-label', `Select point ${index + 1} in map`);
  select.setAttribute('aria-pressed', String(selected));
  select.title = 'Select in map';
  const number = document.createElement('span');
  number.className = 'camera-point-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const summaryCopy = document.createElement('span');
  summaryCopy.className = 'camera-point-summary-copy';
  const name = document.createElement('strong');
  name.textContent = `Point ${index + 1}, ${compactSeconds(point.duration + point.wait)}`;
  name.title = `${point.duration}s travel${point.wait ? ` + ${point.wait}s wait` : ''}`;
  const position = document.createElement('span');
  position.textContent = point.position.map(compactCoordinate).join(', ');
  position.title = `Position: ${point.position.join(' ')}`;
  summaryCopy.append(name, position);
  select.append(number, summaryCopy);
  select.addEventListener('click', () => {
    cameraPointExpansion.set(point.entity, item.classList.contains('open'));
    editor.selectEntity(point.entity);
  });

  const actions = document.createElement('div');
  actions.className = 'camera-point-actions';
  actions.append(
    iconButton(CAMERA_POINT_ICON_NAMES.earlier, `Move point ${index + 1} earlier`, () => editor.reorderCameraPoint(point.entity, -1), index === 0),
    iconButton(CAMERA_POINT_ICON_NAMES.later, `Move point ${index + 1} later`, () => editor.reorderCameraPoint(point.entity, 1), index === path.points.length - 1),
  );

  const body = document.createElement('div');
  body.className = 'camera-point-body';
  body.hidden = !expanded;
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'btn icon-btn camera-point-expand';
  expand.innerHTML = `<i class="ph ph-${CAMERA_POINT_ICON_NAMES.expand}" aria-hidden="true"></i>`;
  expand.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} point ${index + 1} settings`);
  expand.setAttribute('aria-expanded', String(expanded));
  expand.title = expanded ? 'Collapse settings' : 'Expand settings';
  expand.addEventListener('click', () => {
    const nextExpanded = !item.classList.contains('open');
    item.classList.toggle('open', nextExpanded);
    body.hidden = !nextExpanded;
    expand.setAttribute('aria-expanded', String(nextExpanded));
    expand.setAttribute('aria-label', `${nextExpanded ? 'Collapse' : 'Expand'} point ${index + 1} settings`);
    expand.title = nextExpanded ? 'Collapse settings' : 'Expand settings';
    cameraPointExpansion.set(point.entity, nextExpanded);
  });
  header.append(select, actions, expand);
  item.appendChild(header);

  const timingFields = document.createElement('div');
  timingFields.className = 'camera-point-timing-fields';
  field(timingFields, 'Travel', point.duration, 'number', value => editor.updateCameraPoint(point.entity, { duration: Number(value) }), { min: 0.01 });
  field(timingFields, 'Wait', point.wait, 'number', value => editor.updateCameraPoint(point.entity, { wait: Number(value) }), { min: 0 });
  field(timingFields, 'FOV', point.fov, 'number', value => editor.updateCameraPoint(point.entity, { fov: Number(value) }), { min: 1, max: 179 });
  body.appendChild(timingFields);

  const advanced = document.createElement('details');
  advanced.className = 'camera-point-advanced';
  advanced.open = !!point.lookTarget || !!point.action;
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Target & action';
  advanced.appendChild(advancedSummary);
  field(advanced, 'Look target', point.lookTarget, 'text', value => editor.updateCameraPoint(point.entity, { lookTarget: value }));
  field(advanced, 'Action', point.action, 'text', value => editor.updateCameraPoint(point.entity, { action: value }));
  if (path.invalidReferences.some(reference => reference.endsWith(` -> ${point.lookTarget}`))) {
    const invalid = document.createElement('div');
    invalid.className = 'camera-point-warning';
    invalid.innerHTML = '<i class="ph ph-warning" aria-hidden="true"></i>';
    const warningText = document.createElement('span');
    warningText.textContent = `Missing target “${point.lookTarget}”`;
    invalid.appendChild(warningText);
    advanced.appendChild(invalid);
  }
  body.appendChild(advanced);
  item.appendChild(body);
  container.appendChild(item);
}
