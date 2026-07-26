/**
 * WASM wrapper for the q3map BSP compiler.
 * Compilation runs in a Web Worker to keep the UI responsive.
 */

import type { Entity } from './entity';
import type { ModelManager } from './model-manager';

export interface CompileOptions {
  /** Additional q3map BSP flags, e.g. ['-v', '-nowater'] */
  args?: string[]
  /** Run -light pass after BSP compilation (default: true) */
  light?: boolean
  /** Additional -light flags, e.g. ['-extra', '-bounce', '8'] */
  lightArgs?: string[]
  /** Run -vis pass after BSP compilation (default: true) */
  vis?: boolean
  /** Additional -vis flags, e.g. ['-fast'] */
  visArgs?: string[]
  /** Generate Quake III bot navigation data after compilation (default: true) */
  aas?: boolean
  /** Shader file contents keyed by path */
  shaderFiles?: Record<string, string>
  /** Raw game assets required during compilation, keyed by pak path */
  assetFiles?: Map<string, Uint8Array>
  /** Callback for compiler output lines */
  onOutput?: (line: string) => void
  /** Cancels the worker and resolves with a cancelled result. */
  signal?: AbortSignal
  /** Reuse the previous successful artifact when every compile input is identical. */
  reuseUnchanged?: boolean
}

export interface CompileStageResult {
  stage: 'bsp' | 'vis' | 'light' | 'aas'
  status: 'success' | 'failed' | 'skipped' | 'reused'
  durationMs: number
}

export interface CompileResult {
  success: boolean
  cancelled: boolean
  reused: boolean
  bsp: Uint8Array | null
  aas: Uint8Array | null
  portalFileText: string | null
  pointfileText: string | null
  output: string[]
  stages: CompileStageResult[]
}

let lastSuccessfulCompile: { key: string; result: CompileResult } | null = null
let lastBspStage: {
  key: string
  bsp: Uint8Array
  prt: Uint8Array | null
  pointfileText: string | null
} | null = null

function hashBytes(hash: number, bytes: Uint8Array): number {
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
  return hash >>> 0
}

