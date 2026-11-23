#!/usr/bin/env bash
# Rebuilds vendor/libarchive/{worker-bundle.js,libarchive.wasm} from source.
# libarchive.js stays the unchanged dist/libarchive.js of libarchive.js 2.0.2.
# Needs: git, curl, node/npm, make, and an Emscripten SDK on PATH
# (built with emsdk "latest" = emcc 7.0.1 on 2026-11-23).
#   bash vendor/libarchive/build/build.sh <work dir>
set -euo pipefail
W="$(mkdir -p "${1:?work dir}" && cd "$1" && pwd)"; P="$W/prefix"; mkdir -p "$P" "$W/src"
cd "$W/src"
get() { curl -fsSL -o "$2" "$1"; echo "$3  $2" | sha256sum -c -; }
get https://github.com/libarchive/libarchive/releases/download/v3.8.11/libarchive-3.8.11.tar.xz libarchive.tar.xz \
  a3dc0872b1b39da34dc18ef1b944f0f11ffd37425d70ae04be679279f1cf43d2
get https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz zlib.tar.gz \
  9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
get https://github.com/tukaani-project/xz/releases/download/v5.8.1/xz-5.8.1.tar.gz xz.tar.gz \
  507825b599356c10dca1cd720c9d0d0c9d5400b9de300af00e4d1ea150795543
git clone -q --depth 1 --branch bzip2-1.0.8 https://gitlab.com/bzip2/bzip2.git bzip2
test "$(git -C bzip2 rev-parse HEAD)" = 6a8690fc8d26c815e798c588f796eabe9d684cf0
git clone -q https://github.com/nika-begiashvili/libarchivejs lajs
git -C lajs checkout -q v2.0.2
tar xJf libarchive.tar.xz; tar xzf zlib.tar.gz; tar xzf xz.tar.gz

(cd zlib-1.3.1 && emconfigure ./configure --static --prefix="$P" && emmake make && emmake make install)
(cd xz-5.8.1 && emconfigure ./configure --prefix="$P" --disable-assembler --enable-threads=no \
  --enable-static --disable-shared --disable-xz --disable-xzdec --disable-lzmadec --disable-lzmainfo \
  --disable-scripts --disable-doc --disable-nls && emmake make && emmake make install)
(cd bzip2 && make libbz2.a CC=emcc AR=emar RANLIB=emranlib CFLAGS="-O2 -D_FILE_OFFSET_BITS=64" \
  && cp libbz2.a "$P/lib/" && cp bzlib.h "$P/include/")
# No OpenSSL (orOS refuses encrypted archives), no zstd/lz4/xml.
(cd libarchive-3.8.11 && CPPFLAGS="-I$P/include" LDFLAGS="-L$P/lib" emconfigure ./configure --prefix="$P" \
  --enable-static --disable-shared --disable-bsdtar --disable-bsdcat --disable-bsdcpio --disable-bsdunzip \
  --enable-posix-regex-lib=libc --disable-xattr --disable-acl --without-nettle --without-openssl \
  --without-lzo2 --without-cng --without-lz4 --without-zstd --without-xml2 --without-expat \
  --without-iconv --without-libb2 --without-mbedtls && emmake make && emmake make install)

L="$W/src/lajs/lib"
emcc "$L/wrapper/main.c" -c -I"$P/include" -O3 -o "$W/main.o"
# WASM_BIGINT=0: the 2.0.2 worker reads 64-bit results as plain numbers.
emcc "$W/main.o" "$P/lib/libarchive.a" "$P/lib/liblzma.a" "$P/lib/libbz2.a" "$P/lib/libz.a" \
  -o "$W/src/lajs/src/webworker/wasm-gen/libarchive.js" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=libarchive -s WASM=1 -s WASM_BIGINT=0 -O3 \
  -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_RUNTIME_METHODS='["cwrap","stringToNewUTF8","HEAPU8"]' \
  -s EXPORTED_FUNCTIONS=@"$L/tools/lib.exports" -s ERROR_ON_UNDEFINED_SYMBOLS=0
# Emscripten dropped allocate(); the one place that used it (passphrase
# strings) now uses stringToNewUTF8, which also mallocs.
sed -i 's|string: (str) => this.allocate(this.intArrayFromString(str), "i8", 0),|string: (str) => this.stringToNewUTF8(str),|' \
  "$W/src/lajs/src/webworker/wasm-module.js"
grep -q stringToNewUTF8 "$W/src/lajs/src/webworker/wasm-module.js"
(cd "$W/src/lajs" && npm ci --ignore-scripts && npm run build)
echo "dist ready: $W/src/lajs/dist (copy worker-bundle.js and libarchive.wasm)"
