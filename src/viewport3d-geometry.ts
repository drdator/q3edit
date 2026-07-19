import { Vec3 } from './math';
import { Editor } from './editor';
import { BrushFace, computeFaceUV } from './brush';
import { entityColor, entityOrigin, parseLightColor } from './entity';
import { terrainDefCellTexture, type Patch } from './patch';
import { DrawGroup, LightRadiusDraw } from './viewport3d-render';
import { buildModelGeometry } from './model-geometry';

export interface Viewport3DGeometryContext {
  gl: WebGL2RenderingContext;
  editor: Editor;
  solidVBO: WebGLBuffer;
  clipBoxVBO: WebGLBuffer;
  pathLineVBO: WebGLBuffer;
  pathLineSelVBO: WebGLBuffer;
  pathCurveVBO: WebGLBuffer;
  pathCurveSelVBO: WebGLBuffer;
  pointfileLineVBO: WebGLBuffer;
  pointfileMarkerVBO: WebGLBuffer;
  paintPreviewVBO: WebGLBuffer;
  lineVBO: WebGLBuffer;
  wireVBO: WebGLBuffer;
  faceSelVBO: WebGLBuffer;
  vtxHandleVBO: WebGLBuffer;
  vtxHandleSelVBO: WebGLBuffer;
  lightRadiusVBO: WebGLBuffer;
}

export interface Viewport3DGeometryBuild {
  drawGroups: DrawGroup[];
  clipBoxCount: number;
  pathLineCount: number;
  pathLineSelCount: number;
  pathCurveCount: number;
  pathCurveSelCount: number;
  pointfileLineCount: number;
  pointfileMarkerCount: number;
  paintPreviewCount: number;
  lineCount: number;
  wireCount: number;
  faceSelCount: number;
  vtxHandleCount: number;
  vtxHandleSelCount: number;
  lightRadiusDraws: LightRadiusDraw[];
}

