import { classicTextureProjection, type BrushFace, textureAxisFromPlane } from './brush';
import { vec3Dot } from './math';
import { setPatchTexture, terrainDefDisplayTexture, type Patch, type TerrainDefSurface } from './patch';
import type { Editor } from './editor';

export type TextureReplaceScope = 'selection' | 'map';
export type TextureReplaceMatch = 'exact' | 'contains';

type TextureTarget =
  | { kind: 'face'; face: BrushFace }
  | { kind: 'patch'; patch: Patch }
  | { kind: 'terrain-surface'; patch: Patch; surface: TerrainDefSurface };

function canonicalTextureName(texture: string): string {
  return texture.trim().replace(/\\/g, '/').replace(/^textures\//i, '');
}

function normalizedTextureName(texture: string): string {
  return canonicalTextureName(texture).toLowerCase();
}

function collectSelectedTextureTargets(editor: Editor): TextureTarget[] {
  const targets: TextureTarget[] = [];
  const seenFaces = new Set<BrushFace>();
  const seenPatches = new Set<Patch>();
  const seenTerrainSurfaces = new Set<TerrainDefSurface>();

  const addPatchTargets = (patch: Patch) => {
    if (!patch.terrainDef) {
      if (seenPatches.has(patch)) return;
      seenPatches.add(patch);
      targets.push({ kind: 'patch', patch });
      return;
    }
    for (const row of patch.terrainDef.surfaces) {
      for (const surface of row) {
        if (seenTerrainSurfaces.has(surface)) continue;
        seenTerrainSurfaces.add(surface);
        targets.push({ kind: 'terrain-surface', patch, surface });
      }
    }
  };

  for (const item of editor.selection) {
    if (item.type === 'entity') {
      for (const brush of item.entity.brushes) {
        for (const face of brush.faces) {
          if (seenFaces.has(face)) continue;
          seenFaces.add(face);
          targets.push({ kind: 'face', face });
        }
      }
      for (const patch of item.entity.patches) {
        addPatchTargets(patch);
      }
      continue;
    }

    if (item.type === 'brush') {
      for (const face of item.brush.faces) {
        if (seenFaces.has(face)) continue;
        seenFaces.add(face);
        targets.push({ kind: 'face', face });
      }
      continue;
    }

    if (item.type === 'face') {
      if (seenFaces.has(item.face)) continue;
      seenFaces.add(item.face);
      targets.push({ kind: 'face', face: item.face });
      continue;
    }

    addPatchTargets(item.patch);
  }

  return targets;
}

function collectMapTextureTargets(editor: Editor): TextureTarget[] {
  const targets: TextureTarget[] = [];
  for (const entity of editor.entities) {
    for (const brush of entity.brushes) {
      for (const face of brush.faces) {
        targets.push({ kind: 'face', face });
      }
    }
    for (const patch of entity.patches) {
      if (!patch.terrainDef) {
        targets.push({ kind: 'patch', patch });
        continue;
      }
      for (const row of patch.terrainDef.surfaces) {
        for (const surface of row) {
          targets.push({ kind: 'terrain-surface', patch, surface });
        }
      }
    }
  }
  return targets;
}

function textureTargetTexture(target: TextureTarget): string {
  if (target.kind === 'face') return target.face.texture;
  if (target.kind === 'patch') return target.patch.texture;
  return target.surface.texture;
}

function setTextureTarget(target: TextureTarget, texture: string): void {
  if (target.kind === 'face') {
    target.face.texture = texture;
  } else if (target.kind === 'patch') {
    setPatchTexture(target.patch, texture);
  } else {
    target.surface.texture = texture;
    target.patch.texture = terrainDefDisplayTexture(target.patch);
  }
}

export function setTexture(editor: Editor, texture: string): void {
  const nextTexture = canonicalTextureName(texture);
  if (!nextTexture) return;

  editor.currentTexture = nextTexture;
  if (editor.patchEditMode && editor.terrainBrushMode === 'texture') {
    editor.redrawRequested = true;
    editor.statusMessage = `Terrain paint texture: ${nextTexture}`;
    return;
  }
  const targets = collectSelectedTextureTargets(editor);
  editor.transact('Set texture', () => {
    for (const target of targets) {
      if (textureTargetTexture(target) === nextTexture) continue;
      setTextureTarget(target, nextTexture);
    }
  });

  editor.redrawRequested = true;
}

export function getTextureFaces(editor: Editor): BrushFace[] {
  const faces: BrushFace[] = [];
  for (const target of collectSelectedTextureTargets(editor)) {
    if (target.kind === 'face') faces.push(target.face);
  }
  return faces;
}

function faceTextureDimensions(editor: Editor, face: BrushFace): [number, number] {
  const texture = editor.textureManager?.getIfLoaded(face.texture);
  return [texture?.width ?? 128, texture?.height ?? 128];
}

export function shiftTexture(editor: Editor, du: number, dv: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Shift texture', () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (projection) {
        projection.offsetX += du;
        projection.offsetY += dv;
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        const [width, height] = faceTextureDimensions(editor, face);
        face.textureProjection.matrix[0][2] += du / width;
        face.textureProjection.matrix[1][2] += dv / height;
      }
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'shift-texture' });
}

