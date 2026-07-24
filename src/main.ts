import './style.css';
import { Editor } from './editor';
import { Viewport2D } from './viewport2d';
import { Viewport3D } from './viewport3d';
import { UI } from './ui';
import { indexPakArchives, loadPakManifest, type PakArchive, type PakProgressCallback } from './pak';
import { AssetIndex } from './asset-index';
import { loadEntityClassRegistry, setEntityClassRegistry } from './entity-definitions';
import { ModelManager } from './model-manager';
import {
  loadOpenArenaEnabled,
  loadStoredPaks,
  preparePakFiles,
  replaceStoredAssetConfiguration,
} from './pak-storage';
import { TextureManager } from './textures';
import { saveProjectConfiguration, type ProjectConfiguration } from './project-config';
import { configuredBridgeUrl } from './live-bridge/configuration';
import { openUnreadReleaseNotesDialog } from './release-notes-dialog';
import { DocumentRecoveryService } from './document-recovery';
import { currentEditorSessionId } from './editor-session';
import { installDialogEscapeDismissal } from './dialog-dismissal';
import { startupDialogsEnabled } from './startup-options';

let loadingEl: HTMLDivElement;
const OPENARENA_NOTICE_DISMISSED_KEY = 'q3edit.openarenaNotice.dismissed';

function isOpenArenaNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(OPENARENA_NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissOpenArenaNotice(): void {
  try {
    localStorage.setItem(OPENARENA_NOTICE_DISMISSED_KEY, '1');
  } catch {
    // The notice can still be closed when browser storage is unavailable.
  }
}

function setLoadingStatus(msg: string) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
  console.log(msg);
}

// ── Bootstrap ──

