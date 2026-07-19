import { createFace, computeBrushGeometry, type Brush, type BrushFace } from './brush';
import type { Entity } from './entity';
import type { Vec3 } from './math';
import {
  tessellatePatch,
  type Patch,
  type PatchControlPoint,
  type TerrainDefSurface,
} from './patch';
import { tokenizeMap, type MapToken, type MapTokenKind } from './map-tokenizer';

export type MapParseDiagnosticSeverity = 'warning' | 'error';

export interface MapParseDiagnostic {
  severity: MapParseDiagnosticSeverity;
  line: number;
  column: number;
  message: string;
}

export interface UnsupportedMapConstruct {
  keyword: string;
  line: number;
  column: number;
  /** Diagnostic capture only; it is not attached to or re-serialized with the document. */
  rawSource: string;
}

export type UnsupportedConstructPolicy = 'diagnostic-only';

export interface ParsedMapDocument {
  entities: Entity[];
}

export interface MapParseResult {
  document: ParsedMapDocument;
  warnings: MapParseDiagnostic[];
  errors: MapParseDiagnostic[];
  unsupportedConstructs: UnsupportedMapConstruct[];
  unsupportedConstructPolicy: UnsupportedConstructPolicy;
  diagnostics: MapParseDiagnostic[];
}

const AUTO_GENERATED_COMMENT = /^(brush|entity|patch) \d+$/;

class MapParser {
  private index = 0;
  private readonly diagnostics: MapParseDiagnostic[];
  private readonly unsupportedConstructs: UnsupportedMapConstruct[] = [];

  constructor(
    private readonly source: string,
    private readonly tokens: MapToken[],
    tokenizeDiagnostics: MapParseDiagnostic[],
  ) {
    this.diagnostics = [...tokenizeDiagnostics];
  }

  parse(): MapParseResult {
    const entities: Entity[] = [];
    while (true) {
      this.skipComments();
      const token = this.current();
      if (token.kind === 'eof') break;
      if (token.kind !== 'brace-open') {
        this.report('error', token, `Expected entity opening brace, found '${token.value}'`);
        this.index++;
        continue;
      }
      entities.push(this.parseEntity());
    }

    this.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
    return {
      document: { entities },
      warnings: this.diagnostics.filter(diagnostic => diagnostic.severity === 'warning'),
      errors: this.diagnostics.filter(diagnostic => diagnostic.severity === 'error'),
      unsupportedConstructs: this.unsupportedConstructs,
      unsupportedConstructPolicy: 'diagnostic-only',
      diagnostics: this.diagnostics,
    };
  }

  private parseEntity(): Entity {
    const openingBrace = this.current();
    this.index++;
    const entity: Entity = {
      classname: 'worldspawn',
      properties: {},
      brushes: [],
      patches: [],
    };
    let pendingComment: MapToken | undefined;

    while (this.current().kind !== 'eof') {
      const token = this.current();
      if (token.kind === 'comment') {
        pendingComment = token;
        this.index++;
        continue;
      }
      if (token.kind === 'brace-close') {
        this.index++;
        return entity;
      }
      if (token.kind === 'string') {
        pendingComment = undefined;
        this.parseProperty(entity);
        continue;
      }
      if (token.kind === 'brace-open') {
        const brushName = pendingComment && !AUTO_GENERATED_COMMENT.test(pendingComment.value)
          ? pendingComment.value
          : undefined;
        pendingComment = undefined;
        this.parseEntityBlock(entity, brushName);
        continue;
      }

      pendingComment = undefined;
      this.report('warning', token, `Ignored unexpected entity content '${token.value}'`);
      this.skipLine(token.line);
    }

    this.report('error', openingBrace, 'Entity is missing a closing brace');
    return entity;
  }

  private parseProperty(entity: Entity): void {
    const key = this.current();
    this.index++;
    const value = this.currentSignificant();
    if (value.kind !== 'string') {
      this.report('warning', value, `Ignored malformed entity property '${key.value}'`);
      this.skipLine(key.line);
      return;
    }
    this.index++;
    entity.properties[key.value] = value.value;
    if (key.value === 'classname') entity.classname = value.value;
  }

