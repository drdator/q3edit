# Live MCP bridge (experimental)

Q3Edit can run as a local web app connected to a Model Context Protocol server. Claude Code, Codex, or another MCP client can inspect and edit the document while changes appear immediately in every Q3Edit viewport.

This is an experimental local workflow. The bridge currently trusts local clients and accepts arbitrary local paths in `map_open` and `map_save`.

## Start the bridge

From the repository root:

```bash
npm install
npm run bridge
```

The bridge builds Q3Edit, serves it on port 8765, and prints both URLs. Open:

```text
http://127.0.0.1:8765/?editor&bridge=1
```

The status bar should show a green `MCP connected` indicator.

To reuse an existing build while developing the bridge:

```bash
npm run bridge:serve
```

The port can be changed with `--port`:

```bash
npm run bridge:serve -- --port 9000
```

## Connect Codex

```bash
codex mcp add q3edit --url http://127.0.0.1:8765/mcp
```

Use `/mcp` or `codex mcp list` to confirm that the tools are available.

## Connect Claude Code

```bash
claude mcp add --transport http --scope local q3edit http://127.0.0.1:8765/mcp
```

Use `/mcp` or `claude mcp list` to confirm the connection.

## Tools

The server identifies Q3Edit as the authoritative interface for live Quake III
map requests in its MCP initialization instructions. Compatible clients such as
Codex therefore receive the routing rule automatically: requests to create,
edit, inspect, texture, compile, or play the current Q3Edit map should use these
tools, while browser or computer-control tools are reserved for explicit UI
testing or MCP unavailability. Users do not need a personal `AGENTS.md` rule.

