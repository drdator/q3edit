import { entityOrigin, type Entity } from './entity';
import type { MapDocumentRef } from './map-operations';

export interface StructuredCompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: 'missing-shader-image' | 'expected-tool-shader' | 'compiler-warning' | 'compiler-error' | 'compiler-memory' | 'leak';
  message: string;
  refs: MapDocumentRef[];
  stage?: 'bsp' | 'vis' | 'light';
}

function textureRefs(entities: readonly Entity[], texture: string): MapDocumentRef[] {
  const normalized = texture.toLowerCase().replace(/^textures\//, '');
  const refs: MapDocumentRef[] = [];
  entities.forEach((entity, entityIndex) => {
    entity.brushes.forEach((brush, brushIndex) => brush.faces.forEach((face, faceIndex) => {
      if (face.texture.toLowerCase().replace(/^textures\//, '') === normalized) refs.push(`E${entityIndex}:B${brushIndex}:F${faceIndex}`);
    }));
    entity.patches.forEach((patch, patchIndex) => {
      if (patch.texture.toLowerCase().replace(/^textures\//, '') === normalized) refs.push(`E${entityIndex}:P${patchIndex}`);
    });
  });
  return refs;
}

function originRefs(entities: readonly Entity[], line: string): MapDocumentRef[] {
  const match = /\bat\s*\(?\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(line);
  if (!match) return [];
  const point = [Number(match[1]), Number(match[2]), Number(match[3])];
  const refs: MapDocumentRef[] = [];
  entities.forEach((entity, entityIndex) => {
    const origin = entityOrigin(entity);
    if (origin && origin.every((value, axis) => Math.abs(value - point[axis]) <= 1)) refs.push(`E${entityIndex}`);
  });
  return refs;
}

export function structureCompilerOutput(
  output: readonly string[],
  entities: readonly Entity[],
  isDeclaredShader: (texture: string) => boolean = () => false,
): StructuredCompilerDiagnostic[] {
  const diagnostics: StructuredCompilerDiagnostic[] = [];
  let stage: StructuredCompilerDiagnostic['stage'];
  for (const raw of output) {
    const line = raw.trim();
    if (!line) continue;
    const stageMatch = /^=== Stage \d+: (BSP|Vis|Light) ===$/i.exec(line);
    if (stageMatch) {
      stage = stageMatch[1].toLowerCase() as StructuredCompilerDiagnostic['stage'];
      continue;
    }
    const missing = /warning:\s*couldn't find image for shader\s+(.+)$/i.exec(line);
    if (missing) {
      const texture = missing[1].trim();
      const expectedToolShader = isDeclaredShader(texture);
      diagnostics.push({
        severity: expectedToolShader ? 'info' : 'warning',
        code: expectedToolShader ? 'expected-tool-shader' : 'missing-shader-image',
        message: expectedToolShader ? `${line} (declared shader without a preview image)` : line,
        refs: textureRefs(entities, texture),
        stage,
      });
      continue;
    }
    if (/\bnoshader\b/i.test(line)) {
      diagnostics.push({ severity: 'warning', code: 'missing-shader-image', message: line, refs: originRefs(entities, line), stage });
      continue;
    }
    if (/^warning:/i.test(line)) {
      diagnostics.push({ severity: 'warning', code: 'compiler-warning', message: line, refs: originRefs(entities, line), stage });
      continue;
    }
    if (/memory access out of bounds|out of memory|cannot enlarge memory/i.test(line)) {
      diagnostics.push({
        severity: 'error', code: 'compiler-memory', stage, refs: [],
        message: `${stage ? `${stage.toUpperCase()} pass: ` : ''}${line}. The bundled WASM compiler exhausted or accessed invalid memory; try fast/BSP-only compile and reduce light complexity while preserving this output for investigation.`,
      });
      continue;
    }
    if (/\b(?:error|failed|exception)\b|exited with code/i.test(line)) {
      diagnostics.push({ severity: 'error', code: 'compiler-error', message: line, refs: originRefs(entities, line), stage });
    }
  }
  return diagnostics;
}
