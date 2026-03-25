import { type BrushFace, textureAxisFromPlane } from './brush';
import { vec3Dot } from './math';
import type { Editor } from './editor';

export function setTexture(editor: Editor, texture: string): void {
  editor.currentTexture = texture;
  for (const item of editor.selection) {
    if (item.type === 'face') {
      item.face.texture = texture;
    } else if (item.type === 'brush') {
      for (const face of item.brush.faces) {
        face.texture = texture;
      }
    } else if (item.type === 'patch') {
      item.patch.texture = texture;
    }
  }
  editor.dirty = true;
}

export function getTextureFaces(editor: Editor): BrushFace[] {
  const faces: BrushFace[] = [];
  for (const item of editor.selection) {
    if (item.type === 'face') {
      faces.push(item.face);
    } else if (item.type === 'brush') {
      faces.push(...item.brush.faces);
    }
  }
  return faces;
}

export function shiftTexture(editor: Editor, du: number, dv: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.snapshot();
  for (const face of faces) {
    face.offsetX += du;
    face.offsetY += dv;
  }
  editor.dirty = true;
}

export function scaleTexture(editor: Editor, ds: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.snapshot();
  for (const face of faces) {
    face.scaleX = Math.max(0.01, face.scaleX + ds);
    face.scaleY = Math.max(0.01, face.scaleY + ds);
  }
  editor.dirty = true;
}

export function rotateTexture(editor: Editor, angle: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.snapshot();
  for (const face of faces) {
    face.rotation = ((face.rotation + angle) % 360 + 360) % 360;
  }
  editor.dirty = true;
}

export function resetTextureAlignment(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.snapshot();
  for (const face of faces) {
    face.offsetX = 0;
    face.offsetY = 0;
    face.rotation = 0;
    face.scaleX = 0.5;
    face.scaleY = 0.5;
  }
  editor.dirty = true;
  editor.statusMessage = 'Texture alignment reset';
}

export function fitTexture(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0 || !editor.textureManager) return;
  editor.snapshot();
  for (const face of faces) {
    if (face.polygon.length < 3) continue;
    const texInfo = editor.textureManager.getIfLoaded(face.texture);
    const textureWidth = texInfo?.width ?? 128;
    const textureHeight = texInfo?.height ?? 128;

    const [sv, tv] = textureAxisFromPlane(face.plane.normal);

    let minS = Infinity;
    let maxS = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    for (const vertex of face.polygon) {
      const s = vec3Dot(vertex, sv);
      const t = vec3Dot(vertex, tv);
      minS = Math.min(minS, s);
      maxS = Math.max(maxS, s);
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }

    const sRange = maxS - minS;
    const tRange = maxT - minT;
    if (sRange < 0.001 || tRange < 0.001) continue;

    face.scaleX = sRange / textureWidth;
    face.scaleY = tRange / textureHeight;
    face.rotation = 0;
    face.offsetX = -minS / face.scaleX;
    face.offsetY = -minT / face.scaleY;
  }
  editor.dirty = true;
  editor.statusMessage = 'Texture fit to face';
}