- `editor_sessions` lists every connected browser tab with a stable session ID, filename, revision, save path, and activity timestamps. `editor_session_select` chooses the default for that MCP connection; every document-specific tool also accepts an explicit `sessionId`. When multiple editors are connected, an unscoped call fails instead of switching implicitly.
- `activity_log` returns recent calls made by the current MCP connection and the path to its complete append-only JSONL transcript. Entries include the target editor session, summarized arguments/results, duration, status, and revision delta; full map text and image payloads are omitted.
- `map_capabilities` advertises the batch limit and supported operation version/types, coordinate guidance, screenshot dimensions and modes, compiler availability, and the targeted editor's active game/project and loaded asset counts.
- `operation_schema` returns the exact discriminated JSON Schema and semantic notes for one `map_apply`/`map_preview` operation. The batch tool intentionally keeps a flat compatibility schema because some MCP hosts omit tools containing `oneOf`/`anyOf`.
- `map_status` returns the live revision, active path, map counts, entity summaries, and diagnostic counts.
- `editor_selection` reads whatever the user currently has selected and returns revision-safe entity, brush, patch, or face references plus combined bounds. It includes per-face texture and projection details for selected brushes by default, so an agent can diagnose and preview a targeted texture repair without asking the user to identify object indices. Use the returned revision for the subsequent `map_preview` and `map_apply` calls.
- `map_entities` lists entity references and supports an exact classname filter.
- `map_statistics` summarizes world bounds, structural/detail geometry, texture usage, approximate light influence, and spawn/item distribution and spacing.
- `map_texture_review` measures brush-face projection density and reports stretched, over-tiled, suspiciously fitted, or inconsistent materials with exact face references and suggested `edit_faces` transforms.
- `map_geometry_lint` finds duplicate brushes, coplanar z-fighting candidates, thin brushes, sliver faces, compiler-grid coordinates, and small structural geometry that is probably detail. Its findings are also included in `map_design_review`.
- `map_spatial_plan_get` returns persistent semantic areas and connections plus their bounds, height levels, route distribution, connected components, and consistency findings. `map_spatial_plan_preview` merges proposed areas/routes in memory so an agent can review layout intent without changing the document or generating brushes.
- `design_pattern_search` finds abstract spatial compositions by design goal and scale. Results contain area roles, route constraints, gameplay purpose, risks, variations, and live-map proportional guidance—never fixed coordinates or prefab geometry.
- `map_construction_paths_get` returns durable path sources, generation settings, named groups, generated object counts, and bounds for geometry created with `create_path`.
- `map_path_estimate` cheaply compares polyline and Catmull-Rom sampling, length, distributed stair/support/post points, and expected brush counts before a full preview.
- `map_spatial_review` measures box/axis alignment, walk-surface height bands, repeated brush proportions, approximate route branching/loops/dead ends, open-versus-enclosed rhythm, mirror symmetry, landmark and silhouette variation, and long flat walls. Every finding includes suggested corrective actions; these are design heuristics to guide screenshots and playtests, not an objective quality score.
- `map_summary` is the token-efficient orientation call for iterative work: revision, file, bounds, geometry/detail totals, diagnostics, major entity classes, and spawn/item distribution without full object dumps.
- `map_style_get`, `map_style_set`, and `map_style_review` keep a structured visual brief in worldspawn so theme, exact or folder-based texture palette, modular grid, texel-density target, lighting mood, detail density, and notes survive save/reload and different agent sessions. Guide palettes produce informational deviations; strict palettes produce warnings.
- `map_design_review` combines editor validation, geometry and spatial design review, gameplay placement lint, jump-pad results, approximate route reachability, and compact map context in one revision-consistent response. It reports pass/needs-attention/blocked plus categorized findings without pretending the heuristics form an objective numeric quality score.
- `map_inspect` returns properties, bounds, textures, optional brush-face material details, and optional face/control-point geometry for referenced objects.
- `map_validate` returns current editor diagnostics.
- `map_gameplay_lint` reports approximate embedded-entity, spawn-clearance, and pickup-support problems with implicated references.
- `map_analyze_jump_pad` mirrors Quake III's `AimAtTarget` math for an existing `trigger_push` or proposed trigger bounds/apex. It reports velocity, timing, nominal landing, the first plausible landing surface, and approximate player-hull obstructions. The linked `target_position` is the trajectory apex, not its landing point.
- `map_route_lint` analyzes every jump pad, including sampled trajectories and standing clearance at landing, and builds an approximate directed platform graph from player spawns to pickups. It defaults to a sampled `summary`; use `issuesOnly` for the cheapest iteration signal and `full` only when exact trajectories and connectivity edges are needed. Its walk/jump thresholds are authoring heuristics rather than AAS or engine playtest proof.
- `map_compile_preflight` validates the exact compiler-safe input and reports source/compiled line sizes, parser diagnostics, unsupported constructs, and every editor-only entity, brush, patch, or group record sanitized with its object reference.
- `map_compile` runs the live map through q3map at fast, normal, or full quality. Warnings and errors are structured by severity and linked to implicated references when texture names or entity origins make that possible. Pass `artifactPath` to atomically write the compiled BSP to a local path; `map_save_and_compile` supports the same option.
- Compile results report BSP, VIS, and LIGHT status independently. WASM memory failures are classified as `compiler-memory` and include the active pass, so a LIGHT failure is distinguishable from a BSP/VIS failure that prevents any playable artifact.
- The bundled q3map WebAssembly compiler reserves an 8 MiB stack for legacy per-surface lightmap scratch data. Patch-shadow trace state is initialized consistently across lightmap, light-grid, vertex, and triangle-soup lighting, preventing patch-heavy maps from failing nondeterministically during LIGHT.
- `map_play` compiles and launches the current revision in browser ioquake3, with optional verified noclip. After `map_compile` or `map_save_and_compile`, pass `useLastCompile: true` to launch the cached BSP for the unchanged revision without compiling again. `game_screenshot` captures the running compiled/lightmapped view.
- `game_status` reports whether the preview is idle, preparing, loading, running, closed, or failed, together with the current map, timestamps, last error, and recent engine console output. `game_wait_ready` blocks until it is safe to inspect the rendered frame.
- `game_command` safely enables noclip or restarts the current compiled preview. Noclip waits until ioquake3 is running and fails unless the game console confirms it is enabled. `game_set_view` is early in the tool list, relaunches in verified noclip at an exact position, point-entity reference, or numbered player spawn, and accepts yaw or a look-at target. `game_screenshot` reports sampled luminance and flags effectively black frames instead of silently returning an unusable image.
- `map_query` looks up exact `refs` directly or filters entities, brushes, faces, and patches by bounds, kind, classname, texture, entity property, or persistent group.
- `map_groups` lists persistent named groups and their current member references; `map_query` accepts a group name or ID.
- `texture_search` performs ranked token matching across names and shader semantics, so queries such as `space sky` and `jump pad` work without exact substrings. It includes tool shaders without images and returns compatibility summaries; `texture_preview_many` returns up to 12 images for palette comparison.
- `texture_inspect` resolves one material into image dimensions/source, all parsed `surfaceparm` and `q3map_*` directives, stage images and blending, skybox faces, derived content/surface flags, emission, and separate parser/compiler-safe, editor-previewable, expected-invisible, and ioquake3/WebGL-renderable states. Search and preview use the same concrete image-resolution path.
- `entity_class_search` searches loaded entity definitions and `entity_class_schema` returns typed properties, defaults, spawnflags, and required target relationships. Built-in schemas cover `worldspawn`, jump pads, and teleporters even when retail definitions omit their keys.
- `editor_select` selects referenced objects in Q3Edit and `editor_frame_objects` selects and frames them in every viewport.
- `editor_set_camera` positions the 3D camera using world coordinates and yaw/pitch in degrees.
- `editor_look_at` positions the camera and calculates the yaw/pitch needed to face a target point.
- `editor_screenshot` returns a PNG from the perspective, top, front, or side viewport. It can frame world bounds or a named group and temporarily hide named groups, entity markers, tool/sky brushes, or objects outside section bounds. Perspective captures can use a depth-free wireframe x-ray mode. All visibility changes are restored after capture and do not dirty the map.
- `editor_layout_screenshot` is the preferred spatial-design view. It defaults to a top-down whole-map overview with sky/tool brushes hidden, entity labels enabled, and an embedded axis/grid/world-unit scale legend. Front and side projections, sections, groups, and explicit bounds are also supported.
- `editor_review_bundle` returns a consistently framed perspective plus top/front/side layout images in one call by default. Use it after substantial geometry or art passes; select fewer views when only one projection matters.
- `map_apply` applies an atomic operation batch in the browser. It requires the revision returned by `map_status` and creates one normal Q3Edit undo entry.
- `map_undo` and `map_redo` operate on normal Q3Edit history entries with revision protection. They work across MCP and manual editor changes and invalidate stale compiled BSPs.
- `map_preview` runs the same validated operation batch against an in-memory clone and returns generated references, bounds, map counts, diagnostics, and collisions without changing the document. Its optional `reviews` list compares gameplay, routes, geometry, textures, style, and spatial quality before and after the preview.
- `map_create_jump_pad` and `map_create_teleporter` create complete, correctly linked trigger/destination pairs and persistently group them for later edits.
- `map_new` replaces the targeted editor with an empty or starter document using revision protection. It can preserve existing worldspawn keys and apply explicit worldspawn properties without enumerating starter objects.
- `map_open` opens a local `.map` file in the connected browser.
- `map_save` writes the current browser document to the active path or a supplied path.
- `map_save_and_compile` revision-checks, saves, and compiles in the common finalization workflow.

