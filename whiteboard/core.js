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
//   shape  x y w h tx shp f          rect | round | ellipse | diamond | tri,
//                                    f = fill none | soft | solid
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
      return o;
    }
    var x = num(raw.x), y = num(raw.y), w = size(raw.w), h = size(raw.h);
    if (x === null || y === null || w === null || h === null) return null;
    o.x = x; o.y = y; o.w = w; o.h = h;
    if (k === "note" || k === "text" || k === "shape") o.tx = str(raw.tx, MAX_TEXT);
    if (k === "frame") o.tx = str(raw.tx, MAX_NAME);
    if (k === "text") { var fs = num(raw.fs); o.fs = fs !== null && fs >= 8 && fs <= 200 ? Math.round(fs) : 24; }
    if (k === "shape") { o.shp = pick(raw.shp, SHAPES, "rect"); o.f = pick(raw.f, FILLS, "soft"); }
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
    return o;
  }

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
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

  function textLines(lines, x, y, fs, anchor, fill) {
    return n("text", { x: x, y: y, "font-size": fs, "font-family": FONT, fill: fill, "text-anchor": anchor },
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
    VER: VER, KINDS: KINDS, SHAPES: SHAPES, FILLS: FILLS, HEADS: HEADS, COLORS: COLORS, COLOR_KEYS: COLOR_KEYS,
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
