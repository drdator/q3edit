import { reviewMap, type DesignFinding } from '../bridge/design-review';
import { collectMapStatistics, type MapStatistics } from '../bridge/map-statistics';
import { lintRoutes, type RouteLintResult } from '../bridge/route-lint';
import { reviewTextureQuality, type TextureReviewIssue } from '../bridge/texture-review';
import { collectEditorDiagnostics, collectMapInfo } from './diagnostics';
import { selectDocumentRef } from './document-navigation';
import type { Editor } from './editor';
import { entityOrigin } from './entity';
import type { Vec3 } from './math';
import { listNamedGroups } from './named-groups';
import { readSpatialPlan } from './spatial-plan';

type ReviewSource = DesignFinding['source'] | 'texture' | 'lighting';
type ReviewSeverity = 'error' | 'warning' | 'info';

interface ReviewFinding {
  source: ReviewSource;
  severity: ReviewSeverity;
  code: string;
  message: string;
  refs: string[];
  details?: string;
}

interface ReviewRun {
  id: string;
  timestamp: number;
  revision: number;
  source: 'current' | 'preview';
  status: 'blocked' | 'needs-attention' | 'pass';
  findings: ReviewFinding[];
  statistics: MapStatistics;
  routes: RouteLintResult;
}

interface Suppression {
  key: string;
  reason: string;
  sourceSignature: string;
  acknowledgedAt: number;
}

const HISTORY_PREFIX = 'q3edit.design-review.history.';
const SUPPRESS_PREFIX = 'q3edit.design-review.suppressions.';

function storageKey(prefix: string, fileName: string): string {
  return prefix + fileName.toLowerCase();
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* review persistence is optional */ }
}

function findingKey(finding: ReviewFinding): string {
  return `${finding.source}:${finding.code}:${[...finding.refs].sort().join(',')}`;
}

function refObject(editor: Editor, ref: string): unknown {
  const match = /^E(\d+)(?::B(\d+)(?::F(\d+))?|:P(\d+))?$/.exec(ref);
  if (!match) return null;
  const entity = editor.entities[Number(match[1])];
  if (!entity) return null;
  if (match[4] !== undefined) return entity.patches[Number(match[4])] ?? null;
  if (match[2] !== undefined) {
    const brush = entity.brushes[Number(match[2])];
    return match[3] !== undefined ? brush?.faces[Number(match[3])] ?? null : brush ?? null;
  }
  return entity;
}

function sourceSignature(editor: Editor, finding: ReviewFinding): string {
  return JSON.stringify(finding.refs.map(ref => refObject(editor, ref)));
}

function lightingFindings(statistics: MapStatistics): ReviewFinding[] {
  if (statistics.lighting.count === 0) return [{
    source: 'lighting', severity: 'warning', code: 'no-lights', refs: [],
    message: 'The map has no light entities; a normal light compile will be black unless shaders provide light.',
  }];
  const findings: ReviewFinding[] = [];
  for (const spawn of statistics.spawns.objects) {
    const nearest = statistics.lighting.lights.reduce((distance, light) =>
      Math.min(distance, Math.hypot(...spawn.origin.map((value, axis) => value - light.origin[axis])) - light.radius), Infinity);
    if (nearest > 64) findings.push({
      source: 'lighting', severity: 'warning', code: 'dark-spawn', refs: [spawn.ref],
      message: `${spawn.ref} is outside the approximate influence radius of every light by ${Math.round(nearest)} units.`,
    });
  }
  return findings;
}

function normalizeReviewResult(value: Record<string, unknown>): DesignFinding[] {
  const findings = value.findings as { sample?: DesignFinding[] } | undefined;
  return findings?.sample ?? [];
}

