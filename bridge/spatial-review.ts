import type { Brush, BrushFace } from '../src/brush';
import { parseMapWithDiagnostics } from '../src/mapfile';
import type { Vec3 } from '../src/math';
import { isGroupInfoEntity } from '../src/named-groups';
import { inspectSpatialPlan, readSpatialPlan } from '../src/spatial-plan';
import { lintRoutes } from './route-lint';

export type SpatialReviewCode =
  | 'axis-aligned-dominance'
  | 'limited-height-variation'
  | 'repeated-dimensions'
  | 'straight-layout-dominance'
  | 'weak-route-branching'
  | 'route-dead-ends'
  | 'single-spatial-rhythm'
  | 'excessive-symmetry'
  | 'weak-landmark-distribution'
  | 'flat-silhouette'
  | 'long-flat-walls'
  | 'semantic-plan-invalid'
  | 'semantic-plan-disconnected';

export interface SpatialReviewIssue {
  severity: 'warning' | 'info';
  code: SpatialReviewCode;
  message: string;
  refs: string[];
  suggestions: string[];
}

interface BrushEntry {
  ref: string;
  brush: Brush;
  dimensions: Vec3;
  center: Vec3;
}

interface SurfaceSample {
  ref: string;
  z: number;
  center: Vec3;
  area: number;
  clearance: number | null;
}

export interface SpatialReviewResult {
  model: string;
  status: 'pass' | 'needs-attention';
  metrics: {
    geometry: {
      brushCount: number;
      faceCount: number;
      axisAlignedFaces: number;
      axisAlignedFaceRatio: number | null;
      angledBrushes: number;
      elongatedBrushes: number;
      elongatedBrushRatio: number | null;
    };
    levels: { count: number; values: number[]; heightRange: number | null };
    dimensions: {
      distinctFootprints: number;
      distinctVolumes: number;
      distinctHeights: number;
      dominantFootprintRatio: number | null;
      dominantVolumeRatio: number | null;
      dominantHeightRatio: number | null;
    };
    routes: {
      platformCount: number;
      edgeCount: number;
      components: number;
      branchNodes: number;
      deadEnds: number;
      estimatedLoops: number;
    };
    rhythm: {
      sampleCount: number;
      compressed: number;
      enclosed: number;
      open: number;
      categoryCount: number;
    };
    symmetry: { xMatchRatio: number | null; yMatchRatio: number | null };
    landmarks: { candidateCount: number; occupiedQuadrants: number; refs: string[] };
    silhouette: { minimumTop: number | null; maximumTop: number | null; heightRange: number | null };
    longFlatWalls: { count: number; refs: string[] };
    semanticPlan: {
      areaCount: number;
      connectionCount: number;
      componentCount: number;
      realizedAreas: number;
      realizedConnections: number;
      issueCount: number;
    };
  };
  issueCount: number;
  issues: SpatialReviewIssue[];
}

const rounded = (value: number, precision = 3): number => Number(value.toFixed(precision));

function isAxisAligned(face: BrushFace): boolean {
  const absolute = face.plane.normal.map(Math.abs);
  return absolute.some((value, axis) => value > 0.999 && absolute.every((other, otherAxis) => otherAxis === axis || other < 0.001));
}

