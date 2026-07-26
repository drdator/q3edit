import { collectEditorDiagnostics } from './diagnostics';
import type { Editor, SelectionItem } from './editor';
import {
  deduplicateEditorObjectIds,
  entityObjectId,
  newEditorObjectId,
  setEntityObjectId,
} from './editor-object-ids';
import { CONTENTS_DETAIL } from './map-flags';
import type { Vec3 } from './math';
import {
  GROUP_HIDDEN_KEY,
  GROUP_LOCKED_KEY,
  isObjectInHiddenGroup,
  listNamedGroups,
  type NamedGroup,
} from './named-groups';
import { readSpatialPlan } from './spatial-plan';

export const ORGANIZATION_KEY = '_q3edit_organization';
export const ORGANIZATION_VERSION = 1;

export interface NavigationState {
  camera3d: { position: Vec3; yaw: number; pitch: number };
  views2d: Record<'xy' | 'xz' | 'yz', { centerX: number; centerY: number; zoom: number }>;
}

export interface SelectionSet {
  id: string;
  name: string;
  refs: string[];
}

export interface VisibilityPreset {
  id: string;
  name: string;
  hiddenRefs: string[];
  groups: Array<{ id: string; hidden: boolean; locked: boolean }>;
}

export interface ObjectFilter {
  classname: string;
  texture: string;
  groupId: string;
  areaId: string;
  connectionId: string;
  structural: 'all' | 'structural' | 'detail';
  visibility: 'all' | 'visible' | 'hidden';
  diagnostic: 'all' | 'with-issues' | 'without-issues';
  kinds: Array<'entity' | 'brush' | 'patch' | 'face'>;
  combine: 'and' | 'or';
}

export interface FilterPreset {
  id: string;
  name: string;
  filter: ObjectFilter;
}

export interface CameraBookmark {
  id: string;
  name: string;
  areaId?: string;
  groupId?: string;
  navigation: NavigationState;
}

export interface OrganizationData {
  version: typeof ORGANIZATION_VERSION;
  selectionSets: SelectionSet[];
  visibilityPresets: VisibilityPreset[];
  filterPresets: FilterPreset[];
  bookmarks: CameraBookmark[];
}

export interface FilteredObject {
  ref: string;
  kind: 'entity' | 'brush' | 'patch' | 'face';
  classname: string;
  texture: string | null;
  groupId: string | null;
  areaId: string | null;
  connectionId: string | null;
  structural: boolean | null;
  visible: boolean;
  hasDiagnostic: boolean;
}

const DEFAULT_FILTER: ObjectFilter = {
  classname: '', texture: '', groupId: '', areaId: '', connectionId: '', structural: 'all',
  visibility: 'all', diagnostic: 'all', kinds: ['entity', 'brush', 'patch', 'face'], combine: 'and',
};

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const SIGNATURE_SEPARATOR = '@@';

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return (result >>> 0).toString(36);
}

function itemSignature(item: SelectionItem): string {
  if (item.type === 'entity') {
    return hash(JSON.stringify({
      kind: 'entity',
      classname: item.entity.classname,
      brushes: item.entity.brushes.map(brush => [brush.mins, brush.maxs]),
      patches: item.entity.patches.map(patch => [patch.mins, patch.maxs]),
    }));
  }
  if (item.type === 'patch') {
    return hash(JSON.stringify({
      kind: 'patch',
      controlPoints: item.patch.ctrl.map(row => row.map(point => point.xyz)),
    }));
  }
  if (item.type === 'face') {
    return hash(JSON.stringify({ kind: 'face', points: item.face.points }));
  }
  return hash(JSON.stringify({
    kind: 'brush',
    faces: item.brush.faces.map(face => face.points),
    mins: item.brush.mins,
    maxs: item.brush.maxs,
  }));
}

function persistentRef(item: SelectionItem): string {
  if (item.type === 'entity') {
    let objectId = entityObjectId(item.entity);
    if (!objectId) {
      objectId = newEditorObjectId('entity');
      setEntityObjectId(item.entity, objectId);
    }
    return `OE:${encodeURIComponent(objectId)}`;
  }
  if (item.type === 'patch') {
    item.patch.editorObjectId ??= newEditorObjectId('patch');
    return `OP:${encodeURIComponent(item.patch.editorObjectId)}`;
  }
  if (item.type === 'face') {
    item.face.editorObjectId ??= newEditorObjectId('face');
    return `OF:${encodeURIComponent(item.face.editorObjectId)}`;
  }
  item.brush.editorObjectId ??= newEditorObjectId('brush');
  return `OB:${encodeURIComponent(item.brush.editorObjectId)}`;
}

