import { describe, expect, test } from 'vitest';
import { explainDiagnostic } from '../bridge/diagnostic-explain';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';

describe('MCP diagnostic explanations', () => {
  test('resolves missing material faces and proposes a previewable repair', () => {
    const editor = new Editor();
    editor.entities = [createEntity('worldspawn')];
    applyMapOperations(editor, [
      { type: 'create_box', mins: [0, 0, 0], maxs: [64, 64, 64], texture: 'custom/missing' },
    ]);

    const result = explainDiagnostic(editor.serializeMap(), {
      code: 'missing-shader-image',
      message: "WARNING: Couldn't find image for shader custom/missing",
      severity: 'warning',
    });
    expect(result).toMatchObject({
      impact: 'visible', matters: true,
      likelyRefs: ['E0:B0:F0', 'E0:B0:F1', 'E0:B0:F2', 'E0:B0:F3', 'E0:B0:F4', 'E0:B0:F5'],
      suggestedOperations: [expect.objectContaining({ type: 'edit_faces', texture: '<replacement from texture_search>', fit: true })],
    });
  });

  test('marks intentional grid guidance as informational', () => {
    expect(explainDiagnostic('// empty\n', {
      code: 'style-grid-deviation', message: 'Generated curve is off grid', severity: 'info', refs: ['E0:B1'],
    })).toMatchObject({ impact: 'informational', matters: false, likelyRefs: ['E0:B1'] });
  });
});
