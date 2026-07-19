import { type BrushFace, textureAxisFromPlane } from './brush';
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

export function shiftTexture(editor: Editor, du: number, dv: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Shift texture', () => {
    for (const face of faces) {
      face.offsetX += du;
      face.offsetY += dv;
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'shift-texture' });
}

export function scaleTexture(editor: Editor, ds: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Scale texture', () => {
    for (const face of faces) {
      face.scaleX = Math.max(0.01, face.scaleX + ds);
      face.scaleY = Math.max(0.01, face.scaleY + ds);
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'scale-texture' });
}

export function rotateTexture(editor: Editor, angle: number): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Rotate texture', () => {
    for (const face of faces) {
      face.rotation = ((face.rotation + angle) % 360 + 360) % 360;
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'rotate-texture' });
}

export function resetTextureAlignment(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact('Reset texture alignment', () => {
    for (const face of faces) {
      face.offsetX = 0;
      face.offsetY = 0;
      face.rotation = 0;
      face.scaleX = 0.5;
      face.scaleY = 0.5;
    }
    editor.redrawRequested = true;
    editor.statusMessage = 'Texture alignment reset';
  });
}

export function fitTexture(editor: Editor): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0 || !editor.textureManager) return;
  editor.transact('Fit texture', () => {
    for (const face of faces) {
      if (face.polygon.length < 3) continue;
      const texInfo = editor.textureManager!.getIfLoaded(face.texture);
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
