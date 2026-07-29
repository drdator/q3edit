---
id: 2026-07-29-uv-editing
title: July 29, 2026 — UV Editing Update
date: 2026-07-29
order: 1
---

More precise scaling controls and clearer orientation feedback make direct texture editing easier to understand and more predictable.

## Scaling controls

- Resize along one texture axis with edge handles, or scale both axes together from the corner handles.
- Scaling keeps the opposite edge or corner anchored, so the part of the texture you are aligning stays fixed while you adjust its size.
- Hold Shift for fine linear adjustments or Alt for coarse changes, with cursor directions that follow the visible handle orientation.

## Orientation & feedback

- Surface previews now open in a stable outside-facing orientation for walls, floors, and ceilings, with an optional Match 3D view mode when camera-relative editing is more useful.
- U and V texture-axis indicators use matching colors across the preview and editor viewports, while the normal indicator shows which direction points outside the brush.
- Camera-relative previews and controls rotate or mirror together, and the status display identifies inside-facing views that make textures appear mirrored.

## Isometric 3D views

- Switch the 3D viewport between perspective and orthographic projection, or jump directly to northeast, northwest, southeast, and southwest isometric presets.
- Projection changes preserve the current framing, while orthographic wheel zoom, screen-plane movement, orbiting, picking, and transform gizmos remain aligned with what is displayed.
- The viewport label identifies orthographic and isometric views, and fullscreen walkthroughs automatically return to perspective projection.

## Textured 2D views

- Enable Textured 2D Views from the View menu to preview mapped brush and patch textures in the XY, XZ, and YZ viewports.
- Texture offset, scale, and rotation are preserved, including curved patch UVs and terrain cell materials.
- Grid lines, selection shading, and editing overlays stay visible above the texture preview, while missing or shader-only images retain the normal flat-color display.

## Editor Fill rendering

- Use the new Editor Fill renderer mode for a 3D drafting view that matches the blue wireframe and translucent fill language of the 2D viewports.
- See-through faces and blue edges reveal geometry behind other brushes, while selection outlines and transform controls retain their normal highlight colors.
