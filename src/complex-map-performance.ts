import { computeFaceUV, createBoxBrush } from './brush';
import { createBrushPrimitive, createWedgeBrush } from './brush-primitives';
import { collectEditorDiagnostics } from './diagnostics';
import { Editor, type SelectionItem } from './editor';
import { createEntity } from './entity';
import { parseMapWithDiagnostics, serializeMap } from './mapfile';
import { createCylinderPatch, createFlatPatch } from './patch';

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
  budgetClass: 'setup' | 'load' | 'frame' | 'interaction' | 'command' | 'analysis';
  status: 'pass' | 'over-budget';
  detail?: string;
}

export interface ComplexMapMemoryReport {
  mapTextBytes: number;
  estimatedDocumentBytes: number;
  jsHeapBytes: number | null;
  jsHeapLimitBytes: number | null;
  textures?: ReturnType<NonNullable<Editor['textureManager']>['memoryStats']>;
  assets?: ReturnType<NonNullable<Editor['textureManager']>['assetMemoryStats']>;
  models?: ReturnType<NonNullable<Editor['modelManager']>['memoryStats']>;
}

export interface ComplexMapBenchmarkReport {
  fixture: ComplexMapFixtureSize | 'current';
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

const LOAD_BUDGETS: Record<ComplexMapFixtureSize, number> = {
  small: 100,
  medium: 300,
  large: 1_000,
  stress: 3_000,
};

function elapsed(action: () => void): number {
  const started = performance.now();
  action();
  return performance.now() - started;
}

function metric(
  name: string,
  milliseconds: number,
  budgetMilliseconds: number,
  budgetClass: ComplexMapBenchmarkMetric['budgetClass'],
  detail?: string,
): ComplexMapBenchmarkMetric {
  return {
    name,
    milliseconds,
    budgetMilliseconds,
    budgetClass,
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
    const mins: [number, number, number] = [x, y, 0];
    const maxs: [number, number, number] = [x + 64, y + 64, height];
    const texture = textures[index % textures.length];
    const brush = index % 37 === 0
      ? createBrushPrimitive('cylinder', mins, maxs, texture, 2, 8)
      : index % 29 === 0
        ? createWedgeBrush(mins, maxs, texture, index % 2 === 0 ? 'x+' : 'y+')
        : index % 43 === 0
          ? createBrushPrimitive('pyramid', mins, maxs, texture, 2, 4)
          : createBoxBrush(mins, maxs, texture);
    editor.worldspawn.brushes.push(brush);
    if (index % 128 === 0) {
      editor.worldspawn.patches.push(index % 256 === 0
        ? createCylinderPatch([x, y, height], [x + 128, y + 128, height + 64], 'gothic_trim/metal')
        : createFlatPatch([x, y, height], [x + 128, y + 128, height + 32], 'gothic_trim/metal'));
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
  return benchmarkEditor(editor, size, size, generationMs);
}

function sizeForBrushCount(brushes: number): ComplexMapFixtureSize {
  return brushes > FIXTURE_BRUSHES.large ? 'stress'
    : brushes > FIXTURE_BRUSHES.medium ? 'large'
      : brushes > FIXTURE_BRUSHES.small ? 'medium'
        : 'small';
}

/** Benchmarks a detached reload of the current map without modifying the open document. */
export function runCurrentMapBenchmark(editor: Editor): ComplexMapBenchmarkReport {
  const counts = collectComplexMapCounts(editor);
  return benchmarkEditor(editor, sizeForBrushCount(counts.brushes), 'current', 0);
}

function benchmarkEditor(
  editor: Editor,
  size: ComplexMapFixtureSize,
  fixture: ComplexMapBenchmarkReport['fixture'],
  generationMs: number,
): ComplexMapBenchmarkReport {
  let mapText = '';
  const saveMs = elapsed(() => { mapText = serializeMap(editor.entities); });
  let parsed!: ReturnType<typeof parseMapWithDiagnostics>;
  const parseMs = elapsed(() => { parsed = parseMapWithDiagnostics(mapText); });
  let loaded!: Editor;
  const loadMs = elapsed(() => { loaded = new Editor(); loaded.loadMap(mapText); });
  let renderValues = 0;
  const geometryMs = elapsed(() => { renderValues = generateRenderBuffers(loaded); });
  const center = Math.sqrt(Math.max(1, collectComplexMapCounts(loaded).brushes)) * 40;
  const mapBounds = Array.from(loaded.allBrushes()).reduce<{ mins: [number, number, number]; maxs: [number, number, number] } | null>(
    (bounds, { brush }) => bounds ? {
      mins: bounds.mins.map((value, axis) => Math.min(value, brush.mins[axis])) as [number, number, number],
      maxs: bounds.maxs.map((value, axis) => Math.max(value, brush.maxs[axis])) as [number, number, number],
    } : { mins: [...brush.mins], maxs: [...brush.maxs] },
    null,
  );
  const pickCenter = mapBounds
    ? [(mapBounds.mins[0] + mapBounds.maxs[0]) / 2, (mapBounds.mins[1] + mapBounds.maxs[1]) / 2]
    : [center, center];
  let candidateCount = 0;
  const pickMs = elapsed(() => {
    for (let repeat = 0; repeat < 200; repeat++) {
      const x = pickCenter[0] + repeat % 8;
      candidateCount += loaded.boundsCandidates2D(0, 1, x, pickCenter[1], x, pickCenter[1]).length;
    }
  }) / 200;
  let selectedCount = 0;
  const selectionMs = elapsed(() => {
    selectedCount = loaded.boundsCandidates2D(
      0, 1,
      pickCenter[0] - 512, pickCenter[1] - 512,
      pickCenter[0] + 512, pickCenter[1] + 512,
    ).length;
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
    fixture,
    generatedAt: new Date().toISOString(),
    counts,
    metrics: [
      metric('fixture generation', generationMs, LOAD_BUDGETS[size], 'setup'),
      metric('initial load', loadMs, LOAD_BUDGETS[size], 'load'),
      metric('parse and geometry calculation', parseMs, LOAD_BUDGETS[size], 'load', `${parsed.diagnostics.length} parser diagnostics`),
      metric('asset discovery', assetDiscoveryMs, Math.max(16.7, LOAD_BUDGETS[size] / 10), 'load'),
      metric('viewport geometry preparation', geometryMs, 16.7, 'frame', `${renderValues.toLocaleString()} vertex values`),
      metric('2D picking candidates', pickMs, 2, 'interaction',
        `${Math.round(candidateCount / 200)} matching candidates · direct scan without cache invalidation`),
      metric('region selection', selectionMs, 16.7, 'interaction', `${selectedCount.toLocaleString()} candidates`),
      metric('transform 64 brushes', transformMs, 100, 'command'),
      metric('undo', undoMs, 100, 'command'),
      metric('redo', redoMs, 100, 'command'),
      metric('diagnostics', diagnosticsMs, LOAD_BUDGETS[size], 'analysis', `${diagnosticCount} findings`),
      metric('save serialization', saveMs, LOAD_BUDGETS[size], 'command', `${mapText.length.toLocaleString()} characters`),
      metric('compile preparation', compilePreparationMs, LOAD_BUDGETS[size], 'command', `${compileBytes.toLocaleString()} bytes`),
    ],
    memory: {
      mapTextBytes: new TextEncoder().encode(mapText).byteLength,
      estimatedDocumentBytes: estimatedDocumentBytes(loaded),
      jsHeapBytes: heap.used,
      jsHeapLimitBytes: heap.limit,
      textures: loaded.textureManager?.memoryStats(),
      assets: loaded.textureManager?.assetMemoryStats(),
      models: loaded.modelManager?.memoryStats(),
    },
    interactionBudget: { targetFps: 60, frameMilliseconds: 16.7, pickMilliseconds: 2 },
  };
}
