import type { MapStatistics } from './map-statistics';

export type DesignPatternScale = 'small' | 'medium' | 'large';

export interface DesignPattern {
  id: string;
  name: string;
  summary: string;
  scale: DesignPatternScale[];
  gameplayPurposes: string[];
  areaConstraints: Array<{
    role: string;
    purpose: string;
    shapes: string[];
    relativePosition: string;
    levelIntent: string;
    landmarkIntent?: string;
  }>;
  routeConstraints: Array<{
    fromRole: string;
    toRole: string;
    routeTypes: string[];
    traversalIntent: string;
    visibility: 'hidden' | 'glimpse' | 'visible';
    cover: 'open' | 'partial' | 'enclosed';
  }>;
  risks: string[];
  variations: string[];
  adaptation: string[];
}

const PATTERNS: DesignPattern[] = [
  {
    id: 'raised-perimeter-loop', name: 'Raised perimeter loop',
    summary: 'An upper circulation ring overlooks and repeatedly reconnects with a lower focal space.',
    scale: ['medium', 'large'], gameplayPurposes: ['route choice', 'height control', 'recovery circulation'],
    areaConstraints: [
      { role: 'center', purpose: 'lower contested focus', shapes: ['radial', 'octagonal', 'irregular'], relativePosition: 'inside the loop but not necessarily centered', levelIntent: 'lowest principal level', landmarkIntent: 'visible from several points on the loop' },
      { role: 'perimeter', purpose: 'segmented upper control route', shapes: ['curved', 'irregular'], relativePosition: 'wraps around two or more sides of center', levelIntent: 'one meaningful traversal tier above center' },
    ],
    routeConstraints: [
      { fromRole: 'perimeter', toRole: 'center', routeTypes: ['stairs', 'ramp', 'jump'], traversalIntent: 'at least two asymmetric drops/ascents', visibility: 'visible', cover: 'partial' },
      { fromRole: 'perimeter', toRole: 'perimeter', routeTypes: ['corridor', 'bridge'], traversalIntent: 'complete a loop without one dominant straight sightline', visibility: 'glimpse', cover: 'partial' },
    ],
    risks: ['upper route can dominate without exposure', 'perfect symmetry makes choices interchangeable'],
    variations: ['break one loop segment with a jump', 'compress one side into an enclosed gallery', 'offset the center landmark'],
    adaptation: ['fit the loop to existing structural edges', 'preserve at least two lower-to-upper transitions', 'vary cover and width around the circuit'],
  },
  {
    id: 'crossing-bridges', name: 'Crossing bridges',
    summary: 'Two routes cross at different heights, creating readable movement and contested vertical intersections.',
    scale: ['medium', 'large'], gameplayPurposes: ['cross-map flow', 'vertical encounters', 'sightline layering'],
    areaConstraints: [
      { role: 'crossing', purpose: 'vertical route intersection', shapes: ['rectangular', 'octagonal', 'irregular'], relativePosition: 'near a major circulation seam', levelIntent: 'at least two separated traversal heights', landmarkIntent: 'bridge profiles identify the crossing from afar' },
      { role: 'approaches', purpose: 'four non-equivalent bridge approaches', shapes: ['terraced', 'irregular'], relativePosition: 'distributed around crossing', levelIntent: 'mix direct, rising, and descending entries' },
    ],
    routeConstraints: [
      { fromRole: 'approaches', toRole: 'crossing', routeTypes: ['bridge', 'ramp'], traversalIntent: 'two routes cross without merging at the same height', visibility: 'visible', cover: 'open' },
    ],
    risks: ['long exposed bridges become unusable', 'crossing can become visually confusing'],
    variations: ['curve one bridge', 'make one route broad and one narrow', 'add a lower underpass recovery route'],
    adaptation: ['align each bridge to a meaningful destination', 'use silhouette and materials to distinguish levels', 'provide cover near exits rather than mid-span clutter'],
  },
  {
    id: 'split-level-room', name: 'Split-level room',
    summary: 'One recognizable room contains overlapping floor bands with short, frequent transitions.',
    scale: ['small', 'medium'], gameplayPurposes: ['localized route choice', 'item hierarchy', 'height variation'],
    areaConstraints: [
      { role: 'room', purpose: 'single readable volume with multiple floor bands', shapes: ['octagonal', 'terraced', 'irregular'], relativePosition: 'adapts to an existing room footprint', levelIntent: 'two or three levels separated by player-scale changes', landmarkIntent: 'one feature spans or visually links levels' },
    ],
    routeConstraints: [
      { fromRole: 'room', toRole: 'room', routeTypes: ['stairs', 'ramp', 'jump'], traversalIntent: 'form a small internal loop rather than a single up/down choke', visibility: 'visible', cover: 'partial' },
    ],
    risks: ['too many tiny ledges harm movement', 'levels can read as disconnected rooms'],
    variations: ['sunken center', 'raised side shelf', 'diagonal terrace sequence'],
    adaptation: ['keep transitions broad enough for combat', 'make each band serve a distinct route or pickup', 'retain a clear silhouette for the whole room'],
  },
  {
    id: 'curved-flank-corridor', name: 'Curved flank corridor',
    summary: 'A secondary route bends around a primary space, hiding its exit while offering intermediate glimpses.',
    scale: ['small', 'medium', 'large'], gameplayPurposes: ['flanking', 'sightline control', 'rhythm change'],
    areaConstraints: [
      { role: 'primary', purpose: 'space being flanked', shapes: ['rectangular', 'radial', 'irregular'], relativePosition: 'inside the route arc', levelIntent: 'same or slightly lower than flank' },
      { role: 'flank', purpose: 'curved secondary passage', shapes: ['curved', 'irregular'], relativePosition: 'connects separated edges of primary without crossing its center', levelIntent: 'vary gently or include one short vertical transition' },
    ],
    routeConstraints: [
      { fromRole: 'flank', toRole: 'primary', routeTypes: ['corridor', 'ramp'], traversalIntent: 'entrance and exit should not share direct line of sight', visibility: 'glimpse', cover: 'enclosed' },
    ],
    risks: ['route can become a safe, featureless tube', 'excess curvature wastes travel time'],
    variations: ['partial open arcade', 'one compressed bend and one broad release', 'rising outer curve'],
    adaptation: ['use create_path rather than many short axis-aligned boxes', 'place at least one orientation cue or glimpse', 'compare travel time with the primary route'],
  },
  {
    id: 'radial-landmark', name: 'Radial landmark',
    summary: 'Circulation and sightlines organize around an off-center radial feature with multiple approach qualities.',
    scale: ['small', 'medium', 'large'], gameplayPurposes: ['orientation', 'contested focus', 'route convergence'],
    areaConstraints: [
      { role: 'landmark', purpose: 'strong radial or vertical focus', shapes: ['radial', 'octagonal'], relativePosition: 'visible from key approaches but offset from exact map center', levelIntent: 'extends across more than one visual height band', landmarkIntent: 'unique silhouette and material/lighting treatment' },
      { role: 'orbit', purpose: 'non-uniform circulation around focus', shapes: ['curved', 'irregular'], relativePosition: 'wraps only part of landmark', levelIntent: 'mix lower and raised observation points' },
    ],
    routeConstraints: [
      { fromRole: 'orbit', toRole: 'landmark', routeTypes: ['open', 'bridge', 'stairs'], traversalIntent: 'three or more approaches with different exposure', visibility: 'visible', cover: 'open' },
    ],
    risks: ['radial symmetry can flatten decisions', 'landmark may block movement rather than organize it'],
    variations: ['broken ring', 'offset vertical core', 'one inaccessible visual-only center'],
    adaptation: ['break equal angular spacing', 'preserve circulation around at least two sides', 'frame rather than repeat the landmark material'],
  },
  {
    id: 'compression-release-entrance', name: 'Compression-release entrance',
    summary: 'A narrow, lower, or enclosed approach opens abruptly into a larger and more legible destination.',
    scale: ['small', 'medium'], gameplayPurposes: ['pacing', 'reveal', 'orientation reset'],
    areaConstraints: [
      { role: 'compression', purpose: 'short constrained approach', shapes: ['rectangular', 'curved'], relativePosition: 'immediately before a major destination', levelIntent: 'lower ceiling or narrower section' },
      { role: 'release', purpose: 'open destination and reveal', shapes: ['radial', 'octagonal', 'irregular'], relativePosition: 'opens beyond a framed threshold', levelIntent: 'greater height and lateral extent', landmarkIntent: 'visible at or just after threshold' },
    ],
    routeConstraints: [
      { fromRole: 'compression', toRole: 'release', routeTypes: ['corridor', 'stairs', 'ramp'], traversalIntent: 'short transition with a framed reveal, not a long choke', visibility: 'glimpse', cover: 'enclosed' },
    ],
    risks: ['entrance becomes a spawn trap or hard choke', 'release is weak if visible too early'],
    variations: ['turn before reveal', 'descend then open upward', 'use an angled threshold'],
    adaptation: ['keep constrained segment short', 'provide another exit from the released space', 'test reveal in perspective screenshot'],
  },
  {
    id: 'vertical-courtyard', name: 'Vertical courtyard',
    summary: 'An open vertical void links stacked perimeter routes and makes height relationships immediately readable.',
    scale: ['medium', 'large'], gameplayPurposes: ['vertical navigation', 'orientation', 'cross-level encounters'],
    areaConstraints: [
      { role: 'void', purpose: 'open vertical reference space', shapes: ['rectangular', 'octagonal', 'radial'], relativePosition: 'between several occupied edges', levelIntent: 'visually spans all principal levels', landmarkIntent: 'sky, light, or vertical structure emphasizes height' },
      { role: 'edges', purpose: 'stacked occupied balconies and routes', shapes: ['terraced', 'irregular'], relativePosition: 'occupy non-uniform portions of void boundary', levelIntent: 'at least three readable height bands' },
    ],
    routeConstraints: [
      { fromRole: 'edges', toRole: 'edges', routeTypes: ['stairs', 'ramp', 'bridge', 'jump'], traversalIntent: 'combine gradual and fast vertical transitions', visibility: 'visible', cover: 'partial' },
    ],
    risks: ['open center creates oppressive sightlines', 'falls and dead ends can interrupt flow'],
    variations: ['offset void', 'crossing bridge at one level', 'partially roofed edge'],
    adaptation: ['break sightlines with edge offsets rather than center clutter', 'provide recovery routes at the bottom', 'use front/side layout screenshots to inspect height bands'],
  },
  {
    id: 'layered-exposed-center', name: 'Layered arena with exposed center',
    summary: 'Multiple perimeter and diagonal layers offer safer circulation around a powerful but vulnerable center.',
    scale: ['medium', 'large'], gameplayPurposes: ['risk-reward focus', 'route loops', 'combat readability'],
    areaConstraints: [
      { role: 'center', purpose: 'high-value exposed focus', shapes: ['radial', 'octagonal', 'irregular'], relativePosition: 'offset within overlapping route loops', levelIntent: 'low or mid level with exposure from above', landmarkIntent: 'clear high-value visual treatment' },
      { role: 'layers', purpose: 'distinct surrounding circulation bands', shapes: ['terraced', 'curved', 'irregular'], relativePosition: 'overlap in plan without forming concentric symmetry', levelIntent: 'two or more traversal levels' },
    ],
    routeConstraints: [
      { fromRole: 'layers', toRole: 'layers', routeTypes: ['corridor', 'bridge', 'stairs', 'ramp'], traversalIntent: 'at least one loop and one cross-connection', visibility: 'glimpse', cover: 'partial' },
      { fromRole: 'layers', toRole: 'center', routeTypes: ['open', 'jump'], traversalIntent: 'several fast entries with exposed exits', visibility: 'visible', cover: 'open' },
    ],
    risks: ['perimeter becomes universally safer than center', 'too many layers obscure navigation'],
    variations: ['diagonal upper bridge', 'sunken center', 'one interrupted perimeter band'],
    adaptation: ['give each layer a different silhouette and route role', 'keep the center readable from spawn approaches', 'compare route lengths and exposure with design review plus playtest'],
  },
];

