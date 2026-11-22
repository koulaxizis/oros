// ============================================================
// orOS designkit — render.js (v1.4.0)
// Lays out every story of a document (threads, master pages, page
// numbers, text wrap) and draws pages on a canvas: the editor view,
// thumbnails and image exports all go through drawPage(), and the
// PDF writer (pdf.js) reads the same layout, so screen and print
// agree.
// Needs orosDK.model + orosDK.text (Node: require); orosDK.vector for
// text on a path (LY-TP, wave V3: a text frame with ext.tp = { d, o,
// s } holds one line of its story laid along the outline d, unit path
// text in the frame's box; without vector.js it stays a plain frame).
// Picture colour corrections (it.ext.adj, W4b) need photolab/adjust.js.
// Exposes orosDK.render (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M, T, VEC = null;
  if (typeof module !== "undefined" && module.exports) { M = require("./model.js"); T = require("./text.js"); VEC = require("./vector.js"); }
  else { M = root.orosDK.model; T = root.orosDK.text; }
  function vec() { return VEC || (root.orosDK && root.orosDK.vector) || null; }

  // ---------- 1. Geometry ----------
  function rad(d) { return d * Math.PI / 180; }
  // The document's baseline grid (LY-W5b, setup.ext.bg { s: first line
  // from the page top, i: every, in pt}) as seen from a frame's top:
  // { o, inc }; none for a turned frame.
  function gridOf(doc, it) {
    var g = doc && doc.setup && doc.setup.ext && doc.setup.ext.bg;
    if (!g || !(g.i >= 1 && g.i <= 200) || !(g.s >= 0 && g.s <= 2000) || (it.rot || 0) % 360) return null;
    return { o: g.s - it.y, inc: g.i };
  }
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
  // A picture mirrored in its frame (LY-PRO W4, it.ext.fl "h" | "v" |
  // "hv"): → { h, v } (booleans).
  function flipOf(it) {
    var f = it && it.ext && typeof it.ext.fl === "string" ? it.ext.fl : "";
    return { h: f.indexOf("h") >= 0, v: f.indexOf("v") >= 0 };
  }
  // Colour corrections of a picture (LY-PRO W4b, it.ext.adj), kept
  // apart from the file so they can always be changed or taken off:
  // { levels: { ib, iw, g, ob, ow }, curves: { s, m, h }, bc: { b, c },
  // balance: { r, g, b }, hsl: { h, s, l }, gray: 1 }, applied in that
  // order by photolab/adjust.js (window.PhotoLab.adjust; without it a
  // picture shows as it is). → the cleaned record, or null when it
  // changes nothing.
  var ADJ = {
    levels: { ib: [0, 254, 0], iw: [1, 255, 255], g: [0.1, 9.99, 1], ob: [0, 255, 0], ow: [0, 255, 255] },
    curves: { s: [0, 255, 64], m: [0, 255, 128], h: [0, 255, 192] },
    bc: { b: [-150, 150, 0], c: [-100, 100, 0] },
    balance: { r: [-100, 100, 0], g: [-100, 100, 0], b: [-100, 100, 0] },
    hsl: { h: [-180, 180, 0], s: [-100, 100, 0], l: [-100, 100, 0] }
  };
  var ADJ_ORDER = ["levels", "curves", "bc", "balance", "hsl", "gray"];
  function adjNorm(a) {
    if (!a || typeof a !== "object") return null;
    var out = {}, any = false;
    ADJ_ORDER.forEach(function (id) {
      if (id === "gray") { if (a.gray) { out.gray = 1; any = true; } return; }
      var src = a[id], spec = ADJ[id];
      if (!src || typeof src !== "object") return;
      var o = {}, same = true;
      Object.keys(spec).forEach(function (k) {
        var r = spec[k], v = Number(src[k]);
        v = isFinite(v) ? Math.min(r[1], Math.max(r[0], Math.round(v * 100) / 100)) : r[2];
        o[k] = v;
        if (v !== r[2]) same = false;
      });
      if (id === "levels" && o.iw <= o.ib) o.iw = Math.min(255, o.ib + 1);
      if (!same) { out[id] = o; any = true; }
    });
    return any ? out : null;
  }
  function adjOf(it) { return it && it.t === "img" && it.ext ? adjNorm(it.ext.adj) : null; }
  // A short text that changes when the corrections do (cache keys,
  // PDF image names).
  function adjKey(a) {
    if (!a) return "";
    return ADJ_ORDER.filter(function (id) { return a[id]; }).map(function (id) {
      return id === "gray" ? "g" : id.charAt(0) + Object.keys(ADJ[id]).map(function (k) { return a[id][k]; }).join("_");
    }).join("-");
  }
  function adjLib() {
    if (typeof module !== "undefined" && module.exports) { try { return require("../photolab/adjust.js"); } catch (e) { return null; } }
    return root.PhotoLab && root.PhotoLab.adjust || null;
  }
  // Corrections on pixels { w, h, data RGBA } in place → true if done.
  function applyAdj(img, a) {
    var lib = adjLib();
    if (!a || !lib) return false;
    ADJ_ORDER.forEach(function (id) { if (a[id]) lib.run(img, id, a[id]); });
    return true;
  }
  // The picture with its corrections, for the screen: one canvas per
  // picture and set of corrections, at most 2400 px on its long side.
  var adjCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function adjustedImage(img, a) {
    if (!a || !adjCache || typeof document === "undefined" || !adjLib()) return img;
    var key = adjKey(a), per = adjCache.get(img);
    if (!per) { per = {}; adjCache.set(img, per); }
    if (per[key]) return per[key];
    var w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!(w0 > 0 && h0 > 0)) return img;
    var k = Math.min(1, 2400 / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    try {
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      var id = cx.getImageData(0, 0, w, h);
      applyAdj({ w: w, h: h, data: id.data }, a);
      cx.putImageData(id, 0, 0);
      // only the last few sets per picture stay (sliders make many)
      var keys = Object.keys(per);
      if (keys.length >= 4) delete per[keys[0]];
      per[key] = cv;
      return cv;
    } catch (e) { return img; }
  }
  // Text wrap by the outline (LY-PRO W4b, it.ext.wc on a frame whose
  // wrap is not "none"; older versions see the frame's own wrap):
  // "shape" = the frame's outline (a path's curve, an ellipse, a
  // rotated box), "alpha" = the picture's opaque pixels, from the
  // profile in it.ext.wpr (alphaProfile) of the picture it.ext.wpa
  // (another picture placed since: by the box until it is read again).
  // → polygons in page points,
  // or null (wrap by the box as before).
  function rotPts(it, pts) {
    var a = rad(it.rot || 0);
    if (!a) return pts;
    var cx = it.x + it.w / 2, cy = it.y + it.h / 2, c = Math.cos(a), s = Math.sin(a);
    return pts.map(function (p) { var dx = p[0] - cx, dy = p[1] - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; });
  }
  function flatPath(it) {
    var polys = [], cur = null, last = [0, 0];
    pathCmds(it).forEach(function (c) {
      if (c[0] === "M") { cur = [[c[1], c[2]]]; polys.push(cur); last = [c[1], c[2]]; }
      else if (c[0] === "L") { if (!cur) { cur = [last.slice()]; polys.push(cur); } cur.push([c[1], c[2]]); last = [c[1], c[2]]; }
      else if (c[0] === "C") {
        if (!cur) { cur = [last.slice()]; polys.push(cur); }
        for (var k = 1; k <= 8; k++) {
          var t = k / 8, u = 1 - t;
          cur.push([u * u * u * last[0] + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
            u * u * u * last[1] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
        }
        last = [c[5], c[6]];
      } else cur = null;
    });
    return polys.filter(function (p) { return p.length > 1; });
  }
  function wrapShape(it) {
    var wc = it.ext && it.ext.wc;
    if (!wc || it.wrap === "none") return null;
    var polys = null;
    if (wc === "shape") {
      if (it.t === "path") polys = flatPath(it);
      else if (it.t === "ell") {
        var e = [];
        for (var i = 0; i < 48; i++) { var a = i / 48 * Math.PI * 2; e.push([it.x + it.w / 2 + Math.cos(a) * it.w / 2, it.y + it.h / 2 + Math.sin(a) * it.h / 2]); }
        polys = [e];
      } else if (it.t !== "line") polys = [[[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]]];
    } else if (wc === "alpha" && it.t === "img" && Array.isArray(it.ext.wpr) && it.ext.wpr.length && it.ext.wpa === it.a) {
      var r = imageRect(it), fl = flipOf(it), n = it.ext.wpr.length;
      polys = [];
      it.ext.wpr.forEach(function (row, i) {
        if (!Array.isArray(row) || row.length < 2) return;
        var a0 = row[0] / 1000, a1 = row[1] / 1000, b0 = i / n, b1 = (i + 1) / n;
        if (fl.h) { var t0 = 1 - a1; a1 = 1 - a0; a0 = t0; }
        if (fl.v) { var t1 = 1 - b1; b1 = 1 - b0; b0 = t1; }
        // the picture's part inside its frame only
        var x0 = Math.max(it.x, it.x + r.x + a0 * r.w), x1 = Math.min(it.x + it.w, it.x + r.x + a1 * r.w);
        var y0 = Math.max(it.y, it.y + r.y + b0 * r.h), y1 = Math.min(it.y + it.h, it.y + r.y + b1 * r.h);
        if (x1 > x0 && y1 > y0) polys.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      });
    }
    if (!polys || !polys.length) return null;
    return polys.map(function (p) { return rotPts(it, p); });
  }
  // The opaque part of a picture's pixels { w, h, data RGBA } for an
  // "alpha" wrap: n bands from the top, each [x0, x1] in thousandths
  // of the width (0 = nothing opaque in that band). → array, or null
  // when every pixel is opaque (a box wrap does the same).
  function alphaProfile(img, n, thr) {
    n = Math.max(1, Math.min(200, n || 96)); thr = thr === undefined ? 24 : thr;
    var w = img.w, h = img.h, d = img.data, out = [], clear = false;
    for (var i = 0; i < n; i++) {
      var r0 = Math.floor(i * h / n), r1 = Math.max(r0 + 1, Math.floor((i + 1) * h / n)), lo = w, hi = -1;
      for (var y = r0; y < r1 && y < h; y++) {
        for (var x = 0; x < lo; x++) if (d[(y * w + x) * 4 + 3] > thr) { lo = x; break; }
        for (x = w - 1; x > hi && x >= lo; x--) if (d[(y * w + x) * 4 + 3] > thr) { hi = x; break; }
      }
      if (hi < lo) { out.push(0); clear = true; continue; }
      var a = Math.floor(lo * 1000 / w), b = Math.ceil((hi + 1) * 1000 / w);
      if (a > 0 || b < 1000) clear = true;
      out.push([a, b]);
    }
    return clear ? out : null;
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

  // ---------- 1b. Text on a path (LY-TP, wave V3) ----------
  // A text frame's path: { wk (vector.walker of the outline in the
  // frame's box), o (shift along it, % of its length), s (-1 = the
  // other side) } or null.
  function pathOf(it) {
    var v = it && it.t === "text" && it.ext && it.ext.tp, V = vec();
    if (!V || !v || typeof v !== "object") return null;
    var d = Array.isArray(v.d) ? v.d.join("") : v.d;
    if (typeof d !== "string" || !d) return null;
    var w = Math.max(0.01, it.w), h = Math.max(0.01, it.h);
    var cmds = M.parsePath(d).map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) o.push(c[i] * w, c[i + 1] * h);
      return o;
    });
    var wk = cmds.length ? V.walker(cmds) : null;
    if (!wk) return null;
    var o = typeof v.o === "number" && isFinite(v.o) ? Math.max(0, Math.min(100, v.o)) : 0;
    return { wk: wk, o: o, s: v.s === -1 ? -1 : 1 };
  }
  // The laid-out line of a path frame bent onto its outline: each
  // run gets g = [{ ch, w, x, y, rot }] (glyph baseline centres in the
  // frame's box); glyphs past the ends of an open outline are left out.
  function bend(lines, tp) {
    var wk = tp.wk, L = wk.len, flip = tp.s === -1;
    (lines || []).forEach(function (ln) {
      // open outline: the paragraph's alignment along it, moved by o;
      // closed: the line centred on the point o
      var shift = tp.o / 100 * L;
      if (wk.closed) {
        var a = Infinity, b = -Infinity;
        ln.runs.forEach(function (r) { if (r.t) { a = Math.min(a, r.x); b = Math.max(b, r.x + r.w); } });
        if (a < b) shift -= (a + b) / 2;
      }
      ln.runs.forEach(function (r) {
        if (!r.t) return;
        var g = [], x = r.x, prev = "";
        for (var i = 0; i < r.t.length; i++) {
          var ch = r.t[i];
          if (r.kern && prev) x += T.kernPair(r.key, prev, ch, r.size);
          var w = T.measure(r.key, ch, r.size, r.track || 0), d = x + w / 2 + shift;
          x += w; prev = ch;
          if (wk.closed) d = ((d % L) + L) % L;
          else if (d < -1e-6 || d > L + 1e-6) continue;
          if (!ch.trim()) continue;
          var q = wk.at(flip ? L - d : d);
          g.push({ ch: ch, w: w, x: q[0], y: q[1], rot: flip ? q[2] + Math.PI : q[2] });
        }
        r.g = g;
      });
    });
  }
  function bendAll(frames, res) {
    frames.forEach(function (f) {
      var tp = pathOf(f);
      if (tp && res.frames[f.id]) bend(res.frames[f.id].lines, tp);
    });
  }

  // ---------- 2. Layout of a whole document ----------
  // Result:
  //   { frames: { itemId: { lines } }          page frames
  //     master: { pageId: { itemId: { lines } } }  master frames
  //     overset: { storyId: true }, pageOf: { pageId: index } }
  function masterIds0(doc) {
    var m = {};
    doc.masters.forEach(function (x) { m[x.id] = 1; });
    return m;
  }
  function computeLayout(doc) {
    var pages = M.pagesInOrder(doc), idx = {}, info = {}, first = M.firstNumber(doc);
    var labels = M.pageLabels ? M.pageLabels(doc) : null;   // sections (LY-PRO W3)
    pages.forEach(function (p, i) { idx[p.id] = i; info[p.id] = { side: M.sideOf(doc, i), label: labels ? labels[i].label : String(i + first), no: labels ? labels[i].no : i + first }; });
    // anchored objects (LY-PRO W4b, it.ext.anc = the story they sit
    // in, as a U+FFFC run with ext.obj = their id): set in the text
    // like a word as wide and tall as they are, and moved to where
    // their place in the text falls (derived: every device does the
    // same, so the move is not a change of its own); they never wrap
    var objs = {}, anchored = {}, mIds = masterIds0(doc);
    doc.items.forEach(function (it) {
      var a = it.ext && it.ext.anc;
      if (typeof a !== "string" || it.t === "text" || mIds[it.pg]) return;
      objs[it.id] = { w: Math.max(0, it.w), h: Math.max(0, it.h) };
      anchored[it.id] = it;
    });
    var styles = { ps: doc.pstyles, cs: doc.cstyles, obj: objs };
    var masterIds = {};
    doc.masters.forEach(function (m) { masterIds[m.id] = 1; });
    var out = { frames: {}, master: {}, overset: {}, placed: {}, pageOf: idx, labels: labels };

    // wrap objects per owner (page or master)
    var wrapsBy = {};
    doc.items.forEach(function (it) {
      if (it.wrap === "none" || it.hide || anchored[it.id]) return;
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
          // by the outline or the picture's opaque part (W4b)
          var polys = wrapShape(w);
          if (polys) {
            polys = polys.map(function (pl) { return pl.map(function (p) { return toLocal(frame, p[0], p[1]); }); });
            var pb = bbox([].concat.apply([], polys));
            ex.push({ x: pb.x - o, y: pb.y - o, w: pb.w + 2 * o, h: pb.h + 2 * o, shape: "poly", polys: polys, o: o });
            return;
          }
          ex.push({ x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o, shape: w.wrap === "ell" && !w.rot ? "ell" : "box" });
        });
      });
      return ex;
    }

    var placedA = {};
    function placeAnchored(frames, res, sid) {
      frames.forEach(function (f) {
        var fr = res.frames[f.id];
        if (!fr || pathOf(f)) return;
        fr.lines.forEach(function (ln) {
          ln.runs.forEach(function (r) {
            var it = r.obj && anchored[r.obj];
            if (!it || it.ext.anc !== sid || placedA[it.id]) return;
            placedA[it.id] = 1;
            // its bottom on the baseline, turned with the frame
            var c = rotPts(f, [[f.x + r.x + it.w / 2, f.y + r.y - it.h / 2]])[0];
            it.pg = f.pg;
            if (f.side !== undefined) it.side = f.side;
            it.x = c[0] - it.w / 2; it.y = c[1] - it.h / 2;
          });
        });
      });
    }

    function geom(it, ctx, ex) {
      var tp = pathOf(it);
      if (tp) return { id: it.id, w: tp.wk.len, h: it.h, cols: 1, gut: 0, inset: 0, valign: "t", excl: [], ctx: ctx, story: it.story, one: true };
      return { id: it.id, w: it.w, h: it.h, cols: it.cols, gut: it.gut, inset: it.ins, valign: it.va, excl: ex, ctx: ctx, story: it.story, sfit: !!(it.ext && it.ext.sfit), vj: !!(it.ext && it.ext.vj), bgrid: gridOf(doc, it) };
    }

    // page stories
    var stories = {};
    doc.items.forEach(function (it) {
      if (it.t !== "text" || masterIds[it.pg]) return;
      if (idx[it.pg] === undefined) return;
      (stories[it.story] = stories[it.story] || []).push(it);
    });
    // stories in reading order (the page of their first frame, then
    // top to bottom): note numbers run through the document in it
    var sids = Object.keys(stories).map(function (sid) {
      stories[sid].sort(function (a, b) { return a.seq - b.seq || M.cmpStr(a.id, b.id); });
      return sid;
    }).sort(function (a, b) {
      var fa = stories[a][0], fb = stories[b][0];
      return idx[fa.pg] - idx[fb.pg] || fa.y - fb.y || fa.x - fb.x || M.cmpStr(a, b);
    });
    // notes (LY-W7): setup.ext.fn { kind "foot" | "end", ps, r "story"
    // (numbers start again in each story) }
    var fx = doc.setup && doc.setup.ext && doc.setup.ext.fn;
    var nCfg = fx && typeof fx === "object" ? fx : {};
    function layoutPages(xr) {
      placedA = {};
      var n = 1;
      sids.forEach(function (sid) {
        var st = M.story(doc, sid);
        var frames = stories[sid];
        var g = frames.map(function (f) {
          var pi = info[f.pg], pg = M.find(doc.pages, f.pg);
          var owners = [f.pg];
          if (pg && pg.ms) owners.push(pg.ms);
          return geom(f, { pageLabel: pi.label, pageCount: pages.length, pg: f.pg, no: pi.no }, exclFor(f, owners, pi.side, f.pg));
        });
        var sty = { ps: styles.ps, cs: styles.cs, obj: styles.obj, xr: xr, notes: { kind: nCfg.kind, ps: nCfg.ps, start: nCfg.r === "story" ? 1 : n } };
        var nn = st ? T.notesOf(st, sty) : null;
        if (nn) n += nn.order.length;
        var res = T.layoutChain(st || { paras: [] }, g, sty);
        bendAll(frames, res);
        placeAnchored(frames, res, sid);
        Object.keys(res.frames).forEach(function (fid) { out.frames[fid] = res.frames[fid]; });
        if (res.overset) out.overset[sid] = true;
        else delete out.overset[sid];
        out.placed[sid] = res.placedParas;   // paragraphs that fit whole (the Story Editor marks the rest, LY-N3)
      });
    }
    // cross-references (LY-W7): a run with ext.xr { to: an anchor, k:
    // "p" page | "t" text | "tp" both } shows where a paragraph with
    // ext.aid = that anchor fell; a second pass sets them once the
    // pages are known (a reference that moves the anchor again is
    // left at the second pass)
    var hasXr = doc.stories.some(function (st) {
      return (st.paras || []).some(function (p) { return (p.runs || []).some(function (r) { return r.ext && r.ext.xr; }); });
    });
    layoutPages(null);
    if (hasXr) {
      out.xr = anchorsOf(doc, sids, stories, out.frames, info);
      layoutPages(out.xr);
    }
    out.anchored = {};
    Object.keys(anchored).forEach(function (id) { var it = anchored[id]; if (it.ext.anc && placedA[id]) out.anchored[id] = { pg: it.pg, x: it.x, y: it.y }; });

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
        bendAll(frames, res);
        Object.keys(res.frames).forEach(function (fid) { res0[fid] = res.frames[fid]; });
        if (res.overset) out.overset[sid] = true;
      });
      out.master[p.id] = res0;
    });
    return out;
  }

  // every anchor's place: { aid: { t: the paragraph's text, pg: the
  // label of the page it starts on } }
  function anchorsOf(doc, sids, stories, frames, info) {
    var out = {};
    sids.forEach(function (sid) {
      var st = M.story(doc, sid);
      if (!st) return;
      stories[sid].forEach(function (f) {
        ((frames[f.id] || {}).lines || []).forEach(function (ln) {
          var para = ln.p >= 0 ? st.paras[ln.p] : null, a = para && para.ext && para.ext.aid;
          if (typeof a !== "string" || out[a]) return;
          var tx = (para.runs || []).map(function (r) { return typeof r.t === "string" && !(r.ext && (r.ext.fn || r.ext.xr)) ? r.t : ""; }).join("").replace(/\s+/g, " ").trim().slice(0, 200);
          out[a] = { t: tx, pg: info[f.pg] ? info[f.pg].label : "", pid: f.pg };
        });
      });
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
  var PF_PPI = 150, PF_MIN_PT = 6, PF_HAIR = 0.25, PF_RB_PT = 12;
  // Print checks (LY-W9, setup.ext.pf): ink the most ink a colour may
  // carry (%, 300 by default), safe how far text keeps from the trim
  // (pt, 3 mm), bop 0 = black does not overprint (on by default).
  function pfOf(doc) {
    var x = (doc && doc.setup && doc.setup.ext && doc.setup.ext.pf) || {};
    var ink = Number(x.ink), safe = Number(x.safe);
    return { ink: ink >= 200 && ink <= 400 ? ink : 300, safe: safe >= 0 && safe <= 36 ? safe : 72 / 25.4 * 3, bop: x.bop !== 0 };
  }
  // a swatch's inks in % (0..100 each), or null for an RGB one with no
  // profile to convert it
  function inksOf(sw, conv) {
    if (!sw) return null;
    if (sw.mode === "cmyk") return sw.v.slice();
    if (!conv) return null;
    return conv.rgb(sw.v[0] / 255, sw.v[1] / 255, sw.v[2] / 255).map(function (v) { return v * 100; });
  }
  // overprints: marked so (ext.op), or 100 % black alone while black
  // overprints
  function overprints(doc, sw) {
    if (!sw) return false;
    if (sw.ext && sw.ext.op) return true;
    if (!pfOf(doc).bop) return false;
    return sw.mode === "cmyk" ? sw.v[0] === 0 && sw.v[1] === 0 && sw.v[2] === 0 && sw.v[3] >= 100 : sw.v[0] === 0 && sw.v[1] === 0 && sw.v[2] === 0;
  }
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
    // characters the fonts cannot draw (LY-W6): the frame says which
    var noGlyph = {};
    if (T.missingGlyphs) Object.keys(L.frames || {}).forEach(function (fid) {
      (L.frames[fid].lines || []).forEach(function (ln) {
        ln.runs.forEach(function (r) {
          if (!r.t || r.f) return;
          T.missingGlyphs(r.key, String(r.t)).forEach(function (ch) {
            var a = noGlyph[fid] = noGlyph[fid] || [];
            if (a.indexOf(ch) === -1 && a.length < 20) a.push(ch);
          });
        });
      });
    });
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
        if (noGlyph[it.id]) { add("err", "glyph", it); out[out.length - 1].chars = noGlyph[it.id].join(" "); }
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
        var psz = M.pageSize ? M.pageSize(doc, M.find(doc.pages, it.pg)) : null;
        if (psz) { W = psz.w; H = psz.h; }
        var left = !(facing && side === "R"), right = !(facing && side === "L");
        if ((left && short(b.x <= e, b.x <= -bleed + e)) || (right && short(b.x + b.w >= W - e, b.x + b.w >= W + bleed - e)) ||
            short(b.y <= e, b.y <= -bleed + e) || short(b.y + b.h >= H - e, b.y + b.h >= H + bleed - e)) add("warn", "bleed", it);
      }
    });
    printChecks(doc, L, opts, order, add, out);
    out.sort(function (a, b) {
      return (order[a.pg] - order[b.pg]) || (a.sev === b.sev ? 0 : a.sev === "err" ? -1 : 1) || M.cmpStr(a.code + a.id, b.code + b.id);
    });
    return out;
  }

  // LY-W9: too much ink, small text in rich black, hairlines, text
  // near the trim, white that overprints
  function printChecks(doc, L, opts, order, add, out) {
    var pf = pfOf(doc), conv = opts.conv || null, memo = {};
    function sw(id) { return id ? M.find(doc.swatches, id) : null; }
    function inks(id) {
      if (!(id in memo)) memo[id] = inksOf(sw(id), conv);
      return memo[id];
    }
    function total(v) { return v ? v[0] + v[1] + v[2] + v[3] : 0; }
    function white(s) { return s && (s.mode === "cmyk" ? total(s.v) < 0.5 : s.v[0] === 255 && s.v[1] === 255 && s.v[2] === 255); }
    function colour(it, id) {
      if (!id) return;
      var v = inks(id), tot = total(v);
      if (tot > pf.ink + 0.5) { add("warn", "ink", it); var x = out[out.length - 1]; if (x.id === it.id && x.code === "ink" && !x.n) { x.n = Math.round(tot); x.m = pf.ink; } }
      var s = sw(id);
      if (s && s.ext && s.ext.op && white(s)) add("err", "opWhite", it);
    }
    function frameLines(id) { var f = (L.frames || {})[id]; return f && f.lines || []; }
    doc.items.forEach(function (it) {
      if (it.hide || order[it.pg] === undefined) return;
      if (it.t !== "line") colour(it, it.fill);
      if (it.gr && it.gr.st) it.gr.st.forEach(function (st) { colour(it, st[1]); });
      if (it.stroke && it.sw > 0) {
        colour(it, it.stroke);
        if (it.sw < PF_HAIR - 1e-9) add("warn", "hair", it);
      }
      if (it.t !== "text") return;
      var lines = frameLines(it.id), ex = null;
      lines.forEach(function (ln) {
        (ln.runs || []).forEach(function (r) {
          if (!r.t || !String(r.t).trim()) return;
          colour(it, r.color);
          var v = r.color ? inks(r.color) : null, s = sw(r.color);
          // several inks under small text: CMYK swatches only (an RGB
          // black becomes black ink alone)
          if (v && s && s.mode === "cmyk" && v[3] >= 80 && v[0] + v[1] + v[2] >= 10 && r.size < PF_RB_PT) add("warn", "richBlack", it);
          var x0 = r.x, x1 = r.x + (r.w || 0), y0 = r.y - r.size * 0.8, y1 = r.y + r.size * 0.25;
          if (!ex) ex = [x0, y0, x1, y1];
          else { ex[0] = Math.min(ex[0], x0); ex[1] = Math.min(ex[1], y0); ex[2] = Math.max(ex[2], x1); ex[3] = Math.max(ex[3], y1); }
        });
      });
      // the text itself (not the frame) near or past the trim, on pages
      if (!ex || it.rot || order[it.pg] >= 100000 || pathOf(it)) return;
      var pg = M.find(doc.pages, it.pg), psz = M.pageSize ? M.pageSize(doc, pg) : doc.setup, e = 0.01;
      var bx0 = it.x + ex[0], by0 = it.y + ex[1], bx1 = it.x + ex[2], by1 = it.y + ex[3];
      if (bx0 < pf.safe - e || by0 < pf.safe - e || bx1 > psz.w - pf.safe + e || by1 > psz.h - pf.safe + e) {
        add("warn", "safe", it);
        var y = out[out.length - 1];
        if (y.id === it.id && y.code === "safe") y.n = Math.round(pf.safe * 25.4 / 72 * 10) / 10;
      }
    });
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
        var c = { pageLabel: master.pre, pageCount: master.pre + "#" }, tp = pathOf(f);
        if (tp) return { id: f.id, w: tp.wk.len, h: f.h, cols: 1, gut: 0, inset: 0, valign: "t", excl: [], ctx: c, one: true };
        return { id: f.id, w: f.w, h: f.h, cols: f.cols, gut: f.gut, inset: f.ins, valign: f.va, excl: [], ctx: c, sfit: !!(f.ext && f.ext.sfit), vj: !!(f.ext && f.ext.vj), bgrid: gridOf(doc, f) };
      });
      var res = T.layoutChain(M.story(doc, sid) || { paras: [] }, g, styles);
      bendAll(frames, res);
      Object.keys(res.frames).forEach(function (fid) { out.frames[fid] = res.frames[fid]; });
      if (res.overset) out.overset[sid] = true;
    });
    return out;
  }

  // ---------- 3. Drawing ----------
  // A print view (LY-W9, layout/proof.js) may stand between the
  // swatches and the screen: view.color(c {rgb, cmyk}, swatch) → [r,
  // g, b] (soft proof, one ink plate, total ink), view.image(img) →
  // drawable, view.op(swatch) true → it overprints (drawn multiplied).
  var view = null;
  function setView(v) { view = v && typeof v.color === "function" ? v : null; }
  function rgba(doc, id, op) {
    var c = M.swatchColor(doc, id);
    if (!c) return null;
    var rgb = view ? view.color(c, M.find(doc.swatches, id)) : c.rgb;
    return "rgba(" + rgb.join(",") + "," + (op === undefined ? 1 : op) + ")";
  }
  // the overprint of a swatch, in a print view only
  function opMode(ctx, doc, id) {
    ctx.globalCompositeOperation = view && view.op && id && view.op(M.find(doc.swatches, id)) ? "multiply" : "source-over";
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

  // a table row's cell fills and rules (LY-W12); a rule without a
  // swatch is black
  function drawTb(ctx, doc, tb) {
    tb.fills.forEach(function (f) {
      var c = rgba(doc, f[4]);
      if (!c) return;
      ctx.fillStyle = c;
      if (view) opMode(ctx, doc, f[4]);
      ctx.fillRect(f[0], f[1], f[2], f[3]);
    });
    if (view) ctx.globalCompositeOperation = "source-over";
    tb.rules.forEach(function (r) {
      ctx.strokeStyle = (r[4] && rgba(doc, r[4])) || "#000";
      if (view) opMode(ctx, doc, r[4] || "sw-black");
      ctx.lineWidth = r[5];
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.lineTo(r[2], r[3]); ctx.stroke();
    });
  }
  function drawLines(ctx, doc, lines) {
    if (!lines) return;
    ctx.textBaseline = "alphabetic";
    try { ctx.fontKerning = "none"; } catch (e) {}
    lines.forEach(function (ln) {
      if (ln.tb) { ctx.save(); drawTb(ctx, doc, ln.tb); ctx.restore(); }
      ln.runs.forEach(function (r) {
        if (!r.t) return;
        ctx.font = r.size + "px " + T.cssStack(r.key);
        ctx.fillStyle = rgba(doc, r.color) || "#000";
        if (view) opMode(ctx, doc, r.color);
        if (r.g) {                                  // on a path (LY-TP)
          r.g.forEach(function (gl) {
            ctx.save();
            ctx.translate(gl.x, gl.y); ctx.rotate(gl.rot);
            ctx.fillText(gl.ch, -gl.w / 2, 0);
            ctx.restore();
          });
          return;
        }
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
        if (view) opMode(ctx, doc, it.stroke);
        ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.x + it.w, it.y + it.h); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    outline(ctx, it);
    var paint = it.gr ? gradient(ctx, doc, it) : it.fill ? rgba(doc, it.fill) : null;
    if (paint) { if (view && !it.gr) opMode(ctx, doc, it.fill); ctx.fillStyle = paint; ctx.fill(it.eo ? "evenodd" : "nonzero"); if (view) ctx.globalCompositeOperation = "source-over"; }
    if (it.t === "img") drawImageItem(ctx, doc, it, opts);
    if (it.t === "text") {
      ctx.save();
      ctx.translate(it.x, it.y);
      drawLines(ctx, doc, opts.lines ? opts.lines(it.id) : null);
      ctx.restore();
    }
    if (strokeStyle(ctx, doc, it)) {
      outline(ctx, it);
      if (view) opMode(ctx, doc, it.stroke);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawImageItem(ctx, doc, it, opts) {
    var img = it.a && opts.getImage ? opts.getImage(it.a) : null;
    if (img) img = adjustedImage(img, adjOf(it));
    if (img && view && view.image) img = view.image(img) || img;
    if (img) {
      ctx.save();
      roundRectPath(ctx, it.x, it.y, it.w, it.h, it.r);
      ctx.clip();
      var r = imageRect(it), fl = flipOf(it);
      if (fl.h || fl.v) {
        // mirrored about the picture's own centre
        ctx.translate(it.x + r.x + r.w / 2, it.y + r.y + r.h / 2);
        ctx.scale(fl.h ? -1 : 1, fl.v ? -1 : 1);
        ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
      } else ctx.drawImage(img, it.x + r.x, it.y + r.y, r.w, r.h);
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
    // opts.skipText(item) true: the frame is drawn without its text
    // (a fixed-layout EPUB puts that text over the picture as text)
    var skip = typeof opts.skipText === "function" ? opts.skipText : null;
    M.itemsOn(doc, page.id).forEach(function (it) {
      var bare = skip && it.t === "text" && skip(it);
      drawItem(ctx, doc, it, { lines: function (id) { var f = !bare && L.frames[id]; return f && f.lines; }, getImage: opts.getImage, preview: opts.preview, missing: opts.missing });
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
    var s = M.pageSize ? M.pageSize(doc, page) : doc.setup, b = opts.bleed ? doc.setup.bleed : 0;
    var cv = opts.canvas || document.createElement("canvas");
    cv.width = Math.max(1, Math.round((s.w + 2 * b) * scale));
    cv.height = Math.max(1, Math.round((s.h + 2 * b) * scale));
    var ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.background || "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, b * scale, b * scale);
    if (!opts.bleed) { ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip(); }
    drawPage(ctx, doc, page, L, { getImage: opts.getImage, preview: true, skipText: opts.skipText });
    return cv;
  }

  var api = {
    corners: corners, bbox: bbox, itemBox: itemBox, toLocal: toLocal, imageRect: imageRect, flipOf: flipOf, wrapShape: wrapShape, alphaProfile: alphaProfile, adjNorm: adjNorm, adjOf: adjOf, adjKey: adjKey, applyAdj: applyAdj, ADJ_ORDER: ADJ_ORDER, effectivePpi: effectivePpi, uniform: uniform,
    gridOf: gridOf, pathOf: pathOf, computeLayout: computeLayout, computeMasterLayout: computeMasterLayout, preflight: preflight, setView: setView, pfOf: pfOf, inksOf: inksOf, overprints: overprints,
    drawItem: drawItem, drawPage: drawPage, pathCmds: pathCmds, gradGeom: gradGeom, drawMaster: drawMaster, renderPage: renderPage, roundRectPath: roundRectPath
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.render = api; }
})(typeof window !== "undefined" ? window : this);
