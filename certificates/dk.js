// ============================================================
// orOS Certificates — dk.js (certificate -> designkit document, v1.0.0)
// The preview, the PNG, the PDF and printing all draw a certificate
// through the shared designkit engine (render.js, pdf.js), so screen
// and paper agree. This file turns an event + its people into a
// TRANSIENT designkit document, one page per person. Nothing here is
// stored or synced.
//   - six looks (classic, modern, elegant, bold, minimal, kids): page
//     background, frames, bands, corner marks, confetti, a medal
//   - one vertical stack of blocks (logo, issuer, title, rule, line
//     before the name, name, text) with the free space shared
//     between the gaps, and a bottom row of signatures, the date and
//     place, a seal / medal, the certificate number
//   - shrink to fit: a text that does not fit its box is drawn
//     smaller (down to MIN_FIT), searched against the designkit
//     typesetter itself, so what fits on screen fits in the PDF
// Units: points. A4 = 595.28 x 841.89, Letter = 612 x 792.
// Needs CertCore + orosDK.model + orosDK.text on the same global.
// Pure: Node tests load it in a vm context.
// ============================================================
(function (root) {
  "use strict";

  function C() { return root.CertCore; }
  function M() { return root.orosDK.model; }
  function T() { return root.orosDK.text; }

  var PAGES = { a4: { w: 595.276, h: 841.89 }, letter: { w: 612, h: 792 } };
  var MIN_FIT = 0.4;
  var INK = "#222222", MUTED = "#5c5c5c", WHITE = "#ffffff";

  // Per look: page colour, title tracking, name face, content box,
  // rule under the title, line under the name, text colours.
  var LOOK = {
    classic: { bg: "#fffaf0", track: 60,  nameB: 1, nameI: 1, inset: 64, rule: 1, under: 1, head: "acc",  name: "acc2" },
    modern:  { bg: "#ffffff", track: 40,  nameB: 1, nameI: 0, inset: 52, rule: 0, under: 1, head: "acc",  name: "ink"  },
    elegant: { bg: "#ffffff", track: 260, nameB: 0, nameI: 1, inset: 66, rule: 1, under: 1, head: "acc2", name: "acc"  },
    bold:    { bg: "#ffffff", track: 40,  nameB: 1, nameI: 0, inset: 52, rule: 0, under: 1, head: "white", name: "acc" },
    minimal: { bg: "#ffffff", track: 140, nameB: 0, nameI: 0, inset: 60, rule: 1, under: 0, head: "acc",  name: "ink"  },
    kids:    { bg: "#fffbea", track: 0,   nameB: 1, nameI: 0, inset: 62, rule: 0, under: 0, head: "acc",  name: "acc2" }
  };
  // Confetti for the kids look: [x, y] as fractions of the page,
  // radius in k units, colour index.
  var CONFETTI = [
    [0.05, 0.08, 22, 0], [0.13, 0.04, 9, 2], [0.2, 0.1, 6, 3], [0.9, 0.06, 26, 1], [0.82, 0.13, 8, 4],
    [0.96, 0.24, 11, 2], [0.04, 0.3, 10, 4], [0.03, 0.62, 16, 3], [0.08, 0.9, 24, 1], [0.18, 0.95, 8, 0],
    [0.95, 0.55, 9, 0], [0.92, 0.88, 30, 2], [0.8, 0.95, 10, 3], [0.5, 0.03, 7, 4], [0.36, 0.97, 7, 2],
    [0.66, 0.97, 9, 1]
  ];

  function pageSize(ev) {
    var p = PAGES[ev.size] || PAGES.a4;
    return ev.orient === "p" ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
  }

  // ---------- Styles registry (one per build) ----------
  function Registry() {
    var sw = {}, ps = {}, swatches = [], pstyles = [], n = 0;
    function swatch(h) {
      h = /^#[0-9a-f]{6}$/.test(h) ? h : "#000000";
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
        var s = { id: "ps-" + (++n).toString(36), m: 1, name: "s" };
        Object.keys(o).forEach(function (k) { s[k] = o[k]; });
        ps[key] = s.id;
        pstyles.push(s);
      }
      return ps[key];
    }
    return { swatch: swatch, pstyle: pstyle, swatches: swatches, pstyles: pstyles };
  }

  // Text → paragraphs of one style.
  function parasOf(text, o, reg) {
    var ps = reg.pstyle(o);
    return String(text).split("\n").map(function (l) { return { ps: ps, runs: l ? [{ t: l }] : [] }; });
  }

  // ---------- Shrink to fit ----------
  var fitCache = {}, fitCount = 0;
  // The largest factor (MIN_FIT..1) at which the text fits w x h.
  function fitOf(text, o, w, h) {
    var key = JSON.stringify([text, o, Math.round(w), Math.round(h)]);
    if (fitCache[key] !== undefined) return fitCache[key];
    function over(k) {
      var reg = Registry(), oo = {};
      Object.keys(o).forEach(function (x) { oo[x] = o[x]; });
      oo.size = Math.round(o.size * k * 100) / 100;
      if (o.lead) oo.lead = Math.round(o.lead * k * 100) / 100;
      oo.color = reg.swatch(INK);
      var paras = parasOf(text, oo, reg);
      var res = T().layoutChain({ paras: paras }, [{ id: "f", w: w, h: h, cols: 1, gut: 0, inset: 0, valign: "t", excl: [], ctx: { pageLabel: "1", pageCount: 1 } }],
        { ps: reg.pstyles, cs: [] });
      return res.overset;
    }
    var out;
    if (!over(1)) out = 1;
    else if (over(MIN_FIT)) out = MIN_FIT;
    else {
      var lo = MIN_FIT, hi = 1;
      for (var i = 0; i < 7; i++) { var mid = (lo + hi) / 2; if (over(mid)) hi = mid; else lo = mid; }
      out = Math.floor(lo * 100) / 100;
    }
    if (++fitCount > 4000) { fitCache = {}; fitCount = 0; }
    fitCache[key] = out;
    return out;
  }
  // Fonts load late in the browser: measurements made before must go.
  function resetFit() { fitCache = {}; fitCount = 0; }

  // ---------- Build ----------
  // build(ev, people, opts) -> { doc, pages: [{ id, person, qr? }] }
  //   qr: { x, y, s } (pt) the white square where the app paints the
  //   signed check QR code (ev.qr on); the code itself is not a doc item
  //   people: [person…]; empty or null = one sample page
  //   opts.sample: { n, no } the sample person
  function build(ev, people, opts) {
    opts = opts || {};
    var CC = C();
    var list = people && people.length ? people : [opts.sample || { n: "", no: 0 }];
    var P = pageSize(ev), W = P.w, H = P.h, k = Math.min(W, H) / 595.276;
    var L = LOOK[ev.sty] || LOOK.classic;
    var reg = Registry(), n = 0;
    function id(pre) { n++; return pre + "-" + n.toString(36); }
    var colors = { acc: ev.acc, acc2: ev.acc2, ink: INK, white: WHITE };
    var font = ev.font === "sans" ? "sans" : "serif";

    var doc = {
      id: "doc-cert", m: 1, name: ev.t || "Certificate",
      setup: { w: W, h: H, unit: "pt", bleed: 0, mt: 0, mb: 0, mi: 0, mo: 0, cols: 1, gut: 0, facing: 0, preset: "custom" },
      pages: [], masters: [], items: [], stories: [], pstyles: reg.pstyles, cstyles: [],
      swatches: reg.swatches, guides: [], rec: [], tombs: {}
    };
    var out = { doc: doc, pages: [] };

    function add(o) { o.id = id("it"); o.m = 1; doc.items.push(o); return o; }
    function rect(pg, x, y, w, h, o) {
      var it = { t: o.ell ? "ell" : "rect", pg: pg, x: x, y: y, w: w, h: h, z: o.z || 0, op: o.op === undefined ? 100 : o.op, r: o.r || 0, rot: o.rot || 0 };
      if (o.fill) it.fill = reg.swatch(o.fill);
      if (o.stroke) { it.stroke = reg.swatch(o.stroke); it.sw = o.sw || 1; }
      return add(it);
    }
    function lineTo(pg, x, y, dx, dy, color, sw, z) {
      return add({ t: "line", pg: pg, x: x, y: y, w: dx, h: dy, stroke: reg.swatch(color), sw: sw, z: z || 0, fill: "" });
    }
    function image(pg, im, x, y, w, h, z) {
      if (!im || !im.a) return null;
      return add({ t: "img", pg: pg, x: x, y: y, w: w, h: h, z: z || 3, a: im.a, nm: "", iw: im.w, ih: im.h, fit: "fit" });
    }
    // A text box; shrinks to fit when it must. o: paragraph style.
    function textBox(pg, txt, x, y, w, h, o, va, z) {
      if (!txt || !String(txt).trim()) return null;
      var fo = { font: o.font, size: o.size, align: o.align || "c", b: o.b || 0, i: o.i || 0 };
      if (o.lead) fo.lead = o.lead;
      if (o.track) fo.track = o.track;
      var f = fitOf(txt, fo, w, h);
      var ps = { font: fo.font, size: Math.round(fo.size * f * 100) / 100, align: fo.align, b: fo.b, i: fo.i, color: reg.swatch(o.color || INK) };
      if (fo.lead) ps.lead = Math.round(fo.lead * f * 100) / 100;
      if (fo.track) ps.track = fo.track;
      var sid = id("st");
      doc.stories.push({ id: sid, m: 1, paras: parasOf(txt, ps, reg) });
      return add({ t: "text", pg: pg, x: x, y: y, w: w, h: h, z: z || 2, story: sid, seq: 1, cols: 1, gut: 0, ins: 0, va: va || "t" });
    }

    // ----- the look -----
    function decor(pg) {
      var a = ev.acc, b = ev.acc2;
      rect(pg, 0, 0, W, H, { fill: L.bg, z: -100 });
      if (ev.sty === "classic") {
        var o1 = 20 * k, o2 = 29 * k, sq = 7 * k;
        rect(pg, o1, o1, W - 2 * o1, H - 2 * o1, { stroke: a, sw: 3 * k, z: -50 });
        rect(pg, o2, o2, W - 2 * o2, H - 2 * o2, { stroke: a, sw: 0.8 * k, z: -50 });
        [[o2, o2], [W - o2, o2], [o2, H - o2], [W - o2, H - o2]].forEach(function (c) {
          rect(pg, c[0] - sq / 2, c[1] - sq / 2, sq, sq, { fill: b, z: -49, rot: 45 });
        });
      } else if (ev.sty === "modern") {
        var bw = 0.055 * W;
        rect(pg, 0, 0, bw, H, { fill: a, z: -50 });
        rect(pg, bw + 5 * k, 0, 6 * k, H, { fill: b, z: -50 });
        rect(pg, W - 150 * k, -150 * k, 300 * k, 300 * k, { fill: b, op: 22, ell: true, z: -60 });
        rect(pg, W - 70 * k, H - 70 * k, 140 * k, 140 * k, { fill: a, op: 14, ell: true, z: -60 });
      } else if (ev.sty === "elegant") {
        var e = 24 * k, len = 56 * k, sw = 2.4 * k;
        rect(pg, e, e, W - 2 * e, H - 2 * e, { stroke: b, sw: 0.5 * k, z: -50 });
        var e2 = e + 8 * k;
        [[e2, e2, 1, 1], [W - e2, e2, -1, 1], [e2, H - e2, 1, -1], [W - e2, H - e2, -1, -1]].forEach(function (c) {
          lineTo(pg, c[0], c[1], c[2] * len, 0, a, sw, -49);
          lineTo(pg, c[0], c[1], 0, c[3] * len, a, sw, -49);
        });
      } else if (ev.sty === "bold") {
        rect(pg, 0, 0, W, bandH(), { fill: a, z: -50 });
        rect(pg, 0, bandH(), W, 5 * k, { fill: b, z: -50 });
        rect(pg, 0, H - 0.035 * H, W, 0.035 * H, { fill: b, z: -50 });
      } else if (ev.sty === "minimal") {
        var mi = 22 * k;
        rect(pg, mi, mi, W - 2 * mi, H - 2 * mi, { stroke: b, sw: 0.5 * k, z: -50 });
      } else if (ev.sty === "kids") {
        var cols = [a, b, "#ffd166", "#7b61ff", "#06d6a0"];
        CONFETTI.forEach(function (c) {
          var r = c[2] * k;
          rect(pg, c[0] * W - r, c[1] * H - r, 2 * r, 2 * r, { fill: cols[c[3]], ell: true, z: -60, op: 85 });
        });
        var ki = 30 * k;
        rect(pg, ki, ki, W - 2 * ki, H - 2 * ki, { stroke: b, sw: 5 * k, r: 26 * k, z: -50 });
      }
    }
    function bandH() { return Math.round(0.2 * H); }
    function contentBox() {
      var m = L.inset * k;
      if (ev.sty === "modern") { var left = 0.055 * W + 11 * k + 40 * k; return { x: left, y: m, w: W - left - m, h: H - 2 * m }; }
      if (ev.sty === "bold") { var top = bandH() + 22 * k; return { x: m, y: top, w: W - 2 * m, h: H - top - 0.035 * H - 18 * k }; }
      return { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    }
    function medal(pg, cx, cy, r) {
      rect(pg, cx - r * 0.55, cy + r * 0.2, r * 0.42, r * 1.2, { fill: ev.acc2, rot: 18, z: 4 });
      rect(pg, cx + r * 0.13, cy + r * 0.2, r * 0.42, r * 1.2, { fill: ev.acc2, rot: -18, z: 4 });
      rect(pg, cx - r, cy - r, 2 * r, 2 * r, { fill: ev.acc, ell: true, z: 5 });
      var ri = r * 0.8;
      rect(pg, cx - ri, cy - ri, 2 * ri, 2 * ri, { stroke: WHITE, sw: 1.2 * k, ell: true, z: 6, op: 75 });
      var yr = (ev.idate || "").slice(0, 4);
      if (yr) textBox(pg, yr, cx - ri, cy - 9 * k, 2 * ri, 18 * k, { font: "sans", size: 12 * k, b: 1, color: WHITE }, "c", 7);
    }

    // ----- one page per person -----
    list.forEach(function (p, pi) {
      var pg = id("pg");
      doc.pages.push({ id: pg, m: 1, pos: (pi + 1) * 1024, ms: "" });
      var pgOut = { id: pg, person: p && p.id ? p.id : "" };
      out.pages.push(pgOut);
      decor(pg);
      var map = CC.fields(ev, p), fl = function (key) { return CC.fill(ev.txt[key] || "", map).trim(); };
      var B = contentBox();
      var sigs = ev.sigs.filter(function (s) { return s.n || s.r || s.a; });
      var foot = fl("foot"), serialLine = ev.showNo ? fl("no") : "";
      var hasSeal = !!(ev.seal || ev.medal);

      // the vertical stack: [key, height (k units), gap weight before]
      var blocks = [];
      if (ev.logo) blocks.push(["logo", 58, 0]);
      var sub = fl("sub");
      if (sub) blocks.push(["sub", 22, blocks.length ? 0.7 : 0]);
      var head = fl("head");
      if (head && ev.sty !== "bold") blocks.push(["head", 50, blocks.length ? 0.9 : 0]);
      if (head && L.rule && ev.sty !== "bold") blocks.push(["rule", 6, 0.25]);
      var pre = fl("pre");
      if (pre) blocks.push(["pre", 26, blocks.length ? 1 : 0]);
      blocks.push(["name", 62, blocks.length ? (pre ? 0.4 : 1) : 0]);
      var body = fl("body");
      if (body) blocks.push(["body", 70, 0.6]);
      var bottomH = 96 * k, serialH = serialLine || (foot && sigs.length >= 2) ? 14 * k : 0;
      var fixed = 0, weights = 1.4;          // 1.4 = the gap before the bottom row
      blocks.forEach(function (b) { fixed += b[1] * k; weights += b[2]; });
      var free = B.h - fixed - bottomH - serialH;
      var unit = weights > 0 ? Math.max(3 * k, free / weights) : 0;
      // portrait pages: some of the extra room goes above and below
      var top = 0;
      if (free > 0 && unit > 46 * k) { top = (free - 46 * k * weights) / 2; unit = 46 * k; }
      var y = B.y + top, cx = B.x + B.w / 2;
      var tc = function (c) { return colors[c] || INK; };

      blocks.forEach(function (b) {
        y += b[2] * unit;
        var h = b[1] * k, key = b[0];
        if (key === "logo") image(pg, ev.logo, cx - 90 * k, y, 180 * k, h, 3);
        else if (key === "sub") textBox(pg, sub, B.x, y, B.w, h, { font: font, size: 13 * k, track: 80, color: MUTED }, "c");
        else if (key === "head") textBox(pg, head, B.x, y, B.w, h, { font: font, size: 35 * k, b: 1, track: L.track, color: tc(L.head) }, "c");
        else if (key === "rule") lineTo(pg, cx - 45 * k, y + h / 2, 90 * k, 0, ev.acc, 1.5 * k, 1);
        else if (key === "pre") textBox(pg, pre, B.x, y, B.w, h, { font: font, size: 15 * k, i: font === "serif" ? 1 : 0, color: MUTED }, "c");
        else if (key === "name") {
          var nm = fl("nm");
          textBox(pg, nm, B.x, y, B.w, h, { font: font, size: 44 * k, b: L.nameB, i: L.nameI, color: tc(L.name) }, "b");
          if (L.under) lineTo(pg, cx - B.w * 0.3, y + h + 3 * k, B.w * 0.6, 0, ev.acc2, 0.75 * k, 1);
        } else if (key === "body") textBox(pg, body, B.x + B.w * 0.06, y, B.w * 0.88, h, { font: font, size: 15 * k, lead: 20.5 * k, color: INK }, "t");
        y += h;
      });
      if (head && ev.sty === "bold") {
        var bh = bandH();
        textBox(pg, head, 52 * k, bh / 2 - 24 * k, W - 104 * k, 48 * k, { font: font, size: 34 * k, b: 1, track: L.track, color: WHITE }, "c", 3);
      }

      // the bottom row: the check QR code (when on) at the left, then three slots
      var rowY = B.y + B.h - serialH - bottomH, rowX = B.x, rowW = B.w;
      if (ev.qr) {
        var q = 84 * k;
        pgOut.qr = { x: B.x, y: rowY + bottomH - q - 2 * k, s: q };
        rect(pg, pgOut.qr.x, pgOut.qr.y, q, q, { fill: WHITE, r: 3 * k, z: 2 });
        rowX = B.x + q + 12 * k;
        rowW = B.w - q - 12 * k;
      }
      var cw = rowW / 3;
      var slots = [null, null, null];
      if (sigs.length === 1) slots = [foot ? "foot" : null, hasSeal ? "seal" : null, sigs[0]];
      else if (sigs.length === 2) slots = [sigs[0], hasSeal ? "seal" : null, sigs[1]];
      else if (sigs.length >= 3) slots = [sigs[0], sigs[1], sigs[2]];
      else slots = [foot ? "foot" : null, hasSeal ? "seal" : null, null];
      var footBelow = foot && slots.indexOf("foot") < 0;
      slots.forEach(function (s, i) {
        if (!s) return;
        var sx = rowX + i * cw + 10 * k, sw = cw - 20 * k;
        if (s === "seal") {
          if (ev.seal) image(pg, ev.seal, rowX + i * cw + cw / 2 - 44 * k, rowY + 4 * k, 88 * k, 88 * k, 3);
          else medal(pg, rowX + i * cw + cw / 2, rowY + 40 * k, 34 * k);
          return;
        }
        var lineY = rowY + 58 * k;
        if (s === "foot") {
          textBox(pg, foot, sx, lineY - 22 * k, sw, 20 * k, { font: font, size: 11 * k, color: INK }, "b");
          lineTo(pg, sx + sw * 0.1, lineY, sw * 0.8, 0, ev.acc2, 0.75 * k, 1);
          return;
        }
        if (s.a) image(pg, { a: s.a, w: s.w, h: s.h }, sx + sw * 0.15, lineY - 48 * k, sw * 0.7, 46 * k, 3);
        lineTo(pg, sx + sw * 0.1, lineY, sw * 0.8, 0, ev.acc2, 0.75 * k, 1);
        textBox(pg, s.n, sx, lineY + 4 * k, sw, 16 * k, { font: font, size: 11 * k, b: 1, color: INK }, "t");
        textBox(pg, s.r, sx, lineY + (s.n ? 19 : 4) * k, sw, 15 * k, { font: font, size: 9.5 * k, color: MUTED }, "t");
      });
      // three signatures: the seal / medal goes to the top corner
      if (sigs.length >= 3 && hasSeal) {
        var sx2 = B.x + B.w - 70 * k, sy2 = B.y - 6 * k;
        if (ev.sty === "bold") sy2 = bandH() + 10 * k;
        if (ev.seal) image(pg, ev.seal, sx2, sy2, 70 * k, 70 * k, 3);
        else medal(pg, sx2 + 35 * k, sy2 + 32 * k, 26 * k);
      }
      // the line under the row: date / place (when it had no slot) and the number
      var last = [footBelow ? foot : "", serialLine].filter(Boolean).join("  ·  ");
      if (last) {
        var ly = B.y + B.h - 13 * k;
        textBox(pg, last, B.x, ly, B.w, 13 * k, { font: font, size: footBelow ? 9.5 * k : 8 * k, color: MUTED }, "b");
      }
    });

    out.doc = M().normDoc(doc);
    return out;
  }

  // ---------- Sign-in sheet (wave 3) ----------
  // buildSheet(ev, people, L) -> { doc } : a table to print and sign,
  // one signature column per day (up to 7; landscape from 4 days),
  // blank rows at the end for people not on the list.
  //   L: { title, sub, sheet, no ("#"), name, sign, page "{i} / {n}", day(ymd) -> label }
  var SHEET = { margin: 40, rowH: 26, headH: 30, blanks: 5 };
  function buildSheet(ev, people, L) {
    var CC = C(), days = CC.eventDays(ev), pp = PAGES[ev.size] || PAGES.a4;
    var land = days.length >= 4, W = land ? pp.h : pp.w, H = land ? pp.w : pp.h, m = SHEET.margin;
    var reg = Registry(), n = 0;
    function id(pre) { n++; return pre + "-" + n.toString(36); }
    var doc = {
      id: "doc-sheet", m: 1, name: L.title || "Sign-in sheet",
      setup: { w: W, h: H, unit: "pt", bleed: 0, mt: 0, mb: 0, mi: 0, mo: 0, cols: 1, gut: 0, facing: 0, preset: "custom" },
      pages: [], masters: [], items: [], stories: [], pstyles: reg.pstyles, cstyles: [],
      swatches: reg.swatches, guides: [], rec: [], tombs: {}
    };
    function add(o) { o.id = id("it"); o.m = 1; doc.items.push(o); return o; }
    function line(pg, x, y, dx, dy, color, sw) {
      return add({ t: "line", pg: pg, x: x, y: y, w: dx, h: dy, stroke: reg.swatch(color), sw: sw, z: 1, fill: "" });
    }
    function rect(pg, x, y, w, h, fill) {
      return add({ t: "rect", pg: pg, x: x, y: y, w: w, h: h, z: 0, op: 100, r: 0, rot: 0, fill: reg.swatch(fill) });
    }
    function text(pg, txt, x, y, w, h, o, va) {
      if (!txt || !String(txt).trim()) return;
      var fo = { font: o.font || "sans", size: o.size, align: o.align || "l", b: o.b || 0, i: 0 };
      var f = o.fit ? fitOf(txt, fo, w, h) : 1;
      var ps = { font: fo.font, size: Math.round(fo.size * f * 100) / 100, align: fo.align, b: fo.b, i: 0, color: reg.swatch(o.color || INK) };
      var sid = id("st");
      doc.stories.push({ id: sid, m: 1, paras: parasOf(txt, ps, reg) });
      add({ t: "text", pg: pg, x: x, y: y, w: w, h: h, z: 2, story: sid, seq: 1, cols: 1, gut: 0, ins: 0, va: va || "c" });
    }
    // columns: number, name, then one per day
    var tw = W - 2 * m, noW = 34, nameW = Math.max(150, Math.min(260, tw - noW - days.length * 80));
    var dayW = (tw - noW - nameW) / days.length;
    var cols = [{ x: m, w: noW, key: "no" }, { x: m + noW, w: nameW, key: "name" }];
    days.forEach(function (d, i) { cols.push({ x: m + noW + nameW + i * dayW, w: dayW, key: "day", d: d }); });
    var top = m + 62, rowH = SHEET.rowH;
    var perPage = Math.max(1, Math.floor((H - top - SHEET.headH - m - 16) / rowH));
    var rows = (people || []).map(function (p, i) { return { no: String(i + 1), n: p.n }; });
    for (var b = 0; b < SHEET.blanks; b++) rows.push({ no: "", n: "" });
    var pages = Math.max(1, Math.ceil(rows.length / perPage));
    for (var pi = 0; pi < pages; pi++) {
      var pg = id("pg");
      doc.pages.push({ id: pg, m: 1, pos: (pi + 1) * 1024, ms: "" });
      rect(pg, 0, 0, W, H, WHITE);
      text(pg, L.title, m, m - 6, tw, 26, { size: 17, b: 1, fit: true }, "t");
      text(pg, L.sub, m, m + 22, tw, 18, { size: 10.5, color: MUTED, fit: true }, "t");
      text(pg, L.sheet, m, m + 40, tw, 16, { size: 10, b: 1, color: ev.acc }, "t");
      // header row
      rect(pg, m, top, tw, SHEET.headH, "#f1f1f1");
      cols.forEach(function (c) {
        var lab = c.key === "no" ? L.no : c.key === "name" ? L.name : (days.length > 1 && c.d ? L.day(c.d) : L.sign);
        text(pg, lab, c.x + 6, top, c.w - 12, SHEET.headH, { size: 9.5, b: 1, align: c.key === "day" ? "c" : "l", fit: true });
      });
      var chunk = rows.slice(pi * perPage, (pi + 1) * perPage), y = top + SHEET.headH;
      chunk.forEach(function (r) {
        text(pg, r.no, cols[0].x + 4, y, cols[0].w - 8, rowH, { size: 9, color: MUTED, align: "r" });
        text(pg, r.n, cols[1].x + 6, y, cols[1].w - 10, rowH, { size: 11, fit: true });
        y += rowH;
        line(pg, m, y, tw, 0, "#c8c8c8", 0.6);
      });
      // frame and column lines
      var bottom = top + SHEET.headH + chunk.length * rowH;
      line(pg, m, top, tw, 0, "#9a9a9a", 0.8);
      line(pg, m, top + SHEET.headH, tw, 0, "#9a9a9a", 0.8);
      line(pg, m, bottom, tw, 0, "#9a9a9a", 0.8);
      cols.concat([{ x: m + tw }]).forEach(function (c) { line(pg, c.x, top, 0, bottom - top, "#9a9a9a", 0.6); });
      if (pages > 1) text(pg, L.page.replace("{i}", pi + 1).replace("{n}", pages), m, H - m + 6, tw, 14, { size: 8.5, color: MUTED, align: "r" }, "t");
    }
    return { doc: M().normDoc(doc), days: days, perPage: perPage };
  }

  var api = { PAGES: PAGES, LOOK: LOOK, MIN_FIT: MIN_FIT, pageSize: pageSize, build: build, buildSheet: buildSheet, fitOf: fitOf, resetFit: resetFit };
  root.CertDK = api;
})(typeof window !== "undefined" ? window : this);
