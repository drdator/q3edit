import { Vec3, vec3, vec3Add, vec3Sub, vec3Copy, vec3Scale, vec3Min, vec3Max } from './math';
import { Brush, BrushFace, computeBrushGeometry, brushCenter, BrushValidationResult } from './brush';
import { Entity, createEntity, createWorldspawn } from './entity';
import { Patch } from './patch';
import { History } from './history';
import { TextureManager } from './textures';
import type { ModelManager } from './model-manager';
import { loadDisplayPreferences, saveDisplayPreferences, setDisplayCategory, type DisplayCategory, type RendererMode, type TextureFiltering } from './display-policy';
import { BrushVertex } from './vertex';
import {
  addBrushToSelection as addBrushSelectionItem,
  addBrushDirectToSelection as addBrushDirectSelectionItem,
  addEntityToSelection as addEntitySelectionItem,
  addPatchDirectToSelection as addPatchDirectSelectionItem,
  addPatchToSelection as addPatchSelectionItem,
  clearSelection as clearEditorSelection,
  getSelectedFace,
  getSelectedFaces,
  invertSelection as invertEditorSelection,
  isBrushSelected,
  isEntitySelected as isEditorEntitySelected,
  isFaceSelected as isEditorFaceSelected,
  isPatchSelected as isEditorPatchSelected,
  selectAll as selectAllItems,
  selectAllOfType as selectEditorAllOfType,
  selectCompleteTall as selectEditorCompleteTall,
  selectBrush as selectEditorBrush,
  selectBrushDirect as selectEditorBrushDirect,
  selectEntity as selectEditorEntity,
  selectFace as selectEditorFace,
  selectInside as selectEditorInside,
  selectPartialTall as selectEditorPartialTall,
  selectPatch as selectEditorPatch,
  selectPatchDirect as selectEditorPatchDirect,
  selectTouching as selectEditorTouching,
} from './editor-selection';
import {
  allBrushes as iterateAllBrushes,
  allPatches as iterateAllPatches,
  collectSnapTargets as collectEditorSnapTargets,
  entityBounds as getEntityBounds,
  entityCenter as getEntityCenter,
  entityDisplayOrigin as getEntityDisplayOrigin,
  hasEntityGeometry as entityHasGeometry,
  isPointEntity as checkPointEntity,
  nonWorldspawnEntities as iterateNonWorldspawnEntities,
  pointEntities as iteratePointEntities,
  selectionBounds as getSelectionBounds,
  selectionCenter as getSelectionCenter,
} from './editor-queries';
import {
  createDefaultMap as createDefaultEditorMap,
  loadMap as loadEditorMap,
  newMap as createNewMap,
  openMapFromFile as openEditorMapFromFile,
  redo as redoDocument,
  saveMapToFile as saveEditorMapToFile,
  serializeMap as serializeEditorMap,
  undo as undoDocument,
} from './editor-document';
import {
  copySelection as copyEditorSelection,
  pasteClipboard as pasteEditorClipboard,
} from './editor-clipboard';
import {
  importPrefabFromFile as importEditorPrefabFromFile,
  saveSelectionAsPrefab as saveEditorSelectionAsPrefab,
} from './editor-prefabs';
import {
  clearPointfile as clearEditorPointfile,
  loadPointfileText as loadEditorPointfileText,
  nextPointfilePoint as nextEditorPointfilePoint,
  openPointfileFromFile as openEditorPointfileFromFile,
  prevPointfilePoint as prevEditorPointfilePoint,
} from './editor-pointfile';
import {
  fitTexture as fitEditorTexture,
  getTextureFaces as collectTextureFaces,
  replaceTextures as replaceEditorTextures,
  resetTextureAlignment as resetEditorTextureAlignment,
  rotateTexture as rotateEditorTexture,
  scaleTexture as scaleEditorTexture,
  setTexture as setEditorTexture,
  shiftTexture as shiftEditorTexture,
  type TextureReplaceMatch,
  type TextureReplaceScope,
} from './editor-textures';
import {
  clearVertexSelection as clearEditorVertexSelection,
  enterVertexMode as enterEditorVertexMode,
  exitVertexMode as exitEditorVertexMode,
  isVertexSelected as isEditorVertexSelected,
  moveSelectedVertices as moveEditorSelectedVertices,
  rebuildBrushes as rebuildEditorBrushes,
  refreshVertexData as refreshEditorVertexData,
  selectVertex as selectEditorVertex,
  splitBrushesConvex as splitEditorBrushesConvex,
  vertexSelectionCenter as getEditorVertexSelectionCenter,
} from './editor-vertex';
import {
  changeSubdivisions as changeEditorPatchSubdivisions,
  applyPatchOperation as applyEditorPatchOperation,
  convertSelectedTerrainToPatch as convertEditorTerrainToPatch,
  createMatrixPatch as createEditorMatrixPatch,
  thickenSelectedPatches as thickenEditorPatches,
  updatePatchProperties as updateEditorPatchProperties,
  type PatchOperation,
  clearControlPointSelection as clearEditorControlPointSelection,
  createPatch as createEditorPatch,
  enterPatchEditMode as enterEditorPatchEditMode,
  exitPatchEditMode as exitEditorPatchEditMode,
  isControlPointSelected as isEditorControlPointSelected,
  moveSelectedControlPoints as moveEditorSelectedControlPoints,
  patchControlSelectionCenter as getEditorPatchControlSelectionCenter,
  selectControlPoint as selectEditorControlPoint,
} from './editor-patch';
import {
  adjustTerrainRadius as adjustEditorTerrainRadius,
  adjustTerrainStrength as adjustEditorTerrainStrength,
  createTerrainPatch as createEditorTerrainPatch,
  currentTerrainRadius as getEditorTerrainRadius,
  currentTerrainStrength as getEditorTerrainStrength,
  cycleTerrainFalloff as cycleEditorTerrainFalloff,
  erodeTerrain as erodeEditorTerrain,
  hoveredTerrainPaintTargets as hoveredEditorTerrainPaintTargets,
  hoveredTerrainPaintPatches as hoveredEditorTerrainPaintPatches,
  hoveredTerrainPaintNeedsPreparation as hoveredEditorTerrainPaintNeedsPreparation,
  lowerTerrain as lowerEditorTerrain,
  noiseTerrain as noiseEditorTerrain,
  paintTerrainTexture as paintEditorTerrainTexture,
  raiseTerrain as raiseEditorTerrain,
  sculptTerrain as sculptEditorTerrain,
  selectTerrainColumns as selectEditorTerrainColumns,
  selectTerrainRows as selectEditorTerrainRows,
  stitchSelectedTerrainControlSeams as stitchEditorSelectedTerrainControlSeams,
  splitTerrainIntoPaintTiles as splitEditorTerrainIntoPaintTiles,
  stitchTerrainSeams as stitchEditorTerrainSeams,
  smoothTerrain as smoothEditorTerrain,
  toggleTerrainBrushMode as toggleEditorTerrainBrushMode,
  updateTerrainSample as updateEditorTerrainSample,
  type TerrainBrushMode,
  type TerrainFalloff,
  type TerrainPaintTarget,
  type TerrainSampleChanges,
} from './editor-terrain';
import {
  addBrush as addEditorBrush,
  addEntity as addEditorEntity,
  deleteSelection as deleteEditorSelection,
  duplicateSelection as duplicateEditorSelection,
  duplicateSelectionInPlace as duplicateEditorSelectionInPlace,
  flipSelection as flipEditorSelection,
  moveSelection as moveEditorSelection,
  rotateSelection as rotateEditorSelection,
  scaleSelection as scaleEditorSelection,
  snapSelectionToGrid as snapEditorSelectionToGrid,
} from './editor-transforms';
import {
  groupSelectionIntoEntity as groupEditorSelectionIntoEntity,
  moveSelectionToWorldspawn as moveEditorSelectionToWorldspawn,
} from './editor-grouping';
import {
  addSelectionToNamedGroup as addEditorSelectionToNamedGroup,
  createNamedGroup as createEditorNamedGroup,
  deleteNamedGroup as deleteEditorNamedGroup,
  listNamedGroups,
  removeSelectionFromNamedGroups as removeEditorSelectionFromNamedGroups,
  renameNamedGroup as renameEditorNamedGroup,
  selectNamedGroup as selectEditorNamedGroup,
  setNamedGroupHidden as setEditorNamedGroupHidden,
  setNamedGroupLocked as setEditorNamedGroupLocked,
  type NamedGroup,
} from './named-groups';
import {
  collectEntityPathCurves as collectEditorEntityPathCurves,
  collectEntityLinks as collectEditorEntityLinks,
  connectSelectedEntitiesAsClosedPath as connectEditorSelectedEntitiesAsClosedPath,
  connectSelectedEntitiesAsPath as connectEditorSelectedEntitiesAsPath,
  connectSelectedEntities as connectEditorSelectedEntities,
  type EntityPathCurve,
  type EntityLink,
} from './editor-connections';
import {
  addClipPoint as addEditorClipPoint,
  cancelClip as cancelEditorClip,
  csgHollow as hollowEditorBrushes,
  csgMerge as mergeEditorBrushes,
  csgSubtract as subtractEditorBrushes,
  cycleClipMode as cycleEditorClipMode,
  executeClip as executeEditorClip,
} from './editor-clip-csg';
import {
  INVISIBLE_TEXTURES,
  clearHiddenState as clearEditorHiddenState,
  hideSelected as hideEditorSelection,
  isBrushHidden as isEditorBrushHidden,
  isEntityHidden as isEditorEntityHidden,
  isPatchHidden as isEditorPatchHidden,
  isBrushVisible as isEditorBrushVisible,
  isEntityVisible as isEditorEntityVisible,
  isPatchVisible as isEditorPatchVisible,
  reconcileHiddenState as reconcileEditorHiddenState,
  showHidden as showEditorHidden,
} from './editor-visibility';
import {
  clearRegion as clearEditorRegion,
  collectRegionEntities as collectEditorRegionEntities,
  isBrushInRegion as isEditorBrushInRegion,
  isEntityInRegion as isEditorEntityInRegion,
  isPatchInRegion as isEditorPatchInRegion,
  isRegionActive as isEditorRegionActive,
  serializeRegionMap as serializeEditorRegionMap,
  setRegionFromSelection as setEditorRegionFromSelection,
  type RegionBounds,
} from './editor-regions';
import {
  brushDetailState as getBrushDetailState,
  makeDetail as makeEditorDetail,
  makeStructural as makeEditorStructural,
  patchDetailState as getPatchDetailState,
} from './editor-contents';
import {
  adjustCubicClipSize as adjustEditorCubicClipSize,
  cubicClipBounds as getEditorCubicClipBounds,
  isBrushVisibleIn3D as isEditorBrushVisibleIn3D,
  isEntityVisibleIn3D as isEditorEntityVisibleIn3D,
  isPatchVisibleIn3D as isEditorPatchVisibleIn3D,
  isPointVisibleIn3D as isEditorPointVisibleIn3D,
  isSegmentVisibleIn3D as isEditorSegmentVisibleIn3D,
  toggleCubicClip as toggleEditorCubicClip,
  type CubicClipBounds,
} from './editor-cubic-clipping';
import type { BrushPrimitive } from './brush-primitives';
import type { MapParseDiagnostic } from './mapfile';
import {
  beginTransaction as beginEditorTransaction,
  cancelTransaction as cancelEditorTransaction,
  commitTransaction as commitEditorTransaction,
  transact as transactEditorDocument,
  type TransactionOptions,
} from './editor-transactions';

