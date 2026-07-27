import { cloneBrush, type Brush } from './brush';
import { createEntity, type Entity } from './entity';
import type { Editor, SelectionItem } from './editor';
import type { MapSnapshot } from './history';
import type { Vec3 } from './math';
import { clonePatch, translatePatch, type Patch } from './patch';
import { translateBrushLocked } from './texture-lock';

export const GROUP_INFO_CLASSNAME = 'group_info';
export const GROUP_ID_KEY = '_q3edit_group_id';
export const GROUP_NAME_KEY = 'group';
export const GROUP_HIDDEN_KEY = '_q3edit_hidden';
export const GROUP_LOCKED_KEY = '_q3edit_locked';
export const GROUP_PARENT_KEY = '_q3edit_parent_group';
export const GROUP_LINK_SOURCE_KEY = '_q3edit_link_source_group';
export const GROUP_LINK_OFFSET_KEY = '_q3edit_link_offset';
export const Q3RADIANT_NAMED_GROUP_SERIALIZATION =
  'Q3Radiant group_info/group epairs with q3edit-group comment fallback for classic brushes and terrain' as const;

export interface NamedGroup {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  parentId?: string;
  linkedSourceId?: string;
  linkedOffset?: Vec3;
  entity: Entity;
}

const VALID_GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isGroupInfoEntity(entity: Entity): boolean {
  return entity.classname === GROUP_INFO_CLASSNAME;
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function parseOffset(value: string | undefined): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : undefined;
}

export function listNamedGroups(entities: Entity[]): NamedGroup[] {
  return entities.filter(isGroupInfoEntity).map(entity => ({
    id: entity.properties[GROUP_ID_KEY] ?? '',
    name: entity.properties[GROUP_NAME_KEY]?.trim() || 'Unnamed Group',
    hidden: parseBoolean(entity.properties[GROUP_HIDDEN_KEY]),
    locked: parseBoolean(entity.properties[GROUP_LOCKED_KEY]),
    parentId: entity.properties[GROUP_PARENT_KEY] || undefined,
    linkedSourceId: entity.properties[GROUP_LINK_SOURCE_KEY] || undefined,
    linkedOffset: parseOffset(entity.properties[GROUP_LINK_OFFSET_KEY]),
    entity,
  }));
}

function nextGroupId(used: Set<string>): string {
  let index = 1;
  while (used.has(`group-${index}`)) index++;
  return `group-${index}`;
}

function objectGroupIds(entities: Entity[]): string[] {
  const ids: string[] = [];
  for (const entity of entities) {
    if (!isGroupInfoEntity(entity) && entity.properties[GROUP_ID_KEY]) ids.push(entity.properties[GROUP_ID_KEY]);
    for (const brush of entity.brushes) if (brush.editorGroupId) ids.push(brush.editorGroupId);
    for (const patch of entity.patches) if (patch.editorGroupId) ids.push(patch.editorGroupId);
  }
  return ids;
}

/** Repairs malformed IDs/collisions and retains unknown memberships as recovered groups. */
export function reconcileNamedGroups(entities: Entity[]): void {
  const used = new Set<string>();
  const byName = new Map<string, string>();
  for (const group of listNamedGroups(entities)) {
    let id = group.id;
    if (!VALID_GROUP_ID.test(id) || used.has(id)) id = nextGroupId(used);
    used.add(id);
    group.entity.properties.classname = GROUP_INFO_CLASSNAME;
    group.entity.classname = GROUP_INFO_CLASSNAME;
    group.entity.properties[GROUP_ID_KEY] = id;
    group.entity.properties[GROUP_NAME_KEY] = group.name;
    byName.set(group.name, id);
  }

  for (const entity of entities) {
    if (isGroupInfoEntity(entity)) continue;
    const legacyName = entity.properties[GROUP_NAME_KEY];
    if (!entity.properties[GROUP_ID_KEY] && legacyName && byName.has(legacyName)) {
      entity.properties[GROUP_ID_KEY] = byName.get(legacyName)!;
    }
    for (const brush of entity.brushes) {
      const legacyBrushName = brush.properties?.[GROUP_NAME_KEY];
      if (!brush.editorGroupId && legacyBrushName && byName.has(legacyBrushName)) {
        brush.editorGroupId = byName.get(legacyBrushName);
      }
    }
  }

  for (const unknownId of new Set(objectGroupIds(entities))) {
    if (!VALID_GROUP_ID.test(unknownId)) {
      for (const entity of entities) {
        if (!isGroupInfoEntity(entity) && entity.properties[GROUP_ID_KEY] === unknownId) delete entity.properties[GROUP_ID_KEY];
        for (const brush of entity.brushes) if (brush.editorGroupId === unknownId) brush.editorGroupId = undefined;
        for (const patch of entity.patches) if (patch.editorGroupId === unknownId) patch.editorGroupId = undefined;
      }
      continue;
    }
    if (used.has(unknownId)) continue;
    const recovered = createEntity(GROUP_INFO_CLASSNAME);
    recovered.properties[GROUP_ID_KEY] = unknownId;
    recovered.properties[GROUP_NAME_KEY] = `Recovered ${unknownId}`;
    entities.push(recovered);
    used.add(unknownId);
  }
}

