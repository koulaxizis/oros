// ============================================================
// orOS designkit — model.js (v1.2.0)
// The document model shared by Layout and Atelier: page presets and
// units, new documents with seeds, strict normalization (the same
// code cleans storage, sync pulls and imported packages), and the
// canonical per-entity merge (R5, R17, R26, R27).
//
// Data (synced slice, e.g. "layout" / oros-layout-data):
//   { ver: 1, docs: [doc…] sorted by id, dt: { docId: deletedAt } }
// doc:
//   { id, m, name, setup, pages[], masters[], items[], stories[],
//     pstyles[], cstyles[], swatches[], guides[], rec[], tombs{} }
//   m = mtime of the doc's own fields (name, setup). Every entity
//   in a collection has its own id + m; tombs maps entity id →
//   deletedAt for the whole doc (ids never repeat across
//   collections: each has its own prefix).
// Merge: docs union by id; inside a doc, LWW per entity (newer m
// wins; equal m: the larger canonical JSON), tombstones max-merged,
// a tombstone wins ties, a newer edit resurrects. A document whose
// newest entity is not newer than its doc tombstone is gone.
// Stories carry h = the mtimes they went through (newest first,
// ≤ 50). When the losing copy's m is not in the winner's history,
// the two were edited apart: the loser's text is kept in rec[]
// ("Recovered text") so nothing typed is ever lost.
// Items: text, img, rect, ell, line, path (outline in `d`, see
// parsePath); rect / ell / path may carry a gradient fill `gr`. Older
// copies of the app drop path items they do not know when they read a
// document, but the merge is a union, so the items come back from
// any newer copy: nothing is deleted.
// Forward compatibility (model level 2, wave L0): setup, pages,
// masters, items, stories, paragraphs, runs, styles, swatches and
// guides may carry an extension bag `ext` that every copy from level 2
// on keeps byte for byte (normX: JSON values only, keys sorted,
// capped; an invalid bag is dropped whole, never trimmed). Every
// field added after level 2 lives inside `ext`, so a copy that does not
// know it still keeps it. Atelier `ax` of a kind this copy does not
// know is kept as `axu`. On an equal `m` the copy that carries such
// preserved data wins (better()), so a device still running older
// code cannot strip it from the others. setup.ext.mv = the lowest model
// level that may edit the document (needsNewer()).
// Units: points. Exposes orosDK.model (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var PT_PER = { pt: 1, mm: 72 / 25.4, in: 72 };
  var MAX_COORD = 20000, MAX_ITEMS = 5000, MAX_PAGES = 999, MAX_TEXT = 400000;
  var HIST = 50;
  var MODEL_LEVEL = 2;

  // ---------- 1. Presets ----------
  // [id, width mm, height mm] (portrait); "post" is in px at 72 dpi.
  var PRESETS = [
    ["a4", 210, 297], ["a5", 148, 210], ["a3", 297, 420], ["a6", 105, 148],
    ["b5", 176, 250], ["letter", 215.9, 279.4], ["legal", 215.9, 355.6],
    ["card", 85, 55], ["dl", 99, 210], ["square", 1080 * 25.4 / 72, 1080 * 25.4 / 72],
    ["poster", 500, 700]
  ];
  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i][0] === id) {
      return { w: PRESETS[i][1] * PT_PER.mm, h: PRESETS[i][2] * PT_PER.mm };
    }
    return null;
  }
  function toUnit(pt, u) { return pt / (PT_PER[u] || 1); }
  function fromUnit(v, u) { return v * (PT_PER[u] || 1); }

  // ---------- 2. Small helpers ----------
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function num(v, lo, hi, def) {
    if (!isNum(v)) return def;
    return Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
  }
  function int(v, lo, hi, def) {
    if (!isNum(v)) return def;
    return Math.min(hi, Math.max(lo, Math.round(v)));
  }
  function bit(v) { return v === 1 || v === true ? 1 : 0; }
  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max) : ""; }
  var ID_RE = /^[a-z]{1,4}-[a-z0-9]{1,24}$/;
  function isId(v) { return typeof v === "string" && ID_RE.test(v); }
  function stamp(v) { return isNum(v) && v >= 0 ? Math.floor(v) : 0; }
  // A seed name {en, el} or a hand-typed string (R15).
  function nameOf(v, max) {
    if (v && typeof v === "object" && typeof v.en === "string" && typeof v.el === "string") {
      return { en: str(v.en, max), el: str(v.el, max) };
    }
    return str(v, max);
  }
  // lang "el" → Greek; else the page's pack language for a seed name,
  // else English.
  function label(name, lang) {
    if (name && typeof name === "object") {
      if (lang !== "el" && typeof window !== "undefined" && window.orosI18n) {
        var c = window.orosI18n.lang();
        if (c !== "en" && c !== "el") { var v = seedLabel(name.en, c); if (v) return v; }
      }
      return name[lang === "el" ? "el" : "en"] || name.en || "";
    }
    return name || "";
  }

  var rand = (function () {
    var c = root && root.crypto;
    return function (n) {
      var s = "", A = "abcdefghijklmnopqrstuvwxyz0123456789";
      var b = new Uint8Array(n);
      if (c && c.getRandomValues) c.getRandomValues(b);
      else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
      for (var j = 0; j < n; j++) s += A[b[j] % 36];
      return s;
    };
  })();
  function newId(prefix) { return prefix + "-" + rand(12); }

  // m moves only on a real change (R27) and always forward.
  function touch(ent, now) { ent.m = Math.max(stamp(now), (ent.m || 0) + 1); return ent; }

  // ---------- 3. Normalizers ----------
  // Extension bag `ext` (not `x`: items and frames use x for their
  // position): kept exactly as it is or dropped whole. Plain
  // JSON (objects with keys ^[a-z][a-zA-Z0-9]{0,23}$, arrays ≤ 1000,
  // strings ≤ 4000 without control characters other than tab / line
  // breaks, finite numbers, booleans, null), depth ≤ 6, canonical
  // (keys sorted at every level), at most `max` characters of JSON.
  // A later wave normalizes its own keys and then runs normX, so its
  // output is already what this function keeps.
  var X_KEY = /^[a-z][a-zA-Z0-9]{0,23}$/, X_STR = 4000, X_ARR = 1000, X_DEPTH = 6;
  var X_MAX = 8192, X_MAX_SETUP = 65536, AXU_MAX = 16384;
  var X_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  function xVal(v, depth) {
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") { if (!isFinite(v)) throw X_BAD; return v; }
    if (typeof v === "string") { if (v.length > X_STR || X_CTRL.test(v)) throw X_BAD; return v; }
    if (depth >= X_DEPTH || typeof v !== "object") throw X_BAD;
    if (Array.isArray(v)) {
      if (v.length > X_ARR) throw X_BAD;
      return v.map(function (e) { return xVal(e, depth + 1); });
    }
    if (Object.prototype.toString.call(v) !== "[object Object]") throw X_BAD;   // plain objects (any window)
    var keys = Object.keys(v).sort(cmpStr), o = {};
    keys.forEach(function (k) {
      if (!X_KEY.test(k)) throw X_BAD;
      o[k] = xVal(v[k], depth + 1);
    });
    return o;
  }
  var X_BAD = {};
  function normX(v, max) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    try {
      var o = xVal(v, 0);
      if (!Object.keys(o).length || JSON.stringify(o).length > (max || X_MAX)) return null;
      return o;
    } catch (e) {
      if (e === X_BAD) return null;
      throw e;
    }
  }
  function withX(o, src, max) {
    var x = src && normX(src.ext, max);
    if (x) o.ext = x;
    return o;
  }
  // The `ext` keys of an entity that `known` does not list (for a
  // "made with a newer orOS" notice).
  function unknownX(ent, known) {
    var x = ent && ent.ext;
    if (!x) return [];
    return Object.keys(x).filter(function (k) { return (known || []).indexOf(k) < 0; });
  }
  // The lowest model level allowed to edit the document (setup.ext.mv).
  function minLevel(doc) {
    var mv = doc && doc.setup && doc.setup.ext && doc.setup.ext.mv;
    return typeof mv === "number" && mv % 1 === 0 && mv > 1 ? mv : 1;
  }
  function needsNewer(doc) { return minLevel(doc) > MODEL_LEVEL; }
  // True when the entity (or a paragraph / run of a story, or a doc's
  // setup) carries data kept for a newer copy: decides equal-m ties.
  function keepsMore(e) {
    if (!e) return false;
    if (e.ext || e.axu || (e.setup && e.setup.ext)) return true;
    var ps = e.paras;
    if (Array.isArray(ps)) {
      for (var i = 0; i < ps.length; i++) {
        if (ps[i].ext) return true;
        for (var j = 0; j < ps[i].runs.length; j++) if (ps[i].runs[j].ext) return true;
      }
    }
    return false;
  }

  function normSetup(s) {
    s = s && typeof s === "object" ? s : {};
    return withX({
      w: num(s.w, 36, 14400, 595.276), h: num(s.h, 36, 14400, 841.89),
      unit: oneOf(s.unit, ["mm", "pt", "in"], "mm"),
      bleed: num(s.bleed, 0, 72, 8.504),
      mt: num(s.mt, 0, 2000, 36), mb: num(s.mb, 0, 2000, 36),
      mi: num(s.mi, 0, 2000, 36), mo: num(s.mo, 0, 2000, 36),
      cols: int(s.cols, 1, 20, 1), gut: num(s.gut, 0, 500, 12),
      facing: bit(s.facing),
      preset: typeof s.preset === "string" && /^[a-z0-9]{1,12}$/.test(s.preset) ? s.preset : "custom"
    }, s, X_MAX_SETUP);
  }

  function normPage(p) {
    if (!p || !isId(p.id)) return null;
    return withX({ id: p.id, m: stamp(p.m), pos: num(p.pos, -1e12, 1e12, 0), ms: isId(p.ms) ? p.ms : "" }, p);
  }
  function normMaster(p) {
    if (!p || !isId(p.id)) return null;
    var pre = str(p.pre, 3).replace(/[^A-Za-zΑ-Ωα-ω0-9]/g, "").toUpperCase() || "A";
    return withX({ id: p.id, m: stamp(p.m), name: nameOf(p.name, 60), pre: pre }, p);
  }

  var ITEM_TYPES = ["text", "img", "rect", "ell", "line", "path"];

  // ---------- Paths and gradients (imported shapes) ----------
  // A "path" item keeps its outline in `d`: M / L / C / Z commands whose
  // coordinates are fractions of the item's box (0..1, control points
  // may go a little outside), so moving or resizing the box moves and
  // scales the outline. `eo` = even-odd fill. Canonical text form:
  // "M0 0L1 0L1 1Z", numbers rounded to 4 decimals.
  var MAX_PATH_CMDS = 8000, PATH_LO = -4, PATH_HI = 5;
  var PATH_ARGS = { M: 2, L: 2, C: 6, Z: 0 };
  function fmt4(n) { return String(Math.round(n * 10000) / 10000); }
  // → [["M", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"], …] or null
  function parsePath(d) {
    if (typeof d !== "string" || d.length > MAX_PATH_CMDS * 60) return null;
    var tok = d.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [], out = [], i = 0, open = false;
    while (i < tok.length && out.length < MAX_PATH_CMDS) {
      var c = tok[i++], n = PATH_ARGS[c];
      if (n === undefined) return null;
      if (!open && c !== "M") return null;
      var cmd = [c];
      for (var k = 0; k < n; k++) {
        var v = parseFloat(tok[i++]);
        if (!isFinite(v)) return null;
        cmd.push(Math.min(PATH_HI, Math.max(PATH_LO, Math.round(v * 10000) / 10000)));
      }
      out.push(cmd);
      open = c !== "Z";
    }
    return out.length ? out : null;
  }
  function pathText(cmds) {
    return cmds.map(function (c) { return c[0] + c.slice(1).map(fmt4).join(" "); }).join("");
  }
  // gradient { k: "l" linear | "r" radial, x1, y1, x2, y2 (fractions of
  // the box; radial: centre → a point on the outer circle), st: [[pos
  // 0..1, swatch id, opacity 0..100], …] (2..16 stops, by position) }
  function normGrad(g) {
    if (!g || typeof g !== "object") return null;
    var k = oneOf(g.k, ["l", "r"], "");
    if (!k) return null;
    var st = [];
    (Array.isArray(g.st) ? g.st : []).slice(0, 16).forEach(function (s) {
      if (Array.isArray(s) && isId(s[1])) st.push([num(s[0], 0, 1, 0), s[1], int(s[2], 0, 100, 100)]);
    });
    if (st.length < 2) return null;
    st.sort(function (a, b) { return a[0] - b[0]; });
    return { k: k, x1: num(g.x1, -10, 10, 0), y1: num(g.y1, -10, 10, 0.5), x2: num(g.x2, -10, 10, 1), y2: num(g.y2, -10, 10, 0.5), st: st };
  }

  // Per-app item extras. An app that needs fields of its own on
  // items (Atelier: shapes, icons, effects, filters…) registers ONE
  // normalizer: fn(rawAx, normalizedItem) → canonical object or null.
  // It runs inside normItem, so storage, merge and imports all keep
  // the extras. Nothing registered (Layout): `ax` is dropped as
  // before.
  var itemExt = null, itemKnown = null;
  // known(k): true when the app knows the extras kind k; extras of an
  // unknown kind are kept as `axu` instead of being dropped.
  function setItemExt(fn, known) {
    itemExt = typeof fn === "function" ? fn : null;
    itemKnown = itemExt && typeof known === "function" ? known : null;
  }
  function normItem(it) {
    if (!it || !isId(it.id) || ITEM_TYPES.indexOf(it.t) < 0 || !isId(it.pg)) return null;
    var o = {
      id: it.id, m: stamp(it.m), t: it.t, pg: it.pg,
      side: oneOf(it.side, ["L", "R"], ""),
      x: num(it.x, -MAX_COORD, MAX_COORD, 0), y: num(it.y, -MAX_COORD, MAX_COORD, 0),
      w: num(it.w, it.t === "line" ? -MAX_COORD : 0.5, MAX_COORD, 100),
      h: num(it.h, it.t === "line" ? -MAX_COORD : 0.5, MAX_COORD, 100),
      rot: num(it.rot, -360, 360, 0), z: num(it.z, -1e12, 1e12, 0),
      fill: isId(it.fill) ? it.fill : "", stroke: isId(it.stroke) ? it.stroke : "",
      sw: num(it.sw, 0, 200, 1), dash: bit(it.dash), op: int(it.op, 0, 100, 100),
      r: num(it.r, 0, 5000, 0), lock: bit(it.lock), hide: bit(it.hide),
      grp: isId(it.grp) ? it.grp : "",
      wrap: oneOf(it.wrap, ["none", "box", "ell"], "none"), wo: num(it.wo, -500, 500, 6)
    };
    if (it.t === "text") {
      o.story = isId(it.story) ? it.story : "";
      o.seq = num(it.seq, -1e12, 1e12, 0);
      o.cols = int(it.cols, 1, 20, 1); o.gut = num(it.gut, 0, 500, 12);
      o.ins = num(it.ins, 0, 500, 0); o.va = oneOf(it.va, ["t", "c", "b"], "t");
      if (!o.story) return null;
    } else if (it.t === "img") {
      o.a = typeof it.a === "string" && /^[0-9a-f]{64}\.(jpg|png)$/.test(it.a) ? it.a : "";
      o.nm = str(it.nm, 120);
      o.iw = int(it.iw, 0, 100000, 0); o.ih = int(it.ih, 0, 100000, 0);
      o.fit = oneOf(it.fit, ["fit", "fill", "custom"], "fill");
      o.ix = num(it.ix, -MAX_COORD, MAX_COORD, 0); o.iy = num(it.iy, -MAX_COORD, MAX_COORD, 0);
      o.isc = num(it.isc, 0.001, 1000, 1);
      // Layout data merge: the CSV column that names this frame's
      // picture (only when set, so older documents stay as they were)
      var mf = str(it.mf, 60).replace(/[{}\n\r\t]/g, "").trim();
      if (mf) o.mf = mf;
    }
    if (it.t === "path") {
      var cmds = parsePath(it.d);
      if (!cmds) return null;
      o.d = pathText(cmds);
      if (bit(it.eo)) o.eo = 1;
    }
    if (it.t === "rect" || it.t === "ell" || it.t === "path") {
      var gr = normGrad(it.gr);
      if (gr) o.gr = gr;
    }
    // a page's own copy of a master item ("detached here"): the
    // master item stops showing on that page
    if (isId(it.ov) && it.ov !== it.id) o.ov = it.ov;
    if (itemExt) {
      // `axu`: Atelier extras of a kind this copy does not know, kept
      // as they are (a newer copy turns them back into `ax`)
      var raw = it.ax && typeof it.ax === "object" ? it.ax : it.axu && typeof it.axu === "object" ? it.axu : null;
      var ax = raw ? itemExt(raw, o) : null;
      if (ax && typeof ax === "object") o.ax = ax;
      else if (raw && typeof raw.k === "string" && itemKnown && !itemKnown(raw.k)) {
        var axu = normX(raw, AXU_MAX);
        if (axu) o.axu = axu;
      }
    }
    return withX(o, it);
  }

  function normRun(r) {
    if (!r || typeof r !== "object") return null;
    var o = {};
    if (r.f === "pn" || r.f === "pc") o.f = r.f;
    else {
      var t = str(r.t, MAX_TEXT).replace(/\r\n?/g, "\n");
      if (!t) return null;
      o.t = t;
    }
    if (isId(r.cs)) o.cs = r.cs;
    if (bit(r.b)) o.b = 1;
    if (bit(r.i)) o.i = 1;
    if (bit(r.u)) o.u = 1;
    return withX(o, r);
  }
  function sameFmt(a, b) {
    return !a.f && !b.f && a.cs === b.cs && a.b === b.b && a.i === b.i && a.u === b.u &&
      JSON.stringify(a.ext || null) === JSON.stringify(b.ext || null);
  }
  function normPara(p) {
    if (!p || typeof p !== "object") return null;
    var runs = [];
    (Array.isArray(p.runs) ? p.runs : []).forEach(function (r) {
      var n = normRun(r);
      if (!n) return;
      var last = runs[runs.length - 1];
      if (last && sameFmt(last, n)) last.t += n.t;     // coalesce
      else runs.push(n);
    });
    return withX({ ps: isId(p.ps) ? p.ps : "ps-base", runs: runs }, p);
  }
  function normStory(s) {
    if (!s || !isId(s.id)) return null;
    var paras = [];
    (Array.isArray(s.paras) ? s.paras : []).slice(0, 20000).forEach(function (p) {
      var n = normPara(p);
      if (n) paras.push(n);
    });
    if (!paras.length) paras.push({ ps: "ps-base", runs: [] });
    var m = stamp(s.m), seen = {}, h = [];
    (Array.isArray(s.h) ? s.h : []).forEach(function (v) {
      v = stamp(v);
      if (v && v < m && !seen[v]) { seen[v] = 1; h.push(v); }
    });
    h.sort(function (a, b) { return b - a; });
    return withX({ id: s.id, m: m, h: h.slice(0, HIST), paras: paras }, s);
  }

  function normPs(s) {
    if (!s || !isId(s.id)) return null;
    var o = { id: s.id, m: stamp(s.m), name: nameOf(s.name, 60) };
    if (isId(s.base) && s.base !== s.id) o.base = s.base;
    if (s.font !== undefined) o.font = oneOf(s.font, ["sans", "serif", "mono"], "serif");
    if (s.size !== undefined) o.size = num(s.size, 1, 1296, 11);
    if (s.lead !== undefined) o.lead = num(s.lead, 0, 1500, 0);
    if (s.align !== undefined) o.align = oneOf(s.align, ["l", "c", "r", "j"], "l");
    ["b", "i", "u", "bul", "caps"].forEach(function (k) { if (s[k] !== undefined) o[k] = bit(s[k]); });
    ["sb", "sa"].forEach(function (k) { if (s[k] !== undefined) o[k] = num(s[k], 0, 1000, 0); });
    ["fi", "li", "ri"].forEach(function (k) { if (s[k] !== undefined) o[k] = num(s[k], -1000, 1000, 0); });
    if (s.track !== undefined) o.track = num(s.track, -500, 2000, 0);
    if (s.color !== undefined && isId(s.color)) o.color = s.color;
    return withX(o, s);
  }
  function normCs(s) {
    if (!s || !isId(s.id)) return null;
    var o = { id: s.id, m: stamp(s.m), name: nameOf(s.name, 60) };
    if (isId(s.base) && s.base !== s.id) o.base = s.base;
    if (s.font !== undefined) o.font = oneOf(s.font, ["sans", "serif", "mono"], "serif");
    if (s.size !== undefined) o.size = num(s.size, 1, 1296, 11);
    ["b", "i", "u", "caps"].forEach(function (k) { if (s[k] !== undefined) o[k] = bit(s[k]); });
    if (s.track !== undefined) o.track = num(s.track, -500, 2000, 0);
    if (s.color !== undefined && isId(s.color)) o.color = s.color;
    return withX(o, s);
  }
  function normSwatch(s) {
    if (!s || !isId(s.id)) return null;
    var mode = oneOf(s.mode, ["rgb", "cmyk"], "rgb");
    var v = Array.isArray(s.v) ? s.v : [];
    var vals = mode === "rgb"
      ? [int(v[0], 0, 255, 0), int(v[1], 0, 255, 0), int(v[2], 0, 255, 0)]
      : [num(v[0], 0, 100, 0), num(v[1], 0, 100, 0), num(v[2], 0, 100, 0), num(v[3], 0, 100, 100)];
    return withX({ id: s.id, m: stamp(s.m), name: nameOf(s.name, 60), mode: mode, v: vals }, s);
  }
  function normGuide(g) {
    if (!g || !isId(g.id) || !isId(g.pg)) return null;
    return withX({ id: g.id, m: stamp(g.m), pg: g.pg, o: oneOf(g.o, ["v", "h"], "v"), p: num(g.p, -MAX_COORD, MAX_COORD, 0) }, g);
  }
  function normRec(r) {
    if (!r || !isId(r.id)) return null;
    return { id: r.id, m: stamp(r.m), sid: isId(r.sid) ? r.sid : "", t: str(r.t, MAX_TEXT) };
  }

  var COLLECTIONS = [
    ["pages", normPage], ["masters", normMaster], ["items", normItem], ["stories", normStory],
    ["pstyles", normPs], ["cstyles", normCs], ["swatches", normSwatch], ["guides", normGuide], ["rec", normRec]
  ];

  function canon(o) { return JSON.stringify(o); }
  function better(a, b) {   // true when a beats b (LWW)
    if (a.m !== b.m) return a.m > b.m;
    // equal m: the copy that keeps data for newer code wins over one
    // that an older copy stripped (wave L0), then the larger JSON
    var ka = keepsMore(a), kb = keepsMore(b);
    if (ka !== kb) return ka;
    return canon(a) > canon(b);
  }

  // ---------- 4. Merge ----------
  function mergeTombs(list) {
    var out = {};
    list.forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!isId(id)) return;
        var v = stamp(tm[id]);
        if (!v) return;
        if (!(id in out) || v > out[id]) out[id] = v;
      });
    });
    var sorted = {};
    Object.keys(out).sort(cmpStr).forEach(function (id) { sorted[id] = out[id]; });
    return sorted;
  }

  function storyKey(s) { return JSON.stringify(s.paras); }

  // One collection of two docs (either may be missing).
  function mergeColl(name, normFn, a, b, tombs, recOut) {
    var best = {};
    [a, b].forEach(function (doc) {
      if (!doc || !Array.isArray(doc[name])) return;
      doc[name].forEach(function (raw) {
        var e = normFn(raw);
        if (!e) return;
        var cur = best[e.id];
        if (!cur) { best[e.id] = e; return; }
        if (name === "stories") best[e.id] = mergeStory(cur, e, recOut);
        else if (better(e, cur)) best[e.id] = e;
      });
    });
    var out = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      out.push(best[id]);
    });
    return out;
  }

  function mergeStory(x, y, recOut) {
    if (canon(x) === canon(y)) return x;
    var win = better(x, y) ? x : y, lose = win === x ? y : x;
    var seen = {}, h = [];
    win.h.concat(lose.h, [lose.m]).forEach(function (v) {
      if (v && v < win.m && !seen[v]) { seen[v] = 1; h.push(v); }
    });
    var concurrent = lose.m !== win.m && win.h.indexOf(lose.m) < 0 && lose.h.indexOf(win.m) < 0;
    if (concurrent && storyKey(lose) !== storyKey(win)) {
      var T = textApi();
      var txt = T ? T.plainText(lose) : "";
      if (txt.trim()) recOut.push({ id: "rc-" + (lose.id.split("-")[1] + lose.m.toString(36)).slice(0, 24), m: lose.m, sid: lose.id, t: txt });
    }
    h.sort(function (a, b) { return b - a; });
    return withX({ id: win.id, m: win.m, h: h.slice(0, HIST), paras: win.paras }, win);
  }

  function textApi() {
    if (typeof module !== "undefined" && module.exports) {
      try { return require("./text.js"); } catch (e) { return null; }
    }
    return root.orosDK && root.orosDK.text;
  }

  function maxM(doc) {
    var m = doc.m || 0;
    COLLECTIONS.forEach(function (c) { (doc[c[0]] || []).forEach(function (e) { if (e.m > m) m = e.m; }); });
    Object.keys(doc.tombs || {}).forEach(function (k) { if (doc.tombs[k] > m) m = doc.tombs[k]; });
    return m;
  }

  // A duplicate of a document: new id, every entity stamped `now` so the copy is
  // not older than anything it holds, no tombstones. Only stories carry an edit
  // history in `h`; on items, pages etc. `h` is a size and must survive.
  function copyDoc(doc, now) {
    var copy = JSON.parse(JSON.stringify(doc));
    var t = stamp(now);
    copy.id = newId("doc");
    copy.m = t;
    COLLECTIONS.forEach(function (c) {
      (copy[c[0]] || []).forEach(function (e) { e.m = t; if (c[0] === "stories") e.h = []; });
    });
    copy.tombs = {};
    return normDoc(copy);
  }

  function mergeDoc(a, b) {
    var x = a && isId(a.id) ? a : null, y = b && isId(b.id) ? b : null;
    var base = x || y;
    var mx = x ? stamp(x.m) : -1, my = y ? stamp(y.m) : -1;
    var metaX = x ? { m: mx, name: str(x.name, 120), setup: normSetup(x.setup) } : null;
    var metaY = y ? { m: my, name: str(y.name, 120), setup: normSetup(y.setup) } : null;
    var meta = !metaY ? metaX : !metaX ? metaY : (better(metaX, metaY) ? metaX : metaY);
    var tombs = mergeTombs([x && x.tombs, y && y.tombs]);
    var doc = { id: base.id, m: meta.m, name: meta.name, setup: meta.setup };
    var rec = [];
    COLLECTIONS.forEach(function (c) {
      if (c[0] === "rec") return;
      doc[c[0]] = mergeColl(c[0], c[1], x, y, tombs, rec);
    });
    var recSrc = { rec: rec };
    doc.rec = mergeColl("rec", normRec, { rec: (x && x.rec || []).concat(y && y.rec || []) }, recSrc, tombs, []);
    doc.tombs = tombs;
    return doc;
  }

  function mergeData(A, B) {
    var a = A || {}, b = B || {};
    var dt = mergeTombs([a.dt, b.dt]);
    var by = {};
    [a.docs, b.docs].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (d) {
        if (!d || !isId(d.id)) return;
        by[d.id] = by[d.id] ? mergeDoc(by[d.id], d) : mergeDoc(d, null);
      });
    });
    var docs = [];
    Object.keys(by).sort(cmpStr).forEach(function (id) {
      var d = by[id];
      if (id in dt && dt[id] >= maxM(d)) return;
      docs.push(d);
    });
    return { ver: DATA_VER, docs: docs, dt: dt };
  }

  // ---------- 5. Seeds + new documents ----------
  // Seed names are saved in documents as { en, el } (that format stays);
  // label() shows a pack language's name for them (i18n/<code>/
  // designkit.js, "designkit" in data-app), found by their English text.
  var SEED = {
    en: {
      "seed.sw-black": "Black", "seed.sw-paper": "Paper", "seed.sw-gray": "Gray 50%", "seed.sw-red": "Red",
      "seed.sw-blue": "Blue", "seed.sw-yellow": "Yellow", "seed.sw-green": "Green",
      "seed.ps-base": "Basic paragraph", "seed.ps-body": "Body", "seed.ps-h1": "Heading 1",
      "seed.ps-h2": "Heading 2", "seed.ps-h3": "Heading 3", "seed.ps-cap": "Caption", "seed.ps-quote": "Quote",
      "seed.ps-list": "List", "seed.cs-strong": "Strong", "seed.cs-em": "Emphasis",
      "seed.cs-accent": "Accent colour"
    },
    el: {
      "seed.sw-black": "Μαύρο", "seed.sw-paper": "Χαρτί", "seed.sw-gray": "Γκρι 50%", "seed.sw-red": "Κόκκινο",
      "seed.sw-blue": "Μπλε", "seed.sw-yellow": "Κίτρινο", "seed.sw-green": "Πράσινο",
      "seed.ps-base": "Βασική παράγραφος", "seed.ps-body": "Κείμενο", "seed.ps-h1": "Τίτλος 1",
      "seed.ps-h2": "Τίτλος 2", "seed.ps-h3": "Τίτλος 3", "seed.ps-cap": "Λεζάντα", "seed.ps-quote": "Παράθεση",
      "seed.ps-list": "Λίστα", "seed.cs-strong": "Έντονα", "seed.cs-em": "Πλάγια",
      "seed.cs-accent": "Χρώμα έμφασης"
    }
  };
  function nm(k) { return { en: SEED.en[k], el: SEED.el[k] }; }
  var seedByEn = null, seedPack = {};
  // templates.js adds the names of its own styles and swatches.
  function seedNames(t) {
    if (!t || !t.en || !t.el) return;
    Object.keys(t.en).forEach(function (k) { SEED.en[k] = t.en[k]; SEED.el[k] = t.el[k]; });
    seedByEn = null; seedPack = {};
  }
  function seedLabel(en, code) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (!I || typeof en !== "string") return "";
    if (!seedByEn) {
      seedByEn = {};
      Object.keys(SEED.en).forEach(function (k) { if (!(SEED.en[k] in seedByEn)) seedByEn[SEED.en[k]] = k; });
    }
    var k = seedByEn[en];
    if (!k) return "";
    var tb = seedPack[code] || (seedPack[code] = I.table({ en: SEED.en, el: SEED.el }, "designkit", code));
    return tb[k] || "";
  }
  var SEED_SWATCHES = [
    ["sw-black", nm("seed.sw-black"), "cmyk", [0, 0, 0, 100]],
    ["sw-paper", nm("seed.sw-paper"), "rgb", [255, 255, 255]],
    ["sw-gray", nm("seed.sw-gray"), "cmyk", [0, 0, 0, 50]],
    ["sw-red", nm("seed.sw-red"), "cmyk", [0, 90, 85, 0]],
    ["sw-blue", nm("seed.sw-blue"), "cmyk", [100, 60, 0, 0]],
    ["sw-yellow", nm("seed.sw-yellow"), "cmyk", [0, 10, 95, 0]],
    ["sw-green", nm("seed.sw-green"), "cmyk", [75, 0, 100, 0]]
  ];
  var SEED_PS = [
    { id: "ps-base", name: nm("seed.ps-base"), font: "serif", size: 10.5, lead: 14, align: "l", color: "sw-black" },
    { id: "ps-body", name: nm("seed.ps-body"), base: "ps-base", align: "j", sa: 6 },
    { id: "ps-h1", name: nm("seed.ps-h1"), base: "ps-base", font: "sans", b: 1, size: 28, lead: 32, sa: 10 },
    { id: "ps-h2", name: nm("seed.ps-h2"), base: "ps-h1", size: 18, lead: 22, sb: 10, sa: 6 },
    { id: "ps-h3", name: nm("seed.ps-h3"), base: "ps-h1", size: 13, lead: 16, sb: 8, sa: 4 },
    { id: "ps-cap", name: nm("seed.ps-cap"), base: "ps-base", font: "sans", i: 1, size: 8.5, lead: 11 },
    { id: "ps-quote", name: nm("seed.ps-quote"), base: "ps-base", i: 1, size: 12, lead: 16, li: 18, ri: 18, sb: 6, sa: 6 },
    { id: "ps-list", name: nm("seed.ps-list"), base: "ps-base", bul: 1, sa: 2 }
  ];
  var SEED_CS = [
    { id: "cs-strong", name: nm("seed.cs-strong"), b: 1 },
    { id: "cs-em", name: nm("seed.cs-em"), i: 1 },
    { id: "cs-accent", name: nm("seed.cs-accent"), color: "sw-blue" }
  ];

  // opts: { name, w, h, unit, bleed, mt, mb, mi, mo, cols, gut,
  //         facing, preset, pages }
  function newDoc(opts, now) {
    opts = opts || {};
    var t = stamp(now) || 1;
    var setup = normSetup(opts);
    var doc = {
      id: newId("doc"), m: t, name: str(opts.name, 120) || "Untitled", setup: setup,
      pages: [], masters: [{ id: "ms-a", m: t, name: { en: "A-Master", el: "A-Master" }, pre: "A" }],
      items: [], stories: [], pstyles: [], cstyles: [], swatches: [], guides: [], rec: [], tombs: {}
    };
    SEED_SWATCHES.forEach(function (s) { doc.swatches.push({ id: s[0], m: t, name: s[1], mode: s[2], v: s[3] }); });
    SEED_PS.forEach(function (s) { var o = JSON.parse(JSON.stringify(s)); o.m = t; doc.pstyles.push(normPs(o)); });
    SEED_CS.forEach(function (s) { var o = JSON.parse(JSON.stringify(s)); o.m = t; doc.cstyles.push(normCs(o)); });
    var n = int(opts.pages, 1, MAX_PAGES, 1);
    for (var i = 0; i < n; i++) doc.pages.push({ id: newId("pg"), m: t, pos: (i + 1) * 1024, ms: "ms-a" });
    return normDoc(doc);
  }

  // Normalize one doc on its own (storage load, import).
  function normDoc(d) { return mergeDoc(d, null); }
  function normData(d) { return mergeData(d, null); }

  // ---------- 6. Queries ----------
  function pagesInOrder(doc) {
    return doc.pages.slice().sort(function (a, b) { return a.pos - b.pos || cmpStr(a.id, b.id); });
  }
  // Side of the n-th page (0-based): a facing document starts on a
  // right-hand page.
  function sideOf(doc, idx) { return doc.setup.facing ? (idx % 2 === 0 ? "R" : "L") : "R"; }
  function spreads(doc) {
    var pages = pagesInOrder(doc), out = [];
    if (!doc.setup.facing) { pages.forEach(function (p) { out.push([p]); }); return out; }
    if (pages.length) out.push([pages[0]]);
    for (var i = 1; i < pages.length; i += 2) out.push(pages.slice(i, i + 2));
    return out;
  }
  // Margins in page coordinates (left/right swap on left pages).
  function margins(doc, side) {
    var s = doc.setup;
    if (!s.facing) return { t: s.mt, b: s.mb, l: s.mi, r: s.mo };
    return side === "L" ? { t: s.mt, b: s.mb, l: s.mo, r: s.mi } : { t: s.mt, b: s.mb, l: s.mi, r: s.mo };
  }
  function byZ(a, b) { return a.z - b.z || cmpStr(a.id, b.id); }
  function itemsOn(doc, ownerId, side) {
    return doc.items.filter(function (it) {
      return it.pg === ownerId && (side === undefined || !it.side || it.side === side);
    }).sort(byZ);
  }
  // Master items that show on a page: those of its master (and side)
  // minus the ones the page has detached (a page item with ov = id).
  function masterItems(doc, page, side) {
    if (!page || !page.ms) return [];
    var gone = {};
    doc.items.forEach(function (it) { if (it.pg === page.id && it.ov) gone[it.ov] = 1; });
    return itemsOn(doc, page.ms, side).filter(function (it) { return !gone[it.id]; });
  }
  // Frames of a story, in reading order.
  function chain(doc, storyId) {
    return doc.items.filter(function (it) { return it.t === "text" && it.story === storyId; })
      .sort(function (a, b) { return a.seq - b.seq || cmpStr(a.id, b.id); });
  }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function owner(doc, id) { return find(doc.pages, id) || find(doc.masters, id); }

  // Swatch → { rgb: [r,g,b], cmyk: [c,m,y,k] | null }. CMYK on
  // screen is a naive conversion (no ICC profile).
  function swatchColor(doc, id) {
    var s = id ? find(doc.swatches, id) : null;
    if (!s) return null;
    if (s.mode === "rgb") return { rgb: s.v.slice(), cmyk: null };
    var c = s.v[0] / 100, m = s.v[1] / 100, y = s.v[2] / 100, k = s.v[3] / 100;
    return { rgb: [Math.round(255 * (1 - c) * (1 - k)), Math.round(255 * (1 - m) * (1 - k)), Math.round(255 * (1 - y) * (1 - k))], cmyk: s.v.slice() };
  }
  function cssColor(doc, id) {
    var c = swatchColor(doc, id);
    return c ? "rgb(" + c.rgb.join(",") + ")" : null;
  }

  function storyOfDoc(doc, id) { return find(doc.stories, id); }
  function docBytes(doc) { return JSON.stringify(doc).length; }

  var api = {
    DATA_VER: DATA_VER, MODEL_LEVEL: MODEL_LEVEL, PT_PER: PT_PER,
    normX: normX, unknownX: unknownX, minLevel: minLevel, needsNewer: needsNewer, keepsMore: keepsMore, PRESETS: PRESETS, MAX_ITEMS: MAX_ITEMS, MAX_PAGES: MAX_PAGES,
    preset: preset, toUnit: toUnit, fromUnit: fromUnit, label: label, seedNames: seedNames, nameOf: nameOf,
    newId: newId, touch: touch, isId: isId, cmpStr: cmpStr, setItemExt: setItemExt, parsePath: parsePath, pathText: pathText, normGrad: normGrad,
    normSetup: normSetup, normItem: normItem, normStory: normStory, normPs: normPs, normCs: normCs,
    normSwatch: normSwatch, normPage: normPage, normMaster: normMaster, normGuide: normGuide, normPara: normPara,
    normDoc: normDoc, copyDoc: copyDoc, normData: normData, mergeDoc: mergeDoc, mergeData: mergeData, maxM: maxM,
    newDoc: newDoc, pagesInOrder: pagesInOrder, sideOf: sideOf, spreads: spreads, margins: margins,
    itemsOn: itemsOn, masterItems: masterItems, chain: chain, find: find, owner: owner, byZ: byZ,
    swatchColor: swatchColor, cssColor: cssColor, story: storyOfDoc, docBytes: docBytes,
    COLLECTIONS: COLLECTIONS.map(function (c) { return c[0]; })
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.model = api; }
})(typeof window !== "undefined" ? window : this);