function terms(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 1);
}

export function searchDesignPatterns(
  query: string | undefined,
  goals: string[],
  scale: DesignPatternScale | undefined,
  limit: number,
  statistics: MapStatistics,
): Array<DesignPattern & { matchReasons: string[]; liveMapAdaptation: { worldBounds: MapStatistics['worldBounds']; recommendedSpan: [number, number] | null; instructions: string[] } }> {
  const requested = new Set([...terms(query ?? ''), ...goals.flatMap(terms)]);
  const horizontalSpan = statistics.worldSize ? Math.max(statistics.worldSize[0], statistics.worldSize[1]) : null;
  const ratios: Record<DesignPatternScale, [number, number]> = { small: [0.15, 0.35], medium: [0.3, 0.65], large: [0.55, 0.95] };
  return PATTERNS.map(pattern => {
    const haystack = new Set(terms(JSON.stringify(pattern)));
    const matched = [...requested].filter(term => haystack.has(term));
    const scaleMatch = !scale || pattern.scale.includes(scale);
    const score = matched.length * 3 + (scaleMatch ? 2 : -4);
    const chosenScale = scale && pattern.scale.includes(scale) ? scale : pattern.scale[0];
    const ratio = ratios[chosenScale];
    return {
      pattern, score,
      matchReasons: [
        ...(matched.length ? [`Matched goals: ${matched.join(', ')}`] : []),
        ...(scaleMatch && scale ? [`Supports ${scale} layouts`] : []),
      ],
      recommendedSpan: horizontalSpan ? [Math.round(horizontalSpan * ratio[0]), Math.round(horizontalSpan * ratio[1])] as [number, number] : null,
    };
  }).filter(result => requested.size === 0 || result.score > 0)
    .sort((a, b) => b.score - a.score || a.pattern.name.localeCompare(b.pattern.name))
    .slice(0, limit)
    .map(({ pattern, matchReasons, recommendedSpan }) => ({
      ...pattern, matchReasons,
      liveMapAdaptation: {
        worldBounds: statistics.worldBounds, recommendedSpan,
        instructions: [
          'Translate roles into create_area ids with bounds, levels, shape, and landmark intent adapted to the live map.',
          'Translate route constraints into connect_areas calls, then realize curved or repeated construction with create_path only after previewing the semantic graph.',
          'Do not copy fixed coordinates or create every variation; choose the smallest changes that improve the current route graph.',
        ],
      },
    }));
}