export function groupNameMap(entities: Entity[]): Map<string, string> {
  return new Map(listNamedGroups(entities).map(group => [group.id, group.name]));
}

export function entityGroupId(entity: Entity): string | undefined {
  return isGroupInfoEntity(entity) ? undefined : entity.properties[GROUP_ID_KEY];
}

export function objectGroupId(object: Entity | Brush | Patch): string | undefined {
  return 'classname' in object ? entityGroupId(object) : object.editorGroupId;
}

export function namedGroupForId(entities: Entity[], id: string | undefined): NamedGroup | null {
  if (!id) return null;
  return listNamedGroups(entities).find(group => group.id === id) ?? null;
}

export function countNamedGroupMembers(entities: Entity[], id: string): number {
  let count = 0;
  for (const entity of entities) {
    if (isGroupInfoEntity(entity)) continue;
    if (entityGroupId(entity) === id) { count++; continue; }
    count += entity.brushes.filter(brush => brush.editorGroupId === id).length;
    count += entity.patches.filter(patch => patch.editorGroupId === id).length;
  }
  return count;
}

export function isObjectInHiddenGroup(editor: Editor, object: Entity | Brush | Patch, owner?: Entity): boolean {
  const own = namedGroupForId(editor.entities, objectGroupId(object));
  const inherited = owner && owner !== object ? namedGroupForId(editor.entities, entityGroupId(owner)) : null;
  return groupStateInherited(editor.entities, own, 'hidden') || groupStateInherited(editor.entities, inherited, 'hidden');
}

export function isObjectInLockedGroup(editor: Editor, object: Entity | Brush | Patch, owner?: Entity): boolean {
  const own = namedGroupForId(editor.entities, objectGroupId(object));
  const inherited = owner && owner !== object ? namedGroupForId(editor.entities, entityGroupId(owner)) : null;
  return groupStateInherited(editor.entities, own, 'locked') || groupStateInherited(editor.entities, inherited, 'locked');
}

function groupStateInherited(entities: Entity[], group: NamedGroup | null, key: 'hidden' | 'locked'): boolean {
  const visited = new Set<string>();
  let current = group;
  while (current && !visited.has(current.id)) {
    if (current[key]) return true;
    visited.add(current.id);
    current = namedGroupForId(entities, current.parentId);
  }
  return false;
}

export function setNamedGroupParent(editor: Editor, id: string, parentId?: string): void {
  const group = namedGroupForId(editor.entities, id);
  if (!group || parentId === id) return;
  if (parentId && !namedGroupForId(editor.entities, parentId)) return;
  let ancestor = parentId ? namedGroupForId(editor.entities, parentId) : null;
  const visited = new Set<string>();
  while (ancestor && !visited.has(ancestor.id)) {
    if (ancestor.id === id) { editor.statusMessage = 'Group hierarchy cannot contain a cycle'; return; }
    visited.add(ancestor.id);
    ancestor = namedGroupForId(editor.entities, ancestor.parentId);
  }
  editor.transact('Move named group', () => {
    if (parentId) group.entity.properties[GROUP_PARENT_KEY] = parentId;
    else delete group.entity.properties[GROUP_PARENT_KEY];
    editor.redrawRequested = true;
    editor.statusMessage = parentId ? `Moved ${group.name} into ${namedGroupForId(editor.entities, parentId)?.name}` : `Moved ${group.name} to the root`;
  });
}

function setItemGroup(item: SelectionItem, groupId: string | undefined): void {
  if (item.type === 'entity') {
    if (groupId) item.entity.properties[GROUP_ID_KEY] = groupId;
    else delete item.entity.properties[GROUP_ID_KEY];
  } else if (item.type === 'patch') {
    item.patch.editorGroupId = groupId;
  } else {
    item.brush.editorGroupId = groupId;
  }
}

