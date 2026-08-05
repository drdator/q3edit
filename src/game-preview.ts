import { zipSync } from 'fflate';

/**
 * Give loose Quick Play builds a content-addressed name so an older BSP with
 * the document's filename in an enabled PK3 cannot win Quake's search lookup.
 */
export function quickPlayRuntimeMapName(mapName: string, bsp: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bsp) hash = Math.imul(hash ^ byte, 16777619);

  const safeBase = mapName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 38) || 'compile';
  const fingerprint = (hash >>> 0).toString(16).padStart(8, '0');
  return `${safeBase}_q3e_${fingerprint}`;
}

/** Package the current compile as the highest-priority archive in the preview filesystem. */
export function createQuickPlayPk3(
  runtimeMapName: string,
  bsp: Uint8Array,
  aas: Uint8Array | null,
): Uint8Array {
  return zipSync({
    [`maps/${runtimeMapName}.bsp`]: bsp,
    ...(aas ? { [`maps/${runtimeMapName}.aas`]: aas } : {}),
  }, { level: 0 });
}
