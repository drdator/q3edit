import { Vec3, vec3, vec3Add, vec3Sub, vec3Snap, vec3Copy, vec3Scale, vec3Min, vec3Max, vec3Dot } from './math';
import { Brush, BrushFace, createBoxBrush, translateBrush, rotateBrush, cloneBrush, clipBrush, computeBrushGeometry, brushCenter, validateBrush, rebuildBrush, splitBrushConvex, BrushValidationResult, textureAxisFromPlane } from './brush';
import { Entity, createEntity, entityOrigin, translateEntity, cloneEntity, setEntityOrigin, entityDefaults } from './entity';
import { Patch, clonePatch, translatePatch, rotatePatch, tessellatePatch, createFlatPatch, createCylinderPatch, createConePatch, createBevelPatch, createEndcapPatch } from './patch';
import { History } from './history';
import { serializeMap, parseMap } from './mapfile';
import { TextureManager } from './textures';
import { BrushVertex, collectBrushVertices, moveVertices } from './vertex';
import { subtractBrush, hollowBrush, mergeBrushes } from './csg';
import {
  addBrushToSelection as addBrushSelectionItem,
  addEntityToSelection as addEntitySelectionItem,
  addPatchToSelection as addPatchSelectionItem,
  clearSelection as clearEditorSelection,
  getSelectedBrushItems,
  getSelectedFace,
  getSelectedFaces,
  isBrushSelected,
  isEntitySelected as isEditorEntitySelected,
  isFaceSelected as isEditorFaceSelected,
  isPatchSelected as isEditorPatchSelected,
  selectAll as selectAllItems,
  selectBrush as selectEditorBrush,
  selectEntity as selectEditorEntity,
  selectFace as selectEditorFace,
  selectPatch as selectEditorPatch,
} from './editor-selection';
import {
  allBrushes as iterateAllBrushes,
  allPatches as iterateAllPatches,
  collectSnapTargets as collectEditorSnapTargets,
  pointEntities as iteratePointEntities,
  selectionBounds as getSelectionBounds,
  selectionCenter as getSelectionCenter,
} from './editor-queries';

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
  dirty = true;
  textureManager: TextureManager | null = null;
  history = new History();
  fileName = 'untitled.map';

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

  // UI callback for locating a texture in the texture panel
  onLocateTexture: ((texture: string) => void) | null = null;
  // Selection filter — constrains what types can be picked in viewports
  selectionFilter: 'all' | 'brushes' | 'patches' | 'entities' = 'all';
  invisibleMode: InvisibleMode = 'show';

  // 3D camera state (written by Viewport3D, read by Viewport2D)
  camera3d: { position: Vec3; yaw: number; pitch: number } = {
    position: [80, 80, 120], yaw: Math.PI * 0.25, pitch: -0.2,
  };

  // Fullscreen 3D walkthrough mode (set by Viewport3D)
  fullscreen3d = false;

  /** Textures considered invisible (tool brushes) */
  static readonly INVISIBLE_TEXTURES = new Set([
    'common/clip', 'common/weapclip', 'common/trigger',
    'common/hint', 'common/skip', 'common/nodraw',
    'common/areaportal', 'common/donotenter', 'common/caulk',
  ]);

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

  selectEntity(entity: Entity, additive = false): void {
    selectEditorEntity(this, entity, additive);
  }

  isBrushVisible(brush: Brush): boolean {
    // In 'hide' mode, completely hide brushes where ALL faces are invisible
    if (this.invisibleMode === 'hide' && brush.faces.length > 0 &&
        brush.faces.every(f => Editor.INVISIBLE_TEXTURES.has(f.texture.toLowerCase()))) {
      return false;
    }
    if (!this.renderSelectedOnly || this.selection.length === 0) return true;
    return this.selection.some(s => (s.type === 'brush' || s.type === 'face') && s.brush === brush);
  }

  isSelected(brush: Brush): boolean {
    return isBrushSelected(this, brush);
  }

  isEntitySelected(entity: Entity): boolean {
    return isEditorEntitySelected(this, entity);
  }

  addBrushToSelection(entity: Entity, brush: Brush): void {
    addBrushSelectionItem(this, entity, brush);
  }

  addEntityToSelection(entity: Entity): void {
    addEntitySelectionItem(this, entity);
  }

  selectPatch(entity: Entity, patch: Patch, additive = false): void {
    selectEditorPatch(this, entity, patch, additive);
  }

  isPatchSelected(patch: Patch): boolean {
    return isEditorPatchSelected(this, patch);
  }

  addPatchToSelection(entity: Entity, patch: Patch): void {
    addPatchSelectionItem(this, entity, patch);
  }

  isPatchVisible(patch: Patch): boolean {
    if (!this.renderSelectedOnly || this.selection.length === 0) return true;
    return this.selection.some(s => s.type === 'patch' && s.patch === patch);
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

  private selectedBrushItems(): { entity: Entity; brush: Brush }[] {
    return getSelectedBrushItems(this);
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
    const grid = this.effectiveGrid(ctrlKey);
    const snapped_mins = vec3Snap(mins, grid);
    const snapped_maxs = vec3Snap(maxs, grid);

    // Ensure mins < maxs
    const realMins: Vec3 = [
      Math.min(snapped_mins[0], snapped_maxs[0]),
      Math.min(snapped_mins[1], snapped_maxs[1]),
      Math.min(snapped_mins[2], snapped_maxs[2]),
    ];
    const realMaxs: Vec3 = [
      Math.max(snapped_mins[0], snapped_maxs[0]),
      Math.max(snapped_mins[1], snapped_maxs[1]),
      Math.max(snapped_mins[2], snapped_maxs[2]),
    ];

    // Minimum brush size
    for (let i = 0; i < 3; i++) {
      if (realMaxs[i] - realMins[i] < grid) {
        realMaxs[i] = realMins[i] + grid;
      }
    }

    const brush = createBoxBrush(realMins, realMaxs, this.currentTexture);
    this.worldspawn.brushes.push(brush);
    this.dirty = true;
    return brush;
  }

  // ── Patch creation ──

  createPatch(preset: 'flat' | 'cylinder' | 'cone' | 'bevel' | 'endcap'): void {
    const bounds = this.selectionBounds();
    if (!bounds) {
      this.statusMessage = 'Select a brush first';
      return;
    }
    this.snapshot();
    const { mins, maxs } = bounds;
    const texture = this.currentTexture;
    const creators = {
      flat: createFlatPatch,
      cylinder: createCylinderPatch,
      cone: createConePatch,
      bevel: createBevelPatch,
      endcap: createEndcapPatch,
    };
    const patch = creators[preset](mins, maxs, texture);
    this.worldspawn.patches.push(patch);
    this.selection = [{ type: 'patch', entity: this.worldspawn, patch }];
    this.dirty = true;
    this.statusMessage = `Created ${preset} patch`;
  }

  changeSubdivisions(delta: number): void {
    const patchItems = this.selection.filter(s => s.type === 'patch') as
      { type: 'patch'; entity: Entity; patch: Patch }[];
    if (patchItems.length === 0) return;
    this.snapshot();
    for (const item of patchItems) {
      const newSub = Math.max(1, Math.min(24, item.patch.subdivisions + delta));
      item.patch.subdivisions = newSub;
      tessellatePatch(item.patch);
    }
    const level = patchItems[0].patch.subdivisions;
    this.dirty = true;
    this.statusMessage = `Subdivisions: ${level}`;
  }

  deleteSelection(): void {
    if (this.selection.length === 0) return;
    this.snapshot();

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        const brush = item.brush;
        const idx = item.entity.brushes.indexOf(brush);
        if (idx >= 0) item.entity.brushes.splice(idx, 1);
      } else if (item.type === 'patch') {
        const idx = item.entity.patches.indexOf(item.patch);
        if (idx >= 0) item.entity.patches.splice(idx, 1);
      } else {
        const idx = this.entities.indexOf(item.entity);
        // Don't delete worldspawn
        if (idx > 0) this.entities.splice(idx, 1);
      }
    }

    this.selection = [];
    this.dirty = true;
    this.statusMessage = 'Deleted';
  }

  moveSelection(delta: Vec3): void {
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        translateBrush(item.brush, delta);
      } else if (item.type === 'patch') {
        translatePatch(item.patch, delta);
      } else {
        translateEntity(item.entity, delta);
      }
    }
    this.dirty = true;
  }

  rotateSelection(angleDeg: number): void {
    if (this.selection.length === 0) return;
    this.snapshot();

    const angle = (angleDeg / 180) * Math.PI;
    const axis = this.rotationAxis;

    // Compute selection center
    let mins: Vec3 = [Infinity, Infinity, Infinity];
    let maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const item of this.selection) {
      if (item.type === 'entity') continue;
      const b = item.type === 'patch' ? item.patch : item.brush;
      for (let i = 0; i < 3; i++) {
        if (b.mins[i] < mins[i]) mins[i] = b.mins[i];
        if (b.maxs[i] > maxs[i]) maxs[i] = b.maxs[i];
      }
    }
    const center: Vec3 = [
      (mins[0] + maxs[0]) / 2,
      (mins[1] + maxs[1]) / 2,
      (mins[2] + maxs[2]) / 2,
    ];

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        rotateBrush(item.brush, center, axis, angle);
      } else if (item.type === 'patch') {
        rotatePatch(item.patch, center, axis, angle);
      }
    }

    this.dirty = true;
    const axisName = ['X', 'Y', 'Z'][axis];
    this.statusMessage = `Rotated ${angleDeg}° around ${axisName}`;
  }

  // ── Clip tool ──

  addClipPoint(point: Vec3, depthAxis: number): void {
    if (this.clipPoints.length >= 2) this.clipPoints = [];
    this.clipPoints.push(point);
    this.clipDepthAxis = depthAxis;
    this.dirty = true;
  }

  cycleClipMode(): void {
    const modes: ClipMode[] = ['front', 'back', 'both'];
    this.clipMode = modes[(modes.indexOf(this.clipMode) + 1) % 3];
    this.dirty = true;
    this.statusMessage = `Clip: ${this.clipMode}`;
  }

  cancelClip(): void {
    this.clipPoints = [];
    this.dirty = true;
    this.statusMessage = 'Clip cancelled';
  }

  executeClip(): void {
    if (this.clipPoints.length < 2 || this.selection.length === 0) return;

    const p1 = this.clipPoints[0];
    const p2 = this.clipPoints[1];
    const depthAxis = this.clipDepthAxis;

    // Third point offset along depth axis to define the plane
    const p3: Vec3 = [p1[0], p1[1], p1[2]];
    p3[depthAxis] += 1;

    // Front clip points: p1, p2, p3 → normal points to the "front"
    // Back clip points: reversed winding → p2, p1, p3
    const frontPoints: [Vec3, Vec3, Vec3] = [p1, p2, p3];
    const backPoints: [Vec3, Vec3, Vec3] = [p2, p1, p3];

    this.snapshot();
    const newSelection: SelectionItem[] = [];

    for (const item of this.selection) {
      if (item.type === 'entity' || item.type === 'patch') continue;
      const brush = item.brush;
      const entity = item.entity;
      const idx = entity.brushes.indexOf(brush);
      if (idx < 0) continue;

      const front = clipBrush(brush, frontPoints);
      const back = clipBrush(brush, backPoints);

      // Remove the original brush
      entity.brushes.splice(idx, 1);

      if (this.clipMode === 'front' || this.clipMode === 'both') {
        if (front) {
          entity.brushes.push(front);
          newSelection.push({ type: 'brush', entity, brush: front });
        }
      }
      if (this.clipMode === 'back' || this.clipMode === 'both') {
        if (back) {
          entity.brushes.push(back);
          newSelection.push({ type: 'brush', entity, brush: back });
        }
      }
    }

    this.selection = newSelection;
    this.clipPoints = [];
    this.dirty = true;
    this.statusMessage = `Clipped (${this.clipMode})`;
  }

  // ── CSG operations ──

  csgSubtract(): void {
    const brushItems = this.selectedBrushItems();
    if (brushItems.length === 0) {
      this.statusMessage = 'CSG Subtract: select brushes to carve with';
      return;
    }

    this.snapshot();
    const carverSet = new Set(brushItems.map(s => s.brush));
    const newSelection: SelectionItem[] = [];
    let totalFragments = 0;

    for (const entity of this.entities) {
      const newBrushes: Brush[] = [];
      for (const brush of entity.brushes) {
        if (carverSet.has(brush)) continue; // carvers are removed

        let pieces: Brush[] = [brush];
        for (const carverBrush of carverSet) {
          const next: Brush[] = [];
          for (const piece of pieces) {
            const frags = subtractBrush(piece, carverBrush);
            if (frags !== null) {
              next.push(...frags);
            } else {
              next.push(piece); // no overlap, keep as-is
            }
          }
          pieces = next;
        }
        newBrushes.push(...pieces);
        if (pieces.length > 1 || (pieces.length === 1 && pieces[0] !== brush)) {
          totalFragments += pieces.length;
          for (const p of pieces) {
            newSelection.push({ type: 'brush', entity, brush: p });
          }
        }
      }
      entity.brushes = newBrushes;
    }

    this.selection = newSelection;
    this.dirty = true;
    this.statusMessage = totalFragments > 0
      ? `CSG Subtract: ${totalFragments} fragments created`
      : 'CSG Subtract: no intersections found';
  }

  csgHollow(): void {
    const brushItems = this.selectedBrushItems();
    if (brushItems.length === 0) {
      this.statusMessage = 'CSG Hollow: select brushes first';
      return;
    }

    this.snapshot();
    const newSelection: SelectionItem[] = [];

    for (const item of brushItems) {
      const shells = hollowBrush(item.brush, this.gridSize);
      if (shells.length === 0) continue;

      // Remove original
      const idx = item.entity.brushes.indexOf(item.brush);
      if (idx >= 0) item.entity.brushes.splice(idx, 1);

      // Add shell pieces
      for (const shell of shells) {
        item.entity.brushes.push(shell);
        newSelection.push({ type: 'brush', entity: item.entity, brush: shell });
      }
    }

    this.selection = newSelection;
    this.dirty = true;
    this.statusMessage = `CSG Hollow: ${newSelection.length} shell pieces (wall thickness: ${this.gridSize})`;
  }

  csgMerge(): void {
    const brushItems = this.selectedBrushItems();
    if (brushItems.length < 2) {
      this.statusMessage = 'CSG Merge: select 2+ brushes';
      return;
    }

    // All brushes must belong to the same entity
    const entity = brushItems[0].entity;
    if (!brushItems.every(s => s.entity === entity)) {
      this.statusMessage = 'CSG Merge: brushes must be in the same entity';
      return;
    }

    const merged = mergeBrushes(brushItems.map(s => s.brush));
    if (!merged) {
      this.statusMessage = 'CSG Merge: result is not convex — cannot merge';
      return;
    }

    this.snapshot();

    // Remove originals
    for (const item of brushItems) {
      const idx = entity.brushes.indexOf(item.brush);
      if (idx >= 0) entity.brushes.splice(idx, 1);
    }

    // Add merged brush
    entity.brushes.push(merged);
    this.selection = [{ type: 'brush', entity, brush: merged }];
    this.dirty = true;
    this.statusMessage = `CSG Merge: ${brushItems.length} brushes merged into 1`;
  }

  duplicateSelection(): void {
    if (this.selection.length === 0) return;
    this.snapshot();

    const newSelection: SelectionItem[] = [];
    const offset: Vec3 = [this.gridSize, this.gridSize, 0];

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        const newBrush = cloneBrush(item.brush);
        translateBrush(newBrush, offset);
        item.entity.brushes.push(newBrush);
        newSelection.push({ type: 'brush', entity: item.entity, brush: newBrush });
      } else if (item.type === 'patch') {
        const newPatch = clonePatch(item.patch);
        translatePatch(newPatch, offset);
        item.entity.patches.push(newPatch);
        newSelection.push({ type: 'patch', entity: item.entity, patch: newPatch });
      } else {
        const newEntity = cloneEntity(item.entity);
        translateEntity(newEntity, offset);
        this.entities.push(newEntity);
        newSelection.push({ type: 'entity', entity: newEntity });
      }
    }

    this.selection = newSelection;
    this.dirty = true;
    this.statusMessage = 'Duplicated';
  }

  snapSelectionToGrid(): void {
    if (this.selection.length === 0) return;
    this.snapshot();
    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        const snapped = vec3Snap(item.brush.mins, this.gridSize);
        const delta: Vec3 = [snapped[0] - item.brush.mins[0], snapped[1] - item.brush.mins[1], snapped[2] - item.brush.mins[2]];
        if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
          translateBrush(item.brush, delta);
        }
      } else if (item.type === 'patch') {
        const snapped = vec3Snap(item.patch.mins, this.gridSize);
        const delta: Vec3 = [snapped[0] - item.patch.mins[0], snapped[1] - item.patch.mins[1], snapped[2] - item.patch.mins[2]];
        if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
          translatePatch(item.patch, delta);
        }
      } else {
        const origin = entityOrigin(item.entity);
        if (origin) {
          const snapped = vec3Snap(origin, this.gridSize);
          setEntityOrigin(item.entity, snapped);
        }
      }
    }
    this.dirty = true;
    this.statusMessage = 'Snapped to grid';
  }

  /** Clone the current selection in-place (no offset). Used for Option-drag duplication. */
  duplicateSelectionInPlace(): void {
    if (this.selection.length === 0) return;
    const newSelection: SelectionItem[] = [];
    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        const newBrush = cloneBrush(item.brush);
        item.entity.brushes.push(newBrush);
        newSelection.push({ type: 'brush', entity: item.entity, brush: newBrush });
      } else if (item.type === 'patch') {
        const newPatch = clonePatch(item.patch);
        item.entity.patches.push(newPatch);
        newSelection.push({ type: 'patch', entity: item.entity, patch: newPatch });
      } else {
        const newEntity = cloneEntity(item.entity);
        this.entities.push(newEntity);
        newSelection.push({ type: 'entity', entity: newEntity });
      }
    }
    this.selection = newSelection;
    this.dirty = true;
  }

  // ── Entity operations ──

  addEntity(classname: string, origin: Vec3, ctrlKey = false): Entity {
    const snapped = vec3Snap(origin, this.effectiveGrid(ctrlKey));
    const entity = createEntity(classname, snapped);
    // Apply default properties for this entity class
    const defaults = entityDefaults(classname);
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in entity.properties)) {
        entity.properties[key] = value;
      }
    }
    this.entities.push(entity);
    this.dirty = true;
    return entity;
  }

  // ── History ──

  snapshot(): void {
    this.history.snapshot(this.entities);
  }

  undo(): void {
    const prev = this.history.undo(this.entities);
    if (prev) {
      this.entities = prev;
      this.selection = [];
      this.exitVertexMode();
      this.dirty = true;
      this.statusMessage = 'Undo';
    }
  }

  redo(): void {
    const next = this.history.redo(this.entities);
    if (next) {
      this.entities = next;
      this.selection = [];
      this.exitVertexMode();
      this.dirty = true;
      this.statusMessage = 'Redo';
    }
  }

  // ── File I/O ──

  serializeMap(): string {
    return serializeMap(this.entities);
  }

  loadMap(text: string): void {
    this.snapshot();
    this.entities = parseMap(text);
    this.selection = [];
    this.dirty = true;
    this.statusMessage = 'Map loaded';
  }

  newMap(): void {
    this.snapshot();
    this.entities = [];
    this.selection = [];
    this.dirty = true;
    this.statusMessage = 'New map';
  }

  saveMapToFile(): void {
    const data = this.serializeMap();
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName;
    a.click();
    URL.revokeObjectURL(url);
    this.statusMessage = `Saved ${this.fileName}`;
  }

  openMapFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.map';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      this.fileName = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        this.loadMap(reader.result as string);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Default map ──

  createDefaultMap(): void {
    this.entities = [];
    const ws = this.worldspawn;

    const tex = 'base_wall/basewall03';
    const floorTex = 'base_floor/concrete';
    const ceilTex = 'base_floor/concrete';

    // Floor
    ws.brushes.push(createBoxBrush([0, 0, -16], [512, 512, 0], floorTex));
    // Ceiling
    ws.brushes.push(createBoxBrush([0, 0, 256], [512, 512, 272], ceilTex));
    // North wall (+Y)
    ws.brushes.push(createBoxBrush([0, 512, 0], [512, 528, 256], tex));
    // South wall (-Y)
    ws.brushes.push(createBoxBrush([0, -16, 0], [512, 0, 256], tex));
    // East wall (+X)
    ws.brushes.push(createBoxBrush([512, 0, 0], [528, 512, 256], tex));
    // West wall (-X)
    ws.brushes.push(createBoxBrush([-16, 0, 0], [0, 512, 256], tex));

    // Spawn point
    const spawn = createEntity('info_player_deathmatch', [256, 256, 32]);
    spawn.properties['angle'] = '0';
    this.entities.push(spawn);

    // Light
    const light = createEntity('light', [256, 256, 200]);
    light.properties['light'] = '300';
    this.entities.push(light);

    this.dirty = true;
    this.statusMessage = 'Default map created';
  }

  // ── Get all brushes across all entities ──

  *allBrushes(): Iterable<{ entity: Entity; brush: Brush }> {
    yield* iterateAllBrushes(this);
  }

  // ── Get all patches across all entities ──

  *allPatches(): Iterable<{ entity: Entity; patch: Patch }> {
    yield* iterateAllPatches(this);
  }

  // ── Point entities (non-worldspawn, no brushes/patches) ──

  *pointEntities(): Iterable<Entity> {
    yield* iteratePointEntities(this);
  }

  // ── Select all ──

  selectAll(): void {
    selectAllItems(this);
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
    this.currentTexture = texture;
    // Apply to selected face, all faces of selected brushes, or selected patches
    for (const item of this.selection) {
      if (item.type === 'face') {
        item.face.texture = texture;
      } else if (item.type === 'brush') {
        for (const face of item.brush.faces) {
          face.texture = texture;
        }
      } else if (item.type === 'patch') {
        item.patch.texture = texture;
      }
    }
    this.dirty = true;
  }

  // ── Texture alignment ──

  /** Get all faces affected by texture operations (selected faces, or all faces of selected brushes) */
  private getTextureFaces(): BrushFace[] {
    const faces: BrushFace[] = [];
    for (const item of this.selection) {
      if (item.type === 'face') {
        faces.push(item.face);
      } else if (item.type === 'brush') {
        faces.push(...item.brush.faces);
      }
    }
    return faces;
  }

  /** Shift texture offset by (du, dv) pixels */
  shiftTexture(du: number, dv: number): void {
    const faces = this.getTextureFaces();
    if (faces.length === 0) return;
    this.snapshot();
    for (const face of faces) {
      face.offsetX += du;
      face.offsetY += dv;
    }
    this.dirty = true;
  }

  /** Scale texture by delta (added to current scale) */
  scaleTexture(ds: number): void {
    const faces = this.getTextureFaces();
    if (faces.length === 0) return;
    this.snapshot();
    for (const face of faces) {
      face.scaleX = Math.max(0.01, face.scaleX + ds);
      face.scaleY = Math.max(0.01, face.scaleY + ds);
    }
    this.dirty = true;
  }

  /** Rotate texture by angle in degrees */
  rotateTexture(angle: number): void {
    const faces = this.getTextureFaces();
    if (faces.length === 0) return;
    this.snapshot();
    for (const face of faces) {
      face.rotation = ((face.rotation + angle) % 360 + 360) % 360;
    }
    this.dirty = true;
  }

  /** Reset texture alignment to defaults */
  resetTextureAlignment(): void {
    const faces = this.getTextureFaces();
    if (faces.length === 0) return;
    this.snapshot();
    for (const face of faces) {
      face.offsetX = 0;
      face.offsetY = 0;
      face.rotation = 0;
      face.scaleX = 0.5;
      face.scaleY = 0.5;
    }
    this.dirty = true;
    this.statusMessage = 'Texture alignment reset';
  }

  /** Fit texture to face polygon bounds */
  fitTexture(): void {
    const faces = this.getTextureFaces();
    if (faces.length === 0 || !this.textureManager) return;
    this.snapshot();
    for (const face of faces) {
      if (face.polygon.length < 3) continue;
      const texInfo = this.textureManager.getIfLoaded(face.texture);
      const tw = texInfo?.width ?? 128;
      const th = texInfo?.height ?? 128;

      // Get texture axes for this face
      const [sv, tv] = textureAxisFromPlane(face.plane.normal);

      // Project polygon onto texture axes to find bounds
      let minS = Infinity, maxS = -Infinity;
      let minT = Infinity, maxT = -Infinity;
      for (const v of face.polygon) {
        const s = vec3Dot(v, sv);
        const t = vec3Dot(v, tv);
        minS = Math.min(minS, s);
        maxS = Math.max(maxS, s);
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
      }

      const sRange = maxS - minS;
      const tRange = maxT - minT;
      if (sRange < 0.001 || tRange < 0.001) continue;

      face.scaleX = sRange / tw;
      face.scaleY = tRange / th;
      face.rotation = 0;
      face.offsetX = -minS / face.scaleX;
      face.offsetY = -minT / face.scaleY;
    }
    this.dirty = true;
    this.statusMessage = 'Texture fit to face';
  }

  // ── Vertex editing ──

  enterVertexMode(): void {
    const brushItems = this.selection.filter(s => s.type === 'brush' || s.type === 'face');
    if (brushItems.length === 0) return;

    this.vertexData = [];
    const seen = new Set<Brush>();
    for (const item of brushItems) {
      if (seen.has(item.brush)) continue;
      seen.add(item.brush);
      this.vertexData.push({
        brush: item.brush,
        entity: item.entity,
        vertices: collectBrushVertices(item.brush),
      });
    }

    this.vertexMode = true;
    this.vertexSelection = [];
    this.dirty = true;
    this.statusMessage = 'Vertex mode';
  }

  exitVertexMode(): { invalidBrushes: { brush: Brush; entity: Entity; result: BrushValidationResult }[] } | null {
    if (!this.vertexMode) return null;

    // Validate all edited brushes before leaving vertex mode
    const invalidBrushes: { brush: Brush; entity: Entity; result: BrushValidationResult }[] = [];
    for (const data of this.vertexData) {
      const result = validateBrush(data.brush);
      if (!result.valid) {
        invalidBrushes.push({ brush: data.brush, entity: data.entity, result });
      }
    }

    this.vertexMode = false;
    this.vertexData = [];
    this.vertexSelection = [];
    this.dirty = true;

    if (invalidBrushes.length > 0) {
      return { invalidBrushes };
    }
    return null;
  }

  /** Rebuild invalid brushes from their face planes (reconvexifies). */
  rebuildBrushes(brushes: Brush[]): void {
    for (const brush of brushes) {
      rebuildBrush(brush);
    }
    this.dirty = true;
  }

  /** Split non-convex brushes into multiple convex brushes. */
  splitBrushesConvex(invalidBrushes: { brush: Brush; entity: Entity }[]): void {
    for (const { brush, entity } of invalidBrushes) {
      const pieces = splitBrushConvex(brush);
      if (pieces.length <= 1) continue; // No split occurred

      // Replace original brush with the convex pieces
      const idx = entity.brushes.indexOf(brush);
      if (idx >= 0) entity.brushes.splice(idx, 1);
      for (const piece of pieces) {
        entity.brushes.push(piece);
      }
    }
    this.selection = [];
    this.dirty = true;
  }

  selectVertex(dataIndex: number, vertexIndex: number, additive = false): void {
    if (!additive) this.vertexSelection = [];
    const idx = this.vertexSelection.findIndex(
      v => v.dataIndex === dataIndex && v.vertexIndex === vertexIndex
    );
    if (idx >= 0) {
      if (additive) this.vertexSelection.splice(idx, 1);
      return;
    }
    this.vertexSelection.push({ dataIndex, vertexIndex });
    this.dirty = true;
  }

  clearVertexSelection(): void {
    this.vertexSelection = [];
    this.dirty = true;
  }

  isVertexSelected(dataIndex: number, vertexIndex: number): boolean {
    return this.vertexSelection.some(
      v => v.dataIndex === dataIndex && v.vertexIndex === vertexIndex
    );
  }

  moveSelectedVertices(delta: Vec3): void {
    if (this.vertexSelection.length === 0) return;

    // Group selected vertex indices by dataIndex (brush)
    const byBrush = new Map<number, number[]>();
    for (const vs of this.vertexSelection) {
      let arr = byBrush.get(vs.dataIndex);
      if (!arr) { arr = []; byBrush.set(vs.dataIndex, arr); }
      arr.push(vs.vertexIndex);
    }

    for (const [di, indices] of byBrush) {
      const data = this.vertexData[di];
      moveVertices(data.brush, data.vertices, indices, delta);
    }

    // Refresh vertex data (polygon topology may have changed)
    this.refreshVertexData();
    this.dirty = true;
  }

  refreshVertexData(): void {
    // Polygons are edited directly — vertex indices are stable, no remapping needed.
    // Just filter out any that went out of range as a safety measure.
    this.vertexSelection = this.vertexSelection.filter(vs =>
      vs.dataIndex < this.vertexData.length &&
      vs.vertexIndex < this.vertexData[vs.dataIndex].vertices.length
    );
  }

  vertexSelectionCenter(): Vec3 | null {
    if (this.vertexSelection.length === 0) return null;
    let sum: Vec3 = [0, 0, 0];
    for (const vs of this.vertexSelection) {
      const pos = this.vertexData[vs.dataIndex]?.vertices[vs.vertexIndex]?.position;
      if (!pos) continue;
      sum[0] += pos[0]; sum[1] += pos[1]; sum[2] += pos[2];
    }
    const n = this.vertexSelection.length;
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  }

  // ── Patch control point editing ──

  enterPatchEditMode(): void {
    const patchItems = this.selection.filter(s => s.type === 'patch') as
      { type: 'patch'; entity: Entity; patch: Patch }[];
    if (patchItems.length === 0) return;

    this.patchEditData = [];
    const seen = new Set<Patch>();
    for (const item of patchItems) {
      if (seen.has(item.patch)) continue;
      seen.add(item.patch);
      this.patchEditData.push({ patch: item.patch, entity: item.entity });
    }

    this.patchEditMode = true;
    this.patchControlSelection = [];
    this.dirty = true;
    this.statusMessage = 'Patch edit mode';
  }

  exitPatchEditMode(): void {
    if (!this.patchEditMode) return;
    // Re-tessellate all edited patches
    for (const data of this.patchEditData) {
      tessellatePatch(data.patch);
    }
    this.patchEditMode = false;
    this.patchEditData = [];
    this.patchControlSelection = [];
    this.dirty = true;
  }

  selectControlPoint(dataIndex: number, row: number, col: number, additive = false): void {
    if (!additive) this.patchControlSelection = [];
    const idx = this.patchControlSelection.findIndex(
      cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
    );
    if (idx >= 0) {
      if (additive) this.patchControlSelection.splice(idx, 1);
      return;
    }
    this.patchControlSelection.push({ dataIndex, row, col });
    this.dirty = true;
  }

  clearControlPointSelection(): void {
    this.patchControlSelection = [];
    this.dirty = true;
  }

  isControlPointSelected(dataIndex: number, row: number, col: number): boolean {
    return this.patchControlSelection.some(
      cp => cp.dataIndex === dataIndex && cp.row === row && cp.col === col
    );
  }

  moveSelectedControlPoints(delta: Vec3): void {
    if (this.patchControlSelection.length === 0) return;

    const affectedPatches = new Set<number>();
    for (const cp of this.patchControlSelection) {
      const data = this.patchEditData[cp.dataIndex];
      if (!data) continue;
      const pt = data.patch.ctrl[cp.row][cp.col];
      pt.xyz[0] += delta[0];
      pt.xyz[1] += delta[1];
      pt.xyz[2] += delta[2];
      affectedPatches.add(cp.dataIndex);
    }

    // Re-tessellate affected patches
    for (const di of affectedPatches) {
      tessellatePatch(this.patchEditData[di].patch);
    }
    this.dirty = true;
  }

  patchControlSelectionCenter(): Vec3 | null {
    if (this.patchControlSelection.length === 0) return null;
    let sum: Vec3 = [0, 0, 0];
    for (const cp of this.patchControlSelection) {
      const data = this.patchEditData[cp.dataIndex];
      if (!data) continue;
      const pos = data.patch.ctrl[cp.row][cp.col].xyz;
      sum[0] += pos[0]; sum[1] += pos[1]; sum[2] += pos[2];
    }
    const n = this.patchControlSelection.length;
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  }
}