export function createNamedGroup(editor: Editor, name: string): NamedGroup | null {
  const trimmed = name.trim();
  if (!trimmed) { editor.statusMessage = 'Group name cannot be empty'; return null; }
  if (listNamedGroups(editor.entities).some(group => group.name.toLowerCase() === trimmed.toLowerCase())) {
    editor.statusMessage = `A group named ${trimmed} already exists`;
    return null;
  }
  return editor.transact('Create named group', () => {
    const used = new Set(listNamedGroups(editor.entities).map(group => group.id));
    const entity = createEntity(GROUP_INFO_CLASSNAME);
    entity.properties[GROUP_ID_KEY] = nextGroupId(used);
    entity.properties[GROUP_NAME_KEY] = trimmed;
    editor.entities.push(entity);
    for (const item of editor.selection) setItemGroup(item, entity.properties[GROUP_ID_KEY]);
    editor.redrawRequested = true;
    editor.statusMessage = `Created group ${trimmed}`;
    return listNamedGroups([entity])[0];
  });
}

function groupGeometry(entities: Entity[], id: string): Array<
  { kind: 'brush'; owner: Entity; brush: Brush } | { kind: 'patch'; owner: Entity; patch: Patch }
> {
  const result: Array<
    { kind: 'brush'; owner: Entity; brush: Brush } | { kind: 'patch'; owner: Entity; patch: Patch }
  > = [];
  for (const owner of entities) {
    for (const brush of owner.brushes) {
      if (brush.editorGroupId === id) result.push({ kind: 'brush', owner, brush });
    }
    for (const patch of owner.patches) {
      if (patch.editorGroupId === id) result.push({ kind: 'patch', owner, patch });
    }
  }
  return result;
}

function hasEntityMembers(entities: Entity[], id: string): boolean {
  return entities.some(entity => !isGroupInfoEntity(entity) && entityGroupId(entity) === id);
}

function nextLinkedCopyName(entities: Entity[], sourceName: string): string {
  const names = new Set(listNamedGroups(entities).map(group => group.name.toLowerCase()));
  let index = 1;
  let candidate = `${sourceName} instance`;
  while (names.has(candidate.toLowerCase())) candidate = `${sourceName} instance ${++index}`;
  return candidate;
}

function copyBrushStableIds(source: Brush | undefined, target: Brush): void {
  target.editorObjectId = source?.editorObjectId;
  target.faces.forEach((face, index) => { face.editorObjectId = source?.faces[index]?.editorObjectId; });
}

function comparableLinkedValue(value: Brush | Patch): string {
  return JSON.stringify(value, (key, member) => (
    key === 'editorObjectId' || key === 'editorGroupId' ? undefined : member
  ));
}

