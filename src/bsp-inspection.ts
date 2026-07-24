import type { Vec3 } from './math';

const LUMP_COUNT = 17;
const LIGHTMAP_SIZE = 128;
const LIGHTMAP_BYTES = LIGHTMAP_SIZE * LIGHTMAP_SIZE * 3;

export interface BspBounds {
  mins: Vec3;
  maxs: Vec3;
}

export interface BspShader {
  name: string;
  surfaceFlags: number;
  contentFlags: number;
}

export interface BspLeaf extends BspBounds {
  cluster: number;
  area: number;
  firstSurface: number;
  surfaceCount: number;
  firstBrush: number;
  brushCount: number;
}

export interface BspPlane {
  normal: Vec3;
  dist: number;
}

export interface BspNode extends BspBounds {
  planeIndex: number;
  children: [number, number];
}

export interface BspSurface {
  shaderIndex: number;
  shader: string;
  type: 'planar' | 'patch' | 'triangle-soup' | 'flare' | 'unknown';
  firstVertex: number;
  vertexCount: number;
  firstIndex: number;
  indexCount: number;
  lightmapIndex: number;
  lightmapX: number;
  lightmapY: number;
  lightmapWidth: number;
  lightmapHeight: number;
  triangleCount: number;
  lightmapPixels: number;
  worldArea: number;
  lightmapTexelsPerUnit: number | null;
  lighting: 'lightmapped' | 'vertex-lit' | 'unlit';
  emissive: boolean;
  transparent: boolean;
}

export interface BspVisibility {
  clusters: number;
  bytesPerCluster: number;
  visibleClusters(cluster: number): number[];
}

export interface BspStatistics {
  bytes: number;
  entities: number;
  shaders: number;
  planes: number;
  nodes: number;
  leaves: number;
  clusters: number;
  portals: number;
  models: number;
  brushes: number;
  brushSides: number;
  drawVertices: number;
  drawIndexes: number;
  drawSurfaces: number;
  triangles: number;
  lightmaps: number;
  lightmapBytes: number;
  planarSurfaces: number;
  patchSurfaces: number;
  triangleSoupSurfaces: number;
  flareSurfaces: number;
}

export interface BspInspection {
  version: number;
  stats: BspStatistics;
  worldBounds: BspBounds | null;
  shaders: BspShader[];
  planes: BspPlane[];
  nodes: BspNode[];
  leaves: BspLeaf[];
  surfaces: BspSurface[];
  lightmaps: Uint8Array[];
  visibility: BspVisibility | null;
  portals: Vec3[][];
  warnings: string[];
}

interface Lump {
  offset: number;
  length: number;
}

function assertRange(data: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > data.byteLength) {
    throw new Error(`${label} is outside the BSP file`);
  }
}

function readCString(data: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(data.length, offset + length);
  while (end < limit && data[end] !== 0) end++;
  return new TextDecoder().decode(data.subarray(offset, end));
}

function countEntities(text: string): number {
  let depth = 0;
  let count = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') {
      if (depth === 0) count++;
      depth++;
    } else if (char === '}') depth = Math.max(0, depth - 1);
  }
  return count;
}

function surfaceType(value: number): BspSurface['type'] {
  if (value === 1) return 'planar';
  if (value === 2) return 'patch';
  if (value === 3) return 'triangle-soup';
  if (value === 4) return 'flare';
  return 'unknown';
}

function classifySurface(shader: BspShader | undefined, lightmapIndex: number): Pick<BspSurface, 'lighting' | 'emissive' | 'transparent'> {
  const name = shader?.name.toLowerCase() ?? '';
  const surfaceFlags = shader?.surfaceFlags ?? 0;
  const contentFlags = shader?.contentFlags ?? 0;
  const unlit = (surfaceFlags & 0x400) !== 0 || /(?:^|\/)(?:nodraw|skip|hint|trigger|caulk)(?:$|_)/.test(name);
  return {
    lighting: unlit ? 'unlit' : lightmapIndex >= 0 ? 'lightmapped' : 'vertex-lit',
    emissive: /(?:^|\/)(?:light|glow|lava|energy|flare)/.test(name),
    transparent: (contentFlags & 0x20000000) !== 0 || /(?:glass|trans|energy|flare|teleporter|water)/.test(name),
  };
}

export function parsePortalFile(source: string | null | undefined): Vec3[][] {
  if (!source) return [];
  const lines = source.trim().split(/\r?\n/);
  if (!/^PRT1/.test(lines[0] ?? '')) return [];
  const portals: Vec3[][] = [];
  for (const line of lines.slice(3)) {
    const header = /^\s*(\d+)\s+-?\d+\s+-?\d+\s+/.exec(line);
    if (!header) continue;
    const count = Number(header[1]);
    const points = [...line.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/g)]
      .map(match => [Number(match[1]), Number(match[2]), Number(match[3])] as Vec3)
      .slice(0, count);
    if (points.length >= 3) portals.push(points);
  }
  return portals;
}

