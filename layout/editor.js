// ============================================================
// orOS Layout — editor (v1.0.0)
// The canvas: spreads on a pasteboard, pan / zoom / pinch, tools
// (select, text, image, rect, ellipse, line, hand), selection with
// move / resize / rotate handles, snapping (page edges, margins,
// columns, guides, other objects), threads between text frames,
// master editing, keyboard shortcuts, clipboard.
// Sections:
//   1. State + geometry of the pasteboard
//   2. Document operations (items, stories, threads, pages)
//   3. Drawing
//   4. Pointer input
//   5. Keyboard + clipboard
//   6. Wiring
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, R = LY.R, T = LY.T, t = LY.t, $ = LY.$, el = LY.el;

  // ---------- 1. State + geometry ----------
  var K = 96 / 72;          // CSS px per pt at 100%
  var GAP = 48;             // pt between spreads
  var ED = LY.ed = {
    tool: "select", sel: [], zoom: 1, camX: 0, camY: 0, preview: false,
    master: null, threadFrom: null, L: null, ML: null, snaps: [], marquee: null, draft: null
  };
  var cv, ctx, dpr = 1, W = 0, H = 0;
  var world = [];           // spreads: { pages: [P], x, y, w, h }
  var palette = { board: "#222", accent: "#4da3ff", text: "#ddd" };

  function scale() { return ED.zoom * K; }
  function toScreen(wx, wy) { var s = scale(); return [(wx - ED.camX) * s, (wy - ED.camY) * s]; }
  function toWorld(sx, sy) { var s = scale(); return [sx / s + ED.camX, sy / s + ED.camY]; }

  // P = { id (owner id), page (entity), x, y, w, h, side, idx, master }
  function buildWorld() {
    var doc = LY.doc, s = doc.setup, y = 0;
    world = [];
    if (ED.master) {
      var ms = M.find(doc.masters, ED.master);
      if (!ms) { ED.master = null; return buildWorld(); }
      var pages = s.facing
        ? [{ id: ms.id, page: ms, x: -s.w, y: 0, w: s.w, h: s.h, side: "L", idx: -1, master: true },
           { id: ms.id, page: ms, x: 0, y: 0, w: s.w, h: s.h, side: "R", idx: -1, master: true }]
        : [{ id: ms.id, page: ms, x: -s.w / 2, y: 0, w: s.w, h: s.h, side: "", idx: -1, master: true }];
      world.push({ pages: pages, x: pages[0].x, y: 0, w: s.w * pages.length, h: s.h });
      return;
    }
    var idx = 0;
    M.spreads(doc).forEach(function (sp) {
      var ps = [];
      var x0 = s.facing ? (sp.length === 2 ? -s.w : (idx === 0 ? 0 : -s.w)) : -s.w / 2;
      sp.forEach(function (p, k) {
        ps.push({ id: p.id, page: p, x: x0 + k * s.w, y: y, w: s.w, h: s.h, side: M.sideOf(doc, idx), idx: idx, master: false });
        idx++;
      });
      world.push({ pages: ps, x: ps[0].x, y: y, w: s.w * ps.length, h: s.h });
      y += s.h + GAP;
    });
  }
  function allP() { var o = []; world.forEach(function (sp) { o = o.concat(sp.pages); }); return o; }
  function pageAt(wx, wy, loose) {
    var b = LY.doc.setup.bleed, best = null, bd = Infinity;
    allP().forEach(function (P) {
      var inX = wx >= P.x - b && wx <= P.x + P.w + b, inY = wy >= P.y - b && wy <= P.y + P.h + b;
      if (inX && inY) { best = P; bd = -1; return; }
      if (loose && bd >= 0) {
        var dx = Math.max(P.x - wx, 0, wx - P.x - P.w), dy = Math.max(P.y - wy, 0, wy - P.y - P.h);
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = P; }
      }
    });
    return best;
  }
  // The P an item is drawn on.
  function pOf(it) {
    var ps = allP();
    for (var i = 0; i < ps.length; i++) {
      var P = ps[i];
      if (P.id !== it.pg) continue;
      if (P.master && it.side && P.side && it.side !== P.side) continue;
      if (P.master && !it.side && P.side === "L" && ps.length > 1) continue;
      return P;
    }
    return null;
  }
  LY.pOf = pOf;
  function curP() {
    var c = toWorld(W / 2, H / 2);
    return pageAt(c[0], c[1], true);
  }
  ED.curPage = function () { var P = curP(); return P ? P.page : null; };
  ED.curP = curP;

  function itemsOfP(P) {
    return M.itemsOn(LY.doc, P.id, P.master && P.side ? P.side : undefined);
  }
  function selItems() {
    var doc = LY.doc;
    return ED.sel.map(function (id) { return M.find(doc.items, id); }).filter(Boolean);
  }
  ED.selItems = selItems;

  // ---------- 2. Document operations ----------
  function tomb(doc, id, now) { doc.tombs[id] = Math.max(now, doc.tombs[id] || 0); }
  function maxZ(doc, owner) {
    var z = 0;
    doc.items.forEach(function (it) { if (it.pg === owner && it.z > z) z = it.z; });
    return z;
  }
  function newStory(doc, now, paras) {
    var st = { id: M.newId("st"), m: now, h: [], paras: paras || [{ ps: "ps-body", runs: [] }] };
    doc.stories.push(st);
    return st;
  }
  ED.newStory = newStory;

  function addItem(doc, props, now) {
    if (doc.items.length >= M.MAX_ITEMS) { LY.toast(t("toast.maxItems", { n: M.MAX_ITEMS })); return null; }
    var it = {
      id: M.newId("it"), m: now, t: props.t, pg: props.pg, side: props.side || "",
      x: props.x, y: props.y, w: props.w, h: props.h, rot: 0, z: maxZ(doc, props.pg) + 1,
      fill: props.fill || "", stroke: props.stroke || "", sw: props.sw === undefined ? 1 : props.sw,
      dash: 0, op: 100, r: 0, lock: 0, hide: 0, grp: "", wrap: "none", wo: 6
    };
    if (it.t === "text") {
      it.story = props.story || newStory(doc, now).id;
      it.seq = props.seq || 1024; it.cols = props.cols || 1; it.gut = props.gut === undefined ? 12 : props.gut;
      it.ins = 0; it.va = "t";
    }
    if (it.t === "img") { it.a = ""; it.nm = ""; it.iw = 0; it.ih = 0; it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1; }
    doc.items.push(it);
    return it;
  }
  ED.addItem = addItem;

  // Remove items (+ stories nothing shows any more), with tombstones.
  function delItems(doc, ids, now) {
    var gone = {};
    ids.forEach(function (id) { gone[id] = 1; });
    var dropped = doc.items.filter(function (it) { return gone[it.id]; });
    doc.items = doc.items.filter(function (it) { return !gone[it.id]; });
    dropped.forEach(function (it) {
      tomb(doc, it.id, now);
      if (it.t === "text" && !doc.items.some(function (o) { return o.t === "text" && o.story === it.story; })) {
        doc.stories = doc.stories.filter(function (s) { if (s.id === it.story) { tomb(doc, s.id, now); return false; } return true; });
      }
    });
  }
  ED.delItems = delItems;

  function storyEmpty(doc, sid) {
    var st = M.story(doc, sid);
    return !st || !T.hasText(st);
  }
  function isMasterId(doc, id) { return !!M.find(doc.masters, id); }

  // Put frame `dst` right after `src` in src's chain.
  function linkAfter(doc, src, dst, now) {
    var ch = M.chain(doc, src.story), i = -1;
    ch.forEach(function (f, k) { if (f.id === src.id) i = k; });
    var next = ch[i + 1];
    var oldStory = dst.story;
    dst.story = src.story;
    dst.seq = next ? (src.seq + next.seq) / 2 : src.seq + 1024;
    M.touch(dst, now);
    if (oldStory && oldStory !== src.story && !doc.items.some(function (o) { return o.t === "text" && o.story === oldStory; })) {
      doc.stories = doc.stories.filter(function (s) { if (s.id === oldStory) { tomb(doc, s.id, now); return false; } return true; });
    }
    // seq precision guard: renumber the chain when gaps get tiny
    if (next && Math.abs(next.seq - dst.seq) < 1e-6) {
      M.chain(doc, src.story).forEach(function (f, k) { f.seq = (k + 1) * 1024; M.touch(f, now); });
    }
  }

  function addPageAfter(doc, afterId, now, ms) {
    if (doc.pages.length >= M.MAX_PAGES) { LY.toast(t("pages.max", { n: M.MAX_PAGES })); return null; }
    var order = M.pagesInOrder(doc), i = -1;
    order.forEach(function (p, k) { if (p.id === afterId) i = k; });
    var prev = order[i], next = order[i + 1];
    var pos = !prev ? (order.length ? order[0].pos - 1024 : 1024) : next ? (prev.pos + next.pos) / 2 : prev.pos + 1024;
    if (prev && next && Math.abs(next.pos - pos) < 1e-6) {
      order.forEach(function (p, k) { p.pos = (k + 1) * 1024; M.touch(p, now); });
      pos = order[i].pos + 512;
    }
    var pg = { id: M.newId("pg"), m: now, pos: pos, ms: ms !== undefined ? ms : (prev ? prev.ms : "ms-a") };
    doc.pages.push(pg);
    return pg;
  }
  ED.addPageAfter = addPageAfter;

  // Margin box of a page side, in page coordinates.
  function marginBox(doc, side) {
    var m = M.margins(doc, side), s = doc.setup;
    return { x: m.l, y: m.t, w: Math.max(10, s.w - m.l - m.r), h: Math.max(10, s.h - m.t - m.b) };
  }
  ED.marginBox = marginBox;

  // Continue a story from frame `fid` on the next page (one frame).
  ED.threadNext = function (fid) {
    var created = null;
    LY.op(function (doc, now) {
      var src = M.find(doc.items, fid);
      if (!src || src.t !== "text" || isMasterId(doc, src.pg)) return false;
      var order = M.pagesInOrder(doc), i = -1;
      order.forEach(function (p, k) { if (p.id === src.pg) i = k; });
      var pg = order[i + 1] || addPageAfter(doc, src.pg, now);
      if (!pg) return false;
      var nf = addItem(doc, { t: "text", pg: pg.id, x: src.x, y: src.y, w: src.w, h: src.h, cols: src.cols, gut: src.gut, story: src.story }, now);
      if (!nf) return false;
      nf.ins = src.ins; nf.va = src.va;
      linkAfter(doc, src, nf, now);
      created = nf.id;
    });
    if (created) { ED.select([created]); ED.scrollToItem(created); }
  };

  // Autoflow: pages + frames inside the margins until the story fits.
  ED.autoflow = function (fid) {
    var added = 0, MAX = 200;
    LY.op(function (doc, now) {
      var src = M.find(doc.items, fid);
      if (!src || src.t !== "text" || isMasterId(doc, src.pg)) return false;
      var ch = M.chain(doc, src.story), last = ch[ch.length - 1];
      for (var n = 0; n < MAX; n++) {
        var L = R.computeLayout(M.normDoc(doc));
        if (!L.overset[src.story]) break;
        var pg = addPageAfter(doc, lastPageId(doc), now);
        if (!pg) break;
        var order = M.pagesInOrder(doc), idx = order.length - 1;
        var mb = marginBox(doc, M.sideOf(doc, idx));
        var nf = addItem(doc, { t: "text", pg: pg.id, x: mb.x, y: mb.y, w: mb.w, h: mb.h, cols: doc.setup.cols, gut: doc.setup.gut, story: src.story }, now);
        if (!nf) break;
        linkAfter(doc, last, nf, now);
        last = nf;
        added++;
      }
      if (!added) return false;
    });
    if (added) LY.toast(added >= MAX ? t("toast.flowMax", { n: added }) : t("toast.flowDone", { n: added }));
  };
  function lastPageId(doc) { var o = M.pagesInOrder(doc); return o[o.length - 1].id; }

  // Break the chain after frame fid: later frames get a new, empty
  // story (the text stays with the earlier frames, InDesign-style).
  ED.unthread = function (fid) {
    LY.op(function (doc, now) {
      var src = M.find(doc.items, fid);
      if (!src || src.t !== "text") return false;
      var ch = M.chain(doc, src.story), i = -1;
      ch.forEach(function (f, k) { if (f.id === fid) i = k; });
      var rest = ch.slice(i + 1);
      if (!rest.length) return false;
      var st = newStory(doc, now);
      rest.forEach(function (f, k) { f.story = st.id; f.seq = (k + 1) * 1024; M.touch(f, now); });
    });
  };

  // ---------- 3. Drawing ----------
  var raf = 0;
  ED.render = function () { if (!raf) raf = requestAnimationFrame(draw); };

  function relayout() {
    if (!LY.doc) return;
    ED.L = R.computeLayout(LY.doc);
    ED.pf = R.preflight(LY.doc, ED.L, { isMissing: LY.A.isMissing });
    if (ED.master) {
      var ms = M.find(LY.doc.masters, ED.master);
      ED.ML = { L: ms ? R.computeMasterLayout(LY.doc, ms, "L") : null, R: ms ? R.computeMasterLayout(LY.doc, ms, "R") : null, B: ms ? R.computeMasterLayout(LY.doc, ms, "") : null };
    }
  }
  ED.relayout = relayout;

  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    palette.board = cs.getPropertyValue("--bg-desktop").trim() || cs.getPropertyValue("--bg").trim() || "#222";
    palette.accent = cs.getPropertyValue("--accent").trim() || "#4da3ff";
    palette.text = cs.getPropertyValue("--text-dim").trim() || "#aaa";
  }

  function resize() {
    var st = $("stage");
    dpr = window.devicePixelRatio || 1;
    W = st.clientWidth; H = st.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ED.render();
  }

  function draw() {
    raf = 0;
    if (!LY.doc || !cv) return;
    if (!world.length) buildWorld();
    var doc = LY.doc, s = doc.setup, sc = scale();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.board;
    ctx.fillRect(0, 0, cv.width, cv.height);
    var getImage = LY.A.get, missing = t("img.missing");
    var vis0 = toWorld(0, 0), vis1 = toWorld(W, H);

    world.forEach(function (sp) {
      if (sp.y > vis1[1] + s.bleed || sp.y + sp.h < vis0[1] - s.bleed) return;
      // paper + shadow
      ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (sp.x - ED.camX) * sc * dpr, (sp.y - ED.camY) * sc * dpr);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 12 * dpr; ctx.shadowOffsetY = 2 * dpr;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, sp.w, sp.h);
      ctx.restore();
      sp.pages.forEach(function (P) {
        ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (P.x - ED.camX) * sc * dpr, (P.y - ED.camY) * sc * dpr);
        ctx.save();
        if (ED.preview) { ctx.beginPath(); ctx.rect(0, 0, P.w, P.h); ctx.clip(); }
        if (P.master) {
          var ML = ED.ML ? (P.side === "L" ? ED.ML.L : P.side === "R" ? ED.ML.R : ED.ML.B) : null;
          if (ML) R.drawMaster(ctx, doc, P.page, P.side || undefined, ML, { getImage: getImage, preview: ED.preview, missing: missing });
        } else {
          R.drawPage(ctx, doc, P.page, ED.L, { getImage: getImage, preview: ED.preview, missing: missing });
        }
        ctx.restore();
        if (!ED.preview) drawGuides(P, sc);
      });
      if (!ED.preview && s.bleed > 0) {
        ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (sp.x - ED.camX) * sc * dpr, (sp.y - ED.camY) * sc * dpr);
        ctx.strokeStyle = "rgba(230,60,60,0.8)"; ctx.lineWidth = 1 / sc;
        ctx.setLineDash([]);
        ctx.strokeRect(-s.bleed, -s.bleed, sp.w + 2 * s.bleed, sp.h + 2 * s.bleed);
      }
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay();
    LY.emit("drawn");
  }

  function drawGuides(P, sc) {
    var doc = LY.doc, s = doc.setup;
    var m = M.margins(doc, P.side || "R");
    ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (P.x - ED.camX) * sc * dpr, (P.y - ED.camY) * sc * dpr);
    ctx.lineWidth = 1 / sc;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(220,0,220,0.55)";
    ctx.strokeRect(m.l, m.t, s.w - m.l - m.r, s.h - m.t - m.b);
    if (s.cols > 1) {
      ctx.strokeStyle = "rgba(120,80,240,0.55)";
      var iw = s.w - m.l - m.r, cw = (iw - s.gut * (s.cols - 1)) / s.cols;
      for (var c = 1; c < s.cols; c++) {
        var x = m.l + c * cw + (c - 1) * s.gut;
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, s.h - m.b);
        ctx.moveTo(x + s.gut, m.t); ctx.lineTo(x + s.gut, s.h - m.b); ctx.stroke();
      }
    }
    // ruler guides of this owner
    ctx.strokeStyle = "rgba(0,180,220,0.8)";
    doc.guides.forEach(function (g) {
      if (g.pg !== P.id) return;
      ctx.beginPath();
      if (g.o === "v") { ctx.moveTo(g.p, -s.bleed); ctx.lineTo(g.p, s.h + s.bleed); }
      else { ctx.moveTo(-s.bleed, g.p); ctx.lineTo(s.w + s.bleed, g.p); }
      ctx.stroke();
    });
    // frame edges (text + image frames)
    ctx.strokeStyle = "rgba(77,163,255,0.55)";
    itemsOfP(P).forEach(function (it) {
      if (it.hide || (it.t !== "text" && it.t !== "img")) return;
      ctx.save();
      if (it.rot) { var cx = it.x + it.w / 2, cy = it.y + it.h / 2; ctx.translate(cx, cy); ctx.rotate(it.rot * Math.PI / 180); ctx.translate(-cx, -cy); }
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      ctx.restore();
    });
  }

  // Screen-space overlay: selection, handles, ports, snaps, marquee.
  function drawOverlay() {
    var doc = LY.doc;
    ctx.save();
    // overset markers on the last frame of every overset story
    if (!ED.preview) {
      Object.keys(ED.L ? ED.L.overset : {}).forEach(function (sid) {
        var ch = M.chain(doc, sid).filter(function (f) { return !isMasterId(doc, f.pg); });
        var last = ch[ch.length - 1];
        if (last) drawPort(last, true, true);
      });
    }
    var items = selItems();
    items.forEach(function (it) {
      var P = pOf(it);
      if (!P) return;
      ctx.strokeStyle = palette.accent; ctx.lineWidth = 1; ctx.setLineDash([]);
      var pts = it.t === "line" ? [[it.x, it.y], [it.x + it.w, it.y + it.h]] : R.corners(it);
      ctx.beginPath();
      pts.forEach(function (p, k) {
        var sp = toScreen(P.x + p[0], P.y + p[1]);
        if (k) ctx.lineTo(sp[0], sp[1]); else ctx.moveTo(sp[0], sp[1]);
      });
      if (it.t !== "line") ctx.closePath();
      ctx.stroke();
    });
    if (items.length === 1) {
      var it0 = items[0];
      handles(it0).forEach(function (h) {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = palette.accent; ctx.lineWidth = 1.5;
        if (h.k === "rot") { ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        else { ctx.fillRect(h.x - 4, h.y - 4, 8, 8); ctx.strokeRect(h.x - 4, h.y - 4, 8, 8); }
      });
      if (it0.t === "text") {
        var ch = M.chain(doc, it0.story), last = ch[ch.length - 1];
        drawPort(it0, false, false);
        drawPort(it0, true, !!(ED.L && ED.L.overset[it0.story]) && last && last.id === it0.id);
        if (ch.length > 1) drawThreadLines(ch);
      }
    }
    // snap lines
    ctx.strokeStyle = "rgba(255,0,170,0.9)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ED.snaps.forEach(function (g) {
      ctx.beginPath();
      if (g.o === "v") { var a = toScreen(g.p, 0); ctx.moveTo(a[0], 0); ctx.lineTo(a[0], H); }
      else { var b = toScreen(0, g.p); ctx.moveTo(0, b[1]); ctx.lineTo(W, b[1]); }
      ctx.stroke();
    });
    ctx.setLineDash([]);
    if (ED.marquee) {
      var q = ED.marquee;
      ctx.fillStyle = "rgba(77,163,255,0.12)"; ctx.strokeStyle = palette.accent;
      ctx.fillRect(Math.min(q.x0, q.x1), Math.min(q.y0, q.y1), Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0));
      ctx.strokeRect(Math.min(q.x0, q.x1), Math.min(q.y0, q.y1), Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0));
    }
    if (ED.draft) {
      var d = ED.draft, a0 = toScreen(d.x0, d.y0), a1 = toScreen(d.x1, d.y1);
      ctx.strokeStyle = palette.accent; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (d.t === "line") { ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); }
      else if (d.t === "ell") ctx.ellipse((a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, Math.abs(a1[0] - a0[0]) / 2, Math.abs(a1[1] - a0[1]) / 2, 0, 0, Math.PI * 2);
      else ctx.rect(Math.min(a0[0], a1[0]), Math.min(a0[1], a1[1]), Math.abs(a1[0] - a0[0]), Math.abs(a1[1] - a0[1]));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function portPos(it, out) {
    var P = pOf(it);
    if (!P) return null;
    // on the frame edge, clear of the corner handles and the text:
    // in-port down the left edge, out-port up the right edge
    var c = R.corners(it);
    var a = out ? c[2] : c[0], e = out ? c[1] : c[3];
    var sa = toScreen(P.x + a[0], P.y + a[1]), se = toScreen(P.x + e[0], P.y + e[1]);
    var dx = se[0] - sa[0], dy = se[1] - sa[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var d = Math.min(22, len / 2);
    return [sa[0] + dx / len * d, sa[1] + dy / len * d];
  }
  function drawPort(it, out, overset) {
    var p = portPos(it, out);
    if (!p) return;
    ctx.fillStyle = overset ? "#e5484d" : "#fff";
    ctx.strokeStyle = overset ? "#e5484d" : palette.accent;
    ctx.lineWidth = 1.2;
    ctx.fillRect(p[0] - 6, p[1] - 6, 12, 12);
    ctx.strokeRect(p[0] - 6, p[1] - 6, 12, 12);
    if (overset) {
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p[0] - 3.5, p[1]); ctx.lineTo(p[0] + 3.5, p[1]); ctx.moveTo(p[0], p[1] - 3.5); ctx.lineTo(p[0], p[1] + 3.5); ctx.stroke();
    } else if (out && it.t === "text") {
      var ch = M.chain(LY.doc, it.story);
      if (ch[ch.length - 1] && ch[ch.length - 1].id !== it.id) {
        ctx.fillStyle = palette.accent;
        ctx.beginPath(); ctx.moveTo(p[0] - 3, p[1] - 4); ctx.lineTo(p[0] + 4, p[1]); ctx.lineTo(p[0] - 3, p[1] + 4); ctx.fill();
      }
    }
  }
  function drawThreadLines(ch) {
    ctx.strokeStyle = "rgba(77,163,255,0.8)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    for (var i = 0; i + 1 < ch.length; i++) {
      var a = portPos(ch[i], true), b = portPos(ch[i + 1], false);
      if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Handles of one item, in screen space.
  function handles(it) {
    var P = pOf(it);
    if (!P) return [];
    if (it.t === "line") {
      var a = toScreen(P.x + it.x, P.y + it.y), b = toScreen(P.x + it.x + it.w, P.y + it.y + it.h);
      return [{ k: "p0", x: a[0], y: a[1] }, { k: "p1", x: b[0], y: b[1] }];
    }
    var c = R.corners(it).map(function (p) { return toScreen(P.x + p[0], P.y + p[1]); });
    function mid(p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
    var n = mid(c[0], c[1]), e = mid(c[1], c[2]), s = mid(c[2], c[3]), w = mid(c[3], c[0]);
    var ang = (it.rot || 0) * Math.PI / 180;
    var rot = [n[0] + 26 * Math.sin(ang), n[1] - 26 * Math.cos(ang)];
    return [
      { k: "nw", x: c[0][0], y: c[0][1] }, { k: "n", x: n[0], y: n[1] }, { k: "ne", x: c[1][0], y: c[1][1] },
      { k: "e", x: e[0], y: e[1] }, { k: "se", x: c[2][0], y: c[2][1] }, { k: "s", x: s[0], y: s[1] },
      { k: "sw", x: c[3][0], y: c[3][1] }, { k: "w", x: w[0], y: w[1] }, { k: "rot", x: rot[0], y: rot[1] }
    ];
  }

  // ---------- View ----------
  ED.setZoom = function (z, sx, sy) {
    z = Math.max(0.05, Math.min(16, z));
    if (sx === undefined) { sx = W / 2; sy = H / 2; }
    var wp = toWorld(sx, sy);
    ED.zoom = z;
    ED.camX = wp[0] - sx / scale(); ED.camY = wp[1] - sy / scale();
    ED.render();
    LY.emit("view");
  };
  ED.fit = function (P) {
    P = P || curP();
    if (!P) return;
    var sp = null;
    world.forEach(function (s) { if (s.pages.indexOf(P) >= 0) sp = s; });
    if (!sp) return;
    var b = LY.doc.setup.bleed + 12, pad = 24;
    var z = Math.min((W - 2 * pad) / ((sp.w + 2 * b) * K), (H - 2 * pad) / ((sp.h + 2 * b) * K));
    ED.zoom = Math.max(0.05, Math.min(16, z));
    var s2 = scale();
    ED.camX = sp.x + sp.w / 2 - W / 2 / s2;
    ED.camY = sp.y + sp.h / 2 - H / 2 / s2;
    ED.render();
    LY.emit("view");
  };
  ED.scrollToPage = function (pageId) {
    var P = null;
    allP().forEach(function (p) { if (p.id === pageId && !P) P = p; });
    if (P) ED.fit(P);
  };
  ED.scrollToItem = function (id) {
    var it = M.find(LY.doc.items, id);
    if (!it) return;
    var P = pOf(it);
    if (!P) return;
    var s = scale();
    var visible = P.x + it.x > ED.camX && P.x + it.x + it.w < ED.camX + W / s && P.y + it.y > ED.camY && P.y + it.y + it.h < ED.camY + H / s;
    if (!visible) ED.fit(P);
  };

  ED.select = function (ids) {
    ED.sel = ids.filter(function (id) { return !!M.find(LY.doc.items, id); });
    ED.render();
    LY.emit("sel");
  };
  function withGroups(ids) {
    var doc = LY.doc, set = {}, out = [];
    ids.forEach(function (id) {
      var it = M.find(doc.items, id);
      if (!it) return;
      var members = it.grp ? doc.items.filter(function (o) { return o.grp === it.grp; }) : [it];
      members.forEach(function (m) { if (!set[m.id]) { set[m.id] = 1; out.push(m.id); } });
    });
    return out;
  }

  ED.setTool = function (tool) {
    ED.tool = tool;
    [].forEach.call(document.querySelectorAll("#tools .tool"), function (b) {
      var on = b.getAttribute("data-tool") === tool;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    cv.style.cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
  };

  ED.enterMaster = function (id) {
    LY.flushStory && LY.flushStory();
    LY.story && LY.story.close();
    ED.master = id; ED.sel = []; ED.threadFrom = null;
    world = []; buildWorld(); relayout();
    $("master-banner").hidden = !id;
    if (id) {
      var ms = M.find(LY.doc.masters, id);
      $("master-banner-txt").textContent = t("ms.editing", { name: LY.label(ms.name) });
    }
    ED.fit(world[0] && world[0].pages[0]);
    LY.emit("sel"); LY.emit("mode");
  };

  // ---------- 4. Pointer input ----------
  var drag = null, pointers = {}, pinch = null, lastTap = { t: 0, id: null }, pressTimer = null, spaceDown = false;

  function evPos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // Is page-local point (lx, ly) on item `it`? tol in pt.
  function hits(it, lx, ly, tol) {
    if (it.t === "line") {
      var ax = it.x, ay = it.y, bx = it.x + it.w, by = it.y + it.h;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      var u = Math.max(0, Math.min(1, ((lx - ax) * dx + (ly - ay) * dy) / l2));
      var qx = ax + u * dx - lx, qy = ay + u * dy - ly;
      return Math.sqrt(qx * qx + qy * qy) <= Math.max(tol * 2, it.sw);
    }
    var loc = R.toLocal(it, lx, ly);
    if (loc[0] < -tol || loc[0] > it.w + tol || loc[1] < -tol || loc[1] > it.h + tol) return false;
    // an unfilled shape is hit on its outline only
    if ((it.t === "rect" || it.t === "ell") && !it.fill) {
      var edge = Math.max(tol * 2, it.sw);
      if (loc[0] > edge && loc[0] < it.w - edge && loc[1] > edge && loc[1] < it.h - edge) return false;
    }
    return true;
  }
  function hitItem(wx, wy, tolPx) {
    var tol = (tolPx || 4) / scale();
    var ps = allP();
    for (var pi = ps.length - 1; pi >= 0; pi--) {
      var P = ps[pi];
      var list = itemsOfP(P);
      for (var i = list.length - 1; i >= 0; i--) {
        if (!list[i].hide && hits(list[i], wx - P.x, wy - P.y, tol)) return list[i];
      }
    }
    return null;
  }

  // A master item showing on a document page under the point.
  function hitMaster(wx, wy, tolPx) {
    if (ED.master) return null;
    var P = pageAt(wx, wy, false);
    if (!P || P.master) return null;
    var tol = (tolPx || 4) / scale();
    var list = M.masterItems(LY.doc, P.page, P.side);
    for (var i = list.length - 1; i >= 0; i--) {
      if (!list[i].hide && hits(list[i], wx - P.x, wy - P.y, tol)) return { P: P, it: list[i] };
    }
    return null;
  }

  // Detach master items on one page: each becomes the page's own copy
  // (ov = the master item), below the page's own objects; a text frame
  // gets its own copy of the story. Returns the new ids.
  function detach(doc, P, masterIds, now) {
    var made = [], low = Infinity;
    doc.items.forEach(function (it) { if (it.pg === P.id && it.z < low) low = it.z; });
    if (!isFinite(low)) low = 1;
    masterIds.forEach(function (mid, k) {
      var mi = M.find(doc.items, mid);
      if (!mi || doc.items.some(function (it) { return it.pg === P.id && it.ov === mid; })) return;
      var c = JSON.parse(JSON.stringify(mi));
      c.id = M.newId("it"); c.m = now; c.pg = P.id; c.side = ""; c.ov = mid; c.grp = "";
      c.z = low - masterIds.length + k;
      if (c.t === "text") {
        var st = M.story(doc, mi.story);
        c.story = newStory(doc, now, st ? JSON.parse(JSON.stringify(st.paras)) : null).id;
        c.seq = 1024;
      }
      doc.items.push(c);
      made.push(c.id);
    });
    return made;
  }
  ED.detachAll = function () {
    var P = curP();
    if (!P || P.master) return;
    var ids = M.masterItems(LY.doc, P.page, P.side).map(function (it) { return it.id; });
    if (!ids.length) { LY.toast(t("ms.noneHere")); return; }
    var made = [];
    LY.op(function (doc, now) { made = detach(doc, P, ids, now); if (!made.length) return false; });
    if (made.length) LY.toast(t("ms.detached", { n: made.length }));
  };
  function detachOne(hm) {
    var made = [];
    LY.op(function (doc, now) { made = detach(doc, hm.P, [hm.it.id], now); if (!made.length) return false; });
    if (made.length) ED.select(made);
  }
  // Back to the master version: drop the page's copies.
  ED.resetToMaster = function () {
    var ids = selItems().filter(function (it) { return it.ov; }).map(function (it) { return it.id; });
    if (!ids.length) return;
    LY.op(function (doc, now) { delItems(doc, ids, now); });
    ED.select([]);
  };

  function hitHandle(sx, sy, touch) {
    var items = selItems();
    if (items.length !== 1) return null;
    var r = touch ? 20 : 9, best = null, bd = r;
    handles(items[0]).forEach(function (h) {
      var d = Math.hypot(h.x - sx, h.y - sy);
      if (d <= bd) { bd = d; best = h; }
    });
    return best;
  }
  function hitPort(sx, sy, touch) {
    var items = selItems();
    if (items.length !== 1 || items[0].t !== "text") return null;
    var p = portPos(items[0], true);
    if (!p) return null;
    return Math.hypot(p[0] - sx, p[1] - sy) <= (touch ? 18 : 9) ? items[0] : null;
  }

  // Snap candidates for an owner P (owner coordinates).
  function snapLines(P, excludeIds) {
    var doc = LY.doc, s = doc.setup, xs = [0, s.w / 2, s.w], ys = [0, s.h / 2, s.h];
    var m = M.margins(doc, P.side || "R");
    xs.push(m.l, s.w - m.r); ys.push(m.t, s.h - m.b);
    if (s.cols > 1) {
      var iw = s.w - m.l - m.r, cw = (iw - s.gut * (s.cols - 1)) / s.cols;
      for (var c = 1; c < s.cols; c++) { var x = m.l + c * cw + (c - 1) * s.gut; xs.push(x, x + s.gut); }
    }
    doc.guides.forEach(function (g) { if (g.pg === P.id) (g.o === "v" ? xs : ys).push(g.p); });
    var ex = {};
    (excludeIds || []).forEach(function (id) { ex[id] = 1; });
    itemsOfP(P).forEach(function (it) {
      if (ex[it.id] || it.hide) return;
      var b = R.itemBox(it);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    return { xs: xs, ys: ys };
  }
  // Best offset to snap any of `vals` onto `lines` (owner coords).
  function snapAxis(vals, lines, tol) {
    var best = null;
    vals.forEach(function (v) {
      lines.forEach(function (l) {
        var d = l - v;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, p: l };
      });
    });
    return best;
  }

  function startDrag(e, kind, extra) {
    drag = { kind: kind, x0: evPos(e)[0], y0: evPos(e)[1], moved: false, pid: e.pointerId, touch: e.pointerType === "touch" };
    var w = toWorld(drag.x0, drag.y0);
    drag.wx0 = w[0]; drag.wy0 = w[1];
    Object.keys(extra || {}).forEach(function (k) { drag[k] = extra[k]; });
    return drag;
  }

  function onDown(e) {
    if (!LY.doc) return;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = evPos(e);
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      // pinch: cancel whatever the first finger started
      clearTimeout(pressTimer);
      if (drag && drag.kind === "move" && LY.inGesture()) LY.endGesture();
      drag = null; ED.marquee = null; ED.draft = null; ED.snaps = [];
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: ED.zoom, mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cam: [ED.camX, ED.camY] };
      pinch.w0 = toWorld(pinch.mid0[0], pinch.mid0[1]);
      return;
    }
    if (ids.length > 2) return;
    var p = evPos(e), w = toWorld(p[0], p[1]), touch = e.pointerType === "touch";
    if (e.button === 1 || ED.tool === "hand" || spaceDown) { startDrag(e, "pan", { cam: [ED.camX, ED.camY] }); return; }
    if (e.button === 2) return;   // contextmenu handles it

    if (ED.threadFrom) { threadClick(w); return; }

    if (ED.tool === "select") {
      var h = hitHandle(p[0], p[1], touch);
      if (h) { beginResize(e, h); return; }
      var port = hitPort(p[0], p[1], touch);
      if (port) { startThread(port.id); return; }
      var it = hitItem(w[0], w[1], touch ? 10 : 4);
      if (!it && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        var hm = hitMaster(w[0], w[1], 4);
        if (hm) { detachOne(hm); return; }
      }
      if (it) {
        var add = e.shiftKey || e.metaKey || e.ctrlKey;
        var already = ED.sel.indexOf(it.id) >= 0;
        if (add) {
          var grp = withGroups([it.id]);
          ED.select(already ? ED.sel.filter(function (id) { return grp.indexOf(id) < 0; }) : ED.sel.concat(grp));
        } else if (!already) ED.select(withGroups([it.id]));
        // double click / tap on a text frame → Story Editor
        var nowT = Date.now();
        if (lastTap.id === it.id && nowT - lastTap.t < 350 && it.t === "text") { lastTap = { t: 0, id: null }; LY.story.open(it.id); return; }
        lastTap = { t: nowT, id: it.id };
        beginMove(e);
        if (touch) {
          clearTimeout(pressTimer);
          pressTimer = setTimeout(function () {
            if (drag && !drag.moved) { var d0 = drag; drag = null; LY.endGesture(); contextMenu(d0.x0, d0.y0); }
          }, 450);
        }
        return;
      }
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) ED.select([]);
      if (touch) startDrag(e, "pan", { cam: [ED.camX, ED.camY] });
      else startDrag(e, "marquee");
      return;
    }
    // drawing tools
    var P = pageAt(w[0], w[1], true);
    if (!P) return;
    startDrag(e, "create", { P: P, t: toolType(ED.tool) });
    ED.draft = { t: drag.t, x0: w[0], y0: w[1], x1: w[0], y1: w[1] };
  }
  function toolType(tool) { return tool === "image" ? "img" : tool; }

  function beginMove(e) {
    var doc = LY.doc;
    var items = selItems();
    if (!items.length) return;
    var locked = items.some(function (it) { return it.lock; });
    startDrag(e, "move", { locked: locked, orig: items.map(function (it) { return { id: it.id, x: it.x, y: it.y }; }) });
    var P = pOf(items[0]);
    drag.P = P;
    drag.lines = P ? snapLines(P, ED.sel) : { xs: [], ys: [] };
    var bb = null;
    items.forEach(function (it) { var b = R.itemBox(it); bb = bb ? union(bb, b) : b; });
    drag.bb = bb;
    void doc;
  }
  function union(a, b) {
    var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  }

  function beginResize(e, h) {
    var it = selItems()[0];
    if (it.lock) { LY.toast(t("toast.locked")); return; }
    var P = pOf(it);
    startDrag(e, h.k === "rot" ? "rotate" : "resize", { h: h.k, item: JSON.parse(JSON.stringify(it)), P: P, lines: snapLines(P, [it.id]) });
  }

  function onMove(e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = evPos(e);
    if (pinch) {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ED.zoom = Math.max(0.05, Math.min(16, pinch.z0 * d / pinch.d0));
      var s = scale();
      ED.camX = pinch.w0[0] - mid[0] / s; ED.camY = pinch.w0[1] - mid[1] / s;
      ED.render(); LY.emit("view");
      return;
    }
    if (!drag || drag.pid !== e.pointerId) return;
    var p = evPos(e), w = toWorld(p[0], p[1]);
    var dxs = p[0] - drag.x0, dys = p[1] - drag.y0;
    if (!drag.moved && Math.hypot(dxs, dys) < (drag.touch ? 8 : 3)) return;
    if (!drag.moved) { drag.moved = true; clearTimeout(pressTimer); }
    var tol = 6 / scale();
    if (drag.kind === "pan") {
      var s2 = scale();
      ED.camX = drag.cam[0] - dxs / s2; ED.camY = drag.cam[1] - dys / s2;
      ED.render(); LY.emit("view");
    } else if (drag.kind === "marquee") {
      ED.marquee = { x0: drag.x0, y0: drag.y0, x1: p[0], y1: p[1] };
      ED.render();
    } else if (drag.kind === "create") {
      var x1 = w[0], y1 = w[1];
      if (e.shiftKey) {
        var ddx = x1 - drag.wx0, ddy = y1 - drag.wy0;
        if (drag.t === "line") { if (Math.abs(ddx) > Math.abs(ddy)) y1 = drag.wy0; else x1 = drag.wx0; }
        else { var m = Math.max(Math.abs(ddx), Math.abs(ddy)); x1 = drag.wx0 + (ddx < 0 ? -m : m); y1 = drag.wy0 + (ddy < 0 ? -m : m); }
      }
      var lines = snapLines(drag.P, []);
      var sx = snapAxis([x1 - drag.P.x], lines.xs, tol), sy = snapAxis([y1 - drag.P.y], lines.ys, tol);
      ED.snaps = [];
      if (sx && !e.shiftKey) { x1 += sx.d; ED.snaps.push({ o: "v", p: drag.P.x + sx.p }); }
      if (sy && !e.shiftKey) { y1 += sy.d; ED.snaps.push({ o: "h", p: drag.P.y + sy.p }); }
      ED.draft.x1 = x1; ED.draft.y1 = y1;
      ED.render();
    } else if (drag.kind === "move") {
      if (drag.locked) return;
      if (!LY.inGesture()) LY.beginGesture();
      var dx = w[0] - drag.wx0, dy = w[1] - drag.wy0;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      ED.snaps = [];
      if (drag.P && !e.altKey) {
        var b = drag.bb;
        var snx = snapAxis([b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx], drag.lines.xs, tol);
        var sny = snapAxis([b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy], drag.lines.ys, tol);
        if (snx) { dx += snx.d; ED.snaps.push({ o: "v", p: drag.P.x + snx.p }); }
        if (sny) { dy += sny.d; ED.snaps.push({ o: "h", p: drag.P.y + sny.p }); }
      }
      liveEdit(function (doc) {
        drag.orig.forEach(function (o) {
          var it = M.find(doc.items, o.id);
          if (it) { it.x = o.x + dx; it.y = o.y + dy; }
        });
      });
    } else if (drag.kind === "resize") {
      if (!LY.inGesture()) LY.beginGesture();
      resizeTo(w, e.shiftKey, tol);
    } else if (drag.kind === "rotate") {
      if (!LY.inGesture()) LY.beginGesture();
      var o = drag.item, P = drag.P;
      var cx = P.x + o.x + o.w / 2, cy = P.y + o.y + o.h / 2;
      var ang = Math.atan2(w[1] - cy, w[0] - cx) * 180 / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      ang = ((ang + 540) % 360) - 180;
      liveEdit(function (doc) { var it = M.find(doc.items, o.id); if (it) it.rot = Math.round(ang * 10) / 10; });
    }
  }

  // Edits during a gesture: applied in place (no undo step, no save
  // until the gesture ends), with a fresh layout.
  function liveEdit(fn) {
    fn(LY.doc);
    relayout();
    ED.render();
  }

  function resizeTo(w, keep, tol) {
    var o = drag.item, P = drag.P, h = drag.h;
    var lx = w[0] - P.x, ly = w[1] - P.y;
    var sx = snapAxis([lx], drag.lines.xs, tol), sy = snapAxis([ly], drag.lines.ys, tol);
    ED.snaps = [];
    if (!o.rot) {
      if (sx) { lx += sx.d; ED.snaps.push({ o: "v", p: P.x + sx.p }); }
      if (sy) { ly += sy.d; ED.snaps.push({ o: "h", p: P.y + sy.p }); }
    }
    if (o.t === "line") {
      liveEdit(function (doc) {
        var it = M.find(doc.items, o.id);
        if (!it) return;
        if (h === "p0") { it.x = lx; it.y = ly; it.w = o.x + o.w - lx; it.h = o.y + o.h - ly; }
        else { it.w = lx - o.x; it.h = ly - o.y; }
      });
      return;
    }
    // work in the item's unrotated frame
    var loc = R.toLocal(o, lx, ly);
    var x0 = 0, y0 = 0, x1 = o.w, y1 = o.h;
    if (h.indexOf("w") >= 0) x0 = loc[0];
    if (h.indexOf("e") >= 0) x1 = loc[0];
    if (h.indexOf("n") >= 0) y0 = loc[1];
    if (h.indexOf("s") >= 0) y1 = loc[1];
    if (keep && o.w > 0 && o.h > 0 && h.length === 2) {
      var ratio = o.w / o.h, nw = Math.abs(x1 - x0), nh = Math.abs(y1 - y0);
      if (nw / ratio > nh) nh = nw / ratio; else nw = nh * ratio;
      if (h.indexOf("w") >= 0) x0 = x1 - nw; else x1 = x0 + nw;
      if (h.indexOf("n") >= 0) y0 = y1 - nh; else y1 = y0 + nh;
    }
    var nx0 = Math.min(x0, x1), nx1 = Math.max(x0, x1), ny0 = Math.min(y0, y1), ny1 = Math.max(y0, y1);
    var nwid = Math.max(1, nx1 - nx0), nhgt = Math.max(1, ny1 - ny0);
    // new centre in owner coordinates (rotate the local centre)
    var a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var lcx = nx0 + nwid / 2 - o.w / 2, lcy = ny0 + nhgt / 2 - o.h / 2;
    var cx = o.x + o.w / 2 + lcx * c - lcy * s, cy = o.y + o.h / 2 + lcx * s + lcy * c;
    liveEdit(function (doc) {
      var it = M.find(doc.items, o.id);
      if (!it) return;
      it.x = cx - nwid / 2; it.y = cy - nhgt / 2; it.w = nwid; it.h = nhgt;
      if (it.t === "img" && it.fit === "custom" && o.w) {
        var k = nwid / o.w;
        if (keep) { it.isc = o.isc * k; it.ix = o.ix * k; it.iy = o.iy * k; }
      }
    });
  }

  function onUp(e) {
    delete pointers[e.pointerId];
    if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
    clearTimeout(pressTimer);
    if (!drag || drag.pid !== e.pointerId) return;
    var d = drag; drag = null;
    var p = evPos(e), w = toWorld(p[0], p[1]);
    ED.snaps = [];
    if (d.kind === "marquee") {
      ED.marquee = null;
      if (d.moved) {
        var a = toWorld(Math.min(d.x0, p[0]), Math.min(d.y0, p[1])), b = toWorld(Math.max(d.x0, p[0]), Math.max(d.y0, p[1]));
        var ids = [];
        allP().forEach(function (P) {
          itemsOfP(P).forEach(function (it) {
            if (it.hide) return;
            var bb = R.itemBox(it);
            if (P.x + bb.x >= a[0] && P.y + bb.y >= a[1] && P.x + bb.x + bb.w <= b[0] && P.y + bb.y + bb.h <= b[1]) ids.push(it.id);
          });
        });
        ED.select(e.shiftKey ? withGroups(ED.sel.concat(ids)) : withGroups(ids));
      }
      ED.render();
    } else if (d.kind === "create") {
      var dr = ED.draft; ED.draft = null;
      finishCreate(d, dr);
    } else if (d.kind === "move") {
      if (d.locked && d.moved) LY.toast(t("toast.locked"));
      if (LY.inGesture()) { reparent(); stampSel(); LY.endGesture(); }
    } else if (d.kind === "resize" || d.kind === "rotate") {
      if (LY.inGesture()) { stampSel(); LY.endGesture(); }
    }
    ED.render();
  }

  // Gesture edits were applied in place: stamp what moved (R27).
  function stampSel() {
    var nw = LY.now();
    selItems().forEach(function (it) { M.touch(it, nw); });
  }

  // An item dropped with its centre on another page moves there.
  function reparent() {
    if (ED.master) return;
    selItems().forEach(function (it) {
      var P = pOf(it);
      if (!P) return;
      var b = R.itemBox(it), cx = P.x + b.x + b.w / 2, cy = P.y + b.y + b.h / 2;
      var Q = pageAt(cx, cy, false);
      if (Q && Q.id !== P.id && !Q.master) {
        it.x += P.x - Q.x; it.y += P.y - Q.y; it.pg = Q.id;
        it.z = maxZ(LY.doc, Q.id) + 1;
      }
    });
  }

  function finishCreate(d, dr) {
    var P = d.P, typ = d.t;
    var x0 = dr.x0 - P.x, y0 = dr.y0 - P.y, x1 = dr.x1 - P.x, y1 = dr.y1 - P.y;
    var small = !d.moved || (Math.abs(x1 - x0) < 4 / scale() && Math.abs(y1 - y0) < 4 / scale());
    var props;
    if (typ === "line") {
      if (small) { x1 = x0 + 120; y1 = y0; }
      props = { t: "line", x: x0, y: y0, w: x1 - x0, h: y1 - y0, stroke: "sw-black", sw: 1 };
    } else {
      var x = Math.min(x0, x1), y = Math.min(y0, y1), ww = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
      if (small) {
        if (typ === "text") {
          var mb = marginBox(LY.doc, P.side || "R");
          ww = Math.min(mb.w, 220); hh = 120;
        } else { ww = 100; hh = typ === "img" ? 75 : 100; }
      }
      props = { t: typ, x: x, y: y, w: Math.max(2, ww), h: Math.max(2, hh) };
      if (typ === "rect" || typ === "ell") { props.stroke = "sw-black"; props.sw = 1; }
      if (typ === "text" || typ === "img") props.sw = 1;
    }
    props.pg = P.id;
    if (P.master && LY.doc.setup.facing) props.side = P.side;
    var made = null;
    LY.op(function (doc, now) { var it = addItem(doc, props, now); if (!it) return false; made = it; });
    ED.setTool("select");
    if (!made) return;
    ED.select([made.id]);
    if (typ === "text") LY.story.open(made.id);
    else if (typ === "img") LY.io.placeImage(made.id);
  }

  // ---------- Threads ----------
  function startThread(fid) {
    ED.threadFrom = fid;
    $("thread-banner").hidden = false;
    cv.style.cursor = "copy";
    ED.render();
  }
  function endThread() {
    ED.threadFrom = null;
    $("thread-banner").hidden = true;
    ED.setTool(ED.tool);
    ED.render();
  }
  ED.endThread = endThread;
  ED.startThread = startThread;

  function threadClick(w) {
    var doc = LY.doc, src = M.find(doc.items, ED.threadFrom);
    if (!src) { endThread(); return; }
    var target = hitItem(w[0], w[1], 8);
    var srcMaster = isMasterId(doc, src.pg);
    var linked = null;
    if (target && target.t === "text") {
      if (target.id === src.id || target.story === src.story) { endThread(); return; }
      if (isMasterId(doc, target.pg) !== srcMaster) { LY.toast(t("thread.otherKind")); return; }
      var alone = M.chain(doc, target.story).length === 1;
      if (!alone || !storyEmpty(doc, target.story)) { LY.toast(t("thread.notEmpty")); return; }
      LY.op(function (d2, now) {
        var s2 = M.find(d2.items, src.id), t2 = M.find(d2.items, target.id);
        linkAfter(d2, s2, t2, now);
      });
      linked = target.id;
    } else {
      var P = pageAt(w[0], w[1], true);
      if (!P || P.master !== srcMaster) { LY.toast(t("thread.otherKind")); return; }
      LY.op(function (d2, now) {
        var s2 = M.find(d2.items, src.id);
        var nf = addItem(d2, { t: "text", pg: P.id, side: P.master && d2.setup.facing ? P.side : "", x: w[0] - P.x, y: w[1] - P.y, w: s2.w, h: s2.h, cols: s2.cols, gut: s2.gut, story: s2.story }, now);
        if (!nf) return false;
        linkAfter(d2, s2, nf, now);
        linked = nf.id;
      });
    }
    endThread();
    if (linked) ED.select([linked]);
  }

  // ---------- Context menu ----------
  function contextMenu(sx, sy) {
    var anchor = $("ctx-anchor");
    anchor.style.left = sx + "px"; anchor.style.top = sy + "px";
    var items = selItems();
    var list = [];
    if (items.length === 1 && items[0].t === "text") list.push({ label: t("props.edit"), fn: function () { LY.story.open(items[0].id); } });
    if (items.length === 1 && items[0].t === "img") list.push({ label: items[0].a ? t("props.replace") : t("props.place"), fn: function () { LY.io.placeImage(items[0].id); } });
    if (items.length) {
      list.push({ label: t("props.dup"), fn: duplicate });
      list.push({ label: t("props.front"), fn: function () { ED.arrange("front"); } });
      list.push({ label: t("props.back"), fn: function () { ED.arrange("back"); } });
      if (items.length > 1) list.push({ label: t("props.group"), fn: ED.group });
      if (items.some(function (it) { return it.grp; })) list.push({ label: t("props.ungroup"), fn: ED.ungroup });
      list.push({ sep: true });
      list.push({ label: t("props.del"), danger: true, fn: ED.deleteSel });
      if (items.some(function (it) { return it.ov; })) list.push({ label: t("ms.reset"), fn: ED.resetToMaster });
    } else {
      var wp = toWorld(sx, sy), hm = hitMaster(wp[0], wp[1], 10);
      if (hm) list.push({ label: t("ms.detachOne"), fn: function () { detachOne(hm); } });
      list.push({ label: t("more.selall"), fn: selectAll });
      if (clipboard) list.push({ label: t("ed.paste"), fn: function () { paste(false); } });
    }
    LY.menu(anchor, list);
  }

  // ---------- Selection commands ----------
  ED.deleteSel = function () {
    var ids = ED.sel.slice();
    if (!ids.length) return;
    LY.op(function (doc, now) { delItems(doc, ids, now); });
    ED.select([]);
    LY.toast(t("toast.deleted"), t("btn.undo"), LY.undo);
  };
  ED.arrange = function (how) {
    var ids = ED.sel.slice();
    LY.op(function (doc, now) {
      ids.forEach(function (id) {
        var it = M.find(doc.items, id);
        if (!it) return;
        var sib = doc.items.filter(function (o) { return o.pg === it.pg; }).sort(M.byZ);
        var i = sib.indexOf(it);
        if (how === "front") it.z = sib[sib.length - 1].z + 1;
        else if (how === "back") it.z = sib[0].z - 1;
        else if (how === "fwd" && i < sib.length - 1) { var nz = sib[i + 1].z; sib[i + 1].z = it.z; it.z = nz === it.z ? nz + 0.5 : nz; M.touch(sib[i + 1], now); }
        else if (how === "bwd" && i > 0) { var pz = sib[i - 1].z; sib[i - 1].z = it.z; it.z = pz === it.z ? pz - 0.5 : pz; M.touch(sib[i - 1], now); }
        M.touch(it, now);
      });
    });
  };
  ED.group = function () {
    var ids = ED.sel.slice();
    if (ids.length < 2) return;
    LY.op(function (doc, now) {
      var g = M.newId("gr");
      ids.forEach(function (id) { var it = M.find(doc.items, id); if (it) { it.grp = g; M.touch(it, now); } });
    });
  };
  ED.ungroup = function () {
    var ids = ED.sel.slice();
    LY.op(function (doc, now) {
      ids.forEach(function (id) { var it = M.find(doc.items, id); if (it && it.grp) { it.grp = ""; M.touch(it, now); } });
    });
  };
  // Align to the margins (one object) or to the selection.
  ED.align = function (how) {
    var items = selItems();
    if (!items.length) return;
    var doc = LY.doc, target;
    if (items.length === 1) {
      var P = pOf(items[0]);
      target = marginBox(doc, P ? P.side || "R" : "R");
    } else {
      target = null;
      items.forEach(function (it) { var b = R.itemBox(it); target = target ? union(target, b) : b; });
    }
    var ids = items.map(function (it) { return it.id; });
    LY.op(function (d2, now) {
      var list = ids.map(function (id) { return M.find(d2.items, id); }).filter(Boolean);
      if (how === "dh" || how === "dv") {
        if (list.length < 3) return false;
        var hz = how === "dh";
        list.sort(function (a, b) { var A = R.itemBox(a), B = R.itemBox(b); return hz ? A.x - B.x : A.y - B.y; });
        var first = R.itemBox(list[0]), last = R.itemBox(list[list.length - 1]);
        var total = 0;
        list.forEach(function (it) { var b = R.itemBox(it); total += hz ? b.w : b.h; });
        var span = hz ? (last.x + last.w - first.x) : (last.y + last.h - first.y);
        var gap = (span - total) / (list.length - 1), pos = hz ? first.x : first.y;
        list.forEach(function (it) {
          var b = R.itemBox(it);
          if (hz) it.x += pos - b.x; else it.y += pos - b.y;
          pos += (hz ? b.w : b.h) + gap;
          M.touch(it, now);
        });
        return;
      }
      list.forEach(function (it) {
        var b = R.itemBox(it), dx = 0, dy = 0;
        if (how === "al") dx = target.x - b.x;
        if (how === "ac") dx = target.x + target.w / 2 - (b.x + b.w / 2);
        if (how === "ar") dx = target.x + target.w - (b.x + b.w);
        if (how === "at") dy = target.y - b.y;
        if (how === "am") dy = target.y + target.h / 2 - (b.y + b.h / 2);
        if (how === "ab") dy = target.y + target.h - (b.y + b.h);
        if (dx || dy) { it.x += dx; it.y += dy; M.touch(it, now); }
      });
    });
  };

  function selectAll() {
    var P = curP();
    if (!P) return;
    ED.select(itemsOfP(P).filter(function (it) { return !it.hide; }).map(function (it) { return it.id; }));
  }
  ED.selectAll = selectAll;

  // ---------- 5. Keyboard + clipboard ----------
  var clipboard = null;     // session only: { items, stories }
  function copySel() {
    var doc = LY.doc, items = selItems();
    if (!items.length) return false;
    var sids = {};
    items.forEach(function (it) { if (it.t === "text") sids[it.story] = 1; });
    clipboard = {
      items: JSON.parse(JSON.stringify(items)),
      stories: Object.keys(sids).map(function (sid) { return JSON.parse(JSON.stringify(M.story(doc, sid) || { id: sid, paras: [] })); }),
      swatches: JSON.parse(JSON.stringify(doc.swatches)), pstyles: JSON.parse(JSON.stringify(doc.pstyles)), cstyles: JSON.parse(JSON.stringify(doc.cstyles)),
      from: doc.id
    };
    return true;
  }
  function paste(offset) {
    if (!clipboard) return;
    var P = curP();
    if (!P) return;
    var made = [];
    LY.op(function (doc, now) {
      var storyMap = {}, grpMap = {};
      clipboard.stories.forEach(function (st) {
        var ns = newStory(doc, now, JSON.parse(JSON.stringify(st.paras)));
        storyMap[st.id] = ns.id;
      });
      // swatches / styles the pasted objects need (other documents)
      if (clipboard.from !== doc.id) {
        ["swatches", "pstyles", "cstyles"].forEach(function (c) {
          clipboard[c].forEach(function (e) { if (!M.find(doc[c], e.id)) { var x = JSON.parse(JSON.stringify(e)); x.m = now; doc[c].push(x); } });
        });
      }
      var z = maxZ(doc, P.id);
      var sameOwner = clipboard.items.every(function (it) { return it.pg === P.id; });
      clipboard.items.forEach(function (src) {
        var it = JSON.parse(JSON.stringify(src));
        it.id = M.newId("it"); it.m = now; it.pg = P.id; it.z = ++z;
        it.side = P.master && doc.setup.facing ? P.side : "";
        if (sameOwner || offset) { it.x += 10; it.y += 10; }
        if (it.grp) { grpMap[it.grp] = grpMap[it.grp] || M.newId("gr"); it.grp = grpMap[it.grp]; }
        if (it.t === "text") it.story = storyMap[it.story];
        doc.items.push(it);
        made.push(it.id);
      });
    });
    if (made.length) ED.select(made);
  }
  function duplicate() { if (copySel()) paste(true); }
  ED.duplicate = duplicate;

  function nudge(dx, dy) {
    var ids = ED.sel.slice();
    if (!ids.length) return;
    LY.op(function (doc, now) {
      var any = false;
      ids.forEach(function (id) {
        var it = M.find(doc.items, id);
        if (!it || it.lock) return;
        it.x += dx; it.y += dy; M.touch(it, now); any = true;
      });
      if (!any) return false;
    });
  }

  function typing(e) {
    var tg = e.target;
    if (!tg) return false;
    var tag = tg.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tg.isContentEditable || !!(tg.closest && tg.closest("dialog[open]"));
  }

  function onKey(e) {
    if (!LY.doc || $("editor").hidden) return;
    if (e.key === " " && !typing(e)) { spaceDown = true; }
    if (typing(e)) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && e.shiftKey) return;            // shell shortcuts
    var k = e.key, code = e.code;
    if (mod && (code === "KeyZ")) { e.preventDefault(); if (e.shiftKey) LY.redo(); else LY.undo(); return; }
    if (mod && code === "KeyY") { e.preventDefault(); LY.redo(); return; }
    if (mod && code === "KeyC") { if (copySel()) { e.preventDefault(); LY.toast(t("toast.copied")); } return; }
    if (mod && code === "KeyX") { if (copySel()) { e.preventDefault(); ED.deleteSel(); } return; }
    if (mod && code === "KeyV") { if (clipboard) { e.preventDefault(); paste(false); } return; }
    if (mod && code === "KeyD") { e.preventDefault(); duplicate(); return; }
    if (mod && code === "KeyA") { e.preventDefault(); selectAll(); return; }
    if (mod && code === "KeyG") { e.preventDefault(); if (e.shiftKey) ED.ungroup(); else ED.group(); return; }
    if (mod && code === "KeyE") { e.preventDefault(); LY.dlg.exportDlg(); return; }
    if (mod && (code === "Digit0" || code === "Numpad0")) { e.preventDefault(); ED.fit(); return; }
    if (mod && (code === "Digit1" || code === "Numpad1")) { e.preventDefault(); ED.setZoom(1); return; }
    if (mod && (k === "=" || k === "+" || code === "NumpadAdd")) { e.preventDefault(); ED.setZoom(ED.zoom * 1.25); return; }
    if (mod && (k === "-" || code === "NumpadSubtract")) { e.preventDefault(); ED.setZoom(ED.zoom / 1.25); return; }
    if (mod) return;
    if (k === "Escape") {
      if (ED.threadFrom) endThread();
      else if (ED.sel.length) ED.select([]);
      else if (ED.master) ED.enterMaster(null);
      return;
    }
    if (k === "Delete" || k === "Backspace") { if (ED.sel.length) { e.preventDefault(); ED.deleteSel(); } return; }
    var step = e.shiftKey ? 10 : 1;
    if (k === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); return; }
    if (k === "ArrowRight") { e.preventDefault(); nudge(step, 0); return; }
    if (k === "ArrowUp") { e.preventDefault(); nudge(0, -step); return; }
    if (k === "ArrowDown") { e.preventDefault(); nudge(0, step); return; }
    if (k === "Enter") {
      var it = selItems()[0];
      if (it && it.t === "text") { e.preventDefault(); LY.story.open(it.id); }
      return;
    }
    var tools = { KeyV: "select", KeyT: "text", KeyF: "image", KeyR: "rect", KeyE: "ell", KeyL: "line", KeyH: "hand" };
    if (tools[code] && !e.shiftKey && !e.altKey) { ED.setTool(tools[code]); return; }
    if (code === "KeyW" && !e.shiftKey) { ED.togglePreview(); }
  }

  ED.togglePreview = function () {
    ED.preview = !ED.preview;
    $("ed-preview").classList.toggle("on", ED.preview);
    $("ed-preview").setAttribute("aria-pressed", ED.preview ? "true" : "false");
    ED.render();
  };

  // ---------- 6. Wiring ----------
  function buildTools() {
    var host = $("tools");
    host.innerHTML = "";
    [["select", "select"], ["text", "text"], ["image", "image"], ["rect", "rect"], ["ell", "ell"], ["line", "line"], ["hand", "hand"]].forEach(function (d) {
      var b = LY.iconBtn(d[1], t("tool." + d[0]), "tool");
      b.setAttribute("data-tool", d[0]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { ED.setTool(d[0]); });
      host.appendChild(b);
    });
  }

  function updateStatus() {
    if (!LY.doc) return;
    var P = curP(), n = LY.doc.pages.length;
    if (ED.master) {
      var ms = M.find(LY.doc.masters, ED.master);
      $("st-page").textContent = ms ? t("st.master", { name: LY.label(ms.name) }) : "";
    } else $("st-page").textContent = P ? t("st.page", { n: P.idx + 1, c: n }) : "";
    var k = ED.sel.length;
    $("st-sel").textContent = k === 1 ? t("st.sel1") : k ? t("st.sel", { n: k }) : "";
    var ov = Object.keys(ED.L ? ED.L.overset : {}).length;
    var b = $("st-overset");
    b.hidden = !ov;
    if (ov) b.innerHTML = LY.icon("warn") + "<span></span>", b.lastChild.textContent = t("st.overset", { n: ov });
    var pf = ED.pf || [], errs = pf.filter(function (x) { return x.sev === "err"; }).length;
    var pb = $("st-pf");
    pb.className = "st-pf " + (errs ? "err" : pf.length ? "warn" : "ok");
    $("st-pf-txt").textContent = pf.length ? t("st.pf", { n: pf.length }) : t("st.pfOk");
    pb.title = t("pf.title");
    $("ed-undo").disabled = !LY.canUndo();
    $("ed-redo").disabled = !LY.canRedo();
    $("ed-zoom").textContent = Math.round(ED.zoom * 100) + "%";
  }
  ED.updateStatus = updateStatus;

  // Jump to the first overset story's last frame.
  function gotoOverset() {
    var sids = Object.keys(ED.L ? ED.L.overset : {});
    if (!sids.length) return;
    var ch = M.chain(LY.doc, sids[0]), last = ch[ch.length - 1];
    if (!last) return;
    if (isMasterId(LY.doc, last.pg)) { ED.enterMaster(last.pg); }
    ED.select([last.id]);
    ED.scrollToItem(last.id);
  }

  // Select a preflight entry's item, on its master when it lives there.
  ED.gotoItem = function (id) {
    var it = M.find(LY.doc.items, id);
    if (!it) return;
    var onMaster = isMasterId(LY.doc, it.pg);
    if (onMaster && ED.master !== it.pg) ED.enterMaster(it.pg);
    else if (!onMaster && ED.master) ED.enterMaster(null);
    ED.select([it.id]);
    ED.scrollToItem(it.id);
  };

  function wire() {
    cv = $("cv");
    ctx = cv.getContext("2d");
    cv.setAttribute("aria-label", t("a11y.canvas"));
    var anchor = el("span", "ctx-anchor");
    anchor.id = "ctx-anchor";
    $("stage").appendChild(anchor);
    buildTools();
    ED.setTool("select");
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; pinch = null; if (drag && drag.pid === e.pointerId) { drag = null; ED.marquee = null; ED.draft = null; ED.snaps = []; LY.endGesture(); ED.render(); } });
    cv.addEventListener("dblclick", function (e) {
      var p = evPos(e), w = toWorld(p[0], p[1]), it = hitItem(w[0], w[1], 4);
      if (it && it.t === "text") LY.story.open(it.id);
      else if (it && it.t === "img") LY.io.placeImage(it.id);
    });
    cv.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var p = evPos(e), w = toWorld(p[0], p[1]), it = hitItem(w[0], w[1], 4);
      if (it && ED.sel.indexOf(it.id) < 0) ED.select(withGroups([it.id]));
      contextMenu(p[0], p[1]);
    });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = evPos(e);
      if (e.ctrlKey || e.metaKey) { ED.setZoom(ED.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)), p[0], p[1]); return; }
      var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1, s = scale();
      if (e.shiftKey) ED.camX += (e.deltaY || e.deltaX) * k / s;
      else { ED.camX += e.deltaX * k / s; ED.camY += e.deltaY * k / s; }
      ED.render(); LY.emit("view");
    }, { passive: false });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", function (e) { if (e.key === " ") spaceDown = false; });
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("stage"));

    $("ed-back").addEventListener("click", LY.goHome);
    $("ed-name").addEventListener("click", function () { LY.renameDoc(LY.doc.id); });
    $("ed-undo").addEventListener("click", LY.undo);
    $("ed-redo").addEventListener("click", LY.redo);
    $("ed-zin").addEventListener("click", function () { ED.setZoom(ED.zoom * 1.25); });
    $("ed-zout").addEventListener("click", function () { ED.setZoom(ED.zoom / 1.25); });
    $("ed-zoom").addEventListener("click", function () { ED.fit(); });
    $("ed-preview").addEventListener("click", ED.togglePreview);
    $("master-done").addEventListener("click", function () { ED.enterMaster(null); });
    $("thread-cancel").addEventListener("click", endThread);
    $("st-overset").addEventListener("click", gotoOverset);
    $("st-pf").addEventListener("click", function () { LY.dlg.preflight(); });
    LY.setIcon($("ed-back"), "back", t("ed.back"));
    LY.setIcon($("ed-undo"), "undo", t("ed.undo"));
    LY.setIcon($("ed-redo"), "redo", t("ed.redo"));
    LY.setIcon($("ed-zin"), "plus", t("ed.zin"));
    LY.setIcon($("ed-zout"), "minus", t("ed.zout"));
    LY.setIcon($("ed-preview"), "eye", t("ed.preview"));
    $("ed-zoom").title = t("ed.fit");
    $("ed-name").title = t("ed.rename");

    LY.on("palette", function () { readPalette(); ED.render(); });
    LY.on("open", function () {
      ED.sel = []; ED.master = null; ED.threadFrom = null; ED.preview = false;
      $("master-banner").hidden = true; $("thread-banner").hidden = true;
      $("ed-preview").classList.remove("on");
      world = []; buildWorld(); relayout(); resize();
      requestAnimationFrame(function () { resize(); ED.fit(allP()[0]); updateStatus(); });
    });
    LY.on("close", function () { ED.sel = []; world = []; });
    function changed() {
      if (!LY.doc) return;
      world = []; buildWorld(); relayout();
      ED.sel = ED.sel.filter(function (id) { return !!M.find(LY.doc.items, id); });
      ED.render(); updateStatus();
    }
    LY.on("doc", changed);
    LY.on("remote", function () { changed(); LY.emit("sel"); });
    LY.on("sel", updateStatus);
    LY.on("view", updateStatus);
    LY.A.onChange(function () { if (LY.doc && ED.L) ED.pf = R.preflight(LY.doc, ED.L, { isMissing: LY.A.isMissing }); ED.render(); updateStatus(); });
    readPalette();
  }

  LY.on("boot", wire);
})();
