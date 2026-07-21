import { parseMapWithDiagnostics } from '../src/mapfile';
import { CONTENTS_DETAIL } from '../src/map-flags';
import { isGroupInfoEntity } from '../src/named-groups';
import { collectMapStatistics } from './map-statistics';
import { reviewTextureQuality } from './texture-review';

export const MAP_STYLE_BRIEF_KEY = '_q3edit_style_brief';

export interface MapStyleBrief {
  name?: string;
  theme?: string;
  palette?: string[];
  paletteMode?: 'guide' | 'strict';
  modularGrid?: number;
  targetTexelsPerUnit?: number;
  lightingMood?: 'dark' | 'balanced' | 'bright' | 'dramatic';
  detailDensity?: 'sparse' | 'balanced' | 'rich';
  notes?: string;
}

export interface StyleFinding {
  severity: 'warning' | 'info';
  code: 'style-grid-deviation' | 'style-palette-deviation' | 'style-detail-density' | 'style-lighting-mood' | 'style-texture-density';
  message: string;
  refs: string[];
}

function normalizedTexture(texture: string): string {
  return texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

function paletteMatches(texture: string, palette: string[]): boolean {
  const normalized = normalizedTexture(texture);
  return palette.some(entry => {
    const candidate = normalizedTexture(entry);
    return candidate.endsWith('/*') ? normalized.startsWith(candidate.slice(0, -1)) : normalized === candidate;
  });
}

export function validateStyleBrief(value: MapStyleBrief): MapStyleBrief {
  const brief = structuredClone(value);
  if (brief.name !== undefined && (!brief.name.trim() || brief.name.length > 120)) throw new Error('style name must contain 1 to 120 characters');
  if (brief.theme !== undefined && (!brief.theme.trim() || brief.theme.length > 500)) throw new Error('style theme must contain 1 to 500 characters');
  if (brief.notes !== undefined && brief.notes.length > 4000) throw new Error('style notes must contain at most 4000 characters');
  if (brief.palette !== undefined) {
    if (brief.palette.length > 64 || brief.palette.some(texture => !texture.trim() || texture.length > 240)) {
      throw new Error('style palette must contain at most 64 non-empty texture or folder-pattern names');
    }
    brief.palette = [...new Set(brief.palette.map(texture => texture.trim()))];
  }
  if (brief.modularGrid !== undefined && (!Number.isFinite(brief.modularGrid) || brief.modularGrid <= 0)) {
    throw new Error('modularGrid must be a positive finite number');
  }
  if (brief.targetTexelsPerUnit !== undefined && (!Number.isFinite(brief.targetTexelsPerUnit) || brief.targetTexelsPerUnit <= 0)) {
    throw new Error('targetTexelsPerUnit must be a positive finite number');
  }
  return brief;
}

export function serializeStyleBrief(brief: MapStyleBrief): string {
  return JSON.stringify(validateStyleBrief(brief));
}

export function readStyleBrief(mapText: string): MapStyleBrief | null {
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const worldspawn = entities.find(entity => entity.classname === 'worldspawn');
  const raw = worldspawn?.properties[MAP_STYLE_BRIEF_KEY];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as MapStyleBrief;
    return value && typeof value === 'object' && !Array.isArray(value) ? validateStyleBrief(value) : null;
  } catch {
    return null;
  }
}

