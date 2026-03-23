/**
 * WASM wrapper for the q3map BSP compiler.
 *
 * Usage:
 *   const bsp = await compileMap(mapText);
 *   // bsp is a Uint8Array containing the .bsp file
 */

interface Q3MapModule {
  FS: {
    mkdir(path: string): void
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string, opts?: { encoding?: string }): Uint8Array
    unlink(path: string): void
    stat(path: string): any
    readdir(path: string): string[]
  }
  callMain(args: string[]): number
}

type CreateQ3Map = (opts?: Record<string, unknown>) => Promise<Q3MapModule>

let scriptLoaded = false

/**
 * Create a fresh q3map WASM module instance.
 * Each compilation gets a fresh module since q3map uses global state
 * that doesn't reset between runs.
 */
async function createModule(
  onOutput?: (text: string) => void
): Promise<Q3MapModule> {
  // Load the Emscripten JS glue via script tag (it's not an ES module)
  if (!scriptLoaded) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/q3map-compiler/dist/q3map.js?v=' + Date.now()
      script.onload = () => { scriptLoaded = true; resolve() }
      script.onerror = () => reject(new Error('Failed to load q3map.js'))
      document.head.appendChild(script)
    })
  }
  const createQ3Map: CreateQ3Map = (globalThis as any).createQ3Map

  const mod = await createQ3Map({
    noInitialRun: true,
    print: (text: string) => {
      onOutput?.(text)
      console.log('[q3map]', text)
    },
    printErr: (text: string) => {
      onOutput?.(text)
      console.warn('[q3map]', text)
    },
    locateFile: (path: string) => `/q3map-compiler/dist/${path}?v=${Date.now()}`,
  })

  return mod
}

/** Set up the virtual filesystem with directories, map file, and shaders */
function setupFS(
  mod: Q3MapModule,
  mapText: string | null,
  bspData: Uint8Array | null,
  shaderFiles?: Record<string, string>,
  prtData?: Uint8Array | null,
  imageFiles?: Map<string, Uint8Array>,
) {
  const basePath = '/quake/baseq3'
  const mapDir = `${basePath}/maps`

  tryMkdir(mod, '/quake')
  tryMkdir(mod, basePath)
  tryMkdir(mod, mapDir)
  tryMkdir(mod, `${basePath}/scripts`)

  if (mapText) {
    mod.FS.writeFile(`${mapDir}/compile.map`, mapText)
  }
  if (bspData) {
    mod.FS.writeFile(`${mapDir}/compile.bsp`, bspData)
  }
  if (prtData) {
    mod.FS.writeFile(`${mapDir}/compile.prt`, prtData)
  }

  // Write shader files and build shaderlist.txt
  const shaderNames: string[] = []
  if (shaderFiles) {
    for (const [path, content] of Object.entries(shaderFiles)) {
      const fullPath = `${basePath}/${path}`
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      tryMkdir(mod, dir)
      mod.FS.writeFile(fullPath, content)
      const match = path.match(/scripts\/(.+)\.shader$/)
      if (match) shaderNames.push(match[1])
    }
  }
  mod.FS.writeFile(`${basePath}/scripts/shaderlist.txt`, shaderNames.join('\n') + '\n')

  // Write texture image files so q3map can read their dimensions
  if (imageFiles) {
    const createdDirs = new Set<string>()
    for (const [path, data] of imageFiles) {
      const fullPath = `${basePath}/${path}`
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (!createdDirs.has(dir)) {
        mkdirp(mod, dir)
        createdDirs.add(dir)
      }
      mod.FS.writeFile(fullPath, data)
    }
  }
}

/** Run q3map with given args, returns exit code */
function runQ3Map(mod: Q3MapModule, args: string[]): number {
  try {
    return mod.callMain(args)
  } catch (e: any) {
    if (e.status !== undefined) return e.status
    return 1
  }
}

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
  /** Shader file contents keyed by path, e.g. { 'scripts/common.shader': '...' } */
  shaderFiles?: Record<string, string>
  /** Raw texture/image files keyed by pak path, e.g. { 'textures/base_floor/concrete.tga': Uint8Array } */
  imageFiles?: Map<string, Uint8Array>
  /** Callback for compiler output lines */
  onOutput?: (line: string) => void
}

export interface CompileResult {
  success: boolean
  bsp: Uint8Array | null
  output: string[]
}

/**
 * Compile a .map file to .bsp using the q3map WASM module.
 */
export async function compileMap(
  mapText: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const output: string[] = []
  const emit = (text: string) => {
    output.push(text)
    options.onOutput?.(text)
  }

  const bspPath = '/quake/baseq3/maps/compile.bsp'
  const mapPath = '/quake/baseq3/maps/compile.map'

  // Stage 1: BSP compilation
  emit('=== Stage 1: BSP ===')
  const bspMod = await createModule(emit)
  setupFS(bspMod, mapText, null, options.shaderFiles, null, options.imageFiles)

  const bspArgs = [...(options.args || []), mapPath]
  const bspExit = runQ3Map(bspMod, bspArgs)

  let bsp: Uint8Array | null = null
  try {
    bsp = bspMod.FS.readFile(bspPath)
  } catch {
    return { success: false, bsp: null, output }
  }

  if (bspExit !== 0 || !bsp) {
    return { success: false, bsp, output }
  }

  // Grab the .prt file (portal file) — needed by vis stage
  const prtPath = '/quake/baseq3/maps/compile.prt'
  let prt: Uint8Array | null = null
  try {
    prt = bspMod.FS.readFile(prtPath)
  } catch {
    // leaked maps don't generate a .prt
  }

  // Stage 2: Vis (optional) — computes PVS (potentially visible sets)
  if (options.vis !== false) {
    emit('')
    emit('=== Stage 2: Vis ===')
    const visMod = await createModule(emit)
    setupFS(visMod, mapText, bsp, options.shaderFiles, prt, options.imageFiles)

    const visArgs = ['-vis', ...(options.visArgs || []), bspPath]
    const visExit = runQ3Map(visMod, visArgs)

    try {
      bsp = visMod.FS.readFile(bspPath)
    } catch {
      // vis failed, keep BSP without PVS
    }

    if (visExit !== 0) {
      emit('Warning: vis pass failed, continuing without PVS')
    }
  }

  // Stage 3: Light (optional) — computes lightmaps
  if (options.light !== false) {
    emit('')
    emit('=== Stage 3: Light ===')
    const lightMod = await createModule(emit)
    setupFS(lightMod, mapText, bsp, options.shaderFiles, prt, options.imageFiles)

    const lightArgs = ['-light', ...(options.lightArgs || []), bspPath]
    const lightExit = runQ3Map(lightMod, lightArgs)

    try {
      bsp = lightMod.FS.readFile(bspPath)
    } catch {
      // light failed, keep the unlit BSP
    }

    if (lightExit !== 0) {
      emit('Warning: light pass failed, using unlit BSP')
    }
  }

  return {
    success: true,
    bsp,
    output,
  }
}

function tryMkdir(mod: Q3MapModule, path: string) {
  try {
    mod.FS.mkdir(path)
  } catch {
    // already exists
  }
}

/** Recursively create directories */
function mkdirp(mod: Q3MapModule, path: string) {
  const parts = path.split('/')
  let current = ''
  for (const part of parts) {
    if (!part) continue
    current += '/' + part
    tryMkdir(mod, current)
  }
}