export function buildViewport3DGeometry(ctx: Viewport3DGeometryContext): Viewport3DGeometryBuild {
  const tm = ctx.editor.textureManager;
  const textureTerrainMode = ctx.editor.patchEditMode && ctx.editor.terrainBrushMode === 'texture';
  const facesByTex = new Map<string, { verts: number[]; selected: boolean; faceSelected: boolean }[]>();
  const appendBoundsWireframe = (verts: number[], mins: Vec3, maxs: Vec3) => {
    const corners: Vec3[] = [
      [mins[0], mins[1], mins[2]],
      [maxs[0], mins[1], mins[2]],
      [maxs[0], maxs[1], mins[2]],
      [mins[0], maxs[1], mins[2]],
      [mins[0], mins[1], maxs[2]],
      [maxs[0], mins[1], maxs[2]],
      [maxs[0], maxs[1], maxs[2]],
      [mins[0], maxs[1], maxs[2]],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edges) {
      verts.push(corners[a][0], corners[a][1], corners[a][2], corners[b][0], corners[b][1], corners[b][2]);
    }
  };
  const appendPatchWireframe = (verts: number[], patch: Patch) => {
    if (patch.terrainDef) {
      for (let row = 0; row < patch.height; row++) {
        for (let col = 0; col < patch.width; col++) {
          const point = patch.ctrl[row]?.[col]?.xyz;
          if (!point) continue;
          if (col < patch.width - 1) {
            const next = patch.ctrl[row]?.[col + 1]?.xyz;
            if (next) verts.push(point[0], point[1], point[2], next[0], next[1], next[2]);
          }
          if (row < patch.height - 1) {
            const next = patch.ctrl[row + 1]?.[col]?.xyz;
            if (next) verts.push(point[0], point[1], point[2], next[0], next[1], next[2]);
          }
        }
      }
      return;
    }
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
              verts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
            if (vi < n - 1) {
              const q = patch.tessVerts[idx + n].position;
              verts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
          }
        }
      }
    }
  };

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

  const clipBoxVerts: number[] = [];
  const cubicClip = ctx.editor.cubicClipBounds();
  if (cubicClip) {
    appendBoundsWireframe(clipBoxVerts, cubicClip.mins, cubicClip.maxs);
  }
  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.clipBoxVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(clipBoxVerts), ctx.gl.DYNAMIC_DRAW);
  const clipBoxCount = clipBoxVerts.length / 3;

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisibleIn3D(brush, entity)) continue;
    const brushSelected = ctx.editor.isSelected(brush, entity);
    for (const face of brush.faces) {
      const fsel = ctx.editor.isFaceSelected(face);
      if (ctx.editor.invisibleMode === 'hide' && !fsel && !brushSelected &&
          Editor.INVISIBLE_TEXTURES.has(face.texture.toLowerCase())) continue;
      addFace(face, brushSelected, fsel);
    }
  }

  for (const { entity, patch } of ctx.editor.allPatches()) {
    if (!ctx.editor.isPatchVisibleIn3D(patch, entity)) continue;
    const patchSelected = ctx.editor.isPatchSelected(patch, entity);
    const shaderSelected = patchSelected && !textureTerrainMode;
    if (patch.terrainDef && (patch.width > 3 || patch.height > 3)) {
      for (let row = 0; row < patch.height - 1; row++) {
        for (let col = 0; col < patch.width - 1; col++) {
          const cellTexture = terrainDefCellTexture(patch, row, col);
          const key = cellTexture.toLowerCase() + (shaderSelected ? '|sel' : '');
          let group = facesByTex.get(key);
          if (!group) {
            group = [];
            facesByTex.set(key, group);
          }
          const verts: number[] = [];
          const topLeft = row * patch.width + col;
          const topRight = topLeft + 1;
          const bottomLeft = topLeft + patch.width;
          const bottomRight = bottomLeft + 1;
          const indices = ((row + col) & 1)
            ? [topLeft, bottomLeft, bottomRight, bottomRight, topRight, topLeft]
            : [topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight];
          for (const idx of indices) {
            const v = patch.tessVerts[idx];
            verts.push(
              v.position[0], v.position[1], v.position[2],
              v.normal[0], v.normal[1], v.normal[2],
              v.uv[0], v.uv[1],
            );
          }
          group.push({ verts, selected: shaderSelected, faceSelected: false });
        }
      }
      continue;
    }
    const key = patch.texture.toLowerCase() + (shaderSelected ? '|sel' : '');
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
    group.push({ verts, selected: shaderSelected, faceSelected: false });
  }

  const entityVertsByColor = new Map<string, number[]>();
  const modelWireVerts: number[] = [];
  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntityVisibleIn3D(entity)) continue;
    const origin = ctx.editor.entityDisplayOrigin(entity);
    if (!origin) continue;
    const resolvedModel = ctx.editor.modelManager?.resolveEntity(entity);
    if (resolvedModel) {
      const selected = ctx.editor.isEntitySelected(entity);
      for (const surface of buildModelGeometry(entity, resolvedModel)) {
        if (surface.vertices.length === 0) continue;
        const key = surface.texture.toLowerCase() + (selected ? '|sel' : '');
        const group = facesByTex.get(key) ?? [];
        group.push({ verts: surface.vertices, selected, faceSelected: false });
        facesByTex.set(key, group);
        for (let offset = 0; offset + 23 < surface.vertices.length; offset += 24) {
          const positions = [0, 8, 16].map(start => surface.vertices.slice(offset + start, offset + start + 3));
          for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) modelWireVerts.push(...positions[a], ...positions[b]);
        }
      }
      continue;
    }
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
      modelWireVerts.push(...v0, ...v1, ...v1, ...v2, ...v2, ...v0);
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
  for (const link of ctx.editor.display.categories.paths ? ctx.editor.collectEntityLinks() : []) {
    if (!ctx.editor.isSegmentVisibleIn3D(link.from, link.to)) continue;
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

  const pathCurveVerts: number[] = [];
  const pathCurveSelVerts: number[] = [];
  for (const curve of ctx.editor.display.categories.paths && ctx.editor.display.categories.curves ? ctx.editor.collectEntityPathCurves() : []) {
    const arr = curve.highlighted ? pathCurveSelVerts : pathCurveVerts;
    for (let i = 0; i < curve.points.length - 1; i++) {
      const from = curve.points[i];
      const to = curve.points[i + 1];
      if (!ctx.editor.isSegmentVisibleIn3D(from, to)) continue;
      arr.push(from[0], from[1], from[2], to[0], to[1], to[2]);
    }
  }
  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pathCurveVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pathCurveVerts), ctx.gl.DYNAMIC_DRAW);
  const pathCurveCount = pathCurveVerts.length / 3;

  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pathCurveSelVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pathCurveSelVerts), ctx.gl.DYNAMIC_DRAW);
  const pathCurveSelCount = pathCurveSelVerts.length / 3;

  const pointfileLineVerts: number[] = [];
  for (let i = 0; i < ctx.editor.pointfilePoints.length - 1; i++) {
    const from = ctx.editor.pointfilePoints[i];
    const to = ctx.editor.pointfilePoints[i + 1];
    if (!ctx.editor.isSegmentVisibleIn3D(from, to)) continue;
    pointfileLineVerts.push(from[0], from[1], from[2], to[0], to[1], to[2]);
  }
  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pointfileLineVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pointfileLineVerts), ctx.gl.DYNAMIC_DRAW);
  const pointfileLineCount = pointfileLineVerts.length / 3;

  const pointfileMarkerVerts: number[] = [];
  if (ctx.editor.pointfilePoints.length > 0) {
    const point = ctx.editor.pointfilePoints[Math.max(0, Math.min(ctx.editor.pointfileIndex, ctx.editor.pointfilePoints.length - 1))];
    if (ctx.editor.isPointVisibleIn3D(point)) {
      const s = 8;
      pointfileMarkerVerts.push(
        point[0] - s, point[1], point[2], point[0] + s, point[1], point[2],
        point[0], point[1] - s, point[2], point[0], point[1] + s, point[2],
        point[0], point[1], point[2] - s, point[0], point[1], point[2] + s,
      );
    }
  }
  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.pointfileMarkerVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(pointfileMarkerVerts), ctx.gl.DYNAMIC_DRAW);
  const pointfileMarkerCount = pointfileMarkerVerts.length / 3;

  const paintPreviewLineVerts: number[] = [];
  if (textureTerrainMode) {
    for (const target of ctx.editor.hoveredTerrainPaintTargets()) {
      appendBoundsWireframe(paintPreviewLineVerts, target.mins, target.maxs);
    }
  }
  ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, ctx.paintPreviewVBO);
  ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, new Float32Array(paintPreviewLineVerts), ctx.gl.DYNAMIC_DRAW);
  const paintPreviewCount = paintPreviewLineVerts.length / 3;

  const selLineVerts: number[] = [];
  const wireVerts: number[] = [...modelWireVerts];
  const faceSelLineVerts: number[] = [];

  for (const { entity, brush } of ctx.editor.allBrushes()) {
    if (!ctx.editor.isBrushVisibleIn3D(brush, entity)) continue;
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
    if (!ctx.editor.isPatchVisibleIn3D(patch, entity)) continue;
    if (textureTerrainMode && ctx.editor.isPatchSelected(patch, entity)) {
      appendBoundsWireframe(selLineVerts, patch.mins, patch.maxs);
      continue;
    }
    if (ctx.editor.isPatchSelected(patch, entity)) {
      appendPatchWireframe(selLineVerts, patch);
      continue;
    }
    appendPatchWireframe(wireVerts, patch);
  }

  for (const entity of ctx.editor.nonWorldspawnEntities()) {
    if (!ctx.editor.isEntitySelected(entity)) continue;
    if (ctx.editor.isPointEntity(entity)) {
      const origin = ctx.editor.entityDisplayOrigin(entity);
      if (!origin || !ctx.editor.isPointVisibleIn3D(origin)) continue;
      const modelBounds = ctx.editor.modelManager?.entityBounds(entity);
      if (modelBounds) {
        appendBoundsWireframe(selLineVerts, modelBounds.mins, modelBounds.maxs);
        continue;
      }
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
    if (!bounds || !ctx.editor.isEntityVisibleIn3D(entity)) continue;
    appendBoundsWireframe(selLineVerts, bounds.mins, bounds.maxs);
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
    if (!origin || !ctx.editor.isPointVisibleIn3D(origin)) continue;
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
  if (ctx.editor.patchEditMode && !textureTerrainMode) {
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
    clipBoxCount,
    pathLineCount,
    pathLineSelCount,
    pathCurveCount,
    pathCurveSelCount,
    pointfileLineCount,
    pointfileMarkerCount,
    paintPreviewCount,
    lineCount,
    wireCount,
    faceSelCount,
    vtxHandleCount,
    vtxHandleSelCount,
    lightRadiusDraws,
  };
}
