---
id: 2026-07-editor-foundations
title: July 2026 Update
date: 2026-07-01
order: 1
---

A major editor update with richer Quake III compatibility, modern entity and model workflows, advanced geometry tools, camera paths, project configuration, and a more dependable editing core.

## Entities & models

- Search game entity definitions while placing entities, then edit typed properties in the Entity Inspector.
- Choose MD3 models and skins with textured, drag-to-rotate previews in both the browser and editor view.
- Compile misc_model entities with Q3Map2-compatible origin, scale, yaw, pitch, and roll transforms.

## Maps & assets

- Load, edit, and round-trip classic brushes and brushDef map formats with clearer parser diagnostics.
- Manage an ordered PK3 asset stack with shader-aware texture lookup and JPEG image support.
- Quick Play now keeps base-game assets separate and handles browser mouse capture more reliably.

## Geometry & terrain

- Create precisely sized boxes, cylinders, cones, spheres, and pyramids with the Exact Primitive dialog.
- Use expanded patch operations for rows, columns, subdivisions, caps, thickening, fitting, and alignment.
- Sculpt, smooth, erode, stitch, and texture terrain with a dedicated inspector and brush controls.

## Organization & paths

- Create persistent named groups, then select, hide, lock, and manage their members from the sidebar.
- Build open or closed camera splines with timing, FOV, look targets, actions, scrubbing, and looping playback.
- Generate smart camera paths and func_train paths directly from the editor.

## View & customization

- Switch renderer modes, texture filtering, display categories, and a tuned dynamic-light preview.
- Customize shortcuts, themes, viewport layouts, and editor defaults in global Preferences.
- Keep game paths, assets, compiler options, entity sources, and overrides in separate Project Settings.

## Reliability & diagnostics

- Document revisions, unsaved-state tracking, centralized mutations, and consistent undo transactions protect edits.
- Inspect map and entity diagnostics, find brushes by address, and run JSON brush macros as one undoable action.
- Review live MCP tool activity, arguments, results, failures, and revision changes from the View menu.
- Expanded regression coverage protects map round-tripping, geometry editing, assets, entities, and editor workflows.
