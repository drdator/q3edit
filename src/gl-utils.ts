import { DYNAMIC_LIGHT_AMBIENT } from './dynamic-lighting';

// ── Shaders ──

export const VERT_SRC = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uPV;
out vec3 vNormal;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  vNormal = aNormal;
  vUV = aUV;
  vWorldPos = aPos;
  gl_Position = uPV * vec4(aPos, 1.0);
}
`;

export const FRAG_SRC = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUV;
in vec3 vWorldPos;
uniform sampler2D uTexture;
uniform float uSelected;
uniform float uFaceSelected;
uniform float uUseAlpha;
uniform float uAlphaOverride; // 0.0 = no override, >0 = forced alpha
uniform float uSolidOverride; // 1.0 = replace texture with solid color
uniform float uDynamicLightingEnabled;
uniform int uDynamicLightCount;
uniform vec3 uDynamicLightPos[4];
uniform vec3 uDynamicLightColor[4];
uniform float uDynamicLightRadius[4];
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.3, 0.5, 0.7));
  float diff = abs(dot(n, lightDir)) * 0.5 + 0.45;

  vec4 texColor = texture(uTexture, vUV);
  float baseLight = mix(diff, ${DYNAMIC_LIGHT_AMBIENT.toFixed(2)}, uDynamicLightingEnabled);
  vec3 color = texColor.rgb * baseLight;
  for (int i = 0; i < 4; i++) {
    if (i >= uDynamicLightCount) break;
    float radius = max(uDynamicLightRadius[i], 1.0);
    float attenuation = max(0.0, 1.0 - distance(vWorldPos, uDynamicLightPos[i]) / radius);
    color += texColor.rgb * uDynamicLightColor[i] * attenuation * attenuation;
  }

  // Orange tint for selected brushes
  color = mix(color, vec3(1.0, 0.6, 0.2), uSelected * 0.25);
  // Cyan tint for selected face
  color = mix(color, vec3(0.2, 0.8, 1.0), uFaceSelected * 0.35);
  // Solid cyan override (invisible faces selected in hide mode)
  color = mix(color, vec3(0.15, 0.5, 0.7) * diff, uSolidOverride);

  float alpha = mix(1.0, texColor.a, uUseAlpha);
  alpha = mix(alpha, uAlphaOverride, step(0.001, uAlphaOverride));
  fragColor = vec4(color, alpha);
}
`;

export const LINE_VERT_SRC = `#version 300 es
precision mediump float;
layout(location=0) in vec3 aPos;
uniform mat4 uPV;
void main() {
  gl_Position = uPV * vec4(aPos, 1.0);
}
`;

export const LINE_FRAG_SRC = `#version 300 es
precision mediump float;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor, 1.0);
}
`;

// ── Shader compilation ──

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
  }
  return prog;
}

// ── Buffer helpers ──

export interface GLBuffer {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

/** Create a VAO+VBO for line geometry: position only (3 floats, stride 12) */
export function createLineBuffer(gl: WebGL2RenderingContext): GLBuffer {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);
  return { vao, vbo };
}

/** Create a VAO+VBO for solid geometry: pos(3) + normal(3) + uv(2) = 8 floats, stride 32 */
export function createSolidBuffer(gl: WebGL2RenderingContext): GLBuffer {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  gl.bindVertexArray(null);
  return { vao, vbo };
}
