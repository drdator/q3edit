import type { Editor, SelectionItem } from './editor';
import { createEntity, entityOrigin, type Entity } from './entity';
import { getViewport3DForward } from './viewport3d-navigation';
import { vec3Length, vec3Sub, type Vec3 } from './math';

export const CAMERA_PATH_KEY = '_q3edit_camera_path';
export const CAMERA_ORDER_KEY = '_q3edit_camera_order';
export const CAMERA_DURATION_KEY = '_q3edit_camera_duration';
export const CAMERA_WAIT_KEY = '_q3edit_camera_wait';
export const CAMERA_LOOK_TARGET_KEY = '_q3edit_camera_look_target';
export const CAMERA_ACTION_KEY = '_q3edit_camera_action';
export const CAMERA_FOV_KEY = '_q3edit_camera_fov';
export const CAMERA_CLOSED_KEY = '_q3edit_camera_closed';
export const CAMERA_NAME_KEY = '_q3edit_camera_name';
export const CAMERA_SERIALIZATION_DECISION = 'q3edit-entity-properties-extension' as const;

export interface CameraPathPoint {
  entity: Entity;
  position: Vec3;
  order: number;
  duration: number;
  wait: number;
  lookTarget: string;
  lookPosition: Vec3 | null;
  action: string;
  fov: number;
}

export interface CameraPath {
  id: string;
  name: string;
  closed: boolean;
  points: CameraPathPoint[];
  invalidReferences: string[];
}

export interface CameraPose {
  position: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  action: string;
  elapsed: number;
  totalDuration: number;
}

export interface CameraPlaybackState {
  pathId: string;
  elapsed: number;
  playing: boolean;
}

export interface CameraPointChanges {
  duration?: number;
  wait?: number;
  lookTarget?: string;
  action?: string;
  fov?: number;
}

function finiteNumber(value: string | undefined, fallback: number, minimum = -Infinity, maximum = Infinity): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function selectedEntitiesInOrder(editor: Editor): Entity[] {
  const entities: Entity[] = []; const seen = new Set<Entity>();
  for (const item of editor.selection) {
    if (item.entity === editor.worldspawn || seen.has(item.entity)) continue;
    seen.add(item.entity); entities.push(item.entity);
  }
  return entities;
}

function nextCameraPathId(editor: Editor): string {
  const used = new Set(collectCameraPaths(editor).map(path => path.id));
  let index = 1; while (used.has(`camera-${index}`)) index++;
  return `camera-${index}`;
}

export function isCameraPathPoint(entity: Entity): boolean {
  return !!entity.properties[CAMERA_PATH_KEY]?.trim();
}

export function collectCameraPaths(editor: Editor): CameraPath[] {
  const targetPositions = new Map<string, Vec3>();
  for (const entity of editor.nonWorldspawnEntities()) {
    const name = entity.properties.targetname?.trim(); const origin = entityOrigin(entity);
    if (name && origin && !targetPositions.has(name)) targetPositions.set(name, origin);
  }
  const groups = new Map<string, Entity[]>();
  for (const entity of editor.nonWorldspawnEntities()) {
    const id = entity.properties[CAMERA_PATH_KEY]?.trim();
    if (!id) continue;
    const points = groups.get(id) ?? []; points.push(entity); groups.set(id, points);
  }
  const paths: CameraPath[] = [];
  for (const [id, entities] of groups) {
    const invalidReferences: string[] = [];
    const points = entities.map((entity, sourceIndex): (CameraPathPoint & { sourceIndex: number }) | null => {
      const position = entityOrigin(entity); if (!position) return null;
      const lookTarget = entity.properties[CAMERA_LOOK_TARGET_KEY]?.trim() ?? '';
      const lookPosition = lookTarget ? targetPositions.get(lookTarget) ?? null : null;
      if (lookTarget && !lookPosition) invalidReferences.push(`${entity.properties.targetname ?? `point ${sourceIndex + 1}`} -> ${lookTarget}`);
      return {
        entity, position, sourceIndex,
        order: Math.max(0, Math.round(finiteNumber(entity.properties[CAMERA_ORDER_KEY], sourceIndex))),
        duration: finiteNumber(entity.properties[CAMERA_DURATION_KEY], 2, 0.01, 3600),
        wait: finiteNumber(entity.properties[CAMERA_WAIT_KEY], 0, 0, 3600),
        lookTarget, lookPosition,
        action: entity.properties[CAMERA_ACTION_KEY] ?? '',
        fov: finiteNumber(entity.properties[CAMERA_FOV_KEY], 90, 1, 179),
      };
    }).filter((point): point is CameraPathPoint & { sourceIndex: number } => point !== null)
      .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex)
      .map(({ sourceIndex: _sourceIndex, ...point }) => point);
    if (points.length === 0) continue;
    paths.push({
      id,
      name: entities[0].properties[CAMERA_NAME_KEY]?.trim() || id,
      closed: entities.some(entity => entity.properties[CAMERA_CLOSED_KEY] === '1'),
      points,
      invalidReferences,
    });
  }
  return paths.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function setCameraPointMetadata(entity: Entity, id: string, name: string, order: number, closed: boolean): void {
  entity.properties[CAMERA_PATH_KEY] = id;
  entity.properties[CAMERA_NAME_KEY] = name;
  entity.properties[CAMERA_ORDER_KEY] = String(order);
  entity.properties[CAMERA_DURATION_KEY] ??= '2';
  entity.properties[CAMERA_WAIT_KEY] ??= '0';
  entity.properties[CAMERA_FOV_KEY] ??= '90';
  if (closed) entity.properties[CAMERA_CLOSED_KEY] = '1'; else delete entity.properties[CAMERA_CLOSED_KEY];
}

