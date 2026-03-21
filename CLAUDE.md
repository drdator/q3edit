# map-editor

WIP TypeScript map editor for Quake 3 Arena running in the browser with WebGL2.

## Build & Run

```bash
npm install
npm run dev      # Start Vite dev server
npm run build    # TypeScript check + Vite production build
```

## Reference Source

The original Quake 3 C source is in `../quake3-master/` for reference:

- **Q3Radiant** (map editor): `../quake3-master/q3radiant/` — the original Win32/MFC level editor. Key files: `CamWnd.cpp` (3D camera viewport), `XYWnd.cpp` (2D grid viewports), `MAP.CPP`/`MAP.H` (map file loading/saving), `SELECT.CPP` (brush selection), `CSG.CPP` (CSG operations), `PMESH.CPP` (patch meshes), `ENTITY.CPP` (entity handling).
- **q3map** (BSP compiler): `../quake3-master/q3map/`
- **BSP/map format**: `../quake3-master/code/qcommon/` and `../quake3-master/q3radiant/BSPFILE.H`
- **Renderer**: `../quake3-master/code/renderer/`
