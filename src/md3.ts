import type { Vec3 } from './math';

export interface Md3Frame {
  mins: Vec3;
  maxs: Vec3;
  origin: Vec3;
  radius: number;
  name: string;
}

export interface Md3Tag {
  name: string;
  origin: Vec3;
  axis: [Vec3, Vec3, Vec3];
}

export interface Md3Vertex {
  position: Vec3;
  normal: Vec3;
}

export interface Md3Surface {
  name: string;
  shaders: string[];
  triangles: Array<[number, number, number]>;
  uvs: Array<[number, number]>;
  frames: Md3Vertex[][];
}

export interface Md3Model {
  name: string;
  frames: Md3Frame[];
  tags: Md3Tag[][];
  surfaces: Md3Surface[];
}

const MAX_FRAMES = 1024;
const MAX_TAGS = 4096;
const MAX_SURFACES = 256;
const MAX_VERTICES = 1_000_000;
const MAX_TRIANGLES = 1_000_000;

export class Md3Error extends Error {
  constructor(message: string, readonly offset?: number) {
    super(offset === undefined ? message : `${message} at byte ${offset}`);
    this.name = 'Md3Error';
  }
}

class Reader {
  readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  check(offset: number, size: number, label: string): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > this.data.byteLength) {
      throw new Md3Error(`Truncated or invalid ${label}`, offset);
    }
  }
  i16(offset: number): number { this.check(offset, 2, 'int16'); return this.view.getInt16(offset, true); }
  u16(offset: number): number { this.check(offset, 2, 'uint16'); return this.view.getUint16(offset, true); }
  i32(offset: number): number { this.check(offset, 4, 'int32'); return this.view.getInt32(offset, true); }
  f32(offset: number): number { this.check(offset, 4, 'float'); return this.view.getFloat32(offset, true); }
  string(offset: number, length: number): string {
    this.check(offset, length, 'string');
    const end = this.data.subarray(offset, offset + length).indexOf(0);
    return new TextDecoder().decode(this.data.subarray(offset, offset + (end < 0 ? length : end)));
  }
  vec3(offset: number): Vec3 { return [this.f32(offset), this.f32(offset + 4), this.f32(offset + 8)]; }
}

function checkedCount(value: number, max: number, label: string, offset: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Md3Error(`Invalid ${label} count ${value}`, offset);
  return value;
}

function decodedNormal(value: number): Vec3 {
  const latitude = ((value >> 8) & 0xff) * Math.PI * 2 / 255;
  const longitude = (value & 0xff) * Math.PI * 2 / 255;
  return [
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude) * Math.sin(longitude),
    Math.cos(longitude),
  ];
}