export function createCameraPathFromSelection(editor: Editor, name = 'Camera Path', closed = false): CameraPath | null {
  const entities = selectedEntitiesInOrder(editor).filter(entity => entityOrigin(entity));
  if (entities.length < 2) { editor.statusMessage = 'Select at least two point entities for a camera path'; return null; }
  const id = nextCameraPathId(editor);
  editor.transact('Create camera path', () => {
    entities.forEach((entity, index) => setCameraPointMetadata(entity, id, name.trim() || id, index, closed));
    editor.redrawRequested = true; editor.statusMessage = `Created ${closed ? 'closed ' : ''}camera path ${name}`;
  });
  return collectCameraPaths(editor).find(path => path.id === id) ?? null;
}

export function createCameraPathFromCurrentCamera(editor: Editor, name = 'Camera Path'): CameraPath {
  const id = nextCameraPathId(editor); const forward = getViewport3DForward(editor.camera3d.yaw, editor.camera3d.pitch);
  const points: Entity[] = [];
  editor.transact('Create camera path points', () => {
    for (let index = 0; index < 3; index++) {
      const distance = index * 128;
      const origin: Vec3 = [
        editor.camera3d.position[0] + forward[0] * distance,
        editor.camera3d.position[1] + forward[1] * distance,
        editor.camera3d.position[2] + forward[2] * distance,
      ];
      const entity = createEntity('info_null', origin);
      setCameraPointMetadata(entity, id, name.trim() || id, index, false);
      editor.entities.push(entity); points.push(entity);
    }
    editor.selection = points.map(entity => ({ type: 'entity' as const, entity }));
    editor.redrawRequested = true; editor.statusMessage = `Created camera path ${name}`;
  });
  return collectCameraPaths(editor).find(path => path.id === id)!;
}

export function updateCameraPoint(editor: Editor, entity: Entity, changes: CameraPointChanges): void {
  if (!isCameraPathPoint(entity)) return;
  editor.transact('Edit camera point', () => {
    if (changes.duration !== undefined && Number.isFinite(changes.duration)) entity.properties[CAMERA_DURATION_KEY] = String(Math.max(0.01, changes.duration));
    if (changes.wait !== undefined && Number.isFinite(changes.wait)) entity.properties[CAMERA_WAIT_KEY] = String(Math.max(0, changes.wait));
    if (changes.fov !== undefined && Number.isFinite(changes.fov)) entity.properties[CAMERA_FOV_KEY] = String(Math.max(1, Math.min(179, changes.fov)));
    if (changes.lookTarget !== undefined) entity.properties[CAMERA_LOOK_TARGET_KEY] = changes.lookTarget.trim();
    if (changes.action !== undefined) entity.properties[CAMERA_ACTION_KEY] = changes.action;
    editor.redrawRequested = true; editor.statusMessage = 'Updated camera point';
  }, { coalesceKey: `camera-point-${entity.properties[CAMERA_PATH_KEY]}-${entity.properties[CAMERA_ORDER_KEY]}` });
}