export function parseBsp(data: Uint8Array, portalFile?: string | null): BspInspection {
  if (data.byteLength < 8 + LUMP_COUNT * 8) throw new Error('BSP header is incomplete');
  if (readCString(data, 0, 4) !== 'IBSP') throw new Error('Expected a Quake III IBSP file');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getInt32(4, true);
  if (version !== 46) throw new Error(`Unsupported BSP version ${version}; expected Quake III version 46`);
  const lumps: Lump[] = [];
  for (let index = 0; index < LUMP_COUNT; index++) {
    const offset = view.getInt32(8 + index * 8, true);
    const length = view.getInt32(12 + index * 8, true);
    assertRange(data, offset, length, `BSP lump ${index}`);
    lumps.push({ offset, length });
  }

  const warnings: string[] = [];
  const recordCount = (index: number, size: number, label: string) => {
    const lump = lumps[index];
    if (lump.length % size !== 0) warnings.push(`${label} lump has ${lump.length % size} trailing bytes`);
    return Math.floor(lump.length / size);
  };

  const shaders: BspShader[] = [];
  const shaderCount = recordCount(1, 72, 'Shader');
  for (let index = 0; index < shaderCount; index++) {
    const offset = lumps[1].offset + index * 72;
    shaders.push({
      name: readCString(data, offset, 64),
      surfaceFlags: view.getInt32(offset + 64, true),
      contentFlags: view.getInt32(offset + 68, true),
    });
  }

  const planes: BspPlane[] = [];
  const planeCount = recordCount(2, 16, 'Plane');
  for (let index = 0; index < planeCount; index++) {
    const offset = lumps[2].offset + index * 16;
    planes.push({
      normal: [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ],
      dist: view.getFloat32(offset + 12, true),
    });
  }

  const nodes: BspNode[] = [];
  const nodeCount = recordCount(3, 36, 'Node');
  for (let index = 0; index < nodeCount; index++) {
    const offset = lumps[3].offset + index * 36;
    nodes.push({
      planeIndex: view.getInt32(offset, true),
      children: [view.getInt32(offset + 4, true), view.getInt32(offset + 8, true)],
      mins: [
        view.getInt32(offset + 12, true),
        view.getInt32(offset + 16, true),
        view.getInt32(offset + 20, true),
      ],
      maxs: [
        view.getInt32(offset + 24, true),
        view.getInt32(offset + 28, true),
        view.getInt32(offset + 32, true),
      ],
    });
  }

  const leaves: BspLeaf[] = [];
  const leafCount = recordCount(4, 48, 'Leaf');
  for (let index = 0; index < leafCount; index++) {
    const offset = lumps[4].offset + index * 48;
    leaves.push({
      cluster: view.getInt32(offset, true),
      area: view.getInt32(offset + 4, true),
      mins: [view.getInt32(offset + 8, true), view.getInt32(offset + 12, true), view.getInt32(offset + 16, true)],
      maxs: [view.getInt32(offset + 20, true), view.getInt32(offset + 24, true), view.getInt32(offset + 28, true)],
      firstSurface: view.getInt32(offset + 32, true),
      surfaceCount: view.getInt32(offset + 36, true),
      firstBrush: view.getInt32(offset + 40, true),
      brushCount: view.getInt32(offset + 44, true),
    });
  }

  const vertexCount = recordCount(10, 44, 'Draw vertex');
  const vertices: Vec3[] = [];
  for (let index = 0; index < vertexCount; index++) {
    const offset = lumps[10].offset + index * 44;
    vertices.push([
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ]);
  }
  const drawIndexCount = recordCount(11, 4, 'Draw index');
  const drawIndexes = Array.from({ length: drawIndexCount }, (_, index) =>
    view.getInt32(lumps[11].offset + index * 4, true));

  const surfaces: BspSurface[] = [];
  const drawSurfaceCount = recordCount(13, 104, 'Draw surface');
  for (let index = 0; index < drawSurfaceCount; index++) {
    const offset = lumps[13].offset + index * 104;
    const shaderIndex = view.getInt32(offset, true);
    const type = surfaceType(view.getInt32(offset + 8, true));
    const indexCount = view.getInt32(offset + 24, true);
    const lightmapWidth = view.getInt32(offset + 40, true);
    const lightmapHeight = view.getInt32(offset + 44, true);
    const firstVertex = view.getInt32(offset + 12, true);
    const firstIndex = view.getInt32(offset + 20, true);
    let worldArea = 0;
    for (let triangle = 0; triangle + 2 < indexCount; triangle += 3) {
      const a = vertices[firstVertex + (drawIndexes[firstIndex + triangle] ?? 0)];
      const b = vertices[firstVertex + (drawIndexes[firstIndex + triangle + 1] ?? 0)];
      const c = vertices[firstVertex + (drawIndexes[firstIndex + triangle + 2] ?? 0)];
      if (!a || !b || !c) continue;
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      worldArea += Math.hypot(cross[0], cross[1], cross[2]) * 0.5;
    }
    const lightmapPixels = Math.max(0, lightmapWidth) * Math.max(0, lightmapHeight);
    const lightmapIndex = view.getInt32(offset + 28, true);
    surfaces.push({
      shaderIndex,
      shader: shaders[shaderIndex]?.name ?? `shader ${shaderIndex}`,
      type,
      firstVertex,
      vertexCount: view.getInt32(offset + 16, true),
      firstIndex,
      indexCount,
      lightmapIndex,
      lightmapX: view.getInt32(offset + 32, true),
      lightmapY: view.getInt32(offset + 36, true),
      lightmapWidth,
      lightmapHeight,
      triangleCount: Math.floor(indexCount / 3),
      lightmapPixels,
      worldArea,
      lightmapTexelsPerUnit: lightmapPixels > 0 && worldArea > 0 ? Math.sqrt(lightmapPixels / worldArea) : null,
      ...classifySurface(shaders[shaderIndex], lightmapIndex),
    });
  }

  const lightmaps: Uint8Array[] = [];
  const lightmapCount = recordCount(14, LIGHTMAP_BYTES, 'Lightmap');
  for (let index = 0; index < lightmapCount; index++) {
    const start = lumps[14].offset + index * LIGHTMAP_BYTES;
    lightmaps.push(data.slice(start, start + LIGHTMAP_BYTES));
  }

  let visibility: BspVisibility | null = null;
  if (lumps[16].length >= 8) {
    const clusters = view.getInt32(lumps[16].offset, true);
    const bytesPerCluster = view.getInt32(lumps[16].offset + 4, true);
    const visibilityData = data.slice(lumps[16].offset + 8, lumps[16].offset + lumps[16].length);
    if (clusters >= 0 && bytesPerCluster >= 0 && clusters * bytesPerCluster <= visibilityData.length) {
      visibility = {
        clusters,
        bytesPerCluster,
        visibleClusters(cluster: number): number[] {
          if (cluster < 0 || cluster >= clusters) return [];
          const result: number[] = [];
          const row = cluster * bytesPerCluster;
          for (let candidate = 0; candidate < clusters; candidate++) {
            if ((visibilityData[row + (candidate >> 3)] & (1 << (candidate & 7))) !== 0) result.push(candidate);
          }
          return result;
        },
      };
    } else {
      warnings.push('Visibility data dimensions are invalid');
    }
  }

  const modelCount = recordCount(7, 40, 'Model');
  const worldBounds = modelCount > 0
    ? {
        mins: [
          view.getFloat32(lumps[7].offset, true),
          view.getFloat32(lumps[7].offset + 4, true),
          view.getFloat32(lumps[7].offset + 8, true),
        ] as Vec3,
        maxs: [
          view.getFloat32(lumps[7].offset + 12, true),
          view.getFloat32(lumps[7].offset + 16, true),
          view.getFloat32(lumps[7].offset + 20, true),
        ] as Vec3,
      }
    : null;
  const entities = new TextDecoder().decode(data.subarray(lumps[0].offset, lumps[0].offset + lumps[0].length));
  const portals = parsePortalFile(portalFile);
  const stats: BspStatistics = {
    bytes: data.byteLength,
    entities: countEntities(entities),
    shaders: shaderCount,
    planes: planeCount,
    nodes: nodeCount,
    leaves: leafCount,
    clusters: visibility?.clusters ?? new Set(leaves.filter(leaf => leaf.cluster >= 0).map(leaf => leaf.cluster)).size,
    portals: portals.length,
    models: modelCount,
    brushes: recordCount(8, 12, 'Brush'),
    brushSides: recordCount(9, 8, 'Brush side'),
    drawVertices: vertexCount,
    drawIndexes: drawIndexCount,
    drawSurfaces: drawSurfaceCount,
    triangles: surfaces.reduce((sum, surface) => sum + surface.triangleCount, 0),
    lightmaps: lightmapCount,
    lightmapBytes: lumps[14].length,
    planarSurfaces: surfaces.filter(surface => surface.type === 'planar').length,
    patchSurfaces: surfaces.filter(surface => surface.type === 'patch').length,
    triangleSoupSurfaces: surfaces.filter(surface => surface.type === 'triangle-soup').length,
    flareSurfaces: surfaces.filter(surface => surface.type === 'flare').length,
  };
  return { version, stats, worldBounds, shaders, planes, nodes, leaves, surfaces, lightmaps, visibility, portals, warnings };
}

