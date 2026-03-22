import { Editor } from './editor';
import { Brush, BrushFace } from './brush';
import { Entity } from './entity';

export class PropertiesPanel {
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  update(): void {
    if (!this.editor.dirty) return;
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

      const title = document.createElement('label');
      title.textContent = `Properties: ${entity.classname}`;
      title.style.fontWeight = 'bold';
      propsDiv.appendChild(title);

      for (const [key, value] of Object.entries(entity.properties)) {
        if (key === 'classname') continue;
        const row = document.createElement('div');
        row.className = 'kv-row';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.value = key;
        keyInput.readOnly = true;
        keyInput.style.flex = '0.6';

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = value;
        valInput.addEventListener('change', () => {
          entity.properties[key] = valInput.value;
          this.editor.dirty = true;
        });

        row.appendChild(keyInput);
        row.appendChild(valInput);
        propsDiv.appendChild(row);
      }

      // Add property button
      const addBtn = document.createElement('div');
      addBtn.className = 'btn';
      addBtn.textContent = '+ Add Key';
      addBtn.addEventListener('mousedown', () => {
        const key = prompt('Key name:');
        if (key) {
          entity.properties[key] = '';
          this.editor.dirty = true;
        }
      });
      propsDiv.appendChild(addBtn);
    } else if (sel.some(s => s.type === 'brush')) {
      const brushItems = sel.filter(s => s.type === 'brush') as Array<{ type: 'brush'; entity: Entity; brush: Brush }>;
      this.buildBrushPropsUI(propsDiv, brushItems.map(b => b.brush));
    } else {
      propsDiv.innerHTML = '<label style="color: #666">No selection</label>';
    }
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
      container.appendChild(sizeInfo);
    } else {
      const totalFaces = brushes.reduce((sum, b) => sum + b.faces.length, 0);
      const info = document.createElement('label');
      info.textContent = `${totalFaces} faces total`;
      info.style.color = '#888';
      info.style.fontSize = '11px';
      container.appendChild(info);
    }

    const allFaces = brushes.flatMap(b => b.faces);
    this.buildMultiFaceFields(container, allFaces);
  }

  private buildFacePropsUI(container: HTMLElement, face: BrushFace, brush: { faces: BrushFace[] }): void {
    const title = document.createElement('label');
    title.textContent = 'Face Properties';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    const hint = document.createElement('label');
    hint.textContent = `Face ${brush.faces.indexOf(face) + 1} of ${brush.faces.length}`;
    hint.style.color = '#888';
    hint.style.fontSize = '11px';
    container.appendChild(hint);

    // Texture name
    this.addFaceField(container, 'Texture', face.texture, 'text', (val) => {
      face.texture = val;
      this.editor.dirty = true;
    });

    // Offset X/Y
    this.addFaceNumberRow(container, 'Offset', face.offsetX, face.offsetY, 'X', 'Y', (x, y) => {
      face.offsetX = x;
      face.offsetY = y;
      this.editor.dirty = true;
    });

    // Scale X/Y
    this.addFaceNumberRow(container, 'Scale', face.scaleX, face.scaleY, 'X', 'Y', (x, y) => {
      face.scaleX = x;
      face.scaleY = y;
      this.editor.dirty = true;
    });

    // Rotation
    this.addFaceField(container, 'Rotation', String(face.rotation), 'number', (val) => {
      face.rotation = parseFloat(val) || 0;
      this.editor.dirty = true;
    });

    // Flags
    this.addFaceNumberRow(container, 'Flags', face.surfaceFlags, face.contentFlags, 'Surf', 'Cont', (s, c) => {
      face.surfaceFlags = s;
      face.contentFlags = c;
      this.editor.dirty = true;
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
    container.appendChild(hint);

    this.buildMultiFaceFields(container, faces);
  }

  private buildMultiFaceFields(container: HTMLElement, faces: BrushFace[]): void {
    // Texture
    const textures = new Set(faces.map(f => f.texture));
    const commonTex = textures.size === 1 ? [...textures][0] : '';
    this.addFaceField(container, 'Texture', commonTex, 'text', (val) => {
      for (const f of faces) f.texture = val;
      this.editor.currentTexture = val;
      this.editor.dirty = true;
    }, textures.size > 1 ? `(${textures.size} textures)` : undefined);

    // Offset
    const sameOx = faces.every(f => f.offsetX === faces[0].offsetX);
    const sameOy = faces.every(f => f.offsetY === faces[0].offsetY);
    this.addFaceNumberRow(container, 'Offset',
      sameOx ? faces[0].offsetX : null, sameOy ? faces[0].offsetY : null, 'X', 'Y', (x, y) => {
      for (const f of faces) { f.offsetX = x; f.offsetY = y; }
      this.editor.dirty = true;
    });

    // Scale
    const sameSx = faces.every(f => f.scaleX === faces[0].scaleX);
    const sameSy = faces.every(f => f.scaleY === faces[0].scaleY);
    this.addFaceNumberRow(container, 'Scale',
      sameSx ? faces[0].scaleX : null, sameSy ? faces[0].scaleY : null, 'X', 'Y', (x, y) => {
      for (const f of faces) { f.scaleX = x; f.scaleY = y; }
      this.editor.dirty = true;
    });

    // Rotation
    const sameRot = faces.every(f => f.rotation === faces[0].rotation);
    this.addFaceField(container, 'Rotation', sameRot ? String(faces[0].rotation) : '', 'number', (val) => {
      const r = parseFloat(val) || 0;
      for (const f of faces) f.rotation = r;
      this.editor.dirty = true;
    }, sameRot ? undefined : '(mixed)');

    // Flags
    const sameSurf = faces.every(f => f.surfaceFlags === faces[0].surfaceFlags);
    const sameCont = faces.every(f => f.contentFlags === faces[0].contentFlags);
    this.addFaceNumberRow(container, 'Flags',
      sameSurf ? faces[0].surfaceFlags : null, sameCont ? faces[0].contentFlags : null, 'Surf', 'Cont', (s, c) => {
      for (const f of faces) { f.surfaceFlags = s; f.contentFlags = c; }
      this.editor.dirty = true;
    });
  }

  private addFaceField(container: HTMLElement, label: string, value: string, type: string, onChange: (val: string) => void, placeholder?: string): void {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.marginTop = '4px';
    lbl.style.fontSize = '11px';
    container.appendChild(lbl);

    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    if (type === 'number') input.step = 'any';
    input.addEventListener('change', () => onChange(input.value));
    container.appendChild(input);
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