function normalizedTexture(texture: string): string {
  return texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

function isSkyTexture(texture: string): boolean {
  const normalized = normalizedTexture(texture);
  return normalized.startsWith('skies/') || /^common\/sky(?:_|$|\/)/.test(normalized);
}

function isHardToolTexture(texture: string): boolean {
  const normalized = texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
  return /^common\/(?:clip|playerclip|botclip|weaponclip|trigger|hint|skip|areaportal|clusterportal|donotenter|origin)(?:_|$|\/)/.test(normalized);
}

function isCompositionShell(brush: Brush): boolean {
  if (brush.faces.length === 0) return false;
  const hasSky = brush.faces.some(face => isSkyTexture(face.texture));
  if (hasSky) return brush.faces.every(face => {
    const texture = normalizedTexture(face.texture);
    return isSkyTexture(texture) || texture === 'common/caulk' || texture === 'common/nodraw';
  });
  return brush.faces.every(face => isHardToolTexture(face.texture));
}

function faceArea(face: BrushFace): number {
  if (face.polygon.length < 3) return 0;
  const origin = face.polygon[0];
  let area = 0;
  for (let index = 1; index < face.polygon.length - 1; index++) {
    const a = face.polygon[index].map((value, axis) => value - origin[axis]) as Vec3;
    const b = face.polygon[index + 1].map((value, axis) => value - origin[axis]) as Vec3;
    const cross: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    area += Math.hypot(...cross) / 2;
  }
  return area;
}

function clusterValues(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const value of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (!cluster || value - cluster[cluster.length - 1] > tolerance) clusters.push([value]);
    else cluster.push(value);
  }
  return clusters.map(cluster => rounded(cluster.reduce((sum, value) => sum + value, 0) / cluster.length, 1));
}

function frequency(values: string[]): { distinct: number; dominantRatio: number | null } {
  if (values.length === 0) return { distinct: 0, dominantRatio: null };
  const counts = values.reduce<Map<string, number>>((result, value) => result.set(value, (result.get(value) ?? 0) + 1), new Map());
  return { distinct: counts.size, dominantRatio: Math.max(...counts.values()) / values.length };
}

function boundsSignature(mins: Vec3, maxs: Vec3): string {
  return [...mins, ...maxs].map(value => rounded(value, 1)).join(':');
}

function mirroredMatchRatio(entries: BrushEntry[], axis: 0 | 1, center: number): number | null {
  if (entries.length === 0) return null;
  const signatures = new Set(entries.map(entry => boundsSignature(entry.brush.mins, entry.brush.maxs)));
  const matches = entries.filter(entry => {
    const mins = [...entry.brush.mins] as Vec3;
    const maxs = [...entry.brush.maxs] as Vec3;
    mins[axis] = center * 2 - entry.brush.maxs[axis];
    maxs[axis] = center * 2 - entry.brush.mins[axis];
    return signatures.has(boundsSignature(mins, maxs));
  }).length;
  return matches / entries.length;
}

function routeTopology(mapText: string, platformRefs: string[]): SpatialReviewResult['metrics']['routes'] {
  const connectivity = lintRoutes(mapText).connectivity;
  const adjacency = new Map(platformRefs.map(ref => [ref, new Set<string>()]));
  const uniqueEdges = new Set<string>();
  for (const edge of connectivity.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
    uniqueEdges.add([edge.from, edge.to].sort().join('|'));
  }
  let components = 0;
  const visited = new Set<string>();
  for (const ref of adjacency.keys()) {
    if (visited.has(ref)) continue;
    components++;
    const queue = [ref]; visited.add(ref);
    while (queue.length > 0) for (const neighbor of adjacency.get(queue.shift()!) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor); queue.push(neighbor);
    }
  }
  const degrees = [...adjacency.values()].map(neighbors => neighbors.size);
  return {
    platformCount: connectivity.platformCount,
    edgeCount: uniqueEdges.size,
    components,
    branchNodes: degrees.filter(degree => degree >= 3).length,
    deadEnds: degrees.filter(degree => degree === 1).length,
    estimatedLoops: Math.max(0, uniqueEdges.size - adjacency.size + components),
  };
}

