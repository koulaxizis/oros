// ============================================================
// orOS Library — pure core (v1.0.0)
// No DOM, no storage: testable under Node (tests/library.test.js).
//   1. Constants + small helpers (ids, text folding, clamps)
//   2. Model: normalize books, positions, marks (bookmarks and
//      highlights), the whole library state
//   3. Merge (sync slice "library"): books and marks LWW per id,
//      positions LWW per book, tombstones, reading stats (max per
//      device) (R5, R17, R26, R27)
//   4. Locations ("loc") in a book: parse, compare, label
//   5. Text: accent-free search with a map back to the source,
//      re-anchoring a highlight by its quote, snippets
//   6. A small tolerant XML reader + EPUB packaging: container.xml,
//      the OPF package (metadata, manifest, spine, cover), the TOC
//      (EPUB 3 nav document or EPUB 2 NCX), paths inside the ZIP
//   7. Views: sorting / filtering the library, Markdown export
//   8. Media Shelf link (read only)
//   9. Read aloud: a section's text cut into parts to speak
//  10. Reading stats: seconds per day and per book, per device (max merge)
//  11. The Today line
//  12. FB2 and CBZ turned into the files of a small EPUB
//  13. Dictionary lookups (Wiktionary) and questions for the Assistant
// Exposes window.LibCore (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var DATA_VER   = 1;
  var MAX_BOOKS  = 2000;
  var MAX_MARKS  = 20000;
  var TITLE_LEN  = 200;
  var BY_LEN     = 120;
  var PATH_LEN   = 500;
  var TAG_LEN    = 30;
  var MAX_TAGS   = 10;
  var QUOTE_LEN  = 1000;
  var CTX_LEN    = 32;
  var NOTE_LEN   = 4000;
  var NCOLORS    = 4;
  var MAX_BYTES  = 50 * 1024 * 1024;
  var MAX_COMIC  = 200 * 1024 * 1024;     // a CBZ is mostly pictures
  var FORMATS    = ["epub", "pdf"];
  var BOOK_ID_RE = /^b[0-9a-f]{16}$/;
  var MARK_ID_RE = /^k[0-9a-z]{6,24}$/;
  var LOC_RE     = /^(?:e:\d{1,5}:\d{1,9}|p:\d{1,6}:y?\d{1,9})$/;
  var YMD_RE     = /^\d{4}-\d{2}-\d{2}$/;
  var EXTRA_RE   = /^[a-z][a-z0-9]{0,15}$/;
  var HAS = Object.prototype.hasOwnProperty;

  function str(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    return max && v.length > max ? v.slice(0, max) : v;
  }
  function int(v, lo, hi) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    v = Math.round(v);
    return v < lo || v > hi ? null : v;
  }
  function stamp(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  // Stable JSON with sorted keys (tie-breaks, R5).
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  // Book id from the file's SHA-256 (hex): the same file on two devices
  // is one record, so a union never duplicates a book (R16).
  function bookIdOf(hex) {
    hex = String(hex || "").toLowerCase();
    return /^[0-9a-f]{64}$/.test(hex) ? "b" + hex.slice(0, 16) : null;
  }
  function newMarkId(rnd) {
    var s = "k" + Date.now().toString(36);
    var r = rnd || Math.random;
    while (s.length < 15) s += Math.floor(r() * 36).toString(36);
    return s;
  }
  function extOf(name) {
    var m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }
  // The engine a file opens with: "pdf", or "epub" (EPUB, and FB2 and
  // CBZ, which open as a book built in memory: see section 12).
  function formatOf(name) {
    var k = kindOf(name);
    return k === "pdf" ? "pdf" : k ? "epub" : null;
  }
  // What the file is: "epub" | "pdf" | "fb2" (also .fb2.zip) | "cbz".
  function kindOf(name) {
    var n = String(name || "").toLowerCase();
    if (/\.fb2(\.zip)?$/.test(n)) return "fb2";
    var e = extOf(n);
    return e === "epub" || e === "pdf" || e === "cbz" ? e : null;
  }
  // "EPUB", "PDF", "FB2", "CBZ" for a book record (kind is an extra
  // field: older versions keep it and still see fmt "epub").
  function maxBytesOf(name) { return kindOf(name) === "cbz" ? MAX_COMIC : MAX_BYTES; }
  function fmtLabel(b) { return String(b && (b.kind || b.fmt) || "epub").toUpperCase(); }
  function titleFromName(name) {
    var n = String(name || "").split("/").pop().replace(/\.[a-z0-9]{1,8}$/i, "");
    n = n.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    return str(n, TITLE_LEN);
  }

  // Accent-free, case-free comparison text (Greek final sigma too).
  function foldChar(c) {
    var f = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return f === "ς" ? "σ" : f;
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ς/g, "σ");
  }

  // ---------- 2. Model ----------
  function normTags(a) {
    var out = [], seen = {};
    (Array.isArray(a) ? a : []).forEach(function (t) {
      t = str(t, TAG_LEN);
      var k = fold(t);
      if (!t || seen[k] || out.length >= MAX_TAGS) return;
      seen[k] = 1;
      out.push(t);
    });
    return out;
  }
  function parseTags(s) { return normTags(String(s || "").split(",")); }

  // Unknown fields ride along (forward-compatible), within bounds.
  function extras(src, out, known) {
    Object.keys(src).forEach(function (k) {
      if (HAS.call(known, k) || !EXTRA_RE.test(k)) return;
      var v = src[k];
      if (typeof v === "string" && v.length <= 500) out[k] = v;
      else if (typeof v === "number" && isFinite(v)) out[k] = v;
      else if (typeof v === "boolean") out[k] = v;
    });
  }

  var BOOK_KEYS = { id: 1, m: 1, h: 1, fmt: 1, title: 1, by: 1, lang: 1, year: 1, pages: 1,
                    path: 1, size: 1, tags: 1, shelf: 1, added: 1, fin: 1, kind: 1 };
  function normBook(b) {
    if (!b || typeof b !== "object" || !BOOK_ID_RE.test(b.id)) return null;
    var m = stamp(b.m);
    if (!m) return null;
    var h = typeof b.h === "string" && /^[0-9a-f]{64}$/.test(b.h) ? b.h : "";
    if (h && bookIdOf(h) !== b.id) h = "";
    var out = { id: b.id, m: m, fmt: FORMATS.indexOf(b.fmt) >= 0 ? b.fmt : "epub" };
    if (h) out.h = h;
    out.title = str(b.title, TITLE_LEN) || "?";
    var by = str(b.by, BY_LEN); if (by) out.by = by;
    var lang = str(b.lang, 20); if (lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang)) out.lang = lang;
    var year = int(b.year, 1, 9999); if (year) out.year = year;
    var pages = int(b.pages, 1, 100000); if (pages) out.pages = pages;
    var path = str(b.path, PATH_LEN); if (/^\/internal\/./.test(path) && path.indexOf("/../") < 0) out.path = path;
    var size = int(b.size, 1, 4e9); if (size) out.size = size;
    var tags = normTags(b.tags); if (tags.length) out.tags = tags;
    var shelf = str(b.shelf, 40); if (shelf && /^[A-Za-z0-9_-]+$/.test(shelf)) out.shelf = shelf;
    var added = stamp(b.added); if (added) out.added = added;
    if (typeof b.fin === "string" && YMD_RE.test(b.fin)) out.fin = b.fin;
    if ((b.kind === "fb2" || b.kind === "cbz") && out.fmt === "epub") out.kind = b.kind;   // built in memory, opens as EPUB
    extras(b, out, BOOK_KEYS);
    return out;
  }

  function normPos(p) {
    if (!p || typeof p !== "object") return null;
    var m = stamp(p.m);
    if (!m || typeof p.loc !== "string" || !LOC_RE.test(p.loc)) return null;
    var pct = int(p.pct, 0, 1000);
    return { m: m, loc: p.loc, pct: pct === null ? 0 : pct };
  }

  function normMark(k) {
    if (!k || typeof k !== "object" || !MARK_ID_RE.test(k.id) || !BOOK_ID_RE.test(k.b)) return null;
    var m = stamp(k.m);
    if (!m || (k.k !== "bm" && k.k !== "hl")) return null;
    if (typeof k.loc !== "string" || !LOC_RE.test(k.loc)) return null;
    var out = { id: k.id, m: m, b: k.b, k: k.k, loc: k.loc };
    if (k.k === "hl") {
      if (typeof k.end !== "string" || !LOC_RE.test(k.end) || cmpLoc(k.end, k.loc) <= 0) return null;
      out.end = k.end;
      var c = int(k.c, 0, NCOLORS - 1);
      out.c = c === null ? 0 : c;
    }
    var q = str(k.q, QUOTE_LEN); if (q) out.q = q;
    var pre = typeof k.pre === "string" ? k.pre.slice(-CTX_LEN) : ""; if (pre) out.pre = pre;
    var suf = typeof k.suf === "string" ? k.suf.slice(0, CTX_LEN) : ""; if (suf) out.suf = suf;
    var n = typeof k.n === "string" ? k.n.slice(0, NOTE_LEN) : ""; if (n.trim()) out.n = n;
    var pct = int(k.pct, 0, 1000); if (pct !== null) out.pct = pct;
    var lbl = str(k.lbl, 120); if (lbl) out.lbl = lbl;
    return out;
  }

  function emptyState() { return { ver: DATA_VER, books: [], pos: {}, marks: [], tombs: {} }; }

  // ---------- 3. Merge ----------
  function newer(a, b) {          // LWW: newer m; equal m → larger canonical JSON
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function tombsOf(s) {
    var out = {};
    var t = s && s.tombs && typeof s.tombs === "object" ? s.tombs : {};
    Object.keys(t).forEach(function (id) {
      if (!BOOK_ID_RE.test(id) && !MARK_ID_RE.test(id)) return;
      var ts = stamp(t[id]);
      if (ts) out[id] = ts;
    });
    return out;
  }
  // Symmetric, associative, idempotent; output canonical (sorted ids,
  // sorted keys), inputs untouched. merge(s, s) normalizes one state.
  function mergeLibrary(a, b) {
    var tombs = tombsOf(a), tb = tombsOf(b);
    Object.keys(tb).forEach(function (id) { if (!tombs[id] || tb[id] > tombs[id]) tombs[id] = tb[id]; });
    function unionBy(list, norm) {
      var map = {};
      list.forEach(function (x) {
        var n = norm(x);
        if (n) map[n.id] = newer(map[n.id], n);
      });
      return Object.keys(map).sort(cmpStr).map(function (id) { return map[id]; })
        .filter(function (x) { return !(tombs[x.id] >= x.m); });
    }
    function arr(s, k) { return s && Array.isArray(s[k]) ? s[k] : []; }
    var books = unionBy(arr(a, "books").concat(arr(b, "books")), normBook);
    if (books.length > MAX_BOOKS) books = books.slice(0, MAX_BOOKS);
    var marks = unionBy(arr(a, "marks").concat(arr(b, "marks")), normMark);
    if (marks.length > MAX_MARKS) marks = marks.slice(0, MAX_MARKS);
    var pos = {};
    [a, b].forEach(function (s) {
      var p = s && s.pos && typeof s.pos === "object" ? s.pos : {};
      Object.keys(p).forEach(function (id) {
        if (!BOOK_ID_RE.test(id)) return;
        var n = normPos(p[id]);
        if (n) pos[id] = newer(pos[id], n);
      });
    });
    var posOut = {};
    Object.keys(pos).sort(cmpStr).forEach(function (id) { posOut[id] = pos[id]; });
    var tombOut = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { tombOut[id] = tombs[id]; });
    var out = { ver: DATA_VER, books: books, pos: posOut, marks: marks, tombs: tombOut };
    var st = mergeStats(a && a.stats, b && b.stats);
    if (!statsEmpty(st)) out.stats = st;            // left out while empty
    return out;
  }

  // ---------- 4. Locations ----------
  // EPUB: "e:<spine index>:<character offset in that chapter's text>"
  // PDF:  "p:<page, 1-based>:<character offset in the page's text>"
  //       "p:<page>:y<per-mille of the page height>" (no text needed:
  //       reading position and bookmarks, also for scanned pages)
  function parseLoc(s) {
    if (typeof s !== "string" || !LOC_RE.test(s)) return null;
    var p = s.split(":");
    var y = p[2].charAt(0) === "y";
    return { f: p[0], s: +p[1], y: y, o: +(y ? p[2].slice(1) : p[2]) };
  }
  function makeLoc(f, s, o, y) {
    return f + ":" + Math.max(0, Math.floor(s)) + ":" + (y ? "y" : "") + Math.max(0, Math.floor(o));
  }
  function cmpLoc(a, b) {
    var x = parseLoc(a), z = parseLoc(b);
    if (!x || !z) return cmpStr(String(a), String(b));
    if (x.s !== z.s) return x.s - z.s;
    if (x.y !== z.y) {      // a "y" place against a text offset on one page: no order
      return 0;
    }
    return x.o - z.o;
  }
  function sortMarks(list) {
    return list.slice().sort(function (a, b) { return cmpLoc(a.loc, b.loc) || cmpStr(a.id, b.id); });
  }

  // ---------- 5. Text ----------
  // fold with a map: f[i] came from text[map[i]] (combining marks drop
  // out, so lengths may differ).
  function foldMap(text) {
    text = String(text || "");
    var f = "", map = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { c = text.substr(i, 2); }
      var g = c.length === 2 ? c : foldChar(c);
      for (var j = 0; j < g.length; j++) { f += g.charAt(j); map.push(i); }
      if (c.length === 2) i++;
    }
    map.push(text.length);
    return { f: f, map: map };
  }
  // Every match of query in text, accent- and case-free:
  // [{ o, len }] in the source's offsets. Whitespace in the query
  // matches any run of whitespace.
  function findAll(text, query, max, fm) {
    var q = fold(query).replace(/\s+/g, " ").trim();
    if (!q) return [];
    fm = fm || foldMap(text);
    var hay = fm.f.replace(/\s/g, " ");
    var out = [], lim = max || 200;
    var parts = q.split(" ").map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    var re = new RegExp(parts.join("\\s+"), "g");
    var m;
    while ((m = re.exec(hay)) && out.length < lim) {
      var s = fm.map[m.index], e = fm.map[m.index + m[0].length];
      out.push({ o: s, len: Math.max(1, e - s) });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }
  function squash(s) { return String(s || "").replace(/\s+/g, " "); }
  // Block elements join with no space in the offset text ("end.Next"):
  // the snippet puts one back after sentence punctuation for reading.
  function spaced(s) { return squash(s).replace(/([.!?;:\u00b7\u00bb\u201d])(?=[A-Za-z\u0370-\u03ff\u1f00-\u1fff\u0400-\u04ff])/g, "$1 "); }
  function snippet(text, o, len, room) {
    room = room || 40;
    var a = Math.max(0, o - room), b = Math.min(text.length, o + len + room);
    var post = spaced(text.slice(o + len, b));
    if (/^[.!?;:\u00b7\u00bb\u201d]$/.test(text.charAt(o + len - 1)) && /^[^\s]/.test(post)) post = " " + post;
    return {
      pre: (a > 0 ? "…" : "") + spaced(text.slice(a, o)).replace(/^\s+/, ""),
      hit: squash(text.slice(o, o + len)),
      post: post.replace(/\s+$/, "") + (b < text.length ? "…" : "")
    };
  }
  // Where is a highlight's quote in this text? The stored offset first
  // (unchanged file), then every occurrence scored by its context and
  // by its distance to the old offset. → offset or -1.
  function reanchor(text, q, pre, suf, hint) {
    if (!q) return -1;
    text = String(text || "");
    if (hint >= 0 && text.substr(hint, q.length) === q) return hint;
    var best = -1, bestScore = -Infinity, i = text.indexOf(q);
    var n = 0;
    while (i >= 0 && n < 500) {
      var score = 0;
      if (pre && text.slice(Math.max(0, i - pre.length), i) === pre) score += 2;
      if (suf && text.substr(i + q.length, suf.length) === suf) score += 2;
      if (hint >= 0) score -= Math.min(1, Math.abs(i - hint) / Math.max(1, text.length));
      if (score > bestScore) { bestScore = score; best = i; }
      i = text.indexOf(q, i + 1);
      n++;
    }
    return best;
  }
  function contextOf(text, o, end) {
    return { q: text.slice(o, end).slice(0, QUOTE_LEN),
             pre: text.slice(Math.max(0, o - CTX_LEN), o),
             suf: text.slice(end, end + CTX_LEN) };
  }

  // ---------- 6. XML + EPUB packaging ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };
  function decodeEnt(s) {
    return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (all, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
      }
      var k = e.toLowerCase();
      return HAS.call(ENT, k) ? ENT[k] : all;
    });
  }
  // Tolerant XML → { n (name), l (local name, lower case), a {attrs},
  // c [children: nodes or strings] }. Never throws; unknown or broken
  // markup is skipped. For the packaging files of an EPUB (container,
  // OPF, NCX, nav) and FB2 books; what it reads is never shown as
  // markup: fb2Book escapes it and sanitize.js cleans the result.
  function xmlParse(src) {
    src = String(src || "");
    if (src.length > 8 * 1024 * 1024) src = src.slice(0, 8 * 1024 * 1024);
    var rootNode = { n: "#root", l: "#root", a: {}, c: [] }, stack = [rootNode], i = 0, L = src.length;
    var nodes = 0;
    function top() { return stack[stack.length - 1]; }
    while (i < L) {
      var lt = src.indexOf("<", i);
      if (lt < 0) lt = L;
      if (lt > i) top().c.push(decodeEnt(src.slice(i, lt)));
      if (lt >= L) break;
      if (src.startsWith("<!--", lt)) { var ce = src.indexOf("-->", lt + 4); i = ce < 0 ? L : ce + 3; continue; }
      if (src.startsWith("<![CDATA[", lt)) {
        var cd = src.indexOf("]]>", lt + 9);
        top().c.push(src.slice(lt + 9, cd < 0 ? L : cd));
        i = cd < 0 ? L : cd + 3; continue;
      }
      if (src.charAt(lt + 1) === "?" || src.charAt(lt + 1) === "!") {
        var de = src.indexOf(">", lt); i = de < 0 ? L : de + 1; continue;
      }
      var gt = lt + 1, quote = null;
      while (gt < L) {
        var ch = src.charAt(gt);
        if (quote) { if (ch === quote) quote = null; }
        else if (ch === "\"" || ch === "'") quote = ch;
        else if (ch === ">") break;
        gt++;
      }
      if (gt >= L) break;
      var body = src.slice(lt + 1, gt);
      i = gt + 1;
      if (body.charAt(0) === "/") {
        var cn = body.slice(1).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].n.toLowerCase() === cn) { stack.length = k; break; }
        }
        continue;
      }
      var self = /\/\s*$/.test(body);
      if (self) body = body.replace(/\/\s*$/, "");
      var nm = /^([^\s\/>]+)/.exec(body);
      if (!nm) continue;
      if (++nodes > 200000) break;
      var name = nm[1];
      var node = { n: name, l: name.replace(/^.*:/, "").toLowerCase(), a: {}, c: [] };
      var re = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g, am;
      var rest = body.slice(name.length);
      while ((am = re.exec(rest))) {
        var an = am[1];
        if (!HAS.call(node.a, an)) node.a[an] = decodeEnt(am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[5]);
      }
      top().c.push(node);
      if (!self) stack.push(node);
    }
    return rootNode;
  }
  function kids(node, local) {
    return (node && node.c || []).filter(function (c) { return typeof c === "object" && (!local || c.l === local); });
  }
  function find(node, local) {      // first descendant, document order
    var st = [node];
    while (st.length) {
      var n = st.shift();
      if (n !== node && n.l === local) return n;
      var k = kids(n);
      for (var i = k.length - 1; i >= 0; i--) st.unshift(k[i]);
    }
    return null;
  }
  function findAllNodes(node, local) {
    var out = [];
    (function walk(n) { kids(n).forEach(function (c) { if (c.l === local) out.push(c); walk(c); }); })(node);
    return out;
  }
  function textOf(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    return node.c.map(textOf).join("");
  }
  function attr(node, local) {      // attribute by local name (any prefix)
    if (!node) return "";
    if (HAS.call(node.a, local)) return node.a[local];
    var keys = Object.keys(node.a);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].replace(/^.*:/, "").toLowerCase() === local) return node.a[keys[i]];
    }
    return "";
  }

  // Path of "href" relative to the file "base" (both inside the ZIP).
  // → { path, frag } or null (absolute URLs, escapes above the root).
  function resolvePath(base, href) {
    href = String(href || "").trim();
    if (!href) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) return null;
    var frag = "", h = href.indexOf("#");
    if (h >= 0) { frag = href.slice(h + 1); href = href.slice(0, h); }
    var q = href.indexOf("?");
    if (q >= 0) href = href.slice(0, q);
    try { href = decodeURIComponent(href); } catch (e) { /* keep raw */ }
    try { frag = decodeURIComponent(frag); } catch (e) { /* keep raw */ }
    var parts;
    if (!href) {
      return { path: String(base || ""), frag: frag };
    }
    if (href.charAt(0) === "/") parts = [];
    else { parts = String(base || "").split("/"); parts.pop(); }
    var segs = href.replace(/^\/+/, "").split("/");
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === "" || s === ".") continue;
      if (s === "..") { if (!parts.length) return null; parts.pop(); continue; }
      parts.push(s);
    }
    return parts.length ? { path: parts.join("/"), frag: frag } : null;
  }

  function parseContainer(xml) {
    var r = xmlParse(xml);
    var rf = findAllNodes(r, "rootfile");
    for (var i = 0; i < rf.length; i++) {
      var mt = String(rf[i].a["media-type"] || "");
      var p = rf[i].a["full-path"];
      if (p && (!mt || mt === "application/oebps-package+xml")) return String(p).replace(/^\/+/, "");
    }
    return null;
  }

  function cleanText(s, max) {
    s = String(s || "").replace(/<[^>]*>/g, " ");
    s = decodeEnt(s).replace(/\s+/g, " ").trim();
    return max && s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  // → { meta: { title, by, lang, publisher, year, desc, ident },
  //     items: { id: { path, type, props } }, spine: [{ id, path, type, linear }],
  //     navPath, ncxPath, coverPath, dir: "ltr"|"rtl" }
  function parseOpf(xml, opfPath) {
    var r = xmlParse(xml);
    var pkg = find(r, "package") || r;
    var md = find(pkg, "metadata") || pkg;
    function dc(local) { return kids(md, local).concat(kids(find(md, "dc-metadata") || {}, local)); }
    var meta = {};
    var titles = dc("title");
    meta.title = cleanText(textOf(titles[0]), TITLE_LEN);
    var creators = dc("creator").map(function (c) { return cleanText(textOf(c), BY_LEN); }).filter(Boolean);
    meta.by = str(creators.slice(0, 4).join(", "), BY_LEN);
    meta.lang = cleanText(textOf(dc("language")[0]), 20);
    meta.publisher = cleanText(textOf(dc("publisher")[0]), 200);
    var dt = /\b(\d{4})\b/.exec(cleanText(textOf(dc("date")[0]), 40));
    if (dt && +dt[1] > 0) meta.year = +dt[1];
    meta.desc = cleanText(textOf(dc("description")[0]), 2000);
    meta.ident = cleanText(textOf(dc("identifier")[0]), 200);
    var items = {}, byPath = {};
    var man = find(pkg, "manifest");
    kids(man, "item").forEach(function (it) {
      var id = it.a.id, rp = resolvePath(opfPath, it.a.href);
      if (!id || !rp || HAS.call(items, id)) return;
      items[id] = { path: rp.path, type: String(it.a["media-type"] || "").toLowerCase(), props: String(it.a.properties || "") };
      byPath[rp.path] = id;
    });
    var spineNode = find(pkg, "spine");
    var spine = [];
    kids(spineNode, "itemref").forEach(function (ir) {
      var it = items[ir.a.idref];
      if (!it) return;
      if (!/(x?html|xml)/.test(it.type) && !/\.x?html?$/i.test(it.path)) return;
      spine.push({ id: ir.a.idref, path: it.path, type: it.type, linear: String(ir.a.linear || "yes").toLowerCase() !== "no" });
    });
    var navPath = null, ncxPath = null, coverPath = null;
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!navPath && /(^|\s)nav(\s|$)/.test(it.props)) navPath = it.path;
      if (!coverPath && /(^|\s)cover-image(\s|$)/.test(it.props)) coverPath = it.path;
    });
    var tocId = spineNode && spineNode.a.toc;
    if (tocId && items[tocId]) ncxPath = items[tocId].path;
    if (!ncxPath) Object.keys(items).forEach(function (id) { if (!ncxPath && items[id].type === "application/x-dtbncx+xml") ncxPath = items[id].path; });
    if (!coverPath) {
      kids(md, "meta").forEach(function (m) {
        if (coverPath || String(m.a.name || "").toLowerCase() !== "cover") return;
        var it = items[m.a.content];
        if (it && /^image\//.test(it.type)) coverPath = it.path;
      });
    }
    if (!coverPath) {
      Object.keys(items).forEach(function (id) {
        var it = items[id];
        if (!coverPath && /^image\//.test(it.type) && /cover/i.test(id + " " + it.path)) coverPath = it.path;
      });
    }
    var dir = String(spineNode && spineNode.a["page-progression-direction"] || "").toLowerCase() === "rtl" ? "rtl" : "ltr";
    return { meta: meta, items: items, byPath: byPath, spine: spine, navPath: navPath, ncxPath: ncxPath, coverPath: coverPath, dir: dir };
  }

  // TOC entries: [{ t (title), path, frag, d (depth 0…) }], max 3000.
  function parseNav(xhtml, navPath) {
    var r = xmlParse(xhtml);
    var navs = findAllNodes(r, "nav"), nav = null;
    navs.forEach(function (n) { if (!nav && /(^|\s)toc(\s|$)/.test(attr(n, "type"))) nav = n; });
    nav = nav || navs[0];
    var out = [];
    if (!nav) return out;
    (function walkList(list, d) {
      kids(list, "li").forEach(function (li) {
        if (out.length >= 3000) return;
        var a = kids(li, "a")[0] || kids(li, "span")[0];
        var t = cleanText(textOf(a), 200);
        var rp = a && a.l === "a" ? resolvePath(navPath, a.a.href) : null;
        if (t) out.push({ t: t, path: rp ? rp.path : "", frag: rp ? rp.frag : "", d: Math.min(d, 6) });
        kids(li, "ol").concat(kids(li, "ul")).forEach(function (sub) { walkList(sub, d + 1); });
      });
    })(kids(nav, "ol")[0] || kids(nav, "ul")[0] || nav, 0);
    return out;
  }
  function parseNcx(xml, ncxPath) {
    var r = xmlParse(xml);
    var map = find(r, "navmap");
    var out = [];
    if (!map) return out;
    (function walk(node, d) {
      kids(node, "navpoint").forEach(function (np) {
        if (out.length >= 3000) return;
        var t = cleanText(textOf(find(find(np, "navlabel") || np, "text")), 200);
        var c = kids(np, "content")[0];
        var rp = c ? resolvePath(ncxPath, c.a.src) : null;
        if (t) out.push({ t: t, path: rp ? rp.path : "", frag: rp ? rp.frag : "", d: Math.min(d, 6) });
        walk(np, d + 1);
      });
    })(map, 0);
    return out;
  }

  // ---------- 7. Views ----------
  function liveBooks(state) { return (state && state.books) || []; }
  function progressOf(state, id) {
    var p = state && state.pos && state.pos[id];
    return p ? p.pct : 0;
  }
  // filter: all | epub | pdf | fb2 | cbz | unread | reading | done
  function viewBooks(state, opts) {
    opts = opts || {};
    var q = fold(opts.q || "").trim();
    var list = liveBooks(state).filter(function (b) {
      var pct = progressOf(state, b.id);
      switch (opts.filter) {
        case "epub": case "pdf": if (b.fmt !== opts.filter || b.kind) return false; break;
        case "fb2": case "cbz": if (b.kind !== opts.filter) return false; break;
        case "unread": if (pct > 0 || b.fin) return false; break;
        case "reading": if (!(pct > 0) || b.fin) return false; break;
        case "done": if (!b.fin) return false; break;
      }
      if (q) {
        var hay = fold([b.title, b.by || "", (b.tags || []).join(" "), b.year || ""].join(" "));
        var words = q.split(/\s+/);
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    function lastRead(b) { var p = state.pos && state.pos[b.id]; return Math.max(p ? p.m : 0, b.added || 0); }
    var sort = opts.sort || "recent";
    list.sort(function (a, b) {
      var d = 0;
      if (sort === "title") d = cmpStr(fold(a.title), fold(b.title));
      else if (sort === "author") d = cmpStr(fold(a.by || "\uffff"), fold(b.by || "\uffff")) || cmpStr(fold(a.title), fold(b.title));
      else if (sort === "progress") d = progressOf(state, b.id) - progressOf(state, a.id);
      else d = lastRead(b) - lastRead(a);
      return d || cmpStr(a.id, b.id);
    });
    return list;
  }
  // The last books opened (position stamp), unfinished first; max n.
  function continueList(state, n) {
    var pos = (state && state.pos) || {};
    return liveBooks(state).filter(function (b) { return pos[b.id] && !b.fin; })
      .sort(function (a, b) { return pos[b.id].m - pos[a.id].m || cmpStr(a.id, b.id); })
      .slice(0, n || 3);
  }
  var COLOR_NAMES = {
    en: ["Yellow", "Green", "Blue", "Pink"],
    el: ["Κίτρινο", "Πράσινο", "Μπλε", "Ροζ"]
  };
  // Markdown of a book's highlights, notes and bookmarks, in book order.
  function exportMarkdown(book, marks, lang, labels) {
    labels = labels || {};
    var el = lang === "el";
    var out = ["# " + (book.title || "?")];
    if (book.by) out.push("", "*" + book.by + "*");
    var hl = sortMarks(marks.filter(function (k) { return k.b === book.id; }));
    if (!hl.length) out.push("", el ? "Δεν υπάρχουν σημειώσεις." : "No highlights or notes.");
    var lastSec = null;
    hl.forEach(function (k) {
      var sec = labels[k.id] || k.lbl || "";
      if (sec && sec !== lastSec) { out.push("", "## " + sec); lastSec = sec; }
      if (k.k === "bm") {
        out.push("", (el ? "🔖 Σελιδοδείκτης" : "🔖 Bookmark") + (k.q ? ": " + squash(k.q).slice(0, 120) : ""));
      } else {
        var name = (COLOR_NAMES[el ? "el" : "en"][k.c || 0] || "");
        out.push("", "> " + squash(k.q || "").replace(/\n/g, " "), "", "*" + name + "*");
      }
      if (k.n) out.push("", k.n.trim());
    });
    return out.join("\n") + "\n";
  }
  // The same as plain text for a Notes page (Notes takes plain text,
  // max characters): author, then per section its label and the
  // highlights as "• «quote»" with the note under them. What does not
  // fit is counted in the last line. → { text, left }
  function notesPlain(book, marks, lang, max) {
    max = max || 20000;
    var el = lang === "el";
    var out = book.by ? [book.by] : [];
    var list = sortMarks(marks.filter(function (k) { return k.b === book.id && (k.k === "hl" || k.n); }));
    var lastSec = null, size = out.join("\n").length, left = 0;
    list.forEach(function (k, i) {
      if (left) { left++; return; }
      var lines = [];
      var sec = k.lbl || "";
      if (sec && sec !== lastSec) lines.push("", sec);
      lines.push("", k.k === "bm" ? "🔖 " + squash(k.q || "").trim().slice(0, 120)
        : "• " + (el ? "«" : "“") + squash(k.q || "").trim() + (el ? "»" : "”"));
      if (k.n) k.n.trim().split("\n").forEach(function (l) { lines.push("  " + l); });
      var add = lines.join("\n").length + 1;
      if (size + add > max - 120) { left = 1; return; }
      out = out.concat(lines);
      size += add;
      if (sec) lastSec = sec;
    });
    if (left) out.push("", el ? "… και " + left + " ακόμη: η «Εξαγωγή σημειώσεων» της Βιβλιοθήκης τα έχει όλα."
      : "… and " + left + " more: Library's “Export notes” has them all.");
    return { text: out.join("\n").replace(/^\n+/, ""), left: left };
  }
  function estPages(chars) { return Math.max(1, Math.round((chars || 0) / 1500)); }
  // EPUB page estimate from the chapters' file sizes (markup included:
  // about 2400 bytes per printed page of ~1500 characters).
  function estPagesBytes(bytes) { return Math.max(1, Math.min(100000, Math.round((bytes || 0) / 2400))); }

  // ---------- 8. Media Shelf link (BR-LIB-SHELF) ----------
  // Media Shelf data (oros-shelf-data) is only read here: the live item
  // linked to this book (`lib` field), else null.
  function shelfItemOf(shelfData, bookId) {
    if (!shelfData || typeof shelfData !== "object" || !BOOK_ID_RE.test(bookId)) return null;
    var tombs = shelfData.tombs && typeof shelfData.tombs === "object" ? shelfData.tombs : {};
    var hit = null;
    (Array.isArray(shelfData.items) ? shelfData.items : []).forEach(function (it) {
      if (!it || it.lib !== bookId || typeof it.id !== "string" || typeof it.m !== "number") return;
      if (typeof tombs[it.id] === "number" && tombs[it.id] >= it.m) return;
      if (!hit || it.m > hit.m) hit = it;
    });
    return hit ? hit.id : null;
  }
  // The deep-link target that adds the book to Media Shelf.
  function shelfTarget(book) {
    var b = { lib: book.id, title: book.title };
    if (book.by) b.by = book.by;
    if (book.year) b.year = book.year;
    if (book.pages) b.size = book.pages;
    return { addBook: b };
  }

  // ---------- 9. Read aloud ----------
  // The text of a section cut into short parts to speak one by one:
  // [{ a, b }] offsets in text. A part ends after . ! ? … (and ; in
  // Greek, its question mark) followed by a space or a block edge, at
  // a block edge (breaks: sorted offsets where a paragraph starts), or
  // at the last space before max characters. Parts with no letter or
  // digit are left out; spaces at both ends are trimmed.
  var SPEAK_MAX = 300;
  function speechParts(text, breaks, lang, max) {
    text = String(text || "");
    max = max || SPEAK_MAX;
    var ends = lang === "el" ? /[.!?…;;]/ : /[.!?…]/;
    var closers = /["'”’»)\]·]/;
    var brk = {};
    (breaks || []).forEach(function (o) { if (o > 0) brk[o] = 1; });
    var out = [], a = 0, lastSpace = -1;
    function push(x, y) {
      while (x < y && /\s/.test(text.charAt(x))) x++;
      while (y > x && /\s/.test(text.charAt(y - 1))) y--;
      if (y > x && /[0-9A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/.test(text.slice(x, y))) out.push({ a: x, b: y });
    }
    for (var i = 0; i < text.length; i++) {
      if (brk[i] && i > a) { push(a, i); a = i; lastSpace = -1; }
      var c = text.charAt(i);
      if (/\s/.test(c)) lastSpace = i;
      if (ends.test(c)) {
        var j = i + 1;
        while (j < text.length && (ends.test(text.charAt(j)) || closers.test(text.charAt(j)))) j++;
        if (j >= text.length || /\s/.test(text.charAt(j)) || brk[j]) {
          push(a, j); a = j; lastSpace = -1; i = j - 1;
          continue;
        }
      }
      if (i - a >= max) {
        var cut = lastSpace > a ? lastSpace : i;
        push(a, cut); a = cut; lastSpace = -1;
      }
    }
    if (a < text.length) push(a, text.length);
    return out;
  }
  // What the voice is given: line-end hyphens joined, spaces squashed.
  function speechText(s) {
    return String(s || "").replace(/(\S)[-­]\n(?=[a-zß-ÿά-ώἀ-῿])/g, "$1")
      .replace(/­/g, "").replace(/\s+/g, " ").trim();
  }
  // A book with no language: Greek when most of its letters are.
  function guessLang(text) {
    var s = String(text || "").slice(0, 4000);
    var gr = (s.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
    var lat = (s.match(/[A-Za-z]/g) || []).length;
    return gr > lat ? "el" : lat ? "en" : "";
  }

  // ---------- 10. Reading stats ----------
  // stats: { d: { "YYYY-MM-DD": { <device>: seconds } },
  //          b: { <book id>: { <device>: seconds } } }
  // Each device only adds to its own counter, so the merge takes the
  // larger number per day (or book) and device. Only the latest
  // STAT_DAYS days are kept.
  var STAT_DAYS = 400;
  var DEV_RE = /^[a-z0-9]{6,16}$/;
  function normCounters(src, max) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    Object.keys(src).sort(cmpStr).forEach(function (dev) {
      if (!DEV_RE.test(dev)) return;
      var v = src[dev];
      if (typeof v === "number" && isFinite(v) && v >= 1) out[dev] = Math.min(max, Math.floor(v));
    });
    return out;
  }
  function mergeStats(a, b) {
    var d = {}, bk = {};
    function into(target, src, keyRe, max) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        if (!keyRe.test(k)) return;
        var c = normCounters(src[k], max);
        if (!Object.keys(c).length) return;
        var t = target[k] || (target[k] = {});
        Object.keys(c).forEach(function (dev) { if (!(t[dev] >= c[dev])) t[dev] = c[dev]; });
      });
    }
    [a, b].forEach(function (s) {
      if (!s || typeof s !== "object") return;
      into(d, s.d, YMD_RE, 86400);
      into(bk, s.b, BOOK_ID_RE, 1e9);
    });
    function sorted(o, keys) {
      var r = {};
      keys.forEach(function (k) {
        var c = {};
        Object.keys(o[k]).sort(cmpStr).forEach(function (dev) { c[dev] = o[k][dev]; });
        r[k] = c;
      });
      return r;
    }
    var days = Object.keys(d).sort(cmpStr);
    if (days.length > STAT_DAYS) days = days.slice(days.length - STAT_DAYS);
    var books = Object.keys(bk).sort(cmpStr);
    if (books.length > MAX_BOOKS) books = books.slice(0, MAX_BOOKS);
    return { d: sorted(d, days), b: sorted(bk, books) };
  }
  function statsEmpty(s) { return !s || (!Object.keys(s.d || {}).length && !Object.keys(s.b || {}).length); }
  function sumOf(c) { var n = 0; Object.keys(c || {}).forEach(function (k) { n += c[k]; }); return n; }
  // Add seconds read today on this device (a new stats object).
  function addReading(stats, day, dev, bookId, secs) {
    var s = mergeStats(stats, null);
    secs = Math.floor(secs);
    if (!(secs >= 1) || !YMD_RE.test(day) || !DEV_RE.test(dev)) return s;
    var c = s.d[day] || (s.d[day] = {});
    c[dev] = Math.min(86400, (c[dev] || 0) + secs);
    if (BOOK_ID_RE.test(bookId)) {
      var cb = s.b[bookId] || (s.b[bookId] = {});
      cb[dev] = Math.min(1e9, (cb[dev] || 0) + secs);
    }
    return mergeStats(s, null);
  }
  function ymdOf(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function dayBefore(ymd, n) {
    var p = ymd.split("-");
    return ymdOf(new Date(+p[0], +p[1] - 1, +p[2] - (n === undefined ? 1 : n), 12));
  }
  // Totals for the stats screen. A day counts towards the streak with
  // at least a minute read; today not read yet does not break it.
  function statsSummary(stats, today, nDays) {
    var d = (stats && stats.d) || {};
    var day = function (k) { return sumOf(d[k]); };
    var out = { today: day(today), week: 0, total: 0, streak: 0, best: 0, days: [] };
    for (var i = 0; i < 7; i++) out.week += day(dayBefore(today, i));
    Object.keys(d).forEach(function (k) { out.total += sumOf(d[k]); });
    var k = day(today) >= 60 ? today : dayBefore(today, 1);
    while (day(k) >= 60) { out.streak++; k = dayBefore(k, 1); }
    var run = 0, prev = null;
    Object.keys(d).sort(cmpStr).forEach(function (x) {
      if (day(x) < 60) return;
      run = prev && dayBefore(x, 1) === prev ? run + 1 : 1;
      prev = x;
      if (run > out.best) out.best = run;
    });
    for (var j = (nDays || 14) - 1; j >= 0; j--) { var y = dayBefore(today, j); out.days.push({ d: y, s: day(y) }); }
    return out;
  }
  function bookSeconds(stats, bookId) { return sumOf(stats && stats.b && stats.b[bookId]); }
  // Time left in a book from the time read so far and the progress
  // (per-mille); null until a twentieth of the book is read.
  function timeLeft(secs, pct) {
    if (!(secs > 0) || !(pct >= 50) || pct >= 1000) return null;
    return Math.round(secs * (1000 - pct) / pct);
  }

  // ---------- 11. Today line (library/today.js) ----------
  // The book you're reading (opened in the last 14 days, not finished)
  // with its progress, today's reading time and the streak. → { book,
  // title } or null.
  var TODAY_WORDS = {
    en: { reading: "Reading “{t}” · {p}%", today: "{m} min today", streak: "{n} days in a row" },
    el: { reading: "Διαβάζεις «{t}» · {p}%", today: "{m} λεπ. σήμερα", streak: "{n} μέρες στη σειρά" }
  };
  function todayLine(state, today, nowMs, lang) {
    var b = continueList(state, 1)[0];
    if (!b) return null;
    var p = state.pos[b.id];
    if (!(nowMs - p.m < 14 * 86400000)) return null;
    var W = TODAY_WORDS[lang === "el" ? "el" : "en"];
    var title = b.title.length > 80 ? b.title.slice(0, 79) + "…" : b.title;
    var parts = [W.reading.replace("{t}", title).replace("{p}", Math.floor(p.pct / 10))];
    var sum = statsSummary(state.stats, today, 1);
    if (sum.today >= 60) parts.push(W.today.replace("{m}", Math.round(sum.today / 60)));
    if (sum.streak >= 2) parts.push(W.streak.replace("{n}", sum.streak));
    return { book: b.id, title: parts.join(" · ") };
  }

  // ---------- 12. FB2 and CBZ as a book in memory ----------
  // FB2 (FictionBook XML) and CBZ (a ZIP of pictures) are turned into
  // the files of a small EPUB: container.xml, content.opf, nav.xhtml,
  // one XHTML file per chapter (or per picture), a stylesheet and the
  // pictures. The EPUB engine then reads them like any book, through
  // the same sanitizer (sanitize.js): nothing here is trusted markup,
  // every text and attribute is escaped on the way out.
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function xhtml(title, lang, body, bodyClass) {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"" +
      (lang ? " xml:lang=\"" + esc(lang) + "\" lang=\"" + esc(lang) + "\"" : "") + "><head><title>" + esc(title || "") +
      "</title><link rel=\"stylesheet\" type=\"text/css\" href=\"book.css\"/></head><body" +
      (bodyClass ? " class=\"" + esc(bodyClass) + "\"" : "") + ">" + body + "</body></html>";
  }
  var CONTAINER = "<?xml version=\"1.0\"?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">" +
    "<rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>";
  // files: { name: string | Uint8Array }, chapters [{ file, title }],
  // images [{ file, type, cover? }], meta { title, by, lang, year, desc }
  function packBook(meta, chapters, images, css) {
    var files = {};
    files["META-INF/container.xml"] = CONTAINER;
    var man = "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>" +
      "<item id=\"css\" href=\"book.css\" media-type=\"text/css\"/>";
    var spine = "";
    chapters.forEach(function (c, i) {
      man += "<item id=\"c" + i + "\" href=\"" + esc(c.file) + "\" media-type=\"application/xhtml+xml\"/>";
      spine += "<itemref idref=\"c" + i + "\"/>";
    });
    images.forEach(function (im, i) {
      man += "<item id=\"i" + i + "\" href=\"" + esc(im.file) + "\" media-type=\"" + esc(im.type) + "\"" + (im.cover ? " properties=\"cover-image\"" : "") + "/>";
    });
    var md = "<dc:title>" + esc(meta.title || "") + "</dc:title>" +
      (meta.by ? "<dc:creator>" + esc(meta.by) + "</dc:creator>" : "") +
      (meta.lang ? "<dc:language>" + esc(meta.lang) + "</dc:language>" : "") +
      (meta.year ? "<dc:date>" + esc(meta.year) + "</dc:date>" : "") +
      (meta.desc ? "<dc:description>" + esc(meta.desc) + "</dc:description>" : "");
    files["OEBPS/content.opf"] = "<?xml version=\"1.0\" encoding=\"utf-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\">" +
      "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">" + md + "</metadata><manifest>" + man + "</manifest><spine>" + spine + "</spine></package>";
    var nav = "";
    chapters.forEach(function (c) { if (c.title) nav += "<li><a href=\"" + esc(c.file) + "\">" + esc(c.title) + "</a></li>"; });
    files["OEBPS/nav.xhtml"] = xhtml(meta.title, meta.lang, "<nav epub:type=\"toc\"><ol>" + nav + "</ol></nav>");
    files["OEBPS/book.css"] = css || "";
    chapters.forEach(function (c) { files["OEBPS/" + c.file] = c.html; });
    images.forEach(function (im) { files["OEBPS/" + im.file] = im.data; });
    return files;
  }

  // FB2 → { meta, files } or null. src is the decoded XML text (see
  // fb2Encoding); pictures come base64 in <binary> and are handed back
  // as { file, type, b64 } for the caller to decode (data: never used).
  var FB2_CSS = ".epigraph{margin:1em 0 1em 25%;font-style:italic}.author{text-align:right;font-style:italic}" +
    ".poem{margin:1em 0 1em 2em}.stanza{margin-bottom:1em}.stanza p{margin:0;text-indent:0}" +
    ".subtitle{text-align:center;font-weight:bold}.fb2-img{text-align:center;text-indent:0}" +
    "section.note{margin-bottom:1em}h1,h2,h3,h4{text-align:center}";
  var IMG_TYPES = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
  function fb2Encoding(head) {
    var m = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9_.:-]{2,40})["']/.exec(String(head || ""));
    return m ? m[1].toLowerCase() : "utf-8";
  }
  function fb2Book(src) {
    src = String(src || "");
    var bins = [], nb = 0;
    // pictures out first: they are most of a big file
    src = src.replace(/<binary\b([^>]*)>([\s\S]*?)<\/binary\s*>/gi, function (all, attrs, data) {
      var id = /\bid\s*=\s*["']([^"']{1,200})["']/.exec(attrs), ct = /content-type\s*=\s*["']([^"']{1,60})["']/i.exec(attrs);
      var ext = ct && IMG_TYPES[ct[1].toLowerCase()];
      if (id && ext && nb < 2000) bins.push({ id: id[1], file: "img/p" + (nb++) + "." + ext, type: ct[1].toLowerCase() === "image/jpg" ? "image/jpeg" : ct[1].toLowerCase(), b64: data.replace(/\s+/g, "") });
      return "";
    });
    var doc = xmlParse(src);
    var fb = find(doc, "fictionbook");
    if (!fb) return null;
    var desc = find(fb, "description") || { c: [] };
    var ti = find(desc, "title-info") || { c: [] };
    function names(n) {
      return [attr(n, "x") || "", textOf(find(n, "first-name")), textOf(find(n, "middle-name")), textOf(find(n, "last-name"))]
        .map(function (x) { return cleanText(x, 60); }).filter(Boolean).join(" ") || cleanText(textOf(find(n, "nickname")), 60);
    }
    var meta = {
      title: cleanText(textOf(find(ti, "book-title")), TITLE_LEN),
      by: kids(ti, "author").map(names).filter(Boolean).join(", ").slice(0, BY_LEN),
      lang: cleanText(textOf(find(ti, "lang")), 20),
      year: "",
      desc: cleanText(textOf(find(ti, "annotation")), 2000)
    };
    if (meta.lang && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(meta.lang)) meta.lang = "";
    var ym = /(\d{4})/.exec(textOf(find(ti, "date")) + " " + attr(find(ti, "date"), "value"));
    if (ym) meta.year = ym[1];
    var binById = {};
    bins.forEach(function (b) { binById[b.id] = b; });
    function imgFile(n) {
      var h = attr(n, "href");
      return h && h.charAt(0) === "#" && binById[h.slice(1)] ? binById[h.slice(1)].file : "";
    }
    var cov = find(ti, "coverpage"), covImg = cov ? find(cov, "image") : null;
    var coverFile = covImg ? imgFile(covImg) : "";
    bins.forEach(function (b) { if (b.file === coverFile) b.cover = true; });

    var bodies = kids(fb, "body");
    var main = bodies.filter(function (b) { return !/^(notes|comments|footnotes)$/i.test(attr(b, "name")); })[0] || bodies[0];
    var notes = bodies.filter(function (b) { return b !== main; });
    // ids → the chapter file that holds them (links between chapters)
    var where = {}, chapters = [];
    function inline(n, file) {
      if (typeof n === "string") return esc(n);
      var inner = function () { return n.c.map(function (c) { return inline(c, file); }).join(""); };
      switch (n.l) {
        case "emphasis": return "<em>" + inner() + "</em>";
        case "strong": return "<strong>" + inner() + "</strong>";
        case "strikethrough": return "<s>" + inner() + "</s>";
        case "sub": case "sup": case "code": return "<" + n.l + ">" + inner() + "</" + n.l + ">";
        case "style": return "<span>" + inner() + "</span>";
        case "image": var f = imgFile(n); return f ? "<img src=\"" + esc(f) + "\" alt=\"\"/>" : "";
        case "a":
          var h = attr(n, "href");
          if (!h) return inner();
          if (h.charAt(0) === "#") {
            var tgt = h.slice(1), note = attr(n, "type") === "note";
            return "<a href=\"" + esc((where[tgt] || "notes.xhtml") + "#" + tgt) + "\"" + (note ? " epub:type=\"noteref\"" : "") + ">" + inner() + "</a>";
          }
          return /^https?:\/\//i.test(h) ? "<a href=\"" + esc(h) + "\">" + inner() + "</a>" : inner();
        default: return inner();
      }
    }
    function idAttr(n) { var id = attr(n, "id"); return id ? " id=\"" + esc(id) + "\"" : ""; }
    function block(n, depth, file) {
      if (typeof n === "string") return n.trim() ? "<p>" + esc(n) + "</p>" : "";
      var all = function (d) { return n.c.map(function (c) { return block(c, d, file); }).join(""); };
      switch (n.l) {
        case "section": return "<section" + idAttr(n) + ">" + all(depth + 1) + "</section>";
        case "title":
          var hl = "h" + Math.min(4, depth + 1);
          return "<" + hl + idAttr(n) + ">" + kids(n, "p").map(function (p) { return inline(p, file); }).join("<br/>") + "</" + hl + ">";
        case "subtitle": return "<p class=\"subtitle\"" + idAttr(n) + ">" + inline(n, file) + "</p>";
        case "p": return "<p" + idAttr(n) + ">" + inline(n, file) + "</p>";
        case "v": return "<p" + idAttr(n) + ">" + inline(n, file) + "</p>";
        case "empty-line": return "<br/>";
        case "epigraph": return "<blockquote class=\"epigraph\"" + idAttr(n) + ">" + all(depth) + "</blockquote>";
        case "cite": return "<blockquote" + idAttr(n) + ">" + all(depth) + "</blockquote>";
        case "text-author": return "<p class=\"author\">" + inline(n, file) + "</p>";
        case "poem": return "<div class=\"poem\"" + idAttr(n) + ">" + all(depth) + "</div>";
        case "stanza": return "<div class=\"stanza\">" + all(depth) + "</div>";
        case "date": return "<p class=\"author\">" + inline(n, file) + "</p>";
        case "image": var f = imgFile(n); return f ? "<p class=\"fb2-img\"" + idAttr(n) + "><img src=\"" + esc(f) + "\" alt=\"\"/></p>" : "";
        case "table": case "tr": case "td": case "th":
          return "<" + n.l + ">" + (n.l === "td" || n.l === "th" ? inline(n, file) : all(depth)) + "</" + n.l + ">";
        case "annotation": return "<div>" + all(depth) + "</div>";
        default: return all(depth);
      }
    }
    // the chapters: what comes before the first section, then one
    // file per top-level section
    var head = [], secs = [];
    (main ? main.c : []).forEach(function (c) { if (typeof c === "object" && c.l === "section") secs.push(c); else if (typeof c === "object") head.push(c); });
    var plan = [];
    if (head.length) plan.push({ nodes: head, title: "" });
    secs.forEach(function (sct) { plan.push({ nodes: [sct], title: cleanText(textOf(find(sct, "title")), 200) }); });
    if (!plan.length) plan.push({ nodes: [], title: "" });
    plan.forEach(function (pl, i) { pl.file = "c" + i + ".xhtml"; });
    var notesFile = "notes.xhtml";
    // first pass: where each id lives
    plan.forEach(function (pl) {
      pl.nodes.forEach(function (n) { (function walk(x) { if (typeof x !== "object") return; var id = attr(x, "id"); if (id && !where[id]) where[id] = pl.file; x.c.forEach(walk); })(n); });
    });
    notes.forEach(function (b) { (function walk(x) { if (typeof x !== "object") return; var id = attr(x, "id"); if (id && !where[id]) where[id] = notesFile; x.c.forEach(walk); })(b); });
    plan.forEach(function (pl, i) {
      var body = pl.nodes.map(function (n) { return block(n, n.l === "section" ? 0 : 0, pl.file); }).join("");
      if (i === 0 && !pl.title && !body.replace(/<[^>]*>/g, "").trim() && !/<img/.test(body)) body = "<h1>" + esc(meta.title || "") + "</h1>";
      chapters.push({ file: pl.file, title: pl.title || (i === 0 ? meta.title : ""), html: xhtml(pl.title || meta.title, meta.lang, body) });
    });
    if (notes.length) {
      var nbody = notes.map(function (b) {
        return b.c.map(function (c) {
          if (typeof c !== "object") return "";
          if (c.l === "section") return "<section class=\"note\" epub:type=\"footnote\"" + idAttr(c) + ">" + c.c.map(function (x) { return block(x, 2, notesFile); }).join("\n") + "</section>";
          return block(c, 1, notesFile);
        }).join("");
      }).join("");
      var nt = cleanText(textOf(find(notes[0], "title")), 200) || "Notes";
      chapters.push({ file: notesFile, title: nt, html: xhtml(nt, meta.lang, nbody) });
    }
    return { meta: meta, chapters: chapters, images: bins, css: FB2_CSS };
  }

  // CBZ: the pictures in natural order ("page 2" before "page 10"),
  // ComicInfo.xml for the details when there is one.
  function natCmp(a, b) {
    var x = String(a).toLowerCase().split(/(\d+)/), y = String(b).toLowerCase().split(/(\d+)/);
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (i % 2) return (+x[i] - +y[i]) || (x[i].length - y[i].length);
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }
  var CBZ_IMG = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
  function cbzPages(names) {
    return (names || []).filter(function (n) {
      return CBZ_IMG[extOf(n)] && !/(^|\/)(__macosx|\.)/i.test(n);
    }).sort(natCmp);
  }
  function comicInfo(xml) {
    var d = xmlParse(xml), ci = find(d, "comicinfo");
    if (!ci) return {};
    function f(k) { return cleanText(textOf(find(ci, k)), 200); }
    var title = f("title"), series = f("series"), num = f("number");
    var t = series ? series + (num ? " #" + num : "") + (title && title !== series ? ": " + title : "") : title;
    var by = [f("writer"), f("penciller")].filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ");
    var lang = f("languageiso");
    return { title: t.slice(0, TITLE_LEN), by: by.slice(0, BY_LEN), year: /^\d{4}$/.test(f("year")) ? f("year") : "",
             lang: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : "", desc: f("summary") };
  }
  var CBZ_CSS = ".comic{margin:0;text-align:center;text-indent:0}.comic img{display:block;margin:0 auto}";
  // → { meta, chapters, images } with pictures { file, type, src } (src
  // = the name inside the CBZ, read by the caller).
  function cbzBook(names, info, fallbackTitle) {
    var pages = cbzPages(names);
    if (!pages.length) return null;
    var meta = { title: (info && info.title) || fallbackTitle || "", by: info && info.by || "", lang: info && info.lang || "",
                 year: info && info.year || "", desc: info && info.desc || "" };
    var images = pages.map(function (n, i) {
      return { file: "img/p" + i + "." + extOf(n), type: CBZ_IMG[extOf(n)], src: n, cover: i === 0 };
    });
    var chapters = images.map(function (im, i) {
      return { file: "p" + i + ".xhtml", title: "", html: xhtml(meta.title, meta.lang, "<p class=\"comic\"><img src=\"" + esc(im.file) + "\" alt=\"\"/></p>", "comic") };
    });
    return { meta: meta, chapters: chapters, images: images, css: CBZ_CSS };
  }

  // ---------- 13. Dictionary (Wiktionary, opt-in) and the Assistant ----------
  // A selection that can be looked up: one to three words, without the
  // punctuation around them. → the word(s) or null.
  function dictWord(sel) {
    var w = squash(sel).trim().replace(/^[^0-9A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]+|[^0-9A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]+$/g, "");
    if (!w || w.length > 60 || w.split(" ").length > 3) return null;
    return w;
  }
  // The sentence(s) a selection [a, b) sits in (core.speechParts), at
  // most max characters: the context of a word for the Assistant.
  function sentenceAround(text, breaks, a, b, lang, max) {
    max = max || 600;
    var parts = speechParts(text, breaks, lang), out = [];
    parts.forEach(function (p) { if (p.b > a && p.a < Math.max(b, a + 1)) out.push(text.slice(p.a, p.b)); });
    var s = squash(out.join(" ")).trim();
    return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
  }
  function dictUrl(word) {
    return "https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(word.replace(/ /g, "_")) + "?redirect=true";
  }
  function dictPage(word, lang) {
    var host = lang === "el" ? "el" : "en";
    return "https://" + host + ".wiktionary.org/wiki/" + encodeURIComponent(word.replace(/ /g, "_"));
  }
  // Wiktionary's definitions come as HTML: only their text is kept.
  function htmlText(h) {
    return squash(decodeEnt(String(h || "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, ""))).trim();
  }
  // The REST answer { "<lang code>": [{ partOfSpeech, language,
  // definitions: [{ definition, examples }] }] } → [{ code, name,
  // items: [{ pos, defs: [{ d, ex }] }] }], the book's language first,
  // then English, then the rest; at most 3 languages, 8 meanings each.
  function dictParse(json, lang) {
    if (!json || typeof json !== "object") return [];
    var base = String(lang || "").toLowerCase().split("-")[0];
    var codes = Object.keys(json).filter(function (k) { return Array.isArray(json[k]); });
    codes.sort(function (a, b) {
      var ra = a === base ? 0 : a === "en" ? 1 : 2, rb = b === base ? 0 : b === "en" ? 1 : 2;
      return ra - rb || cmpStr(a, b);
    });
    var out = [];
    codes.slice(0, 3).forEach(function (code) {
      var items = [], name = "", n = 0;
      json[code].forEach(function (e) {
        if (!e || typeof e !== "object" || n >= 8) return;
        if (!name && typeof e.language === "string") name = cleanText(e.language, 40);
        var defs = [];
        (Array.isArray(e.definitions) ? e.definitions : []).forEach(function (d) {
          if (!d || n >= 8) return;
          var txt = htmlText(d.definition).slice(0, 400);
          if (!txt) return;
          var ex = Array.isArray(d.examples) && d.examples.length ? htmlText(d.examples[0]).slice(0, 300) : "";
          defs.push(ex ? { d: txt, ex: ex } : { d: txt });
          n++;
        });
        if (defs.length) items.push({ pos: cleanText(e.partOfSpeech, 40), defs: defs });
      });
      if (items.length) out.push({ code: code, name: name || code, items: items });
    });
    return out;
  }
  // The question handed to the Assistant (__orosOpenAt("assistant",
  // { ask })), at most 2000 characters; nothing is sent until you do.
  var ASK_WORDS = {
    en: { passage: "In the book “{t}”{by}, explain this passage to me: what it means and its context. Don't reveal anything from later in the book.",
          word: "In the book “{t}”{by}, what does “{w}” mean in this sentence?",
          book: "Tell me about the book “{t}”{by}{y}: what it is about, its themes and its background. I've read {p}% of it, so no spoilers beyond that." },
    el: { passage: "Στο βιβλίο «{t}»{by}, εξήγησέ μου αυτό το απόσπασμα: τι σημαίνει και ποιο είναι το πλαίσιό του. Μη μου αποκαλύψεις τίποτα από τη συνέχεια του βιβλίου.",
          word: "Στο βιβλίο «{t}»{by}, τι σημαίνει «{w}» σε αυτή την πρόταση;",
          book: "Πες μου για το βιβλίο «{t}»{by}: τι πραγματεύεται, τα θέματά του και το πλαίσιό του. Έχω διαβάσει το {p}%, οπότε χωρίς αποκαλύψεις πέρα από αυτό." }
  };
  function askText(kind, book, opts, lang) {
    opts = opts || {};
    var el = lang === "el", W = ASK_WORDS[el ? "el" : "en"];
    // Greek names can't be put in the genitive here: "(author, year)"
    var by = el ? (book.by || book.year ? " (" + [book.by, kind === "book" ? book.year : ""].filter(Boolean).join(", ") + ")" : "")
      : book.by ? " by " + book.by : "";
    var y = !el && book.year ? " (" + book.year + ")" : "";
    var head = W[kind].replace("{t}", book.title).replace("{by}", by).replace("{y}", y)
      .replace("{p}", Math.floor((opts.pct || 0) / 10)).replace("{w}", opts.word || "");
    var quote = squash(opts.quote || "").trim();
    if (!quote) return head.slice(0, 2000);
    var room = 2000 - head.length - 4;
    if (quote.length > room) quote = quote.slice(0, Math.max(0, room - 1)) + "…";
    return head + "\n\n" + (el ? "«" : "“") + quote + (el ? "»" : "”");
  }

  var api = {
    DATA_VER: DATA_VER, MAX_BOOKS: MAX_BOOKS, MAX_MARKS: MAX_MARKS, MAX_BYTES: MAX_BYTES, NCOLORS: NCOLORS,
    TITLE_LEN: TITLE_LEN, BY_LEN: BY_LEN, NOTE_LEN: NOTE_LEN, QUOTE_LEN: QUOTE_LEN, CTX_LEN: CTX_LEN,
    BOOK_ID_RE: BOOK_ID_RE, MARK_ID_RE: MARK_ID_RE, LOC_RE: LOC_RE,
    str: str, canon: canon, cmpStr: cmpStr, bookIdOf: bookIdOf, newMarkId: newMarkId, extOf: extOf,
    formatOf: formatOf, kindOf: kindOf, fmtLabel: fmtLabel, maxBytesOf: maxBytesOf, MAX_COMIC: MAX_COMIC, titleFromName: titleFromName, fold: fold, normTags: normTags, parseTags: parseTags,
    normBook: normBook, normPos: normPos, normMark: normMark, emptyState: emptyState, mergeLibrary: mergeLibrary,
    parseLoc: parseLoc, makeLoc: makeLoc, cmpLoc: cmpLoc, sortMarks: sortMarks,
    foldMap: foldMap, findAll: findAll, snippet: snippet, squash: squash, reanchor: reanchor, contextOf: contextOf,
    decodeEnt: decodeEnt, xmlParse: xmlParse, resolvePath: resolvePath, parseContainer: parseContainer,
    parseOpf: parseOpf, parseNav: parseNav, parseNcx: parseNcx, cleanText: cleanText,
    viewBooks: viewBooks, continueList: continueList, progressOf: progressOf, exportMarkdown: exportMarkdown, notesPlain: notesPlain,
    estPages: estPages, estPagesBytes: estPagesBytes, shelfItemOf: shelfItemOf, shelfTarget: shelfTarget,
    COLOR_NAMES: COLOR_NAMES,
    speechParts: speechParts, speechText: speechText, guessLang: guessLang,
    mergeStats: mergeStats, statsEmpty: statsEmpty, addReading: addReading, statsSummary: statsSummary,
    bookSeconds: bookSeconds, todayLine: todayLine,
    packBook: packBook, dictWord: dictWord, sentenceAround: sentenceAround, dictUrl: dictUrl, dictPage: dictPage, dictParse: dictParse, htmlText: htmlText, askText: askText, fb2Book: fb2Book, fb2Encoding: fb2Encoding, cbzBook: cbzBook, cbzPages: cbzPages, comicInfo: comicInfo, natCmp: natCmp, timeLeft: timeLeft, dayBefore: dayBefore, ymdOf: ymdOf, DEV_RE: DEV_RE
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LibCore = api;
})(typeof window !== "undefined" ? window : globalThis);
