/* ============================================================
   orOS Transfer — core.js (pure: no DOM), v1.0.0
   The parts of Transfer that need no browser, shared by the app
   (transfer/app.js), the receive page (transfer/receive.html) and the
   Node tests (tests/transfer.test.js):

   1. Codes. 12 characters of Crockford base32 (about 60 bits), the
      same shape as PAIR-1 (pair.js), shown as XXXX-XXXX-XXXX, as a
      link and as a QR. The room id on the relay is a hash of the code
      and the key is derived from it, so the relay only sees sealed
      frames and a room id.
   2. Sealing. Control messages are JSON sealed with AES-GCM, the
      sender's role as additional data (a message cannot be reflected
      back). File bytes travel in binary pieces: a 12-byte header
      (kind, file number, piece number) that is also additional data,
      then IV + ciphertext. A piece cannot be moved to another file or
      place without failing to open.
   3. A streaming SHA-256 (SubtleCrypto has none) so a file of many GB
      is hashed while it is read and written, piece by piece.
   4. A streaming ZIP writer (stored entries, data descriptors, ZIP64
      when needed) for a folder saved to a device as one file. CRC-32
      is computed as the bytes pass.
   5. The list of files (manifest): names cleaned so nothing can climb
      out of the target folder, sizes checked.

   window.OrosTransferCore (browser) / module.exports (Node).
   ============================================================ */
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var PROTO = 1;
  var NS = "oros-transfer/v1";
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var CODE_LEN = 12;
  var CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
  var KDF_ROUNDS = 200000;
  var PIECE = 61440;                  // plain bytes per piece (60 KiB: fits every browser's data channel)
  var HEAD = 12;                      // header bytes of a binary piece
  var MAX_CTRL = 60000;               // characters of one sealed control message
  var MAX_FILES = 10000;              // files in one transfer
  var MAX_NAME = 255;                 // bytes are not counted; characters are
  var MAX_PATH = 1024;
  var MAX_SIZE = Math.pow(2, 50);     // a sanity bound, not a limit anyone meets
  var DISK_MAX = 200 * 1048576;       // a file bigger than this is not written to the orOS disk (it syncs, whole, in memory)
  var MEM_MAX = 500 * 1048576;        // browsers without a writable OPFS keep a transfer in memory, up to this

  var C = root.crypto || (typeof require === "function" ? require("crypto").webcrypto : null);
  var enc = new TextEncoder(), dec = new TextDecoder();

  function hex(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function b64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // ---------- 1. Codes ----------
  function newCode() {
    var b = C.getRandomValues(new Uint8Array(CODE_LEN)), s = "";
    for (var i = 0; i < CODE_LEN; i++) s += ALPHA[b[i] & 31];
    return s;
  }
  // What a person typed or pasted → the code, or "". Spaces, dashes and
  // case do not matter; I and L read as 1, O as 0 (Crockford). A whole
  // link works too.
  function normCode(input) {
    var s = String(input == null ? "" : input).trim();
    var m = /#(?:t=)?([0-9A-Za-z][0-9A-Za-z\-]{11,16})\s*$/.exec(s);
    if (m) s = m[1];
    s = s.toUpperCase().replace(/[\s\-_.·]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
    return CODE_RE.test(s) ? s : "";
  }
  function fmtCode(code) { return code.slice(0, 4) + "-" + code.slice(4, 8) + "-" + code.slice(8, 12); }
  // The receive page's address. A local copy (Portable, USB, localhost)
  // cannot be opened from another device: the link is then useoros.online.
  function isLocalOrigin(o) {
    o = String(o || "");
    return !/^https:\/\//.test(o) ||
      /^https:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(o) ||
      /\.(local|lan|internal)(:\d+)?$/.test(o);
  }
  function linkFor(code, origin) {
    var o = isLocalOrigin(origin) ? "https://useoros.online" : String(origin).replace(/\/+$/, "");
    return o + "/transfer/receive.html#" + fmtCode(code);
  }

  // ---------- 2. Keys and sealing ----------
  function derive(code) {
    var S = C.subtle;
    return Promise.all([
      S.digest("SHA-256", enc.encode(NS + "/room/" + code)),
      S.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function (base) {
        return S.deriveKey({ name: "PBKDF2", salt: enc.encode(NS + "/key"), iterations: KDF_ROUNDS, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      })
    ]).then(function (r) { return { room: hex(r[0]), key: r[1] }; });
  }
  function ad(from) { return enc.encode(NS + "/" + from); }
  function seal(key, from, obj) {
    var iv = C.getRandomValues(new Uint8Array(12));
    return C.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: ad(from) }, key,
      enc.encode(JSON.stringify(obj))).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      return b64(out);
    });
  }
  // null for anything that is not a message from `from` under this key.
  function unseal(key, from, text) {
    try {
      if (typeof text !== "string" || text.length > MAX_CTRL * 2) return Promise.resolve(null);
      var u8 = unb64(text);
      if (u8.length < 29) return Promise.resolve(null);
      return C.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: ad(from) },
        key, u8.subarray(12)).then(function (pt) {
        var o = JSON.parse(dec.decode(pt));
        return (o && typeof o === "object" && !Array.isArray(o)) ? o : null;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // Binary piece: [0x44 'D'][0x01 = from sender][0][0][file u32][piece u32] | IV(12) | ciphertext+tag
  function pieceHead(file, n) {
    var h = new Uint8Array(HEAD);
    h[0] = 0x44; h[1] = 1;
    var v = new DataView(h.buffer);
    v.setUint32(4, file >>> 0); v.setUint32(8, n >>> 0);
    return h;
  }
  function sealPiece(key, file, n, bytes) {
    var h = pieceHead(file, n), iv = C.getRandomValues(new Uint8Array(12));
    var a = new Uint8Array(HEAD + 32);
    a.set(h, 0); a.set(ad("sender").subarray(0, 32), HEAD);
    return C.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: a }, key, bytes).then(function (ct) {
      var out = new Uint8Array(HEAD + 12 + ct.byteLength);
      out.set(h, 0); out.set(iv, HEAD); out.set(new Uint8Array(ct), HEAD + 12);
      return out;
    });
  }
  // → { file, n, bytes } or null.
  function openPiece(key, buf) {
    try {
      var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (u8.length < HEAD + 12 + 16 || u8.length > HEAD + 12 + 16 + PIECE || u8[0] !== 0x44 || u8[1] !== 1) return Promise.resolve(null);
      var v = new DataView(u8.buffer, u8.byteOffset, HEAD);
      var file = v.getUint32(4), n = v.getUint32(8);
      var a = new Uint8Array(HEAD + 32);
      a.set(u8.subarray(0, HEAD), 0); a.set(ad("sender").subarray(0, 32), HEAD);
      return C.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(HEAD, HEAD + 12), additionalData: a }, key,
        u8.subarray(HEAD + 12)).then(function (pt) {
        return { file: file, n: n, bytes: new Uint8Array(pt) };
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function pieces(size) { return Math.ceil(size / PIECE); }

  // ---------- 3. SHA-256, streaming ----------
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function Sha256() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.fill = 0;
    this.len = 0;               // bytes so far (a double: exact far beyond any file)
    this.w = new Uint32Array(64);
  }
  Sha256.prototype.block = function (b, o) {
    var w = this.w, h = this.h, i, t1, t2;
    for (i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var mj = (a & bb) ^ (a & c) ^ (bb & c);
      t2 = (S0 + mj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  };
  Sha256.prototype.update = function (data) {
    var i = 0, n = data.length;
    this.len += n;
    if (this.fill) {
      var take = Math.min(64 - this.fill, n);
      this.buf.set(data.subarray(0, take), this.fill);
      this.fill += take; i = take;
      if (this.fill < 64) return this;
      this.block(this.buf, 0);
      this.fill = 0;
    }
    for (; i + 64 <= n; i += 64) this.block(data, i);
    if (i < n) { this.buf.set(data.subarray(i), 0); this.fill = n - i; }
    return this;
  };
  Sha256.prototype.hex = function () {
    var bits = this.len * 8, pad = new Uint8Array(((this.fill < 56) ? 56 : 120) - this.fill + 8);
    pad[0] = 0x80;
    var hi = Math.floor(bits / 4294967296), lo = bits >>> 0, L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
    pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    var keep = this.len;
    this.update(pad);
    this.len = keep;
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) { out[i * 4] = this.h[i] >>> 24; out[i * 4 + 1] = this.h[i] >>> 16; out[i * 4 + 2] = this.h[i] >>> 8; out[i * 4 + 3] = this.h[i]; }
    return hex(out);
  };

  // ---------- 4. CRC-32 and a streaming ZIP writer ----------
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(prev, b) {
    var c = (prev ^ 0xffffffff) >>> 0;
    for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function dosTime(ms) {
    var d = new Date(ms > 315532800000 ? ms : 315532800000);   // ZIP time starts in 1980
    return {
      t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }
  function Bytes(n) { this.u8 = new Uint8Array(n); this.v = new DataView(this.u8.buffer); this.p = 0; }
  Bytes.prototype.u16 = function (x) { this.v.setUint16(this.p, x, true); this.p += 2; return this; };
  Bytes.prototype.u32 = function (x) { this.v.setUint32(this.p, x >>> 0, true); this.p += 4; return this; };
  Bytes.prototype.u64 = function (x) { this.v.setUint32(this.p, x % 4294967296, true); this.v.setUint32(this.p + 4, Math.floor(x / 4294967296), true); this.p += 8; return this; };
  Bytes.prototype.raw = function (b) { this.u8.set(b, this.p); this.p += b.length; return this; };

  // The caller writes: begin(name, size, mtime) → bytes, the file's
  // bytes (each through data()), end() → bytes, and finish() → bytes.
  // `big` (tests) is the size from which ZIP64 fields are used.
  function ZipWriter(opts) {
    this.big = (opts && opts.big) || 0xffffffff;
    this.off = 0;
    this.entries = [];
    this.cur = null;
  }
  ZipWriter.prototype.begin = function (name, size, mtime) {
    var nm = enc.encode(name), z64 = size >= this.big || this.off >= this.big, tm = dosTime(mtime || 0);
    var b = new Bytes(30 + nm.length + (z64 ? 20 : 0));
    b.u32(0x04034b50).u16(z64 ? 45 : 20).u16(0x0808).u16(0).u16(tm.t).u16(tm.d).u32(0);
    if (z64) b.u32(0xffffffff).u32(0xffffffff); else b.u32(0).u32(0);
    b.u16(nm.length).u16(z64 ? 20 : 0).raw(nm);
    if (z64) b.u16(1).u16(16).u64(0).u64(0);
    this.cur = { nm: nm, tm: tm, off: this.off, z64: z64, crc: 0, size: 0 };
    this.off += b.p;
    return b.u8;
  };
  ZipWriter.prototype.data = function (bytes) {
    this.cur.crc = crc32(this.cur.crc, bytes);
    this.cur.size += bytes.length;
    this.off += bytes.length;
    return bytes;
  };
  ZipWriter.prototype.end = function () {
    var e = this.cur, b = new Bytes(e.z64 ? 24 : 16);
    b.u32(0x08074b50).u32(e.crc);
    if (e.z64) b.u64(e.size).u64(e.size); else b.u32(e.size).u32(e.size);
    this.off += b.p;
    this.entries.push(e);
    this.cur = null;
    return b.u8;
  };
  ZipWriter.prototype.finish = function () {
    var big = this.big, parts = [], cdStart = this.off, cdLen = 0;
    this.entries.forEach(function (e) {
      var needSize = e.size >= big, needOff = e.off >= big, xl = (needSize ? 16 : 0) + (needOff ? 8 : 0);
      var b = new Bytes(46 + e.nm.length + (xl ? 4 + xl : 0));
      b.u32(0x02014b50).u16(0x031e).u16(xl || e.z64 ? 45 : 20).u16(0x0808).u16(0).u16(e.tm.t).u16(e.tm.d).u32(e.crc);
      if (needSize) b.u32(0xffffffff).u32(0xffffffff); else b.u32(e.size).u32(e.size);
      b.u16(e.nm.length).u16(xl ? 4 + xl : 0).u16(0).u16(0).u16(0).u32(0x81a40000);
      b.u32(needOff ? 0xffffffff : e.off).raw(e.nm);
      if (xl) { b.u16(1).u16(xl); if (needSize) b.u64(e.size).u64(e.size); if (needOff) b.u64(e.off); }
      parts.push(b.u8); cdLen += b.p;
    });
    var n = this.entries.length, z64 = n >= 0xffff || cdStart >= big || cdLen >= big;
    if (z64) {
      var r = new Bytes(56 + 20);
      r.u32(0x06064b50).u64(44).u16(0x031e).u16(45).u32(0).u32(0).u64(n).u64(n).u64(cdLen).u64(cdStart);
      r.u32(0x07064b50).u32(0).u64(cdStart + cdLen).u32(1);
      parts.push(r.u8);
    }
    var eo = new Bytes(22);
    eo.u32(0x06054b50).u16(0).u16(0).u16(z64 ? 0xffff : n).u16(z64 ? 0xffff : n)
      .u32(z64 ? 0xffffffff : cdLen).u32(z64 ? 0xffffffff : cdStart).u16(0);
    parts.push(eo.u8);
    var total = 0; parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    this.off += total;
    return out;
  };

  // ---------- 5. Names and the manifest ----------
  var WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  // One part of a path → a safe name, or "" when nothing is left.
  function cleanName(s) {
    var n = String(s == null ? "" : s).normalize("NFC")
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_").trim().replace(/[. ]+$/, "");
    if (n === "." || n === ".." || /^\.+$/.test(n)) return "";
    if (/^\./.test(n)) n = "_" + n.slice(1);                 // no hidden (dot) names on the orOS disk
    if (WIN_RESERVED.test(n)) n = "_" + n;
    if (n.length > MAX_NAME) {
      var dot = n.lastIndexOf("."), ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : "";
      n = n.slice(0, MAX_NAME - ext.length) + ext;
    }
    return n;
  }
  // "a/b/../c.txt" → "a/b/c.txt" (".." and "." parts are dropped, never followed).
  function cleanPath(p) {
    var parts = String(p == null ? "" : p).split(/[\\/]+/).map(cleanName).filter(Boolean);
    var out = parts.join("/");
    return out.length > MAX_PATH ? "" : out;
  }
  // Sender side: [{ path, size, mtime }] → manifest files (paths cleaned,
  // duplicates made unique the way a disk would, "name (2).ext").
  function buildManifest(list) {
    var seen = Object.create(null), out = [];
    (list || []).forEach(function (f) {
      var p = cleanPath(f && f.path);
      if (!p) return;
      p = uniqueIn(seen, p);
      seen[p.toLowerCase()] = true;
      out.push({ p: p, s: Math.max(0, Math.floor(+f.size || 0)), m: Math.max(0, Math.floor(+f.mtime || 0)) });
    });
    return out;
  }
  function uniqueIn(seen, p) {
    if (!seen[p.toLowerCase()]) return p;
    var slash = p.lastIndexOf("/"), dir = slash >= 0 ? p.slice(0, slash + 1) : "", base = p.slice(slash + 1);
    var dot = base.lastIndexOf("."), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : "";
    for (var i = 2; i < 100000; i++) {
      var q = dir + stem + " (" + i + ")" + ext;
      if (!seen[q.toLowerCase()]) return q;
    }
    return p;
  }
  // Receiver side: whatever arrived → a clean manifest, or null when it
  // is not one. Never trusts a path or a size as sent.
  function checkManifest(files) {
    if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) return null;
    var seen = Object.create(null), out = [], total = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || typeof f !== "object") return null;
      var s = +f.s;
      if (!(s >= 0) || s > MAX_SIZE || Math.floor(s) !== s) return null;
      var p = cleanPath(f.p);
      if (!p) return null;
      p = uniqueIn(seen, p);
      seen[p.toLowerCase()] = true;
      var m = +f.m;
      out.push({ p: p, s: s, m: m > 0 && m < 1e13 ? Math.floor(m) : 0 });
      total += s;
    }
    return { files: out, total: total, biggest: out.reduce(function (a, f) { return Math.max(a, f.s); }, 0) };
  }
  // A short label for a transfer: "photos" or "a.txt + 3 more" (the app formats it).
  function topNames(files) {
    var tops = [];
    files.forEach(function (f) {
      var t = f.p.split("/")[0];
      if (tops.indexOf(t) < 0) tops.push(t);
    });
    return tops;
  }
  // "name.ext" → the first free "name (n).ext" given a test of taken names.
  function freeName(name, taken) {
    if (!taken(name)) return name;
    var dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (var i = 2; i < 10000; i++) {
      var q = stem + " (" + i + ")" + ext;
      if (!taken(q)) return q;
    }
    return stem + " (" + Date.now() + ")" + ext;
  }
  // Split a manifest into sealed-size parts (a long list of files).
  function splitManifest(files) {
    var parts = [], cur = [], len = 0;
    files.forEach(function (f) {
      var l = JSON.stringify(f).length + 1;
      if (cur.length && len + l > 30000) { parts.push(cur); cur = []; len = 0; }
      cur.push(f); len += l;
    });
    if (cur.length) parts.push(cur);
    return parts;
  }

  function fmtSize(n, lang) {
    var u = lang === "el" ? ["B", "KB", "MB", "GB", "TB"] : ["B", "KB", "MB", "GB", "TB"], i = 0;
    n = +n || 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    var s = i === 0 ? String(Math.round(n)) : n.toFixed(n < 10 ? 1 : 0);
    if (lang === "el") s = s.replace(".", ",");
    return s + " " + u[i];
  }
  function browserLabel(ua) {
    ua = String(ua || "");
    var b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" :
      /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\/|Chromium\//.test(ua) ? "Chrome" :
      /Safari\//.test(ua) ? "Safari" : "Browser";
    var os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" :
      /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? b + " · " + os : b;
  }
  function cleanDev(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60); }

  var api = {
    VERSION: VERSION, PROTO: PROTO, NS: NS, CODE_RE: CODE_RE, PIECE: PIECE, HEAD: HEAD, MAX_CTRL: MAX_CTRL,
    MAX_FILES: MAX_FILES, DISK_MAX: DISK_MAX, MEM_MAX: MEM_MAX,
    hex: hex, newCode: newCode, normCode: normCode, fmtCode: fmtCode, linkFor: linkFor, isLocalOrigin: isLocalOrigin,
    derive: derive, seal: seal, unseal: unseal, sealPiece: sealPiece, openPiece: openPiece, pieces: pieces,
    Sha256: Sha256, crc32: crc32, ZipWriter: ZipWriter,
    cleanName: cleanName, cleanPath: cleanPath, buildManifest: buildManifest, checkManifest: checkManifest,
    topNames: topNames, freeName: freeName, splitManifest: splitManifest,
    fmtSize: fmtSize, browserLabel: browserLabel, cleanDev: cleanDev
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTransferCore = api;
})(typeof window !== "undefined" ? window : globalThis);