function compileKey(mapText: string, options: CompileOptions): string {
  let hash = hashBytes(2166136261, new TextEncoder().encode(mapText))
  const configuration = JSON.stringify({
    args: options.args ?? [],
    light: options.light !== false,
    lightArgs: options.lightArgs ?? [],
    vis: options.vis !== false,
    visArgs: options.visArgs ?? [],
    aas: options.aas !== false,
    shaderFiles: options.shaderFiles ?? {},
  })
  hash = hashBytes(hash, new TextEncoder().encode(configuration))
  for (const [path, bytes] of [...(options.assetFiles?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
    hash = hashBytes(hash, new TextEncoder().encode(path))
    hash = hashBytes(hash, bytes)
  }
  return hash.toString(16).padStart(8, '0')
}

function bspStageKey(mapText: string, options: CompileOptions): string {
  let hash = hashBytes(2166136261, new TextEncoder().encode(mapText))
  hash = hashBytes(hash, new TextEncoder().encode(JSON.stringify({
    args: options.args ?? [],
    shaderFiles: options.shaderFiles ?? {},
  })))
  for (const [path, bytes] of [...(options.assetFiles?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
    hash = hashBytes(hash, new TextEncoder().encode(path))
    hash = hashBytes(hash, bytes)
  }
  return hash.toString(16).padStart(8, '0')
}

function parseStages(output: readonly string[]): CompileStageResult[] {
  const starts = new Map<number, CompileStageResult['stage']>()
  const stages: CompileStageResult[] = []
  for (const line of output) {
    const start = /^=== Stage (\d+): (BSP|Vis|Light|Bot navigation) ===$/i.exec(line.trim())
    if (start) {
      starts.set(Number(start[1]), start[2].toLowerCase() === 'bot navigation'
        ? 'aas'
        : start[2].toLowerCase() as CompileStageResult['stage'])
      continue
    }
    const result = /^=== Stage (\d+) result: (success|failed|skipped|reused)(?: \((\d+) ms\))? ===$/i.exec(line.trim())
    if (!result) continue
    const stage = starts.get(Number(result[1]))
    if (stage) stages.push({
      stage,
      status: result[2].toLowerCase() as CompileStageResult['status'],
      durationMs: Number(result[3] ?? 0),
    })
  }
  return stages
}

/** Collect MD3 and skin files that q3map must bake into misc_model draw surfaces. */
export function collectCompileModelFiles(
  entities: readonly Entity[],
  modelManager: ModelManager | null,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  if (!modelManager) return files;
  for (const entity of entities) {
    if (entity.classname !== 'misc_model') continue;
    const resolved = modelManager.resolveEntity(entity);
    if (!resolved) continue;
    const file = modelManager.getModelFile(resolved.path);
    if (file) files.set(file[0], file[1]);
    if (resolved.skinPath) {
      const skin = modelManager.getSkinFile(resolved.skinPath);
      if (skin) files.set(skin[0], skin[1]);
    }
  }
  return files;
}

/**
 * Compile a .map file to .bsp using the q3map WASM module in a Web Worker.
 */
export function compileMap(
  mapText: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const key = compileKey(mapText, options)
  const bspKey = bspStageKey(mapText, options)
  if (options.reuseUnchanged !== false && lastSuccessfulCompile?.key === key) {
    const result = lastSuccessfulCompile.result
    options.onOutput?.('Reused unchanged compile artifacts')
    return Promise.resolve({ ...result, reused: true, output: [...result.output, 'Reused unchanged compile artifacts'] })
  }
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL('./q3map-worker.ts', import.meta.url),
      { type: 'module' }
    )

    const output: string[] = []
    let settled = false
    const finish = (result: CompileResult) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      if (result.success && result.bsp && !result.cancelled) {
        lastSuccessfulCompile = { key, result: { ...result, reused: false } }
      }
      resolve(result)
    }
    const abort = () => {
      worker.terminate()
      output.push('Compilation cancelled')
      finish({
        success: false, cancelled: true, reused: false, bsp: null, aas: null,
        portalFileText: null, pointfileText: null, output, stages: parseStages(output),
      })
    }
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'output') {
        output.push(e.data.line)
        options.onOutput?.(e.data.line)
      } else if (e.data.type === 'done') {
        worker.terminate()
        if (e.data.bspStage && e.data.success) {
          lastBspStage = {
            key: bspKey,
            bsp: e.data.bspStage,
            prt: e.data.prtData ?? null,
            pointfileText: e.data.pointfileText ?? null,
          }
        }
        finish({
          success: e.data.success,
          cancelled: false,
          reused: false,
          bsp: e.data.bsp,
          aas: e.data.aas ?? null,
          portalFileText: e.data.portalFileText ?? null,
          pointfileText: e.data.pointfileText ?? null,
          output,
          stages: parseStages(output),
        })
      }
    }

    worker.onerror = (e) => {
      output.push(`Worker error: ${e.message}`)
      worker.terminate()
      finish({
        success: false, cancelled: false, reused: false, bsp: null, aas: null,
        portalFileText: null, pointfileText: null, output, stages: parseStages(output),
      })
    }

    // Convert Map to array of tuples for structured clone transfer
    const assetFiles = options.assetFiles
      ? Array.from(options.assetFiles.entries())
      : undefined

    worker.postMessage({
      mapText,
      options: {
        args: options.args,
        light: options.light,
        lightArgs: options.lightArgs,
        vis: options.vis,
        visArgs: options.visArgs,
        aas: options.aas,
        shaderFiles: options.shaderFiles,
        assetFiles,
        reuseBsp: options.reuseUnchanged !== false && lastBspStage?.key === bspKey
          ? lastBspStage.bsp
          : undefined,
        reusePrt: options.reuseUnchanged !== false && lastBspStage?.key === bspKey
          ? lastBspStage.prt
          : undefined,
        reusePointfileText: options.reuseUnchanged !== false && lastBspStage?.key === bspKey
          ? lastBspStage.pointfileText
          : undefined,
      },
    })
  })
}