Clients with constrained tool discovery should use the early-listed
`editor_capture` and `editor_review` visual tools. The original
`editor_screenshot`, `editor_layout_screenshot`, and `editor_review_bundle`
remain available for compatibility. The shared authoring workflow is exposed
as the `q3edit://agent-workflow` MCP resource instead of being repeated in
every tool description.

MCP clients commonly cache their tool inventory. After updating Q3Edit, restart
`npm run bridge` and reconnect or restart the MCP client if `editor_capture`,
`editor_review`, `game_set_view`, `map_undo`, or another capability advertised
by `map_capabilities.essentialTools` is absent.

`diagnostic_explain` accepts a compiler warning or design-review finding,
resolves likely source references when possible, classifies its practical
impact, and suggests focused inspection tools plus concrete `map_preview`
operation templates. Use it when a warning such as `noshader` does not identify
an object directly.

Compile, quick-play, and region-compile workflows serialize a compiler-safe
view of the document. Editor-only `_q3edit_*` semantic metadata, named-group
records, group comments, and brush/patch editor properties stay in the saved
editable map but are omitted from q3map input. This avoids legacy parser line
limits and keeps grouped patches valid without discarding the authoring data.

`create_area` and `connect_areas` store spatial intent in worldspawn independently of brush geometry. An area records its purpose, shape language, center, bounds/radius, height levels, openings, and landmark intent. A connection records its endpoint areas, traversal type, width, vertical change, curvature intent, cover, visibility, and traversal role. Both can remain plan-only or optionally create ordinary grouped floor/room/connector brushes. The generated objects are not opaque: they remain queryable, editable, and removable through normal map operations.