function takePreviousLinkedValue<T extends Brush | Patch>(previous: T[], candidate: T): T | undefined {
  if (previous.length === 0) return undefined;
  const exactIndex = previous.findIndex(value => comparableLinkedValue(value) === comparableLinkedValue(candidate));
  if (exactIndex >= 0) return previous.splice(exactIndex, 1)[0];
  const center = candidate.mins.map((value, axis) => (value + candidate.maxs[axis]) * 0.5);
  let closestIndex = 0;
  let closestDistance = Infinity;
  previous.forEach((value, index) => {
    const distance = value.mins.reduce((sum, minimum, axis) => {
      const valueCenter = (minimum + value.maxs[axis]) * 0.5;
      return sum + (valueCenter - center[axis]) ** 2;
    }, 0);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return previous.splice(closestIndex, 1)[0];
}

function replaceLinkedGeometry(entities: Entity[], sourceId: string, targetId: string, offset: Vec3): void {
  const oldBrushes = groupGeometry(entities, targetId)
    .filter((item): item is { kind: 'brush'; owner: Entity; brush: Brush } => item.kind === 'brush')
    .map(item => item.brush);
  const oldPatches = groupGeometry(entities, targetId)
    .filter((item): item is { kind: 'patch'; owner: Entity; patch: Patch } => item.kind === 'patch')
    .map(item => item.patch);
  for (const owner of entities) {
    owner.brushes = owner.brushes.filter(brush => brush.editorGroupId !== targetId);
    owner.patches = owner.patches.filter(patch => patch.editorGroupId !== targetId);
  }

  for (const item of groupGeometry(entities, sourceId)) {
    if (item.kind === 'brush') {
      const clone = cloneBrush(item.brush);
      clone.editorGroupId = targetId;
      translateBrushLocked(clone, offset);
      copyBrushStableIds(takePreviousLinkedValue(oldBrushes, clone), clone);
      item.owner.brushes.push(clone);
    } else {
      const clone = clonePatch(item.patch);
      clone.editorGroupId = targetId;
      translatePatch(clone, offset);
      clone.editorObjectId = takePreviousLinkedValue(oldPatches, clone)?.editorObjectId;
      item.owner.patches.push(clone);
    }
  }
}

function comparableGroupGeometry(entities: Entity[], id: string): string {
  return JSON.stringify(groupGeometry(entities, id).map(item => {
    const value = item.kind === 'brush' ? item.brush : item.patch;
    return JSON.parse(JSON.stringify(value, (key, member) => (
      key === 'editorObjectId' || key === 'editorGroupId' ? undefined : member
    )));
  }));
}

/**
 * Linked instances are flattened geometry in the map. Only source changes rebuild
 * their locked copies, which keeps normal group edits from churning object IDs.
 */
export function synchronizeLinkedGroups(editor: Editor, before: MapSnapshot): void {
  const beforeGroups = listNamedGroups(before);
  for (const instance of listNamedGroups(editor.entities).filter(group => group.linkedSourceId)) {
    const sourceId = instance.linkedSourceId!;
    if (!namedGroupForId(editor.entities, sourceId)) continue;
    const beforeInstance = beforeGroups.find(group => group.id === instance.id);
    const sourceChanged = comparableGroupGeometry(before, sourceId) !== comparableGroupGeometry(editor.entities, sourceId);
    const linkChanged = beforeInstance?.linkedSourceId !== sourceId
      || JSON.stringify(beforeInstance?.linkedOffset) !== JSON.stringify(instance.linkedOffset);
    if (sourceChanged || linkChanged) {
      replaceLinkedGeometry(editor.entities, sourceId, instance.id, instance.linkedOffset ?? [0, 0, 0]);
    }
  }
}

export function createLinkedGroupCopy(editor: Editor, id: string, offset: Vec3): NamedGroup | null {
  const source = namedGroupForId(editor.entities, id);
  if (!source || source.linkedSourceId) {
    editor.statusMessage = 'Create linked copies from a source group';
    return null;
  }
  if (hasEntityMembers(editor.entities, id)) {
    editor.statusMessage = 'Linked groups currently support brush and patch members only';
    return null;
  }
  if (groupGeometry(editor.entities, id).length === 0) {
    editor.statusMessage = 'The source group has no geometry';
    return null;
  }
  if (!offset.every(Number.isFinite)) {
    editor.statusMessage = 'Linked group offset must contain three numbers';
    return null;
  }
  return editor.transact('Create linked group copy', () => {
    const used = new Set(listNamedGroups(editor.entities).map(group => group.id));
    const entity = createEntity(GROUP_INFO_CLASSNAME);
    const targetId = nextGroupId(used);
    entity.properties[GROUP_ID_KEY] = targetId;
    entity.properties[GROUP_NAME_KEY] = nextLinkedCopyName(editor.entities, source.name);
    entity.properties[GROUP_LINK_SOURCE_KEY] = source.id;
    entity.properties[GROUP_LINK_OFFSET_KEY] = offset.join(' ');
    entity.properties[GROUP_LOCKED_KEY] = '1';
    editor.entities.push(entity);
    replaceLinkedGeometry(editor.entities, source.id, targetId, offset);
    editor.redrawRequested = true;
    editor.statusMessage = `Created linked copy of ${source.name}`;
    return listNamedGroups([entity])[0];
  });
}

export function setLinkedGroupOffset(editor: Editor, id: string, offset: Vec3): void {
  const group = namedGroupForId(editor.entities, id);
  if (!group?.linkedSourceId || !offset.every(Number.isFinite)) return;
  editor.transact('Move linked group copy', () => {
    group.entity.properties[GROUP_LINK_OFFSET_KEY] = offset.join(' ');
    editor.redrawRequested = true;
    editor.statusMessage = `Moved linked copy ${group.name}`;
  });
}

export function unlinkNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id);
  if (!group?.linkedSourceId) return;
  editor.transact('Unlink named group', () => {
    delete group.entity.properties[GROUP_LINK_SOURCE_KEY];
    delete group.entity.properties[GROUP_LINK_OFFSET_KEY];
    delete group.entity.properties[GROUP_LOCKED_KEY];
    editor.redrawRequested = true;
    editor.statusMessage = `Unlinked ${group.name}; its geometry is now independent`;
  });
}

export function renameNamedGroup(editor: Editor, id: string, name: string): void {
  const group = namedGroupForId(editor.entities, id); const trimmed = name.trim();
  if (!group || !trimmed) return;
  if (listNamedGroups(editor.entities).some(other => other.id !== id && other.name.toLowerCase() === trimmed.toLowerCase())) {
    editor.statusMessage = `A group named ${trimmed} already exists`; return;
  }
  editor.transact('Rename named group', () => {
    group.entity.properties[GROUP_NAME_KEY] = trimmed;
    editor.redrawRequested = true; editor.statusMessage = `Renamed group to ${trimmed}`;
  });
}

