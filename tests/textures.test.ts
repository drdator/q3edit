import { describe, expect, it } from 'vitest';
import { imageMimeType, textureImageCandidates } from '../src/textures';

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
});
