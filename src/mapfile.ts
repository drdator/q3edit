import { Vec3 } from './math';
import { Brush, BrushFace, createFace, computeBrushGeometry } from './brush';
import { Entity } from './entity';

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
      lines.push(`// brush ${b}`);
      lines.push('{');

      for (const face of brush.faces) {
        const [p1, p2, p3] = face.points;
        const fmt = (v: Vec3) => `( ${fmtNum(v[0])} ${fmtNum(v[1])} ${fmtNum(v[2])} )`;
        lines.push(
          `${fmt(p1)} ${fmt(p2)} ${fmt(p3)} ` +
          `${face.texture} ${fmtNum(face.offsetX)} ${fmtNum(face.offsetY)} ` +
          `${fmtNum(face.rotation)} ${fmtNum(face.scaleX)} ${fmtNum(face.scaleY)} ` +
          `${face.contentFlags} ${face.surfaceFlags} ${face.value}`
        );
      }

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
        // Brush
        i++;
        const brush = parseBrush(lines, () => i, (v) => { i = v; });
        if (brush) {
          entity.brushes.push(brush);
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

  while ((match = pointRegex.exec(line)) !== null && points.length < 3) {
    points.push([parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]);
  }

  if (points.length < 3) return null;

  // Get the rest after the three point groups
  const afterPoints = line.substring(pointRegex.lastIndex).trim();
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

  return createFace(
    points[0], points[1], points[2],
    texture, offsetX, offsetY, rotation, scaleX, scaleY
  );
}
