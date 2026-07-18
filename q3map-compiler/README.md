# q3map WebAssembly compiler

This directory contains the q3map compiler from the id Software Quake III
Arena GPL source release, modified to build with Emscripten and run in a Web
Worker. It is not an unmodified upstream checkout.

The q3map source is Copyright (C) 1999-2005 id Software, Inc. and licensed
under GPL-2.0-or-later. The repository-wide license is in [`../LICENSE`](../LICENSE).
The RSA MD4 and Independent JPEG Group components retain their own notices;
see [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
[`libs/jpeg6/README`](libs/jpeg6/README).

The upstream source is available at
https://github.com/id-Software/Quake-III-Arena. This port includes WebAssembly
entry-point, platform compatibility, filesystem, memory, and JPEG-loading
changes needed by Q3Edit. Git history records the local modifications.

Two files from the bundled Independent JPEG Group code differ from the
upstream Quake III release:

- `libs/jpeg6/jmorecfg.h` enables the fallback `boolean` typedef required by
  the standalone Emscripten build.
- `libs/jpeg6/jpgload.cpp` uses standard C headers and defines the local
  `byte` alias instead of relying on headers from the original Windows build.

Build it with:

```sh
npm run build:q3map
```

To compile q3map and stage it with the complete web application, run:

```sh
npm run build:release
```

Generated object files and the `dist/` JavaScript/WebAssembly output are
excluded from Git.

The Quake III Arena game data is not covered by the GPL source release and is
not included here.
