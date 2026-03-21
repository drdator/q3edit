import { Vec3, vec3, vec3Add, vec3Sub, vec3Snap, vec3Copy, vec3Scale } from './math';
import { Brush, BrushFace, createBoxBrush, translateBrush, cloneBrush, computeBrushGeometry } from './brush';
import { Entity, createEntity, entityOrigin, translateEntity, cloneEntity, setEntityOrigin } from './entity';
import { History } from './history';
import { serializeMap, parseMap } from './mapfile';

export type Tool = 'select' | 'create' | 'entity';

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
}

export class Editor {
  entities: Entity[] = [];
  selection: SelectionItem[] = [];
  activeTool: Tool = 'select';
  gridSize = 16;
  currentTexture = 'common/caulk';
  currentEntityClass = 'info_player_deathmatch';
  dirty = true;
  history = new History();
  fileName = 'untitled.map';

  // Drag state for brush creation
  creating = false;
  createStart: Vec3 = [0, 0, 0];
  createEnd: Vec3 = [0, 0, 0];
  createAxisH = 0;
  createAxisV = 1;
  createDepth = 64;

  // Status message
  statusMessage = 'Ready';

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
    this.selection = [];
    this.dirty = true;
  }

  selectBrush(entity: Entity, brush: Brush, additive = false): void {
    if (!additive) this.selection = [];
    // Check if already selected
    const idx = this.selection.findIndex(
      s => s.type === 'brush' && s.brush === brush
    );
    if (idx >= 0) {
      if (additive) this.selection.splice(idx, 1); // toggle off
      return;
    }
    this.selection.push({ type: 'brush', entity, brush });
    this.dirty = true;
  }

  selectEntity(entity: Entity, additive = false): void {
    if (!additive) this.selection = [];
    const idx = this.selection.findIndex(
      s => s.type === 'entity' && s.entity === entity
    );
    if (idx >= 0) {
      if (additive) this.selection.splice(idx, 1);
      return;
    }
    this.selection.push({ type: 'entity', entity });
    this.dirty = true;
  }

  isSelected(brush: Brush): boolean {
    return this.selection.some(s => s.type === 'brush' && s.brush === brush);
  }

  isEntitySelected(entity: Entity): boolean {
    return this.selection.some(s => s.type === 'entity' && s.entity === entity);
  }

  selectFace(entity: Entity, brush: Brush, face: BrushFace): void {
    // Face selection is always single — replaces entire selection
    this.selection = [{ type: 'face', entity, brush, face }];
    this.dirty = true;
  }

  isFaceSelected(face: BrushFace): boolean {
    return this.selection.some(s => s.type === 'face' && s.face === face);
  }

  get selectedFace(): BrushFace | null {
    const s = this.selection[0];
    return s?.type === 'face' ? s.face : null;
  }

  // ── Brush operations ──

  addBrush(mins: Vec3, maxs: Vec3): Brush {
    const snapped_mins = vec3Snap(mins, this.gridSize);
    const snapped_maxs = vec3Snap(maxs, this.gridSize);

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
      if (realMaxs[i] - realMins[i] < this.gridSize) {
        realMaxs[i] = realMins[i] + this.gridSize;
      }
    }

    const brush = createBoxBrush(realMins, realMaxs, this.currentTexture);
    this.worldspawn.brushes.push(brush);
    this.dirty = true;
    return brush;
  }

  deleteSelection(): void {
    if (this.selection.length === 0) return;
    this.snapshot();

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        const brush = item.brush;
        const idx = item.entity.brushes.indexOf(brush);
        if (idx >= 0) item.entity.brushes.splice(idx, 1);
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
    const snapped = vec3Snap(delta, this.gridSize);
    if (snapped[0] === 0 && snapped[1] === 0 && snapped[2] === 0) return;

    for (const item of this.selection) {
      if (item.type === 'brush' || item.type === 'face') {
        translateBrush(item.brush, snapped);
      } else {
        translateEntity(item.entity, snapped);
      }
    }
    this.dirty = true;
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

  // ── Entity operations ──

  addEntity(classname: string, origin: Vec3): Entity {
    const snapped = vec3Snap(origin, this.gridSize);
    const entity = createEntity(classname, snapped);
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
      this.dirty = true;
      this.statusMessage = 'Undo';
    }
  }

  redo(): void {
    const next = this.history.redo(this.entities);
    if (next) {
      this.entities = next;
      this.selection = [];
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
    for (const entity of this.entities) {
      for (const brush of entity.brushes) {
        yield { entity, brush };
      }
    }
  }

  // ── Point entities (non-worldspawn, no brushes) ──

  *pointEntities(): Iterable<Entity> {
    for (let i = 1; i < this.entities.length; i++) {
      if (this.entities[i].brushes.length === 0) {
        yield this.entities[i];
      }
    }
  }

  // ── Select all ──

  selectAll(): void {
    this.selection = [];
    for (const { entity, brush } of this.allBrushes()) {
      this.selection.push({ type: 'brush', entity, brush });
    }
    for (const entity of this.pointEntities()) {
      this.selection.push({ type: 'entity', entity });
    }
    this.dirty = true;
  }

  setTexture(texture: string): void {
    this.currentTexture = texture;
    // Apply to selected face or all faces of selected brushes
    for (const item of this.selection) {
      if (item.type === 'face') {
        item.face.texture = texture;
      } else if (item.type === 'brush') {
        for (const face of item.brush.faces) {
          face.texture = texture;
        }
      }
    }
    this.dirty = true;
  }
}
