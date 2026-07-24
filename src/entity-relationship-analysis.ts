import { analyzeJumpPad, type JumpPadAnalysis } from '../bridge/jump-analysis';
import type { Editor } from './editor';
import { entityOrigin, type Entity } from './entity';
import { getEntityClassRegistry } from './entity-definitions';
import { entityBounds, entityDisplayOrigin } from './editor-queries';
import type { Vec3 } from './math';
import { GROUP_ID_KEY, groupNameMap, isGroupInfoEntity } from './named-groups';
import { readSpatialPlan } from './spatial-plan';

export interface EntityGraphNode {
  ref: string;
  entity: Entity;
  classname: string;
  label: string;
  target: string | null;
  targetname: string | null;
  origin: Vec3 | null;
  groupId: string | null;
  groupName: string | null;
  areaId: string | null;
  selected: boolean;
}

export interface EntityGraphEdge {
  sourceRef: string;
  targetRef: string;
  value: string;
}

export interface EntityGraphIssue {
  severity: 'error' | 'warning' | 'info';
  code: 'missing-required-target' | 'missing-target' | 'duplicate-targetname' | 'ambiguous-target' |
    'cycle' | 'intentional-cycle' | 'unreachable' | 'teleporter-clearance' | 'invalid-jump-pad' | 'runtime-error';
  message: string;
  refs: string[];
}

export interface EntityMovementPreview {
  ref: string;
  classname: string;
  start: { mins: Vec3; maxs: Vec3 };
  end: { mins: Vec3; maxs: Vec3 };
  note: string;
}

export interface EntityChainStep {
  ref: string;
  classname: string;
  earliestSeconds: number;
  latestSeconds: number;
  oneShot: boolean;
  note: string;
}

export interface EntityChainSimulation {
  rootRef: string;
  steps: EntityChainStep[];
  truncated: boolean;
}

export interface EntityRelationshipAnalysis {
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
  issues: EntityGraphIssue[];
  movements: EntityMovementPreview[];
  simulations: EntityChainSimulation[];
  jumpPads: JumpPadAnalysis[];
}

const CYCLE_CLASSES = new Set(['path_corner', 'func_train']);
const CHAIN_ROOT_CLASSES = new Set(['trigger_always', 'trigger_once', 'trigger_multiple', 'func_button']);

function finite(value: string | undefined, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function entityLabel(entity: Entity, ref: string): string {
  const name = entity.properties.targetname?.trim() || entity.properties.name?.trim();
  return `${ref} · ${entity.classname}${name ? ` · ${name}` : ''}`;
}

function nodeArea(editor: Editor, groupId: string | null): string | null {
  if (!groupId) return null;
  return readSpatialPlan(editor.worldspawn.properties).areas.find(area => area.groupId === groupId)?.id ?? null;
}

function playerHullClear(editor: Editor, origin: Vec3): { clear: boolean; blockers: string[] } {
  const hull = {
    mins: [origin[0] - 15, origin[1] - 15, origin[2] - 24] as Vec3,
    maxs: [origin[0] + 15, origin[1] + 15, origin[2] + 32] as Vec3,
  };
  const blockers: string[] = [];
  editor.entities.forEach((entity, entityIndex) => {
    if (entity.classname.startsWith('trigger_') || isGroupInfoEntity(entity)) return;
    entity.brushes.forEach((brush, brushIndex) => {
      if (hull.maxs.every((value, axis) => value > brush.mins[axis]) &&
          hull.mins.every((value, axis) => value < brush.maxs[axis])) blockers.push(`E${entityIndex}:B${brushIndex}`);
    });
  });
  return { clear: blockers.length === 0, blockers };
}

function moverDirection(entity: Entity): Vec3 {
  const angle = finite(entity.properties.angle, 0);
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = angle * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians), 0];
}

