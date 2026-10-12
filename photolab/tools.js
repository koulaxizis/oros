// ============================================================
// orOS Photo Lab — tools (v1.0.0)
// Pointer tools on the canvas. Each tool is
//   { id, key, down(p, e) → op | null, hover(p), overlay(g, vw),
//     enter(), leave(), key(e) }
// and an op is { move(p, e), up(p, e), cancel() }. p = doc px.
// Two fingers always pinch-zoom and pan; Space (held), the middle
// button and the Hand tool pan.
//
// Every change goes through the engine (photolab/paint.js,
// select.js, resample.js) and becomes one undo step.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, C = PL.C, T = PL.T, S = PL.S, P = PL.P, R = PL.R, H = PL.H;
  var st = PL.st;

  // ---------- Helpers ----------
  function view() { return PL.view; }
  function pr() { return PL.prefs; }
  function rgb(hex) { return P.rgbOf(hex); }
  // On a layer mask the colours paint as grey (their luminance).
  function ink(L, hex) {
    if (!L || !L.mask) return hex;
    var c = P.rgbOf(hex), v = Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
    var h = (v < 16 ? "0" : "") + v.toString(16);
    return "#" + h + h + h;
  }
  function clampRect(r) {
    var d = st.doc;
    var x0 = Math.max(0, Math.min(r.x, r.x + r.w)), y0 = Math.max(0, Math.min(r.y, r.y + r.h));
    var x1 = Math.min(d.w, Math.max(r.x, r.x + r.w)), y1 = Math.min(d.h, Math.max(r.y, r.y + r.h));
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  }
  function normRect(a, b, square, centre) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (square) { var m = Math.max(Math.abs(dx), Math.abs(dy)); dx = dx < 0 ? -m : m; dy = dy < 0 ? -m : m; }
    if (centre) return { x: a.x - dx, y: a.y - dy, w: dx * 2, h: dy * 2 };
    return { x: a.x, y: a.y, w: dx, h: dy };
  }
  function absRect(r) {
    return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) };
  }
  function sx(x) { return x * view().state().z + view().state().ox; }
  function sy(y) { return y * view().state().z + view().state().oy; }

  // ---------- Snapping (View › Snap) ----------
  // To guides, the canvas edges and centre, and the grid when shown,
  // within 8 screen px.
  function snapTargets() {
    var P = pr();
    if (!P.snap || !st.doc) return null;
    return PL.G.targets(st.doc, { guides: P.guides, grid: P.grid ? P.gridSize : 0 });
  }
  function snapTol() { return 8 / view().state().z; }
  function snapP(p) {
    var tg = snapTargets();
    if (!tg) return p;
    var s = PL.G.snapPoint(p, tg, snapTol());
    return { x: s.x, y: s.y };
  }
  function snapV(v, axis) {
    var tg = snapTargets();
    return tg ? PL.G.snap1(v, tg[axis], snapTol()) : v;
  }

  // The active layer (or the mask being edited) if a paint tool may
  // use it, else a message (R28).
  function paintable(needRaster) {
    var L = PL.paintLayer();
    if (!L) { PL.toast(PL.t("msg.noLayer")); return null; }
    if (!L.vis) { PL.toast(PL.t("msg.hidden")); return null; }
    if (L.lock) { PL.toast(PL.t("msg.locked")); return null; }
    if (needRaster && L.k !== "raster") { PL.toast(PL.t("msg.notRaster")); return null; }
    return L;
  }
  function selMode(e) {
    if (e && e.shiftKey && e.altKey) return "and";
    if (e && e.shiftKey) return "add";
    if (e && e.altKey) return "sub";
    return pr().selMode;
  }
  function finishSel(shape, mode, label) {
    if (shape && pr().feather > 0) shape = S.feather(shape, pr().feather);
    PL.setSel(S.combine(st.sel, shape, mode), label);
  }
  // Pixels of the active layer, canvas-sized (for wand and fill).
  function layerImage(L) {
    var d = st.doc;
    if (L.k !== "raster") return null;
    return T.readRect(PL.surface(L.id), -L.x, -L.y, d.w, d.h);
  }
  function mergedImage() {
    var d = st.doc, c = view().flatten(null, 1);
    var data = c.getContext("2d").getImageData(0, 0, d.w, d.h).data;
    c.width = c.height = 0;
    return { w: d.w, h: d.h, data: data };
  }
  function inDoc(p) { return p.x >= 0 && p.y >= 0 && p.x < st.doc.w && p.y < st.doc.h; }

  // ---------- Retouch: source point and options ----------
  // Clone stamp and healing copy from a source point (Alt+click, or
  // "Set source" then a tap). The offset is kept between strokes
  // (aligned), until a new source is set.
  var cloneSrc = null, cloneOff = null, pickSrc = false;
  function retouchKind(id) {
    if (id === "clone") return "clone";
    if (id === "heal") return pr().heal.kind === "redeye" ? "redeye" : "heal";
    if (id === "tone") return pr().tone.kind;
    return "smudge";
  }
  function copies(id) { var k = retouchKind(id); return k === "clone" || k === "heal"; }
  function setSource(p) {
    cloneSrc = { x: Math.round(p.x), y: Math.round(p.y) }; cloneOff = null; pickSrc = false;
    PL.toast(PL.t("msg.srcSet")); view().schedule();
  }
  // → true when the stroke may start; false when the click set the source.
  function retouchDown(id, p, e) {
    if (!copies(id)) return true;
    if (e.altKey || pickSrc) { setSource(p); return false; }
    if (!cloneSrc) { pickSrc = true; PL.toast(PL.t("msg.needSrc")); return false; }
    if (!cloneOff) cloneOff = { x: cloneSrc.x - Math.round(p.x), y: cloneSrc.y - Math.round(p.y) };
    return true;
  }
  function retouchStroke(id, L, s) {
    var o = pr()[id];
    return P.retouch(T, s, {
      kind: retouchKind(id), size: o.size, hard: o.hard, opacity: o.opacity, flow: o.flow, strength: o.strength,
      range: o.range, sat: o.sat, dx: cloneOff ? cloneOff.x : 0, dy: cloneOff ? cloneOff.y : 0,
      mask: st.sel, ox: L.x, oy: L.y
    });
  }

  // ---------- Brush + eraser (and the retouch tools) ----------
  var lastPaint = null;
  function brushTool(id, erase, retouch) {
    return {
      id: id, cursor: "crosshair",
      down: function (p, e) {
        if (retouch && !retouchDown(id, p, e)) return null;
        var L = paintable(true);
        if (!L) return null;
        var s = PL.surface(L.id), o = pr()[id];
        // On a mask the eraser paints the background colour (hides
        // or reveals), like Photoshop.
        var stroke = retouch ? retouchStroke(id, L, s) : P.stroke(T, s, {
          color: rgb(ink(L, erase && L.mask ? st.bg : st.fg)), size: o.size, hard: o.hard, opacity: o.opacity, flow: o.flow,
          erase: erase && !L.mask, mask: st.sel, ox: L.x, oy: L.y, lockAlpha: !erase && !L.mask && !!o.lockAlpha
        });
        var label = retouch ? PL.t("rk." + retouchKind(id)) : PL.t(erase ? "step.erase" : "step.brush");
        var pres = function (ev) { return ev.pointerType === "pen" && ev.pressure > 0 ? ev.pressure : null; };
        var last = { x: p.x, y: p.y };
        function touch(a, b) {
          var r = o.size / 2 + 2;
          var x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r;
          view().dirtyTiles(L.id, T.keysIn(Math.floor(x0 - L.x), Math.floor(y0 - L.y),
            Math.ceil(Math.abs(a.x - b.x) + r * 2) + 1, Math.ceil(Math.abs(a.y - b.y) + r * 2) + 1));
        }
        if (e.shiftKey && lastPaint) { stroke.dab(lastPaint.x, lastPaint.y, pres(e)); stroke.lineTo(p.x, p.y, pres(e)); touch(lastPaint, p); }
        else { stroke.dab(p.x, p.y, pres(e)); touch(p, p); }
        return {
          move: function (q, ev) { stroke.lineTo(q.x, q.y, pres(ev)); touch(last, q); last = { x: q.x, y: q.y }; },
          up: function () {
            var r = stroke.end();
            lastPaint = { x: last.x, y: last.y };
            if (!r.keys.length) return;
            var after = T.snapshot(s, r.keys);
            PL.pushStep(H.tileStep(label, T, s, r.before, after, function () {
              view().dirtyTiles(L.id, r.keys); PL.changed();
            }));
            view().dirtyTiles(L.id, r.keys);
            PL.changed();
          },
          cancel: function () {
            var r = stroke.end();
            T.restore(s, r.before);
            view().dirtyTiles(L.id, r.keys);
          }
        };
      },
      overlay: function (g, vw) {
        if (retouch && copies(id) && cloneSrc) {
          var c = cloneOff && hoverPt ? { x: hoverPt.x + cloneOff.x, y: hoverPt.y + cloneOff.y } : cloneSrc;
          var X = sx(c.x), Y = sy(c.y);
          g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,0.6)";
          g.beginPath(); g.moveTo(X - 8, Y); g.lineTo(X + 8, Y); g.moveTo(X, Y - 8); g.lineTo(X, Y + 8); g.stroke();
          g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,0.9)"; g.stroke();
        }
        if (!hoverPt) return;
        var r = Math.max(1, pr()[id].size * vw.z / 2);
        g.beginPath(); g.arc(sx(hoverPt.x), sy(hoverPt.y), r, 0, Math.PI * 2);
        g.lineWidth = 1; g.strokeStyle = "rgba(0,0,0,0.7)"; g.stroke();
        g.beginPath(); g.arc(sx(hoverPt.x), sy(hoverPt.y), r + 1, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,255,255,0.7)"; g.stroke();
      }
    };
  }

  // ---------- Selections ----------
  var drag = null;          // live rectangle / line / path for overlays
  function marquee(id, ellipse) {
    return {
      id: id, cursor: "crosshair",
      down: function (p, e) {
        var a = snapP(p), mode = selMode(e);
        drag = { kind: ellipse ? "ellipse" : "rect", r: { x: a.x, y: a.y, w: 0, h: 0 } };
        return {
          move: function (q, ev) { drag.r = normRect(a, snapP(q), ev.shiftKey && !e.shiftKey, ev.altKey && !e.altKey); view().schedule(); },
          up: function () {
            var r = absRect(drag.r); drag = null;
            if (r.w < 1 || r.h < 1) {                         // a click: deselect
              if (mode === "replace" && st.sel) PL.setSel(null, PL.t("step.deselect"));
              view().schedule(); return;
            }
            var d = st.doc;
            finishSel(ellipse ? S.ellipse(d.w, d.h, r) : S.rect(d.w, d.h, r), mode, PL.t("step.select"));
          },
          cancel: function () { drag = null; view().schedule(); }
        };
      },
      overlay: function (g) {
        if (!drag || !drag.r) return;
        var r = absRect(drag.r);
        g.save(); g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeStyle = "#fff";
        g.beginPath();
        if (drag.kind === "ellipse") g.ellipse(sx(r.x + r.w / 2), sy(r.y + r.h / 2), r.w * view().state().z / 2, r.h * view().state().z / 2, 0, 0, Math.PI * 2);
        else g.rect(sx(r.x), sy(r.y), r.w * view().state().z, r.h * view().state().z);
        g.stroke(); g.strokeStyle = "#000"; g.lineDashOffset = 4; g.stroke(); g.restore();
      }
    };
  }

  var poly = null;          // polygon lasso in progress: { pts, mode }
  function closePoly() {
    if (!poly) return;
    var pts = poly.pts, mode = poly.mode;
    poly = null;
    if (pts.length >= 3) finishSel(S.polygon(st.doc.w, st.doc.h, pts), mode, PL.t("step.select"));
    view().schedule();
  }
  var lasso = {
    id: "lasso", cursor: "crosshair",
    down: function (p, e) {
      if (pr().lassoPoly) {
        if (!poly) poly = { pts: [], mode: selMode(e) };
        var f = poly.pts[0];
        if (f && poly.pts.length >= 3 && Math.hypot((p.x - f.x) * view().state().z, (p.y - f.y) * view().state().z) < 10) { closePoly(); return null; }
        poly.pts.push(snapP(p));
        view().schedule();
        return null;
      }
      var mode = selMode(e);
      drag = { kind: "path", pts: [{ x: p.x, y: p.y }] };
      return {
        move: function (q) { drag.pts.push({ x: q.x, y: q.y }); view().schedule(); },
        up: function () {
          var pts = drag.pts; drag = null;
          if (pts.length < 3) { if (mode === "replace" && st.sel) PL.setSel(null, PL.t("step.deselect")); return; }
          finishSel(S.polygon(st.doc.w, st.doc.h, pts), mode, PL.t("step.select"));
        },
        cancel: function () { drag = null; view().schedule(); }
      };
    },
    dbl: function () { closePoly(); },
    key: function (e) {
      if (!poly) return false;
      if (e.key === "Enter") { closePoly(); return true; }
      if (e.key === "Escape") { poly = null; view().schedule(); return true; }
      if (e.key === "Backspace") { poly.pts.pop(); if (!poly.pts.length) poly = null; view().schedule(); return true; }
      return false;
    },
    leave: function () { poly = null; },
    overlay: function (g) {
      var pts = drag && drag.kind === "path" ? drag.pts : poly ? poly.pts.concat(hoverPt ? [hoverPt] : []) : null;
      if (!pts || pts.length < 2) return;
      g.save(); g.lineWidth = 1; g.strokeStyle = "#fff"; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(sx(pts[0].x), sy(pts[0].y));
      for (var i = 1; i < pts.length; i++) g.lineTo(sx(pts[i].x), sy(pts[i].y));
      g.stroke(); g.strokeStyle = "#000"; g.lineDashOffset = 4; g.stroke(); g.restore();
    }
  };

  var wand = {
    id: "wand", cursor: "crosshair",
    down: function (p, e) {
      if (!inDoc(p)) { PL.toast(PL.t("msg.outside")); return null; }
      var L = PL.layer(), mode = selMode(e);
      var img = pr().wand.all || !L || L.k !== "raster" ? mergedImage() : layerImage(L);
      PL.busy(true);
      PL.job("wand", { img: img, x: p.x, y: p.y, tol: pr().wand.tol, contiguous: pr().wand.contiguous })
        .then(function (m) { PL.busy(false); finishSel(m, mode, PL.t("step.wand")); },
              function () { PL.busy(false); PL.toast(PL.t("msg.failed")); });
      return null;
    }
  };

  // ---------- Quick selection ----------
  // Paint over an area: it grows out to the edges of similar colour.
  // Shift adds (default once there is a selection), Alt subtracts.
  // One undo step per stroke.
  var quick = {
    id: "quick", cursor: "crosshair",
    down: function (p, e) {
      if (!inDoc(p)) { PL.toast(PL.t("msg.outside")); return null; }
      var L = PL.layer(), o = pr().quick;
      var img = o.all || !L || L.k !== "raster" ? mergedImage() : layerImage(L);
      var sub = e.altKey, before = st.sel, d = st.doc;
      var area = null, last = null, timer = null;
      function show() {
        st.sel = sub ? S.combine(before, area, "sub") : S.combine(before, area, "add");
        view().selChanged();
      }
      function dab(q) {
        if (!inDoc(q)) return;
        if (last && Math.hypot(q.x - last.x, q.y - last.y) < o.size / 3) return;
        last = { x: q.x, y: q.y };
        area = S.quickGrow(img, area, q.x, q.y, o.size / 2, o.tol);
        if (!timer) timer = setTimeout(function () { timer = null; show(); }, 60);
      }
      dab(p);
      return {
        move: function (q) { dab(q); },
        up: function () {
          clearTimeout(timer); timer = null;
          st.sel = before;
          if (!area) return;
          var next = sub ? S.combine(before, area, "sub") : S.combine(before, area, "add");
          PL.setSel(next && S.isEmpty(next) ? null : next, PL.t("step.quick"));
          if (!next || !before) view().selChanged();
        },
        cancel: function () { clearTimeout(timer); timer = null; st.sel = before; view().selChanged(); }
      };
    },
    overlay: function (g, vw) {
      if (!hoverPt) return;
      var r = Math.max(1, pr().quick.size * vw.z / 2);
      g.beginPath(); g.arc(sx(hoverPt.x), sy(hoverPt.y), r, 0, Math.PI * 2);
      g.lineWidth = 1; g.strokeStyle = "rgba(0,0,0,0.7)"; g.stroke();
      g.beginPath(); g.moveTo(sx(hoverPt.x) - 4, sy(hoverPt.y)); g.lineTo(sx(hoverPt.x) + 4, sy(hoverPt.y));
      g.moveTo(sx(hoverPt.x), sy(hoverPt.y) - 4); g.lineTo(sx(hoverPt.x), sy(hoverPt.y) + 4);
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.stroke();
    }
  };

  // ---------- Move ----------
  function blendOver(dst, src) {           // straight-alpha "over", same size
    var d = dst.data, s = src.data;
    for (var i = 0; i < d.length; i += 4) {
      var sa = s[i + 3] / 255;
      if (!sa) continue;
      var da = d[i + 3] / 255, na = sa + da * (1 - sa);
      for (var c = 0; c < 3; c++) d[i + c] = (s[i + c] * sa + d[i + c] * da * (1 - sa)) / na;
      d[i + 3] = na * 255;
    }
  }
  var floatImg = null;      // { L, img, x, y } lifted selection while moving
  var move = {
    id: "move", cursor: "move",
    down: function (p) {
      var L = PL.layer();
      if (!L) { PL.toast(PL.t("msg.noLayer")); return null; }
      if (L.lock) { PL.toast(PL.t("msg.locked")); return null; }
      var a = { x: p.x, y: p.y };
      if (st.sel && L.k === "raster") return liftAndMove(L, a);
      var before = JSON.stringify(st.doc), x0 = L.x, y0 = L.y;
      var b0 = L.k === "adj" ? null : view().layerBounds(L);
      if (L.k === "raster") { var cb = T.contentBounds(PL.surface(L.id)); b0 = cb && { x: cb.x + L.x, y: cb.y + L.y, w: cb.w, h: cb.h }; }
      return {
        move: function (q, ev) {
          var dx = Math.round(q.x - a.x), dy = Math.round(q.y - a.y);
          if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
          var tg = b0 && snapTargets();
          if (tg) {
            var sr = PL.G.snapRect({ x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h }, tg, snapTol());
            if (!ev.shiftKey || dx) dx += Math.round(sr.dx);
            if (!ev.shiftKey || dy) dy += Math.round(sr.dy);
          }
          L.x = x0 + dx; L.y = y0 + dy; view().invalidate();
        },
        up: function () {
          if (L.x === x0 && L.y === y0) return;
          PL.pushStep(H.docStep(PL.t("step.move"), before, JSON.stringify(st.doc), PL.setDocRecord));
          PL.changed();
        },
        cancel: function () { L.x = x0; L.y = y0; view().invalidate(); }
      };
    },
    key: function (e) {
      var k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k) return false;
      var L = PL.layer();
      if (!L || L.lock) return true;
      var n = e.shiftKey ? 10 : 1;
      PL.docChange(PL.t("step.move"), function () { L.x += k[0] * n; L.y += k[1] * n; }, []);
      return true;
    }
  };
  function liftAndMove(L, a) {
    var s = PL.surface(L.id), sel = st.sel, b = S.bounds(sel);
    if (!b) return null;
    var lx = b.x - L.x, ly = b.y - L.y;
    var srcKeys = T.keysIn(lx, ly, b.w, b.h);
    var before = T.snapshot(s, srcKeys);
    var selBefore = sel;
    var img = T.readRect(s, lx, ly, b.w, b.h), rest = T.readRect(s, lx, ly, b.w, b.h);
    for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) {
      var m = sel.data[(y + b.y) * sel.w + x + b.x] / 255, i = (y * b.w + x) * 4;
      img.data[i + 3] = Math.round(img.data[i + 3] * m);
      rest.data[i + 3] = Math.round(rest.data[i + 3] * (1 - m));
    }
    T.writeRect(s, lx, ly, rest);
    view().dirtyTiles(L.id, srcKeys);
    floatImg = { L: L, img: img, x: b.x, y: b.y };
    var dx = 0, dy = 0;
    return {
      move: function (q, ev) {
        dx = Math.round(q.x - a.x); dy = Math.round(q.y - a.y);
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        floatImg.x = b.x + dx; floatImg.y = b.y + dy; view().invalidate();
      },
      up: function () {
        var nx = b.x + dx - L.x, ny = b.y + dy - L.y;
        var dstKeys = T.keysIn(nx, ny, b.w, b.h);
        var allKeys = srcKeys.concat(dstKeys.filter(function (k) { return srcKeys.indexOf(k) < 0; }));
        var bAll = {};
        allKeys.forEach(function (k) { bAll[k] = k in before ? before[k] : (s.tiles.get(k) ? new Uint8ClampedArray(s.tiles.get(k)) : null); });
        var under = T.readRect(s, nx, ny, b.w, b.h);
        blendOver(under, img);
        T.writeRect(s, nx, ny, under);
        floatImg = null;
        var after = T.snapshot(s, allKeys);
        var moved = shiftMask(selBefore, dx, dy);
        st.sel = moved; view().selChanged();
        PL.pushStep({
          label: PL.t("step.move"),
          bytes: T.snapBytes(bAll) + T.snapBytes(after) + selBefore.data.length * 2,
          undo: function () { T.restore(s, bAll); st.sel = selBefore; view().selChanged(); view().dirtyTiles(L.id, allKeys); PL.changed(); },
          redo: function () { T.restore(s, after); st.sel = moved; view().selChanged(); view().dirtyTiles(L.id, allKeys); PL.changed(); }
        });
        view().dirtyTiles(L.id, allKeys);
        PL.changed();
      },
      cancel: function () { floatImg = null; T.restore(s, before); view().dirtyTiles(L.id, srcKeys); }
    };
  }
  function shiftMask(m, dx, dy) {
    var out = S.make(m.w, m.h);
    for (var y = 0; y < m.h; y++) {
      var ny = y + dy;
      if (ny < 0 || ny >= m.h) continue;
      for (var x = 0; x < m.w; x++) {
        var nx = x + dx;
        if (nx < 0 || nx >= m.w) continue;
        out.data[ny * m.w + nx] = m.data[y * m.w + x];
      }
    }
    return out;
  }

  // ---------- Fill + gradient ----------
  var fill = {
    id: "fill", cursor: "crosshair",
    down: function (p) {
      var L = paintable(true);
      if (!L) return null;
      if (!inDoc(p)) { PL.toast(PL.t("msg.outside")); return null; }
      var o = pr().fill, img = o.all ? mergedImage() : layerImage(L);
      PL.busy(true);
      PL.job("wand", { img: img, x: p.x, y: p.y, tol: o.tol, contiguous: o.contiguous }).then(function (area) {
        PL.busy(false);
        var s = PL.surface(L.id);
        var r = P.fillArea(T, s, area, { color: rgb(ink(L, st.fg)), opacity: o.opacity, mask: st.sel, ox: L.x, oy: L.y });
        pushPaint(PL.t("step.fill"), L, s, r);
      }, function () { PL.busy(false); PL.toast(PL.t("msg.failed")); });
      return null;
    }
  };
  function pushPaint(label, L, s, r) {
    if (!r.keys.length) return;
    var after = T.snapshot(s, r.keys);
    PL.pushStep(H.tileStep(label, T, s, r.before, after, function () { view().dirtyTiles(L.id, r.keys); PL.changed(); }));
    view().dirtyTiles(L.id, r.keys);
    PL.changed();
  }
  PL.pushPaint = pushPaint;

  var gradient = {
    id: "gradient", cursor: "crosshair",
    down: function (p) {
      var L = paintable(true);
      if (!L) return null;
      var a = { x: p.x, y: p.y };
      drag = { kind: "line", a: a, b: a };
      return {
        move: function (q, ev) {
          var b = { x: q.x, y: q.y };
          if (ev.shiftKey) {                                 // snap to 45°
            var ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
            var len = Math.hypot(b.x - a.x, b.y - a.y);
            b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
          }
          drag.b = b; view().schedule();
        },
        up: function () {
          var b = drag.b; drag = null; view().schedule();
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
          var o = pr().gradient, s = PL.surface(L.id), c0 = rgb(ink(L, st.fg)).concat(255);
          var c1 = o.toClear ? rgb(ink(L, st.fg)).concat(0) : rgb(ink(L, st.bg)).concat(255);
          PL.busy(true);
          setTimeout(function () {
            var r = P.gradient(T, s, st.doc.w, st.doc.h, { type: o.type, x0: a.x, y0: a.y, x1: b.x, y1: b.y,
              c0: c0, c1: c1, opacity: o.opacity, mask: st.sel, ox: L.x, oy: L.y });
            PL.busy(false);
            pushPaint(PL.t("step.gradient"), L, s, r);
          }, 20);
        },
        cancel: function () { drag = null; view().schedule(); }
      };
    },
    overlay: function (g) {
      if (!drag || drag.kind !== "line") return;
      g.save(); g.lineWidth = 2; g.strokeStyle = "#fff";
      g.beginPath(); g.moveTo(sx(drag.a.x), sy(drag.a.y)); g.lineTo(sx(drag.b.x), sy(drag.b.y)); g.stroke();
      g.lineWidth = 1; g.strokeStyle = "#000"; g.stroke(); g.restore();
    }
  };

  // ---------- Eyedropper ----------
  function pickAt(p, toBg) {
    if (!inDoc(p)) return;
    var c = view().flatten({ x: Math.floor(p.x), y: Math.floor(p.y), w: 1, h: 1 }, 1);
    var d = c.getContext("2d").getImageData(0, 0, 1, 1).data;
    if (!d[3]) { PL.toast(PL.t("msg.clearPixel")); return; }
    var hex = "#" + [d[0], d[1], d[2]].map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
    if (toBg) st.bg = hex; else st.fg = hex;
    PL.emit("colors");
  }
  var picker = {
    id: "picker", cursor: "crosshair",
    down: function (p, e) {
      pickAt(p, e.altKey);
      return { move: function (q) { pickAt(q, e.altKey); }, up: function () {}, cancel: function () {} };
    }
  };

  // ---------- Text + shape ----------
  function hitVector(p, kind) {
    var ls = st.doc.layers;
    for (var i = ls.length - 1; i >= 0; i--) {
      var L = ls[i];
      if (L.k !== kind || !L.vis) continue;
      var b = view().layerBounds(L);
      if (b && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h) return L;
    }
    return null;
  }
  var text = {
    id: "text", cursor: "text",
    down: function (p) {
      var hit = hitVector(p, "text");
      if (hit) { PL.selectLayer(hit.id); PL.panels.textDialog(hit); return null; }
      PL.panels.textDialog(null, { x: Math.round(p.x), y: Math.round(p.y) });
      return null;
    }
  };
  var shape = {
    id: "shape", cursor: "crosshair",
    down: function (p) {
      var a = snapP(p);
      drag = { kind: "shape", r: { x: a.x, y: a.y, w: 0, h: 0 } };
      return {
        move: function (q, ev) { drag.r = normRect(a, snapP(q), ev.shiftKey, ev.altKey); view().schedule(); },
        up: function () {
          var r = absRect(drag.r); drag = null; view().schedule();
          if (r.w < 2 || r.h < 2) return;
          var o = pr().shape;
          PL.addLayer({ k: "shape", name: PL.shapeName(o.id), x: Math.round(r.x), y: Math.round(r.y),
            sh: { id: o.id, w: Math.round(r.w), h: Math.round(r.h), f: o.noFill ? "" : st.fg,
                  s: o.stroke ? st.bg : "", sw: o.stroke ? o.sw : 0 } }, PL.t("step.shape"));
        },
        cancel: function () { drag = null; view().schedule(); }
      };
    },
    overlay: function (g) {
      if (!drag || drag.kind !== "shape") return;
      var r = absRect(drag.r), z = view().state().z;
      if (r.w < 1 || r.h < 1) return;
      g.save(); g.translate(sx(r.x), sy(r.y)); g.scale(z, z);
      var path = view().shapePath({ id: pr().shape.id, w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });
      g.globalAlpha = 0.6; g.fillStyle = st.fg; g.fill(path); g.restore();
    }
  };

  // ---------- Crop ----------
  var crop = { r: null };
  function cropRatio() {
    var v = pr().cropRatio, d = st.doc;
    if (v === "orig") return d.w / d.h;
    var m = /^(\d+):(\d+)$/.exec(v || "");
    return m ? +m[1] / +m[2] : 0;
  }
  function handleAt(r, p) {
    var z = view().state().z, tol = 12 / z;
    var xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
    var names = [["nw", "n", "ne"], ["w", null, "e"], ["sw", "s", "se"]];
    for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) {
      if (!names[j][i]) continue;
      if (Math.abs(p.x - xs[i]) <= tol && Math.abs(p.y - ys[j]) <= tol) return names[j][i];
    }
    if (p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h) return "move";
    return null;
  }
  var cropTool = {
    id: "crop", cursor: "crosshair",
    enter: function () { crop.r = { x: 0, y: 0, w: st.doc.w, h: st.doc.h }; PL.emit("tool"); view().schedule(); },
    leave: function () { crop.r = null; view().schedule(); },
    down: function (p) {
      var r0 = crop.r, h = r0 && handleAt(r0, p), a = h ? { x: p.x, y: p.y } : snapP(p);
      var start = r0 ? { x: r0.x, y: r0.y, w: r0.w, h: r0.h } : null, ratio = cropRatio();
      return {
        move: function (q) {
          var dx = q.x - a.x, dy = q.y - a.y, r;
          if (!h) r = absRect(normRect(a, snapP(q), false, false));
          else if (h === "move") {
            r = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };
            var tg = snapTargets();
            if (tg) r = PL.G.snapRect(r, tg, snapTol());
          } else {
            var x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
            if (h.indexOf("w") >= 0) x0 = snapV(x0 + dx, "x");
            if (h.indexOf("e") >= 0) x1 = snapV(x1 + dx, "x");
            if (h.indexOf("n") >= 0) y0 = snapV(y0 + dy, "y");
            if (h.indexOf("s") >= 0) y1 = snapV(y1 + dy, "y");
            r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
          }
          if (ratio && h !== "move") {
            if (r.w / Math.max(1, r.h) > ratio) r.w = r.h * ratio; else r.h = r.w / ratio;
          }
          crop.r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
          view().schedule(); PL.emit("cropRect");
        },
        up: function () {},
        cancel: function () { crop.r = start; view().schedule(); }
      };
    },
    key: function (e) {
      if (e.key === "Enter") { applyCrop(); return true; }
      if (e.key === "Escape") { crop.r = { x: 0, y: 0, w: st.doc.w, h: st.doc.h }; view().schedule(); return true; }
      return false;
    },
    overlay: function (g) {
      var r = crop.r;
      if (!r) return;
      var z = view().state().z, x = sx(r.x), y = sy(r.y), w = r.w * z, h = r.h * z;
      var sz = view().size();
      g.save();
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.beginPath(); g.rect(0, 0, sz.w, sz.h); g.rect(x, y, w, h); g.fill("evenodd");
      g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
      g.strokeStyle = "rgba(255,255,255,0.4)";
      g.beginPath();
      for (var i = 1; i < 3; i++) { g.moveTo(x + w * i / 3, y); g.lineTo(x + w * i / 3, y + h); g.moveTo(x, y + h * i / 3); g.lineTo(x + w, y + h * i / 3); }
      g.stroke();
      g.fillStyle = "#fff";
      [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]].forEach(function (k) {
        g.fillRect(x + w * k[0] - 4, y + h * k[1] - 4, 8, 8);
      });
      g.restore();
    }
  };
  function applyCrop() {
    var r = crop.r;
    if (!r) return;
    var d = st.doc;
    if (r.x === 0 && r.y === 0 && r.w === d.w && r.h === d.h) { PL.toast(PL.t("msg.cropSame")); return; }
    PL.cropTo(r, PL.t("step.crop"));
    crop.r = { x: 0, y: 0, w: st.doc.w, h: st.doc.h };
    view().fit();
  }

  // ---------- Hand + zoom ----------
  var hand = {
    id: "hand", cursor: "grab",
    down: function (p, e) { return panOp(e); }
  };
  function panOp(e) {
    var lx = e.clientX, ly = e.clientY;
    return {
      move: function (q, ev) { view().pan(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; },
      up: function () {}, cancel: function () {}
    };
  }
  var zoom = {
    id: "zoom", cursor: "zoom-in",
    down: function (p, e) {
      var sp = view().screenPoint(e.clientX, e.clientY);
      view().zoomStep(e.altKey ? -1 : 1, sp.x, sp.y);
      return null;
    }
  };

  // ---------- Free transform (Ctrl+T) ----------
  // tf = { L, b (doc bounds before), cx, cy, sx, sy, ang (rad), tx, ty }
  var tf = null;
  function tfMatrix() {
    var c = Math.cos(tf.ang), s = Math.sin(tf.ang);
    var a = c * tf.sx, b = s * tf.sx, cc = -s * tf.sy, d = c * tf.sy;
    var e = tf.cx + tf.tx - (a * tf.cx + cc * tf.cy), f = tf.cy + tf.ty - (b * tf.cx + d * tf.cy);
    return [a, b, cc, d, e, f];
  }
  function tfCorners() {
    var m = tfMatrix(), b = tf.b;
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(function (p) {
      return { x: m[0] * p[0] + m[2] * p[1] + m[4], y: m[1] * p[0] + m[3] * p[1] + m[5] };
    });
  }
  function startTransform() {
    var L = PL.layer();
    if (!L) { PL.toast(PL.t("msg.noLayer")); return; }
    if (L.lock) { PL.toast(PL.t("msg.locked")); return; }
    if (L.k === "adj") { PL.toast(PL.t("msg.adjNoPixels")); return; }
    var b = view().layerBounds(L);
    if (!b || L.k === "raster" && !T.contentBounds(PL.surface(L.id))) { PL.toast(PL.t("msg.emptyLayer")); return; }
    if (L.k === "raster") b = (function (cb) { return { x: cb.x + L.x, y: cb.y + L.y, w: cb.w, h: cb.h }; })(T.contentBounds(PL.surface(L.id)));
    tf = { L: L, b: b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, ang: 0, tx: 0, ty: 0, prevTool: PL.st.tool };
    PL.setTool("transform", true);
  }
  function endTransform(apply) {
    if (!tf) return;
    var t0 = tf;
    tf = null;
    if (apply && (t0.sx !== 1 || t0.sy !== 1 || t0.ang || t0.tx || t0.ty)) commitTransform(t0);
    PL.setTool(t0.prevTool === "transform" ? "move" : t0.prevTool, true);
    view().invalidate();
  }
  function commitTransform(t0) {
    var L = t0.L;
    tf = t0; var m = tfMatrix(); tf = null;
    if (L.k !== "raster") {
      PL.docChange(PL.t("step.transform"), function () {
        var c = { x: t0.b.x * m[0] + t0.b.y * m[2] + m[4], y: t0.b.x * m[1] + t0.b.y * m[3] + m[5] };
        var v = view().vector(L);
        L.x = Math.round(c.x + v.pad * t0.sx); L.y = Math.round(c.y + v.pad * t0.sy);
        if (L.k === "text") L.tx.z = Math.max(4, Math.min(2000, Math.round(L.tx.z * Math.min(Math.abs(t0.sx), Math.abs(t0.sy)))));
        else { L.sh.w = Math.max(1, Math.round(L.sh.w * Math.abs(t0.sx))); L.sh.h = Math.max(1, Math.round(L.sh.h * Math.abs(t0.sy))); }
      }, []);
      return;
    }
    var s = PL.surface(L.id), b = t0.b;
    var img = T.readRect(s, b.x - L.x, b.y - L.y, b.w, b.h);
    tf = t0; var cs = tfCorners(); tf = null;
    var xs = cs.map(function (p) { return p.x; }), ys = cs.map(function (p) { return p.y; });
    var ox = Math.floor(Math.min.apply(null, xs)), oy = Math.floor(Math.min.apply(null, ys));
    var ow = Math.max(1, Math.ceil(Math.max.apply(null, xs)) - ox), oh = Math.max(1, Math.ceil(Math.max.apply(null, ys)) - oy);
    // image local → output local
    var M = [m[0], m[1], m[2], m[3], m[0] * b.x + m[2] * b.y + m[4] - ox, m[1] * b.x + m[3] * b.y + m[5] - oy];
    PL.busy(true);
    PL.job("transform", { img: img, m: M, w: ow, h: oh }).then(function (out) {
      PL.busy(false);
      PL.docChange(PL.t("step.transform"), function () {
        T.clear(s);
        T.writeRect(s, ox - L.x, oy - L.y, out);
      }, [L.id]);
    }, function () { PL.busy(false); PL.toast(PL.t("msg.failed")); });
  }
  var transform = {
    id: "transform", cursor: "default",
    down: function (p, e) {
      if (!tf) return null;
      var cs = tfCorners(), z = view().state().z, tol = 14 / z;
      var hit = -1;
      cs.forEach(function (c, i) { if (Math.hypot(c.x - p.x, c.y - p.y) <= tol) hit = i; });
      var a = { x: p.x, y: p.y }, s0 = { sx: tf.sx, sy: tf.sy, ang: tf.ang, tx: tf.tx, ty: tf.ty };
      var ccx = tf.cx + tf.tx, ccy = tf.cy + tf.ty;
      var inside = pointInPoly(p, cs);
      var mode = hit >= 0 ? "scale" : inside ? "move" : "rotate";
      if (mode === "rotate" && tf.L.k !== "raster") return null;     // text and shapes do not rotate
      var a0 = Math.atan2(a.y - ccy, a.x - ccx);
      var d0 = local(a.x - ccx, a.y - ccy, s0.ang);
      return {
        move: function (q, ev) {
          if (mode === "move") { tf.tx = s0.tx + q.x - a.x; tf.ty = s0.ty + q.y - a.y; }
          else if (mode === "rotate") {
            var ang = s0.ang + Math.atan2(q.y - ccy, q.x - ccx) - a0;
            if (ev.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
            tf.ang = ang;
          } else {
            var d = local(q.x - ccx, q.y - ccy, s0.ang);
            var kx = d0.x ? d.x / d0.x : 1, ky = d0.y ? d.y / d0.y : 1;
            if (!ev.shiftKey) { var k = Math.abs(kx) > Math.abs(ky) ? kx : ky; kx = ky = k; }
            tf.sx = s0.sx * kx; tf.sy = s0.sy * ky;
          }
          view().invalidate(); PL.emit("transform");
        },
        up: function () {}, cancel: function () { tf.sx = s0.sx; tf.sy = s0.sy; tf.ang = s0.ang; tf.tx = s0.tx; tf.ty = s0.ty; view().invalidate(); }
      };
    },
    key: function (e) {
      if (e.key === "Enter") { endTransform(true); return true; }
      if (e.key === "Escape") { endTransform(false); return true; }
      return false;
    },
    leave: function () { if (tf) { tf = null; view().invalidate(); } },
    overlay: function (g) {
      if (!tf) return;
      var cs = tfCorners();
      g.save(); g.lineWidth = 1; g.strokeStyle = "#4aa3ff";
      g.beginPath(); cs.forEach(function (c, i) { if (i) g.lineTo(sx(c.x), sy(c.y)); else g.moveTo(sx(c.x), sy(c.y)); });
      g.closePath(); g.stroke();
      g.fillStyle = "#fff";
      cs.forEach(function (c) { g.fillRect(sx(c.x) - 5, sy(c.y) - 5, 10, 10); g.strokeRect(sx(c.x) - 5, sy(c.y) - 5, 10, 10); });
      g.restore();
    }
  };
  function local(x, y, ang) { var c = Math.cos(-ang), s = Math.sin(-ang); return { x: x * c - y * s, y: x * s + y * c }; }
  function pointInPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i].y > p.y) !== (pts[j].y > p.y) &&
          p.x < (pts[j].x - pts[i].x) * (p.y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
    }
    return inside;
  }
  // Live preview while transforming, and the floating selection.
  function preview(L, g) {
    if (tf && tf.L === L) {
      g.save();
      var m = tfMatrix();
      g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      view().drawLayer(g, L, null);
      g.restore();
      return true;
    }
    if (floatImg && floatImg.L === L) {
      view().drawLayer(g, L, null);
      var c = view().canvas(floatImg.img.w, floatImg.img.h);
      c.getContext("2d").putImageData(new ImageData(floatImg.img.data, floatImg.img.w, floatImg.img.h), 0, 0);
      g.drawImage(c, floatImg.x, floatImg.y);
      return true;
    }
    return false;
  }

  // ---------- Registry ----------
  var TOOLS = {
    move: move, marquee: null, lasso: lasso, wand: wand, quick: quick, crop: cropTool,
    brush: brushTool("brush", false), eraser: brushTool("eraser", true),
    clone: brushTool("clone", false, true), heal: brushTool("heal", false, true),
    tone: brushTool("tone", false, true), smudge: brushTool("smudge", false, true),
    fill: fill, gradient: gradient, picker: picker, text: text, shape: shape,
    hand: hand, zoom: zoom, transform: transform
  };
  var rectSel = marquee("marquee", false), ellSel = marquee("marquee", true);
  function tool(id) {
    if (id === "marquee") return pr().marqueeEllipse ? ellSel : rectSel;
    return TOOLS[id] || TOOLS.brush;
  }
  var ORDER = ["move", "marquee", "lasso", "wand", "quick", "crop", "brush", "eraser", "clone", "heal", "tone", "smudge", "fill", "gradient", "picker", "text", "shape", "hand", "zoom"];

  var PAINTS = ["brush", "eraser", "clone", "heal", "tone", "smudge"];

  // ---------- Pointer routing ----------
  var hoverPt = null, op = null, pointers = new Map(), pinch = null, spaceDown = false;

  function onDown(e) {
    if (!st.doc) return;
    e.preventDefault();
    var cv = e.currentTarget;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (op) { op.cancel(); op = null; }
      var ps = Array.from(pointers.values());
      pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2, z: view().state().z };
      return;
    }
    if (pointers.size > 2) return;
    var p = view().toDoc(e.clientX, e.clientY);
    if (e.button === 1 || spaceDown) { op = panOp(e); return; }
    if (e.button === 2) return;
    var sp = view().screenPoint(e.clientX, e.clientY), ax = view().rulerAt(sp);
    if (ax) { op = guideOp(ax, -1, ax === "x" ? p.x : p.y); return; }
    if (st.tool === "move" || st.tool === "hand") {
      var gh = view().guideAt(sp);
      if (gh) { op = guideOp(gh.axis, gh.i, gh.v); return; }
    }
    op = tool(st.tool).down(p, e);
  }
  // Drags a guide out of a ruler (i = -1) or moves guide i; dropping
  // it on a ruler or outside the picture's surroundings deletes it.
  // One undo step.
  function guideOp(axis, i, v0) {
    if (!pr().guides) { pr().guides = true; PL.savePrefs(); }
    var before = JSON.stringify(st.doc), gd = st.doc.gd || { x: [], y: [] };
    var list = gd[axis].slice();
    if (i >= 0) list.splice(i, 1);
    function setList(l) {
      var n = { x: axis === "x" ? l : gd.x, y: axis === "y" ? l : gd.y };
      st.doc.gd = PL.C.normGuides(n) || undefined;
      if (!st.doc.gd) delete st.doc.gd;
    }
    setList(list);
    var v = Math.round(v0);
    view().setGuideDrag({ axis: axis, v: v });
    function at(q, ev) {
      var sp = view().screenPoint(ev.clientX, ev.clientY), sz = view().size();
      var gone = view().rulerAt(sp) === axis || sp.x < 0 || sp.y < 0 || sp.x > sz.w || sp.y > sz.h;
      v = Math.round(snapV(axis === "x" ? q.x : q.y, axis));
      view().setGuideDrag(gone ? null : { axis: axis, v: v });
      PL.emit("pointer", axis === "x" ? { x: v, y: q.y } : { x: q.x, y: v });
      return !gone;
    }
    return {
      move: function (q, ev) { at(q, ev); },
      up: function (q, ev) {
        var keep = at(q, ev);
        view().setGuideDrag(null);
        if (keep) setList(list.concat([v]));
        var after = JSON.stringify(st.doc);
        if (after === before) return;
        PL.pushStep(H.docStep(PL.t(i < 0 ? "step.guideAdd" : keep ? "step.guideMove" : "step.guideDelete"), before, after, PL.setDocRecord));
        PL.changed();
      },
      cancel: function () { view().setGuideDrag(null); PL.setDocRecord(JSON.parse(before)); }
    };
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      var ps = Array.from(pointers.values());
      var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
      view().pan(mx - pinch.mx, my - pinch.my);
      var sp = view().screenPoint(mx, my);
      if (pinch.d > 0) view().zoomAt(pinch.z * d / pinch.d, sp.x, sp.y);
      pinch.mx = mx; pinch.my = my;
      return;
    }
    var p = view().toDoc(e.clientX, e.clientY);
    hoverPt = e.pointerType === "touch" ? null : p;
    PL.emit("pointer", p);
    if (op) {
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (evs && evs.length > 1 && PAINTS.indexOf(st.tool) >= 0) {
        evs.forEach(function (ce) { op.move(view().toDoc(ce.clientX, ce.clientY), ce); });
      } else op.move(p, e);
    } else if (tool(st.tool).overlay) view().schedule();
  }
  function onUp(e) {
    var had = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!had) return;
    if (op) { var o = op; op = null; o.up(view().toDoc(e.clientX, e.clientY), e); }
  }
  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (op) { op.cancel(); op = null; }
  }
  function onWheel(e) {
    if (!st.doc) return;
    e.preventDefault();
    var sp = view().screenPoint(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey || e.altKey) {
      var k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      view().zoomAt(view().state().z * k, sp.x, sp.y);
    } else view().pan(-(e.shiftKey ? e.deltaY : e.deltaX), -(e.shiftKey ? 0 : e.deltaY));
  }
  function wire(cv) {
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onCancel);
    cv.addEventListener("pointerleave", function () { hoverPt = null; view().schedule(); });
    cv.addEventListener("dblclick", function () { var t = tool(st.tool); if (t.dbl) t.dbl(); });
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  function cursor() { return spaceDown ? "grab" : tool(st.tool).cursor || "default"; }

  PL.tools = {
    ORDER: ORDER, get: tool, wire: wire, cursor: cursor,
    overlay: function (g, vw) { var t = tool(st.tool); if (t.overlay) t.overlay(g, vw); },
    preview: preview,
    key: function (e) { var t = tool(st.tool); return t.key ? t.key(e) : false; },
    space: function (down) { spaceDown = down; },
    busy: function () { return !!op; },
    cancel: function () { if (op) { op.cancel(); op = null; } },
    enter: function (id) { var t = tool(id); if (t.enter) t.enter(); },
    leave: function (id) { var t = tool(id); if (t.leave) t.leave(); },
    PAINTS: PAINTS,
    armSource: function () { pickSrc = true; PL.toast(PL.t("msg.pickSrc")); },
    cropRect: function () { return crop.r; },
    setCropRect: function (r) { crop.r = clampRect(r); view().schedule(); },
    applyCrop: applyCrop,
    transforming: function () { return tf; },
    startTransform: startTransform, endTransform: endTransform
  };
})();
