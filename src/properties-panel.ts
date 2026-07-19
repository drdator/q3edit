import { Editor } from './editor';
import { Brush, BrushFace, classicTextureProjection, type ClassicBrushTextureProjection } from './brush';
import { Entity } from './entity';
import { getEntityClassRegistry } from './entity-definitions';
import { buildDefinedEntityProperties } from './entity-property-panel';
import {
  addEntityProperty,
  removeEntityProperty,
  renameEntityProperty,
  setEntityClassname,
  setEntityProperty,
  updateBrushPrimitiveMatrixEntry,
  updateFaceProperties,
} from './editor-properties';

/** Convert Q3 "r g b" (0-1 floats) to "#rrggbb" hex */
function q3ColorToHex(value: string): string {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
    const toHex = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
  }
  return '#ffffff';
}

export class PropertiesPanel {
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  update(): void {
    if (!this.editor.redrawRequested) return;
    const propsDiv = document.getElementById('entity-props')!;
    const sel = this.editor.selection;

    propsDiv.innerHTML = '';

    const faceItems = sel.filter(s => s.type === 'face') as Array<{ type: 'face'; entity: Entity; brush: Brush; face: BrushFace }>;
    if (faceItems.length === 1) {
      this.buildFacePropsUI(propsDiv, faceItems[0].face, faceItems[0].brush);
    } else if (faceItems.length > 1) {
      this.buildMultiFacePropsUI(propsDiv, faceItems.map(f => f.face));
    } else if (sel.length === 1 && sel[0].type === 'entity') {
      const entity = sel[0].entity;
      const isWorldspawn = this.editor.entities[0] === entity;

      const title = document.createElement('label');
      title.textContent = `Properties: ${entity.classname}`;
      title.style.fontWeight = 'bold';
      propsDiv.appendChild(title);

      const classLabel = document.createElement('label');
      classLabel.textContent = 'Classname';
      classLabel.style.marginTop = '4px';
      classLabel.style.fontSize = '11px';
      propsDiv.appendChild(classLabel);

      if (isWorldspawn) {
        const classValue = document.createElement('input');
        classValue.type = 'text';
        classValue.value = entity.classname;
        classValue.disabled = true;
        propsDiv.appendChild(classValue);
      } else {
        const classInput = document.createElement('input');
        classInput.type = 'text';
        classInput.value = entity.classname;
        classInput.spellcheck = false;
        classInput.autocomplete = 'off';
        classInput.setAttribute('list', this.ensureEntityClassDatalist());
        classInput.addEventListener('change', () => {
          const nextClassname = classInput.value.trim();
          if (!nextClassname) {
            classInput.value = entity.classname;
            return;
          }
          setEntityClassname(this.editor, entity, nextClassname);
        });
        propsDiv.appendChild(classInput);
      }

      const classDefinition = getEntityClassRegistry().get(entity.classname);
      if (classDefinition) buildDefinedEntityProperties(propsDiv, this.editor, entity, classDefinition);

      for (const [key, value] of Object.entries(entity.properties)) {
        if (key === 'classname' || key === 'spawnflags' || classDefinition?.properties[key]) continue;
        const row = document.createElement('div');
        row.className = 'kv-row';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.value = key;
        keyInput.style.flex = '0.6';
        let currentKey = key;
        keyInput.addEventListener('change', () => {
          const newKey = keyInput.value.trim();
          if (!newKey || newKey === currentKey) { keyInput.value = currentKey; return; }
          if (newKey in entity.properties) { keyInput.value = currentKey; return; }
          if (renameEntityProperty(this.editor, entity, currentKey, newKey)) {
            currentKey = newKey;
          }
        });

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = value;
        valInput.addEventListener('change', () => {
          setEntityProperty(this.editor, entity, currentKey, valInput.value);
          if (colorSwatch) colorSwatch.style.backgroundColor = q3ColorToHex(valInput.value);
        });

        // Color picker for _color keys
        let colorSwatch: HTMLElement | null = null;
        if (key === '_color') {
          colorSwatch = document.createElement('div');
          colorSwatch.className = 'kv-color';
          colorSwatch.style.backgroundColor = q3ColorToHex(value);
          const hiddenInput = document.createElement('input');
          hiddenInput.type = 'color';
          hiddenInput.style.position = 'absolute';
          hiddenInput.style.opacity = '0';
          hiddenInput.style.width = '0';
          hiddenInput.style.height = '0';
          hiddenInput.style.pointerEvents = 'none';
          hiddenInput.value = q3ColorToHex(value);
          colorSwatch.appendChild(hiddenInput);
          colorSwatch.addEventListener('mousedown', (e) => { e.stopPropagation(); hiddenInput.click(); });
          hiddenInput.addEventListener('input', () => {
            const hex = hiddenInput.value;
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            const q3 = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
            valInput.value = q3;
            setEntityProperty(this.editor, entity, currentKey, q3);
            colorSwatch!.style.backgroundColor = hex;
          });
        }

        const delBtn = document.createElement('div');
        delBtn.className = 'btn icon-btn kv-del';
        delBtn.innerHTML = '<i class="ph ph-trash"></i>';
        delBtn.title = 'Remove property';
        delBtn.addEventListener('mousedown', () => {
          removeEntityProperty(this.editor, entity, currentKey);
        });

        row.appendChild(keyInput);
        row.appendChild(valInput);
        if (colorSwatch) row.appendChild(colorSwatch);
        row.appendChild(delBtn);
        propsDiv.appendChild(row);
      }

      // Add property — just adds an empty row
      const addBtn = document.createElement('div');
      addBtn.className = 'btn';
      addBtn.innerHTML = '<i class="ph ph-plus"></i> Add Key';
      addBtn.addEventListener('mousedown', () => {
        addEntityProperty(this.editor, entity);
      });
      propsDiv.appendChild(addBtn);
    } else if (sel.some(s => s.type === 'brush')) {
      const brushItems = sel.filter(s => s.type === 'brush') as Array<{ type: 'brush'; entity: Entity; brush: Brush }>;
      this.buildBrushPropsUI(propsDiv, brushItems.map(b => b.brush));
    } else {
      propsDiv.innerHTML = '<label style="color: #666">No selection</label>';
    }
  }

