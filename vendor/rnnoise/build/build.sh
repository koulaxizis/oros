#!/bin/sh
# Builds vendor/rnnoise/rnnoise.wasm from RNNoise v0.1.1 (xiph/rnnoise,
# tag v0.1.1, commit 6cbfd53eb348a8d394e0757b4025c6ded34eb2b6, BSD-3,
# the original 2017 model in src/rnn_data.c) with plain clang + wasm-ld
# (LLVM 18), no Emscripten: libc/ holds the few C functions it needs.
#   sh build.sh /path/to/rnnoise-v0.1.1
set -e
SRC="$1/src"
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../rnnoise.wasm"
TMP=$(mktemp -d)
for f in denoise rnn rnn_data pitch kiss_fft celt_lpc; do
  clang --target=wasm32 -O3 -ffreestanding -nostdlibinc -isystem "$HERE/libc" -I "$1/include" -I "$SRC" \
    -DRNNOISE_BUILD -Wno-everything -c "$SRC/$f.c" -o "$TMP/$f.o"
done
clang --target=wasm32 -O3 -ffreestanding -nostdlibinc -isystem "$HERE/libc" -c "$HERE/libc/shim.c" -o "$TMP/shim.o"
wasm-ld --no-entry --strip-all --initial-memory=1048576 \
  --export=rnnoise_create --export=rnnoise_process_frame --export=rnnoise_get_size --export=malloc \
  "$TMP"/*.o -o "$OUT"
rm -rf "$TMP"
ls -l "$OUT"
