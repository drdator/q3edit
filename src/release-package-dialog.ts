import { buildSourceFingerprint, type BuildHistoryService, type BuildRecord } from './build-history';
import type { Editor } from './editor';
import {
  buildReleasePackage,
  scanProjectAssets,
  type ArenaMetadata,
  type ProjectAssetManifest,
  type ReleasePackageResult,
} from './release-package';
import type { TextureManager } from './textures';

const RELEASE_METADATA_KEY = '_q3edit_release';

interface CaptureResult {
  mimeType: string;
  data: string;
  width: number;
  height: number;
}

export interface ReleasePackageDialogOptions {
  editor: Editor;
  textureManager: TextureManager;
  buildHistory: BuildHistoryService;
  captureLevelshot: () => CaptureResult;
  playPackage: (mapName: string, bsp: Uint8Array, aas: Uint8Array | null, pk3: Uint8Array) => void;
}

interface StoredRelease {
  target: ReleaseTarget;
  metadata: ArenaMetadata;
  readme: string;
  license: string;
  attribution: string;
  includeSource: boolean;
}

export type ReleaseTarget = 'map' | 'game';

let releaseDialogRequest = 0;

function defaults(mapName: string): StoredRelease {
  return {
    target: 'map',
    metadata: {
      title: mapName, gameTypes: ['ffa'], botSupport: true,
      recommendedPlayers: '', author: '', description: '',
    },
    readme: '',
    license: '',
    attribution: '',
    includeSource: false,
  };
}

export function gameReleaseBuildIssue(target: ReleaseTarget, build: BuildRecord | null): string | null {
  if (target !== 'game' || !build) return null;
  if (!build.aas) return 'Maker game levels require a successful AAS bot-navigation stage. Recompile with Generate AAS enabled.';
  return null;
}

function readStored(editor: Editor, mapName: string): StoredRelease {
  const source = editor.worldspawn.properties[RELEASE_METADATA_KEY];
  if (!source) return defaults(mapName);
  try {
    const parsed = JSON.parse(source) as Partial<StoredRelease>;
    const fallback = defaults(mapName);
    return {
      ...fallback,
      ...parsed,
      metadata: { ...fallback.metadata, ...parsed.metadata },
    };
  } catch {
    return defaults(mapName);
  }
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const result = document.createElement('label');
  result.className = 'release-field';
  const text = document.createElement('span');
  text.textContent = label;
  result.append(text, input);
  return result;
}

function input(value = ''): HTMLInputElement {
  const result = document.createElement('input');
  result.type = 'text';
  result.value = value;
  return result;
}

function textarea(value = ''): HTMLTextAreaElement {
  const result = document.createElement('textarea');
  result.value = value;
  return result;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
}

export function selectReleaseBuild(
  builds: readonly BuildRecord[],
  documentRevision: number,
  compileSourceFingerprint?: string,
): BuildRecord | null {
  return builds.find(record =>
    record.success && record.bsp && !record.region &&
    (record.compileSourceFingerprint !== undefined
      ? compileSourceFingerprint !== undefined && record.compileSourceFingerprint === compileSourceFingerprint
      : record.documentRevision === documentRevision)) ?? null;
}

