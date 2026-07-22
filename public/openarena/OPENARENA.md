# OpenArena default assets

Q3Edit includes the unmodified `pak0.pk3` and `pak4-textures.pk3` archives
from OpenArena 0.8.8 as its default models and texture library. It also builds
`q3edit-bots.pk3` from the unmodified `scripts/bots.txt` and `botfiles/` entries
in OpenArena's `pak6-misc.pk3`. Those definitions and personality files are
used by Quick Play with Bot. OpenArena's unrelated maps, demos, and navigation
files are not included in the generated archive.

OpenArena is free, open content released under the GNU General Public License,
version 2 or later. The complete license is provided in `COPYING`.

- Project: https://openarena.ws/
- Release: https://sourceforge.net/projects/oarena/files/openarena-0.8.8.zip/download
- Corresponding content source: https://openarena.ws/svn/source/
- Debian source mirror: https://sources.debian.org/src/openarena-088-data/

The OpenArena archives are loaded before any PK3 files supplied by the user.
User-supplied files remain in that browser's IndexedDB storage and are not
uploaded to Q3Edit.
