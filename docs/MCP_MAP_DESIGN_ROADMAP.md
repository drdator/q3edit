# MCP Map Design Roadmap

This document tracks improvements intended to help MCP agents create maps that
feel authored rather than assembled from boxes and straight corridors.

## Problem

Agents currently favor simple, axis-aligned geometry because it is the safest
and cheapest geometry to describe, validate, revise, and texture through the
MCP API. Adding more primitive types alone will not fully solve this. Agents
also need a vocabulary for spatial intent, useful feedback, and generic tools
that make interesting compositions as reliable as rectangular blockouts.

## Design goals

- Make curved, angled, layered, and vertically connected spaces easy to author.
- Let agents reason in terms of rooms, routes, landmarks, and spatial
  relationships instead of individual brushes.
- Preserve predictable texture projection, compiler-safe geometry, undo, stable
  references, and atomic `map_apply` batches.
- Give agents measurable feedback about spatial variety and composition.
- Support deliberate repetition and variation without producing noisy or
  arbitrary geometry.

## Non-goals

- Do not build a large bundled library of authored prefabs or map fragments.
- Do not make agents dependent on a fixed architectural kit or visual style.
- Do not hide substantial opaque geometry behind operations that cannot be
  inspected, edited, or reproduced from explicit parameters.
- Do not substitute decorative complexity for a coherent layout.

Existing focused helpers may remain useful, but new work should favor generic
construction and refinement operations over an expanding prefab catalog.

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

### 2. Semantic spaces and connections

- [ ] Add `create_area` with purpose, center, bounds/radius, height, levels,
  shape language, openings, and landmark intent.
- [ ] Support shapes such as rectangular, octagonal, radial, curved, terraced,
  and irregular.
- [ ] Add `connect_areas` with route type, width, vertical change, curvature,
  cover, visibility, and traversal intent.
- [ ] Represent the area and route graph independently of generated brushes.
- [ ] Let the implementation choose compiler-safe generic brushes and patches.
- [ ] Return semantic relationships alongside generated object references.
- [ ] Let spatial review evaluate the intended and realized area graph.
- [ ] Support previewing the spatial plan before generating geometry.

This gives agents a vocabulary closer to level design: “connect the atrium to
the upper flank with a curved, partially enclosed route” instead of a long list
of coordinates. It should happen before detailed geometry so composition drives
construction rather than emerging accidentally from it.

### 3. Angled brush construction, curves, and patches

- [ ] Make arbitrary plane-based brush construction easy to validate and use.
- [ ] Add reliable wedge, trapezoid, tapered, and octagonal brush operations.
- [ ] Add `create_patch_bevel`.
- [ ] Add `create_patch_endcap`.
- [ ] Add `create_patch_cylinder`.
- [ ] Add `create_patch_arch`.
- [ ] Add `create_patch_pipe`.
- [ ] Add `create_patch_ramp`.
- [ ] Add `thicken_patch`.
- [ ] Add `fit_patch_texture` and predictable texture controls.
- [ ] Support stable aliases, groups, preview, and atomic application.
- [ ] Add geometry/compiler validation for generated brushes and patches.

Generic angled brushes and patches provide the direct escape from box-only
architecture while remaining inspectable, editable, and native to Quake 3.

### 4. Path-based construction

- [ ] Create a corridor along a polyline or spline.
- [ ] Create walls along a path.
- [ ] Create railings along a path.
- [ ] Create pipes, beams, and trim along a path.
- [ ] Create stairs along a curved or segmented path.
- [ ] Distribute generated supports or objects along a path.
- [ ] Support corners, joins, caps, spacing, banking, and controlled variation.
- [ ] Preview generated bounds and object counts before applying.
- [ ] Return the underlying path and generated-object relationships so later
  edits remain understandable.

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

### 6. Abstract design-pattern guidance

- [ ] Add `design_pattern_search`.
- [ ] Describe abstract spatial patterns such as:
  - raised perimeter loop
  - crossing bridges
  - split-level room
  - curved flank corridor
  - radial landmark
  - compression-release entrance
  - vertical courtyard
  - layered arena with an exposed center
- [ ] Describe appropriate scale, gameplay purpose, risks, and variations.
- [ ] Express patterns as area-graph and route constraints rather than geometry.
- [ ] Allow a selected pattern to guide `create_area` and `connect_areas` calls.
- [ ] Require the agent to adapt each pattern to the current bounds, style,
  gameplay needs, and existing layout.
- [ ] Do not ship opaque brushwork, fixed coordinates, or authored map fragments
  as part of a pattern.

### 7. Controlled variation

- [ ] Add alternating and role-based material sequences.
- [ ] Add deterministic size, spacing, and rotation sequences.
- [ ] Add mirror and radial distribution helpers.
- [ ] Add bounded position, scale, and orientation variation with a seed.
- [ ] Add parameterized variation rules for repeated generated geometry.
- [ ] Preview the generated result and report collisions or invalid geometry.
- [ ] Discourage unbounded randomness and preserve grid/compiler constraints.

Controlled variation should break visible repetition while retaining deliberate
rhythm and making results reproducible.

## Agent workflow after implementation

1. Read or establish the map style brief.
2. Define semantic areas, vertical levels, landmarks, and intended route graph.
3. Use an abstract design pattern when it supports the intended gameplay.
4. Preview and review the spatial plan before committing detailed geometry.
5. Generate the main spaces with angled brushes, patches, and path-based
   connections.
6. Refine the blockout and apply controlled variation where repetition is
   visible.
7. Run spatial, geometry, texture, gameplay, and style reviews.
8. Use multi-angle screenshots to inspect silhouette, rhythm, and navigation.
9. Refine flagged sections instead of rebuilding the entire map.
10. Save, compile, and playtest after the editor-level review converges.

## Success criteria

- Agents routinely create angled, curved, layered, and vertically varied maps.
- Interesting layouts require fewer low-level operations than box-based maps.
- Generated maps contain readable landmarks and multiple recognizable spaces.
- Routes include meaningful loops, choices, and changes in openness and height.
- Decorative detail improves silhouette and rhythm without harming BSP/VIS.
- Texture projection remains intentional on generated and refined geometry.
- The same request and seed produce reproducible geometry.
- Spatial review scores and visual inspection improve across agent iterations.
- Output quality does not depend on a bundled catalog of authored prefabs.

