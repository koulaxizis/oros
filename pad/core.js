// ============================================================
// orOS Pad — pure helpers (no DOM, no CodeMirror)
// Loaded by index.html before app.js, and by Node in the tests
// (tests/pad.test.js).
//   - languages: the list Pad offers, and the guess from a file name
//     or its first line (shebang, <?xml, <!DOCTYPE html>);
//   - bytes → text: BOM, UTF-8, UTF-16 LE/BE and the single-byte
//     encodings Greek files still use (Windows-1253, ISO-8859-7),
//     plus Windows-1252 and ISO-8859-1. Single-byte tables come
//     from the browser's own TextDecoder, so the encoder is its
//     exact inverse; a character the encoding has no byte for is
//     reported, never replaced by "?";
//   - line endings: detect LF / CRLF / CR, join on save;
//   - indentation: guess tabs or spaces and the width;
//   - names: "name (2).ext" for a copy, safe file names;
//   - the session (open tabs) as plain data, normalised on load.
// Nothing here runs a file or reads a file's content as code.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Languages ----------
  // id → bundle in vendor/codemirror (cm-<bundle>.min.js). "" = no
  // file needed (plain text, or Pad's own EEL2 mode in pad/eel2.js).
  var LANGS = [
    { id: "text",       name: "Plain text",  bundle: "" },
    { id: "javascript", name: "JavaScript",  bundle: "web" },
    { id: "typescript", name: "TypeScript",  bundle: "web" },
    { id: "jsx",        name: "JSX",         bundle: "web" },
    { id: "tsx",        name: "TSX",         bundle: "web" },
    { id: "json",       name: "JSON",        bundle: "web" },
    { id: "html",       name: "HTML",        bundle: "web" },
    { id: "css",        name: "CSS",         bundle: "web" },
    { id: "xml",        name: "XML",         bundle: "web" },
    { id: "php",        name: "PHP",         bundle: "web" },
    { id: "markdown",   name: "Markdown",    bundle: "web" },
    { id: "python",     name: "Python",      bundle: "python" },
    { id: "go",         name: "Go",          bundle: "go" },
    { id: "rust",       name: "Rust",        bundle: "rust" },
    { id: "cpp",        name: "C / C++",     bundle: "cpp" },
    { id: "java",       name: "Java",        bundle: "java" },
    { id: "sql",        name: "SQL",         bundle: "sql" },
    { id: "yaml",       name: "YAML",        bundle: "yaml" },
    { id: "shell",      name: "Shell",       bundle: "legacy" },
    { id: "powershell", name: "PowerShell",  bundle: "legacy" },
    { id: "toml",       name: "TOML",        bundle: "legacy" },
    { id: "ini",        name: "INI",         bundle: "legacy" },
    { id: "lua",        name: "Lua",         bundle: "legacy" },
    { id: "ruby",       name: "Ruby",        bundle: "legacy" },
    { id: "perl",       name: "Perl",        bundle: "legacy" },
    { id: "csharp",     name: "C#",          bundle: "legacy" },
    { id: "kotlin",     name: "Kotlin",      bundle: "legacy" },
    { id: "dart",       name: "Dart",        bundle: "legacy" },
    { id: "swift",      name: "Swift",       bundle: "legacy" },
    { id: "r",          name: "R",           bundle: "legacy" },
    { id: "diff",       name: "Diff",        bundle: "legacy" },
    { id: "dockerfile", name: "Dockerfile",  bundle: "legacy" },
    { id: "nginx",      name: "nginx",       bundle: "legacy" },
    { id: "eel2",       name: "EEL2 / JSFX", bundle: "" }
  ];
  var LANG_BY_ID = {};
  LANGS.forEach(function (l) { LANG_BY_ID[l.id] = l; });

  var EXT = {
    txt: "text", text: "text", log: "text", csv: "text", tsv: "text", nfo: "text",
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", mts: "typescript", cts: "typescript",
    jsx: "jsx", tsx: "tsx",
    json: "json", webmanifest: "json", jsonc: "json", geojson: "json", map: "json",
    html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
    css: "css", scss: "css", less: "css",
    xml: "xml", svg: "xml", xsl: "xml", xslt: "xml", rss: "xml", atom: "xml", plist: "xml", kml: "xml", gpx: "xml", xliff: "xml", csproj: "xml",
    php: "php", phtml: "php",
    md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
    py: "python", pyw: "python", pyi: "python",
    go: "go",
    rs: "rust",
    c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
    java: "java",
    sql: "sql",
    yaml: "yaml", yml: "yaml",
    sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", command: "shell",
    ps1: "powershell", psm1: "powershell", psd1: "powershell",
    toml: "toml",
    ini: "ini", cfg: "ini", conf: "ini", properties: "ini", desktop: "ini", reg: "ini", inf: "ini", env: "ini", editorconfig: "ini", gitconfig: "ini",
    lua: "lua",
    rb: "ruby", gemspec: "ruby",
    pl: "perl", pm: "perl",
    cs: "csharp",
    kt: "kotlin", kts: "kotlin",
    dart: "dart",
    swift: "swift",
    r: "r",
    diff: "diff", patch: "diff",
    dockerfile: "dockerfile",
    jsfx: "eel2", "jsfx-inc": "eel2", eel: "eel2"
  };
  var NAMES = {
    dockerfile: "dockerfile", containerfile: "dockerfile",
    makefile: "shell", ".bashrc": "shell", ".bash_profile": "shell", ".profile": "shell", ".zshrc": "shell",
    ".gitignore": "ini", ".gitattributes": "ini", ".npmrc": "ini", ".env": "ini",
    gemfile: "ruby", rakefile: "ruby", "cmakelists.txt": "text",
    "nginx.conf": "nginx"
  };

  function extOf(name) {
    var n = String(name || "").toLowerCase();
    var slash = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
    if (slash >= 0) n = n.slice(slash + 1);
    if (n.slice(-9) === ".jsfx-inc") return "jsfx-inc";
    var i = n.lastIndexOf(".");
    return i > 0 ? n.slice(i + 1) : "";
  }
  function baseName(name) {
    var n = String(name || "");
    var slash = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
    return slash >= 0 ? n.slice(slash + 1) : n;
  }

  // The language for a file: its whole name, then its extension, then
  // the first line. A JSFX file is often named without an extension in
  // REAPER's Effects folder, so a first line "desc:" means EEL2 too.
  function guessLang(name, firstLine) {
    var b = baseName(name).toLowerCase();
    if (NAMES[b]) return NAMES[b];
    if (/^dockerfile\./.test(b)) return "dockerfile";
    var e = extOf(b);
    if (e && EXT[e]) return EXT[e];
    var l = String(firstLine || "").replace(/^﻿/, "").slice(0, 200);
    var m = /^#!\s*(?:\/usr)?\/bin\/(?:env\s+)?([a-z0-9]+)/.exec(l);
    if (m) {
      var p = m[1];
      if (/^(?:ba|z|k|da)?sh$/.test(p)) return "shell";
      if (/^python/.test(p)) return "python";
      if (p === "node" || p === "deno" || p === "bun") return "javascript";
      if (p === "ruby") return "ruby";
      if (p === "perl") return "perl";
      if (p === "pwsh") return "powershell";
      if (p === "lua") return "lua";
    }
    if (/^<\?xml\b/.test(l)) return "xml";
    if (/^<!doctype html/i.test(l) || /^<html\b/i.test(l)) return "html";
    if (/^<\?php\b/.test(l)) return "php";
    if (/^desc:/.test(l)) return "eel2";
    return "text";
  }
  function langInfo(id) { return LANG_BY_ID[id] || LANG_BY_ID.text; }

  // ---------- Encodings ----------
  var ENCODINGS = [
    { id: "utf-8",        name: "UTF-8" },
    { id: "utf-8-bom",    name: "UTF-8 BOM" },
    { id: "utf-16le",     name: "UTF-16 LE" },
    { id: "utf-16be",     name: "UTF-16 BE" },
    { id: "windows-1253", name: "Windows-1253" },
    { id: "iso-8859-7",   name: "ISO-8859-7" },
    { id: "windows-1252", name: "Windows-1252" },
    { id: "iso-8859-1",   name: "ISO-8859-1" }
  ];
  var SINGLE = { "windows-1253": 1, "iso-8859-7": 1, "windows-1252": 1, "iso-8859-1": 1 };
  function encInfo(id) {
    for (var i = 0; i < ENCODINGS.length; i++) if (ENCODINGS[i].id === id) return ENCODINGS[i];
    return null;
  }

  function u8(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf && typeof buf.byteLength === "number") return new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
    return new Uint8Array(0);
  }

  function bomOf(b) {
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return "utf-8-bom";
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return "utf-16le";
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return "utf-16be";
    return "";
  }

  function validUtf8(b) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(b); return true; }
    catch (e) { return false; }
  }

  // UTF-16 without a BOM: many zero bytes on one side only.
  function looksUtf16(b) {
    var n = Math.min(b.length, 4096) & ~1, even = 0, odd = 0;
    if (n < 4) return "";
    for (var i = 0; i < n; i += 2) { if (b[i] === 0) even++; if (b[i + 1] === 0) odd++; }
    var half = n / 2;
    if (odd > half * 0.3 && even < half * 0.05) return "utf-16le";
    if (even > half * 0.3 && odd < half * 0.05) return "utf-16be";
    return "";
  }

  // A NUL byte in a file that is not UTF-16 = most likely not text.
  function looksBinary(buf) {
    var b = u8(buf);
    if (bomOf(b) || looksUtf16(b)) return false;
    var n = Math.min(b.length, 8192);
    for (var i = 0; i < n; i++) if (b[i] === 0) return true;
    return false;
  }

  // Which encoding a file is in. Not valid UTF-8 and no BOM means one
  // of the old single-byte encodings; the bytes cannot say which, so
  // the caller's fallback decides (Greek screen: Windows-1253).
  function detectEncoding(buf, fallback) {
    var b = u8(buf);
    var bom = bomOf(b);
    if (bom) return bom;
    var w = looksUtf16(b);
    if (w) return w;
    if (validUtf8(b)) return "utf-8";
    return SINGLE[fallback] ? fallback : "windows-1252";
  }

  function decode(buf, enc) {
    var b = u8(buf);
    var label = enc === "utf-8-bom" ? "utf-8" : enc;
    if (!encInfo(enc)) label = "utf-8";
    var skip = 0;
    if ((enc === "utf-8-bom" || enc === "utf-8") && bomOf(b) === "utf-8-bom") skip = 3;
    if (enc === "utf-16le" && b[0] === 0xFF && b[1] === 0xFE) skip = 2;
    if (enc === "utf-16be" && b[0] === 0xFE && b[1] === 0xFF) skip = 2;
    // ignoreBOM: the BOM is removed above, exactly once.
    return new TextDecoder(label, { ignoreBOM: true }).decode(b.subarray(skip));
  }

  var tables = {};
  function singleTable(enc) {
    if (tables[enc]) return tables[enc];
    var dec = new TextDecoder(enc), map = {};
    for (var i = 255; i >= 0; i--) {
      var ch = dec.decode(new Uint8Array([i]));
      if (ch !== "�") map[ch] = i;   // lower byte wins a duplicate (loop runs down)
    }
    tables[enc] = map;
    return map;
  }

  // text → bytes. { bytes } or { bad: { ch, line, col } } when a
  // character has no byte in a single-byte encoding.
  function encode(text, enc) {
    var s = String(text);
    var i, out;
    if (enc === "utf-8" || enc === "utf-8-bom" || !encInfo(enc)) {
      var body = new TextEncoder().encode(s);
      if (enc !== "utf-8-bom") return { bytes: body };
      out = new Uint8Array(body.length + 3);
      out.set([0xEF, 0xBB, 0xBF]);
      out.set(body, 3);
      return { bytes: out };
    }
    if (enc === "utf-16le" || enc === "utf-16be") {
      out = new Uint8Array(2 + s.length * 2);
      var le = enc === "utf-16le";
      out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF;
      for (i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        out[2 + i * 2] = le ? c & 255 : c >> 8;
        out[3 + i * 2] = le ? c >> 8 : c & 255;
      }
      return { bytes: out };
    }
    var map = singleTable(enc);
    out = new Uint8Array(s.length);
    var line = 1, col = 1;
    for (i = 0; i < s.length; i++) {
      var ch = s[i];
      var code = s.charCodeAt(i);
      var v = code < 128 ? code : map[ch];
      if (v === undefined) {
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) ch = s.slice(i, i + 2);
        return { bad: { ch: ch, line: line, col: col } };
      }
      out[i] = v;
      if (ch === "\n") { line++; col = 1; } else col++;
    }
    return { bytes: out };
  }

  // ---------- Line endings ----------
  // CodeMirror keeps "\n" inside; the file's own ending comes back on
  // save. Mixed files get the most common one.
  function detectEol(text) {
    var s = String(text).slice(0, 1 << 20);
    var crlf = 0, lf = 0, cr = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 13) { if (s.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++; }
      else if (c === 10) lf++;
    }
    if (!crlf && !lf && !cr) return { eol: "lf", mixed: false };
    var eol = crlf >= lf && crlf >= cr ? "crlf" : lf >= cr ? "lf" : "cr";
    var kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0);
    return { eol: eol, mixed: kinds > 1 };
  }
  var EOL_CHARS = { lf: "\n", crlf: "\r\n", cr: "\r" };
  function toLf(text) { return String(text).replace(/\r\n?/g, "\n"); }
  function withEol(text, eol) {
    var s = toLf(text);
    return eol === "crlf" || eol === "cr" ? s.replace(/\n/g, EOL_CHARS[eol]) : s;
  }

  // ---------- Indentation ----------
  // { tabs: bool, size: 2|3|4|8 } or null when the text does not say.
  function detectIndent(text) {
    var lines = String(text).slice(0, 200000).split(/\r\n?|\n/, 2000);
    var tabs = 0, spaces = 0, widths = { 2: 0, 3: 0, 4: 0, 8: 0 }, prev = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) continue;
      if (l[0] === "\t") { tabs++; prev = 0; continue; }
      var m = /^ +/.exec(l);
      var n = m ? m[0].length : 0;
      if (n && /\S/.test(l[n] || "")) spaces++;
      var d = Math.abs(n - prev);
      if (d === 2 || d === 3 || d === 4 || d === 8) widths[d]++;
      prev = n;
    }
    if (!tabs && !spaces) return null;
    if (tabs > spaces) return { tabs: true, size: 4 };
    var best = 4, bestN = 0;
    [2, 4, 3, 8].forEach(function (w) { if (widths[w] > bestN) { best = w; bestN = widths[w]; } });
    return { tabs: false, size: best };
  }

  // ---------- Names ----------
  var BAD_NAME = /[\\\/:*?"<>|\u0000-\u001F]/g;
  function safeName(name, fallback) {
    var n = String(name || "").replace(BAD_NAME, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 120);
    return n || fallback || "untitled.txt";
  }
  // "notes.txt" → "notes (2).txt", the first number not in taken.
  function copyName(name, taken) {
    var set = {};
    (taken || []).forEach(function (t) { set[String(t).toLowerCase()] = true; });
    var n = String(name || "untitled.txt");
    if (!set[n.toLowerCase()]) return n;
    var e = extOf(n), stem = e ? n.slice(0, n.length - e.length - 1) : n;
    stem = stem.replace(/ \(\d+\)$/, "");
    for (var i = 2; i < 10000; i++) {
      var c = stem + " (" + i + ")" + (e ? "." + e : "");
      if (!set[c.toLowerCase()]) return c;
    }
    return stem + " (" + Date.now() + ")" + (e ? "." + e : "");
  }

  // ---------- Session (open tabs, this device only) ----------
  // A tab as stored in IndexedDB "oros-pad" (store "tabs"):
  //   { id, name, text, lang, enc, eol, dirty, loc, sel, top, mtime }
  // loc: null (never saved) | { kind: "disk", path, mtime, size, h }
  //      (h = hashBytes of the file as Pad last read or wrote it)
  //      | { kind: "device" } (opened from this device; saved again
  //        through orosDialog, which asks where).
  var ID_RE = /^t[a-z0-9]{4,40}$/;
  function cleanLoc(l) {
    if (!l || typeof l !== "object") return null;
    if (l.kind === "disk" && typeof l.path === "string" && /^\/internal\/./.test(l.path) && l.path.indexOf("..") < 0) {
      return { kind: "disk", path: l.path.slice(0, 1024), mtime: Number(l.mtime) || 0, size: Number(l.size) || 0,
        h: typeof l.h === "string" ? l.h.slice(0, 40) : "" };
    }
    if (l.kind === "device") return { kind: "device" };
    return null;
  }
  function cleanTab(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    var sel = raw.sel && typeof raw.sel === "object" ? raw.sel : {};
    return {
      id: raw.id,
      name: safeName(raw.name),
      text: typeof raw.text === "string" ? raw.text : "",
      lang: LANG_BY_ID[raw.lang] ? raw.lang : "text",
      enc: encInfo(raw.enc) ? raw.enc : "utf-8",
      eol: EOL_CHARS[raw.eol] ? raw.eol : "lf",
      dirty: raw.dirty === true,
      loc: cleanLoc(raw.loc),
      sel: { a: Math.max(0, Number(sel.a) || 0), h: Math.max(0, Number(sel.h) || 0) },
      top: Math.max(0, Number(raw.top) || 0),
      mtime: Math.max(0, Number(raw.mtime) || 0)
    };
  }
  function cleanSession(raw) {
    var s = raw && typeof raw === "object" ? raw : {};
    var order = Array.isArray(s.order) ? s.order.filter(function (id, i, a) {
      return typeof id === "string" && ID_RE.test(id) && a.indexOf(id) === i;
    }).slice(0, 200) : [];
    var active = typeof s.active === "string" && order.indexOf(s.active) >= 0 ? s.active : (order[0] || "");
    var recent = Array.isArray(s.recent) ? s.recent.map(cleanLoc).filter(function (l) { return l && l.kind === "disk"; }).slice(0, 20) : [];
    return { order: order, active: active, recent: recent };
  }

  // "Untitled 3": the first number no open tab uses.
  function untitledName(base, taken) {
    var set = {};
    (taken || []).forEach(function (n) { set[String(n).toLowerCase()] = true; });
    for (var i = 1; i < 1000; i++) {
      var n = base + (i === 1 ? "" : " " + i) + ".txt";
      if (!set[n.toLowerCase()]) return n;
    }
    return base + ".txt";
  }

  // FNV-1a over the text, to compare a file with what Pad last saw
  // without keeping a second copy of the text.
  function hash(text) {
    var s = String(text), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + s.length;
  }

  // The same over bytes: "has the file on the disk changed?"
  function hashBytes(b) {
    var h = 0x811c9dc5;
    for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + b.length;
  }

  var api = {
    LANGS: LANGS, ENCODINGS: ENCODINGS,
    extOf: extOf, baseName: baseName, guessLang: guessLang, langInfo: langInfo, encInfo: encInfo,
    detectEncoding: detectEncoding, decode: decode, encode: encode, looksBinary: looksBinary,
    detectEol: detectEol, toLf: toLf, withEol: withEol, detectIndent: detectIndent,
    safeName: safeName, copyName: copyName, untitledName: untitledName,
    cleanTab: cleanTab, cleanSession: cleanSession, cleanLoc: cleanLoc, hash: hash, hashBytes: hashBytes
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PadCore = api;
})(typeof window !== "undefined" ? window : globalThis);