export function deleteNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  editor.transact('Delete named group', () => {
    for (const entity of editor.entities) {
      if (entity.properties[GROUP_PARENT_KEY] === id) delete entity.properties[GROUP_PARENT_KEY];
      if (entity.properties[GROUP_LINK_SOURCE_KEY] === id) {
        delete entity.properties[GROUP_LINK_SOURCE_KEY];
        delete entity.properties[GROUP_LINK_OFFSET_KEY];
        delete entity.properties[GROUP_LOCKED_KEY];
      }
      if (entity.properties[GROUP_ID_KEY] === id) delete entity.properties[GROUP_ID_KEY];
      for (const brush of entity.brushes) if (brush.editorGroupId === id) brush.editorGroupId = undefined;
      for (const patch of entity.patches) if (patch.editorGroupId === id) patch.editorGroupId = undefined;
    }
    editor.entities.splice(editor.entities.indexOf(group.entity), 1);
    editor.redrawRequested = true; editor.statusMessage = `Deleted group ${group.name}`;
  });
}

export function addSelectionToNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id); if (!group || editor.selection.length === 0) return;
  if (group.linkedSourceId) {
    editor.statusMessage = 'Linked copies mirror their source group and cannot accept members';
    return;
  }
  editor.transact('Add selection to named group', () => {
    for (const item of editor.selection) setItemGroup(item, id);
    editor.redrawRequested = true; editor.statusMessage = `Added selection to ${group.name}`;
  });
}

export function removeSelectionFromNamedGroups(editor: Editor): void {
  if (editor.selection.length === 0) return;
  editor.transact('Remove selection from named groups', () => {
    for (const item of editor.selection) setItemGroup(item, undefined);
    editor.redrawRequested = true; editor.statusMessage = 'Removed selection from named groups';
  });
}

export function selectNamedGroup(editor: Editor, id: string): void {
  const group = namedGroupForId(editor.entities, id);
  if (groupStateInherited(editor.entities, group, 'locked')) {
    editor.statusMessage = `Group ${group?.name ?? id} is locked`;
    return;
  }
  const selection: SelectionItem[] = [];
  for (const entity of editor.entities) {
    if (isGroupInfoEntity(entity)) continue;
    if (entityGroupId(entity) === id) { selection.push({ type: 'entity', entity }); continue; }
    for (const brush of entity.brushes) if (brush.editorGroupId === id) selection.push({ type: 'brush', entity, brush });
    for (const patch of entity.patches) if (patch.editorGroupId === id) selection.push({ type: 'patch', entity, patch });
  }
  editor.selection = selection;
  editor.redrawRequested = true;
  editor.statusMessage = `Selected ${selection.length} group item${selection.length === 1 ? '' : 's'}`;
}

export function setNamedGroupHidden(editor: Editor, id: string, hidden: boolean): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  editor.transact(hidden ? 'Hide named group' : 'Show named group', () => {
    if (hidden) group.entity.properties[GROUP_HIDDEN_KEY] = '1'; else delete group.entity.properties[GROUP_HIDDEN_KEY];
    if (hidden) editor.selection = editor.selection.filter(item => {
      const object = item.type === 'entity' ? item.entity : item.type === 'patch' ? item.patch : item.brush;
      return !isObjectInHiddenGroup(editor, object, item.entity);
    });
    editor.redrawRequested = true; editor.statusMessage = `${hidden ? 'Hidden' : 'Shown'} group ${group.name}`;
  });
}

export function setNamedGroupLocked(editor: Editor, id: string, locked: boolean): void {
  const group = namedGroupForId(editor.entities, id); if (!group) return;
  if (group.linkedSourceId && !locked) {
    editor.statusMessage = 'Unlink this instance before editing it independently';
    return;
  }
  editor.transact(locked ? 'Lock named group' : 'Unlock named group', () => {
    if (locked) group.entity.properties[GROUP_LOCKED_KEY] = '1'; else delete group.entity.properties[GROUP_LOCKED_KEY];
    if (locked) editor.selection = editor.selection.filter(item => {
      const object = item.type === 'entity' ? item.entity : item.type === 'patch' ? item.patch : item.brush;
      return !isObjectInLockedGroup(editor, object, item.entity);
    });
    editor.redrawRequested = true; editor.statusMessage = `${locked ? 'Locked' : 'Unlocked'} group ${group.name}`;
  });
}
