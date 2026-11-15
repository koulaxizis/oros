// ============================================================
// orOS Atelier — the pen and point editing (v1.0.0, wave V1)
// The host for designkit/pathedit.js: the pen draws a new shape whose
// outline is its own (ext.pth, unit path, as blend steps since C1);
// Edit points turns any shape's outline (a library shape too) into
// points to drag. Every write goes through AT.op (undo, R27 stamps);
// a drag is one gesture. ext keeps its other keys (lnk, gs, …); a
// blend step that is edited becomes a plain shape (ext.bl goes).
//   AT.ed.vec.pen(), .edit(id), .active(), .busyWith(id), .cancel()
// Wave V2 (designkit/boolean.js): .canCombine(list), .combine(kind)
// makes one shape of the picked ones (the back one's look and place);
// .canOutline(it), .outline(id) turns a stroke (a line's too, with its
// heads) into a filled shape.
// Wave V3 (text on a path, ext.tp in ax.js): .canTextPath(list),
// .textPath() puts the picked text on the picked shape's or line's
// outline (the text takes the outline's box; the shape stays);
// .tpSet(id, { o, s }) moves / flips it, .tpOff(id) frees the text.
// Wave V5: .canTextOutline(it), .textOutline(id) turns a text into
// shapes with its letters' outlines (AX.textOutlines, designkit/fonts.js).
// editor.js hands it the pointer, keys and painting while active.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, AX = AT.AX, t = AT.t, $ = AT.$;
  var V = window.orosDK.vector, PE = window.orosDK.pathedit, BO = null;               // designkit/boolean.js, loaded on first use
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

  // ---------- Wave V2: combine shapes, outline stroke ----------
  function toPage(it, cmds) {
    var fr = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 };
    return cmds.map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) { var q = fromFrame(fr, c[i], c[i + 1]); o.push(q.x, q.y); }
      return o;
    });
  }
  function ptPage(it, x, y) { var q = fromFrame({ x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 }, x, y); return [q.x, q.y]; }
  function byZ(a, b) { return a.z - b.z || (a.id < b.id ? -1 : 1); }
  function canCombine(list) { return !!(list && list.length >= 2 && list.every(editable) && list.every(function (x) { return x.pg === list[0].pg; })); }
  function canOutline(it) {
    if (!it || it.lock || !it.ax || !(it.sw > 0)) return false;
    if (it.ax.k === "line") return true;
    return it.ax.k === "shape" && !it.ax.bg && !!it.ax.sc;
  }
  function ready(fn) {
    PE.loadBoolean("../").then(function (b) { BO = b; fn(); }, function () { AT.toast(PE.str("pe.opLoad")); });
  }
  // a z just above `it` on its page, below the next element
  function zAbove(d, it) {
    var up = null;
    d.items.forEach(function (x) { if (x.pg === it.pg && x.id !== it.id && x.z > it.z && (up === null || x.z < up)) up = x.z; });
    if (up === null) return it.z + 1;
    var z = Math.round((it.z + up) / 2 * 1e6) / 1e6;
    return z > it.z && z < up ? z : it.z + (up - it.z) / 2;
  }
  // A new shape from page-space paths, looking like `like` (its ax,
  // ext without the outline and blend, its opacity, link, animation).
  function shapeFrom(d, like, paths, look, nw) {
    var r = V.reframe({ x: 0, y: 0, w: 0, h: 0, rot: 0 }, paths);
    var ext = packFor(like, r.unit);
    if (!ext) return null;
    var spec = {};
    Object.keys(like.ax).forEach(function (k) { spec[k] = like.ax[k]; });
    delete spec.rd; delete spec.as; delete spec.ae; delete spec.ico;
    Object.keys(look || {}).forEach(function (k) { spec[k] = look[k]; });
    spec.k = "shape"; spec.shp = "rect";
    spec.x = r.x; spec.y = r.y; spec.w = r.w; spec.h = r.h; spec.rot = 0;
    spec.op = like.op; spec.sw = look && look.sw !== undefined ? look.sw : like.sw; spec.z = look && look.z !== undefined ? look.z : like.z;
    delete spec.lock; spec.ext = ext;
    var dash = look && look.dash !== undefined ? look.dash : like.dash;
    delete spec.dash;
    var made = AX.addItem(d, like.pg, spec, nw);
    if (made && dash) made.dash = 1;
    return made;
  }
  function tooBig(paths) { return V.count(paths) > V.MAX_NODES; }

  function combine(kind) {
    var list = ED.selItems().slice().sort(byZ);
    if (!canCombine(list)) return;
    if (S) S.cancel();
    ready(function () {
      var shapes = list.map(function (it) { return V.fromCmds(toPage(it, AX.shapeCmds(it))); });
      var res = BO.op(kind, shapes);
      if (!res) { AT.toast(PE.str("pe.opFail")); return; }
      if (!res.length) { AT.toast(PE.str("pe.opNone")); return; }
      if (tooBig(res)) { AT.toast(PE.str("pe.tooBig")); return; }
      var ids = list.map(function (x) { return x.id; }), made = null;
      AT.op(function (d, nw) {
        var base = M.find(d.items, ids[0]);
        if (!base) return false;
        made = shapeFrom(d, base, res, null, nw);
        if (!made) return false;
        d.items = d.items.filter(function (x) { return ids.indexOf(x.id) < 0; });
        ids.forEach(function (id) { d.tombs[id] = nw; });
      });
      if (made) { ED.select([made.id]); AT.toast(PE.str("pe." + kind), t("btn.undo"), AT.undo); }
      else AT.toast(PE.str("pe.tooBig"));
    });
  }

  // a line as the canvas draws it (draw.js drawLine): round caps,
  // shortened under an arrow head, the heads as filled shapes
  function lineParts(it) {
    var ax = it.ax, sw = it.sw || 1, ang = Math.atan2(it.h, it.w), len = Math.hypot(it.w, it.h);
    var s = Math.max(6, sw * 3.2), cut = s * 0.7;
    var x0 = 0, y0 = 0, x1 = it.w, y1 = it.h;
    if (ax.as === "arrow" && len > cut) { x0 += Math.cos(ang) * cut; y0 += Math.sin(ang) * cut; }
    if (ax.ae === "arrow" && len > cut) { x1 -= Math.cos(ang) * cut; y1 -= Math.sin(ang) * cut; }
    var extra = [];
    function head(x, y, a, kind) {
      var c = Math.cos(a), n = Math.sin(a);
      function pt(px, py) { return ptPage(it, x + px * c - py * n, y + px * n + py * c); }
      if (kind === "dot") {
        var r = s / 2.2, ring = [];
        for (var k = 0; k < 48; k++) ring.push(pt(r * Math.cos(k * Math.PI / 24), r * Math.sin(k * Math.PI / 24)));
        extra.push(ring);
      } else extra.push([pt(0, 0), pt(-s, -s / 1.6), pt(-s, s / 1.6)]);
    }
    if (ax.as) head(0, 0, ang + Math.PI, ax.as);
    if (ax.ae) head(it.w, it.h, ang, ax.ae);
    return { paths: V.fromCmds(toPage(it, [["M", x0, y0], ["L", x1, y1]])), extra: extra };
  }

  function outline(id) {
    var it = ED.find(id);
    if (!canOutline(it)) return;
    if (S) S.cancel();
    ready(function () {
      var line = it.ax.k === "line", sw = it.sw, res;
      var dash = it.dash ? [sw * 3, sw * 2] : null;
      if (line) {
        var lp = lineParts(it);
        res = BO.outline(lp.paths, { w: sw, join: "round", cap: "round", dash: dash, extra: lp.extra });
      } else res = BO.outline(V.fromCmds(toPage(it, AX.shapeCmds(it))), { w: sw, join: "round", cap: "butt", dash: dash });
      if (!res || !res.length) { AT.toast(PE.str("pe.opFail")); return; }
      if (tooBig(res)) { AT.toast(PE.str("pe.tooBig")); return; }
      var made = null, keep = !line && !!(it.ax.fc || it.ax.g);
      AT.op(function (d, nw) {
        var x = M.find(d.items, id);
        if (!x) return false;
        var look = { fc: line ? (x.ax.sc || "#000000") : x.ax.sc, sc: "", g: undefined, sw: 0, dash: 0 };
        if (keep) look.z = zAbove(d, x);
        made = shapeFrom(d, x, res, look, nw);
        if (!made) return false;
        delete made.ax.g;
        if (keep) { x.sw = 0; x.dash = 0; M.touch(x, nw); }
        else { d.items = d.items.filter(function (y) { return y.id !== id; }); d.tombs[id] = nw; }
      });
      if (made) { ED.select([made.id]); AT.toast(PE.str("pe.outline"), t("btn.undo"), AT.undo); }
      else AT.toast(PE.str("pe.tooBig"));
    });
  }
  // ---------- Wave V3: text on a path ----------
  function pathItem(it) {
    if (!it || it.lock || !it.ax || it.ax.bg) return false;
    return it.ax.k === "shape" || (it.ax.k === "line" && Math.hypot(it.w, it.h) > 1);
  }
  function pairOf(list) {
    if (!list || list.length !== 2 || list[0].pg !== list[1].pg) return null;
    var tx = list[0].ax.k === "text" ? list[0] : list[1].ax.k === "text" ? list[1] : null;
    var sh = tx === list[0] ? list[1] : list[0];
    if (!tx || tx.lock || !(tx.ax.tx || "").trim() || !pathItem(sh)) return null;
    return { text: tx, path: sh };
  }
  function canTextPath(list) { return !!pairOf(list); }
  // the outline the text follows, in a box of its own (rotation kept)
  function outlineOf(sh) {
    var fr, cmds;
    if (sh.ax.k === "line") { fr = { x: sh.x, y: sh.y, w: sh.w, h: sh.h, rot: 0 }; cmds = [["M", 0, 0], ["L", sh.w, sh.h]]; }
    else { fr = { x: sh.x, y: sh.y, w: sh.w, h: sh.h, rot: sh.rot || 0 }; cmds = AX.shapeCmds(sh); }
    var paths = V.fromCmds(cmds);
    if (!paths.length) return null;
    return V.reframe(fr, [paths[0]]);
  }
  // the anchor (%) of a closed outline: its top, nearest the middle
  function topOf(cmds, w) {
    var wk = V.walker(cmds);
    if (!wk) return 0;
    var best = 0, by = Infinity, bx = Infinity;
    for (var i = 0; i < 400; i++) {
      var q = wk.at(wk.len * i / 400), dx = Math.abs(q[0] - w / 2);
      if (q[1] < by - 0.5 || (q[1] < by + 0.5 && dx < bx)) { by = Math.min(by, q[1]); bx = dx; best = i / 4; }
    }
    return best;
  }
  function textPath() {
    var pr = pairOf(ED.selItems());
    if (!pr) { AT.toast(PE.str("pe.tpNeed")); return; }
    if (S) S.cancel();
    var r = outlineOf(pr.path);
    if (!r) { AT.toast(PE.str("pe.opFail")); return; }
    var cmds = V.scaled(r.unit, r.w, r.h), wk = V.walker(cmds);
    if (!wk) { AT.toast(PE.str("pe.opFail")); return; }
    var closed = wk.closed, tid = pr.text.id, over = false;
    AT.op(function (d, nw) {
      var it = M.find(d.items, tid);
      if (!it) return false;
      var rest = {};
      if (it.ext) Object.keys(it.ext).forEach(function (k) { if (k !== "tp") rest[k] = it.ext[k]; });
      var dd = V.pack(r.unit, EXT_ROOM - JSON.stringify(rest).length - 40);
      if (!dd) return false;
      var ax = it.ax;
      delete ax.cv;
      var al = closed ? "c" : (ax.al === "r" ? "r" : ax.al === "c" ? "c" : "l");
      if (al !== AX.TEXT_DEF.al) ax.al = al; else delete ax.al;
      // text longer than the outline: smaller, down to a third
      var tw = 0;
      AX.curveLayout({ ax: ax, ext: rest, w: it.w, h: it.h }).glyphs.forEach(function (g) { tw += g.w; });
      var room = wk.len * (closed ? 0.98 : 1);
      if (tw > room && ax.size) {
        var k = Math.max(1 / 3, room / tw);
        ax.size = Math.max(2, Math.floor(ax.size * k * 10) / 10);
        over = k <= 1 / 3;
      }
      it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h; it.rot = r.rot;
      AX.setTp(it, { d: dd, o: closed ? topOf(cmds, r.w) : al === "r" ? 100 : al === "c" ? 50 : 0, s: 1 });
      M.touch(it, nw);
    });
    ED.select([tid]);
    AT.toast(over ? PE.str("pe.tpOver") : PE.str("pe.textPath"), t("btn.undo"), AT.undo);
  }
  function tpSet(id, v) {
    AT.editItems([id], function (it) {
      var tp = it.ext && it.ext.tp;
      if (!tp) return;
      AX.setTp(it, { d: tp.d, o: v.o !== undefined ? v.o : tp.o, s: v.s !== undefined ? v.s : tp.s });
    });
  }
  function tpOff(id) {
    AT.op(function (d, nw) {
      var it = M.find(d.items, id);
      if (!it || !AX.tpOf(it)) return false;
      var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      AX.setTp(it, null);
      var w = Math.max(10, Math.min(d.setup.w, AX.textWidth(it.ax, it)));
      it.w = w;
      var h = AX.textHeight(M.normItem(it) || it);
      it.h = h; it.x = cx - w / 2; it.y = cy - h / 2;
      M.touch(it, nw);
    });
  }

  // ---------- Wave V5: text to outlines ----------
  // The text becomes shapes with its letters' outlines (ext.pth, in the
  // text's box and turn): one shape when the outline fits a record,
  // else one per line, per word, per letter. Its colour or gradient,
  // opacity and link go with it; the text goes (one undo step).
  function canTextOutline(it) {
    var F = window.orosDK.fonts;
    return !!(it && !it.lock && it.ax && it.ax.k === "text" && (it.ax.tx || "").trim() && F && F.outlineGlyphs);
  }
  function textOutline(id) {
    if (ED.exitText) ED.exitText();
    var it = ED.find(id);
    if (!canTextOutline(it)) return;
    if (S) S.cancel();
    var res = null;
    AT.op(function (d, nw) {
      var x = M.find(d.items, id);
      if (!x) return false;
      res = AX.outlineText(d, x, nw);
      if (!res || !res.ids.length) return false;
    });
    if (!res || !res.ids.length) {
      AT.toast(PE.str(res && res.missing && !res.lost ? "pe.olNone" : res && res.lost ? "pe.tooBig" : "pe.opFail"));
      return;
    }
    ED.select(res.ids);
    var left = res.missing + res.lost;
    AT.toast(left ? PE.str("pe.olMissing").replace("{n}", left) : PE.str("pe.toOutlines"), t("btn.undo"), AT.undo);
  }
  VEC.canTextOutline = canTextOutline;
  VEC.textOutline = textOutline;
  VEC.canTextPath = canTextPath;
  VEC.textPath = textPath;
  VEC.tpSet = tpSet;
  VEC.tpOff = tpOff;
  VEC.canCombine = canCombine;
  VEC.combine = combine;
  VEC.canOutline = canOutline;
  VEC.outline = outline;

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