function movementPreview(editor: Editor, entity: Entity, ref: string): EntityMovementPreview | null {
  const bounds = entityBounds(entity);
  if (!bounds || !/^func_(?:door|plat|bobbing|rotating|train)$/.test(entity.classname)) return null;
  let delta: Vec3 = [0, 0, 0];
  let note = 'Stationary bounds';
  if (entity.classname === 'func_door') {
    const direction = moverDirection(entity);
    const distance = Math.max(0, direction.reduce((sum, value, axis) =>
      sum + Math.abs(value) * (bounds.maxs[axis] - bounds.mins[axis]), 0) - finite(entity.properties.lip, 8));
    delta = direction.map(value => value * distance) as Vec3;
    note = `${Math.round(distance)} unit door travel`;
  } else if (entity.classname === 'func_plat') {
    delta = [0, 0, -(finite(entity.properties.height, bounds.maxs[2] - bounds.mins[2]) - finite(entity.properties.lip, 8))];
    note = `${Math.round(Math.abs(delta[2]))} unit platform travel`;
  } else if (entity.classname === 'func_bobbing') {
    const height = finite(entity.properties.height, 32);
    const flags = finite(entity.properties.spawnflags, 0);
    const axis = flags & 2 ? 0 : flags & 1 ? 2 : 1;
    delta[axis] = height;
    note = `${height} unit bobbing range`;
  } else if (entity.classname === 'func_rotating') {
    note = 'Rotating swept bounds (conservative)';
    const center = entityDisplayOrigin(entity) ?? bounds.mins.map((value, axis) => (value + bounds.maxs[axis]) / 2) as Vec3;
    const radius = Math.max(...bounds.mins.flatMap((value, axis) => [
      Math.abs(value - center[axis]), Math.abs(bounds.maxs[axis] - center[axis]),
    ]));
    return {
      ref, classname: entity.classname,
      start: bounds,
      end: { mins: center.map(value => value - radius) as Vec3, maxs: center.map(value => value + radius) as Vec3 },
      note,
    };
  } else if (entity.classname === 'func_train') {
    const targetNodes = Array.from(editor.nonWorldspawnEntities()).filter(candidate => candidate.classname === 'path_corner');
    if (targetNodes.length > 0) {
      const origins = targetNodes.map(entityOrigin).filter((value): value is Vec3 => value !== null);
      if (origins.length > 0) {
        const center = bounds.mins.map((value, axis) => (value + bounds.maxs[axis]) / 2) as Vec3;
        const offsets = origins.map(origin => origin.map((value, axis) => value - center[axis]) as Vec3);
        const mins = bounds.mins.map((value, axis) => value + Math.min(0, ...offsets.map(offset => offset[axis]))) as Vec3;
        const maxs = bounds.maxs.map((value, axis) => value + Math.max(0, ...offsets.map(offset => offset[axis]))) as Vec3;
        return { ref, classname: entity.classname, start: bounds, end: { mins, maxs }, note: `${origins.length}-point train path` };
      }
    }
  }
  return {
    ref, classname: entity.classname, start: bounds,
    end: { mins: bounds.mins.map((value, axis) => value + delta[axis]) as Vec3, maxs: bounds.maxs.map((value, axis) => value + delta[axis]) as Vec3 },
    note,
  };
}

function stronglyConnected(nodes: EntityGraphNode[], edges: EntityGraphEdge[]): string[][] {
  const outgoing = new Map(nodes.map(node => [node.ref, [] as string[]]));
  for (const edge of edges) outgoing.get(edge.sourceRef)?.push(edge.targetRef);
  let index = 0;
  const indices = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  const visit = (ref: string) => {
    indices.set(ref, index); lows.set(ref, index); index++; stack.push(ref); stacked.add(ref);
    for (const next of outgoing.get(ref) ?? []) {
      if (!indices.has(next)) { visit(next); lows.set(ref, Math.min(lows.get(ref)!, lows.get(next)!)); }
      else if (stacked.has(next)) lows.set(ref, Math.min(lows.get(ref)!, indices.get(next)!));
    }
    if (lows.get(ref) !== indices.get(ref)) return;
    const component: string[] = [];
    let current = '';
    do { current = stack.pop()!; stacked.delete(current); component.push(current); } while (current !== ref);
    if (component.length > 1 || (outgoing.get(ref) ?? []).includes(ref)) components.push(component);
  };
  for (const node of nodes) if (!indices.has(node.ref)) visit(node.ref);
  return components;
}