function runReview(editor: Editor, mapText: string, source: ReviewRun['source']): ReviewRun {
  const diagnostics = collectEditorDiagnostics(editor);
  const mapInfo = collectMapInfo(editor, diagnostics);
  const combined = reviewMap(mapText, mapInfo, diagnostics, 'full');
  const texture = reviewTextureQuality(mapText, new Map(), { limit: Number.MAX_SAFE_INTEGER });
  const statistics = collectMapStatistics(mapText);
  const routes = lintRoutes(mapText);
  const findings: ReviewFinding[] = [
    ...normalizeReviewResult(combined),
    ...texture.issues.sample.map((item: TextureReviewIssue): ReviewFinding => ({
      source: 'texture', severity: item.severity, code: item.code, message: item.message,
      refs: item.refs, details: `${item.texture} · ${item.metrics.texelsPerUnit} texels/unit`,
    })),
    ...lightingFindings(statistics),
  ];
  const status = findings.some(item => item.severity === 'error') ? 'blocked'
    : findings.some(item => item.severity === 'warning') ? 'needs-attention'
      : 'pass';
  return {
    id: `${Date.now()}-${editor.documentRevision}`, timestamp: Date.now(), revision: editor.documentRevision,
    source, status, findings, statistics, routes,
  };
}

function appendCross(lines: Vec3[], point: Vec3, size = 24): void {
  lines.push(
    [point[0] - size, point[1], point[2]], [point[0] + size, point[1], point[2]],
    [point[0], point[1] - size, point[2]], [point[0], point[1] + size, point[2]],
    [point[0], point[1], point[2] - size], [point[0], point[1], point[2] + size],
  );
}

function appendCircle(lines: Vec3[], center: Vec3, radius: number, plane: 0 | 1 | 2): void {
  const axes = [0, 1, 2].filter(axis => axis !== plane);
  const segments = 24;
  for (let index = 0; index < segments; index++) {
    const a = index / segments * Math.PI * 2;
    const b = (index + 1) / segments * Math.PI * 2;
    const first = [...center] as Vec3;
    const second = [...center] as Vec3;
    first[axes[0]] += Math.cos(a) * radius; first[axes[1]] += Math.sin(a) * radius;
    second[axes[0]] += Math.cos(b) * radius; second[axes[1]] += Math.sin(b) * radius;
    lines.push(first, second);
  }
}

function refCenter(editor: Editor, ref: string): Vec3 | null {
  const object = refObject(editor, ref) as { mins?: Vec3; maxs?: Vec3; properties?: Record<string, string> } | null;
  if (!object) return null;
  if (object.mins && object.maxs) return object.mins.map((value, axis) => (value + object.maxs![axis]) / 2) as Vec3;
  const entity = object as Parameters<typeof entityOrigin>[0];
  const origin = entityOrigin(entity);
  if (origin) return origin;
  if (entity.brushes?.length) {
    const mins = [0, 1, 2].map(axis => Math.min(...entity.brushes.map(brush => brush.mins[axis]))) as Vec3;
    const maxs = [0, 1, 2].map(axis => Math.max(...entity.brushes.map(brush => brush.maxs[axis]))) as Vec3;
    return mins.map((value, axis) => (value + maxs[axis]) / 2) as Vec3;
  }
  return null;
}

function reviewOverlayLines(
  editor: Editor,
  run: ReviewRun,
  modes: Set<string>,
): Vec3[] {
  const lines: Vec3[] = [];
  if (modes.has('spawns')) for (const spawn of run.statistics.spawns.objects) appendCross(lines, spawn.origin, 28);
  if (modes.has('items')) for (const item of run.statistics.items.objects) appendCross(lines, item.origin, 16);
  if (modes.has('routes')) for (const edge of run.routes.connectivity.edges) {
    const from = refCenter(editor, edge.from);
    const to = refCenter(editor, edge.to);
    if (from && to) lines.push(from, to);
  }
  if (modes.has('routes')) editor.entities.forEach((entity, entityIndex) => {
    if (entity.classname !== 'trigger_teleport' || !entity.properties.target) return;
    const from = refCenter(editor, `E${entityIndex}`);
    const targetIndex = editor.entities.findIndex(candidate => candidate.properties.targetname === entity.properties.target);
    const to = targetIndex >= 0 ? refCenter(editor, `E${targetIndex}`) : null;
    if (from && to) lines.push(from, to);
  });
  if (modes.has('jumps')) for (const jump of run.routes.jumpPads) {
    for (let index = 0; index + 1 < jump.trajectory.length; index++) lines.push(jump.trajectory[index].position, jump.trajectory[index + 1].position);
    appendCross(lines, jump.apex, 20);
    if (jump.landing.supported) appendCross(lines, jump.landing.origin, 20);
  }
  if (modes.has('lights')) for (const light of run.statistics.lighting.lights) {
    appendCircle(lines, light.origin, light.radius, 0);
    appendCircle(lines, light.origin, light.radius, 1);
    appendCircle(lines, light.origin, light.radius, 2);
  }
  if (modes.has('sight')) {
    for (const spawn of run.statistics.spawns.objects) for (const item of run.statistics.items.objects) {
      if (Math.hypot(...spawn.origin.map((value, axis) => value - item.origin[axis])) <= 1024) lines.push(spawn.origin, item.origin);
    }
  }
  return lines;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function select(value: string, options: Array<[string, string]>): HTMLSelectElement {
  const result = document.createElement('select');
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = optionValue; option.textContent = label; option.selected = value === optionValue;
    result.appendChild(option);
  }
  return result;
}