export type Tool = 'select' | 'create' | 'entity' | 'clip' | 'rotate';
export type ClipMode = 'front' | 'back' | 'both';
export type GizmoMode = 'move' | 'scale';
export type InvisibleMode = 'show' | 'dim' | 'hide';

export type SelectionItem = {
  type: 'brush';
  entity: Entity;
  brush: Brush;
} | {
  type: 'entity';
  entity: Entity;
} | {
  type: 'face';
  entity: Entity;
  brush: Brush;
  face: BrushFace;
} | {
  type: 'patch';
  entity: Entity;
  patch: Patch;
}

export class Editor {
  entities: Entity[] = [createWorldspawn()];
  selection: SelectionItem[] = [];
  activeTool: Tool = 'select';
  gridSize = 16;
  gridSnapMode: 'off' | 'abs' | 'rel' = 'rel';
  snapToGeometry = false;
  currentTexture = 'common/caulk';
  currentEntityClass = 'info_player_deathmatch';
  currentBrushEntityClass = 'func_group';
  currentBrushPrimitive: BrushPrimitive = 'box';
  currentBrushSides = 8;
  terrainBrushRadius = 64;
  terrainBrushStrength = 16;
  terrainFalloff: TerrainFalloff = 'smooth';
  terrainBrushMode: TerrainBrushMode = 'height';
  terrainBrushCenter: Vec3 | null = null;
  terrainBrushAxes: [number, number] | null = null;
  pointfilePoints: Vec3[] = [];
  pointfileIndex = 0;
  redrawRequested = true;
  textureManager: TextureManager | null = null;
  modelManager: ModelManager | null = null;
  display = loadDisplayPreferences();
  history = new History();
  fileName = 'untitled.map';
  clipboardText = '';
  mapDiagnostics: MapParseDiagnostic[] = [];
  documentRevision = 0;
  savedDocumentRevision = 0;
  private nextDocumentRevision = 1;

