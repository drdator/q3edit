import type { Editor } from './editor';
import type { Entity } from './entity';
import { entityDisplayOrigin } from './editor-queries';
import type { Vec3 } from './math';
import { CAMERA_CLOSED_KEY, CAMERA_ORDER_KEY, CAMERA_PATH_KEY } from './camera-paths';

export interface EntityLink {
  source: Entity;
  target: Entity;
  value: string;
  from: Vec3;
  to: Vec3;
  highlighted: boolean;
}

export interface EntityPathCurve {
  entities: Entity[];
  points: Vec3[];
  closed: boolean;
  highlighted: boolean;
}

function trimProperty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function selectedEntitiesInOrder(editor: Editor): Entity[] {
  const ordered: Entity[] = [];
  const seen = new Set<Entity>();

  for (const item of editor.selection) {
    if (seen.has(item.entity)) continue;
    seen.add(item.entity);
    ordered.push(item.entity);
  }

  return ordered;
}

function nextTargetName(editor: Editor, reserved = new Set<string>()): string {
  let maxIndex = 0;

  for (const entity of editor.nonWorldspawnEntities()) {
    for (const key of ['target', 'targetname'] as const) {
      const value = trimProperty(entity.properties[key]);
      if (!value) continue;
      const match = value.match(/^t(\d+)$/i);
      if (!match) continue;
      maxIndex = Math.max(maxIndex, Number(match[1]) || 0);
    }
  }

  while (reserved.has(`t${maxIndex + 1}`)) {
    maxIndex++;
  }
  return `t${maxIndex + 1}`;
}

function entityLabel(entity: Entity): string {
  const name = trimProperty(entity.properties['targetname']) ?? trimProperty(entity.properties['name']);
  return name ? `${entity.classname} "${name}"` : entity.classname;
}

function entitySelected(editor: Editor, entity: Entity): boolean {
  return editor.selection.some(item => item.entity === entity);
}

function isPathEntity(entity: Entity): boolean {
  return entity.classname.startsWith('path_')
    || entity.classname === 'info_null'
    || entity.classname === 'info_notnull'
    || entity.classname === 'target_position';
}

function catmullRomPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3),
  ];
}

export function samplePathCurve(points: Vec3[], closed = false): Vec3[] {
  if (points.length <= 1) return points.map(point => [...point]);
  if (points.length === 2) {
    const sampled = points.map(point => [...point] as Vec3);
    if (closed) sampled.push([...points[0]]);
    return sampled;
  }
  const sampled: Vec3[] = [];
  const steps = 12;
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = closed ? points[(i - 1 + points.length) % points.length] : points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = closed ? points[(i + 2) % points.length] : points[Math.min(points.length - 1, i + 2)];
    for (let step = 0; step < steps; step++) {
      if (i > 0 && step === 0) continue;
      sampled.push(catmullRomPoint(p0, p1, p2, p3, step / steps));
    }
  }
  sampled.push([...points[closed ? 0 : points.length - 1]]);
  return sampled;
}

export function collectEntityLinks(editor: Editor): EntityLink[] {
  const targetnameMap = new Map<string, { entity: Entity; origin: Vec3 }[]>();

  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity)) continue;
    const targetname = trimProperty(entity.properties['targetname']);
    if (!targetname) continue;
    const origin = entityDisplayOrigin(entity);
    if (!origin) continue;
    const matches = targetnameMap.get(targetname) ?? [];
    matches.push({ entity, origin });
    targetnameMap.set(targetname, matches);
  }

  const links: EntityLink[] = [];

  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity)) continue;
    const target = trimProperty(entity.properties['target']);
    if (!target) continue;
    const origin = entityDisplayOrigin(entity);
    if (!origin) continue;
    const destinations = targetnameMap.get(target);
    if (!destinations) continue;

    for (const destination of destinations) {
      if (destination.entity === entity) continue;
      links.push({
        source: entity,
        target: destination.entity,
        value: target,
        from: [...origin],
        to: [...destination.origin],
        highlighted: entitySelected(editor, entity) || entitySelected(editor, destination.entity),
      });
    }
  }

  return links;
}

