---
id: 2026-07-22-mcp-preview
title: July 22, 2026 — MCP Preview
date: 2026-07-22
order: 1
---

A complete local AI map-authoring workflow for Codex and Claude, with live editing, richer construction tools, visual review, diagnostics, compilation, and play-preview control.

## Live AI authoring

- Connect Codex or Claude to the current Q3Edit document through the experimental local MCP companion and see atomic map edits appear immediately in every viewport.
- Target multiple open editor sessions reliably by filename, revision, connection ID, and last-active time instead of depending on whichever tab connected most recently.
- Use revision-checked previews, symbolic references, persistent named groups, normal undo and redo, and exact selection references for safer iterative editing.
- Follow every MCP request, result, failure, and revision change in the docked activity console or its append-only local transcript.

## Construction & discovery

- Create boxes, wedges, cylinders, stairs, arbitrary convex brushes, curved patches, paths, rooms, gameplay helpers, controlled patterns, and semantic areas and connections.
- Refine geometry with clipping, hollowing, CSG subtraction, chamfers, face offsets, transforms, detail or structural classification, per-face materials, and patch thickening.
- Search and inspect textures, shaders, entity classes, properties, groups, spatial plans, construction paths, map objects, and the user’s current selection without guessing names or references.
- Carry structured style and spatial intent between agent sessions, with texture-projection guidance and abstract design patterns that encourage more varied layouts.

## Review, compile & play

- Capture perspective, top, front, and side editor views with shared framing, coordinate overlays, sections, x-ray rendering, and optional sky, tool, group, or marker hiding.
- Review geometry, textures, gameplay placement, jump trajectories, routes, spatial composition, and overall design through structured diagnostics linked back to map references.
- Run compiler-safe preflight checks, save and compile maps, export BSP artifacts, reuse unchanged builds, and inspect structured BSP, VIS, and lighting results.
- Launch the compiled map, wait for renderer readiness, position the game camera at coordinates, entities, or player spawns, and detect unusable black screenshots.

## Local companion

- Use the deployed q3edit.com editor while the MCP server, files, compiler, and logs remain on the user’s computer.
- Pair the browser with a per-start code from the View menu or status bar; local and q3edit.com editor origins are validated before a document can connect.
- Install Q3Edit plugins for Codex and Claude Code so ordinary map-editing prompts route to the MCP tools instead of generic browser automation.
