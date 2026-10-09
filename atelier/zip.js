// ============================================================
// orOS Atelier — zip.js: a small, read-only ZIP reader (v1.0.0)
// Enough for Office files (.pptx): stored and deflated entries,
// read lazily, one entry at a time. No ZIP64, no encryption.
// Inflating uses the platform's DecompressionStream("deflate-raw")
// (browsers, Node 18+), so nothing is vendored.
// Limits keep a hostile file from eating the device: entry count,
// and a cap on the size of every entry once inflated (checked while
// it streams, not trusted from the header).
// Pure: no DOM. Exposes window.AtelierZip (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_ENTRIES = 20000;
  var MAX_ENTRY = 80 * 1024 * 1024;     // inflated bytes per entry

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }

  function utf8(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  // bytes: Uint8Array of the whole file. Returns { names:[…],
  // has(name), size(name), bytes(name, max) → Promise<Uint8Array>,
  // text(name, max) → Promise<string> } or throws Error("zip").
  function open(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw new Error("zip");
    // end of central directory: last 22 bytes + up to 64 KB comment
    var eocd = -1, stop = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= stop; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip");
    var count = u16(bytes, eocd + 10), cdOff = u32(bytes, eocd + 16);
    if (count > MAX_ENTRIES || cdOff >= bytes.length) throw new Error("zip");
    var entries = {}, names = [], p = cdOff;
    for (var n = 0; n < count; n++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("zip");
      var method = u16(bytes, p + 10), csize = u32(bytes, p + 20), size = u32(bytes, p + 24);
      var nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32);
      var flags = u16(bytes, p + 8), loc = u32(bytes, p + 42);
      var name = utf8(bytes.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
      p += 46 + nlen + xlen + clen;
      if (name.slice(-1) === "/" || flags & 1) continue;          // folders, encrypted entries
      if (!Object.prototype.hasOwnProperty.call(entries, name)) names.push(name);
      entries[name] = { method: method, csize: csize, size: size, loc: loc };
    }

    function dataOf(e) {
      var l = e.loc;
      if (l + 30 > bytes.length || u32(bytes, l) !== 0x04034b50) throw new Error("zip");
      var start = l + 30 + u16(bytes, l + 26) + u16(bytes, l + 28);
      var end = start + e.csize;
      if (end > bytes.length) throw new Error("zip");
      return bytes.subarray(start, end);
    }

    function inflate(data, max) {
      if (typeof DecompressionStream !== "function") return Promise.reject(new Error("inflate"));
      var ds = new DecompressionStream("deflate-raw");
      var w = ds.writable.getWriter();
      w.write(data).then(null, function () {});
      w.close().then(null, function () {});
      var reader = ds.readable.getReader(), parts = [], total = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(total), o = 0;
            parts.forEach(function (c) { out.set(c, o); o += c.length; });
            return out;
          }
          total += r.value.length;
          if (total > max) { try { reader.cancel(); } catch (e) {} throw new Error("toobig"); }
          parts.push(r.value);
          return pump();
        });
      }
      return pump();
    }

    function getBytes(name, max) {
      max = Math.min(max || MAX_ENTRY, MAX_ENTRY);
      var e = Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : null;
      if (!e) return Promise.resolve(null);
      try {
        var data = dataOf(e);
        if (e.method === 0) {
          if (data.length > max) return Promise.reject(new Error("toobig"));
          return Promise.resolve(data.slice());
        }
        if (e.method === 8) return inflate(data, max);
      } catch (err) { return Promise.reject(err); }
      return Promise.reject(new Error("method"));
    }

    return {
      names: names,
      has: function (name) { return Object.prototype.hasOwnProperty.call(entries, name); },
      size: function (name) { return Object.prototype.hasOwnProperty.call(entries, name) ? entries[name].size : 0; },
      bytes: getBytes,
      text: function (name, max) { return getBytes(name, max).then(function (b) { return b ? utf8(b) : null; }); }
    };
  }

  var api = { open: open, MAX_ENTRY: MAX_ENTRY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierZip = api;
})(typeof window !== "undefined" ? window : this);
