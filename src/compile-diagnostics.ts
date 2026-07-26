import { entityOrigin, type Entity } from './entity';
import type { MapDocumentRef } from './map-operations';
import { serializeMap } from './mapfile';

export interface StructuredCompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: 'missing-shader-image' | 'expected-tool-shader' | 'compiler-warning' | 'compiler-error' | 'compiler-memory' | 'leak';
  message: string;
  refs: MapDocumentRef[];
  stage?: 'bsp' | 'vis' | 'light' | 'aas';
  impact: 'correctness' | 'performance' | 'appearance' | 'compatibility';
  suggestion: string;
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

function sourceRefs(entities: readonly Entity[], line: string): MapDocumentRef[] {
  const explicit = /\bentity\s+(\d+)(?:\D+brush\s+(\d+))?/i.exec(line);
  if (explicit) {
    const entityIndex = Number(explicit[1]);
    const brushIndex = explicit[2] === undefined ? undefined : Number(explicit[2]);
    if (entities[entityIndex] && (brushIndex === undefined || entities[entityIndex].brushes[brushIndex])) {
      return [brushIndex === undefined ? `E${entityIndex}` : `E${entityIndex}:B${brushIndex}`];
    }
  }
  const lineMatch = /\bline\s+(\d+)\b/i.exec(line);
  if (!lineMatch) return [];
  const targetLine = Number(lineMatch[1]);
  const sourceLines = serializeMap([...entities], { compilerSafe: true }).split('\n');
  let entityIndex: number | null = null;
  let brushIndex: number | null = null;
  for (let index = 0; index < Math.min(targetLine, sourceLines.length); index++) {
    const entity = /^\/\/ entity (\d+)/.exec(sourceLines[index]);
    if (entity) { entityIndex = Number(entity[1]); brushIndex = null; }
    const brush = /^\/\/ brush (\d+)/.exec(sourceLines[index]);
    if (brush) brushIndex = Number(brush[1]);
  }
  if (entityIndex === null || !entities[entityIndex]) return [];
  if (brushIndex !== null && entities[entityIndex].brushes[brushIndex]) return [`E${entityIndex}:B${brushIndex}`];
  return [`E${entityIndex}`];
}

function likelyRefs(entities: readonly Entity[], line: string): MapDocumentRef[] {
  return [...new Set<MapDocumentRef>([...originRefs(entities, line), ...sourceRefs(entities, line)])];
}

function unresolvedTextureRefs(entities: readonly Entity[], isAvailable: (texture: string) => boolean): MapDocumentRef[] {
  const refs: MapDocumentRef[] = [];
  entities.forEach((entity, entityIndex) => {
    entity.brushes.forEach((brush, brushIndex) => brush.faces.forEach((face, faceIndex) => {
      if (!isAvailable(face.texture)) refs.push(`E${entityIndex}:B${brushIndex}:F${faceIndex}`);
    }));
    entity.patches.forEach((patch, patchIndex) => {
      if (!isAvailable(patch.texture)) refs.push(`E${entityIndex}:P${patchIndex}`);
    });
  });
  return refs.slice(0, 100);
}

export function structureCompilerOutput(
  output: readonly string[],
  entities: readonly Entity[],
  isDeclaredShader: (texture: string) => boolean = () => false,
  isAvailableTexture: (texture: string) => boolean = () => true,
): StructuredCompilerDiagnostic[] {
  const diagnostics: StructuredCompilerDiagnostic[] = [];
  let stage: StructuredCompilerDiagnostic['stage'];
  for (const raw of output) {
    const line = raw.trim();
    if (!line) continue;
    const stageMatch = /^=== Stage \d+: (BSP|Vis|Light|Bot navigation) ===$/i.exec(line);
    if (stageMatch) {
      stage = stageMatch[1].toLowerCase() === 'bot navigation'
        ? 'aas'
        : stageMatch[1].toLowerCase() as StructuredCompilerDiagnostic['stage'];
      continue;
    }
    const missing = /warning:\s*couldn't find image for shader\s+(.+)$/i.exec(line);
    if (missing) {
      const texture = missing[1].trim();
      const expectedToolShader = isDeclaredShader(texture);
      let refs = textureRefs(entities, texture);
      if (refs.length === 0 && texture.toLowerCase().replace(/^textures\//, '') === 'noshader') {
        refs = unresolvedTextureRefs(entities, isAvailableTexture);
      }
      diagnostics.push({
        severity: expectedToolShader ? 'info' : 'warning',
        code: expectedToolShader ? 'expected-tool-shader' : 'missing-shader-image',
        message: expectedToolShader ? `${line} (declared shader without a preview image)` : line,
        refs,
        stage,
        impact: expectedToolShader ? 'compatibility' : 'appearance',
        suggestion: expectedToolShader
          ? 'No action is normally required for an intentionally invisible tool shader.'
          : `Install or replace '${texture}', then compile again.`,
      });
      continue;
    }
    if (/\bnoshader\b/i.test(line)) {
      const refs = likelyRefs(entities, line);
      diagnostics.push({
        severity: 'warning', code: 'missing-shader-image', message: line,
        refs: refs.length > 0 ? refs : unresolvedTextureRefs(entities, isAvailableTexture), stage,
        impact: 'appearance',
        suggestion: 'Inspect the linked faces for missing or misspelled materials and replace them with an available shader.',
      });
      continue;
    }
    if (/^warning:/i.test(line)) {
      diagnostics.push({
        severity: 'warning', code: 'compiler-warning', message: line, refs: likelyRefs(entities, line), stage,
        impact: stage === 'vis' ? 'performance' : stage === 'light' ? 'appearance' : 'correctness',
        suggestion: stage === 'vis'
          ? 'Inspect structural geometry, hint surfaces, and portals near the referenced source.'
          : stage === 'light'
            ? 'Inspect the referenced light or surface and retry the light stage.'
            : 'Inspect the linked source geometry and compiler output around this warning.',
      });
      continue;
    }
    if (/memory access out of bounds|out of memory|cannot enlarge memory/i.test(line)) {
      diagnostics.push({
        severity: 'error', code: 'compiler-memory', stage, refs: [],
        message: `${stage ? `${stage.toUpperCase()} pass: ` : ''}${line}. The bundled WASM compiler exhausted or accessed invalid memory; try fast/BSP-only compile and reduce light complexity while preserving this output for investigation.`,
        impact: stage === 'light' ? 'appearance' : 'correctness',
        suggestion: 'Retry BSP-only to isolate the failing stage, then reduce light or structural complexity in the affected area.',
      });
      continue;
    }
    if (/\b(?:error|failed|exception)\b|exited with code/i.test(line)) {
      diagnostics.push({
        severity: 'error', code: 'compiler-error', message: line, refs: likelyRefs(entities, line), stage,
        impact: 'correctness',
        suggestion: 'Open the linked source, fix the reported construct, and rerun the failed stage.',
      });
    }
  }
  return diagnostics;
}
