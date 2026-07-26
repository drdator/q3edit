import { reviewMap, type DesignFinding } from '../bridge/design-review';
import { collectMapStatistics, type MapStatistics } from '../bridge/map-statistics';
import { lintRoutes, type RouteLintResult } from '../bridge/route-lint';
import {
  reviewTextureQuality,
  textureNamesForReview,
  type TextureDimensions,
  type TextureReviewIssue,
} from '../bridge/texture-review';
import { collectEditorDiagnostics, collectMapInfo } from './diagnostics';
import { selectDocumentRef } from './document-navigation';
import { Editor } from './editor';
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

export interface ReviewRun {
  id: string;
  timestamp: number;
  revision: number;
  source: 'current' | 'preview';
  status: 'blocked' | 'needs-attention' | 'pass';
  findings: ReviewFinding[];
  statistics: MapStatistics;
  routes: RouteLintResult;
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

function reviewedTextureDimensions(editor: Editor, mapText: string): Map<string, TextureDimensions> {
  const dimensions = new Map<string, TextureDimensions>();
  if (!editor.textureManager) return dimensions;
  for (const name of textureNamesForReview(mapText)) {
    const inspected = editor.textureManager.inspectTexture(name);
    const image = inspected.image as { width?: number | null; height?: number | null } | null;
    if (!image?.width || !image.height) continue;
    dimensions.set(name.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, ''), {
      width: image.width,
      height: image.height,
      verified: true,
    });
  }
  return dimensions;
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

export function runDesignReview(editor: Editor, mapText: string, source: ReviewRun['source']): ReviewRun {
  const reviewedEditor = source === 'current' ? editor : new Editor();
  if (source === 'preview') {
    reviewedEditor.textureManager = editor.textureManager;
    reviewedEditor.modelManager = editor.modelManager;
    reviewedEditor.loadMap(mapText);
  }
  const diagnostics = collectEditorDiagnostics(reviewedEditor);
  const mapInfo = collectMapInfo(reviewedEditor, diagnostics);
  const combined = reviewMap(mapText, mapInfo, diagnostics, 'full');
  const texture = reviewTextureQuality(mapText, reviewedTextureDimensions(editor, mapText), { limit: Number.MAX_SAFE_INTEGER });
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

function appendBounds(lines: Vec3[], mins: Vec3, maxs: Vec3): void {
  const corners: Vec3[] = [
    [mins[0], mins[1], mins[2]], [maxs[0], mins[1], mins[2]],
    [maxs[0], maxs[1], mins[2]], [mins[0], maxs[1], mins[2]],
    [mins[0], mins[1], maxs[2]], [maxs[0], mins[1], maxs[2]],
    [maxs[0], maxs[1], maxs[2]], [mins[0], maxs[1], maxs[2]],
  ];
  for (const [from, to] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    lines.push(corners[from], corners[to]);
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
  if (modes.has('spawns')) for (const spawn of run.statistics.spawns.objects) {
    appendCross(lines, spawn.origin, 28);
    appendBounds(
      lines,
      [spawn.origin[0] - 15, spawn.origin[1] - 15, spawn.origin[2] - 24],
      [spawn.origin[0] + 15, spawn.origin[1] + 15, spawn.origin[2] + 32],
    );
  }
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
    for (const collision of jump.clearance.collisions) appendCross(lines, collision.position, 12);
    if (jump.landing.supported) {
      appendCross(lines, jump.landing.origin, 20);
      appendBounds(
        lines,
        [jump.landing.origin[0] - 15, jump.landing.origin[1] - 15, jump.landing.origin[2] - 24],
        [jump.landing.origin[0] + 15, jump.landing.origin[1] + 15, jump.landing.origin[2] + 32],
      );
    }
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
  const content = document.createElement('div');
  content.className = 'design-review-content';
  const overlays = new Set<string>();
  let activeRun: ReviewRun | null = null;

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
      empty.textContent = 'Run a review to inspect spatial, route, gameplay, geometry, texture, lighting, and style quality.';
      content.appendChild(empty);
      return;
    }
    const severityCounts = {
      error: activeRun.findings.filter(item => item.severity === 'error').length,
      warning: activeRun.findings.filter(item => item.severity === 'warning').length,
      info: activeRun.findings.filter(item => item.severity === 'info').length,
    };
    const summary = document.createElement('div');
    summary.className = 'design-review-summary';
    for (const [label, value] of [
      ['Status', activeRun.status], ['Errors', severityCounts.error], ['Warnings', severityCounts.warning],
      ['Info', severityCounts.info],
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
      if (view.value === 'issues' && finding.severity === 'info') continue;
      if (severity.value !== 'all' && finding.severity !== severity.value) continue;
      if (type.value !== 'all' && finding.source !== type.value) continue;
      if (group.value !== 'all' && !finding.refs.some(ref => refGroup(ref) === group.value)) continue;
      if (area.value !== 'all') {
        const areaGroup = spatialPlan.areas.find(item => item.id === area.value)?.groupId;
        if (!areaGroup || !finding.refs.some(ref => refGroup(ref) === areaGroup)) continue;
      }
      if (objectKind.value !== 'all' && !finding.refs.some(ref => refKind(ref) === objectKind.value)) continue;
      const row = document.createElement('article');
      row.className = `design-review-finding ${finding.severity}`;
      const heading = document.createElement('div');
      heading.innerHTML = `<strong>${finding.source} · ${finding.code}</strong><span>${finding.severity}</span>`;
      const message = document.createElement('p');
      message.textContent = finding.message;
      row.append(heading, message);
      if (view.value === 'detailed' && finding.details) {
        const detail = document.createElement('p'); detail.className = 'design-review-finding-detail'; detail.textContent = finding.details; row.appendChild(detail);
      }
      const actions = document.createElement('div');
      actions.className = 'design-review-finding-actions';
      if (activeRun.source === 'current') {
        for (const ref of finding.refs.slice(0, 8)) actions.appendChild(button(ref, () => selectDocumentRef(editor, ref as never)));
      } else if (finding.refs.length > 0) {
        const previewRefs = document.createElement('span');
        previewRefs.textContent = `Preview refs: ${finding.refs.slice(0, 8).join(', ')}`;
        actions.appendChild(previewRefs);
      }
      row.appendChild(actions);
      list.appendChild(row);
    }
    if (list.childElementCount === 0) {
      list.textContent = view.value === 'issues'
        ? 'No actionable findings match the active filters.'
        : 'No findings match the active filters.';
    }
    content.appendChild(list);
  };
  const executeReview = () => {
    const reviewSource = source.value as ReviewRun['source'];
    const mapText = reviewSource === 'preview' ? editor.pendingReviewMapText! : editor.serializeMap();
    activeRun = runDesignReview(editor, mapText, reviewSource);
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
  filterControls.append(source, view, severity, type, area, group, objectKind, runButton);
  for (const [mode, label] of [
    ['spawns', 'Spawns & hulls'], ['items', 'Items'], ['routes', 'Routes'], ['jumps', 'Jump paths & collisions'], ['lights', 'Light coverage'], ['sight', 'Spawn/item links'],
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
  for (const element of [view, severity, type, area, group, objectKind]) element.onchange = render;
  root.append(controls, content);
  render();
  return root;
}