  private ensureEntityClassDatalist(): string {
    const listId = 'entity-class-suggestions';
    let list = document.getElementById(listId) as HTMLDataListElement | null;
    if (!list) {
      list = document.createElement('datalist');
      list.id = listId;
      document.body.appendChild(list);
    }
    list.innerHTML = '';
    for (const definition of getEntityClassRegistry().list()) {
      const option = document.createElement('option');
      option.value = definition.classname;
      list.appendChild(option);
    }
    return listId;
  }

  private buildBrushPropsUI(container: HTMLElement, brushes: Brush[]): void {
    const title = document.createElement('label');
    title.textContent = brushes.length === 1 ? 'Brush Properties' : `${brushes.length} Brushes Selected`;
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    if (brushes.length === 1) {
      const brush = brushes[0];
      const info = document.createElement('label');
      info.textContent = `${brush.faces.length} faces`;
      info.style.color = '#888';
      info.style.fontSize = '11px';
      container.appendChild(info);

      const size = [
        (brush.maxs[0] - brush.mins[0]).toFixed(0),
        (brush.maxs[1] - brush.mins[1]).toFixed(0),
        (brush.maxs[2] - brush.mins[2]).toFixed(0),
      ];
      const sizeInfo = document.createElement('label');
      sizeInfo.textContent = `Size: ${size.join(' x ')}`;
      sizeInfo.style.marginBottom = '10px';
      container.appendChild(sizeInfo);
    } else {
      const totalFaces = brushes.reduce((sum, b) => sum + b.faces.length, 0);
      const info = document.createElement('label');
      info.textContent = `${totalFaces} faces total`;
      info.style.color = '#888';
      info.style.fontSize = '11px';
      info.style.marginBottom = '10px';
      container.appendChild(info);
    }

    const detailStates = brushes.map(brush => this.editor.brushDetailState(brush));
    const detailState = detailStates.every(state => state === true)
      ? true
      : detailStates.every(state => state === false)
        ? false
        : null;

    const classInfo = document.createElement('label');
    classInfo.textContent = `Classification: ${detailState === null ? 'Mixed' : detailState ? 'Detail' : 'Structural'}`;
    classInfo.style.marginBottom = '8px';
    container.appendChild(classInfo);

    const classRow = document.createElement('div');
    classRow.className = 'kv-row';

    const detailBtn = document.createElement('div');
    detailBtn.className = 'btn';
    detailBtn.textContent = 'Make Detail';
    detailBtn.addEventListener('mousedown', () => this.editor.makeDetail());

    const structuralBtn = document.createElement('div');
    structuralBtn.className = 'btn';
    structuralBtn.textContent = 'Make Structural';
    structuralBtn.addEventListener('mousedown', () => this.editor.makeStructural());

    classRow.appendChild(detailBtn);
    classRow.appendChild(structuralBtn);
    container.appendChild(classRow);

    const allFaces = brushes.flatMap(b => b.faces);
    this.buildMultiFaceFields(container, allFaces);
  }

