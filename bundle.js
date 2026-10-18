// ============================================================
// orOS — bundle.js: the open orOS file format (OBF 1.0)
// ------------------------------------------------------------
// One project = one ZIP file with the app's own extension
// (.orosdoc, .orosslides, …). Unzip it and the folder holds:
//   mimetype                 first entry, stored: "application/x-oros-…"
//   META-INF/manifest.xml    every file: path, type, size, sha256
//   meta.xml                 title, author, dates (Dublin Core)
//   content.json             the project, in the app's own model
//   settings.json            optional view state
//   media/<key>              pictures, sounds, videos, fonts
//   preview/…                thumbnail + a copy other programs read
//   README.txt               what this file is
// Spec: docs/oros-bundle.md. Nothing here touches storage; only
// pickFolder() touches the DOM.
//
//   write(opts)          → Promise<Uint8Array>
//   writeBlob(opts)      → Promise<Blob>: media Blobs stay Blobs, for
//                          projects with big videos and sounds
//   read(input, opts)    → Promise<result>   (a .zip bundle: bytes, or a
//                          Blob/File read a piece at a time; opts.big
//                          for media up to 16 GB, given as Blobs)
//   readFolder(files)    → Promise<result>   (an unzipped bundle:
//                          [{ path, file|bytes }] or a FileList with
//                          webkitRelativePath)
//   sniff(head)          → the bundle's MIME type, "" for another
//                          ZIP, null when not a ZIP (head: the first
//                          ≥ 128 bytes)
//   sha256(bytes)        → Promise<hex>
//   digest(bytes|Blob)   → Promise<{ sha, crc, size }>, big Blobs
//                          streamed (ZIP64 is written past 4 GB)
//   typeOf(bytes)        → MIME type from the first bytes ("" unknown)
//   safePath(p)          → true for a path a bundle may carry
//   TYPES                → extension → { app, mime }
//   pickFolder()         → Promise<FileList|null>: the browser's folder
//                          picker (an <input webkitdirectory>), for
//                          "Open unzipped folder"
//
// Opening a bundle from anywhere is opening a hostile file: every
// path is checked, every size is capped while it inflates (never
// trusted from the headers), XML with a DOCTYPE/ENTITY is refused,
// every file is hashed against the manifest, media types come from
// the bytes. Nothing is ever run; the app's own normaliser and
// sanitiser still decide what of content.json is kept.
// UMD: window.OrosBundle in the browser, module.exports in Node.
// ============================================================
// i18n-inline-ok: the README inside an exported orOS file is bilingual by format (both lines always written), not UI text
(function (root) {
  "use strict";

  var VERSION = "1.0", MAJOR = 1;
  var NS = "https://useoros.online/ns/bundle/1";
  var DC = "http://purl.org/dc/elements/1.1/";
  var SPEC = "https://github.com/koulaxizis/oros/blob/main/docs/oros-bundle.md";

  // Extension → app. Only types an app can save AND open are here.
  var TYPES = {
    ".orosdoc": { app: "writer", mime: "application/x-oros-doc" },
    ".orosslides": { app: "slides", mime: "application/x-oros-slides" },
    ".orosdesign": { app: "atelier", mime: "application/x-oros-design" },
    ".oroslayout": { app: "layout", mime: "application/x-oros-layout" },
    ".orossheet": { app: "spreadsheet", mime: "application/x-oros-sheet" },
    ".orosmind": { app: "mindmap", mime: "application/x-oros-mind" },
    ".orosnotes": { app: "notes", mime: "application/x-oros-notes" },
    ".oroswiki": { app: "wiki", mime: "application/x-oros-wiki" },
    ".orosboard": { app: "kanban", mime: "application/x-oros-board" },
    ".orosscript": { app: "prompter", mime: "application/x-oros-script" },
    ".orostone": { app: "ringtones", mime: "application/x-oros-tone" },
    ".orosstudio": { app: "studio", mime: "application/x-oros-studio" },
    ".orosmontage": { app: "montage", mime: "application/x-oros-montage" },
    ".orosphoto": { app: "photolab", mime: "application/x-oros-photo" },
    ".orospixel": { app: "pixel", mime: "application/x-oros-pixel" },
    ".orostree": { app: "familytree", mime: "application/x-oros-tree" },
    ".oroscert": { app: "certificates", mime: "application/x-oros-cert" },
    ".oroslabels": { app: "labels", mime: "application/x-oros-labels" },
    ".orostrip": { app: "travel", mime: "application/x-oros-trip" },
    ".orosmap": { app: "maps", mime: "application/x-oros-map" },
    // phase 4b: record apps (recordpkg.js), one extension each
    ".orostasks": { app: "todo", mime: "application/x-oros-tasks" },
    ".oroshabits": { app: "habits", mime: "application/x-oros-habits" },
    ".oroswater": { app: "water", mime: "application/x-oros-water" },
    ".oroschores": { app: "chores", mime: "application/x-oros-chores" },
    ".orosscores": { app: "scores", mime: "application/x-oros-scores" },
    ".oroscycle": { app: "cycle", mime: "application/x-oros-cycle" },
    ".orosmood": { app: "mood", mime: "application/x-oros-mood" },
    ".oroscal": { app: "calendar", mime: "application/x-oros-cal" },
    ".oroscontacts": { app: "contacts", mime: "application/x-oros-contacts" },
    ".orosbookmarks": { app: "bookmarks", mime: "application/x-oros-bookmarks" },
    ".orosfeeds": { app: "feeds", mime: "application/x-oros-feeds" },
    ".orospodcasts": { app: "podcasts", mime: "application/x-oros-podcasts" },
    ".orosmeals": { app: "meals", mime: "application/x-oros-meals" },
    ".orosstickies": { app: "stickies", mime: "application/x-oros-stickies" },
    ".orosbudget": { app: "budget", mime: "application/x-oros-budget" },
    ".orosinvoices": { app: "invoices", mime: "application/x-oros-invoices" },
    ".oroscrm": { app: "crm", mime: "application/x-oros-crm" },
    ".oroshours": { app: "timesheet", mime: "application/x-oros-hours" },
    ".orosquote": { app: "quote", mime: "application/x-oros-quote" },
    ".orossplit": { app: "split", mime: "application/x-oros-split" },
    ".orosstock": { app: "stock", mime: "application/x-oros-stock" },
    ".orosdiary": { app: "diary", mime: "application/x-oros-diary" },
    ".oroshealth": { app: "health", mime: "application/x-oros-health" },
    ".orosworkouts": { app: "fitness", mime: "application/x-oros-workouts" },
    ".orosbaby": { app: "baby", mime: "application/x-oros-baby" },
    ".orospet": { app: "petcare", mime: "application/x-oros-pet" },
    ".orosplants": { app: "plants", mime: "application/x-oros-plants" },
    ".orosgarage": { app: "garage", mime: "application/x-oros-garage" },
    ".oroslibrary": { app: "library", mime: "application/x-oros-library" },
    ".orosshelf": { app: "shelf", mime: "application/x-oros-shelf" },
    ".orossignature": { app: "signature", mime: "application/x-oros-signature" },
    ".orosnewsletter": { app: "newsletter", mime: "application/x-oros-newsletter" },
    ".orosinventory": { app: "storage", mime: "application/x-oros-inventory" },
    ".oroscards": { app: "flashcards", mime: "application/x-oros-cards" }
  };

  var LIM = {
    entries: 10000,
    entry: 512 * 1024 * 1024,      // one file, inflated
    total: 1024 * 1024 * 1024,     // the whole bundle, inflated
    ratio: 1000,                   // inflated : compressed, per entry
    xml: 4 * 1024 * 1024,          // manifest.xml, meta.xml
    json: 128 * 1024 * 1024,       // content.json
    // { big: true } (Montage, Studio): stored media may be this large;
    // deflated entries keep the caps above, since they inflate in memory
    bigEntry: 16 * 1024 * 1024 * 1024,
    bigTotal: 64 * 1024 * 1024 * 1024
  };
  var MIME_RE = /^application\/x-oros-[a-z]{2,20}$/;
  var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var HASHED_RE = /^([0-9a-f]{64})(\.[a-z0-9]{1,8})?$/;

  var enc = new TextEncoder();
  function utf8(b) { return new TextDecoder("utf-8").decode(b); }
  function bad(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- paths ----------
  function safePath(p) {
    if (typeof p !== "string" || !p || p.length > 200) return false;
    if (!/^[\x21-\x7e]+$/.test(p.replace(/ /g, "_"))) return false;   // printable ASCII (spaces allowed)
    if (p.charAt(0) === "/" || p.indexOf("\\") >= 0 || p.indexOf(":") >= 0) return false;
    var segs = p.split("/");
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || s === "." || s === ".." || s.trim() !== s) return false;
    }
    return true;
  }

  // ---------- bytes ----------
  function toBytes(v) {
    if (v instanceof Uint8Array) return Promise.resolve(v);
    if (typeof v === "string") return Promise.resolve(enc.encode(v));
    if (v && typeof ArrayBuffer !== "undefined" && v instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(v));
    if (v && typeof v.arrayBuffer === "function") return v.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    return Promise.reject(bad("data"));
  }
  function subtle() {
    var c = (typeof crypto !== "undefined" && crypto) || (typeof require === "function" ? require("crypto").webcrypto : null);
    if (!c || !c.subtle) throw bad("crypto");
    return c.subtle;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(bytes) {
    return Promise.resolve().then(function () { return subtle().digest("SHA-256", bytes); }).then(hex);
  }
  function starts(b, sig, at) {
    at = at || 0;
    if (b.length < at + sig.length) return false;
    for (var i = 0; i < sig.length; i++) if (sig[i] !== null && b[at + i] !== sig[i]) return false;
    return true;
  }
  function ascii(b, at, n) { var s = ""; for (var i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]); return s; }
  // The type of a file from its first bytes, never from its name.
  function typeOf(b) {
    if (!b || !b.length) return "";
    if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "audio/wav";
    if (ascii(b, 0, 2) === "BM") return "image/bmp";
    if (ascii(b, 4, 4) === "ftyp") {
      var brand = ascii(b, 8, 4);
      if (/^(avif|avis)$/.test(brand)) return "image/avif";
      if (/^(M4A |M4B )$/.test(brand)) return "audio/mp4";
      if (/^qt  $/.test(brand)) return "video/quicktime";
      return "video/mp4";
    }
    if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
    if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
    if (ascii(b, 0, 4) === "fLaC") return "audio/flac";
    if (ascii(b, 0, 3) === "ID3" || starts(b, [0xff, null]) && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";
    if (ascii(b, 0, 4) === "%PDF") return "application/pdf";
    if (ascii(b, 0, 4) === "wOFF") return "font/woff";
    if (ascii(b, 0, 4) === "wOF2") return "font/woff2";
    if (starts(b, [0, 1, 0, 0]) || ascii(b, 0, 4) === "OTTO" || ascii(b, 0, 4) === "true") return "font/ttf";
    return "";
  }
  var EXT_OF = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
    "image/avif": "avif", "audio/wav": "wav", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg",
    "audio/flac": "flac", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "application/pdf": "pdf", "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf"
  };
  var TYPE_OF_NAME = {
    json: "application/json", xml: "application/xml", txt: "text/plain", md: "text/markdown",
    html: "text/html", csv: "text/csv", svg: "image/svg+xml", gpx: "application/gpx+xml",
    opml: "text/x-opml", ged: "application/x-gedcom"
  };
  function typeFor(name, bytes) {
    var t = typeOf(bytes);
    if (t) return t;
    var ext = (name.split(".").pop() || "").toLowerCase();
    return TYPE_OF_NAME[ext] || "application/octet-stream";
  }

  // ---------- deflate ----------
  function stream(kind, mode, data, max) {
    var Ctor = kind === "c" ? (typeof CompressionStream === "function" ? CompressionStream : null)
      : (typeof DecompressionStream === "function" ? DecompressionStream : null);
    if (!Ctor) return Promise.reject(bad("deflate"));
    var s = new Ctor(mode), w = s.writable.getWriter();
    w.write(data).then(null, function () {});
    w.close().then(null, function () {});
    var reader = s.readable.getReader(), parts = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), o = 0;
          parts.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        total += r.value.length;
        if (max && total > max) { try { reader.cancel(); } catch (e) {} throw bad("toobig"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  var canDeflate = typeof CompressionStream === "function";

  // ---------- CRC-32 and SHA-256, also a piece at a time ----------
  // crypto.subtle.digest wants the whole file in memory; a 2 GB video
  // would not fit. Blobs above SMALL are read in CHUNK pieces (the same
  // SHA-256 as montage/hash.js).
  var CHUNK = 4 * 1024 * 1024, SMALL = 64 * 1024 * 1024, M32 = 0xFFFFFFFF;
  var Z64 = M32, Z64N = 0xFFFF;          // when ZIP64 starts (tests lower them)
  var CRC = null;
  function crcUpdate(x, b) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 0xFF] ^ (x >>> 8);
    return x;
  }
  function crc32(b) { return (crcUpdate(0xFFFFFFFF, b) ^ 0xFFFFFFFF) >>> 0; }
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function hasher() {
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
        t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K256[i] + W[i] | 0;
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
    function hexOut() {
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
    return { update: update, hex: hexOut };
  }
  function isBlob(v) {
    return !!v && !(v instanceof Uint8Array) && typeof v.slice === "function" && typeof v.size === "number" && typeof v.arrayBuffer === "function";
  }
  // { sha, crc, size, bytes? } of bytes or a Blob. A Blob up to SMALL is
  // read whole (bytes set); a bigger one is streamed and stays a Blob.
  // onBytes(n) after each piece (progress).
  function digest(data, onBytes) {
    if (!isBlob(data) || data.size <= SMALL) {
      return toBytes(data).then(function (b) {
        return sha256(b).then(function (h) {
          if (onBytes) onBytes(b.length);
          return { sha: h, crc: crc32(b), size: b.length, bytes: b };
        });
      });
    }
    var h = hasher(), c = 0xFFFFFFFF, pos = 0;
    function step() {
      if (pos >= data.size) return { sha: h.hex(), crc: (c ^ 0xFFFFFFFF) >>> 0, size: data.size };
      var end = Math.min(data.size, pos + CHUNK);
      return data.slice(pos, end).arrayBuffer().then(function (ab) {
        var b = new Uint8Array(ab);
        h.update(b); c = crcUpdate(c, b);
        pos = end;
        if (onBytes) onBytes(b.length);
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      });
    }
    return Promise.resolve().then(step);
  }
  function concat(parts) {
    if (parts.some(isBlob)) return new Blob(parts).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    var n = parts.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(n), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return Promise.resolve(out);
  }

  // ---------- ZIP writer (stored + deflated; ZIP64 only past 4 GB) ----------
  // entries: [{ name, data: Uint8Array|Blob, crc?, deflate }] in order.
  // A Blob is stored as it is and never read here (its crc comes from
  // digest), so the bundle can be one Blob made of other Blobs.
  // → Promise<parts[]> (Uint8Array and Blob pieces, in file order)
  function zipParts(entries, date) {
    // default 1 Jan 2026, so the same input gives the same bytes
    var d = date instanceof Date && !isNaN(date) ? date : new Date(2026, 0, 1);
    var dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosD = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var chain = Promise.resolve(), ready = [];
    entries.forEach(function (f) {
      chain = chain.then(function () {
        if (isBlob(f.data)) { ready.push({ f: f, crc: f.crc >>> 0, method: 0, out: f.data, size: f.data.size, csize: f.data.size }); return; }
        var crc = f.crc != null ? f.crc >>> 0 : crc32(f.data), n = f.data.length;
        if (!f.deflate || !canDeflate || n < 64) { ready.push({ f: f, crc: crc, method: 0, out: f.data, size: n, csize: n }); return; }
        return stream("c", "deflate-raw", f.data).then(function (z) {
          if (z.length >= n) ready.push({ f: f, crc: crc, method: 0, out: f.data, size: n, csize: n });
          else ready.push({ f: f, crc: crc, method: 8, out: z, size: n, csize: z.length });
        }, function () { ready.push({ f: f, crc: crc, method: 0, out: f.data, size: n, csize: n }); });
      });
    });
    return chain.then(function () {
      var parts = [], central = [], off = 0, cdSize = 0;
      function view(len) { return new DataView(new ArrayBuffer(len)); }
      function set64(v, at, n) { v.setUint32(at, n % 4294967296, true); v.setUint32(at + 4, Math.floor(n / 4294967296), true); }
      ready.forEach(function (r) {
        var name = enc.encode(r.f.name);
        var big = r.size >= Z64 || r.csize >= Z64, far = off >= Z64;
        // local header: ZIP64 extra { size, csize } when either is too big
        var h = view(30 + (big ? 20 : 0));
        h.setUint32(0, 0x04034b50, true);
        h.setUint16(4, big ? 45 : 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, r.method, true);
        h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
        h.setUint32(14, r.crc, true);
        h.setUint32(18, big ? M32 : r.csize, true); h.setUint32(22, big ? M32 : r.size, true);
        h.setUint16(26, name.length, true); h.setUint16(28, big ? 20 : 0, true);
        var lh = new Uint8Array(h.buffer);
        if (big) {
          var lx = view(20);
          lx.setUint16(0, 1, true); lx.setUint16(2, 16, true); set64(lx, 4, r.size); set64(lx, 12, r.csize);
          parts.push(lh.subarray(0, 30), name, new Uint8Array(lx.buffer), r.out);
        } else parts.push(lh, name, r.out);
        // central header: ZIP64 extra holds only the fields that do not fit
        var xs = [];
        if (r.size >= Z64) xs.push(r.size);
        if (r.csize >= Z64) xs.push(r.csize);
        if (far) xs.push(off);
        var c = view(46);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, xs.length ? 45 : 20, true); c.setUint16(6, xs.length ? 45 : 20, true);
        c.setUint16(8, 0x0800, true); c.setUint16(10, r.method, true);
        c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
        c.setUint32(16, r.crc, true);
        c.setUint32(20, r.csize >= Z64 ? M32 : r.csize, true); c.setUint32(24, r.size >= Z64 ? M32 : r.size, true);
        c.setUint16(28, name.length, true); c.setUint16(30, xs.length ? 4 + 8 * xs.length : 0, true);
        c.setUint32(42, far ? M32 : off, true);
        central.push(new Uint8Array(c.buffer), name);
        cdSize += 46 + name.length;
        if (xs.length) {
          var cx = view(4 + 8 * xs.length);
          cx.setUint16(0, 1, true); cx.setUint16(2, 8 * xs.length, true);
          xs.forEach(function (n, i) { set64(cx, 4 + 8 * i, n); });
          central.push(new Uint8Array(cx.buffer));
          cdSize += 4 + 8 * xs.length;
        }
        off += 30 + name.length + (big ? 20 : 0) + r.csize;
      });
      var tail = [], count = ready.length;
      if (count > Z64N || off >= Z64 || cdSize >= Z64) {
        var z = view(56);                                    // ZIP64 end of central directory
        z.setUint32(0, 0x06064b50, true); set64(z, 4, 44);
        z.setUint16(12, 45, true); z.setUint16(14, 45, true);
        set64(z, 24, count); set64(z, 32, count); set64(z, 40, cdSize); set64(z, 48, off);
        var loc = view(20);                                  // ZIP64 locator
        loc.setUint32(0, 0x07064b50, true); set64(loc, 8, off + cdSize); loc.setUint32(16, 1, true);
        tail.push(new Uint8Array(z.buffer), new Uint8Array(loc.buffer));
      }
      var e = view(22);
      e.setUint32(0, 0x06054b50, true);
      e.setUint16(8, Math.min(count, 0xFFFF), true); e.setUint16(10, Math.min(count, 0xFFFF), true);
      e.setUint32(12, cdSize >= Z64 ? M32 : cdSize, true); e.setUint32(16, off >= Z64 ? M32 : off, true);
      tail.push(new Uint8Array(e.buffer));
      return parts.concat(central, tail);
    });
  }
  function zip(entries, date) { return zipParts(entries, date).then(concat); }

  // ---------- ZIP reader → source { names, size(n), bytes(n, max), blob(n) } ----------
  // Over random access ("ra"): bytes in memory, or a Blob/File read a
  // piece at a time, so a 3 GB bundle never has to fit in memory.
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function u64(b, o) { return u32(b, o) + u32(b, o + 4) * 4294967296; }
  function bytesRA(b) {
    return {
      size: b.length,
      get: function (o, n) { return Promise.resolve(b.subarray(Math.min(o, b.length), Math.min(b.length, o + n))); },
      part: function (o, n) { return b.subarray(o, o + n); }
    };
  }
  function blobRA(bl) {
    return {
      size: bl.size,
      get: function (o, n) {
        return bl.slice(Math.min(o, bl.size), Math.min(bl.size, o + n)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      },
      part: function (o, n) { return bl.slice(o, o + n); }
    };
  }
  function zipSource(ra, lim) {
    if (ra.size < 22) return Promise.reject(bad("notzip"));
    var tailAt = Math.max(0, ra.size - 22 - 65535 - 20);
    var entries = {}, names = [];
    return ra.get(tailAt, ra.size - tailAt).then(function (t) {
      var eocd = -1;
      for (var i = t.length - 22; i >= 0; i--) {
        if (t[i] === 0x50 && t[i + 1] === 0x4b && t[i + 2] === 0x05 && t[i + 3] === 0x06) { eocd = i; break; }
      }
      if (eocd < 0) throw bad("notzip");
      var info = { count: u16(t, eocd + 10), cdSize: u32(t, eocd + 12), cdOff: u32(t, eocd + 16) };
      if (info.count !== 0xFFFF && info.cdSize !== M32 && info.cdOff !== M32) return info;
      // ZIP64: the locator sits right before the end record
      var l = eocd - 20;
      if (l < 0 || u32(t, l) !== 0x07064b50) throw bad("notzip");
      var at = u64(t, l + 8);
      return ra.get(at, 56).then(function (z) {
        if (z.length < 56 || u32(z, 0) !== 0x06064b50) throw bad("notzip");
        return { count: u64(z, 32), cdSize: u64(z, 40), cdOff: u64(z, 48) };
      });
    }).then(function (info) {
      if (info.count > lim.entries) throw bad("toomany");
      if (info.cdOff + info.cdSize > ra.size || info.cdSize > info.count * (46 + 65535 * 3) + 46) throw bad("notzip");
      return ra.get(info.cdOff, info.cdSize).then(function (cd) { return { cd: cd, count: info.count }; });
    }).then(function (x) {
      var cd = x.cd, p = 0, declared = 0;
      for (var n = 0; n < x.count; n++) {
        if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw bad("notzip");
        var flags = u16(cd, p + 8), method = u16(cd, p + 10);
        var csize = u32(cd, p + 20), size = u32(cd, p + 24);
        var nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), loc = u32(cd, p + 42);
        var name = utf8(cd.subarray(p + 46, p + 46 + nlen));
        if (size === M32 || csize === M32 || loc === M32) {
          // ZIP64 extra: the fields that did not fit, in this order
          var q = p + 46 + nlen, xe = q + xlen, found = false;
          while (q + 4 <= xe) {
            var id = u16(cd, q), len = u16(cd, q + 2), v = q + 4;
            if (id === 1) {
              found = true;
              if (size === M32) { if (v + 8 > q + 4 + len) throw bad("notzip"); size = u64(cd, v); v += 8; }
              if (csize === M32) { if (v + 8 > q + 4 + len) throw bad("notzip"); csize = u64(cd, v); v += 8; }
              if (loc === M32) { if (v + 8 > q + 4 + len) throw bad("notzip"); loc = u64(cd, v); }
              break;
            }
            q += 4 + len;
          }
          if (!found) throw bad("notzip");
        }
        p += 46 + nlen + xlen + clen;
        if (flags & 1) throw bad("encrypted");
        if (name.slice(-1) === "/") continue;                       // folder entries
        if (name.indexOf("__MACOSX/") === 0 || /(^|\/)\.DS_Store$/.test(name)) continue;
        if (!safePath(name)) throw bad("path");
        if (Object.prototype.hasOwnProperty.call(entries, name)) throw bad("dup");
        if (method !== 0 && method !== 8) throw bad("method");
        if (size > (method === 0 ? lim.stored : lim.entry)) throw bad("toobig");
        if (method === 0 && csize !== size) throw bad("notzip");
        if (method === 8 && size > Math.max(1024, csize * lim.ratio)) throw bad("ratio");
        declared += size;
        if (declared > lim.total) throw bad("toobig");
        names.push(name);
        entries[name] = { method: method, csize: csize, size: size, loc: loc, first: n === 0 };
      }
      return source();
    });
    // where an entry's data starts: after its local header
    function start(e) {
      if (e.start != null) return Promise.resolve(e.start);
      return ra.get(e.loc, 30).then(function (h) {
        if (h.length < 30 || u32(h, 0) !== 0x04034b50) throw bad("notzip");
        var s = e.loc + 30 + u16(h, 26) + u16(h, 28);
        if (s + e.csize > ra.size) throw bad("notzip");
        e.start = s;
        return s;
      });
    }
    function entry(nm) { return Object.prototype.hasOwnProperty.call(entries, nm) ? entries[nm] : null; }
    function source() {
      return {
        names: names,
        has: function (nm) { return !!entry(nm); },
        size: function (nm) { var e = entry(nm); return e ? e.size : 0; },
        firstName: function () { for (var k in entries) if (entries[k].first) return k; return names[0]; },
        stored: function (nm) { var e = entry(nm); return !!e && e.method === 0; },
        bytes: function (nm, max) {
          var e = entry(nm);
          if (!e) return Promise.resolve(null);
          var cap = e.method === 0 ? lim.stored : lim.entry;
          max = Math.min(max || cap, cap, e.size);               // never more than it declared
          if (e.method === 0 && e.csize > max) return Promise.reject(bad("toobig"));
          return start(e).then(function (s) { return ra.get(s, e.csize); }).then(function (data) {
            if (data.length < e.csize) throw bad("notzip");
            if (e.method === 0) return data.slice();
            return stream("d", "deflate-raw", data, max);
          });
        },
        // a stored entry as a Blob slice (or bytes), never read whole
        blob: function (nm) {
          var e = entry(nm);
          if (!e) return Promise.resolve(null);
          if (e.method !== 0) return this.bytes(nm);
          return start(e).then(function (s) { return ra.part(s, e.csize); });
        }
      };
    }
  }

  // An unzipped bundle picked as a folder: [{ path, file|bytes }] or a
  // FileList (webkitRelativePath). The folder that holds "mimetype" is
  // the bundle's root; everything outside it is ignored.
  function folderSource(list, lim) {
    var items = [];
    Array.prototype.forEach.call(list || [], function (it) {
      if (!it) return;
      var p = it.path || it.webkitRelativePath || it.name || "";
      var data = it.file || it.bytes || (typeof it.arrayBuffer === "function" ? it : null);
      if (p && data) items.push({ path: String(p).replace(/\\/g, "/").replace(/^\/+/, ""), data: data });
    });
    var rootDir = null;
    items.forEach(function (it) {
      var m = /^(.*\/)?mimetype$/.exec(it.path);
      if (m) {
        var dir = m[1] || "";
        if (rootDir === null || dir.length < rootDir.length) rootDir = dir;
      }
    });
    if (rootDir === null) throw bad("notbundle");
    var entries = {}, names = [], total = 0;
    items.forEach(function (it) {
      if (it.path.indexOf(rootDir) !== 0) return;
      var name = it.path.slice(rootDir.length);
      if (/(^|\/)\.DS_Store$/.test(name) || /(^|\/)(desktop\.ini|Thumbs\.db)$/i.test(name)) return;
      if (!safePath(name)) throw bad("path");
      if (entries[name]) throw bad("dup");
      var size = it.data.size != null ? it.data.size : it.data.length || 0;
      if (size > lim.stored) throw bad("toobig");
      total += size;
      if (total > lim.total) throw bad("toobig");
      names.push(name);
      entries[name] = { data: it.data, size: size };
    });
    if (names.length > lim.entries) throw bad("toomany");
    return {
      names: names,
      has: function (nm) { return Object.prototype.hasOwnProperty.call(entries, nm); },
      size: function (nm) { return entries[nm] ? entries[nm].size : 0; },
      firstName: function () { return "mimetype"; },
      stored: function () { return true; },
      bytes: function (nm, max) {
        var e = Object.prototype.hasOwnProperty.call(entries, nm) ? entries[nm] : null;
        if (!e) return Promise.resolve(null);
        max = Math.min(max || lim.stored, lim.stored);
        if (e.size > max) return Promise.reject(bad("toobig"));
        return toBytes(e.data).then(function (b) {
          if (b.length > max) throw bad("toobig");
          return b;
        });
      },
      blob: function (nm) {
        var e = Object.prototype.hasOwnProperty.call(entries, nm) ? entries[nm] : null;
        return Promise.resolve(e ? e.data : null);
      }
    };
  }

  // ---------- XML (our two small files only) ----------
  function escXml(s) {
    return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function unescXml(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, function (m, e) {
      if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "amp") return "&";
      if (e === "quot") return "\""; if (e === "apos") return "'";
      var n = e.charAt(1) === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    });
  }
  // Refuses DOCTYPE / ENTITY / CDATA / processing tricks: our files
  // never need them, and they are how XML parsers get attacked.
  function checkXml(text) {
    var t = String(text).replace(/^﻿/, "").replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
    if (/<!/.test(t) || /<\?/.test(t)) throw bad("xml");
    return t;
  }
  function attrs(s) {
    var o = {}, re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s))) o[m[1]] = unescXml(m[3] != null ? m[3] : m[4]);
    return o;
  }
  function parseManifest(text) {
    var t = checkXml(text);
    var rootM = /<manifest\b([^>]*)>/.exec(t);
    if (!rootM) throw bad("manifest");
    var out = { attrs: attrs(rootM[1]), files: {} };
    var re = /<file\b([^>]*?)\/?>/g, m;
    while ((m = re.exec(t))) {
      var a = attrs(m[1]);
      if (a.path && safePath(a.path)) out.files[a.path] = { type: a.type || "", size: +a.size || 0, sha256: /^[0-9a-f]{64}$/.test(a.sha256 || "") ? a.sha256 : "" };
    }
    return out;
  }
  var META_KEYS = { "dc:title": "title", "dc:creator": "creator", "dc:language": "language", "dc:date": "modified",
    "dc:description": "description", "created": "created", "generator": "generator", "id": "id" };
  function parseMeta(text) {
    var t = checkXml(text), out = { subjects: [] };
    var re = /<(dc:[a-z]+|created|generator|id)\b[^>]*>([^<]*)<\/\1>/g, m;
    while ((m = re.exec(t))) {
      var v = unescXml(m[2]).trim().slice(0, 2000);
      if (m[1] === "dc:subject") { if (v && out.subjects.length < 100) out.subjects.push(v.slice(0, 200)); }
      else if (META_KEYS[m[1]]) out[META_KEYS[m[1]]] = v;
    }
    return out;
  }
  function isoOf(v) {
    var d = typeof v === "number" ? new Date(v) : v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
    return d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
  }
  function metaXml(m) {
    var l = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<meta xmlns="' + NS + '" xmlns:dc="' + DC + '">'];
    function el(tag, v) { if (v != null && String(v) !== "") l.push("  <" + tag + ">" + escXml(String(v).slice(0, 2000)) + "</" + tag + ">"); }
    el("dc:title", m.title);
    el("dc:creator", m.creator);
    el("dc:language", m.language);
    el("dc:date", isoOf(m.modified));
    el("dc:description", m.description);
    (Array.isArray(m.subjects) ? m.subjects : []).slice(0, 100).forEach(function (s) { el("dc:subject", s); });
    el("created", isoOf(m.created));
    el("generator", m.generator);
    el("id", m.id);
    l.push("</meta>", "");
    return l.join("\n");
  }
  function manifestXml(app, schema, files) {
    var l = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<manifest xmlns="' + NS + '" version="' + VERSION + '" app="' + escXml(app) + '" schema="' + escXml(schema) + '" min-reader="' + VERSION + '">'];
    files.forEach(function (f) {
      l.push('  <file path="' + escXml(f.name) + '" type="' + escXml(f.type) + '" size="' + f.size + '" sha256="' + f.sha + '"/>');
    });
    l.push("</manifest>", "");
    return l.join("\n");
  }
  function readme(mime, title) {
    return [
      "This is an orOS file (" + mime + ")" + (title ? ": " + title : "") + ".",
      "Open it at https://useoros.online, or unzip it: content.json is the project,",
      "media/ holds its pictures and sounds, preview/ a copy other programs can open.",
      "Format: " + SPEC,
      "",
      "Αρχείο του orOS. Ανοίγει στο https://useoros.online ή με αποσυμπίεση: το",
      "content.json είναι το έργο, ο φάκελος media/ οι εικόνες και οι ήχοι του,",
      "ο φάκελος preview/ ένα αντίγραφο για άλλα προγράμματα.",
      ""
    ].join("\r\n");
  }

  // ---------- write ----------
  // opts: { mime, app, schema, content (object), meta { title, creator,
  //   language, description, subjects[], created, modified, id },
  //   generator, media { key: Uint8Array|Blob }, thumbnail (PNG),
  //   preview [{ name, data, type? }], settings (object), date,
  //   onProgress(done, total) (bytes of media hashed so far) }
  // Media Blobs over 64 MB are hashed a piece at a time and stored as
  // they are, never copied into memory (writeBlob keeps them as Blobs).
  function pack(opts) {
    opts = opts || {};
    if (!MIME_RE.test(opts.mime || "")) return Promise.reject(bad("mime"));
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(opts.app || "")) return Promise.reject(bad("app"));
    var schema = String(opts.schema || opts.app + "/1");
    var files = [], chain = Promise.resolve();
    var media = opts.media || {}, done = 0, total = 0;
    var prog = typeof opts.onProgress === "function" ? opts.onProgress : null;
    Object.keys(media).forEach(function (k) { var v = media[k]; total += v ? (isBlob(v) ? v.size : v.length || v.byteLength || 0) : 0; });
    function add(name, data, type, deflate, counted) {
      chain = chain.then(function () {
        if (!safePath(name)) throw bad("path");
        return digest(data, counted && prog ? function (n) { done += n; prog(done, total); } : null);
      }).then(function (d) {
        var body = d.bytes || data;
        return (d.bytes ? Promise.resolve(d.bytes) : body.slice(0, 64).arrayBuffer().then(function (ab) { return new Uint8Array(ab); })).then(function (head) {
          files.push({ name: name, data: body, size: d.size, crc: d.crc, type: type || typeFor(name, head), deflate: deflate, sha: d.sha });
        });
      });
    }
    var json = JSON.stringify(opts.content === undefined ? null : opts.content, null, 1);
    add("content.json", json, "application/json", true);
    var meta = {};
    var mo = opts.meta || {};
    Object.keys(mo).forEach(function (k) { meta[k] = mo[k]; });
    meta.generator = meta.generator || opts.generator || "orOS " + opts.app;
    add("meta.xml", metaXml(meta), "application/xml", true);
    if (opts.settings && typeof opts.settings === "object") add("settings.json", JSON.stringify(opts.settings, null, 1), "application/json", true);
    Object.keys(media).sort().forEach(function (k) {
      if (!KEY_RE.test(k)) { chain = chain.then(function () { throw bad("key"); }); return; }
      add("media/" + k, media[k], null, false, true);
    });
    if (opts.thumbnail) add("preview/thumbnail.png", opts.thumbnail, "image/png", false);
    (Array.isArray(opts.preview) ? opts.preview : []).forEach(function (p) {
      if (p && p.name) add("preview/" + p.name, p.data, p.type, !/\.(png|jpe?g|gif|webp|pdf|mp4|webm|mp3|m4a|ogg|wav|flac)$/i.test(p.name));
    });
    add("README.txt", readme(opts.mime, mo.title), "text/plain", true);
    return chain.then(function () {
      var mf = manifestXml(opts.app, schema, files);
      var all = [{ name: "mimetype", data: enc.encode(opts.mime), deflate: false },
        { name: "META-INF/manifest.xml", data: enc.encode(mf), deflate: true }];
      // a stable order: the description files first, then media and previews
      return zipParts(all.concat(files), opts.date);
    });
  }
  // → Promise<Uint8Array> (the whole file in memory: fine below a few
  // hundred MB)
  function write(opts) { return pack(opts).then(concat); }
  // → Promise<Blob> made of the pieces and the media Blobs themselves:
  // for projects with big videos or sounds (Montage, Studio)
  function writeBlob(opts) {
    return pack(opts).then(function (parts) { return new Blob(parts, { type: opts.mime }); });
  }

  // ---------- read ----------
  function lims(opts) {
    var o = opts && opts.limits, l = {};
    Object.keys(LIM).forEach(function (k) { l[k] = o && typeof o[k] === "number" ? Math.min(o[k], LIM[k] * 4) : LIM[k]; });
    l.big = !!(opts && opts.big);
    l.stored = l.big ? l.bigEntry : l.entry;
    if (l.big) l.total = Math.max(l.total, l.bigTotal);
    return l;
  }
  // sha256 of an entry; big stored entries are streamed, not read whole
  function hashOf(src, name, onBytes, whole) {
    if (whole || src.size(name) <= SMALL) return src.bytes(name).then(function (b) { return sha256(b).then(function (h) { return { sha: h, bytes: b, head: b }; }); });
    return src.blob(name).then(function (bl) {
      return digest(bl, onBytes).then(function (d) {
        var head = d.bytes ? Promise.resolve(d.bytes) : bl.slice(0, 64).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
        return head.then(function (h) { return { sha: d.sha, blob: bl, head: h }; });
      });
    });
  }
  // opts: { mime: "application/x-oros-…" | [..] (expected types),
  //   limits overrides }. Result: { mime, app, schema, version, meta,
  //   content, media { key: { bytes, type, sha, size } }, settings, thumbnail,
  //   changed [paths whose bytes no longer match the manifest],
  //   missing [paths the manifest lists that are gone], rekeyed { old: new } }
  // { big: true }: media up to LIM.bigEntry; each media item also has
  //   blob (a slice of the file, never copied), and bytes only when it
  //   is at most 64 MB. onProgress(done, total) while big media hash.
  //
  //   changed [paths whose bytes no longer match the manifest],
  //   missing [paths the manifest lists that are gone], rekeyed { old: new } }
  function readSource(src, opts, l) {
    opts = opts || {};
    var out = { changed: [], missing: [], rekeyed: {}, media: {}, meta: { subjects: [] } };
    var mf = null;
    if (!src.has("mimetype")) return Promise.reject(bad("notbundle"));
    return src.bytes("mimetype", 128).then(function (b) {
      var mime = utf8(b).trim();
      if (!MIME_RE.test(mime)) throw bad("notbundle");
      var want = opts.mime ? [].concat(opts.mime) : null;
      if (want && want.indexOf(mime) < 0) throw bad("wrongtype");
      out.mime = mime;
      return src.has("META-INF/manifest.xml") ? src.bytes("META-INF/manifest.xml", l.xml) : null;
    }).then(function (b) {
      if (b) {
        mf = parseManifest(utf8(b));
        var v = String(mf.attrs.version || "1.0"), mr = String(mf.attrs["min-reader"] || v);
        if ((parseInt(v, 10) || 0) > MAJOR || (parseInt(mr, 10) || 0) > MAJOR) throw bad("newer");
        out.version = v;
        out.app = /^[a-z][a-z0-9-]{1,30}$/.test(mf.attrs.app || "") ? mf.attrs.app : "";
        out.schema = String(mf.attrs.schema || "").slice(0, 60);
      } else {
        out.version = VERSION; out.app = ""; out.schema = "";
        out.noManifest = true;
      }
      return src.has("meta.xml") ? src.bytes("meta.xml", l.xml) : null;
    }).then(function (b) {
      if (b) out.meta = parseMeta(utf8(b));
      // every file the manifest lists: still there, still the same bytes?
      var chain = Promise.resolve();
      if (mf) Object.keys(mf.files).forEach(function (p) {
        if (!src.has(p)) { out.missing.push(p); return; }
        if (!mf.files[p].sha256 || /^media\//.test(p)) return;   // media are hashed below
        chain = chain.then(function () { return hashOf(src, p); }).then(function (x) {
          if (x.sha !== mf.files[p].sha256) out.changed.push(p);
        });
      });
      return chain;
    }).then(function () {
      // media: bytes, real type, real hash; a hash-named file whose
      // bytes changed outside orOS gets its real hash as its new key
      var chain = Promise.resolve();
      var mnames = src.names.filter(function (n) { return /^media\/[^/]+$/.test(n) && KEY_RE.test(n.slice(6)); });
      var prog = typeof opts.onProgress === "function" ? opts.onProgress : null, done = 0, total = 0;
      mnames.forEach(function (n) { total += src.size(n); });
      mnames.forEach(function (n) {
        var key = n.slice(6);
        chain = chain.then(function () {
          return hashOf(src, n, prog ? function (k) { done += k; prog(done, total); } : null, !l.big);
        }).then(function (x) {
          var h = x.sha, listed = mf && mf.files[n];
          if (listed && listed.sha256 && listed.sha256 !== h) out.changed.push(n);
          var m = HASHED_RE.exec(key), k = key;
          if (m && m[1] !== h) { k = h + (m[2] || ""); out.rekeyed[key] = k; }
          var type = typeOf(x.head) || "application/octet-stream";
          var item = { type: type, sha: h, size: src.size(n) };
          if (x.bytes) item.bytes = x.bytes;
          if (l.big) item.blob = x.blob || new Blob([x.bytes], { type: type });
          out.media[k] = item;
          if (x.bytes && prog) { done += x.bytes.length; prog(done, total); }
        });
      });
      return chain;
    }).then(function () {
      if (!src.has("content.json")) throw bad("nocontent");
      return src.bytes("content.json", l.json);
    }).then(function (b) {
      var txt = utf8(b).replace(/^﻿/, "");
      Object.keys(out.rekeyed).forEach(function (o) {
        var oldStem = o.replace(/\..*$/, ""), newStem = out.rekeyed[o].replace(/\..*$/, "");
        txt = txt.split(oldStem).join(newStem);
      });
      try { out.content = JSON.parse(txt); } catch (e) { throw bad("content"); }
      return src.has("settings.json") ? src.bytes("settings.json", l.xml) : null;
    }).then(function (b) {
      if (b) { try { out.settings = JSON.parse(utf8(b)); } catch (e) { out.settings = null; } }
      return src.has("preview/thumbnail.png") ? src.bytes("preview/thumbnail.png", 8 * 1024 * 1024) : null;
    }).then(function (b) {
      if (b && typeOf(b) === "image/png") out.thumbnail = b;
      return out;
    });
  }
  // input: bytes, an ArrayBuffer, or a Blob/File (read a piece at a time)
  function read(input, opts) {
    var l = lims(opts);
    return Promise.resolve().then(function () {
      return isBlob(input) ? blobRA(input) : toBytes(input).then(bytesRA);
    }).then(function (ra) { return zipSource(ra, l); }).then(function (src) {
      // the type must be the first entry, uncompressed (ODF/EPUB rule),
      // so tools can tell the type from the bytes alone
      if (src.firstName() !== "mimetype" || !src.stored("mimetype")) throw bad("notbundle");
      return readSource(src, opts, l);
    });
  }
  function readFolder(list, opts) {
    var l = lims(opts);
    return Promise.resolve().then(function () { return readSource(folderSource(list, l), opts, l); });
  }

  // The bundle's type from the first bytes of a file: the first local
  // entry must be "mimetype", stored. "" = some other ZIP, null = not a ZIP.
  function sniff(head) {
    if (!head || head.length < 4 || !starts(head, [0x50, 0x4b, 0x03, 0x04])) return null;
    if (head.length < 38) return "";
    var method = u16(head, 8), csize = u32(head, 18), nlen = u16(head, 26), xlen = u16(head, 28);
    if (nlen !== 8 || ascii(head, 30, 8) !== "mimetype" || method !== 0 || csize > 64) return "";
    var at = 30 + nlen + xlen;
    if (head.length < at + csize) return "";
    var m = ascii(head, at, csize).trim();
    return MIME_RE.test(m) ? m : "";
  }
  function typeOfExt(name) {
    var m = /(\.[a-z0-9]+)$/i.exec(String(name || ""));
    return m && TYPES[m[1].toLowerCase()] ? TYPES[m[1].toLowerCase()] : null;
  }

  function pickFolder() {
    if (typeof document === "undefined") return Promise.resolve(null);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.multiple = true;
      inp.setAttribute("webkitdirectory", ""); inp.setAttribute("directory", "");
      inp.addEventListener("change", function () { resolve(inp.files && inp.files.length ? inp.files : null); });
      inp.addEventListener("cancel", function () { resolve(null); });
      inp.click();
    });
  }

  var api = {
    VERSION: VERSION, NS: NS, TYPES: TYPES, LIM: LIM,
    write: write, writeBlob: writeBlob, read: read, readFolder: readFolder, digest: digest, sniff: sniff, pickFolder: pickFolder,
    sha256: sha256, typeOf: typeOf, safePath: safePath, typeOfExt: typeOfExt,
    _zip: zip, _z64: function (bytes, count) { Z64 = bytes || M32; Z64N = count || 0xFFFF; }, _parseManifest: parseManifest, _parseMeta: parseMeta
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBundle = api;
})(typeof window !== "undefined" ? window : this);