function simulationRoots(nodes: EntityGraphNode[], edges: EntityGraphEdge[]): EntityChainSimulation[] {
  const byRef = new Map(nodes.map(node => [node.ref, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.sourceRef, [...(outgoing.get(edge.sourceRef) ?? []), edge.targetRef]);
  return nodes.filter(node => CHAIN_ROOT_CLASSES.has(node.classname)).map(root => {
    const steps: EntityChainStep[] = [];
    const queue: Array<{ ref: string; earliest: number; latest: number }> = [{ ref: root.ref, earliest: 0, latest: 0 }];
    const visits = new Map<string, number>();
    let truncated = false;
    while (queue.length > 0 && steps.length < 64) {
      const item = queue.shift()!;
      const node = byRef.get(item.ref); if (!node) continue;
      const count = visits.get(item.ref) ?? 0;
      if (count >= 2) { truncated = true; continue; }
      visits.set(item.ref, count + 1);
      const wait = node.classname === 'target_delay' ? finite(node.entity.properties.wait, 1) : 0;
      const random = node.classname === 'target_delay' ? Math.abs(finite(node.entity.properties.random, 0)) : 0;
      const earliest = item.earliest + Math.max(0, wait - random);
      const latest = item.latest + wait + random;
      const oneShot = node.classname === 'trigger_once' || finite(node.entity.properties.wait, 0) < 0;
      const counter = node.classname === 'trigger_counter' ? Math.max(1, finite(node.entity.properties.count, 2)) : null;
      steps.push({
        ref: node.ref, classname: node.classname, earliestSeconds: earliest, latestSeconds: latest, oneShot,
        note: counter ? `fires after ${counter} activations` : node.classname === 'target_relay' ? 'relay' : oneShot ? 'one-shot' : '',
      });
      for (const next of outgoing.get(item.ref) ?? []) queue.push({ ref: next, earliest, latest });
    }
    if (queue.length > 0) truncated = true;
    return { rootRef: root.ref, steps, truncated };
  });
}

function runtimeIssues(editor: Editor, nodes: EntityGraphNode[]): EntityGraphIssue[] {
  const issues: EntityGraphIssue[] = [];
  for (const message of editor.runtimeEntityMessages) {
    const lower = message.toLowerCase();
    const refs = nodes.filter(node =>
      lower.includes(node.ref.toLowerCase()) ||
      (node.targetname && lower.includes(node.targetname.toLowerCase())) ||
      lower.includes(node.classname.toLowerCase())
    ).map(node => node.ref);
    if (refs.length === 0 && !/(entity|target|trigger|teleport|train|door)/i.test(message)) continue;
    issues.push({ severity: 'error', code: 'runtime-error', message, refs });
  }
  return issues;
}

export function analyzeEntityRelationships(editor: Editor): EntityRelationshipAnalysis {
  const groupNames = groupNameMap(editor.entities);
  const nodes: EntityGraphNode[] = editor.entities.flatMap((entity, index) => {
    if (index === 0 || isGroupInfoEntity(entity)) return [];
    const ref = `E${index}`;
    const groupId = entity.properties[GROUP_ID_KEY]?.trim() || null;
    return [{
      ref, entity, classname: entity.classname, label: entityLabel(entity, ref),
      target: entity.properties.target?.trim() || null,
      targetname: entity.properties.targetname?.trim() || null,
      origin: entityDisplayOrigin(entity),
      groupId, groupName: groupId ? groupNames.get(groupId) ?? groupId : null,
      areaId: nodeArea(editor, groupId),
      selected: editor.selection.some(item => item.entity === entity),
    }];
  });
  const byTargetname = new Map<string, EntityGraphNode[]>();
  for (const node of nodes) if (node.targetname) byTargetname.set(node.targetname, [...(byTargetname.get(node.targetname) ?? []), node]);
  const edges: EntityGraphEdge[] = [];
  const issues: EntityGraphIssue[] = [];
  for (const node of nodes) {
    const requiredTarget = getEntityClassRegistry().get(node.classname)?.relationships
      ?.some(relationship => relationship.direction === 'outgoing' && relationship.required);
    if (requiredTarget && !node.target) issues.push({
      severity: 'error', code: 'missing-required-target', refs: [node.ref],
      message: `${node.label} requires a target`,
    });
    if (!node.target) continue;
    const matches = byTargetname.get(node.target) ?? [];
    if (matches.length === 0) issues.push({
      severity: 'error', code: 'missing-target', refs: [node.ref],
      message: `${node.label} targets “${node.target}”, which does not exist`,
    });
    if (matches.length > 1) issues.push({
      severity: 'warning', code: 'ambiguous-target', refs: [node.ref, ...matches.map(match => match.ref)],
      message: `${node.label} targets ${matches.length} entities named “${node.target}”`,
    });
    for (const target of matches) edges.push({ sourceRef: node.ref, targetRef: target.ref, value: node.target });
  }
  for (const [name, owners] of byTargetname) if (owners.length > 1) issues.push({
    severity: 'warning', code: 'duplicate-targetname', refs: owners.map(owner => owner.ref),
    message: `${owners.length} entities share targetname “${name}”`,
  });
  const incoming = new Set(edges.map(edge => edge.targetRef));
  for (const node of nodes) if (node.targetname && !incoming.has(node.ref) &&
      !/^(?:info_player_|team_|item_|weapon_|ammo_|light$)/.test(node.classname)) issues.push({
    severity: 'info', code: 'unreachable', refs: [node.ref],
    message: `${node.label} has a targetname but no incoming relationship`,
  });
  for (const component of stronglyConnected(nodes, edges)) {
    const intentional = component.every(ref => CYCLE_CLASSES.has(nodes.find(node => node.ref === ref)!.classname));
    issues.push({
      severity: intentional ? 'info' : 'warning', code: intentional ? 'intentional-cycle' : 'cycle', refs: component,
      message: intentional
        ? `Intentional path/train cycle: ${component.join(' → ')}`
        : `Entity activation cycle may repeat indefinitely: ${component.join(' → ')}`,
    });
  }

  for (const node of nodes.filter(node => node.classname === 'trigger_teleport' && node.target)) {
    const destination = (byTargetname.get(node.target!) ?? [])[0];
    if (!destination?.origin) continue;
    const clearance = playerHullClear(editor, destination.origin);
    if (!clearance.clear) issues.push({
      severity: 'error', code: 'teleporter-clearance', refs: [node.ref, destination.ref, ...clearance.blockers],
      message: `${destination.label} does not have a clear standing player hull`,
    });
  }

  const jumpPads: JumpPadAnalysis[] = [];
  let serialized: string | null = null;
  for (const node of nodes.filter(node => node.classname === 'trigger_push')) {
    try {
      serialized ??= editor.serializeMap();
      jumpPads.push(analyzeJumpPad(serialized, { triggerRef: node.ref, sampleCount: 24 }));
    } catch (error) {
      issues.push({
        severity: 'error', code: 'invalid-jump-pad', refs: [node.ref],
        message: `${node.label}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  issues.push(...runtimeIssues(editor, nodes));
  return {
    nodes,
    edges,
    issues,
    movements: nodes.map(node => movementPreview(editor, node.entity, node.ref)).filter((value): value is EntityMovementPreview => value !== null),
    simulations: simulationRoots(nodes, edges),
    jumpPads,
  };
}

function appendBounds(lines: Vec3[], bounds: { mins: Vec3; maxs: Vec3 }): void {
  const [a, b] = [bounds.mins, bounds.maxs];
  const corners: Vec3[] = [
    [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
    [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
  ];
  for (const [from, to] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    lines.push(corners[from], corners[to]);
  }
}

export function entityRelationshipOverlayLines(
  analysis: EntityRelationshipAnalysis,
  options: { links: boolean; triggers: boolean; movement: boolean; jumps: boolean },
): Vec3[] {
  const lines: Vec3[] = [];
  const nodes = new Map(analysis.nodes.map(node => [node.ref, node]));
  if (options.links) for (const edge of analysis.edges) {
    const from = nodes.get(edge.sourceRef)?.origin;
    const to = nodes.get(edge.targetRef)?.origin;
    if (from && to) lines.push(from, to);
  }
  if (options.triggers) for (const node of analysis.nodes) {
    if (!node.classname.startsWith('trigger_')) continue;
    const bounds = entityBounds(node.entity);
    if (bounds) appendBounds(lines, bounds);
  }
  if (options.movement) for (const movement of analysis.movements) {
    appendBounds(lines, movement.start); appendBounds(lines, movement.end);
    const start = movement.start.mins.map((value, axis) => (value + movement.start.maxs[axis]) / 2) as Vec3;
    const end = movement.end.mins.map((value, axis) => (value + movement.end.maxs[axis]) / 2) as Vec3;
    lines.push(start, end);
  }
  if (options.jumps) for (const jump of analysis.jumpPads) {
    for (let index = 0; index + 1 < jump.trajectory.length; index++) {
      lines.push(jump.trajectory[index].position, jump.trajectory[index + 1].position);
    }
  }
  return lines;
}
