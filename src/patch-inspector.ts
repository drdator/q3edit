import type { Editor } from './editor';
import { inspectPatch } from './patch-operations';
import type { Patch } from './patch';

export function buildPatchInspector(container: HTMLElement, editor: Editor, patches: Patch[]): void {
  const title = document.createElement('label'); title.style.fontWeight = 'bold';
  title.textContent = patches.length === 1 ? 'Patch Inspector' : `${patches.length} Patches`;
  container.appendChild(title);
  if (patches.length !== 1) return;
  const patch = patches[0]; const model = inspectPatch(patch);
  const dimensions = document.createElement('label'); dimensions.textContent = `Dimensions: ${model.width} x ${model.height}`; container.appendChild(dimensions);
  const fields: Array<[string, keyof Pick<Patch, 'texture'|'subdivisions'|'contentFlags'|'surfaceFlags'|'value'>, string | number]> = [
    ['Shader', 'texture', model.texture], ['Subdivisions', 'subdivisions', model.subdivisions],
    ['Content flags', 'contentFlags', model.contentFlags], ['Surface flags', 'surfaceFlags', model.surfaceFlags], ['Value', 'value', model.value],
  ];
  for (const [labelText, key, value] of fields) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = key === 'texture' ? 'text' : 'number'; input.value = String(value);
    input.dataset.commandId = 'patch.inspector.set';
    input.addEventListener('change', () => editor.updatePatchProperties(patch, { [key]: key === 'texture' ? input.value : Number(input.value) }));
    container.append(label, input);
  }
  const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `${model.controlPoints.length} control points`;
  const pre = document.createElement('pre'); pre.className = 'patch-control-data';
  pre.textContent = model.controlPoints.map(point => `${point.row},${point.col}: (${point.xyz.join(' ')}) uv(${point.uv.join(' ')})`).join('\n');
  details.append(summary, pre); container.appendChild(details);
}
