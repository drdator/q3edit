# Map compatibility fixtures

- `openarena-dm17ish.map` is an independently authored GtkRadiant-era complex
  map from the OpenArena source repository, revision 951.
- `OPENARENA-MAPS-GPL.txt` is the source repository's GNU GPL license.
- `gtkradiant-patch-seam.map` is a GtkRadiant q3map2 regression fixture from
  the `1.6-release` branch; `GTKRADIANT-GPL.txt` is its license.
- `netradiant-coarse-snap.map` is a NetRadiant q3map2 regression fixture from
  its `master` branch; `NETRADIANT-GPL.txt` is its license.
- The smaller classic-brush, brush-primitive, terrain, patch, group, and custom
  shader cases in the parent fixture directory are authored specifically for
  Q3Edit's format tests and distributed under this repository's license.

Run `scripts/fetch-map-compatibility-fixtures.sh` to refresh the independently
sourced fixture. Checksums intentionally make upstream changes an explicit
review event.
