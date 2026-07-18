/*
===========================================================================
Copyright (C) 1999-2005 Id Software, Inc.

This file is part of Quake III Arena source code.

Quake III Arena source code is free software; you can redistribute it
and/or modify it under the terms of the GNU General Public License as
published by the Free Software Foundation; either version 2 of the License,
or (at your option) any later version.

Quake III Arena source code is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Foobar; if not, write to the Free Software
Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
===========================================================================
*/

/*
Q3Edit modification, 2026-03-23:
Added stubs for compiler modes excluded from the WebAssembly build.
*/

#include "qbsp.h"

vec3_t draw_mins, draw_maxs;
qboolean	drawflag;

void Draw_ClearWindow (void)
{
}

//============================================================

#define	GLSERV_PORT	25001


void GLS_BeginScene (void)
{
}

void GLS_Winding (winding_t *w, int code)
{
}

void GLS_EndScene (void)
{
}

/* Stubs for excluded modes (vlight, vsound) */
int VLightMain( int argc, char **argv ) {
	Error("vlight mode not supported in WASM build");
	return 1;
}

int VSoundMain( int argc, char **argv ) {
	Error("vsound mode not supported in WASM build");
	return 1;
}
