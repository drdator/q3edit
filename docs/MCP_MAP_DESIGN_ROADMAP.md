# MCP Map Design Roadmap

This document tracks improvements intended to help MCP agents create maps that
feel authored rather than assembled from boxes and straight corridors.

## Problem

Agents currently favor simple, axis-aligned geometry because it is the safest
and cheapest geometry to describe, validate, revise, and texture through the
MCP API. Adding more primitive types alone will not fully solve this. Agents
also need higher-level architectural vocabulary, spatial feedback, and tools
that make interesting compositions as reliable as rectangular blockouts.

## Design goals

- Make curved, angled, layered, and vertically connected spaces easy to author.
- Let agents reason in terms of rooms, routes, landmarks, and architectural
  modules instead of individual brushes.
- Preserve predictable texture projection, compiler-safe geometry, undo, stable
  references, and atomic `map_apply` batches.
- Give agents measurable feedback about spatial variety and composition.
- Support deliberate repetition and variation without producing noisy or
  arbitrary geometry.

## Recommended implementation order

### 1. Spatial design review

- [ ] Add `map_spatial_review` with typed output.
- [ ] Measure the percentage of axis-aligned geometry.
- [ ] Report distinct floor and traversal height levels.
- [ ] Measure footprint, volume, and height diversity.
- [ ] Detect excessive use of straight corridors and rectangular rooms.
- [ ] Estimate route branching, loops, and dead ends.
- [ ] Review open/enclosed and compression/release rhythm.
- [ ] Detect excessive symmetry and repeated dimensions.
- [ ] Review landmark distribution and silhouette variation.
- [ ] Flag long, uninterrupted flat walls.
- [ ] Integrate the findings into `map_design_review`.
- [ ] Document suggested corrective operations for every finding type.

This should come first because it gives agents an objective signal to improve,
and lets us measure whether later geometry tools actually produce better maps.

### 2. Curves and patches

- [ ] Add `create_patch_bevel`.
- [ ] Add `create_patch_endcap`.
- [ ] Add `create_patch_cylinder`.
- [ ] Add `create_patch_arch`.
- [ ] Add `create_patch_pipe`.
- [ ] Add `create_patch_ramp`.
- [ ] Add `thicken_patch`.
- [ ] Add `fit_patch_texture` and predictable texture controls.
- [ ] Support stable aliases, groups, preview, and atomic application.
- [ ] Add geometry/compiler validation for generated patches.

Patches provide the most direct escape from box-only architecture and are
native to the Quake 3 visual language.

### 3. Architectural module library

- [ ] Extend `create_prefab` with arches and archways.
- [ ] Add alcoves and recessed wall bays.
- [ ] Add buttresses and supports.
- [ ] Add windows and window frames.
- [ ] Add balconies and overlooks.
- [ ] Add bridges and catwalks.
- [ ] Add railings and barriers.
- [ ] Add pipes, beams, trim bands, and ceiling ribs.
- [ ] Add curved and spiral stair modules.
- [ ] Add jump-pad and teleporter chambers.
- [ ] Define named snap points/connectors on every applicable prefab.
- [ ] Keep material roles and texture transforms explicit.
- [ ] Mark decorative pieces as detail by default where appropriate.
- [ ] Return compact bounds, connectors, aliases, and created references.

Modules should be parametric rather than fixed assets. Dimensions, curvature,
segment count, materials, detail level, and orientation should remain editable.

### 4. Path-based construction

- [ ] Create a corridor along a polyline or spline.
- [ ] Create walls along a path.
- [ ] Create railings along a path.
- [ ] Create pipes, beams, and trim along a path.
- [ ] Create stairs along a curved or segmented path.
- [ ] Distribute supports or modules along a path.
- [ ] Support corners, joins, caps, spacing, banking, and controlled variation.
- [ ] Preview generated bounds and object counts before applying.

Path-based tools let an agent express intent with a few control points instead
of constructing dozens of fragile individual pieces.

### 5. Brush refinement

- [ ] Chamfer or bevel selected corners.
- [ ] Taper a brush.
- [ ] Inset or extrude a face.
- [ ] Clip/slice corners and split brushes.
- [ ] Turn a rectangular room into an octagonal or angled room.
- [ ] Add recesses and openings without rebuilding surrounding geometry.
- [ ] Replace selected straight sections with angled or curved alternatives.
- [ ] Preserve or deliberately refit face materials during refinement.

These operations are especially valuable for revising a safe blockout into a
more expressive final layout.

### 6. Semantic spaces and connections

- [ ] Add `create_area` with purpose, center, bounds/radius, height, levels,
  shape language, openings, and landmark intent.
- [ ] Support shapes such as rectangular, octagonal, radial, curved, terraced,
  and irregular.
- [ ] Add `connect_areas` with route type, width, vertical change, curvature,
  cover, visibility, and traversal intent.
- [ ] Let the implementation choose compiler-safe brushes, patches, and modules.
- [ ] Return semantic relationships alongside generated object references.
- [ ] Let spatial review evaluate the resulting area graph.

This gives agents a vocabulary closer to level design: “connect the atrium to
the upper flank with a curved, partially enclosed route” instead of a long list
of coordinates.

### 7. Design-pattern library

- [ ] Add `design_pattern_search`.
- [ ] Provide authored patterns such as:
  - raised perimeter loop
  - crossing bridges
  - split-level room
  - curved flank corridor
  - radial landmark
  - compression/release entrance
  - vertical courtyard
  - layered arena with an exposed center
- [ ] Describe appropriate scale, gameplay purpose, risks, and variations.
- [ ] Allow a selected pattern to seed `create_area` and `connect_areas` calls.
- [ ] Keep patterns as guidance and parameterized structures, not opaque map
  fragments.

### 8. Controlled variation

- [ ] Add alternating and role-based material sequences.
- [ ] Add deterministic size, spacing, and rotation sequences.
- [ ] Add mirror and radial distribution helpers.
- [ ] Add bounded position, scale, and orientation variation with a seed.
- [ ] Add reusable variation presets for supports, trims, columns, and props.
- [ ] Preview the generated result and report collisions or invalid geometry.
- [ ] Discourage unbounded randomness and preserve grid/compiler constraints.

Controlled variation should break visible repetition while retaining deliberate
rhythm and making results reproducible.

## Agent workflow after implementation

1. Read or establish the map style brief.
2. Define semantic areas, vertical levels, landmarks, and intended route graph.
3. Select one or more suitable design patterns.
4. Generate the main spaces and path-based connections.
5. Apply architectural modules and controlled variation.
6. Run spatial, geometry, texture, gameplay, and style reviews.
7. Use multi-angle screenshots to inspect silhouette, rhythm, and navigation.
8. Refine flagged sections instead of rebuilding the entire map.
9. Save, compile, and playtest only after the editor-level review converges.

## Success criteria

- Agents routinely create angled, curved, layered, and vertically varied maps.
- Interesting layouts require fewer low-level operations than box-based maps.
- Generated maps contain readable landmarks and multiple recognizable spaces.
- Routes include meaningful loops, choices, and changes in openness and height.
- Decorative detail improves silhouette and rhythm without harming BSP/VIS.
- Texture projection remains intentional on generated and refined geometry.
- The same request and seed produce reproducible geometry.
- Spatial review scores and visual inspection improve across agent iterations.

