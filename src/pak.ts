import { unzipSync } from 'fflate';

export type PakFiles = Map<string, Uint8Array>;

export async function loadPak(url: string, onProgress?: (msg: string) => void): Promise<PakFiles> {
  onProgress?.(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(1);
  onProgress?.(`Extracting ${url} (${sizeMB} MB)...`);

  const data = new Uint8Array(arrayBuffer);
  const files = unzipSync(data);

  const pak: PakFiles = new Map();
  for (const [path, content] of Object.entries(files)) {
    pak.set(path.toLowerCase(), content);
  }

  onProgress?.(`Extracted ${pak.size} files from ${url}`);
  return pak;
}

export async function loadAllPaks(dir: string, onProgress?: (msg: string) => void): Promise<PakFiles> {
  const merged: PakFiles = new Map();

  for (let i = 0; i <= 8; i++) {
    const url = `${dir}/pak${i}.pk3`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) continue;

      const pak = await loadPak(url, onProgress);
      for (const [path, content] of pak) {
        merged.set(path, content);
      }
    } catch {
      // Skip missing paks
    }
  }

  onProgress?.(`Total: ${merged.size} files loaded`);
  return merged;
}
