/**
 * Web Worker for q3map BSP compilation.
 * Runs the WASM compiler off the main thread so the UI stays responsive.
 */

interface Q3MapModule {
  FS: {
    mkdir(path: string): void
    writeFile(path: string, data: string | Uint8Array): void
    readFile(path: string, opts?: { encoding?: string }): Uint8Array
    stat(path: string): any
  }
  callMain(args: string[]): number
}

type CreateQ3Map = (opts?: Record<string, unknown>) => Promise<Q3MapModule>
type CreateBspc = (opts?: Record<string, unknown>) => Promise<Q3MapModule>

let q3mapScriptLoaded = false
let bspcScriptLoaded = false

async function createModule(onOutput: (text: string) => void): Promise<Q3MapModule> {
  if (!q3mapScriptLoaded) {
    // Fetch and eval the Emscripten glue (importScripts doesn't work in module workers)
    const resp = await fetch('/q3map-compiler/dist/q3map.js?v=' + Date.now())
    if (!resp.ok) throw new Error(`Could not load q3map.js (${resp.status})`)
    const code = await resp.text()
    // eslint-disable-next-line no-eval
    ;(0, eval)(code)
    q3mapScriptLoaded = true
  }
  const createQ3Map: CreateQ3Map = (self as any).createQ3Map

  return createQ3Map({
    noInitialRun: true,
    print: (text: string) => { onOutput(text) },
    printErr: (text: string) => { onOutput(text) },
    locateFile: (path: string) => `/q3map-compiler/dist/${path}?v=${Date.now()}`,
  })
}

async function createBspcModule(onOutput: (text: string) => void): Promise<Q3MapModule> {
  if (!bspcScriptLoaded) {
    const resp = await fetch('/bspc-compiler/dist/bspc.js?v=' + Date.now())
    if (!resp.ok) throw new Error(`Could not load bspc.js (${resp.status})`)
    const code = await resp.text()
    // eslint-disable-next-line no-eval
    ;(0, eval)(code)
    bspcScriptLoaded = true
  }
  const createBspc: CreateBspc = (self as any).createBspc

  return createBspc({
    noInitialRun: true,
    print: (text: string) => { onOutput(text) },
    printErr: (text: string) => { onOutput(text) },
    locateFile: (path: string) => `/bspc-compiler/dist/${path}?v=${Date.now()}`,
  })
}

function setupFS(
  mod: Q3MapModule,
  mapText: string | null,
  bspData: Uint8Array | null,
  shaderFiles: Record<string, string> | undefined,
  prtData: Uint8Array | null,
  assetFiles: [string, Uint8Array][] | undefined,
) {
  const basePath = '/quake/baseq3'
  const mapDir = `${basePath}/maps`

  tryMkdir(mod, '/quake')
  tryMkdir(mod, basePath)
  tryMkdir(mod, mapDir)
  tryMkdir(mod, `${basePath}/scripts`)

  if (mapText) mod.FS.writeFile(`${mapDir}/compile.map`, mapText)
  if (bspData) mod.FS.writeFile(`${mapDir}/compile.bsp`, bspData)
  if (prtData) mod.FS.writeFile(`${mapDir}/compile.prt`, prtData)

  const shaderNames: string[] = []
  if (shaderFiles) {
    for (const [path, content] of Object.entries(shaderFiles)) {
      const fullPath = `${basePath}/${path}`
      mkdirp(mod, fullPath.substring(0, fullPath.lastIndexOf('/')))
      mod.FS.writeFile(fullPath, content)
      const match = path.match(/scripts\/(.+)\.shader$/)
      if (match) shaderNames.push(match[1])
    }
  }
  mod.FS.writeFile(`${basePath}/scripts/shaderlist.txt`, shaderNames.join('\n') + '\n')

  if (assetFiles) {
    const createdDirs = new Set<string>()
    for (const [path, data] of assetFiles) {
      const fullPath = `${basePath}/${path}`
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (!createdDirs.has(dir)) { mkdirp(mod, dir); createdDirs.add(dir) }
      mod.FS.writeFile(fullPath, data)
    }
  }
}

function runQ3Map(mod: Q3MapModule, args: string[], emit?: (text: string) => void): number {
  try {
    return mod.callMain(args)
  } catch (e: any) {
    // Emscripten exit() throws ExitStatus with a status property
    if (e.status !== undefined) {
      if (e.status !== 0 && emit) emit(`q3map exited with code ${e.status}`)
      return e.status
    }
    // WASM trap or other unexpected error
    if (emit) emit(`WASM exception: ${e.message || e}`)
    return 1
  }
}

function tryMkdir(mod: Q3MapModule, path: string) {
  try { mod.FS.mkdir(path) } catch { /* exists */ }
}

