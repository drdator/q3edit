import type { Brush } from '../src/brush';
import { entityOrigin } from '../src/entity';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { planePointDistance, type Vec3 } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';

export interface GameplayLintIssue {
  severity: 'error' | 'warning' | 'info';
  code: 'entity-in-solid' | 'spawn-clearance' | 'unsupported-item';
  message: string;
  refs: string[];
}

function pointInsideBrush(point: Vec3, brush: Brush): boolean {
  return brush.faces.every(face => planePointDistance(face.plane, point) <= 0.1);
}

function overlaps(mins: Vec3, maxs: Vec3, brush: Brush): boolean {
  return brush.maxs.every((value, axis) => value > mins[axis]) && brush.mins.every((value, axis) => value < maxs[axis]);
}

function collisionBrushes(entities: ReturnType<typeof parseMapWithDiagnostics>['document']['entities']): Array<{ ref: string; brush: Brush }> {
  return entities.flatMap((entity, entityIndex) => {
    if (entity.classname.startsWith('trigger_') || isGroupInfoEntity(entity)) return [];
    return entity.brushes.map((brush, brushIndex) => ({ ref: `E${entityIndex}:B${brushIndex}`, brush }));
  });
}

function isSpawn(classname: string): boolean {
  return classname.startsWith('info_player_') || /spawn$/i.test(classname);
}

function isPickup(classname: string): boolean {
  return /^(?:item|weapon|ammo|holdable)_/.test(classname);
}

export function lintGameplay(mapText: string): GameplayLintIssue[] {
  const parsed = parseMapWithDiagnostics(mapText);
  const brushes = collisionBrushes(parsed.document.entities);
  const issues: GameplayLintIssue[] = [];

  parsed.document.entities.forEach((entity, entityIndex) => {
    if (entity.brushes.length > 0 || entity.patches.length > 0 || isGroupInfoEntity(entity)) return;
    const origin = entityOrigin(entity);
    if (!origin) return;
    const entityRef = `E${entityIndex}`;
    const containing = brushes.find(candidate => pointInsideBrush(origin, candidate.brush));
    if (containing) issues.push({
      severity: 'error', code: 'entity-in-solid', refs: [entityRef, containing.ref],
      message: `${entityRef} (${entity.classname}) origin is embedded in ${containing.ref}`,
    });

    if (isSpawn(entity.classname)) {
      const hullMins: Vec3 = [origin[0] - 15, origin[1] - 15, origin[2] - 24];
      const hullMaxs: Vec3 = [origin[0] + 15, origin[1] + 15, origin[2] + 32];
      const blockers = brushes.filter(candidate => overlaps(hullMins, hullMaxs, candidate.brush));
      if (blockers.length > 0) issues.push({
        severity: 'warning', code: 'spawn-clearance', refs: [entityRef, ...blockers.map(item => item.ref)],
        message: `${entityRef} (${entity.classname}) player hull overlaps ${blockers.length} brush${blockers.length === 1 ? '' : 'es'}`,
      });
    }

    if (isPickup(entity.classname)) {
      const support = brushes
        .filter(candidate => origin[0] >= candidate.brush.mins[0] && origin[0] <= candidate.brush.maxs[0] &&
          origin[1] >= candidate.brush.mins[1] && origin[1] <= candidate.brush.maxs[1] && candidate.brush.maxs[2] <= origin[2] + 1)
        .sort((a, b) => b.brush.maxs[2] - a.brush.maxs[2])[0];
      const gap = support ? origin[2] - support.brush.maxs[2] : Infinity;
      if (gap > 64) issues.push({
        severity: 'warning', code: 'unsupported-item', refs: support ? [entityRef, support.ref] : [entityRef],
        message: `${entityRef} (${entity.classname}) has no supporting brush within 64 map units`,
      });
    }
  });
  return issues;
}
