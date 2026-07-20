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

- `editor_sessions` lists every connected browser tab with a stable session ID, filename, revision, save path, and activity timestamps. `editor_session_select` chooses the default for that MCP connection; every document-specific tool also accepts an explicit `sessionId`. When multiple editors are connected, an unscoped call fails instead of switching implicitly.
- `map_status` returns the live revision, active path, map counts, entity summaries, and diagnostic counts.
- `map_entities` lists entity references and supports an exact classname filter.
- `map_inspect` returns properties, bounds, textures, and optional face/control-point geometry for referenced objects.
- `map_validate` returns current editor diagnostics.
- `map_gameplay_lint` reports approximate embedded-entity, spawn-clearance, and pickup-support problems with implicated references.
- `map_compile` runs the live map through q3map at fast, normal, or full quality. Warnings and errors are structured by severity and linked to implicated references when texture names or entity origins make that possible.
- `map_play` compiles and launches the current revision in browser ioquake3, with optional noclip. `game_screenshot` captures the running compiled/lightmapped view.
- `map_query` finds entities, brushes, and patches by bounds, kind, classname, texture, or entity property.
- `map_groups` lists persistent named groups and their current member references; `map_query` accepts a group name or ID.
- `texture_search` searches image assets and declared shaders, including tool shaders without images. Results identify shaders and preview availability; `texture_preview_many` returns up to 12 images for palette comparison.
- `entity_class_search` searches loaded entity definitions and `entity_class_schema` returns typed properties, defaults, spawnflags, and required target relationships. Built-in schemas cover `worldspawn`, jump pads, and teleporters even when retail definitions omit their keys.
- `editor_select` selects referenced objects in Q3Edit and `editor_frame_objects` selects and frames them in every viewport.
- `editor_set_camera` positions the 3D camera using world coordinates and yaw/pitch in degrees.
- `editor_look_at` positions the camera and calculates the yaw/pitch needed to face a target point.
- `editor_screenshot` returns a PNG rendered from the current textured 3D viewport and can temporarily hide entity/light/path markers.
- `map_apply` applies an atomic operation batch in the browser. It requires the revision returned by `map_status` and creates one normal Q3Edit undo entry.
- `map_preview` runs the same validated operation batch against an in-memory clone and returns generated references, bounds, map counts, and diagnostics without changing the document.
- `map_create_jump_pad` and `map_create_teleporter` create complete, correctly linked trigger/destination pairs and persistently group them for later edits.
- `map_new` replaces the targeted editor with an empty or starter document using revision protection. It can preserve existing worldspawn keys and apply explicit worldspawn properties without enumerating starter objects.
- `map_open` opens a local `.map` file in the connected browser.
- `map_save` writes the current browser document to the active path or a supplied path.

Declared shaders count as valid texture sources even when they intentionally have no image, so tool, trigger, clip, and sky shaders do not produce false missing-texture diagnostics.

Initial `map_apply` operations are:

- `create_entity`
- `set_entity_properties`
- `create_box`
- `create_room`
- `create_primitive` (`box`, `cylinder`, `cone`, `sphere`, or `pyramid`)
- `create_wedge`
- `create_stairs`
- `create_brush` from arbitrary convex face planes
- `create_jump_pad` and `create_teleporter` as composable, wired gameplay operations
- `translate`
- `rotate`
- `mirror`
- `clone`
- `array`
- `set_texture`
- `edit_faces` for per-face texture, shift, scale, rotation, fit, and compile flags
- `set_brush_classification` (`detail` or `structural`)
- `clip_brushes` by an arbitrary plane (`front`, `back`, or `both`)
- `hollow_brushes` with an exact wall thickness
- `csg_subtract` with optional carver removal
- `assign_group` and `remove_from_group`
- `delete`

Creation operations accept `group` and an optional stable `groupId`. The created objects are assigned immediately, without a separate `assign_group` operation.

Object references use the current document indices: `E1`, `E0:B2`, `E0:B2:F4`, and `E0:P0`. Face references can be inspected, queried, selected, framed, or passed to `edit_faces`. References are revision-sensitive, so call `map_status`, `map_query`, or `map_entities` again after a revision conflict.

Mark decorative geometry as detail before compiling so it does not unnecessarily split the BSP tree:

```json
{
  "type": "set_brush_classification",
  "targets": ["@trim", "E0:B12"],
  "classification": "detail"
}
```

Face texture transforms are relative. `scale: [2, 1]` makes the texture twice as large horizontally, while `fit: true` fits one texture repeat to the face. In a batch, `@trim` edits every face of aliased brush geometry and `@trim:F4` edits face 4 without predicting its numeric brush index:

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

1. Call `map_status`, then use `map_query`, `texture_search`, and `entity_class_search` to discover the live document and assets.
2. For complex geometry, call `map_preview` first; then make one logical edit with `map_apply` and the same current revision.
3. Call `editor_frame_objects` with created or queried references, or position an exact view with `editor_set_camera`.
4. Call `editor_screenshot` to review the result, then iterate.

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
