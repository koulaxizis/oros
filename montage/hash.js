// ============================================================
// orOS Montage — SHA-256 of a file of any size, a piece at a time.
// crypto.subtle.digest needs the whole file in memory at once; a
// phone video of 1-2 GB would not fit. Small files still go through
// crypto.subtle (faster); larger ones are read in CHUNK pieces and
// hashed here, with a progress callback and a pause between pieces
// so the page stays responsive.
//
//   MontageHash.file(blob, progress?) → Promise<hex>
//   MontageHash.create() → { update(Uint8Array), hex() }   (tests)
// UMD: module.exports in Node, window.MontageHash in the browser.
// ============================================================
(function (root) {
  "use strict";

  var CHUNK = 4 * 1024 * 1024;
  var SMALL = 64 * 1024 * 1024;
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function create() {
    var H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var W = new Int32Array(64), buf = new Uint8Array(64), used = 0, total = 0;

    function block(b, off) {
      var i, a, bb, c, d, e, f, g, h, t1, t2, x, y;
      for (i = 0; i < 16; i++) W[i] = (b[off + 4 * i] << 24) | (b[off + 4 * i + 1] << 16) | (b[off + 4 * i + 2] << 8) | b[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        x = W[i - 15]; y = W[i - 2];
        W[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[i - 7] +
               (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[i - 16] | 0;
      }
      a = H[0]; bb = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (i = 0; i < 64; i++) {
        t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i] | 0;
        t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c)) | 0;
        h = g; g = f; f = e; e = d + t1 | 0; d = c; c = bb; bb = a; a = t1 + t2 | 0;
      }
      H[0] = H[0] + a | 0; H[1] = H[1] + bb | 0; H[2] = H[2] + c | 0; H[3] = H[3] + d | 0;
      H[4] = H[4] + e | 0; H[5] = H[5] + f | 0; H[6] = H[6] + g | 0; H[7] = H[7] + h | 0;
    }

    function update(data) {
      var i = 0, n = data.length;
      total += n;
      if (used) {
        while (used < 64 && i < n) buf[used++] = data[i++];
        if (used === 64) { block(buf, 0); used = 0; }
      }
      for (; i + 64 <= n; i += 64) block(data, i);
      while (i < n) buf[used++] = data[i++];
    }

    function hex() {
      var bits = total * 8, pad = new Uint8Array(used < 56 ? 64 - used : 128 - used);
      pad[0] = 0x80;
      var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, L = pad.length;
      pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16 & 255; pad[L - 6] = hi >>> 8 & 255; pad[L - 5] = hi & 255;
      pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16 & 255; pad[L - 2] = lo >>> 8 & 255; pad[L - 1] = lo & 255;
      update(pad);
      var s = "";
      for (var j = 0; j < 8; j++) s += ("00000000" + (H[j] >>> 0).toString(16)).slice(-8);
      return s;
    }
    return { update: update, hex: hex };
  }

  function toHex(ab) {
    var b = new Uint8Array(ab), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  function file(blob, progress) {
    progress = progress || function () {};
    var subtle = root.crypto && root.crypto.subtle;
    if (subtle && blob.size <= SMALL) {
      return blob.arrayBuffer().then(function (ab) { return subtle.digest("SHA-256", ab); })
        .then(function (d) { progress(1); return toHex(d); });
    }
    var h = create(), pos = 0;
    function step() {
      if (pos >= blob.size) { progress(1); return Promise.resolve(h.hex()); }
      var end = Math.min(blob.size, pos + CHUNK);
      return blob.slice(pos, end).arrayBuffer().then(function (ab) {
        h.update(new Uint8Array(ab));
        pos = end;
        progress(pos / blob.size);
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      });
    }
    return step();
  }

  var api = { create: create, file: file, CHUNK: CHUNK, SMALL: SMALL };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontageHash = api;
})(typeof window !== "undefined" ? window : this);
