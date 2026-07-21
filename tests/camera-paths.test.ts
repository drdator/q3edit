import { describe, expect, it } from 'vitest';
import {
  CAMERA_ACTION_KEY,
  CAMERA_LOOK_TARGET_KEY,
  CAMERA_SERIALIZATION_DECISION,
  cameraPathDuration,
  collectCameraPaths,
  sampleCameraPath,
} from '../src/camera-paths';
import { collectEntityLinks, collectEntityPathCurves } from '../src/editor-connections';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { parseMap, serializeMap } from '../src/mapfile';

function point(classname: string, origin: [number, number, number]) {
  return createEntity(classname, origin);
}

describe('camera paths', () => {
  it('creates a serialized camera path extension without changing ordinary links', () => {
    const editor = new Editor();
    const first = point('info_null', [0, 0, 32]);
    const second = point('info_null', [128, 0, 48]);
    const third = point('info_null', [256, 64, 64]);
    first.properties.target = 'existing_link';
    editor.entities.push(first, second, third);
    editor.selection = [first, second, third].map(entity => ({ type: 'entity' as const, entity }));
    const path = editor.createCameraPathFromSelection('Intro', false)!;

    expect(CAMERA_SERIALIZATION_DECISION).toBe('q3edit-entity-properties-extension');
    expect(first.properties.target).toBe('existing_link');
    expect(path.points.map(item => item.position)).toEqual([[0, 0, 32], [128, 0, 48], [256, 64, 64]]);
    expect(collectEntityPathCurves(editor)).toContainEqual(expect.objectContaining({ closed: false, entities: [first, second, third] }));

    const loaded = parseMap(serializeMap(editor.entities));
    const loadedEditor = new Editor(); loadedEditor.entities = loaded;
    expect(collectCameraPaths(loadedEditor)[0]).toMatchObject({ name: 'Intro', closed: false });
    expect(collectCameraPaths(loadedEditor)[0].points).toHaveLength(3);
  });

  it('edits timing/actions, reorders points, and supports undo/redo', () => {
    const editor = new Editor();
    const first = point('info_null', [0, 0, 0]); const second = point('info_null', [64, 0, 0]); const third = point('info_null', [128, 0, 0]);
    editor.entities.push(first, second, third);
    editor.selection = [first, second, third].map(entity => ({ type: 'entity' as const, entity }));
    editor.createCameraPathFromSelection('Edit', false);
    editor.updateCameraPoint(first, { duration: 4, wait: 1.5, fov: 105, lookTarget: 'look_here', action: 'fade-in' });
    expect(first.properties[CAMERA_ACTION_KEY]).toBe('fade-in');
    expect(first.properties[CAMERA_LOOK_TARGET_KEY]).toBe('look_here');
    expect(collectCameraPaths(editor)[0].invalidReferences).toHaveLength(1);
    editor.undo();
    expect(editor.entities[1].properties[CAMERA_ACTION_KEY]).toBeUndefined();
    editor.redo();
    const restored = editor.entities[1];
    editor.reorderCameraPoint(restored, 1);
    expect(collectCameraPaths(editor)[0].points[1].entity).toBe(restored);
  });

  it('samples open/closed timelines and advances 3D playback', () => {
    const editor = new Editor();
    const look = point('target_position', [128, 128, 64]); look.properties.targetname = 'look';
    const first = point('info_null', [0, 0, 0]); const second = point('info_null', [128, 0, 0]); const third = point('info_null', [128, 128, 0]);
    editor.entities.push(look, first, second, third);
    editor.selection = [first, second, third].map(entity => ({ type: 'entity' as const, entity }));
    const path = editor.createCameraPathFromSelection('Loop', true)!;
    editor.updateCameraPoint(first, { duration: 2, wait: 1, lookTarget: 'look', action: 'start' });
    const updated = collectCameraPaths(editor)[0];
    expect(updated.invalidReferences).toEqual([]);
    expect(cameraPathDuration(updated)).toBe(7);
    expect(sampleCameraPath(updated, 0.5)).toMatchObject({ position: [0, 0, 0], action: 'start' });
    expect(sampleCameraPath(updated, 8)?.elapsed).toBe(1);

    editor.startCameraPlayback(path.id);
    const pose = editor.advanceCameraPlayback(1.5)!;
    expect(pose.position[0]).toBeGreaterThan(0);
    expect(pose.pitch).toBeGreaterThan(0);
    editor.toggleCameraPlayback(path.id);
    expect(editor.cameraPlayback).toMatchObject({ elapsed: 1.5, playing: false });
    expect(editor.advanceCameraPlayback(1)).toBeNull();
    editor.toggleCameraPlayback(path.id);
    expect(editor.cameraPlayback?.playing).toBe(true);
    let soughtPose = null;
    editor.onCameraPlaybackSeek(pose => { soughtPose = pose; });
    const seekResult = editor.seekCameraPlayback(2.25);
    expect(soughtPose).toBe(seekResult);
    expect(editor.camera3d.position).toEqual(seekResult?.position);
    const loopedPose = editor.advanceCameraPlayback(6.5)!;
    expect(editor.cameraPlayback?.elapsed).toBe(1.75);
    expect(loopedPose.elapsed).toBe(1.75);
    editor.stopCameraPlayback();
    expect(editor.cameraPlayback).toBeNull();
  });

  it('builds smart open/closed paths and connects a train using standard targets', () => {
    const editor = new Editor();
    editor.camera3d.position = [0, 0, 32]; editor.camera3d.yaw = 0;
    const created = editor.createSmartPath(5, 96, false);
    expect(created).toHaveLength(5);
    expect(created[0].properties.target).toBe(created[1].properties.targetname);
    expect(created[4].properties.target).toBeUndefined();
    expect(collectEntityLinks(editor)).toHaveLength(4);

    editor.selection = created.slice(0, 3).map(entity => ({ type: 'entity' as const, entity }));
    editor.createSmartPath(3, 64, true);
    expect(created[2].properties.target).toBe(created[0].properties.targetname);

    const train = createEntity('func_train'); editor.entities.push(train);
    editor.selection = [{ type: 'entity', entity: train }];
    const trainPoints = editor.createSmartTrainPath(3, 64);
    expect(trainPoints).toHaveLength(3);
    expect(train.properties.target).toBe(trainPoints[0].properties.targetname);
  });
});