Declared shaders count as valid texture sources even when they intentionally have no image, so tool, trigger, clip, and sky shaders do not produce false missing-texture diagnostics.

Initial `map_apply` operations are:

- `create_entity`
- `create_entity_array` for evenly spaced point entities
- `set_entity_properties`
- `create_box`
- `create_box_array` for evenly spaced, optionally detail-classified geometry
- `create_room`
- `create_primitive` (`box`, `cylinder`, `cone`, `sphere`, or `pyramid`)
- `create_wedge`
- `create_tapered` for convex tapered or asymmetrically offset trapezoid brushes
- `create_stairs`
- `create_brush` from arbitrary convex face planes
- `create_prefab` for textured, modular `pillar`, `door_frame`, and `jump_pad_base` assemblies
- `create_patch` for native editable bevel, endcap, cylinder, arch, pipe, and ramp patchDef2 surfaces
- `edit_patches` for material, natural/fit UVs, relative UV transforms, and subdivisions
- `thicken_patch` for offset front/back surfaces with optional caps
- `create_area` and `connect_areas` for persistent semantic plans with optional transparent geometry
- `create_path` for polyline or Catmull-Rom corridors, walls, railings, pipes, beams, trim, stairs, and distributed supports
- `reshape_room` for material- and group-preserving rectangular-to-octagonal room-shell conversion
- `create_jump_pad` and `create_teleporter` as composable, wired gameplay operations
- `translate`
- `rotate`
- `mirror`
- `clone`
- `array`
- `repeat_variation` for deterministic linear, radial, or mirrored repetitions with bounded seeded variation
- `set_texture`
- `edit_faces` for per-face texture, shift, scale, rotation, fit, and compile flags
- `set_brush_classification` (`detail` or `structural`)
- `clip_brushes` by an arbitrary plane (`front`, `back`, or `both`)
- `hollow_brushes` with an exact wall thickness
- `csg_subtract` with optional carver removal
- `offset_faces` for signed plane extrusion/inset with preserved or fitted projection
- `chamfer_brushes` for selected or all cross-section corners around an axis
- `taper_brushes` for material-preserving refinement of existing axis-aligned boxes
- `assign_group` and `remove_from_group`
- `delete`

Creation operations accept `group` and an optional stable `groupId`. The created objects are assigned immediately, without a separate `assign_group` operation.

`create_prefab` requires a discovered fallback `texture`, accepts role materials through `textures.primary`, `accent`, `focal`, `sides`, and `bottom`, and returns the whole assembly under its symbolic ID. Prefabs default to detail geometry. Pillars and door frames preserve architectural tiling; jump-pad bases automatically fit the focal material once on the top cap. Use `classification: "structural"` only when the module must seal the world or control visibility.