  // Drag state for brush creation
  creating = false;
  createStart: Vec3 = [0, 0, 0];
  createEnd: Vec3 = [0, 0, 0];
  createAxisH = 0;
  createAxisV = 1;
  createDepth = 64;

  // Active viewport axes (from last-interacted 2D viewport)
  rotationAxis = 2; // default Z
  nudgeAxisH = 0;   // horizontal axis for arrow key nudge
  nudgeAxisV = 1;   // vertical axis for arrow key nudge

  // 3D gizmo mode
  gizmoMode: GizmoMode = 'move';

  // Clip tool state
  clipPoints: Vec3[] = [];
  clipMode: ClipMode = 'front';
  clipDepthAxis = 2; // depth axis of viewport where clip points were placed

  // Rotate tool state
  rotateAnchor: Vec3 | null = null;

  // Vertex editing mode
  vertexMode = false;
  vertexData: { brush: Brush; entity: Entity; vertices: BrushVertex[] }[] = [];
  vertexSelection: { dataIndex: number; vertexIndex: number }[] = [];

  // Patch control point editing mode
  patchEditMode = false;
  patchEditData: { patch: Patch; entity: Entity }[] = [];
  patchControlSelection: { dataIndex: number; row: number; col: number }[] = [];

  // Render filter
  renderSelectedOnly = false;
  hiddenBrushes = new Set<Brush>();
  hiddenPatches = new Set<Patch>();
  hiddenEntities = new Set<Entity>();
  regionBounds: RegionBounds | null = null;

