import { cloneBrush, type Brush } from './brush';
import { cloneEntity, type Entity } from './entity';
import { ENTITY_OBJECT_ID_KEY, entityObjectId } from './editor-object-ids';
import { cloneMapSnapshot, type MapSnapshot } from './history';
import { clonePatch, type Patch } from './patch';

export type MapDiffKind = 'entity' | 'brush' | 'patch';
export type MapDiffChange = 'added' | 'removed' | 'modified';
export type MapDiffCorrelation = 'stable-id' | 'semantic' | 'exact' | 'unmatched';

type DiffValue = Entity | Brush | Patch;

export interface MapDiffEntry {
  id: string;
  kind: MapDiffKind;
  change: MapDiffChange;
  label: string;
  detail: string;
  correlation: MapDiffCorrelation;
  stableKey?: string;
  currentRef?: string;
  baselineRef?: string;
  currentOwnerKey?: string;
  baselineOwnerKey?: string;
  currentValue?: DiffValue;
  baselineValue?: DiffValue;
}

export interface MapDiffResult {
  entries: MapDiffEntry[];
  counts: Record<MapDiffChange, number>;
  stableEntries: number;
  limitedCorrelation: boolean;
}

export interface MapMergeConflict {
  stableKey?: string;
  kind: MapDiffKind;
  label: string;
  reason: string;
}

export interface MapMergeResult {
  entities: MapSnapshot;
  applied: number;
  conflicts: MapMergeConflict[];
  skipped: MapMergeConflict[];
}

function sortedRecord(value: Record<string, string>, omitted: string[] = []): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !omitted.includes(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalEntity(entity: Entity): string {
  return JSON.stringify({
    classname: entity.classname,
    properties: sortedRecord(entity.properties, [ENTITY_OBJECT_ID_KEY]),
  });
}

function canonicalBrush(brush: Brush): string {
  return JSON.stringify({
    name: brush.name,
    editorGroupId: brush.editorGroupId,
    properties: brush.properties ? sortedRecord(brush.properties) : undefined,
    faces: brush.faces.map(face => ({
      points: face.points,
      texture: face.texture,
      textureProjection: face.textureProjection,
      contentFlags: face.contentFlags,
      surfaceFlags: face.surfaceFlags,
      value: face.value,
    })),
  });
}

function canonicalPatch(patch: Patch): string {
  return JSON.stringify({
    width: patch.width,
    height: patch.height,
    texture: patch.texture,
    terrainGroupId: patch.terrainGroupId,
    editorGroupId: patch.editorGroupId,
    properties: patch.properties ? sortedRecord(patch.properties) : undefined,
    terrainDef: patch.terrainDef,
    contentFlags: patch.contentFlags,
    surfaceFlags: patch.surfaceFlags,
    value: patch.value,
    ctrl: patch.ctrl,
    subdivisions: patch.subdivisions,
  });
}

function canonical(kind: MapDiffKind, value: DiffValue | undefined): string {
  if (!value) return '';
  if (kind === 'entity') return canonicalEntity(value as Entity);
  if (kind === 'brush') return canonicalBrush(value as Brush);
  return canonicalPatch(value as Patch);
}

function stableEntityKey(entity: Entity, index: number): string | undefined {
  if (index === 0 && entity.classname === 'worldspawn') return 'entity:worldspawn';
  const id = entityObjectId(entity);
  return id ? `entity:${id}` : undefined;
}

function semanticEntityKey(entity: Entity, index: number): string | undefined {
  if (index === 0 && entity.classname === 'worldspawn') return 'worldspawn';
  const groupId = entity.properties._q3edit_group_id;
  if (entity.classname === 'group_info' && groupId) return `group:${groupId}`;
  const targetname = entity.properties.targetname?.trim();
  if (targetname) return `target:${entity.classname}:${targetname}`;
  const origin = entity.properties.origin?.trim();
  if (origin) return `origin:${entity.classname}:${origin}`;
  return undefined;
}

function stableObjectKey(kind: 'brush' | 'patch', object: Brush | Patch): string | undefined {
  return object.editorObjectId ? `${kind}:${object.editorObjectId}` : undefined;
}

interface EntityItem {
  entity: Entity;
  index: number;
  ref: string;
  stableKey?: string;
  semanticKey?: string;
}

interface GeometryItem<T extends Brush | Patch> {
  value: T;
  index: number;
  ref: string;
  stableKey?: string;
  canonical: string;
}

function entityItems(entities: Entity[]): EntityItem[] {
  return entities.map((entity, index) => ({
    entity,
    index,
    ref: `E${index}`,
    stableKey: stableEntityKey(entity, index),
    semanticKey: semanticEntityKey(entity, index),
  }));
}

function uniqueKeyMap<T>(items: T[], key: (item: T) => string | undefined): Map<string, T> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Map(items.flatMap(item => {
    const value = key(item);
    return value && counts.get(value) === 1 ? [[value, item] as const] : [];
  }));
}