function downloadReview(editor: Editor, run: ReviewRun): void {
  const data = JSON.stringify(run, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${editor.fileName.replace(/\.map$/i, '')}-design-review.json`; anchor.click();
  URL.revokeObjectURL(url);
}

export function createDesignReviewWorkspace(editor: Editor): HTMLElement {
  const root = document.createElement('div');
  root.className = 'design-review-workspace';
  const controls = document.createElement('div');
  controls.className = 'design-review-controls';
  const filterControls = document.createElement('div');
  filterControls.className = 'design-review-filter-controls';
  const overlayControls = document.createElement('div');
  overlayControls.className = 'design-review-overlay-controls';
  const source = select('current', [
    ['current', 'Current map'],
    ['preview', editor.pendingReviewMapText ? 'Unapplied MCP preview' : 'No unapplied preview available'],
  ]);
  source.querySelector<HTMLOptionElement>('option[value=preview]')!.disabled = !editor.pendingReviewMapText;
  const view = select('issues', [['summary', 'Summary'], ['issues', 'Issues only'], ['detailed', 'Detailed']]);
  const severity = select('all', [['all', 'All severities'], ['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Info']]);
  const type = select('all', [
    ['all', 'All review types'], ['validation', 'Validation'], ['geometry', 'Geometry'], ['spatial', 'Spatial'],
    ['style', 'Style'], ['gameplay', 'Gameplay'], ['routes', 'Routes'], ['texture', 'Texture'], ['lighting', 'Lighting'],
  ]);
  const group = select('all', [['all', 'All groups'], ...listNamedGroups(editor.entities).map(item => [item.id, item.name] as [string, string])]);
  const spatialPlan = readSpatialPlan(editor.worldspawn.properties);
  const area = select('all', [['all', 'All map areas'], ...spatialPlan.areas.map(item => [item.id, item.purpose || item.id] as [string, string])]);
  const objectKind = select('all', [['all', 'All object kinds'], ['entity', 'Entities'], ['brush', 'Brushes'], ['face', 'Faces'], ['patch', 'Patches']]);
  const showAcknowledged = document.createElement('input');
  showAcknowledged.type = 'checkbox';
  const content = document.createElement('div');
  content.className = 'design-review-content';
  const overlays = new Set<string>();
  let activeRun: ReviewRun | null = null;
  const historyKey = storageKey(HISTORY_PREFIX, editor.fileName);
  const suppressKey = storageKey(SUPPRESS_PREFIX, editor.fileName);
  let history = readJson<ReviewRun[]>(historyKey, []);
  let suppressions = readJson<Suppression[]>(suppressKey, []);
  const historySelect = select('', [['', 'Current review'], ...history.map(item => [item.id, new Date(item.timestamp).toLocaleString()] as [string, string])]);

  const refGroup = (ref: string): string | null => {
    const match = /^E(\d+)(?::B(\d+)|:P(\d+))?/.exec(ref);
    if (!match) return null;
    const entity = editor.entities[Number(match[1])];
    if (!entity) return null;
    if (match[2] !== undefined) return entity.brushes[Number(match[2])]?.editorGroupId ?? null;
    if (match[3] !== undefined) return entity.patches[Number(match[3])]?.editorGroupId ?? null;
    return entity.properties._q3edit_group_id ?? null;
  };
  const refKind = (ref: string): string => ref.includes(':F') ? 'face' : ref.includes(':B') ? 'brush' : ref.includes(':P') ? 'patch' : 'entity';
  const render = () => {
    content.replaceChildren();
    if (!activeRun) {
      const empty = document.createElement('p');
      empty.textContent = history.length > 0
        ? `Last review: ${new Date(history[0].timestamp).toLocaleString()} · ${history[0].status}. Run again for the current revision.`
        : 'Run a review to inspect spatial, route, gameplay, geometry, texture, lighting, and style quality.';
      content.appendChild(empty);
      return;
    }
    const severityCounts = {
      error: activeRun.findings.filter(item => item.severity === 'error').length,
      warning: activeRun.findings.filter(item => item.severity === 'warning').length,
      info: activeRun.findings.filter(item => item.severity === 'info').length,
    };
    const previous = history.find(item => item.id !== activeRun!.id);
    const previousKeys = new Set(previous?.findings.map(findingKey) ?? []);
    const currentKeys = new Set(activeRun.findings.map(findingKey));
    const summary = document.createElement('div');
    summary.className = 'design-review-summary';
    for (const [label, value] of [
      ['Status', activeRun.status], ['Errors', severityCounts.error], ['Warnings', severityCounts.warning],
      ['Info', severityCounts.info], ['New', activeRun.findings.filter(item => !previousKeys.has(findingKey(item))).length],
      ['Resolved', previous?.findings.filter(item => !currentKeys.has(findingKey(item))).length ?? 0],
    ]) {
      const item = document.createElement('div');
      item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      summary.appendChild(item);
    }
    content.appendChild(summary);
    if (view.value === 'summary') {
      const detail = document.createElement('div');
      detail.className = 'design-review-detail';
      detail.innerHTML = `<p>${activeRun.statistics.geometry.totalBrushes} brushes · ${activeRun.statistics.geometry.totalPatches} patches · ${activeRun.statistics.textures.uniqueCount} materials</p>
        <p>${activeRun.statistics.spawns.count} spawns · ${activeRun.statistics.items.count} pickups · ${activeRun.routes.connectivity.reachablePlatformCount}/${activeRun.routes.connectivity.platformCount} reachable platforms</p>
        <p>${activeRun.statistics.lighting.count} lights · approximate coverage upper bound ${activeRun.statistics.lighting.worldVolumeUpperBoundPercent?.toFixed(1) ?? '—'}%</p>`;
      content.appendChild(detail);
      return;
    }
    const list = document.createElement('div');
    list.className = 'design-review-findings';
    for (const finding of activeRun.findings) {
      if (severity.value !== 'all' && finding.severity !== severity.value) continue;
      if (type.value !== 'all' && finding.source !== type.value) continue;
      if (group.value !== 'all' && !finding.refs.some(ref => refGroup(ref) === group.value)) continue;
      if (area.value !== 'all') {
        const areaGroup = spatialPlan.areas.find(item => item.id === area.value)?.groupId;
        if (!areaGroup || !finding.refs.some(ref => refGroup(ref) === areaGroup)) continue;
      }
      if (objectKind.value !== 'all' && !finding.refs.some(ref => refKind(ref) === objectKind.value)) continue;
      const key = findingKey(finding);
      const suppression = suppressions.find(item => item.key === key);
      const unchanged = suppression?.sourceSignature === sourceSignature(editor, finding);
      if (unchanged && !showAcknowledged.checked) continue;
      const row = document.createElement('article');
      row.className = `design-review-finding ${finding.severity}${unchanged ? ' acknowledged' : ''}`;
      const heading = document.createElement('div');
      heading.innerHTML = `<strong>${finding.source} · ${finding.code}</strong><span>${finding.severity}${suppression && !unchanged ? ' · reopened after source change' : unchanged ? ' · acknowledged' : ''}</span>`;
      const message = document.createElement('p');
      message.textContent = finding.message;
      row.append(heading, message);
      if (view.value === 'detailed' && finding.details) {
        const detail = document.createElement('p'); detail.className = 'design-review-finding-detail'; detail.textContent = finding.details; row.appendChild(detail);
      }
      const actions = document.createElement('div');
      actions.className = 'design-review-finding-actions';
      for (const ref of finding.refs.slice(0, 8)) actions.appendChild(button(ref, () => selectDocumentRef(editor, ref as never)));
      if (unchanged) actions.appendChild(button('Reopen', () => {
        suppressions = suppressions.filter(item => item.key !== key); writeJson(suppressKey, suppressions); render();
      }));
      else actions.appendChild(button('Acknowledge...', () => {
        const reason = globalThis.prompt?.('Why is this finding intentional?', suppression?.reason ?? '');
        if (!reason?.trim()) return;
        suppressions = suppressions.filter(item => item.key !== key);
        suppressions.push({ key, reason: reason.trim(), sourceSignature: sourceSignature(editor, finding), acknowledgedAt: Date.now() });
        writeJson(suppressKey, suppressions); render();
      }));
      row.appendChild(actions);
      list.appendChild(row);
    }
    if (list.childElementCount === 0) list.textContent = 'No findings match the active filters.';
    content.appendChild(list);
  };
  const executeReview = () => {
    const reviewSource = source.value as ReviewRun['source'];
    const mapText = reviewSource === 'preview' ? editor.pendingReviewMapText! : editor.serializeMap();
    activeRun = runReview(editor, mapText, reviewSource);
    history = [activeRun, ...history].slice(0, 10);
    writeJson(historyKey, history);
    historySelect.replaceChildren(...[
      ['', 'Current review'],
      ...history.map(item => [item.id, new Date(item.timestamp).toLocaleString()] as [string, string]),
    ].map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
    editor.activityHistory.record({
      source: 'edit', status: activeRun.status === 'blocked' ? 'error' : activeRun.status === 'needs-attention' ? 'info' : 'success',
      category: 'system', title: 'Design review completed',
      summary: `${activeRun.status} · ${activeRun.findings.length} findings · ${reviewSource}`,
      revisionBefore: editor.documentRevision, revisionAfter: editor.documentRevision, undoable: false,
      details: [{ title: 'Important findings', value: activeRun.findings.filter(item => item.severity !== 'info').slice(0, 20) }],
    });
    render();
  };
  const runButton = button('Run Review', executeReview);
  runButton.classList.add('primary');
  historySelect.onchange = () => {
    activeRun = historySelect.value ? history.find(item => item.id === historySelect.value) ?? null : history[0] ?? activeRun;
    render();
  };
  filterControls.append(source, view, severity, type, area, group, objectKind, historySelect, runButton, button('Export', () => {
    if (activeRun) downloadReview(editor, activeRun);
  }));
  const acknowledgedLabel = document.createElement('label');
  acknowledgedLabel.className = 'design-review-checkbox';
  acknowledgedLabel.append(showAcknowledged, document.createTextNode('Show acknowledged'));
  overlayControls.appendChild(acknowledgedLabel);
  for (const [mode, label] of [
    ['spawns', 'Spawns'], ['items', 'Items'], ['routes', 'Routes'], ['jumps', 'Jump paths'], ['lights', 'Light coverage'], ['sight', 'Sight/distance'],
  ]) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.onchange = () => {
      if (checkbox.checked) overlays.add(mode); else overlays.delete(mode);
      editor.designReviewOverlayLines = activeRun && source.value === 'current' ? reviewOverlayLines(editor, activeRun, overlays) : [];
      editor.redrawRequested = true;
    };
    const labelElement = document.createElement('label');
    labelElement.className = 'design-review-checkbox';
    labelElement.append(checkbox, document.createTextNode(label));
    overlayControls.appendChild(labelElement);
  }
  controls.append(filterControls, overlayControls);
  for (const element of [view, severity, type, area, group, objectKind, showAcknowledged]) element.onchange = render;
  root.append(controls, content);
  render();
  return root;
}
