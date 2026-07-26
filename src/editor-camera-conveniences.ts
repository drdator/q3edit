import type { Editor } from './editor';
import { entityOrigin, type Entity } from './entity';
import { getEntityClassRegistry } from './entity-definitions';
import { rayTriangleIntersect, type Vec3 } from './math';
import { getViewport3DForward } from './viewport3d-navigation';

function selectedEntity(editor: Editor): Entity | null {
  return editor.selection.find(item => item.entity !== editor.worldspawn)?.entity ?? null;
}

function entityEyePosition(entity: Entity): Vec3 | null {
  const origin = entityOrigin(entity);
  if (!origin) return null;
  const bounds = getEntityClassRegistry().get(entity.classname)?.bounds;
  if (!bounds) return [...origin];
  const height = bounds.maxs[2] - bounds.mins[2];
  return [origin[0], origin[1], origin[2] + bounds.maxs[2] - height * 0.1];
}

function entityLookTarget(editor: Editor, entity: Entity, eye: Vec3): Vec3 {
  const targetName = entity.properties.target?.trim();
  if (targetName) {
    const target = editor.entities.find(candidate => candidate.properties.targetname === targetName);
    const targetOrigin = target ? entityOrigin(target) : null;
    if (targetOrigin) return targetOrigin;
  }

  const angles = entity.properties.angles?.trim().split(/\s+/).map(Number);
  let yaw = Number(entity.properties.angle);
  let pitch = 0;
  if (angles?.length === 3 && angles.every(Number.isFinite)) {
    pitch = -angles[0] * Math.PI / 180;
    yaw = angles[1] * Math.PI / 180;
  } else {
    yaw = (Number.isFinite(yaw) ? yaw : 0) * Math.PI / 180;
  }
  const forward = getViewport3DForward(yaw, pitch);
  return [eye[0] + forward[0] * 128, eye[1] + forward[1] * 128, eye[2] + forward[2] * 128];
}

function setCameraLookingAt(editor: Editor, position: Vec3, target: Vec3): void {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const length = Math.hypot(dx, dy, dz);
  const yaw = length > 0.001 ? Math.atan2(dy, dx) : editor.camera3d.yaw;
  const pitch = length > 0.001
    ? Math.asin(Math.max(-1, Math.min(1, dz / length)))
    : editor.camera3d.pitch;
  editor.camera3d = { position: [...position], yaw, pitch };
  editor.cameraPlayback = null;
  editor.locatePoint(position, target);
}

export function lookThroughSelectedEntity(editor: Editor): void {
  const entity = selectedEntity(editor);
  const eye = entity ? entityEyePosition(entity) : null;
  if (!entity || !eye) {
    editor.statusMessage = 'Select a point entity to look through';
    return;
  }
  setCameraLookingAt(editor, eye, entityLookTarget(editor, entity, eye));
  editor.statusMessage = `Viewing from ${entity.classname}`;
}

export function lookThroughCameraPath(editor: Editor): void {
  const paths = editor.cameraPaths();
  const selected = selectedEntity(editor);
  const path = paths.find(candidate => candidate.points.some(point => point.entity === selected)) ?? paths[0];
  if (!path || path.points.length === 0) {
    editor.statusMessage = 'No camera path is available';
    return;
  }
  const index = Math.max(0, path.points.findIndex(point => point.entity === selected));
  const point = path.points[index];
  const next = path.points[(index + 1) % path.points.length];
  const target = point.lookPosition ?? next?.position;
  if (!target) {
    editor.statusMessage = 'Camera path needs another point or a look target';
    return;
  }
  setCameraLookingAt(editor, point.position, target);
  editor.statusMessage = `Viewing from ${path.name}, point ${index + 1}`;
}

export function moveSelectionToCamera(editor: Editor): void {
  const center = editor.selectionCenter();
  if (!center) {
    editor.statusMessage = 'Select objects to move to the camera';
    return;
  }
  editor.moveSelection([
    editor.camera3d.position[0] - center[0],
    editor.camera3d.position[1] - center[1],
    editor.camera3d.position[2] - center[2],
  ]);
  editor.statusMessage = 'Moved selection to camera';
}

export function floorHeightsAt(editor: Editor, x: number, y: number): number[] {
  const rayOrigin: Vec3 = [x, y, -65536];
  const rayDirection: Vec3 = [0, 0, 1];
  const heights: number[] = [];
  for (const { entity, brush } of editor.allBrushes()) {
    if (/^trigger_/i.test(entity.classname)) continue;
    if (x < brush.mins[0] || x > brush.maxs[0] || y < brush.mins[1] || y > brush.maxs[1]) continue;
    for (const face of brush.faces) {
      if (face.plane.normal[2] < 0.5 || face.polygon.length < 3) continue;
      for (let index = 1; index < face.polygon.length - 1; index++) {
        const distance = rayTriangleIntersect(
          rayOrigin,
          rayDirection,
          face.polygon[0],
          face.polygon[index],
          face.polygon[index + 1],
        );
        if (distance === null) continue;
        heights.push(rayOrigin[2] + distance);
        break;
      }
    }
  }
  return [...new Set(heights.map(height => Math.round(height * 100) / 100))].sort((a, b) => a - b);
}

export function moveCameraFloor(editor: Editor, direction: -1 | 1): void {
  const position = editor.camera3d.position;
  const floors = floorHeightsAt(editor, position[0], position[1]);
  let currentFloorIndex = -1;
  for (let index = floors.length - 1; index >= 0; index--) {
    if (floors[index] < position[2] - 1) {
      currentFloorIndex = index;
      break;
    }
  }
  const currentFloor = currentFloorIndex >= 0 ? floors[currentFloorIndex] : null;
  const eyeOffset = currentFloor === null ? 64 : Math.max(16, Math.min(128, position[2] - currentFloor));
  const targetFloor = direction > 0
    ? floors.find(height => height > position[2] + 1)
    : currentFloorIndex > 0 ? floors[currentFloorIndex - 1] : undefined;
  if (targetFloor === undefined) {
    editor.statusMessage = direction > 0 ? 'No floor above camera' : 'No floor below camera';
    return;
  }
  const nextPosition: Vec3 = [position[0], position[1], targetFloor + eyeOffset];
  const forward = getViewport3DForward(editor.camera3d.yaw, editor.camera3d.pitch);
  setCameraLookingAt(editor, nextPosition, [
    nextPosition[0] + forward[0] * 128,
    nextPosition[1] + forward[1] * 128,
    nextPosition[2] + forward[2] * 128,
  ]);
  editor.statusMessage = `Camera moved ${direction > 0 ? 'up' : 'down'} one floor`;
}
