import { describe, expect, it } from 'vitest';
import { createBoxBrush } from '../src/brush';
import { importBrushMacro, normalizeBrushMacro, runBrushMacro } from '../src/brush-macros';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';

describe('brush macros', () => {
  function selectedEditor(): Editor {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    const brush = createBoxBrush([0, 0, 0], [64, 64, 64]);
    editor.entities[0].brushes.push(brush);
    editor.selectBrushDirect(editor.entities[0], brush);
    return editor;
  }

  it('validates the versioned declarative format', () => {
    expect(importBrushMacro('{"version":1,"name":"Offset","steps":[{"operation":"translate","offset":[1,2,3]}]}')).toMatchObject({ name: 'Offset' });
    expect(() => normalizeBrushMacro({ version: 2, steps: [{ operation: 'duplicate' }] })).toThrow('Unsupported brush macro version');
    expect(() => normalizeBrushMacro({ version: 1, steps: [{ operation: 'shell' }] })).toThrow('unsupported operation');
  });

  it('duplicates, transforms, and rotates brushes in one undoable transaction', () => {
    const editor = selectedEditor();
    const result = runBrushMacro(editor, {
      version: 1, name: 'Offset copy',
      steps: [{ operation: 'duplicate' }, { operation: 'translate', offset: [128, 0, 0] }, { operation: 'rotate', axis: 'z', degrees: 90 }],
    });
    expect(result).toEqual({ changed: true, selectedBrushes: 1 });
    expect(editor.worldspawn.brushes).toHaveLength(2);
    expect(editor.worldspawn.brushes[0].mins).toEqual([0, 0, 0]);
    expect(editor.worldspawn.brushes[1].mins[0]).toBeCloseTo(128);
    expect(editor.history.canUndo).toBe(true);
    editor.undo();
    expect(editor.worldspawn.brushes).toHaveLength(1);
  });

  it('does not create history when there is no brush selection or validation fails', () => {
    const editor = new Editor();
    expect(runBrushMacro(editor, { version: 1, name: 'Nothing', steps: [{ operation: 'duplicate' }] })).toEqual({ changed: false, selectedBrushes: 0 });
    expect(editor.history.canUndo).toBe(false);
    expect(() => runBrushMacro(editor, { version: 1, name: 'Bad', steps: [{ operation: 'translate', offset: [0, Number.NaN, 0] }] })).toThrow();
    expect(editor.history.canUndo).toBe(false);
  });
});