  private parseEntityBlock(entity: Entity, brushName?: string): void {
    const openIndex = this.index;
    const openingBrace = this.tokens[openIndex];
    const closeIndex = this.findClosingBrace(openIndex);
    this.index++;
    this.skipComments();
    const marker = this.current();

    if (marker.kind === 'word' && marker.value === 'patchDef2') {
      this.index++;
      const patch = this.parsePatchDef2(closeIndex);
      if (patch) entity.patches.push(patch);
      this.index = Math.min(closeIndex + 1, this.tokens.length - 1);
      return;
    }
    if (marker.kind === 'word' && marker.value === 'terrainDef') {
      this.index++;
      const patch = this.parseTerrainDef(closeIndex);
      if (patch) entity.patches.push(patch);
      this.index = Math.min(closeIndex + 1, this.tokens.length - 1);
      return;
    }
    if (marker.kind === 'word' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(marker.value) &&
        this.nextSignificantKind(this.index + 1) === 'brace-open') {
      const closingBrace = this.tokens[closeIndex] ?? this.tokens[this.tokens.length - 1];
      this.unsupportedConstructs.push({
        keyword: marker.value,
        line: marker.line,
        column: marker.column,
        rawSource: this.source.slice(openingBrace.offset, closingBrace.endOffset),
      });
      this.report('warning', marker, `Unsupported map block '${marker.value}' was skipped`);
      this.index = Math.min(closeIndex + 1, this.tokens.length - 1);
      return;
    }

    const brush = this.parseClassicBrush(closeIndex, openingBrace);
    if (brush) {
      if (brushName) brush.name = brushName;
      entity.brushes.push(brush);
    }
    this.index = Math.min(closeIndex + 1, this.tokens.length - 1);
  }

  private parseClassicBrush(closeIndex: number, openingBrace: MapToken): Brush | null {
    const faces: BrushFace[] = [];
    while (this.index < closeIndex && this.current().kind !== 'eof') {
      this.skipComments();
      if (this.index >= closeIndex) break;
      const token = this.current();
      if (token.kind !== 'paren-open') {
        this.report('warning', token, 'Ignored malformed brush face');
        this.skipLine(token.line);
        continue;
      }
      const face = this.parseClassicFace(closeIndex);
      if (face) faces.push(face);
      else this.skipToNextFace(closeIndex);
    }

    if (faces.length < 4) {
      this.report('warning', openingBrace, 'Ignored brush with fewer than 4 valid faces');
      return null;
    }
    const brush: Brush = { faces, mins: [0, 0, 0], maxs: [0, 0, 0] };
    computeBrushGeometry(brush);
    return brush;
  }

  private parseClassicFace(limit: number): BrushFace | null {
    const start = this.current();
    const points: Vec3[] = [];
    for (let point = 0; point < 3; point++) {
      const value = this.readNumberTuple(3, limit, 'brush face point');
      if (!value) {
        this.report('warning', start, 'Ignored malformed brush face');
        return null;
      }
      points.push(value as Vec3);
    }

    const texture = this.readText(limit, 'brush face texture');
    if (texture === null) {
      this.report('warning', start, 'Ignored malformed brush face');
      return null;
    }
    const values: number[] = [];
    for (const label of ['horizontal offset', 'vertical offset', 'rotation', 'horizontal scale', 'vertical scale']) {
      const value = this.readNumber(limit, `brush face ${label}`);
      if (value === null) {
        this.report('warning', start, 'Ignored malformed brush face');
        return null;
      }
      values.push(value);
    }
    const optional = [0, 0, 0];
    for (let index = 0; index < optional.length; index++) {
      this.skipComments();
      const token = this.current();
      if (this.index >= limit || token.kind !== 'word' || !Number.isFinite(Number(token.value))) break;
      optional[index] = Number(token.value);
      this.index++;
    }

    return createFace(
      points[0], points[2], points[1],
      texture,
      values[0], values[1], values[2], values[3], values[4],
      optional[0], optional[1], optional[2],
    );
  }

