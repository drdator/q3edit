import { computeFaceUV, createBoxBrush } from './brush';
import { collectEditorDiagnostics } from './diagnostics';
import { Editor, type SelectionItem } from './editor';
import { createEntity } from './entity';
import { MapSpatialIndex } from './map-spatial-index';
import { parseMapWithDiagnostics, serializeMap } from './mapfile';
import { createFlatPatch } from './patch';

export type ComplexMapFixtureSize = 'small' | 'medium' | 'large' | 'stress';

export interface ComplexMapCounts {
  entities: number;
  brushes: number;
  faces: number;
  patches: number;
  patchControlPoints: number;
  textures: number;
  models: number;
}

export interface ComplexMapBenchmarkMetric {
  name: string;
  milliseconds: number;
  budgetMilliseconds: number;
  status: 'pass' | 'over-budget';
  detail?: string;
}

export interface ComplexMapMemoryReport {
  mapTextBytes: number;
  estimatedDocumentBytes: number;
  spatialIndexBytes: number;
  jsHeapBytes: number | null;
  jsHeapLimitBytes: number | null;
  textures?: ReturnType<NonNullable<Editor['textureManager']>['memoryStats']>;
  assets?: ReturnType<NonNullable<Editor['textureManager']>['assetMemoryStats']>;
  models?: ReturnType<NonNullable<Editor['modelManager']>['memoryStats']>;
}

export interface ComplexMapBenchmarkReport {
  fixture: ComplexMapFixtureSize;
  generatedAt: string;
  counts: ComplexMapCounts;
  metrics: ComplexMapBenchmarkMetric[];
  memory: ComplexMapMemoryReport;
  interactionBudget: { targetFps: number; frameMilliseconds: number; pickMilliseconds: number };
}

const FIXTURE_BRUSHES: Record<ComplexMapFixtureSize, number> = {
  small: 64,
  medium: 512,
  large: 2_048,
  stress: 6_000,
};

const BUDGET_MULTIPLIER: Record<ComplexMapFixtureSize, number> = {
  small: 1,
  medium: 3,
  large: 10,
  stress: 25,
};

function elapsed(action: () => void): number {
  const started = performance.now();
  action();
  return performance.now() - started;
}

function metric(name: string, milliseconds: number, baseBudget: number, size: ComplexMapFixtureSize, detail?: string): ComplexMapBenchmarkMetric {
  const budgetMilliseconds = baseBudget * BUDGET_MULTIPLIER[size];
  return {
    name,
    milliseconds,
    budgetMilliseconds,
    status: milliseconds <= budgetMilliseconds ? 'pass' : 'over-budget',
    detail,
  };
}

export function createComplexMapFixture(size: ComplexMapFixtureSize): Editor {
  const editor = new Editor();
  editor.entities = [editor.worldspawn];
  editor.worldspawn.brushes = [];
  const count = FIXTURE_BRUSHES[size];
  const columns = Math.ceil(Math.sqrt(count));
  const textures = ['base_wall/metal', 'base_floor/stone', 'gothic_trim/baseboard', 'common/caulk'];
  for (let index = 0; index < count; index++) {
    const x = (index % columns) * 80;
    const y = Math.floor(index / columns) * 80;
    const height = 32 + (index % 5) * 16;
    editor.worldspawn.brushes.push(createBoxBrush([x, y, 0], [x + 64, y + 64, height], textures[index % textures.length]));
    if (index % 128 === 0) {
      editor.worldspawn.patches.push(createFlatPatch([x, y, height], [x + 128, y + 128, height + 32], 'gothic_trim/metal'));
    }
    if (index % 64 === 0) {
      const light = createEntity('light', [x + 32, y + 32, height + 96]);
      light.properties.light = String(300 + index % 600);
      editor.entities.push(light);
    }
    if (index % 256 === 0) {
      const model = createEntity('misc_model', [x + 16, y + 16, height]);
      model.properties.model = 'models/mapobjects/teleporter/teleporter.md3';
      editor.entities.push(model);
    }
  }
  const spawn = createEntity('info_player_deathmatch', [32, 32, 64]);
  editor.entities.push(spawn);
  editor.commitDocumentRevision();
  editor.markDocumentSaved();
  return editor;
}

export function collectComplexMapCounts(editor: Editor): ComplexMapCounts {
  const textures = new Set<string>();
  let brushes = 0;
  let faces = 0;
  let patches = 0;
  let patchControlPoints = 0;
  let models = 0;
  for (const entity of editor.entities) {
    brushes += entity.brushes.length;
    patches += entity.patches.length;
    if (entity.properties.model) models++;
    for (const brush of entity.brushes) for (const face of brush.faces) {
      faces++; textures.add(face.texture.toLowerCase());
    }
    for (const patch of entity.patches) {
      textures.add(patch.texture.toLowerCase());
      patchControlPoints += patch.width * patch.height;
    }
  }
  return { entities: editor.entities.length, brushes, faces, patches, patchControlPoints, textures: textures.size, models };
}

function generateRenderBuffers(editor: Editor): number {
  let values = 0;
  for (const { brush } of editor.allBrushes()) for (const face of brush.faces) {
    if (face.polygon.length < 3) continue;
    for (let index = 1; index < face.polygon.length - 1; index++) {
      for (const point of [face.polygon[0], face.polygon[index], face.polygon[index + 1]]) {
        computeFaceUV(point, face, 128, 128); values += 8;
      }
    }
  }
  for (const { patch } of editor.allPatches()) values += patch.tessIndices.length * 8;
  return values;
}