function takeMatches<T>(
  current: T[],
  baseline: T[],
  key: (item: T) => string | undefined,
  correlation: MapDiffCorrelation,
): Array<{ current: T; baseline: T; correlation: MapDiffCorrelation }> {
  const currentByKey = uniqueKeyMap(current, key);
  const baselineByKey = uniqueKeyMap(baseline, key);
  const matches: Array<{ current: T; baseline: T; correlation: MapDiffCorrelation }> = [];
  for (const [value, currentItem] of currentByKey) {
    const baselineItem = baselineByKey.get(value);
    if (!baselineItem) continue;
    matches.push({ current: currentItem, baseline: baselineItem, correlation });
  }
  const currentMatched = new Set(matches.map(match => match.current));
  const baselineMatched = new Set(matches.map(match => match.baseline));
  current.splice(0, current.length, ...current.filter(item => !currentMatched.has(item)));
  baseline.splice(0, baseline.length, ...baseline.filter(item => !baselineMatched.has(item)));
  return matches;
}

function geometryItems<T extends Brush | Patch>(
  values: T[],
  ownerRef: string,
  kind: 'brush' | 'patch',
): GeometryItem<T>[] {
  return values.map((value, index) => ({
    value,
    index,
    ref: `${ownerRef}:${kind === 'brush' ? 'B' : 'P'}${index}`,
    stableKey: stableObjectKey(kind, value),
    canonical: kind === 'brush' ? canonicalBrush(value as Brush) : canonicalPatch(value as Patch),
  }));
}

function entityLabel(entity: Entity): string {
  const suffix = entity.properties.targetname || entity.properties.origin || '';
  return suffix ? `${entity.classname} · ${suffix}` : entity.classname;
}

function geometryLabel(kind: 'brush' | 'patch', value: Brush | Patch): string {
  if (kind === 'patch') return `Patch · ${(value as Patch).texture}`;
  const brush = value as Brush;
  const textures = [...new Set(brush.faces.map(face => face.texture))];
  return `Brush · ${textures.slice(0, 2).join(', ')}${textures.length > 2 ? '…' : ''}`;
}

function propertyDetail(current: Entity, baseline: Entity): string {
  const keys = new Set([...Object.keys(current.properties), ...Object.keys(baseline.properties)]);
  const changed = [...keys].filter(key => key !== ENTITY_OBJECT_ID_KEY
    && current.properties[key] !== baseline.properties[key]);
  return changed.length > 0 ? `Properties: ${changed.join(', ')}` : 'Entity properties changed';
}

function geometryDetail(kind: 'brush' | 'patch', current: Brush | Patch, baseline: Brush | Patch): string {
  if (kind === 'patch') {
    const currentPatch = current as Patch;
    const baselinePatch = baseline as Patch;
    return currentPatch.texture !== baselinePatch.texture
      ? `Texture: ${baselinePatch.texture} → ${currentPatch.texture}`
      : 'Patch shape or projection changed';
  }
  const currentBrush = current as Brush;
  const baselineBrush = baseline as Brush;
  const currentTextures = [...new Set(currentBrush.faces.map(face => face.texture))].join(', ');
  const baselineTextures = [...new Set(baselineBrush.faces.map(face => face.texture))].join(', ');
  return currentTextures !== baselineTextures
    ? `Textures: ${baselineTextures} → ${currentTextures}`
    : 'Brush shape or texture projection changed';
}

