#!/usr/bin/env bash
# Rebuilds vendor/libraw/libraw.wasm: libraw-wasm 1.6.0's own build
# (compileLibraw.sh) with LibRaw 0.22.3 instead of 0.22.1. index.js,
# worker.js and libraw.js come out byte for byte the same as the 1.6.0 dist.
# Needs: git, node/npm, autoconf, automake, libtool, and Emscripten 5.0.7 on
# PATH (the version the package's release workflow pins).
#   bash vendor/libraw/build.sh <work dir>
set -euo pipefail
W="$(mkdir -p "${1:?work dir}" && cd "$1" && pwd)"
emcc --version | head -1 | grep -q ' 5\.0\.7 ' || { echo "needs Emscripten 5.0.7"; exit 1; }
git clone -q https://github.com/ybouane/LibRaw-Wasm "$W/lrw"
cd "$W/lrw"
git checkout -q v1.6.0
sed -i 's/--branch 0.22.1/--branch 0.22.3/; s/LibRaw from GitHub (0.22.1)/LibRaw from GitHub (0.22.3)/' compileLibraw.sh
grep -q -- '--branch 0.22.3' compileLibraw.sh
npm ci
FORCE_LIBS=1 bash compileLibraw.sh
grep -q 'LIBRAW_PATCH_VERSION 3' includes/libraw/libraw_version.h
npm test
echo "dist ready: $W/lrw/dist (copy libraw.wasm; check the three .js files are unchanged)"
