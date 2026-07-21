import { parseMapWithDiagnostics } from '../src/mapfile';

export interface DiagnosticExplanationInput {
  code?: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
  refs?: string[];
  unavailableTextures?: Set<string>;
}

function normalizeTexture(texture: string): string {
  return texture.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
}

function textureRefs(mapText: string, requested: string): string[] {
  const target = normalizeTexture(requested);
  const refs: string[] = [];
  parseMapWithDiagnostics(mapText).document.entities.forEach((entity, entityIndex) => {
    entity.brushes.forEach((brush, brushIndex) => brush.faces.forEach((face, faceIndex) => {
      if (normalizeTexture(face.texture) === target) refs.push(`E${entityIndex}:B${brushIndex}:F${faceIndex}`);
    }));
    entity.patches.forEach((patch, patchIndex) => {
      if (normalizeTexture(patch.texture) === target) refs.push(`E${entityIndex}:P${patchIndex}`);
    });
  });
  return refs;
}

function unavailableRefs(mapText: string, unavailable: Set<string>): string[] {
  const refs: string[] = [];
  for (const texture of unavailable) refs.push(...textureRefs(mapText, texture));
  return [...new Set(refs)].slice(0, 100);
}

export function explainDiagnostic(mapText: string, input: DiagnosticExplanationInput): Record<string, unknown> {
  const code = input.code?.toLowerCase() ?? '';
  const message = input.message.trim();
  const lower = `${code} ${message.toLowerCase()}`;
  const explicitShader = /(?:shader|texture|material)\s+["']?([^\s"']+)/i.exec(message)?.[1]?.replace(/[.,;:)]+$/, '');
  const inferredRefs = explicitShader && normalizeTexture(explicitShader) !== 'noshader'
    ? textureRefs(mapText, explicitShader)
    : /noshader|missing.shader|missing.texture/.test(lower)
      ? unavailableRefs(mapText, input.unavailableTextures ?? new Set())
      : [];
  const likelyRefs = [...new Set([...(input.refs ?? []), ...inferredRefs])].slice(0, 100);

  let impact: 'blocking' | 'visible' | 'quality' | 'informational' = input.severity === 'error' ? 'blocking' : 'quality';
  let explanation = 'This is an authoring heuristic. Inspect the implicated references and decide whether the geometry is intentional.';
  const suggestedTools: string[] = ['map_inspect', 'editor_capture'];
  const suggestedOperations: Array<Record<string, unknown>> = [];

  if (/noshader|missing.shader|missing.texture|couldn.t find image/.test(lower)) {
    impact = 'visible';
    explanation = likelyRefs.length > 0
      ? 'One or more referenced materials have no compiler/runtime source. They can compile to a placeholder or checker surface.'
      : 'The compiler reported an unresolved material, but did not identify a source object. Search the map’s materials and inspect declared shader/runtime compatibility.';
    suggestedTools.unshift('texture_search', 'texture_inspect');
    const faceRefs = likelyRefs.filter(ref => /:F\d+$/.test(ref));
    const patchRefs = likelyRefs.filter(ref => /:P\d+$/.test(ref));
    if (faceRefs.length > 0) suggestedOperations.push({ type: 'edit_faces', targets: faceRefs, texture: '<replacement from texture_search>', fit: true });
    if (patchRefs.length > 0) suggestedOperations.push({ type: 'edit_patches', targets: patchRefs, texture: '<replacement from texture_search>', textureMode: 'fit' });
  } else if (/leak/.test(lower)) {
    impact = 'blocking';
    explanation = 'The structural world is not sealed, so VIS and lighting cannot produce a valid final map.';
    suggestedTools.unshift('map_compile_preflight');
  } else if (/embedded|clearance|collision|blocked/.test(lower)) {
    impact = input.severity === 'error' ? 'blocking' : 'quality';
    explanation = 'The referenced gameplay object or route intersects solid geometry or lacks player-hull clearance.';
    suggestedTools.unshift('map_gameplay_lint', 'map_route_lint');
    const entities = likelyRefs.filter(ref => /^E\d+$/.test(ref));
    if (entities.length > 0) suggestedOperations.push({ type: 'translate', targets: entities, delta: ['<dx>', '<dy>', '<dz>'] });
  } else if (/small.structural|detail/.test(lower)) {
    impact = 'quality';
    explanation = 'Small decorative structural brushes increase BSP/VIS complexity and should normally be detail geometry.';
    const brushes = likelyRefs.filter(ref => /:B\d+$/.test(ref));
    if (brushes.length > 0) suggestedOperations.push({ type: 'set_brush_classification', targets: brushes, classification: 'detail' });
  } else if (/grid|off.grid/.test(lower)) {
    impact = 'informational';
    explanation = 'This reports modular-grid drift. Intentional angled or curved generated geometry may be left unchanged; axis-aligned drift should be corrected at its source operation.';
    suggestedTools.unshift('map_construction_paths_get', 'operation_schema');
  } else if (/long.flat.wall|axis.aligned|straight.layout/.test(lower)) {
    impact = 'quality';
    explanation = 'The review detected repetitive planar composition that may weaken silhouette, navigation, or landmark readability.';
    suggestedOperations.push({ type: 'chamfer_brushes', targets: likelyRefs.filter(ref => /:B\d+$/.test(ref)), amount: '<grid-sized amount>', corners: ['<selected corners>'] });
  } else if (input.severity === 'info') {
    impact = 'informational';
  }

  return {
    code: input.code ?? null, message, severity: input.severity ?? null, impact,
    matters: impact !== 'informational', explanation, likelyRefs,
    suggestedTools: [...new Set(suggestedTools)], suggestedOperations,
    note: 'Suggested operations are templates. Resolve placeholders and run map_preview before applying them.',
  };
}