function diffMatchedGeometry<T extends Brush | Patch>(
  entries: MapDiffEntry[],
  kind: 'brush' | 'patch',
  currentOwner: EntityItem,
  baselineOwner: EntityItem,
): void {
  const currentValues = (kind === 'brush'
    ? currentOwner.entity.brushes
    : currentOwner.entity.patches) as T[];
  const baselineValues = (kind === 'brush'
    ? baselineOwner.entity.brushes
    : baselineOwner.entity.patches) as T[];
  const current = geometryItems(
    currentValues,
    currentOwner.ref,
    kind,
  ) as GeometryItem<T>[];
  const baseline = geometryItems(
    baselineValues,
    baselineOwner.ref,
    kind,
  ) as GeometryItem<T>[];
  const matched = [
    ...takeMatches(current, baseline, item => item.stableKey, 'stable-id'),
    ...takeMatches(current, baseline, item => item.canonical, 'exact'),
  ];
  for (const match of matched) {
    if (match.current.canonical === match.baseline.canonical) continue;
    entries.push({
      id: `${kind}:${entries.length}`,
      kind,
      change: 'modified',
      label: geometryLabel(kind, match.current.value),
      detail: geometryDetail(kind, match.current.value, match.baseline.value),
      correlation: match.correlation,
      stableKey: match.current.stableKey === match.baseline.stableKey ? match.current.stableKey : undefined,
      currentRef: match.current.ref,
      baselineRef: match.baseline.ref,
      currentOwnerKey: currentOwner.stableKey,
      baselineOwnerKey: baselineOwner.stableKey,
      currentValue: match.current.value,
      baselineValue: match.baseline.value,
    });
  }
  for (const item of current) {
    entries.push({
      id: `${kind}:${entries.length}`,
      kind,
      change: 'added',
      label: geometryLabel(kind, item.value),
      detail: `Added to ${entityLabel(currentOwner.entity)}`,
      correlation: 'unmatched',
      stableKey: item.stableKey,
      currentRef: item.ref,
      currentOwnerKey: currentOwner.stableKey,
      currentValue: item.value,
    });
  }
  for (const item of baseline) {
    entries.push({
      id: `${kind}:${entries.length}`,
      kind,
      change: 'removed',
      label: geometryLabel(kind, item.value),
      detail: `Removed from ${entityLabel(baselineOwner.entity)}`,
      correlation: 'unmatched',
      stableKey: item.stableKey,
      baselineRef: item.ref,
      currentOwnerKey: currentOwner.stableKey,
      baselineOwnerKey: baselineOwner.stableKey,
      baselineValue: item.value,
    });
  }
}

