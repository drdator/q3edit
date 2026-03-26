import { Vec3 } from './math';
import { Editor } from './editor';
import { BrushFace, computeFaceUV } from './brush';
import { entityColor, entityOrigin, parseLightColor } from './entity';
import { DrawGroup, LightRadiusDraw } from './viewport3d-render';

export interface Viewport3DGeometryContext {
  gl: WebGL2RenderingContext;
  editor: Editor;
  solidVBO: WebGLBuffer;
  pathLineVBO: WebGLBuffer;
  pathLineSelVBO: WebGLBuffer;
  lineVBO: WebGLBuffer;
  wireVBO: WebGLBuffer;
  faceSelVBO: WebGLBuffer;
  vtxHandleVBO: WebGLBuffer;
  vtxHandleSelVBO: WebGLBuffer;
  lightRadiusVBO: WebGLBuffer;
}

export interface Viewport3DGeometryBuild {
  drawGroups: DrawGroup[];
  pathLineCount: number;
  pathLineSelCount: number;
  lineCount: number;
  wireCount: number;
  faceSelCount: number;
  vtxHandleCount: number;
  vtxHandleSelCount: number;
  lightRadiusDraws: LightRadiusDraw[];
}

export function buildViewport3DGeometry(ctx: Viewport3DGeometryContext): Viewport3DGeometryBuild {
  const tm = ctx.editor.textureManager;
  const facesByTex = new Map<string, { verts: number[]; selected: boolean; faceSelected: boolean }[]>();

  const addFace = (face: BrushFace, selected: boolean, faceSelected: boolean) => {
    if (face.polygon.length < 3) return;
    const suffix = faceSelected ? '|fsel' : selected ? '|sel' : '';
    const key = face.texture.toLowerCase() + suffix;
    let group = facesByTex.get(key);
    if (!group) {
      group = [];
      facesByTex.set(key, group);
    }

    const n = face.plane.normal;
    const texInfo = tm?.getIfLoaded(face.texture);
    const tw = texInfo?.width ?? 64;
    const th = texInfo?.height ?? 64;

    const verts: number[] = [];
    for (let i = 1; i < face.polygon.length - 1; i++) {
      const tri = [face.polygon[0], face.polygon[i], face.polygon[i + 1]];
      for (const v of tri) {
        const [u, uv] = computeFaceUV(v, face, tw, th);
        verts.push(v[0], v[1], v[2], n[0], n[1], n[2], u, uv);
      }
    }
    group.push({ verts, selected, faceSelected });
  };

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisible(brush, entity)) continue;
    const brushSelected = ctx.editor.isSelected(brush, entity);
    for (const face of brush.faces) {
      const fsel = ctx.editor.isFaceSelected(face);
      if (ctx.editor.invisibleMode === 'hide' && !fsel && !brushSelected &&
          Editor.INVISIBLE_TEXTURES.has(face.texture.toLowerCase())) continue;
      addFace(face, brushSelected, fsel);
    }
  }

  for (const { entity, patch } of ctx.editor.allPatches()) {
    if (!ctx.editor.isPatchVisible(patch, entity)) continue;
    const patchSelected = ctx.editor.isPatchSelected(patch, entity);
    const key = patch.texture.toLowerCase() + (patchSelected ? '|sel' : '');
    let group = facesByTex.get(key);
    if (!group) {
      group = [];
      facesByTex.set(key, group);
    }
    const verts: number[] = [];
    for (let ti = 0; ti < patch.tessIndices.length; ti += 3) {
      const i0 = patch.tessIndices[ti];
      const i1 = patch.tessIndices[ti + 1];
      const i2 = patch.tessIndices[ti + 2];
      for (const idx of [i0, i1, i2]) {
        const v = patch.tessVerts[idx];
        verts.push(
          v.position[0], v.position[1], v.position[2],
          v.normal[0], v.normal[1], v.normal[2],
          v.uv[0], v.uv[1],
        );
      }
    }
    group.push({ verts, selected: patchSelected, faceSelected: false });
  }

  const entityVertsByColor = new Map<string, number[]>();
  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntityVisible(entity)) continue;
    const origin = ctx.editor.entityDisplayOrigin(entity);
    if (!origin) continue;
    const color = entityColor(entity.classname);
    let verts = entityVertsByColor.get(color);
    if (!verts) {
      verts = [];
      entityVertsByColor.set(color, verts);
    }

    const s = 8;
    const top: Vec3 = [origin[0], origin[1], origin[2] + s];
    const bottom: Vec3 = [origin[0], origin[1], origin[2] - s];
    const front: Vec3 = [origin[0], origin[1] + s, origin[2]];
    const back: Vec3 = [origin[0], origin[1] - s, origin[2]];
    const right: Vec3 = [origin[0] + s, origin[1], origin[2]];
    const left: Vec3 = [origin[0] - s, origin[1], origin[2]];

    const tris: [Vec3, Vec3, Vec3, Vec3][] = [
      [top, front, right, [0.33, 0.33, 0.57]],
      [top, right, back, [0.33, -0.33, 0.57]],
      [top, back, left, [-0.33, -0.33, 0.57]],
      [top, left, front, [-0.33, 0.33, 0.57]],
      [bottom, right, front, [0.33, 0.33, -0.57]],
      [bottom, back, right, [0.33, -0.33, -0.57]],
      [bottom, left, back, [-0.33, -0.33, -0.57]],
      [bottom, front, left, [-0.33, 0.33, -0.57]],
    ];
    for (const [v0, v1, v2, n] of tris) {
      for (const v of [v0, v1, v2]) {
        verts.push(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0);
      }
    }
  }

  const allVerts: number[] = [];
  const drawGroups: DrawGroup[] = [];

  for (const [key, groups] of facesByTex) {
    const texName = key.replace(/\|(sel|fsel)$/, '');
    const selected = key.endsWith('|sel');
    const faceSelected = key.endsWith('|fsel');
    const start = allVerts.length / 8;
    for (const g of groups) {
      for (const v of g.verts) allVerts.push(v);
    }
    const count = allVerts.length / 8 - start;
    if (count > 0) {
      const invisible = Editor.INVISIBLE_TEXTURES.has(texName.toLowerCase());
      let blendMode = tm?.getBlendMode(texName) ?? 'opaque';
      if (invisible && ctx.editor.invisibleMode === 'dim' && blendMode === 'opaque') {
        blendMode = 'blend';
      }
      const solidOverride = invisible && ctx.editor.invisibleMode === 'hide' && (selected || faceSelected);
      drawGroups.push({ textureName: texName, start, count, selected, faceSelected, blendMode, invisible, solidOverride });
    }
  }

  for (const [color, verts] of entityVertsByColor) {
    if (verts.length === 0) continue;
    const start = allVerts.length / 8;
    for (const v of verts) allVerts.push(v);
    drawGroups.push({
      textureName: `__entity_${color}`,
      start,
      count: verts.length / 8,
      selected: false,
      faceSelected: false,
      blendMode: 'opaque',
      invisible: false,
      solidOverride: false,
    });
  }

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.solidVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(allVerts), ctx.gl.DYNAMIC_DRAW);

  const pathLineVerts: number[] = [];
  const pathSelLineVerts: number[] = [];
  for (const link of ctx.editor.collectEntityLinks()) {
    const arr = link.highlighted ? pathSelLineVerts : pathLineVerts;
    arr.push(
      link.from[0], link.from[1], link.from[2],
      link.to[0], link.to[1], link.to[2],
    );
  }

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pathLineVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pathLineVerts), ctx.gl.DYNAMIC_DRAW);
  const pathLineCount = pathLineVerts.length / 3;

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pathLineSelVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pathSelLineVerts), ctx.gl.DYNAMIC_DRAW);
  const pathLineSelCount = pathSelLineVerts.length / 3;

  const selLineVerts: number[] = [];
  const wireVerts: number[] = [];
  const faceSelLineVerts: number[] = [];

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisible(brush, entity)) continue;
    const brushSelected = ctx.editor.isSelected(brush, entity);
    for (const face of brush.faces) {
      if (face.polygon.length < 3) continue;
      const fsel = ctx.editor.isFaceSelected(face);
      for (let i = 0; i < face.polygon.length; i++) {
        const a = face.polygon[i];
        const b = face.polygon[(i + 1) % face.polygon.length];
        if (fsel) {
          faceSelLineVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        } else if (brushSelected) {
          selLineVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        } else {
          wireVerts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }
  }

  for (const { entity, patch } of ctx.editor.allPatches()) {
    if (!ctx.editor.isPatchVisible(patch, entity)) continue;
    const arr = ctx.editor.isPatchSelected(patch, entity) ? selLineVerts : wireVerts;
    const n = patch.subdivisions + 1;
    const subCols = (patch.width - 1) / 2;
    const subRows = (patch.height - 1) / 2;
    for (let spr = 0; spr < subRows; spr++) {
      for (let spc = 0; spc < subCols; spc++) {
        const base = (spr * subCols + spc) * n * n;
        for (let vi = 0; vi < n; vi++) {
          for (let ui = 0; ui < n; ui++) {
            const idx = base + vi * n + ui;
            const p = patch.tessVerts[idx]?.position;
            if (!p) continue;
            if (ui < n - 1) {
              const q = patch.tessVerts[idx + 1].position;
              arr.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
            if (vi < n - 1) {
              const q = patch.tessVerts[idx + n].position;
              arr.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
          }
        }
      }
    }
  }

  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntitySelected(entity)) continue;
    if (ctx.editor.isPointEntity(entity)) {
      const origin = ctx.editor.entityDisplayOrigin(entity);
      if (!origin) continue;
      const s = 8;
      const pts: Vec3[] = [
        [origin[0], origin[1], origin[2] + s],
        [origin[0], origin[1] + s, origin[2]],
        [origin[0] + s, origin[1], origin[2]],
        [origin[0], origin[1] - s, origin[2]],
        [origin[0] - s, origin[1], origin[2]],
        [origin[0], origin[1], origin[2] - s],
      ];
      const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [5, 1], [5, 2], [5, 3], [5, 4], [1, 2], [2, 3], [3, 4], [4, 1]];
      for (const [a, b] of edges) {
        selLineVerts.push(pts[a][0], pts[a][1], pts[a][2], pts[b][0], pts[b][1], pts[b][2]);
      }
      continue;
    }

    const bounds = ctx.editor.entityBounds(entity);
    if (!bounds) continue;
    const corners: Vec3[] = [
      [bounds.mins[0], bounds.mins[1], bounds.mins[2]],
      [bounds.maxs[0], bounds.mins[1], bounds.mins[2]],
      [bounds.maxs[0], bounds.maxs[1], bounds.mins[2]],
      [bounds.mins[0], bounds.maxs[1], bounds.mins[2]],
      [bounds.mins[0], bounds.mins[1], bounds.maxs[2]],
      [bounds.maxs[0], bounds.mins[1], bounds.maxs[2]],
      [bounds.maxs[0], bounds.maxs[1], bounds.maxs[2]],
      [bounds.mins[0], bounds.maxs[1], bounds.maxs[2]],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edges) {
      selLineVerts.push(corners[a][0], corners[a][1], corners[a][2], corners[b][0], corners[b][1], corners[b][2]);
    }
  }

  const lightRadiusVerts: number[] = [];
  const lightRadiusDraws: LightRadiusDraw[] = [];
  const circleSegments = 48;
  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (entity.classname !== 'light' || !entity.properties['light']) continue;
    if (!ctx.editor.isEntitySelected(entity)) continue;
    const radius = parseFloat(entity.properties['light']);
    if (!(radius > 0)) continue;
    const origin = entityOrigin(entity);
    if (!origin) continue;
    const color: [number, number, number] = parseLightColor(entity) ?? [1.0, 1.0, 0.4];
    const start = lightRadiusVerts.length / 3;
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < circleSegments; i++) {
        const a0 = (i / circleSegments) * Math.PI * 2;
        const a1 = ((i + 1) / circleSegments) * Math.PI * 2;
        const p0: Vec3 = [origin[0], origin[1], origin[2]];
        const p1: Vec3 = [origin[0], origin[1], origin[2]];
        if (axis === 0) {
          p0[0] += Math.cos(a0) * radius; p0[1] += Math.sin(a0) * radius;
          p1[0] += Math.cos(a1) * radius; p1[1] += Math.sin(a1) * radius;
        } else if (axis === 1) {
          p0[0] += Math.cos(a0) * radius; p0[2] += Math.sin(a0) * radius;
          p1[0] += Math.cos(a1) * radius; p1[2] += Math.sin(a1) * radius;
        } else {
          p0[1] += Math.cos(a0) * radius; p0[2] += Math.sin(a0) * radius;
          p1[1] += Math.cos(a1) * radius; p1[2] += Math.sin(a1) * radius;
        }
        lightRadiusVerts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      }
    }
    lightRadiusDraws.push({ start, count: lightRadiusVerts.length / 3 - start, color });
  }

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.lightRadiusVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(lightRadiusVerts), ctx.gl.DYNAMIC_DRAW);

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.lineVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(selLineVerts), ctx.gl.DYNAMIC_DRAW);
  const lineCount = selLineVerts.length / 3;

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.wireVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(wireVerts), ctx.gl.DYNAMIC_DRAW);
  const wireCount = wireVerts.length / 3;

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.faceSelVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(faceSelLineVerts), ctx.gl.DYNAMIC_DRAW);
  const faceSelCount = faceSelLineVerts.length / 3;

  const vtxVerts: number[] = [];
  const vtxSelVerts: number[] = [];
  if (ctx.editor.vertexMode) {
    const s = 4;
    for (let di = 0; di < ctx.editor.vertexData.length; di++) {
      const data = ctx.editor.vertexData[di];
      for (let vi = 0; vi < data.vertices.length; vi++) {
        const p = data.vertices[vi].position;
        const arr = ctx.editor.isVertexSelected(di, vi) ? vtxSelVerts : vtxVerts;
        arr.push(p[0] - s, p[1], p[2], p[0] + s, p[1], p[2]);
        arr.push(p[0], p[1] - s, p[2], p[0], p[1] + s, p[2]);
        arr.push(p[0], p[1], p[2] - s, p[0], p[1], p[2] + s);
      }
    }
  }
  if (ctx.editor.patchEditMode) {
    const s = 4;
    for (let di = 0; di < ctx.editor.patchEditData.length; di++) {
      const patch = ctx.editor.patchEditData[di].patch;
      for (let r = 0; r < patch.height; r++) {
        for (let c = 0; c < patch.width; c++) {
          const p = patch.ctrl[r][c].xyz;
          const arr = ctx.editor.isControlPointSelected(di, r, c) ? vtxSelVerts : vtxVerts;
          arr.push(p[0] - s, p[1], p[2], p[0] + s, p[1], p[2]);
          arr.push(p[0], p[1] - s, p[2], p[0], p[1] + s, p[2]);
          arr.push(p[0], p[1], p[2] - s, p[0], p[1], p[2] + s);
        }
      }
      for (let r = 0; r < patch.height; r++) {
        for (let c = 0; c < patch.width; c++) {
          const p = patch.ctrl[r][c].xyz;
          if (c < patch.width - 1) {
            const q = patch.ctrl[r][c + 1].xyz;
            selLineVerts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
          }
          if (r < patch.height - 1) {
            const q = patch.ctrl[r + 1][c].xyz;
            selLineVerts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
          }
        }
      }
    }
  }

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.vtxHandleVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(vtxVerts), ctx.gl.DYNAMIC_DRAW);
  const vtxHandleCount = vtxVerts.length / 3;

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.vtxHandleSelVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(vtxSelVerts), ctx.gl.DYNAMIC_DRAW);
  const vtxHandleSelCount = vtxSelVerts.length / 3;

  return {
    drawGroups,
    pathLineCount,
    pathLineSelCount,
    lineCount,
    wireCount,
    faceSelCount,
    vtxHandleCount,
    vtxHandleSelCount,
    lightRadiusDraws,
  };
}