  // UI callback for locating a texture in the texture panel
  onLocateTexture: ((texture: string) => void) | null = null;
  onRequestExitVertexMode: (() => void) | null = null;
  // Selection filter — constrains what types can be picked in viewports
  selectionFilter: 'all' | 'brushes' | 'patches' | 'entities' = 'all';
  invisibleMode: InvisibleMode = 'show';
  textureLock = true;

  toggleDisplayCategory(category: DisplayCategory): void {
    setDisplayCategory(this.display, category, !this.display.categories[category]);
    this.redrawRequested = true;
  }

  setRendererMode(mode: RendererMode): void {
    this.display.rendererMode = mode;
    saveDisplayPreferences(this.display);
    this.redrawRequested = true;
  }

  setTextureFiltering(filtering: TextureFiltering): void {
    this.display.textureFiltering = filtering;
    saveDisplayPreferences(this.display);
    this.redrawRequested = true;
  }

  toggleDynamicLights(): void {
    this.display.dynamicLights = !this.display.dynamicLights;
    saveDisplayPreferences(this.display);
    this.redrawRequested = true;
  }

  // 3D camera state (written by Viewport3D, read by Viewport2D)
  camera3d: { position: Vec3; yaw: number; pitch: number } = {
    position: [80, 80, 120], yaw: Math.PI * 0.25, pitch: -0.2,
  };

  // Fullscreen 3D walkthrough mode (set by Viewport3D)
  fullscreen3d = false;
  cubicClipEnabled = false;
  cubicClipSize = 1024;

  /** Textures considered invisible (tool brushes) */
  static readonly INVISIBLE_TEXTURES = INVISIBLE_TEXTURES;

  // Status message
  statusMessage = 'Ready';

  // Center-on-selection callbacks (registered by viewports)
  private centerOnSelectionCallbacks: (() => void)[] = [];
  private locatePointCallbacks: ((point: Vec3, lookAt: Vec3 | null) => void)[] = [];

  get worldspawn(): Entity {
    const worldspawn = this.entities[0];
    if (!worldspawn) throw new Error('Editor document is missing worldspawn');
    return worldspawn;
  }

  // ── Selection ──

  clearSelection(): void {
    clearEditorSelection(this);
  }

  selectBrush(entity: Entity, brush: Brush, additive = false): void {
    selectEditorBrush(this, entity, brush, additive);
  }

  selectBrushDirect(entity: Entity, brush: Brush, additive = false): void {
    selectEditorBrushDirect(this, entity, brush, additive);
  }

  selectEntity(entity: Entity, additive = false): void {
    selectEditorEntity(this, entity, additive);
  }

  isBrushVisible(brush: Brush, entity?: Entity): boolean {
    return isEditorBrushVisible(this, brush, entity);
  }

  isBrushVisibleIn3D(brush: Brush, entity?: Entity): boolean {
    return isEditorBrushVisibleIn3D(this, brush, entity);
  }

  isBrushHidden(brush: Brush, entity?: Entity): boolean {
    return isEditorBrushHidden(this, brush, entity);
  }

  isBrushInRegion(brush: Brush, entity?: Entity): boolean {
    return isEditorBrushInRegion(this, brush, entity);
  }

  isSelected(brush: Brush, entity?: Entity): boolean {
    return isBrushSelected(this, brush, entity);
  }

  isEntitySelected(entity: Entity): boolean {
    return isEditorEntitySelected(this, entity);
  }

  isEntityHidden(entity: Entity): boolean {
    return isEditorEntityHidden(this, entity);
  }

  isEntityInRegion(entity: Entity): boolean {
    return isEditorEntityInRegion(this, entity);
  }

  addBrushToSelection(entity: Entity, brush: Brush): void {
    addBrushSelectionItem(this, entity, brush);
  }

  addBrushDirectToSelection(entity: Entity, brush: Brush): void {
    addBrushDirectSelectionItem(this, entity, brush);
  }

  addEntityToSelection(entity: Entity): void {
    addEntitySelectionItem(this, entity);
  }

  selectPatch(entity: Entity, patch: Patch, additive = false): void {
    selectEditorPatch(this, entity, patch, additive);
  }

  selectPatchDirect(entity: Entity, patch: Patch, additive = false): void {
    selectEditorPatchDirect(this, entity, patch, additive);
  }

  isPatchSelected(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchSelected(this, patch, entity);
  }

  addPatchToSelection(entity: Entity, patch: Patch): void {
    addPatchSelectionItem(this, entity, patch);
  }

