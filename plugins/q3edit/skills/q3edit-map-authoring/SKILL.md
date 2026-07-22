---
name: q3edit-map-authoring
description: Author and edit the live Quake III map through the Q3Edit MCP. Use whenever the user mentions Q3Edit, Quake 3 map authoring, the current map, the current selection, a selected brush/entity/face, or asks to create, edit, texture, inspect, validate, compile, play, or visually review live map geometry or entities. Prefer Q3Edit MCP over browser, computer-use, shell, or direct .map editing; use UI automation only when the user explicitly asks to test Q3Edit's interface.
---

# Q3Edit map authoring

Use the `q3edit` MCP tools as the authoritative interface to the live editor.
Do not announce or invoke browser/computer-control skills for map-authoring
requests.

## Route the request

- For any live map request, call `editor_sessions` when multiple tabs may be
  open, then call `map_status`.
- When the user refers to the current selection, call `editor_selection` before
  deciding what to change.
- Use browser or computer control only when the user explicitly asks to test UI
  behavior such as clicking, dragging, layout, focus, or styling.
- If the Q3Edit MCP tools are unavailable or the bridge is disconnected, report
  that clearly and ask the user to start or reconnect the bridge. Do not
  silently substitute UI automation or direct `.map` file editing.

## Author safely

1. Read the current revision with `map_status` or `editor_selection`.
2. Use `operation_schema` for unfamiliar operation fields and use texture or
   entity discovery tools instead of guessing assets or class properties.
3. Use `map_preview` for non-trivial changes, then call `map_apply` with the
   same `expectedRevision`. Group related changes into one undoable batch.
4. Use `editor_capture` for a perspective image and `editor_review` for
   perspective plus orthographic views after visible changes.
5. Finish substantial work with validation/design review, save, compile, or
   playtest as appropriate.

For a simple request such as “create a box in the current Q3Edit map,” use
`map_status`, inspect `operation_schema({type: "create_box"})` when needed,
then preview and apply a `create_box` operation. Do not operate the web UI.