`create_box` and `create_primitive` accept semantic `textures.top`, `textures.bottom`, and `textures.sides` slots. For non-box primitives, top/bottom are the positive/negative caps along `axis`. `create_stairs` accepts `textures.treads`, `textures.risers`, `textures.sides`, and `textures.underside`; unspecified slots fall back to `texture`.

`create_patch` produces ordinary patchDef2 control grids and validates their dimensions, finite coordinates/UVs, bounds, and tessellation before committing. `axis` selects the extrusion axis for cylindrical/cap surfaces and arches; `direction` orients ramps. `textureMode: "fit"` maps one repeat over the grid, while `"natural"` derives world-scale UVs. `edit_patches` applies fit/natural mapping before relative shift, scale, and rotation. Thickening replaces a source with grouped editable patch surfaces and can expose the result through one symbolic alias.

`create_path` samples two to 64 control points as a polyline or Catmull-Rom curve and produces ordinary grouped brushes. Its role-specific settings cover width, height/thickness, support/post/stair spacing, pipe sides, corner joins, constant banking, texture, and structural/detail classification. Optional seeded `variation` applies bounded per-segment width, height, spacing, and bank deviations; dimensions snap to its grid and the bounds must remain smaller than their base values. Every path is stored as versioned worldspawn metadata with its generated group, bounds, object count, optional replacement count, and variation settings; use `map_construction_paths_get` to recover that relationship in later sessions. `replaceTargets` atomically removes selected straight geometry only after the new path validates, making an angled or curved refinement one undoable operation. Q3 brushes are closed solids, so physical segment ends are always capped. Use `map_preview` before applying a dense or varied path to review exact generated objects, aggregate bounds, collisions, diagnostics, and the 256-object per-path limit.

Creation operations accept `areaId` or `connectionId` to assign generated
objects to an existing semantic-plan group and mark that plan element realized.
This is useful when a plan-only area is later built from several low-level
operations or a curved semantic connection is realized by `create_path`.
Geometry lint omits expected same-family path overlaps, while style review
counts intentionally non-axial brushes separately from accidental axis-aligned
modular-grid drift.

Brush refinement operations work on existing geometry. `offset_faces` moves selected planes along their outward normals; positive distances extrude and negative distances inset. `chamfer_brushes` clips any subset of the four cross-section corners around X, Y, or Z, and beveling all four turns a rectangular solid into an octagonal one. `taper_brushes` refines axis-aligned six-face boxes along any axis with a scaled and optionally offset positive end. These operations preserve face materials, projections, compile flags, brush properties, and named groups by default. Set `textureMode: "fit"` only when the moved or newly created faces should intentionally receive a fresh fit. Existing `clip_brushes`, `hollow_brushes`, and `csg_subtract` now also preserve group membership on replacement fragments.

`reshape_room` consumes a complete uncomplicated rectangular room shell and replaces it with two octagonal caps plus eight angled wall brushes using the aggregate room bounds. It infers thickness when omitted and keeps representative wall, floor, and ceiling materials, projections, flags, brush properties, and the common named group. Use it before cutting doorways or embedding detail; openings and unrelated geometry should not be included among its targets. `textureMode: "fit"` is available when a deliberate fresh fit is preferable to preserved projection.

`design_pattern_search` is a planning aid rather than a prefab catalog. Search by intent such as `vertical route`, `flank`, `risk reward`, or `compression release`, optionally with a small/medium/large scale. Each result describes semantic area roles and connection constraints suitable for adapting into `create_area` and `connect_areas`, then recommends how to realize only the necessary geometry. The catalog deliberately omits coordinates and brushwork: agents must adapt proportions, levels, visibility, cover, and variations to the live bounds, style brief, route graph, and gameplay needs.

