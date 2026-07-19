import { BRUSH_PRIMITIVES, brushPrimitiveSideRange, type BrushPrimitive } from './brush-primitives';
import type { Editor } from './editor';
import type { Vec3 } from './math';

function numberInput(value: number, min?: number, max?: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number'; input.step = 'any'; input.value = String(value);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  return input;
}

function labeledRow(container: HTMLElement, labelText: string, inputs: HTMLElement[]): void {
  const label = document.createElement('label'); label.textContent = labelText;
  const row = document.createElement('div'); row.className = 'kv-row'; row.append(...inputs);
  container.append(label, row);
}

export function openExactPrimitiveDialog(editor: Editor): void {
  document.getElementById('primitive-dialog')?.remove();
  const bounds = editor.selectionBounds();
  const center: Vec3 = bounds
    ? bounds.mins.map((value, axis) => (value + bounds.maxs[axis]) / 2) as Vec3
    : [0, 0, 0];
  const dimensions: Vec3 = bounds
    ? bounds.mins.map((value, axis) => Math.max(editor.gridSize, bounds.maxs[axis] - value)) as Vec3
    : [128, 128, 128];

  const overlay = document.createElement('div'); overlay.id = 'primitive-dialog'; overlay.className = 'editor-dialog-overlay';
  const dialog = document.createElement('div'); dialog.className = 'editor-dialog';
  const title = document.createElement('div'); title.className = 'editor-dialog-title'; title.textContent = 'Create Exact Brush Primitive';
  dialog.appendChild(title);

  const primitive = document.createElement('select');
  for (const option of BRUSH_PRIMITIVES) {
    const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; primitive.appendChild(element);
  }
  primitive.value = editor.currentBrushPrimitive;
  labeledRow(dialog, 'Primitive', [primitive]);

  const centerInputs = center.map(value => numberInput(value));
  const dimensionInputs = dimensions.map(value => numberInput(value, 0.001));
  labeledRow(dialog, 'Center X / Y / Z', centerInputs);
  labeledRow(dialog, 'Dimensions X / Y / Z', dimensionInputs);

  const axis = document.createElement('select');
  for (const [value, label] of [['0', 'X'], ['1', 'Y'], ['2', 'Z']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; axis.appendChild(option);
  }
  axis.value = String(editor.rotationAxis);
  const sides = numberInput(editor.currentBrushSides, 3, 64);
  sides.step = '1';
  labeledRow(dialog, 'Axis / Sides', [axis, sides]);

  const error = document.createElement('div'); error.className = 'editor-dialog-description'; error.style.color = '#f80';
  dialog.appendChild(error);
  const syncSides = () => {
    const range = brushPrimitiveSideRange(primitive.value as BrushPrimitive);
    sides.disabled = range === null;
    if (range) {
      sides.min = String(range.min); sides.max = String(range.max);
      const value = Number(sides.value);
      if (!Number.isInteger(value) || value < range.min || value > range.max) sides.value = String(Math.max(range.min, Math.min(range.max, Math.round(value) || range.min)));
    }
  };
  primitive.addEventListener('change', syncSides); syncSides();

  const actions = document.createElement('div'); actions.className = 'editor-dialog-actions';
  const create = document.createElement('button'); create.textContent = 'Create';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  const close = () => overlay.remove();
  const submit = () => {
    const parsedCenter = centerInputs.map(input => Number(input.value)) as Vec3;
    const parsedDimensions = dimensionInputs.map(input => Number(input.value)) as Vec3;
    editor.createExactBrushPrimitive({
      primitive: primitive.value as BrushPrimitive,
      center: parsedCenter,
      dimensions: parsedDimensions,
      axis: Number(axis.value),
      sides: Number(sides.value),
    });
    if (editor.statusMessage.startsWith('Created exact')) close(); else error.textContent = editor.statusMessage;
  };
  create.addEventListener('click', submit); cancel.addEventListener('click', close);
  actions.append(cancel, create); dialog.appendChild(actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') submit();
  });
  primitive.focus();
}
