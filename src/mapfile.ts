import { Vec3 } from './math';
import { Brush, BrushFace, createFace, computeBrushGeometry } from './brush';
import { Entity } from './entity';
import {
  Patch,
  PatchControlPoint,
  type TerrainDefSurface,
  syncTerrainDefMetadata,
  tessellatePatch,
} from './patch';

// ── Serialize to .map format ──

export function serializeMap(entities: Entity[]): string {
  const lines: string[] = [];

  for (let e = 0; e < entities.length; e++) {
    const entity = entities[e];
    lines.push(`// entity ${e}`);
    lines.push('{');

    // Properties
    for (const [key, value] of Object.entries(entity.properties)) {
      lines.push(`"${key}" "${value}"`);
    }

    // Brushes
    for (let b = 0; b < entity.brushes.length; b++) {
      const brush = entity.brushes[b];
      lines.push(brush.name ? `// ${brush.name}` : `// brush ${b}`);
      lines.push('{');

      for (const face of brush.faces) {
        const [p1, p2, p3] = face.points;
        const fmt = (v: Vec3) => `( ${fmtNum(v[0])} ${fmtNum(v[1])} ${fmtNum(v[2])} )`;
        // Swap p2/p3 back to standard Q3 format (inward-pointing normals)
        lines.push(
          `${fmt(p1)} ${fmt(p3)} ${fmt(p2)} ` +
          `${face.texture} ${fmtNum(face.offsetX)} ${fmtNum(face.offsetY)} ` +
          `${fmtNum(face.rotation)} ${fmtNum(face.scaleX)} ${fmtNum(face.scaleY)} ` +
          `${face.contentFlags} ${face.surfaceFlags} ${face.value}`
        );
      }

      lines.push('}');
    }

    // Patches
    for (let p = 0; p < entity.patches.length; p++) {
      const patch = entity.patches[p];
      if (patch.terrainDef) syncTerrainDefMetadata(patch);
      lines.push(`// patch ${p}`);
      lines.push('{');
      if (patch.terrainDef?.serializable) {
        lines.push('terrainDef');
        lines.push('{');
        lines.push(`( ${fmtNum(patch.width)} ${fmtNum(patch.height)} ${fmtNum(patch.terrainDef.scale[0])} ${fmtNum(patch.terrainDef.scale[1])} )`.replace(/[()]/g, '').trim());
        lines.push(`${fmtNum(patch.terrainDef.origin[0])} ${fmtNum(patch.terrainDef.origin[1])} ${fmtNum(patch.terrainDef.origin[2])}`);
        for (let r = 0; r < patch.height; r++) {
          for (let c = 0; c < patch.width; c++) {
            const cp = patch.ctrl[r][c];
            const surface = patch.terrainDef.surfaces[r]?.[c] ?? defaultTerrainSurface(patch);
            const height = cp.xyz[2] - patch.terrainDef.origin[2];
            lines.push(
              `${fmtNum(height)} ${surface.texture} ${fmtNum(surface.offsetX)} ${fmtNum(surface.offsetY)} ` +
              `${fmtNum(surface.rotation)} ${fmtNum(surface.scaleX)} ${fmtNum(surface.scaleY)} ` +
              `${surface.contentFlags} ${surface.surfaceFlags} ${surface.value}`
            );
          }
        }
        lines.push('}');
        lines.push('}');
        continue;
      }
      lines.push('patchDef2');
      lines.push('{');
      lines.push(patch.texture);
      // Q3 patchDef2 format: first number is d_width (rows), second is d_height (CPs per row)
      lines.push(`( ${patch.height} ${patch.width} ${patch.contentFlags} ${patch.surfaceFlags} ${patch.value} )`);
      lines.push('(');
      for (let r = 0; r < patch.height; r++) {
        const row = patch.ctrl[r];
        const cpStrs = row.map(cp =>
          `( ${fmtNum(cp.xyz[0])} ${fmtNum(cp.xyz[1])} ${fmtNum(cp.xyz[2])} ${fmtNum(cp.uv[0])} ${fmtNum(cp.uv[1])} )`
        );
        lines.push(`( ${cpStrs.join(' ')} )`);
      }
      lines.push(')');
      lines.push('}');
      lines.push('}');
    }

    lines.push('}');
  }

  return lines.join('\n') + '\n';
}

