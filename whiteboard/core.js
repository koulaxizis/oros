// ============================================================
// orOS Whiteboard — data model, geometry and drawing (pure, no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// Data in localStorage "oros-whiteboard-data":
//   { ver: 1,
//     boards: [{ id, name, m }],
//     objs:   [{ id, b (board id), k (kind), z, m, c (colour), … }],
//     tombs:  { id: ms } }                     (boards and objects)
// Kinds and their own fields:
//   note   x y w h tx                sticky note, text fitted inside
//   text   x y w h tx fs             free text, h follows the lines
//   shape  x y w h tx shp f sym?     rect | round | ellipse | diamond | tri,
//                                    f = fill none | soft | solid; sym = a
//                                    symbol of the diagram library (DG1),
//                                    shp then the nearest basic shape
//   arrow  ax ay bx by ao bo hd ds tx   ends are points, or stuck to
//                                    objects (ao / bo = their ids);
//                                    hd = end | both | none, ds = dashed
//   pen    x y w h pts sw            pts = [x0, y0, x1, y1, …] from x, y
//   image  x y w h src               a small JPEG / PNG / WebP data URI
//   frame  x y w h tx                a named area, drawn under the rest
// Sync rules (OROS_BIBLE.md Part I, Part VI): one row per object, the
// newer m wins, a tie goes to the larger JSON; merge(a, b) ===
// merge(b, a) and merge(a, a) === a; a tombstone at least as new as a
// row removes it, a newer edit brings it back (R17); an object whose
// board is gone is left out; no clock or random inside the merge;
// serialize() is canonical (rows sorted by id, tombs by key).
// FORWARD SAFE (DG1): a flat field this version does not know rides
// along unchanged (see extras()), and on equal stamps the row with
// more fields wins, so an older device that drops a newer field never
// takes it away from a newer device.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MAX_TEXT = 5000, MAX_NAME = 120, MAX_PTS = 4000;
  var IMG_LEN = 160000;                       // chars of one picture's data URI
  var IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;
  var KINDS = ["note", "text", "shape", "arrow", "pen", "image", "frame"];
  var SHAPES = ["rect", "round", "ellipse", "diamond", "tri"];
  var FILLS = ["none", "soft", "solid"];
  var HEADS = ["end", "both", "none"];
  // Diagram symbols (wave DG1): id: [group, nearest basic shape, w, h].
  // The drawing of each one is in GEO further down.
  var SYM_GROUPS = ["flow", "org", "uml", "basic", "net"];
  var SYMS = {
    process: ["flow", "rect", 160, 90], decision: ["flow", "diamond", 160, 110], terminator: ["flow", "round", 160, 70],
    data: ["flow", "rect", 160, 90], document: ["flow", "rect", 160, 100], documents: ["flow", "rect", 170, 110],
    predefined: ["flow", "rect", 160, 90], "manual-input": ["flow", "rect", 160, 90], "manual-op": ["flow", "rect", 160, 90],
    preparation: ["flow", "rect", 160, 90], database: ["flow", "rect", 120, 110], delay: ["flow", "round", 150, 90],
    "off-page": ["flow", "rect", 100, 100], connector: ["flow", "ellipse", 60, 60], merge: ["flow", "rect", 110, 90],
    person: ["org", "rect", 200, 80], unit: ["org", "rect", 220, 110],
    "class": ["uml", "rect", 200, 160], "interface": ["uml", "rect", 200, 140], actor: ["uml", "rect", 80, 130],
    usecase: ["uml", "ellipse", 180, 90], "package": ["uml", "rect", 200, 140], component: ["uml", "rect", 180, 100],
    comment: ["uml", "rect", 160, 110], node: ["uml", "rect", 180, 130], start: ["uml", "ellipse", 40, 40],
    end: ["uml", "ellipse", 44, 44],
    hexagon: ["basic", "rect", 140, 110], octagon: ["basic", "rect", 120, 120], star: ["basic", "rect", 120, 120],
    cross: ["basic", "rect", 100, 100], "arrow-right": ["basic", "rect", 160, 90], "arrow-both": ["basic", "rect", 180, 90],
    cloud: ["basic", "ellipse", 180, 120], callout: ["basic", "rect", 180, 120],
    server: ["net", "rect", 100, 130], router: ["net", "rect", 100, 130], "switch": ["net", "rect", 100, 130],
    firewall: ["net", "rect", 100, 130], internet: ["net", "rect", 100, 130], laptop: ["net", "rect", 100, 130],
    desktop: ["net", "rect", 100, 130], phone: ["net", "rect", 100, 130], tablet: ["net", "rect", 100, 130],
    "db-server": ["net", "rect", 100, 130], storage: ["net", "rect", 100, 130], user: ["net", "rect", 100, 130],
    printer: ["net", "rect", 100, 130], wifi: ["net", "rect", 100, 130]
  };
  var SYM_IDS = Object.keys(SYMS);
  // A symbol name of this or a later version (kept even when unknown).
  var SYM_RE = /^[a-z][a-z0-9-]{0,23}$/;
  function symOf(o) { return o && o.k === "shape" && o.sym && own(SYMS, o.sym) ? o.sym : ""; }
  // name: [strong, soft]. Notes are soft, lines and text are strong.
  var COLORS = {
    yellow: ["#e0a800", "#fff1a8"], orange: ["#e8590c", "#ffd8a8"], pink: ["#d6336c", "#fcc2d7"],
    red: ["#e03131", "#ffc9c9"], purple: ["#7048e8", "#d0bfff"], blue: ["#1c7ed6", "#a5d8ff"],
    teal: ["#0c8599", "#96f2d7"], green: ["#2f9e44", "#b2f2bb"], gray: ["#868e96", "#e9ecef"],
    ink: ["#1f2328", "#ced4da"]
  };
  var COLOR_KEYS = Object.keys(COLORS);
  var DEF_COLOR = { note: "yellow", text: "ink", shape: "blue", arrow: "ink", pen: "ink", image: "ink", frame: "gray" };
  var PAPER = "#fbfaf7", INK = "#1f2328";
  var FONT = "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Noto Sans\", sans-serif";
  var LH = 1.25;
  var FIT = [32, 28, 24, 20, 18, 16, 14, 12, 10];

  function empty() { return { ver: VER, boards: [], objs: [], tombs: {} }; }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function num(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 1e6 ? Math.round(v * 100) / 100 : null; }
  function size(v) { var n = num(v); return n !== null && n >= 1 && n <= 50000 ? n : null; }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function idOk(v) { return typeof v === "string" && v.length > 0 && v.length <= 64; }

  // Fields of a later version (FORWARD SAFE): a flat field with a
  // plain name that this version does not know is kept as it came:
  // a string up to 500 characters, a finite number, true / false or
  // a list of up to 64 numbers; at most 16 of them, sorted by name.
  var KNOWN = {};
  "id b k z m c x y w h tx fs shp f sym ax ay bx by ao bo hd ds pts sw src".split(" ").forEach(function (k) { KNOWN[k] = 1; });
  var EXTRA_RE = /^[a-z][a-zA-Z0-9]{0,15}$/, MAX_EXTRA = 16;
  function okNum(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 1e9; }
  function extraOk(v) {
    if (typeof v === "string") return v.length <= 500;
    if (typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.length <= 64 && v.every(okNum);
    return okNum(v);
  }
  function extras(raw, o) {
    Object.keys(raw).filter(function (k) { return !KNOWN[k] && EXTRA_RE.test(k) && extraOk(raw[k]); })
      .sort().slice(0, MAX_EXTRA).forEach(function (k) { o[k] = Array.isArray(raw[k]) ? raw[k].slice() : raw[k]; });
    return o;
  }

  function cleanBoard(raw) {
    if (!raw || typeof raw !== "object" || !idOk(raw.id)) return null;
    return { id: raw.id, name: str(raw.name, MAX_NAME), m: ms(raw.m) };
  }

  // A bad row is dropped, never repaired with a fresh id or time.
  function cleanObj(raw) {
    if (!raw || typeof raw !== "object" || !idOk(raw.id) || !idOk(raw.b)) return null;
    var k = raw.k;
    if (KINDS.indexOf(k) < 0) return null;
    var z = num(raw.z);
    var o = { id: raw.id, b: raw.b, k: k, z: z === null ? 0 : z, m: ms(raw.m), c: pick(raw.c, COLOR_KEYS, DEF_COLOR[k]) };
    if (k === "arrow") {
      var ax = num(raw.ax), ay = num(raw.ay), bx = num(raw.bx), by = num(raw.by);
      if (ax === null || ay === null || bx === null || by === null) return null;
      o.ax = ax; o.ay = ay; o.bx = bx; o.by = by;
      o.ao = idOk(raw.ao) ? raw.ao : "";
      o.bo = idOk(raw.bo) ? raw.bo : "";
      o.hd = pick(raw.hd, HEADS, "end");
      o.ds = raw.ds === true;
      o.tx = str(raw.tx, MAX_NAME);
      return extras(raw, o);
    }
    var x = num(raw.x), y = num(raw.y), w = size(raw.w), h = size(raw.h);
    if (x === null || y === null || w === null || h === null) return null;
    o.x = x; o.y = y; o.w = w; o.h = h;
    if (k === "note" || k === "text" || k === "shape") o.tx = str(raw.tx, MAX_TEXT);
    if (k === "frame") o.tx = str(raw.tx, MAX_NAME);
    if (k === "text") { var fs = num(raw.fs); o.fs = fs !== null && fs >= 8 && fs <= 200 ? Math.round(fs) : 24; }
    if (k === "shape") {
      o.shp = pick(raw.shp, SHAPES, "rect"); o.f = pick(raw.f, FILLS, "soft");
      if (typeof raw.sym === "string" && SYM_RE.test(raw.sym)) o.sym = raw.sym;   // written only when set
    }
    if (k === "pen") {
      var p = raw.pts;
      if (!Array.isArray(p) || p.length < 2 || p.length > MAX_PTS || p.length % 2) return null;
      var pts = [];
      for (var i = 0; i < p.length; i++) { var v = num(p[i]); if (v === null) return null; pts.push(v); }
      o.pts = pts;
      var sw = num(raw.sw);
      o.sw = sw !== null && sw >= 1 && sw <= 40 ? sw : 3;
    }
    if (k === "image") {
      if (typeof raw.src !== "string" || raw.src.length > IMG_LEN || !IMG_RE.test(raw.src)) return null;
      o.src = raw.src;
    }
    return extras(raw, o);
  }

  // Equal stamps: the row with more fields wins, then the larger JSON.
  // An older version drops the fields it does not know without a new
  // stamp, so counting fields first keeps the fuller row; it is still
  // one total order, so merge(a, b) === merge(b, a).
  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    var na = Object.keys(a).length, nb = Object.keys(b).length;
    if (na !== nb) return na > nb;
    return JSON.stringify(a) > JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function mergeLists(list) {
    var boards = {}, objs = {}, tombs = {};
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      (Array.isArray(d.boards) ? d.boards : []).forEach(function (raw) {
        var b = cleanBoard(raw);
        if (b && (!own(boards, b.id) || newer(b, boards[b.id]))) boards[b.id] = b;
      });
      (Array.isArray(d.objs) ? d.objs : []).forEach(function (raw) {
        var o = cleanObj(raw);
        if (o && (!own(objs, o.id) || newer(o, objs[o.id]))) objs[o.id] = o;
      });
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && id.length <= 64 && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    var out = empty();
    var alive = function (r) { return !(own(tombs, r.id) && tombs[r.id] >= r.m); };
    out.boards = Object.keys(boards).map(function (id) { return boards[id]; }).filter(alive).sort(byId);
    var live = {};
    out.boards.forEach(function (b) { live[b.id] = 1; });
    out.objs = Object.keys(objs).map(function (id) { return objs[id]; })
      .filter(function (o) { return alive(o) && own(live, o.b); })
      .sort(byId);
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  function normalize(d) { return mergeLists([d]); }
  function merge(local, remote) { return mergeLists([local, remote]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- edits (the app passes the clock in) ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function stamp(d, id, prev, now) {
    return Math.max(now, prev ? prev.m + 1 : 0, own(d.tombs, id) ? d.tombs[id] + 1 : 0);
  }

  // rows = { id: object (the new state) | null (delete) }. One call
  // is one undo step in the app. Returns the new data.
  function apply(d, rows, now) {
    var out = normalize(d);
    var at = {};
    out.objs.forEach(function (o, i) { at[o.id] = i; });
    Object.keys(rows).forEach(function (id) {
      var row = rows[id], prev = own(at, id) ? out.objs[at[id]] : null;
      if (row === null) {
        if (prev) out.tombs[id] = Math.max(now, prev.m);
        return;
      }
      var o = cleanObj(row);
      if (!o || o.id !== id) return;
      o.m = stamp(out, id, prev, now);
      delete out.tombs[id];
      if (prev) out.objs[at[id]] = o; else { at[id] = out.objs.length; out.objs.push(o); }
    });
    return normalize(out);
  }

  function putBoard(d, id, name, now) {
    var out = normalize(d);
    var prev = out.boards.filter(function (b) { return b.id === id; })[0] || null;
    var b = { id: id, name: str(name, MAX_NAME), m: stamp(out, id, prev, now) };
    delete out.tombs[id];
    out.boards = out.boards.filter(function (x) { return x.id !== id; }).concat([b]);
    return normalize(out);
  }

  // The board and everything on it.
  function removeBoard(d, id, now) {
    var out = normalize(d);
    out.boards.forEach(function (b) { if (b.id === id) out.tombs[id] = Math.max(now, b.m); });
    out.objs.forEach(function (o) { if (o.b === id) out.tombs[o.id] = Math.max(now, o.m); });
    return normalize(out);
  }

  function boards(d) {
    return d.boards.slice().sort(function (a, b) { return byId(a, b); });
  }
  function board(d, id) { return d.boards.filter(function (b) { return b.id === id; })[0] || null; }

  // Drawing order: frames first, then by z, then by id.
  function objsOf(d, boardId) {
    return d.objs.filter(function (o) { return o.b === boardId; }).sort(function (a, b) {
      var fa = a.k === "frame" ? 0 : 1, fb = b.k === "frame" ? 0 : 1;
      return fa - fb || a.z - b.z || byId(a, b);
    });
  }
  function zTop(d, boardId) {
    var z = 0;
    d.objs.forEach(function (o) { if (o.b === boardId && o.z > z) z = o.z; });
    return Math.floor(z) + 1;
  }
  function zBottom(d, boardId) {
    var z = 0;
    d.objs.forEach(function (o) { if (o.b === boardId && o.z < z) z = o.z; });
    return Math.ceil(z) - 1;
  }

  // Copies with fresh ids (newId() from the app), moved by dx, dy.
  // Arrows stuck to a copied object stick to its copy; to anything
  // else they come loose where they were drawn.
  function copies(objs, newId, dx, dy, z0) {
    var map = {}, out = [];
    objs.forEach(function (o) { map[o.id] = newId(); });
    objs.forEach(function (o, i) {
      var c = JSON.parse(JSON.stringify(o));
      c.id = map[o.id];
      c.z = (z0 || 0) + i;
      if (c.k === "arrow") {
        c.ax += dx; c.ay += dy; c.bx += dx; c.by += dy;
        c.ao = c.ao && own(map, c.ao) ? map[c.ao] : "";
        c.bo = c.bo && own(map, c.bo) ? map[c.bo] : "";
      } else { c.x += dx; c.y += dy; }
      out.push(c);
    });
    return out;
  }

  // ---------- text ----------
  function approx(s, fs) { return s.length * fs * 0.56; }

  // Lines of text that fit maxW, at font size fs. Long words break.
  function wrap(text, maxW, fs, measure) {
    var mw = measure || approx, out = [];
    String(text || "").split("\n").forEach(function (para) {
      var words = para.split(/ +/), line = "";
      if (!para) { out.push(""); return; }
      words.forEach(function (w) {
        var tryL = line ? line + " " + w : w;
        if (mw(tryL, fs) <= maxW || !line && w.length < 2) { line = tryL; return; }
        if (line) out.push(line);
        line = "";
        while (mw(w, fs) > maxW && w.length > 1) {
          var n = w.length - 1;
          while (n > 1 && mw(w.slice(0, n), fs) > maxW) n--;
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        line = w;
      });
      out.push(line);
    });
    return out;
  }

  // The largest size from FIT (at most `max`) whose lines fit w × h.
  function fit(text, w, h, max, measure) {
    for (var i = 0; i < FIT.length; i++) {
      var fs = FIT[i];
      if (fs > max) continue;
      var lines = wrap(text, w, fs, measure);
      if (lines.length * fs * LH <= h) return { fs: fs, lines: lines };
    }
    var small = FIT[FIT.length - 1], all = wrap(text, w, small, measure);
    return { fs: small, lines: all.slice(0, Math.max(1, Math.floor(h / (small * LH)))), cut: true };
  }

  function textHeight(o, measure) {
    return Math.max(o.fs * LH, wrap(o.tx, o.w, o.fs, measure).length * o.fs * LH);
  }

  // ---------- geometry ----------
  function center(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }

  // Where the ray from o's centre toward p leaves o's outline (+gap).
  function edge(o, p, gap) {
    var c = center(o), dx = p.x - c.x, dy = p.y - c.y;
    var g = gap === undefined ? 6 : gap;
    if (!dx && !dy) return c;
    var hw = o.w / 2, hh = o.h / 2, t;
    if (o.k === "shape" && o.shp === "ellipse") t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    else if (o.k === "shape" && o.shp === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    if (t >= 1) return c;                       // p is inside: point at the centre
    var len = Math.sqrt(dx * dx + dy * dy);
    return { x: c.x + dx * t + dx / len * g, y: c.y + dy * t + dy / len * g };
  }

  // The two ends of an arrow, after sticking to live objects.
  function ends(a, byIdMap) {
    var A = a.ao && byIdMap[a.ao] && byIdMap[a.ao].k !== "arrow" ? byIdMap[a.ao] : null;
    var B = a.bo && byIdMap[a.bo] && byIdMap[a.bo].k !== "arrow" ? byIdMap[a.bo] : null;
    var pa = A ? center(A) : { x: a.ax, y: a.ay }, pb = B ? center(B) : { x: a.bx, y: a.by };
    return { a: A ? edge(A, pb) : pa, b: B ? edge(B, pa) : pb };
  }

  function index(list) {
    var m = {};
    list.forEach(function (o) { m[o.id] = o; });
    return m;
  }

  // Box of one object (text height measured when measure is given).
  function box(o, byIdMap, measure) {
    if (o.k === "arrow") {
      var e = ends(o, byIdMap || {});
      var x = Math.min(e.a.x, e.b.x), y = Math.min(e.a.y, e.b.y);
      return { x: x, y: y, w: Math.max(1, Math.abs(e.a.x - e.b.x)), h: Math.max(1, Math.abs(e.a.y - e.b.y)) };
    }
    if (o.k === "text" && measure) return { x: o.x, y: o.y, w: o.w, h: textHeight(o, measure) };
    if (o.k === "frame") return { x: o.x, y: o.y - 24, w: o.w, h: o.h + 24 };
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }

  function bounds(list, measure, pad) {
    var m = index(list), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (o) {
      var b = box(o, m, measure);
      var sw = o.k === "pen" ? o.sw : o.k === "arrow" ? 12 : 0;
      x0 = Math.min(x0, b.x - sw); y0 = Math.min(y0, b.y - sw);
      x1 = Math.max(x1, b.x + b.w + sw); y1 = Math.max(y1, b.y + b.h + sw);
    });
    if (x0 === Infinity) return null;
    var p = pad === undefined ? 40 : pad;
    return { x: Math.floor(x0 - p), y: Math.floor(y0 - p), w: Math.ceil(x1 - x0 + 2 * p), h: Math.ceil(y1 - y0 + 2 * p) };
  }

  function overlaps(a, r) { return a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y; }
  function inside(a, r) { return a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h; }

  // Ids of the objects a marquee r touches.
  function inRect(list, r, measure) {
    var m = index(list);
    return list.filter(function (o) { return overlaps(box(o, m, measure), r); }).map(function (o) { return o.id; });
  }

  // What a frame holds: everything whose box lies inside it, the
  // frame itself first (export of one frame).
  function inFrame(list, frame, measure) {
    var m = index(list), r = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    return [frame].concat(list.filter(function (o) {
      return o.id !== frame.id && inside(box(o, m, measure), r);
    }));
  }

  // Fewer points for a hand-drawn line (Ramer-Douglas-Peucker).
  function simplify(pts, tol) {
    var n = pts.length / 2;
    if (n <= 2) return pts.slice();
    var keep = new Array(n), stack = [[0, n - 1]];
    keep[0] = keep[n - 1] = true;
    while (stack.length) {
      var s = stack.pop(), a = s[0], b = s[1], best = -1, bi = -1;
      var ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      for (var i = a + 1; i < b; i++) {
        var px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay, dd;
        if (!L) dd = px * px + py * py;
        else {
          var t = Math.max(0, Math.min(1, (px * dx + py * dy) / L));
          var qx = px - t * dx, qy = py - t * dy;
          dd = qx * qx + qy * qy;
        }
        if (dd > best) { best = dd; bi = i; }
      }
      if (bi > 0 && best > tol * tol) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
    }
    var out = [];
    for (var j = 0; j < n; j++) if (keep[j]) out.push(pts[j * 2], pts[j * 2 + 1]);
    return out;
  }

  // A pen object from absolute points (the app passes them in).
  function penFrom(abs, base) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < abs.length; i += 2) {
      x0 = Math.min(x0, abs[i]); y0 = Math.min(y0, abs[i + 1]);
      x1 = Math.max(x1, abs[i]); y1 = Math.max(y1, abs[i + 1]);
    }
    var o = JSON.parse(JSON.stringify(base));
    o.k = "pen"; o.x = r2(x0); o.y = r2(y0); o.w = Math.max(1, r2(x1 - x0)); o.h = Math.max(1, r2(y1 - y0));
    o.pts = [];
    for (i = 0; i < abs.length; i += 2) o.pts.push(r2(abs[i] - x0), r2(abs[i + 1] - y0));
    return o;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  // Moved / resized copy. Pen points and arrows that are not stuck
  // follow; a resize scales the pen's points.
  function moved(o, dx, dy) {
    var c = JSON.parse(JSON.stringify(o));
    if (c.k === "arrow") {
      if (!c.ao) { c.ax = r2(c.ax + dx); c.ay = r2(c.ay + dy); }
      if (!c.bo) { c.bx = r2(c.bx + dx); c.by = r2(c.by + dy); }
    } else { c.x = r2(c.x + dx); c.y = r2(c.y + dy); }
    return c;
  }
  function resized(o, w, h) {
    var c = JSON.parse(JSON.stringify(o));
    w = Math.max(8, r2(w)); h = Math.max(8, r2(h));
    if (c.k === "pen") {
      var sx = w / c.w, sy = h / c.h;
      c.pts = c.pts.map(function (v, i) { return r2(v * (i % 2 ? sy : sx)); });
    }
    c.w = w; c.h = h;
    return c;
  }

  // ---------- drawing: a scene of plain nodes ----------
  // A node is { tag, a: {attr: value}, text?, kids? }. The app makes
  // DOM elements from it (createElementNS + textContent); toSvg()
  // writes the same nodes as an escaped SVG file. live: true adds
  // the wide, invisible hit areas the screen needs.
  function n(tag, a, kids, text) {
    var o = { tag: tag, a: a || {} };
    if (kids) o.kids = kids;
    if (text !== undefined) o.text = text;
    return o;
  }
  function col(o, i) { return COLORS[o.c] ? COLORS[o.c][i] : COLORS.ink[i]; }

  function textLines(lines, x, y, fs, anchor, fill, more) {
    var a = { x: x, y: y, "font-size": fs, "font-family": FONT, fill: fill, "text-anchor": anchor };
    if (more) Object.keys(more).forEach(function (k) { a[k] = more[k]; });
    return n("text", a,
      lines.map(function (l, i) {
        return n("tspan", { x: x, dy: i ? r2(fs * LH) : r2(fs * 0.95) }, null, l || " ");
      }));
  }

  function shapePath(o) {
    var x = o.x, y = o.y, w = o.w, h = o.h;
    if (o.shp === "ellipse") return n("ellipse", { cx: r2(x + w / 2), cy: r2(y + h / 2), rx: r2(w / 2), ry: r2(h / 2) });
    if (o.shp === "diamond") return n("path", { d: "M" + r2(x + w / 2) + " " + y + "L" + r2(x + w) + " " + r2(y + h / 2) + "L" + r2(x + w / 2) + " " + r2(y + h) + "L" + x + " " + r2(y + h / 2) + "Z" });
    if (o.shp === "tri") return n("path", { d: "M" + r2(x + w / 2) + " " + y + "L" + r2(x + w) + " " + r2(y + h) + "L" + x + " " + r2(y + h) + "Z" });
    return n("rect", { x: x, y: y, width: w, height: h, rx: o.shp === "round" ? Math.min(16, w / 4, h / 4) : 0 });
  }

  // ---------- diagram symbols: the drawing ----------
  // Each symbol is drawn in a 100 × 100 grid: m "fit" stretches it to
  // the object's box, m "icon" keeps it square (icons, and the round
  // start / end nodes). lab: the text goes under the icon (the icon
  // takes the top 72 %). tb: the text box as parts of the box
  // [left, top, right, bottom]. cls: a UML class (1) or interface (2),
  // with compartments from the text. p: what to draw, in order:
  //   [role, "M x y L x y C … Q … Z"]   a path (absolute, grid units)
  //   [role + "c", cx, cy, r]           a circle (an ellipse in "fit")
  //   [role + "r", x, y, w, h, rx]      a rectangle, rx in pixels or "pill"
  // Roles: b body (the fill, a strong outline), l a line on the body
  // (paper-coloured on a full-colour body), L a line that is always
  // strong, s a dot on the body (paper-coloured on full colour), S a
  // dot that is always strong, w a paper-filled part with an outline.
  var STAR = (function () {
    var d = "";
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 20 : 50;
      d += (i ? "L" : "M") + r2(50 + r * Math.cos(a)) + " " + r2(50 + r * Math.sin(a) * 1.05 + 3);
    }
    return d + "Z";
  })();
  var CYL = [["b", "M0 12C0 -4 100 -4 100 12L100 88C100 104 0 104 0 88Z"], ["l", "M0 12C0 28 100 28 100 12"]];
  var GEO = {
    process: { m: "fit", p: [["br", 0, 0, 100, 100, 0]] },
    decision: { m: "fit", tb: [0.22, 0.22, 0.78, 0.78], p: [["b", "M50 0L100 50L50 100L0 50Z"]] },
    terminator: { m: "fit", tb: [0.12, 0.08, 0.88, 0.92], p: [["br", 0, 0, 100, 100, "pill"]] },
    data: { m: "fit", tb: [0.2, 0.06, 0.8, 0.94], p: [["b", "M20 0L100 0L80 100L0 100Z"]] },
    document: { m: "fit", tb: [0.05, 0.05, 0.95, 0.8], p: [["b", "M0 0L100 0L100 82C80 72 65 72 50 84C35 96 18 96 0 86Z"]] },
    documents: { m: "fit", tb: [0.05, 0.16, 0.84, 0.82], p: [["L", "M12 6L12 0L100 0L100 70L94 70"], ["L", "M6 12L6 6L94 6L94 76L88 76"],
      ["b", "M0 12L88 12L88 88C70 80 58 80 44 90C30 100 14 100 0 92Z"]] },
    predefined: { m: "fit", tb: [0.12, 0.06, 0.88, 0.94], p: [["br", 0, 0, 100, 100, 0], ["l", "M10 0L10 100M90 0L90 100"]] },
    "manual-input": { m: "fit", tb: [0.05, 0.3, 0.95, 0.95], p: [["b", "M0 28L100 0L100 100L0 100Z"]] },
    "manual-op": { m: "fit", tb: [0.2, 0.06, 0.8, 0.94], p: [["b", "M0 0L100 0L80 100L20 100Z"]] },
    preparation: { m: "fit", tb: [0.16, 0.06, 0.84, 0.94], p: [["b", "M15 0L85 0L100 50L85 100L15 100L0 50Z"]] },
    database: { m: "fit", tb: [0.06, 0.3, 0.94, 0.92], p: CYL },
    delay: { m: "fit", tb: [0.05, 0.08, 0.8, 0.92], p: [["b", "M0 0L60 0C113 0 113 100 60 100L0 100Z"]] },
    "off-page": { m: "fit", tb: [0.08, 0.06, 0.92, 0.68], p: [["b", "M0 0L100 0L100 70L50 100L0 70Z"]] },
    connector: { m: "fit", tb: [0.16, 0.16, 0.84, 0.84], p: [["bc", 50, 50, 50]] },
    merge: { m: "fit", tb: [0.22, 0.04, 0.78, 0.5], p: [["b", "M0 0L100 0L50 100Z"]] },
    person: { m: "fit", tb: [0.1, 0.06, 0.96, 0.94], p: [["br", 0, 0, 100, 100, 0], ["sr", 0, 0, 5, 100, 0]] },
    unit: { m: "fit", tb: [0.05, 0.28, 0.95, 0.94], p: [["br", 0, 0, 100, 100, 0], ["sr", 0, 0, 100, 18, 0]] },
    "class": { m: "fit", cls: 1, p: [["br", 0, 0, 100, 100, 0]] },
    "interface": { m: "fit", cls: 2, p: [["br", 0, 0, 100, 100, 0]] },
    actor: { m: "icon", lab: 1, p: [["Lc", 50, 15, 12], ["L", "M50 27L50 62M22 40L78 40M50 62L28 97M50 62L72 97"]] },
    usecase: { m: "fit", tb: [0.14, 0.14, 0.86, 0.86], p: [["bc", 50, 50, 50]] },
    "package": { m: "fit", tb: [0.05, 0.24, 0.95, 0.95], p: [["b", "M0 0L42 0L42 18L0 18Z"], ["b", "M0 18L100 18L100 100L0 100Z"]] },
    component: { m: "fit", tb: [0.2, 0.06, 0.95, 0.94], p: [["b", "M10 0L100 0L100 100L10 100Z"], ["wr", 0, 18, 20, 16, 0], ["wr", 0, 62, 20, 16, 0]] },
    comment: { m: "fit", tb: [0.06, 0.08, 0.9, 0.94], p: [["b", "M0 0L82 0L100 18L100 100L0 100Z"], ["l", "M82 0L82 18L100 18"]] },
    node: { m: "fit", tb: [0.05, 0.22, 0.8, 0.95], p: [["b", "M0 15L15 0L100 0L85 15Z"], ["b", "M85 15L100 0L100 85L85 100Z"], ["b", "M0 15L85 15L85 100L0 100Z"]] },
    start: { m: "icon", p: [["Sc", 50, 50, 50]] },
    end: { m: "icon", p: [["Lc", 50, 50, 48], ["Sc", 50, 50, 32]] },
    hexagon: { m: "fit", tb: [0.2, 0.08, 0.8, 0.92], p: [["b", "M25 0L75 0L100 50L75 100L25 100L0 50Z"]] },
    octagon: { m: "fit", tb: [0.12, 0.12, 0.88, 0.88], p: [["b", "M30 0L70 0L100 30L100 70L70 100L30 100L0 70L0 30Z"]] },
    star: { m: "fit", tb: [0.3, 0.36, 0.7, 0.72], p: [["b", STAR]] },
    cross: { m: "fit", tb: [0.1, 0.36, 0.9, 0.64], p: [["b", "M35 0L65 0L65 35L100 35L100 65L65 65L65 100L35 100L35 65L0 65L0 35L35 35Z"]] },
    "arrow-right": { m: "fit", tb: [0.04, 0.32, 0.72, 0.68], p: [["b", "M0 30L65 30L65 0L100 50L65 100L65 70L0 70Z"]] },
    "arrow-both": { m: "fit", tb: [0.2, 0.32, 0.8, 0.68], p: [["b", "M0 50L25 0L25 30L75 30L75 0L100 50L75 100L75 70L25 70L25 100Z"]] },
    cloud: { m: "fit", tb: [0.16, 0.24, 0.84, 0.84], p: [["b", "M25 90C5 90 0 70 12 60C0 45 15 25 32 32C38 10 68 8 74 28C92 22 104 45 92 58C104 72 92 92 75 88C65 100 38 100 25 90Z"]] },
    callout: { m: "fit", tb: [0.05, 0.06, 0.95, 0.72], p: [["b", "M0 0L100 0L100 76L45 76L22 100L26 76L0 76Z"]] },
    server: { m: "icon", lab: 1, p: [["br", 24, 4, 52, 92, 4], ["l", "M32 22L68 22M32 38L68 38M32 54L68 54"], ["sc", 36, 80, 4], ["sc", 50, 80, 4]] },
    router: { m: "icon", lab: 1, p: [["b", "M4 38C4 22 96 22 96 38L96 64C96 80 4 80 4 64Z"], ["l", "M4 38C4 54 96 54 96 38"],
      ["l", "M34 34L66 42M66 34L34 42"]] },
    "switch": { m: "icon", lab: 1, p: [["br", 4, 32, 92, 36, 4], ["sr", 12, 48, 9, 9, 0], ["sr", 26, 48, 9, 9, 0], ["sr", 40, 48, 9, 9, 0],
      ["sr", 54, 48, 9, 9, 0], ["sr", 68, 48, 9, 9, 0], ["sc", 84, 42, 3]] },
    firewall: { m: "icon", lab: 1, p: [["br", 6, 12, 88, 76, 0],
      ["l", "M6 31L94 31M6 50L94 50M6 69L94 69M50 12L50 31M28 31L28 50M72 31L72 50M50 50L50 69M28 69L28 88M72 69L72 88"]] },
    internet: { m: "icon", lab: 1, p: [["bc", 50, 50, 46], ["l", "M4 50L96 50M50 4C24 24 24 76 50 96M50 4C76 24 76 76 50 96M12 27L88 27M12 73L88 73"]] },
    laptop: { m: "icon", lab: 1, p: [["br", 16, 16, 68, 50, 3], ["wr", 22, 22, 56, 38, 0], ["b", "M6 70L94 70L100 82L0 82Z"]] },
    desktop: { m: "icon", lab: 1, p: [["br", 6, 8, 88, 60, 3], ["wr", 12, 14, 76, 48, 0], ["L", "M50 68L50 84M30 90L70 90"]] },
    phone: { m: "icon", lab: 1, p: [["br", 28, 2, 44, 96, 7], ["l", "M43 10L57 10"], ["sc", 50, 88, 4]] },
    tablet: { m: "icon", lab: 1, p: [["br", 12, 10, 76, 80, 6], ["wr", 18, 16, 64, 62, 0], ["sc", 50, 84, 3]] },
    "db-server": { m: "icon", lab: 1, p: [["b", "M14 14C14 2 86 2 86 14L86 86C86 98 14 98 14 86Z"], ["l", "M14 14C14 26 86 26 86 14M14 38C14 50 86 50 86 38M14 62C14 74 86 74 86 62"]] },
    storage: { m: "icon", lab: 1, p: [["br", 8, 16, 84, 68, 4], ["l", "M8 39L92 39M8 61L92 61M18 28L54 28M18 50L54 50M18 72L54 72"],
      ["sc", 80, 28, 4], ["sc", 80, 50, 4], ["sc", 80, 72, 4]] },
    user: { m: "icon", lab: 1, p: [["bc", 50, 28, 20], ["b", "M12 98C12 62 88 62 88 98Z"]] },
    printer: { m: "icon", lab: 1, p: [["wr", 26, 8, 48, 32, 0], ["br", 8, 36, 84, 40, 6], ["wr", 26, 62, 48, 32, 0], ["sc", 80, 46, 3]] },
    wifi: { m: "icon", lab: 1, p: [["Sc", 50, 82, 7], ["L", "M30 62C40 51 60 51 70 62M17 47C35 28 65 28 83 47M4 32C30 6 70 6 96 32"]] }
  };

  // A grid path in pixels: x → ox + x · sx, y → oy + y · sy.
  function gridPath(d, ox, oy, sx, sy) {
    var i = 0;
    return d.replace(/-?\d*\.?\d+/g, function (v) {
      var out = (i++ % 2) ? oy + parseFloat(v) * sy : ox + parseFloat(v) * sx;
      return String(r2(out));
    });
  }

  function drawSym(o, def, strong, soft, opt, kids) {
    var X = o.x, Y = o.y, W = o.w, H = o.h, iconH = def.lab ? H * 0.72 : H, sx, sy, ox, oy;
    if (def.m === "icon") {
      var side = Math.max(1, Math.min(W, iconH));
      sx = sy = side / 100; ox = X + (W - side) / 2; oy = Y + (iconH - side) / 2;
    } else { sx = W / 100; sy = H / 100; ox = X; oy = Y; }
    var solid = o.f === "solid", fill = solid ? strong : o.f === "soft" ? soft : "none";
    if (opt.live) kids.push(n("rect", { x: X, y: Y, width: W, height: H, fill: "transparent" }));
    def.p.forEach(function (pr) {
      var role = pr[0].charAt(0), type = pr[0].charAt(1), nd;
      if (type === "c") {
        nd = def.m === "icon" ? n("circle", { cx: r2(ox + pr[1] * sx), cy: r2(oy + pr[2] * sy), r: r2(pr[3] * sx) })
          : n("ellipse", { cx: r2(ox + pr[1] * sx), cy: r2(oy + pr[2] * sy), rx: r2(pr[3] * sx), ry: r2(pr[3] * sy) });
      } else if (type === "r") {
        var rw = pr[3] * sx, rh = pr[4] * sy;
        nd = n("rect", { x: r2(ox + pr[1] * sx), y: r2(oy + pr[2] * sy), width: r2(rw), height: r2(rh),
          rx: pr[5] === "pill" ? r2(Math.min(rw, rh) / 2) : Math.min(pr[5], rw / 4, rh / 4) });
      } else nd = n("path", { d: gridPath(pr[1], ox, oy, sx, sy) });
      var a = nd.a;
      if (role === "b") { a.fill = fill; a.stroke = strong; a["stroke-width"] = 2; a["stroke-linejoin"] = "round"; }
      else if (role === "w") { a.fill = PAPER; a.stroke = strong; a["stroke-width"] = 2; a["stroke-linejoin"] = "round"; }
      else if (role === "l" || role === "L") {
        a.fill = "none"; a.stroke = role === "l" && solid ? PAPER : strong; a["stroke-width"] = 2;
        a["stroke-linecap"] = "round"; a["stroke-linejoin"] = "round";
      } else a.fill = role === "s" && solid ? PAPER : strong;
      kids.push(nd);
    });
    var ink = solid && !def.lab ? "#ffffff" : INK;
    if (def.cls) { drawClass(o, def.cls === 2, strong, solid, ink, opt.measure, kids); return; }
    if (!o.tx) return;
    var tb = def.tb || [0.06, 0.06, 0.94, 0.94], bx, by, bw, bh, max = 28;
    if (def.lab) { bx = X; by = Y + iconH + 2; bw = W; bh = Math.max(10, H - iconH - 2); max = 16; }
    else { bx = X + tb[0] * W; by = Y + tb[1] * H; bw = (tb[2] - tb[0]) * W; bh = (tb[3] - tb[1]) * H; }
    var f = fit(o.tx, Math.max(8, bw - 8), Math.max(10, bh - 4), max, opt.measure), th = f.lines.length * f.fs * LH;
    kids.push(textLines(f.lines, r2(bx + bw / 2), r2(def.lab ? by : by + (bh - th) / 2), f.fs, "middle", ink));
  }

  // A UML class: the first part of the text is its name, a line of
  // two or more dashes starts the next compartment (attributes, then
  // methods). The largest size up to 16 whose lines all fit is used.
  function drawClass(o, iface, strong, solid, ink, measure, kids) {
    var secs = [[]];
    String(o.tx || "").split("\n").forEach(function (l) {
      if (/^\s*-{2,}\s*$/.test(l)) secs.push([]); else secs[secs.length - 1].push(l);
    });
    var head = secs[0].length ? secs[0] : [""], rest = secs.slice(1), W = o.w, H = o.h;
    if (iface) head = ["«interface»"].concat(head);
    var pickFs = null, hw, rw, wr;
    for (var i = 0; i < FIT.length && !pickFs; i++) {
      var fs = FIT[i];
      if (fs > 16) continue;
      wr = function (lines) { var out = []; lines.forEach(function (l) { wrap(l, W - 16, fs, measure).forEach(function (x) { out.push(x); }); }); return out; };
      hw = wr(head); rw = rest.map(wr);
      var tot = hw.length * fs * LH + 12;
      rw.forEach(function (r) { tot += Math.max(1, r.length) * fs * LH + 10; });
      if (tot <= H || fs === FIT[FIT.length - 1]) pickFs = fs;
    }
    var line = solid ? PAPER : strong, y = o.y + 6;
    kids.push(textLines(hw, r2(o.x + W / 2), r2(y), pickFs, "middle", ink, { "font-weight": 600 }));
    y += hw.length * pickFs * LH + 6;
    if (!rw.length) rw = [[]];
    rw.forEach(function (r) {
      if (y >= o.y + H - 2) return;
      kids.push(n("path", { d: "M" + o.x + " " + r2(y) + "L" + r2(o.x + W) + " " + r2(y), stroke: line, "stroke-width": 1.5, fill: "none" }));
      var room = Math.floor((o.y + H - y - 6) / (pickFs * LH));
      if (r.length && room > 0) kids.push(textLines(r.slice(0, room), r2(o.x + 8), r2(y + 5), pickFs, "start", ink));
      y += Math.max(1, r.length) * pickFs * LH + 10;
    });
  }

  function penPath(o) {
    var p = o.pts, d = "M" + r2(o.x + p[0]) + " " + r2(o.y + p[1]);
    if (p.length === 2) return d + "l0.01 0";
    for (var i = 2; i < p.length - 2; i += 2) {        // through the midpoints: a smooth line
      var mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      d += "Q" + r2(o.x + p[i]) + " " + r2(o.y + p[i + 1]) + " " + r2(o.x + mx) + " " + r2(o.y + my);
    }
    return d + "L" + r2(o.x + p[p.length - 2]) + " " + r2(o.y + p[p.length - 1]);
  }

  function head(tip, from, sw) {
    var dx = tip.x - from.x, dy = tip.y - from.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / L, uy = dy / L, s = 8 + sw * 2;
    var bx = tip.x - ux * s, by = tip.y - uy * s;
    return "M" + r2(tip.x) + " " + r2(tip.y) + "L" + r2(bx - uy * s * 0.55) + " " + r2(by + ux * s * 0.55) +
      "L" + r2(bx + uy * s * 0.55) + " " + r2(by - ux * s * 0.55) + "Z";
  }

  function draw(o, m, opt) {
    var g = { "data-id": o.id }, kids = [], measure = opt.measure, live = opt.live;
    var strong = col(o, 0), soft = col(o, 1);
    if (o.k === "note") {
      kids.push(n("rect", { x: o.x, y: o.y, width: o.w, height: o.h, rx: 4, fill: soft, stroke: "rgba(0,0,0,0.12)" }));
      if (o.tx) {
        var f = fit(o.tx, o.w - 24, o.h - 24, 32, measure);
        var th = f.lines.length * f.fs * LH;
        kids.push(textLines(f.lines, r2(o.x + o.w / 2), r2(o.y + (o.h - th) / 2), f.fs, "middle", INK));
      }
    } else if (o.k === "text") {
      if (live) kids.push(n("rect", { x: o.x, y: o.y, width: o.w, height: r2(textHeight(o, measure)), fill: "transparent" }));
      kids.push(textLines(wrap(o.tx, o.w, o.fs, measure), o.x, o.y, o.fs, "start", strong));
    } else if (o.k === "shape" && symOf(o)) {
      drawSym(o, GEO[o.sym], strong, soft, opt, kids);
    } else if (o.k === "shape") {
      var s = shapePath(o);
      s.a.fill = o.f === "solid" ? strong : o.f === "soft" ? soft : live ? "transparent" : "none";
      s.a.stroke = strong;
      s.a["stroke-width"] = 2;
      kids.push(s);
      if (o.tx) {
        var top = o.shp === "tri" ? o.h * 0.4 : 0, inset = o.shp === "rect" || o.shp === "round" ? 0.9 : 0.68;
        var fs2 = fit(o.tx, o.w * inset - 8, (o.h - top) * inset - 8, 28, measure);
        var th2 = fs2.lines.length * fs2.fs * LH;
        kids.push(textLines(fs2.lines, r2(o.x + o.w / 2), r2(o.y + top + (o.h - top - th2) / 2), fs2.fs, "middle",
          o.f === "solid" ? "#ffffff" : INK));
      }
    } else if (o.k === "arrow") {
      var e = ends(o, m), d = "M" + r2(e.a.x) + " " + r2(e.a.y) + "L" + r2(e.b.x) + " " + r2(e.b.y);
      if (live) kids.push(n("path", { d: d, stroke: "transparent", "stroke-width": 18, fill: "none" }));
      var line = { d: d, stroke: strong, "stroke-width": 2.5, fill: "none", "stroke-linecap": "round" };
      if (o.ds) line["stroke-dasharray"] = "8 6";
      kids.push(n("path", line));
      if (o.hd !== "none") kids.push(n("path", { d: head(e.b, e.a, 2.5), fill: strong }));
      if (o.hd === "both") kids.push(n("path", { d: head(e.a, e.b, 2.5), fill: strong }));
      if (o.tx) {
        var mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2, lw = (measure || approx)(o.tx, 14) + 12;
        kids.push(n("rect", { x: r2(mx - lw / 2), y: r2(my - 12), width: r2(lw), height: 24, rx: 6, fill: PAPER }));
        kids.push(textLines([o.tx], r2(mx), r2(my - 9), 14, "middle", strong));
      }
    } else if (o.k === "pen") {
      var pd = penPath(o);
      if (live) kids.push(n("path", { d: pd, stroke: "transparent", "stroke-width": Math.max(16, o.sw + 12), fill: "none", "stroke-linecap": "round" }));
      kids.push(n("path", { d: pd, stroke: strong, "stroke-width": o.sw, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    } else if (o.k === "image") {
      kids.push(n("image", { x: o.x, y: o.y, width: o.w, height: o.h, href: o.src, preserveAspectRatio: "none" }));
    } else if (o.k === "frame") {
      kids.push(n("rect", { x: o.x, y: o.y, width: o.w, height: o.h, rx: 6, fill: "rgba(255,255,255,0.55)", stroke: strong, "stroke-width": 1.5 }));
      var name = o.tx || opt.frameName || "";
      if (name) {
        var nm = wrap(name, o.w, 14, measure)[0] || "";
        kids.push(textLines([nm], o.x, r2(o.y - 22), 14, "start", strong));
      }
    }
    return n("g", g, kids);
  }

  // The scene of a board: one <g data-id> per object, in drawing order.
  // opt = { measure, live, frameName, draft: { id: obj | null } }
  function scene(list, opt) {
    opt = opt || {};
    var dr = opt.draft || {}, seen = {}, all = [];
    list.forEach(function (o) {
      seen[o.id] = 1;
      if (own(dr, o.id)) { if (dr[o.id]) all.push(dr[o.id]); } else all.push(o);
    });
    Object.keys(dr).forEach(function (id) { if (!seen[id] && dr[id]) all.push(dr[id]); });
    all.sort(function (a, b) {
      var fa = a.k === "frame" ? 0 : 1, fb = b.k === "frame" ? 0 : 1;
      return fa - fb || a.z - b.z || byId(a, b);
    });
    var m = index(all);
    return all.map(function (o) { return draw(o, m, opt); });
  }

  // ---------- SVG file ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function write(node) {
    var a = node.a, s = "<" + node.tag;
    Object.keys(a).forEach(function (k) {
      if (k === "data-id") return;              // screen only
      s += " " + k + "=\"" + esc(a[k]) + "\"";
    });
    if (!node.kids && node.text === undefined) return s + "/>";
    s += ">";
    if (node.text !== undefined) s += esc(node.text);
    (node.kids || []).forEach(function (k) { s += write(k); });
    return s + "</" + node.tag + ">";
  }
  // nodes from scene(); r = the area to show; o = { title, bg }
  function toSvg(nodes, r, o) {
    o = o || {};
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + r.w + '" height="' + r.h +
      '" viewBox="' + r.x + " " + r.y + " " + r.w + " " + r.h + '">';
    if (o.title) s += "<title>" + esc(o.title) + "</title>";
    if (o.bg && o.bg !== "none") s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + esc(o.bg) + '"/>';
    nodes.forEach(function (nd) { s += write(nd); });
    return s + "</svg>";
  }

  // Words of an object, for search and the screen reader.
  function words(o) { return typeof o.tx === "string" ? o.tx.replace(/\s+/g, " ").trim() : ""; }

  var API = {
    VER: VER, KINDS: KINDS, SHAPES: SHAPES, SYMS: SYMS, SYM_IDS: SYM_IDS, SYM_GROUPS: SYM_GROUPS, GEO: GEO, symOf: symOf, FILLS: FILLS, HEADS: HEADS, COLORS: COLORS, COLOR_KEYS: COLOR_KEYS,
    DEF_COLOR: DEF_COLOR, PAPER: PAPER, FONT: FONT, LH: LH, IMG_LEN: IMG_LEN, MAX_PTS: MAX_PTS, MAX_TEXT: MAX_TEXT,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, cleanObj: cleanObj,
    uid: uid, apply: apply, putBoard: putBoard, removeBoard: removeBoard, boards: boards, board: board,
    objsOf: objsOf, zTop: zTop, zBottom: zBottom, copies: copies,
    wrap: wrap, fit: fit, textHeight: textHeight, edge: edge, ends: ends, index: index, box: box, bounds: bounds,
    inRect: inRect, inFrame: inFrame, simplify: simplify, penFrom: penFrom, moved: moved, resized: resized,
    scene: scene, toSvg: toSvg, words: words
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.WhiteboardCore = API;
})(typeof window !== "undefined" ? window : globalThis);
