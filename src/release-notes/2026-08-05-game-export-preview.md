---
id: 2026-08-05-game-export-preview
title: August 5, 2026 — Game Export and Preview
date: 2026-08-05
order: 2
---

Packaging and testing maps now fit more naturally into both Maker projects and the editor's Quick Play workflow.

## Maker export target

- Release Package can export a game-level bundle for Maker projects.
- The export includes the compiled level and the supporting files needed by the game project.

## Reliable Quick Play updates

- Unsaved previews use a content-addressed runtime map name, preventing an older BSP in an enabled archive from taking precedence.
- Preview files are delivered as a temporary PK3 and the player page is cache-busted for each launch.
