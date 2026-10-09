// ============================================================
// orOS Slides — editor (v1.0.0)
// The slide canvas (drawn by designkit through dk.js) with an HTML
// overlay for hit boxes, placeholders, selection handles and smart
// guides; the slide strip, the sorter, the outline view and the
// speaker notes; insert tools, keyboard, clipboard.
// Coordinates: slide units (height 1000, width 1778 or 1333).
// Sections:
//   1. State + view switching
//   2. Drawing (canvas + overlay)
//   3. Pointer: select, move, resize, rotate, guides
//   4. Item edits, insert tools, clipboard
//   5. Slide strip + slide menu
//   6. Sorter
//   7. Outline + notes
//   8. Keyboard, wiring
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = SL.C, t = SL.t, $ = SL.$, el = SL.el;
  var ED = SL.ed = {};

  // ---------- 1. State + view switching ----------
  ED.cur = null;            // current slide id
  ED.sel = [];              // selected item ids
  var view = "slide";
  var scale = 1;            // CSS px per slide unit
  var drawQueued = false, stripQueued = false;

  function deck() { return SL.curDeck(); }
  function W() { var d = deck(); return d ? C.widthOf(d.as) : 1778; }
  function slides() { return SL.deck ? C.deckSlides(SL.data(), SL.deck) : []; }
  function item(id) { return SL.data().items[id] || null; }
  function curItems() { return ED.cur ? C.slideItems(SL.data(), ED.cur) : []; }
  ED.W = W; ED.slides = slides; ED.item = item; ED.curItems = curItems;

  function ensureCur() {
    var list = slides();
    if (!list.length) { ED.cur = null; return; }
    if (!ED.cur || !SL.data().slides[ED.cur] || SL.data().slides[ED.cur].d !== SL.deck) ED.cur = list[0].id;
    ED.sel = ED.sel.filter(function (id) { var it = item(id); return it && it.s === ED.cur; });
  }
  ED.go = function (slideId) {
    if (!SL.data().slides[slideId]) return;
    if (ED.cur !== slideId) { SL.text.stop(); flushNotes(); ED.sel = []; }
    ED.cur = slideId;
    refreshAll();
    var n = indexOf(slideId);
    SL.live(t("slide.n", { n: n + 1 }));
    var th = $("strip").querySelector('[data-id="' + slideId + '"]');
    if (th && th.scrollIntoView) th.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  function indexOf(slideId) {
    var list = slides();
    for (var i = 0; i < list.length; i++) if (list[i].id === slideId) return i;
    return -1;
  }
  ED.indexOf = indexOf;
  ED.select = function (ids) {
    ED.sel = ids.filter(function (id) { var it = item(id); return it && it.s === ED.cur; });
    drawOverlay();
    SL.panels.render();
  };

  function setView(v) {
    SL.text.stop(); flushNotes(); flushOutline();
    view = v;
    SL.prefs.view = v; SL.savePrefs();
    [].forEach.call($("ed-views").children, function (b) {
      var on = b.getAttribute("data-v") === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.body.setAttribute("data-view", v);
    $("strip").hidden = v !== "slide";
    $("center").hidden = v !== "slide";
    $("sorter").hidden = v !== "sorter";
    $("outline").hidden = v !== "outline";
    if (v !== "slide") document.body.classList.remove("side-open");
    refreshAll();
  }
  ED.setView = setView;
  ED.view = function () { return view; };

  function refreshAll() {
    ensureCur();
    if (view === "slide") { fitStage(); draw(); renderStrip(); loadNotes(); }
    else if (view === "sorter") renderSorter();
    else loadOutline();
    SL.panels.render();
    updateBar();
  }
  ED.refresh = refreshAll;

  function updateBar() {
    $("ed-undo").disabled = !SL.canUndo();
    $("ed-redo").disabled = !SL.canRedo();
    var d = deck();
    if (d) $("ed-name").textContent = SL.deckTitle(d);
  }

  // ---------- 2. Drawing ----------
  function fitStage() {
    var st = $("stage"), cw = st.clientWidth, ch = st.clientHeight;
    if (!cw || !ch) return;
    var pad = cw < 500 ? 10 : 28;
    scale = Math.max(0.05, Math.min((cw - 2 * pad) / W(), (ch - 2 * pad) / C.H));
    var w = Math.round(W() * scale), h = Math.round(C.H * scale);
    var x = Math.round((cw - w) / 2), y = Math.round((ch - h) / 2);
    [$("cv"), $("ov")].forEach(function (n) {
      n.style.left = x + "px"; n.style.top = y + "px";
      n.style.width = w + "px"; n.style.height = h + "px";
    });
    $("ov").style.setProperty("--s", String(scale));
  }
  ED.scale = function () { return scale; };

  function draw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      if (view !== "slide" || !ED.cur || !SL.data().slides[ED.cur]) return;
      var cv = $("cv"), dpr = window.devicePixelRatio || 1;
      try {
        SL.renderSlide(ED.cur, Math.round(W() * scale * dpr), { canvas: cv, editing: SL.text.active() ? { skip: SL.text.active() } : null });
      } catch (e) { console.error(e); }
      drawOverlay();
    });
  }
  ED.draw = draw;

  function px(v) { return Math.round(v * scale * 100) / 100 + "px"; }
  function place(n, it) {
    n.style.left = px(it.x); n.style.top = px(it.y);
    n.style.width = px(it.w); n.style.height = px(it.h);
    n.style.transform = it.r ? "rotate(" + it.r + "deg)" : "";
  }

  var guides = [];
  function drawOverlay() {
    var ov = $("ov");
    ov.innerHTML = "";
    if (!ED.cur) return;
    var editing = SL.text.active(), th = C.themeById(deck().th);
    curItems().forEach(function (it) {
      var n = el("div", "hit");
      n.setAttribute("data-id", it.id);
      place(n, it);
      if (C.isEmptyPlaceholder(it)) {
        n.classList.add("ph-empty");
        var lbl = el("span", "ph-lbl", t("ph." + it.ph));
        if (it.k === "image") lbl.innerHTML = SL.icon("image") + "<span></span>", lbl.lastChild.textContent = t("ph.img");
        n.appendChild(lbl);
      } else if (it.k === "text" && !C.itemText(it).trim() && it.id !== editing) {
        n.classList.add("ph-empty");
        n.appendChild(el("span", "ph-lbl", t("ph.text")));
      }
      if (it.k === "image" && it.img && SL.A.isMissing(it.img.a)) {
        n.classList.add("missing");
        n.title = t("img.missing");
      }
      if (it.k === "text" && it.id !== editing && SL.D.fitOf(it, th).over) n.classList.add("overset");
      if (it.lk) n.classList.add("locked");
      ov.appendChild(n);
    });
    // selection
    var sel = ED.sel.map(item).filter(Boolean);
    if (sel.length === 1 && sel[0].id !== editing) {
      var it = sel[0], box = el("div", "selbox" + (it.lk ? " locked" : ""));
      place(box, it);
      if (!it.lk) {
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (h) {
          var hd = el("div", "hd hd-" + h); hd.setAttribute("data-h", h); box.appendChild(hd);
        });
        var rot = el("div", "hd hd-rot"); rot.setAttribute("data-h", "rot"); box.appendChild(rot);
      }
      ov.appendChild(box);
    } else if (sel.length > 1) {
      sel.forEach(function (x) { var b = el("div", "selbox multi"); place(b, x); ov.appendChild(b); });
    }
    guides.forEach(function (g) {
      var gl = el("div", "guide " + g.o);
      if (g.o === "v") { gl.style.left = px(g.p); } else { gl.style.top = px(g.p); }
      ov.appendChild(gl);
    });
    if (editing) SL.text.place();
  }
  ED.drawOverlay = drawOverlay;

  // ---------- 3. Pointer ----------
  var drag = null;
  function unitsAt(e) {
    var r = $("ov").getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  function rotP(x, y, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  // Bounding box of items (rotation included).
  function bounds(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (it) {
      var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        var p = rotP(c[0] * it.w / 2, c[1] * it.h / 2, it.r || 0);
        x0 = Math.min(x0, cx + p.x); x1 = Math.max(x1, cx + p.x);
        y0 = Math.min(y0, cy + p.y); y1 = Math.max(y1, cy + p.y);
      });
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  ED.bounds = bounds;

  // Smart guides: snap the moving box's edges / centre to the slide
  // and to the other objects.
  function snapMove(b, others, tol) {
    var xs = [0, W() / 2, W()], ys = [0, C.H / 2, C.H];
    others.forEach(function (o) {
      var ob = bounds([o]);
      xs.push(ob.x, ob.x + ob.w / 2, ob.x + ob.w);
      ys.push(ob.y, ob.y + ob.h / 2, ob.y + ob.h);
    });
    var out = { dx: 0, dy: 0, g: [] };
    function best(vals, cands) {
      var bd = tol + 1, bv = null, bc = null;
      vals.forEach(function (v) { cands.forEach(function (c) { var d = Math.abs(c - v); if (d < bd) { bd = d; bv = v; bc = c; } }); });
      return bv === null ? null : { d: bc - bv, at: bc };
    }
    var sx = best([b.x, b.x + b.w / 2, b.x + b.w], xs), sy = best([b.y, b.y + b.h / 2, b.y + b.h], ys);
    if (sx) { out.dx = sx.d; out.g.push({ o: "v", p: sx.at }); }
    if (sy) { out.dy = sy.d; out.g.push({ o: "h", p: sy.at }); }
    return out;
  }

  var longTimer = null;
  function onDown(e) {
    if (e.button > 0 && e.pointerType === "mouse") return;
    var hd = e.target.closest(".hd"), hit = e.target.closest(".hit");
    var p = unitsAt(e);
    if (SL.text.active() && !(hit && hit.getAttribute("data-id") === SL.text.active())) SL.text.stop();
    if (hd) {
      var it = item(ED.sel[0]);
      if (!it || it.lk) return;
      e.preventDefault();
      $("ov").setPointerCapture(e.pointerId);
      SL.beginGesture();
      drag = { kind: hd.getAttribute("data-h") === "rot" ? "rot" : "size", h: hd.getAttribute("data-h"), id: it.id, start: p, o: JSON.parse(JSON.stringify(it)), shift: e.shiftKey };
      return;
    }
    if (!hit) {
      ED.select([]);
      return;
    }
    var id = hit.getAttribute("data-id"), was = ED.sel.indexOf(id) >= 0;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ED.select(was ? ED.sel.filter(function (x) { return x !== id; }) : ED.sel.concat([id]));
      return;
    }
    if (!was) ED.select([id]);
    e.preventDefault();
    $("ov").setPointerCapture(e.pointerId);
    var list = ED.sel.map(item).filter(function (x) { return x && !x.lk; });
    drag = { kind: "move", id: id, was: was, start: p, o: list.map(function (x) { return JSON.parse(JSON.stringify(x)); }), moved: false, client: { x: e.clientX, y: e.clientY } };
    clearTimeout(longTimer);
    if (e.pointerType !== "mouse") {
      var cx = e.clientX, cy = e.clientY;
      longTimer = setTimeout(function () {
        if (drag && !drag.moved) { drag = null; itemMenu(null, { x: cx, y: cy }); }
      }, 550);
    }
  }
  function onMove(e) {
    if (!drag) return;
    var p = unitsAt(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.kind === "move") {
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.client.x) + Math.abs(e.clientY - drag.client.y) < 5 || !drag.o.length) return;
        drag.moved = true;
        clearTimeout(longTimer);
        SL.beginGesture();
      }
      var b = bounds(drag.o);
      b.x += dx; b.y += dy;
      var ids = {};
      drag.o.forEach(function (o) { ids[o.id] = 1; });
      var sn = e.altKey ? { dx: 0, dy: 0, g: [] } : snapMove(b, curItems().filter(function (x) { return !ids[x.id]; }), 6 / scale);
      guides = sn.g;
      SL.live2(function (dt, nw) {
        drag.o.forEach(function (o) {
          var it = dt.items[o.id];
          if (!it) return;
          it.x = Math.round(o.x + dx + sn.dx); it.y = Math.round(o.y + dy + sn.dy);
          it.m = nw; C.touchSlide(dt, it.s, nw);
        });
      });
    } else if (drag.kind === "size") {
      resizeTo(drag, dx, dy, e.shiftKey);
    } else if (drag.kind === "rot") {
      var o = drag.o, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      var a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      else [0, 90, 180, 270, 360, -90, -180].forEach(function (q) { if (Math.abs(a - q) < 4) a = q; });
      a = ((Math.round(a) % 360) + 540) % 360 - 180;
      SL.live2(function (dt, nw) {
        var it = dt.items[o.id];
        if (it) { it.r = a; it.m = nw; C.touchSlide(dt, it.s, nw); }
      });
    }
  }
  function resizeTo(d, dx, dy, shift) {
    var o = d.o, h = d.h;
    var sx = h.indexOf("e") >= 0 ? 1 : h.indexOf("w") >= 0 ? -1 : 0;
    var sy = h.indexOf("s") >= 0 ? 1 : h.indexOf("n") === 0 ? -1 : 0;
    var l = rotP(dx, dy, -(o.r || 0));
    var w = Math.max(10, o.w + sx * l.x), hh = Math.max(10, o.h + sy * l.y);
    var keep = (shift || (o.k === "image" && o.img)) && sx && sy;
    if (keep) {
      var k = Math.max(w / o.w, hh / o.h);
      w = Math.max(10, o.w * k); hh = Math.max(10, o.h * k);
    }
    if (!sx) w = o.w;
    if (!sy) hh = o.h;
    // the opposite edge / corner stays where it was
    var c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    var anchor = rotP(-sx * o.w / 2, -sy * o.h / 2, o.r || 0);
    var ax = c0.x + anchor.x, ay = c0.y + anchor.y;
    var back = rotP(sx * w / 2, sy * hh / 2, o.r || 0);
    var cx = sx || sy ? ax + back.x : c0.x, cy = sx || sy ? ay + back.y : c0.y;
    if (!sx) { var off = rotP(0, sy * hh / 2, o.r || 0); var a2 = rotP(0, -sy * o.h / 2, o.r || 0); cx = c0.x + a2.x + off.x; cy = c0.y + a2.y + off.y; }
    if (!sy) { var off2 = rotP(sx * w / 2, 0, o.r || 0); var a3 = rotP(-sx * o.w / 2, 0, o.r || 0); cx = c0.x + a3.x + off2.x; cy = c0.y + a3.y + off2.y; }
    SL.live2(function (dt, nw) {
      var it = dt.items[o.id];
      if (!it) return;
      it.w = Math.round(w); it.h = Math.round(hh);
      it.x = Math.round(cx - w / 2); it.y = Math.round(cy - hh / 2);
      it.m = nw; C.touchSlide(dt, it.s, nw);
    });
  }
  function onUp(e) {
    clearTimeout(longTimer);
    if (!drag) return;
    var d = drag;
    drag = null;
    guides = [];
    if (d.kind === "move" && !d.moved) {
      var it = item(d.id);
      if (!it) return;
      // a tap on a selected text box (or an empty placeholder) edits it
      if (it.k === "text" && !it.lk && (d.was || C.isEmptyPlaceholder(it))) SL.text.start(it.id);
      else if (it.k === "image" && !it.img) SL.io.placeImage(it.id);
      else drawOverlay();
      return;
    }
    SL.endGesture();
    drawOverlay();
  }
  function onDbl(e) {
    var hit = e.target.closest(".hit");
    if (!hit) return;
    var it = item(hit.getAttribute("data-id"));
    if (!it) return;
    if (it.k === "text") SL.text.start(it.id);
    else if (it.k === "image") SL.io.placeImage(it.id);
  }

  // ---------- 4. Item edits, insert tools, clipboard ----------
  // Change items in one undo step; each changed one is stamped (R27)
  // and its slide and deck learn that something inside changed.
  ED.editItems = function (ids, fn) {
    return SL.op(function (dt, nw) {
      var ch = false;
      ids.forEach(function (id) {
        var it = dt.items[id];
        if (!it) return;
        var before = JSON.stringify(it);
        fn(it, dt);
        var x = C.normItem(it);
        if (x) { Object.keys(it).forEach(function (k) { delete it[k]; }); Object.keys(x).forEach(function (k) { it[k] = x[k]; }); }
        if (JSON.stringify(it) !== before) { it.m = nw; C.touchSlide(dt, it.s, nw); ch = true; }
      });
      if (!ch) return false;
    });
  };
  ED.editSlide = function (fn) {
    var id = ED.cur;
    return SL.op(function (dt, nw) {
      var s = dt.slides[id];
      if (!s) return false;
      var before = JSON.stringify(s);
      fn(s, dt);
      var x = C.normSlide(s);
      if (x) { Object.keys(s).forEach(function (k) { delete s[k]; }); Object.keys(x).forEach(function (k) { s[k] = x[k]; }); }
      if (JSON.stringify(s) === before) return false;
      s.m = nw; C.touchDeck(dt, s.d, nw);
    });
  };
  ED.editDeck = function (fn) {
    return SL.op(function (dt, nw) {
      var d = dt.decks[SL.deck];
      if (!d) return false;
      var before = JSON.stringify(d);
      fn(d, dt, nw);
      var x = C.normDeck(d);
      if (x) { Object.keys(x).forEach(function (k) { d[k] = x[k]; }); }
      if (JSON.stringify(d) === before) return false;
      d.m = nw;
    });
  };

  function topZ() { var z = 0; curItems().forEach(function (it) { if (it.z > z) z = it.z; }); return z; }
  function roomFor(n) {
    if (curItems().length + n > C.LIM.items) { SL.toast(t("toast.maxItems", { n: C.LIM.items })); return false; }
    return true;
  }
  // A new item on the current slide; returns its id.
  ED.addItem = function (o) {
    if (!ED.cur || !roomFor(1)) return null;
    var id = null;
    SL.op(function (dt, nw, newId) {
      var x = JSON.parse(JSON.stringify(o));
      x.id = newId(); x.m = nw; x.s = ED.cur; x.z = Math.min(C.LIM.z, topZ() + 1);
      x = C.normItem(x);
      if (!x) return false;
      dt.items[x.id] = x;
      C.touchSlide(dt, x.s, nw);
      id = x.id;
    });
    if (id) ED.select([id]);
    return id;
  };
  ED.insert = function (kind) {
    SL.text.stop();
    var w = W(), id;
    if (kind === "text") {
      id = ED.addItem({ k: "text", x: Math.round(w * 0.25), y: 400, w: Math.round(w * 0.5), h: 160, paras: [], al: "l", va: "t", fs: 40 });
      if (id) SL.text.start(id);
    } else if (kind === "image") {
      SL.io.placeImage(null);
    } else if (kind === "rect" || kind === "ell") {
      ED.addItem({ k: "shape", sh: kind === "ell" ? "ellipse" : "rect", x: Math.round(w / 2 - 200), y: 375, w: 400, h: 250, fill: "t:a1" });
    } else if (kind === "line") {
      ED.addItem({ k: "line", x: Math.round(w / 2 - 300), y: 499, w: 600, h: 2, st: "t:fg", sw: 6 });
    }
  };

  ED.deleteSel = function () {
    var ids = ED.sel.slice();
    if (!ids.length) return;
    SL.op(function (dt, nw) {
      ids.forEach(function (id) {
        var it = dt.items[id];
        if (!it) return;
        delete dt.items[id];
        dt.tombs[id] = Math.max(nw, dt.tombs[id] || 0);
        C.touchSlide(dt, it.s, nw);
      });
    });
    ED.select([]);
  };

  var clip = null;
  function copySel() {
    var list = ED.sel.map(item).filter(Boolean);
    if (!list.length) return false;
    clip = { from: ED.cur, items: JSON.parse(JSON.stringify(list)) };
    return true;
  }
  ED.copy = function () { if (copySel()) SL.toast(t("toast.copied")); };
  ED.paste = function () {
    if (!clip || !ED.cur || !roomFor(clip.items.length)) return;
    var made = [], off = clip.from === ED.cur ? 20 : 0;
    SL.op(function (dt, nw, newId) {
      var z = topZ();
      clip.items.forEach(function (o) {
        var x = JSON.parse(JSON.stringify(o));
        x.id = newId(); x.m = nw; x.s = ED.cur; x.x += off; x.y += off; x.z = Math.min(C.LIM.z, ++z);
        delete x.ph;
        if (x.k === "text") x.b = 0;
        x = C.normItem(x);
        if (x) { dt.items[x.id] = x; made.push(x.id); }
      });
      if (!made.length) return false;
      C.touchSlide(dt, ED.cur, nw);
    });
    if (off) clip.items.forEach(function (o) { o.x += off; o.y += off; });
    ED.select(made);
  };
  ED.duplicate = function () {
    var keep = clip;
    if (copySel()) ED.paste();
    clip = keep;
  };

  // Stacking order inside the slide.
  ED.arrange = function (how) {
    var ids = ED.sel.slice();
    if (!ids.length) return;
    SL.op(function (dt, nw) {
      var list = C.slideItems(dt, ED.cur), sel = {};
      ids.forEach(function (id) { sel[id] = 1; });
      var rest = list.filter(function (x) { return !sel[x.id]; }), mine = list.filter(function (x) { return sel[x.id]; });
      var order;
      if (how === "front") order = rest.concat(mine);
      else if (how === "back") order = mine.concat(rest);
      else {
        order = list.slice();
        var step = how === "fwd" ? 1 : -1;
        var idxs = order.map(function (x, i) { return sel[x.id] ? i : -1; }).filter(function (i) { return i >= 0; });
        if (step > 0) idxs.reverse();
        idxs.forEach(function (i) {
          var j = i + step;
          if (j < 0 || j >= order.length || sel[order[j].id]) return;
          var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        });
      }
      var ch = false;
      order.forEach(function (x, i) {
        var it = dt.items[x.id];
        if (it.z !== i + 1) { it.z = i + 1; it.m = nw; ch = true; }
      });
      if (!ch) return false;
      C.touchSlide(dt, ED.cur, nw);
    });
  };

  // Align to the slide (one object) or to the selection (several).
  ED.align = function (how) {
    var list = ED.sel.map(item).filter(function (x) { return x && !x.lk; });
    if (!list.length) return;
    var ref = list.length > 1 ? bounds(list) : { x: 0, y: 0, w: W(), h: C.H };
    ED.editItems(list.map(function (x) { return x.id; }), function (it) {
      var b = bounds([it]), dx = 0, dy = 0;
      if (how === "al") dx = ref.x - b.x;
      if (how === "ac") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (how === "ar") dx = ref.x + ref.w - (b.x + b.w);
      if (how === "at") dy = ref.y - b.y;
      if (how === "am") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (how === "ab") dy = ref.y + ref.h - (b.y + b.h);
      it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy);
    });
  };

  function nudge(dx, dy) {
    var ids = ED.sel.filter(function (id) { var it = item(id); return it && !it.lk; });
    if (!ids.length) return;
    ED.editItems(ids, function (it) { it.x += dx; it.y += dy; });
  }

  function itemMenu(anchor, at) {
    var has = ED.sel.length > 0;
    SL.menu(anchor || $("ov"), [
      has ? { label: t("pn.edit"), disabled: !(ED.sel.length === 1 && item(ED.sel[0]).k === "text"), fn: function () { SL.text.start(ED.sel[0]); } } : null,
      has ? { label: t("pn.dup"), fn: ED.duplicate } : null,
      has ? { label: t("it.copy"), fn: ED.copy } : null,
      { label: t("it.paste"), disabled: !clip, fn: ED.paste },
      has ? { sep: true } : null,
      has ? { label: t("pn.front"), fn: function () { ED.arrange("front"); } } : null,
      has ? { label: t("pn.back"), fn: function () { ED.arrange("back"); } } : null,
      has ? { sep: true } : null,
      has ? { label: t("pn.del"), danger: true, fn: ED.deleteSel } : null
    ], at);
  }
  ED.itemMenu = itemMenu;

  // ---------- 5. Slide strip + slide menu ----------
  var thumbCache = {};      // slideId → { key, url }
  var assetsTick = 0;
  function thumbKey(s, i) {
    var d = deck();
    return [s.m, s.tm, i, d.th, d.as, JSON.stringify(d.ft), assetsTick, SL.T.isLoaded("sans-r")].join("|");
  }
  function thumbUrl(s, i, w) {
    var key = thumbKey(s, i) + "|" + w, c = thumbCache[s.id];
    if (c && c.key === key) return c.url;
    var url = "";
    try { url = SL.renderSlide(s.id, w * (window.devicePixelRatio || 1)).toDataURL("image/png"); } catch (e) {}
    thumbCache[s.id] = { key: key, url: url };
    return url;
  }
  ED.thumbUrl = thumbUrl;

  function thumbNode(s, i, w, cls) {
    var b = el("div", cls);
    b.setAttribute("data-id", s.id);
    b.tabIndex = 0;
    b.setAttribute("role", "button");
    var title = C.slideTitle(SL.data(), s.id);
    b.setAttribute("aria-label", t("slide.n", { n: i + 1 }) + (title ? ": " + title : "") + (s.hid ? " · " + t("slide.hidden") : ""));
    b.appendChild(el("span", "th-n", String(i + 1)));
    var fr = el("span", "th-img");
    fr.style.aspectRatio = W() + " / " + C.H;
    var img = el("img");
    img.alt = ""; img.draggable = false;
    img.src = thumbUrl(s, i, w);
    fr.appendChild(img);
    if (s.hid) { var h = el("span", "th-hid"); h.innerHTML = SL.icon("eyeOff"); fr.appendChild(h); }
    b.appendChild(fr);
    if (s.hid) b.classList.add("hid");
    return b;
  }

  function renderStrip() {
    if (stripQueued) return;
    stripQueued = true;
    requestAnimationFrame(function () {
      stripQueued = false;
      if (view !== "slide") return;
      var host = $("strip");
      var keepScroll = [host.scrollLeft, host.scrollTop];
      host.innerHTML = "";
      slides().forEach(function (s, i) {
        var b = thumbNode(s, i, 160, "thumb" + (s.id === ED.cur ? " on" : ""));
        if (s.id === ED.cur) b.setAttribute("aria-current", "true");
        wireThumb(b, s, host);
        host.appendChild(b);
      });
      var add = SL.iconBtn("plus", t("tool.add"), "strip-add");
      add.addEventListener("click", function () { layoutMenu(add, function (ly) { ED.addSlide(ly); }); });
      host.appendChild(add);
      host.scrollLeft = keepScroll[0]; host.scrollTop = keepScroll[1];
    });
  }
  ED.renderStrip = renderStrip;

  function wireThumb(b, s, host) {
    var lt = null;
    b.addEventListener("click", function () { if (view === "sorter") selectInSorter(s.id); else ED.go(s.id); });
    b.addEventListener("dblclick", function () { if (view === "sorter") { ED.cur = s.id; setView("slide"); } });
    b.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); ED.deleteSlide(s.id); }
      if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && e.altKey) { e.preventDefault(); ED.moveSlide(s.id, -1); }
      if ((e.key === "ArrowDown" || e.key === "ArrowRight") && e.altKey) { e.preventDefault(); ED.moveSlide(s.id, 1); }
    });
    b.addEventListener("contextmenu", function (e) { e.preventDefault(); slideMenu(s.id, b, { x: e.clientX, y: e.clientY }); });
    b.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      var x = e.clientX, y = e.clientY;
      lt = setTimeout(function () { slideMenu(s.id, b, { x: x, y: y }); }, 550);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(function (ev) {
      b.addEventListener(ev, function (e) { if (ev !== "pointermove" || e.pointerType !== "mouse") clearTimeout(lt); });
    });
    // drag to reorder (mouse)
    b.draggable = true;
    b.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/x-oros-slide", s.id);
      e.dataTransfer.effectAllowed = "move";
      b.classList.add("dragging");
    });
    b.addEventListener("dragend", function () { b.classList.remove("dragging"); clearDrop(host); });
    b.addEventListener("dragover", function (e) {
      if ([].indexOf.call(e.dataTransfer.types, "text/x-oros-slide") < 0) return;
      e.preventDefault();
      clearDrop(host);
      var r = b.getBoundingClientRect();
      var horiz = host.scrollWidth > host.clientWidth + 4 || view === "sorter";
      var after = horiz && view === "sorter" ? e.clientX > r.left + r.width / 2 : (horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2);
      b.classList.add(after ? "drop-after" : "drop-before");
    });
    b.addEventListener("drop", function (e) {
      var id = e.dataTransfer.getData("text/x-oros-slide");
      e.preventDefault();
      var after = b.classList.contains("drop-after");
      clearDrop(host);
      if (!id || id === s.id) return;
      ED.moveSlideTo(id, s.id, after);
    });
  }
  function clearDrop(host) {
    [].forEach.call(host.querySelectorAll(".drop-before, .drop-after"), function (n) { n.classList.remove("drop-before", "drop-after"); });
  }

  function slideMenu(id, anchor, at) {
    var s = SL.data().slides[id];
    if (!s) return;
    var i = indexOf(id), n = slides().length;
    SL.menu(anchor, [
      { label: t("sm.new"), fn: function () { ED.cur = id; layoutMenu(anchor, function (ly) { ED.addSlide(ly); }, at); } },
      { label: t("sm.dup"), fn: function () { ED.dupSlide(id); } },
      { label: t("sm.layout"), fn: function () { ED.cur = id; layoutMenu(anchor, function (ly) { ED.setLayout(ly); }, at); } },
      { label: s.hid ? t("sm.show") : t("sm.hide"), fn: function () { ED.toggleHidden(id); } },
      { label: t("sm.up"), disabled: i <= 0, fn: function () { ED.moveSlide(id, -1); } },
      { label: t("sm.down"), disabled: i >= n - 1, fn: function () { ED.moveSlide(id, 1); } },
      { label: t("sm.present"), fn: function () { SL.io.present({ from: i }); } },
      { sep: true },
      { label: t("sm.del"), danger: true, fn: function () { ED.deleteSlide(id); } }
    ], at);
  }
  ED.slideMenu = slideMenu;

  function layoutMenu(anchor, done, at) {
    SL.menu(anchor, C.LAYOUTS.map(function (ly) {
      return { label: SL.label(ly.name), fn: function () { done(ly.id); } };
    }), at);
  }
  ED.layoutMenu = layoutMenu;

  ED.addSlide = function (layoutId) {
    if (slides().length >= C.LIM.slides) { SL.toast(t("toast.maxSlides", { n: C.LIM.slides })); return; }
    var made = SL.op(function (dt, nw, newId) {
      var s = C.addSlide(dt, SL.deck, layoutId || "content", ED.cur, nw, newId);
      return s ? s.id : false;
    });
    if (typeof made === "string") { SL.text.stop(); ED.sel = []; ED.go(made); }
  };
  ED.dupSlide = function (id) {
    if (slides().length >= C.LIM.slides) { SL.toast(t("toast.maxSlides", { n: C.LIM.slides })); return; }
    var made = SL.op(function (dt, nw, newId) { var c = C.duplicateSlide(dt, id, nw, newId); return c ? c.id : false; });
    if (typeof made === "string") ED.go(made);
  };
  ED.deleteSlide = function (id) {
    var list = slides();
    if (list.length <= 1) { SL.toast(t("toast.lastSlide")); return; }
    var i = indexOf(id);
    SL.text.stop();
    if (SL.op(function (dt, nw) { return C.deleteSlide(dt, id, nw) ? undefined : false; })) {
      var rest = slides();
      if (ED.cur === id) ED.cur = rest[Math.min(i, rest.length - 1)].id;
      ED.sel = [];
      SL.toast(t("toast.slideDeleted"), t("btn.undo"), SL.undo);
      refreshAll();
    }
  };
  ED.moveSlide = function (id, step) {
    var list = slides(), i = indexOf(id), j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    var before = step < 0 ? (list[j - 1] ? list[j - 1].id : null) : list[j].id;
    var after = step < 0 ? list[j].id : (list[j + 1] ? list[j + 1].id : null);
    SL.op(function (dt, nw) { return C.moveSlide(dt, id, before, after, nw) ? undefined : false; });
    focusThumb(id);
  };
  ED.moveSlideTo = function (id, targetId, after) {
    var list = slides().filter(function (s) { return s.id !== id; });
    var k = -1;
    list.forEach(function (s, i) { if (s.id === targetId) k = i; });
    if (k < 0) return;
    var before = after ? list[k].id : (list[k - 1] ? list[k - 1].id : null);
    var aft = after ? (list[k + 1] ? list[k + 1].id : null) : list[k].id;
    SL.op(function (dt, nw) { return C.moveSlide(dt, id, before, aft, nw) ? undefined : false; });
  };
  function focusThumb(id) {
    setTimeout(function () {
      var host = view === "sorter" ? $("sorter") : $("strip");
      var n = host.querySelector('[data-id="' + id + '"]');
      if (n) n.focus();
    }, 40);
  }
  ED.toggleHidden = function (id) {
    SL.op(function (dt, nw) {
      var s = dt.slides[id];
      if (!s) return false;
      s.hid = !s.hid; s.m = nw; C.touchDeck(dt, s.d, nw);
    });
  };
  ED.setLayout = function (ly) {
    SL.text.stop();
    SL.op(function (dt, nw, newId) { return C.applyLayout(dt, ED.cur, ly, nw, newId) ? undefined : false; });
    ED.sel = [];
  };

  // ---------- 6. Sorter ----------
  var sorterSel = null;
  function renderSorter() {
    var host = $("sorter");
    host.innerHTML = "";
    var head = el("p", "hint sorter-hint", t("so.hint"));
    host.appendChild(head);
    var grid = el("div", "sorter-grid");
    slides().forEach(function (s, i) {
      var b = thumbNode(s, i, 240, "thumb big" + (s.id === (sorterSel || ED.cur) ? " on" : ""));
      var more = SL.iconBtn("more", t("ed.more"), "th-more");
      more.addEventListener("click", function (e) { e.stopPropagation(); slideMenu(s.id, more); });
      b.appendChild(more);
      wireThumb(b, s, grid);
      grid.appendChild(b);
    });
    var add = el("button", "sorter-add");
    add.type = "button";
    add.innerHTML = SL.icon("plus");
    add.appendChild(el("span", "", t("tool.add")));
    add.addEventListener("click", function () {
      var list = slides();
      ED.cur = list.length ? list[list.length - 1].id : null;
      layoutMenu(add, function (ly) { ED.addSlide(ly); setView("sorter"); });
    });
    grid.appendChild(add);
    host.appendChild(grid);
  }
  function selectInSorter(id) {
    sorterSel = id; ED.cur = id;
    [].forEach.call($("sorter").querySelectorAll(".thumb"), function (n) { n.classList.toggle("on", n.getAttribute("data-id") === id); });
  }

  // ---------- 7. Outline + notes ----------
  var olTimer = null, olDirty = false;
  function loadOutline() {
    var ta = $("outline-ed");
    $("outline-hint").textContent = t("ol.hint");
    if (document.activeElement === ta && olDirty) return;
    var v = C.formatOutline(SL.data(), SL.deck);
    if (ta.value !== v) ta.value = v;
  }
  function flushOutline() {
    clearTimeout(olTimer);
    if (!olDirty) return;
    olDirty = false;
    var text = $("outline-ed").value;
    SL.op(function (dt, nw, newId) {
      var res = C.applyOutline(dt, SL.deck, text, nw, newId);
      // the outline never leaves a deck without slides
      if (res && !C.deckSlides(dt, SL.deck).length) C.addSlide(dt, SL.deck, "title", null, nw, newId);
      return res ? undefined : false;
    });
  }
  ED.flushOutline = flushOutline;

  var notesTimer = null, notesDirty = false, notesBase = null, notesSlide = null;
  function loadNotes() {
    var ta = $("notes"), s = ED.cur ? SL.data().slides[ED.cur] : null;
    if (!s) return;
    if (document.activeElement === ta && notesDirty && notesSlide === s.id) return;
    notesSlide = s.id; notesBase = s.nm;
    if (ta.value !== s.n) ta.value = s.n;
  }
  function flushNotes() {
    clearTimeout(notesTimer);
    if (!notesDirty) return;
    notesDirty = false;
    var id = notesSlide, text = $("notes").value, base = notesBase;
    SL.op(function (dt, nw) { return C.setNotes(dt, id, text, nw, base) ? undefined : false; });
    var s = SL.data().slides[id];
    if (s) notesBase = s.nm;
  }
  ED.flushNotes = flushNotes;

  // ---------- 8. Keyboard, wiring ----------
  function typing(e) {
    var n = e.target;
    return n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
  }
  function onKey(e) {
    if ($("editor").hidden || $("dlg").open) return;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (k === "z" || k === "Z") && !SL.text.active() && !(typing(e) && e.target.tagName === "TEXTAREA")) {
      e.preventDefault(); if (e.shiftKey) SL.redo(); else SL.undo(); return;
    }
    if (mod && !e.altKey && (k === "y" || k === "Y") && !SL.text.active() && !typing(e)) { e.preventDefault(); SL.redo(); return; }
    if (k === "F5") { e.preventDefault(); SL.io.present({ from: e.shiftKey ? Math.max(0, indexOf(ED.cur)) : 0 }); return; }
    if (typing(e) || view === "outline") return;
    if (mod && (k === "m" || k === "M")) { e.preventDefault(); ED.addSlide("content"); return; }
    if (view !== "slide") return;
    if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      var list = slides(), i = indexOf(ED.cur) + (k === "PageDown" ? 1 : -1);
      if (list[i]) ED.go(list[i].id);
      return;
    }
    if (mod && (k === "c" || k === "C")) { if (ED.sel.length) { e.preventDefault(); ED.copy(); } return; }
    if (mod && (k === "v" || k === "V")) { if (clip) { e.preventDefault(); ED.paste(); } return; }
    if (mod && (k === "d" || k === "D")) { e.preventDefault(); ED.duplicate(); return; }
    if (mod && (k === "a" || k === "A")) { e.preventDefault(); ED.select(curItems().map(function (x) { return x.id; })); return; }
    if (k === "Delete" || k === "Backspace") { if (ED.sel.length) { e.preventDefault(); ED.deleteSel(); } return; }
    if (k === "Escape") { if (ED.sel.length) { e.preventDefault(); ED.select([]); } return; }
    if (k === "Enter" && ED.sel.length === 1) {
      var it = item(ED.sel[0]);
      if (it && it.k === "text") { e.preventDefault(); SL.text.start(it.id); }
      return;
    }
    var step = e.shiftKey ? 10 : 1;
    if (k === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); }
    if (k === "ArrowRight") { e.preventDefault(); nudge(step, 0); }
    if (k === "ArrowUp") { e.preventDefault(); nudge(0, -step); }
    if (k === "ArrowDown") { e.preventDefault(); nudge(0, step); }
  }

  function buildTools() {
    var host = $("tools");
    host.innerHTML = "";
    function tb(icon, label, fn, cls) {
      var b = SL.iconBtn(icon, label, cls);
      b.addEventListener("click", function (e) { fn(b, e); });
      host.appendChild(b);
      return b;
    }
    tb("plus", t("tool.add"), function (b) { layoutMenu(b, function (ly) { ED.addSlide(ly); }); }, "tool-add");
    tb("layout", t("tool.layout"), function (b) { layoutMenu(b, function (ly) { ED.setLayout(ly); }); });
    host.appendChild(el("span", "sep"));
    tb("text", t("tool.text"), function () { ED.insert("text"); });
    tb("image", t("tool.image"), function () { ED.insert("image"); });
    tb("rect", t("tool.rect"), function () { ED.insert("rect"); });
    tb("ell", t("tool.ell"), function () { ED.insert("ell"); });
    tb("line", t("tool.line"), function () { ED.insert("line"); });
    host.appendChild(el("span", "spacer"));
    var fmt = tb("format", t("tool.format"), function () { SL.panels.toggle(); }, "tool-format");
    fmt.id = "tool-format";
  }

  function wire() {
    SL.setIcon($("ed-back"), "back", t("ed.back"));
    SL.setIcon($("ed-undo"), "undo", t("ed.undo"));
    SL.setIcon($("ed-redo"), "redo", t("ed.redo"));
    SL.setIcon($("ed-more"), "more", t("ed.more"));
    $("ed-play").innerHTML = SL.icon("play") + "<span></span>";
    $("ed-play").lastChild.textContent = t("ed.play");
    $("ed-play").title = t("ed.play") + " (F5)";
    $("ed-name").title = t("ed.rename");
    var views = $("ed-views");
    [["slide", "slide"], ["sorter", "sorter"], ["outline", "outline"]].forEach(function (v) {
      var b = el("button", "seg-btn");
      b.type = "button";
      b.setAttribute("data-v", v[0]);
      b.setAttribute("role", "tab");
      b.innerHTML = SL.icon(v[1]) + "<span></span>";
      b.lastChild.textContent = t("view." + v[0]);
      b.title = t("view." + v[0]);
      b.addEventListener("click", function () { setView(v[0]); });
      views.appendChild(b);
    });
    $("ed-back").addEventListener("click", SL.goHome);
    $("ed-undo").addEventListener("click", SL.undo);
    $("ed-redo").addEventListener("click", SL.redo);
    $("ed-name").addEventListener("click", function () { SL.renameDeck(SL.deck); });
    $("ed-play").addEventListener("click", function () { SL.io.present({ from: view === "slide" ? Math.max(0, indexOf(ED.cur)) : 0 }); });
    $("ed-more").addEventListener("click", function () { moreMenu($("ed-more")); });
    buildTools();

    var ov = $("ov");
    ov.addEventListener("pointerdown", onDown);
    ov.addEventListener("pointermove", onMove);
    ov.addEventListener("pointerup", onUp);
    ov.addEventListener("pointercancel", function () { clearTimeout(longTimer); if (drag) { drag = null; guides = []; SL.endGesture(); drawOverlay(); } });
    ov.addEventListener("dblclick", onDbl);
    ov.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var hit = e.target.closest(".hit");
      if (hit && ED.sel.indexOf(hit.getAttribute("data-id")) < 0) ED.select([hit.getAttribute("data-id")]);
      itemMenu(null, { x: e.clientX, y: e.clientY });
    });
    $("stage").addEventListener("pointerdown", function (e) {
      if (e.target === $("stage") || e.target === $("cv")) { SL.text.stop(); ED.select([]); }
    });
    document.addEventListener("keydown", onKey);

    $("notes").placeholder = t("notes.ph");
    $("notes").setAttribute("aria-label", t("notes.title"));
    $("notes-toggle").textContent = t("notes.title");
    $("notes-toggle").addEventListener("click", function () {
      SL.prefs.notes = !SL.prefs.notes; SL.savePrefs();
      document.body.classList.toggle("notes-closed", !SL.prefs.notes);
      fitStage(); draw();
    });
    $("notes").addEventListener("focus", function () { var s = SL.data().slides[ED.cur]; notesSlide = ED.cur; notesBase = s ? s.nm : 0; });
    $("notes").addEventListener("input", function () {
      notesDirty = true; notesSlide = notesSlide || ED.cur;
      clearTimeout(notesTimer); notesTimer = setTimeout(flushNotes, 700);
    });
    $("notes").addEventListener("blur", flushNotes);
    $("outline-ed").addEventListener("input", function () {
      olDirty = true;
      clearTimeout(olTimer); olTimer = setTimeout(flushOutline, 900);
    });
    $("outline-ed").addEventListener("blur", flushOutline);
    $("outline-ed").addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      // Tab indents a line (a bullet level) instead of leaving the field
      e.preventDefault();
      var ta = e.target, s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf("\n", s - 1) + 1;
      if (e.shiftKey) {
        if (v.substr(ls, 2) === "  ") { ta.value = v.slice(0, ls) + v.slice(ls + 2); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 2); }
      } else { ta.value = v.slice(0, ls) + "  " + v.slice(ls); ta.selectionStart = ta.selectionEnd = s + 2; }
      ta.dispatchEvent(new Event("input"));
    });

    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { if (view === "slide" && SL.deck) { fitStage(); draw(); } }) : null;
    if (ro) ro.observe($("stage")); else window.addEventListener("resize", function () { fitStage(); draw(); });

    SL.on("open", function () {
      ED.cur = null; ED.sel = []; thumbCache = {};
      document.body.classList.toggle("notes-closed", !SL.prefs.notes);
      setView(SL.prefs.view);
    });
    SL.on("close", function () { SL.text.stop(); flushNotes(); flushOutline(); ED.sel = []; });
    SL.on("flush", function () { SL.text.flush(); flushNotes(); flushOutline(); });
    SL.on("deck", function (info) {
      if (info && info.live) { draw(); return; }
      refreshAll();
    });
    SL.on("remote", function () { refreshAll(); if (SL.text.active()) SL.text.remote(); });
    SL.on("assets", function () { assetsTick++; refreshAll(); });
  }

  function moreMenu(anchor) {
    var rec = SL.recovered(SL.deck).length;
    SL.menu(anchor, [
      { label: t("more.theme"), fn: function () { SL.panels.open("deck"); } },
      { label: t("more.footer"), fn: function () { SL.panels.open("deck"); } },
      { sep: true },
      { label: t("more.fromStart"), fn: function () { SL.io.present({ from: 0 }); } },
      { label: t("more.presenter"), fn: function () { SL.io.present({ from: Math.max(0, indexOf(ED.cur)), presenter: true }); } },
      { sep: true },
      { label: t("more.pdf"), fn: function () { SL.io.exportPdf(false); } },
      { label: t("more.handout"), fn: function () { SL.io.exportPdf(true); } },
      { label: t("more.png"), disabled: !ED.cur, fn: function () { SL.io.exportPng(ED.cur); } },
      { label: t("more.pkg"), fn: function () { SL.io.exportPackage(SL.deck); } },
      rec ? { sep: true } : null,
      rec ? { label: t("more.rec", { n: rec }), fn: SL.dlg.recovered } : null,
      { sep: true },
      { label: t("more.keys"), fn: SL.dlg.keys }
    ]);
  }

  SL.on("boot", wire);
})();
