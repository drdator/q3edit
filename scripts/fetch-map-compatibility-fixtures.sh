#!/usr/bin/env bash
set -euo pipefail

fixture_dir="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures/compatibility"
mkdir -p "$fixture_dir"

curl -fsSL https://openarena.ws/svn/source/assets/maps/dm17ish.map \
  -o "$fixture_dir/openarena-dm17ish.map"
curl -fsSL https://openarena.ws/svn/source/assets/maps/gpl.txt \
  -o "$fixture_dir/OPENARENA-MAPS-GPL.txt"
curl -fsSL https://raw.githubusercontent.com/TTimo/GtkRadiant/1.6-release/regression_tests/q3map2/patch_seam/maps/patch_seam.map \
  -o "$fixture_dir/gtkradiant-patch-seam.map"
curl -fsSL https://raw.githubusercontent.com/TTimo/GtkRadiant/1.6-release/GPL \
  -o "$fixture_dir/GTKRADIANT-GPL.txt"
curl -fsSL https://gitlab.com/xonotic/netradiant/-/raw/master/regression_tests/q3map2/coarse_snap_normal/maps/coarse_snap_normal.map \
  -o "$fixture_dir/netradiant-coarse-snap.map"
curl -fsSL https://gitlab.com/xonotic/netradiant/-/raw/master/GPL \
  -o "$fixture_dir/NETRADIANT-GPL.txt"

printf '%s  %s\n' \
  147d3f68ebcd866185137be33532209529dbfc1cdc9a6c8fe567072ecd019083 \
  "$fixture_dir/openarena-dm17ish.map" \
  8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903 \
  "$fixture_dir/OPENARENA-MAPS-GPL.txt" \
  3b8f1ed6dc79c2bd8c8c37ca4eefd67052e04a20934d2792cf16e6cfeefa1e07 \
  "$fixture_dir/gtkradiant-patch-seam.map" \
  963b8b5b6b822179b47463786faf9cc5ce6e1b655028e3f4ff2727dd99d590fc \
  "$fixture_dir/GTKRADIANT-GPL.txt" \
  34f143e97e6538232aa23b39f6eac02d54630ebbdbea4ff620d84bed104b8f7c \
  "$fixture_dir/netradiant-coarse-snap.map" \
  e6d6a009505e345fe949e1310334fcb0747f28dae2856759de102ab66b722cb4 \
  "$fixture_dir/NETRADIANT-GPL.txt" | shasum -a 256 -c -