  addPatchDirectToSelection(entity: Entity, patch: Patch): void {
    addPatchDirectSelectionItem(this, entity, patch);
  }

  isPatchVisible(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchVisible(this, patch, entity);
  }

  isPatchVisibleIn3D(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchVisibleIn3D(this, patch, entity);
  }

  isPatchHidden(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchHidden(this, patch, entity);
  }

  isPatchInRegion(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchInRegion(this, patch, entity);
  }

  isEntityVisible(entity: Entity): boolean {
    return isEditorEntityVisible(this, entity);
  }

  isEntityVisibleIn3D(entity: Entity): boolean {
    return isEditorEntityVisibleIn3D(this, entity);
  }

  isPointVisibleIn3D(point: Vec3): boolean {
    return isEditorPointVisibleIn3D(this, point);
  }

  isSegmentVisibleIn3D(start: Vec3, end: Vec3): boolean {
    return isEditorSegmentVisibleIn3D(this, start, end);
  }

  cubicClipBounds(): CubicClipBounds | null {
    return getEditorCubicClipBounds(this);
  }

  toggleCubicClip(): void {
    toggleEditorCubicClip(this);
  }

  adjustCubicClipSize(direction: -1 | 1): void {
    adjustEditorCubicClipSize(this, direction);
  }

  isRegionActive(): boolean {
    return isEditorRegionActive(this);
  }

  setRegionFromSelection(): void {
    setEditorRegionFromSelection(this);
  }

  clearRegion(): void {
    clearEditorRegion(this);
  }

  clearHiddenState(): void {
    clearEditorHiddenState(this);
  }

  reconcileHiddenState(): void {
    reconcileEditorHiddenState(this);
  }

  hideSelected(): void {
    hideEditorSelection(this);
  }

  showHidden(): void {
    showEditorHidden(this);
  }

  toggleTextureLock(): void {
    this.textureLock = !this.textureLock;
    this.redrawRequested = true;
    this.statusMessage = this.textureLock ? 'Texture lock: ON' : 'Texture lock: OFF';
  }

  makeDetail(): void {
    makeEditorDetail(this);
  }

  makeStructural(): void {
    makeEditorStructural(this);
  }

  selectFace(entity: Entity, brush: Brush, face: BrushFace, additive = false): void {
    selectEditorFace(this, entity, brush, face, additive);
  }

  isFaceSelected(face: BrushFace): boolean {
    return isEditorFaceSelected(this, face);
  }

  get selectedFaces(): BrushFace[] {
    return getSelectedFaces(this);
  }

  get selectedFace(): BrushFace | null {
    return getSelectedFace(this);
  }

  /** Returns effective grid size: 1 when snapping is off (toggle or Ctrl held), gridSize otherwise */
  effectiveGrid(ctrlKey = false): number {
    return (this.gridSnapMode === 'off' || ctrlKey) ? 1 : this.gridSize;
  }

  /** Whether grid snap is in absolute mode */
  get gridAbsolute(): boolean {
    return this.gridSnapMode === 'abs';
  }

  /** Collect sorted snap target values per axis from geometry.
   *  When includeSelected is true, includes selected geometry (useful for rotation anchor). */
  collectSnapTargets(includeSelected = false): [number[], number[], number[]] {
    return collectEditorSnapTargets(this, includeSelected);
  }

  // ── Brush operations ──

  addBrush(mins: Vec3, maxs: Vec3, axis: number, ctrlKey = false): Brush {
    return addEditorBrush(this, mins, maxs, axis, ctrlKey);
  }

  // ── Patch creation ──

  createPatch(preset: 'flat' | 'cylinder' | 'cone' | 'bevel' | 'endcap'): void {
    createEditorPatch(this, preset);
  }

  createTerrainPatch(): void {
    createEditorTerrainPatch(this);
  }

  splitTerrainIntoPaintTiles(): void {
    splitEditorTerrainIntoPaintTiles(this);
  }

  changeSubdivisions(delta: number): void {
    changeEditorPatchSubdivisions(this, delta);
  }

  applyPatchOperation(operation: PatchOperation): void { applyEditorPatchOperation(this, operation); }
  convertSelectedTerrainToPatch(): void { convertEditorTerrainToPatch(this); }
  createMatrixPatch(width: number, height: number): void { createEditorMatrixPatch(this, width, height); }
  thickenPatches(amount = 16): void { thickenEditorPatches(this, amount); }
  updatePatchProperties(patch: Patch, changes: Partial<Pick<Patch, 'texture' | 'subdivisions' | 'contentFlags' | 'surfaceFlags' | 'value'>>): void {
    updateEditorPatchProperties(this, patch, changes);
  }

  deleteSelection(): void {
    deleteEditorSelection(this);
  }

  moveSelection(delta: Vec3): void {
    moveEditorSelection(this, delta);
  }

  rotateSelection(angleDeg: number): void {
    rotateEditorSelection(this, angleDeg);
  }

