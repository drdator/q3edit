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

function labeledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
  const field = document.createElement('label'); field.className = 'exact-primitive-field';
  const label = document.createElement('span'); label.className = 'exact-primitive-label'; label.textContent = labelText;
  field.append(label, control);
  return field;
}

function vectorField(labelText: string, inputs: HTMLInputElement[]): HTMLElement {
  const field = document.createElement('div'); field.className = 'exact-primitive-field';
  const label = document.createElement('div'); label.className = 'exact-primitive-label'; label.textContent = labelText;
  const row = document.createElement('div'); row.className = 'exact-primitive-vector';
  for (const [index, input] of inputs.entries()) {
    const coordinate = document.createElement('label'); coordinate.className = 'exact-primitive-coordinate';
    const axis = document.createElement('span'); axis.textContent = ['X', 'Y', 'Z'][index];
    input.setAttribute('aria-label', `${labelText} ${axis.textContent}`);
    coordinate.append(axis, input); row.appendChild(coordinate);
  }
  field.append(label, row);
  return field;
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
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'primitive-dialog-title');
  const dialog = document.createElement('form'); dialog.className = 'editor-dialog exact-primitive-dialog';
  const title = document.createElement('div'); title.id = 'primitive-dialog-title'; title.className = 'editor-dialog-title'; title.textContent = 'Create Exact Brush Primitive';
  const description = document.createElement('div'); description.className = 'editor-dialog-description';
  description.textContent = 'Set the primitive type, center, and dimensions in map units.';
  const fields = document.createElement('div'); fields.className = 'exact-primitive-fields';
  dialog.append(title, description, fields);

  const primitive = document.createElement('select');
  for (const option of BRUSH_PRIMITIVES) {
    const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; primitive.appendChild(element);
  }
  primitive.value = editor.currentBrushPrimitive;
  fields.appendChild(labeledControl('Primitive', primitive));

  const centerInputs = center.map(value => numberInput(value));
  const dimensionInputs = dimensions.map(value => numberInput(value, 0.001));
  fields.append(vectorField('Center', centerInputs), vectorField('Dimensions', dimensionInputs));

  const axis = document.createElement('select');
  for (const [value, label] of [['0', 'X'], ['1', 'Y'], ['2', 'Z']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; axis.appendChild(option);
  }
  axis.value = String(editor.rotationAxis);
  const sides = numberInput(editor.currentBrushSides, 3, 64);
  sides.step = '1';
  const shapeOptions = document.createElement('div'); shapeOptions.className = 'exact-primitive-options';
  shapeOptions.append(labeledControl('Axis', axis), labeledControl('Sides', sides));
  fields.appendChild(shapeOptions);

  const error = document.createElement('div'); error.className = 'exact-primitive-error'; error.setAttribute('role', 'alert'); error.setAttribute('aria-live', 'polite');
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
  const create = document.createElement('button'); create.type = 'submit'; create.className = 'btn primary'; create.textContent = 'Create';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
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
  dialog.addEventListener('submit', event => { event.preventDefault(); submit(); }); cancel.addEventListener('click', close);
  actions.append(cancel, create); dialog.appendChild(actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); event.stopPropagation(); }
  });
  primitive.focus();
}