  private buildFacePropsUI(container: HTMLElement, face: BrushFace, brush: { faces: BrushFace[] }): void {
    const projection = classicTextureProjection(face);
    const title = document.createElement('label');
    title.textContent = 'Face Properties';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    const hint = document.createElement('label');
    hint.textContent = `Face ${brush.faces.indexOf(face) + 1} of ${brush.faces.length}`;
    hint.style.color = '#888';
    hint.style.fontSize = '11px';
    hint.style.marginBottom = '10px';
    container.appendChild(hint);

    // Texture name
    this.addFaceField(container, 'Texture', face.texture, 'text', (val) => {
      updateFaceProperties(this.editor, [face], 'Change face texture', { texture: val });
    }, { locateTexture: true });

    if (projection) {
      this.addFaceNumberRow(container, 'Offset', projection.offsetX, projection.offsetY, 'X', 'Y', (x, y) => {
        updateFaceProperties(this.editor, [face], 'Edit face offset', { offsetX: x, offsetY: y });
      });
      this.addFaceNumberRow(container, 'Scale', projection.scaleX, projection.scaleY, 'X', 'Y', (x, y) => {
        updateFaceProperties(this.editor, [face], 'Edit face scale', { scaleX: x, scaleY: y });
      });
      this.addFaceField(container, 'Rotation', String(projection.rotation), 'number', (val) => {
        updateFaceProperties(this.editor, [face], 'Edit face rotation', { rotation: parseFloat(val) || 0 });
      });
    } else {
      this.addBrushPrimitiveMatrixFields(container, [face]);
    }

    // Flags
    this.addFaceNumberRow(container, 'Flags', face.surfaceFlags, face.contentFlags, 'Surf', 'Cont', (s, c) => {
      updateFaceProperties(this.editor, [face], 'Edit face flags', { surfaceFlags: s, contentFlags: c });
    });
  }

  private buildMultiFacePropsUI(container: HTMLElement, faces: BrushFace[]): void {
    const title = document.createElement('label');
    title.textContent = 'Face Properties';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    const hint = document.createElement('label');
    hint.textContent = `${faces.length} faces selected`;
    hint.style.color = '#888';
    hint.style.fontSize = '11px';
    hint.style.marginBottom = '10px';
    container.appendChild(hint);

    this.buildMultiFaceFields(container, faces);
  }

  private buildMultiFaceFields(container: HTMLElement, faces: BrushFace[]): void {
    // Texture
    const textures = new Set(faces.map(f => f.texture));
    const commonTex = textures.size === 1 ? [...textures][0] : '';
    this.addFaceField(container, 'Texture', commonTex, 'text', (val) => {
      updateFaceProperties(this.editor, faces, 'Change face textures', { texture: val });
      this.editor.currentTexture = val;
    }, { placeholder: textures.size > 1 ? `(${textures.size} textures)` : undefined, locateTexture: true });

    const projections = faces.map(face => classicTextureProjection(face));
    const allClassic = projections.every((projection): projection is ClassicBrushTextureProjection => projection !== null);

    if (allClassic) {
      // Offset
      const sameOx = projections.every(projection => projection.offsetX === projections[0].offsetX);
      const sameOy = projections.every(projection => projection.offsetY === projections[0].offsetY);
      this.addFaceNumberRow(container, 'Offset',
        sameOx ? projections[0].offsetX : null, sameOy ? projections[0].offsetY : null, 'X', 'Y', (x, y) => {
        updateFaceProperties(this.editor, faces, 'Edit face offsets', { offsetX: x, offsetY: y });
      });

      // Scale
      const sameSx = projections.every(projection => projection.scaleX === projections[0].scaleX);
      const sameSy = projections.every(projection => projection.scaleY === projections[0].scaleY);
      this.addFaceNumberRow(container, 'Scale',
        sameSx ? projections[0].scaleX : null, sameSy ? projections[0].scaleY : null, 'X', 'Y', (x, y) => {
        updateFaceProperties(this.editor, faces, 'Edit face scales', { scaleX: x, scaleY: y });
      });

      // Rotation
      const sameRot = projections.every(projection => projection.rotation === projections[0].rotation);
      this.addFaceField(container, 'Rotation', sameRot ? String(projections[0].rotation) : '', 'number', (val) => {
        const r = parseFloat(val) || 0;
        updateFaceProperties(this.editor, faces, 'Edit face rotations', { rotation: r });
      }, sameRot ? undefined : { placeholder: '(mixed)' });
    } else if (faces.every(face => face.textureProjection.kind === 'brush-primitive')) {
      this.addBrushPrimitiveMatrixFields(container, faces);
    } else {
      const projectionHint = document.createElement('label');
      projectionHint.textContent = 'Texture alignment fields require classic brush projections.';
      projectionHint.style.color = '#888';
      projectionHint.style.fontSize = '11px';
      container.appendChild(projectionHint);
    }

    // Flags
    const sameSurf = faces.every(f => f.surfaceFlags === faces[0].surfaceFlags);
    const sameCont = faces.every(f => f.contentFlags === faces[0].contentFlags);
    this.addFaceNumberRow(container, 'Flags',
      sameSurf ? faces[0].surfaceFlags : null, sameCont ? faces[0].contentFlags : null, 'Surf', 'Cont', (s, c) => {
      updateFaceProperties(this.editor, faces, 'Edit face flags', { surfaceFlags: s, contentFlags: c });
    });
  }

