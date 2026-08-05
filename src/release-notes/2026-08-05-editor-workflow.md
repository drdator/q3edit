---
id: 2026-08-05-editor-workflow
title: "August 5, 2026: Editor Workflow Improvements"
date: 2026-08-05
order: 1
---

Selection, geometry editing, and brush creation are more consistent across the 2D and 3D views.

## Selection and geometry editing

- Selecting a brush or face now selects its texture in the texture panel.
- Edges can be selected in the 3D view and are highlighted at a steady two-pixel screen width.
- The transform gizmo uses solid geometry for better visibility.
- Moving a selected face with the gizmo edits that face instead of moving the entire brush.
- Option-click selects faces while editing polygons in the 3D view.

## Brush creation and tools

- New brushes inherit their depth from the centers of the other two orthographic views instead of always starting on the world origin.
- Brush and entity tool options open on a second click, with a visible chevron indicating that the active tool has additional options.
