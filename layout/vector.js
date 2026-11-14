// ============================================================
// orOS Layout — the pen and point editing (v1.0.0, wave V1)
// The host for designkit/pathedit.js. The pen (tool P) draws a new
// "path" item on the page under its first point; Edit points works on
// path items, and turns a rectangle, ellipse or line into a path item
// first (same id, t "path", outline in `d`, so it syncs as one edit).
// Edits are applied in place during a gesture like every Layout drag
// (LY.beginGesture … endGesture, the edited item stamped at the end).
// A blend step that is edited becomes a plain shape (LayoutBlend
// unlink).
//   LY.ed.vec.pen(), .edit(id), .active(), .canEdit(it), .cancel()
// Wave V2 (designkit/boolean.js): .canCombine(items), .combine(kind)
// makes one path of the picked shapes (the back one's look and place);
// .canOutline(it), .outline(id) turns a stroke into a filled path.
// editor.js hands it the pointer, keys and the overlay while active.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t, $ = LY.$;
  var V = window.orosDK.vector, PE = window.orosDK.pathedit, LB = window.LayoutBlend, BO = window.orosDK.boolean;
  var ED = LY.ed;

  var S = null, editId = null, frame = null, P0 = null, writing = false;

  function bar() { return $("pe-bar"); }
  function accent() { return (ED.palette && ED.palette.accent) || "#4da3ff"; }

  // frame space (the item's unrotated box) → page → world → screen
  function fromFrame(fr, x, y) {
    if (!fr) return { x: x, y: y };
    var a = (fr.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - fr.w / 2, dy = y - fr.h / 2;
    return { x: fr.x + fr.w / 2 + dx * c - dy * s, y: fr.y + fr.h / 2 + dx * s + dy * c };
  }
  function toFrame(fr, x, y) {
    if (!fr) return { x: x, y: y };
    var a = -(fr.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - fr.x - fr.w / 2, dy = y - fr.y - fr.h / 2;
    return { x: fr.w / 2 + dx * c - dy * s, y: fr.h / 2 + dx * s + dy * c };
  }

  // The outline of an item in its own box (pt).
  function cmdsOf(it) {
    if (it.t === "path") return V.scaled(M.parsePath(it.d) || [], it.w, it.h);
    if (it.t === "ell") return V.ellCmds(it.w, it.h);
    if (it.t === "rect") return V.rectCmds(it.w, it.h, it.r);
    return null;
  }
  // A line becomes a path in a box of its own (lines may run any way).
  function lineFrame(it) {
    var x0 = Math.min(it.x, it.x + it.w), y0 = Math.min(it.y, it.y + it.h);
    return { fr: { x: x0, y: y0, w: Math.abs(it.w), h: Math.abs(it.h), rot: 0 }, cmds: [["M", it.x - x0, it.y - y0], ["L", it.x + it.w - x0, it.y + it.h - y0]] };
  }

  function editable(it) {
    return !!(it && !it.lock && (it.t === "path" || it.t === "rect" || it.t === "ell" || it.t === "line"));
  }

  function host(fr, P) {
    return {
      accent: accent(),
      toScreen: function (x, y) {
        var q = fromFrame(fr, x, y), pp = P || { x: 0, y: 0 };
        return ED.toScreen(pp.x + q.x, pp.y + q.y);
      },
      toSpace: function (sx, sy) {
        var w = ED.toWorld(sx, sy), pp = P || { x: 0, y: 0 }, q = toFrame(fr, w[0] - pp.x, w[1] - pp.y);
        return [q.x, q.y];
      },
      begin: function () { if (!LY.inGesture()) LY.beginGesture(); },
      end: function () {
        if (!LY.inGesture()) return;
        writing = true;
        var it = editId && M.find(LY.doc.items, editId);
        if (it) M.touch(it, LY.now());
        LY.endGesture();
        writing = false;
      },
      set: function (paths) {
        if (!editId || !fr) return false;
        var it = M.find(LY.doc.items, editId);
        if (!it) return false;
        if (V.count(paths) > V.MAX_NODES) return false;
        var r = V.reframe(fr, paths);
        ED.live(function () {
          if (it.t !== "path") {
            if (it.t === "rect") it.r = 0;
            it.t = "path";
          }
          it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h; it.rot = r.rot;
          it.d = M.pathText(r.unit);
          if (LB && LB.unlink) LB.unlink(it);
        });
        return true;
      },
      create: function (paths) {
        // the page under the first point; the outline in its points
        var f = paths[0] && paths[0].n[0];
        var Q = f && ED.pageAt(f.x, f.y, true);
        if (!Q) return false;
        var local = V.clone(paths);
        local.forEach(function (p) { p.n.forEach(function (n) { n.x -= Q.x; n.ix -= Q.x; n.ox -= Q.x; n.y -= Q.y; n.iy -= Q.y; n.oy -= Q.y; }); });
        var r = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, local);
        var made = null;
        LY.op(function (doc, now) {
          var props = { t: "path", pg: Q.id, x: r.x, y: r.y, w: r.w, h: r.h, stroke: "sw-black", sw: 1 };
          if (Q.master && doc.setup.facing) props.side = Q.side;
          var it = ED.addItem(doc, props, now);
          if (!it) return false;
          it.d = M.pathText(r.unit);
          made = it;
        });
        if (made) setTimeout(function () { ED.select([made.id]); }, 0);
        return !!made;
      },
      exit: function () {
        S = null; editId = null; frame = null; P0 = null;
        var b = bar();
        if (b) { b.hidden = true; b.innerHTML = ""; }
        if (ED.tool === "pen") ED.setTool("select");
        LY.emit("sel");
        ED.render();
      },
      redraw: function () { ED.render(); },
      say: function (s) { LY.toast(s); }
    };
  }

  function start(mode, fr, P, cmds) {
    if (S) S.cancel();
    S = PE.session(host(fr, P), { mode: mode, cmds: cmds });
    var b = bar();
    if (b) S.bar(b);
    LY.toast(PE.str(mode === "pen" ? "pe.hintPen" : "pe.hintEdit"));
    ED.render();
  }

  function editFrame(it) {
    if (it.t === "line") return lineFrame(it);
    return { fr: { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 }, cmds: cmdsOf(it) };
  }

  var VEC = {
    active: function () { return !!S; },
    canEdit: editable,
    pen: function () {
      if (!LY.doc) return;
      if (LY.inframe && LY.inframe.isOn && LY.inframe.isOn() && LY.inframe.stop) LY.inframe.stop();
      ED.select([]);
      start("pen", null, null, null);
    },
    edit: function (id) {
      var it = M.find(LY.doc.items, id);
      if (!editable(it)) { if (it && it.lock) LY.toast(t("toast.locked")); return; }
      var P = LY.pOf(it);
      if (!P) return;
      ED.select([id]);
      var ef = editFrame(it);
      start("nodes", ef.fr, P, ef.cmds);
      editId = id; frame = ef.fr; P0 = P;
    },
    cancel: function () { if (S) S.cancel(); },
    down: function (e, p) { return S ? S.down(evOf(e, p)) : false; },
    move: function (e, p) { return S ? S.move(evOf(e, p)) : false; },
    up: function (e, p) { return S ? S.up(evOf(e, p)) : false; },
    tapEmpty: function () { if (S) S.tapEmpty(); },
    key: function (e) { return S ? S.key(e) : false; },
    paint: function (ctx) { if (S) S.paint(ctx); }
  };
  function evOf(e, p) { return { sx: p[0], sy: p[1], shift: !!e.shiftKey, alt: !!e.altKey, touch: e.pointerType === "touch" || e.pointerType === "pen" }; }
  ED.vec = VEC;

  // ---------- Wave V2: combine shapes, outline stroke ----------
  function pagePaths(it) {
    var ef = editFrame(it);
    if (!ef.cmds) return null;
    return V.fromCmds(ef.cmds.map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) { var q = fromFrame(ef.fr, c[i], c[i + 1]); o.push(q.x, q.y); }
      return o;
    }));
  }
  function byZ(a, b) { return a.z - b.z || (a.id < b.id ? -1 : 1); }
  function areaShape(it) { return editable(it) && it.t !== "line"; }
  function canCombine(items) {
    return !!(BO && items && items.length >= 2 && items.every(areaShape) && items.every(function (x) { return x.pg === items[0].pg && (x.side || "") === (items[0].side || ""); }));
  }
  function canOutline(it) { return !!(BO && editable(it) && it.stroke && it.sw > 0); }
  function ready(fn) { BO.need("../").then(fn, function () { LY.toast(PE.str("pe.opLoad")); }); }
  var LOOK = ["fill", "stroke", "sw", "dash", "op", "gr", "eo", "wrap", "wo", "grp", "side", "hide"];
  // A new path item on `like`'s page from page-space paths.
  function pathFrom(doc, like, paths, now) {
    var r = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, paths);
    var it = ED.addItem(doc, { t: "path", pg: like.pg, x: r.x, y: r.y, w: r.w, h: r.h, side: like.side }, now);
    if (!it) return null;
    LOOK.forEach(function (k) { if (like[k] !== undefined) it[k] = JSON.parse(JSON.stringify(like[k])); });
    delete it.eo;                 // the result's holes are wound the other way: nonzero draws them
    it.d = M.pathText(r.unit);
    it.z = like.z;
    return it;
  }
  function zAbove(doc, it) {
    var up = null;
    doc.items.forEach(function (x) { if (x.pg === it.pg && x.id !== it.id && x.z > it.z && (up === null || x.z < up)) up = x.z; });
    return up === null ? it.z + 1 : it.z + (up - it.z) / 2;
  }
  function combine(kind) {
    var items = ED.selItems().slice().sort(byZ);
    if (!canCombine(items)) return;
    if (S) S.cancel();
    ready(function () {
      var shapes = items.map(pagePaths);
      var res = BO.op(kind, shapes);
      if (!res) { LY.toast(PE.str("pe.opFail")); return; }
      if (!res.length) { LY.toast(PE.str("pe.opNone")); return; }
      if (V.count(res) > V.MAX_NODES) { LY.toast(PE.str("pe.tooBig")); return; }
      var ids = items.map(function (x) { return x.id; }), made = null;
      LY.op(function (doc, now) {
        var base = M.find(doc.items, ids[0]);
        if (!base) return false;
        made = pathFrom(doc, base, res, now);
        if (!made) return false;
        ED.delItems(doc, ids, now);
      });
      if (made) { var id = made.id; setTimeout(function () { ED.select([id]); }, 0); LY.toast(PE.str("pe." + kind)); }
    });
  }
  function outline(id) {
    var it = M.find(LY.doc.items, id);
    if (!canOutline(it)) return;
    if (S) S.cancel();
    ready(function () {
      var sw = it.sw, res = BO.outline(pagePaths(it), { w: sw, join: "miter", miter: 10, cap: "butt", dash: it.dash ? [sw * 3, sw * 2] : null });
      if (!res || !res.length) { LY.toast(PE.str("pe.opFail")); return; }
      if (V.count(res) > V.MAX_NODES) { LY.toast(PE.str("pe.tooBig")); return; }
      var keep = it.t !== "line" && !!(it.fill || it.gr), made = null;
      LY.op(function (doc, now) {
        var x = M.find(doc.items, id);
        if (!x) return false;
        made = pathFrom(doc, x, res, now);
        if (!made) return false;
        made.fill = x.stroke; made.stroke = ""; made.sw = 0; made.dash = 0; delete made.gr;
        if (keep) { made.z = zAbove(doc, x); x.stroke = ""; M.touch(x, now); }
        else ED.delItems(doc, [id], now);
      });
      if (made) { var mid = made.id; setTimeout(function () { ED.select([mid]); }, 0); LY.toast(PE.str("pe.outline")); }
    });
  }
  VEC.canCombine = canCombine;
  VEC.combine = combine;
  VEC.canOutline = canOutline;
  VEC.outline = outline;

  // The document changed under the points (undo, redo, another device,
  // a panel): follow it, or leave when the item is gone.
  function follow() {
    if (!S || writing || LY.inGesture()) return;
    if (!editId) return;
    var it = M.find(LY.doc.items, editId);
    if (!editable(it)) { S.cancel(); return; }
    var P = LY.pOf(it);
    if (!P) { S.cancel(); return; }
    var ef = editFrame(it), keep = S.selected(), old = S, id = editId;
    S = PE.session(host(ef.fr, P), { mode: "nodes", cmds: ef.cmds });
    editId = id; frame = ef.fr; P0 = P;
    var b = bar();
    if (b) S.bar(b);
    if (V.count(S.paths) === V.count(old.paths)) S.select(keep);
    ED.render();
  }
  LY.on("doc", follow);
  LY.on("remote", follow);
  LY.on("close", function () { if (S) S.cancel(); });
  LY.on("open", function () { if (S) S.cancel(); });
  LY.on("mode", function () { if (S) S.cancel(); });
})();
