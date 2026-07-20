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

- `map_status` returns the live revision, active path, map counts, entity summaries, and diagnostic counts.
- `map_entities` lists entity references and supports an exact classname filter.
- `map_inspect` returns properties, bounds, textures, and optional face/control-point geometry for referenced objects.
- `map_validate` returns current editor diagnostics.
- `map_query` finds entities, brushes, and patches by bounds, kind, classname, texture, or entity property.
- `texture_search` searches the live PK3 asset index and `texture_preview` returns an image for an exact result.
- `entity_class_search` searches loaded entity definitions and `entity_class_schema` returns typed properties, defaults, and spawnflags.
- `editor_select` selects referenced objects in Q3Edit and `editor_frame_objects` selects and frames them in every viewport.
- `editor_set_camera` positions the 3D camera using world coordinates and yaw/pitch in degrees.
- `editor_screenshot` returns a PNG rendered from the current textured 3D viewport.
- `map_apply` applies an atomic operation batch in the browser. It requires the revision returned by `map_status` and creates one normal Q3Edit undo entry.
- `map_open` opens a local `.map` file in the connected browser.
- `map_save` writes the current browser document to the active path or a supplied path.

Initial `map_apply` operations are:

- `create_entity`
- `set_entity_properties`
- `create_box`
- `create_room`
- `create_primitive` (`box`, `cylinder`, `cone`, `sphere`, or `pyramid`)
- `create_wedge`
- `create_stairs`
- `create_brush` from arbitrary convex face planes
- `translate`
- `rotate`
- `mirror`
- `clone`
- `array`
- `set_texture`
- `delete`

Object references use the current document indices: `E1`, `E0:B2`, and `E0:P0`. They are revision-sensitive, so call `map_status` or `map_entities` again after a revision conflict.

A useful authoring loop is:

1. Call `map_status`, then use `map_query`, `texture_search`, and `entity_class_search` to discover the live document and assets.
2. Make one logical edit with `map_apply` and its current revision.
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