function normalizeData(value: unknown): OrganizationData {
  const source = value && typeof value === 'object' ? value as Partial<OrganizationData> : {};
  return {
    version: ORGANIZATION_VERSION,
    selectionSets: Array.isArray(source.selectionSets) ? source.selectionSets : [],
    visibilityPresets: Array.isArray(source.visibilityPresets) ? source.visibilityPresets : [],
    filterPresets: Array.isArray(source.filterPresets) ? source.filterPresets : [],
    bookmarks: Array.isArray(source.bookmarks) ? source.bookmarks : [],
  };
}

export function readOrganization(editor: Editor): OrganizationData {
  const value = editor.worldspawn.properties[ORGANIZATION_KEY];
  if (!value) return normalizeData(null);
  try { return normalizeData(JSON.parse(value)); } catch { return normalizeData(null); }
}

function writeOrganization(editor: Editor, label: string, data: OrganizationData): void {
  editor.transact(label, () => {
    editor.worldspawn.properties[ORGANIZATION_KEY] = JSON.stringify(data);
  });
}

export function selectionRefs(editor: Editor, persistent = false): string[] {
  if (persistent) deduplicateEditorObjectIds(editor.entities);
  const refs: string[] = [];
  for (const item of editor.selection) {
    const entityIndex = editor.entities.indexOf(item.entity);
    if (entityIndex < 0) continue;
    if (item.type === 'entity') {
      const ref = `E${entityIndex}`;
      refs.push(persistent ? persistentRef(item) : ref);
    }
    else if (item.type === 'patch') {
      const patchIndex = item.entity.patches.indexOf(item.patch);
      if (patchIndex >= 0) {
        const ref = `E${entityIndex}:P${patchIndex}`;
        refs.push(persistent ? persistentRef(item) : ref);
      }
    } else {
      const brushIndex = item.entity.brushes.indexOf(item.brush);
      if (brushIndex < 0) continue;
      if (item.type === 'face') {
        const faceIndex = item.brush.faces.indexOf(item.face);
        if (faceIndex >= 0) {
          const ref = `E${entityIndex}:B${brushIndex}:F${faceIndex}`;
          refs.push(persistent ? persistentRef(item) : ref);
        }
      } else {
        const ref = `E${entityIndex}:B${brushIndex}`;
        refs.push(persistent ? persistentRef(item) : ref);
      }
    }
  }
  return [...new Set(refs)];
}

function resolvePositionalRef(editor: Editor, ref: string): SelectionItem[] {
  if (ref.startsWith('G:')) {
    const groupId = ref.slice(2);
    const result: SelectionItem[] = [];
    editor.entities.forEach(entity => {
      if (entity.properties._q3edit_group_id === groupId) result.push({ type: 'entity', entity });
      entity.brushes.forEach(brush => { if (brush.editorGroupId === groupId) result.push({ type: 'brush', entity, brush }); });
      entity.patches.forEach(patch => { if (patch.editorGroupId === groupId) result.push({ type: 'patch', entity, patch }); });
    });
    return result;
  }
  const match = /^E(\d+)(?::B(\d+)(?::F(\d+))?|:P(\d+))?$/.exec(ref);
  if (!match) return [];
  const entity = editor.entities[Number(match[1])];
  if (!entity) return [];
  if (match[4] !== undefined) {
    const patch = entity.patches[Number(match[4])];
    return patch ? [{ type: 'patch', entity, patch }] : [];
  }
  if (match[2] !== undefined) {
    const brush = entity.brushes[Number(match[2])];
    if (!brush) return [];
    if (match[3] !== undefined) {
      const face = brush.faces[Number(match[3])];
      return face ? [{ type: 'face', entity, brush, face }] : [];
    }
    return [{ type: 'brush', entity, brush }];
  }
  return [{ type: 'entity', entity }];
}