export function leafAtPoint(inspection: BspInspection, point: Vec3): BspLeaf | null {
  if (inspection.nodes.length > 0 && inspection.planes.length > 0) {
    let child = 0;
    const visited = new Set<number>();
    while (child >= 0 && !visited.has(child)) {
      visited.add(child);
      const node = inspection.nodes[child];
      if (!node) break;
      const plane = inspection.planes[node.planeIndex];
      if (!plane) break;
      const distance = point[0] * plane.normal[0] + point[1] * plane.normal[1]
        + point[2] * plane.normal[2] - plane.dist;
      child = node.children[distance >= 0 ? 0 : 1];
    }
    if (child < 0) return inspection.leaves[-child - 1] ?? null;
  }
  return inspection.leaves.find(leaf =>
    point[0] >= leaf.mins[0] && point[0] <= leaf.maxs[0]
    && point[1] >= leaf.mins[1] && point[1] <= leaf.maxs[1]
    && point[2] >= leaf.mins[2] && point[2] <= leaf.maxs[2],
  ) ?? null;
}

export interface BspComparison {
  key: keyof BspStatistics;
  current: number;
  previous: number;
  delta: number;
}

export function compareBspStatistics(current: BspStatistics, previous: BspStatistics | null): BspComparison[] {
  if (!previous) return [];
  const keys: Array<keyof BspStatistics> = [
    'bytes', 'nodes', 'leaves', 'clusters', 'portals', 'drawSurfaces', 'triangles', 'lightmaps',
  ];
  return keys.map(key => ({
    key,
    current: current[key],
    previous: previous[key],
    delta: current[key] - previous[key],
  }));
}

