import type { Editor } from './editor';
import { getSelectedBrushItems, getSelectedPatchItems } from './editor-selection';
import { exportGeometryObj, type ObjExportGeometry } from './geometry-obj-export';

function download(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'preferences-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  row.append(caption, control);
  return row;
}

export function openGeometryExportDialog(editor: Editor): void {
  document.getElementById('geometry-export-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'geometry-export-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'geometry-export-title');

  const dialog = document.createElement('form');
  dialog.className = 'editor-dialog geometry-export-dialog';
  const title = document.createElement('div');
  title.id = 'geometry-export-title';
  title.className = 'editor-dialog-title';
  title.textContent = 'Export Geometry';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Export brush and patch triangles as Wavefront OBJ. Texture V coordinates are converted to OBJ convention.';

  const scope = document.createElement('select');
  const selected = document.createElement('option');
  selected.value = 'selection'; selected.textContent = 'Current selection';
  const whole = document.createElement('option');
  whole.value = 'map'; whole.textContent = 'Whole map';
  scope.append(selected, whole);
  if (editor.selection.length === 0) scope.value = 'map';

  const subdivisions = document.createElement('input');
  subdivisions.type = 'number';
  subdivisions.min = '1';
  subdivisions.max = '32';
  subdivisions.value = '8';

  const materials = document.createElement('input');
  materials.type = 'checkbox';
  materials.checked = true;
  const fields = document.createElement('div');
  fields.className = 'geometry-export-fields';
  fields.append(
    field('Scope', scope),
    field('Patch subdivisions', subdivisions),
    field('Write material file', materials),
  );

  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit'; save.className = 'btn primary'; save.textContent = 'Export';
  actions.append(cancel, save);
  dialog.append(title, description, fields, actions);
  overlay.append(dialog);
  document.body.append(overlay);

  const close = () => overlay.remove();
  cancel.onclick = close;
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); event.stopPropagation(); }
  });
  dialog.onsubmit = event => {
    event.preventDefault();
    const useSelection = scope.value === 'selection';
    const brushItems = useSelection ? getSelectedBrushItems(editor) : [...editor.allBrushes()];
    const patchItems = useSelection ? getSelectedPatchItems(editor) : [...editor.allPatches()];
    if (brushItems.length === 0 && patchItems.length === 0) {
      editor.statusMessage = 'Export Geometry: no brush or patch geometry in scope';
      return;
    }
    const grouped = new Map<object, ObjExportGeometry>();
    for (const item of [...brushItems, ...patchItems]) {
      let group = grouped.get(item.entity);
      if (!group) {
        group = { name: item.entity.classname, brushes: [], patches: [] };
        grouped.set(item.entity, group);
      }
      if ('brush' in item) (group.brushes as typeof brushItems[number]['brush'][]).push(item.brush);
      else (group.patches as typeof patchItems[number]['patch'][]).push(item.patch);
    }
    const baseName = editor.fileName.replace(/\.map$/i, '') || 'map';
    const result = exportGeometryObj([...grouped.values()], {
      subdivisions: Number(subdivisions.value),
      materialLibrary: materials.checked ? `${baseName}.mtl` : undefined,
      textureSize: texture => {
        const inspected = editor.textureManager?.inspectTexture(texture);
        const image = inspected?.image && typeof inspected.image === 'object'
          ? inspected.image as Record<string, unknown>
          : null;
        return typeof image?.width === 'number' && typeof image?.height === 'number'
          ? { width: image.width, height: image.height }
          : null;
      },
    });
    download(`${baseName}.obj`, result.obj);
    if (materials.checked) download(`${baseName}.mtl`, result.mtl);
    editor.statusMessage = `Exported ${result.triangleCount} triangles with ${result.materialCount} materials`;
    close();
  };
  scope.focus();
}