  private parsePatchDef2(limit: number): Patch | null {
    if (!this.expect('brace-open', limit, "Expected '{' after patchDef2")) return null;
    const texture = this.readText(limit, 'patch texture');
    if (texture === null) return null;
    const header = this.readNumberTuple(5, limit, 'patch header');
    if (!header) return null;
    const height = this.integerDimension(header[0], 'patch row count');
    const width = this.integerDimension(header[1], 'patch column count');
    if (width === null || height === null) return null;
    if (!this.expect('paren-open', limit, "Expected '(' before patch control matrix")) return null;

    const ctrl: PatchControlPoint[][] = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
      if (!this.expect('paren-open', limit, `Expected '(' before patch row ${rowIndex + 1}`)) return null;
      const row: PatchControlPoint[] = [];
      for (let columnIndex = 0; columnIndex < width; columnIndex++) {
        const point = this.readNumberTuple(5, limit, `patch control point ${rowIndex + 1}:${columnIndex + 1}`);
        if (!point) return null;
        row.push({ xyz: [point[0], point[1], point[2]], uv: [point[3], point[4]] });
      }
      if (!this.expect('paren-close', limit, `Expected ')' after patch row ${rowIndex + 1}`)) return null;
      ctrl.push(row);
    }
    if (!this.expect('paren-close', limit, "Expected ')' after patch control matrix")) return null;
    if (!this.expect('brace-close', limit, "Expected '}' after patchDef2 data")) return null;