function fmtNum(n: number): string {
  // Clean up floating point: use integer if possible
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(6).replace(/\.?0+$/, '');
}

function defaultTerrainSurface(patch: Patch): TerrainDefSurface {
  return {
    texture: patch.texture,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scaleX: 0.5,
    scaleY: 0.5,
    contentFlags: patch.contentFlags,
    surfaceFlags: patch.surfaceFlags,
    value: patch.value,
  };
}

// ── Parse .map format ──

export function parseMap(text: string): Entity[] {
  const entities: Entity[] = [];
  const lines = text.split('\n');
  let i = 0;

  function skipWhitespace() {
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed === '' || trimmed.startsWith('//')) {
        i++;
      } else {
        break;
      }
    }
  }

  function expectLine(expected: string): boolean {
    skipWhitespace();
    if (i < lines.length && lines[i].trim() === expected) {
      i++;
      return true;
    }
    return false;
  }

  while (i < lines.length) {
    skipWhitespace();
    if (i >= lines.length) break;

    if (!expectLine('{')) break;

    const entity: Entity = {
      classname: 'worldspawn',
      properties: {},
      brushes: [],
      patches: [],
    };

    // Parse properties and brushes
    while (i < lines.length) {
      skipWhitespace();
      if (i >= lines.length) break;
      const line = lines[i].trim();

      if (line === '}') {
        i++;
        break;
      }

      if (line === '{') {
        // Brush or patch — check if the previous non-blank line was a comment (brush name)
        let brushName: string | undefined;
        for (let j = i - 1; j >= 0; j--) {
          const prev = lines[j].trim();
          if (prev === '') continue;
          if (prev.startsWith('//')) {
            const label = prev.replace(/^\/\/\s*/, '');
            // Skip auto-generated comments like "brush 0", "entity 0", "patch 0"
            if (!/^(brush|entity|patch) \d+$/.test(label)) {
              brushName = label;
            }
          }
          break;
        }
        i++;

        // Peek at first non-blank/comment line to check for patchDef2 / terrainDef
        let peekIdx = i;
        while (peekIdx < lines.length) {
          const peekLine = lines[peekIdx].trim();
          if (peekLine === '' || peekLine.startsWith('//')) { peekIdx++; continue; }
          break;
        }

        if (peekIdx < lines.length && lines[peekIdx].trim() === 'patchDef2') {
          i = peekIdx + 1; // skip past 'patchDef2'
          const patch = parsePatchDef2(lines, () => i, (v) => { i = v; });
          if (patch) {
            entity.patches.push(patch);
          }
        } else if (peekIdx < lines.length && lines[peekIdx].trim() === 'terrainDef') {
          i = peekIdx + 1; // skip past 'terrainDef'
          const patch = parseTerrainDef(lines, () => i, (v) => { i = v; });
          if (patch) {
            entity.patches.push(patch);
          }
        } else {
          const brush = parseBrush(lines, () => i, (v) => { i = v; });
          if (brush) {
            if (brushName) brush.name = brushName;
            entity.brushes.push(brush);
          }
        }
      } else if (line.startsWith('"')) {
        // Property
        const match = line.match(/^"([^"]*?)"\s+"([^"]*?)"$/);
        if (match) {
          entity.properties[match[1]] = match[2];
          if (match[1] === 'classname') {
            entity.classname = match[2];
          }
        }
        i++;
      } else {
        i++;
      }
    }

    entities.push(entity);
  }

  return entities;
}

function parseBrush(lines: string[], getI: () => number, setI: (v: number) => void): Brush | null {
  const faces: BrushFace[] = [];

  while (getI() < lines.length) {
    const line = lines[getI()].trim();

    if (line === '' || line.startsWith('//')) {
      setI(getI() + 1);
      continue;
    }

    if (line === '}') {
      setI(getI() + 1);
      break;
    }

    // Parse face: ( x y z ) ( x y z ) ( x y z ) texture offX offY rot scX scY [cflags sflags value]
    const face = parseFaceLine(line);
    if (face) {
      faces.push(face);
    }
    setI(getI() + 1);
  }

  if (faces.length < 4) return null;

  const brush: Brush = {
    faces,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
  };
  computeBrushGeometry(brush);
  return brush;
}