export function scaleTexture(editor: Editor, ds: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Scale texture', () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (projection) {
        projection.scaleX = Math.max(0.01, projection.scaleX + ds);
        projection.scaleY = Math.max(0.01, projection.scaleY + ds);
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        const [width, height] = faceTextureDimensions(editor, face);
        const [uRow, vRow] = face.textureProjection.matrix;
        const uScale = 1 / Math.max(1e-9, Math.hypot(uRow[0], uRow[1]) * width);
        const vScale = 1 / Math.max(1e-9, Math.hypot(vRow[0], vRow[1]) * height);
        const nextUScale = Math.max(0.01, uScale + ds);
        const nextVScale = Math.max(0.01, vScale + ds);
        const uFactor = uScale / nextUScale;
        const vFactor = vScale / nextVScale;
        uRow[0] *= uFactor;
        uRow[1] *= uFactor;
        vRow[0] *= vFactor;
        vRow[1] *= vFactor;
      }
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'scale-texture' });
}

export function rotateTexture(editor: Editor, angle: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Rotate texture', () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (projection) {
        projection.rotation = ((projection.rotation + angle) % 360 + 360) % 360;
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        const [width, height] = faceTextureDimensions(editor, face);
        const radians = angle * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const [uRow, vRow] = face.textureProjection.matrix;
        const uPixels = uRow.map(value => value * width);
        const vPixels = vRow.map(value => value * height);
        for (let index = 0; index < 3; index++) {
          uRow[index] = (cos * uPixels[index] - sin * vPixels[index]) / width;
          vRow[index] = (sin * uPixels[index] + cos * vPixels[index]) / height;
        }
      }
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'rotate-texture' });
}

export function resetTextureAlignment(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Reset texture alignment', () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (projection) {
        projection.offsetX = 0;
        projection.offsetY = 0;
        projection.rotation = 0;
        projection.scaleX = 0.5;
        projection.scaleY = 0.5;
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        const [width, height] = faceTextureDimensions(editor, face);
        face.textureProjection.matrix = [[2 / width, 0, 0], [0, 2 / height, 0]];
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = 'Texture alignment reset';
  });
}

export function fitTexture(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Fit texture', () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (face.polygon.length < 3) continue;
      const [textureWidth, textureHeight] = faceTextureDimensions(editor, face);

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

      if (projection) {
        projection.scaleX = sRange / textureWidth;
        projection.scaleY = tRange / textureHeight;
        projection.rotation = 0;
        projection.offsetX = -minS / projection.scaleX;
        projection.offsetY = -minT / projection.scaleY;
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        face.textureProjection.matrix = [
          [1 / sRange, 0, -minS / sRange],
          [0, 1 / tRange, -minT / tRange],
        ];
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = 'Texture fit to face';
  });
}

export function replaceTextures(
  editor: Editor,
  findTexture: string,
  replaceTexture: string,
  scope: TextureReplaceScope,
  match: TextureReplaceMatch,
): number {
  const find = canonicalTextureName(findTexture);
  const replace = canonicalTextureName(replaceTexture);

  if (!find || !replace) {
    editor.statusMessage = 'Find and replace textures are required';
    return 0;
  }

  const targets = scope === 'map'
    ? collectMapTextureTargets(editor)
    : collectSelectedTextureTargets(editor);

  if (targets.length === 0) {
    editor.statusMessage = scope === 'map'
      ? 'Map contains no textured surfaces'
      : 'Nothing selected for texture replace';
    return 0;
  }

  const normalizedFind = find.toLowerCase();
  const replaced = editor.transact('Replace textures', () => {
    let count = 0;
    for (const target of targets) {
      const current = textureTargetTexture(target);
      const normalizedCurrent = normalizedTextureName(current);
      const matches = match === 'exact'
        ? normalizedCurrent === normalizedFind
        : normalizedCurrent.includes(normalizedFind);
      if (!matches || current === replace) continue;

      setTextureTarget(target, replace);
      count++;
    }
    return count;
  });

  if (replaced === 0) {
    editor.statusMessage = scope === 'map'
      ? 'No matching textures in map'
      : 'No matching textures in selection';
    return 0;
  }

  editor.currentTexture = replace;
  editor.redrawRequested = true;
  editor.statusMessage = `Replaced ${replaced} surface${replaced === 1 ? '' : 's'} in ${scope === 'map' ? 'map' : 'selection'}`;
  return replaced;
}
