// ============================================================
// orOS Atelier — design model on top of designkit (v1.0.0)
// An Atelier design IS a designkit document (designkit/model.js:
// pages, items, per-entity merge, tombstones). What Canva-style
// design needs beyond DTP lives on each item as `ax`, kept through
// storage, merge and imports by M.setItemExt(normAx):
//   ax.k   "text" | "shape" | "icon" | "photo" | "line"
//          (base item t: text/shape/icon → "rect", photo → "img",
//          line → "line"; a mismatch drops the item's extras)
//   bg     1 = the page background (one per page, bottom, full page)
//   fc/sc  fill / stroke colour "#rrggbb" ("" = none)
//   g      gradient fill { a, b, ang } (shapes + backgrounds)
//   shp    shape id (fx.SHAPES): the shape of a shape, the mask of a
//          photo; rd = roundness 0..100 (rounded / bubble; default 30)
//   ico    icon id (library/icons.js), drawn with sc
//   text:  tx, font (sans|serif|mono|fs_<fontsource id>), size (pt), b, i, u, caps, al l|c|r|j,
//          lh (line height %), tr (tracking 1/1000 em),
//          tfx (fx.normTextFx, omitted when "none"), cv (curve)
//   photo: adj (fx.normAdjust, omitted at identity), flt (preset id),
//          flh / flv (flips); crop = designkit's custom fit
//          (ix, iy, isc on the item)
//   line:  as / ae arrow heads ("" | "arrow" | "dot")
//   an     entrance animation fade|rise|pop|wipe|type (type: text)
//   dur/ptr the page background only: seconds the page shows (1..60,
//          default 5) and the transition to it (none|fade|slide|push|
//          zoom, default fade); see anim.js
//   vid    a photo that is a video element: vid (clip id), vs / ve
//          (trim), mu, vol, nl; see clips.js
//   au/av/ao the page background only: the page's sound (clip id),
//          its volume and where in it the page starts; see clips.js
//   cr     credit of a piece from an open source (media.normCredit)
// Defaults are omitted, keys come in one fixed order: the record is
// canonical (R26), so equal designs give equal JSON on every device.
// Pure: no DOM. Exposes window.AtelierAX (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, T, FX, MEDIA, CL;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js");
    FX = require("../designkit/fx.js"); MEDIA = require("../designkit/media.js");
    CL = require("./clips.js");
  } else {
    M = root.orosDK.model; T = root.orosDK.text; FX = root.orosDK.fx; MEDIA = root.orosDK.media;
    CL = root.AtelierClips;
  }

  var KINDS = ["text", "shape", "icon", "photo", "line"];
  var BASE = { text: "rect", shape: "rect", icon: "rect", photo: "img", line: "line" };
  var SHAPE_IDS = FX.SHAPES.map(function (s) { return s.id; });
  var FILTER_IDS = FX.FILTERS.map(function (f) { return f.id; });
  var ALIGNS = ["l", "c", "r", "j"];
  var HEADS = ["", "arrow", "dot"];
  var ANIMS = ["fade", "rise", "pop", "wipe", "type"];             // anim.js
  var TRANSITIONS = ["none", "fade", "slide", "push", "zoom"];
  var DUR_DEF = 5, PTR_DEF = "fade";
  var MAX_TX = 5000;
  var TEXT_DEF = { font: "sans", size: 48, lh: 120, al: "l" };
  var RD_DEF = 30;                 // fx.shapePath's default roundness

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v, lo, hi, def) { return isNum(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : def; }
  function int(v, lo, hi, def) { return isNum(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def; }
  function bit(v) { return v === 1 || v === true ? 1 : 0; }
  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }

  // Fonts: designkit's own families (sans, serif, mono) or a
  // Fontsource family as "fs_<id with _ for ->" (fetched on demand,
  // cached per device; unknown or offline falls back to sans).
  var FS_FONT = /^fs_[a-z0-9]+(_[a-z0-9]+)*$/;
  function isExtraFont(id) { return typeof id === "string" && id.length <= 63 && FS_FONT.test(id); }
  function fontId(v) { return isExtraFont(v) ? v : oneOf(v, T.FAMILY_IDS, TEXT_DEF.font); }
  function fsSlug(id) { return id.slice(3).replace(/_/g, "-"); }
  function fsIdOf(slug) { return "fs_" + String(slug).replace(/-/g, "_"); }
  function fsName(id) { return fsSlug(id).split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" "); }
  function ensureFont(id, name) {
    if (!isExtraFont(id) || (T.FAMILIES[id] && T.FAMILIES[id].urls)) return;
    var urls = MEDIA && MEDIA.fontsourceUrls ? MEDIA.fontsourceUrls(fsSlug(id)) : null;
    if (urls) T.registerFamily(id, { name: name || fsName(id), urls: urls, fallback: "sans" });
  }
  function fontName(id) { ensureFont(id); var f = T.FAMILIES[id]; return f ? f.name : fsName(id); }
  function col(v) { return FX.normColor(v); }
  function text(v) {
    return typeof v === "string"
      ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, MAX_TX)
      : "";
  }

  // ---------- 1. Normalizer (registered with designkit/model.js) ----------
  function normAx(a, it) {
    if (!a || typeof a !== "object") return null;
    var k = oneOf(a.k, KINDS, "");
    if (!k || !it || BASE[k] !== it.t) return null;
    var o = { k: k };
    if ((k === "shape" || k === "photo") && bit(a.bg)) o.bg = 1;
    var fc = col(a.fc), sc = col(a.sc);
    if (k !== "photo" && k !== "line" && fc) o.fc = fc;
    if ((k === "shape" || k === "icon" || k === "line") && sc) o.sc = sc;
    if (k === "shape" && a.g && typeof a.g === "object") {
      var ga = col(a.g.a), gb = col(a.g.b);
      if (ga && gb) o.g = { a: ga, b: gb, ang: int(a.g.ang, -360, 360, 90) };
    }
    if (k === "shape" || k === "photo") {
      var shp = oneOf(a.shp, SHAPE_IDS, "");
      if (k === "shape" && !shp) shp = "rect";
      if (shp && !(k === "photo" && shp === "rect")) o.shp = shp;
      var rd = int(a.rd, 0, 100, RD_DEF);
      if (rd !== RD_DEF) o.rd = rd;
    }
    if (k === "icon") {
      o.ico = typeof a.ico === "string" && /^[a-z0-9-]{1,48}$/.test(a.ico) ? a.ico : "square";
    }
    if (k === "text") {
      o.tx = text(a.tx);
      o.font = fontId(a.font);
      ensureFont(o.font);
      o.size = num(a.size, 2, 2000, TEXT_DEF.size);
      if (bit(a.b)) o.b = 1;
      if (bit(a.i)) o.i = 1;
      if (bit(a.u)) o.u = 1;
      if (bit(a.caps)) o.caps = 1;
      var al = oneOf(a.al, ALIGNS, TEXT_DEF.al);
      if (al !== TEXT_DEF.al) o.al = al;
      var lh = int(a.lh, 70, 300, TEXT_DEF.lh);
      if (lh !== TEXT_DEF.lh) o.lh = lh;
      var tr = int(a.tr, -200, 1000, 0);
      if (tr) o.tr = tr;
      if (a.tfx && typeof a.tfx === "object") {
        var tfx = FX.normTextFx(a.tfx);
        if (tfx.type !== "none") o.tfx = tfx;
      }
      var cv = int(a.cv, -100, 100, 0);
      if (cv) o.cv = cv;
    }
    if (k === "photo") {
      if (a.adj && typeof a.adj === "object" && !FX.isIdentity(a.adj)) o.adj = FX.normAdjust(a.adj);
      var flt = oneOf(a.flt, FILTER_IDS, "none");
      if (flt !== "none") o.flt = flt;
      if (bit(a.flh)) o.flh = 1;
      if (bit(a.flv)) o.flv = 1;
      // a video element: the picture is its poster frame (clips.js)
      if (!o.bg && CL.isVideo(a.vid)) {
        o.vid = a.vid;
        var vs = num(a.vs, 0, CL.MAX_LEN, 0), ve = num(a.ve, 0, CL.MAX_LEN, 0);
        if (vs) o.vs = vs;
        if (ve > vs + 0.1) o.ve = ve;
        if (bit(a.mu)) o.mu = 1;
        var vol = int(a.vol, 0, 100, 100);
        if (vol !== 100) o.vol = vol;
        if (bit(a.nl)) o.nl = 1;
      }
    }
    if (k === "line") {
      var as = oneOf(a.as, HEADS, ""), ae = oneOf(a.ae, HEADS, "");
      if (as) o.as = as;
      if (ae) o.ae = ae;
    }
    // animation (video, GIF, preview): an entrance per element; the
    // page background carries the page's duration and transition
    if (o.bg) {
      var dur = int(a.dur, 1, 60, DUR_DEF);
      if (dur !== DUR_DEF) o.dur = dur;
      var ptr = oneOf(a.ptr, TRANSITIONS, PTR_DEF);
      if (ptr !== PTR_DEF) o.ptr = ptr;
      // the page's sound (clips.js)
      if (CL.isSound(a.au)) {
        o.au = a.au;
        var av = int(a.av, 0, 100, 100);
        if (av !== 100) o.av = av;
        var ao = num(a.ao, 0, CL.MAX_LEN, 0);
        if (ao) o.ao = ao;
      }
    } else {
      var an = oneOf(a.an, ANIMS, "");
      if (an && !(an === "type" && k !== "text")) o.an = an;
    }
    if (a.cr && typeof a.cr === "object" && MEDIA) {
      var cr = MEDIA.normCredit(a.cr);
      if (cr) o.cr = cr;
    }
    return o;
  }

  M.setItemExt(normAx);

  // ---------- 2. Designs ----------
  // opts: { name, w, h (points; 1 px of a screen design = 1 pt),
  //         unit "px" | "mm", bg colour, pages }
  function newDesign(opts, now) {
    opts = opts || {};
    var mm = opts.unit === "mm";
    var d = M.newDoc({
      name: opts.name, w: opts.w, h: opts.h, unit: mm ? "mm" : "pt",
      bleed: mm ? 3 * M.PT_PER.mm : 0, mt: 0, mb: 0, mi: 0, mo: 0, pages: opts.pages || 1
    }, now);
    // no masters / styles / swatches: Atelier keeps its look on items
    d.masters = []; d.pstyles = []; d.cstyles = []; d.swatches = [];
    d.pages.forEach(function (p) {
      p.ms = "";
      addBackground(d, p.id, opts.bg || "#ffffff", now);
    });
    return M.normDoc(d);
  }

  function nextZ(doc, pg) {
    var z = 0;
    doc.items.forEach(function (it) { if (it.pg === pg && it.z > z) z = it.z; });
    return z + 1;
  }

  // spec: base fields (x, y, w, h, rot, op, sw, z) + ax fields.
  // Returns the normalized item pushed into doc.items (or null).
  function addItem(doc, pg, spec, now) {
    if (doc.items.length >= M.MAX_ITEMS) return null;
    var k = spec.k;
    var it = {
      id: M.newId("it"), m: now, t: BASE[k] || "rect", pg: pg,
      x: spec.x || 0, y: spec.y || 0,
      w: spec.w === undefined ? 100 : spec.w, h: spec.h === undefined ? 100 : spec.h,
      rot: spec.rot || 0, op: spec.op === undefined ? 100 : spec.op,
      sw: spec.sw === undefined ? (k === "line" ? 4 : 0) : spec.sw,
      z: spec.z === undefined ? nextZ(doc, pg) : spec.z, lock: spec.lock ? 1 : 0
    };
    if (k === "photo") {
      it.a = spec.a || ""; it.nm = spec.nm || ""; it.iw = spec.iw || 0; it.ih = spec.ih || 0;
      it.fit = spec.fit || "fill"; it.ix = spec.ix || 0; it.iy = spec.iy || 0; it.isc = spec.isc || 1;
    }
    var ax = {};
    Object.keys(spec).forEach(function (key) {
      if (["x", "y", "w", "h", "rot", "op", "sw", "z", "lock", "a", "nm", "iw", "ih", "fit", "ix", "iy", "isc"].indexOf(key) < 0) ax[key] = spec[key];
    });
    it.ax = ax;
    var n = M.normItem(it);
    if (!n || !n.ax) return null;
    if (n.ax.k === "text") n.h = textHeight(n);
    doc.items.push(n);
    return n;
  }

  function addBackground(doc, pg, colour, now) {
    return addItem(doc, pg, { k: "shape", bg: 1, shp: "rect", fc: colour, x: 0, y: 0, w: doc.setup.w, h: doc.setup.h, z: -1e9, lock: 1 }, now);
  }
  function background(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      if (it.pg === pg && it.ax && it.ax.bg) return it;
    }
    return null;
  }

  // ---------- 3. Text ----------
  var PS_ID = "ps-ax";
  function textStyle(ax) {
    return {
      id: PS_ID, m: 1, name: "ax", font: ax.font || TEXT_DEF.font, size: ax.size || TEXT_DEF.size,
      lead: (ax.size || TEXT_DEF.size) * (ax.lh || TEXT_DEF.lh) / 100, align: ax.al || TEXT_DEF.al,
      b: ax.b ? 1 : 0, i: ax.i ? 1 : 0, u: ax.u ? 1 : 0, caps: ax.caps ? 1 : 0,
      track: ax.tr || 0, color: "", sb: 0, sa: 0, fi: 0, li: 0, ri: 0, bul: 0
    };
  }
  function storyOf(ax) {
    var src = ax.tx || "";
    return {
      id: "st-ax", paras: src.split("\n").map(function (line) {
        return { ps: PS_ID, runs: line ? [{ t: line }] : [] };
      })
    };
  }
  function fontKeyOf(ax) { ensureFont(ax.font); return T.fontKey(ax.font || TEXT_DEF.font, ax.b, ax.i); }

  // Lines of a text item (frame-local points, y = baseline), laid out
  // by designkit/text.js in a frame as wide as the box and as tall as
  // the text needs. Returns { lines, h }.
  function textLayout(it) {
    var ax = it.ax || {};
    var ps = textStyle(ax);
    var res = T.layoutChain(storyOf(ax), [{ id: "f", w: Math.max(1, it.w), h: 1e7, cols: 1, gut: 0, inset: 0, valign: "t", excl: [], ctx: {} }], { ps: [ps], cs: [] });
    var lines = res.frames.f.lines;
    var lead = ps.lead;
    var h = lines.length ? lines[lines.length - 1].y + Math.max(lines[lines.length - 1].d, lead * 0.25) : lead;
    return { lines: lines, h: Math.max(lead * 0.5, h) };
  }

  // Curved text: one line along an arc (fx.curveGlyphs). Glyphs are
  // centred on the box; returns { glyphs:[{ch, x, y, rot}], w, h, key,
  // size } with x/y relative to the box centre (y = baseline).
  function curveLayout(it) {
    var ax = it.ax || {};
    var key = fontKeyOf(ax), size = ax.size || TEXT_DEF.size;
    var s = (ax.tx || "").replace(/\n+/g, " ");
    if (ax.caps) s = s.toLocaleUpperCase();
    var chars = Array.from(s), x = 0, list = [];
    chars.forEach(function (ch) {
      var w = T.measure(key, ch, size, ax.tr || 0);
      list.push({ x: x, w: w, ch: ch });
      x += w;
    });
    var pos = FX.curveGlyphs(list, ax.cv || 0);
    var asc = T.ascent(key, size), desc = T.descent(key, size);
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pos.forEach(function (p, i) {
      var r = Math.max(list[i].w / 2, asc);
      x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r);
      y0 = Math.min(y0, p.y - asc); y1 = Math.max(y1, p.y + desc);
    });
    if (!pos.length) { x0 = -size / 2; x1 = size / 2; y0 = -asc; y1 = desc; }
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return {
      glyphs: pos.map(function (p, i) { return { ch: list[i].ch, w: list[i].w, x: p.x - cx, y: p.y - cy, rot: p.rot }; }),
      w: x1 - x0, h: y1 - y0, key: key, size: size
    };
  }

  // Height a text box needs (straight text) or its whole box (curved).
  function textHeight(it) {
    if (it.ax && it.ax.cv) return Math.max(1, Math.round(curveLayout(it).h * 100) / 100);
    return Math.max(1, Math.round(textLayout(it).h * 100) / 100);
  }

  // Natural width of a line of text (new text boxes, "fit width").
  function textWidth(ax) {
    var key = fontKeyOf(ax), size = ax.size || TEXT_DEF.size, w = 0;
    (ax.tx || "").split("\n").forEach(function (line) {
      if (ax.caps) line = line.toLocaleUpperCase();
      w = Math.max(w, T.measure(key, line, size, ax.tr || 0));
    });
    return Math.ceil(w + size * 0.1);
  }

  // ---------- 4. Templates ----------
  // A template is data (templates.js): { id, preset, w, h, unit,
  // en, el, pages: [ { bg, g, items: [spec…] } ] } where text specs
  // carry tx: { en, el }. Instantiation picks the language and makes a
  // normal, independent design (fresh ids).
  function fromTemplate(tpl, lang, now) {
    var name = lang === "el" ? tpl.el : tpl.en;
    var d = newDesign({ name: name, w: tpl.w, h: tpl.h, unit: tpl.unit, pages: (tpl.pages || []).length || 1 }, now);
    var pages = M.pagesInOrder(d);
    (tpl.pages || []).forEach(function (P, i) {
      var pg = pages[i];
      if (!pg) return;
      var bg = background(d, pg.id);
      if (bg) {
        if (P.bg) bg.ax.fc = col(P.bg) || bg.ax.fc;
        if (P.g) bg.ax.g = P.g;
      }
      (P.items || []).forEach(function (spec, zi) {
        var s = JSON.parse(JSON.stringify(spec));
        if (s.tx && typeof s.tx === "object") {
          var en = s.tx.en;
          s.tx = lang === "el" ? s.tx.el : s.tx.en;
          if (s.tx !== en) fitTranslation(s, en);
        }
        s.z = zi + 1;
        addItem(d, pg.id, s, now);
      });
    });
    return M.normDoc(d);
  }

  // A translated text keeps the layout of the original: its size
  // shrinks (down to 60%) until it takes no more lines than the
  // English text and its longest word fits the box.
  function linesOf(spec, tx, size) {
    var it = { w: spec.w, ax: normAx({ k: "text", tx: tx, font: spec.font, size: size, b: spec.b, i: spec.i, caps: spec.caps, al: spec.al, lh: spec.lh, tr: spec.tr }, { t: "rect" }) };
    return textLayout(it).lines.length;
  }
  function longestWord(spec, tx, size) {
    var ax = { font: spec.font, b: spec.b, i: spec.i, size: size, tr: spec.tr }, key = fontKeyOf(ax), w = 0;
    tx.split(/\s+/).forEach(function (word) {
      if (spec.caps) word = word.toLocaleUpperCase();
      w = Math.max(w, T.measure(key, word, size, spec.tr || 0));
    });
    return w;
  }
  function fitTranslation(spec, en) {
    if (spec.cv || !spec.w) return;
    var size0 = spec.size || TEXT_DEF.size, size = size0;
    var want = linesOf(spec, en, size0);
    for (var n = 0; n < 12; n++) {
      if (linesOf(spec, spec.tx, size) <= want && longestWord(spec, spec.tx, size) <= spec.w) break;
      size = Math.round(size * 0.96 * 100) / 100;
      if (size < size0 * 0.6) { size = size0 * 0.6; break; }
    }
    spec.size = size;
  }

  // ---------- 5. Credits ----------
  // Every piece from an open source used in a design, once.
  function credits(doc) {
    var seen = {}, out = [];
    doc.items.slice().sort(M.byZ).forEach(function (it) {
      var c = it.ax && it.ax.cr;
      if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); }
    });
    return out;
  }

  // Images a design needs (packages, uploads list).
  function assetIds(doc) {
    var ids = {};
    doc.items.forEach(function (it) { if (it.t === "img" && it.a) ids[it.a] = 1; });
    return Object.keys(ids).sort();
  }
  // video and sound files a design uses (packages, export)
  function clipIds(doc) {
    var ids = {};
    doc.items.forEach(function (it) {
      if (!it.ax) return;
      if (it.ax.vid) ids[it.ax.vid] = 1;
      if (it.ax.au) ids[it.ax.au] = 1;
    });
    return Object.keys(ids).sort();
  }

  var api = {
    KINDS: KINDS, BASE: BASE, TEXT_DEF: TEXT_DEF, RD_DEF: RD_DEF, MAX_TX: MAX_TX, HEADS: HEADS,
    normAx: normAx, newDesign: newDesign, addItem: addItem, addBackground: addBackground, background: background,
    nextZ: nextZ, textStyle: textStyle, textLayout: textLayout, curveLayout: curveLayout, textHeight: textHeight,
    textWidth: textWidth, fontKeyOf: fontKeyOf, isExtraFont: isExtraFont, ensureFont: ensureFont,
    fontName: fontName, fsIdOf: fsIdOf, fsSlug: fsSlug, fromTemplate: fromTemplate, credits: credits, assetIds: assetIds, clipIds: clipIds
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierAX = api;
})(typeof window !== "undefined" ? window : this);