export function reorderCameraPoint(editor: Editor, entity: Entity, delta: -1 | 1): void {
  const id = entity.properties[CAMERA_PATH_KEY]; const path = collectCameraPaths(editor).find(item => item.id === id);
  if (!path) return;
  const index = path.points.findIndex(point => point.entity === entity); const swapIndex = index + delta;
  if (index < 0 || swapIndex < 0 || swapIndex >= path.points.length) return;
  editor.transact('Reorder camera point', () => {
    path.points[index].entity.properties[CAMERA_ORDER_KEY] = String(swapIndex);
    path.points[swapIndex].entity.properties[CAMERA_ORDER_KEY] = String(index);
    editor.redrawRequested = true; editor.statusMessage = `Moved camera point ${delta < 0 ? 'earlier' : 'later'}`;
  });
}

export function setCameraPathClosed(editor: Editor, id: string, closed: boolean): void {
  const path = collectCameraPaths(editor).find(item => item.id === id); if (!path) return;
  editor.transact(closed ? 'Close camera path' : 'Open camera path', () => {
    for (const point of path.points) {
      if (closed) point.entity.properties[CAMERA_CLOSED_KEY] = '1'; else delete point.entity.properties[CAMERA_CLOSED_KEY];
    }
    editor.redrawRequested = true;
  });
}

function catmullRom(points: Vec3[], index: number, t: number, closed: boolean): Vec3 {
  const count = points.length;
  const at = (value: number): Vec3 => points[closed ? (value + count) % count : Math.max(0, Math.min(count - 1, value))];
  const p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2);
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(axis => 0.5 * ((2 * p1[axis]) + (-p0[axis] + p2[axis]) * t
    + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2
    + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3)) as Vec3;
}

export function cameraPathDuration(path: CameraPath): number {
  const segments = path.closed ? path.points.length : Math.max(0, path.points.length - 1);
  let total = 0; for (let index = 0; index < segments; index++) total += path.points[index].wait + path.points[index].duration;
  if (!path.closed && path.points.length > 0) total += path.points[path.points.length - 1].wait;
  return total;
}

function normalizeCameraPathTime(path: CameraPath, requestedTime: number): number {
  const totalDuration = cameraPathDuration(path);
  if (totalDuration <= 0) return 0;
  return path.closed
    ? ((requestedTime % totalDuration) + totalDuration) % totalDuration
    : Math.max(0, Math.min(totalDuration, requestedTime));
}

export function sampleCameraPath(path: CameraPath, requestedTime: number): CameraPose | null {
  if (path.points.length < 2) return null;
  const totalDuration = cameraPathDuration(path); if (totalDuration <= 0) return null;
  let elapsed = normalizeCameraPathTime(path, requestedTime);
  const timelineElapsed = elapsed;
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;
  let segment = Math.max(0, segmentCount - 1), t = 1, action = '';
  for (let index = 0; index < segmentCount; index++) {
    const point = path.points[index];
    if (elapsed <= point.wait) { segment = index; t = 0; action = point.action; break; }
    elapsed -= point.wait;
    if (elapsed <= point.duration) { segment = index; t = elapsed / point.duration; break; }
    elapsed -= point.duration;
  }
  const positions = path.points.map(point => point.position);
  const position = catmullRom(positions, segment, t, path.closed);
  const point = path.points[segment];
  const next = path.points[(segment + 1) % path.points.length];
  const look = point.lookPosition ?? next.lookPosition;
  const ahead = look ?? catmullRom(positions, segment, Math.min(1, t + 0.01), path.closed);
  const direction = vec3Sub(ahead, position); const length = vec3Length(direction);
  const yaw = length > 0.0001 ? Math.atan2(direction[1], direction[0]) : 0;
  const pitch = length > 0.0001 ? Math.asin(Math.max(-1, Math.min(1, direction[2] / length))) : 0;
  return { position, yaw, pitch, fov: point.fov + (next.fov - point.fov) * t, action, elapsed: timelineElapsed, totalDuration };
}

export function startCameraPlayback(editor: Editor, pathId: string): void {
  const path = collectCameraPaths(editor).find(item => item.id === pathId);
  if (!path || path.points.length < 2) { editor.statusMessage = 'Camera path needs at least two valid points'; return; }
  editor.cameraPlayback = { pathId, elapsed: 0, playing: true };
  editor.statusMessage = `Playing camera path ${path.name}`; editor.redrawRequested = true;
}

export function stopCameraPlayback(editor: Editor): void {
  if (!editor.cameraPlayback) return;
  editor.cameraPlayback = null; editor.statusMessage = 'Camera playback stopped'; editor.redrawRequested = true;
}