export function reviewSpatialDesign(mapText: string): SpatialReviewResult {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const spatialPlan = readSpatialPlan(entities.find(entity => entity.classname === 'worldspawn')?.properties ?? {});
  const planInspection = inspectSpatialPlan(spatialPlan);
  const entries: BrushEntry[] = [];
  entities.forEach((entity, entityIndex) => {
    if (isGroupInfoEntity(entity) || entity.classname.startsWith('trigger_')) return;
    entity.brushes.forEach((brush, brushIndex) => {
      if (isCompositionShell(brush)) return;
      const dimensions = brush.maxs.map((value, axis) => value - brush.mins[axis]) as Vec3;
      const center = brush.maxs.map((value, axis) => (value + brush.mins[axis]) / 2) as Vec3;
      entries.push({ ref: `E${entityIndex}:B${brushIndex}`, brush, dimensions, center });
    });
  });

  const faces = entries.flatMap(entry => entry.brush.faces.map((face, faceIndex) => ({ entry, face, ref: `${entry.ref}:F${faceIndex}` })));
  const axisAlignedFaces = faces.filter(({ face }) => isAxisAligned(face)).length;
  const angledBrushes = entries.filter(entry => entry.brush.faces.some(face => !isAxisAligned(face))).length;
  const elongated = entries.filter(entry => {
    const horizontal = entry.dimensions.slice(0, 2).sort((a, b) => a - b);
    return horizontal[1] >= 256 && horizontal[1] / Math.max(1, horizontal[0]) >= 4;
  });

  const upwardFaces = faces.filter(({ face }) => face.plane.normal[2] > 0.9 && faceArea(face) >= 1024);
  const downwardFaces = faces.filter(({ face }) => face.plane.normal[2] < -0.9 && face.polygon.length >= 3);
  const surfaceSamples: SurfaceSample[] = upwardFaces.map(({ face, ref }) => {
    const polygon = face.polygon;
    const center = [0, 1, 2].map(axis => polygon.reduce((sum, point) => sum + point[axis], 0) / polygon.length) as Vec3;
    const z = center[2];
    const ceilings = downwardFaces.flatMap(({ face: ceiling }) => {
      const xs = ceiling.polygon.map(point => point[0]); const ys = ceiling.polygon.map(point => point[1]);
      const ceilingZ = ceiling.polygon.reduce((sum, point) => sum + point[2], 0) / ceiling.polygon.length;
      return center[0] >= Math.min(...xs) - 0.1 && center[0] <= Math.max(...xs) + 0.1 &&
        center[1] >= Math.min(...ys) - 0.1 && center[1] <= Math.max(...ys) + 0.1 && ceilingZ > z + 1
        ? [ceilingZ - z] : [];
    });
    return { ref, z, center, area: faceArea(face), clearance: ceilings.length > 0 ? Math.min(...ceilings) : null };
  });
  const levels = clusterValues(surfaceSamples.map(sample => sample.z), 24);

  const footprintFrequency = frequency(entries.map(entry => entry.dimensions.slice(0, 2).sort((a, b) => a - b).map(value => Math.round(value / 8) * 8).join('×')));
  const volumeFrequency = frequency(entries.map(entry => String(Math.round(entry.dimensions.reduce((product, value) => product * value, 1) / 4096) * 4096)));
  const heightFrequency = frequency(entries.map(entry => String(Math.round(entry.dimensions[2] / 8) * 8)));
  const platformRefs = upwardFaces.map(({ entry }) => entry.ref).filter((ref, index, refs) => refs.indexOf(ref) === index);
  const routes = routeTopology(mapText, platformRefs);

  const compressed = surfaceSamples.filter(sample => sample.clearance !== null && sample.clearance <= 160).length;
  const enclosed = surfaceSamples.filter(sample => sample.clearance !== null && sample.clearance > 160 && sample.clearance <= 384).length;
  const open = surfaceSamples.filter(sample => sample.clearance === null || sample.clearance > 384).length;
  const categoryCount = [compressed, enclosed, open].filter(count => count > 0).length;

  const worldMins: Vec3 = entries.length > 0 ? [0, 1, 2].map(axis => Math.min(...entries.map(entry => entry.brush.mins[axis]))) as Vec3 : [0, 0, 0];
  const worldMaxs: Vec3 = entries.length > 0 ? [0, 1, 2].map(axis => Math.max(...entries.map(entry => entry.brush.maxs[axis]))) as Vec3 : [0, 0, 0];
  const worldCenter: Vec3 = worldMaxs.map((value, axis) => (value + worldMins[axis]) / 2) as Vec3;
  const xMatchRatio = mirroredMatchRatio(entries, 0, worldCenter[0]);
  const yMatchRatio = mirroredMatchRatio(entries, 1, worldCenter[1]);

  const heights = entries.map(entry => entry.dimensions[2]).sort((a, b) => a - b);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0;
  const worldHeight = worldMaxs[2] - worldMins[2];
  const landmarkEntries = entries.filter(entry =>
    entry.dimensions[2] >= Math.max(128, medianHeight * 1.75) && entry.brush.maxs[2] >= worldMaxs[2] - worldHeight * 0.25
  );
  const occupiedQuadrants = new Set(landmarkEntries.map(entry => `${entry.center[0] >= worldCenter[0] ? 1 : 0}:${entry.center[1] >= worldCenter[1] ? 1 : 0}`)).size;
  const topValues = entries.map(entry => entry.brush.maxs[2]);

  const longWallRefs = faces.filter(({ face }) => {
    if (Math.abs(face.plane.normal[2]) > 0.1 || !isAxisAligned(face) || face.polygon.length < 3) return false;
    const width = Math.max(
      Math.max(...face.polygon.map(point => point[0])) - Math.min(...face.polygon.map(point => point[0])),
      Math.max(...face.polygon.map(point => point[1])) - Math.min(...face.polygon.map(point => point[1])),
    );
    const height = Math.max(...face.polygon.map(point => point[2])) - Math.min(...face.polygon.map(point => point[2]));
    return width >= 512 && height >= 128 && faceArea(face) >= 65536;
  }).map(({ ref }) => ref);
  const realizedGroupIds = new Set(entities.flatMap(entity => [
    entity.properties._q3edit_group_id,
    ...entity.brushes.map(brush => brush.editorGroupId),
    ...entity.patches.map(patch => patch.editorGroupId),
  ]).filter((value): value is string => Boolean(value)));

  const metrics: SpatialReviewResult['metrics'] = {
    geometry: {
      brushCount: entries.length, faceCount: faces.length, axisAlignedFaces,
      axisAlignedFaceRatio: faces.length > 0 ? rounded(axisAlignedFaces / faces.length) : null,
      angledBrushes, elongatedBrushes: elongated.length,
      elongatedBrushRatio: entries.length > 0 ? rounded(elongated.length / entries.length) : null,
    },
    levels: { count: levels.length, values: levels, heightRange: levels.length > 0 ? rounded(levels[levels.length - 1] - levels[0], 1) : null },
    dimensions: {
      distinctFootprints: footprintFrequency.distinct, distinctVolumes: volumeFrequency.distinct, distinctHeights: heightFrequency.distinct,
      dominantFootprintRatio: footprintFrequency.dominantRatio === null ? null : rounded(footprintFrequency.dominantRatio),
      dominantVolumeRatio: volumeFrequency.dominantRatio === null ? null : rounded(volumeFrequency.dominantRatio),
      dominantHeightRatio: heightFrequency.dominantRatio === null ? null : rounded(heightFrequency.dominantRatio),
    },
    routes,
    rhythm: { sampleCount: surfaceSamples.length, compressed, enclosed, open, categoryCount },
    symmetry: {
      xMatchRatio: xMatchRatio === null ? null : rounded(xMatchRatio),
      yMatchRatio: yMatchRatio === null ? null : rounded(yMatchRatio),
    },
    landmarks: { candidateCount: landmarkEntries.length, occupiedQuadrants, refs: landmarkEntries.map(entry => entry.ref) },
    silhouette: {
      minimumTop: topValues.length > 0 ? rounded(Math.min(...topValues), 1) : null,
      maximumTop: topValues.length > 0 ? rounded(Math.max(...topValues), 1) : null,
      heightRange: topValues.length > 0 ? rounded(Math.max(...topValues) - Math.min(...topValues), 1) : null,
    },
    longFlatWalls: { count: longWallRefs.length, refs: longWallRefs },
    semanticPlan: {
      areaCount: spatialPlan.areas.length,
      connectionCount: spatialPlan.connections.length,
      componentCount: planInspection.connectedComponents.length,
      realizedAreas: spatialPlan.areas.filter(area => area.groupId && realizedGroupIds.has(area.groupId)).length,
      realizedConnections: spatialPlan.connections.filter(connection => connection.groupId && realizedGroupIds.has(connection.groupId)).length,
      issueCount: planInspection.issues.length,
    },
  };

  const issues: SpatialReviewIssue[] = [];
  const add = (issue: SpatialReviewIssue) => issues.push(issue);
  if (entries.length >= 8 && (metrics.geometry.axisAlignedFaceRatio ?? 0) >= 0.94 && angledBrushes / entries.length <= 0.1) add({
    severity: 'warning', code: 'axis-aligned-dominance', refs: [],
    message: `${Math.round((metrics.geometry.axisAlignedFaceRatio ?? 0) * 100)}% of brush faces are axis-aligned and only ${angledBrushes} brushes introduce angled planes.`,
    suggestions: ['Introduce angled or tapered boundary brushes in a focal area.', 'Use a curved patch or an octagonal space to vary the silhouette.'],
  });
  if (surfaceSamples.length >= 6 && levels.length <= 1) add({
    severity: 'warning', code: 'limited-height-variation', refs: surfaceSamples.slice(0, 8).map(sample => sample.ref),
    message: `The review found ${levels.length} distinct large walk-surface level across ${surfaceSamples.length} samples.`,
    suggestions: ['Add a meaningful upper or lower route.', 'Use ramps, stairs, lifts, or jump traversal to connect distinct height bands.'],
  });
  if (entries.length >= 8 && ((metrics.dimensions.dominantFootprintRatio ?? 0) >= 0.6 || (metrics.dimensions.dominantVolumeRatio ?? 0) >= 0.6 || (metrics.dimensions.dominantHeightRatio ?? 0) >= 0.75)) add({
    severity: 'info', code: 'repeated-dimensions', refs: [],
    message: `Brush dimensions repeat heavily (dominant footprint ${Math.round((metrics.dimensions.dominantFootprintRatio ?? 0) * 100)}%, volume ${Math.round((metrics.dimensions.dominantVolumeRatio ?? 0) * 100)}%, height ${Math.round((metrics.dimensions.dominantHeightRatio ?? 0) * 100)}%).`,
    suggestions: ['Vary bay widths, ceiling heights, and support spacing deliberately.', 'Keep a modular grid while using multiple related module sizes.'],
  });
  if (entries.length >= 10 && (metrics.geometry.elongatedBrushRatio ?? 0) >= 0.45 && (metrics.geometry.axisAlignedFaceRatio ?? 0) >= 0.9) add({
    severity: 'info', code: 'straight-layout-dominance', refs: elongated.slice(0, 12).map(entry => entry.ref),
    message: `${elongated.length} of ${entries.length} brushes are long axis-aligned forms, suggesting strongly linear boundaries or routes.`,
    suggestions: ['Break a long route with an offset, diagonal, curve, or widening.', 'Alternate sightline direction and room proportions.'],
  });
  if (routes.platformCount >= 4 && routes.branchNodes === 0) add({
    severity: 'warning', code: 'weak-route-branching', refs: [],
    message: `The approximate ${routes.platformCount}-platform route graph has no node with three or more connections.`,
    suggestions: ['Add a route choice that reconnects later.', 'Create a vertical or lateral flank instead of extending the main line.'],
  });
  if (routes.platformCount >= 4 && routes.deadEnds / routes.platformCount > 0.4) add({
    severity: 'info', code: 'route-dead-ends', refs: [],
    message: `${routes.deadEnds} of ${routes.platformCount} approximate platform nodes are dead ends.`,
    suggestions: ['Reconnect useful dead ends into loops.', 'Reserve remaining dead ends for deliberate rewards, ambushes, or landmarks.'],
  });
  if (surfaceSamples.length >= 6 && categoryCount <= 1) add({
    severity: 'info', code: 'single-spatial-rhythm', refs: surfaceSamples.slice(0, 8).map(sample => sample.ref),
    message: `All ${surfaceSamples.length} sampled walk surfaces share one broad ceiling-clearance category.`,
    suggestions: ['Contrast a compressed entrance with a larger release space.', 'Alternate exposed and enclosed traversal sections.'],
  });
  if (entries.length >= 8 && Math.max(xMatchRatio ?? 0, yMatchRatio ?? 0) >= 0.85) add({
    severity: 'info', code: 'excessive-symmetry', refs: [],
    message: `Brush bounds have ${Math.round(Math.max(xMatchRatio ?? 0, yMatchRatio ?? 0) * 100)}% mirror correspondence on the strongest world axis.`,
    suggestions: ['Break symmetry with a secondary route, height change, or landmark.', 'Preserve intentional balance while varying traversal and sightlines.'],
  });
  if (entries.length >= 10 && landmarkEntries.length === 0) add({
    severity: 'info', code: 'weak-landmark-distribution', refs: [],
    message: 'No tall, upper-silhouette brush cluster qualified as a likely landmark candidate.',
    suggestions: ['Give one important space a distinct vertical silhouette.', 'Use geometry, lighting, or a framed vista to establish orientation.'],
  });
  if (entries.length >= 10 && worldHeight > 0 && (metrics.silhouette.heightRange ?? 0) < Math.max(64, worldHeight * 0.2)) add({
    severity: 'info', code: 'flat-silhouette', refs: [],
    message: `Brush top elevations vary by only ${metrics.silhouette.heightRange} units.`,
    suggestions: ['Vary rooflines, towers, pits, or overhead structures.', 'Use height changes to make major spaces recognizable at a glance.'],
  });
  if (longWallRefs.length > 0) add({
    severity: 'info', code: 'long-flat-walls', refs: longWallRefs.slice(0, 16),
    message: `${longWallRefs.length} uninterrupted axis-aligned wall faces are at least 512 units wide and 128 units tall.`,
    suggestions: ['Articulate long walls with depth changes, openings, supports, or material rhythm.', 'Angle or curve selected wall sections where it supports navigation.'],
  });
  const invalidPlanIssues = planInspection.issues.filter(issue => issue.severity === 'error');
  if (invalidPlanIssues.length > 0) add({
    severity: 'warning', code: 'semantic-plan-invalid', refs: [],
    message: `The persistent semantic plan has ${invalidPlanIssues.length} invalid relationship${invalidPlanIssues.length === 1 ? '' : 's'}.`,
    suggestions: ['Inspect map_spatial_plan_get and repair duplicate or missing area references before generating more geometry.'],
  });
  if (spatialPlan.areas.length > 1 && planInspection.connectedComponents.length > 1) add({
    severity: 'warning', code: 'semantic-plan-disconnected', refs: [],
    message: `${spatialPlan.areas.length} planned areas form ${planInspection.connectedComponents.length} disconnected semantic components.`,
    suggestions: ['Connect isolated areas with an intentional traversal route.', 'Remove areas that are no longer part of the intended layout.'],
  });

  return {
    model: 'Authoring heuristics over brush planes, AABBs, walk-surface heights, ceiling clearance, mirror correspondence, and the approximate platform graph; use screenshots and playtests to judge intent.',
    status: issues.some(issue => issue.severity === 'warning') ? 'needs-attention' : 'pass',
    metrics,
    issueCount: issues.length,
    issues,
  };
}