export function diffMaps(currentEntities: Entity[], baselineEntities: Entity[]): MapDiffResult {
  const entries: MapDiffEntry[] = [];
  const current = entityItems(currentEntities);
  const baseline = entityItems(baselineEntities);
  const matched = [
    ...takeMatches(current, baseline, item => item.stableKey, 'stable-id'),
    ...takeMatches(current, baseline, item => item.semanticKey, 'semantic'),
  ];

  for (const match of matched) {
    if (canonicalEntity(match.current.entity) !== canonicalEntity(match.baseline.entity)) {
      entries.push({
        id: `entity:${entries.length}`,
        kind: 'entity',
        change: 'modified',
        label: entityLabel(match.current.entity),
        detail: propertyDetail(match.current.entity, match.baseline.entity),
        correlation: match.correlation,
        stableKey: match.current.stableKey === match.baseline.stableKey ? match.current.stableKey : undefined,
        currentRef: match.current.ref,
        baselineRef: match.baseline.ref,
        currentValue: match.current.entity,
        baselineValue: match.baseline.entity,
      });
    }
    diffMatchedGeometry<Brush>(entries, 'brush', match.current, match.baseline);
    diffMatchedGeometry<Patch>(entries, 'patch', match.current, match.baseline);
  }

  for (const item of current) {
    entries.push({
      id: `entity:${entries.length}`,
      kind: 'entity',
      change: 'added',
      label: entityLabel(item.entity),
      detail: `Added with ${item.entity.brushes.length} brushes and ${item.entity.patches.length} patches`,
      correlation: 'unmatched',
      stableKey: item.stableKey,
      currentRef: item.ref,
      currentValue: item.entity,
    });
  }
  for (const item of baseline) {
    entries.push({
      id: `entity:${entries.length}`,
      kind: 'entity',
      change: 'removed',
      label: entityLabel(item.entity),
      detail: `Removed with ${item.entity.brushes.length} brushes and ${item.entity.patches.length} patches`,
      correlation: 'unmatched',
      stableKey: item.stableKey,
      baselineRef: item.ref,
      baselineValue: item.entity,
    });
  }

  return {
    entries,
    counts: {
      added: entries.filter(entry => entry.change === 'added').length,
      removed: entries.filter(entry => entry.change === 'removed').length,
      modified: entries.filter(entry => entry.change === 'modified').length,
    },
    stableEntries: entries.filter(entry => entry.stableKey).length,
    limitedCorrelation: entries.some(entry => !entry.stableKey),
  };
}

function findEntityByKey(entities: Entity[], key: string | undefined): Entity | undefined {
  if (!key) return undefined;
  if (key === 'entity:worldspawn') return entities.find(entity => entity.classname === 'worldspawn');
  const id = key.slice('entity:'.length);
  return entities.find(entity => entityObjectId(entity) === id);
}

function removeByStableKey(entities: Entity[], entry: MapDiffEntry): boolean {
  if (!entry.stableKey) return false;
  if (entry.kind === 'entity') {
    const entity = findEntityByKey(entities, entry.stableKey);
    if (!entity || entity.classname === 'worldspawn') return false;
    entities.splice(entities.indexOf(entity), 1);
    return true;
  }
  const kind = entry.kind;
  for (const entity of entities) {
    if (kind === 'brush') {
      const index = entity.brushes.findIndex(value => stableObjectKey(kind, value) === entry.stableKey);
      if (index >= 0) {
        entity.brushes.splice(index, 1);
        return true;
      }
    } else {
      const index = entity.patches.findIndex(value => stableObjectKey(kind, value) === entry.stableKey);
      if (index >= 0) {
        entity.patches.splice(index, 1);
        return true;
      }
    }
  }
  return false;
}

function applyDesiredEntry(entities: Entity[], entry: MapDiffEntry): boolean {
  if (!entry.stableKey) return false;
  if (entry.change === 'removed') return removeByStableKey(entities, entry);
  const value = entry.currentValue;
  if (!value) return false;
  if (entry.kind === 'entity') {
    if (entry.change === 'added') {
      entities.push(cloneEntity(value as Entity));
      return true;
    }
    const target = findEntityByKey(entities, entry.stableKey);
    if (!target) return false;
    target.classname = (value as Entity).classname;
    target.properties = { ...(value as Entity).properties };
    return true;
  }
  const owner = findEntityByKey(entities, entry.currentOwnerKey ?? entry.baselineOwnerKey);
  if (!owner) return false;
  const values = entry.kind === 'brush' ? owner.brushes : owner.patches;
  if (entry.change === 'added') {
    if (entry.kind === 'brush') owner.brushes.push(cloneBrush(value as Brush));
    else owner.patches.push(clonePatch(value as Patch));
    return true;
  }
  const index = values.findIndex(candidate => stableObjectKey(entry.kind as 'brush' | 'patch', candidate) === entry.stableKey);
  if (index < 0) return false;
  if (entry.kind === 'brush') owner.brushes[index] = cloneBrush(value as Brush);
  else owner.patches[index] = clonePatch(value as Patch);
  return true;
}

function desiredState(entry: MapDiffEntry): string {
  return entry.change === 'removed' ? 'removed' : canonical(entry.kind, entry.currentValue);
}

