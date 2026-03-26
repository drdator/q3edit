/**
 * WASM wrapper for the q3map BSP compiler.
 * Compilation runs in a Web Worker to keep the UI responsive.
 */

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
  /** Shader file contents keyed by path */
  shaderFiles?: Record<string, string>
  /** Raw texture/image files keyed by pak path */
  imageFiles?: Map<string, Uint8Array>
  /** Callback for compiler output lines */
  onOutput?: (line: string) => void
}

export interface CompileResult {
  success: boolean
  bsp: Uint8Array | null
  pointfileText: string | null
  output: string[]
}

/**
 * Compile a .map file to .bsp using the q3map WASM module in a Web Worker.
 */
export function compileMap(
  mapText: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL('./q3map-worker.ts', import.meta.url),
      { type: 'module' }
    )

    const output: string[] = []

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'output') {
        output.push(e.data.line)
        options.onOutput?.(e.data.line)
      } else if (e.data.type === 'done') {
        worker.terminate()
        resolve({
          success: e.data.success,
          bsp: e.data.bsp,
          pointfileText: e.data.pointfileText ?? null,
          output,
        })
      }
    }

    worker.onerror = (e) => {
      output.push(`Worker error: ${e.message}`)
      worker.terminate()
      resolve({ success: false, bsp: null, pointfileText: null, output })
    }

    // Convert Map to array of tuples for structured clone transfer
    const imageFiles = options.imageFiles
      ? Array.from(options.imageFiles.entries())
      : undefined

    worker.postMessage({
      mapText,
      options: {
        args: options.args,
        light: options.light,
        lightArgs: options.lightArgs,
        vis: options.vis,
        visArgs: options.visArgs,
        shaderFiles: options.shaderFiles,
        imageFiles,
      },
    })
  })
}
