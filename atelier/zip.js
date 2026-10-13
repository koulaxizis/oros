// ============================================================
// orOS Atelier — zip.js: a small ZIP reader and writer (v1.1.0)
// Enough for Office files (.pptx): stored and deflated entries,
// read lazily, one entry at a time. No ZIP64, no encryption.
// write(files) makes a stored (uncompressed) ZIP, enough for the
// .pptx export (pictures are already compressed).
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

  // ---------- writer ----------
  var CRC = null;
  function crc32(b) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var x = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  // files: [{ name, data: Uint8Array | string }] in order; date: a
  // Date for every entry (default 1 Jan 2026, so the same input gives
  // the same bytes). Returns a Uint8Array. Throws Error("zip") past
  // the format's 4 GB / 65535-entry limits.
  function write(files, date) {
    var enc = new TextEncoder(), d = date instanceof Date ? date : new Date(2026, 0, 1);
    var dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosD = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    if (files.length > 65535) throw new Error("zip");
    var parts = [], central = [], off = 0;
    function head(sig, len) { var v = new DataView(new ArrayBuffer(len)); v.setUint32(0, sig, true); return v; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      var crc = crc32(data), size = data.length;
      if (off + size > 0xFFFFFFF0) throw new Error("zip");
      var h = head(0x04034b50, 30);
      h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = head(0x02014b50, 46);
      c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
      c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + size;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var e = head(0x06054b50, 22);
    e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]);
    var out = new Uint8Array(off + cdSize + 22), o = 0;
    all.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  var api = { open: open, write: write, crc32: crc32, MAX_ENTRY: MAX_ENTRY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierZip = api;
})(typeof window !== "undefined" ? window : this);
