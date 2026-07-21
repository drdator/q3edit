import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { BridgeHub } from './bridge-hub';
import { inspectMapObjects } from './map-inspection';
import { inspectMapGroups, queryMap, type MapQueryOptions } from './map-query';
import type { MapDocumentRef, MapOperation } from '../src/map-operations';
import { parseMapWithDiagnostics } from '../src/mapfile';
import {
  inspectSpatialPlan,
  readSpatialPlan,
  upsertSpatialArea,
  upsertSpatialConnection,
  type SpatialArea,
  type SpatialConnection,
} from '../src/spatial-plan';
import { lintGameplay } from './gameplay-lint';
import { analyzeJumpPad } from './jump-analysis';
import { lintRoutes } from './route-lint';
import { collectMapStatistics } from './map-statistics';
import { compactMapSummary, reviewMap } from './design-review';
import type { McpActivityLog } from './activity-log';
import { reviewTextureQuality, textureNamesForReview, type TextureDimensions } from './texture-review';
import { lintGeometry } from './geometry-lint';
import { reviewSpatialDesign } from './spatial-review';
import {
  MAP_STYLE_BRIEF_KEY,
  readStyleBrief,
  reviewStyleBrief,
  serializeStyleBrief,
} from './style-brief';
import { constructionPathSummary, readConstructionPaths } from '../src/construction-paths';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const compatibleVec3 = z.array(z.number()).length(3);
const objectRef = z.string().regex(/^E\d+(?::[BP]\d+)?(?::F\d+)?$/, 'Expected an object reference such as E1, E0:B2, E0:B2:F4, or E0:P0');
const operationRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63})$/, 'Expected an object reference or symbolic reference such as @north_tower');
const faceRef = z.string().regex(/^(?:E\d+:B\d+:F\d+|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/, 'Expected a face reference such as E0:B2:F4, @trim, or @trim:F4');
const compatibleTargetRef = z.string().regex(/^(?:E\d+(?::[BP]\d+)?(?::F\d+)?|@[A-Za-z][A-Za-z0-9_-]{0,63}(?::F\d+)?)$/);
const symbolicId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const editorSessionId = z.string().min(1).max(160);
const sessionInput = { sessionId: editorSessionId.optional().describe('Explicit editor session; otherwise uses this MCP connection’s selected session or the sole connected editor') };
const groupId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const creationMetadataSchema = {
  id: symbolicId.optional(),
  group: z.string().min(1).max(120).optional(),
  groupId: groupId.optional(),
};
const textureTransformSchema = z.object({
  fit: z.boolean().optional().describe('Fit one complete texture repeat to each targeted face before applying shift, scale, and rotation'),
  shift: z.tuple([z.number(), z.number()]).optional().describe('Relative texture shift in pixels'),
  scale: z.tuple([z.number().positive(), z.number().positive()]).optional()
    .describe('Relative texture-size multiplier; 2 makes the texture twice as large, while 0.5 produces twice as many repeats'),
  rotateDegrees: z.number().optional().describe('Relative clockwise texture rotation in degrees'),
});
const compatibleTextureTransformSchema = z.object({
  fit: z.boolean().optional(),
  shift: z.array(z.number()).length(2).optional(),
  scale: z.array(z.number().positive()).length(2).optional(),
  rotateDegrees: z.number().optional(),
});
const capSideTextureTransformsSchema = z.object({
  top: textureTransformSchema.optional(),
  bottom: textureTransformSchema.optional(),
  sides: textureTransformSchema.optional(),
});
const roomTextureTransformsSchema = z.object({
  walls: textureTransformSchema.optional(),
  floor: textureTransformSchema.optional(),
  ceiling: textureTransformSchema.optional(),
});
const stairTextureTransformsSchema = z.object({
  treads: textureTransformSchema.optional(),
  risers: textureTransformSchema.optional(),
  sides: textureTransformSchema.optional(),
  underside: textureTransformSchema.optional(),
});
const prefabTextureTransformsSchema = z.object({
  primary: textureTransformSchema.optional(),
  accent: textureTransformSchema.optional(),
  focal: textureTransformSchema.optional(),
  sides: textureTransformSchema.optional(),
  bottom: textureTransformSchema.optional(),
});
const screenshotBounds = z.object({ mins: vec3, maxs: vec3 });
const nullableBounds = screenshotBounds.nullable();
const issueSeverity = z.enum(['error', 'warning', 'info']);
const gameplayLintIssueSchema = z.object({
  severity: issueSeverity,
  code: z.enum(['entity-in-solid', 'spawn-clearance', 'unsupported-item']),
  message: z.string(),
  refs: z.array(z.string()),
});
const routeLintIssueSchema = z.object({
  severity: issueSeverity,
  code: z.enum([
    'invalid-jump-pad', 'blocked-jump-pad', 'unsupported-jump-landing',
    'blocked-jump-landing', 'unreachable-pickup', 'missing-spawn',
  ]),
  message: z.string(),
  refs: z.array(z.string()),
});
const geometryLintIssueSchema = z.object({
  severity: z.enum(['warning', 'info']),
  code: z.enum(['duplicate-brush', 'coplanar-overlap', 'thin-brush', 'sliver-face', 'off-grid-geometry', 'likely-structural-detail']),
  message: z.string(), refs: z.array(z.string()),
});
const spatialReviewIssueSchema = z.object({
  severity: z.enum(['warning', 'info']),
  code: z.enum([
    'axis-aligned-dominance', 'limited-height-variation', 'repeated-dimensions', 'straight-layout-dominance',
    'weak-route-branching', 'route-dead-ends', 'single-spatial-rhythm', 'excessive-symmetry',
    'weak-landmark-distribution', 'flat-silhouette', 'long-flat-walls', 'semantic-plan-invalid', 'semantic-plan-disconnected',
  ]),
  message: z.string(), refs: z.array(z.string()), suggestions: z.array(z.string()),
});
const spatialReviewMetricsSchema = z.object({
  geometry: z.object({
    brushCount: z.number().int(), faceCount: z.number().int(), axisAlignedFaces: z.number().int(),
    axisAlignedFaceRatio: z.number().nullable(), angledBrushes: z.number().int(), elongatedBrushes: z.number().int(),
    elongatedBrushRatio: z.number().nullable(),
  }),
  levels: z.object({ count: z.number().int(), values: z.array(z.number()), heightRange: z.number().nullable() }),
  dimensions: z.object({
    distinctFootprints: z.number().int(), distinctVolumes: z.number().int(), distinctHeights: z.number().int(),
    dominantFootprintRatio: z.number().nullable(), dominantVolumeRatio: z.number().nullable(), dominantHeightRatio: z.number().nullable(),
  }),
  routes: z.object({
    platformCount: z.number().int(), edgeCount: z.number().int(), components: z.number().int(),
    branchNodes: z.number().int(), deadEnds: z.number().int(), estimatedLoops: z.number().int(),
  }),
  rhythm: z.object({
    sampleCount: z.number().int(), compressed: z.number().int(), enclosed: z.number().int(),
    open: z.number().int(), categoryCount: z.number().int(),
  }),
  symmetry: z.object({ xMatchRatio: z.number().nullable(), yMatchRatio: z.number().nullable() }),
  landmarks: z.object({ candidateCount: z.number().int(), occupiedQuadrants: z.number().int(), refs: z.array(z.string()) }),
  silhouette: z.object({ minimumTop: z.number().nullable(), maximumTop: z.number().nullable(), heightRange: z.number().nullable() }),
  longFlatWalls: z.object({ count: z.number().int(), refs: z.array(z.string()) }),
  semanticPlan: z.object({
    areaCount: z.number().int(), connectionCount: z.number().int(), componentCount: z.number().int(),
    realizedAreas: z.number().int(), realizedConnections: z.number().int(), issueCount: z.number().int(),
  }),
});
const jumpPadAnalysisSchema = z.object({
  model: z.string(),
  triggerRef: z.string().nullable(),
  targetRef: z.string().nullable(),
  targetMatches: z.number().int(),
  gravity: z.number(),
  triggerBounds: screenshotBounds,
  launchOrigin: vec3,
  apex: vec3,
  velocity: vec3,
  horizontalSpeed: z.number(),
  verticalSpeed: z.number(),
  timeToApex: z.number(),
  nominalFlightTime: z.number(),
  nominalLandingOrigin: vec3,
  landing: z.discriminatedUnion('supported', [
    z.object({ supported: z.literal(false) }),
    z.object({
      supported: z.literal(true),
      brushRef: z.string(),
      time: z.number(),
      origin: vec3,
      feetPosition: vec3,
      hullClear: z.boolean(),
      blockers: z.array(z.string()),
    }),
  ]),
  clearance: z.object({
    clear: z.boolean(),
    collisions: z.array(z.object({ ref: z.string(), firstTime: z.number(), position: vec3 })),
  }),
  trajectory: z.array(z.object({ time: z.number(), position: vec3 })),
  warnings: z.array(z.string()),
});
const routeLintSchema = z.object({
  model: z.string(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(routeLintIssueSchema),
  jumpPads: z.array(jumpPadAnalysisSchema),
  connectivity: z.object({
    platformCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    spawnPlatforms: z.array(z.object({ entityRef: z.string(), platformRef: z.string() })),
    reachablePlatformCount: z.number().int().nonnegative(),
    pickups: z.array(z.object({
      entityRef: z.string(), classname: z.string(), platformRef: z.string().nullable(), reachableFromSpawn: z.boolean(),
    })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(['walk', 'jump', 'jump-pad']) })),
  }),
});
const queryGroupSchema = z.object({ id: z.string(), name: z.string() }).nullable();
const mapQueryMatchSchema = z.discriminatedUnion('kind', [
  z.object({
    ref: z.string(), kind: z.literal('entity'), classname: z.string(), origin: vec3.nullable(), bounds: nullableBounds,
    properties: z.record(z.string(), z.string()), brushCount: z.number().int(), patchCount: z.number().int(),
    textures: z.array(z.string()), group: queryGroupSchema,
  }),
  z.object({
    ref: z.string(), kind: z.literal('brush'), entity: z.string(), classname: z.string(), bounds: screenshotBounds,
    faceCount: z.number().int(), textures: z.array(z.string()), group: queryGroupSchema,
  }),
  z.object({
    ref: z.string(), kind: z.literal('face'), entity: z.string(), brush: z.string(), classname: z.string(),
    texture: z.string(), bounds: nullableBounds, contentFlags: z.number().int(), surfaceFlags: z.number().int(),
    value: z.number().int(), group: queryGroupSchema,
  }),
  z.object({
    ref: z.string(), kind: z.literal('patch'), entity: z.string(), classname: z.string(), bounds: screenshotBounds,
    width: z.number().int(), height: z.number().int(), textures: z.array(z.string()), group: queryGroupSchema,
  }),
]);
const gameplayLintOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), issueCount: z.number().int().nonnegative(),
  issues: z.array(gameplayLintIssueSchema),
});
const geometryLintOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), issueCount: z.number().int().nonnegative(),
  issues: z.array(geometryLintIssueSchema),
});
const spatialReviewOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), model: z.string(),
  status: z.enum(['pass', 'needs-attention']), metrics: spatialReviewMetricsSchema,
  issueCount: z.number().int().nonnegative(), issues: z.array(spatialReviewIssueSchema),
});
const jumpPadOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), ...jumpPadAnalysisSchema.shape,
});
const routeLintOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), ...routeLintSchema.shape,
});
const mapQueryOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(), count: z.number().int().nonnegative(),
  matches: z.array(mapQueryMatchSchema),
});
const nearestNeighborSchema = z.object({ minimum: z.number(), average: z.number() }).nullable();
const compactMapSummarySchema = z.object({
  world: z.object({ bounds: nullableBounds, size: z.array(z.number()).length(3).nullable() }),
  counts: z.object({
    entities: z.number().int(), brushes: z.number().int(), patches: z.number().int(), terrain: z.number().int(), groups: z.number().int(),
    structuralBrushes: z.number().int(), detailBrushes: z.number().int(), structuralPatches: z.number().int(), detailPatches: z.number().int(),
    textures: z.number().int(), lights: z.number().int(), spawns: z.number().int(), items: z.number().int(),
  }),
  diagnostics: z.object({ errors: z.number().int(), warnings: z.number().int(), info: z.number().int() }),
  entityClasses: z.object({
    count: z.number().int(), sample: z.array(z.object({ classname: z.string(), count: z.number().int() })), truncated: z.boolean(),
  }),
  distributions: z.object({
    spawnBounds: nullableBounds, itemBounds: nullableBounds,
    spawnNearestNeighbor: nearestNeighborSchema, itemNearestNeighbor: nearestNeighborSchema,
  }),
});
const mapStyleBriefSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  theme: z.string().min(1).max(500).optional(),
  palette: z.array(z.string().min(1).max(240)).max(64).optional(),
  paletteMode: z.enum(['guide', 'strict']).optional(),
  modularGrid: z.number().positive().optional(),
  targetTexelsPerUnit: z.number().positive().optional(),
  lightingMood: z.enum(['dark', 'balanced', 'bright', 'dramatic']).optional(),
  detailDensity: z.enum(['sparse', 'balanced', 'rich']).optional(),
  notes: z.string().max(4000).optional(),
});
const spatialAreaShapeSchema = z.enum(['rectangular', 'octagonal', 'radial', 'curved', 'terraced', 'irregular']);
const spatialRouteTypeSchema = z.enum(['corridor', 'bridge', 'stairs', 'ramp', 'jump', 'teleporter', 'open']);
const spatialOpeningSchema = z.object({
  side: z.enum(['north', 'south', 'east', 'west', 'up', 'down']),
  width: z.number().positive(), offset: z.number().optional(), note: z.string().max(500).optional(),
});
const spatialAreaSchema = z.object({
  id: symbolicId, purpose: z.string().min(1).max(500), shape: spatialAreaShapeSchema, center: vec3,
  bounds: screenshotBounds.optional(), radius: z.number().positive().optional(), height: z.number().positive(),
  levels: z.array(z.number()).max(16), footprint: z.array(vec3).min(3).max(64).optional(),
  openings: z.array(spatialOpeningSchema).max(32), landmarkIntent: z.string().max(1000).optional(), groupId: z.string().optional(),
});
const spatialConnectionSchema = z.object({
  id: symbolicId, fromArea: symbolicId, toArea: symbolicId, routeType: spatialRouteTypeSchema,
  width: z.number().positive(), verticalChange: z.number().optional(), curvature: z.number().min(-1).max(1).optional(),
  cover: z.enum(['open', 'partial', 'enclosed']).optional(), visibility: z.enum(['hidden', 'glimpse', 'visible']).optional(),
  traversalIntent: z.string().max(1000).optional(), groupId: z.string().optional(),
});
const spatialPlanIssueSchema = z.object({
  severity: issueSeverity,
  code: z.enum(['duplicate-area', 'duplicate-connection', 'missing-area', 'self-connection', 'overlapping-area', 'disconnected-area']),
  message: z.string(), ids: z.array(z.string()),
});
const spatialPlanInspectionSchema = z.object({
  bounds: nullableBounds, levels: z.array(z.number()),
  routeTypes: z.object({
    corridor: z.number().int(), bridge: z.number().int(), stairs: z.number().int(), ramp: z.number().int(),
    jump: z.number().int(), teleporter: z.number().int(), open: z.number().int(),
  }),
  connectedComponents: z.array(z.array(z.string())), issues: z.array(spatialPlanIssueSchema),
});
const spatialPlanOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(),
  plan: z.object({ version: z.literal(1), areas: z.array(spatialAreaSchema), connections: z.array(spatialConnectionSchema) }),
  inspection: spatialPlanInspectionSchema,
});
const constructionPathKindSchema = z.enum(['corridor', 'wall', 'railing', 'pipe', 'beam', 'trim', 'stairs', 'supports']);
const constructionPathSchema = z.object({
  id: symbolicId, kind: constructionPathKindSchema, curve: z.enum(['polyline', 'catmull-rom']),
  controlPoints: z.array(vec3).min(2).max(64), sampledPointCount: z.number().int().positive(),
  width: z.number().positive(), height: z.number().positive().optional(), thickness: z.number().positive(),
  spacing: z.number().positive().optional(), subdivisions: z.number().int().min(1).max(16),
  sides: z.number().int().min(3).max(32).optional(), join: z.enum(['overlap', 'bevel']),
  capEnds: z.boolean(), bankDegrees: z.number().min(-180).max(180), texture: z.string(),
  classification: z.enum(['detail', 'structural']), groupId: z.string(), objectCount: z.number().int().positive(),
  bounds: screenshotBounds,
});
const constructionPathsOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int().nonnegative(),
  document: z.object({ version: z.literal(1), paths: z.array(constructionPathSchema) }),
  summary: z.object({
    count: z.number().int(), totalObjects: z.number().int(),
    byKind: z.object({
      corridor: z.number().int(), wall: z.number().int(), railing: z.number().int(), pipe: z.number().int(),
      beam: z.number().int(), trim: z.number().int(), stairs: z.number().int(), supports: z.number().int(),
    }),
    bounds: nullableBounds,
  }),
});
const spatialAreaProposalSchema = z.object({
  id: symbolicId, purpose: z.string().min(1).max(500), shape: spatialAreaShapeSchema, center: vec3,
  bounds: screenshotBounds.optional(), radius: z.number().positive().optional(), height: z.number().positive(),
  levels: z.array(z.number()).max(16).optional(), footprint: z.array(vec3).min(3).max(64).optional(),
  openings: z.array(spatialOpeningSchema).max(32).optional(), landmarkIntent: z.string().max(1000).optional(),
});
const spatialConnectionProposalSchema = z.object({
  id: symbolicId, fromArea: symbolicId, toArea: symbolicId, routeType: spatialRouteTypeSchema,
  width: z.number().positive(), verticalChange: z.number().optional(), curvature: z.number().min(-1).max(1).optional(),
  cover: z.enum(['open', 'partial', 'enclosed']).optional(), visibility: z.enum(['hidden', 'glimpse', 'visible']).optional(),
  traversalIntent: z.string().max(1000).optional(),
});
const styleFindingSchema = z.object({
  severity: z.enum(['warning', 'info']),
  code: z.enum(['style-grid-deviation', 'style-palette-deviation', 'style-detail-density', 'style-lighting-mood', 'style-texture-density']),
  message: z.string(), refs: z.array(z.string()),
});
const styleMetricsSchema = z.object({
  paletteMaterials: z.number().int(), outOfPaletteMaterials: z.array(z.string()),
  onGridBrushes: z.number().int(), offGridBrushes: z.number().int(), detailRatio: z.number().nullable(),
  lightCount: z.number().int(), averageLightIntensity: z.number().nullable(),
});
const sampledDesignFindingSchema = z.object({
  count: z.number().int(),
  sample: z.array(z.object({ source: z.enum(['validation', 'geometry', 'spatial', 'style', 'gameplay', 'routes']), severity: issueSeverity, code: z.string(), message: z.string(), refs: z.array(z.string()) })),
  truncated: z.boolean(),
});
const designReviewOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), model: z.string(), detail: z.enum(['compact', 'full']),
  status: z.enum(['pass', 'needs-attention', 'blocked']),
  severityCounts: z.object({ errors: z.number().int(), warnings: z.number().int(), info: z.number().int() }),
  findingCount: z.number().int(), findings: sampledDesignFindingSchema, map: compactMapSummarySchema,
  validation: sampledDesignFindingSchema,
  geometry: z.object({
    issueCount: z.number().int(),
    issues: z.object({ count: z.number().int(), sample: z.array(geometryLintIssueSchema), truncated: z.boolean() }),
  }),
  spatial: z.object({
    model: z.string(), status: z.enum(['pass', 'needs-attention']), metrics: spatialReviewMetricsSchema,
    issueCount: z.number().int(),
    issues: z.object({ count: z.number().int(), sample: z.array(spatialReviewIssueSchema), truncated: z.boolean() }),
  }),
  style: z.object({
    brief: mapStyleBriefSchema.nullable(), status: z.enum(['not-configured', 'pass', 'needs-attention']),
    metrics: styleMetricsSchema, issueCount: z.number().int(),
    issues: z.object({ count: z.number().int(), sample: z.array(styleFindingSchema), truncated: z.boolean() }),
  }),
  gameplay: z.object({
    issueCount: z.number().int(),
    issues: z.object({ count: z.number().int(), sample: z.array(gameplayLintIssueSchema), truncated: z.boolean() }),
  }),
  routes: z.object({
    issueCount: z.number().int(),
    issues: z.object({ count: z.number().int(), sample: z.array(routeLintIssueSchema), truncated: z.boolean() }),
    jumpPads: z.object({
      count: z.number().int(), truncated: z.boolean(),
      sample: z.array(z.object({
        triggerRef: z.string().nullable(), targetRef: z.string().nullable(),
        clearance: z.object({ clear: z.boolean(), collisionCount: z.number().int() }),
        landing: z.union([
          z.object({ supported: z.literal(false) }),
          z.object({ supported: z.literal(true), brushRef: z.string(), hullClear: z.boolean(), blockers: z.array(z.string()) }),
        ]),
        warnings: z.array(z.string()),
      })),
    }),
    connectivity: z.object({
      platformCount: z.number().int(), edgeCount: z.number().int(), reachablePlatformCount: z.number().int(),
      spawnCount: z.number().int(), pickupCount: z.number().int(), reachablePickupCount: z.number().int(),
      unreachablePickupRefs: z.array(z.string()),
      edgeKinds: z.object({ walk: z.number().int(), jump: z.number().int(), 'jump-pad': z.number().int() }),
    }),
  }),
});
const mapSummaryOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), fileName: z.string(), activeMapPath: z.string().nullable(),
  ...compactMapSummarySchema.shape,
});
const layoutScreenshotOutputSchema = z.object({
  sessionId: z.string(), mimeType: z.literal('image/png'), width: z.number().int(), height: z.number().int(),
  mode: z.enum(['top', 'front', 'side']), frameBounds: nullableBounds,
  gridSize: z.number().positive(), majorGridSize: z.number().positive(),
  axisLabels: z.tuple([z.string(), z.string()]), worldUnitsPerPixel: z.number().positive(),
});
const reviewBundleOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), frameBounds: nullableBounds, frameGroup: z.string().nullable(),
  views: z.array(z.object({
    mode: z.enum(['perspective', 'top', 'front', 'side']), mimeType: z.literal('image/png'),
    width: z.number().int(), height: z.number().int(),
    gridSize: z.number().optional(), majorGridSize: z.number().optional(),
    axisLabels: z.tuple([z.string(), z.string()]).optional(), worldUnitsPerPixel: z.number().optional(),
  })),
});
const activityLogOutputSchema = z.object({
  enabled: z.boolean(), filePath: z.string().nullable(), mcpSessionId: z.string().nullable(), count: z.number().int(),
  entries: z.array(z.object({
    id: z.string(), timestamp: z.string(), mcpSessionId: z.string(), editorSessionId: z.string().nullable(), tool: z.string(),
    readOnly: z.boolean(),
    durationMs: z.number(), status: z.enum(['success', 'error']),
    revisionBefore: z.number().int().nullable(), revisionAfter: z.number().int().nullable(), revisionDelta: z.number().int().nullable(),
    arguments: z.unknown(), result: z.unknown(),
  })),
});
const textureReviewIssueSchema = z.object({
  severity: z.enum(['warning', 'info']),
  code: z.enum(['low-texel-density', 'high-texel-density', 'anisotropic-texture', 'large-fitted-face', 'inconsistent-density']),
  message: z.string(), refs: z.array(z.string()), texture: z.string(),
  metrics: z.object({
    texelsPerUnit: z.number(), minimumTexelsPerUnit: z.number(), maximumTexelsPerUnit: z.number(),
    anisotropy: z.number(), repeats: z.tuple([z.number(), z.number()]), faceArea: z.number(), dimensionsVerified: z.boolean(),
  }),
  suggestedTransform: z.object({ fit: z.boolean().optional(), scale: z.tuple([z.number(), z.number()]).optional() }).optional(),
});
const textureReviewOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), model: z.string(), status: z.enum(['pass', 'needs-attention']),
  summary: z.object({
    facesReviewed: z.number().int(), materialsReviewed: z.number().int(), verifiedMaterials: z.number().int(), warningCount: z.number().int(),
    density: z.object({ minimum: z.number(), maximum: z.number(), median: z.number() }).nullable(),
  }),
  issues: z.object({ count: z.number().int(), sample: z.array(textureReviewIssueSchema), truncated: z.boolean() }),
});
const styleReviewOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), brief: mapStyleBriefSchema.nullable(),
  status: z.enum(['not-configured', 'pass', 'needs-attention']), metrics: styleMetricsSchema,
  issueCount: z.number().int(), issues: z.array(styleFindingSchema),
});
const styleBriefOutputSchema = z.object({
  sessionId: z.string(), revision: z.number().int(), brief: mapStyleBriefSchema.nullable(),
});
const MAX_BATCH_OPERATIONS = 128;
const SUPPORTED_MAP_OPERATIONS = [
  'create_entity', 'create_entity_array', 'set_entity_properties', 'create_box', 'create_box_array', 'create_room', 'create_primitive',
  'create_wedge', 'create_tapered', 'create_stairs', 'create_brush', 'create_prefab', 'create_patch', 'create_area', 'connect_areas', 'create_path',
  'translate', 'rotate', 'mirror', 'clone', 'array', 'set_texture', 'edit_faces', 'edit_patches', 'thicken_patch', 'set_brush_classification', 'clip_brushes',
  'hollow_brushes', 'csg_subtract', 'create_jump_pad', 'create_teleporter', 'delete',
  'assign_group', 'remove_from_group',
] as const;

