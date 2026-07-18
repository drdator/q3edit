import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'q3map-compiler/dist');
const destinationDirectory = resolve(projectRoot, 'dist/q3map-compiler/dist');
const artifacts = ['q3map.js', 'q3map.wasm'];

for (const artifact of artifacts) {
  const source = resolve(sourceDirectory, artifact);

  try {
    await access(source);
  } catch {
    throw new Error(`Missing ${source}. Run "npm run build:q3map" first.`);
  }
}

await mkdir(destinationDirectory, { recursive: true });

await Promise.all(
  artifacts.map((artifact) =>
    copyFile(
      resolve(sourceDirectory, artifact),
      resolve(destinationDirectory, artifact),
    ),
  ),
);

console.log(`Staged q3map.js and q3map.wasm in ${destinationDirectory}`);