function parseFaceLine(line: string): BrushFace | null {
  // Match three point groups: ( x y z ) ( x y z ) ( x y z )
  const pointRegex = /\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/g;
  const points: Vec3[] = [];
  let match;
  let lastSuccessIndex = 0;

  while ((match = pointRegex.exec(line)) !== null && points.length < 3) {
    points.push([parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]);
    lastSuccessIndex = pointRegex.lastIndex;
  }

  if (points.length < 3) return null;

  // Get the rest after the three point groups
  // Note: can't use pointRegex.lastIndex — it resets to 0 when exec() returns null
  const afterPoints = line.substring(lastSuccessIndex).trim();
  const parts = afterPoints.split(/\s+/);

  if (parts.length < 5) return null;

  const texture = parts[0];
  const offsetX = parseFloat(parts[1]) || 0;
  const offsetY = parseFloat(parts[2]) || 0;
  const rotation = parseFloat(parts[3]) || 0;
  const scaleX = parseFloat(parts[4]) || 0.5;
  const scaleY = parseFloat(parts[5]) || 0.5;
  const contentFlags = parseInt(parts[6]) || 0;
  const surfaceFlags = parseInt(parts[7]) || 0;
  const value = parseInt(parts[8]) || 0;

  // Q3 .map format uses inward-pointing normals (cross(p2-p1, p3-p1) points into brush).
  // Swap p2/p3 to produce outward-pointing normals for the clipping algorithm.
  return createFace(
    points[0], points[2], points[1],
    texture, offsetX, offsetY, rotation, scaleX, scaleY
  );
}

// ── Parse patchDef2 ──
// Format after 'patchDef2' keyword has been consumed:
//   {
//   texture_name
//   ( width height contents flags value )
//   (
//     ( ( x y z u v ) ( x y z u v ) ... )
//     ...
//   )
//   }
//   }   ← outer brace from the brush-level block

function parsePatchDef2(lines: string[], getI: () => number, setI: (v: number) => void): Patch | null {
  function nextLine(): string | null {
    while (getI() < lines.length) {
      const line = lines[getI()].trim();
      setI(getI() + 1);
      if (line === '' || line.startsWith('//')) continue;
      return line;
    }
    return null;
  }

  // Expect inner opening brace
  const brace = nextLine();
  if (brace !== '{') return null;

  // Texture name
  const texture = nextLine();
  if (!texture) return null;

  // ( width height contents flags value )
  const headerLine = nextLine();
  if (!headerLine) return null;
  const headerMatch = headerLine.match(/\(\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\)/);
  if (!headerMatch) return null;
  // Q3 patchDef2 format: first number is d_width (rows), second is d_height (CPs per row)
  // Our convention: width = columns, height = rows — so swap them
  const width = parseInt(headerMatch[2]);
  const height = parseInt(headerMatch[1]);
  const contentFlags = parseInt(headerMatch[3]);
  const surfaceFlags = parseInt(headerMatch[4]);
  const value = parseInt(headerMatch[5]);

  // Opening ( of control point matrix
  const matOpen = nextLine();
  if (matOpen !== '(') return null;

  // Parse rows of control points
  const ctrl: PatchControlPoint[][] = [];
  const cpRegex = /\(\s*(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s*\)/g;

  for (let r = 0; r < height; r++) {
    const rowLine = nextLine();
    if (!rowLine) return null;
    const row: PatchControlPoint[] = [];
    let match;
    cpRegex.lastIndex = 0;
    while ((match = cpRegex.exec(rowLine)) !== null) {
      row.push({
        xyz: [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])],
        uv: [parseFloat(match[4]), parseFloat(match[5])],
      });
    }
    if (row.length !== width) return null;
    ctrl.push(row);
  }

  // Closing ) of control point matrix
  const matClose = nextLine();
  if (matClose !== ')') return null;

  // Inner closing brace
  const innerClose = nextLine();
  if (innerClose !== '}') return null;

  // Outer closing brace
  const outerClose = nextLine();
  if (outerClose !== '}') return null;

  const patch: Patch = {
    width,
    height,
    texture,
    contentFlags,
    surfaceFlags,
    value,
    ctrl,
    subdivisions: 6,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    tessVerts: [],
    tessIndices: [],
  };
  tessellatePatch(patch);
  return patch;
}

