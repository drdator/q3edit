export function decodeTGA(data: Uint8Array): { width: number; height: number; pixels: Uint8Array } | null {
  if (data.length < 18) return null;

  const idLength = data[0];
  const imageType = data[2];
  const width = data[12] | (data[13] << 8);
  const height = data[14] | (data[15] << 8);
  const pixelSize = data[16];
  const descriptor = data[17];

  if (width === 0 || height === 0) return null;

  const bytesPerPixel = pixelSize >> 3;
  const topToBottom = (descriptor & 0x20) !== 0;

  const pixels = new Uint8Array(width * height * 4);
  let offset = 18 + idLength;

  if (imageType === 2) {
    for (let y = 0; y < height; y++) {
      const row = topToBottom ? y : height - 1 - y;
      for (let x = 0; x < width; x++) {
        const dst = (row * width + x) * 4;
        if (bytesPerPixel >= 3) {
          pixels[dst + 0] = data[offset + 2];
          pixels[dst + 1] = data[offset + 1];
          pixels[dst + 2] = data[offset + 0];
          pixels[dst + 3] = bytesPerPixel === 4 ? data[offset + 3] : 255;
        }
        offset += bytesPerPixel;
      }
    }
  } else if (imageType === 10) {
    let x = 0, y = 0;
    while (y < height) {
      const packet = data[offset++];
      const count = (packet & 0x7f) + 1;
      const isRle = (packet & 0x80) !== 0;
      let r = 0, g = 0, b = 0, a = 255;
      if (isRle) {
        b = data[offset++]; g = data[offset++]; r = data[offset++];
        if (bytesPerPixel === 4) a = data[offset++];
      }
      for (let i = 0; i < count; i++) {
        if (!isRle) {
          b = data[offset++]; g = data[offset++]; r = data[offset++];
          if (bytesPerPixel === 4) a = data[offset++];
        }
        const row = topToBottom ? y : height - 1 - y;
        const dst = (row * width + x) * 4;
        pixels[dst] = r; pixels[dst + 1] = g; pixels[dst + 2] = b; pixels[dst + 3] = a;
        x++;
        if (x >= width) { x = 0; y++; }
      }
    }
  } else if (imageType === 3) {
    for (let y = 0; y < height; y++) {
      const row = topToBottom ? y : height - 1 - y;
      for (let x = 0; x < width; x++) {
        const dst = (row * width + x) * 4;
        const v = data[offset++];
        pixels[dst] = v; pixels[dst + 1] = v; pixels[dst + 2] = v; pixels[dst + 3] = 255;
      }
    }
  } else {
    return null;
  }

  return { width, height, pixels };
}
