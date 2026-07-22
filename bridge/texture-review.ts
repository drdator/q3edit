import { computeFaceUV, textureAxisFromPlane, type BrushFace } from '../src/brush';
import { parseMapWithDiagnostics } from '../src/mapfile';
import { vec3Cross, vec3Dot, vec3Length, vec3Sub } from '../src/math';

export interface TextureDimensions {
  width: number;
  height: number;
  verified: boolean;
}

export interface TextureReviewOptions {
  targetTexelsPerUnit?: number;
  minimumTexelsPerUnit?: number;
  maximumTexelsPerUnit?: number;
  maximumAnisotropy?: number;
  largeFittedFaceArea?: number;
  includeToolTextures?: boolean;
  limit?: number;
}

export interface TextureReviewIssue {
  severity: 'warning' | 'info';
  code: 'low-texel-density' | 'high-texel-density' | 'anisotropic-texture' | 'large-fitted-face' | 'inconsistent-density';
  message: string;
  refs: string[];
  texture: string;
  metrics: {
    texelsPerUnit: number;
    minimumTexelsPerUnit: number;
    maximumTexelsPerUnit: number;
    anisotropy: number;
    repeats: [number, number];
    faceArea: number;
    dimensionsVerified: boolean;
  };
  suggestedTransform?: { fit?: boolean; scale?: [number, number] };
}

type FaceMetric = TextureReviewIssue['metrics'] & {
  ref: string;
  texture: string;
};

const TOOL_TEXTURE = /^(?:textures\/)?common\//i;

function normalizedTexture(texture: string): string {
  return texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

export function textureNamesForReview(mapText: string, includeToolTextures = false): string[] {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const names = new Set<string>();
  for (const entity of entities) for (const brush of entity.brushes) for (const face of brush.faces) {
    if (!includeToolTextures && TOOL_TEXTURE.test(face.texture)) continue;
    names.add(face.texture);
  }
  return [...names].sort();
}

function polygonArea(face: BrushFace): number {
  if (face.polygon.length < 3) return 0;
  const origin = face.polygon[0];
  let area = 0;
  for (let index = 1; index < face.polygon.length - 1; index++) {
    area += vec3Length(vec3Cross(vec3Sub(face.polygon[index], origin), vec3Sub(face.polygon[index + 1], origin))) / 2;
  }
  return area;
}

function singularValues(a: number, b: number, c: number, d: number): [number, number] {
  const trace = a * a + b * b + c * c + d * d;
  const determinant = (a * d - b * c) ** 2;
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant));
  const maximum = Math.sqrt(Math.max(0, (trace + discriminant) / 2));
  const minimum = Math.sqrt(Math.max(0, (trace - discriminant) / 2));
  return [minimum, maximum];
}

function faceDensity(face: BrushFace, dimensions: TextureDimensions): [number, number] {
  if (face.textureProjection.kind === 'classic') {
    const x = Math.abs(face.textureProjection.scaleX || 0.5);
    const y = Math.abs(face.textureProjection.scaleY || 0.5);
    return [Math.min(1 / x, 1 / y), Math.max(1 / x, 1 / y)];
  }
  const [u, v] = face.textureProjection.matrix;
  return singularValues(
    u[0] * dimensions.width, u[1] * dimensions.width,
    v[0] * dimensions.height, v[1] * dimensions.height,
  );
}

function faceRepeats(face: BrushFace, dimensions: TextureDimensions): [number, number] {
  if (face.polygon.length < 3) return [0, 0];
  const coordinates = face.polygon.map(point => computeFaceUV(point, face, dimensions.width, dimensions.height));
  return [
    Math.max(...coordinates.map(value => value[0])) - Math.min(...coordinates.map(value => value[0])),
    Math.max(...coordinates.map(value => value[1])) - Math.min(...coordinates.map(value => value[1])),
  ];
}

function physicalTextureAxisSpans(face: BrushFace): [number, number] {
  const [sAxis, tAxis] = textureAxisFromPlane(face.plane.normal);
  const s = face.polygon.map(point => vec3Dot(point, sAxis));
  const t = face.polygon.map(point => vec3Dot(point, tAxis));
  return [Math.max(...s) - Math.min(...s), Math.max(...t) - Math.min(...t)];
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function metricForFace(ref: string, face: BrushFace, dimensions: TextureDimensions): FaceMetric | null {
  if (face.polygon.length < 3) return null;
  const [minimum, maximum] = faceDensity(face, dimensions);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= 0) return null;
  const repeats = faceRepeats(face, dimensions);
  return {
    ref,
    texture: face.texture,
    texelsPerUnit: rounded(Math.sqrt(Math.max(0, minimum * maximum))),
    minimumTexelsPerUnit: rounded(minimum),
    maximumTexelsPerUnit: rounded(maximum),
    anisotropy: rounded(minimum > 0 ? maximum / minimum : Number.POSITIVE_INFINITY),
    repeats: [rounded(repeats[0]), rounded(repeats[1])],
    faceArea: rounded(polygonArea(face)),
    dimensionsVerified: dimensions.verified,
  };
}

function suggestedUniformScale(current: number, target: number): [number, number] {
  const multiplier = Math.max(0.01, Math.min(100, current / target));
  const roundedMultiplier = Number(multiplier.toFixed(3));
  return [roundedMultiplier, roundedMultiplier];
}

function issue(metric: FaceMetric, code: TextureReviewIssue['code'], message: string, suggestedTransform?: TextureReviewIssue['suggestedTransform']): TextureReviewIssue {
  const { ref, texture, ...metrics } = metric;
  return { severity: 'warning', code, message, refs: [ref], texture, metrics, ...(suggestedTransform ? { suggestedTransform } : {}) };
}