const mapOperationVariants = [
  z.object({
    type: z.literal('create_entity'),
    ...creationMetadataSchema,
    classname: z.string().min(1),
    origin: vec3.optional(),
    properties: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_entity_array'),
    ...creationMetadataSchema,
    classname: z.string().min(1),
    start: vec3,
    count: z.number().int().min(1).max(128),
    delta: vec3,
    properties: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('set_entity_properties'),
    target: operationRef,
    classname: z.string().min(1).optional(),
    properties: z.record(z.string(), z.string()).optional(),
    unset: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_box'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: capSideTextureTransformsSchema.optional(),
  }),
  z.object({
    type: z.literal('create_room'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    wallThickness: z.number().positive().optional(),
    textures: z.object({
      walls: z.string().min(1).optional(),
      floor: z.string().min(1).optional(),
      ceiling: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: roomTextureTransformsSchema.optional(),
  }),
  z.object({
    type: z.literal('create_box_array'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    count: z.number().int().min(1).max(128),
    delta: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: capSideTextureTransformsSchema.optional(),
    classification: z.enum(['detail', 'structural']).optional(),
  }),
  z.object({
    type: z.literal('create_primitive'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    primitive: z.enum(['box', 'cylinder', 'cone', 'sphere', 'pyramid']),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      top: z.string().min(1).optional(), bottom: z.string().min(1).optional(), sides: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: capSideTextureTransformsSchema.optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
    sides: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('create_wedge'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textureTransform: textureTransformSchema.optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
  }),
  z.object({
    type: z.literal('create_tapered'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textureTransform: textureTransformSchema.optional(),
    topScale: z.tuple([z.number().positive().max(4), z.number().positive().max(4)]).optional(),
    topOffset: z.tuple([z.number(), z.number()]).optional(),
  }),
  z.object({
    type: z.literal('create_stairs'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    textures: z.object({
      treads: z.string().min(1).optional(), risers: z.string().min(1).optional(),
      sides: z.string().min(1).optional(), underside: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: stairTextureTransformsSchema.optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
    steps: z.number().int().min(2).max(64),
  }),
  z.object({
    type: z.literal('create_brush'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    texture: z.string().min(1).optional(),
    textureTransform: textureTransformSchema.optional(),
    faces: z.array(z.object({
      points: z.tuple([vec3, vec3, vec3]),
      texture: z.string().min(1).optional(),
      textureTransform: textureTransformSchema.optional(),
    })).min(4).max(128),
  }),
  z.object({
    type: z.literal('create_prefab'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    prefab: z.enum(['pillar', 'door_frame', 'jump_pad_base']),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1),
    textures: z.object({
      primary: z.string().min(1).optional(), accent: z.string().min(1).optional(),
      focal: z.string().min(1).optional(), sides: z.string().min(1).optional(), bottom: z.string().min(1).optional(),
    }).optional(),
    textureTransform: textureTransformSchema.optional(),
    textureTransforms: prefabTextureTransformsSchema.optional(),
    orientation: z.enum(['x', 'y']).optional(),
    classification: z.enum(['detail', 'structural']).optional(),
  }),
  z.object({
    type: z.literal('create_patch'),
    ...creationMetadataSchema,
    parent: operationRef.optional(),
    preset: z.enum(['bevel', 'endcap', 'cylinder', 'arch', 'pipe', 'ramp']),
    mins: vec3,
    maxs: vec3,
    texture: z.string().min(1).optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
    direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
    subdivisions: z.number().int().min(1).max(24).optional(),
    textureMode: z.enum(['natural', 'fit']).optional(),
  }),
  z.object({
    type: z.literal('create_area'),
    ...creationMetadataSchema,
    id: symbolicId,
    purpose: z.string().min(1).max(500),
    shape: spatialAreaShapeSchema,
    center: vec3,
    bounds: screenshotBounds.optional(),
    radius: z.number().positive().optional(),
    height: z.number().positive(),
    levels: z.array(z.number()).max(16).optional(),
    footprint: z.array(vec3).min(3).max(64).optional(),
    openings: z.array(spatialOpeningSchema).max(32).optional(),
    landmarkIntent: z.string().max(1000).optional(),
    geometry: z.enum(['none', 'floor', 'room']).optional(),
    texture: z.string().min(1).optional(),
    wallThickness: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal('connect_areas'),
    ...creationMetadataSchema,
    id: symbolicId,
    fromArea: symbolicId,
    toArea: symbolicId,
    routeType: spatialRouteTypeSchema,
    width: z.number().positive(),
    verticalChange: z.number().optional(),
    curvature: z.number().min(-1).max(1).optional(),
    cover: z.enum(['open', 'partial', 'enclosed']).optional(),
    visibility: z.enum(['hidden', 'glimpse', 'visible']).optional(),
    traversalIntent: z.string().max(1000).optional(),
    geometry: z.enum(['none', 'floor']).optional(),
    thickness: z.number().positive().optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('create_path'),
    ...creationMetadataSchema,
    id: symbolicId,
    parent: operationRef.optional(),
    kind: constructionPathKindSchema,
    curve: z.enum(['polyline', 'catmull-rom']).optional(),
    points: z.array(vec3).min(2).max(64),
    width: z.number().positive(),
    height: z.number().positive().optional(),
    thickness: z.number().positive().optional(),
    spacing: z.number().positive().optional(),
    subdivisions: z.number().int().min(1).max(16).optional(),
    sides: z.number().int().min(3).max(32).optional(),
    join: z.enum(['overlap', 'bevel']).optional(),
    capEnds: z.boolean().optional(),
    bankDegrees: z.number().min(-180).max(180).optional(),
    texture: z.string().min(1).optional(),
    classification: z.enum(['detail', 'structural']).optional(),
  }),
  z.object({ type: z.literal('translate'), targets: z.array(operationRef).min(1), delta: vec3 }),
  z.object({ type: z.literal('rotate'), targets: z.array(operationRef).min(1), center: vec3, axis: z.enum(['x', 'y', 'z']), angleDegrees: z.number() }),
  z.object({ type: z.literal('mirror'), targets: z.array(operationRef).min(1), center: vec3, axis: z.enum(['x', 'y', 'z']) }),
  z.object({ type: z.literal('clone'), ...creationMetadataSchema, targets: z.array(operationRef).min(1), delta: vec3.optional() }),
  z.object({ type: z.literal('array'), ...creationMetadataSchema, targets: z.array(operationRef).min(1), copies: z.number().int().min(1).max(64), delta: vec3 }),
  z.object({ type: z.literal('set_texture'), targets: z.array(operationRef).min(1), texture: z.string().min(1) }),
  z.object({
    type: z.literal('edit_faces'),
    targets: z.array(faceRef).min(1),
    texture: z.string().min(1).optional(),
    shift: z.tuple([z.number(), z.number()]).optional(),
    scale: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    rotateDegrees: z.number().optional(),
    fit: z.boolean().optional(),
    contentFlags: z.number().int().nonnegative().optional(),
    surfaceFlags: z.number().int().nonnegative().optional(),
    value: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('edit_patches'),
    targets: z.array(operationRef).min(1),
    texture: z.string().min(1).optional(),
    textureMode: z.enum(['natural', 'fit']).optional(),
    shift: z.tuple([z.number(), z.number()]).optional(),
    scale: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    rotateDegrees: z.number().optional(),
    subdivisions: z.number().int().min(1).max(24).optional(),
  }),
  z.object({
    type: z.literal('thicken_patch'),
    ...creationMetadataSchema,
    targets: z.array(operationRef).min(1),
    amount: z.number().positive(),
    caps: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('set_brush_classification'),
    targets: z.array(operationRef).min(1),
    classification: z.enum(['detail', 'structural']),
  }),
  z.object({
    type: z.literal('clip_brushes'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    planePoints: z.tuple([vec3, vec3, vec3]),
    keep: z.enum(['front', 'back', 'both']).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('hollow_brushes'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    thickness: z.number().positive(),
  }),
  z.object({
    type: z.literal('csg_subtract'),
    id: symbolicId.optional(),
    targets: z.array(operationRef).min(1),
    carvers: z.array(operationRef).min(1),
    deleteCarvers: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('create_jump_pad'),
    ...creationMetadataSchema,
    mins: vec3,
    maxs: vec3,
    apex: vec3,
    targetname: z.string().min(1).max(64).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('create_teleporter'),
    ...creationMetadataSchema,
    mins: vec3,
    maxs: vec3,
    destination: vec3,
    exitAngle: z.number().optional(),
    targetname: z.string().min(1).max(64).optional(),
    texture: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('assign_group'),
    targets: z.array(operationRef).min(1),
    group: z.string().min(1).max(120),
    groupId: groupId.optional(),
  }),
  z.object({ type: z.literal('remove_from_group'), targets: z.array(operationRef).min(1) }),
  z.object({ type: z.literal('delete'), targets: z.array(operationRef).min(1) }),
] as const;
const mapOperation = z.discriminatedUnion('type', mapOperationVariants);
const operationSchemaByType = new Map(mapOperationVariants.map(schema => [schema.shape.type.value, schema]));
const GLOBAL_TEXTURE_TRANSFORM_NOTE = 'textureTransform applies to every created face. fit runs first, then relative shift, scale, and rotation.';
const OPERATION_SCHEMA_NOTES: Partial<Record<(typeof SUPPORTED_MAP_OPERATIONS)[number], string[]>> = {
  create_box: [
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
    'textureTransforms.top, bottom, and sides override individual fields from textureTransform for those semantic faces.',
  ],
  create_room: [
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
    'textureTransforms.walls, floor, and ceiling override individual fields from textureTransform for each room component.',
  ],
  create_box_array: [
    'Creates count evenly spaced brushes at mins/maxs + delta × index; classification can mark every brush detail immediately.',
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
    'textureTransforms.top, bottom, and sides override individual fields from textureTransform for every created box.',
  ],
  create_primitive: [
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
    'textureTransforms.top, bottom, and sides use the primitive axis for cap classification; a box always uses Z caps.',
  ],
  create_wedge: [GLOBAL_TEXTURE_TRANSFORM_NOTE],
  create_tapered: [
    'Creates one convex six-face brush. topScale changes the top rectangle relative to the base; topOffset produces an asymmetric trapezoid.',
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
  ],
  create_stairs: [
    GLOBAL_TEXTURE_TRANSFORM_NOTE,
    'textureTransforms.treads, risers, sides, and underside override individual fields from textureTransform on every step.',
  ],
  create_jump_pad: [
    'apex is required and is the target_position at the top of the trajectory; destination is not valid.',
    'The operation creates and wires trigger_push, its trigger brush, and target_position atomically.',
  ],
  create_teleporter: [
    'destination is required and is the misc_teleporter_dest origin; apex is not valid.',
    'exitAngle controls the destination facing angle in degrees.',
  ],
  create_brush: [
    'Each face is a plane defined by three points. Point winding must face outward.',
    'textureTransform applies to every face; faces[].textureTransform overrides individual transform fields for that face.',
  ],
  create_prefab: [
    'Creates a reusable pillar (3 brushes), door_frame (3 brushes), or jump_pad_base (one 16-sided cylinder) inside mins/maxs.',
    'texture is required and must be discovered from loaded assets; textures.primary, accent, focal, sides, and bottom override material roles.',
    'Prefabs default to detail classification. Set classification to structural only when the module must seal the world or control visibility.',
    'jump_pad_base fits the focal material once on its top. Pillars and door frames preserve natural architectural tiling.',
  ],
  create_patch: [
    'Creates a native editable patchDef2 surface using bevel, endcap, cylinder, arch, pipe, or ramp control grids.',
    'axis selects the extrusion axis for bevel/endcap/cylinder/pipe and arch; direction orients ramps. Use textureMode=fit for one repeat or natural for world-scale tiling.',
    'Generated patches are validated for odd 3..31 control grids, finite control points/UVs, finite bounds, and non-empty tessellation.',
  ],
  edit_patches: [
    'Targets patch references or patch-owning entities. textureMode is applied before relative shift, scale, and rotation.',
    'subdivisions controls editor/render tessellation from 1 through 24 without changing the serialized control grid.',
  ],
  thicken_patch: [
    'Replaces each target patch with offset front/back surfaces and, by default, four cap patches. The new patches preserve source group membership.',
    'Use id to address every resulting patch through one symbolic alias later in the batch.',
  ],
  create_area: [
    'Persists a semantic area in worldspawn independently of generated geometry. id remains stable across later MCP sessions.',
    'Provide bounds, a positive radius, or at least three footprint points. levels are absolute world Z values.',
    'geometry defaults to none for plan-first work. floor creates editable grouped box/cylinder floors; room currently requires rectangular shape.',
  ],
  connect_areas: [
    'Both area ids must already exist, including areas created earlier in the same map_apply batch.',
    'Persists route intent independently of geometry. geometry=floor creates one editable grouped straight connector that may slope between area centers.',
    'curvature records normalized design intent from -1 to 1; curved realization is handled by later path construction rather than hidden geometry.',
  ],
  create_path: [
    'Creates ordinary editable grouped brushes along a polyline or Catmull-Rom path and persists the control points plus generated group, bounds, and object count in worldspawn.',
    'corridor, wall, beam, and trim create joined oriented boxes; railing adds spaced posts; pipe uses oriented cylinders; supports are distributed vertically; stairs follow resampled path points.',
    'Use map_preview first to inspect generated references, bounds, counts, and diagnostics. map_construction_paths_get returns the durable source-to-generated relationship after applying.',
    'Path brushes are closed compiler-safe solids, so their physical ends are always capped. join controls overlap versus four-sided beveled corner fillers; bankDegrees applies a constant roll.',
  ],
  create_entity_array: ['Creates count entities at start + delta × index in one operation and one undo transaction.'],
  edit_faces: [
    'Targets must be face references such as E0:B2:F4 or a symbolic brush reference with an optional :F suffix.',
    'fit runs before relative shift, scale, and rotation, so they can intentionally adjust a fitted texture in one operation.',
  ],
  assign_group: ['The group name reuses an existing case-insensitive match or creates a persistent named group.'],
};

// Keep the client-facing schema flat. Some MCP hosts omit tools whose JSON
// Schema contains nested oneOf/anyOf unions. Strict per-operation validation
// still happens in the handler through mapOperation below.
const compatibleMapOperationInput = z.object({
  type: z.enum([
    'create_entity',
    'create_entity_array',
    'set_entity_properties',
    'create_box',
    'create_box_array',
    'create_room',
    'create_primitive',
    'create_wedge',
    'create_tapered',
    'create_stairs',
    'create_brush',
    'create_prefab',
    'create_patch',
    'create_area',
    'connect_areas',
    'create_path',
    'translate',
    'rotate',
    'mirror',
    'clone',
    'array',
    'set_texture',
    'edit_faces',
    'edit_patches',
    'thicken_patch',
    'set_brush_classification',
    'clip_brushes',
    'hollow_brushes',
    'csg_subtract',
    'create_jump_pad',
    'create_teleporter',
    'assign_group',
    'remove_from_group',
    'delete',
  ]),
  id: symbolicId.optional(),
  classname: z.string().optional(),
  origin: compatibleVec3.optional(),
  start: compatibleVec3.optional(),
  count: z.number().int().optional(),
  properties: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
  target: operationRef.optional(),
  targets: z.array(compatibleTargetRef).optional(),
  parent: operationRef.optional(),
  mins: compatibleVec3.optional(),
  maxs: compatibleVec3.optional(),
  texture: z.string().optional(),
  wallThickness: z.number().optional(),
  textures: z.object({
    walls: z.string().optional(),
    floor: z.string().optional(),
    ceiling: z.string().optional(),
    top: z.string().optional(),
    bottom: z.string().optional(),
    sides: z.string().optional(),
    treads: z.string().optional(),
    risers: z.string().optional(),
    underside: z.string().optional(),
    primary: z.string().optional(),
    accent: z.string().optional(),
    focal: z.string().optional(),
  }).optional(),
  textureTransform: compatibleTextureTransformSchema.optional(),
  textureTransforms: z.object({
    walls: compatibleTextureTransformSchema.optional(),
    floor: compatibleTextureTransformSchema.optional(),
    ceiling: compatibleTextureTransformSchema.optional(),
    top: compatibleTextureTransformSchema.optional(),
    bottom: compatibleTextureTransformSchema.optional(),
    sides: compatibleTextureTransformSchema.optional(),
    treads: compatibleTextureTransformSchema.optional(),
    risers: compatibleTextureTransformSchema.optional(),
    underside: compatibleTextureTransformSchema.optional(),
    primary: compatibleTextureTransformSchema.optional(),
    accent: compatibleTextureTransformSchema.optional(),
    focal: compatibleTextureTransformSchema.optional(),
  }).optional(),
  primitive: z.enum(['box', 'cylinder', 'cone', 'sphere', 'pyramid']).optional(),
  prefab: z.enum(['pillar', 'door_frame', 'jump_pad_base']).optional(),
  preset: z.enum(['bevel', 'endcap', 'cylinder', 'arch', 'pipe', 'ramp']).optional(),
  kind: constructionPathKindSchema.optional(),
  curve: z.enum(['polyline', 'catmull-rom']).optional(),
  points: z.array(compatibleVec3).optional(),
  spacing: z.number().optional(),
  join: z.enum(['overlap', 'bevel']).optional(),
  capEnds: z.boolean().optional(),
  bankDegrees: z.number().optional(),
  purpose: z.string().optional(),
  shape: spatialAreaShapeSchema.optional(),
  bounds: z.object({ mins: compatibleVec3, maxs: compatibleVec3 }).optional(),
  radius: z.number().optional(),
  height: z.number().optional(),
  levels: z.array(z.number()).optional(),
  footprint: z.array(compatibleVec3).optional(),
  openings: z.array(z.object({
    side: z.enum(['north', 'south', 'east', 'west', 'up', 'down']), width: z.number(), offset: z.number().optional(), note: z.string().optional(),
  })).optional(),
  landmarkIntent: z.string().optional(),
  geometry: z.enum(['none', 'floor', 'room']).optional(),
  fromArea: symbolicId.optional(),
  toArea: symbolicId.optional(),
  routeType: spatialRouteTypeSchema.optional(),
  width: z.number().optional(),
  verticalChange: z.number().optional(),
  curvature: z.number().optional(),
  cover: z.enum(['open', 'partial', 'enclosed']).optional(),
  visibility: z.enum(['hidden', 'glimpse', 'visible']).optional(),
  traversalIntent: z.string().optional(),
  orientation: z.enum(['x', 'y']).optional(),
  axis: z.enum(['x', 'y', 'z']).optional(),
  sides: z.number().int().optional(),
  direction: z.enum(['x+', 'x-', 'y+', 'y-']).optional(),
  steps: z.number().int().optional(),
  topScale: z.array(z.number()).length(2).optional(),
  topOffset: z.array(z.number()).length(2).optional(),
  subdivisions: z.number().int().optional(),
  textureMode: z.enum(['natural', 'fit']).optional(),
  faces: z.array(z.object({
    points: z.array(compatibleVec3).length(3),
    texture: z.string().optional(),
    textureTransform: compatibleTextureTransformSchema.optional(),
  })).optional(),
  center: compatibleVec3.optional(),
  angleDegrees: z.number().optional(),
  copies: z.number().int().optional(),
  delta: compatibleVec3.optional(),
  shift: z.array(z.number()).length(2).optional(),
  scale: z.array(z.number()).length(2).optional(),
  rotateDegrees: z.number().optional(),
  fit: z.boolean().optional(),
  contentFlags: z.number().int().optional(),
  surfaceFlags: z.number().int().optional(),
  value: z.number().int().optional(),
  classification: z.enum(['detail', 'structural']).optional(),
  planePoints: z.array(compatibleVec3).length(3).optional(),
  keep: z.enum(['front', 'back', 'both']).optional(),
  thickness: z.number().optional(),
  amount: z.number().optional(),
  caps: z.boolean().optional(),
  carvers: z.array(operationRef).optional(),
  deleteCarvers: z.boolean().optional(),
  apex: compatibleVec3.optional(),
  destination: compatibleVec3.optional(),
  exitAngle: z.number().optional(),
  targetname: z.string().optional(),
  group: z.string().optional(),
  groupId: z.string().optional(),
});

const mapOperationBatchInputSchema = {
  ...sessionInput,
  expectedRevision: z.number().int().nonnegative(),
  label: z.string().min(1).max(120).describe('Undo or preview label, for example MCP: Add side room'),
  operations: z.array(compatibleMapOperationInput).min(1).max(MAX_BATCH_OPERATIONS),
  responseDetail: z.enum(['full', 'compact']).optional().default('full'),
};

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function toolResult(value: unknown, text?: string) {
  return {
    content: [{ type: 'text' as const, text: text ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function validatedMapOperations(operations: unknown[]): MapOperation[] {
  return operations.map((operation, index) => {
    const parsed = mapOperation.safeParse(operation);
    if (!parsed.success) throw new Error(`Invalid operation ${index + 1}: ${z.prettifyError(parsed.error)}`);
    return parsed.data as MapOperation;
  });
}

function spatialPlanFromMapText(mapText: string) {
  const worldspawn = parseMapWithDiagnostics(mapText).document.entities.find(entity => entity.classname === 'worldspawn');
  return readSpatialPlan(worldspawn?.properties ?? {});
}

function constructionPathsFromMapText(mapText: string) {
  const worldspawn = parseMapWithDiagnostics(mapText).document.entities.find(entity => entity.classname === 'worldspawn');
  return readConstructionPaths(worldspawn?.properties ?? {});
}

function compactRefs(refs: string[]): { count: number; refs: string[]; truncated: boolean } {
  if (refs.length <= 8) return { count: refs.length, refs, truncated: false };
  return { count: refs.length, refs: [...refs.slice(0, 4), ...refs.slice(-4)], truncated: true };
}

function compactItems<T>(items: T[]): { count: number; sample: T[]; truncated: boolean } {
  return { count: items.length, sample: items.slice(0, 8), truncated: items.length > 8 };
}

function compactApplyResult(result: {
  revision: number; operationCount: number; summary: string; created: string[]; changed: string[]; aliases: Record<string, string[]>;
}): Record<string, unknown> {
  return {
    revision: result.revision, operationCount: result.operationCount, summary: result.summary,
    created: compactRefs(result.created), changed: compactRefs(result.changed),
    aliases: Object.fromEntries(Object.entries(result.aliases).map(([alias, refs]) => [alias, compactRefs(refs)])),
  };
}

export function createQ3EditMcpServer(hub: BridgeHub, activityLog?: McpActivityLog): McpServer {
  let selectedEditorSessionId: string | undefined;
  const session = (requested?: string): string => hub.resolveSessionId(requested ?? selectedEditorSessionId);
  const sessionValue = (sessionId: string, value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { sessionId, ...(value as Record<string, unknown>) };
    return { sessionId, result: value };
  };
  const server = new McpServer({ name: 'q3edit-live', version: '0.1.0' }, {
    instructions: [
      'Call editor_sessions first when more than one Q3Edit browser may be open, then pass sessionId or select one with editor_session_select.',
      'Inspect map_status before editing. Use map_query, map_groups, and the texture/entity discovery tools instead of guessing object, asset, or classname data.',
      'Call map_style_get before substantial authoring and follow its persistent palette, grid, density, lighting, and visual notes when configured.',
      'For substantial layouts, call map_spatial_plan_get and preview semantic areas and connections before generating detailed geometry. Use create_area and connect_areas to keep spatial intent persistent and inspectable.',
      'Prefer create_tapered and native create_patch bevel, endcap, cylinder, arch, pipe, or ramp surfaces when spatial review shows excessive box and axis-aligned geometry.',
      'Use create_path for curved or segmented corridors, walls, railings, pipes, beams, trim, stairs, and supports. Preview complex paths first, then inspect their persistent source/group relationship with map_construction_paths_get.',
      'Use the returned revision as expectedRevision in map_apply. Group related changes into one map_apply call so they appear as one undo step in Q3Edit.',
      'Object references and revisions belong to one editor session. Creation operations may declare id and later operations in the same batch may target @id.',
      'Treat texture projection as part of geometry creation: use textureTransform for all faces and textureTransforms for semantic overrides such as top, sides, floor, or treads.',
      'Use fit for focal surfaces that should show one complete image, but preserve intentional tiling on large walls and floors. Inspect unfamiliar materials, run map_texture_review, and verify textured geometry with editor_screenshot.',
      'Run map_spatial_review after blockout changes and address repeated axis alignment, weak height or route variation, flat walls, and missing spatial rhythm before adding decoration.',
      'After a major edit, use editor_review_bundle for consistently framed perspective and orthographic visual review.',
    ].join(' '),
  });
  if (activityLog) {
    const registerTool = server.registerTool.bind(server) as any;
    server.registerTool = ((name: string, config: unknown, callback: (...args: any[]) => any) => {
      const readOnly = (config as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
      return registerTool(name, config as any, async (args: Record<string, unknown>, extra: unknown) => {
        const startedAt = Date.now();
        const requestedSessionId = typeof args.sessionId === 'string' ? args.sessionId : selectedEditorSessionId;
        let editorSessionId: string | null = null;
        try { editorSessionId = hub.resolveSessionId(requestedSessionId); } catch { /* Tools may not target an editor. */ }
        const revision = (): number | null => {
          if (!editorSessionId) return null;
          try { return hub.status(editorSessionId).snapshot?.revision ?? null; } catch { return null; }
        };
        const revisionBefore = revision();
        let result: any;
        try {
          result = await callback(args, extra);
        } catch (error) {
          try {
            await activityLog.record({
              editorSessionId, tool: name, readOnly, durationMs: Date.now() - startedAt, status: 'error',
              revisionBefore, revisionAfter: revision(), revisionDelta: null,
              arguments: args, result: { thrown: error instanceof Error ? error.message : String(error) },
            });
          } catch (logError) {
            console.error('Failed to record MCP activity', logError);
          }
          throw error;
        }
        const revisionAfter = revision();
        try {
          await activityLog.record({
            editorSessionId, tool: name, readOnly, durationMs: Date.now() - startedAt, status: result?.isError ? 'error' : 'success',
            revisionBefore, revisionAfter,
            revisionDelta: revisionBefore === null || revisionAfter === null ? null : revisionAfter - revisionBefore,
            arguments: args,
            result: result?.structuredContent ?? { isError: result?.isError === true, content: result?.content },
          });
        } catch (logError) {
          console.error('Failed to record MCP activity', logError);
        }
        return result;
      });
    }) as typeof server.registerTool;
  }

  server.registerTool('editor_sessions', {
    title: 'List connected Q3Edit editor sessions',
    description: 'List stable browser-tab session IDs with filenames, revisions, active save paths, and activity timestamps. Use this before document tools when multiple editors are open.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolResult({ selectedSessionId: selectedEditorSessionId ?? null, sessions: hub.listSessions() }));

  server.registerTool('activity_log', {
    title: 'Inspect this MCP session activity log',
    description: 'Return recent tool calls from this MCP connection, including target editor session, duration, status, summarized arguments/results, and revision deltas. The complete append-only JSONL transcript is written to filePath.',
    inputSchema: {
      editorSessionId: editorSessionId.optional().describe('Optionally filter entries to one editor tab'),
      limit: z.number().int().min(1).max(500).optional().default(50),
    },
    outputSchema: activityLogOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ editorSessionId, limit }) => toolResult({
    enabled: Boolean(activityLog),
    filePath: activityLog?.filePath ?? null,
    mcpSessionId: activityLog?.mcpSessionId ?? null,
    count: activityLog?.count ?? 0,
    entries: activityLog?.recent(limit, editorSessionId) ?? [],
  }));

  server.registerTool('editor_session_select', {
    title: 'Select a Q3Edit editor session',
    description: 'Set the default editor session for subsequent tools on this MCP connection. Explicit sessionId arguments still override it.',
    inputSchema: { sessionId: editorSessionId },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      selectedEditorSessionId = hub.resolveSessionId(sessionId);
      return toolResult({ selectedSessionId: selectedEditorSessionId, status: hub.status(selectedEditorSessionId) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_status', {
    title: 'Get live Q3Edit map status',
    description: 'Return the connected editor, active map, revision, map counts, and diagnostics summary.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(hub.status(resolved));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_capabilities', {
    title: 'Describe Q3Edit MCP capabilities and limits',
    description: 'Return batch limits, supported operation versions, screenshot constraints, compiler availability, and the selected editor’s loaded project/game profile.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const editor = await hub.editorCapabilities(resolved);
      return toolResult({
        sessionId: resolved,
        protocolVersion: 2,
        operations: { version: 6, maxPerBatch: MAX_BATCH_OPERATIONS, supported: SUPPORTED_MAP_OPERATIONS },
        spatialPlanning: {
          persistent: true,
          tools: ['map_spatial_plan_get', 'map_spatial_plan_preview'],
          operations: ['create_area', 'connect_areas'],
          geometryIndependent: true,
        },
        curvedGeometry: {
          patchPresets: ['bevel', 'endcap', 'cylinder', 'arch', 'pipe', 'ramp'],
          operations: ['create_patch', 'edit_patches', 'thicken_patch'],
          textureModes: ['natural', 'fit'],
        },
        pathConstruction: {
          persistent: true,
          tools: ['map_construction_paths_get'],
          operation: 'create_path',
          kinds: ['corridor', 'wall', 'railing', 'pipe', 'beam', 'trim', 'stairs', 'supports'],
          curves: ['polyline', 'catmull-rom'],
          maxControlPoints: 64,
          maxGeneratedObjects: 256,
        },
        textureProjection: {
          creationFields: ['textureTransform', 'textureTransforms'],
          controls: ['fit', 'shift', 'scale', 'rotateDegrees'],
          order: ['fit', 'shift', 'scale', 'rotateDegrees'],
          semanticSlots: ['top', 'bottom', 'sides', 'walls', 'floor', 'ceiling', 'treads', 'risers', 'underside'],
          note: 'Fit focal one-image surfaces; keep intentional tiling on large architectural surfaces and verify with editor_screenshot.',
        },
        coordinates: {
          finiteNumbersRequired: true,
          enforcedRange: null,
          recommendedRange: [-32768, 32768],
          note: 'Q3Edit accepts finite coordinates; the recommended range avoids common Quake III compiler and precision problems.',
        },
        screenshots: {
          minWidth: 64, minHeight: 64, maxWidth: 2048, maxHeight: 2048,
          modes: ['perspective', 'top', 'front', 'side'],
          controls: [
            'frameBounds', 'frameGroup', 'hideGroups', 'hideToolBrushes', 'hideSkyBrushes', 'sectionBounds', 'xray',
            'showEntityLabels', 'showCoordinates', 'layoutOverlay',
          ],
          layoutPreset: 'editor_layout_screenshot',
        },
        compiler: { available: hub.compilerAvailable, qualities: ['fast', 'normal', 'full'] },
        editor,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('operation_schema', {
    title: 'Get the exact schema for one map operation',
    description: 'Return the discriminated JSON Schema, required fields, constraints, and semantic notes for one operation accepted by map_apply and map_preview. Use this instead of inferring fields from the compatibility-oriented flat batch schema.',
    inputSchema: { type: z.enum(SUPPORTED_MAP_OPERATIONS) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ type }) => {
    const schema = operationSchemaByType.get(type);
    if (!schema) return toolError(new Error(`Unknown map operation ${type}`));
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    return toolResult({
      type,
      acceptedBy: ['map_apply', 'map_preview'],
      jsonSchema,
      required: jsonSchema.required ?? [],
      notes: OPERATION_SCHEMA_NOTES[type] ?? [],
    });
  });

  server.registerTool('map_entities', {
    title: 'List live map entities',
    description: 'List entity references, classnames, property counts, geometry counts, targets, and diagnostics.',
    inputSchema: {
      ...sessionInput,
      classname: z.string().optional().describe('Optional exact classname filter'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, classname }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const entities = classname ? snapshot.entities.filter(entity => entity.classname === classname) : snapshot.entities;
      return toolResult({ sessionId: resolved, revision: snapshot.revision, entities });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_statistics', {
    title: 'Summarize map geometry and gameplay distribution',
    description: 'Return world bounds/size, structural versus detail geometry, texture usage, approximate light influence coverage, and spawn/item counts, bounds, class distribution, spacing, and object references.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...collectMapStatistics(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_texture_review', {
    title: 'Review texture projection quality',
    description: 'Analyze visible brush faces for low or excessive texel density, anisotropic stretching, suspicious one-repeat fitting on large faces, and inconsistent density between uses of one material. Findings include exact face references, projection metrics, and suggested edit_faces transforms.',
    inputSchema: {
      ...sessionInput,
      targetTexelsPerUnit: z.number().positive().optional().default(2),
      minimumTexelsPerUnit: z.number().positive().optional().default(0.5),
      maximumTexelsPerUnit: z.number().positive().optional().default(6),
      maximumAnisotropy: z.number().min(1).optional().default(3),
      largeFittedFaceArea: z.number().positive().optional().default(32768),
      includeToolTextures: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    outputSchema: textureReviewOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({
    sessionId, targetTexelsPerUnit, minimumTexelsPerUnit, maximumTexelsPerUnit,
    maximumAnisotropy, largeFittedFaceArea, includeToolTextures, limit,
  }) => {
    try {
      if (minimumTexelsPerUnit >= maximumTexelsPerUnit) {
        throw new Error('minimumTexelsPerUnit must be less than maximumTexelsPerUnit');
      }
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const names = textureNamesForReview(snapshot.mapText, includeToolTextures);
      const dimensions = new Map<string, TextureDimensions>();
      await Promise.all(names.map(async name => {
        try {
          const inspection = await hub.textureInspect(name, resolved) as { image?: { width?: number | null; height?: number | null } | null };
          const width = inspection.image?.width; const height = inspection.image?.height;
          if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return;
          dimensions.set(name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, ''), { width, height, verified: true });
        } catch { /* Projection review can fall back to 128×128 for unresolved shader-only materials. */ }
      }));
      return toolResult({
        sessionId: resolved, revision: snapshot.revision,
        ...reviewTextureQuality(snapshot.mapText, dimensions, {
          targetTexelsPerUnit, minimumTexelsPerUnit, maximumTexelsPerUnit,
          maximumAnisotropy, largeFittedFaceArea, includeToolTextures, limit,
        }),
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_geometry_lint', {
    title: 'Lint geometry construction quality',
    description: 'Find duplicate brushes, coplanar same-facing overlaps that may z-fight, sub-unit brush thickness, sliver faces, coordinates outside the compiler eighth-unit grid, and small structural brushes that are likely decorative detail. Returns exact brush or face references.',
    inputSchema: { ...sessionInput },
    outputSchema: geometryLintOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...lintGeometry(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_spatial_plan_get', {
    title: 'Get the persistent semantic spatial plan',
    description: 'Return semantic areas and connections stored in worldspawn independently of generated geometry, together with plan bounds, levels, route-type counts, connected components, and consistency findings.',
    inputSchema: { ...sessionInput },
    outputSchema: spatialPlanOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const plan = spatialPlanFromMapText(snapshot.mapText);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, plan, inspection: inspectSpatialPlan(plan) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_spatial_plan_preview', {
    title: 'Preview semantic areas and routes without editing',
    description: 'Merge proposed areas and connections into the current semantic plan in memory and return bounds, height levels, route distribution, connected components, overlap, missing-link, and isolation findings. This does not generate brushes or change the document.',
    inputSchema: {
      ...sessionInput,
      replace: z.boolean().optional().default(false).describe('Preview only the proposed plan instead of merging it with the current persisted plan'),
      areas: z.array(spatialAreaProposalSchema).max(128).optional().default([]),
      connections: z.array(spatialConnectionProposalSchema).max(256).optional().default([]),
    },
    outputSchema: spatialPlanOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, replace, areas, connections }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      let plan = replace ? { version: 1 as const, areas: [], connections: [] } : spatialPlanFromMapText(snapshot.mapText);
      for (const area of areas) plan = upsertSpatialArea(plan, {
        ...area, levels: area.levels ?? [area.bounds?.mins[2] ?? area.center[2]], openings: area.openings ?? [],
      } as SpatialArea);
      for (const connection of connections) plan = upsertSpatialConnection(plan, connection as SpatialConnection);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, plan, inspection: inspectSpatialPlan(plan) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_construction_paths_get', {
    title: 'Get persistent construction paths',
    description: 'Return every path source stored in worldspawn, including control points, generation settings, generated named group, object count, and bounds. The grouped output remains ordinary editable map geometry.',
    inputSchema: { ...sessionInput },
    outputSchema: constructionPathsOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const document = constructionPathsFromMapText(snapshot.mapText);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, document, summary: constructionPathSummary(document) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_spatial_review', {
    title: 'Review spatial design variety',
    description: 'Measure axis-aligned geometry dominance, floor-level and brush-dimension variety, approximate route branching/loops/dead ends, open-versus-enclosed rhythm, mirror symmetry, landmark and silhouette variation, and long flat walls. Findings are transparent authoring heuristics with suggested corrective actions.',
    inputSchema: { ...sessionInput },
    outputSchema: spatialReviewOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...reviewSpatialDesign(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_summary', {
    title: 'Get a compact map orientation summary',
    description: 'Return a token-efficient revision snapshot with world bounds, object/detail counts, diagnostic totals, major entity classes, and spawn/item distribution. Use this between edit batches instead of dumping the full document.',
    inputSchema: { ...sessionInput },
    outputSchema: mapSummaryOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const status = hub.status(resolved);
      const summary = compactMapSummary(snapshot.mapInfo, collectMapStatistics(snapshot.mapText));
      return toolResult({
        sessionId: resolved, revision: snapshot.revision, fileName: snapshot.fileName,
        activeMapPath: status.activeMapPath, ...summary,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_style_get', {
    title: 'Get the persistent map style brief',
    description: 'Read the structured visual direction stored in worldspawn for this map: theme, approved texture palette, modular grid, target texel density, lighting mood, detail density, and notes. Call this before substantial authoring work.',
    inputSchema: { ...sessionInput },
    outputSchema: styleBriefOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, brief: readStyleBrief(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_style_set', {
    title: 'Set the persistent map style brief',
    description: 'Store or replace structured visual direction in worldspawn as one undoable document revision. Palette entries may be exact materials or folder patterns such as base_wall/*. Guide palettes report informational deviations; strict palettes report warnings.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      brief: mapStyleBriefSchema,
    },
    outputSchema: styleBriefOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, brief }) => {
    try {
      if (Object.keys(brief).length === 0) throw new Error('brief must define at least one style field');
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const worldspawn = snapshot.entities.find(entity => entity.classname === 'worldspawn');
      if (!worldspawn) throw new Error('The map has no worldspawn entity');
      const serialized = serializeStyleBrief(brief);
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Set map style brief', [{
        type: 'set_entity_properties', target: worldspawn.id as `E${number}`,
        properties: { [MAP_STYLE_BRIEF_KEY]: serialized },
      }], resolved);
      return toolResult({ sessionId: resolved, revision: applied.result.revision, brief: readStyleBrief(applied.snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_style_review', {
    title: 'Review the map against its style brief',
    description: 'Measure palette adherence, modular-grid alignment, detail ratio, lighting mood, and target texture density against the persistent map style brief. Guide-level differences are informational; strict palette differences are warnings.',
    inputSchema: { ...sessionInput },
    outputSchema: styleReviewOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...reviewStyleBrief(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_design_review', {
    title: 'Run a combined map design review',
    description: 'Return one revision-consistent review combining editor validation, geometry construction quality, spatial design variety, gameplay placement lint, jump-pad analysis, approximate route reachability, and compact map statistics. Compact mode caps repeated findings; focused review tools remain available for deeper follow-up.',
    inputSchema: {
      ...sessionInput,
      detail: z.enum(['compact', 'full']).optional().default('compact'),
    },
    outputSchema: designReviewOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, detail }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({
        sessionId: resolved, revision: snapshot.revision,
        ...reviewMap(snapshot.mapText, snapshot.mapInfo, snapshot.diagnostics, detail),
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_inspect', {
    title: 'Inspect live map objects',
    description: 'Return properties, bounds, textures, and optional geometry for current revision object references.',
    inputSchema: {
      ...sessionInput,
      refs: z.array(objectRef).min(1).max(50),
      includeGeometry: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, refs, includeGeometry }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({
        sessionId: resolved,
        revision: snapshot.revision,
        objects: inspectMapObjects(snapshot.mapText, refs as MapDocumentRef[], includeGeometry),
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_validate', {
    title: 'Validate live map',
    description: 'Return all current parser, geometry, entity-link, texture, and model diagnostics from Q3Edit.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_gameplay_lint', {
    title: 'Lint gameplay placement',
    description: 'Run approximate gameplay checks for point entities embedded in solids, player-spawn hull clearance, and pickup support height. Results include implicated object references.',
    inputSchema: { ...sessionInput },
    outputSchema: gameplayLintOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const issues = lintGameplay(snapshot.mapText);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, issueCount: issues.length, issues });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_analyze_jump_pad', {
    title: 'Analyze a Quake III jump-pad trajectory',
    description: 'Reproduce the engine AimAtTarget velocity for an existing trigger_push or proposed trigger bounds/apex. Returns timing, velocity, nominal landing, first plausible landing surface, and approximate player-hull clearance collisions.',
    inputSchema: {
      ...sessionInput,
      triggerRef: z.string().regex(/^E\d+$/, 'Expected a trigger_push entity reference such as E12').optional(),
      mins: vec3.optional().describe('Proposed trigger bounds; required with maxs and apex when triggerRef is omitted'),
      maxs: vec3.optional(),
      apex: vec3.optional().describe('The target_position is the trajectory apex, not the landing point'),
      gravity: z.number().positive().optional().describe('Defaults to worldspawn gravity or Quake III default 800'),
      sampleCount: z.number().int().min(4).max(128).optional().default(32),
    },
    outputSchema: jumpPadOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, triggerRef, mins, maxs, apex, gravity, sampleCount }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const analysis = analyzeJumpPad(snapshot.mapText, { triggerRef, mins, maxs, apex, gravity, sampleCount });
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...analysis });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_route_lint', {
    title: 'Lint jump pads and approximate gameplay routes',
    description: 'Analyze every trigger_push trajectory and landing, then build a conservative platform graph connecting spawns, pickups, ordinary walk/jump transitions, and directed jump-pad routes. Results are editor heuristics, not AAS or engine playtest proof.',
    inputSchema: { ...sessionInput },
    outputSchema: routeLintOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, ...lintRoutes(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_compile', {
    title: 'Compile the live map',
    description: 'Run the browser-based q3map toolchain against the current document and return BSP success, leak status, byte size, structured diagnostics with implicated references where possible, and complete compiler output. Fast runs BSP only; normal adds fast VIS and LIGHT; full uses configured full VIS and LIGHT settings.',
    inputSchema: {
      ...sessionInput,
      quality: z.enum(['fast', 'normal', 'full']).optional().default('fast'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, quality }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.compileMap(quality, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_play', {
    title: 'Compile and playtest the live map',
    description: 'Compile the current map and launch the resulting BSP in Q3Edit’s browser ioquake3 preview. Noclip enables cheats and starts the noclip command for route inspection.',
    inputSchema: {
      ...sessionInput,
      quality: z.enum(['fast', 'normal', 'full']).optional().default('normal'),
      noclip: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, quality, noclip }) => {
    try {
      const resolved = session(sessionId);
      const compile = await hub.compileMap(quality, resolved) as { success?: boolean; output?: string[] };
      if (!compile.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(compile, null, 2) }],
          structuredContent: sessionValue(resolved, compile),
        };
      }
      const launch = await hub.playMap(noclip, resolved);
      return toolResult({ sessionId: resolved, compile, launch }, `Compiled and launched editor session ${resolved} (${quality}${noclip ? ', noclip' : ''}).`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_groups', {
    title: 'List persistent map groups',
    description: 'List stable named groups and their current member references. Group names and IDs survive revisions, save, and reload.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, groups: inspectMapGroups(snapshot.mapText) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_query', {
    title: 'Query live map objects',
    description: 'Find entities, brushes, or patches by classname, texture, entity property, and optional world-space bounds. Returns current-revision object references suitable for map_inspect or map_apply.',
    inputSchema: {
      ...sessionInput,
      kind: z.enum(['entity', 'brush', 'face', 'patch']).optional(),
      classname: z.string().optional().describe('Exact entity classname; geometry results are limited to geometry owned by matching entities'),
      texture: z.string().optional().describe('Case-insensitive texture name substring'),
      propertyKey: z.string().optional().describe('Entity property key that must exist'),
      propertyValue: z.string().optional().describe('Case-insensitive value substring; requires propertyKey'),
      group: z.string().optional().describe('Exact persistent group name or ID'),
      mins: compatibleVec3.optional().describe('Minimum world-space bounds; must be provided together with maxs'),
      maxs: compatibleVec3.optional().describe('Maximum world-space bounds; must be provided together with mins'),
      boundsMode: z.enum(['intersects', 'inside']).optional().default('intersects'),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    outputSchema: mapQueryOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, kind, classname, texture, propertyKey, propertyValue, group, mins, maxs, boundsMode, limit }) => {
    try {
      if ((mins && !maxs) || (!mins && maxs)) throw new Error('mins and maxs must be provided together');
      if (propertyValue !== undefined && !propertyKey) throw new Error('propertyValue requires propertyKey');
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const options: MapQueryOptions = {
        kind,
        classname,
        texture,
        propertyKey,
        propertyValue,
        group,
        bounds: mins && maxs ? {
          mins: mins as [number, number, number],
          maxs: maxs as [number, number, number],
          mode: boundsMode,
        } : undefined,
        limit,
      };
      const matches = queryMap(snapshot.mapText, options);
      return toolResult({ sessionId: resolved, revision: snapshot.revision, count: matches.length, matches });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_search', {
    title: 'Search loaded textures',
    description: 'Search the texture assets currently loaded by Q3Edit. Use returned names when creating or texturing geometry.',
    inputSchema: {
      ...sessionInput,
      query: z.string().optional().default(''),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, query, limit }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.textureSearch(query, limit, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview', {
    title: 'Preview a loaded texture',
    description: 'Return an image preview for an exact texture name from texture_search.',
    inputSchema: { ...sessionInput, name: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, name }) => {
    try {
      const resolved = session(sessionId);
      const preview = await hub.texturePreview(name, resolved);
      return {
        content: [
          { type: 'text' as const, text: `Texture preview: ${preview.name}` },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ],
        structuredContent: { sessionId: resolved, name: preview.name, mimeType: preview.mimeType },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_inspect', {
    title: 'Inspect texture and shader semantics',
    description: 'Return resolved image dimensions/source, complete parsed shader surfaceparms and q3map directives, stages and referenced images, skybox metadata, content/surface flags, transparency, emission, preview consistency, and compiler availability.',
    inputSchema: { ...sessionInput, name: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, name }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.textureInspect(name, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('texture_preview_many', {
    title: 'Preview several loaded textures',
    description: 'Return image previews for up to 12 exact previewable names from texture_search, useful for choosing a coherent palette in one call.',
    inputSchema: { ...sessionInput, names: z.array(z.string().min(1)).min(1).max(12) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, names }) => {
    try {
      const resolved = session(sessionId);
      const previews = await hub.texturePreviews(names, resolved);
      return {
        content: previews.flatMap(preview => [
          { type: 'text' as const, text: preview.name },
          { type: 'image' as const, data: preview.data, mimeType: preview.mimeType },
        ]),
        structuredContent: { sessionId: resolved, textures: previews.map(({ name, mimeType }) => ({ name, mimeType })) },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_search', {
    title: 'Search entity classes',
    description: 'Search Q3Edit entity definitions by classname, category, or description before creating an entity.',
    inputSchema: {
      ...sessionInput,
      query: z.string().optional().default(''),
      classType: z.enum(['point', 'brush']).optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, query, classType, limit }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.entityClassSearch(query, classType, limit, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('entity_class_schema', {
    title: 'Get an entity class schema',
    description: 'Return the full live definition, defaults, typed properties, spawnflags, and required incoming/outgoing target relationships for an exact entity classname.',
    inputSchema: { ...sessionInput, classname: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, classname }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.entityClassSchema(classname, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_select', {
    title: 'Select objects in Q3Edit',
    description: 'Select current-revision entity, brush, or patch references in the live editor so the user can inspect them.',
    inputSchema: {
      ...sessionInput,
      refs: z.array(objectRef).min(1).max(100),
      replace: z.boolean().optional().default(true).describe('Replace the current selection; false adds to it'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, refs, replace }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.selectObjects(refs, replace, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_frame_objects', {
    title: 'Frame objects in Q3Edit',
    description: 'Select object references and move all editor viewports to frame that selection.',
    inputSchema: { ...sessionInput, refs: z.array(objectRef).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, refs }) => {
    try {
      const resolved = session(sessionId);
      return toolResult(sessionValue(resolved, await hub.frameObjects(refs, resolved)));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_set_camera', {
    title: 'Position the Q3Edit 3D camera',
    description: 'Set the live 3D viewport camera using world coordinates and degree angles. Yaw is rotation around Z; pitch is positive when looking upward.',
    inputSchema: {
      ...sessionInput,
      position: compatibleVec3,
      yawDegrees: z.number(),
      pitchDegrees: z.number().min(-89.8).max(89.8),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, position, yawDegrees, pitchDegrees }) => {
    try {
      const resolved = session(sessionId);
      await hub.setCamera(
        position as [number, number, number],
        yawDegrees * Math.PI / 180,
        pitchDegrees * Math.PI / 180,
        resolved,
      );
      return toolResult({ sessionId: resolved, position, yawDegrees, pitchDegrees });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_look_at', {
    title: 'Point the Q3Edit 3D camera at a target',
    description: 'Position the 3D camera and calculate yaw/pitch so it looks directly at a world-space target.',
    inputSchema: { ...sessionInput, position: compatibleVec3, target: compatibleVec3 },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionId, position, target }) => {
    try {
      const resolved = session(sessionId);
      const delta = target.map((value, axis) => value - position[axis]);
      const horizontal = Math.hypot(delta[0], delta[1]);
      if (horizontal < 1e-9 && Math.abs(delta[2]) < 1e-9) throw new Error('position and target must differ');
      const yaw = Math.atan2(delta[1], delta[0]);
      const pitch = Math.atan2(delta[2], horizontal);
      await hub.setCamera(position as [number, number, number], yaw, pitch, resolved);
      return toolResult({
        sessionId: resolved, position, target,
        yawDegrees: yaw * 180 / Math.PI,
        pitchDegrees: pitch * 180 / Math.PI,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_screenshot', {
    title: 'Capture a controlled Q3Edit viewport',
    description: 'Render a perspective or orthographic PNG. The call can frame bounds/a named group and temporarily hide groups, entity markers, tool/sky brushes, or objects outside sectionBounds without modifying the document. xray produces a depth-free wireframe perspective.',
    inputSchema: {
      ...sessionInput,
      mode: z.enum(['perspective', 'top', 'front', 'side']).optional().default('perspective'),
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
      hideEntityMarkers: z.boolean().optional().default(false),
      hideGroups: z.array(z.string().min(1)).max(64).optional(),
      hideToolBrushes: z.boolean().optional().default(false),
      hideSkyBrushes: z.boolean().optional().default(false),
      sectionBounds: screenshotBounds.optional(),
      frameBounds: screenshotBounds.optional(),
      frameGroup: z.string().min(1).optional(),
      xray: z.boolean().optional().default(false),
      showEntityLabels: z.boolean().optional(),
      showCoordinates: z.boolean().optional(),
      layoutOverlay: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, ...options }) => {
    try {
      const resolved = session(sessionId);
      const screenshot = await hub.screenshot(options, resolved);
      return {
        content: [
          { type: 'text' as const, text: `Q3Edit ${options.mode} viewport · ${screenshot.width} × ${screenshot.height}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          sessionId: resolved,
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height,
          mode: options.mode,
          ...(screenshot.gridSize === undefined ? {} : {
            gridSize: screenshot.gridSize, majorGridSize: screenshot.majorGridSize,
            axisLabels: screenshot.axisLabels, worldUnitsPerPixel: screenshot.worldUnitsPerPixel,
          }),
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_layout_screenshot', {
    title: 'Capture a map-design layout overview',
    description: 'Capture a purpose-built top/front/side flat-shaded overview with grid, axis, and world-unit scale overlays. By default it frames the whole map, hides sky/tool brushes, and labels entities for spatial layout review.',
    inputSchema: {
      ...sessionInput,
      mode: z.enum(['top', 'front', 'side']).optional().default('top'),
      width: z.number().int().min(320).max(2048).optional().default(1200),
      height: z.number().int().min(240).max(2048).optional().default(900),
      frameBounds: screenshotBounds.optional(),
      frameGroup: z.string().min(1).optional(),
      sectionBounds: screenshotBounds.optional(),
      hideGroups: z.array(z.string().min(1)).max(64).optional(),
      hideToolBrushes: z.boolean().optional().default(true),
      hideSkyBrushes: z.boolean().optional().default(true),
      showEntityLabels: z.boolean().optional().default(true),
      showCoordinates: z.boolean().optional().default(false),
    },
    outputSchema: layoutScreenshotOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, ...options }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const defaultBounds = collectMapStatistics(snapshot.mapText).worldBounds;
      const frameBounds = options.frameBounds ?? (options.frameGroup ? undefined : defaultBounds ?? undefined);
      const screenshot = await hub.screenshot({ ...options, frameBounds, layoutOverlay: true }, resolved);
      if (screenshot.gridSize === undefined || screenshot.majorGridSize === undefined ||
          screenshot.axisLabels === undefined || screenshot.worldUnitsPerPixel === undefined) {
        throw new Error('The connected editor did not return layout screenshot metadata; reload Q3Edit from the current bridge build');
      }
      return {
        content: [
          { type: 'text' as const, text: `Q3Edit ${options.mode} layout · grid ${screenshot.gridSize} · ${screenshot.width} × ${screenshot.height}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          sessionId: resolved, mimeType: 'image/png', width: screenshot.width, height: screenshot.height,
          mode: options.mode, frameBounds: frameBounds ?? null,
          gridSize: screenshot.gridSize, majorGridSize: screenshot.majorGridSize,
          axisLabels: screenshot.axisLabels, worldUnitsPerPixel: screenshot.worldUnitsPerPixel,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('editor_review_bundle', {
    title: 'Capture a multi-angle map review bundle',
    description: 'Capture several consistently framed editor views in one call. The default bundle contains perspective, top, front, and side PNGs; orthographic views include layout grid/scale metadata. Use after major edits to review appearance and spatial structure without four tool round trips.',
    inputSchema: {
      ...sessionInput,
      views: z.array(z.enum(['perspective', 'top', 'front', 'side'])).min(1).max(4)
        .optional().default(['perspective', 'top', 'front', 'side']),
      width: z.number().int().min(320).max(1600).optional().default(960),
      height: z.number().int().min(240).max(1200).optional().default(720),
      frameBounds: screenshotBounds.optional(),
      frameGroup: z.string().min(1).optional(),
      sectionBounds: screenshotBounds.optional(),
      hideGroups: z.array(z.string().min(1)).max(64).optional(),
      hideToolBrushes: z.boolean().optional().default(true),
      hideSkyBrushes: z.boolean().optional().default(true),
      hideEntityMarkers: z.boolean().optional().default(false),
      showEntityLabels: z.boolean().optional().default(true),
      showCoordinates: z.boolean().optional().default(true),
    },
    outputSchema: reviewBundleOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, views, width, height, frameBounds: requestedBounds, frameGroup, ...visibility }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = hub.snapshot(resolved);
      const frameBounds = requestedBounds ?? (frameGroup ? undefined : collectMapStatistics(snapshot.mapText).worldBounds ?? undefined);
      const captures: Array<{
        mode: 'perspective' | 'top' | 'front' | 'side'; mimeType: string; data: string; width: number; height: number;
        gridSize?: number; majorGridSize?: number; axisLabels?: [string, string]; worldUnitsPerPixel?: number;
      }> = [];
      for (const mode of [...new Set(views)]) {
        const layout = mode !== 'perspective';
        const screenshot = await hub.screenshot({
          ...visibility, mode, width, height, frameBounds, frameGroup,
          layoutOverlay: layout,
          showEntityLabels: layout ? visibility.showEntityLabels : false,
          showCoordinates: layout ? visibility.showCoordinates : false,
        }, resolved);
        captures.push({ mode, ...screenshot });
      }
      return {
        content: captures.flatMap(capture => [
          { type: 'text' as const, text: `Q3Edit ${capture.mode} review · ${capture.width} × ${capture.height}` },
          { type: 'image' as const, data: capture.data, mimeType: capture.mimeType },
        ]),
        structuredContent: {
          sessionId: resolved, revision: snapshot.revision,
          frameBounds: frameBounds ?? null, frameGroup: frameGroup ?? null,
          views: captures.map(({ data: _data, ...capture }) => capture),
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_screenshot', {
    title: 'Capture the compiled BSP playtest',
    description: 'Return a PNG from the browser ioquake3 preview with current lifecycle state, sampled mean luminance, and explicit black-frame detection. Call game_wait_ready first.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      const screenshot = await hub.gameScreenshot(resolved);
      const warning = screenshot.blackFrame
        ? ` Warning: the captured frame is effectively black (mean luminance ${screenshot.meanLuminance.toFixed(2)}); inspect game_status for loading or renderer errors.`
        : '';
      return {
        content: [
          { type: 'text' as const, text: `Compiled BSP preview · ${screenshot.width} × ${screenshot.height}.${warning}` },
          { type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          sessionId: resolved, mimeType: screenshot.mimeType, width: screenshot.width, height: screenshot.height,
          blackFrame: screenshot.blackFrame, meanLuminance: screenshot.meanLuminance, status: screenshot.status,
        },
      };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_status', {
    title: 'Inspect compiled BSP preview status',
    description: 'Return ioquake3 lifecycle state, current map, noclip state, timestamps, last error, and recent stdout/stderr lines.',
    inputSchema: { ...sessionInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.gameStatus(resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_wait_ready', {
    title: 'Wait for compiled BSP preview readiness',
    description: 'Wait until the ioquake3 preview reports running, fails, closes, or reaches the timeout. Use before game_screenshot.',
    inputSchema: {
      ...sessionInput,
      timeoutMs: z.number().int().min(100).max(120_000).optional().default(30_000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, timeoutMs }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.waitForGameReady(timeoutMs, resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_command', {
    title: 'Run a safe compiled-preview command',
    description: 'Reliably relaunch the current compiled preview with a safe command. noclip enables cheats/noclip; restart reloads the current BSP.',
    inputSchema: { ...sessionInput, command: z.enum(['noclip', 'restart']) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, command }) => {
    try {
      const resolved = session(sessionId);
      return toolResult({ sessionId: resolved, ...(await hub.gameCommand(command, resolved)) });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('game_set_view', {
    title: 'Position the compiled-preview player',
    description: 'Relaunch the current BSP in noclip at a world-space position and yaw. Follow with game_wait_ready before capturing a screenshot.',
    inputSchema: { ...sessionInput, position: vec3, yawDegrees: z.number() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ sessionId, position, yawDegrees }) => {
    try {
      const resolved = session(sessionId);
      const status = await hub.setGameView(position, yawDegrees * Math.PI / 180, resolved);
      return toolResult({ sessionId: resolved, position, yawDegrees, ...status });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_preview', {
    title: 'Preview map operations without committing',
    description: 'Run an operation batch against an in-memory clone of the current revision. Returns generated references, aliases, object bounds, map counts, and diagnostics without changing the live document or undo history.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, label, operations, responseDetail }) => {
    try {
      const resolved = session(sessionId);
      const beforeSnapshot = hub.snapshot(resolved);
      const beforeGameplay = lintGameplay(beforeSnapshot.mapText);
      const preview = await hub.previewOperations(expectedRevision, label, validatedMapOperations(operations), resolved) as Record<string, unknown>;
      const previewMapText = typeof preview.mapText === 'string' ? preview.mapText : beforeSnapshot.mapText;
      const afterGameplay = lintGameplay(previewMapText);
      const issueKey = (issue: { code: string; message: string; refs: string[] }) => JSON.stringify([issue.code, issue.message, issue.refs]);
      const beforeKeys = new Set(beforeGameplay.map(issueKey));
      const afterKeys = new Set(afterGameplay.map(issueKey));
      const safePreview = { ...preview };
      delete safePreview.mapText;
      const gameplayLint = {
        beforeCount: beforeGameplay.length,
        afterCount: afterGameplay.length,
        added: afterGameplay.filter(issue => !beforeKeys.has(issueKey(issue))),
        resolved: beforeGameplay.filter(issue => !afterKeys.has(issueKey(issue))),
      };
      const previewResult: Record<string, unknown> = {
        ...safePreview,
        gameplayLint,
      };
      if (responseDetail === 'compact') {
        const created = Array.isArray(previewResult.created) ? previewResult.created as string[] : [];
        const changed = Array.isArray(previewResult.changed) ? previewResult.changed as string[] : [];
        const aliases = previewResult.aliases && typeof previewResult.aliases === 'object'
          ? previewResult.aliases as Record<string, string[]> : {};
        const objects = Array.isArray(previewResult.objects) ? previewResult.objects : [];
        return toolResult(sessionValue(resolved, {
          ...compactApplyResult({
            revision: Number(previewResult.revision), operationCount: Number(previewResult.operationCount),
            summary: `${previewResult.operationCount} operation preview`, created, changed, aliases,
          }),
          objects: { count: objects.length, sample: objects.slice(0, 8), truncated: objects.length > 8 },
          mapInfo: previewResult.mapInfo,
          diagnostics: Array.isArray(previewResult.diagnostics) ? compactItems(previewResult.diagnostics) : previewResult.diagnostics,
          gameplayLint: {
            beforeCount: gameplayLint.beforeCount, afterCount: gameplayLint.afterCount,
            added: compactItems(gameplayLint.added), resolved: compactItems(gameplayLint.resolved),
          },
        }));
      }
      return toolResult(sessionValue(resolved, previewResult));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_jump_pad', {
    title: 'Create a wired jump pad',
    description: 'Atomically create a trigger_push volume and its target_position apex, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      apex: compatibleVec3,
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Jump Pad'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, mins, maxs, apex, targetname, group }) => {
    try {
      const resolved = session(sessionId);
      const link = targetname ?? `mcp_jump_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create jump pad', [
        {
          type: 'create_jump_pad', id: 'jump_pad', mins: mins as [number, number, number],
          maxs: maxs as [number, number, number], apex: apex as [number, number, number], targetname: link, group,
        },
      ], resolved);
      return toolResult({ sessionId: resolved, ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_create_teleporter', {
    title: 'Create a wired teleporter',
    description: 'Atomically create a trigger_teleport volume and misc_teleporter_dest, wire their target keys, and place both in a persistent named group.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      mins: compatibleVec3,
      maxs: compatibleVec3,
      destination: compatibleVec3,
      exitAngle: z.number().optional().default(0),
      targetname: z.string().min(1).max(64).optional(),
      group: z.string().min(1).max(120).optional().default('Teleporter'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, mins, maxs, destination, exitAngle, targetname, group }) => {
    try {
      const resolved = session(sessionId);
      const link = targetname ?? `mcp_teleport_${expectedRevision}`;
      const applied = await hub.applyOperations(expectedRevision, 'MCP: Create teleporter', [
        {
          type: 'create_teleporter', id: 'teleporter', mins: mins as [number, number, number],
          maxs: maxs as [number, number, number], destination: destination as [number, number, number],
          exitAngle, targetname: link, group,
        },
      ], resolved);
      return toolResult({ sessionId: resolved, ...applied.result, targetname: link, mapInfo: applied.snapshot.mapInfo, diagnostics: applied.snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_apply', {
    title: 'Apply live map operations',
    description: 'Apply one atomic, undoable batch in the connected Q3Edit browser. Creation/clone/array operations accept an optional symbolic id; later operations in the batch can target @id. assign_group gives objects a stable persistent group for later map_query calls. Geometry includes primitives, wedges, stairs, convex plane brushes, textured modular prefabs, and bulk entity/box arrays. Geometry creation accepts textureTransform for all faces and textureTransforms for semantic face overrides; edit_faces controls existing face textures, projection, fit, and flags. Set responseDetail to compact for large batches and call operation_schema for exact fields.',
    inputSchema: mapOperationBatchInputSchema,
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, label, operations, responseDetail }) => {
    try {
      const resolved = session(sessionId);
      const validatedOperations = validatedMapOperations(operations);
      const applied = await hub.applyOperations(expectedRevision, label, validatedOperations, resolved);
      const result = responseDetail === 'compact' ? compactApplyResult(applied.result) : applied.result;
      const value = {
        sessionId: resolved,
        ...result,
        mapInfo: applied.snapshot.mapInfo,
        diagnostics: applied.snapshot.diagnostics,
      };
      const aliases = Object.keys(applied.result.aliases).length > 0
        ? `\nAliases: ${JSON.stringify((result as { aliases?: unknown }).aliases)}`
        : '';
      return toolResult(value, `${applied.result.summary}\nEditor session: ${resolved}\nRevision: ${applied.result.revision}${aliases}`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_new', {
    title: 'Create a new map document',
    description: 'Atomically replace one editor session with an empty or starter document. Requires the current revision, always preserves a valid worldspawn, resets the active save path, and can retain or override worldspawn properties.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      template: z.enum(['empty', 'starter']).optional().default('empty'),
      preserveWorldspawn: z.boolean().optional().default(true),
      worldspawnProperties: z.record(z.string(), z.string()).optional(),
      fileName: z.string().min(1).max(200).optional().default('untitled.map'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, template, preserveWorldspawn, worldspawnProperties, fileName }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = await hub.newMap({
        expectedRevision, template, preserveWorldspawn, worldspawnProperties, fileName,
      }, resolved);
      return toolResult({
        sessionId: resolved, fileName: snapshot.fileName, revision: snapshot.revision,
        mapInfo: snapshot.mapInfo, diagnostics: snapshot.diagnostics,
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_open', {
    title: 'Open map in Q3Edit',
    description: 'Read a local .map file and replace the connected browser document with it.',
    inputSchema: { ...sessionInput, path: z.string().min(1) },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    try {
      const resolved = session(sessionId);
      const snapshot = await hub.openMap(path, resolved);
      return toolResult({ sessionId: resolved, path, revision: snapshot.revision, mapInfo: snapshot.mapInfo, diagnostics: snapshot.diagnostics });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_save', {
    title: 'Save live map',
    description: 'Atomically save the connected browser document to the active path or a supplied local path.',
    inputSchema: { ...sessionInput, path: z.string().min(1).optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, path }) => {
    try {
      const resolved = session(sessionId);
      const result = await hub.saveMap(path, resolved);
      return toolResult({ sessionId: resolved, ...result }, `Saved editor session ${resolved} revision ${result.revision} to ${result.path}`);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('map_save_and_compile', {
    title: 'Save and compile the current map revision',
    description: 'Revision-check the selected document, atomically save it to the active or supplied path, then compile that live revision and return the save result plus structured compiler diagnostics.',
    inputSchema: {
      ...sessionInput,
      expectedRevision: z.number().int().nonnegative(),
      path: z.string().min(1).optional(),
      quality: z.enum(['fast', 'normal', 'full']).optional().default('normal'),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId, expectedRevision, path, quality }) => {
    try {
      const resolved = session(sessionId);
      const current = hub.snapshot(resolved);
      if (current.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, current revision is ${current.revision}`);
      const saved = await hub.saveMap(path, resolved);
      const compile = await hub.compileMap(quality, resolved) as Record<string, unknown>;
      return toolResult({ sessionId: resolved, saved, compile },
        `Saved revision ${saved.revision} to ${saved.path}; compile ${compile.success ? 'succeeded' : 'failed'} (${quality}).`);
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}
