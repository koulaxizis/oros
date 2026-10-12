// ============================================================
// orOS Photo Lab — rulers, guides, grid and snapping (no DOM)
// The maths behind the View menu's rulers, guides and grid; view.js
// draws them and tools.js drags them.
//
//   tickStep(z)          → { major, minor } doc px between ruler ticks
//                          at zoom z (major ticks get a number)
//   targets(doc, o)      → { x: [px], y: [px] } lines a point may snap
//                          to: guides, the canvas edges and centre,
//                          grid lines (o.grid = size, when shown)
//   snap1(v, list, tol)  → the nearest value in list within tol, else v
//   snapPoint(p, t, tol) → { x, y, sx, sy } (sx/sy: the line hit, or null)
//   snapRect(r, t, tol)  → r moved so its nearest edge or centre snaps
//
// UMD: module.exports in Node (tests), window.PhotoLab.guides in the app.
// ============================================================
(function (root) {
  "use strict";

  var STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

  // Major ticks at least ~64 screen px apart; minor ticks ~8 px.
  function tickStep(z) {
    z = z > 0 ? z : 1;
    var major = STEPS[STEPS.length - 1];
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] * z >= 64) { major = STEPS[i]; break; }
    var minor = major;
    [10, 5, 4, 2].some(function (d) {
      if (major % d === 0 && (major / d) * z >= 7) { minor = major / d; return true; }
      return false;
    });
    return { major: major, minor: minor };
  }

  function targets(doc, o) {
    o = o || {};
    var x = [0, doc.w, Math.round(doc.w / 2)], y = [0, doc.h, Math.round(doc.h / 2)];
    if (doc.gd && o.guides !== false) { x = x.concat(doc.gd.x); y = y.concat(doc.gd.y); }
    var g = o.grid;
    if (g > 0 && doc.w / g <= 2000 && doc.h / g <= 2000) {
      for (var gx = g; gx < doc.w; gx += g) x.push(gx);
      for (var gy = g; gy < doc.h; gy += g) y.push(gy);
    }
    return { x: x, y: y };
  }

  function nearest(v, list, tol) {
    var best = null, bd = tol;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i] - v);
      if (d <= bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  function snap1(v, list, tol) { var n = nearest(v, list, tol); return n === null ? v : n; }

  function snapPoint(p, t, tol) {
    var sx = nearest(p.x, t.x, tol), sy = nearest(p.y, t.y, tol);
    return { x: sx === null ? p.x : sx, y: sy === null ? p.y : sy, sx: sx, sy: sy };
  }

  // Moves r (no resize) so that its left, centre or right edge (and
  // top, middle or bottom) lands on the closest target within tol.
  function snapRect(r, t, tol) {
    function axis(a, size, list) {
      var best = 0, bd = tol + 1;
      [a, a + size / 2, a + size].forEach(function (v) {
        var n = nearest(v, list, tol);
        if (n !== null && Math.abs(n - v) < bd) { bd = Math.abs(n - v); best = n - v; }
      });
      return best;
    }
    var dx = axis(r.x, r.w, t.x), dy = axis(r.y, r.h, t.y);
    return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h, dx: dx, dy: dy };
  }

  var API = { tickStep: tickStep, targets: targets, snap1: snap1, snapPoint: snapPoint, snapRect: snapRect };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.guides = API; }
})(typeof window !== "undefined" ? window : this);
