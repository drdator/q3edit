import {
  compareBspStatistics,
  fragmentedLeafIndices,
  leafAtPoint,
  parseBsp,
  toolShaderKind,
  type BspInspection,
  type BspOverlayMode,
} from './bsp-inspection';
import type { BuildRecord } from './build-history';
import type { BuildHistoryService } from './build-history';
import type { StructuredCompilerDiagnostic } from './compile-diagnostics';
import type { Editor } from './editor';
import type { MapDocumentRef } from './map-operations';

type BuildTab = 'summary' | 'diagnostics' | 'bsp-vis' | 'lightmaps' | 'history';

function selectRef(editor: Editor, ref: MapDocumentRef): boolean {
  const match = /^E(\d+)(?::B(\d+)(?::F(\d+))?|:P(\d+))?$/.exec(ref);
  if (!match) return false;
  const entity = editor.entities[Number(match[1])];
  if (!entity) return false;
  if (match[4] !== undefined) {
    const patch = entity.patches[Number(match[4])];
    if (!patch) return false;
    editor.selectPatchDirect(entity, patch);
  } else if (match[2] !== undefined) {
    const brush = entity.brushes[Number(match[2])];
    if (!brush) return false;
    if (match[3] !== undefined) {
      const face = brush.faces[Number(match[3])];
      if (!face) return false;
      editor.selectFace(entity, brush, face);
    } else editor.selectBrushDirect(entity, brush);
  } else editor.selectEntity(entity);
  editor.centerOnSelection();
  return true;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
}

function summaryGrid(record: BuildRecord, previous: BuildRecord | null): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'build-inspector-summary';
  const stats = record.statistics;
  const items: Array<[string, string]> = [
    ['Result', record.success ? record.reused ? 'Reused' : 'Success' : 'Failed'],
    ['Duration', `${record.durationMs} ms`],
    ['BSP', record.bsp ? formatBytes(record.bsp.byteLength) : 'None'],
    ['AAS', record.aas ? formatBytes(record.aas.byteLength) : 'None'],
    ['Nodes', String(stats?.nodes ?? '—')],
    ['Leaves', String(stats?.leaves ?? '—')],
    ['Clusters', String(stats?.clusters ?? '—')],
    ['Portals', String(stats?.portals ?? '—')],
    ['Draw surfaces', String(stats?.drawSurfaces ?? '—')],
    ['Triangles', String(stats?.triangles ?? '—')],
    ['Lightmaps', String(stats?.lightmaps ?? '—')],
    ['Warnings', String(record.diagnostics.filter(item => item.severity === 'warning').length)],
  ];
  for (const [label, value] of items) {
    const item = document.createElement('div');
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    grid.appendChild(item);
  }
  if (stats && previous?.statistics) {
    const comparisons = document.createElement('div');
    comparisons.className = 'build-comparison';
    const heading = document.createElement('h4');
    heading.textContent = `Compared with ${new Date(previous.startedAt).toLocaleString()}`;
    comparisons.appendChild(heading);
    for (const comparison of compareBspStatistics(stats, previous.statistics)) {
      const row = document.createElement('div');
      const sign = comparison.delta > 0 ? '+' : '';
      row.textContent = `${comparison.key}: ${comparison.current} (${sign}${comparison.delta})`;
      comparisons.appendChild(row);
    }
    const warnings = record.diagnostics.filter(item => item.severity === 'warning').length;
    const previousWarnings = previous.diagnostics.filter(item => item.severity === 'warning').length;
    const warningRow = document.createElement('div');
    const warningDelta = warnings - previousWarnings;
    warningRow.textContent = `warnings: ${warnings} (${warningDelta > 0 ? '+' : ''}${warningDelta})`;
    comparisons.appendChild(warningRow);
    grid.appendChild(comparisons);
  }
  return grid;
}

function diagnosticList(editor: Editor, diagnostics: StructuredCompilerDiagnostic[]): HTMLElement {
  const list = document.createElement('div');
  list.className = 'build-diagnostic-list';
  if (diagnostics.length === 0) {
    list.textContent = 'No structured compiler diagnostics.';
    return list;
  }
  for (const diagnostic of diagnostics) {
    const row = document.createElement('article');
    row.className = `build-diagnostic-row ${diagnostic.severity}`;
    const heading = document.createElement('div');
    heading.innerHTML = `<strong>${diagnostic.severity.toUpperCase()} · ${diagnostic.impact}</strong><span>${diagnostic.stage?.toUpperCase() ?? 'BUILD'}</span>`;
    const message = document.createElement('p');
    message.textContent = diagnostic.message;
    const suggestion = document.createElement('p');
    suggestion.className = 'build-diagnostic-suggestion';
    suggestion.textContent = diagnostic.suggestion;
    const refs = document.createElement('div');
    refs.className = 'build-diagnostic-refs';
    for (const ref of diagnostic.refs.slice(0, 20)) refs.appendChild(button(ref, () => selectRef(editor, ref)));
    if (diagnostic.refs.length > 20) refs.append(`+${diagnostic.refs.length - 20} more`);
    row.append(heading, message, suggestion, refs);
    list.appendChild(row);
  }
  return list;
}