    const patch: Patch = {
      width,
      height,
      texture,
      contentFlags: header[2],
      surfaceFlags: header[3],
      value: header[4],
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

  private parseTerrainDef(limit: number): Patch | null {
    if (!this.expect('brace-open', limit, "Expected '{' after terrainDef")) return null;
    const header = this.readNumberSequence(4, limit, 'terrain header');
    if (!header) return null;
    const width = this.integerDimension(header[0], 'terrain width', 2);
    const height = this.integerDimension(header[1], 'terrain height', 2);
    if (width === null || height === null) return null;
    const originValues = this.readNumberSequence(3, limit, 'terrain origin');
    if (!originValues) return null;
    const origin: Vec3 = [originValues[0], originValues[1], originValues[2]];
    const ctrl: PatchControlPoint[][] = [];
    const surfaces: TerrainDefSurface[][] = [];

    for (let row = 0; row < height; row++) {
      const ctrlRow: PatchControlPoint[] = [];
      const surfaceRow: TerrainDefSurface[] = [];
      for (let column = 0; column < width; column++) {
        const heightValue = this.readNumber(limit, `terrain height ${row + 1}:${column + 1}`);
        const texture = this.readText(limit, `terrain texture ${row + 1}:${column + 1}`);
        const values: number[] = [];
        for (let valueIndex = 0; valueIndex < 8; valueIndex++) {
          const value = this.readNumber(limit, `terrain surface value ${row + 1}:${column + 1}`);
          if (value === null) return null;
          values.push(value);
        }
        if (heightValue === null || texture === null) return null;
        const surface: TerrainDefSurface = {
          texture,
          offsetX: values[0],
          offsetY: values[1],
          rotation: values[2],
          scaleX: values[3],
          scaleY: values[4],
          contentFlags: values[5],
          surfaceFlags: values[6],
          value: values[7],
        };
        const x = origin[0] + column * header[2];
        const y = origin[1] + row * header[3];
        ctrlRow.push({ xyz: [x, y, origin[2] + heightValue], uv: terrainDefUv(surface, x, y) });
        surfaceRow.push(surface);
      }
      ctrl.push(ctrlRow);
      surfaces.push(surfaceRow);
    }
    if (!this.expect('brace-close', limit, "Expected '}' after terrainDef data")) return null;
    const firstSurface = surfaces[0][0];
    const patch: Patch = {
      width,
      height,
      texture: firstSurface.texture,
      terrainDef: { origin, scale: [header[2], header[3]], surfaces, serializable: true },
      contentFlags: firstSurface.contentFlags,
      surfaceFlags: firstSurface.surfaceFlags,
      value: firstSurface.value,
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

  private readNumberSequence(count: number, limit: number, description: string): number[] | null {
    this.skipComments();
    const parenthesized = this.current().kind === 'paren-open';
    if (parenthesized) this.index++;
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      const value = this.readNumber(limit, description);
      if (value === null) return null;
      values.push(value);
    }
    if (parenthesized && !this.expect('paren-close', limit, `Expected ')' after ${description}`)) return null;
    return values;
  }

  private readNumberTuple(count: number, limit: number, description: string): number[] | null {
    if (!this.expect('paren-open', limit, `Expected '(' before ${description}`)) return null;
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      const value = this.readNumber(limit, description);
      if (value === null) return null;
      values.push(value);
    }
    if (!this.expect('paren-close', limit, `Expected ')' after ${description}`)) return null;
    return values;
  }

  private readNumber(limit: number, description: string): number | null {
    this.skipComments();
    const token = this.current();
    const value = Number(token.value);
    if (this.index >= limit || token.kind !== 'word' || !Number.isFinite(value)) {
      this.report('error', token, `Expected number for ${description}`);
      return null;
    }
    this.index++;
    return value;
  }

  private readText(limit: number, description: string): string | null {
    this.skipComments();
    const token = this.current();
    if (this.index >= limit || (token.kind !== 'word' && token.kind !== 'string')) {
      this.report('error', token, `Expected ${description}`);
      return null;
    }
    this.index++;
    return token.value;
  }

  private expect(kind: MapTokenKind, limit: number, message: string): MapToken | null {
    this.skipComments();
    const token = this.current();
    if (this.index >= limit || token.kind !== kind) {
      this.report('error', token, message);
      return null;
    }
    this.index++;
    return token;
  }

  private integerDimension(value: number, description: string, minimum = 1): number | null {
    if (Number.isInteger(value) && value >= minimum) return value;
    this.report('error', this.current(), `Expected ${description} to be an integer of at least ${minimum}`);
    return null;
  }

  private findClosingBrace(openIndex: number): number {
    let depth = 0;
    for (let index = openIndex; index < this.tokens.length; index++) {
      if (this.tokens[index].kind === 'brace-open') depth++;
      else if (this.tokens[index].kind === 'brace-close') {
        depth--;
        if (depth === 0) return index;
      }
    }
    this.report('error', this.tokens[openIndex], 'Map block is missing a closing brace');
    return this.tokens.length - 1;
  }

  private skipComments(): void {
    while (this.current().kind === 'comment') this.index++;
  }

  private currentSignificant(): MapToken {
    this.skipComments();
    return this.current();
  }

  private current(): MapToken {
    return this.tokens[Math.min(this.index, this.tokens.length - 1)];
  }

  private nextSignificantKind(startIndex: number): MapTokenKind {
    let index = startIndex;
    while (this.tokens[index]?.kind === 'comment') index++;
    return this.tokens[index]?.kind ?? 'eof';
  }

  private skipLine(line: number): void {
    while (this.current().kind !== 'eof' && this.current().line === line) this.index++;
  }

  private skipToNextFace(limit: number): void {
    while (this.index < limit && this.current().kind !== 'eof') {
      if (this.current().kind === 'paren-open') return;
      this.index++;
    }
  }

  private report(severity: MapParseDiagnosticSeverity, token: MapToken, message: string): void {
    this.diagnostics.push({ severity, line: token.line, column: token.column, message });
  }
}

export function parseMapWithDiagnostics(source: string): MapParseResult {
  const tokenized = tokenizeMap(source);
  const parser = new MapParser(source, tokenized.tokens, tokenized.diagnostics);
  return parser.parse();
}

export function parseMap(source: string): Entity[] {
  return parseMapWithDiagnostics(source).document.entities;
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
