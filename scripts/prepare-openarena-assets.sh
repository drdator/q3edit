#!/usr/bin/env bash

set -euo pipefail

readonly RELEASE_URL="https://sourceforge.net/projects/oarena/files/openarena-0.8.8.zip/download"
readonly RELEASE_SHA256="5a8faf7f5b51f351b0a1618c06b6b98a5f1a6758f1d39818de2c87df2a0bac4a"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${script_dir}/.." && pwd)"
cache_dir="${project_dir}/.cache/openarena"
release_zip="${cache_dir}/openarena-0.8.8.zip"
output_dir="${project_dir}/public/openarena"

mkdir -p "$cache_dir" "$output_dir"

if [[ ! -f "$release_zip" ]]; then
  curl -L --fail --retry 3 "$RELEASE_URL" -o "$release_zip"
fi

actual_sha256="$(shasum -a 256 "$release_zip" | awk '{print $1}')"
if [[ "$actual_sha256" != "$RELEASE_SHA256" ]]; then
  echo "OpenArena archive checksum mismatch." >&2
  echo "Expected: $RELEASE_SHA256" >&2
  echo "Actual:   $actual_sha256" >&2
  exit 1
fi

unzip -j -o "$release_zip" \
  'openarena-0.8.8/baseoa/pak0.pk3' \
  'openarena-0.8.8/baseoa/pak4-textures.pk3' \
  'openarena-0.8.8/COPYING' \
  -d "$output_dir"

echo "Prepared OpenArena assets in ${output_dir}"