function parseTerrainDef(lines: string[], getI: () => number, setI: (v: number) => void): Patch | null {
  function nextLine(): string | null {
    while (getI() < lines.length) {
      const line = lines[getI()].trim();
      setI(getI() + 1);
      if (line === '' || line.startsWith('//')) continue;
      return line;
    }
    return null;
  }

  const brace = nextLine();
  if (brace !== '{') return null;

  const headerLine = nextLine();
  if (!headerLine) return null;
  const header = headerLine.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '');
  const headerParts = header.split(/\s+/);
  if (headerParts.length < 4) return null;
  const width = parseInt(headerParts[0]);
  const height = parseInt(headerParts[1]);
  const scaleX = parseFloat(headerParts[2]);
  const scaleY = parseFloat(headerParts[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;

  const originLine = nextLine();
  if (!originLine) return null;
  const originParts = originLine.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '').split(/\s+/);
  if (originParts.length < 3) return null;
  const origin: Vec3 = [
    parseFloat(originParts[0]),
    parseFloat(originParts[1]),
    parseFloat(originParts[2]),
  ];
  if (origin.some(value => !Number.isFinite(value))) return null;

  const ctrl: PatchControlPoint[][] = [];
  const surfaces: TerrainDefSurface[][] = [];
  let patchTexture = 'common/caulk';
  let patchContentFlags = 0;
  let patchSurfaceFlags = 0;
  let patchValue = 0;

  for (let row = 0; row < height; row++) {
    const ctrlRow: PatchControlPoint[] = [];
    const surfaceRow: TerrainDefSurface[] = [];
    for (let col = 0; col < width; col++) {
      const line = nextLine();
      if (!line) return null;
      const parts = line.split(/\s+/);
      if (parts.length < 9) return null;
      const heightValue = parseFloat(parts[0]);
      const surface: TerrainDefSurface = {
        texture: parts[1],
        offsetX: parseFloat(parts[2]) || 0,
        offsetY: parseFloat(parts[3]) || 0,
        rotation: parseFloat(parts[4]) || 0,
        scaleX: parseFloat(parts[5]) || 0.5,
        scaleY: parseFloat(parts[6]) || 0.5,
        contentFlags: parseInt(parts[7]) || 0,
        surfaceFlags: parseInt(parts[8]) || 0,
        value: parseInt(parts[9]) || 0,
      };
      if (row === 0 && col === 0) {
        patchTexture = surface.texture;
        patchContentFlags = surface.contentFlags;
        patchSurfaceFlags = surface.surfaceFlags;
        patchValue = surface.value;
      }
      const x = origin[0] + col * scaleX;
      const y = origin[1] + row * scaleY;
      ctrlRow.push({
        xyz: [x, y, origin[2] + heightValue],
        uv: terrainDefUv(surface, x, y),
      });
      surfaceRow.push(surface);
    }
    ctrl.push(ctrlRow);
    surfaces.push(surfaceRow);
  }

  const innerClose = nextLine();
  if (innerClose !== '}') return null;

  const outerClose = nextLine();
  if (outerClose !== '}') return null;

  const patch: Patch = {
    width,
    height,
    texture: patchTexture,
    terrainDef: {
      origin,
      scale: [scaleX, scaleY],
      surfaces,
      serializable: true,
    },
    contentFlags: patchContentFlags,
    surfaceFlags: patchSurfaceFlags,
    value: patchValue,
    ctrl,
    subdivisions: 1,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    tessVerts: [],
    tessIndices: [],
  };
  tessellatePatch(patch);
  return patch;
}

function terrainDefUv(surface: TerrainDefSurface, x: number, y: number): [number, number] {
  const sx = Math.abs(surface.scaleX) > 0.0001 ? surface.scaleX : 0.5;
  const sy = Math.abs(surface.scaleY) > 0.0001 ? surface.scaleY : 0.5;
  const angle = surface.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = x * cos + y * sin;
  const ry = -x * sin + y * cos;
  return [
    rx / (sx * 128) + surface.offsetX / 128,
    ry / (sy * 128) + surface.offsetY / 128,
  ];
}
