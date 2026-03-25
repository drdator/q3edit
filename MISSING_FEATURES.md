# Feature Status vs Q3Radiant

Current status of major Q3Radiant features relative to this editor.

## Done

### Brush Entities / Grouping
Basic brush-entity support is now in place:
- Selected brushes and patches can be grouped into a new brush entity.
- Selected brush-entity geometry can be moved back to `worldspawn`.
- Existing non-`worldspawn` entity classnames can be edited in the properties panel.

What is still missing:
- Dedicated group management UX
- Named groups / prefab workflows
- Entity-link visualization and target wiring tools

### Detail / Structural Brushes
Supported via content flags, with UI actions to mark selected brushes or patches as detail or structural.

### Texture Lock
Supported for brush move / rotate / flip operations.

### Hide / Show Selected
Supported for brushes, patches, and entities.

### Flip Operations
Supported on X / Y / Z axes.

### Copy / Paste
Supported for selected brushes, patches, and entities, with browser clipboard integration plus an internal fallback.

## Partial

### Selection Enhancements
Implemented:
- Nudge selection with arrow keys by grid amount

Still missing:
- Select touching
- Select inside
- Select complete / partial tall
- Select all of type
- Invert selection

### Display Filters
Implemented:
- Basic invisible-texture show / dim / hide modes
- Render selected only

Still missing:
- Granular per-category filters for water, clip, caulk, hint, lights, detail, paths, entity names, angles, coordinates, blocks, and similar Radiant toggles

## Missing

### 1. Brush Primitives Beyond Boxes
Radiant can create cylinders (3-9 sided), cones, spheres, torus, and pyramids. We only have box brushes.

### 2. Terrain System
Radiant has a full terrain editor with raise/lower sculpting and vertex-level terrain mesh editing.

### 3. Find / Replace Textures
Radiant has a dedicated dialog to search and batch-replace textures across the map, including selected-only workflows.

### 4. Map Regions
Radiant can isolate a region of the map for editing and compiling, ignoring everything outside it.

### 5. Prefabs
Radiant can save / load prefabs (reusable grouped brush assemblies).

### 6. Connect Entities (target / targetname)
Radiant can auto-wire target / targetname links between selected entities and draw path lines.

### 7. Pointfile / Leak Navigation
Radiant loads pointfiles from the compiler and lets you navigate leak paths.

### 8. Splines / Paths
Radiant has spline path tools for camera paths and entity movement.

### 9. Cubic Clipping (View Distance)
Radiant can clip the 3D view at a configurable distance for large-map performance.

### 10. Arbitrary Rotation / Scale Dialogs
Radiant has precise numeric input dialogs for rotation and scaling. We only have direct manipulation plus fixed-angle rotation shortcuts.

### 11. Edge Dragging
Radiant can drag edges, not just vertices, in vertex editing mode.

### 12. Plugin System
Radiant has a plugin architecture. A web-native equivalent does not exist here yet.

## Suggested Next Priority

1. Find / replace textures
2. Remaining selection enhancements
3. Map regions
4. Brush primitives beyond boxes
5. Prefabs