  scaleSelection(scale: Vec3): void {
    scaleEditorSelection(this, scale);
  }

  flipSelection(axis: number): void {
    flipEditorSelection(this, axis);
  }

  // ── Clip tool ──

  addClipPoint(point: Vec3, depthAxis: number): void {
    addEditorClipPoint(this, point, depthAxis);
  }

  cycleClipMode(): void {
    cycleEditorClipMode(this);
  }

  cancelClip(): void {
    cancelEditorClip(this);
  }

  executeClip(): void {
    executeEditorClip(this);
  }

  // ── CSG operations ──

  csgSubtract(): void {
    subtractEditorBrushes(this);
  }

  csgHollow(): void {
    hollowEditorBrushes(this);
  }

  csgMerge(): void {
    mergeEditorBrushes(this);
  }

  duplicateSelection(): void {
    duplicateEditorSelection(this);
  }

  snapSelectionToGrid(): void {
    snapEditorSelectionToGrid(this);
  }

  /** Clone the current selection in-place (no offset). Used for Option-drag duplication. */
  duplicateSelectionInPlace(): void {
    duplicateEditorSelectionInPlace(this);
  }

  // ── Entity operations ──

  addEntity(classname: string, origin: Vec3, ctrlKey = false): Entity {
    return addEditorEntity(this, classname, origin, ctrlKey);
  }

  groupSelectionIntoEntity(classname = this.currentBrushEntityClass): void {
    groupEditorSelectionIntoEntity(this, classname);
  }

  moveSelectionToWorldspawn(): void {
    moveEditorSelectionToWorldspawn(this);
  }

  namedGroups(): NamedGroup[] { return listNamedGroups(this.entities); }
  createNamedGroup(name: string): NamedGroup | null { return createEditorNamedGroup(this, name); }
  renameNamedGroup(id: string, name: string): void { renameEditorNamedGroup(this, id, name); }
  deleteNamedGroup(id: string): void { deleteEditorNamedGroup(this, id); }
  addSelectionToNamedGroup(id: string): void { addEditorSelectionToNamedGroup(this, id); }
  removeSelectionFromNamedGroups(): void { removeEditorSelectionFromNamedGroups(this); }
  selectNamedGroup(id: string): void { selectEditorNamedGroup(this, id); }
  setNamedGroupHidden(id: string, hidden: boolean): void { setEditorNamedGroupHidden(this, id, hidden); }
  setNamedGroupLocked(id: string, locked: boolean): void { setEditorNamedGroupLocked(this, id, locked); }

  connectSelectedEntities(): void {
    connectEditorSelectedEntities(this);
  }

  connectSelectedEntitiesAsPath(): void {
    connectEditorSelectedEntitiesAsPath(this);
  }

  connectSelectedEntitiesAsClosedPath(): void {
    connectEditorSelectedEntitiesAsClosedPath(this);
  }

  collectEntityLinks(): EntityLink[] {
    return collectEditorEntityLinks(this);
  }

  collectEntityPathCurves(): EntityPathCurve[] {
    return collectEditorEntityPathCurves(this);
  }

  // ── History ──

  get hasUnsavedChanges(): boolean {
    return this.documentRevision !== this.savedDocumentRevision;
  }

  /** Internal transaction hook: assign a fresh identity to committed document state. */
  commitDocumentRevision(): void {
    this.documentRevision = this.nextDocumentRevision++;
  }

  /** Internal history hook: restore the identity associated with a snapshot. */
  restoreDocumentRevision(revision: number): void {
    this.documentRevision = revision;
    this.nextDocumentRevision = Math.max(this.nextDocumentRevision, revision + 1);
  }

  markDocumentSaved(): void {
    this.savedDocumentRevision = this.documentRevision;
    this.history.breakCoalescing();
  }

  beginTransaction(label: string, options: TransactionOptions = {}): void {
    beginEditorTransaction(this, label, options);
  }

  commitTransaction(): boolean {
    return commitEditorTransaction(this);
  }

  cancelTransaction(): boolean {
    return cancelEditorTransaction(this);
  }

  transact<T>(label: string, mutation: () => T, options: TransactionOptions = {}): T {
    return transactEditorDocument(this, label, mutation, options);
  }

  undo(): void {
    undoDocument(this);
  }

  redo(): void {
    redoDocument(this);
  }

  // ── File I/O ──

  serializeMap(): string {
    return serializeEditorMap(this);
  }

  serializeRegionMap(addCompileBoundaryBrushes = false): string {
    return serializeEditorRegionMap(this, { addCompileBoundaryBrushes });
  }

  collectRegionEntities(addCompileBoundaryBrushes = false): Entity[] {
    return collectEditorRegionEntities(this, { addCompileBoundaryBrushes });
  }

  loadMap(text: string): void {
    loadEditorMap(this, text);
  }

  newMap(): void {
    createNewMap(this);
  }

  saveMapToFile(): void {
    saveEditorMapToFile(this);
  }

