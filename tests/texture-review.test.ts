import { describe, expect, test } from 'vitest';
import { Editor } from '../src/editor';
import { createEntity } from '../src/entity';
import { applyMapOperations } from '../src/map-operations';
import { reviewTextureQuality } from '../bridge/texture-review';

function emptyEditor(): Editor {
  const editor = new Editor();
  editor.entities = [createEntity('worldspawn')];
  return editor;
}

describe('MCP texture quality review', () => {
  test('accepts normal architectural texture density', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [{
      type: 'create_box', mins: [0, 0, 0], maxs: [128, 128, 64], texture: 'base_wall/metal',
    }]);

    const review = reviewTextureQuality(editor.serializeMap());
    expect(review.status).toBe('pass');
    expect(review.summary).toMatchObject({ facesReviewed: 6, materialsReviewed: 1, warningCount: 0 });
    expect(review.summary.density).toEqual({ minimum: 2, maximum: 2, median: 2 });
  });

  test('flags large fitted artwork and offers a repeat-aware transform', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [{
      type: 'create_box', mins: [0, 0, 0], maxs: [512, 512, 16], texture: 'base_floor/metal',
      textureTransforms: { top: { fit: true } },
    }]);

    const review = reviewTextureQuality(editor.serializeMap());
    expect(review.issues.sample).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'low-texel-density', refs: ['E0:B0:F4'] }),
      expect.objectContaining({
        code: 'large-fitted-face', refs: ['E0:B0:F4'],
        suggestedTransform: { fit: true, scale: [0.25, 0.25] },
      }),
    ]));
  });

  test('flags stretched and inconsistent projections with face references', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [
      {
        type: 'create_box', mins: [0, 0, 0], maxs: [128, 128, 64], texture: 'base_wall/metal',
        textureTransforms: { top: { scale: [0.1, 10] } },
      },
      {
        type: 'create_box', mins: [256, 0, 0], maxs: [384, 128, 64], texture: 'base_wall/metal',
        textureTransform: { scale: [5, 5] },
      },
    ]);

    const review = reviewTextureQuality(editor.serializeMap());
    expect(review.issues.sample).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'anisotropic-texture', refs: ['E0:B0:F4'] }),
      expect.objectContaining({ code: 'inconsistent-density', refs: ['E0:B1:F0'] }),
    ]));
  });

  test('omits tool textures unless explicitly requested', () => {
    const editor = emptyEditor();
    applyMapOperations(editor, [{
      type: 'create_box', mins: [0, 0, 0], maxs: [512, 512, 16], texture: 'common/caulk',
      textureTransform: { fit: true },
    }]);

    expect(reviewTextureQuality(editor.serializeMap()).summary.facesReviewed).toBe(0);
    expect(reviewTextureQuality(editor.serializeMap(), new Map(), { includeToolTextures: true }).summary.facesReviewed).toBe(6);
  });
});