function allPositionalItems(editor: Editor): SelectionItem[] {
  const result: SelectionItem[] = [];
  editor.entities.forEach(entity => {
    result.push({ type: 'entity', entity });
    entity.brushes.forEach(brush => {
      result.push({ type: 'brush', entity, brush });
      brush.faces.forEach(face => result.push({ type: 'face', entity, brush, face }));
    });
    entity.patches.forEach(patch => result.push({ type: 'patch', entity, patch }));
  });
  return result;
}

function resolvePersistentRef(editor: Editor, encodedRef: string): SelectionItem[] | null {
  const match = /^O([EBPF]):(.+)$/.exec(encodedRef);
  if (!match) return null;
  let objectId: string;
  try { objectId = decodeURIComponent(match[2]); } catch { objectId = match[2]; }
  const matches = allPositionalItems(editor).filter(item => {
    if (match[1] === 'E') return item.type === 'entity' && entityObjectId(item.entity) === objectId;
    if (match[1] === 'B') return item.type === 'brush' && item.brush.editorObjectId === objectId;
    if (match[1] === 'P') return item.type === 'patch' && item.patch.editorObjectId === objectId;
    return item.type === 'face' && item.face.editorObjectId === objectId;
  });
  return matches.length === 1 ? matches : [];
}

function resolveRef(editor: Editor, encodedRef: string): SelectionItem[] {
  const persistent = resolvePersistentRef(editor, encodedRef);
  if (persistent) return persistent;
  const [ref, expectedSignature] = encodedRef.split(SIGNATURE_SEPARATOR, 2);
  if (!expectedSignature) return resolvePositionalRef(editor, ref);
  const matches = allPositionalItems(editor).filter(item => itemSignature(item) === expectedSignature);
  return matches.length === 1 ? matches : [];
}

function setSelection(editor: Editor, refs: string[]): void {
  editor.selection = refs.flatMap(ref => resolveRef(editor, ref));
  editor.redrawRequested = true;
  if (editor.selection.length > 0) editor.centerOnSelection();
}

function hiddenRefs(editor: Editor, persistent = false): string[] {
  if (persistent) deduplicateEditorObjectIds(editor.entities);
  const refs: string[] = [];
  editor.entities.forEach((entity, entityIndex) => {
    if (editor.hiddenEntities.has(entity)) {
      const item: SelectionItem = { type: 'entity', entity };
      const ref = `E${entityIndex}`;
      refs.push(persistent ? persistentRef(item) : ref);
    }
    entity.brushes.forEach((brush, brushIndex) => {
      if (!editor.hiddenBrushes.has(brush)) return;
      const item: SelectionItem = { type: 'brush', entity, brush };
      const ref = `E${entityIndex}:B${brushIndex}`;
      refs.push(persistent ? persistentRef(item) : ref);
    });
    entity.patches.forEach((patch, patchIndex) => {
      if (!editor.hiddenPatches.has(patch)) return;
      const item: SelectionItem = { type: 'patch', entity, patch };
      const ref = `E${entityIndex}:P${patchIndex}`;
      refs.push(persistent ? persistentRef(item) : ref);
    });
  });
  return refs;
}

function applyHiddenRefs(editor: Editor, refs: string[]): void {
  editor.hiddenEntities.clear(); editor.hiddenBrushes.clear(); editor.hiddenPatches.clear();
  for (const ref of refs) for (const item of resolveRef(editor, ref)) {
    if (item.type === 'entity') editor.hiddenEntities.add(item.entity);
    else if (item.type === 'patch') editor.hiddenPatches.add(item.patch);
    else editor.hiddenBrushes.add(item.brush);
  }
}

function groupIdForObject(entity: Editor['entities'][number], object?: { editorGroupId?: string }): string | null {
  return object?.editorGroupId ?? entity.properties._q3edit_group_id ?? null;
}

function areaForGroup(editor: Editor): Map<string, string> {
  return new Map(readSpatialPlan(editor.worldspawn.properties).areas.flatMap(area => area.groupId ? [[area.groupId, area.id] as const] : []));
}

function connectionForGroup(editor: Editor): Map<string, string> {
  return new Map(readSpatialPlan(editor.worldspawn.properties).connections.flatMap(connection =>
    connection.groupId ? [[connection.groupId, connection.id] as const] : []));
}

