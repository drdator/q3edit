import type { Vec3 } from './math';
import type { Entity } from './entity';
import { classicTextureProjection, type Brush, type BrushFace } from './brush';
import {
  type Patch,
  type TerrainDefSurface,
  syncTerrainDefMetadata,
} from './patch';
import { assertTerrainSerializable } from './terrain-model';

export {
  parseMap,
  parseMapWithDiagnostics,
  type MapParseDiagnostic,
  type MapParseDiagnosticSeverity,
  type MapParseResult,
  type ParsedMapDocument,
  type UnsupportedMapConstruct,
  type UnsupportedConstructPolicy,
} from './map-parser';

export function serializeMap(entities: Entity[]): string {
  const lines: string[] = [];

  for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
    const entity = entities[entityIndex];
    lines.push(`// entity ${entityIndex}`);
    lines.push('{');
    for (const [key, value] of Object.entries(entity.properties)) {
      lines.push(`${quoteMapString(key)} ${quoteMapString(value)}`);
    }

    for (let brushIndex = 0; brushIndex < entity.brushes.length; brushIndex++) {
      const brush = entity.brushes[brushIndex];
      lines.push(brush.name ? `// ${brush.name}` : `// brush ${brushIndex}`);
      lines.push('{');
      serializeBrush(lines, brush);
      lines.push('}');
    }

    for (let patchIndex = 0; patchIndex < entity.patches.length; patchIndex++) {
      const patch = entity.patches[patchIndex];
      if (patch.terrainDef) {
        syncTerrainDefMetadata(patch);
        assertTerrainSerializable(patch);
      }
      lines.push(`// patch ${patchIndex}`);
      lines.push('{');
      if (patch.terrainDef) {
        serializeTerrainDef(lines, patch);
      } else {
        serializePatchDef2(lines, patch);
      }
      lines.push('}');
    }
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

function serializeBrush(lines: string[], brush: Brush): void {
  const projectionKinds = new Set(brush.faces.map(face => face.textureProjection.kind));
  if (projectionKinds.size > 1) {
    throw new Error('Cannot serialize a brush containing mixed classic and brush-primitive projections');
  }
  if (projectionKinds.has('brush-primitive')) {
    serializeBrushDef(lines, brush);
    return;
  }
  if (brush.properties && Object.keys(brush.properties).length > 0) {
    throw new Error('Classic brush syntax cannot preserve brush-local properties');
  }
  for (const face of brush.faces) serializeClassicFace(lines, face);
}

function serializeClassicFace(lines: string[], face: BrushFace): void {
  const projection = classicTextureProjection(face);
  if (!projection) throw new Error('Expected a classic texture projection');
  const [point1, point2, point3] = face.points;
  lines.push(
    `${formatPoint(point1)} ${formatPoint(point3)} ${formatPoint(point2)} ` +
    `${face.texture} ${fmtNum(projection.offsetX)} ${fmtNum(projection.offsetY)} ` +
    `${fmtNum(projection.rotation)} ${fmtNum(projection.scaleX)} ${fmtNum(projection.scaleY)} ` +
    `${face.contentFlags} ${face.surfaceFlags} ${face.value}`,
  );
}

function serializeBrushDef(lines: string[], brush: Brush): void {
  lines.push('brushDef');
  lines.push('{');
  for (const [key, value] of Object.entries(brush.properties ?? {})) {
    lines.push(`${quoteMapString(key)} ${quoteMapString(value)}`);
  }
  for (const face of brush.faces) {
    if (face.textureProjection.kind !== 'brush-primitive') {
      throw new Error('Expected a brush-primitive texture projection');
    }
    const [point1, point2, point3] = face.points;
    const [row0, row1] = face.textureProjection.matrix;
    lines.push(
      `${formatPoint(point1)} ${formatPoint(point3)} ${formatPoint(point2)} ` +
      `( ( ${row0.map(fmtNum).join(' ')} ) ( ${row1.map(fmtNum).join(' ')} ) ) ` +
      `${face.texture} ${face.contentFlags} ${face.surfaceFlags} ${face.value}`,
    );
  }
  lines.push('}');
}

function formatPoint(value: Vec3): string {
  return `( ${fmtNum(value[0])} ${fmtNum(value[1])} ${fmtNum(value[2])} )`;
}

function serializePatchDef2(lines: string[], patch: Patch): void {
  lines.push('patchDef2');
  lines.push('{');
  lines.push(patch.texture);
  lines.push(`( ${patch.height} ${patch.width} ${patch.contentFlags} ${patch.surfaceFlags} ${patch.value} )`);
  lines.push('(');
  for (const row of patch.ctrl) {
    const points = row.map(controlPoint =>
      `( ${fmtNum(controlPoint.xyz[0])} ${fmtNum(controlPoint.xyz[1])} ${fmtNum(controlPoint.xyz[2])} ${fmtNum(controlPoint.uv[0])} ${fmtNum(controlPoint.uv[1])} )`,
    );
    lines.push(`( ${points.join(' ')} )`);
  }
  lines.push(')');
  lines.push('}');
}

function serializeTerrainDef(lines: string[], patch: Patch): void {
  const terrain = patch.terrainDef!;
  lines.push('terrainDef');
  lines.push('{');
  lines.push(`${fmtNum(patch.width)} ${fmtNum(patch.height)} ${fmtNum(terrain.scale[0])} ${fmtNum(terrain.scale[1])}`);
  lines.push(`${fmtNum(terrain.origin[0])} ${fmtNum(terrain.origin[1])} ${fmtNum(terrain.origin[2])}`);
  for (let row = 0; row < patch.height; row++) {
    for (let column = 0; column < patch.width; column++) {
      const controlPoint = patch.ctrl[row][column];
      const surface = terrain.surfaces[row]?.[column] ?? defaultTerrainSurface(patch);
      const height = controlPoint.xyz[2] - terrain.origin[2];
      lines.push(
        `${fmtNum(height)} ${surface.texture} ${fmtNum(surface.offsetX)} ${fmtNum(surface.offsetY)} ` +
        `${fmtNum(surface.rotation)} ${fmtNum(surface.scaleX)} ${fmtNum(surface.scaleY)} ` +
        `${surface.contentFlags} ${surface.surfaceFlags} ${surface.value}`,
      );
    }
  }
  lines.push('}');
}

function quoteMapString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function fmtNum(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function defaultTerrainSurface(patch: Patch): TerrainDefSurface {
  return {
    texture: patch.texture,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scaleX: 0.5,
    scaleY: 0.5,
    contentFlags: patch.contentFlags,
    surfaceFlags: patch.surfaceFlags,
    value: patch.value,
  };
}