export function mergeMapsThreeWay(
  baseline: Entity[],
  current: Entity[],
  incoming: Entity[],
): MapMergeResult {
  const entities = cloneMapSnapshot(current);
  const currentChanges = diffMaps(current, baseline).entries;
  const incomingChanges = diffMaps(incoming, baseline).entries;
  const currentByKey = new Map(currentChanges.flatMap(entry => entry.stableKey ? [[entry.stableKey, entry] as const] : []));
  const conflicts: MapMergeConflict[] = [];
  const skipped: MapMergeConflict[] = [];
  let applied = 0;

  for (const incomingChange of incomingChanges) {
    if (!incomingChange.stableKey) {
      skipped.push({
        kind: incomingChange.kind,
        label: incomingChange.label,
        reason: 'No persistent object ID; automatic correlation would be unsafe',
      });
      continue;
    }
    const currentChange = currentByKey.get(incomingChange.stableKey);
    if (currentChange) {
      if (desiredState(currentChange) !== desiredState(incomingChange)) {
        conflicts.push({
          stableKey: incomingChange.stableKey,
          kind: incomingChange.kind,
          label: incomingChange.label,
          reason: 'Both maps changed this object differently',
        });
      }
      continue;
    }
    if (applyDesiredEntry(entities, incomingChange)) applied++;
    else {
      skipped.push({
        stableKey: incomingChange.stableKey,
        kind: incomingChange.kind,
        label: incomingChange.label,
        reason: 'The destination owner could not be resolved',
      });
    }
  }
  return { entities, applied, conflicts, skipped };
}

/**
 * Replaces one current object with its baseline state. Positional references are
 * safe because the caller recomputes the diff after each accepted row.
 */
export function acceptBaselineEntry(current: Entity[], baseline: Entity[], entry: MapDiffEntry): boolean {
  const parseRef = (ref: string | undefined) => /^E(\d+)(?::([BP])(\d+))?$/.exec(ref ?? '');
  const currentMatch = parseRef(entry.currentRef);
  const baselineMatch = parseRef(entry.baselineRef);
  if (entry.change === 'added' && currentMatch) {
    const owner = current[Number(currentMatch[1])];
    if (!owner) return false;
    if (!currentMatch[2]) {
      if (owner.classname === 'worldspawn') return false;
      current.splice(Number(currentMatch[1]), 1);
    } else if (currentMatch[2] === 'B') owner.brushes.splice(Number(currentMatch[3]), 1);
    else owner.patches.splice(Number(currentMatch[3]), 1);
    return true;
  }
  if (!baselineMatch) return false;
  const baselineOwner = baseline[Number(baselineMatch[1])];
  if (!baselineOwner) return false;
  if (entry.change === 'removed') {
    if (!baselineMatch[2]) {
      current.push(cloneEntity(baselineOwner));
      return true;
    }
    const currentOwner = entry.currentOwnerKey
      ? findEntityByKey(current, entry.currentOwnerKey)
      : current[Number(baselineMatch[1])];
    if (!currentOwner) return false;
    if (baselineMatch[2] === 'B') currentOwner.brushes.push(cloneBrush(baselineOwner.brushes[Number(baselineMatch[3])]));
    else currentOwner.patches.push(clonePatch(baselineOwner.patches[Number(baselineMatch[3])]));
    return true;
  }
  if (!currentMatch) return false;
  const currentOwner = current[Number(currentMatch[1])];
  if (!currentOwner) return false;
  if (!currentMatch[2]) {
    currentOwner.classname = baselineOwner.classname;
    currentOwner.properties = { ...baselineOwner.properties };
  } else if (currentMatch[2] === 'B') {
    currentOwner.brushes[Number(currentMatch[3])] = cloneBrush(baselineOwner.brushes[Number(baselineMatch[3])]);
  } else {
    currentOwner.patches[Number(currentMatch[3])] = clonePatch(baselineOwner.patches[Number(baselineMatch[3])]);
  }
  return true;
}
