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
- `map_apply` applies an atomic operation batch in the browser. It requires the revision returned by `map_status` and creates one normal Q3Edit undo entry.
- `map_open` opens a local `.map` file in the connected browser.
- `map_save` writes the current browser document to the active path or a supplied path.

Initial `map_apply` operations are:

- `create_entity`
- `set_entity_properties`
- `create_box`
- `create_room`
- `translate`
- `set_texture`
- `delete`

Object references use the current document indices: `E1`, `E0:B2`, and `E0:P0`. They are revision-sensitive, so call `map_status` or `map_entities` again after a revision conflict.

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
