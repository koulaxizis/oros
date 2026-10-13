// ============================================================
// orOS Maps — heat-core.js (personal heatmap, OSM upgrade wave 4, v1.0.0).
// Pure functions, no DOM, no network: Node-tested in
// tests/maps-heat.test.js. The same engine runs in the Web Worker
// (maps/heat-worker.js) and, where workers are missing, on the page.
//
//   - pack(track): a parsed track (tracks-core.js shape) → one
//     Float64Array [lat, lon, lat, lon, NaN, NaN (segment break), ...]
//     plus its bbox. Simplified first (3 m) so a heatmap of years of
//     walks stays small.
//   - Engine: add / remove packed tracks, render a view, count stats.
//     render(): every visible track is drawn as lines into a grid of
//     `cell`-pixel squares; a square counts each track once, so the
//     colour says how many different tracks passed there. The answer
//     is RGBA (one pixel per square) that the page scales up.
//   - Statistics from the index entries (no files needed): distance,
//     time and tracks per year and per month.
//   - New ground: squares of ~40 m (zoom 17, 32 px) seen for the first
//     time, in date order, summed as metres of new path per month.
//
// API: window.OrosMapsHeat (self.OrosMapsHeat in the worker,
// module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var LIM = { cell: 64, gridCells: 2000000, tracks: 2000 };
  var NEW_Z = 17, NEW_SHIFT = 5;          // 2^17 * 256 px world, 32 px squares (~38 m at the equator)
  var EARTH = 40075016.686;               // metres around the equator

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // Web Mercator world pixels at zoom z (256 px tiles), as Leaflet.
  function projX(lon, scale) { return (lon + 180) / 360 * scale; }
  function projY(lat, scale) {
    var la = Math.max(-85.05112878, Math.min(85.05112878, lat));
    var s = Math.sin(la * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  }

  // Track → packed coordinates (segment breaks as NaN pairs) + bbox.
  function pack(tr, simplify) {
    var segs = (tr && tr.segs) || [];
    if (simplify) segs = segs.map(function (s) { return simplify(s); });
    var n = 0;
    segs.forEach(function (s) { if (s.length) n += s.length + 1; });
    var a = new Float64Array(n * 2), k = 0;
    var s0 = 90, w0 = 180, n0 = -90, e0 = -180;
    segs.forEach(function (s) {
      if (!s.length) return;
      for (var i = 0; i < s.length; i++) {
        var la = s[i][0], lo = s[i][1];
        a[k++] = la; a[k++] = lo;
        if (la < s0) s0 = la; if (la > n0) n0 = la;
        if (lo < w0) w0 = lo; if (lo > e0) e0 = lo;
      }
      a[k++] = NaN; a[k++] = NaN;
    });
    return { pts: a, bbox: n ? [s0, w0, n0, e0] : null };
  }

  // Grid line walk (DDA): calls fn(cx, cy) for every square a line
  // from (x0, y0) to (x1, y1) touches, in grid units.
  function walk(x0, y0, x1, y1, fn) {
    var dx = x1 - x0, dy = y1 - y0;
    var steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (steps > 100000) steps = 100000;   // a single absurd jump
    if (steps < 1) { fn(Math.floor(x0), Math.floor(y0)); return; }
    var sx = dx / steps, sy = dy / steps, x = x0, y = y0;
    for (var i = 0; i <= steps; i++) { fn(Math.floor(x), Math.floor(y)); x += sx; y += sy; }
  }

  // Colour for t in [0, 1]: blue → cyan → yellow → red, alpha rising.
  var STOPS = [[0, 40, 90, 220, 120], [0.35, 0, 200, 220, 170], [0.7, 255, 220, 0, 210], [1, 230, 30, 30, 240]];
  function color(t) {
    if (t <= 0) return [0, 0, 0, 0];
    if (t > 1) t = 1;
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], u = (t - a[0]) / (b[0] - a[0]);
        return [0, 1, 2, 3].map(function (j) { return Math.round(a[j + 1] + (b[j + 1] - a[j + 1]) * u); });
      }
    }
    return STOPS[STOPS.length - 1].slice(1);
  }
  var LUT = (function () {
    var l = new Uint8ClampedArray(256 * 4);
    for (var i = 0; i < 256; i++) { var c = color(i / 255); l.set(c, i * 4); }
    return l;
  })();

  function Engine() { this.tracks = {}; }
  Engine.prototype.add = function (id, packed, start) {
    if (typeof id !== "string" || !packed || !packed.pts) return;
    this.tracks[id] = { pts: packed.pts, bbox: packed.bbox, start: isNum(start) ? start : 0 };
  };
  Engine.prototype.remove = function (id) { delete this.tracks[id]; };
  Engine.prototype.ids = function () { return Object.keys(this.tracks).sort(); };

  // view: { z, x0, y0, w, h, cell }  (x0 / y0 = world pixel of the
  // top-left corner at zoom z). ids: the tracks to draw (filter).
  // → { gw, gh, rgba: Uint8ClampedArray, max, drawn }
  Engine.prototype.render = function (ids, view) {
    var cell = Math.max(1, Math.min(LIM.cell, Math.round(view.cell || 2)));
    var gw = Math.max(1, Math.ceil(view.w / cell)), gh = Math.max(1, Math.ceil(view.h / cell));
    if (gw * gh > LIM.gridCells) { var f = Math.sqrt(gw * gh / LIM.gridCells); gw = Math.floor(gw / f); gh = Math.floor(gh / f); cell = view.w / gw; }
    var scale = 256 * Math.pow(2, view.z);
    var counts = new Uint16Array(gw * gh), stamp = new Int32Array(gw * gh);
    var self = this, drawn = 0, max = 0, mark = 0;
    // view bounds in degrees, with one square of margin
    var west = (view.x0 - cell) / scale * 360 - 180, east = (view.x0 + view.w + cell) / scale * 360 - 180;
    function latOf(y) { var n = Math.PI - 2 * Math.PI * y / scale; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
    var north = latOf(view.y0 - cell), south = latOf(view.y0 + view.h + cell);
    (ids || []).forEach(function (id) {
      var t = self.tracks[id];
      if (!t || !t.bbox) return;
      var b = t.bbox;
      if (b[2] < south || b[0] > north || b[3] < west || b[1] > east) return;
      mark++; drawn++;
      var p = t.pts, px = NaN, py = NaN;
      function hit(cx, cy) {
        if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return;
        var i = cy * gw + cx;
        if (stamp[i] === mark) return;
        stamp[i] = mark;
        if (counts[i] < 65535) counts[i]++;
        if (counts[i] > max) max = counts[i];
      }
      for (var k = 0; k < p.length; k += 2) {
        var la = p[k];
        if (la !== la) { px = NaN; continue; }   // segment break
        var x = (projX(p[k + 1], scale) - view.x0) / cell, y = (projY(la, scale) - view.y0) / cell;
        if (px === px) {
          // skip lines with both ends far outside the grid on one side
          if (!((x < -1 && px < -1) || (y < -1 && py < -1) || (x > gw + 1 && px > gw + 1) || (y > gh + 1 && py > gh + 1))) walk(px, py, x, y, hit);
        } else hit(Math.floor(x), Math.floor(y));
        px = x; py = y;
      }
    });
    var rgba = new Uint8ClampedArray(gw * gh * 4);
    if (max) {
      var lm = Math.log(1 + Math.max(max, 3));
      for (var i = 0; i < counts.length; i++) {
        var c = counts[i];
        if (!c) continue;
        var v = Math.max(40, Math.min(255, Math.round(Math.log(1 + c) / lm * 255)));
        rgba[i * 4] = LUT[v * 4]; rgba[i * 4 + 1] = LUT[v * 4 + 1]; rgba[i * 4 + 2] = LUT[v * 4 + 2]; rgba[i * 4 + 3] = LUT[v * 4 + 3];
      }
    }
    return { gw: gw, gh: gh, cell: cell, rgba: rgba, max: max, drawn: drawn };
  };

  // New ground: in date order, metres of path through squares never
  // visited before. → { months: { "YYYY-MM": m }, total: m, squares: n }
  Engine.prototype.newGround = function (ids) {
    var self = this, seen = new Set(), months = {}, total = 0;
    var scale = 256 * Math.pow(2, NEW_Z), side = 1 << NEW_SHIFT, grid = scale / side;
    var list = (ids || []).filter(function (id) { return self.tracks[id]; })
      .sort(function (a, b) { return self.tracks[a].start - self.tracks[b].start || (a < b ? -1 : 1); });
    list.forEach(function (id) {
      var t = self.tracks[id], p = t.pts, px = NaN, py = NaN, add = 0;
      var key = monthKey(t.start);
      function hit(cx, cy) {
        if (cx < 0 || cy < 0 || cx >= grid || cy >= grid) return;
        var k = cx * grid + cy;
        if (seen.has(k)) return;
        seen.add(k);
        var lat = latOfY((cy + 0.5) * side, scale);
        add += EARTH * Math.cos(lat * Math.PI / 180) / grid;
      }
      for (var k = 0; k < p.length; k += 2) {
        if (p[k] !== p[k]) { px = NaN; continue; }
        var x = projX(p[k + 1], scale) / side, y = projY(p[k], scale) / side;
        if (px === px) walk(px, py, x, y, hit); else hit(Math.floor(x), Math.floor(y));
        px = x; py = y;
      }
      if (key) months[key] = (months[key] || 0) + add;
      total += add;
    });
    Object.keys(months).forEach(function (k) { months[k] = Math.round(months[k]); });
    return { months: months, total: Math.round(total), squares: seen.size };
  };
  function latOfY(y, scale) { var n = Math.PI - 2 * Math.PI * y / scale; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  function monthKey(ms) {
    if (!isNum(ms) || ms <= 0) return "";
    var d = new Date(ms);
    var m = d.getUTCMonth() + 1;
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m;
  }

  // Entries (mapstracks index) passing the filter { year, folder }.
  function filterEntries(entries, f) {
    f = f || {};
    return (entries || []).filter(function (e) {
      if (f.year && monthKey(e.start).slice(0, 4) !== String(f.year)) return false;
      if (f.folder && e.folder !== f.folder) return false;
      return true;
    });
  }
  // Totals per year and per month from the index entries.
  function stats(entries) {
    var out = { dist: 0, dur: 0, n: 0, years: {}, months: {} };
    (entries || []).forEach(function (e) {
      var d = isNum(e.dist) ? e.dist : 0, t = isNum(e.dur) ? e.dur : 0;
      out.dist += d; out.dur += t; out.n++;
      var mk = monthKey(e.start);
      if (!mk) return;
      var y = mk.slice(0, 4);
      [[out.years, y], [out.months, mk]].forEach(function (x) {
        var o = x[0][x[1]] || (x[0][x[1]] = { dist: 0, dur: 0, n: 0 });
        o.dist += d; o.dur += t; o.n++;
      });
    });
    return out;
  }
  function years(entries) {
    var s = {};
    (entries || []).forEach(function (e) { var k = monthKey(e.start); if (k) s[k.slice(0, 4)] = 1; });
    return Object.keys(s).sort().reverse();
  }

  var api = {
    VER: VER, LIM: LIM, NEW_Z: NEW_Z, NEW_SHIFT: NEW_SHIFT,
    projX: projX, projY: projY, pack: pack, walk: walk, color: color,
    Engine: Engine, monthKey: monthKey, filterEntries: filterEntries, stats: stats, years: years
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsHeat = api;
})(typeof window !== "undefined" ? window : this);
