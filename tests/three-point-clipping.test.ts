import { describe, expect, test } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

function editorWithBrush(): Editor {
  const editor = new Editor();
  const worldspawn = createEntity('worldspawn');
  const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
  worldspawn.brushes.push(brush);
  editor.entities = [worldspawn];
  editor.selection = [{ type: 'brush', entity: worldspawn, brush }];
  editor.clipMode = 'both';
  return editor;
}

describe('three-point clipping', () => {
  test('keeps the two-point axial clipping workflow', () => {
    const editor = editorWithBrush();
    editor.addClipPoint([32, 0, 0], 2);
    editor.addClipPoint([32, 64, 0], 2);

    editor.executeClip();

    expect(editor.entities[0].brushes).toHaveLength(2);
    expect(editor.history.undoLabel).toBe('Clip selection');
  });

  test('clips against an arbitrary plane defined by three points', () => {
    const editor = editorWithBrush();
    editor.addClipPoint([0, 0, 0], -1);
    editor.addClipPoint([64, 0, 0], -1);
    editor.addClipPoint([0, 64, 64], -1);

    editor.executeClip();

    expect(editor.entities[0].brushes).toHaveLength(2);
    expect(editor.selection).toHaveLength(2);
    expect(editor.clipPoints).toHaveLength(0);
  });

  test('rejects collinear points without creating history', () => {
    const editor = editorWithBrush();
    editor.addClipPoint([0, 0, 0], -1);
    editor.addClipPoint([16, 16, 16], -1);
    editor.addClipPoint([32, 32, 32], -1);

    editor.executeClip();

    expect(editor.entities[0].brushes).toHaveLength(1);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.statusMessage).toContain('collinear');
  });

  test('requires a third point when points originate in the 3D view', () => {
    const editor = editorWithBrush();
    editor.addClipPoint([0, 0, 0], -1);
    editor.addClipPoint([64, 0, 0], -1);

    editor.executeClip();

    expect(editor.entities[0].brushes).toHaveLength(1);
    expect(editor.statusMessage).toContain('third point');
  });

  test('starts a new plane after three points', () => {
    const editor = editorWithBrush();
    editor.addClipPoint([0, 0, 0], -1);
    editor.addClipPoint([64, 0, 0], -1);
    editor.addClipPoint([0, 64, 0], -1);
    editor.addClipPoint([8, 8, 8], 2);

    expect(editor.clipPoints).toEqual([[8, 8, 8]]);
    expect(editor.clipDepthAxis).toBe(2);
  });
});
