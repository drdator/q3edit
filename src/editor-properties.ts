import { classicTextureProjection, type BrushFace, type ClassicBrushTextureProjection } from './brush';
import type { Editor } from './editor';
import type { Entity } from './entity';
import type { EntityPropertyType } from './entity-definitions';

export type FacePropertyChanges = Partial<Pick<BrushFace,
  | 'texture'
  | 'contentFlags'
  | 'surfaceFlags'
  | 'value'
> & Omit<ClassicBrushTextureProjection, 'kind'>>;

const PROJECTION_FIELDS = new Set<keyof ClassicBrushTextureProjection>([
  'offsetX',
  'offsetY',
  'rotation',
  'scaleX',
  'scaleY',
]);

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function objectId(value: object): number {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
}

export function setEntityClassname(editor: Editor, entity: Entity, classname: string): boolean {
  const nextClassname = classname.trim();
  if (!nextClassname) return false;
  editor.transact('Change entity classname', () => {
    entity.classname = nextClassname;
    entity.properties.classname = nextClassname;
  });
  return true;
}

export function renameEntityProperty(
  editor: Editor,
  entity: Entity,
  currentKey: string,
  newKey: string,
): boolean {
  const nextKey = newKey.trim();
  if (!nextKey || nextKey === currentKey || nextKey in entity.properties) return false;
  if (!(currentKey in entity.properties)) return false;

  editor.transact('Rename entity property', () => {
    entity.properties[nextKey] = entity.properties[currentKey];
    delete entity.properties[currentKey];
  });
  return true;
}

export function setEntityProperty(editor: Editor, entity: Entity, key: string, value: string): void {
  editor.transact('Edit entity property', () => {
    entity.properties[key] = value;
  }, {
    coalesceKey: `entity-property:${objectId(entity)}:${key}`,
  });
}

export function setTypedEntityProperty(
  editor: Editor,
  entity: Entity,
  key: string,
  value: string,
  _type: EntityPropertyType,
): void {
  editor.transact('Edit entity property', () => {
    entity.properties[key] = value;
    if (entity.classname === 'misc_model' && key === 'angle') delete entity.properties.angles;
    if (entity.classname === 'misc_model' && key === 'angles') delete entity.properties.angle;
    if (entity.classname === 'misc_model' && key === 'modelscale') delete entity.properties.modelscale_vec;
    if (entity.classname === 'misc_model' && key === 'modelscale_vec') delete entity.properties.modelscale;
  }, {
    coalesceKey: `entity-property:${objectId(entity)}:${key}`,
  });
}

export function setEntitySpawnflag(
  editor: Editor,
  entity: Entity,
  bit: number,
  enabled: boolean,
): void {
  const current = Number.parseInt(entity.properties.spawnflags ?? '0', 10) || 0;
  const next = enabled ? (current | bit) : (current & ~bit);
  setEntityProperty(editor, entity, 'spawnflags', String(next));
}

export function removeEntityProperty(editor: Editor, entity: Entity, key: string): void {
  editor.transact('Remove entity property', () => {
    delete entity.properties[key];
  });
}

export function addEntityProperty(editor: Editor, entity: Entity): string {
  let n = 1;
  while (`key${n}` in entity.properties) n++;
  const key = `key${n}`;
  editor.transact('Add entity property', () => {
    entity.properties[key] = '';
  });
  return key;
}

export function updateFaceProperties(
  editor: Editor,
  faces: BrushFace[],
  label: string,
  changes: FacePropertyChanges,
): void {
  const ids = faces.map(face => objectId(face)).sort((a, b) => a - b).join(',');
  const fields = Object.keys(changes).sort().join(',');
  editor.transact(label, () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      for (const [field, value] of Object.entries(changes)) {
        if (PROJECTION_FIELDS.has(field as keyof ClassicBrushTextureProjection)) {
          if (projection) Object.assign(projection, { [field]: value });
        } else {
          Object.assign(face, { [field]: value });
        }
      }
    }
  }, {
    coalesceKey: `face-properties:${ids}:${fields}`,
  });
}

export function updateBrushPrimitiveMatrixEntry(
  editor: Editor,
  faces: BrushFace[],
  row: 0 | 1,
  column: 0 | 1 | 2,
  value: number,
): void {
  const primitiveFaces = faces.filter(face => face.textureProjection.kind === 'brush-primitive');
  if (primitiveFaces.length === 0) return;
  const ids = primitiveFaces.map(face => objectId(face)).sort((a, b) => a - b).join(',');
  editor.transact('Edit brush primitive matrix', () => {
    for (const face of primitiveFaces) {
      if (face.textureProjection.kind === 'brush-primitive') {
        face.textureProjection.matrix[row][column] = value;
      }
    }
  }, {
    coalesceKey: `brush-primitive-matrix:${ids}:${row}:${column}`,
  });
}