async function init() {
  const showStartupDialogs = startupDialogsEnabled(window.location.search);
  installDialogEscapeDismissal();
  const editor = new Editor();
  editor.createDefaultMap();
  const recovery = new DocumentRecoveryService(editor, currentEditorSessionId());
  setLoadingStatus('Checking for recovered work...');
  const recoveredDocument = await recovery.restore();
  if (recoveredDocument) {
    editor.activityHistory.record({
      source: 'system',
      status: 'success',
      category: 'system',
      title: 'Recovered browser session',
      summary: editor.hasUnsavedChanges
        ? `Restored unsaved changes to ${editor.fileName}`
        : `Restored ${editor.fileName}`,
      revisionBefore: editor.documentRevision,
      revisionAfter: editor.documentRevision,
      undoable: false,
    });
  }
  recovery.start();
  window.addEventListener('beforeunload', event => {
    if (!editor.hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Get canvases
  const xyCanvas = document.querySelector('#vp-xy canvas') as HTMLCanvasElement;
  const xzCanvas = document.querySelector('#vp-xz canvas') as HTMLCanvasElement;
  const yzCanvas = document.querySelector('#vp-yz canvas') as HTMLCanvasElement;
  const tdCanvas = document.querySelector('#vp-3d canvas') as HTMLCanvasElement;

  // Create viewports
  const vpXY = new Viewport2D(xyCanvas, editor, 'xy');
  const vpXZ = new Viewport2D(xzCanvas, editor, 'xz');
  const vpYZ = new Viewport2D(yzCanvas, editor, 'yz');
  const vp3D = new Viewport3D(tdCanvas, editor);

  // Create UI
  const ui = new UI(editor);
  if (recoveredDocument) {
    editor.statusMessage = editor.hasUnsavedChanges
      ? `Recovered unsaved changes to ${editor.fileName}`
      : `Restored ${editor.fileName}`;
  }
  const initialBridgeUrl = configuredBridgeUrl();
  const bridgeControls = {
      setCamera: (position, yaw, pitch) => vp3D.setCamera(position, yaw, pitch),
      frameBounds: bounds => {
        vp3D.frameBounds(bounds);
        vpXY.frameBounds(bounds);
        vpXZ.frameBounds(bounds);
        vpYZ.frameBounds(bounds);
      },
      captureScreenshot: options => {
        const mode = options.mode ?? 'perspective';
        if (mode === 'top') return vpXY.capturePng(options.width, options.height, options.layoutOverlay);
        if (mode === 'front') return vpXZ.capturePng(options.width, options.height, options.layoutOverlay);
        if (mode === 'side') return vpYZ.capturePng(options.width, options.height, options.layoutOverlay);
        return vp3D.capturePng(options.width, options.height, options.xray);
      },
      recordMcpActivity: entry => ui.recordMcpActivity(entry),
      launchBspPreview: (mapName, bsp, aas, noclip) => ui.openBspPreview(mapName, bsp, aas, noclip),
      gameStatus: () => ui.getGamePreviewStatus(),
      waitForGameReady: timeoutMs => ui.waitForGamePreview(timeoutMs),
      gameCommand: command => ui.runGamePreviewCommand(command),
      setGameView: (position, yaw) => ui.setGamePreviewView(position, yaw),
      captureBspPreview: () => ui.captureBspPreview(),
  } satisfies import('./live-bridge/client').LiveBridgeEditorControls;
  let liveBridge: import('./live-bridge/client').LiveMapBridge | null = null;
  const connectMcp = async (url: string): Promise<void> => {
    liveBridge?.disconnect();
    const { connectLiveBridge } = await import('./live-bridge/client');
    liveBridge = connectLiveBridge(editor, bridgeControls, url);
    ui.setMcpConnectionUrl(url);
  };
  const disconnectMcp = (): void => {
    liveBridge?.disconnect();
    liveBridge = null;
    ui.setMcpConnectionUrl(null);
  };
  ui.configureMcpConnection(connectMcp, disconnectMcp, initialBridgeUrl);
  if (initialBridgeUrl) await connectMcp(initialBridgeUrl);

  let defaultArchives: PakArchive[] = [];
  let defaultPakLoaded = false;
  let openArenaEnabled = true;
  let activeTextureManager: TextureManager | null = null;

  const describeAssetStack = (names: string[], useOpenArena: boolean): string => {
    if (useOpenArena) {
      return names.length > 0
        ? `OpenArena + ${names.length} imported PK3 file${names.length === 1 ? '' : 's'}`
        : 'OpenArena default assets';
    }
    return names.length > 0
      ? `${names.length} imported PK3 file${names.length === 1 ? '' : 's'} · OpenArena disabled`
      : 'No texture assets enabled';
  };

  const ensureDefaultPakLoaded = async (
    onProgress: PakProgressCallback = setLoadingStatus,
  ): Promise<void> => {
    if (defaultPakLoaded) return;
    onProgress('Loading OpenArena assets...');
    const defaults = await loadPakManifest('/openarena/manifest.json', onProgress, {
      label: 'OpenArena 0.8.8 default textures',
      archives: ['pak0.pk3', 'pak4-textures.pk3'],
      license: 'COPYING',
      source: 'OPENARENA.md',
    });
    defaultArchives = defaults.archives;
    defaultPakLoaded = true;
  };

  const installTextureManager = (assets: AssetIndex): TextureManager => {
    const entityRegistry = loadEntityClassRegistry(assets, editor.projectConfiguration.entityDefinitions.sources);
    setEntityClassRegistry(entityRegistry);
    editor.modelManager = new ModelManager(assets);
    ui.updateEntityDefinitions();
    if (entityRegistry.diagnostics.length > 0) {
      console.warn('Entity definition diagnostics:', entityRegistry.diagnostics);
    }
    activeTextureManager?.dispose();
    const texMgr = new TextureManager(vp3D.gl, assets);

    // Create solid-color textures for entity category markers
    const registerColorTex = (name: string, r: number, g: number, b: number) => {
      const pixels = new Uint8Array([r, g, b, 255]);
      const tex = vp3D.gl.createTexture()!;
      vp3D.gl.bindTexture(vp3D.gl.TEXTURE_2D, tex);
      vp3D.gl.texImage2D(vp3D.gl.TEXTURE_2D, 0, vp3D.gl.RGBA, 1, 1, 0,
        vp3D.gl.RGBA, vp3D.gl.UNSIGNED_BYTE, pixels);
      texMgr.registerTexture(name, tex, 1, 1);
    };
    registerColorTex('__entity_green', 40, 180, 40);
    registerColorTex('__entity_#44cc44', 68, 204, 68);
    registerColorTex('__entity_#ffcc00', 255, 204, 0);
    registerColorTex('__entity_#ff6644', 255, 102, 68);
    registerColorTex('__entity_#cc8844', 204, 136, 68);
    registerColorTex('__entity_#44bbff', 68, 187, 255);
    registerColorTex('__entity_#cc44ff', 204, 68, 255);
    registerColorTex('__entity_#888888', 136, 136, 136);

    texMgr.onTextureLoaded = () => { editor.redrawRequested = true; };
    editor.textureManager = texMgr;
    activeTextureManager = texMgr;
    ui.updateTextureBrowser(texMgr);
    editor.redrawRequested = true;
    return texMgr;
  };

  const rebuildWithStoredPaks = async (): Promise<string[]> => {
    const allStored = await loadStoredPaks();
    const configured = editor.projectConfiguration.assets;
    const stored = configured.configured
      ? configured.archives.map(name => allStored.find(pak => pak.name.toLowerCase() === name.toLowerCase())).filter((pak): pak is PakArchive => pak !== undefined)
      : allStored;
    if (openArenaEnabled) await ensureDefaultPakLoaded();
    const archives = [...(openArenaEnabled ? defaultArchives : []), ...stored];
    installTextureManager(await indexPakArchives(archives, setLoadingStatus));
    return stored.map(pak => pak.name);
  };

  ui.onProjectConfigurationChanged = async (project: ProjectConfiguration) => {
    openArenaEnabled = project.assets.configured ? project.assets.openArenaEnabled : await loadOpenArenaEnabled();
    const names = await rebuildWithStoredPaks();
    const description = describeAssetStack(names, openArenaEnabled);
    ui.setTextureAssetStatus(description, names);
    editor.statusMessage = `Using ${description}`;
  };

  ui.onManagePakFiles = async () => {
    let assetLoading: ReturnType<UI['showAssetLoading']> | null = null;
    try {
      const stored = await loadStoredPaks();
      const result = await ui.openPakManager(stored.map(pak => ({
        name: pak.name,
        size: pak.data.byteLength,
      })), openArenaEnabled);
      if (!result) return;

      assetLoading = ui.showAssetLoading('Preparing PK3 file changes...');
      await assetLoading.ready;
      const reportProgress: PakProgressCallback = (message, completed, total) => {
        setLoadingStatus(message);
        assetLoading?.update(message, completed, total);
      };

      ui.setTextureAssetStatus('Applying PK3 file changes...');
      reportProgress('Applying PK3 file changes...');

      const existingByName = new Map(stored.map(pak => [pak.name.toLowerCase(), pak]));
      const newFiles = result.entries.filter(entry => entry.file).map(entry => entry.file!);
      const prepared = await preparePakFiles(newFiles, reportProgress);
      const preparedByName = new Map(prepared.map(pak => [pak.name.toLowerCase(), pak]));
      const ordered = result.entries.map(entry => {
        const key = entry.name.toLowerCase();
        const archive = preparedByName.get(key) ?? existingByName.get(key);
        if (!archive) throw new Error(`${entry.name} is no longer available`);
        return archive;
      });

      // Build and validate the complete stack before changing persistent
      // storage, then install the already-extracted result without a second pass.
      if (result.openArenaEnabled) await ensureDefaultPakLoaded(reportProgress);
      const archives = [...(result.openArenaEnabled ? defaultArchives : []), ...ordered];
      const assets = await indexPakArchives(archives, reportProgress);
      reportProgress('Saving asset configuration...');
      await replaceStoredAssetConfiguration(ordered, result.openArenaEnabled);
      openArenaEnabled = result.openArenaEnabled;
      editor.projectConfiguration.assets = {
        ...editor.projectConfiguration.assets,
        archives: ordered.map(pak => pak.name),
        openArenaEnabled,
        configured: true,
      };
      saveProjectConfiguration(editor.projectConfiguration);
      assetLoading.update('Updating textures in the 3D view...', 1, 1);
      const installedTextureManager = installTextureManager(assets);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      assetLoading.update('Decoding visible textures...', 1, 1);
      await installedTextureManager.waitForIdle();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const names = ordered.map(pak => pak.name);
      const description = describeAssetStack(names, openArenaEnabled);
      ui.setTextureAssetStatus(description, names);
      editor.statusMessage = `Using ${description}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to update PK3 files:', error);
      const names = (await loadStoredPaks()).map(pak => pak.name);
      ui.setTextureAssetStatus(`Could not update PK3 files: ${message}`, names);
      editor.statusMessage = `Could not update PK3 files: ${message}`;
    } finally {
      assetLoading?.close();
    }
  };

  // Start render loop immediately (untextured)
  function frame(time: number): void {
    vp3D.render(time);
    vpXY.render();
    vpXZ.render();
    vpYZ.render();
    ui.update();
    editor.redrawRequested = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Load the persisted asset stack. OpenArena is fetched only when enabled.
  let showOpenArenaNotice = false;
  setLoadingStatus('Loading texture asset settings...');
  try {
    openArenaEnabled = editor.projectConfiguration.assets.configured
      ? editor.projectConfiguration.assets.openArenaEnabled
      : await loadOpenArenaEnabled();
    const names = await rebuildWithStoredPaks();
    ui.setTextureAssetStatus(describeAssetStack(names, openArenaEnabled), names);
    showOpenArenaNotice = showStartupDialogs
      && openArenaEnabled
      && names.length === 0
      && !isOpenArenaNoticeDismissed();
    setLoadingStatus('Ready');
  } catch (err) {
    console.warn('Failed to load texture assets:', err);
    const message = err instanceof Error ? err.message : String(err);
    ui.setTextureAssetStatus(`Running without textures: ${message}`);
    setLoadingStatus('Running without textures (asset files not found)');
  }

  // Hide loading screen
  setTimeout(() => {
    loadingEl.style.opacity = '0';
    setTimeout(async () => {
      loadingEl.remove();
      document.documentElement.dataset.editorReady = 'true';
      if (showOpenArenaNotice) {
        const dismissPermanently = await ui.showOpenArenaNotice();
        if (dismissPermanently) dismissOpenArenaNotice();
      }
      if (showStartupDialogs) openUnreadReleaseNotesDialog();
    }, 500);
  }, 500);
}

function startEditor(): void {
  document.documentElement.dataset.editorReady = 'false';
  document.documentElement.classList.remove('landing-active');
  document.body.classList.remove('landing-active');
  document.getElementById('landing')?.remove();
  document.title = 'Q3Edit — Editor';

  loadingEl = document.createElement('div');
  loadingEl.id = 'loading-screen';
  loadingEl.innerHTML = `
    <div class="loading-content">
      <div class="loading-title">Q3EDIT</div>
      <div class="loading-status" id="loading-status">Initializing...</div>
      <div class="loading-bar"><div class="loading-fill" id="loading-fill"></div></div>
    </div>
  `;
  document.body.appendChild(loadingEl);
  void init();
}

if (new URLSearchParams(window.location.search).has('editor')) {
  startEditor();
}
