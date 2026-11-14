// ============================================================
// orOS Writer — cattm.js: translation memory for book translation
// (WR-CAT, wave T2). Pure: no DOM, no storage (catstore.js keeps the
// files). Tested in Node (tests/writer-cattm.test.js).
//   - units: one per source sentence and language pair,
//     key "<from>-<to>-<16 hex>" → [source, translation, stamp, deleted]
//     (source and translation keep the segment tags ⟦n⟧ ⟦/n⟧ ⟦n/⟧)
//   - files: units-<dev>-<bucket>.json, 32 buckets by key, each device
//     its own (merged on read: the newer stamp wins per unit)
//   - Index: exact and fuzzy matches (word edit distance, 70%+),
//     concordance (where a phrase was translated before)
//   - diff: the words that differ between two sources (for the screen)
//   - TMX 1.4b in and out (read as data with our own XML reader: no
//     DTD, no external entities, size caps; inline codes become tags)
// Exposes window.WriterCatTM (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var TAG_RX = /⟦(\/?)(\d{1,4})(\/?)⟧/g;
  var BUCKETS = 32, MAX_TEXT = 20000, MAX_UNITS = 300000, MIN_SCORE = 70, MAX_TOK = 200;
  var KEY_RX = /^([a-z]{2,3})-([a-z]{2,3})-([0-9a-f]{16})$/;
  var TM_RX = /^tm[a-z0-9]{6,30}$/;
  var DEV_RX = /^[a-z0-9]{6,32}$/;
  var WORD_RX = /[\p{L}\p{N}]+/gu, TOK_RX = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu, SHOW_RX = /\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

  function str(s) { return s === undefined || s === null ? "" : String(s); }
  function strip(s) { return str(s).replace(TAG_RX, ""); }
  function ws(s) { return str(s).replace(/\s+/g, " ").trim(); }
  function fold(s) { return str(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  // en-US → en (the memory works on base languages)
  function base(l) { var b = str(l).toLowerCase().split(/[-_]/)[0]; return /^[a-z]{2,3}$/.test(b) ? b : ""; }
  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function keyOf(from, to, src) {
    var f = base(from), t = base(to), s = ws(src);
    if (!f || !t || !s) return "";
    return f + "-" + t + "-" + fnv(s, 0x811c9dc5) + fnv(s, 0x050c5d1f);
  }
  function pairOf(key) { var m = KEY_RX.exec(str(key)); return m ? { from: m[1], to: m[2] } : null; }
  function bucketOf(key) { return parseInt(str(key).slice(-2), 16) % BUCKETS; }

  // ---------- units ----------
  // [source, translation, stamp, deleted 0|1]
  function cleanUnit(u) {
    if (!Array.isArray(u) || typeof u[0] !== "string" || typeof u[1] !== "string") return null;
    var m = Number(u[2]);
    if (!isFinite(m) || m <= 0 || Math.floor(m) !== m) return null;
    return [u[0].slice(0, MAX_TEXT), u[1].slice(0, MAX_TEXT), m, u[3] === 1 ? 1 : 0];
  }
  function newer(a, b) {
    if (!a) return b; if (!b) return a;
    if (a[2] !== b[2]) return a[2] > b[2] ? a : b;
    if (a[3] !== b[3]) return a[3] > b[3] ? a : b;
    return a[1] >= b[1] ? a : b;
  }
  // { key: unit } × many → one map (a join: any order, same result)
  function mergeUnits(list) {
    var out = {};
    (list || []).forEach(function (map) {
      if (!map || typeof map !== "object") return;
      Object.keys(map).forEach(function (k) {
        if (!KEY_RX.test(k)) return;
        var u = cleanUnit(map[k]);
        if (u) out[k] = newer(out[k], u);
      });
    });
    return out;
  }
  function unitsName(name) {
    var m = /^units-([a-z0-9]{6,32})-(\d{1,2})\.json$/.exec(str(name));
    return m && +m[2] < BUCKETS ? { dev: m[1], bucket: +m[2] } : null;
  }
  function unitsFile(dev, map) { return { v: 1, dev: dev, u: map }; }
  function readUnitsFile(obj, dev, bucket) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !obj.u || typeof obj.u !== "object") return {};
    var out = {};
    Object.keys(obj.u).forEach(function (k) {
      if (!KEY_RX.test(k) || bucketOf(k) !== bucket) return;
      var u = cleanUnit(obj.u[k]);
      if (u) out[k] = u;
    });
    return out;
  }
  function readTm(obj) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !TM_RX.test(str(obj.id))) return null;
    return { v: 1, id: obj.id, name: str(obj.name).slice(0, 200), at: Number(obj.at) > 0 ? Math.floor(obj.at) : 0 };
  }
  function newTmId(now, rnd) {
    return "tm" + Math.floor(now).toString(36) + Math.floor(rnd * 1e9).toString(36).padStart(6, "0").slice(0, 6);
  }
  // how many units a map holds (not deleted), per pair
  function count(map) {
    var out = { all: 0, pairs: {} };
    Object.keys(map || {}).forEach(function (k) {
      var u = map[k], p = pairOf(k);
      if (!u || u[3] || !p) return;
      out.all++;
      var pk = p.from + "-" + p.to;
      out.pairs[pk] = (out.pairs[pk] || 0) + 1;
    });
    return out;
  }

  // ---------- matching ----------
  function tokens(s) { return (strip(s).toLowerCase().match(TOK_RX) || []).slice(0, MAX_TOK); }
  function words(s) { return strip(s).toLowerCase().match(WORD_RX) || []; }
  function editDist(a, b) {
    var n = a.length, m = b.length;
    if (!n) return m; if (!m) return n;
    var prev = new Array(m + 1), cur = new Array(m + 1), i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur[0] = i;
      for (j = 1; j <= m; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      var x = prev; prev = cur; cur = x;
    }
    return prev[m];
  }
  // 0–100: 100 the same source (tags too), 99 the same words
  function score(a, b) {
    if (ws(a) === ws(b)) return 100;
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    var d = editDist(ta, tb);
    if (!d) return 99;
    return Math.max(0, Math.min(98, Math.floor(100 * (1 - d / Math.max(ta.length, tb.length)))));
  }

  // The units of one pair (from the merged maps of every memory) →
  // lookup(source) and concord(phrase).
  function Index(maps, from, to) {
    var f = base(from), t = base(to), pre = f + "-" + t + "-";
    var ents = [], exact = new Map(), inv = new Map();
    var all = {};
    (maps || []).forEach(function (map) {
      Object.keys(map || {}).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        var u = map[k];
        // a unit in two memories: the newer copy
        all[k] = newer(all[k], u);
      });
    });
    Object.keys(all).forEach(function (k) {
      var u = all[k];
      if (!u || u[3] || !u[1].trim()) return;
      var e = { key: k, src: u[0], tgt: u[1], m: u[2], fs: null, ft: null };
      var i = ents.length;
      ents.push(e);
      var ex = ws(u[0]), had = exact.get(ex);
      if (had === undefined || ents[had].m < u[2]) exact.set(ex, i);
      var seen = {};
      words(u[0]).forEach(function (w) {
        if (seen[w]) return;
        seen[w] = 1;
        var l = inv.get(w);
        if (!l) inv.set(w, l = []);
        l.push(i);
      });
    });
    this.size = ents.length;
    this.from = f;
    this.to = t;
    // → [{ key, src, tgt, score, m }], best first, one per translation
    this.lookup = function (src, opts) {
      opts = opts || {};
      var min = opts.min || MIN_SCORE, max = opts.max || 3, out = [], got = {};
      var ex = exact.get(ws(src));
      if (ex !== undefined) { var e0 = ents[ex]; out.push({ key: e0.key, src: e0.src, tgt: e0.tgt, score: 100, m: e0.m }); got[e0.tgt] = 1; }
      var qw = {}, q = words(src).filter(function (w) { if (qw[w]) return false; qw[w] = 1; return true; });
      if (q.length) {
        var hits = new Map(), common = 20000;
        q.forEach(function (w) {
          var l = inv.get(w);
          if (!l || (l.length > common && q.length > 2)) return;
          for (var k = 0; k < l.length; k++) hits.set(l[k], (hits.get(l[k]) || 0) + 1);
        });
        var need = Math.max(1, Math.floor(q.length * 0.5)), cand = [];
        hits.forEach(function (n, i) { if (n >= need && i !== ex) cand.push([i, n]); });
        cand.sort(function (a, b) { return b[1] - a[1] || ents[b[0]].m - ents[a[0]].m; });
        cand.slice(0, 80).forEach(function (c) {
          var e = ents[c[0]], sc = score(src, e.src);
          if (sc >= min) out.push({ key: e.key, src: e.src, tgt: e.tgt, score: sc, m: e.m });
        });
      }
      out.sort(function (a, b) { return b.score - a.score || b.m - a.m; });
      return out.filter(function (x) {
        if (x.score === 100) return true;
        if (got[x.tgt]) return false;
        got[x.tgt] = 1;
        return true;
      }).slice(0, max);
    };
    // where a phrase was translated before (source or translation, accents ignored)
    this.concord = function (phrase, opts) {
      var p = fold(ws(strip(phrase))), limit = (opts && opts.limit) || 50, out = [];
      if (p.length < 2) return out;
      for (var i = 0; i < ents.length; i++) {
        var e = ents[i];
        if (e.fs === null) { e.fs = fold(strip(e.src)); e.ft = fold(strip(e.tgt)); }
        if (e.fs.indexOf(p) >= 0 || e.ft.indexOf(p) >= 0) out.push({ key: e.key, src: e.src, tgt: e.tgt, m: e.m });
      }
      out.sort(function (a, b) { return b.m - a.m; });
      return out.slice(0, limit);
    };
  }

  // The words that differ: a (this segment's source) against b (the
  // memory's source) → [{ t, op }]: 0 both, -1 only in a, 1 only in b
  function diff(a, b) {
    var ta = strip(a).match(SHOW_RX) || [], tb = strip(b).match(SHOW_RX) || [];
    if (ta.length > 400 || tb.length > 400) return [{ t: strip(b), op: 0 }];
    var la = ta.map(function (x) { return /^\s+$/.test(x) ? " " : x.toLowerCase(); });
    var lb = tb.map(function (x) { return /^\s+$/.test(x) ? " " : x.toLowerCase(); });
    var n = ta.length, m = tb.length, L = [], i, j;
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = la[i] === lb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = [];
    function push(t, op) {
      var last = out[out.length - 1];
      if (last && last.op === op) last.t += t; else out.push({ t: t, op: op });
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (la[i] === lb[j]) { push(tb[j], 0); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push(ta[i], -1); i++; }
      else { push(tb[j], 1); j++; }
    }
    while (i < n) push(ta[i++], -1);
    while (j < m) push(tb[j++], 1);
    return out;
  }

  // ---------- TMX 1.4b ----------
  var MAX_TMX = 64 * 1024 * 1024, MAX_DEPTH = 64;
  function decode(s) {
    return str(s).replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos);/g, function (m, e) {
      if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "amp") return "&";
      if (e === "quot") return "\""; if (e === "apos") return "'";
      var n = e.charAt(1) === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : "";
    });
  }
  function attrs(s) {
    var out = {}, re = /([^\s=\/>"']+)\s*=\s*("([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (out[k] === undefined) out[k] = decode(m[3] !== undefined ? m[3] : m[4]);
    }
    return out;
  }
  // { n, a, c: [node | string] }; DTD and processing instructions are
  // skipped, only the five XML entities and numbers are decoded.
  function parseXml(s) {
    var rootNode = { n: "#root", a: {}, c: [] }, stack = [rootNode], i = 0, n = s.length;
    function top() { return stack[stack.length - 1]; }
    function text(t) { if (t) top().c.push(t); }
    while (i < n) {
      var lt = s.indexOf("<", i), e;
      if (lt < 0) { text(decode(s.slice(i))); break; }
      if (lt > i) text(decode(s.slice(i, lt)));
      if (s.startsWith("<!--", lt)) { e = s.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (s.startsWith("<![CDATA[", lt)) { e = s.indexOf("]]>", lt + 9); text(s.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue; }
      var c1 = s.charAt(lt + 1);
      if (c1 === "?") { e = s.indexOf("?>", lt); i = e < 0 ? n : e + 2; continue; }
      if (c1 === "!") {
        var j = lt + 2, depth = 0;
        while (j < n) { var ch = s[j]; if (ch === "[") depth++; else if (ch === "]") depth--; else if (ch === ">" && depth <= 0) break; j++; }
        i = j + 1;
        continue;
      }
      if (c1 === "/") {
        e = s.indexOf(">", lt);
        var cname = s.slice(lt + 2, e < 0 ? n : e).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) if (stack[k].n === cname) { stack.length = k; break; }
        i = e < 0 ? n : e + 1;
        continue;
      }
      var m = /^<([A-Za-z_][\w:.\-]*)/.exec(s.slice(lt, lt + 256));
      if (!m) { text("<"); i = lt + 1; continue; }
      var p = lt + m[0].length, q = "";
      while (p < n) {
        var cc = s[p];
        if (q) { if (cc === q) q = ""; } else if (cc === "\"" || cc === "'") q = cc; else if (cc === ">") break;
        p++;
      }
      var inner = s.slice(lt + m[0].length, p), self = /\/\s*$/.test(inner);
      var nd = { n: m[1].toLowerCase(), a: attrs(inner), c: [] };
      top().c.push(nd);
      if (!self && stack.length < MAX_DEPTH) stack.push(nd);
      i = p + 1;
    }
    return rootNode;
  }
  function kids(nd, name) { return (nd ? nd.c : []).filter(function (k) { return typeof k !== "string" && (!name || k.n === name); }); }
  function textOf(nd) { return (nd ? nd.c : []).map(function (k) { return typeof k === "string" ? k : textOf(k); }).join(""); }

  // A <seg> → our text with tags. ids: shared between the languages of
  // one <tu> (x, else i, else the place of a ph), numbered in the order
  // the source meets them.
  function segText(seg, num) {
    var out = "", iToId = {}, ph = 0;
    function id(raw) {
      if (num.map[raw] === undefined) num.map[raw] = ++num.n;
      return num.map[raw];
    }
    function walk(nd) {
      nd.c.forEach(function (k) {
        if (typeof k === "string") { out += k.replace(/[⟦⟧]/g, function (c) { return c === "⟦" ? "[" : "]"; }); return; }
        if (k.n === "bpt") {
          var raw = k.a.x ? "x" + k.a.x : "i" + k.a.i;
          iToId[k.a.i] = raw;
          out += "⟦" + id(raw) + "⟧";
        } else if (k.n === "ept") {
          var r2 = iToId[k.a.i];
          if (r2 !== undefined) out += "⟦/" + id(r2) + "⟧";
        } else if (k.n === "it" && (k.a.pos === "begin" || k.a.pos === "end")) {
          // one end of a pair whose other end is in another segment
          var r3 = k.a.x ? "x" + k.a.x : "t" + (++ph);
          out += k.a.pos === "begin" ? "\u27E6" + id(r3) + "\u27E7" : "\u27E6/" + id(r3) + "\u27E7";
        } else if (k.n === "ph" || k.n === "it" || k.n === "x") {
          ph++;
          out += "⟦" + id(k.a.x ? "x" + k.a.x : "p" + ph) + "/⟧";
        } else if (k.n === "hi" || k.n === "g") {
          walk(k);
        }
        // ut, sub (inside codes): native code, never text
      });
    }
    walk(seg);
    return out.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }
  function tuvLang(tuv) { return base(tuv.a["xml:lang"] || tuv.a.lang); }

  // → { srclang, units: [{ from, to, src, tgt, m }], total, skipped }
  function parseTmx(text, opts) {
    opts = opts || {};
    var s = str(text);
    if (s.length > MAX_TMX) return { err: "size", units: [], total: 0, skipped: 0 };
    var doc = parseXml(s), tmx = kids(doc, "tmx")[0];
    if (!tmx) return { err: "notmx", units: [], total: 0, skipped: 0 };
    var head = kids(tmx, "header")[0], body = kids(tmx, "body")[0];
    var sl = head ? str(head.a.srclang) : "", src = sl.toLowerCase() === "*all*" ? "" : base(sl);
    var units = [], total = 0, skipped = 0, now = opts.now || Date.now();
    kids(body, "tu").forEach(function (tu) {
      total++;
      var tuvs = kids(tu, "tuv").filter(function (v) { return tuvLang(v); });
      var from = src || (tuvs[0] ? tuvLang(tuvs[0]) : "");
      var sv = tuvs.filter(function (v) { return tuvLang(v) === from; })[0];
      if (!sv || units.length >= MAX_UNITS) { skipped++; return; }
      var num = { map: {}, n: 0 };
      var st = segText(kids(sv, "seg")[0] || { c: [] }, num);
      if (!st) { skipped++; return; }
      var m = tmxDate(tu.a.changedate) || tmxDate(tu.a.creationdate) || now, any = false;
      tuvs.forEach(function (v) {
        var to = tuvLang(v);
        if (v === sv || to === from) return;
        var tt = segText(kids(v, "seg")[0] || { c: [] }, { map: Object.assign({}, num.map), n: num.n });
        if (!tt) return;
        any = true;
        units.push({ from: from, to: to, src: st, tgt: tt, m: m });
      });
      if (!any) skipped++;
    });
    return { srclang: src, units: units, total: total, skipped: skipped };
  }
  function tmxDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(str(s));
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isFinite(t) && t > 0 ? t : 0;
  }
  function tmxDateOf(t) {
    var d = new Date(t), p = function (n) { return ("0" + n).slice(-2); };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  }
  function xesc(s) {
    return str(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // our text → <seg> content (pairs with both ends as bpt/ept, a lone
  // end as it, voids as ph)
  function segXml(text) {
    var toks = [], last = 0, m, s = str(text);
    TAG_RX.lastIndex = 0;
    while ((m = TAG_RX.exec(s))) {
      if (m.index > last) toks.push({ x: s.slice(last, m.index) });
      last = TAG_RX.lastIndex;
      var n = +m[2];
      toks.push(m[3] ? { v: n } : m[1] ? { c: n } : { o: n });
    }
    if (last < s.length) toks.push({ x: s.slice(last) });
    var open = [], paired = {};
    toks.forEach(function (t, i) {
      if (t.o) open.push([t.o, i]);
      else if (t.c) {
        for (var k = open.length - 1; k >= 0; k--) if (open[k][0] === t.c) { paired[open[k][1]] = 1; paired[i] = 1; open.splice(k, 1); break; }
      }
    });
    return toks.map(function (t, i) {
      if (t.x !== undefined) return xesc(t.x);
      if (t.v) return '<ph x="' + t.v + '"/>';
      if (t.o) return paired[i] ? '<bpt i="' + t.o + '" x="' + t.o + '"/>' : '<it pos="begin" x="' + t.o + '"/>';
      return paired[i] ? '<ept i="' + t.c + '"/>' : '<it pos="end" x="' + t.c + '"/>';
    }).join("");
  }
  // units: [{ from, to, src, tgt, m }] → TMX 1.4b text
  function tmx(units, opts) {
    opts = opts || {};
    var froms = {};
    units.forEach(function (u) { froms[u.from] = 1; });
    var fl = Object.keys(froms), srclang = fl.length === 1 ? fl[0] : "*all*";
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tmx version="1.4">',
      '<header creationtool="orOS Writer" creationtoolversion="1" datatype="plaintext" segtype="sentence" adminlang="en" srclang="' + xesc(srclang) +
      '" o-tmf="orOS"' + (opts.name ? ' creationid="' + xesc(String(opts.name).slice(0, 200)) + '"' : "") + '/>', "<body>"];
    units.forEach(function (u) {
      out.push('<tu changedate="' + tmxDateOf(u.m || Date.now()) + '"><tuv xml:lang="' + xesc(u.from) + '"><seg>' + segXml(u.src) +
        '</seg></tuv><tuv xml:lang="' + xesc(u.to) + '"><seg>' + segXml(u.tgt) + "</seg></tuv></tu>");
    });
    out.push("</body>", "</tmx>", "");
    return out.join("\n");
  }
  // a memory's map → the units for tmx()
  function unitsOf(map, from, to) {
    var out = [];
    Object.keys(map || {}).sort().forEach(function (k) {
      var u = map[k], p = pairOf(k);
      if (!u || u[3] || !p || !u[1].trim()) return;
      if (from && p.from !== from) return;
      if (to && p.to !== to) return;
      out.push({ from: p.from, to: p.to, src: u[0], tgt: u[1], m: u[2] });
    });
    return out;
  }

  var api = {
    BUCKETS: BUCKETS, MIN_SCORE: MIN_SCORE, MAX_UNITS: MAX_UNITS, TM_RX: TM_RX, KEY_RX: KEY_RX, DEV_RX: DEV_RX,
    base: base, keyOf: keyOf, pairOf: pairOf, bucketOf: bucketOf, cleanUnit: cleanUnit, mergeUnits: mergeUnits,
    unitsName: unitsName, unitsFile: unitsFile, readUnitsFile: readUnitsFile, readTm: readTm, newTmId: newTmId, count: count,
    score: score, Index: Index, diff: diff, parseTmx: parseTmx, tmx: tmx, unitsOf: unitsOf, fold: fold,
    // shared with catqa.js (T3)
    fnv: fnv, ws: ws, strip: strip, xesc: xesc, xml: { parse: parseXml, kids: kids, textOf: textOf }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterCatTM = api;
})(this);
