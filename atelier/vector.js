// ============================================================
// orOS Atelier — the pen and point editing (v1.0.0, wave V1)
// The host for designkit/pathedit.js: the pen draws a new shape whose
// outline is its own (ext.pth, unit path, as blend steps since C1);
// Edit points turns any shape's outline (a library shape too) into
// points to drag. Every write goes through AT.op (undo, R27 stamps);
// a drag is one gesture. ext keeps its other keys (lnk, gs, …); a
// blend step that is edited becomes a plain shape (ext.bl goes).
//   AT.ed.vec.pen(), .edit(id), .active(), .busyWith(id), .cancel()
// editor.js hands it the pointer, keys and painting while active.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, AX = AT.AX, t = AT.t, $ = AT.$;
  var V = window.orosDK.vector, PE = window.orosDK.pathedit;
  var ED = AT.ed;
  var EXT_ROOM = 8000;               // designkit normX keeps ≤ 8192 characters of ext

  var S = null, editId = null, frame = null, writing = false, pageId = null;

  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4da3ff";
  }
  function bar() { return $("pe-bar"); }

  // frame space (the item's unrotated box) ↔ page points ↔ screen
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

  // the outline as ext.pth, room left for the item's other ext keys
  function packFor(it, unit) {
    var rest = {};
    if (it.ext) Object.keys(it.ext).forEach(function (k) { if (k !== "pth" && k !== "bl") rest[k] = it.ext[k]; });
    var room = EXT_ROOM - JSON.stringify(rest).length - 12;
    var p = V.pack(unit, room);
    if (!p) return null;
    rest.pth = p;
    return rest;
  }

  function host(fr) {
    return {
      accent: accent(),
      toScreen: function (x, y) { var p = fromFrame(fr, x, y), s = ED.toScreen(p.x, p.y); return [s.x, s.y]; },
      toSpace: function (sx, sy) {
        var p = { x: (sx - ED.ox) / ED.zoom, y: (sy - ED.oy) / ED.zoom }, q = toFrame(fr, p.x, p.y);
        return [q.x, q.y];
      },
      begin: function () { AT.beginGesture(); },
      end: function () { AT.endGesture(); },
      set: function (paths) {
        if (!editId || !fr) return false;
        var r = V.reframe(fr, paths), ok = true;
        writing = true;
        AT.op(function (d, nw) {
          var it = M.find(d.items, editId);
          if (!it) { ok = false; return false; }
          var ext = packFor(it, r.unit);
          if (!ext) { ok = false; return false; }
          it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h; it.rot = r.rot;
          it.ext = ext;
          M.touch(it, nw);
        });
        writing = false;
        return ok;
      },
      create: function (paths) {
        var r = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, paths);
        var closed = paths.some(function (p) { return p.closed; });
        var ext = V.pack(r.unit, EXT_ROOM - 12);
        if (!ext) return false;
        var made = null;
        AT.op(function (d, nw) {
          var spec = { k: "shape", shp: "rect", x: r.x, y: r.y, w: r.w, h: r.h, ext: { pth: ext } };
          if (closed) spec.fc = "#8c52ff";
          else { spec.sc = "#1f2328"; spec.sw = 3; }
          made = AX.addItem(d, pageId || ED.pg, spec, nw);
          if (!made) { AT.toast(t("toast.maxItems", { n: M.MAX_ITEMS })); return false; }
        });
        if (made) setTimeout(function () { ED.select([made.id]); }, 0);
        return !!made;
      },
      exit: function () {
        S = null; editId = null; frame = null; pageId = null;
        var b = bar();
        if (b) { b.hidden = true; b.innerHTML = ""; }
        document.body.classList.remove("pe-on");
        AT.emit("sel");
        ED.redraw();
      },
      redraw: function () { ED.redraw(); },
      say: function (s) { AT.toast(s); }
    };
  }

  function start(mode, fr, cmds) {
    if (S) S.cancel();
    if (ED.exitText) ED.exitText();
    if (ED.exitCrop) ED.exitCrop();
    S = PE.session(host(fr), { mode: mode, cmds: cmds });
    pageId = ED.pg;
    document.body.classList.add("pe-on");
    var b = bar();
    if (b) S.bar(b);
    AT.toast(PE.str(mode === "pen" ? "pe.hintPen" : "pe.hintEdit"));
    AT.emit("sel");
    ED.redraw();
  }

  function editable(it) { return !!(it && it.ax && it.ax.k === "shape" && !it.ax.bg && !it.lock); }

  var VEC = {
    active: function () { return !!S; },
    busyWith: function (id) { return !!S && editId === id; },
    pen: function () {
      if (!AT.doc) return;
      ED.select([]);
      start("pen", null, null);
    },
    edit: function (id) {
      var it = ED.find(id);
      if (!editable(it)) { if (it && it.lock) AT.toast(t("toast.locked")); return; }
      ED.select([id]);
      frame = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 };
      editId = id;
      start("nodes", frame, AX.shapeCmds(it));
      editId = id;
    },
    canEdit: editable,
    cancel: function () { if (S) S.cancel(); },
    down: function (e, sp) { return S ? S.down(evOf(e, sp)) : false; },
    move: function (e, sp) { return S ? S.move(evOf(e, sp)) : false; },
    up: function (e, sp) { return S ? S.up(evOf(e, sp)) : false; },
    tapEmpty: function () { if (S) S.tapEmpty(); },
    key: function (e) { return S ? S.key(e) : false; },
    paint: function (ctx) { if (S) S.paint(ctx); }
  };
  function evOf(e, sp) { return { sx: sp.x, sy: sp.y, shift: !!e.shiftKey, alt: !!e.altKey, touch: e.pointerType !== "mouse" }; }
  ED.vec = VEC;

  // The document changed under the points (undo, redo, another device,
  // a panel): follow it, or leave when the shape is gone.
  function follow() {
    if (!S || writing) return;
    if (ED.pg !== pageId) { S.cancel(); return; }
    if (!editId) return;
    var it = ED.find(editId);
    if (!editable(it)) { S.cancel(); return; }
    frame = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 };
    var h = host(frame);
    // the host keeps the frame it was made with: start a fresh one,
    // keeping the selection when the points are the same
    var keep = S.selected(), old = S;
    S = PE.session(h, { mode: "nodes", cmds: AX.shapeCmds(it) });
    var b = bar();
    if (b) S.bar(b);
    if (V.count(S.paths) === V.count(old.paths)) S.select(keep);
    ED.redraw();
  }
  AT.on("doc", follow);
  AT.on("remote", follow);
  AT.on("page", function () { if (S && ED.pg !== pageId) S.cancel(); });
  AT.on("close", function () { if (S) S.cancel(); });
  AT.on("open", function () { if (S) S.cancel(); });
  AT.on("palette", function () { if (S) ED.redraw(); });
})();
