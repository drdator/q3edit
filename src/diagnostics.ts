import { validateBrush, type Brush } from './brush';
import type { Editor } from './editor';
import type { Entity } from './entity';
import { entityOrigin } from './entity';
import { getEntityClassRegistry } from './entity-definitions';
import { isTerrainMesh, validateTerrainMesh } from './terrain-model';
import { listNamedGroups } from './named-groups';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticTarget =
  | { kind: 'entity'; entityIndex: number }
  | { kind: 'brush'; entityIndex: number; brushIndex: number }
  | { kind: 'patch'; entityIndex: number; patchIndex: number };

export interface EditorDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  target?: DiagnosticTarget;
  line?: number;
  column?: number;
}

export interface MapInfo {
  entities: number;
  brushes: number;
  patches: number;
  terrain: number;
  textures: number;
  groups: number;
  unsupportedConstructs: number;
  diagnostics: { errors: number; warnings: number; info: number };
  entityClasses: Array<{ classname: string; count: number }>;
}

export interface EntityInfo {
  id: string;
  index: number;
  classname: string;
  propertyCount: number;
  brushCount: number;
  patchCount: number;
  targetname?: string;
  target?: string;
  diagnostics: EditorDiagnostic[];
}

export interface DocumentObjectReference {
  id: string;
  entityIndex: number;
  entity: Entity;
  brushIndex?: number;
  brush?: Brush;
}

export function entityId(entityIndex: number): string { return `E${entityIndex}`; }
export function brushId(entityIndex: number, brushIndex: number): string { return `E${entityIndex}:B${brushIndex}`; }

export function documentObjectReferences(editor: Pick<Editor, 'entities'>): DocumentObjectReference[] {
  const result: DocumentObjectReference[] = [];
  editor.entities.forEach((entity, entityIndex) => {
    result.push({ id: entityId(entityIndex), entityIndex, entity });
    entity.brushes.forEach((brush, brushIndex) => result.push({
      id: brushId(entityIndex, brushIndex), entityIndex, entity, brushIndex, brush,
    }));
  });
  return result;
}

export function findDocumentObject(editor: Pick<Editor, 'entities'>, query: string): DocumentObjectReference | null {
  const numeric = query.trim().match(/^(?:E|ENTITY)?\s*(\d+)\s*(?:[:/, -]\s*(?:B|BRUSH)?\s*(\d+))?$/i);
  if (!numeric) return null;
  const entityIndex = Number(numeric[1]);
  const brushIndex = numeric[2] === undefined ? undefined : Number(numeric[2]);
  const entity = editor.entities[entityIndex];
  if (!entity) return null;
  if (brushIndex === undefined) return { id: entityId(entityIndex), entityIndex, entity };
  const brush = entity.brushes[brushIndex];
  return brush ? { id: brushId(entityIndex, brushIndex), entityIndex, entity, brushIndex, brush } : null;
}

function targetForEntity(entityIndex: number): DiagnosticTarget { return { kind: 'entity', entityIndex }; }