export function reviewTextureQuality(
  mapText: string,
  textureDimensions: Map<string, TextureDimensions> = new Map(),
  options: TextureReviewOptions = {},
): {
  model: string;
  status: 'pass' | 'needs-attention';
  summary: {
    facesReviewed: number; materialsReviewed: number; verifiedMaterials: number; warningCount: number;
    density: { minimum: number; maximum: number; median: number } | null;
  };
  issues: { count: number; sample: TextureReviewIssue[]; truncated: boolean };
} {
  const target = options.targetTexelsPerUnit ?? 2;
  const minimum = options.minimumTexelsPerUnit ?? 0.5;
  const maximum = options.maximumTexelsPerUnit ?? 6;
  const maximumAnisotropy = options.maximumAnisotropy ?? 3;
  const largeFittedArea = options.largeFittedFaceArea ?? 32768;
  const limit = options.limit ?? 100;
  const parsed = parseMapWithDiagnostics(mapText).document;
  const metrics: FaceMetric[] = [];

  parsed.entities.forEach((entity, entityIndex) => entity.brushes.forEach((brush, brushIndex) => {
    brush.faces.forEach((face, faceIndex) => {
      if (!options.includeToolTextures && TOOL_TEXTURE.test(face.texture)) return;
      const dimensions = textureDimensions.get(normalizedTexture(face.texture)) ?? { width: 128, height: 128, verified: false };
      const metric = metricForFace(`E${entityIndex}:B${brushIndex}:F${faceIndex}`, face, dimensions);
      if (metric) metrics.push(metric);
    });
  }));

  const issues: TextureReviewIssue[] = [];
  for (const metric of metrics) {
    if (metric.texelsPerUnit < minimum) {
      issues.push(issue(
        metric, 'low-texel-density',
        `${metric.ref} uses ${metric.texelsPerUnit} texels/unit; the texture may look blurry or oversized.`,
        { scale: suggestedUniformScale(metric.texelsPerUnit, target) },
      ));
    } else if (metric.texelsPerUnit > maximum) {
      issues.push(issue(
        metric, 'high-texel-density',
        `${metric.ref} uses ${metric.texelsPerUnit} texels/unit; the texture may look noisy or over-tiled.`,
        { scale: suggestedUniformScale(metric.texelsPerUnit, target) },
      ));
    }
    if (metric.anisotropy > maximumAnisotropy) {
      issues.push(issue(
        metric, 'anisotropic-texture',
        `${metric.ref} has ${metric.anisotropy}:1 texture density anisotropy and is likely stretched along one axis.`,
      ));
    }
    const fittedOnce = metric.repeats.every(repeat => repeat >= 0.85 && repeat <= 1.15);
    if (fittedOnce && metric.faceArea >= largeFittedArea) {
      const face = parsed.entities[Number(metric.ref.match(/^E(\d+)/)?.[1])]
        ?.brushes[Number(metric.ref.match(/:B(\d+)/)?.[1])]
        ?.faces[Number(metric.ref.match(/:F(\d+)/)?.[1])];
      const spans = face ? physicalTextureAxisSpans(face) : [256, 256];
      const repeats: [number, number] = [Math.max(1, Math.ceil(spans[0] / 128)), Math.max(1, Math.ceil(spans[1] / 128))];
      issues.push(issue(
        metric, 'large-fitted-face',
        `${metric.ref} fits one repeat across ${Math.round(metric.faceArea)} square units; this is likely stretched unless it is intentional focal artwork.`,
        { fit: true, scale: [1 / repeats[0], 1 / repeats[1]] },
      ));
    }
  }

  const byTexture = new Map<string, FaceMetric[]>();
  for (const metric of metrics) {
    const key = normalizedTexture(metric.texture);
    const entries = byTexture.get(key) ?? [];
    entries.push(metric); byTexture.set(key, entries);
  }
  for (const entries of byTexture.values()) {
    if (entries.length < 3) continue;
    const sorted = entries.map(entry => entry.texelsPerUnit).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const metric of entries) {
      const ratio = Math.max(metric.texelsPerUnit / median, median / metric.texelsPerUnit);
      if (ratio <= 2.5) continue;
      issues.push(issue(
        metric, 'inconsistent-density',
        `${metric.ref} differs by ${rounded(ratio)}× from the median density of other ${metric.texture} faces.`,
        { scale: suggestedUniformScale(metric.texelsPerUnit, median) },
      ));
    }
  }

  const densities = metrics.map(metric => metric.texelsPerUnit).sort((a, b) => a - b);
  const materialNames = new Set(metrics.map(metric => normalizedTexture(metric.texture)));
  const verifiedMaterials = new Set(metrics.filter(metric => metric.dimensionsVerified).map(metric => normalizedTexture(metric.texture)));
  return {
    model: 'Projection-based heuristic review. Density thresholds and fit intent are authoring guidance, not renderer errors.',
    status: issues.length > 0 ? 'needs-attention' : 'pass',
    summary: {
      facesReviewed: metrics.length,
      materialsReviewed: materialNames.size,
      verifiedMaterials: verifiedMaterials.size,
      warningCount: issues.length,
      density: densities.length > 0 ? {
        minimum: densities[0], maximum: densities[densities.length - 1], median: densities[Math.floor(densities.length / 2)],
      } : null,
    },
    issues: { count: issues.length, sample: issues.slice(0, limit), truncated: issues.length > limit },
  };
}