  openMapFromFile(): void {
    openEditorMapFromFile(this);
  }

  // ── Clipboard ──

  async copySelection(): Promise<void> {
    await copyEditorSelection(this);
  }

  async pasteClipboard(): Promise<void> {
    await pasteEditorClipboard(this);
  }

  saveSelectionAsPrefab(): void {
    saveEditorSelectionAsPrefab(this);
  }

  importPrefabFromFile(): void {
    importEditorPrefabFromFile(this);
  }

  // ── Default map ──

  createDefaultMap(): void {
    createDefaultEditorMap(this);
  }

  // ── Get all brushes across all entities ──

  *allBrushes(): Iterable<{ entity: Entity; brush: Brush }> {
    yield* iterateAllBrushes(this);
  }

  // ── Get all patches across all entities ──

  *allPatches(): Iterable<{ entity: Entity; patch: Patch }> {
    yield* iterateAllPatches(this);
  }

  *nonWorldspawnEntities(): Iterable<Entity> {
    yield* iterateNonWorldspawnEntities(this);
  }

  // ── Point entities (non-worldspawn, no brushes/patches) ──

  *pointEntities(): Iterable<Entity> {
    yield* iteratePointEntities(this);
  }

  isPointEntity(entity: Entity): boolean {
    return checkPointEntity(entity);
  }

  hasEntityGeometry(entity: Entity): boolean {
    return entityHasGeometry(entity);
  }

  entityBounds(entity: Entity): { mins: Vec3; maxs: Vec3 } | null {
    return getEntityBounds(entity, this.modelManager);
  }

  entityCenter(entity: Entity): Vec3 | null {
    return getEntityCenter(entity, this.modelManager);
  }

  entityDisplayOrigin(entity: Entity): Vec3 | null {
    return getEntityDisplayOrigin(entity);
  }

  brushDetailState(brush: Brush): boolean | null {
    return getBrushDetailState(brush);
  }

  patchDetailState(patch: Patch): boolean {
    return getPatchDetailState(patch);
  }

  // ── Select all ──

  selectAll(): void {
    selectAllItems(this);
  }

  selectAllOfType(): void {
    selectEditorAllOfType(this);
  }

  invertSelection(): void {
    invertEditorSelection(this);
  }

  selectTouching(): void {
    selectEditorTouching(this);
  }

  selectInside(): void {
    selectEditorInside(this);
  }

  selectCompleteTall(): void {
    selectEditorCompleteTall(this);
  }

  selectPartialTall(): void {
    selectEditorPartialTall(this);
  }

  selectionBounds(): { mins: Vec3; maxs: Vec3 } | null {
    return getSelectionBounds(this);
  }

  selectionCenter(): Vec3 | null {
    return getSelectionCenter(this);
  }

  onCenterOnSelection(callback: () => void): void {
    this.centerOnSelectionCallbacks.push(callback);
  }

  centerOnSelection(): void {
    if (this.selection.length === 0) return;
    for (const cb of this.centerOnSelectionCallbacks) cb();
    this.redrawRequested = true;
  }

  onLocatePoint(callback: (point: Vec3, lookAt: Vec3 | null) => void): void {
    this.locatePointCallbacks.push(callback);
  }

  locatePoint(point: Vec3, lookAt: Vec3 | null = null): void {
    for (const cb of this.locatePointCallbacks) cb(point, lookAt);
    this.redrawRequested = true;
  }

  loadPointfileText(text: string, statusPrefix?: string): boolean {
    return loadEditorPointfileText(this, text, { statusPrefix });
  }

  openPointfileFromFile(): void {
    openEditorPointfileFromFile(this);
  }

  clearPointfile(updateStatus = true): void {
    clearEditorPointfile(this, updateStatus);
  }

  nextPointfilePoint(): void {
    nextEditorPointfilePoint(this);
  }

  prevPointfilePoint(): void {
    prevEditorPointfilePoint(this);
  }

  setTexture(texture: string): void {
    setEditorTexture(this, texture);
  }

  replaceTextures(
    findTexture: string,
    replaceTexture: string,
    scope: TextureReplaceScope,
    match: TextureReplaceMatch,
  ): number {
    return replaceEditorTextures(this, findTexture, replaceTexture, scope, match);
  }

  // ── Texture alignment ──

  /** Get all faces affected by texture operations (selected faces, or all faces of selected brushes) */
  private getTextureFaces(): BrushFace[] {
    return collectTextureFaces(this);
  }

  /** Shift texture offset by (du, dv) pixels */
  shiftTexture(du: number, dv: number): void {
    shiftEditorTexture(this, du, dv);
  }

  /** Scale texture by delta (added to current scale) */
  scaleTexture(ds: number): void {
    scaleEditorTexture(this, ds);
  }

  /** Rotate texture by angle in degrees */
  rotateTexture(angle: number): void {
    rotateEditorTexture(this, angle);
  }