function mkdirp(mod: Q3MapModule, path: string) {
  const parts = path.split('/')
  let current = ''
  for (const part of parts) {
    if (!part) continue
    current += '/' + part
    tryMkdir(mod, current)
  }
}

function readTextFile(mod: Q3MapModule, path: string): string | null {
  try {
    const data = mod.FS.readFile(path);
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

// Message handler
self.onmessage = async (e: MessageEvent) => {
  const { mapText, options } = e.data as {
    mapText: string
    options: {
      args?: string[]
      light?: boolean
      lightArgs?: string[]
      vis?: boolean
      visArgs?: string[]
      aas?: boolean
      shaderFiles?: Record<string, string>
      assetFiles?: [string, Uint8Array][]
    }
  }

  const output: string[] = []
  const emit = (text: string) => {
    output.push(text)
    self.postMessage({ type: 'output', line: text })
  }

  const bspPath = '/quake/baseq3/maps/compile.bsp'
  const mapPath = '/quake/baseq3/maps/compile.map'
  const pointfilePath = '/quake/baseq3/maps/compile.lin'

  try {

    // Stage 1: BSP
    emit('=== Stage 1: BSP ===')
    const bspMod = await createModule(emit)
    setupFS(bspMod, mapText, null, options.shaderFiles, null, options.assetFiles)

    const bspExit = runQ3Map(bspMod, [...(options.args || []), mapPath], emit)

    let bsp: Uint8Array | null = null
    try { bsp = bspMod.FS.readFile(bspPath) } catch { /* */ }
    const pointfileText = readTextFile(bspMod, pointfilePath)

    if (bspExit !== 0 || !bsp) {
      emit('=== Stage 1 result: failed ===')
      self.postMessage({ type: 'done', success: false, bsp: null, aas: null, pointfileText, output })
      return
    }
    emit('=== Stage 1 result: success ===')

    let prt: Uint8Array | null = null
    try { prt = bspMod.FS.readFile('/quake/baseq3/maps/compile.prt') } catch { /* */ }

    // Stage 2: Vis
    if (options.vis !== false && prt) {
      emit('')
      emit('=== Stage 2: Vis ===')
      const visMod = await createModule(emit)
      setupFS(visMod, mapText, bsp, options.shaderFiles, prt, options.assetFiles)

      const visExit = runQ3Map(visMod, ['-vis', ...(options.visArgs || []), bspPath], emit)
      try { bsp = visMod.FS.readFile(bspPath) } catch { /* */ }
      if (visExit !== 0) emit('Warning: vis pass failed, continuing without PVS')
      emit(`=== Stage 2 result: ${visExit === 0 ? 'success' : 'failed'} ===`)
    }

    // Stage 3: Light
    if (options.light !== false) {
      emit('')
      emit('=== Stage 3: Light ===')
      const lightMod = await createModule(emit)
      setupFS(lightMod, mapText, bsp, options.shaderFiles, prt, options.assetFiles)

      const lightExit = runQ3Map(lightMod, ['-light', ...(options.lightArgs || []), bspPath], emit)
      try { bsp = lightMod.FS.readFile(bspPath) } catch { /* */ }
      if (lightExit !== 0) emit('Warning: light pass failed, using unlit BSP')
      emit(`=== Stage 3 result: ${lightExit === 0 ? 'success' : 'failed'} ===`)
    }

    // Stage 4: AAS bot navigation
    let aas: Uint8Array | null = null
    if (options.aas !== false) {
      emit('')
      emit('=== Stage 4: Bot navigation ===')
      try {
        const bspcMod = await createBspcModule(emit)
        setupFS(bspcMod, null, bsp, undefined, null, undefined)
        const aasExit = runQ3Map(bspcMod, ['-bsp2aas', bspPath], emit)
        try { aas = bspcMod.FS.readFile('/quake/baseq3/maps/compile.aas') } catch { /* */ }
        if (aasExit !== 0 || !aas) {
          aas = null
          emit('Warning: bot navigation generation failed; the BSP can still be played without bots')
        }
        emit(`=== Stage 4 result: ${aas ? 'success' : 'failed'} ===`)
      } catch (error) {
        emit(`Warning: bot navigation generation failed: ${error instanceof Error ? error.message : String(error)}`)
        emit('=== Stage 4 result: failed ===')
      }
    }

    self.postMessage({ type: 'done', success: true, bsp, aas, pointfileText, output })
  } catch (error) {
    emit(`Compiler worker error: ${error instanceof Error ? error.message : String(error)}`)
    self.postMessage({ type: 'done', success: false, bsp: null, aas: null, pointfileText: null, output })
  }
}
