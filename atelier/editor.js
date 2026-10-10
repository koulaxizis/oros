// ============================================================
// orOS Atelier — the stage (v1.0.0)
//   - view: one page at a time, fit / zoom / pan (wheel, pinch,
//     drag on empty space with a finger)
//   - selection: tap, Shift+tap, marquee (mouse), select all
//   - move with snapping to the page and other elements (guides),
//     resize (corners keep proportions, text corners scale the
//     font), rotate (snaps to 45°), line end points
//   - text: edited in place (a textarea over the element)
//   - crop: double-tap a photo, drag / zoom it inside its frame
//   - pages strip: switch, add, duplicate, delete, reorder
// Every change goes through AT.op / AT.editItems (undo, R27 stamps).
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, T = AT.T, AX = AT.AX, R = window.orosDK.render, t = AT.t, $ = AT.$, el = AT.el;
  var ED = AT.ed = { pg: null, sel: [], zoom: 1, ox: 0, oy: 0, mode: "", editId: null, cropId: null };

  var cv, ctx, stage, dpr = 1, W = 0, H = 0;
  var fitted = false, needDraw = false;
  var HANDLE = 5, HIT = 12;
  var guides = [], marquee = null, hoverId = null;

  // ---------- 1. Queries ----------
  function doc() { return AT.doc; }
  function page() { return ED.pg ? M.find(doc().pages, ED.pg) : null; }
  function items(pg) {
    return doc().items.filter(function (it) { return it.pg === (pg || ED.pg) && it.ax; }).sort(M.byZ);
  }
  function find(id) { return M.find(doc().items, id); }
  function selItems() { return ED.sel.map(find).filter(Boolean); }
  ED.selItems = selItems;
  ED.find = find;
  ED.items = items;
  function isBg(it) { return !!(it.ax && it.ax.bg); }

  // ---------- 2. View ----------
  function toPage(sx, sy) { return { x: (sx - ED.ox) / ED.zoom, y: (sy - ED.oy) / ED.zoom }; }
  function toScreen(px, py) { return { x: ED.ox + px * ED.zoom, y: ED.oy + py * ED.zoom }; }
  ED.toScreen = toScreen;

  function resize() {
    if (!stage) return;
    var r = stage.getBoundingClientRect();
    // keep what is in the middle of the stage in the middle
    var mid = fitted && W > 1 ? toPage(W / 2, H / 2) : null;
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    if (mid) { ED.ox = W / 2 - mid.x * ED.zoom; ED.oy = H / 2 - mid.y * ED.zoom; }
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    if (!fitted) fit(); else clampView();
    redraw();
  }
  function fit() {
    if (!doc() || !W) return;
    var s = doc().setup, pad = W < 500 ? 16 : 40;
    ED.zoom = Math.max(0.02, Math.min((W - 2 * pad) / s.w, (H - 2 * pad) / s.h));
    ED.ox = (W - s.w * ED.zoom) / 2; ED.oy = (H - s.h * ED.zoom) / 2;
    fitted = true;
    zoomLabel();
    positionOverlays();
    redraw();
  }
  ED.fit = fit;
  function clampView() {
    var s = doc() ? doc().setup : null;
    if (!s) return;
    var pw = s.w * ED.zoom, ph = s.h * ED.zoom, m = 60;
    ED.ox = pw < W ? Math.min(Math.max(ED.ox, m - pw), W - m) : Math.min(m, Math.max(ED.ox, W - pw - m));
    ED.oy = ph < H ? Math.min(Math.max(ED.oy, m - ph), H - m) : Math.min(m, Math.max(ED.oy, H - ph - m));
  }
  function zoomAt(z, sx, sy) {
    z = Math.max(0.02, Math.min(16, z));
    var p = toPage(sx, sy);
    ED.zoom = z;
    ED.ox = sx - p.x * z; ED.oy = sy - p.y * z;
    clampView();
    zoomLabel();
    positionOverlays();
    redraw();
  }
  ED.zoomBy = function (k) { zoomAt(ED.zoom * k, W / 2, H / 2); };
  function zoomLabel() {
    var b = $("ed-zoom");
    if (b) b.textContent = Math.round(ED.zoom * 100) + "%";
  }

  // ---------- 3. Drawing ----------
  function redraw() {
    if (needDraw) return;
    needDraw = true;
    requestAnimationFrame(function () { needDraw = false; paint(); });
  }
  ED.redraw = redraw;

  var checker = null;
  function checkerPattern() {
    if (checker) return checker;
    var c = document.createElement("canvas");
    c.width = c.height = 16;
    var g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#e3e3e3"; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    checker = ctx.createPattern(c, "repeat");
    return checker;
  }

  function paint() {
    if (!ctx || !doc() || !page()) return;
    var s = doc().setup;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // page + shadow
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#fff";
    ctx.fillRect(ED.ox, ED.oy, s.w * ED.zoom, s.h * ED.zoom);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = checkerPattern();
    ctx.fillRect(ED.ox, ED.oy, s.w * ED.zoom, s.h * ED.zoom);
    ctx.restore();
    // content
    ctx.save();
    ctx.setTransform(dpr * ED.zoom, 0, 0, dpr * ED.zoom, dpr * ED.ox, dpr * ED.oy);
    var skip = {};
    if (ED.editId) skip[ED.editId] = 1;
    ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip();
    AT.draw.drawPage(ctx, doc(), page(), { maxSide: 1600, skip: skip, time: ED.animTime, media: ED.media });
    ctx.restore();
    if (ED.cropId) cropGhost(find(ED.cropId));
    // overlays (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (hoverId && ED.sel.indexOf(hoverId) < 0) {
      var hv = find(hoverId);
      if (hv) outline(hv, "rgba(77,163,255,0.8)", 1);
    }
    var sel = selItems();
    if (sel.length === 1 && !ED.editId) drawHandles(sel[0]);
    else if (sel.length > 1) {
      sel.forEach(function (it) { outline(it, "rgba(77,163,255,0.6)", 1); });
      var b = selBox(sel), a = toScreen(b.x, b.y);
      ctx.strokeStyle = accent(); ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.strokeRect(a.x, a.y, b.w * ED.zoom, b.h * ED.zoom);
      ctx.setLineDash([]);
    }
    guides.forEach(function (g) {
      ctx.strokeStyle = "#ff3b8d"; ctx.lineWidth = 1;
      ctx.beginPath();
      if (g.v !== undefined) { var x = toScreen(g.v, 0).x; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      else { var y = toScreen(0, g.h).y; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    });
    if (marquee) {
      ctx.fillStyle = "rgba(77,163,255,0.12)"; ctx.strokeStyle = accent(); ctx.lineWidth = 1;
      var mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1);
      ctx.fillRect(mx, my, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(mx, my, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
  }

  // While cropping: the parts of the photo outside its frame, faint.
  function cropGhost(ci) {
    var img = ci && ci.a ? AT.A.get(ci.a) : null;
    if (!img) return;
    ctx.save();
    ctx.setTransform(dpr * ED.zoom, 0, 0, dpr * ED.zoom, dpr * ED.ox, dpr * ED.oy);
    ctx.translate(ci.x + ci.w / 2, ci.y + ci.h / 2);
    ctx.rotate((ci.rot || 0) * Math.PI / 180);
    ctx.translate(-ci.w / 2, -ci.h / 2);
    var r = R.imageRect(ci), big = 1e6;
    ctx.beginPath();
    ctx.rect(-big, -big, 2 * big, 2 * big);
    ctx.rect(0, 0, ci.w, ci.h);
    ctx.clip("evenodd");
    if (ci.ax.flh || ci.ax.flv) {
      ctx.translate(ci.w / 2, ci.h / 2); ctx.scale(ci.ax.flh ? -1 : 1, ci.ax.flv ? -1 : 1); ctx.translate(-ci.w / 2, -ci.h / 2);
    }
    ctx.globalAlpha = 0.4;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  var accentCache = null;
  function accent() {
    if (accentCache) return accentCache;
    accentCache = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4da3ff";
    return accentCache;
  }
  AT.on("palette", function () { accentCache = null; redraw(); });

  function screenCorners(it) {
    return R.corners(it).map(function (p) { return toScreen(p[0], p[1]); });
  }
  function outline(it, color, w) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath();
    if (it.t === "line") {
      var a = toScreen(it.x, it.y), b = toScreen(it.x + it.w, it.y + it.h);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    } else {
      var c = screenCorners(it);
      ctx.moveTo(c[0].x, c[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
    }
    ctx.stroke();
  }

  // Handles of one element, in page coordinates.
  //   id: nw n ne e se s sw w (dir), rot, p0 / p1 (line ends)
  function handlesOf(it) {
    if (it.t === "line") return [{ id: "p0", x: it.x, y: it.y }, { id: "p1", x: it.x + it.w, y: it.y + it.h }];
    var k = it.ax.k, out = [];
    var list = [["nw", -1, -1], ["ne", 1, -1], ["se", 1, 1], ["sw", -1, 1]];
    if (k === "text") { if (!it.ax.cv) list.push(["e", 1, 0], ["w", -1, 0]); }
    else if (k !== "icon") list.push(["n", 0, -1], ["e", 1, 0], ["s", 0, 1], ["w", -1, 0]);
    var cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = (it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    function at(lx, ly) { return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }; }
    list.forEach(function (h) {
      var p = at(h[1] * it.w / 2, h[2] * it.h / 2);
      out.push({ id: h[0], dx: h[1], dy: h[2], x: p.x, y: p.y });
    });
    var rp = at(0, it.h / 2 + 28 / ED.zoom);
    out.push({ id: "rot", x: rp.x, y: rp.y });
    return out;
  }

  function drawHandles(it) {
    var locked = !!it.lock;
    outline(it, accent(), 1.5);
    if (locked || ED.cropId) return;
    handlesOf(it).forEach(function (h) {
      var p = toScreen(h.x, h.y);
      ctx.beginPath();
      if (h.id === "rot") {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = accent(); ctx.lineWidth = 1.5;
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, -Math.PI * 0.9, Math.PI * 0.5);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = "#fff"; ctx.strokeStyle = accent(); ctx.lineWidth = 1.5;
      if (h.id.length === 1) {
        // side handles: small pills
        var horiz = h.id === "n" || h.id === "s";
        var rw = horiz ? 16 : 6, rh = horiz ? 6 : 16;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate((it.rot || 0) * Math.PI / 180);
        R.roundRectPath(ctx, -rw / 2, -rh / 2, rw, rh, 3);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      } else {
        ctx.arc(p.x, p.y, HANDLE + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    });
  }

  function selBox(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (it) {
      var b = R.itemBox(it);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  ED.selBox = selBox;

  // ---------- 4. Hit testing ----------
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    var qx = ax + u * dx, qy = ay + u * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }
  function hitItem(px, py, touch) {
    var list = items(), tol = (touch ? 14 : 6) / ED.zoom;
    for (var i = list.length - 1; i >= 0; i--) {
      var it = list[i];
      if (it.hide || isBg(it)) continue;
      if (it.t === "line") {
        if (segDist(px, py, it.x, it.y, it.x + it.w, it.y + it.h) <= Math.max(it.sw / 2, tol)) return it;
        continue;
      }
      var l = R.toLocal(it, px, py);
      var pad = Math.min(it.w, it.h) < 12 / ED.zoom ? tol : 0;
      if (l[0] >= -pad && l[1] >= -pad && l[0] <= it.w + pad && l[1] <= it.h + pad) return it;
    }
    return null;
  }
  function hitHandle(sx, sy, touch) {
    var sel = selItems();
    if (sel.length !== 1 || sel[0].lock || ED.cropId) return null;
    var r = touch ? 20 : HIT, best = null, bd = Infinity;
    handlesOf(sel[0]).forEach(function (h) {
      var p = toScreen(h.x, h.y), d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= r && d < bd) { bd = d; best = h; }
    });
    return best;
  }

  // ---------- 5. Selection ----------
  function select(ids, quiet) {
    ids = (ids || []).filter(function (id) { var it = find(id); return it && it.pg === ED.pg; });
    if (JSON.stringify(ids) === JSON.stringify(ED.sel)) return;
    ED.sel = ids;
    redraw();
    if (!quiet) AT.emit("sel");
  }
  ED.select = select;
  ED.selectAll = function () {
    select(items().filter(function (it) { return !isBg(it) && !it.hide; }).map(function (it) { return it.id; }));
  };

  function setPage(id) {
    if (!M.find(doc().pages, id)) return;
    exitText(); exitCrop();
    ED.pg = id;
    ED.sel = [];
    AT.emit("sel");
    AT.emit("page");
    renderPages();
    redraw();
  }
  ED.setPage = setPage;
  ED.pageIndex = function () {
    var ps = M.pagesInOrder(doc());
    for (var i = 0; i < ps.length; i++) if (ps[i].id === ED.pg) return i;
    return 0;
  };

  // ---------- 6. Adding ----------
  // spec: ax fields + optional x, y, w, h. Placed at the centre of
  // the visible page area when x / y are missing; selected.
  ED.add = function (spec, opts) {
    opts = opts || {};
    var made = null;
    var ok = AT.op(function (d, nw) {
      var s = JSON.parse(JSON.stringify(spec));
      var P = d.setup;
      if (s.w === undefined) s.w = P.w / 3;
      if (s.h === undefined) s.h = s.w;
      if (s.k === "text" && spec.autoW) {
        s.w = Math.min(P.w * 0.9, AX.textWidth(s));
        delete s.autoW;
      }
      if (s.x === undefined || s.y === undefined) {
        var c = toPage(W / 2, H / 2);
        c.x = Math.min(P.w, Math.max(0, c.x)); c.y = Math.min(P.h, Math.max(0, c.y));
        var off = (d.items.length % 6) * Math.max(P.w, P.h) / 80;
        s.x = c.x - s.w / 2 + off;
        s.y = c.y - (s.k === "text" ? AX.textHeight({ w: s.w, ax: AX.normAx(s, { t: "rect" }) || { k: "text" } }) : s.h) / 2 + off;
      }
      made = AX.addItem(d, ED.pg, s, nw);
      if (!made) { AT.toast(t("toast.maxItems", { n: M.MAX_ITEMS })); return false; }
    });
    if (ok && made) {
      select([made.id]);
      if (opts.edit) { enterText(made.id, true); growId = spec.autoW ? made.id : null; }
    }
    return made;
  };

  // ---------- 7. Pointer gestures ----------
  var pointers = {}, drag = null, pinch = null, lastTap = { t: 0, id: null };

  function evPos(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse" && e.button !== 1) return;
    cv.focus({ preventScroll: true });
    cv.setPointerCapture(e.pointerId);
    var sp = evPos(e);
    pointers[e.pointerId] = sp;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      // second finger: pinch (cancel any drag, keep what it did)
      endDrag(true);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: ED.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox: ED.ox, oy: ED.oy,
        crop: ED.cropId ? (find(ED.cropId) || null) : null };
      if (pinch.crop) AT.beginGesture();
      return;
    }
    if (ids.length > 2) return;
    var touch = e.pointerType !== "mouse";
    var p = toPage(sp.x, sp.y);
    if (e.button === 1 || spaceDown) { drag = { kind: "pan", sx: sp.x, sy: sp.y, ox: ED.ox, oy: ED.oy }; return; }

    if (ED.editId) exitText();
    if (ED.cropId) {
      var ci = find(ED.cropId);
      var lc = ci ? R.toLocal(ci, p.x, p.y) : null;
      if (ci && lc && lc[0] >= 0 && lc[1] >= 0 && lc[0] <= ci.w && lc[1] <= ci.h) {
        drag = { kind: "crop", sx: sp.x, sy: sp.y, start: JSON.parse(JSON.stringify(ci)), moved: false };
        return;
      }
      exitCrop();
    }

    var h = hitHandle(sp.x, sp.y, touch);
    if (h) {
      var it0 = selItems()[0];
      drag = { kind: h.id === "rot" ? "rot" : (h.id === "p0" || h.id === "p1") ? "end" : "size", h: h, start: JSON.parse(JSON.stringify(it0)), sx: sp.x, sy: sp.y, moved: false, shift: e.shiftKey };
      return;
    }
    var hit = hitItem(p.x, p.y, touch);
    if (hit) {
      var was = ED.sel.indexOf(hit.id) >= 0;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        select(was ? ED.sel.filter(function (id) { return id !== hit.id; }) : ED.sel.concat([hit.id]));
        return;
      }
      if (!was) select([hit.id]);
      var moving = selItems().filter(function (it) { return !it.lock; });
      drag = { kind: "move", sx: sp.x, sy: sp.y, p0: p, moved: false, hit: hit.id, was: was && ED.sel.length === 1,
        start: moving.map(function (it) { return { id: it.id, x: it.x, y: it.y }; }), locked: moving.length === 0 };
      return;
    }
    // empty space
    if (touch) drag = { kind: "pan", sx: sp.x, sy: sp.y, ox: ED.ox, oy: ED.oy, tap: true };
    else drag = { kind: "marquee", sx: sp.x, sy: sp.y, add: e.shiftKey ? ED.sel.slice() : [], moved: false };
  }

  function onMove(e) {
    var sp = evPos(e);
    if (pointers[e.pointerId]) pointers[e.pointerId] = sp;
    if (pinch) {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var k = d / (pinch.d || 1);
      if (pinch.crop) { cropZoom(pinch.crop, k); return; }
      var z = Math.max(0.02, Math.min(16, pinch.z * k));
      var px = (pinch.mx - pinch.ox) / pinch.z, py = (pinch.my - pinch.oy) / pinch.z;
      ED.zoom = z; ED.ox = mx - px * z; ED.oy = my - py * z;
      clampView(); zoomLabel(); positionOverlays(); redraw();
      return;
    }
    if (!drag) {
      if (e.pointerType === "mouse") {
        var hp = toPage(sp.x, sp.y), hh = hitItem(hp.x, hp.y, false);
        var nid = hh ? hh.id : null;
        if (nid !== hoverId) { hoverId = nid; redraw(); }
        var hd = hitHandle(sp.x, sp.y, false);
        cv.style.cursor = hd ? (hd.id === "rot" ? "grab" : "crosshair") : hh ? "move" : "default";
      }
      return;
    }
    var dist = Math.hypot(sp.x - drag.sx, sp.y - drag.sy);
    if (!drag.moved && dist < (e.pointerType === "mouse" ? 3 : 8)) return;
    var first = !drag.moved;
    drag.moved = true;
    var p = toPage(sp.x, sp.y);
    if (drag.kind === "pan") {
      ED.ox = drag.ox + sp.x - drag.sx; ED.oy = drag.oy + sp.y - drag.sy;
      clampView(); positionOverlays(); redraw();
      return;
    }
    if (drag.kind === "marquee") {
      marquee = { x0: drag.sx, y0: drag.sy, x1: sp.x, y1: sp.y };
      var a0 = toPage(Math.min(drag.sx, sp.x), Math.min(drag.sy, sp.y)), a1 = toPage(Math.max(drag.sx, sp.x), Math.max(drag.sy, sp.y));
      var inside = items().filter(function (it) {
        if (isBg(it) || it.hide) return false;
        var b = R.itemBox(it);
        return b.x >= a0.x && b.y >= a0.y && b.x + b.w <= a1.x && b.y + b.h <= a1.y;
      }).map(function (it) { return it.id; });
      select(drag.add.concat(inside.filter(function (id) { return drag.add.indexOf(id) < 0; })));
      return;
    }
    if (drag.locked) { if (first) AT.toast(t("toast.locked")); return; }
    if (first) AT.beginGesture();
    if (drag.kind === "move") doMove(p, e.shiftKey);
    else if (drag.kind === "size") doResize(p, e.shiftKey);
    else if (drag.kind === "rot") doRotate(p, e.shiftKey);
    else if (drag.kind === "end") doEnd(p, e.shiftKey);
    else if (drag.kind === "crop") doCropPan(sp);
  }

  function onUp(e) {
    delete pointers[e.pointerId];
    if (pinch) {
      if (Object.keys(pointers).length < 2) { if (pinch.crop) AT.endGesture(); pinch = null; }
      return;
    }
    if (!drag) return;
    var d = drag;
    endDrag(false);
    if (d.moved) return;
    // taps
    var nowT = Date.now();
    if (d.kind === "pan" && d.tap) { select([]); return; }
    if (d.kind === "marquee") { select(d.add); return; }
    if (d.kind === "move") {
      var it = find(d.hit);
      if (!it) return;
      var dbl = lastTap.id === it.id && nowT - lastTap.t < 400;
      lastTap = { t: nowT, id: it.id };
      if (it.ax.k === "text" && !it.lock && (d.was || dbl)) { enterText(it.id); return; }
      if (it.ax.k === "photo" && it.a && !it.lock && dbl) { enterCrop(it.id); return; }
    }
  }

  function endDrag(cancel) {
    if (!drag) return;
    var k = drag.kind;
    drag = null;
    guides = []; marquee = null;
    if (k !== "pan" && k !== "marquee") AT.endGesture();
    redraw();
  }

  // --- move with snapping ---
  function snapTargets() {
    var s = doc().setup, xs = [0, s.w / 2, s.w], ys = [0, s.h / 2, s.h];
    items().forEach(function (it) {
      if (ED.sel.indexOf(it.id) >= 0 || isBg(it) || it.hide) return;
      var b = R.itemBox(it);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    return { xs: xs, ys: ys };
  }
  function snap1(vals, targets, tol) {
    var best = null;
    vals.forEach(function (v) {
      targets.forEach(function (tg) {
        var d = tg - v;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, at: tg };
      });
    });
    return best;
  }
  function doMove(p, noSnap) {
    var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    guides = [];
    if (!noSnap) {
      var moved = drag.start.map(function (s) { var it = find(s.id); return it ? Object.assign({}, it, { x: s.x + dx, y: s.y + dy }) : null; }).filter(Boolean);
      if (moved.length) {
        var b = selBox(moved), tg = snapTargets(), tol = 7 / ED.zoom;
        var sx = snap1([b.x, b.x + b.w / 2, b.x + b.w], tg.xs, tol);
        var sy = snap1([b.y, b.y + b.h / 2, b.y + b.h], tg.ys, tol);
        if (sx) { dx += sx.d; guides.push({ v: sx.at }); }
        if (sy) { dy += sy.d; guides.push({ h: sy.at }); }
      }
    }
    var start = drag.start;
    AT.op(function (d, nw) {
      start.forEach(function (s) {
        var it = M.find(d.items, s.id);
        if (!it) return;
        it.x = s.x + dx; it.y = s.y + dy;
        M.touch(it, nw);
      });
    });
  }

  // --- resize ---
  function rotate(x, y, a) { var c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; }
  function doResize(p, free) {
    var s = drag.start, h = drag.h, a = (s.rot || 0) * Math.PI / 180;
    var l = R.toLocal(s, p.x, p.y);            // local to the START box
    var corner = h.dx !== 0 && h.dy !== 0;
    var nw = h.dx > 0 ? l[0] : h.dx < 0 ? s.w - l[0] : s.w;
    var nh = h.dy > 0 ? l[1] : h.dy < 0 ? s.h - l[1] : s.h;
    var min = 4;
    var k = 1;
    if (corner && !(free && s.ax.k === "shape")) {
      k = Math.max(nw / s.w, nh / s.h);
      k = Math.max(k, min / Math.min(s.w, s.h));
      nw = s.w * k; nh = s.h * k;
    } else { nw = Math.max(min, nw); nh = Math.max(min, nh); }
    var isText = s.ax.k === "text";
    var x0 = h.dx > 0 ? 0 : h.dx < 0 ? s.w - nw : 0;
    var y0 = h.dy > 0 ? 0 : h.dy < 0 ? s.h - nh : 0;
    var c = rotate(x0 + nw / 2 - s.w / 2, y0 + nh / 2 - s.h / 2, a);
    var ncx = s.x + s.w / 2 + c.x, ncy = s.y + s.h / 2 + c.y;
    AT.op(function (d, nw2) {
      var it = M.find(d.items, s.id);
      if (!it) return false;
      it.w = nw; it.h = nh;
      it.x = ncx - nw / 2; it.y = ncy - nh / 2;
      if (isText) {
        if (corner) it.ax.size = Math.max(2, Math.round(s.ax.size * k * 10) / 10);
        var n = M.normItem(it);
        var th = AX.textHeight(n);
        // keep the anchored edge: recompute y from the new height
        var y0b = h.dy < 0 ? s.h - th : 0;
        var c2 = rotate(x0 + nw / 2 - s.w / 2, y0b + th / 2 - s.h / 2, a);
        it.h = th;
        it.x = s.x + s.w / 2 + c2.x - nw / 2; it.y = s.y + s.h / 2 + c2.y - th / 2;
        if (it.ax.cv) { it.w = AX.curveLayout(M.normItem(it)).w; }
      }
      if (s.ax.k === "photo" && s.fit === "custom") {
        if (corner) { it.isc = s.isc * k; it.ix = s.ix * k; it.iy = s.iy * k; }
        coverClamp(it);
      }
      M.touch(it, nw2);
    });
  }

  function coverClamp(it) {
    if (it.fit !== "custom" || !it.iw || !it.ih) return;
    var min = Math.max(it.w / it.iw, it.h / it.ih);
    if (it.isc < min) it.isc = min;
    var w = it.iw * it.isc, h = it.ih * it.isc;
    it.ix = Math.min(0, Math.max(it.w - w, it.ix));
    it.iy = Math.min(0, Math.max(it.h - h, it.iy));
  }
  ED.coverClamp = coverClamp;

  // --- rotate ---
  function doRotate(p, free) {
    var s = drag.start, cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    var ang = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI - 90;
    while (ang > 180) ang -= 360;
    while (ang < -180) ang += 360;
    if (!free) {
      var snapTo = Math.round(ang / 45) * 45;
      if (Math.abs(ang - snapTo) < 4) ang = snapTo;
    }
    ang = Math.round(ang * 10) / 10;
    AT.live(Math.round(ang) + "°");
    AT.op(function (d, nw) {
      var it = M.find(d.items, s.id);
      if (!it) return false;
      it.rot = ang === -180 ? 180 : ang;
      M.touch(it, nw);
    });
  }

  // --- line ends ---
  function doEnd(p, free) {
    var s = drag.start, end = drag.h.id;
    var ax = end === "p0" ? s.x + s.w : s.x, ay = end === "p0" ? s.y + s.h : s.y;   // the fixed end
    var px = p.x, py = p.y;
    if (!free) {
      var ang = Math.atan2(py - ay, px - ax), sn = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      if (Math.abs(ang - sn) < 0.07) { var len = Math.hypot(px - ax, py - ay); px = ax + Math.cos(sn) * len; py = ay + Math.sin(sn) * len; }
    }
    AT.op(function (d, nw) {
      var it = M.find(d.items, s.id);
      if (!it) return false;
      if (end === "p0") { it.x = px; it.y = py; it.w = ax - px; it.h = ay - py; }
      else { it.x = ax; it.y = ay; it.w = px - ax; it.h = py - ay; }
      M.touch(it, nw);
    });
  }

  // ---------- 8. Crop ----------
  function enterCrop(id) {
    var it = find(id);
    if (!it || it.ax.k !== "photo" || !it.a || it.lock) return;
    exitText();
    if (it.fit !== "custom") {
      var r = R.imageRect(it);
      AT.editItems([id], function (x) { x.fit = "custom"; x.ix = r.x; x.iy = r.y; x.isc = r.w / (x.iw || 1); });
    }
    ED.cropId = id;
    ED.sel = [id];
    $("crop-bar").hidden = false;
    syncCropSlider();
    AT.emit("sel");
    redraw();
  }
  ED.enterCrop = enterCrop;
  function exitCrop() {
    if (!ED.cropId) return;
    ED.cropId = null;
    $("crop-bar").hidden = true;
    AT.endGesture();
    AT.emit("sel");
    redraw();
  }
  ED.exitCrop = exitCrop;
  function minScale(it) { return Math.max(it.w / (it.iw || 1), it.h / (it.ih || 1)); }
  function syncCropSlider() {
    var it = find(ED.cropId);
    if (!it) return;
    $("crop-zoom").value = String(Math.round(it.isc / minScale(it) * 100));
  }
  function doCropPan(sp) {
    var s = drag.start, a = -(s.rot || 0) * Math.PI / 180;
    var d = rotate((sp.x - drag.sx) / ED.zoom, (sp.y - drag.sy) / ED.zoom, a);
    var flx = s.ax.flh ? -1 : 1, fly = s.ax.flv ? -1 : 1;
    AT.op(function (dd, nw) {
      var it = M.find(dd.items, s.id);
      if (!it) return false;
      it.ix = s.ix + d.x * flx; it.iy = s.iy + d.y * fly;
      coverClamp(it);
      M.touch(it, nw);
    });
  }
  // k relative to the scale at the start of the gesture
  function cropZoom(start, k) {
    AT.op(function (dd, nw) {
      var it = M.find(dd.items, start.id);
      if (!it) return false;
      var ns = Math.max(minScale(start), Math.min(minScale(start) * 5, start.isc * k));
      // zoom about the frame centre
      var cx = start.w / 2, cy = start.h / 2;
      it.ix = cx - (cx - start.ix) * ns / start.isc;
      it.iy = cy - (cy - start.iy) * ns / start.isc;
      it.isc = ns;
      coverClamp(it);
      M.touch(it, nw);
    });
    syncCropSlider();
  }

  // ---------- 9. Text editing ----------
  var txStart = null, growId = null;
  function enterText(id, selectAll) {
    var it = find(id);
    if (!it || it.ax.k !== "text" || it.lock) return;
    exitCrop();
    ED.editId = id;
    ED.sel = [id];
    var ta = $("tx-edit");
    ta.value = it.ax.tx || "";
    txStart = ta.value;
    ta.hidden = false;
    positionOverlays();
    AT.emit("sel");
    redraw();
    setTimeout(function () {
      ta.focus({ preventScroll: true });
      if (selectAll) ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
  }
  ED.enterText = enterText;
  function exitText() {
    if (!ED.editId) return;
    var id = ED.editId;
    ED.editId = null;
    growId = null;
    var ta = $("tx-edit");
    ta.hidden = true;
    AT.endGesture();
    var it = find(id);
    if (it && !String(it.ax.tx || "").trim()) {
      AT.op(function (d, nw) {
        d.items = d.items.filter(function (x) { return x.id !== id; });
        d.tombs[id] = nw;
      });
      ED.sel = [];
    }
    AT.emit("sel");
    redraw();
  }
  ED.exitText = exitText;

  function onTextInput() {
    var id = ED.editId;
    if (!id) return;
    var v = $("tx-edit").value.slice(0, AX.MAX_TX);
    AT.beginGesture();
    AT.editItems([id], function (it, d) {
      it.ax.tx = v;
      // a new text box grows with what is typed (up to the page)
      if (growId === id && !it.ax.cv) {
        var nw = Math.min(d.setup.w * 0.9, Math.max(it.w, AX.textWidth(it.ax)));
        if (nw > it.w) { it.x -= (nw - it.w) / 2; it.w = nw; }
      }
    });
    positionOverlays();
  }

  // Place the textarea over the text element (rotation included).
  function positionOverlays() {
    var ta = $("tx-edit");
    if (ED.editId && !ta.hidden) {
      var it = find(ED.editId);
      if (!it) { ED.editId = null; ta.hidden = true; return; }
      var ax = it.ax, z = ED.zoom;
      var key = AX.fontKeyOf(ax), size = ax.size || 48;
      var p = toScreen(it.x, it.y);
      ta.style.left = p.x + "px"; ta.style.top = p.y + "px";
      var w = ax.cv ? Math.max(it.w, AX.textWidth(ax)) : it.w;
      ta.style.width = (w * z + 2) + "px";
      ta.style.height = Math.max(it.h, size * (ax.lh || 120) / 100) * z + "px";
      ta.style.transform = it.rot ? "rotate(" + it.rot + "deg)" : "";
      ta.style.fontFamily = T.cssStack(key) + ', sans-serif';
      ta.style.fontSize = size * z + "px";
      ta.style.lineHeight = size * (ax.lh || 120) / 100 * z + "px";
      ta.style.letterSpacing = (ax.tr || 0) / 1000 + "em";
      ta.style.textAlign = { l: "left", c: "center", r: "right", j: "justify" }[ax.al || "l"];
      ta.style.textTransform = ax.caps ? "uppercase" : "none";
      ta.style.textDecoration = ax.u ? "underline" : "none";
      ta.style.color = ax.fc || "#000000";
      // first baseline: the canvas puts it at the font's ascent
      var asc = T.ascent(key, size), lead = size * (ax.lh || 120) / 100;
      ta.style.paddingTop = Math.max(0, (asc - (lead / 2 + size * 0.35))) * z + "px";
    }
  }
  ED.positionOverlays = positionOverlays;

  // ---------- 10. Wheel + keys ----------
  var spaceDown = false;
  function onWheel(e) {
    e.preventDefault();
    var sp = evPos(e);
    if (ED.cropId && !e.ctrlKey) {
      var it = find(ED.cropId);
      if (it) { AT.beginGesture(); cropZoom(it, Math.exp(-e.deltaY / 400)); clearTimeout(onWheel.tm); onWheel.tm = setTimeout(AT.endGesture, 400); }
      return;
    }
    if (e.ctrlKey || e.metaKey) zoomAt(ED.zoom * Math.exp(-e.deltaY / 300), sp.x, sp.y);
    else {
      ED.ox -= e.shiftKey ? e.deltaY : e.deltaX; ED.oy -= e.shiftKey ? 0 : e.deltaY;
      clampView(); positionOverlays(); redraw();
    }
  }

  function typing(e) {
    var tg = e.target;
    return tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable);
  }
  function onKey(e) {
    if (!doc() || $("editor").hidden || $("dlg").open) return;
    if (e.key === " " && !typing(e)) { spaceDown = e.type === "keydown"; return; }
    if (e.type !== "keydown") return;
    if (ED.editId) {
      if (e.key === "Escape") { e.preventDefault(); exitText(); cv.focus(); }
      return;
    }
    if (typing(e)) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) AT.redo(); else AT.undo(); return; }
    if (mod && k === "y") { e.preventDefault(); AT.redo(); return; }
    if (mod && k === "a") { e.preventDefault(); ED.selectAll(); return; }
    if (mod && k === "d") { e.preventDefault(); ED.duplicate(); return; }
    if (mod && k === "c") { e.preventDefault(); ED.copy(); return; }
    if (mod && k === "x") { e.preventDefault(); ED.copy(); ED.remove(); return; }
    if (mod && k === "v") { e.preventDefault(); ED.paste(); return; }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); ED.zoomBy(1.25); return; }
    if (mod && k === "-") { e.preventDefault(); ED.zoomBy(0.8); return; }
    if (mod && k === "0") { e.preventDefault(); fit(); return; }
    if (e.key === "Escape") { if (ED.cropId) exitCrop(); else select([]); return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (ED.sel.length) { e.preventDefault(); ED.remove(); } return; }
    if (e.key === "Enter") {
      var one = selItems();
      if (one.length === 1 && one[0].ax.k === "text") { e.preventDefault(); enterText(one[0].id); }
      else if (one.length === 1 && one[0].ax.k === "photo") { e.preventDefault(); enterCrop(one[0].id); }
      return;
    }
    var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && ED.sel.length) {
      e.preventDefault();
      var st = e.shiftKey ? 10 : 1, v = arrows[e.key];
      if (AT.isPrint()) st = st * M.PT_PER.mm / 2;
      AT.editItems(ED.sel, function (it) { if (it.lock) return false; it.x += v[0] * st; it.y += v[1] * st; });
    }
  }

  // ---------- 11. Element actions ----------
  ED.remove = function () {
    var ids = selItems().filter(function (it) { return !it.lock && !isBg(it); }).map(function (it) { return it.id; });
    if (!ids.length) { if (ED.sel.length) AT.toast(t("toast.locked")); return; }
    AT.op(function (d, nw) {
      d.items = d.items.filter(function (it) { return ids.indexOf(it.id) < 0; });
      ids.forEach(function (id) { d.tombs[id] = nw; });
    });
    select([]);
    AT.toast(t("toast.deleted"), t("btn.undo"), AT.undo);
  };

  function cloneInto(d, list, pg, off, nw) {
    var out = [], z = AX.nextZ(d, pg);
    list.slice().sort(M.byZ).forEach(function (src) {
      if (d.items.length >= M.MAX_ITEMS) return;
      var c = JSON.parse(JSON.stringify(src));
      c.id = M.newId("it"); c.m = nw; c.pg = pg; c.z = z++;
      c.x += off; c.y += off; c.lock = 0;
      if (c.ax) delete c.ax.bg;
      var n = M.normItem(c);
      if (n) { d.items.push(n); out.push(n.id); }
    });
    return out;
  }
  ED.duplicate = function () {
    var list = selItems().filter(function (it) { return !isBg(it); });
    if (!list.length) return;
    var made = [], off = Math.max(doc().setup.w, doc().setup.h) / 60;
    AT.op(function (d, nw) { made = cloneInto(d, list, ED.pg, off, nw); if (!made.length) return false; });
    select(made);
  };
  var clip = null;
  ED.copy = function () {
    var list = selItems().filter(function (it) { return !isBg(it); });
    if (!list.length) return;
    clip = JSON.parse(JSON.stringify(list));
    AT.toast(t("toast.copied"));
  };
  ED.paste = function () {
    if (!clip || !clip.length) return;
    var made = [], same = clip.every(function (c) { return !!find(c.id); });
    var off = same ? Math.max(doc().setup.w, doc().setup.h) / 60 : 0;
    AT.op(function (d, nw) { made = cloneInto(d, clip, ED.pg, off, nw); if (!made.length) return false; });
    select(made);
  };
  ED.hasClip = function () { return !!(clip && clip.length); };

  // z order: front / fwd / bwd / back (the background stays last)
  ED.arrange = function (how) {
    var sel = selItems().filter(function (it) { return !isBg(it); });
    if (!sel.length) return;
    var ids = sel.map(function (it) { return it.id; });
    AT.op(function (d, nw) {
      var list = d.items.filter(function (it) { return it.pg === ED.pg && !(it.ax && it.ax.bg); }).sort(M.byZ);
      var inSel = function (it) { return ids.indexOf(it.id) >= 0; };
      var order;
      if (how === "front") order = list.filter(function (it) { return !inSel(it); }).concat(list.filter(inSel));
      else if (how === "back") order = list.filter(inSel).concat(list.filter(function (it) { return !inSel(it); }));
      else {
        order = list.slice();
        if (how === "fwd") {
          for (var i = order.length - 2; i >= 0; i--) if (inSel(order[i]) && !inSel(order[i + 1])) { var a = order[i]; order[i] = order[i + 1]; order[i + 1] = a; }
        } else {
          for (var j = 1; j < order.length; j++) if (inSel(order[j]) && !inSel(order[j - 1])) { var b = order[j]; order[j] = order[j - 1]; order[j - 1] = b; }
        }
      }
      order.forEach(function (it, k) { if (it.z !== k + 1) { it.z = k + 1; M.touch(it, nw); } });
    });
  };

  // align to page (one element) or to the selection box (several)
  ED.align = function (how) {
    var sel = selItems().filter(function (it) { return !isBg(it) && !it.lock; });
    if (!sel.length) return;
    var s = doc().setup;
    var box = sel.length > 1 ? selBox(sel) : { x: 0, y: 0, w: s.w, h: s.h };
    AT.editItems(sel.map(function (it) { return it.id; }), function (it) {
      var b = R.itemBox(it), dx = 0, dy = 0;
      if (how === "al") dx = box.x - b.x;
      if (how === "ac") dx = box.x + box.w / 2 - (b.x + b.w / 2);
      if (how === "ar") dx = box.x + box.w - (b.x + b.w);
      if (how === "at") dy = box.y - b.y;
      if (how === "am") dy = box.y + box.h / 2 - (b.y + b.h / 2);
      if (how === "ab") dy = box.y + box.h - (b.y + b.h);
      it.x += dx; it.y += dy;
    });
  };

  // ---------- 12. Pages ----------
  var pageThumbs = {};
  function renderPages() {
    var host = $("pages");
    if (!host || !doc()) return;
    host.innerHTML = "";
    var ps = M.pagesInOrder(doc()), s = doc().setup;
    var th = 44, tw = Math.max(24, Math.min(80, th * s.w / s.h));
    ps.forEach(function (p, i) {
      var b = el("button", "pg-tile" + (p.id === ED.pg ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "listitem");
      b.setAttribute("aria-label", t("pg.n", { n: i + 1 }));
      b.title = t("pg.n", { n: i + 1 });
      var box = el("span", "pg-thumb");
      box.style.width = tw + "px"; box.style.height = (tw * s.h / s.w) + "px";
      var key = p.id + ":" + JSON.stringify(doc().items.filter(function (it) { return it.pg === p.id; }).map(function (it) { return it.m; })) + s.w + "x" + s.h;
      if (!pageThumbs[p.id] || pageThumbs[p.id].key !== key) {
        try {
          var c = AT.draw.renderPage(doc(), p, tw * Math.min(2, dpr) / s.w, { maxSide: 300, background: "#ffffff" });
          pageThumbs[p.id] = { key: key, url: c.toDataURL("image/png") };
        } catch (e) { pageThumbs[p.id] = { key: key, url: "" }; }
      }
      if (pageThumbs[p.id].url) { var img = el("img"); img.src = pageThumbs[p.id].url; img.alt = ""; box.appendChild(img); }
      b.appendChild(box);
      b.appendChild(el("span", "pg-n", String(i + 1)));
      b.addEventListener("click", function () {
        if (p.id === ED.pg) pageMenu(b);
        else setPage(p.id);
      });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); if (p.id !== ED.pg) setPage(p.id); pageMenu(b); });
      host.appendChild(b);
    });
    var add = AT.iconBtn("plus", t("pg.add"), "pg-add");
    add.addEventListener("click", function () { addPage(false); });
    host.appendChild(add);
    var cur = host.querySelector(".pg-tile.on");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  ED.renderPages = renderPages;
  var pagesTimer = null;
  function renderPagesSoon() { clearTimeout(pagesTimer); pagesTimer = setTimeout(renderPages, 250); }

  function pageMenu(anchor) {
    var ps = M.pagesInOrder(doc()), i = ED.pageIndex();
    AT.menu(anchor, [
      { label: t("pg.add"), fn: function () { addPage(false); } },
      { label: t("pg.dup"), fn: function () { addPage(true); } },
      { label: t("pg.left"), disabled: i === 0, fn: function () { movePage(-1); } },
      { label: t("pg.right"), disabled: i >= ps.length - 1, fn: function () { movePage(1); } },
      { sep: true },
      { label: t("pg.del"), danger: true, fn: deletePage }
    ]);
  }

  function addPage(dup) {
    var ps = M.pagesInOrder(doc());
    if (ps.length >= M.MAX_PAGES) { AT.toast(t("pg.max", { n: M.MAX_PAGES })); return; }
    var i = ED.pageIndex(), cur = ps[i], next = ps[i + 1];
    var pos = next ? (cur.pos + next.pos) / 2 : cur.pos + 1024;
    var nid = null;
    AT.op(function (d, nw) {
      var p = { id: M.newId("pg"), m: nw, pos: pos, ms: "" };
      d.pages.push(p);
      nid = p.id;
      if (dup) {
        var src = d.items.filter(function (it) { return it.pg === cur.id; });
        src.sort(M.byZ).forEach(function (s) {
          var c = JSON.parse(JSON.stringify(s));
          c.id = M.newId("it"); c.m = nw; c.pg = p.id;
          var n = M.normItem(c);
          if (n) d.items.push(n);
        });
      } else {
        var bg = AX.background(d, cur.id);
        var b = AX.addBackground(d, p.id, bg && bg.ax.fc ? bg.ax.fc : "#ffffff", nw);
        if (b && bg && bg.ax.g) b.ax.g = JSON.parse(JSON.stringify(bg.ax.g));
      }
    });
    if (nid) setPage(nid);
  }
  function movePage(dir) {
    var ps = M.pagesInOrder(doc()), i = ED.pageIndex(), j = i + dir;
    if (j < 0 || j >= ps.length) return;
    var a = ps[i], b = ps[j];
    var newPos;
    var k = j + dir;
    if (k < 0) newPos = b.pos - 1024;
    else if (k >= ps.length) newPos = b.pos + 1024;
    else newPos = (b.pos + ps[k].pos) / 2;
    AT.op(function (d, nw) { var p = M.find(d.pages, a.id); p.pos = newPos; M.touch(p, nw); });
    renderPages();
  }
  function deletePage() {
    var ps = M.pagesInOrder(doc());
    if (ps.length <= 1) { AT.toast(t("pg.lastOne")); return; }
    var i = ED.pageIndex(), id = ED.pg;
    AT.op(function (d, nw) {
      d.items.filter(function (it) { return it.pg === id; }).forEach(function (it) { d.tombs[it.id] = nw; });
      d.items = d.items.filter(function (it) { return it.pg !== id; });
      d.pages = d.pages.filter(function (p) { return p.id !== id; });
      d.tombs[id] = nw;
    });
    var rest = M.pagesInOrder(doc());
    setPage(rest[Math.min(i, rest.length - 1)].id);
    AT.toast(t("toast.deleted"), t("btn.undo"), AT.undo);
  }

  // ---------- 13. Wiring ----------
  AT.on("boot", function () {
    cv = $("cv"); stage = $("stage");
    ctx = cv.getContext("2d");
    cv.setAttribute("aria-label", t("a11y.canvas"));
    $("pages").setAttribute("aria-label", t("a11y.pages"));
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("pointerleave", function () { if (hoverId) { hoverId = null; redraw(); } });
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("dblclick", function (e) {
      var sp = evPos(e), p = toPage(sp.x, sp.y), it = hitItem(p.x, p.y, false);
      if (it && it.ax.k === "photo") enterCrop(it.id);
      else if (it && it.ax.k === "text") enterText(it.id);
    });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    var ta = $("tx-edit");
    ta.addEventListener("input", onTextInput);
    ta.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== ta) exitText(); }, 120); });
    $("crop-done").addEventListener("click", exitCrop);
    $("crop-reset").addEventListener("click", function () {
      if (!ED.cropId) return;
      AT.editItems([ED.cropId], function (it) { it.fit = "fill"; });
      var it = find(ED.cropId), r = R.imageRect(it);
      AT.editItems([ED.cropId], function (x) { x.fit = "custom"; x.ix = r.x; x.iy = r.y; x.isc = r.w / (x.iw || 1); });
      syncCropSlider();
    });
    $("crop-zoom").addEventListener("input", function () {
      var it = find(ED.cropId);
      if (!it) return;
      AT.beginGesture();
      cropZoom(it, (Number(this.value) / 100) * minScale(it) / it.isc);
    });
    $("crop-zoom").addEventListener("change", function () { AT.endGesture(); });
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("stage"));
    window.addEventListener("resize", resize);
  });

  AT.on("open", function () {
    ED.pg = M.pagesInOrder(doc())[0].id;
    ED.sel = []; ED.editId = null; ED.cropId = null;
    pageThumbs = {};
    fitted = false;
    $("crop-bar").hidden = true; $("tx-edit").hidden = true;
    setTimeout(function () { resize(); fit(); renderPages(); }, 0);
    AT.emit("sel");
  });
  AT.on("close", function () { exitText(); exitCrop(); });
  function onDocChange() {
    if (!doc()) return;
    if (!M.find(doc().pages, ED.pg)) { ED.pg = M.pagesInOrder(doc())[0].id; renderPages(); }
    var before = ED.sel.length;
    ED.sel = ED.sel.filter(function (id) { var it = find(id); return it && it.pg === ED.pg; });
    if (ED.editId && !find(ED.editId)) exitText();
    if (ED.cropId && !find(ED.cropId)) exitCrop();
    if (ED.sel.length !== before) AT.emit("sel");
    positionOverlays();
    redraw();
    renderPagesSoon();
  }
  AT.on("doc", function () {
    onDocChange();
    // the canvas follows a text edited elsewhere (panels): keep the
    // textarea in step
    var ta = $("tx-edit");
    if (ED.editId && !ta.hidden) {
      var it = find(ED.editId);
      if (it && document.activeElement !== ta && ta.value !== it.ax.tx) ta.value = it.ax.tx || "";
    }
  });
  AT.on("remote", function () { onDocChange(); AT.emit("sel"); });
  window.orosDK.assets.onChange(function () { AT.draw.clearCaches(); pageThumbs = {}; redraw(); renderPagesSoon(); });
  // a font arrived (text layout caches follow T.generation())
  AT.on("fonts", function () { pageThumbs = {}; redraw(); renderPagesSoon(); });
  AT.on("remote", function () {
    if (AT.doc) T.load(AT.draw.fontKeys(AT.doc)).then(function () { AT.emit("fonts"); }, function () {});
  });
})();
