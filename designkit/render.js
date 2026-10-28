// ============================================================
// orOS designkit — render.js (v1.1.0)
// Lays out every story of a document (threads, master pages, page
// numbers, text wrap) and draws pages on a canvas: the editor view,
// thumbnails and image exports all go through drawPage(), and the
// PDF writer (pdf.js) reads the same layout, so screen and print
// agree.
// Needs orosDK.model + orosDK.text (Node: require).
// Exposes orosDK.render (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M, T;
  if (typeof module !== "undefined" && module.exports) { M = require("./model.js"); T = require("./text.js"); }
  else { M = root.orosDK.model; T = root.orosDK.text; }

  // ---------- 1. Geometry ----------
  function rad(d) { return d * Math.PI / 180; }
  // Item corners in owner (page) coordinates, rotation about the
  // centre.
  function corners(it) {
    var cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = rad(it.rot || 0);
    var c = Math.cos(a), s = Math.sin(a);
    return [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]].map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    });
  }
  function bbox(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function itemBox(it) {
    if (it.t === "line") {
      return bbox([[it.x, it.y], [it.x + it.w, it.y + it.h]]);
    }
    return bbox(corners(it));
  }
  // A point in owner coordinates → the item's unrotated local frame
  // (origin at the item's top-left).
  function toLocal(it, px, py) {
    var cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = -rad(it.rot || 0);
    var dx = px - cx, dy = py - cy, c = Math.cos(a), s = Math.sin(a);
    return [cx + dx * c - dy * s - it.x, cy + dx * s + dy * c - it.y];
  }

  // Where an image sits inside its frame (frame-local points). A
  // custom placement may scale the height on its own (ext.iscy: a
  // picture stretched by the program it came from, e.g. Scribus).
  function imageRect(it) {
    var iw = it.iw || 1, ih = it.ih || 1;
    if (it.fit === "custom") return { x: it.ix, y: it.iy, w: iw * it.isc, h: ih * (it.ext && it.ext.iscy > 0 ? it.ext.iscy : it.isc) };
    var s = it.fit === "fit" ? Math.min(it.w / iw, it.h / ih) : Math.max(it.w / iw, it.h / ih);
    var w = iw * s, h = ih * s;
    return { x: (it.w - w) / 2, y: (it.h - h) / 2, w: w, h: h };
  }
  // Effective resolution of a placed image (pixels per inch).
  function effectivePpi(it) {
    if (!it.iw) return 0;
    var r = imageRect(it);
    return Math.min(it.iw / (r.w / 72), (it.ih || it.iw) / (r.h / 72));
  }
  // Back to one scale for both sides (any edit of the fit or scale).
  function uniform(it) {
    if (!it.ext || it.ext.iscy === undefined) return;
    delete it.ext.iscy;
    if (!Object.keys(it.ext).length) delete it.ext;
  }

  // ---------- 2. Layout of a whole document ----------
  // Result:
  //   { frames: { itemId: { lines } }          page frames
  //     master: { pageId: { itemId: { lines } } }  master frames
  //     overset: { storyId: true }, pageOf: { pageId: index } }
  function computeLayout(doc) {
    var pages = M.pagesInOrder(doc), idx = {}, info = {}, first = M.firstNumber(doc);
    pages.forEach(function (p, i) { idx[p.id] = i; info[p.id] = { side: M.sideOf(doc, i), label: String(i + first), no: i + first }; });
    var styles = { ps: doc.pstyles, cs: doc.cstyles };
    var masterIds = {};
    doc.masters.forEach(function (m) { masterIds[m.id] = 1; });
    var out = { frames: {}, master: {}, overset: {}, pageOf: idx };

    // wrap objects per owner (page or master)
    var wrapsBy = {};
    doc.items.forEach(function (it) {
      if (it.wrap === "none" || it.hide) return;
      (wrapsBy[it.pg] = wrapsBy[it.pg] || []).push(it);
    });

    // master items detached on a page (they no longer show there)
    var detached = {};
    doc.items.forEach(function (it) { if (it.ov) detached[it.pg + ":" + it.ov] = 1; });

    function exclFor(frame, ownerIds, side, pageId) {
      var ex = [];
      ownerIds.forEach(function (oid) {
        (wrapsBy[oid] || []).forEach(function (w) {
          if (w.id === frame.id || (w.t === "text" && w.story === frame.story)) return;
          if (detached[pageId + ":" + w.id]) return;
          if (w.side && side && w.side !== side) return;
          var pts = w.t === "line" ? [[w.x, w.y], [w.x + w.w, w.y + w.h]] : corners(w);
          var local = pts.map(function (p) { return toLocal(frame, p[0], p[1]); });
          var b = bbox(local), o = w.wo || 0;
          ex.push({ x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o, shape: w.wrap === "ell" && !w.rot ? "ell" : "box" });
        });
      });
      return ex;
    }

    function geom(it, ctx, ex) {
      return { id: it.id, w: it.w, h: it.h, cols: it.cols, gut: it.gut, inset: it.ins, valign: it.va, excl: ex, ctx: ctx, story: it.story };
    }

    // page stories
    var stories = {};
    doc.items.forEach(function (it) {
      if (it.t !== "text" || masterIds[it.pg]) return;
      if (idx[it.pg] === undefined) return;
      (stories[it.story] = stories[it.story] || []).push(it);
    });
    Object.keys(stories).forEach(function (sid) {
      var st = M.story(doc, sid);
      var frames = stories[sid].sort(function (a, b) { return a.seq - b.seq || M.cmpStr(a.id, b.id); });
      var g = frames.map(function (f) {
        var pi = info[f.pg], pg = M.find(doc.pages, f.pg);
        var owners = [f.pg];
        if (pg && pg.ms) owners.push(pg.ms);
        return geom(f, { pageLabel: pi.label, pageCount: pages.length, pg: f.pg, no: pi.no }, exclFor(f, owners, pi.side, f.pg));
      });
      var res = T.layoutChain(st || { paras: [] }, g, styles);
      Object.keys(res.frames).forEach(function (fid) { out.frames[fid] = res.frames[fid]; });
      if (res.overset) out.overset[sid] = true;
    });

    // running heads (LY-RH): each page's chapter title, the first one
    // that opens on the page, else the last one before it ("" before
    // any); a title is a paragraph whose style has ext.sec
    var secOf = runningHeads(doc, pages, out.frames, styles);

    // master stories, once per page that shows them
    pages.forEach(function (p) {
      if (!p.ms || !masterIds[p.ms]) return;
      var side = info[p.id].side, per = {};
      M.masterItems(doc, p, side).forEach(function (it) {
        if (it.t !== "text" || it.hide) return;
        (per[it.story] = per[it.story] || []).push(it);
      });
      var res0 = {};
      Object.keys(per).forEach(function (sid) {
        var st = M.story(doc, sid);
        var frames = per[sid].sort(function (a, b) { return a.seq - b.seq || M.cmpStr(a.id, b.id); });
        var g = frames.map(function (f) {
          return geom(f, { pageLabel: info[p.id].label, pageCount: pages.length, pg: p.id, no: info[p.id].no, sec: secOf[p.id] }, exclFor(f, [p.ms, p.id], side, p.id));
        });
        var res = T.layoutChain(st || { paras: [] }, g, styles);
        Object.keys(res.frames).forEach(function (fid) { res0[fid] = res.frames[fid]; });
        if (res.overset) out.overset[sid] = true;
      });
      out.master[p.id] = res0;
    });
    return out;
  }

  function runningHeads(doc, pages, frames, styles) {
    var isSec = {}, psMap = T.byId(styles.ps), out = {}, cur = "", any = false;
    doc.pstyles.forEach(function (s) { if (T.resolvePs(psMap, s.id).sec) { isSec[s.id] = 1; any = true; } });
    if (!any) return out;
    var onPage = {}, stories = {}, seen = {};
    doc.items.forEach(function (it) {
      if (it.t === "text" && frames[it.id]) (onPage[it.pg] = onPage[it.pg] || []).push(it);
    });
    doc.stories.forEach(function (st) { stories[st.id] = st; });
    pages.forEach(function (p) {
      var first = null;
      (onPage[p.id] || []).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (f) {
        var st = stories[f.story];
        if (!st) return;
        frames[f.id].lines.forEach(function (ln) {
          var para = st.paras[ln.p];
          if (!para || !isSec[para.ps] || seen[f.story + ":" + ln.p]) return;
          seen[f.story + ":" + ln.p] = 1;
          var tx = (para.runs || []).map(function (r) { return typeof r.t === "string" ? r.t : ""; }).join("").replace(/\s+/g, " ").trim().slice(0, 200);
          if (!tx) return;
          if (first === null) first = tx;
          cur = tx;
        });
      });
      out[p.id] = first !== null ? first : cur;
    });
    return out;
  }

  // ---------- 2b. Preflight ----------
  // Problems that would spoil the print, newest layout L required.
  // opts.isMissing(assetName) → true when the image file is gone.
  // Result: [{ sev: "err"|"warn", code, id (item), pg (page or master id) }]
  // sorted by page order, errors first on each page.
  var PF_PPI = 150, PF_MIN_PT = 6;
  function short(inner, outer) { return inner && !outer; }
  function preflight(doc, L, opts) {
    opts = opts || {};
    var out = [], order = {}, seen = {};
    M.pagesInOrder(doc).forEach(function (p, i) { order[p.id] = i; });
    doc.masters.forEach(function (m, i) { order[m.id] = 100000 + i; });
    function add(sev, code, it) {
      var k = code + ":" + it.id;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ sev: sev, code: code, id: it.id, pg: it.pg });
    }
    // overset: the last frame of the thread
    Object.keys(L.overset || {}).forEach(function (sid) {
      var ch = M.chain(doc, sid), last = ch[ch.length - 1];
      if (last) add("err", "overset", last);
    });
    var minSize = {};
    function scan(frames) {
      Object.keys(frames || {}).forEach(function (fid) {
        (frames[fid].lines || []).forEach(function (ln) {
          ln.runs.forEach(function (r) {
            if (r.t && String(r.t).trim() && r.size < (minSize[fid] || Infinity)) minSize[fid] = r.size;
          });
        });
      });
    }
    scan(L.frames);
    Object.keys(L.master || {}).forEach(function (pid) { scan(L.master[pid]); });
    var bleed = doc.setup.bleed, W = doc.setup.w, H = doc.setup.h, facing = doc.setup.facing;
    var emptyStory = {};
    doc.items.forEach(function (it) {
      if (it.hide || order[it.pg] === undefined) return;
      if (it.t === "img") {
        if (!it.a) add("warn", "empty", it);
        else if (opts.isMissing && opts.isMissing(it.a)) add("err", "missing", it);
        else if (effectivePpi(it) < PF_PPI) add("warn", "ppi", it);
      }
      if (it.t === "text") {
        if (minSize[it.id] < PF_MIN_PT) add("warn", "small", it);
        if (emptyStory[it.story] === undefined) {
          var st = M.story(doc, it.story);
          emptyStory[it.story] = !(st && T.hasText(st));
          if (emptyStory[it.story]) add("warn", "empty", M.chain(doc, it.story)[0] || it);
        }
      }
      // touches the trim edge without running into the bleed
      var paints = it.t === "img" ? !!it.a : it.t === "line" ? false : !!(it.fill || it.gr);
      if (paints && bleed > 0 && order[it.pg] < 100000) {
        var b = itemBox(it), e = 0.5, side = M.sideOf(doc, order[it.pg]);
        var left = !(facing && side === "R"), right = !(facing && side === "L");
        if ((left && short(b.x <= e, b.x <= -bleed + e)) || (right && short(b.x + b.w >= W - e, b.x + b.w >= W + bleed - e)) ||
            short(b.y <= e, b.y <= -bleed + e) || short(b.y + b.h >= H - e, b.y + b.h >= H + bleed - e)) add("warn", "bleed", it);
      }
    });
    out.sort(function (a, b) {
      return (order[a.pg] - order[b.pg]) || (a.sev === b.sev ? 0 : a.sev === "err" ? -1 : 1) || M.cmpStr(a.code + a.id, b.code + b.id);
    });
    return out;
  }

  // Master editing view: master frames laid out with a sample page
  // number (the prefix, like InDesign shows "A").
  function computeMasterLayout(doc, master, side) {
    var styles = { ps: doc.pstyles, cs: doc.cstyles }, per = {}, out = { frames: {}, overset: {} };
    doc.items.forEach(function (it) {
      if (it.t !== "text" || it.pg !== master.id) return;
      if (side && it.side && it.side !== side) return;
      (per[it.story] = per[it.story] || []).push(it);
    });
    Object.keys(per).forEach(function (sid) {
      var frames = per[sid].sort(function (a, b) { return a.seq - b.seq || M.cmpStr(a.id, b.id); });
      var g = frames.map(function (f) {
        return { id: f.id, w: f.w, h: f.h, cols: f.cols, gut: f.gut, inset: f.ins, valign: f.va, excl: [], ctx: { pageLabel: master.pre, pageCount: master.pre + "#" } };
      });
      var res = T.layoutChain(M.story(doc, sid) || { paras: [] }, g, styles);
      Object.keys(res.frames).forEach(function (fid) { out.frames[fid] = res.frames[fid]; });
      if (res.overset) out.overset[sid] = true;
    });
    return out;
  }

  // ---------- 3. Drawing ----------
  function rgba(doc, id, op) {
    var c = M.swatchColor(doc, id);
    if (!c) return null;
    return "rgba(" + c.rgb.join(",") + "," + (op === undefined ? 1 : op) + ")";
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (!r) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // A path item's commands in page points (see model.parsePath).
  function pathCmds(it) {
    var cmds = M.parsePath(it.d) || [], x = it.x, y = it.y, w = it.w, h = it.h;
    return cmds.map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) o.push(x + c[i] * w, y + c[i + 1] * h);
      return o;
    });
  }
  // The current path = the item's outline (rect, rounded rect, ellipse
  // or path).
  function outline(ctx, it) {
    if (it.t === "ell") {
      ctx.beginPath();
      ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.abs(it.w / 2), Math.abs(it.h / 2), 0, 0, Math.PI * 2);
    } else if (it.t === "path") {
      ctx.beginPath();
      pathCmds(it).forEach(function (c) {
        if (c[0] === "M") ctx.moveTo(c[1], c[2]);
        else if (c[0] === "L") ctx.lineTo(c[1], c[2]);
        else if (c[0] === "C") ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
        else ctx.closePath();
      });
    } else roundRectPath(ctx, it.x, it.y, it.w, it.h, it.r);
  }
  // Gradient end points in page points: linear (x1,y1) → (x2,y2);
  // radial centre (x1,y1), radius = distance to (x2,y2).
  function gradGeom(it) {
    var g = it.gr, x1 = it.x + g.x1 * it.w, y1 = it.y + g.y1 * it.h, x2 = it.x + g.x2 * it.w, y2 = it.y + g.y2 * it.h;
    return { k: g.k, x1: x1, y1: y1, x2: x2, y2: y2, r: Math.max(0.01, Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1))) };
  }
  function gradient(ctx, doc, it) {
    var g = gradGeom(it), grad;
    grad = g.k === "r" ? ctx.createRadialGradient(g.x1, g.y1, 0, g.x1, g.y1, g.r) : ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    it.gr.st.forEach(function (s) { grad.addColorStop(s[0], rgba(doc, s[1], s[2] / 100) || "rgba(0,0,0,0)"); });
    return grad;
  }

  function strokeStyle(ctx, doc, it) {
    if (!it.stroke || !(it.sw > 0)) return false;
    ctx.strokeStyle = rgba(doc, it.stroke);
    ctx.lineWidth = it.sw;
    ctx.setLineDash(it.dash ? [it.sw * 3, it.sw * 2] : []);
    return !!ctx.strokeStyle;
  }

  function drawLines(ctx, doc, lines) {
    if (!lines) return;
    ctx.textBaseline = "alphabetic";
    try { ctx.fontKerning = "none"; } catch (e) {}
    lines.forEach(function (ln) {
      ln.runs.forEach(function (r) {
        if (!r.t) return;
        ctx.font = r.size + "px " + T.cssStack(r.key);
        ctx.fillStyle = rgba(doc, r.color) || "#000";
        if (r.track || r.kern) {
          // letter by letter: tracking and pair kerning (LY-KERN) as layout measured them
          var x = r.x, prev = "";
          for (var i = 0; i < r.t.length; i++) {
            var ch = r.t[i];
            if (r.kern && prev) x += T.kernPair(r.key, prev, ch, r.size);
            ctx.fillText(ch, x, r.y);
            x += T.measure(r.key, ch, r.size, r.track);
            prev = ch;
          }
        } else ctx.fillText(r.t, r.x, r.y);
        if (r.u) ctx.fillRect(r.x, r.y + r.size * 0.12, r.w, Math.max(0.3, r.size * 0.05));
      });
    });
  }

  // opts: { lines(itemId) → lines | null, getImage(assetId) →
  //   drawable | null, preview, missing: label for a missing image }
  function drawItem(ctx, doc, it, opts) {
    if (it.hide) return;
    ctx.save();
    ctx.globalAlpha = (it.op === undefined ? 100 : it.op) / 100;
    if (it.rot) {
      var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      ctx.translate(cx, cy); ctx.rotate(rad(it.rot)); ctx.translate(-cx, -cy);
    }
    if (it.t === "line") {
      if (strokeStyle(ctx, doc, it)) {
        ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.x + it.w, it.y + it.h); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    outline(ctx, it);
    var paint = it.gr ? gradient(ctx, doc, it) : it.fill ? rgba(doc, it.fill) : null;
    if (paint) { ctx.fillStyle = paint; ctx.fill(it.eo ? "evenodd" : "nonzero"); }
    if (it.t === "img") drawImageItem(ctx, doc, it, opts);
    if (it.t === "text") {
      ctx.save();
      ctx.translate(it.x, it.y);
      drawLines(ctx, doc, opts.lines ? opts.lines(it.id) : null);
      ctx.restore();
    }
    if (strokeStyle(ctx, doc, it)) {
      outline(ctx, it);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawImageItem(ctx, doc, it, opts) {
    var img = it.a && opts.getImage ? opts.getImage(it.a) : null;
    if (img) {
      ctx.save();
      roundRectPath(ctx, it.x, it.y, it.w, it.h, it.r);
      ctx.clip();
      var r = imageRect(it);
      ctx.drawImage(img, it.x + r.x, it.y + r.y, r.w, r.h);
      ctx.restore();
      return;
    }
    if (opts.preview) return;
    // placeholder: crossed frame (empty or still syncing)
    ctx.save();
    ctx.strokeStyle = "rgba(128,128,128,0.7)";
    ctx.lineWidth = Math.max(0.5, Math.min(it.w, it.h) / 200);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(it.x, it.y); ctx.lineTo(it.x + it.w, it.y + it.h);
    ctx.moveTo(it.x + it.w, it.y); ctx.lineTo(it.x, it.y + it.h);
    ctx.stroke();
    if (it.a && opts.missing) {
      var fs = Math.max(6, Math.min(14, it.w / 12));
      ctx.font = fs + "px sans-serif";
      ctx.fillStyle = "rgba(128,128,128,0.9)";
      ctx.textAlign = "center";
      ctx.fillText(opts.missing, it.x + it.w / 2, it.y + it.h / 2 - fs);
      ctx.textAlign = "start";
    }
    ctx.restore();
  }

  // Draw one page's content. The caller has already set a transform
  // where 1 unit = 1 pt and (0,0) = the page's top-left trim corner,
  // and painted the paper.
  function drawPage(ctx, doc, page, L, opts) {
    opts = opts || {};
    var idx = L.pageOf[page.id], side = M.sideOf(doc, idx || 0);
    var mframes = L.master[page.id] || {};
    if (page.ms) {
      M.masterItems(doc, page, side).forEach(function (it) {
        drawItem(ctx, doc, it, { lines: function (id) { var f = mframes[id]; return f && f.lines; }, getImage: opts.getImage, preview: true });
      });
    }
    M.itemsOn(doc, page.id).forEach(function (it) {
      drawItem(ctx, doc, it, { lines: function (id) { var f = L.frames[id]; return f && f.lines; }, getImage: opts.getImage, preview: opts.preview, missing: opts.missing });
    });
  }

  function drawMaster(ctx, doc, master, side, ML, opts) {
    opts = opts || {};
    M.itemsOn(doc, master.id, side).forEach(function (it) {
      drawItem(ctx, doc, it, { lines: function (id) { var f = ML.frames[id]; return f && f.lines; }, getImage: opts.getImage, preview: opts.preview, missing: opts.missing });
    });
  }

  // A page on a fresh canvas (thumbnails, PNG/JPG). scale = px per pt.
  function renderPage(doc, page, L, scale, opts) {
    opts = opts || {};
    var s = doc.setup, b = opts.bleed ? s.bleed : 0;
    var cv = opts.canvas || document.createElement("canvas");
    cv.width = Math.max(1, Math.round((s.w + 2 * b) * scale));
    cv.height = Math.max(1, Math.round((s.h + 2 * b) * scale));
    var ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.background || "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, b * scale, b * scale);
    if (!opts.bleed) { ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip(); }
    drawPage(ctx, doc, page, L, { getImage: opts.getImage, preview: true });
    return cv;
  }

  var api = {
    corners: corners, bbox: bbox, itemBox: itemBox, toLocal: toLocal, imageRect: imageRect, effectivePpi: effectivePpi, uniform: uniform,
    computeLayout: computeLayout, computeMasterLayout: computeMasterLayout, preflight: preflight,
    drawItem: drawItem, drawPage: drawPage, pathCmds: pathCmds, gradGeom: gradGeom, drawMaster: drawMaster, renderPage: renderPage, roundRectPath: roundRectPath
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.render = api; }
})(typeof window !== "undefined" ? window : this);
