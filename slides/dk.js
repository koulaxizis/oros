// ============================================================
// orOS Slides — dk.js (slides -> designkit document, v1.0.0)
// The editor, the thumbnails, the slide show, PNG and PDF all draw
// a slide through the shared designkit engine (render.js, pdf.js),
// so screen and print agree. This file turns slides into a
// TRANSIENT designkit document: one page per slide, one story per
// text box, paragraph styles from the theme, swatches from the
// colours in use. Nothing here is stored or synced.
//
//   - 1 slide unit = 0.54 pt: a 16:9 slide is 960 x 540 pt.
//   - theme colours ("t:a1") resolve to fixed colours here, so a
//     theme change recolours every slide on the next draw.
//   - shrink to fit: a text box whose text does not fit is drawn
//     smaller (down to MIN_FIT), searched against the designkit
//     typesetter itself, so what fits on screen fits in the PDF.
//   - bullets with levels, numbered lists (the number is drawn as
//     text), slide footer (number, date, text).
//   - handout: an A4 page per slide with the slide on top and the
//     speaker notes below.
//
// Needs OrosSlidesCore (core.js) and orosDK.model + orosDK.text on
// the same global. Pure: Node tests load it in a vm context.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosSlidesCore;
  function M() { return root.orosDK.model; }
  function T() { return root.orosDK.text; }

  var PT = 0.54;            // points per slide unit
  var INS = 12;             // text inset (units)
  var MIN_FIT = 0.4;        // shrink to fit stops at 40 %
  var FOOT_FS = 18;         // footer size (units)
  var A4 = { w: 595.276, h: 841.89 };
  var TITLE_ROLES = { title: 1, quote: 1 };

  // ---------- Ids ----------
  // designkit ids are short (prefix-[a-z0-9]{1,24}); slides ids are
  // not, so the document gets its own, counted per build.
  function Ids() {
    var n = 0;
    return function (pre) { n++; return pre + "-" + n.toString(36); };
  }

  // ---------- Styles ----------
  function hexOf(c, theme) {
    var h = C.resolveColor(c, theme);
    return h && /^#[0-9a-f]{6}$/.test(h) ? h : null;
  }
  // One build's registry of swatches, paragraph and character styles.
  function Registry(theme) {
    var sw = {}, ps = {}, cs = {}, swatches = [], pstyles = [], cstyles = [];
    var ids = Ids();
    function swatch(c) {
      var h = hexOf(c, theme);
      if (!h) return "";
      var id = "sw-" + h.slice(1);
      if (!sw[id]) {
        sw[id] = 1;
        swatches.push({ id: id, m: 1, name: h, mode: "rgb",
          v: [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)] });
      }
      return id;
    }
    function pstyle(o) {
      var key = JSON.stringify(o);
      if (!ps[key]) {
        var s = { id: ids("ps"), m: 1, name: "s" };
        Object.keys(o).forEach(function (k) { s[k] = o[k]; });
        ps[key] = s.id;
        pstyles.push(s);
      }
      return ps[key];
    }
    function cstyle(c) {
      var id = swatch(c);
      if (!id) return "";
      var cid = "cs-" + id.slice(3);
      if (!cs[cid]) { cs[cid] = 1; cstyles.push({ id: cid, m: 1, name: cid, color: id }); }
      return cid;
    }
    return { swatch: swatch, pstyle: pstyle, cstyle: cstyle, swatches: swatches, pstyles: pstyles, cstyles: cstyles };
  }

  // The font family of a text item (its own, or the theme's).
  function fontOf(it, theme) {
    if (it.ff) return it.ff;
    return TITLE_ROLES[it.ph] ? theme.tf : theme.ff;
  }
  // Size of a paragraph at a level, before shrink to fit (units).
  function levelSize(fs, l) { return fs * Math.max(0.7, 1 - 0.08 * (l || 0)); }

  // A text item as a designkit story (paragraphs + runs) and the
  // styles it needs, at `scale` (points per unit x fit).
  function storyOf(it, theme, reg, scale) {
    var fam = fontOf(it, theme), color = reg.swatch(it.fc) || reg.swatch("t:fg");
    var paras = [], num = [];
    var bold = it.ph === "title" ? 1 : 0, ital = it.ph === "quote" ? 1 : 0;
    (it.paras.length ? it.paras : []).forEach(function (p) {
      var size = levelSize(it.fs, p.l) * scale;
      // numbering restarts after any other paragraph at that level
      num.length = p.l + 1;
      if (p.ls === "n") num[p.l] = (num[p.l] || 0) + 1; else num[p.l] = 0;
      var o = {
        font: fam, size: Math.round(size * 100) / 100, align: it.al, color: color,
        b: bold, i: ital, sa: Math.round(size * 0.35 * 100) / 100
      };
      if (p.ls === "b") { o.bul = 1; o.li = Math.round((p.l * 1.2 + 0.9) * size * 100) / 100; }
      else if (p.l) o.li = Math.round(p.l * 1.2 * size * 100) / 100;
      var runs = [];
      if (p.ls === "n") runs.push({ t: num[p.l] + ". " });
      p.r.forEach(function (r) {
        var x = { t: r.t };
        if (r.b) x.b = 1;
        if (r.i) x.i = 1;
        if (r.u) x.u = 1;
        if (r.c) { var cs = reg.cstyle(r.c); if (cs) x.cs = cs; }
        runs.push(x);
      });
      paras.push({ ps: reg.pstyle(o), runs: runs });
    });
    return paras;
  }

  // ---------- Shrink to fit ----------
  var fitCache = {}, fitCount = 0;
  // { k: factor 0.4..1, over: still does not fit at the floor }
  function fitOf(it, theme) {
    if (it.k !== "text" || !it.paras.length) return { k: 1, over: false };
    var key = JSON.stringify([it.paras, it.fs, it.w, it.h, it.al, fontOf(it, theme), it.fit === false]);
    if (fitCache[key]) return fitCache[key];
    function over(k) {
      var reg = Registry(theme);
      var paras = storyOf(it, theme, reg, PT * k);
      var res = T().layoutChain({ paras: paras }, [{ id: "f", w: it.w * PT, h: it.h * PT, cols: 1, gut: 0, inset: INS * PT, valign: "t", excl: [], ctx: { pageLabel: "1", pageCount: 1 } }],
        { ps: reg.pstyles, cs: reg.cstyles });
      return res.overset;
    }
    var out;
    if (!over(1)) out = { k: 1, over: false };
    else if (it.fit === false) out = { k: 1, over: true };
    else if (over(MIN_FIT)) out = { k: MIN_FIT, over: true };
    else {
      var lo = MIN_FIT, hi = 1;           // lo fits, hi does not
      for (var i = 0; i < 7; i++) {
        var mid = (lo + hi) / 2;
        if (over(mid)) hi = mid; else lo = mid;
      }
      out = { k: Math.floor(lo * 100) / 100, over: false };
    }
    if (++fitCount > 3000) { fitCache = {}; fitCount = 0; }
    fitCache[key] = out;
    return out;
  }
  // Fonts load late in the browser: measurements made before must go.
  function resetFit() { fitCache = {}; fitCount = 0; }

  // ---------- Tables ----------
  // A table is drawn as designkit primitives: the header row and
  // banded rows as rectangles, the lines as lines, one text box per
  // cell. Equal columns and rows; one shrink-to-fit factor for the
  // whole table (the largest at which every cell fits).
  var T_INS = 8;
  function tableCells(it) {
    var rows = it.tb.rows, R = rows.length, Cn = rows[0].length;
    var out = [], cw = it.w / Cn, rh = it.h / R;
    rows.forEach(function (row, r) {
      row.forEach(function (txt, c) {
        out.push({ r: r, c: c, x: it.x + c * cw, y: it.y + r * rh, w: cw, h: rh, t: txt, head: !!(it.tb.hd && r === 0) });
      });
    });
    return out;
  }
  function inkOn(hex) {
    var v = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] > 0.4 ? "#1f2328" : "#ffffff";
  }
  function cellParas(cell, it, theme, reg, scale) {
    var size = it.tb.fs * scale;
    var color = cell.head ? reg.swatch(inkOn(hexOf(it.tb.ac, theme) || "#2563eb")) : (reg.swatch(it.fc) || reg.swatch("t:fg"));
    var ps = reg.pstyle({ font: it.ff || theme.ff, size: Math.round(size * 100) / 100, align: "l", color: color, b: cell.head ? 1 : 0, i: 0, sa: 0 });
    return (cell.t ? cell.t.split("\n") : [""]).map(function (l) { return { ps: ps, runs: l ? [{ t: l }] : [] }; });
  }
  var tFit = {}, tFitN = 0;
  function tableFit(it, theme) {
    var key = JSON.stringify([it.tb, it.w, it.h, it.ff, theme.ff]);
    if (tFit[key]) return tFit[key];
    var cells = tableCells(it);
    function over(k) {
      var reg = Registry(theme);
      return cells.some(function (cell) {
        if (!cell.t) return false;
        var res = T().layoutChain({ paras: cellParas(cell, it, theme, reg, PT * k) },
          [{ id: "f", w: cell.w * PT, h: cell.h * PT, cols: 1, gut: 0, inset: T_INS * PT, valign: "t", excl: [], ctx: { pageLabel: "1", pageCount: 1 } }],
          { ps: reg.pstyles, cs: reg.cstyles });
        return res.overset;
      });
    }
    var out;
    if (!over(1)) out = { k: 1, over: false };
    else if (over(MIN_FIT)) out = { k: MIN_FIT, over: true };
    else {
      var lo = MIN_FIT, hi = 1;
      for (var i = 0; i < 6; i++) { var mid = (lo + hi) / 2; if (over(mid)) hi = mid; else lo = mid; }
      out = { k: Math.floor(lo * 100) / 100, over: false };
    }
    if (++tFitN > 500) { tFit = {}; tFitN = 0; }
    tFit[key] = out;
    return out;
  }

  // ---------- Charts ----------
  // A chart is a picture drawn by the Spreadsheet's chart engine
  // (spreadsheet/sheetkit.js chartSVG, in app.js). Here: what it shows
  // (spec) and a key for that picture: 64 hex digits + ".png", so it
  // passes as a designkit asset name and caches by content.
  var CH_SCALE = 0.45;          // SVG px per slide unit: chart text about the size of 20-28 pt
  var CH_RASTER = 3;            // picture pixels per SVG px
  function num(s) {
    s = String(s || "").replace(/[\s %€$£]/g, "");
    if (!s) return null;
    if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (/^[-+]?(\d+[.,]?\d*|[.,]\d+)$/.test(s)) s = s.replace(",", ".");
    else return null;
    var v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  // The chart's rows as the cells sheetkit's chartModel reads.
  function chartGrid(ch) {
    return ch.rows.map(function (row) { return row.map(function (s) { return { n: num(s), s: s }; }); });
  }
  function mixHex(a, b, t) {
    function p(h, i) { return parseInt(h.substr(i, 2), 16); }
    return "#" + [1, 3, 5].map(function (i) {
      var v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * t);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function lumOf(hex) {
    var v = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function chartSpec(it, theme, bg, lang) {
    var bgHex = hexOf(bg || "t:bg", theme) || "#ffffff", fg = hexOf("t:fg", theme), mu = hexOf("t:mu", theme);
    return {
      t: it.ch.t, rows: it.ch.rows, by: it.ch.by || "", ttl: it.ch.ttl || "", lg: it.ch.lg === false ? 0 : 1,
      w: Math.max(160, Math.round(it.w * CH_SCALE)), h: Math.max(120, Math.round(it.h * CH_SCALE)), px: CH_RASTER,
      pal: { bg: bgHex, text: fg, dim: mu, grid: mixHex(fg, bgHex, 0.84), dark: lumOf(bgHex) < 0.35, font: "'Noto Sans', Arial, sans-serif" },
      co: [hexOf("t:a1", theme), hexOf("t:a2", theme), hexOf("t:a3", theme)], lang: lang === "el" ? "el" : "en"
    };
  }
  // 64 hex digits of a string (eight FNV-1a passes with different
  // seeds): a cache key, not a security hash.
  function hash64(s) {
    var out = "";
    for (var k = 0; k < 8; k++) {
      var h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
      out += ("0000000" + (h >>> 0).toString(16)).slice(-8);
    }
    return out;
  }
  function chartKey(spec) { return hash64(JSON.stringify(spec)) + ".png"; }

  // ---------- Geometry ----------
  // Image placement in its frame: fill / fit, zoom, offset (-100..100
  // moves the visible part to one edge or the other).
  function imageGeom(it, w, h) {
    var im = it.img, iw = im.pw || 1, ih = im.ph || 1;
    var s0 = im.fit === "fit" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    var s = s0 * (im.zm || 100) / 100, W = iw * s, H = ih * s;
    return { ix: (w - W) / 2 * (1 + (im.ox || 0) / 100), iy: (h - H) / 2 * (1 + (im.oy || 0) / 100), isc: s };
  }

  // ---------- Build ----------
  // build(data, deckId, slideIds, opts) -> { doc, pages: [{ id, slide }],
  //   fit: { itemId: { k, over } }, map: { dkItemId: itemId } }
  // opts: {
  //   editing: { skip: itemId }  draw that text box without its text
  //                              (the editor shows its own field on top)
  //   date: "9/10/2026"          footer date text
  //   handout: false             A4 pages: slide on top, notes below
  // }
  function build(data, deckId, slideIds, opts) {
    opts = opts || {};
    var deck = data.decks[deckId];
    if (!deck) return null;
    var theme = C.themeById(deck.th), W = C.widthOf(deck.as);
    var reg = Registry(theme), ids = Ids();
    var all = C.deckSlides(data, deckId), indexOf = {};
    all.forEach(function (s, i) { indexOf[s.id] = i; });

    var handout = !!opts.handout;
    var pageW = handout ? A4.w : W * PT, pageH = handout ? A4.h : C.H * PT;
    // slide placement on its page (points)
    var k = PT, ox = 0, oy = 0;
    if (handout) { k = (A4.w - 96) / W; ox = 48; oy = 48; }

    var doc = {
      id: "doc-slides", m: 1, name: deck.t || "Slides",
      setup: { w: pageW, h: pageH, unit: "pt", bleed: 0, mt: 0, mb: 0, mi: 0, mo: 0, cols: 1, gut: 0, facing: 0, preset: "custom" },
      pages: [], masters: [], items: [], stories: [], pstyles: reg.pstyles, cstyles: reg.cstyles,
      swatches: reg.swatches, guides: [], rec: [], tombs: {}
    };
    var out = { doc: doc, pages: [], fit: {}, map: {}, charts: {} };

    function geom(x, y, w, h) { return { x: ox + x * k, y: oy + y * k, w: w * k, h: h * k }; }
    function add(o) { o.m = 1; doc.items.push(o); return o; }
    function textBox(pg, g, paras, z, extra) {
      var sid = ids("st");
      doc.stories.push({ id: sid, m: 1, paras: paras.length ? paras : [{ ps: reg.pstyle({ size: 10 }), runs: [] }] });
      var o = { id: ids("it"), t: "text", pg: pg, x: g.x, y: g.y, w: g.w, h: g.h, z: z, story: sid, seq: 1, cols: 1, gut: 0, ins: INS * k, va: "t" };
      if (extra) Object.keys(extra).forEach(function (key) { o[key] = extra[key]; });
      return add(o);
    }

    slideIds.forEach(function (sid, pi) {
      var s = data.slides[sid];
      if (!s || s.d !== deckId) return;
      var pg = ids("pg");
      doc.pages.push({ id: pg, m: 1, pos: (pi + 1) * 1024, ms: "" });
      out.pages.push({ id: pg, slide: sid });
      // background
      add({ id: ids("it"), t: "rect", pg: pg, x: ox, y: oy, w: W * k, h: C.H * k, z: -2, fill: reg.swatch(s.bg || "t:bg") });
      C.slideItems(data, sid).forEach(function (it) {
        if (C.isEmptyPlaceholder(it)) return;
        var g = geom(it.x, it.y, it.w, it.h);
        var base = { pg: pg, x: g.x, y: g.y, w: g.w, h: g.h, rot: it.r, z: it.z, op: it.op === undefined ? 100 : it.op };
        if (it.fill) base.fill = reg.swatch(it.fill);
        if (it.st) { base.stroke = reg.swatch(it.st); base.sw = it.sw * k; base.dash = it.dash ? 1 : 0; }
        var o = null;
        if (it.k === "text") {
          var f = fitOf(it, theme);
          out.fit[it.id] = f;
          var skip = opts.editing && opts.editing.skip === it.id;
          var paras = skip ? [] : storyOf(it, theme, reg, k * f.k);
          o = textBox(pg, g, paras, it.z, base);
          o.ins = INS * k;
          o.va = it.va === "m" ? "c" : it.va;
        } else if (it.k === "image") {
          var ig = imageGeom(it, g.w, g.h);
          o = add(Object.assign(base, { id: ids("it"), t: "img", a: it.img.a, nm: "", iw: it.img.pw, ih: it.img.ph,
            fit: "custom", ix: ig.ix, iy: ig.iy, isc: ig.isc, r: (it.rad || 0) * k }));
        } else if (it.k === "shape") {
          o = add(Object.assign(base, { id: ids("it"), t: it.sh === "ellipse" ? "ell" : "rect", r: (it.rad || 0) * k }));
        } else if (it.k === "line") {
          // the diagonal of its box; a box 2 units thin or less is a
          // straight horizontal / vertical line
          var x0 = g.x, y0 = it.flip ? g.y + g.h : g.y, dx = g.w, dy = it.flip ? -g.h : g.h;
          if (it.h <= 2) { y0 = g.y + g.h / 2; dy = 0; }
          else if (it.w <= 2) { x0 = g.x + g.w / 2; dx = 0; }
          o = add(Object.assign(base, { id: ids("it"), t: "line", x: x0, y: y0, w: dx, h: dy, fill: "" }));
        } else if (it.k === "table") {
          tableItems(it, pg, base);
        } else if (it.k === "chart") {
          var spec = chartSpec(it, theme, s.bg, opts.lang), key = chartKey(spec);
          out.charts[key] = spec;
          var iw = spec.w * spec.px, ih = spec.h * spec.px;
          o = add(Object.assign(base, { id: ids("it"), t: "img", a: key, nm: "", iw: iw, ih: ih, fit: "custom", ix: 0, iy: 0,
            isc: Math.min(g.w / iw, g.h / ih), r: 0 }));
          if (it.fill) o.fill = reg.swatch(it.fill);
        }
        if (o) out.map[o.id] = it.id;
      });
      footer(s, pg);
      if (handout) handoutPage(s, pg);
    });

    // A table: fills, cell texts, then the lines on top.
    function tableItems(it, pg, base) {
      var f = tableFit(it, theme), cells = tableCells(it), op = base.op, z = it.z;
      out.fit[it.id] = f;
      var R = it.tb.rows.length, Cn = it.tb.rows[0].length;
      function sub(o) { o.pg = pg; o.z = z; o.op = op; o.m = 1; o.id = ids("it"); doc.items.push(o); out.map[o.id] = it.id; return o; }
      if (it.fill) sub(Object.assign({ t: "rect", fill: reg.swatch(it.fill) }, geom(it.x, it.y, it.w, it.h)));
      var rh = it.h / R;
      for (var r = 0; r < R; r++) {
        var fillC = it.tb.hd && r === 0 ? it.tb.ac : (it.tb.bd && (r - (it.tb.hd ? 1 : 0)) % 2 === 1 ? "t:sf" : "");
        if (fillC) sub(Object.assign({ t: "rect", fill: reg.swatch(fillC) }, geom(it.x, it.y + r * rh, it.w, rh)));
      }
      cells.forEach(function (cell) {
        if (!cell.t) return;
        if (opts.editing && opts.editing.skip === it.id) return;
        var o = textBox(pg, geom(cell.x, cell.y, cell.w, cell.h), cellParas(cell, it, theme, reg, k * f.k), z, { op: op });
        o.ins = T_INS * k; o.va = "c";
        out.map[o.id] = it.id;
      });
      if (it.tb.ln !== "none" && it.st) {
        var st = reg.swatch(it.st), sw = it.sw * k;
        var line = function (x0, y0, x1, y1) {
          var a = geom(x0, y0, 0, 0), b = geom(x1, y1, 0, 0);
          sub({ t: "line", x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, stroke: st, sw: sw, fill: "" });
        };
        for (var i = 0; i <= R; i++) line(it.x, it.y + i * rh, it.x + it.w, it.y + i * rh);
        if (it.tb.ln === "all") for (var c = 0; c <= Cn; c++) line(it.x + c * it.w / Cn, it.y, it.x + c * it.w / Cn, it.y + it.h);
      }
    }

    // Footer: number, date, text (theme muted colour), on every slide,
    // the first only when ft.s1.
    function footer(s, pg) {
      var ft = deck.ft, idx = indexOf[s.id];
      if (!(ft.n || ft.d || ft.x) || (idx === 0 && !ft.s1)) return;
      var size = FOOT_FS * k, y = 925, h = 60;
      function line(text, x, w, al) {
        var ps = reg.pstyle({ font: theme.ff, size: Math.round(size * 100) / 100, align: al, color: reg.swatch("t:mu") });
        textBox(pg, geom(x, y, w, h), [{ ps: ps, runs: [{ t: text }] }], C.LIM.z + 1, { va: "c" });
      }
      var third = Math.round(W * 0.3);
      if (ft.d && opts.date) line(opts.date, Math.round(W * 0.04), third, "l");
      if (ft.x) line(ft.x, Math.round((W - W * 0.4) / 2), Math.round(W * 0.4), "c");
      if (ft.n) line(String(idx + 1), W - Math.round(W * 0.04) - third, third, "r");
    }

    // Handout page: a thin frame round the slide, its number, and the
    // notes as plain text below.
    function handoutPage(s, pg) {
      var black = reg.swatch("#1f2328"), grey = reg.swatch("#8c959f");
      var sh = C.H * k;
      add({ id: ids("it"), t: "rect", pg: pg, x: ox, y: oy, w: W * k, h: sh, z: C.LIM.z + 2, stroke: grey, sw: 0.75 });
      var ps = reg.pstyle({ font: "sans", size: 9, align: "r", color: grey });
      textBox(pg, { x: ox, y: oy + sh + 4, w: W * k, h: 16 }, [{ ps: ps, runs: [{ t: String(indexOf[s.id] + 1) }] }], C.LIM.z + 3);
      var nps = reg.pstyle({ font: "sans", size: 11, lead: 15, align: "l", color: black, sa: 4 });
      var paras = (s.n || "").split("\n").map(function (l) { return { ps: nps, runs: l ? [{ t: l }] : [] }; });
      textBox(pg, { x: ox, y: oy + sh + 28, w: W * k, h: A4.h - (oy + sh + 28) - 48 }, s.n ? paras : [], C.LIM.z + 3);
    }

    out.doc = M().normDoc(doc);
    return out;
  }

  // The deck as a designkit document for render / pdf.
  function slideDoc(data, slideId, opts) {
    var s = data.slides[slideId];
    return s ? build(data, s.d, [slideId], opts) : null;
  }

  var api = {
    PT: PT, INS: INS, MIN_FIT: MIN_FIT, A4: A4,
    build: build, slideDoc: slideDoc, fitOf: fitOf, resetFit: resetFit,
    fontOf: fontOf, levelSize: levelSize, imageGeom: imageGeom,
    tableCells: tableCells, tableFit: tableFit, chartGrid: chartGrid, chartSpec: chartSpec, chartKey: chartKey,
    hash64: hash64, num: num, CH_SCALE: CH_SCALE, inkOn: inkOn, hexOf: hexOf, T_INS: T_INS
  };
  root.OrosSlidesDK = api;
})(typeof window !== "undefined" ? window : this);