function bspVisPanel(editor: Editor, inspection: BspInspection): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'build-bsp-vis';
  const controls = document.createElement('div');
  controls.className = 'build-overlay-controls';
  const label = document.createElement('label');
  label.textContent = 'Viewport overlay';
  const select = document.createElement('select');
  for (const [value, text] of [
    ['none', 'None'], ['leaves', 'BSP leaves'], ['portals', 'Portals'], ['both', 'Leaves + portals'], ['visible', 'Visible leaves from camera'],
  ] as Array<[BspOverlayMode, string]>) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = editor.compiledBspOverlay === value;
    select.appendChild(option);
  }
  select.onchange = () => {
    editor.compiledBspOverlay = select.value as BspOverlayMode;
    editor.redrawRequested = true;
  };
  label.appendChild(select);
  controls.appendChild(label);

  const cameraLeaf = leafAtPoint(inspection, editor.camera3d.position);
  const visibleClusters = cameraLeaf && inspection.visibility
    ? inspection.visibility.visibleClusters(cameraLeaf.cluster).length
    : 0;
  const fragmented = fragmentedLeafIndices(inspection);
  const info = document.createElement('div');
  info.className = 'build-analysis-notes';
  info.innerHTML = `
    <p>Camera cluster: <strong>${cameraLeaf?.cluster ?? 'outside compiled leaves'}</strong>${cameraLeaf ? ` · ${visibleClusters} visible clusters` : ''}</p>
    <p>Fragmentation candidates: <strong>${fragmented.length}</strong> leaves with unusually high draw-surface counts.</p>
    <p>Tool surfaces: <strong>${inspection.shaders.filter(shader => toolShaderKind(shader.name)).length}</strong> declared shaders.</p>
  `;
  const shaders = document.createElement('div');
  shaders.className = 'build-tool-shaders';
  for (const shader of inspection.shaders.filter(shader => toolShaderKind(shader.name))) {
    const row = document.createElement('div');
    row.textContent = `${toolShaderKind(shader.name)} · ${shader.name}`;
    shaders.appendChild(row);
  }
  panel.append(controls, info, shaders);
  return panel;
}

function lightmapContactSheet(inspection: BspInspection): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'build-lightmaps';
  if (inspection.lightmaps.length === 0) {
    panel.textContent = 'This BSP has no lightmap pages.';
    return panel;
  }
  const canvas = document.createElement('canvas');
  const columns = Math.min(4, inspection.lightmaps.length);
  const rows = Math.ceil(inspection.lightmaps.length / columns);
  canvas.width = columns * 128;
  canvas.height = rows * 128;
  const context = canvas.getContext('2d')!;
  inspection.lightmaps.forEach((lightmap, index) => {
    const rgba = new Uint8ClampedArray(128 * 128 * 4);
    for (let pixel = 0; pixel < 128 * 128; pixel++) {
      rgba[pixel * 4] = lightmap[pixel * 3];
      rgba[pixel * 4 + 1] = lightmap[pixel * 3 + 1];
      rgba[pixel * 4 + 2] = lightmap[pixel * 3 + 2];
      rgba[pixel * 4 + 3] = 255;
    }
    context.putImageData(new ImageData(rgba, 128, 128), (index % columns) * 128, Math.floor(index / columns) * 128);
  });
  const density = document.createElement('div');
  density.className = 'build-lightmap-density';
  const classes = document.createElement('div');
  classes.className = 'build-surface-classes';
  const lightingCounts = new Map<string, number>();
  for (const surface of inspection.surfaces) {
    lightingCounts.set(surface.lighting, (lightingCounts.get(surface.lighting) ?? 0) + 1);
    if (surface.emissive) lightingCounts.set('emissive', (lightingCounts.get('emissive') ?? 0) + 1);
    if (surface.transparent) lightingCounts.set('transparent', (lightingCounts.get('transparent') ?? 0) + 1);
  }
  for (const label of ['lightmapped', 'vertex-lit', 'unlit', 'emissive', 'transparent']) {
    const item = document.createElement('div');
    item.innerHTML = `<span>${label}</span><strong>${lightingCounts.get(label) ?? 0}</strong>`;
    classes.appendChild(item);
  }
  const surfaces = inspection.surfaces
    .filter(surface => surface.lightmapTexelsPerUnit !== null)
    .sort((a, b) => (b.lightmapTexelsPerUnit ?? 0) - (a.lightmapTexelsPerUnit ?? 0));
  const unusual = surfaces.filter(surface =>
    (surface.lightmapTexelsPerUnit ?? 0) < 0.03 || (surface.lightmapTexelsPerUnit ?? 0) > 0.15);
  const note = document.createElement('p');
  note.textContent = `${unusual.length} surfaces fall outside the 0.03–0.15 texel/unit review range.`;
  density.appendChild(note);
  for (const surface of unusual.slice(0, 40)) {
    const row = document.createElement('div');
    row.textContent = `${surface.shader} · ${surface.lightmapTexelsPerUnit!.toFixed(3)} texel/unit · ${surface.lightmapWidth}×${surface.lightmapHeight}`;
    density.appendChild(row);
  }
  panel.append(classes, canvas, density);
  return panel;
}

