// ============================================================
// orOS Library — pure core (v1.0.0)
// No DOM, no storage: testable under Node (tests/library.test.js).
//   1. Constants + small helpers (ids, text folding, clamps)
//   2. Model: normalize books, positions, marks (bookmarks and
//      highlights), the whole library state
//   3. Merge (sync slice "library"): books and marks LWW per id,
//      positions LWW per book, tombstones (R5, R17, R26, R27)
//   4. Locations ("loc") in a book: parse, compare, label
//   5. Text: accent-free search with a map back to the source,
//      re-anchoring a highlight by its quote, snippets
//   6. A small tolerant XML reader + EPUB packaging: container.xml,
//      the OPF package (metadata, manifest, spine, cover), the TOC
//      (EPUB 3 nav document or EPUB 2 NCX), paths inside the ZIP
//   7. Views: sorting / filtering the library, Markdown export
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
  function formatOf(name) {
    var e = extOf(name);
    return e === "epub" ? "epub" : e === "pdf" ? "pdf" : null;
  }
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
                    path: 1, size: 1, tags: 1, shelf: 1, added: 1, fin: 1 };
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
    return { ver: DATA_VER, books: books, pos: posOut, marks: marks, tombs: tombOut };
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
  // markup is skipped. Only for the small packaging files of an EPUB
  // (container, OPF, NCX, nav), never for content shown to a person.
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
  // filter: all | epub | pdf | unread | reading | done
  function viewBooks(state, opts) {
    opts = opts || {};
    var q = fold(opts.q || "").trim();
    var list = liveBooks(state).filter(function (b) {
      var pct = progressOf(state, b.id);
      switch (opts.filter) {
        case "epub": case "pdf": if (b.fmt !== opts.filter) return false; break;
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
  function estPages(chars) { return Math.max(1, Math.round((chars || 0) / 1500)); }

  var api = {
    DATA_VER: DATA_VER, MAX_BOOKS: MAX_BOOKS, MAX_MARKS: MAX_MARKS, MAX_BYTES: MAX_BYTES, NCOLORS: NCOLORS,
    TITLE_LEN: TITLE_LEN, BY_LEN: BY_LEN, NOTE_LEN: NOTE_LEN, QUOTE_LEN: QUOTE_LEN, CTX_LEN: CTX_LEN,
    BOOK_ID_RE: BOOK_ID_RE, MARK_ID_RE: MARK_ID_RE, LOC_RE: LOC_RE,
    str: str, canon: canon, cmpStr: cmpStr, bookIdOf: bookIdOf, newMarkId: newMarkId, extOf: extOf,
    formatOf: formatOf, titleFromName: titleFromName, fold: fold, normTags: normTags, parseTags: parseTags,
    normBook: normBook, normPos: normPos, normMark: normMark, emptyState: emptyState, mergeLibrary: mergeLibrary,
    parseLoc: parseLoc, makeLoc: makeLoc, cmpLoc: cmpLoc, sortMarks: sortMarks,
    foldMap: foldMap, findAll: findAll, snippet: snippet, squash: squash, reanchor: reanchor, contextOf: contextOf,
    decodeEnt: decodeEnt, xmlParse: xmlParse, resolvePath: resolvePath, parseContainer: parseContainer,
    parseOpf: parseOpf, parseNav: parseNav, parseNcx: parseNcx, cleanText: cleanText,
    viewBooks: viewBooks, continueList: continueList, progressOf: progressOf, exportMarkdown: exportMarkdown,
    estPages: estPages, COLOR_NAMES: COLOR_NAMES
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LibCore = api;
})(typeof window !== "undefined" ? window : globalThis);
