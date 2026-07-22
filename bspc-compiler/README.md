# BSPC WebAssembly compiler

This directory builds the Quake III BSP-to-AAS compiler as a browser-compatible
WebAssembly module. Q3Edit runs it after q3map so Quick Play maps include the
bot navigation data expected by Quake III.

The source under `upstream/` is from
[`TTimo/bspc`](https://github.com/TTimo/bspc) commit
`10d23c5ebd042ddc5d03e17de0f560f5076649dc` and is licensed under GPL-2.0.
The local changes are limited to Emscripten platform detection and portability
fixes needed by modern Clang/WebAssembly.

Build it from the repository root with:

```sh
npm run build:bspc
```