function buildHistoryPanel(records: BuildRecord[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'build-history-list';
  for (const record of records) {
    const row = document.createElement('article');
    row.innerHTML = `<strong>${record.quality} · ${record.success ? 'success' : 'failed'}</strong>
      <span>${new Date(record.startedAt).toLocaleString()} · rev ${record.documentRevision} · ${record.durationMs} ms</span>
      <span>${record.statistics ? `${record.statistics.leaves} leaves · ${record.statistics.drawSurfaces} surfaces · ${record.statistics.lightmaps} lightmaps` : 'No BSP statistics'}</span>`;
    panel.appendChild(row);
  }
  return panel;
}

export function createBuildInspector(
  editor: Editor,
  record: BuildRecord,
  inspection: BspInspection | null,
  previous: BuildRecord | null,
  history: BuildRecord[],
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'build-inspector';
  const tabs = document.createElement('div');
  tabs.className = 'diagnostics-tabs';
  const content = document.createElement('div');
  content.className = 'build-inspector-content';
  let active: BuildTab = 'summary';

  const render = () => {
    content.replaceChildren();
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>('button')) tab.classList.toggle('active', tab.dataset.tab === active);
    if (active === 'summary') {
      const stages = document.createElement('div');
      stages.className = 'build-stage-list';
      for (const stage of record.stages) {
        const item = document.createElement('div');
        item.className = stage.status;
        item.innerHTML = `<strong>${stage.stage.toUpperCase()}</strong><span>${stage.status} · ${stage.durationMs} ms</span>`;
        stages.appendChild(item);
      }
      content.append(stages, summaryGrid(record, previous));
    } else if (active === 'diagnostics') content.appendChild(diagnosticList(editor, record.diagnostics));
    else if (active === 'bsp-vis') content.appendChild(inspection ? bspVisPanel(editor, inspection) : document.createTextNode('No BSP inspection available.'));
    else if (active === 'lightmaps') content.appendChild(inspection ? lightmapContactSheet(inspection) : document.createTextNode('No lightmap data available.'));
    else content.appendChild(buildHistoryPanel(history));
  };
  for (const [tab, label] of [
    ['summary', 'Build Summary'], ['diagnostics', 'Diagnostics'], ['bsp-vis', 'BSP / VIS'], ['lightmaps', 'Lightmaps'], ['history', 'History'],
  ] as Array<[BuildTab, string]>) {
    const tabButton = button(label, () => { active = tab; render(); });
    tabButton.classList.add('diagnostics-tab');
    tabButton.dataset.tab = tab;
    tabs.appendChild(tabButton);
  }
  root.append(tabs, content);
  render();
  return root;
}

export async function openBuildHistoryDialog(editor: Editor, service: BuildHistoryService): Promise<void> {
  document.getElementById('build-history-dialog')?.remove();
  const records = await service.list();
  const overlay = document.createElement('div');
  overlay.id = 'build-history-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog build-history-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = 'Build History';
  const body = document.createElement('div');
  body.className = 'build-history-browser';
  const sidebar = document.createElement('div');
  sidebar.className = 'build-history-sidebar';
  const detail = document.createElement('div');
  detail.className = 'build-history-detail';
  const inspect = async (record: BuildRecord) => {
    let inspection: BspInspection | null = null;
    if (record.bsp) {
      try { inspection = parseBsp(record.bsp, record.portalFileText); } catch { /* keep the stored build metadata visible */ }
    }
    editor.compiledBspInspection = inspection;
    editor.redrawRequested = true;
    const previous = await service.previous(record.fileName, record.id);
    detail.replaceChildren(createBuildInspector(editor, record, inspection, previous, await service.list(record.fileName)));
  };
  for (const record of records) {
    const row = button(`${record.fileName} · ${new Date(record.startedAt).toLocaleString()}`, () => { void inspect(record); });
    row.classList.add('build-history-browser-row');
    sidebar.appendChild(row);
  }
  if (records.length > 0) void inspect(records[0]);
  else detail.textContent = 'No builds have been recorded yet.';
  body.append(sidebar, detail);
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(
    button('Clear History', () => {
      if (!(globalThis.confirm?.('Remove all retained build artifacts and reports?') ?? false)) return;
      void service.clear().then(() => overlay.remove());
    }),
    button('Close', () => overlay.remove()),
  );
  dialog.append(title, body, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