  /** Reset texture alignment to defaults */
  resetTextureAlignment(): void {
    resetEditorTextureAlignment(this);
  }

  /** Fit texture to face polygon bounds */
  fitTexture(): void {
    fitEditorTexture(this);
  }

  // ── Vertex editing ──

  enterVertexMode(): void {
    enterEditorVertexMode(this);
  }

  exitVertexMode(): { invalidBrushes: { brush: Brush; entity: Entity; result: BrushValidationResult }[] } | null {
    return exitEditorVertexMode(this);
  }

  requestExitVertexMode(): void {
    if (this.onRequestExitVertexMode) {
      this.onRequestExitVertexMode();
      return;
    }
    this.exitVertexMode();
  }

  /** Rebuild invalid brushes from their face planes (reconvexifies). */
  rebuildBrushes(brushes: Brush[]): void {
    rebuildEditorBrushes(this, brushes);
  }

  /** Split non-convex brushes into multiple convex brushes. */
  splitBrushesConvex(invalidBrushes: { brush: Brush; entity: Entity }[]): void {
    splitEditorBrushesConvex(this, invalidBrushes);
  }

  selectVertex(dataIndex: number, vertexIndex: number, additive = false): void {
    selectEditorVertex(this, dataIndex, vertexIndex, additive);
  }

  clearVertexSelection(): void {
    clearEditorVertexSelection(this);
  }

  isVertexSelected(dataIndex: number, vertexIndex: number): boolean {
    return isEditorVertexSelected(this, dataIndex, vertexIndex);
  }

  moveSelectedVertices(delta: Vec3): void {
    moveEditorSelectedVertices(this, delta);
  }

  refreshVertexData(): void {
    refreshEditorVertexData(this);
  }

  vertexSelectionCenter(): Vec3 | null {
    return getEditorVertexSelectionCenter(this);
  }

  // ── Patch control point editing ──

  enterPatchEditMode(): void {
    enterEditorPatchEditMode(this);
  }

  exitPatchEditMode(): void {
    exitEditorPatchEditMode(this);
  }

  selectControlPoint(dataIndex: number, row: number, col: number, additive = false): void {
    selectEditorControlPoint(this, dataIndex, row, col, additive);
  }

  clearControlPointSelection(): void {
    clearEditorControlPointSelection(this);
  }

  isControlPointSelected(dataIndex: number, row: number, col: number): boolean {
    return isEditorControlPointSelected(this, dataIndex, row, col);
  }

  moveSelectedControlPoints(delta: Vec3): void {
    moveEditorSelectedControlPoints(this, delta);
  }

  patchControlSelectionCenter(): Vec3 | null {
    return getEditorPatchControlSelectionCenter(this);
  }

  raiseTerrain(): void {
    raiseEditorTerrain(this);
  }

  lowerTerrain(): void {
    lowerEditorTerrain(this);
  }

  smoothTerrain(): void {
    smoothEditorTerrain(this);
  }

  noiseTerrain(): void {
    noiseEditorTerrain(this);
  }

  erodeTerrain(): void {
    erodeEditorTerrain(this);
  }

  hoveredTerrainPaintPatches(): Patch[] {
    return hoveredEditorTerrainPaintPatches(this);
  }

  hoveredTerrainPaintTargets(): TerrainPaintTarget[] {
    return hoveredEditorTerrainPaintTargets(this);
  }

  hoveredTerrainPaintNeedsPreparation(): boolean {
    return hoveredEditorTerrainPaintNeedsPreparation(this);
  }

  paintTerrainTexture(takeSnapshot = true): number {
    return paintEditorTerrainTexture(this, takeSnapshot);
  }

  stitchSelectedTerrainControlSeams(): number {
    return stitchEditorSelectedTerrainControlSeams(this);
  }

  stitchTerrainSeams(): number {
    return stitchEditorTerrainSeams(this);
  }

  updateTerrainSample(patch: Patch, row: number, column: number, changes: TerrainSampleChanges): void {
    updateEditorTerrainSample(this, patch, row, column, changes);
  }

  selectTerrainRows(): void { selectEditorTerrainRows(this); }
  selectTerrainColumns(): void { selectEditorTerrainColumns(this); }

  sculptTerrain(amount: number, takeSnapshot = true, selectedOnly = false): void {
    sculptEditorTerrain(this, amount, takeSnapshot, selectedOnly);
  }

  adjustTerrainRadius(delta: number): void {
    adjustEditorTerrainRadius(this, delta);
  }

  adjustTerrainStrength(delta: number): void {
    adjustEditorTerrainStrength(this, delta);
  }

  cycleTerrainFalloff(): void {
    cycleEditorTerrainFalloff(this);
  }

  toggleTerrainBrushMode(): void {
    toggleEditorTerrainBrushMode(this);
  }

  currentTerrainRadius(): number {
    return getEditorTerrainRadius(this);
  }

  currentTerrainStrength(): number {
    return getEditorTerrainStrength(this);
  }
}