function diagnosticRefs(editor: Editor): Set<string> {
  const refs = new Set<string>();
  for (const diagnostic of collectEditorDiagnostics(editor)) {
    const target = diagnostic.target;
    if (!target) continue;
    refs.add(target.kind === 'entity' ? `E${target.entityIndex}`
      : target.kind === 'brush' ? `E${target.entityIndex}:B${target.brushIndex}`
        : `E${target.entityIndex}:P${target.patchIndex}`);
  }
  return refs;
}

export function collectFilterObjects(editor: Editor): FilteredObject[] {
  const areaByGroup = areaForGroup(editor);
  const connectionByGroup = connectionForGroup(editor);
  const diagnostics = diagnosticRefs(editor);
  const result: FilteredObject[] = [];
  editor.entities.forEach((entity, entityIndex) => {
    if (entity.classname === 'group_info') return;
    const entityRef = `E${entityIndex}`;
    const entityGroup = groupIdForObject(entity);
    result.push({
      ref: entityRef, kind: 'entity', classname: entity.classname, texture: null, groupId: entityGroup,
      areaId: entityGroup ? areaByGroup.get(entityGroup) ?? null : null,
      connectionId: entityGroup ? connectionByGroup.get(entityGroup) ?? null : null, structural: null,
      visible: !editor.hiddenEntities.has(entity) && !isObjectInHiddenGroup(editor, entity),
      hasDiagnostic: diagnostics.has(entityRef),
    });
    entity.brushes.forEach((brush, brushIndex) => {
      const brushRef = `${entityRef}:B${brushIndex}`;
      const groupId = groupIdForObject(entity, brush);
      const visible = !editor.hiddenEntities.has(entity) && !editor.hiddenBrushes.has(brush) &&
        !isObjectInHiddenGroup(editor, brush, entity);
      const structural = !brush.faces.some(face => (face.contentFlags & CONTENTS_DETAIL) !== 0);
      result.push({
        ref: brushRef, kind: 'brush', classname: entity.classname, texture: null, groupId,
        areaId: groupId ? areaByGroup.get(groupId) ?? null : null,
        connectionId: groupId ? connectionByGroup.get(groupId) ?? null : null, structural, visible, hasDiagnostic: diagnostics.has(brushRef),
      });
      brush.faces.forEach((face, faceIndex) => result.push({
        ref: `${brushRef}:F${faceIndex}`, kind: 'face', classname: entity.classname, texture: face.texture, groupId,
        areaId: groupId ? areaByGroup.get(groupId) ?? null : null,
        connectionId: groupId ? connectionByGroup.get(groupId) ?? null : null, structural, visible, hasDiagnostic: diagnostics.has(brushRef),
      }));
    });
    entity.patches.forEach((patch, patchIndex) => {
      const ref = `${entityRef}:P${patchIndex}`;
      const groupId = groupIdForObject(entity, patch);
      result.push({
        ref, kind: 'patch', classname: entity.classname, texture: patch.texture, groupId,
        areaId: groupId ? areaByGroup.get(groupId) ?? null : null,
        connectionId: groupId ? connectionByGroup.get(groupId) ?? null : null,
        structural: (patch.contentFlags & CONTENTS_DETAIL) === 0,
        visible: !editor.hiddenEntities.has(entity) && !editor.hiddenPatches.has(patch) &&
          !isObjectInHiddenGroup(editor, patch, entity),
        hasDiagnostic: diagnostics.has(ref),
      });
    });
  });
  return result;
}

export function applyObjectFilter(objects: FilteredObject[], filter: ObjectFilter): FilteredObject[] {
  return objects.filter(object => {
    if (!filter.kinds.includes(object.kind)) return false;
    const tests: boolean[] = [];
    if (filter.classname) tests.push(object.classname.toLowerCase().includes(filter.classname.toLowerCase()));
    if (filter.texture) tests.push(object.texture?.toLowerCase().includes(filter.texture.toLowerCase()) ?? false);
    if (filter.groupId) tests.push(object.groupId === filter.groupId);
    if (filter.areaId) tests.push(object.areaId === filter.areaId);
    if (filter.connectionId) tests.push(object.connectionId === filter.connectionId);
    if (filter.structural !== 'all') tests.push(object.structural === (filter.structural === 'structural'));
    if (filter.visibility !== 'all') tests.push(object.visible === (filter.visibility === 'visible'));
    if (filter.diagnostic !== 'all') tests.push(object.hasDiagnostic === (filter.diagnostic === 'with-issues'));
    return tests.length === 0 || (filter.combine === 'and' ? tests.every(Boolean) : tests.some(Boolean));
  });
}

