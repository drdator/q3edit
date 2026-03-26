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

### Map Regions
Implemented:
- Region from the current selection bounds
- Region-aware viewport rendering, picking, object tree listing, and 3D walk collision
- Region-only BSP compile export, with temporary boundary walls around the region like classic Radiant

Still missing:
- Additional Radiant region commands like current-XY, single-brush, and tall-brush regioning
- Save / load region workflows

### Brush Primitives Beyond Boxes
Implemented:
- The Create tool can now make box, cylinder, cone, sphere, and pyramid brushes
- Cylinder, cone, and sphere creation support sidedness control in the 3-9 range where applicable

Still missing:
- Torus creation
- More dedicated primitive-creation UX beyond the current Create-tool selector

## Missing

### 1. Terrain System
Radiant has a full terrain editor with raise/lower sculpting and vertex-level terrain mesh editing.

### 2. Prefabs
Radiant can save / load prefabs (reusable grouped brush assemblies).

### 3. Connect Entities (target / targetname)
Radiant can auto-wire target / targetname links between selected entities and draw path lines.

### 4. Pointfile / Leak Navigation
Radiant loads pointfiles from the compiler and lets you navigate leak paths.

### 5. Splines / Paths
Radiant has spline path tools for camera paths and entity movement.

### 6. Cubic Clipping (View Distance)
Radiant can clip the 3D view at a configurable distance for large-map performance.

### 7. Arbitrary Rotation / Scale Dialogs
Radiant has precise numeric input dialogs for rotation and scaling. We only have direct manipulation plus fixed-angle rotation shortcuts.

### 8. Edge Dragging
Radiant can drag edges, not just vertices, in vertex editing mode.

### 9. Plugin System
Radiant has a plugin architecture. A web-native equivalent does not exist here yet.

## Suggested Next Priority

1. Prefabs
2. Connect entities
3. Terrain system
4. Pointfile / leak navigation
5. Splines / paths
