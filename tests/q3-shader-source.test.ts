import { describe, expect, test } from 'vitest';
import {
  defaultProjectShaderSource,
  normalizeProjectShaderPath,
  validateProjectShaderFiles,
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

  test('rejects extra top-level tokens before a shader block', () => {
    const validation = validateShaderSource('textures/custom/wall unexpected { }');
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics[0]?.message).toContain('Unexpected token');
  });

  test('normalizes project package paths and creates a valid template', () => {
    expect(normalizeProjectShaderPath('My Shaders/custom')).toBe('scripts/My_Shaders/custom.shader');
    expect(normalizeProjectShaderPath('../../')).toBe('scripts/q3edit_custom.shader');
    expect(normalizeProjectShaderPath('scripts/../custom')).toBe('scripts/custom.shader');
    expect(normalizeProjectShaderPath('CUSTOM.SHADER')).toBe('scripts/CUSTOM.shader');
    expect(validateShaderSource(defaultProjectShaderSource()).valid).toBe(true);
  });

  test('rejects duplicate shader definitions across project files', () => {
    const validation = validateProjectShaderFiles({
      'scripts/first.shader': 'textures/custom/shared { }',
      'scripts/second.shader': 'textures/custom/shared { }',
    });
    expect(validation.valid).toBe(false);
    expect(validation.files['scripts/second.shader'].diagnostics[0]?.message)
      .toContain('Duplicate shader across project files');
  });
});
