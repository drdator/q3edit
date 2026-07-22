import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(projectRoot, 'bspc-compiler/dist');
const destinationDirectory = resolve(projectRoot, 'dist/bspc-compiler/dist');
const artifacts = ['bspc.js', 'bspc.wasm'];

for (const artifact of artifacts) {
  const source = resolve(sourceDirectory, artifact);

  try {
    await access(source);
  } catch {
    throw new Error(`Missing ${source}. Run "npm run build:bspc" first.`);
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

console.log(`Staged bspc.js and bspc.wasm in ${destinationDirectory}`);
