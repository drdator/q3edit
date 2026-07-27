import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoxBrush } from '../src/brush';
import {
  floorHeightsAt,
  lookThroughCameraPath,
  lookThroughSelectedEntity,
  moveCameraFloor,
  moveSelectionToCamera,
} from '../src/editor-camera-conveniences';
import {
  EntityClassRegistry,
  getEntityClassRegistry,
  setEntityClassRegistry,
} from '../src/entity-definitions';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { serializeMap } from '../src/mapfile';

describe('camera conveniences', () => {
  let previousRegistry: EntityClassRegistry;

  beforeEach(() => {
    previousRegistry = getEntityClassRegistry();
    const registry = new EntityClassRegistry();
    registry.loadSource(
      '/*QUAKED info_player_deathmatch (0 1 0) (-16 -16 -24) (16 16 32)\\nPlayer spawn\\n*/',
      'camera-test.def',
      'def',
    );
    setEntityClassRegistry(registry);
  });

  afterEach(() => setEntityClassRegistry(previousRegistry));

  it('looks through the selected entity using its definition-derived eye height and angles', () => {
    const editor = new Editor();
    const spawn = createEntity('info_player_deathmatch', [64, 96, 100]);
    spawn.properties.angles = '0 90 0';
    editor.entities = [createEntity('worldspawn'), spawn];
    editor.selection = [{ type: 'entity', entity: spawn }];
    const located = vi.fn();
    editor.onLocatePoint(located);

    lookThroughSelectedEntity(editor);

    const [position, target] = located.mock.calls[0];
    expect(position).toEqual([64, 96, 126.4]);
    expect(target[0]).toBeCloseTo(64);
    expect(target[1]).toBeCloseTo(224);
    expect(editor.camera3d.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('looks through a selected camera path point toward the next point', () => {
    const editor = new Editor();
    const first = createEntity('info_null', [0, 0, 64]);
    const second = createEntity('info_null', [128, 0, 64]);
    editor.entities = [createEntity('worldspawn'), first, second];
    editor.selection = [
      { type: 'entity', entity: first },
      { type: 'entity', entity: second },
    ];
    editor.createCameraPathFromSelection('Test Camera');
    editor.selection = [{ type: 'entity', entity: first }];

    lookThroughCameraPath(editor);

    expect(editor.camera3d.position).toEqual([0, 0, 64]);
    expect(editor.camera3d.yaw).toBeCloseTo(0);
    expect(editor.statusMessage).toContain('Test Camera');
  });

  it('moves the selection center exactly to the current camera', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    world.brushes.push(brush);
    editor.entities = [world];
    editor.selection = [{ type: 'brush', entity: world, brush }];
    editor.camera3d.position = [256, 128, 96];

    moveSelectionToCamera(editor);

    expect(editor.selectionCenter()).toEqual([256, 128, 96]);
    expect(editor.history.undoLabel).toBe('Move selection');
  });

  it('pastes map geometry centered at the camera in one transaction', async () => {
    const sourceWorld = createEntity('worldspawn');
    sourceWorld.brushes.push(createBoxBrush([0, 0, 0], [64, 64, 64]));
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    editor.clipboardText = serializeMap([sourceWorld]);
    editor.camera3d.position = [256, 128, 96];

    await editor.pasteClipboardAtCamera();

    expect(editor.selectionCenter()).toEqual([256, 128, 96]);
    expect(editor.history.undoLabel).toBe('Paste at camera');
  });

  it('finds walkable brush tops and moves between floors while preserving eye offset', () => {
    const editor = new Editor();
    const world = createEntity('worldspawn');
    world.brushes.push(
      createBoxBrush([0, 0, -16], [128, 128, 0]),
      createBoxBrush([0, 0, 112], [128, 128, 128]),
    );
    editor.entities = [world];
    editor.camera3d = { position: [32, 32, 64], yaw: 0.25, pitch: -0.1 };

    expect(floorHeightsAt(editor, 32, 32)).toEqual([0, 128]);
    moveCameraFloor(editor, 1);
    expect(editor.camera3d.position).toEqual([32, 32, 192]);
    moveCameraFloor(editor, -1);
    expect(editor.camera3d.position).toEqual([32, 32, 64]);
  });
});