export function fragmentedLeafIndices(inspection: BspInspection): number[] {
  if (inspection.leaves.length < 16) return [];
  const surfaceCounts = inspection.leaves.map(leaf => leaf.surfaceCount).sort((a, b) => a - b);
  const threshold = Math.max(8, surfaceCounts[Math.floor(surfaceCounts.length * 0.9)] ?? 8);
  return inspection.leaves
    .map((leaf, index) => ({ leaf, index }))
    .filter(({ leaf }) => leaf.surfaceCount >= threshold)
    .map(({ index }) => index);
}

export function toolShaderKind(name: string): 'hint' | 'skip' | 'areaportal' | 'clusterportal' | 'other' | null {
  const normalized = name.toLowerCase().replace(/^textures\//, '');
  if (normalized === 'common/hint') return 'hint';
  if (normalized === 'common/skip') return 'skip';
  if (normalized === 'common/areaportal') return 'areaportal';
  if (normalized === 'common/clusterportal') return 'clusterportal';
  if (normalized.startsWith('common/')) return 'other';
  return null;
}

export type BspOverlayMode = 'none' | 'leaves' | 'portals' | 'both' | 'visible';

function appendBoundsLines(lines: Vec3[], bounds: BspBounds): void {
  const { mins, maxs } = bounds;
  const corners: Vec3[] = [
    [mins[0], mins[1], mins[2]], [maxs[0], mins[1], mins[2]],
    [maxs[0], maxs[1], mins[2]], [mins[0], maxs[1], mins[2]],
    [mins[0], mins[1], maxs[2]], [maxs[0], mins[1], maxs[2]],
    [maxs[0], maxs[1], maxs[2]], [mins[0], maxs[1], maxs[2]],
  ];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    lines.push(corners[a], corners[b]);
  }
}

export function bspOverlayLines(
  inspection: BspInspection | null,
  mode: BspOverlayMode,
  cameraPosition?: Vec3,
): Vec3[] {
  if (!inspection || mode === 'none') return [];
  const lines: Vec3[] = [];
  let leaves = inspection.leaves;
  if (mode === 'visible' && cameraPosition) {
    const cameraLeaf = leafAtPoint(inspection, cameraPosition);
    const visible = new Set(cameraLeaf && inspection.visibility
      ? inspection.visibility.visibleClusters(cameraLeaf.cluster)
      : []);
    leaves = visible.size > 0 ? leaves.filter(leaf => visible.has(leaf.cluster)) : [];
  }
  if (mode === 'leaves' || mode === 'both' || mode === 'visible') {
    for (const leaf of leaves) appendBoundsLines(lines, leaf);
  }
  if (mode === 'portals' || mode === 'both') {
    for (const portal of inspection.portals) {
      for (let index = 0; index < portal.length; index++) {
        lines.push(portal[index], portal[(index + 1) % portal.length]);
      }
    }
  }
  return lines;
}