function base64Bytes(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function download(data: Uint8Array | string, fileName: string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function manifestSummary(manifest: ProjectAssetManifest): HTMLElement {
  const root = document.createElement('div');
  root.className = 'release-manifest';
  const summary = document.createElement('div');
  summary.className = 'release-manifest-summary';
  for (const [label, count, className] of [
    ['Dependencies', manifest.dependencies.length, ''],
    ['Missing', manifest.missing.length, manifest.missing.length ? 'error' : ''],
    ['Unlicensed', manifest.unlicensed.length, manifest.unlicensed.length ? 'warning' : ''],
    ['Ambiguous', manifest.ambiguous.length, manifest.ambiguous.length ? 'warning' : ''],
    ['Case mismatches', manifest.caseMismatches.length, manifest.caseMismatches.length ? 'warning' : ''],
    ['Unused project assets', manifest.unusedProjectAssets.length, ''],
  ] as Array<[string, number, string]>) {
    const item = document.createElement('div');
    item.className = className;
    item.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
    summary.appendChild(item);
  }
  const list = document.createElement('div');
  list.className = 'release-dependency-list';
  for (const dependency of manifest.dependencies) {
    const row = document.createElement('div');
    row.className = dependency.disposition;
    row.innerHTML = `<strong>${dependency.resolvedPath ?? dependency.requestedPath}</strong>
      <span>${dependency.kind} · ${dependency.disposition}${dependency.archive ? ` · ${dependency.archive}` : ''}</span>
      <small>${dependency.usedBy.slice(0, 4).join(', ')}</small>`;
    list.appendChild(row);
  }
  root.append(summary, list);
  return root;
}

export async function openReleasePackageDialog(options: ReleasePackageDialogOptions): Promise<void> {
  const request = ++releaseDialogRequest;
  document.getElementById('release-package-dialog')?.remove();
  const { editor, textureManager, buildHistory } = options;
  const fileName = editor.fileName;
  const documentSession = editor.documentSessionStartedAt;
  const builds = await buildHistory.list(fileName);
  if (request !== releaseDialogRequest
    || documentSession !== editor.documentSessionStartedAt
    || fileName !== editor.fileName) return;
  const mapName = fileName.replace(/\.map$/i, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'release';
  const compileFingerprint = buildSourceFingerprint(editor.serializeCompileMap());
  const build = selectReleaseBuild(builds, editor.documentRevision, compileFingerprint);
  const staleBuild = builds.find(record => record.success && record.bsp && !record.region) ?? null;
  const stored = readStored(editor, mapName);
  let levelshot: Uint8Array | null = null;
  let levelshotExtension: 'png' | 'jpg' = 'png';

  const overlay = document.createElement('div');
  overlay.id = 'release-package-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog release-package-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = 'Build Release PK3';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = build
    ? `Using ${build.quality} build from ${new Date(build.startedAt).toLocaleString()}${build.documentRevision === editor.documentRevision ? '' : ` (revision ${build.documentRevision}; current is ${editor.documentRevision})`}.`
    : staleBuild
      ? `The newest successful build is revision ${staleBuild.documentRevision}, but the current map is revision ${editor.documentRevision}. Compile the current map before packaging.`
      : 'Compile the map successfully before building a release package.';

  const body = document.createElement('div');
  body.className = 'release-package-body';
  const metadataSection = document.createElement('section');
  metadataSection.innerHTML = '<h3>Arena metadata</h3>';
  const titleInput = input(stored.metadata.title);
  const gameTypesInput = input(stored.metadata.gameTypes.join(' '));
  const playersInput = input(stored.metadata.recommendedPlayers);
  const authorInput = input(stored.metadata.author);
  const descriptionInput = textarea(stored.metadata.description);
  const botInput = document.createElement('input');
  botInput.type = 'checkbox';
  botInput.checked = stored.metadata.botSupport;
  const metadataGrid = document.createElement('div');
  metadataGrid.className = 'release-fields';
  metadataGrid.append(
    field('Map title', titleInput),
    field('Game types', gameTypesInput),
    field('Recommended players', playersInput),
    field('Author', authorInput),
    field('Description', descriptionInput),
    field('Bot support', botInput),
  );
  metadataSection.appendChild(metadataGrid);

  const levelshotSection = document.createElement('section');
  levelshotSection.innerHTML = '<h3>Levelshot</h3>';
  const levelshotPreview = document.createElement('img');
  levelshotPreview.className = 'release-levelshot';
  levelshotPreview.alt = 'Release levelshot preview';
  const levelshotStatus = document.createElement('p');
  levelshotStatus.textContent = 'No levelshot selected.';
  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = 'image/png,image/jpeg';
  upload.hidden = true;
  upload.onchange = () => {
    const file = upload.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then(buffer => {
      levelshot = new Uint8Array(buffer);
      levelshotExtension = file.type === 'image/jpeg' ? 'jpg' : 'png';
      levelshotPreview.src = URL.createObjectURL(file);
      levelshotStatus.textContent = `${file.name} · ${Math.round(file.size / 1024)} KB`;
    });
  };
  const levelshotActions = document.createElement('div');
  levelshotActions.className = 'release-inline-actions';
  levelshotActions.append(
    button('Capture 3D View', () => {
      const capture = options.captureLevelshot();
      levelshot = base64Bytes(capture.data);
      levelshotExtension = 'png';
      levelshotPreview.src = `data:${capture.mimeType};base64,${capture.data}`;
      levelshotStatus.textContent = `${capture.width}×${capture.height} editor camera capture`;
    }),
    button('Choose Image…', () => upload.click()),
    upload,
  );
  levelshotSection.append(levelshotActions, levelshotPreview, levelshotStatus);

  const filesSection = document.createElement('section');
  filesSection.innerHTML = '<h3>Release files</h3>';
  const targetInput = document.createElement('select');
  for (const [value, label] of [
    ['map', 'Quake 3 map package'],
    ['game', 'Maker game level (BSP + AAS + source)'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    targetInput.appendChild(option);
  }
  targetInput.value = stored.target;
  const readmeInput = textarea(stored.readme);
  const licenseInput = textarea(stored.license);
  const attributionInput = textarea(stored.attribution);
  const includeSource = document.createElement('input');
  includeSource.type = 'checkbox';
  includeSource.checked = stored.includeSource;
  const fileGrid = document.createElement('div');
  fileGrid.className = 'release-fields';
  fileGrid.append(
    field('Export target', targetInput),
    field('README', readmeInput),
    field('License', licenseInput),
    field('Attribution', attributionInput),
    field('Include editable .map source', includeSource),
  );
  filesSection.appendChild(fileGrid);

  const auditSection = document.createElement('section');
  auditSection.innerHTML = '<h3>Asset manifest</h3>';
  const manifestHost = document.createElement('div');
  const renderManifest = () => {
    const activeTextureManager = editor.textureManager ?? textureManager;
    manifestHost.replaceChildren(manifestSummary(scanProjectAssets(
      editor.entities,
      activeTextureManager.getAssetIndex(),
      activeTextureManager,
    )));
  };
  renderManifest();
  auditSection.appendChild(manifestHost);

  const packageSection = document.createElement('section');
  packageSection.innerHTML = '<h3>Package preview</h3>';
  const packageStatus = document.createElement('p');
  packageStatus.textContent = build ? 'Ready to validate and build.' : 'A compiled BSP is required.';
  const packageEntries = document.createElement('div');
  packageEntries.className = 'release-package-entries';
  const allowUnlicensed = document.createElement('input');
  allowUnlicensed.type = 'checkbox';
  packageSection.append(
    field('Reviewed: include assets without detected license', allowUnlicensed),
    packageStatus,
    packageEntries,
  );
  body.append(metadataSection, levelshotSection, filesSection, auditSection, packageSection);

  const applyTargetDefaults = () => {
    const gameTarget = targetInput.value === 'game';
    if (gameTarget) {
      includeSource.checked = true;
      botInput.checked = true;
    }
    includeSource.disabled = gameTarget;
    const issue = gameReleaseBuildIssue(targetInput.value as ReleaseTarget, build);
    packageStatus.textContent = issue ?? (build ? 'Ready to validate and build.' : 'A compiled BSP is required.');
    packageStatus.className = issue ? 'error' : '';
  };
  targetInput.onchange = applyTargetDefaults;
  applyTargetDefaults();

  const collectStored = (): StoredRelease => ({
    target: targetInput.value as ReleaseTarget,
    metadata: {
      title: titleInput.value.trim(),
      gameTypes: gameTypesInput.value.split(/[\s,]+/).filter(Boolean),
      botSupport: botInput.checked,
      recommendedPlayers: playersInput.value.trim(),
      author: authorInput.value.trim(),
      description: descriptionInput.value.trim(),
    },
    readme: readmeInput.value,
    license: licenseInput.value,
    attribution: attributionInput.value,
    includeSource: includeSource.checked,
  });
  const saveMetadata = () => {
    const serialized = JSON.stringify(collectStored());
    if (editor.worldspawn.properties[RELEASE_METADATA_KEY] === serialized) return;
    editor.transact('Update release metadata', () => {
      editor.worldspawn.properties[RELEASE_METADATA_KEY] = serialized;
    });
  };
  const buildPackage = (): ReleasePackageResult | null => {
    if (!build?.bsp) return null;
    saveMetadata();
    try {
      const gameBuildIssue = gameReleaseBuildIssue(targetInput.value as ReleaseTarget, build);
      if (gameBuildIssue) throw new Error(gameBuildIssue);
      const activeTextureManager = editor.textureManager ?? textureManager;
      const packageResult = buildReleasePackage({
        mapName,
        bsp: build.bsp,
        aas: build.aas,
        entities: editor.entities,
        assets: activeTextureManager.getAssetIndex(),
        textures: activeTextureManager,
        metadata: collectStored().metadata,
        levelshot,
        levelshotExtension,
        files: collectStored(),
        includeSourceMap: includeSource.checked ? editor.serializeMap() : null,
        allowUnlicensed: allowUnlicensed.checked,
      });
      packageStatus.textContent = `Archive validated: ${packageResult.report.entries.length} files · ${(packageResult.pk3.byteLength / 1024 / 1024).toFixed(2)} MB PK3`;
      packageStatus.className = 'success';
      packageEntries.replaceChildren(...packageResult.report.entries.map(entry => {
        const row = document.createElement('div');
        row.textContent = `${entry.path} · ${(entry.bytes / 1024).toFixed(1)} KB`;
        return row;
      }));
      editor.activityHistory.record({
        source: 'build', status: 'success', category: 'build',
        title: 'Release package validated',
        summary: `${packageResult.report.entries.length} files · ${(packageResult.pk3.byteLength / 1024 / 1024).toFixed(2)} MB`,
        revisionBefore: editor.documentRevision, revisionAfter: editor.documentRevision, undoable: false,
      });
      return packageResult;
    } catch (error) {
      packageStatus.textContent = error instanceof Error ? error.message : String(error);
      packageStatus.className = 'error';
      return null;
    }
  };

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  const playButton = button('Quick Play Package', () => {
    const result = buildPackage();
    if (result && build?.bsp) options.playPackage(mapName, build.bsp, build.aas, result.pk3);
  });
  playButton.disabled = !build;
  const reportButton = button('Export Report', () => {
    const result = buildPackage();
    if (result) download(JSON.stringify(result.report, null, 2), `${mapName}-package-report.json`, 'application/json');
  });
  reportButton.disabled = !build;
  const exportButton = button('Build PK3', () => {
    const result = buildPackage();
    if (result) download(result.pk3, `${mapName}.pk3`, 'application/zip');
  });
  exportButton.classList.add('primary');
  exportButton.disabled = !build;
  actions.append(
    button('Close', () => {
      saveMetadata();
      if (request === releaseDialogRequest) releaseDialogRequest++;
      overlay.remove();
    }),
    playButton,
    reportButton,
    exportButton,
  );
  dialog.append(title, description, body, actions);
  overlay.appendChild(dialog);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      saveMetadata();
      if (request === releaseDialogRequest) releaseDialogRequest++;
      overlay.remove();
      event.stopPropagation();
    }
  });
  document.body.appendChild(overlay);
}
