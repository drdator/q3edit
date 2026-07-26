import { computeFaceUV, type Brush } from './brush';
import { clonePatch, tessellatePatch, type Patch } from './patch';

export interface ObjExportGeometry {
  name: string;
  brushes: readonly Brush[];
  patches: readonly Patch[];
}

export interface ObjExportOptions {
  subdivisions: number;
  materialLibrary?: string;
  textureSize?: (texture: string) => { width: number; height: number } | null;
}

export interface ObjExportResult {
  obj: string;
  mtl: string;
  triangleCount: number;
  materialCount: number;
}

function materialName(texture: string): string {
  return texture.replace(/^textures\//i, '').replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'material';
}

export function exportGeometryObj(
  groups: readonly ObjExportGeometry[],
  options: ObjExportOptions,
): ObjExportResult {
  const lines = ['# Exported by Q3Edit'];
  if (options.materialLibrary) lines.push(`mtllib ${options.materialLibrary}`);
  const materials = new Map<string, string>();
  let vertexIndex = 1;
  let triangleCount = 0;
  let currentMaterial = '';

  const triangle = (
    texture: string,
    vertices: Array<{ position: [number, number, number]; normal: [number, number, number]; uv: [number, number] }>,
  ): void => {
    const baseMaterial = materialName(texture);
    let material = baseMaterial;
    let suffix = 2;
    while (materials.has(material) && materials.get(material) !== texture) material = `${baseMaterial}_${suffix++}`;
    materials.set(material, texture);
    if (material !== currentMaterial) {
      lines.push(`usemtl ${material}`);
      currentMaterial = material;
    }
    for (const vertex of vertices) {
      lines.push(`v ${vertex.position[0]} ${vertex.position[1]} ${vertex.position[2]}`);
      lines.push(`vt ${vertex.uv[0]} ${1 - vertex.uv[1]}`);
      lines.push(`vn ${vertex.normal[0]} ${vertex.normal[1]} ${vertex.normal[2]}`);
    }
    lines.push(`f ${vertexIndex}/${vertexIndex}/${vertexIndex} ${vertexIndex + 1}/${vertexIndex + 1}/${vertexIndex + 1} ${vertexIndex + 2}/${vertexIndex + 2}/${vertexIndex + 2}`);
    vertexIndex += 3;
    triangleCount++;
  };

  for (const group of groups) {
    lines.push(`g ${group.name.replace(/[^a-zA-Z0-9_.-]+/g, '_')}`);
    for (const brush of group.brushes) {
      for (const face of brush.faces) {
        if (face.polygon.length < 3) continue;
        const size = options.textureSize?.(face.texture) ?? { width: 128, height: 128 };
        for (let index = 1; index < face.polygon.length - 1; index++) {
          triangle(face.texture, [face.polygon[0], face.polygon[index], face.polygon[index + 1]].map(position => ({
            position,
            normal: face.plane.normal,
            uv: computeFaceUV(position, face, size.width, size.height),
          })));
        }
      }
    }
    for (const source of group.patches) {
      const patch = clonePatch(source);
      tessellatePatch(patch, Math.max(1, Math.min(32, Math.round(options.subdivisions))));
      for (let index = 0; index < patch.tessIndices.length; index += 3) {
        triangle(patch.texture, [
          patch.tessVerts[patch.tessIndices[index]],
          patch.tessVerts[patch.tessIndices[index + 1]],
          patch.tessVerts[patch.tessIndices[index + 2]],
        ]);
      }
    }
  }

  const mtl = [...materials].map(([material, texture]) =>
    `newmtl ${material}\n# Q3 texture/shader: ${texture}\nKd 1 1 1\nKa 0 0 0\n`).join('\n');
  return {
    obj: `${lines.join('\n')}\n`,
    mtl,
    triangleCount,
    materialCount: materials.size,
  };
}
