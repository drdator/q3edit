# ioquake3 Web Runtime Source

Q3Edit uses an unmodified Emscripten build of ioquake3 at commit
[`67e4fa978530ae0a3f62fedb0a26ac4797443429`](https://github.com/ioquake/ioq3/tree/67e4fa978530ae0a3f62fedb0a26ac4797443429).

ioquake3 is Copyright (C) 1999-2005 id Software, Inc. and ioquake3
contributors. It is distributed under the GNU General Public License, version
2. The complete license is included as [`COPYING.txt`](COPYING.txt), and the
exact corresponding source is included as [`ioq3-source.tar.gz`](ioq3-source.tar.gz).

Run `npm run build:ioq3` from the Q3Edit source tree to fetch that exact source
revision, compile it with Emscripten, and stage the JavaScript and WebAssembly
artifacts used by the player.
