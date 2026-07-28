import {
  classicTextureProjection,
  cloneTextureProjection,
  computeFaceUV,
  type BrushFace,
  type BrushTextureProjection,
  textureAxisFromPlane,
} from './brush';
import { vec3Cross, vec3Dot, vec3Length, vec3Scale, type Vec3 } from './math';
import { setPatchTexture, terrainDefDisplayTexture, type Patch, type TerrainDefSurface } from './patch';
import type { Editor } from './editor';

export type TextureReplaceScope = 'selection' | 'map';
export type TextureReplaceMatch = 'exact' | 'contains';
export type TextureProjectionMode = 'axial' | 'camera' | 'top' | 'front' | 'side';

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

export function shiftTexture(
  editor: Editor,
  du: number,
  dv: number,
  faces = getTextureFaces(editor),
): void {
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

export function scaleTexture(editor: Editor, ds: number, faces = getTextureFaces(editor)): void {
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

export function scaleTextureFromProjection(
  editor: Editor,
  face: BrushFace,
  initialProjection: BrushTextureProjection,
  factor: number,
  anchorUv: [number, number],
): void {
  const safeFactor = Math.max(0.02, Math.min(50, factor));
  editor.transact('Scale texture', () => {
    const next = cloneTextureProjection(initialProjection);
    face.textureProjection = next;
    if (next.kind === 'classic' && initialProjection.kind === 'classic') {
      const scaled = (value: number) => {
        const sign = value < 0 ? -1 : 1;
        return sign * Math.max(0.001, Math.abs(value) / safeFactor);
      };
      next.scaleX = scaled(initialProjection.scaleX);
      next.scaleY = scaled(initialProjection.scaleY);
      const center = face.polygon.reduce<Vec3>(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
        [0, 0, 0],
      ).map(value => value / Math.max(1, face.polygon.length)) as Vec3;
      const [width, height] = faceTextureDimensions(editor, face);
      const currentUv = computeFaceUV(center, face, width, height);
      next.offsetX += (anchorUv[0] - currentUv[0]) * width;
      next.offsetY += (anchorUv[1] - currentUv[1]) * height;
    } else if (next.kind === 'brush-primitive' && initialProjection.kind === 'brush-primitive') {
      for (let axis = 0; axis < 2; axis++) {
        next.matrix[axis][0] = initialProjection.matrix[axis][0] * safeFactor;
        next.matrix[axis][1] = initialProjection.matrix[axis][1] * safeFactor;
        next.matrix[axis][2] = anchorUv[axis]
          + (initialProjection.matrix[axis][2] - anchorUv[axis]) * safeFactor;
      }
    }
    editor.redrawRequested = true;
  }, { coalesceKey: 'scale-texture' });
}

export function rotateTexture(editor: Editor, angle: number, faces = getTextureFaces(editor)): void {
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

function projectedUnit(vector: Vec3, normal: Vec3): Vec3 | null {
  const projection = vector.map((value, axis) => value - normal[axis] * vec3Dot(vector, normal)) as Vec3;
  const length = vec3Length(projection);
  return length > 1e-6 ? vec3Scale(projection, 1 / length) : null;
}

function projectionHints(editor: Editor, mode: TextureProjectionMode): [Vec3, Vec3] | null {
  if (mode === 'camera') {
    const { yaw, pitch } = editor.camera3d;
    const forward: Vec3 = [
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
    ];
    const right: Vec3 = [Math.cos(yaw - Math.PI / 2), Math.sin(yaw - Math.PI / 2), 0];
    return [right, vec3Cross(forward, right)];
  }
  if (mode === 'top') return [[1, 0, 0], [0, -1, 0]];
  if (mode === 'front') return [[1, 0, 0], [0, 0, -1]];
  if (mode === 'side') return [[0, 1, 0], [0, 0, -1]];
  return null;
}

export function projectTexture(editor: Editor, mode: TextureProjectionMode): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  editor.transact(`Project texture ${mode}`, () => {
    const hints = projectionHints(editor, mode);
    for (const face of faces) {
      const [sv, tv] = textureAxisFromPlane(face.plane.normal);
      let u = sv;
      let v = tv;
      if (hints) {
        const projectedU = projectedUnit(hints[0], face.plane.normal)
          ?? projectedUnit(hints[1], face.plane.normal);
        if (!projectedU) continue;
        u = projectedU;
        const projectedV = projectedUnit(hints[1], face.plane.normal);
        const orthogonalV = projectedV
          ? projectedV.map((value, axis) => value - u[axis] * vec3Dot(projectedV, u)) as Vec3
          : vec3Cross(face.plane.normal, u);
        const vLength = vec3Length(orthogonalV);
        if (vLength < 1e-6) continue;
        v = vec3Scale(orthogonalV, 1 / vLength);
      }

      if (face.textureProjection.kind === 'classic') {
        const projection = face.textureProjection;
        const cosine = vec3Dot(u, sv);
        const sine = -vec3Dot(u, tv);
        const angle = Math.atan2(sine, cosine);
        const expectedV = sv.map((value, axis) => Math.sin(angle) * value + Math.cos(angle) * tv[axis]) as Vec3;
        const sign = vec3Dot(expectedV, v) < 0 ? -1 : 1;
        projection.rotation = ((angle * 180 / Math.PI) % 360 + 360) % 360;
        projection.scaleX = Math.abs(projection.scaleX || 0.5);
        projection.scaleY = Math.abs(projection.scaleY || 0.5) * sign;
        projection.offsetX = 0;
        projection.offsetY = 0;
      } else {
        const [width, height] = faceTextureDimensions(editor, face);
        const currentU = face.textureProjection.matrix[0];
        const currentV = face.textureProjection.matrix[1];
        const uMagnitude = Math.hypot(currentU[0], currentU[1]) || 2 / width;
        const vMagnitude = Math.hypot(currentV[0], currentV[1]) || 2 / height;
        face.textureProjection.matrix = [
          [vec3Dot(u, sv) * uMagnitude, vec3Dot(u, tv) * uMagnitude, 0],
          [vec3Dot(v, sv) * vMagnitude, vec3Dot(v, tv) * vMagnitude, 0],
        ];
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Texture projection: ${mode}`;
  });
}

export type TextureFitAxis = 'both' | 'width' | 'height';

export function fitTexture(editor: Editor, axis: TextureFitAxis = 'both'): void {
  const faces = getTextureFaces(editor);
  if (faces.length === 0) return;
  const label = axis === 'both' ? 'Fit texture' : `Fit texture ${axis}`;
  editor.transact(label, () => {
    for (const face of faces) {
      const projection = classicTextureProjection(face);
      if (face.polygon.length < 3) continue;
      const [textureWidth, textureHeight] = faceTextureDimensions(editor, face);

      const [sv, tv] = textureAxisFromPlane(face.plane.normal);
      const rotation = projection && axis !== 'both' ? projection.rotation * Math.PI / 180 : 0;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const fitS: Vec3 = sv.map((value, index) => cos * value - sin * tv[index]) as Vec3;
      const fitT: Vec3 = sv.map((value, index) => sin * value + cos * tv[index]) as Vec3;

      let minS = Infinity;
      let maxS = -Infinity;
      let minT = Infinity;
      let maxT = -Infinity;
      for (const vertex of face.polygon) {
        const s = vec3Dot(vertex, fitS);
        const t = vec3Dot(vertex, fitT);
        minS = Math.min(minS, s);
        maxS = Math.max(maxS, s);
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
      }

      const sRange = maxS - minS;
      const tRange = maxT - minT;
      if (sRange < 0.001 || tRange < 0.001) continue;

      if (projection) {
        if (axis !== 'height') {
          projection.scaleX = sRange / textureWidth;
          projection.offsetX = -minS / projection.scaleX;
        }
        if (axis !== 'width') {
          projection.scaleY = tRange / textureHeight;
          projection.offsetY = -minT / projection.scaleY;
        }
        if (axis === 'both') projection.rotation = 0;
      } else {
        if (face.textureProjection.kind !== 'brush-primitive') continue;
        if (axis === 'both') {
          face.textureProjection.matrix = [
            [1 / sRange, 0, -minS / sRange],
            [0, 1 / tRange, -minT / tRange],
          ];
        } else {
          const rowIndex = axis === 'width' ? 0 : 1;
          const row = face.textureProjection.matrix[rowIndex];
          const values = face.polygon.map(vertex => {
            const s = vec3Dot(vertex, sv);
            const t = vec3Dot(vertex, tv);
            return row[0] * s + row[1] * t + row[2];
          });
          const minimum = Math.min(...values);
          const range = Math.max(...values) - minimum;
          if (range < 0.001) continue;
          face.textureProjection.matrix[rowIndex] = [
            row[0] / range,
            row[1] / range,
            (row[2] - minimum) / range,
          ];
        }
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = axis === 'both'
      ? 'Texture fit to face'
      : `Texture ${axis} fit to face`;
  });
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.05;
}

function sharedVertices(a: BrushFace, b: BrushFace): Vec3[] {
  return a.polygon.filter(point => b.polygon.some(other => samePoint(point, other)));
}

function solveAffine(points: Array<[number, number]>, values: number[]): [number, number, number] | null {
  const [a, b, c] = points;
  const determinant = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]);
  if (Math.abs(determinant) < 1e-8) return null;
  return [
    (values[0] * (b[1] - c[1]) + values[1] * (c[1] - a[1]) + values[2] * (a[1] - b[1])) / determinant,
    (values[0] * (c[0] - b[0]) + values[1] * (a[0] - c[0]) + values[2] * (b[0] - a[0])) / determinant,
    (values[0] * (b[0] * c[1] - c[0] * b[1]) + values[1] * (c[0] * a[1] - a[0] * c[1]) + values[2] * (a[0] * b[1] - b[0] * a[1])) / determinant,
  ];
}

function targetSamplePoints(face: BrushFace): Vec3[] | null {
  for (let first = 0; first < face.polygon.length; first++) {
    for (let second = first + 1; second < face.polygon.length; second++) {
      for (let third = second + 1; third < face.polygon.length; third++) {
        const points = [face.polygon[first], face.polygon[second], face.polygon[third]];
        const [s, t] = textureAxisFromPlane(face.plane.normal);
        const local = points.map(point => [vec3Dot(point, s), vec3Dot(point, t)] as [number, number]);
        if (Math.abs(local[0][0] * (local[1][1] - local[2][1]) + local[1][0] * (local[2][1] - local[0][1]) + local[2][0] * (local[0][1] - local[1][1])) > 1e-6) return points;
      }
    }
  }
  return null;
}

function rotateVectorBetweenNormals(vector: Vec3, from: Vec3, to: Vec3): Vec3 {
  const cosine = Math.max(-1, Math.min(1, vec3Dot(from, to)));
  if (cosine > 1 - 1e-8) return [...vector];
  let axis = vec3Cross(from, to);
  let sine = vec3Length(axis);
  if (sine < 1e-8) {
    const fallback: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    axis = vec3Cross(from, fallback);
    axis = vec3Scale(axis, 1 / Math.max(1e-9, vec3Length(axis)));
    sine = 0;
  } else {
    axis = vec3Scale(axis, 1 / sine);
  }
  const cross = vec3Cross(axis, vector);
  const alongAxis = vec3Dot(axis, vector) * (1 - cosine);
  return [
    vector[0] * cosine + cross[0] * sine + axis[0] * alongAxis,
    vector[1] * cosine + cross[1] * sine + axis[1] * alongAxis,
    vector[2] * cosine + cross[2] * sine + axis[2] * alongAxis,
  ];
}

function transferAcrossSharedEdge(editor: Editor, source: BrushFace, target: BrushFace, shared: Vec3[]): boolean {
  const anchor = shared[0];
  const [sourceS, sourceT] = textureAxisFromPlane(source.plane.normal);
  const [targetS, targetT] = textureAxisFromPlane(target.plane.normal);
  if (source.textureProjection.kind === 'brush-primitive') {
    const [sourceU, sourceV] = source.textureProjection.matrix;
    const uVector = rotateVectorBetweenNormals([
      sourceS[0] * sourceU[0] + sourceT[0] * sourceU[1],
      sourceS[1] * sourceU[0] + sourceT[1] * sourceU[1],
      sourceS[2] * sourceU[0] + sourceT[2] * sourceU[1],
    ], source.plane.normal, target.plane.normal);
    const vVector = rotateVectorBetweenNormals([
      sourceS[0] * sourceV[0] + sourceT[0] * sourceV[1],
      sourceS[1] * sourceV[0] + sourceT[1] * sourceV[1],
      sourceS[2] * sourceV[0] + sourceT[2] * sourceV[1],
    ], source.plane.normal, target.plane.normal);
    const desired = computeFaceUV(anchor, source, 1, 1);
    target.textureProjection = {
      kind: 'brush-primitive',
      matrix: [
        [vec3Dot(uVector, targetS), vec3Dot(uVector, targetT), desired[0] - vec3Dot(anchor, uVector)],
        [vec3Dot(vVector, targetS), vec3Dot(vVector, targetT), desired[1] - vec3Dot(anchor, vVector)],
      ],
    };
    return true;
  }

  const projection = source.textureProjection;
  const radians = projection.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const sourceU: Vec3 = sourceS.map((value, axis) =>
    (cosine * value - sine * sourceT[axis]) / (projection.scaleX || 0.5)) as Vec3;
  const sourceV: Vec3 = sourceS.map((value, axis) =>
    (sine * value + cosine * sourceT[axis]) / (projection.scaleY || 0.5)) as Vec3;
  const targetU = rotateVectorBetweenNormals(sourceU, source.plane.normal, target.plane.normal);
  const targetV = rotateVectorBetweenNormals(sourceV, source.plane.normal, target.plane.normal);
  const ss = vec3Dot(targetU, targetS);
  const st = vec3Dot(targetU, targetT);
  const ts = vec3Dot(targetV, targetS);
  const tt = vec3Dot(targetV, targetT);
  const scaleX = 1 / Math.max(1e-9, Math.hypot(ss, st));
  const determinant = ss * tt - st * ts;
  const scaleY = (determinant < 0 ? -1 : 1) / Math.max(1e-9, Math.hypot(ts, tt));
  const fittedCosine = ((ss * scaleX) + (tt * scaleY)) * 0.5;
  const fittedSine = ((-st * scaleX) + (ts * scaleY)) * 0.5;
  const [width, height] = faceTextureDimensions(editor, source);
  const desired = computeFaceUV(anchor, source, width, height);
  target.textureProjection = {
    kind: 'classic',
    scaleX,
    scaleY,
    rotation: ((Math.atan2(fittedSine, fittedCosine) * 180 / Math.PI) % 360 + 360) % 360,
    offsetX: desired[0] * width - vec3Dot(anchor, targetU),
    offsetY: desired[1] * height - vec3Dot(anchor, targetV),
  };
  return true;
}

export function transferFaceProjection(editor: Editor, source: BrushFace, target: BrushFace, mode: 'world' | 'local' = 'world'): boolean {
  if (mode === 'local') {
    target.textureProjection = cloneTextureProjection(source.textureProjection);
    return true;
  }
  const shared = sharedVertices(source, target);
  if (shared.length >= 2) return transferAcrossSharedEdge(editor, source, target, shared);
  const samples = targetSamplePoints(target);
  if (!samples) return false;
  const [targetS, targetT] = textureAxisFromPlane(target.plane.normal);
  const local = samples.map(point => [vec3Dot(point, targetS), vec3Dot(point, targetT)] as [number, number]);
  const [sourceWidth, sourceHeight] = faceTextureDimensions(editor, source);
  const desired = samples.map(point => computeFaceUV(point, source, sourceWidth, sourceHeight));
  const u = solveAffine(local, desired.map(value => value[0]));
  const v = solveAffine(local, desired.map(value => value[1]));
  if (!u || !v) return false;
  if (target.textureProjection.kind === 'brush-primitive') {
    target.textureProjection.matrix = [u, v];
    return true;
  }
  const [targetWidth, targetHeight] = faceTextureDimensions(editor, target);
  const angleU = Math.atan2(-u[1], u[0]);
  const angleV = Math.atan2(v[0], v[1]);
  const x = Math.cos(angleU) + Math.cos(angleV);
  const y = Math.sin(angleU) + Math.sin(angleV);
  const angle = Math.atan2(y, x);
  const uMagnitude = Math.hypot(u[0], u[1]) * targetWidth;
  const vMagnitude = Math.hypot(v[0], v[1]) * targetHeight;
  target.textureProjection.rotation = ((angle * 180 / Math.PI) % 360 + 360) % 360;
  target.textureProjection.scaleX = 1 / Math.max(1e-9, uMagnitude);
  target.textureProjection.scaleY = 1 / Math.max(1e-9, vMagnitude);
  target.textureProjection.offsetX = u[2] * targetWidth;
  target.textureProjection.offsetY = v[2] * targetHeight;
  return true;
}

export function copyProjectionFromFirst(editor: Editor, mode: 'world' | 'local' = 'world'): number {
  const faces = getTextureFaces(editor);
  if (faces.length < 2) return 0;
  return editor.transact('Copy face projection', () => {
    let changed = 0;
    for (const face of faces.slice(1)) if (transferFaceProjection(editor, faces[0], face, mode)) changed++;
    editor.redrawRequested = true;
    editor.statusMessage = `Transferred projection to ${changed} face${changed === 1 ? '' : 's'}`;
    return changed;
  });
}

export function alignFaceChain(editor: Editor): number {
  const selected = getTextureFaces(editor);
  if (selected.length < 2) return 0;
  return editor.transact('Align texture face chain', () => {
    const remaining = new Set(selected.slice(1));
    const queue = [selected[0]];
    let changed = 0;
    while (queue.length > 0) {
      const source = queue.shift()!;
      for (const target of [...remaining]) {
        if (sharedVertices(source, target).length < 2) continue;
        if (transferFaceProjection(editor, source, target, 'world')) changed++;
        remaining.delete(target); queue.push(target);
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Aligned ${changed} adjacent face${changed === 1 ? '' : 's'}${remaining.size ? `; ${remaining.size} disconnected` : ''}`;
    return changed;
  });
}

export function wrapTextureSelection(editor: Editor): number {
  const faceItems = editor.selection.filter(item => item.type === 'face');
  const faces = faceItems.map(item => item.face);
  if (faces.length < 3 || new Set(faceItems.map(item => item.brush)).size !== 1) {
    editor.statusMessage = 'Select at least three faces from one convex brush loop';
    return 0;
  }
  const adjacency = new Map(faces.map(face => [
    face,
    faces.filter(candidate => candidate !== face && sharedVertices(face, candidate).length >= 2),
  ]));
  if ([...adjacency.values()].some(neighbors => neighbors.length !== 2)) {
    editor.statusMessage = 'Selected faces do not form one closed convex loop';
    return 0;
  }
  const visited = new Set<BrushFace>();
  const queue = [faces[0]];
  while (queue.length > 0) {
    const face = queue.shift()!;
    if (visited.has(face)) continue;
    visited.add(face);
    queue.push(...adjacency.get(face)!);
  }
  if (visited.size !== faces.length) {
    editor.statusMessage = 'Selected faces contain disconnected loops';
    return 0;
  }
  return alignFaceChain(editor);
}

export function faceTexelDensity(editor: Editor, face: BrushFace): number {
  const [width, height] = faceTextureDimensions(editor, face);
  if (face.textureProjection.kind === 'classic') {
    return Math.sqrt(1 / Math.max(1e-9, Math.abs(face.textureProjection.scaleX * face.textureProjection.scaleY)));
  }
  const [u, v] = face.textureProjection.matrix;
  return Math.sqrt(Math.hypot(u[0], u[1]) * width * Math.hypot(v[0], v[1]) * height);
}

export function selectedTextureDensityReport(editor: Editor): { count: number; minimum: number; maximum: number; median: number; inconsistent: number } | null {
  const densities = getTextureFaces(editor).map(face => faceTexelDensity(editor, face)).filter(Number.isFinite).sort((a, b) => a - b);
  if (densities.length === 0) return null;
  const median = densities[Math.floor(densities.length / 2)];
  return {
    count: densities.length, minimum: densities[0], maximum: densities[densities.length - 1], median,
    inconsistent: densities.filter(value => Math.max(value / median, median / value) > 1.5).length,
  };
}

export function setTextureDensity(editor: Editor, texelsPerUnit: number): void {
  if (!Number.isFinite(texelsPerUnit) || texelsPerUnit <= 0) return;
  const faces = getTextureFaces(editor);
  editor.transact('Set texture density', () => {
    for (const face of faces) {
      const [width, height] = faceTextureDimensions(editor, face);
      if (face.textureProjection.kind === 'classic') {
        const signX = Math.sign(face.textureProjection.scaleX) || 1;
        const signY = Math.sign(face.textureProjection.scaleY) || 1;
        face.textureProjection.scaleX = signX / texelsPerUnit;
        face.textureProjection.scaleY = signY / texelsPerUnit;
      } else {
        const [u, v] = face.textureProjection.matrix;
        const normalize = (row: [number, number, number], desired: number) => {
          const length = Math.hypot(row[0], row[1]) || 1;
          row[0] = row[0] / length * desired; row[1] = row[1] / length * desired;
        };
        normalize(u, texelsPerUnit / width);
        normalize(v, texelsPerUnit / height);
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = `Texture density: ${texelsPerUnit} texels/unit`;
  }, { coalesceKey: 'texture-density' });
}

export function fitTextureByMapUnits(editor: Editor, unitsPerRepeat: number): void {
  if (!Number.isFinite(unitsPerRepeat) || unitsPerRepeat <= 0) return;
  const faces = getTextureFaces(editor);
  editor.transact('Fit texture by map units', () => {
    for (const face of faces) {
      const [width, height] = faceTextureDimensions(editor, face);
      const density = Math.sqrt(width * height) / unitsPerRepeat;
      if (face.textureProjection.kind === 'classic') {
        face.textureProjection.scaleX = unitsPerRepeat / width;
        face.textureProjection.scaleY = unitsPerRepeat / height;
      } else {
        const [u, v] = face.textureProjection.matrix;
        const uLength = Math.hypot(u[0], u[1]) || 1;
        const vLength = Math.hypot(v[0], v[1]) || 1;
        u[0] = u[0] / uLength / unitsPerRepeat; u[1] = u[1] / uLength / unitsPerRepeat;
        v[0] = v[0] / vLength / unitsPerRepeat; v[1] = v[1] / vLength / unitsPerRepeat;
        void density;
      }
    }
    editor.redrawRequested = true;
    editor.statusMessage = `One texture repeat every ${unitsPerRepeat} map units`;
  });
}

export function textureAxisLines(editor: Editor): Vec3[] {
  const lines: Vec3[] = [];
  for (const face of getTextureFaces(editor)) {
    if (face.polygon.length < 3) continue;
    const center = [0, 1, 2].map(axis => face.polygon.reduce((sum, point) => sum + point[axis], 0) / face.polygon.length) as Vec3;
    const [s, t] = textureAxisFromPlane(face.plane.normal);
    const [width, height] = faceTextureDimensions(editor, face);
    let u: Vec3;
    let v: Vec3;
    let uLength: number;
    let vLength: number;
    if (face.textureProjection.kind === 'classic') {
      const radians = face.textureProjection.rotation * Math.PI / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      u = s.map((value, axis) => cosine * value - sine * t[axis]) as Vec3;
      v = s.map((value, axis) => sine * value + cosine * t[axis]) as Vec3;
      uLength = width * Math.abs(face.textureProjection.scaleX || 0.5);
      vLength = height * Math.abs(face.textureProjection.scaleY || 0.5);
    } else {
      const [uRow, vRow] = face.textureProjection.matrix;
      u = s.map((value, axis) => value * uRow[0] + t[axis] * uRow[1]) as Vec3;
      v = s.map((value, axis) => value * vRow[0] + t[axis] * vRow[1]) as Vec3;
      uLength = 1 / Math.max(1e-9, vec3Length(u));
      vLength = 1 / Math.max(1e-9, vec3Length(v));
    }
    u = vec3Scale(u, 1 / Math.max(1e-9, vec3Length(u)));
    v = vec3Scale(v, 1 / Math.max(1e-9, vec3Length(v)));
    lines.push(center, center.map((value, axis) => value + u[axis] * Math.min(512, uLength)) as Vec3);
    lines.push(center, center.map((value, axis) => value + v[axis] * Math.min(512, vLength)) as Vec3);
  }
  return lines;
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
