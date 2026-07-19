import type { Editor } from './editor';
import type { Patch, TerrainDefSurface } from './patch';
import { isTerrainMesh, terrainSample, validateTerrainMesh } from './terrain-model';

export interface TerrainInspectorSample extends TerrainDefSurface {
  row: number;
  column: number;
  height: number;
}

export interface TerrainInspectorModel {
  width: number;
  height: number;
  origin: [number, number, number];
  scale: [number, number];
  serializable: boolean;
  issues: string[];
  samples: TerrainInspectorSample[];
}

const selectedSamples = new WeakMap<Patch, { row: number; column: number }>();

export function inspectTerrain(patch: Patch): TerrainInspectorModel | null {
  if (!isTerrainMesh(patch)) return null;
  const validation = validateTerrainMesh(patch);
  const samples: TerrainInspectorSample[] = [];
  for (let row = 0; row < patch.height; row++) {
    for (let column = 0; column < patch.width; column++) {
      const sample = terrainSample(patch, row, column);
      if (sample) samples.push({ row, column, height: sample.point.xyz[2], ...sample.surface });
    }
  }
  return {
    width: patch.width,
    height: patch.height,
    origin: [...patch.terrainDef.origin],
    scale: [...patch.terrainDef.scale],
    serializable: validation.valid,
    issues: validation.issues,
    samples,
  };
}

function appendField(
  container: HTMLElement,
  labelText: string,
  value: string | number,
  type: 'text' | 'number',
  onChange: (value: string) => void,
): void {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.style.fontSize = '11px';
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value);
  if (type === 'number') input.step = 'any';
  input.dataset.commandId = 'terrain.inspector.set-sample';
  input.addEventListener('change', () => onChange(input.value));
  container.append(label, input);
}

export function buildTerrainInspector(container: HTMLElement, editor: Editor, patches: Patch[]): void {
  const terrains = patches.filter(isTerrainMesh);
  const title = document.createElement('label');
  title.style.fontWeight = 'bold';
  title.textContent = terrains.length === 1 ? 'Terrain Inspector' : `${terrains.length} Terrain Meshes`;
  container.appendChild(title);
  if (terrains.length !== 1 || terrains.length !== patches.length) return;

  const patch = terrains[0];
  const model = inspectTerrain(patch)!;
  const summary = document.createElement('label');
  summary.textContent = `${model.width} x ${model.height} samples · origin ${model.origin.join(' ')} · scale ${model.scale.join(' ')}`;
  summary.style.color = '#888';
  summary.style.fontSize = '11px';
  container.appendChild(summary);

  if (!model.serializable) {
    const warning = document.createElement('label');
    warning.textContent = `Cannot save as terrainDef: ${model.issues.join('; ')}`;
    warning.style.color = '#f80';
    container.appendChild(warning);
  }

  const actions = document.createElement('div');
  actions.className = 'kv-row';
  for (const [label, action] of [
    ['Select Row', () => editor.selectTerrainRows()],
    ['Select Column', () => editor.selectTerrainColumns()],
    ['Convert to Patch', () => editor.convertSelectedTerrainToPatch()],
  ] as const) {
    const button = document.createElement('div');
    button.className = 'btn';
    button.textContent = label;
    button.addEventListener('mousedown', action);
    actions.appendChild(button);
  }
  container.appendChild(actions);

  const current = selectedSamples.get(patch) ?? { row: 0, column: 0 };
  if (!model.samples.some(sample => sample.row === current.row && sample.column === current.column)) {
    current.row = 0;
    current.column = 0;
  }
  selectedSamples.set(patch, current);

  const sampleLabel = document.createElement('label');
  sampleLabel.textContent = 'Sample';
  const sampleSelect = document.createElement('select');
  for (const sample of model.samples) {
    const option = document.createElement('option');
    option.value = `${sample.row}:${sample.column}`;
    option.textContent = `row ${sample.row}, column ${sample.column}`;
    option.selected = sample.row === current.row && sample.column === current.column;
    sampleSelect.appendChild(option);
  }
  container.append(sampleLabel, sampleSelect);

  const fields = document.createElement('div');
  const renderFields = () => {
    fields.innerHTML = '';
    const [row, column] = sampleSelect.value.split(':').map(Number);
    selectedSamples.set(patch, { row, column });
    const sample = model.samples.find(item => item.row === row && item.column === column);
    if (!sample) return;
    appendField(fields, 'Height', sample.height, 'number', value => editor.updateTerrainSample(patch, row, column, { height: Number(value) }));
    appendField(fields, 'Texture', sample.texture, 'text', value => editor.updateTerrainSample(patch, row, column, { texture: value }));
    const numericFields: Array<[string, keyof Omit<TerrainInspectorSample, 'texture'|'row'|'column'|'height'>]> = [
      ['Offset X', 'offsetX'], ['Offset Y', 'offsetY'], ['Scale X', 'scaleX'], ['Scale Y', 'scaleY'],
      ['Rotation', 'rotation'], ['Content flags', 'contentFlags'], ['Surface flags', 'surfaceFlags'], ['Value', 'value'],
    ];
    for (const [label, key] of numericFields) {
      appendField(fields, label, sample[key], 'number', value => editor.updateTerrainSample(patch, row, column, { [key]: Number(value) }));
    }
  };
  sampleSelect.addEventListener('change', renderFields);
  renderFields();
  container.appendChild(fields);
}
