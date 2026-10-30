// ============================================================
// orOS Layout — zipin.js: read a .zip of packages without loading it
// (v1.0.0). The central directory is read from the end of the Blob,
// and each entry is sliced (stored) or inflated (deflated) on its own,
// so a 1 GB zip of books costs one book's memory at a time.
// No ZIP64, no encryption. Inflating uses the platform's
// DecompressionStream("deflate-raw"); the inflated size is capped while
// it streams, never trusted from the header.
// Pure: no DOM. Exposes window.LY_ZIPIN (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_ENTRIES = 20000;

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function bytesOf(blob, a, b) { return blob.slice(a, b).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  function bad() { return new Error("zip"); }

  function inflate(blob, max) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("inflate"));
    var reader = blob.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return new Blob(parts);
        total += r.value.length;
        if (total > max) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }

  // blob: the zip. → Promise of [{ name, size, get(max) → Promise<Blob> }]
  // (folders and encrypted entries left out), or rejects Error("zip").
  function list(blob) {
    if (!blob || typeof blob.slice !== "function" || blob.size < 22) return Promise.reject(bad());
    var tail = Math.min(blob.size, 22 + 65535);
    return bytesOf(blob, blob.size - tail, blob.size).then(function (t) {
      var e = -1;
      for (var i = t.length - 22; i >= 0; i--) {
        if (t[i] === 0x50 && t[i + 1] === 0x4b && t[i + 2] === 0x05 && t[i + 3] === 0x06) { e = i; break; }
      }
      if (e < 0) throw bad();
      var count = u16(t, e + 10), cdSize = u32(t, e + 12), cdOff = u32(t, e + 16);
      if (count === 0xffff || cdOff === 0xffffffff || count > MAX_ENTRIES || cdOff + cdSize > blob.size) throw bad();
      return bytesOf(blob, cdOff, cdOff + cdSize).then(function (cd) {
        var out = [], p = 0, dec = new TextDecoder("utf-8");
        for (var n = 0; n < count; n++) {
          if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw bad();
          var flags = u16(cd, p + 8), method = u16(cd, p + 10), csize = u32(cd, p + 20), size = u32(cd, p + 24);
          var nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), loc = u32(cd, p + 42);
          var name = dec.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
          p += 46 + nlen + xlen + clen;
          if (name.slice(-1) === "/" || flags & 1) continue;
          out.push(entry(blob, name, method, csize, size, loc));
        }
        return out;
      });
    });
  }

  function entry(blob, name, method, csize, size, loc) {
    return {
      name: name, size: size,
      get: function (max) {
        return bytesOf(blob, loc, loc + 30).then(function (h) {
          if (h.length < 30 || u32(h, 0) !== 0x04034b50) throw bad();
          var start = loc + 30 + u16(h, 26) + u16(h, 28), end = start + csize;
          if (end > blob.size) throw bad();
          var data = blob.slice(start, end);
          if (method === 0) {
            if (csize > max) throw new Error("toobig");
            return data;
          }
          if (method === 8) return inflate(data, max);
          throw new Error("method");
        });
      }
    };
  }

  var api = { list: list };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_ZIPIN = api;
})(this);