export class MapOrganizationController {
  private isolateSnapshot: VisibilityPreset | null = null;
  private recentSelections: string[][] = [];
  private recentSelectionIndex = -1;
  private recentLocations: NavigationState[] = [];
  private recentLocationIndex = -1;
  private diagnosticIndex = -1;
  private lastSelectionSignature = '';
  private lastLocationAt = 0;

  constructor(
    readonly editor: Editor,
    private readonly captureNavigation: () => NavigationState,
    private readonly restoreNavigation: (state: NavigationState) => void,
  ) {}

  data(): OrganizationData { return readOrganization(this.editor); }

  saveSelectionSet(name: string, groupId?: string): void {
    if (!name.trim() || (!groupId && this.editor.selection.length === 0)) return;
    this.editor.transact('Save selection set', () => {
      const refs = groupId ? [`G:${groupId}`] : selectionRefs(this.editor, true);
      if (refs.length === 0) return;
      const data = this.data();
      data.selectionSets.push({ id: id('selection'), name: name.trim(), refs });
      this.editor.worldspawn.properties[ORGANIZATION_KEY] = JSON.stringify(data);
    });
  }

  restoreSelectionSet(set: SelectionSet): void { setSelection(this.editor, set.refs); }

  deleteSelectionSet(idValue: string): void {
    const data = this.data(); data.selectionSets = data.selectionSets.filter(item => item.id !== idValue);
    writeOrganization(this.editor, 'Delete selection set', data);
  }

  saveVisibilityPreset(name: string): void {
    if (!name.trim()) return;
    this.editor.transact('Save visibility preset', () => {
      const data = this.data();
      data.visibilityPresets.push({
        id: id('visibility'), name: name.trim(), hiddenRefs: hiddenRefs(this.editor, true),
        groups: listNamedGroups(this.editor.entities).map(group => ({ id: group.id, hidden: group.hidden, locked: group.locked })),
      });
      this.editor.worldspawn.properties[ORGANIZATION_KEY] = JSON.stringify(data);
    });
  }

  applyVisibilityPreset(preset: VisibilityPreset): void {
    this.editor.transact('Apply visibility preset', () => {
      applyHiddenRefs(this.editor, preset.hiddenRefs);
      const states = new Map(preset.groups.map(item => [item.id, item]));
      for (const group of listNamedGroups(this.editor.entities)) {
        const state = states.get(group.id);
        if (state?.hidden) group.entity.properties[GROUP_HIDDEN_KEY] = '1'; else delete group.entity.properties[GROUP_HIDDEN_KEY];
        if (state?.locked) group.entity.properties[GROUP_LOCKED_KEY] = '1'; else delete group.entity.properties[GROUP_LOCKED_KEY];
      }
      this.editor.selection = [];
      this.editor.redrawRequested = true;
    });
  }

  deleteVisibilityPreset(idValue: string): void {
    const data = this.data(); data.visibilityPresets = data.visibilityPresets.filter(item => item.id !== idValue);
    writeOrganization(this.editor, 'Delete visibility preset', data);
  }

  isolateSelection(): void {
    if (this.editor.selection.length === 0 || this.isolateSnapshot) return;
    this.isolateSnapshot = {
      id: 'isolate', name: 'Before isolate', hiddenRefs: hiddenRefs(this.editor, true),
      groups: listNamedGroups(this.editor.entities).map(group => ({ id: group.id, hidden: group.hidden, locked: group.locked })),
    };
    const keepItems = new Set(this.editor.selection.map(item =>
      item.type === 'face' ? item.brush : item.type === 'entity' ? item.entity : item.type === 'patch' ? item.patch : item.brush));
    this.editor.hiddenEntities.clear(); this.editor.hiddenBrushes.clear(); this.editor.hiddenPatches.clear();
    this.editor.entities.forEach(entity => {
      if (entity.classname === 'group_info') return;
      if (keepItems.has(entity)) return;
      let visibleChild = false;
      entity.brushes.forEach(brush => {
        if (keepItems.has(brush)) visibleChild = true; else this.editor.hiddenBrushes.add(brush);
      });
      entity.patches.forEach(patch => {
        if (keepItems.has(patch)) visibleChild = true; else this.editor.hiddenPatches.add(patch);
      });
      if (!visibleChild && entity.brushes.length === 0 && entity.patches.length === 0) this.editor.hiddenEntities.add(entity);
    });
    this.editor.redrawRequested = true;
  }

