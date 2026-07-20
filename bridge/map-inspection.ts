import { parseMapWithDiagnostics } from '../src/mapfile';
import type { MapDocumentRef } from '../src/map-operations';

export function inspectMapObjects(mapText: string, refs: MapDocumentRef[], includeGeometry = false): unknown[] {
  const parsed = parseMapWithDiagnostics(mapText);
  return refs.map(ref => {
    const match = /^E(\d+)(?::([BP])(\d+))?(?::F(\d+))?$/.exec(ref);
    if (!match) throw new Error(`Invalid object reference ${ref}`);
    const entityIndex = Number(match[1]);
    const entity = parsed.document.entities[entityIndex];
    if (!entity) throw new Error(`Entity ${ref} does not exist`);

    if (!match[2]) {
      return {
        ref,
        kind: 'entity',
        classname: entity.classname,
        properties: entity.properties,
        brushes: entity.brushes.map((_, index) => `E${entityIndex}:B${index}`),
        patches: entity.patches.map((_, index) => `E${entityIndex}:P${index}`),
      };
    }

    const objectIndex = Number(match[3]);
    if (match[2] === 'B') {
      const brush = entity.brushes[objectIndex];
      if (!brush) throw new Error(`Brush ${ref} does not exist`);
      if (match[4] !== undefined) {
        const face = brush.faces[Number(match[4])];
        if (!face) throw new Error(`Face ${ref} does not exist`);
        return {
          ref,
          kind: 'face',
          entity: `E${entityIndex}`,
          brush: `E${entityIndex}:B${objectIndex}`,
          texture: face.texture,
          textureProjection: face.textureProjection,
          contentFlags: face.contentFlags,
          surfaceFlags: face.surfaceFlags,
          value: face.value,
          plane: face.plane,
          ...(includeGeometry ? { points: face.points, polygon: face.polygon } : {}),
        };
      }
      return {
        ref,
        kind: 'brush',
        entity: `E${entityIndex}`,
        name: brush.name,
        mins: brush.mins,
        maxs: brush.maxs,
        properties: brush.properties,
        faceCount: brush.faces.length,
        textures: [...new Set(brush.faces.map(face => face.texture))],
        ...(includeGeometry ? {
          faces: brush.faces.map(face => ({
            points: face.points,
            texture: face.texture,
            textureProjection: face.textureProjection,
            contentFlags: face.contentFlags,
            surfaceFlags: face.surfaceFlags,
            value: face.value,
          })),
        } : {}),
      };
    }

    const patch = entity.patches[objectIndex];
    if (!patch) throw new Error(`Patch ${ref} does not exist`);
    return {
      ref,
      kind: 'patch',
      entity: `E${entityIndex}`,
      width: patch.width,
      height: patch.height,
      texture: patch.texture,
      mins: patch.mins,
      maxs: patch.maxs,
      properties: patch.properties,
      contentFlags: patch.contentFlags,
      surfaceFlags: patch.surfaceFlags,
      value: patch.value,
      ...(includeGeometry ? { controlPoints: patch.ctrl } : {}),
    };
  });
}
