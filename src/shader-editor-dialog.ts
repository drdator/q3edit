import type { Editor } from './editor';
import { loadProjectShaderFiles, saveProjectShaderFiles } from './pak-storage';
import {
  defaultProjectShaderSource,
  normalizeProjectShaderPath,
  validateProjectShaderFiles,
} from './q3-shader-source';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = primary ? 'btn primary' : 'btn';
  result.textContent = label;
  result.onclick = action;
  return result;
}

export async function openShaderEditorDialog(editor: Editor): Promise<void> {
  document.getElementById('shader-editor-dialog')?.remove();
  const textureManager = editor.textureManager;
  if (!textureManager) {
    editor.statusMessage = 'Shader Editor is available after assets finish loading';
    return;
  }
  let files = await loadProjectShaderFiles();
  if (Object.keys(files).length === 0) {
    files = { 'scripts/q3edit_custom.shader': defaultProjectShaderSource() };
  }
  let currentPath = Object.keys(files).sort()[0];
  let saveTimer: number | null = null;

  const overlay = document.createElement('div');
  overlay.id = 'shader-editor-dialog';
  overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog shader-editor-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title';
  title.textContent = 'Q3 Shader Editor';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'Project-local shader files are previewed in the editor and included in BSP compilation and release packages. Source text is preserved verbatim.';

  const toolbar = document.createElement('div');
  toolbar.className = 'shader-editor-toolbar';
  const fileSelect = document.createElement('select');
  fileSelect.setAttribute('aria-label', 'Project shader file');
  const pathInput = document.createElement('input');
  pathInput.setAttribute('aria-label', 'Shader file path');
  pathInput.spellcheck = false;
  const source = document.createElement('textarea');
  source.className = 'shader-source-editor';
  source.spellcheck = false;
  source.setAttribute('aria-label', 'Shader source');
  const status = document.createElement('div');
  status.className = 'shader-editor-status';
  const declared = document.createElement('div');
  declared.className = 'shader-editor-declared';

  const refreshFileSelect = () => {
    fileSelect.replaceChildren();
    for (const path of Object.keys(files).sort()) {
      fileSelect.appendChild(Object.assign(document.createElement('option'), {
        value: path,
        textContent: path,
      }));
    }
    fileSelect.value = currentPath;
  };
  const validateAndPreview = (scheduleSave: boolean) => {
    files[currentPath] = source.value;
    const projectValidation = validateProjectShaderFiles(files);
    const validation = projectValidation.files[currentPath];
    status.dataset.valid = String(projectValidation.valid);
    status.dataset.saved = 'false';
    const otherInvalidPaths = Object.entries(projectValidation.files)
      .filter(([path, result]) => path !== currentPath && !result.valid)
      .map(([path]) => path);
    status.textContent = !validation.valid
      ? validation.diagnostics.map(item => `Line ${item.line}: ${item.message}`).join(' · ')
      : otherInvalidPaths.length > 0
        ? `Current file valid · Fix ${otherInvalidPaths.join(', ')} before previewing or saving`
        : `${validation.shaderNames.length} shader${validation.shaderNames.length === 1 ? '' : 's'} · valid`;
    declared.textContent = validation.shaderNames.length > 0
      ? `Declared: ${validation.shaderNames.join(', ')}`
      : 'No declared shaders';
    if (!projectValidation.valid) {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      return;
    }
    textureManager.setProjectShaderFiles(files);
    editor.onShaderSourcesChanged?.();
    editor.redrawRequested = true;
    if (scheduleSave) {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => { void persist(); }, 500);
    }
  };
  const showCurrent = () => {
    refreshFileSelect();
    pathInput.value = currentPath;
    source.value = files[currentPath] ?? '';
    validateAndPreview(false);
  };
  const persist = async () => {
    if (!validateProjectShaderFiles(files).valid) return;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    await saveProjectShaderFiles(files);
    status.dataset.saved = 'true';
    status.textContent = `${status.textContent?.replace(/ · saved$/, '') ?? ''} · saved`;
  };

  fileSelect.onchange = () => {
    currentPath = fileSelect.value;
    showCurrent();
  };
  pathInput.onchange = () => {
    const nextPath = normalizeProjectShaderPath(pathInput.value);
    if (nextPath !== currentPath && files[nextPath] !== undefined) {
      status.dataset.valid = 'false';
      status.textContent = `A project shader file already exists at ${nextPath}`;
      pathInput.value = currentPath;
      return;
    }
    const contents = files[currentPath];
    delete files[currentPath];
    currentPath = nextPath;
    files[currentPath] = contents;
    validateAndPreview(true);
    refreshFileSelect();
  };
  source.oninput = () => validateAndPreview(true);

  const newFile = button('New File', () => {
    let suffix = 0;
    let path = 'scripts/q3edit_custom.shader';
    while (files[path] !== undefined) {
      suffix++;
      path = `scripts/q3edit_custom_${suffix}.shader`;
    }
    files[path] = defaultProjectShaderSource(suffix === 0 ? 'q3edit/custom' : `q3edit/custom_${suffix}`);
    currentPath = path;
    showCurrent();
    validateAndPreview(true);
    source.focus();
  });
  const deleteFile = button('Delete File', () => {
    if (Object.keys(files).length === 1) {
      status.dataset.valid = 'false';
      status.textContent = 'At least one project shader file must remain';
      return;
    }
    delete files[currentPath];
    currentPath = Object.keys(files).sort()[0];
    showCurrent();
    validateAndPreview(true);
  });
  toolbar.append(fileSelect, newFile, deleteFile);
  const body = document.createElement('div');
  body.className = 'shader-editor-body';
  const pathField = document.createElement('label');
  pathField.className = 'shader-editor-path';
  pathField.append(Object.assign(document.createElement('span'), { textContent: 'Package path' }), pathInput);
  body.append(toolbar, pathField, source, declared, status);

  const close = async () => {
    files[currentPath] = source.value;
    const validation = validateProjectShaderFiles(files);
    if (validation.valid) await persist();
    else textureManager.setProjectShaderFiles(await loadProjectShaderFiles());
    editor.onShaderSourcesChanged?.();
    overlay.remove();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.append(
    button('Save', () => {
      files[currentPath] = source.value;
      if (validateProjectShaderFiles(files).valid) void persist();
    }, true),
    button('Close', () => { void close(); }),
  );
  dialog.append(title, description, body, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      void close();
      event.stopPropagation();
    }
  });
  showCurrent();
  source.focus();
}
