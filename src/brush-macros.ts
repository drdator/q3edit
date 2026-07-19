import { cloneBrush, rotateBrush, translateBrush, validateBrush, type Brush } from './brush';
import type { Editor } from './editor';
import { getSelectedBrushItems } from './editor-selection';
import type { Entity } from './entity';
import type { Vec3 } from './math';

export const BRUSH_MACRO_VERSION = 1;
export const Q3RADIANT_BRUSH_SCRIPT_DECISION =
  'A versioned declarative JSON macro implements the useful copy/move/rotate subset; arbitrary code, blocking input loops, and the experimental scripts.ini runtime are deliberately excluded.' as const;

export type BrushMacroStep =
  | { operation: 'duplicate' }
  | { operation: 'translate'; offset: Vec3 }
  | { operation: 'rotate'; axis: 'x' | 'y' | 'z'; degrees: number };

export interface BrushMacro {
  version: typeof BRUSH_MACRO_VERSION;
  name: string;
  steps: BrushMacroStep[];
}

interface SimulatedBrush {
  entity: Entity;
  original?: Brush;
  brush: Brush;
  committed?: Brush;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

export function normalizeBrushMacro(value: unknown): BrushMacro {
  if (!isRecord(value)) throw new Error('Brush macro must be a JSON object');
  if (Number(value.version) !== BRUSH_MACRO_VERSION) throw new Error(`Unsupported brush macro version ${String(value.version)}`);
  if (!Array.isArray(value.steps) || value.steps.length === 0) throw new Error('Brush macro must contain at least one step');
  if (value.steps.length > 64) throw new Error('Brush macro cannot contain more than 64 steps');
  const steps = value.steps.map((raw, index): BrushMacroStep => {
    if (!isRecord(raw)) throw new Error(`Step ${index + 1} must be an object`);
    if (raw.operation === 'duplicate') return { operation: 'duplicate' };
    if (raw.operation === 'translate') {
      if (!Array.isArray(raw.offset) || raw.offset.length !== 3) throw new Error(`Step ${index + 1} translate offset must have three numbers`);
      return { operation: 'translate', offset: raw.offset.map((item, axis) => finite(item, `Step ${index + 1} offset ${axis}`)) as Vec3 };
    }
    if (raw.operation === 'rotate') {
      if (!['x', 'y', 'z'].includes(String(raw.axis))) throw new Error(`Step ${index + 1} rotate axis must be x, y, or z`);
      return { operation: 'rotate', axis: raw.axis as 'x' | 'y' | 'z', degrees: finite(raw.degrees, `Step ${index + 1} degrees`) };
    }
    throw new Error(`Step ${index + 1} has unsupported operation '${String(raw.operation)}'`);
  });
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : 'Brush macro';
  return { version: BRUSH_MACRO_VERSION, name, steps };
}

export function importBrushMacro(json: string): BrushMacro { return normalizeBrushMacro(JSON.parse(json)); }
export function exportBrushMacro(macro: BrushMacro): string { return JSON.stringify(normalizeBrushMacro(macro), null, 2); }

function selectionCenter(records: SimulatedBrush[]): Vec3 {
  const mins: Vec3 = [Infinity, Infinity, Infinity];
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { brush } of records) for (let axis = 0; axis < 3; axis++) {
    mins[axis] = Math.min(mins[axis], brush.mins[axis]);
    maxs[axis] = Math.max(maxs[axis], brush.maxs[axis]);
  }
  return [(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2];
}

export function runBrushMacro(editor: Editor, input: BrushMacro): { changed: boolean; selectedBrushes: number } {
  const macro = normalizeBrushMacro(input);
  const selected = getSelectedBrushItems(editor);
  if (selected.length === 0) return { changed: false, selectedBrushes: 0 };
  const records: SimulatedBrush[] = selected.map(item => ({ entity: item.entity, original: item.brush, brush: cloneBrush(item.brush) }));
  let active = [...records];
  for (const step of macro.steps) {
    if (step.operation === 'duplicate') {
      if (records.length + active.length > 256) throw new Error('Brush macro would create more than 256 working brushes');
      active = active.map(record => ({ entity: record.entity, brush: cloneBrush(record.brush) }));
      records.push(...active);
    } else if (step.operation === 'translate') {
      for (const record of active) translateBrush(record.brush, step.offset);
    } else {
      const axis = { x: 0, y: 1, z: 2 }[step.axis];
      const center = selectionCenter(active);
      const radians = step.degrees * Math.PI / 180;
      for (const record of active) rotateBrush(record.brush, center, axis, radians);
    }
  }
  for (const record of records) {
    const validation = validateBrush(record.brush);
    if (!validation.valid) throw new Error(`Brush macro produced invalid geometry: ${validation.issues.join('; ')}`);
  }

  editor.transact(`Run brush macro: ${macro.name}`, () => {
    for (const record of records) {
      if (record.original) {
        Object.assign(record.original, cloneBrush(record.brush));
        record.committed = record.original;
      } else {
        record.committed = cloneBrush(record.brush);
        record.entity.brushes.push(record.committed);
      }
    }
    editor.selection = active.map(record => ({ type: 'brush' as const, entity: record.entity, brush: record.committed! }));
    editor.redrawRequested = true;
  });
  editor.statusMessage = `Ran ${macro.name} on ${selected.length} brush${selected.length === 1 ? '' : 'es'}`;
  return { changed: true, selectedBrushes: active.length };
}
