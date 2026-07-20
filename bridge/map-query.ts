import type { Brush } from '../src/brush';
import { entityOrigin, type Entity } from '../src/entity';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { vec3Max, vec3Min, type Vec3 } from '../src/math';
import type { Patch } from '../src/patch';

export interface MapQueryOptions {
  kind?: 'entity' | 'brush' | 'patch';
  classname?: string;
  texture?: string;
  propertyKey?: string;
  propertyValue?: string;
  bounds?: { mins: Vec3; maxs: Vec3; mode?: 'intersects' | 'inside' };
  limit?: number;
}

type Bounds = { mins: Vec3; maxs: Vec3 };

function entityGeometryBounds(entity: Entity): Bounds | null {
  let mins: Vec3 = [Infinity, Infinity, Infinity];
  let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const object of [...entity.brushes, ...entity.patches]) {
    mins = vec3Min(mins, object.mins);
    maxs = vec3Max(maxs, object.maxs);
    found = true;
  }
  if (found) return { mins, maxs };
  const origin = entityOrigin(entity);
  return origin ? { mins: origin, maxs: origin } : null;
}

function matchesBounds(object: Bounds | null, query: MapQueryOptions['bounds']): boolean {
  if (!query) return true;
  if (!object) return false;
  if (query.mode === 'inside') {
    return object.mins.every((value, axis) => value >= query.mins[axis]) &&
      object.maxs.every((value, axis) => value <= query.maxs[axis]);
  }
  return object.maxs.every((value, axis) => value >= query.mins[axis]) &&
    object.mins.every((value, axis) => value <= query.maxs[axis]);
}

function objectTextures(object: Entity | Brush | Patch): string[] {
  if ('classname' in object) {
    return [...new Set([
      ...object.brushes.flatMap(brush => brush.faces.map(face => face.texture)),
      ...object.patches.map(patch => patch.texture),
    ])];
  }
  if ('faces' in object) return [...new Set(object.faces.map(face => face.texture))];
  return [object.texture];
}

function matchesTexture(object: Entity | Brush | Patch, texture: string | undefined): boolean {
  if (!texture) return true;
  const query = texture.toLowerCase();
  return objectTextures(object).some(value => value.toLowerCase().includes(query));
}

export function queryMap(mapText: string, options: MapQueryOptions): unknown[] {
  const parsed = parseMapWithDiagnostics(mapText);
  const results: unknown[] = [];
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const classname = options.classname?.toLowerCase();

  for (let entityIndex = 0; entityIndex < parsed.document.entities.length && results.length < limit; entityIndex++) {
    const entity = parsed.document.entities[entityIndex];
    const classMatches = !classname || entity.classname.toLowerCase() === classname;
    const propertyMatches = !options.propertyKey || (
      Object.prototype.hasOwnProperty.call(entity.properties, options.propertyKey) &&
      (options.propertyValue === undefined || entity.properties[options.propertyKey].toLowerCase().includes(options.propertyValue.toLowerCase()))
    );

    if ((!options.kind || options.kind === 'entity') && classMatches && propertyMatches &&
        matchesTexture(entity, options.texture) && matchesBounds(entityGeometryBounds(entity), options.bounds)) {
      results.push({
        ref: `E${entityIndex}`,
        kind: 'entity',
        classname: entity.classname,
        origin: entityOrigin(entity),
        bounds: entityGeometryBounds(entity),
        properties: entity.properties,
        brushCount: entity.brushes.length,
        patchCount: entity.patches.length,
        textures: objectTextures(entity),
      });
    }

    if (!classMatches || !propertyMatches || options.kind === 'entity') continue;
    for (let brushIndex = 0; brushIndex < entity.brushes.length && results.length < limit; brushIndex++) {
      const brush = entity.brushes[brushIndex];
      if (options.kind && options.kind !== 'brush') continue;
      if (!matchesTexture(brush, options.texture) || !matchesBounds(brush, options.bounds)) continue;
      results.push({
        ref: `E${entityIndex}:B${brushIndex}`,
        kind: 'brush',
        entity: `E${entityIndex}`,
        classname: entity.classname,
        bounds: { mins: brush.mins, maxs: brush.maxs },
        faceCount: brush.faces.length,
        textures: objectTextures(brush),
      });
    }
    for (let patchIndex = 0; patchIndex < entity.patches.length && results.length < limit; patchIndex++) {
      const patch = entity.patches[patchIndex];
      if (options.kind && options.kind !== 'patch') continue;
      if (!matchesTexture(patch, options.texture) || !matchesBounds(patch, options.bounds)) continue;
      results.push({
        ref: `E${entityIndex}:P${patchIndex}`,
        kind: 'patch',
        entity: `E${entityIndex}`,
        classname: entity.classname,
        bounds: { mins: patch.mins, maxs: patch.maxs },
        width: patch.width,
        height: patch.height,
        textures: objectTextures(patch),
      });
    }
  }
  return results;
}