  private addBrushPrimitiveMatrixFields(container: HTMLElement, faces: BrushFace[]): void {
    const labels = [
      ['S/X', 0, 0], ['S/Y', 0, 1], ['S/Offset', 0, 2],
      ['T/X', 1, 0], ['T/Y', 1, 1], ['T/Offset', 1, 2],
    ] as const;
    for (const [label, row, column] of labels) {
      const values = faces.flatMap(face => face.textureProjection.kind === 'brush-primitive'
        ? [face.textureProjection.matrix[row][column]]
        : []);
      const common = values.length > 0 && values.every(value => value === values[0]);
      this.addFaceField(container, label, common ? String(values[0]) : '', 'number', value => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          updateBrushPrimitiveMatrixEntry(this.editor, faces, row, column, parsed);
        }
      }, common ? undefined : { placeholder: '(mixed)' });
    }
  }

  private addFaceField(container: HTMLElement, label: string, value: string, type: string, onChange: (val: string) => void, opts?: { placeholder?: string; locateTexture?: boolean }): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.marginTop = '4px';
    lbl.style.fontSize = '11px';
    container.appendChild(lbl);

    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (opts?.placeholder) input.placeholder = opts.placeholder;
    if (type === 'number') input.step = 'any';
    if (type === 'text') {
      input.spellcheck = false;
      input.autocomplete = 'off';
    }
    input.addEventListener('change', () => onChange(input.value));

    if (opts?.locateTexture) {
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.appendChild(input);
      const locBtn = document.createElement('div');
      locBtn.className = 'btn icon-btn';
      locBtn.title = 'Locate in texture browser';
      locBtn.innerHTML = '<i class="ph ph-crosshair"></i>';
      locBtn.addEventListener('mousedown', () => {
        const tex = input.value || this.editor.currentTexture;
        if (tex) this.editor.onLocateTexture?.(tex);
      });
      row.appendChild(locBtn);
      container.appendChild(row);
    } else {
      container.appendChild(input);
    }
  }

  private addFaceNumberRow(
    container: HTMLElement,
    label: string,
    valA: number | null, valB: number | null,
    labelA: string, labelB: string,
    onChange: (a: number, b: number) => void
  ): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.marginTop = '4px';
    lbl.style.fontSize = '11px';
    container.appendChild(lbl);

    const row = document.createElement('div');
    row.className = 'kv-row';

    const inputA = document.createElement('input');
    inputA.type = 'number';
    inputA.step = 'any';
    inputA.value = valA !== null ? String(valA) : '';
    inputA.placeholder = valA === null ? '(mixed)' : labelA;
    inputA.title = labelA;

    const inputB = document.createElement('input');
    inputB.type = 'number';
    inputB.step = 'any';
    inputB.value = valB !== null ? String(valB) : '';
    inputB.placeholder = valB === null ? '(mixed)' : labelB;
    inputB.title = labelB;

    const update = () => {
      onChange(parseFloat(inputA.value) || 0, parseFloat(inputB.value) || 0);
    };
    inputA.addEventListener('change', update);
    inputB.addEventListener('change', update);

    row.appendChild(inputA);
    row.appendChild(inputB);
    container.appendChild(row);
  }
}
