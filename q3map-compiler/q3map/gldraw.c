/*
  Stub implementations for WASM build.
  - GL draw functions (original uses Windows OpenGL for debug visualization)
  - Entry points for excluded modes (vis, vlight, vsound)
*/

#include "qbsp.h"

qboolean	drawflag;
vec3_t	draw_mins, draw_maxs;

void Draw_ClearWindow (void) {}
void DrawWinding (winding_t *w) {}

void GLS_BeginScene (void) {}
void GLS_Winding (winding_t *w, int code) {}
void GLS_EndScene (void) {}

/* Stubs for excluded modes (vis, vlight, vsound) */
int VisMain( int argc, char **argv ) {
	Error("vis mode not supported in WASM build");
	return 1;
}

int VLightMain( int argc, char **argv ) {
	Error("vlight mode not supported in WASM build");
	return 1;
}

int VSoundMain( int argc, char **argv ) {
	Error("vsound mode not supported in WASM build");
	return 1;
}
