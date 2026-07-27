import type { Editor } from './editor';

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = primary ? 'btn primary' : 'btn'; result.textContent = label; result.onclick = action;
  return result;
}

function numberInput(value: number, min?: number): HTMLInputElement {
  const result = document.createElement('input');
  result.type = 'number'; result.step = 'any'; result.value = String(value);
  if (min !== undefined) result.min = String(min);
  return result;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const result = document.createElement('label');
  result.className = 'surface-alignment-field';
  result.append(Object.assign(document.createElement('span'), { textContent: label }), control);
  return result;
}

export function openSurfaceAlignmentDialog(editor: Editor): void {
  document.getElementById('surface-alignment-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'surface-alignment-dialog'; overlay.className = 'editor-dialog-overlay';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  const dialog = document.createElement('div');
  dialog.className = 'editor-dialog surface-alignment-dialog';
  const title = document.createElement('div');
  title.className = 'editor-dialog-title'; title.textContent = 'Surface Alignment';
  const description = document.createElement('div');
  description.className = 'editor-dialog-description';
  description.textContent = 'The first selected face or patch is the source. Texture axes remain visible in the viewports while this dialog is open.';
  const body = document.createElement('div');
  body.className = 'surface-alignment-body';
  const status = document.createElement('div');
  status.className = 'surface-alignment-status';
  const updateStatus = () => {
    editor.updateTextureAxisOverlay();
    const report = editor.textureDensityReport();
    status.textContent = report
      ? `${report.count} faces · ${report.minimum.toFixed(3)}–${report.maximum.toFixed(3)} texels/unit · median ${report.median.toFixed(3)}${report.inconsistent ? ` · ${report.inconsistent} inconsistent` : ''}`
      : `${editor.selection.filter(item => item.type === 'patch').length} patches selected`;
  };
  editor.updateTextureAxisOverlay();

  if (editor.textureDensityReport() !== null) {
    const transfer = document.createElement('section');
    transfer.innerHTML = '<h3>Projection transfer and continuity</h3>';
    const projectionMode = document.createElement('select');
    projectionMode.append(
      Object.assign(document.createElement('option'), { value: 'world', textContent: 'World-aligned / continuous' }),
      Object.assign(document.createElement('option'), { value: 'local', textContent: 'Local projection values' }),
    );
    const transferActions = document.createElement('div');
    transferActions.className = 'surface-alignment-actions';
    transferActions.append(
      field('Transfer mode', projectionMode),
      button('Copy Source Projection', () => { editor.copyTextureProjection(projectionMode.value as 'world' | 'local'); updateStatus(); }, true),
      button('Align Adjacent Chain', () => { editor.alignTextureFaceChain(); updateStatus(); }),
      button('Wrap Convex Loop', () => { editor.wrapTextureSelection(); updateStatus(); }),
      button('Fit Current Bounds', () => { editor.fitTexture(); updateStatus(); }),
      button('Fit Width', () => { editor.fitTexture('width'); updateStatus(); }),
      button('Fit Height', () => { editor.fitTexture('height'); updateStatus(); }),
    );
    transfer.appendChild(transferActions);

    const manipulator = document.createElement('section');
    manipulator.innerHTML = '<h3>Live projection controls</h3>';
    const sliderGrid = document.createElement('div');
    sliderGrid.className = 'surface-slider-grid';
    const shiftU = document.createElement('input'); shiftU.type = 'range'; shiftU.min = '-128'; shiftU.max = '128'; shiftU.step = '1'; shiftU.value = '0';
    const shiftV = shiftU.cloneNode() as HTMLInputElement;
    const scale = document.createElement('input'); scale.type = 'range'; scale.min = '-100'; scale.max = '100'; scale.step = '1'; scale.value = '0';
    const rotate = document.createElement('input'); rotate.type = 'range'; rotate.min = '-180'; rotate.max = '180'; rotate.step = '1'; rotate.value = '0';
    let previousU = 0; let previousV = 0; let previousScale = 0; let previousRotate = 0;
    shiftU.oninput = () => { const value = Number(shiftU.value); editor.shiftTexture(value - previousU, 0); previousU = value; updateStatus(); };
    shiftV.oninput = () => { const value = Number(shiftV.value); editor.shiftTexture(0, value - previousV); previousV = value; updateStatus(); };
    scale.oninput = () => { const value = Number(scale.value); editor.scaleTexture((value - previousScale) * 0.005); previousScale = value; updateStatus(); };
    rotate.oninput = () => { const value = Number(rotate.value); editor.rotateTexture(value - previousRotate); previousRotate = value; updateStatus(); };
    sliderGrid.append(field('Shift U', shiftU), field('Shift V', shiftV), field('Scale', scale), field('Rotation', rotate));
    manipulator.appendChild(sliderGrid);

    const density = document.createElement('section');
    density.innerHTML = '<h3>Texel density and real-world fit</h3>';
    const densityInput = numberInput(editor.textureDensityReport()?.median ?? 2, 0.001);
    const unitsInput = numberInput(128, 0.001);
    const densityActions = document.createElement('div');
    densityActions.className = 'surface-alignment-actions';
    densityActions.append(
      field('Texels per map unit', densityInput),
      button('Set Density', () => { editor.setTextureDensity(Number(densityInput.value)); updateStatus(); }),
      field('Map units per repeat', unitsInput),
      button('Fit by Map Units', () => { editor.fitTextureByMapUnits(Number(unitsInput.value)); updateStatus(); }),
    );
    density.appendChild(densityActions);
    body.append(transfer, manipulator, density);
  }

  if (editor.selection.some(item => item.type === 'patch')) {
    const patches = document.createElement('section');
    patches.innerHTML = '<h3>Patch UV seams and direction</h3>';
    const units = numberInput(128, 0.001);
    const actions = document.createElement('div');
    actions.className = 'surface-alignment-actions';
    actions.append(
      button('Align Closest Boundaries', () => { editor.alignPatchBoundaries(); updateStatus(); }, true),
      button('Copy Source UV Grid', () => { editor.copyPatchUV(); updateStatus(); }),
      field('Natural repeat units', units),
      button('Naturalize by Surface Distance', () => { editor.naturalizePatchesByDistance(Number(units.value)); updateStatus(); }),
    );
    patches.appendChild(actions);
    body.appendChild(patches);
  }
  body.appendChild(status);
  updateStatus();
  const close = () => {
    editor.textureAxisOverlayLines = [];
    editor.redrawRequested = true;
    overlay.remove();
  };
  const actions = document.createElement('div');
  actions.className = 'editor-dialog-actions';
  actions.appendChild(button('Close', close));
  dialog.append(title, description, body, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); event.stopPropagation(); } });
}
