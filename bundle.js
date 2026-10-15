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
//   read(bytes, opts)    → Promise<result>   (a .zip bundle)
//   readFolder(files)    → Promise<result>   (an unzipped bundle:
//                          [{ path, file|bytes }] or a FileList with
//                          webkitRelativePath)
//   sniff(head)          → the bundle's MIME type, "" for another
//                          ZIP, null when not a ZIP (head: the first
//                          ≥ 128 bytes)
//   sha256(bytes)        → Promise<hex>
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
    ".orostone": { app: "ringtones", mime: "application/x-oros-tone" }
  };

  var LIM = {
    entries: 10000,
    entry: 512 * 1024 * 1024,      // one file, inflated
    total: 1024 * 1024 * 1024,     // the whole bundle, inflated
    ratio: 1000,                   // inflated : compressed, per entry
    xml: 4 * 1024 * 1024,          // manifest.xml, meta.xml
    json: 128 * 1024 * 1024        // content.json
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

  // ---------- ZIP writer (stored + deflated, no ZIP64) ----------
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
  // entries: [{ name, data: Uint8Array, deflate: bool }] in order
  function zip(entries, date) {
    // default 1 Jan 2026, so the same input gives the same bytes
    var d = date instanceof Date && !isNaN(date) ? date : new Date(2026, 0, 1);
    var dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosD = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    if (entries.length > 65535) return Promise.reject(bad("toomany"));
    var chain = Promise.resolve(), ready = [];
    entries.forEach(function (f) {
      chain = chain.then(function () {
        var crc = crc32(f.data);
        if (!f.deflate || !canDeflate || f.data.length < 64) { ready.push({ f: f, crc: crc, method: 0, out: f.data }); return; }
        return stream("c", "deflate-raw", f.data).then(function (z) {
          if (z.length >= f.data.length) ready.push({ f: f, crc: crc, method: 0, out: f.data });
          else ready.push({ f: f, crc: crc, method: 8, out: z });
        }, function () { ready.push({ f: f, crc: crc, method: 0, out: f.data }); });
      });
    });
    return chain.then(function () {
      var parts = [], central = [], off = 0;
      function head(sig, len) { var v = new DataView(new ArrayBuffer(len)); v.setUint32(0, sig, true); return v; }
      ready.forEach(function (r) {
        var name = enc.encode(r.f.name), size = r.f.data.length, csize = r.out.length;
        if (off + csize > 0xFFFFFFF0) throw bad("toobig");
        var h = head(0x04034b50, 30);
        h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, r.method, true);
        h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
        h.setUint32(14, r.crc, true); h.setUint32(18, csize, true); h.setUint32(22, size, true);
        h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), name, r.out);
        var c = head(0x02014b50, 46);
        c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, r.method, true);
        c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
        c.setUint32(16, r.crc, true); c.setUint32(20, csize, true); c.setUint32(24, size, true);
        c.setUint16(28, name.length, true); c.setUint32(42, off, true);
        central.push(new Uint8Array(c.buffer), name);
        off += 30 + name.length + csize;
      });
      var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
      var e = head(0x06054b50, 22);
      e.setUint16(8, ready.length, true); e.setUint16(10, ready.length, true);
      e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
      var all = parts.concat(central, [new Uint8Array(e.buffer)]);
      var out = new Uint8Array(off + cdSize + 22), o = 0;
      all.forEach(function (p) { out.set(p, o); o += p.length; });
      return out;
    });
  }

  // ---------- ZIP reader → source { names, size(n), bytes(n, max) } ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function zipSource(bytes, lim) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw bad("notzip");
    var eocd = -1, stop = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= stop; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw bad("notzip");
    var count = u16(bytes, eocd + 10), cdOff = u32(bytes, eocd + 16);
    if (count > lim.entries) throw bad("toomany");
    if (cdOff >= bytes.length) throw bad("notzip");
    var entries = {}, names = [], p = cdOff, declared = 0;
    for (var n = 0; n < count; n++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw bad("notzip");
      var flags = u16(bytes, p + 8), method = u16(bytes, p + 10);
      var csize = u32(bytes, p + 20), size = u32(bytes, p + 24);
      var nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32), loc = u32(bytes, p + 42);
      var raw = bytes.subarray(p + 46, p + 46 + nlen);
      var name = utf8(raw);
      p += 46 + nlen + xlen + clen;
      if (flags & 1) throw bad("encrypted");
      if (name.slice(-1) === "/") continue;                       // folder entries
      if (name.indexOf("__MACOSX/") === 0 || /(^|\/)\.DS_Store$/.test(name)) continue;
      if (!safePath(name)) throw bad("path");
      if (Object.prototype.hasOwnProperty.call(entries, name)) throw bad("dup");
      if (method !== 0 && method !== 8) throw bad("method");
      if (size > lim.entry) throw bad("toobig");
      if (method === 8 && size > Math.max(1024, csize * lim.ratio)) throw bad("ratio");
      declared += size;
      if (declared > lim.total) throw bad("toobig");
      names.push(name);
      entries[name] = { method: method, csize: csize, size: size, loc: loc, first: n === 0 };
    }
    function dataOf(e) {
      var l = e.loc;
      if (l + 30 > bytes.length || u32(bytes, l) !== 0x04034b50) throw bad("notzip");
      var start = l + 30 + u16(bytes, l + 26) + u16(bytes, l + 28), end = start + e.csize;
      if (end > bytes.length) throw bad("notzip");
      return bytes.subarray(start, end);
    }
    return {
      names: names,
      has: function (nm) { return Object.prototype.hasOwnProperty.call(entries, nm); },
      size: function (nm) { return entries[nm] ? entries[nm].size : 0; },
      firstName: function () { for (var k in entries) if (entries[k].first) return k; return names[0]; },
      stored: function (nm) { return entries[nm] && entries[nm].method === 0; },
      bytes: function (nm, max) {
        var e = Object.prototype.hasOwnProperty.call(entries, nm) ? entries[nm] : null;
        if (!e) return Promise.resolve(null);
        max = Math.min(max || lim.entry, lim.entry, e.size);   // never more than it declared
        try {
          var data = dataOf(e);
          if (e.method === 0) {
            if (data.length > max) return Promise.reject(bad("toobig"));
            return Promise.resolve(data.slice());
          }
          return stream("d", "deflate-raw", data, max);
        } catch (err) { return Promise.reject(err); }
      }
    };
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
      if (size > lim.entry) throw bad("toobig");
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
        max = Math.min(max || lim.entry, lim.entry);
        if (e.size > max) return Promise.reject(bad("toobig"));
        return toBytes(e.data).then(function (b) {
          if (b.length > max) throw bad("toobig");
          return b;
        });
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
      l.push('  <file path="' + escXml(f.name) + '" type="' + escXml(f.type) + '" size="' + f.data.length + '" sha256="' + f.sha + '"/>');
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
  //   preview [{ name, data, type? }], settings (object), date }
  function write(opts) {
    opts = opts || {};
    if (!MIME_RE.test(opts.mime || "")) return Promise.reject(bad("mime"));
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(opts.app || "")) return Promise.reject(bad("app"));
    var schema = String(opts.schema || opts.app + "/1");
    var files = [], chain = Promise.resolve();
    function add(name, data, type, deflate) {
      chain = chain.then(function () { return toBytes(data); }).then(function (b) {
        if (!safePath(name)) throw bad("path");
        return sha256(b).then(function (h) {
          files.push({ name: name, data: b, type: type || typeFor(name, b), deflate: deflate, sha: h });
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
    var media = opts.media || {};
    Object.keys(media).sort().forEach(function (k) {
      if (!KEY_RE.test(k)) { chain = chain.then(function () { throw bad("key"); }); return; }
      add("media/" + k, media[k], null, false);
    });
    if (opts.thumbnail) add("preview/thumbnail.png", opts.thumbnail, "image/png", false);
    (Array.isArray(opts.preview) ? opts.preview : []).forEach(function (p) {
      if (p && p.name) add("preview/" + p.name, p.data, p.type, !/\.(png|jpe?g|gif|webp|pdf)$/i.test(p.name));
    });
    add("README.txt", readme(opts.mime, mo.title), "text/plain", true);
    return chain.then(function () {
      var mf = manifestXml(opts.app, schema, files);
      var all = [{ name: "mimetype", data: enc.encode(opts.mime), deflate: false },
        { name: "META-INF/manifest.xml", data: enc.encode(mf), deflate: true }];
      // a stable order: the description files first, then media and previews
      return zip(all.concat(files), opts.date);
    });
  }

  // ---------- read ----------
  function lims(o) {
    var l = {};
    Object.keys(LIM).forEach(function (k) { l[k] = o && typeof o[k] === "number" ? Math.min(o[k], LIM[k] * 4) : LIM[k]; });
    return l;
  }
  // opts: { mime: "application/x-oros-…" | [..] (expected types),
  //   limits overrides }. Result: { mime, app, schema, version, meta,
  //   content, media { key: { bytes, type, sha } }, settings, thumbnail,
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
        chain = chain.then(function () { return src.bytes(p); }).then(function (x) {
          return sha256(x).then(function (h) { if (h !== mf.files[p].sha256) out.changed.push(p); });
        });
      });
      return chain;
    }).then(function () {
      // media: bytes, real type, real hash; a hash-named file whose
      // bytes changed outside orOS gets its real hash as its new key
      var chain = Promise.resolve();
      src.names.filter(function (n) { return /^media\/[^/]+$/.test(n); }).forEach(function (n) {
        var key = n.slice(6);
        if (!KEY_RE.test(key)) return;
        chain = chain.then(function () { return src.bytes(n); }).then(function (b) {
          return sha256(b).then(function (h) {
            var listed = mf && mf.files[n];
            if (listed && listed.sha256 && listed.sha256 !== h) out.changed.push(n);
            var m = HASHED_RE.exec(key), k = key;
            if (m && m[1] !== h) { k = h + (m[2] || ""); out.rekeyed[key] = k; }
            out.media[k] = { bytes: b, type: typeOf(b) || "application/octet-stream", sha: h };
          });
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
  function read(bytes, opts) {
    var l = lims(opts && opts.limits);
    return toBytes(bytes).then(function (b) {
      var src = zipSource(b, l);
      // the type must be the first entry, uncompressed (ODF/EPUB rule),
      // so tools can tell the type from the bytes alone
      if (src.firstName() !== "mimetype" || !src.stored("mimetype")) throw bad("notbundle");
      return readSource(src, opts, l);
    });
  }
  function readFolder(list, opts) {
    var l = lims(opts && opts.limits);
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
    write: write, read: read, readFolder: readFolder, sniff: sniff, pickFolder: pickFolder,
    sha256: sha256, typeOf: typeOf, safePath: safePath, typeOfExt: typeOfExt,
    _zip: zip, _parseManifest: parseManifest, _parseMeta: parseMeta
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBundle = api;
})(typeof window !== "undefined" ? window : this);