export function decodeMd3(data: Uint8Array): Md3Model {
  const reader = new Reader(data);
  reader.check(0, 108, 'MD3 header');
  if (reader.string(0, 4) !== 'IDP3') throw new Md3Error('Invalid MD3 identifier', 0);
  if (reader.i32(4) !== 15) throw new Md3Error('Unsupported MD3 version', 4);
  const frameCount = checkedCount(reader.i32(76), MAX_FRAMES, 'frame', 76);
  const tagCount = checkedCount(reader.i32(80), MAX_TAGS, 'tag', 80);
  const surfaceCount = checkedCount(reader.i32(84), MAX_SURFACES, 'surface', 84);
  const frameOffset = reader.i32(92);
  const tagOffset = reader.i32(96);
  const surfaceOffset = reader.i32(100);
  const endOffset = reader.i32(104);
  reader.check(0, endOffset, 'MD3 file extent');
  reader.check(frameOffset, frameCount * 56, 'MD3 frames');
  reader.check(tagOffset, frameCount * tagCount * 112, 'MD3 tags');

  const frames: Md3Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const offset = frameOffset + i * 56;
    frames.push({
      mins: reader.vec3(offset), maxs: reader.vec3(offset + 12), origin: reader.vec3(offset + 24),
      radius: reader.f32(offset + 36), name: reader.string(offset + 40, 16),
    });
  }
  const tags: Md3Tag[][] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const frameTags: Md3Tag[] = [];
    for (let tag = 0; tag < tagCount; tag++) {
      const offset = tagOffset + (frame * tagCount + tag) * 112;
      frameTags.push({
        name: reader.string(offset, 64), origin: reader.vec3(offset + 64),
        axis: [reader.vec3(offset + 76), reader.vec3(offset + 88), reader.vec3(offset + 100)],
      });
    }
    tags.push(frameTags);
  }

  const surfaces: Md3Surface[] = [];
  let offset = surfaceOffset;
  for (let surfaceIndex = 0; surfaceIndex < surfaceCount; surfaceIndex++) {
    reader.check(offset, 108, 'MD3 surface header');
    if (reader.string(offset, 4) !== 'IDP3') throw new Md3Error('Invalid MD3 surface identifier', offset);
    const numFrames = checkedCount(reader.i32(offset + 72), MAX_FRAMES, 'surface frame', offset + 72);
    const shaderCount = checkedCount(reader.i32(offset + 76), 4096, 'shader', offset + 76);
    const vertexCount = checkedCount(reader.i32(offset + 80), MAX_VERTICES, 'vertex', offset + 80);
    const triangleCount = checkedCount(reader.i32(offset + 84), MAX_TRIANGLES, 'triangle', offset + 84);
    if (numFrames !== frameCount) throw new Md3Error('Surface frame count does not match model', offset + 72);
    const trianglesOffset = offset + reader.i32(offset + 88);
    const shadersOffset = offset + reader.i32(offset + 92);
    const uvsOffset = offset + reader.i32(offset + 96);
    const verticesOffset = offset + reader.i32(offset + 100);
    const surfaceEnd = reader.i32(offset + 104);
    if (surfaceEnd < 108) throw new Md3Error('Invalid MD3 surface extent', offset + 104);
    reader.check(offset, surfaceEnd, 'MD3 surface');
    reader.check(trianglesOffset, triangleCount * 12, 'MD3 triangles');
    reader.check(shadersOffset, shaderCount * 68, 'MD3 shaders');
    reader.check(uvsOffset, vertexCount * 8, 'MD3 UVs');
    reader.check(verticesOffset, frameCount * vertexCount * 8, 'MD3 vertices');

    const triangles: Array<[number, number, number]> = [];
    for (let i = 0; i < triangleCount; i++) {
      const triangleOffset = trianglesOffset + i * 12;
      const triangle: [number, number, number] = [reader.i32(triangleOffset), reader.i32(triangleOffset + 4), reader.i32(triangleOffset + 8)];
      if (triangle.some(index => index < 0 || index >= vertexCount)) throw new Md3Error('Triangle vertex index is out of range', triangleOffset);
      triangles.push(triangle);
    }
    const shaders = Array.from({ length: shaderCount }, (_, i) => reader.string(shadersOffset + i * 68, 64));
    const uvs = Array.from({ length: vertexCount }, (_, i): [number, number] => [reader.f32(uvsOffset + i * 8), reader.f32(uvsOffset + i * 8 + 4)]);
    const vertexFrames: Md3Vertex[][] = [];
    for (let frame = 0; frame < frameCount; frame++) {
      const vertices: Md3Vertex[] = [];
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const vertexOffset = verticesOffset + (frame * vertexCount + vertex) * 8;
        vertices.push({
          position: [reader.i16(vertexOffset) / 64, reader.i16(vertexOffset + 2) / 64, reader.i16(vertexOffset + 4) / 64],
          normal: decodedNormal(reader.u16(vertexOffset + 6)),
        });
      }
      vertexFrames.push(vertices);
    }
    surfaces.push({ name: reader.string(offset + 4, 64), shaders, triangles, uvs, frames: vertexFrames });
    offset += surfaceEnd;
  }
  if (offset > endOffset) throw new Md3Error('Surfaces extend beyond the MD3 file', offset);
  return { name: reader.string(8, 64), frames, tags, surfaces };
}