export function toggleCameraPlayback(editor: Editor, pathId: string): void {
  const path = collectCameraPaths(editor).find(item => item.id === pathId);
  if (!path || path.points.length < 2) { editor.statusMessage = 'Camera path needs at least two valid points'; return; }
  const state = editor.cameraPlayback;
  if (!state || state.pathId !== pathId) { startCameraPlayback(editor, pathId); return; }
  if (state.playing) {
    state.playing = false;
    editor.statusMessage = `Paused camera path ${path.name}`;
  } else {
    if (!path.closed && state.elapsed >= cameraPathDuration(path)) state.elapsed = 0;
    state.playing = true;
    editor.statusMessage = `Playing camera path ${path.name}`;
  }
  editor.redrawRequested = true;
}

export function seekCameraPlayback(editor: Editor, elapsed: number): CameraPose | null {
  if (!editor.cameraPlayback) return null;
  const path = collectCameraPaths(editor).find(item => item.id === editor.cameraPlayback?.pathId);
  if (!path) return null;
  editor.cameraPlayback.elapsed = normalizeCameraPathTime(path, elapsed);
  return sampleCameraPath(path, editor.cameraPlayback.elapsed);
}

export function advanceCameraPlayback(editor: Editor, deltaSeconds: number): CameraPose | null {
  const state = editor.cameraPlayback; if (!state?.playing) return null;
  const path = collectCameraPaths(editor).find(item => item.id === state.pathId);
  if (!path) { editor.cameraPlayback = null; editor.statusMessage = 'Camera path reference is invalid'; return null; }
  state.elapsed += Math.max(0, deltaSeconds);
  const duration = cameraPathDuration(path);
  if (path.closed) state.elapsed = normalizeCameraPathTime(path, state.elapsed);
  else if (state.elapsed >= duration) { state.elapsed = duration; state.playing = false; editor.statusMessage = `Finished camera path ${path.name}`; }
  return sampleCameraPath(path, state.elapsed);
}

function connectPathEntities(editor: Editor, entities: Entity[], closed: boolean, label: string): void {
  const reserved = new Set(editor.entities.map(entity => entity.properties.targetname).filter((value): value is string => !!value));
  const nextName = (): string => { let index = 1; while (reserved.has(`t${index}`)) index++; const name = `t${index}`; reserved.add(name); return name; };
  for (let index = 0; index < entities.length; index++) {
    const target = entities[(index + 1) % entities.length];
    if (!closed && index === entities.length - 1) { delete entities[index].properties.target; break; }
    target.properties.targetname ||= nextName();
    entities[index].properties.target = target.properties.targetname;
  }
  editor.redrawRequested = true; editor.statusMessage = label;
}

export function createSmartPath(editor: Editor, count = 4, spacing = 128, closed = false): Entity[] {
  let entities = selectedEntitiesInOrder(editor).filter(entity => entityOrigin(entity));
  editor.transact('Create smart path', () => {
    if (entities.length < 2) {
      entities = [];
      const forward = getViewport3DForward(editor.camera3d.yaw, 0);
      for (let index = 0; index < Math.max(2, Math.min(64, Math.round(count))); index++) {
        const entity = createEntity('path_corner', [
          editor.camera3d.position[0] + forward[0] * spacing * index,
          editor.camera3d.position[1] + forward[1] * spacing * index,
          editor.camera3d.position[2],
        ]);
        editor.entities.push(entity); entities.push(entity);
      }
    }
    connectPathEntities(editor, entities, closed, `Built ${closed ? 'closed ' : ''}path with ${entities.length} points`);
    editor.selection = entities.map(entity => ({ type: 'entity' as const, entity }));
  });
  return entities;
}

export function createSmartTrainPath(editor: Editor, count = 4, spacing = 128): Entity[] {
  const selected = selectedEntitiesInOrder(editor);
  const train = selected.find(entity => entity.classname === 'func_train');
  const points = selected.filter(entity => entity !== train && entityOrigin(entity));
  let result: Entity[] = [];
  editor.transact('Create smart train path', () => {
    result = points.length >= 2 ? points : createSmartPath(editor, count, spacing, false);
    if (train && result[0]) {
      const used = new Set(editor.entities.map(entity => entity.properties.targetname).filter((value): value is string => !!value));
      let index = 1; while (used.has(`train_path_${index}`)) index++;
      result[0].properties.targetname ||= `train_path_${index}`;
      train.properties.target = result[0].properties.targetname;
    }
    editor.statusMessage = train ? `Connected func_train to ${result.length}-point path` : `Built ${result.length}-point train path`;
  });
  return result;
}