function estimatedDocumentBytes(editor: Editor): number {
  const counts = collectComplexMapCounts(editor);
  return counts.entities * 256 + counts.brushes * 320 + counts.faces * 480 +
    counts.patchControlPoints * 80 + counts.models * 16_384;
}

function heapMemory(): { used: number | null; limit: number | null } {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return { used: memory?.usedJSHeapSize ?? null, limit: memory?.jsHeapSizeLimit ?? null };
}

export function runComplexMapBenchmark(size: ComplexMapFixtureSize = 'medium'): ComplexMapBenchmarkReport {
  let editor!: Editor;
  const generationMs = elapsed(() => { editor = createComplexMapFixture(size); });
  let mapText = '';
  const saveMs = elapsed(() => { mapText = serializeMap(editor.entities); });
  let parsed!: ReturnType<typeof parseMapWithDiagnostics>;
  const parseMs = elapsed(() => { parsed = parseMapWithDiagnostics(mapText); });
  let loaded!: Editor;
  const loadMs = elapsed(() => { loaded = new Editor(); loaded.loadMap(mapText); });
  let renderValues = 0;
  const geometryMs = elapsed(() => { renderValues = generateRenderBuffers(loaded); });
  let index!: MapSpatialIndex;
  const indexMs = elapsed(() => { index = new MapSpatialIndex(loaded); });
  const center = Math.sqrt(FIXTURE_BRUSHES[size]) * 40;
  const brushEntries = index.entries.filter(entry => entry.kind === 'brush');
  let linearCandidateCount = 0;
  const linearPickMs = elapsed(() => {
    for (let repeat = 0; repeat < 200; repeat++) {
      const x = center + repeat % 8;
      linearCandidateCount += brushEntries.filter(entry =>
        x >= entry.mins[0] && x <= entry.maxs[0] && center >= entry.mins[1] && center <= entry.maxs[1]).length;
    }
  }) / 200;
  let candidateCount = 0;
  const pickMs = elapsed(() => {
    for (let repeat = 0; repeat < 200; repeat++) {
      candidateCount += index.queryPoint2D(0, 1, center + repeat % 8, center).length;
    }
  }) / 200;
  let selectedCount = 0;
  const selectionMs = elapsed(() => {
    selectedCount = index.queryBounds2D(0, 1, 0, 0, 1_024, 1_024).length;
  });
  const selection = Array.from(loaded.allBrushes()).slice(0, 64)
    .map(({ entity, brush }): SelectionItem => ({ type: 'brush', entity, brush }));
  loaded.selection = selection;
  const transformMs = elapsed(() => loaded.moveSelection([8, 0, 0]));
  const undoMs = elapsed(() => loaded.undo());
  const redoMs = elapsed(() => loaded.redo());
  let diagnosticCount = 0;
  const diagnosticsMs = elapsed(() => { diagnosticCount = collectEditorDiagnostics(loaded).length; });
  let compileBytes = 0;
  const compilePreparationMs = elapsed(() => { compileBytes = new TextEncoder().encode(loaded.serializeCompileMap()).byteLength; });
  const assetDiscoveryMs = elapsed(() => {
    const assets = new Set<string>();
    for (const entity of loaded.entities) {
      if (entity.properties.model) assets.add(entity.properties.model);
      for (const brush of entity.brushes) for (const face of brush.faces) assets.add(face.texture);
      for (const patch of entity.patches) assets.add(patch.texture);
    }
  });
  const heap = heapMemory();
  const counts = collectComplexMapCounts(loaded);
  return {
    fixture: size,
    generatedAt: new Date().toISOString(),
    counts,
    metrics: [
      metric('fixture generation', generationMs, 25, size),
      metric('initial load', loadMs, 30, size),
      metric('parse and geometry calculation', parseMs, 25, size, `${parsed.diagnostics.length} parser diagnostics`),
      metric('asset discovery', assetDiscoveryMs, 2, size),
      metric('viewport geometry preparation', geometryMs, 18, size, `${renderValues.toLocaleString()} vertex values`),
      metric('spatial index rebuild', indexMs, 8, size, `${index.entries.length.toLocaleString()} indexed objects`),
      metric('indexed picking', pickMs, 0.5, size,
        `${Math.round(candidateCount / 200)} indexed candidates / ${Math.round(linearCandidateCount / 200)} linear hits · ${linearPickMs.toFixed(3)} ms linear baseline · ${Math.max(1, linearPickMs / Math.max(0.0001, pickMs)).toFixed(1)}× faster`),
      metric('region selection', selectionMs, 1, size, `${selectedCount.toLocaleString()} candidates`),
      metric('transform 64 brushes', transformMs, 8, size),
      metric('undo', undoMs, 8, size),
      metric('redo', redoMs, 8, size),
      metric('diagnostics', diagnosticsMs, 18, size, `${diagnosticCount} findings`),
      metric('save serialization', saveMs, 18, size, `${mapText.length.toLocaleString()} characters`),
      metric('compile preparation', compilePreparationMs, 20, size, `${compileBytes.toLocaleString()} bytes`),
    ],
    memory: {
      mapTextBytes: new TextEncoder().encode(mapText).byteLength,
      estimatedDocumentBytes: estimatedDocumentBytes(loaded),
      spatialIndexBytes: index.estimatedBytes(),
      jsHeapBytes: heap.used,
      jsHeapLimitBytes: heap.limit,
      textures: loaded.textureManager?.memoryStats(),
      assets: loaded.textureManager?.assetMemoryStats(),
      models: loaded.modelManager?.memoryStats(),
    },
    interactionBudget: { targetFps: 60, frameMilliseconds: 16.7, pickMilliseconds: 2 },
  };
}