export function reviewStyleBrief(mapText: string): {
  brief: MapStyleBrief | null;
  status: 'not-configured' | 'pass' | 'needs-attention';
  metrics: {
    paletteMaterials: number; outOfPaletteMaterials: string[]; onGridBrushes: number; offGridBrushes: number;
    detailRatio: number | null; lightCount: number; averageLightIntensity: number | null;
  };
  issueCount: number;
  issues: StyleFinding[];
} {
  const brief = readStyleBrief(mapText);
  const entities = parseMapWithDiagnostics(mapText).document.entities;
  const palette = brief?.palette ?? [];
  const materialRefs = new Map<string, string[]>();
  let onGridBrushes = 0; let offGridBrushes = 0;
  let structuralBrushes = 0; let detailBrushes = 0;
  const issues: StyleFinding[] = [];

  entities.forEach((entity, entityIndex) => {
    if (isGroupInfoEntity(entity)) return;
    entity.brushes.forEach((brush, brushIndex) => {
      const brushRef = `E${entityIndex}:B${brushIndex}`;
      if (brush.faces.some(face => (face.contentFlags & CONTENTS_DETAIL) !== 0)) detailBrushes++; else structuralBrushes++;
      if (brief?.modularGrid) {
        const aligned = brush.faces.every(face => face.points.every(point => point.every(coordinate => {
          const units = coordinate / brief.modularGrid!;
          return Math.abs(units - Math.round(units)) < 0.001;
        })));
        if (aligned) onGridBrushes++;
        else {
          offGridBrushes++;
          issues.push({
            severity: 'info', code: 'style-grid-deviation', refs: [brushRef],
            message: `${brushRef} does not follow the ${brief.modularGrid}-unit modular grid from the map style brief.`,
          });
        }
      }
      brush.faces.forEach((face, faceIndex) => {
        if (/^(?:textures\/)?common\//i.test(face.texture)) return;
        const key = normalizedTexture(face.texture);
        const refs = materialRefs.get(key) ?? [];
        refs.push(`${brushRef}:F${faceIndex}`); materialRefs.set(key, refs);
      });
    });
  });

  const outOfPalette = palette.length > 0
    ? [...materialRefs.keys()].filter(texture => !paletteMatches(texture, palette)).sort()
    : [];
  for (const texture of outOfPalette) {
    issues.push({
      severity: brief?.paletteMode === 'strict' ? 'warning' : 'info', code: 'style-palette-deviation',
      refs: materialRefs.get(texture)!.slice(0, 20),
      message: `${texture} is outside the ${brief?.paletteMode ?? 'guide'} palette in the map style brief.`,
    });
  }

  const totalBrushes = structuralBrushes + detailBrushes;
  const detailRatio = totalBrushes > 0 ? detailBrushes / totalBrushes : null;
  if (brief?.detailDensity && detailRatio !== null) {
    const outside = brief.detailDensity === 'sparse' ? detailRatio > 0.35
      : brief.detailDensity === 'rich' ? detailRatio < 0.3
        : detailRatio < 0.1 || detailRatio > 0.65;
    if (outside) issues.push({
      severity: 'info', code: 'style-detail-density', refs: [],
      message: `Detail brushes are ${Math.round(detailRatio * 100)}% of brush geometry, outside the expected ${brief.detailDensity} style range.`,
    });
  }

  const statistics = collectMapStatistics(mapText);
  const averageLight = statistics.lighting.radius && statistics.lighting.lights.length > 0
    ? statistics.lighting.lights.reduce((sum, light) => sum + light.intensity, 0) / statistics.lighting.lights.length
    : null;
  if (brief?.lightingMood) {
    const mismatch = brief.lightingMood === 'bright' ? averageLight === null || averageLight < 400
      : brief.lightingMood === 'dark' ? averageLight !== null && averageLight > 700
        : brief.lightingMood === 'dramatic' ? statistics.lighting.count < 2
          : statistics.lighting.count === 0;
    if (mismatch) issues.push({
      severity: 'info', code: 'style-lighting-mood', refs: statistics.lighting.lights.map(light => light.ref),
      message: `Current light count/intensity does not yet match the requested ${brief.lightingMood} lighting mood.`,
    });
  }

  if (brief?.targetTexelsPerUnit) {
    const textureReview = reviewTextureQuality(mapText, new Map(), {
      targetTexelsPerUnit: brief.targetTexelsPerUnit,
      minimumTexelsPerUnit: brief.targetTexelsPerUnit / 2,
      maximumTexelsPerUnit: brief.targetTexelsPerUnit * 2,
      limit: 20,
    });
    for (const textureIssue of textureReview.issues.sample.filter(issue => issue.code === 'low-texel-density' || issue.code === 'high-texel-density')) {
      issues.push({
        severity: 'info', code: 'style-texture-density', refs: textureIssue.refs,
        message: `${textureIssue.refs[0]} uses ${textureIssue.metrics.texelsPerUnit} texels/unit versus the style target of ${brief.targetTexelsPerUnit}.`,
      });
    }
  }

  return {
    brief,
    status: !brief ? 'not-configured' : issues.length > 0 ? 'needs-attention' : 'pass',
    metrics: {
      paletteMaterials: materialRefs.size, outOfPaletteMaterials: outOfPalette,
      onGridBrushes, offGridBrushes, detailRatio,
      lightCount: statistics.lighting.count, averageLightIntensity: averageLight,
    },
    issueCount: issues.length,
    issues,
  };
}
