---
id: 2026-08-04-project-settings
title: "August 4, 2026: Portable Project Settings"
date: 2026-08-04
order: 1
---

Project configuration now travels with each map, keeping editing and build behavior consistent when maps are reopened or shared.

## Map-local project configuration

- Project Settings are embedded in the saved `.map` file and restored automatically when the map opens.
- Build options, asset ordering, entity-definition sources, diagnostics preferences, and editor overrides round-trip with the document and follow undo, redo, and recovery.
- Q3Edit removes the embedded metadata from compiler input, while PK3 binary data remains in browser asset storage.
- Older maps without embedded settings continue to use the browser-stored project configuration as a fallback.