  restoreIsolate(): void {
    if (!this.isolateSnapshot) return;
    this.applyVisibilityPreset(this.isolateSnapshot);
    this.isolateSnapshot = null;
  }

  get canRestoreIsolate(): boolean { return this.isolateSnapshot !== null; }

  saveFilterPreset(name: string, filter: ObjectFilter): void {
    if (!name.trim()) return;
    const data = this.data();
    data.filterPresets.push({ id: id('filter'), name: name.trim(), filter: structuredClone(filter) });
    writeOrganization(this.editor, 'Save object filter', data);
  }

  deleteFilterPreset(idValue: string): void {
    const data = this.data(); data.filterPresets = data.filterPresets.filter(item => item.id !== idValue);
    writeOrganization(this.editor, 'Delete object filter', data);
  }

  saveBookmark(name: string, areaId?: string, groupId?: string): void {
    if (!name.trim()) return;
    const data = this.data();
    data.bookmarks.push({ id: id('bookmark'), name: name.trim(), areaId: areaId || undefined, groupId: groupId || undefined, navigation: this.captureNavigation() });
    writeOrganization(this.editor, 'Save camera bookmark', data);
  }

  restoreBookmark(bookmark: CameraBookmark): void { this.restoreNavigation(bookmark.navigation); }

  deleteBookmark(idValue: string): void {
    const data = this.data(); data.bookmarks = data.bookmarks.filter(item => item.id !== idValue);
    writeOrganization(this.editor, 'Delete camera bookmark', data);
  }

  observe(): void {
    const refs = selectionRefs(this.editor);
    const signature = refs.join('|');
    if (refs.length > 0 && signature !== this.lastSelectionSignature) {
      this.recentSelections = [refs, ...this.recentSelections.filter(item => item.join('|') !== signature)].slice(0, 20);
      this.recentSelectionIndex = -1;
      this.lastSelectionSignature = signature;
    }
    const now = Date.now();
    if (now - this.lastLocationAt < 1000) return;
    this.lastLocationAt = now;
    const state = this.captureNavigation();
    const last = this.recentLocations[0];
    if (!last || Math.hypot(...state.camera3d.position.map((value, axis) => value - last.camera3d.position[axis])) > 192) {
      this.recentLocations.unshift(state);
      this.recentLocations = this.recentLocations.slice(0, 20);
      this.recentLocationIndex = -1;
    }
  }

  navigateRecentSelection(direction: -1 | 1): void {
    if (this.recentSelections.length === 0) return;
    this.recentSelectionIndex = Math.max(0, Math.min(this.recentSelections.length - 1, this.recentSelectionIndex + direction));
    setSelection(this.editor, this.recentSelections[this.recentSelectionIndex]);
  }

  navigateRecentLocation(direction: -1 | 1): void {
    if (this.recentLocations.length === 0) return;
    this.recentLocationIndex = Math.max(0, Math.min(this.recentLocations.length - 1, this.recentLocationIndex + direction));
    this.restoreNavigation(this.recentLocations[this.recentLocationIndex]);
  }

  navigateDiagnostic(direction: -1 | 1): void {
    const refs = collectEditorDiagnostics(this.editor).flatMap(diagnostic => {
      const target = diagnostic.target;
      if (!target) return [];
      if (target.kind === 'entity') return [`E${target.entityIndex}`];
      if (target.kind === 'patch') return [`E${target.entityIndex}:P${target.patchIndex}`];
      return [`E${target.entityIndex}:B${target.brushIndex}`];
    });
    const unique = [...new Set(refs)];
    if (unique.length === 0) return;
    this.diagnosticIndex = (this.diagnosticIndex + direction + unique.length) % unique.length;
    setSelection(this.editor, [unique[this.diagnosticIndex]]);
  }

  selectRefs(refs: string[]): void { setSelection(this.editor, refs); }

  newFilter(): ObjectFilter { return structuredClone(DEFAULT_FILTER); }
}
