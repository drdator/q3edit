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

### Find / Replace Textures
Supported for exact or partial texture-name replacement across the current selection or the whole map.

### Selection Enhancements
Supported:
- Nudge selection with arrow keys by grid amount
- Select touching
- Select inside
- Select complete / partial tall
- Select all of type
- Invert selection

## Partial

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

### 3. Map Regions
Radiant can isolate a region of the map for editing and compiling, ignoring everything outside it.

### 4. Prefabs
Radiant can save / load prefabs (reusable grouped brush assemblies).

### 5. Connect Entities (target / targetname)
Radiant can auto-wire target / targetname links between selected entities and draw path lines.

### 6. Pointfile / Leak Navigation
Radiant loads pointfiles from the compiler and lets you navigate leak paths.

### 7. Splines / Paths
Radiant has spline path tools for camera paths and entity movement.

### 8. Cubic Clipping (View Distance)
Radiant can clip the 3D view at a configurable distance for large-map performance.

### 9. Arbitrary Rotation / Scale Dialogs
Radiant has precise numeric input dialogs for rotation and scaling. We only have direct manipulation plus fixed-angle rotation shortcuts.

### 10. Edge Dragging
Radiant can drag edges, not just vertices, in vertex editing mode.

### 11. Plugin System
Radiant has a plugin architecture. A web-native equivalent does not exist here yet.

## Suggested Next Priority

1. Map regions
2. Brush primitives beyond boxes
3. Prefabs
4. Connect entities
5. Terrain system
