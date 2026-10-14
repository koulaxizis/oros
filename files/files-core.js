// ============================================================
// orOS Files — files-core.js (v1.0.0): pure helpers, no DOM.
// Trash records, synced Favourites (merge), accent-free search
// folding + snippets, ZIP building (stored or deflated entries) and
// a safe extraction plan. Reading ZIPs is atelier/zip.js
// (AtelierZip.open); deflating is the page's CompressionStream.
// Exposes window.OrosFilesCore (browser) or module.exports (tests).
// ============================================================
(function (root) {
  "use strict";

  var ROOT = "/internal";
  var TRASH = ROOT + "/.trash";
  var TRASH_DAYS = 30;
  var DAY = 86400000;
  var BAD = /[\\/:*?"<>|\u0000-\u001f]/g;

  function baseName(p) { return String(p).slice(String(p).lastIndexOf("/") + 1); }
  function parentOf(p) { var i = String(p).lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; }
  function isTrashPath(p) { return typeof p === "string" && (p === TRASH || p.indexOf(TRASH + "/") === 0); }

  // A path of the disk a user item can live at: under /internal, no
  // empty / "." / ".." segment, never inside the trash.
  function safePath(p) {
    if (typeof p !== "string" || p.length > 4096 || p.indexOf(ROOT + "/") !== 0) return false;
    var segs = p.slice(ROOT.length + 1).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === "" || segs[i] === "." || segs[i] === "..") return false;
    }
    return !isTrashPath(p);
  }

  // "(1)" suffix, the desktop file-manager convention.
  function uniqueName(name, taken) {
    if (taken.indexOf(name) === -1) return name;
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : "";
    var i = 1;
    while (taken.indexOf(base + " (" + i + ")" + ext) !== -1) i++;
    return base + " (" + i + ")" + ext;
  }

  // ---------- Trash ----------
  // One record per trashed item, never a shared index file: two
  // devices trashing at once would make one index file conflict in
  // Vault Drive. Layout:
  //   /internal/.trash/<id>/<original name>   the item itself
  //   /internal/.trash/<id>.json              { v, path, name, dir, at }
  // <id> = deletion time in base 36 (9 digits) + "-" + random, so even
  // a record whose .json has not arrived yet has a known age.
  var ID_RE = /^([0-9a-z]{9})-([0-9a-z]{4,12})$/;

  function trashId(now, rnd) {
    var t = Math.max(0, Math.floor(now)).toString(36);
    while (t.length < 9) t = "0" + t;
    var r = String(rnd || "").toLowerCase().replace(/[^0-9a-z]/g, "");
    while (r.length < 6) r += "0";
    return t + "-" + r.slice(0, 12);
  }
  function idTime(id) {
    var m = ID_RE.exec(String(id));
    return m ? parseInt(m[1], 36) : 0;
  }
  function trashItemDir(id) { return TRASH + "/" + id; }
  function trashMetaPath(id) { return TRASH + "/" + id + ".json"; }

  function makeMeta(path, dir, now) {
    return { v: 1, path: path, name: baseName(path), dir: !!dir, at: Math.floor(now) };
  }

  // Whatever a .json holds (another device, an old version, garbage):
  // { path (null when unusable), name, dir, at }.
  function normMeta(o, id) {
    var out = { path: null, name: null, dir: false, at: idTime(id) };
    if (!o || typeof o !== "object") return out;
    if (safePath(o.path)) out.path = o.path;
    var nm = typeof o.name === "string" ? o.name : (out.path ? baseName(out.path) : "");
    if (nm && nm.length <= 255 && nm.indexOf("/") === -1 && nm !== "." && nm !== "..") out.name = nm;
    out.dir = o.dir === true;
    if (typeof o.at === "number" && isFinite(o.at) && o.at > 0) out.at = Math.floor(o.at);
    return out;
  }

  // ls(/internal/.trash) → { ids: [...] (sorted, newest first), metas: {id: true} }
  function trashListing(list) {
    var ids = {}, metas = {};
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (!e || typeof e.name !== "string") return;
      if (e.dir && ID_RE.test(e.name)) ids[e.name] = true;
      else if (!e.dir && /\.json$/.test(e.name) && ID_RE.test(e.name.slice(0, -5))) {
        ids[e.name.slice(0, -5)] = true;
        metas[e.name.slice(0, -5)] = true;
      }
    });
    var out = Object.keys(ids).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    return { ids: out, metas: metas };
  }

  function expired(at, now, days) {
    var d = typeof days === "number" ? days : TRASH_DAYS;
    return at > 0 && now - at >= d * DAY;
  }

  // Where a restored item goes: its old folder when that is a valid
  // disk path, else the disk root.
  function restoreParent(meta) {
    return meta && meta.path ? parentOf(meta.path) : ROOT;
  }

  // ---------- Favourites (synced slice "files") ----------
  // { v:1, items:[{ p, dir, m, del? }] } sorted by p. Per item:
  // bigger m wins, a tie goes to the removal (R17), then to the
  // larger JSON — symmetric and idempotent (R5, R26).
  var FAV_TOMBS = 300;

  function favWinner(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    if (!!a.del !== !!b.del) return a.del ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function normFavItem(it) {
    if (!it || typeof it !== "object" || !safePath(it.p)) return null;
    var m = typeof it.m === "number" && isFinite(it.m) && it.m > 0 ? Math.floor(it.m) : 0;
    var o = { p: it.p, dir: it.dir === true, m: m };
    if (it.del === true) o.del = true;
    return o;
  }
  function normFavs(raw) {
    var by = {};
    var items = raw && typeof raw === "object" && Array.isArray(raw.items) ? raw.items : [];
    items.forEach(function (it) {
      var n = normFavItem(it);
      if (!n) return;
      by[n.p] = Object.prototype.hasOwnProperty.call(by, n.p) ? favWinner(by[n.p], n) : n;
    });
    var live = [], dead = [];
    Object.keys(by).forEach(function (k) { (by[k].del ? dead : live).push(by[k]); });
    dead.sort(function (a, b) { return b.m - a.m || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0); });
    var all = live.concat(dead.slice(0, FAV_TOMBS));
    all.sort(function (a, b) { return a.p < b.p ? -1 : a.p > b.p ? 1 : 0; });
    return { v: 1, items: all };
  }
  function mergeFavs(a, b) {
    var x = a && Array.isArray(a.items) ? a.items : [];
    var y = b && Array.isArray(b.items) ? b.items : [];
    return normFavs({ items: x.concat(y) });
  }
  function favFind(state, p) {
    var items = state && state.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].p === p) return items[i];
    return null;
  }
  function favIs(state, p) { var f = favFind(state, p); return !!(f && !f.del); }
  function favLive(state) {
    return (state && state.items || []).filter(function (f) { return !f.del; });
  }
  function favStamp(old, now) { return Math.max(Math.floor(now), old ? old.m + 1 : 0); }
  function favSet(state, p, dir, on, now) {
    if (!safePath(p)) return normFavs(state);
    var old = favFind(state, p);
    var items = (state && state.items || []).filter(function (f) { return f.p !== p; });
    var it = { p: p, dir: !!dir, m: favStamp(old, now) };
    if (!on) it.del = true;
    items.push(it);
    return normFavs({ items: items });
  }
  // A move / rename inside Files carries the favourite along.
  function favMove(state, from, to, now) {
    var s = normFavs(state);
    favLive(s).forEach(function (f) {
      if (f.p !== from && f.p.indexOf(from + "/") !== 0) return;
      var np = to + f.p.slice(from.length);
      s = favSet(s, f.p, f.dir, false, now);
      s = favSet(s, np, f.dir, true, now);
    });
    return s;
  }
  // Trashed: every favourite at or under the path goes.
  function favDrop(state, p, now) {
    var s = normFavs(state);
    favLive(s).forEach(function (f) {
      if (f.p === p || f.p.indexOf(p + "/") === 0) s = favSet(s, f.p, f.dir, false, now);
    });
    return s;
  }

  // ---------- Search: folding + snippets ----------
  // fold() keeps the length (one UTF-16 unit in, one out), so an index
  // found in the folded text is an index in the original: lower case,
  // accents off, final sigma = sigma.
  var foldCache = {};
  function foldUnit(c) {
    if (Object.prototype.hasOwnProperty.call(foldCache, c)) return foldCache[c];
    var d = c;
    try { d = c.normalize("NFD"); } catch (e) {}
    var f = d.charAt(0).toLowerCase().charAt(0) || c;
    if (f === "ς") f = "σ";
    foldCache[c] = f;
    return f;
  }
  function fold(s) {
    s = String(s);
    var out = new Array(s.length);
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 128) out[i] = code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s.charAt(i);
      else if (code >= 0xd800 && code <= 0xdfff) out[i] = s.charAt(i);
      else out[i] = foldUnit(s.charAt(i));
    }
    return out.join("");
  }

  // Text that is searched / shown for a file of this kind: markup loses
  // its tags (and scripts / styles), a few entities are decoded.
  function plainText(text, ext) {
    var s = String(text);
    if (/^(html?|xml|svg|xhtml)$/.test(ext || "")) {
      s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
           .replace(/<!--[\s\S]*?-->/g, " ")
           .replace(/<[^>]*>/g, " ")
           .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
           .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    }
    return s;
  }

  // → { idx, count, before, match, after } or null. foldedQ = fold(q).
  function findSnippet(text, foldedQ, radius) {
    if (!foldedQ) return null;
    var r = radius || 60;
    var ft = fold(text);
    var idx = ft.indexOf(foldedQ);
    if (idx < 0) return null;
    var count = 0, at = idx;
    while (at >= 0 && count < 999) { count++; at = ft.indexOf(foldedQ, at + foldedQ.length); }
    var start = Math.max(0, idx - r), end = Math.min(text.length, idx + foldedQ.length + r);
    var sp = text.lastIndexOf(" ", idx - 1);
    if (start > 0 && sp > start && sp < idx) start = sp + 1;
    var ep = text.indexOf(" ", idx + foldedQ.length + Math.floor(r / 2));
    if (end < text.length && ep > 0 && ep < end) end = ep;
    function squash(x) { return x.replace(/\s+/g, " "); }
    return {
      idx: idx,
      count: count,
      before: (start > 0 ? "…" : "") + squash(text.slice(start, idx)).replace(/^ /, ""),
      match: squash(text.slice(idx, idx + foldedQ.length)),
      after: squash(text.slice(idx + foldedQ.length, end)).replace(/ $/, "") + (end < text.length ? "…" : "")
    };
  }

  var CONTENT_EXTS = ["txt", "md", "markdown", "csv", "tsv", "json", "js", "mjs", "ts", "css",
    "html", "htm", "xhtml", "xml", "svg", "yml", "yaml", "ini", "cfg", "conf", "log", "py",
    "java", "c", "h", "cpp", "cs", "go", "rs", "rb", "php", "sh", "bat", "ps1", "sql", "tex",
    "srt", "vtt", "ics", "vcf", "toml", "rtf"];
  var TEXT_MAX = 4 * 1024 * 1024;       // bytes read per text file
  var PDF_MAX = 30 * 1024 * 1024;       // bytes per PDF
  var PDF_PAGES = 300;                  // pages read per PDF

  function extOf(name) {
    var dot = String(name).lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return "";
    return name.slice(dot + 1).toLowerCase();
  }
  // "text" | "pdf" | "" for a file of this name and size (null size =
  // unknown: let the reader check).
  function contentKind(name, size) {
    var ext = extOf(name);
    if (ext === "pdf") return (size == null || size <= PDF_MAX) ? "pdf" : "";
    if (ext === "" || CONTENT_EXTS.indexOf(ext) !== -1) return (size == null || size <= TEXT_MAX) ? "text" : "";
    return "";
  }
  // A decoded "text" file that is really binary (a NUL in the first 4 KB).
  function looksBinary(text) { return String(text).slice(0, 4096).indexOf("\u0000") !== -1; }

  // ---------- ZIP ----------
  var CRC = null;
  function crc32(b, prev) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var x = (typeof prev === "number" ? prev : 0) ^ 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }

  // Already compressed: deflating again only costs time.
  var STORE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "zip", "gz", "tgz", "bz2", "xz",
    "7z", "rar", "mp3", "m4a", "aac", "ogg", "opus", "flac", "mp4", "m4v", "mov", "webm", "mkv",
    "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "woff", "woff2"];
  function shouldStore(name) { return STORE_EXTS.indexOf(extOf(name)) !== -1; }

  // Name for a new archive: one item → its name without the
  // extension (a folder keeps its whole name); several → null.
  function zipNameFor(names, dirs) {
    if (!names || names.length !== 1) return null;
    var n = names[0], ext = extOf(n);
    var base = (!dirs || !dirs[0]) && ext ? n.slice(0, n.length - ext.length - 1) : n;
    return (base || "archive") + ".zip";
  }

  function dosTime(d) {
    var t = d instanceof Date && !isNaN(d.getTime()) ? d : new Date(2026, 0, 1);
    if (t.getFullYear() < 1980) t = new Date(1980, 0, 1);
    return {
      time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
      date: ((Math.min(2107, t.getFullYear()) - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate()
    };
  }

  // entries: [{ name ("a/b.txt", a folder ends with "/"), size (raw
  // length), crc, data: Uint8Array (what is stored: raw, or deflated
  // when method 8), method 0 | 8, date }]. → [Uint8Array parts] for a
  // Blob. Throws Error("zip-big") past 65535 entries or 4 GB (no ZIP64).
  function zipBuild(entries) {
    var enc = new TextEncoder();
    if (entries.length > 65535) throw new Error("zip-big");
    var parts = [], central = [], off = 0;
    function head(sig, len) { var v = new DataView(new ArrayBuffer(len)); v.setUint32(0, sig, true); return v; }
    entries.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = f.data || new Uint8Array(0);
      var dt = dosTime(f.date instanceof Date ? f.date : (typeof f.date === "number" ? new Date(f.date) : null));
      var method = f.method === 8 ? 8 : 0;
      var isDir = /\/$/.test(f.name);
      if (off + 30 + name.length + data.length > 0xFFFFFFFE || f.size > 0xFFFFFFFE) throw new Error("zip-big");
      var h = head(0x04034b50, 30);
      h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(10, dt.time, true); h.setUint16(12, dt.date, true);
      h.setUint32(14, f.crc >>> 0, true); h.setUint32(18, data.length, true); h.setUint32(22, f.size >>> 0, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = head(0x02014b50, 46);
      c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(12, dt.time, true); c.setUint16(14, dt.date, true);
      c.setUint32(16, f.crc >>> 0, true); c.setUint32(20, data.length, true); c.setUint32(24, f.size >>> 0, true);
      c.setUint16(28, name.length, true); c.setUint32(38, isDir ? 0x10 : 0, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    if (off + cdSize > 0xFFFFFFFE) throw new Error("zip-big");
    var e = head(0x06054b50, 22);
    e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return parts.concat(central, [new Uint8Array(e.buffer)]);
  }

  // An entry name from a ZIP → safe path segments, or null (skip it):
  // "..", absolute and drive paths can never climb out of the target
  // folder; characters the disk refuses become "_"; Mac resource forks
  // and .DS_Store are dropped.
  function zipSafePath(name) {
    if (typeof name !== "string" || !name || name.length > 1024) return null;
    var raw = name.replace(/\\/g, "/").split("/");
    var segs = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (s === "" || s === ".") continue;
      if (s === "..") return null;
      if (i === 0 && /^[A-Za-z]:$/.test(s)) continue;
      s = s.replace(BAD, "_").replace(/[ .]+$/, function (m) { return m.length === s.length ? "_" : ""; });
      if (!s) continue;
      if (s.length > 255) s = s.slice(0, 255);
      segs.push(s);
    }
    if (!segs.length || segs.length > 64) return null;
    if (segs[0] === "__MACOSX" || segs[segs.length - 1] === ".DS_Store") return null;
    return segs;
  }

  // names: entry names (files only, as AtelierZip lists them);
  // sizeOf(name) → declared size. → { items:[{ name, rel }], skipped,
  // total, tooMany, tooBig }. rel = "a/b.txt" under the target folder;
  // clashes after cleaning get " (1)"; a file where a folder is needed
  // is renamed the same way.
  var X_MAX_FILES = 20000, X_MAX_TOTAL = 1024 * 1024 * 1024;
  function extractPlan(names, sizeOf, caps) {
    var maxFiles = caps && caps.files || X_MAX_FILES, maxTotal = caps && caps.total || X_MAX_TOTAL;
    var items = [], skipped = 0, total = 0, seen = {}, dirs = {}, inDir = {};
    function take(dir, leaf) {
      if (!Object.prototype.hasOwnProperty.call(inDir, dir)) inDir[dir] = [];
      if (inDir[dir].indexOf(leaf) === -1) inDir[dir].push(leaf);
    }
    (names || []).forEach(function (n) {
      var segs = zipSafePath(n);
      if (!segs) { skipped++; return; }
      for (var i = 1; i < segs.length; i++) {
        dirs[segs.slice(0, i).join("/")] = true;
        take(segs.slice(0, i - 1).join("/"), segs[i - 1]);
      }
      items.push({ name: n, segs: segs });
    });
    var out = [];
    items.forEach(function (it) {
      var dir = it.segs.slice(0, -1).join("/");
      var leaf = it.segs[it.segs.length - 1];
      var key = (dir ? dir + "/" : "") + leaf;
      if (seen[key] || dirs[key]) {
        leaf = uniqueName(leaf, inDir[dir] || []);
        key = (dir ? dir + "/" : "") + leaf;
      }
      seen[key] = true;
      take(dir, leaf);
      var sz = Math.max(0, Number(sizeOf ? sizeOf(it.name) : 0) || 0);
      total += sz;
      out.push({ name: it.name, rel: key, size: sz });
    });
    // Every entry inside one top folder ("Docs/…"): extracting makes
    // that folder itself, not "Docs/Docs".
    var top = null;
    for (var t = 0; t < out.length; t++) {
      var cut = out[t].rel.indexOf("/");
      var first = cut > 0 ? out[t].rel.slice(0, cut) : null;
      if (!first || (top !== null && first !== top)) { top = null; break; }
      top = first;
    }
    return { items: out, skipped: skipped, total: total, top: top,
             tooMany: out.length > maxFiles, tooBig: total > maxTotal };
  }

  // ---------- Thumbnails ----------
  var THUMB_MAX = 20 * 1024 * 1024;
  var THUMB_IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];
  function thumbKind(name, size) {
    var ext = extOf(name);
    if (size != null && size > THUMB_MAX) return "";
    if (THUMB_IMG.indexOf(ext) !== -1) return "image";
    if (ext === "pdf") return "pdf";
    return "";
  }

  var api = {
    ROOT: ROOT, TRASH: TRASH, TRASH_DAYS: TRASH_DAYS, DAY: DAY,
    baseName: baseName, parentOf: parentOf, isTrashPath: isTrashPath, safePath: safePath,
    uniqueName: uniqueName,
    trashId: trashId, idTime: idTime, trashItemDir: trashItemDir, trashMetaPath: trashMetaPath,
    makeMeta: makeMeta, normMeta: normMeta, trashListing: trashListing, expired: expired,
    restoreParent: restoreParent,
    normFavs: normFavs, mergeFavs: mergeFavs, favIs: favIs, favLive: favLive, favSet: favSet,
    favMove: favMove, favDrop: favDrop,
    fold: fold, plainText: plainText, findSnippet: findSnippet, extOf: extOf,
    contentKind: contentKind, looksBinary: looksBinary,
    TEXT_MAX: TEXT_MAX, PDF_MAX: PDF_MAX, PDF_PAGES: PDF_PAGES,
    crc32: crc32, shouldStore: shouldStore, zipNameFor: zipNameFor, zipBuild: zipBuild,
    zipSafePath: zipSafePath, extractPlan: extractPlan,
    thumbKind: thumbKind, THUMB_MAX: THUMB_MAX
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosFilesCore = api;
})(typeof window !== "undefined" ? window : this);
