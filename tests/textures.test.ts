import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AssetIndex } from '../src/asset-index';
import { imageMimeType, TextureManager, textureImageCandidates } from '../src/textures';

describe('texture image resolution', () => {
  it('normalizes model shader paths and considers modern image formats', () => {
    const candidates = textureImageCandidates('Models\\Powerups\\item.PNG');
    expect(candidates[0]).toBe('models/powerups/item.png');
    expect(candidates).toContain('models/powerups/item.tga');
    expect(candidates).toContain('textures/models/powerups/item.webp');
  });

  it('does not duplicate the textures prefix', () => {
    expect(textureImageCandidates('textures/base/wall')).not.toContain('textures/textures/base/wall.tga');
  });

  it('provides MIME types for browser-decoded formats', () => {
    expect(imageMimeType('texture.PNG')).toBe('image/png');
    expect(imageMimeType('texture.webp')).toBe('image/webp');
    expect(imageMimeType('texture.jpg')).toBe('image/jpeg');
  });

  it('accepts declared tool shaders without preview images as valid texture sources', () => {
    const packed = zipSync({
      'scripts/tools.shader': strToU8('textures/common/agent_clip\n{\n  surfaceparm nodraw\n}'),
    });
    const gl = {
      TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, TEXTURE_MIN_FILTER: 4, TEXTURE_MAG_FILTER: 5,
      LINEAR_MIPMAP_LINEAR: 6, LINEAR: 7, TEXTURE_WRAP_S: 8, TEXTURE_WRAP_T: 9, REPEAT: 10,
      createTexture: () => ({}), bindTexture: () => {}, texImage2D: () => {}, generateMipmap: () => {},
      texParameteri: () => {}, deleteTexture: () => {},
    } as unknown as WebGL2RenderingContext;
    const manager = new TextureManager(gl, new AssetIndex([{ name: 'tools.pk3', data: new Uint8Array(packed).buffer }]));

    expect(manager.isShader('common/agent_clip')).toBe(true);
    expect(manager.hasPreviewSource('common/agent_clip')).toBe(false);
    expect(manager.hasTextureSource('common/agent_clip')).toBe(true);
    expect(manager.hasTextureSource('common/not_declared')).toBe(false);
  });
});