export function collectEditorDiagnostics(editor: Editor): EditorDiagnostic[] {
  const result: EditorDiagnostic[] = editor.mapDiagnostics.map(diagnostic => ({
    severity: diagnostic.severity,
    code: 'map-parse',
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
  }));
  for (const unsupported of editor.unsupportedMapConstructs) {
    result.push({
      severity: 'warning', code: 'unsupported-construct',
      message: `${unsupported.keyword} at line ${unsupported.line} cannot be preserved when saving`,
      line: unsupported.line, column: unsupported.column,
    });
  }

  const targetOwners = new Map<string, number[]>();
  editor.entities.forEach((entity, entityIndex) => {
    const targetname = entity.properties.targetname?.trim();
    if (targetname) targetOwners.set(targetname, [...(targetOwners.get(targetname) ?? []), entityIndex]);
  });

  editor.entities.forEach((entity, entityIndex) => {
    const target = targetForEntity(entityIndex);
    if (!entity.classname.trim()) result.push({ severity: 'error', code: 'missing-classname', message: `${entityId(entityIndex)} has no classname`, target });
    else if (entity.classname !== 'worldspawn' && !getEntityClassRegistry().get(entity.classname)) result.push({ severity: 'info', code: 'unknown-class', message: `${entityId(entityIndex)} uses undocumented class ${entity.classname}`, target });
    if (entity.properties.classname !== entity.classname) {
      result.push({ severity: 'warning', code: 'classname-mismatch', message: `${entityId(entityIndex)} classname property does not match its class`, target });
    }
    if (entity.properties.origin && !entityOrigin(entity)) {
      result.push({ severity: 'error', code: 'invalid-origin', message: `${entityId(entityIndex)} has invalid origin '${entity.properties.origin}'`, target });
    }
    const linkedTarget = entity.properties.target?.trim();
    if (linkedTarget && !targetOwners.has(linkedTarget)) {
      result.push({ severity: 'warning', code: 'broken-target', message: `${entityId(entityIndex)} targets missing '${linkedTarget}'`, target });
    }

    entity.brushes.forEach((brush, brushIndex) => {
      const validation = validateBrush(brush);
      if (!validation.valid) result.push({
        severity: 'error', code: 'invalid-brush', target: { kind: 'brush', entityIndex, brushIndex },
        message: `${brushId(entityIndex, brushIndex)} is invalid: ${validation.issues.join('; ')}`,
      });
      if (editor.textureManager) {
        for (const texture of new Set(brush.faces.map(face => face.texture))) {
          if (!editor.textureManager.hasTextureSource(texture)) result.push({
            severity: 'warning', code: 'missing-texture', target: { kind: 'brush', entityIndex, brushIndex },
            message: `${brushId(entityIndex, brushIndex)} uses missing texture ${texture}`,
          });
        }
      }
    });
    entity.patches.forEach((patch, patchIndex) => {
      if (isTerrainMesh(patch)) {
        const validation = validateTerrainMesh(patch);
        if (!validation.valid) result.push({
          severity: 'error', code: 'invalid-terrain', target: { kind: 'patch', entityIndex, patchIndex },
          message: `E${entityIndex}:P${patchIndex} has invalid terrain data: ${validation.issues.join('; ')}`,
        });
      }
      if (editor.textureManager && !editor.textureManager.hasTextureSource(patch.texture)) result.push({
        severity: 'warning', code: 'missing-texture', target: { kind: 'patch', entityIndex, patchIndex },
        message: `E${entityIndex}:P${patchIndex} uses missing texture ${patch.texture}`,
      });
    });

    const requestedModel = entity.properties.model || getEntityClassRegistry().get(entity.classname)?.model;
    if (requestedModel && editor.modelManager && !editor.modelManager.resolveEntity(entity)) {
      result.push({
        severity: 'warning', code: 'missing-model', message: `${entityId(entityIndex)} cannot load model ${requestedModel}`, target,
      });
    }
  });

  for (const [name, indices] of targetOwners) {
    if (indices.length < 2) continue;
    for (const entityIndex of indices) result.push({
      severity: 'warning', code: 'duplicate-targetname', target: targetForEntity(entityIndex),
      message: `${entityId(entityIndex)} shares targetname '${name}' with ${indices.length - 1} other ${indices.length === 2 ? 'entity' : 'entities'}`,
    });
  }
  return result;
}

export function collectMapInfo(editor: Editor, diagnostics = collectEditorDiagnostics(editor)): MapInfo {
  const textures = new Set<string>();
  let brushes = 0, patches = 0, terrain = 0;
  const classes = new Map<string, number>();
  for (const entity of editor.entities) {
    classes.set(entity.classname, (classes.get(entity.classname) ?? 0) + 1);
    brushes += entity.brushes.length;
    patches += entity.patches.length;
    for (const brush of entity.brushes) for (const face of brush.faces) textures.add(face.texture.toLowerCase());
    for (const patch of entity.patches) { textures.add(patch.texture.toLowerCase()); if (isTerrainMesh(patch)) terrain++; }
  }
  return {
    entities: editor.entities.length, brushes, patches, terrain, textures: textures.size,
    groups: listNamedGroups(editor.entities).length,
    unsupportedConstructs: editor.unsupportedMapConstructs.length,
    diagnostics: {
      errors: diagnostics.filter(item => item.severity === 'error').length,
      warnings: diagnostics.filter(item => item.severity === 'warning').length,
      info: diagnostics.filter(item => item.severity === 'info').length,
    },
    entityClasses: [...classes].map(([classname, count]) => ({ classname, count })).sort((a, b) => a.classname.localeCompare(b.classname)),
  };
}

export function collectEntityInfo(editor: Editor, diagnostics = collectEditorDiagnostics(editor)): EntityInfo[] {
  return editor.entities.map((entity, index) => ({
    id: entityId(index), index, classname: entity.classname,
    propertyCount: Object.keys(entity.properties).length,
    brushCount: entity.brushes.length, patchCount: entity.patches.length,
    targetname: entity.properties.targetname, target: entity.properties.target,
    diagnostics: diagnostics.filter(item => item.target?.entityIndex === index),
  }));
}

export function navigateToDiagnostic(editor: Editor, diagnostic: Pick<EditorDiagnostic, 'target'>): boolean {
  const target = diagnostic.target;
  if (!target) return false;
  const entity = editor.entities[target.entityIndex];
  if (!entity) return false;
  if (target.kind === 'entity') editor.selectEntity(entity);
  else if (target.kind === 'brush') {
    const brush = entity.brushes[target.brushIndex]; if (!brush) return false;
    editor.selectBrushDirect(entity, brush);
  } else {
    const patch = entity.patches[target.patchIndex]; if (!patch) return false;
    editor.selectPatchDirect(entity, patch);
  }
  editor.centerOnSelection();
  return true;
}
