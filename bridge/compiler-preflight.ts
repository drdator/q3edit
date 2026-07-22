import { parseMapWithDiagnostics, serializeMap } from '../src/mapfile';
import { isGroupInfoEntity } from '../src/named-groups';

export interface CompilerPreflightSanitization {
  kind: 'entity-metadata' | 'group-record' | 'brush-properties' | 'patch-properties' | 'group-membership';
  ref: string;
  keys: string[];
  message: string;
}

export function inspectCompilerPreflight(mapText: string): {
  ready: boolean;
  compilerSafeExport: true;
  source: { bytes: number; maxLineLength: number; diagnostics: ReturnType<typeof parseMapWithDiagnostics>['diagnostics'] };
  compilerInput: { bytes: number; maxLineLength: number; diagnostics: ReturnType<typeof parseMapWithDiagnostics>['diagnostics'] };
  sanitizationCount: number;
  sanitizations: CompilerPreflightSanitization[];
  unsupportedConstructs: ReturnType<typeof parseMapWithDiagnostics>['unsupportedConstructs'];
} {
  const parsed = parseMapWithDiagnostics(mapText);
  const sanitizations: CompilerPreflightSanitization[] = [];
  parsed.document.entities.forEach((entity, entityIndex) => {
    const entityRef = `E${entityIndex}`;
    if (isGroupInfoEntity(entity)) sanitizations.push({
      kind: 'group-record', ref: entityRef, keys: Object.keys(entity.properties),
      message: `${entityRef} is an editor-only named-group record and will be omitted from q3map input.`,
    });
    const metadataKeys = Object.keys(entity.properties).filter(key => key.startsWith('_q3edit_'));
    if (metadataKeys.length > 0) sanitizations.push({
      kind: 'entity-metadata', ref: entityRef, keys: metadataKeys,
      message: `${entityRef} contains editor metadata that will be omitted from q3map input.`,
    });
    if (entity.properties._q3edit_group_id) sanitizations.push({
      kind: 'group-membership', ref: entityRef, keys: ['_q3edit_group_id', 'group'],
      message: `${entityRef} uses editor group membership that will be omitted from q3map input.`,
    });
    entity.brushes.forEach((brush, brushIndex) => {
      const keys = Object.keys(brush.properties ?? {});
      if (keys.length > 0) sanitizations.push({
        kind: 'brush-properties', ref: `${entityRef}:B${brushIndex}`, keys,
        message: `${entityRef}:B${brushIndex} has editor-local brush properties that will be omitted from q3map input.`,
      });
      if (brush.editorGroupId) sanitizations.push({
        kind: 'group-membership', ref: `${entityRef}:B${brushIndex}`, keys: ['q3edit-group'],
        message: `${entityRef}:B${brushIndex} uses editor group membership that will be omitted from q3map input.`,
      });
    });
    entity.patches.forEach((patch, patchIndex) => {
      const ref = `${entityRef}:P${patchIndex}`;
      const keys = Object.keys(patch.properties ?? {});
      if (keys.length > 0) sanitizations.push({
        kind: 'patch-properties', ref, keys,
        message: `${ref} has properties outside the native patch matrix that will be omitted from q3map input.`,
      });
      if (patch.editorGroupId) sanitizations.push({
        kind: 'group-membership', ref, keys: ['q3edit-group'],
        message: `${ref} uses editor group membership that will be omitted from q3map input.`,
      });
    });
  });
  const compilerText = serializeMap(parsed.document.entities, { compilerSafe: true });
  const compilerParsed = parseMapWithDiagnostics(compilerText);
  const maxLineLength = (text: string): number => Math.max(0, ...text.split('\n').map(line => line.length));
  return {
    ready: parsed.errors.length === 0 && compilerParsed.errors.length === 0 && parsed.unsupportedConstructs.length === 0,
    compilerSafeExport: true,
    source: { bytes: new TextEncoder().encode(mapText).byteLength, maxLineLength: maxLineLength(mapText), diagnostics: parsed.diagnostics },
    compilerInput: { bytes: new TextEncoder().encode(compilerText).byteLength, maxLineLength: maxLineLength(compilerText), diagnostics: compilerParsed.diagnostics },
    sanitizationCount: sanitizations.length,
    sanitizations,
    unsupportedConstructs: parsed.unsupportedConstructs,
  };
}
