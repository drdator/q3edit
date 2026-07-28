import { BRUSH_PRIMITIVES, brushPrimitiveSideRange, type BrushPrimitive } from './brush-primitives';
import type { Editor } from './editor';
import type { Vec3 } from './math';
import { openEditorDialog } from './ui-dialog';

function numberInput(value: number, min?: number, max?: number): HTMLInputElement {
  const input = document.createElement('input');
  const displayValue = Math.abs(value - Math.round(value)) < 1e-6
    ? Math.round(value)
    : Number(value.toFixed(6));
  input.type = 'number'; input.step = 'any'; input.value = String(displayValue);
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
  const bounds = editor.selectionBounds();
  const center: Vec3 = bounds
    ? bounds.mins.map((value, axis) => (value + bounds.maxs[axis]) / 2) as Vec3
    : [0, 0, 0];
  const dimensions: Vec3 = bounds
    ? bounds.mins.map((value, axis) => Math.max(editor.gridSize, bounds.maxs[axis] - value)) as Vec3
    : [128, 128, 128];

  const description = document.createElement('div'); description.className = 'editor-dialog-description';
  description.textContent = 'Set the primitive type, center, and dimensions in map units.';
  const fields = document.createElement('div'); fields.className = 'exact-primitive-fields';

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

  openEditorDialog({
    id: 'primitive-dialog',
    title: 'Create Exact Brush Primitive',
    titleId: 'primitive-dialog-title',
    className: 'exact-primitive-dialog',
    form: true,
    body: [description, fields, error],
    actions: [
      { label: 'Cancel', dismiss: true },
      { label: 'Create', primary: true, type: 'submit' },
    ],
    initialFocus: primitive,
    onSubmit: handle => {
      const parsedCenter = centerInputs.map(input => Number(input.value)) as Vec3;
      const parsedDimensions = dimensionInputs.map(input => Number(input.value)) as Vec3;
      editor.createExactBrushPrimitive({
        primitive: primitive.value as BrushPrimitive,
        center: parsedCenter,
        dimensions: parsedDimensions,
        axis: Number(axis.value),
        sides: Number(sides.value),
      });
      if (editor.statusMessage.startsWith('Created exact')) handle.close();
      else error.textContent = editor.statusMessage;
    },
  });
}