export function collectEntityPathCurves(editor: Editor): EntityPathCurve[] {
  const curves: EntityPathCurve[] = [];
  const cameraEntities = new Set<Entity>();
  const cameraGroups = new Map<string, Entity[]>();
  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity)) continue;
    const id = entity.properties[CAMERA_PATH_KEY]?.trim(); if (!id || !entityDisplayOrigin(entity)) continue;
    const points = cameraGroups.get(id) ?? []; points.push(entity); cameraGroups.set(id, points); cameraEntities.add(entity);
  }
  for (const entities of cameraGroups.values()) {
    entities.sort((a, b) => Number(a.properties[CAMERA_ORDER_KEY] ?? 0) - Number(b.properties[CAMERA_ORDER_KEY] ?? 0));
    const points = entities.map(entity => entityDisplayOrigin(entity)!).filter(Boolean);
    if (points.length < 2) continue;
    const closed = entities.some(entity => entity.properties[CAMERA_CLOSED_KEY] === '1');
    curves.push({ entities, points: samplePathCurve(points, closed), closed, highlighted: entities.some(entity => entitySelected(editor, entity)) });
  }
  const eligible = new Map<Entity, Vec3>();
  for (const entity of editor.nonWorldspawnEntities()) {
    if (!editor.isEntityVisible(entity) || !isPathEntity(entity) || cameraEntities.has(entity)) continue;
    const origin = entityDisplayOrigin(entity);
    if (!origin) continue;
    eligible.set(entity, origin);
  }

  const targetnameMap = new Map<string, Entity[]>();
  for (const entity of eligible.keys()) {
    const targetname = trimProperty(entity.properties['targetname']);
    if (!targetname) continue;
    const matches = targetnameMap.get(targetname) ?? [];
    matches.push(entity);
    targetnameMap.set(targetname, matches);
  }

  const outgoing = new Map<Entity, Entity | null>();
  const incomingCount = new Map<Entity, number>();
  for (const entity of eligible.keys()) {
    incomingCount.set(entity, 0);
  }

  for (const entity of eligible.keys()) {
    const target = trimProperty(entity.properties['target']);
    if (!target) continue;
    const matches = (targetnameMap.get(target) ?? []).filter(other => other !== entity);
    if (matches.length !== 1) continue;
    const next = matches[0];
    outgoing.set(entity, next);
    incomingCount.set(next, (incomingCount.get(next) ?? 0) + 1);
  }

  const visited = new Set<Entity>();

  const buildChain = (start: Entity) => {
    const entities: Entity[] = [];
    const points: Vec3[] = [];
    let closed = false;
    let current: Entity | undefined = start;
    const seen = new Set<Entity>();
    while (current && !seen.has(current)) {
      seen.add(current);
      visited.add(current);
      entities.push(current);
      points.push([...(eligible.get(current) as Vec3)]);
      const next: Entity | null = outgoing.get(current) ?? null;
      if (next === start && points.length >= 2) closed = true;
      current = next ?? undefined;
    }
    if (points.length >= 2) {
      curves.push({
        entities,
        points: samplePathCurve(points, closed),
        closed,
        highlighted: entities.some(entity => entitySelected(editor, entity)),
      });
    }
  };

  for (const entity of eligible.keys()) {
    if (visited.has(entity)) continue;
    const inCount = incomingCount.get(entity) ?? 0;
    const out = outgoing.get(entity) ?? null;
    if (inCount !== 1 && out) {
      buildChain(entity);
    }
  }

  for (const entity of eligible.keys()) {
    if (visited.has(entity)) continue;
    if (outgoing.has(entity)) buildChain(entity);
  }

  return curves;
}

export function connectSelectedEntities(editor: Editor): void {
  const entities = selectedEntitiesInOrder(editor).filter(entity => entity !== editor.worldspawn);

  if (entities.length !== 2) {
    editor.statusMessage = 'Select exactly two entities to connect';
    return;
  }

  const [source, target] = entities;
  if (source === target) {
    editor.statusMessage = 'Select two different entities to connect';
    return;
  }

  const linkName = trimProperty(source.properties['target'])
    ?? trimProperty(target.properties['targetname'])
    ?? nextTargetName(editor);

  editor.transact('Connect entities', () => {
    source.properties['target'] = linkName;
    target.properties['targetname'] = linkName;
    editor.selection = [{ type: 'entity', entity: target }];
    editor.redrawRequested = true;
    editor.statusMessage = `Connected ${entityLabel(source)} -> ${entityLabel(target)} (${linkName})`;
  });
}

export function connectSelectedEntitiesAsPath(editor: Editor): void {
  const entities = selectedEntitiesInOrder(editor).filter(entity => entity !== editor.worldspawn);
  if (entities.length < 2) {
    editor.statusMessage = 'Select 2+ entities to connect as a path';
    return;
  }

  editor.transact('Connect entity path', () => {
    const reserved = new Set<string>();
    for (let i = 0; i < entities.length - 1; i++) {
      const source = entities[i];
      const target = entities[i + 1];
      const linkName = trimProperty(target.properties['targetname'])
        ?? nextTargetName(editor, reserved);
      reserved.add(linkName);
      source.properties['target'] = linkName;
      target.properties['targetname'] = linkName;
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Connected ${entities.length} entities as a path`;
  });
}

export function connectSelectedEntitiesAsClosedPath(editor: Editor): void {
  const entities = selectedEntitiesInOrder(editor).filter(entity => entity !== editor.worldspawn);
  if (entities.length < 2) {
    editor.statusMessage = 'Select 2+ entities to connect as a closed path';
    return;
  }

  editor.transact('Connect closed entity path', () => {
    const reserved = new Set<string>();
    for (let i = 0; i < entities.length; i++) {
      const source = entities[i];
      const target = entities[(i + 1) % entities.length];
      const linkName = trimProperty(target.properties['targetname'])
        ?? nextTargetName(editor, reserved);
      reserved.add(linkName);
      source.properties['target'] = linkName;
      target.properties['targetname'] = linkName;
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Connected ${entities.length} entities as a closed path`;
  });
}