`repeat_variation` clones brush or patch targets with deliberate, reproducible rhythm. Linear distributions accept a cumulative cycling `stepSequence`; radial distributions rotate copies around a center; mirror creates one reflected copy. Cycling `rotationSequence`, `scaleSequence`, and labeled `materialSequence` values support alternating or role-based composition. Optional seeded variation bounds position, rotation, and fractional scale independently. Position offsets are snapped to `grid` (one map unit by default), scale deviation is capped below 100%, and identical inputs plus seed produce identical geometry. Always call `map_preview` first: in addition to normal compiler/editor diagnostics, it returns `generatedCollisions` for AABB overlaps involving created brushes or patches. Treat overlaps as review candidates because some architectural intersections are intentional.

## Texture projection quality

Treat texture projection as part of geometry creation rather than a cleanup pass. Brush-creation operations accept `textureTransform` for every created face and `textureTransforms` for semantic overrides:

- Boxes, box arrays, and primitives: `top`, `bottom`, `sides`
- Rooms: `walls`, `floor`, `ceiling`
- Stairs: `treads`, `risers`, `sides`, `underside`
- Plane brushes: a global `textureTransform` plus `faces[].textureTransform`
- Wedges: a global `textureTransform`

Each transform accepts `fit`, `shift`, `scale`, and `rotateDegrees`. Fitting happens first, followed by the relative shift, scale, and rotation. Semantic transforms inherit unspecified fields from the global transform.

Use `fit: true` for a focal surface intended to show one complete image, such as a jump-pad top, sign, door, console, or trim cap. Do not blindly fit large walls and floors: one repeat across a large face usually looks stretched. Preserve natural tiling there, or fit and then choose an intentional repeat count with relative scale. For example, `fit: true, scale: [0.5, 1]` produces two horizontal repeats because a smaller scale multiplier makes the texture repeat more often.

This cylinder fits the jump-pad artwork once on its top while leaving its sides naturally tiled:

```json
{
  "type": "create_primitive",
  "id": "jump_pad_art",
  "primitive": "cylinder",
  "axis": "z",
  "sides": 16,
  "mins": [0, 0, 0],
  "maxs": [128, 128, 16],
  "textures": {
    "top": "sfx/jumppadsmall",
    "bottom": "common/caulk",
    "sides": "base_trim/pewter_shiney"
  },
  "textureTransforms": {
    "top": { "fit": true }
  }
}
```

Before choosing unfamiliar materials, use `texture_search`, `texture_inspect`, and `texture_preview_many` instead of guessing. After creating textured geometry, run `map_texture_review`, then frame implicated faces and inspect them with `editor_screenshot`; use more than one angle when seams, caps, or side materials matter. Use `operation_schema` for the exact transform slots supported by a creation operation.

Large `map_apply` and `map_preview` batches can set `responseDetail: "compact"`. Reference and alias lists then return total counts, the first/last samples, and an explicit `truncated` flag instead of flooding the MCP response.

Object references use the current document indices: `E1`, `E0:B2`, `E0:B2:F4`, and `E0:P0`. Face references can be inspected, queried, selected, framed, or passed to `edit_faces`. References are revision-sensitive, so call `map_status`, `map_query`, or `map_entities` again after a revision conflict.

For a request such as “fix the texture on my selected brush,” call
`editor_selection` with `detail: "faces"`. Use the returned brush reference
with `set_texture` to change every face, or choose its returned face references
and use `edit_faces` for a targeted material or projection fix. Preview and
apply against the exact revision returned by `editor_selection`; if that
revision conflicts, read the selection again before editing.

Mark decorative geometry as detail before compiling so it does not unnecessarily split the BSP tree:

```json
{
  "type": "set_brush_classification",
  "targets": ["@trim", "E0:B12"],
  "classification": "detail"
}
```

Face texture transforms are relative. `scale: [2, 1]` makes the texture twice as large horizontally, while `fit: true` fits one texture repeat to the face before applying any shift, scale, or rotation in the same operation. In a batch, `@trim` edits every face of aliased brush geometry and `@trim:F4` edits face 4 without predicting its numeric brush index:

