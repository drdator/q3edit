import { describe, expect, test } from 'vitest';
import {
  defaultProjectShaderSource,
  normalizeProjectShaderPath,
  validateShaderSource,
} from '../src/q3-shader-source';

describe('Q3 shader source editing', () => {
  test('accepts nested stages and preserves declared names', () => {
    const source = `// custom shader
textures/custom/glow
{
  qer_editorimage textures/base_light/light1
  q3map_surfacelight 400
  {
    map textures/base_light/light1
    blendFunc add
  }
}`;
    expect(validateShaderSource(source)).toEqual({
      valid: true,
      shaderNames: ['custom/glow'],
      diagnostics: [],
    });
  });

  test('reports unclosed and duplicate definitions with source lines', () => {
    const source = `textures/custom/repeated { }
textures/custom/repeated {
  { map textures/base/wall }
`;
    const validation = validateShaderSource(source);
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some(item => /Duplicate shader/.test(item.message))).toBe(true);
    expect(validation.diagnostics.some(item => /Unclosed/.test(item.message))).toBe(true);
  });

  test('normalizes project package paths and creates a valid template', () => {
    expect(normalizeProjectShaderPath('My Shaders/custom')).toBe('scripts/My_Shaders/custom.shader');
    expect(validateShaderSource(defaultProjectShaderSource()).valid).toBe(true);
  });
});
