#!/usr/bin/env bash

set -euo pipefail

readonly IOQ3_REPOSITORY="https://github.com/ioquake/ioq3.git"
readonly IOQ3_COMMIT="67e4fa978530ae0a3f62fedb0a26ac4797443429"

for command_name in git emcmake cmake; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: '$command_name' is required to build ioquake3 for the web." >&2
    exit 1
  fi
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${script_dir}/.." && pwd)"
source_dir="${project_dir}/.cache/ioq3-${IOQ3_COMMIT}"
build_dir="${source_dir}/build-q3edit"
output_dir="${project_dir}/public/ioquake3"

if [[ ! -d "${source_dir}/.git" ]]; then
  echo "Fetching ioquake3 ${IOQ3_COMMIT}..."
  git init --quiet "$source_dir"
  git -C "$source_dir" remote add origin "$IOQ3_REPOSITORY"
  git -C "$source_dir" fetch --depth 1 origin "$IOQ3_COMMIT"
  git -C "$source_dir" checkout --quiet --detach FETCH_HEAD
fi

actual_commit="$(git -C "$source_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$IOQ3_COMMIT" ]]; then
  echo "Error: cached ioquake3 source is at ${actual_commit}, expected ${IOQ3_COMMIT}." >&2
  exit 1
fi

echo "Configuring ioquake3 web build..."
emcmake cmake \
  -S "$source_dir" \
  -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_GAME_QVMS=OFF \
  -DBUILD_SERVER=OFF

echo "Building ioquake3 web runtime..."
cmake --build "$build_dir" --parallel

mkdir -p "$output_dir"
cp "$build_dir/Release/ioquake3.js" "$output_dir/ioquake3.js"
cp "$build_dir/Release/ioquake3.wasm" "$output_dir/ioquake3.wasm"
cp "$source_dir/COPYING.txt" "$output_dir/COPYING.txt"
git -C "$source_dir" archive \
  --format=tar.gz \
  --prefix="ioq3-${IOQ3_COMMIT}/" \
  --output="$output_dir/ioq3-source.tar.gz" \
  "$IOQ3_COMMIT"

echo "Staged the ioquake3 runtime, license, and corresponding source in public/ioquake3/."
