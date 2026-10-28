// ============================================================
// orOS designkit — fonts.js (v1.0.0)
// Font families a Layout document names besides the built-in Noto
// ones. Owner: Layout.
//   - "fs_<id>": a Fontsource family (open licences, mostly SIL OFL),
//     fetched as TTF subset files on demand and kept in this
//     device's Cache Storage, so it works offline after its first use.
//   - "uf_<16 hex>": a font file of the user's, stored once on the
//     orOS disk as /internal/Fonts/<sha256>.ttf (Vault syncs it like
//     any file; a document keeps only the file name). The files on
//     the disk are the user's font library on every device.
// A style names the family in ext.fam and keeps its built-in `font`
// as the stand-in (designkit/text.js); the document lists its
// families in setup.ext.fonts = [{ id, name, fb, r, b, i, bi }]
// (fb = the stand-in, r/b/i/bi = file names of a uf_ family), so a
// device that does not have a font yet still knows its name.
// Fonts are checked before they are kept: TrueType outlines only
// (jsPDF cannot embed PostScript outlines), never a font whose
// licence forbids embedding (OS/2 fsType "restricted"), ≤ 15 MB. A
// WOFF file is unpacked to TTF first.
// Exposes orosDK.fonts (browser) or module.exports (Node: the pure
// parts).
// ============================================================
(function (root) {
  "use strict";

  var T;
  if (typeof module !== "undefined" && module.exports) T = require("./text.js");
  else T = root.orosDK.text;

  var FOLDER = "/internal/Fonts";
  var FILE_RE = /^[0-9a-f]{64}\.ttf$/;
  var MAX = 15 * 1024 * 1024, MAX_FONTS = 40;
  var CACHE = "oros-atelier-fonts";        // shared with Atelier (same files)
  var CATALOG = "https://api.fontsource.org/v1/fonts";
  var CDN = "https://cdn.jsdelivr.net/fontsource/fonts/";
  var SUBSETS = ["latin", "latin-ext", "greek", "greek-ext"];
  var BUILTIN = ["serif", "sans", "mono"];

  // ---------- 1. Ids and names ----------
  function isFam(id) { return typeof id === "string" && id.length <= 63 && T.FAM_RE.test(id); }
  function fsIdOf(slug) { return "fs_" + String(slug).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function fsSlug(id) { return id.slice(3).replace(/_/g, "-"); }
  function ufIdOf(file) { return "uf_" + file.slice(0, 16); }
  // "Times New Roman" / "TimesNewRomanPS-BoldMT" / "ABCDEF+Constantia,Bold"
  // → "timesnewroman" / "constantia": what two names of one family share.
  var STYLE_WORDS = /(regular|book|normal|medium|semibold|demibold|bold|extrabold|black|heavy|light|thin|italic|oblique|condensed|ps|mt)$/;
  function squash(name) {
    var s = String(name || "").replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    var prev;
    do { prev = s; s = s.replace(STYLE_WORDS, ""); } while (s !== prev && s.length > 3);
    return s;
  }

  // ---------- 2. Font files ----------
  function tables(dv) {
    var n = dv.getUint16(4), out = {};
    for (var t = 0; t < n; t++) {
      var off = 12 + t * 16;
      var tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      out[tag] = { off: dv.getUint32(off + 8), len: dv.getUint32(off + 12) };
    }
    return out;
  }
  function utf16(dv, o, n) {
    var s = "";
    for (var i = 0; i + 1 < n; i += 2) s += String.fromCharCode(dv.getUint16(o + i));
    return s;
  }
  function latin1(dv, o, n) {
    var s = "";
    for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i));
    return s;
  }
  // What a TTF says about itself: { family, sub, b, i, fb, fsType,
  // glyf } (family / sub: the typographic names, else the legacy ones).
  function info(buf) {
    var dv = new DataView(buf), tb = tables(dv), names = {};
    if (tb.name) {
      var o = tb.name.off, count = dv.getUint16(o + 2), str = o + dv.getUint16(o + 4);
      for (var r = 0; r < count; r++) {
        var ro = o + 6 + r * 12;
        var pid = dv.getUint16(ro), eid = dv.getUint16(ro + 2), lang = dv.getUint16(ro + 4), nid = dv.getUint16(ro + 6);
        var len = dv.getUint16(ro + 8), off = str + dv.getUint16(ro + 10);
        if ([1, 2, 16, 17].indexOf(nid) < 0) continue;
        var rank = pid === 3 && lang === 0x409 ? 3 : pid === 3 ? 2 : pid === 1 && eid === 0 ? 1 : 0;
        if (!rank || (names[nid] && names[nid].rank >= rank)) continue;
        names[nid] = { rank: rank, s: (pid === 3 ? utf16(dv, off, len) : latin1(dv, off, len)).replace(/[\u0000-\u001F]/g, "").trim() };
      }
    }
    var fam = (names[16] || names[1] || {}).s || "", sub = (names[17] || names[2] || {}).s || "";
    var b = 0, i = 0, fsType = 0, fb = "serif";
    if (tb["OS/2"]) {
      var os = tb["OS/2"].off, sel = dv.getUint16(os + 62);
      fsType = dv.getUint16(os + 8);
      i = sel & 1 ? 1 : 0; b = sel & 32 ? 1 : 0;
      var pan = dv.getUint8(os + 32), serif = dv.getUint8(os + 33), prop = dv.getUint8(os + 35);
      if (pan === 2 && serif >= 11 && serif <= 13) fb = "sans";
      if (pan === 2 && prop === 9) fb = "mono";
    } else if (tb.head) {
      var ms = dv.getUint16(tb.head.off + 44);
      b = ms & 1 ? 1 : 0; i = ms & 2 ? 1 : 0;
    }
    if (/sans/i.test(fam)) fb = "sans";
    if (/mono|code|courier/i.test(fam)) fb = "mono";
    return { family: fam.slice(0, 60), sub: sub.slice(0, 40), b: b, i: i, fb: fb, fsType: fsType, glyf: !!tb.glyf };
  }

  // A WOFF (1.0) file → the TTF it packs (zlib through
  // DecompressionStream). Promise of an ArrayBuffer, or null.
  function unwoff(buf) {
    var dv = new DataView(buf);
    if (latin1(dv, 0, 4) !== "wOFF") return Promise.resolve(buf);
    if (typeof DecompressionStream === "undefined") return Promise.resolve(null);
    var n = dv.getUint16(12), dir = [];
    for (var t = 0; t < n; t++) {
      var o = 44 + t * 20;
      dir.push({ tag: dv.getUint32(o), off: dv.getUint32(o + 4), clen: dv.getUint32(o + 8), olen: dv.getUint32(o + 12), sum: dv.getUint32(o + 16) });
    }
    return Promise.all(dir.map(function (d) {
      var raw = new Uint8Array(buf, d.off, d.clen);
      if (d.clen >= d.olen) return Promise.resolve(raw.slice(0));
      var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    })).then(function (datas) {
      var size = 12 + 16 * n;
      datas.forEach(function (d) { size += (d.length + 3) & ~3; });
      if (size > MAX) return null;
      var out = new Uint8Array(size), ov = new DataView(out.buffer), pos = 12 + 16 * n;
      ov.setUint32(0, dv.getUint32(4));
      ov.setUint16(4, n);
      var p2 = 1, lg = 0;
      while (p2 * 2 <= n) { p2 *= 2; lg++; }
      ov.setUint16(6, p2 * 16); ov.setUint16(8, lg); ov.setUint16(10, n * 16 - p2 * 16);
      dir.forEach(function (d, k) {
        var e = 12 + k * 16;
        ov.setUint32(e, d.tag); ov.setUint32(e + 4, d.sum); ov.setUint32(e + 8, pos); ov.setUint32(e + 12, datas[k].length);
        out.set(datas[k], pos);
        pos += (datas[k].length + 3) & ~3;
      });
      return out.buffer;
    }, function () { return null; });
  }

  // Can this file be kept? → { ok, err, info }; err: "size" | "type" |
  // "outlines" (PostScript) | "restricted" (licence forbids embedding).
  function check(buf) {
    if (!buf || buf.byteLength > MAX) return { ok: false, err: "size" };
    var nfo;
    try { T.parseTTF(buf); nfo = info(buf); } catch (e) { return { ok: false, err: "type" }; }
    if (!nfo.glyf) return { ok: false, err: "outlines", info: nfo };
    if ((nfo.fsType & 0x000F) === 0x0002) return { ok: false, err: "restricted", info: nfo };
    if (!nfo.family) return { ok: false, err: "type" };
    return { ok: true, err: "", info: nfo };
  }

  // ---------- 3. A document's families ----------
  function variantOf(b, i) { return b ? (i ? "bi" : "b") : (i ? "i" : "r"); }
  function normEntry(e) {
    if (!e || !isFam(e.id)) return null;
    var o = { id: e.id, name: String(e.name || "").replace(/[\u0000-\u001F]/g, "").slice(0, 60) || e.id, fb: BUILTIN.indexOf(e.fb) >= 0 ? e.fb : "serif" };
    if (e.id.indexOf("uf_") === 0) {
      ["r", "b", "i", "bi"].forEach(function (v) { if (FILE_RE.test(e[v] || "")) o[v] = e[v]; });
      if (!o.r) { var any = o.b || o.i || o.bi; if (!any) return null; o.r = any; }
    }
    return o;
  }
  function docFonts(doc) {
    var x = doc && doc.setup && doc.setup.ext, out = [], seen = {};
    (x && Array.isArray(x.fonts) ? x.fonts : []).forEach(function (e) {
      var o = normEntry(e);
      if (o && !seen[o.id]) { seen[o.id] = 1; out.push(o); }
    });
    return out;
  }
  // The families the document's styles name.
  function famsUsed(doc) {
    var ids = {};
    (doc.pstyles || []).concat(doc.cstyles || []).forEach(function (s) {
      var f = s.ext && s.ext.fam;
      if (isFam(f)) ids[f] = 1;
    });
    return Object.keys(ids).sort();
  }
  function fontsourceUrls(id) {
    var slug = fsSlug(id);
    function files(w, st) { return SUBSETS.map(function (s) { return CDN + slug + "@latest/" + s + "-" + w + "-" + st + ".ttf"; }); }
    return { r: files(400, "normal"), b: files(700, "normal"), i: files(400, "italic"), bi: files(700, "italic") };
  }
  // Registers every family the document names (once per family) and
  // returns the font keys its styles may need.
  function register(doc) {
    var byId = {}, keys = [];
    docFonts(doc).forEach(function (e) { byId[e.id] = e; });
    famsUsed(doc).forEach(function (id) {
      var e = byId[id] || fromLibrary(id) || { id: id, name: id.indexOf("fs_") === 0 ? fsName(id) : id, fb: "serif" }, urls;
      if (id.indexOf("fs_") === 0) urls = fontsourceUrls(id);
      else {
        if (!e.r) return;
        urls = {};
        ["r", "b", "i", "bi"].forEach(function (v) { urls[v] = e[v] ? ["asset:" + e[v]] : []; });
      }
      if (!T.registerFamily(id, { name: e.name, urls: urls, fallback: e.fb })) return;
      ["r", "b", "i", "bi"].forEach(function (v) { keys.push(id + "-" + v); });
    });
    return keys;
  }
  // A uf_ family the list does not have (two devices added fonts at
  // once and one list won): its files on this disk, by the hash
  // prefix in the id (known after library()).
  function fromLibrary(id) {
    if (id.indexOf("uf_") !== 0) return null;
    var lib = Object.keys(known).map(function (f) { return known[f]; }).filter(Boolean);
    return families(lib).filter(function (f) { return f.id === id; })[0] || null;
  }
  function fsName(id) { return fsSlug(id).split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" "); }
  // The document with this family listed (pure; the caller stamps).
  function withEntry(list, e) {
    var o = normEntry(e);
    if (!o) return list;
    var out = list.filter(function (x) { return x.id !== o.id; });
    out.push(o);
    return out.slice(-MAX_FONTS);
  }

  // ---------- 4. Files: the disk, the cache, the network ----------
  function fs() {
    try { return (root.parent && root.parent.orosFS) || root.orosFS || null; }
    catch (e) { return root.orosFS || null; }
  }
  // A copy made in this window: the shell's orosFS (and a file picked
  // through it) gives ArrayBuffers of the shell's window, which fail
  // text.js's `instanceof ArrayBuffer`.
  function local(ab) { return new Uint8Array(ab).slice().buffer; }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(buf) { return root.crypto.subtle.digest("SHA-256", buf).then(hex); }
  function cached(url) {
    if (typeof caches === "undefined") return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(url); }, function () { return null; });
  }
  function keep(url, res) {
    if (typeof caches === "undefined") return;
    caches.open(CACHE).then(function (c) { return c.put(url, res); }).then(null, function () {});
  }
  // designkit/text.js fetcher: "asset:<file>" from the disk, a web
  // address from the cache first. null = not there (a subset or weight
  // a family does not have is remembered as such).
  function fetcher(url) {
    if (url.indexOf("asset:") === 0) {
      var name = url.slice(6), F = fs();
      if (!F || !FILE_RE.test(name)) return Promise.resolve(null);
      return F.read(FOLDER + "/" + name).then(function (b) { return b.arrayBuffer().then(local); }, function () { return null; });
    }
    return cached(url).then(function (hit) {
      if (hit) return hit.status === 204 ? null : hit.arrayBuffer();
      return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" }).then(function (r) {
        if (r.status === 404 || r.status === 403) { keep(url, new Response(null, { status: 204 })); return null; }
        if (!r.ok) throw new Error("font " + r.status);
        return r.arrayBuffer().then(function (ab) {
          if (ab.byteLength > MAX) throw new Error("font size");
          keep(url, new Response(ab, { headers: { "Content-Type": "font/ttf" } }));
          return ab;
        });
      });
    });
  }

  // The font files on the disk: [{ file, family, sub, b, i, fb }].
  var known = {};
  function library() {
    var F = fs();
    if (!F) return Promise.resolve([]);
    return F.ls(FOLDER).then(function (list) {
      var files = (list || []).map(function (e) { return e.name; }).filter(function (n) { return FILE_RE.test(n); });
      return Promise.all(files.map(function (f) {
        if (known[f]) return known[f];
        return F.read(FOLDER + "/" + f).then(function (b) { return b.arrayBuffer(); }).then(local).then(function (ab) {
          var c = check(ab);
          if (!c.ok) return null;
          known[f] = { file: f, family: c.info.family, sub: c.info.sub, b: c.info.b, i: c.info.i, fb: c.info.fb };
          return known[f];
        }, function () { return null; });
      }));
    }, function () { return []; }).then(function (l) {
      return l.filter(Boolean).sort(function (a, b) { return a.family.localeCompare(b.family) || (a.b - b.b) || (a.i - b.i); });
    });
  }
  // The library grouped by family: [{ id, name, fb, r, b, i, bi }].
  function families(lib) {
    var by = {}, out = [];
    lib.forEach(function (f) {
      var k = squash(f.family) || f.family.toLowerCase();
      var e = by[k];
      if (!e) { e = by[k] = { name: f.family, fb: f.fb, files: {} }; out.push(e); }
      var v = variantOf(f.b, f.i);
      if (!e.files[v]) e.files[v] = f.file;
    });
    return out.map(function (e) {
      var r = e.files.r || e.files.b || e.files.i || e.files.bi;
      var o = { id: ufIdOf(r), name: e.name, fb: e.fb, r: r };
      ["b", "i", "bi"].forEach(function (v) { if (e.files[v]) o[v] = e.files[v]; });
      return o;
    });
  }
  // A file the user picked → kept on the disk (once: the name is its
  // hash). Promise of { file, family, sub, b, i, fb } or { err }.
  function importFile(file) {
    var F = fs();
    if (!F) return Promise.resolve({ err: "disk" });
    if (!file || file.size > MAX * 2) return Promise.resolve({ err: "size" });
    return file.arrayBuffer().then(local).then(unwoff).then(function (buf) {
      if (!buf) return { err: "type" };
      var c = check(buf);
      if (!c.ok) return { err: c.err };
      return sha256(buf).then(function (h) {
        var name = h + ".ttf", path = FOLDER + "/" + name;
        var rec = { file: name, family: c.info.family, sub: c.info.sub, b: c.info.b, i: c.info.i, fb: c.info.fb };
        return F.stat(path).then(function () { return null; }, function () {
          return F.mkdir(FOLDER).then(null, function () {}).then(function () { return F.write(path, new Blob([buf], { type: "font/ttf" })); });
        }).then(function () { known[name] = rec; return rec; });
      });
    }, function () { return { err: "type" }; });
  }
  // A font file from a package: checked against its name (the hash).
  function put(name, blob) {
    var F = fs();
    if (!F || !FILE_RE.test(name || "")) return Promise.reject(new Error("badid"));
    return blob.arrayBuffer().then(local).then(function (ab) {
      return sha256(ab).then(function (h) {
        if (h + ".ttf" !== name) throw new Error("hash");
        if (!check(ab).ok) throw new Error("font");
        var path = FOLDER + "/" + name;
        return F.stat(path).then(function () { return null; }, function () {
          return F.mkdir(FOLDER).then(null, function () {}).then(function () { return F.write(path, new Blob([ab], { type: "font/ttf" })); });
        });
      });
    }).then(function () { return name; });
  }
  function blob(name) {
    var F = fs();
    if (!F || !FILE_RE.test(name || "")) return Promise.resolve(null);
    return F.read(FOLDER + "/" + name).then(null, function () { return null; });
  }

  // The Fontsource catalog (once per device, then from the cache):
  // [{ id, family, cat, greek }].
  var catalogP = null;
  function catalog() {
    if (catalogP) return catalogP;
    catalogP = cached(CATALOG).then(function (hit) {
      if (hit && hit.status === 200) return hit.json();
      return fetch(CATALOG, { credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" }).then(function (r) {
        if (!r.ok) throw new Error("catalog " + r.status);
        return r.clone().json().then(function (j) { keep(CATALOG, r); return j; });
      });
    }).then(function (j) {
      return (Array.isArray(j) ? j : []).filter(function (f) {
        return f && typeof f.id === "string" && /^[a-z0-9-]{1,60}$/.test(f.id) && typeof f.family === "string" && f.type !== "icons";
      }).map(function (f) {
        var subs = Array.isArray(f.subsets) ? f.subsets : [];
        return { id: fsIdOf(f.id), family: f.family.slice(0, 60), cat: f.category === "monospace" ? "mono" : f.category === "serif" ? "serif" : "sans", greek: subs.indexOf("greek") >= 0 };
      });
    }).then(null, function () { catalogP = null; return []; });
    return catalogP;
  }

  // The family to use for a font name found in a PDF or another
  // program's file: one on the disk, else Fontsource. Promise of an
  // entry for setup.ext.fonts, or null.
  function match(name, lib, opts) {
    var k = squash(name);
    if (!k) return Promise.resolve(null);
    var mine = families(lib || []).filter(function (f) { return squash(f.name) === k; })[0];
    if (mine) return Promise.resolve(mine);
    if (opts && opts.offline) return Promise.resolve(null);
    return catalog().then(function (cat) {
      var f = cat.filter(function (c) { return squash(c.family) === k; })[0];
      return f ? { id: f.id, name: f.family, fb: f.cat } : null;
    });
  }

  var api = {
    FOLDER: FOLDER, FILE_RE: FILE_RE, MAX: MAX,
    isFam: isFam, fsIdOf: fsIdOf, ufIdOf: ufIdOf, squash: squash, info: info, check: check,
    docFonts: docFonts, famsUsed: famsUsed, register: register, withEntry: withEntry, families: families,
    unwoff: unwoff, fetcher: fetcher, library: library, importFile: importFile, put: put, blob: blob,
    catalog: catalog, match: match
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.fonts = api; }
})(typeof window !== "undefined" ? window : this);