```json
{
  "type": "edit_faces",
  "targets": ["E0:B12:F4"],
  "texture": "base_trim/pewter_shiney",
  "shift": [16, 0],
  "scale": [2, 1],
  "rotateDegrees": 90
}
```

A useful authoring loop is:

1. Call `map_status`, `map_style_get`, `map_spatial_plan_get`, and `map_construction_paths_get`, then use `map_query`, `texture_search`, and `entity_class_search` to discover the live document, its design intent, generated path sources, and available assets. If the user refers to the current selection, call `editor_selection` first and treat its revision and references as the scope of the edit.
2. If the composition is weak or underspecified, call `design_pattern_search` and adapt one useful pattern rather than combining many. For a substantial layout, call `map_spatial_plan_preview` before committing areas and routes. Use `create_path` when a route or repeated architectural element should follow a curve or segmented line, and `repeat_variation` for short deliberate rhythms rather than hand-authored clone batches. For complex or varied geometry, call `map_preview` and review collisions; then make one logical edit with `map_apply` and the same current revision.
3. Call `editor_frame_objects` with created or queried references, or position an exact view with `editor_set_camera`.
4. Call `editor_screenshot` to review the result, then iterate.
   Use `editor_layout_screenshot` for flow, symmetry, spacing, and route-layout decisions, `map_spatial_review` for composition heuristics, `map_texture_review` for projection quality, and `map_design_review` for a combined structured quality pass.

MCP tool lists are normally loaded when an agent session starts. Restart the Codex or Claude Code session after updating the bridge if a newly added tool is missing.

Creation operations can also declare a symbolic `id`. Later operations in the same batch may use `@id`; a room alias expands to all six room brushes:

```json
{
  "expectedRevision": 4,
  "label": "MCP: Build and texture north room",
  "operations": [
    {
      "type": "create_room",
      "id": "north_room",
      "mins": [0, 0, 0],
      "maxs": [512, 512, 256]
    },
    {
      "type": "set_texture",
      "targets": ["@north_room"],
      "texture": "base_wall/basewall03"
    }
  ]
}
```

Symbolic IDs last only for the current batch. Assign a persistent group when later agent turns need to find, frame, or edit the generated objects:

```json
{
  "type": "assign_group",
  "targets": ["@north_room"],
  "group": "North Room",
  "groupId": "mcp-north-room"
}
```

Later, call `map_query` with `{ "group": "North Room" }`. Group membership is serialized into the `.map` document and survives save/reload. `map_apply` includes its complete symbolic alias mapping in both structured and normal text output for MCP clients that expose only one result representation.

## Activity transcripts

Each bridge MCP connection writes one JSONL file under `.q3edit/mcp-logs/`. Pass `--log-dir /path/to/logs` to `npm run bridge:serve --` to override the directory. The log is independent of the chat transcript and is intended for reviewing iteration strategy, retries, failures, and revision history after a design session.

Open **View → MCP Activity** in Q3Edit to watch the calls targeting that editor tab in real time. The resizable bottom panel separates actions from read-only inspection, highlights failures and revision changes, supports search/status/type filters, and exposes summarized arguments and results without placing image or full-map payloads in the UI. Drag its top edge to resize it, or double-click the edge to restore the default height.

## Manual tool calls

The included development client is useful for checking the bridge without an agent:

```bash
npm run mcp:call -- map_status '{}'
```

List the exact tools and schemas advertised by the server:

```bash
npm run mcp:call -- --list
```

```bash
npm run mcp:call -- map_apply '{
  "expectedRevision": 0,
  "label": "MCP: Add test box",
  "operations": [
    {
      "type": "create_box",
      "mins": [64, 64, 0],
      "maxs": [128, 128, 96],
      "texture": "base_wall/basewall03"
    }
  ]
}'
```

The browser applies the batch transactionally and immediately synchronizes normal UI edits, Undo, and Redo back to the bridge.
