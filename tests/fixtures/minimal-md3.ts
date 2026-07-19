function writeString(bytes: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = new TextEncoder().encode(value);
  bytes.set(encoded.subarray(0, length), offset);
}

export function createMinimalMd3(): Uint8Array {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  const i32 = (offset: number, value: number) => view.setInt32(offset, value, true);
  const i16 = (offset: number, value: number) => view.setInt16(offset, value, true);
  const f32 = (offset: number, value: number) => view.setFloat32(offset, value, true);
  writeString(bytes, 0, 4, 'IDP3');
  i32(4, 15); writeString(bytes, 8, 64, 'minimal');
  i32(76, 1); i32(80, 1); i32(84, 1); i32(88, 0);
  i32(92, 108); i32(96, 164); i32(100, 276); i32(104, 512);
  [-1, -1, -1, 1, 1, 1, 0, 0, 0].forEach((value, index) => f32(108 + index * 4, value));
  f32(144, Math.sqrt(3)); writeString(bytes, 148, 16, 'frame0');
  writeString(bytes, 164, 64, 'tag_weapon');
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, index) => f32(228 + index * 4, value));

  const surface = 276;
  writeString(bytes, surface, 4, 'IDP3'); writeString(bytes, surface + 4, 64, 'body');
  i32(surface + 72, 1); i32(surface + 76, 1); i32(surface + 80, 3); i32(surface + 84, 1);
  i32(surface + 88, 108); i32(surface + 92, 120); i32(surface + 96, 188); i32(surface + 100, 212); i32(surface + 104, 236);
  i32(surface + 108, 0); i32(surface + 112, 1); i32(surface + 116, 2);
  writeString(bytes, surface + 120, 64, 'textures/models/default');
  [[0, 0], [1, 0], [0, 1]].forEach((uv, index) => { f32(surface + 188 + index * 8, uv[0]); f32(surface + 192 + index * 8, uv[1]); });
  [[0, 0, 0], [64, 0, 0], [0, 64, 0]].forEach((position, index) => {
    const offset = surface + 212 + index * 8;
    i16(offset, position[0]); i16(offset + 2, position[1]); i16(offset + 4, position[2]);
    view.setUint16(offset + 6, 0, true);
  });
  return bytes;
}
