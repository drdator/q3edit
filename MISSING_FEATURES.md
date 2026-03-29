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
- Named groups

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

### Prefabs
Supported via saving the current selection as a prefab `.map` fragment and importing prefab files back into the current map.

### Connect Entities
Supported for selected entities with Radiant-style `target` / `targetname` wiring plus live path-line visualization in 2D and 3D.

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

### Pointfile / Leak Navigation
Supported via automatic pointfile loading from failed BSP compiles, manual `.lin` import, 2D/3D leak-path visualization, and next / previous leak-spot navigation.

## Partial

### Terrain System
Implemented:
- Terrain patch creation from the current selection bounds
- Terrain brush-based raise / lower / smooth operations at the 2D cursor, with selected control points as fallback anchors
- Live `Alt`-drag sculpting in 2D patch edit mode
- Terrain texture painting onto terrain paint tiles with the current texture
- Terrain noise and erosion actions using the current brush settings
- Seam stitching for prepared terrain paint tiles, including automatic stitch-on-edit plus a manual stitch command
- Adjustable terrain brush radius, strength, and smooth / linear falloff
- Dedicated terrain controls in a floating terrain panel from the toolbar
- Terrain patch density derived from the current grid size during creation

Still missing:
- Dedicated terrain map serialization and import/export parity with Radiant terrainDef
- Further terrain-specific UX polish beyond the current patch-edit + terrain panel workflow

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

### Splines / Paths
Implemented:
- `path_corner`, `info_null`, and related path point entities can be placed from the entity browser
- Selected entities can be connected in order as open or closed path chains
- Linked path entities render as spline previews in both 2D and 3D

Still missing:
- Dedicated camera-spline editing and playback workflows like classic Radiant
- Smart path creation tools beyond connecting already-placed entities
- Rich per-point path timing / action editing

## Missing

### 1. Plugin System
Radiant has a plugin architecture. A web-native equivalent does not exist here yet.

## Suggested Next Priority

1. Plugin system
2. Terrain system follow-up
3. Splines / paths follow-up
4. Cubic clipping follow-up
