import { Vec3, vec3, vec3Add, vec3Sub, vec3Copy, vec3Scale, vec3Min, vec3Max } from './math';
import { Brush, BrushFace, computeBrushGeometry, brushCenter, BrushValidationResult } from './brush';
import { Entity, createEntity } from './entity';
import { Patch } from './patch';
import { History } from './history';
import { TextureManager } from './textures';
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
  snapshot as snapshotDocument,
  undo as undoDocument,
} from './editor-document';
import {
  copySelection as copyEditorSelection,
  pasteClipboard as pasteEditorClipboard,
} from './editor-clipboard';
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
  addBrush as addEditorBrush,
  addEntity as addEditorEntity,
  deleteSelection as deleteEditorSelection,
  duplicateSelection as duplicateEditorSelection,
  duplicateSelectionInPlace as duplicateEditorSelectionInPlace,
  flipSelection as flipEditorSelection,
  moveSelection as moveEditorSelection,
  rotateSelection as rotateEditorSelection,
  snapSelectionToGrid as snapEditorSelectionToGrid,
} from './editor-transforms';
import {
  groupSelectionIntoEntity as groupEditorSelectionIntoEntity,
  moveSelectionToWorldspawn as moveEditorSelectionToWorldspawn,
} from './editor-grouping';
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
  brushDetailState as getBrushDetailState,
  makeDetail as makeEditorDetail,
  makeStructural as makeEditorStructural,
  patchDetailState as getPatchDetailState,
} from './editor-contents';

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
  entities: Entity[] = [];
  selection: SelectionItem[] = [];
  activeTool: Tool = 'select';
  gridSize = 16;
  gridSnapMode: 'off' | 'abs' | 'rel' = 'rel';
  snapToGeometry = false;
  currentTexture = 'common/caulk';
  currentEntityClass = 'info_player_deathmatch';
  currentBrushEntityClass = 'func_group';
  dirty = true;
  textureManager: TextureManager | null = null;
  history = new History();
  fileName = 'untitled.map';
  clipboardText = '';

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

  // UI callback for locating a texture in the texture panel
  onLocateTexture: ((texture: string) => void) | null = null;
  // Selection filter — constrains what types can be picked in viewports
  selectionFilter: 'all' | 'brushes' | 'patches' | 'entities' = 'all';
  invisibleMode: InvisibleMode = 'show';
  textureLock = true;

  // 3D camera state (written by Viewport3D, read by Viewport2D)
  camera3d: { position: Vec3; yaw: number; pitch: number } = {
    position: [80, 80, 120], yaw: Math.PI * 0.25, pitch: -0.2,
  };

  // Fullscreen 3D walkthrough mode (set by Viewport3D)
  fullscreen3d = false;

  /** Textures considered invisible (tool brushes) */
  static readonly INVISIBLE_TEXTURES = INVISIBLE_TEXTURES;

  // Status message
  statusMessage = 'Ready';

  // Center-on-selection callbacks (registered by viewports)
  private centerOnSelectionCallbacks: (() => void)[] = [];

  get worldspawn(): Entity {
    if (this.entities.length === 0) {
      const ws = createEntity('worldspawn');
      ws.properties['message'] = 'Q3 Map Editor';
      this.entities.push(ws);
    }
    return this.entities[0];
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

  isBrushHidden(brush: Brush, entity?: Entity): boolean {
    return isEditorBrushHidden(this, brush, entity);
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

  isPatchHidden(patch: Patch, entity?: Entity): boolean {
    return isEditorPatchHidden(this, patch, entity);
  }

  isEntityVisible(entity: Entity): boolean {
    return isEditorEntityVisible(this, entity);
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
    this.dirty = true;
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

  addBrush(mins: Vec3, maxs: Vec3, ctrlKey = false): Brush {
    return addEditorBrush(this, mins, maxs, ctrlKey);
  }

  // ── Patch creation ──

  createPatch(preset: 'flat' | 'cylinder' | 'cone' | 'bevel' | 'endcap'): void {
    createEditorPatch(this, preset);
  }

  changeSubdivisions(delta: number): void {
    changeEditorPatchSubdivisions(this, delta);
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

  // ── History ──

  snapshot(): void {
    snapshotDocument(this);
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
    return getEntityBounds(entity);
  }

  entityCenter(entity: Entity): Vec3 | null {
    return getEntityCenter(entity);
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
    this.dirty = true;
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
}
