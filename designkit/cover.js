// ============================================================
// designkit/cover.js: a book cover as one Layout document
// (owner: Layout; publisher wave P3). Back cover, spine and front
// cover (and optional flaps) side by side on one page, bleed all
// round, fold guides, the spine width from the page count and the
// paper, a vector EAN-13 barcode (a path, CMYK black) from the ISBN,
// and the book's texts in the right places. Everything it makes is a
// normal model v1 item, so older copies open and edit it as is.
// Pure: no DOM; the picture is placed by the caller (Layout io.js)
// and handed in as an asset { a, iw, ih, nm }.
// Exposes orosDK.cover (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("./model.js");
  else M = root.orosDK.model;

  var MM = 72 / 25.4;

  // Common trim sizes of books, mm (portrait).
  var SIZES = [
    ["140x210", 140, 210], ["135x210", 135, 210], ["148x210", 148, 210], ["125x190", 125, 190],
    ["120x190", 120, 190], ["130x200", 130, 200], ["150x230", 150, 230], ["170x240", 170, 240],
    ["105x170", 105, 170], ["210x297", 210, 297], ["215x215", 215, 215]
  ];
  // Paper thickness per SHEET (two pages), mm. A good estimate only:
  // the printer's own figure always wins (the dialog says so).
  var PAPERS = [
    ["u70", 0.09], ["u80", 0.10], ["u90", 0.115], ["u100", 0.125],
    ["bulk80", 0.14], ["bulk90", 0.155], ["c115", 0.09], ["c135", 0.11], ["c150", 0.125]
  ];
  var COVER_ALLOW = 0.5;   // mm added for the cover board's own fold (paperback)

  var STR = {
    en: {
      "tps.cover.sw-cover": "Cover background",
      "tps.cover.ps-ctitle": "Cover title",
      "tps.cover.ps-csub": "Cover subtitle",
      "tps.cover.ps-cauth": "Cover author",
      "tps.cover.ps-spine": "Spine",
      "tps.cover.ps-back": "Back cover text",
      "tps.cover.ps-imprint": "Imprint",
      "tps.cover.ps-bc": "Barcode digits",
      "tps.cover.ps-price": "Price",
      "cv.flap": "Flap"
    },
    el: {
      "tps.cover.sw-cover": "Φόντο εξωφύλλου",
      "tps.cover.ps-ctitle": "Τίτλος εξωφύλλου",
      "tps.cover.ps-csub": "Υπότιτλος εξωφύλλου",
      "tps.cover.ps-cauth": "Συγγραφέας εξωφύλλου",
      "tps.cover.ps-spine": "Ράχη",
      "tps.cover.ps-back": "Κείμενο οπισθόφυλλου",
      "tps.cover.ps-imprint": "Εκδότης",
      "tps.cover.ps-bc": "Ψηφία barcode",
      "tps.cover.ps-price": "Τιμή",
      "cv.flap": "Αυτί"
    }
  };
  M.seedNames(STR);
  function nm(k) { return { en: STR.en[k], el: STR.el[k] }; }

  function num(v, lo, hi, def) {
    var n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
    return isFinite(n) && n >= lo && n <= hi ? n : def;
  }
  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").slice(0, max) : "";
  }
  function line(v, max) { return str(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max); }

  // Spine in mm for a page count and a paper (sheet thickness, mm).
  function spineMm(pages, sheet) {
    var p = Math.round(num(pages, 0, 5000, 0)), s = num(sheet, 0.02, 1, 0.1);
    if (!p) return 0;
    return Math.round((Math.ceil(p / 2) * s + COVER_ALLOW) * 10) / 10;
  }
  function paper(id) {
    for (var i = 0; i < PAPERS.length; i++) if (PAPERS[i][0] === id) return PAPERS[i][1];
    return 0;
  }

  // ---------- EAN-13 (the same code as publish/core.js) ----------
  function check13(d12) {
    if (!/^\d{12}$/.test(d12)) return null;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 ? 3 : 1);
    return String((10 - sum % 10) % 10);
  }
  // Any spelling of an ISBN-13 (or ISBN-10) → 13 digits, or "".
  function isbn13(s) {
    var d = String(s || "").replace(/^\s*isbn(-1[03])?:?\s*/i, "").replace(/[\s‐-―-]/g, "").toUpperCase();
    if (/^\d{9}[\dX]$/.test(d)) {
      var sum = 0;
      for (var i = 0; i < 9; i++) sum += (+d[i]) * (10 - i);
      var c = (11 - sum % 11) % 11;
      if ((c === 10 ? "X" : String(c)) !== d[9]) return "";
      d = "978" + d.slice(0, 9);
      return d + check13(d);
    }
    return /^97[89]\d{10}$/.test(d) && check13(d.slice(0, 12)) === d[12] ? d : "";
  }
  var EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  var EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  var EAN_P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  function ean13(code) {
    if (!/^\d{13}$/.test(code || "") || check13(code.slice(0, 12)) !== code[12]) return null;
    var par = EAN_P[+code[0]], out = "101";
    for (var i = 1; i <= 6; i++) out += (par[i - 1] === "L" ? EAN_L : EAN_G)[+code[i]];
    out += "01010";
    for (var j = 7; j <= 12; j++) out += EAN_L[+code[j]].replace(/[01]/g, function (c) { return c === "0" ? "1" : "0"; });
    return out + "101";
  }
  // The bars as one outline (fractions of a 95 × 1 box): normal bars
  // stop at `short` (0..1), the guard bars run the full height.
  function barsPath(code, short) {
    var bars = ean13(code);
    if (!bars) return "";
    var guard = { 0: 1, 1: 1, 2: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 92: 1, 93: 1, 94: 1 };
    var f4 = function (n) { return String(Math.round(n * 10000) / 10000); };
    var out = "";
    for (var i = 0; i < 95; i++) {
      if (bars[i] !== "1") continue;
      var j = i;
      while (j < 95 && bars[j] === "1" && !!guard[j] === !!guard[i]) j++;
      var x0 = f4(i / 95), x1 = f4(j / 95), y1 = guard[i] ? "1" : f4(short);
      out += "M" + x0 + " 0L" + x1 + " 0L" + x1 + " " + y1 + "L" + x0 + " " + y1 + "Z";
      i = j - 1;
    }
    return out;
  }

  // ---------- geometry ----------
  // spec (mm): { w, h, spine, flap, bleed } → points: panel x ranges.
  function geometry(spec) {
    var w = num(spec.w, 50, 500, 140) * MM, h = num(spec.h, 50, 700, 210) * MM;
    var sp = num(spec.spine, 0, 150, 0) * MM, fl = num(spec.flap, 0, 200, 0) * MM;
    var b = num(spec.bleed, 0, 20, 3) * MM;
    var g = { w: w, h: h, spine: sp, flap: fl, bleed: b, W: 2 * w + sp + 2 * fl, H: h };
    g.back = { x: fl, w: w };
    g.sp = { x: fl + w, w: sp };
    g.front = { x: fl + w + sp, w: w };
    g.flapL = fl ? { x: 0, w: fl } : null;
    g.flapR = fl ? { x: fl + 2 * w + sp, w: fl } : null;
    g.folds = [g.back.x, g.sp.x, g.front.x, g.front.x + w].filter(function (x, i, a) {
      return x > 0.01 && x < g.W - 0.01 && a.indexOf(x) === i;
    });
    return g;
  }

  // ---------- builder ----------
  // spec: { name, w, h, pages?, sheet?, spine?, flap?, bleed?, title, sub,
  //         author, blurb, imprint, isbn, price, img: { a, iw, ih, nm },
  //         logo: { a, iw, ih, nm } (the publisher's logo: back cover
  //         and the foot of the spine) }
  // opts: { now, lang } → a normalized document (model v1).
  function build(spec, opts) {
    var s = spec || {}, o = opts || {}, now = o.now || 1;
    var spine = s.spine !== undefined && s.spine !== "" ? num(s.spine, 0, 150, 0) : spineMm(s.pages, s.sheet || 0.1);
    var g = geometry({ w: s.w, h: s.h, spine: spine, flap: s.flap, bleed: s.bleed });
    var m = 12 * MM, z = 0;
    var title = line(s.title, 200), sub = line(s.sub, 200), author = line(s.author, 200);
    var blurb = str(s.blurb, 4000).trim(), imprint = line(s.imprint, 120), price = line(s.price, 40);
    var name = line(s.name, 120) || title || "Cover";
    var doc = M.newDoc({ name: name, w: g.W, h: g.H, unit: "mm", bleed: g.bleed, mt: m, mb: m, mi: m, mo: m,
      cols: 1, gut: 5 * MM, facing: 0, preset: "custom", pages: 1 }, now);
    var pg = M.pagesInOrder(doc)[0];
    pg.ms = "";                                    // a cover has no master items
    doc.setup.ext = { cover: { w: num(s.w, 50, 500, 140), h: num(s.h, 50, 700, 210), spine: spine,
      flap: num(s.flap, 0, 200, 0), pages: Math.round(num(s.pages, 0, 5000, 0)) } };
    function item(t, x, y, w, h, extra) {
      var it = { id: M.newId("it"), m: now, t: t, pg: pg.id, x: x, y: y, w: w, h: h, z: ++z * 1024 };
      Object.keys(extra || {}).forEach(function (k) { it[k] = extra[k]; });
      doc.items.push(it);
      return it;
    }
    function text(x, y, w, h, paras, extra) {
      var st = { id: M.newId("st"), m: now, h: [], paras: [] };
      paras.forEach(function (p) {
        String(p[1]).split("\n").forEach(function (ln) { st.paras.push({ ps: p[0], runs: ln ? [{ t: ln }] : [] }); });
      });
      doc.stories.push(st);
      var ex = extra || {};
      ex.story = st.id; ex.seq = 1024;
      return item("text", x, y, w, h, ex);
    }
    function style(id, props) {
      var p = { id: id, m: now, name: nm("tps.cover." + id) };
      Object.keys(props).forEach(function (k) { p[k] = props[k]; });
      doc.pstyles.push(p);
    }
    doc.swatches.push({ id: "sw-cover", m: now, name: nm("tps.cover.sw-cover"), mode: "cmyk", v: [60, 40, 40, 100] });
    var tsz = Math.max(18, Math.min(40, g.w / 9));
    style("ps-ctitle", { base: "ps-h1", font: "serif", size: tsz, lead: tsz * 1.12, align: "c", color: "sw-paper", sa: 8 });
    style("ps-csub", { base: "ps-base", font: "serif", i: 1, size: Math.round(tsz * 0.45), lead: Math.round(tsz * 0.6), align: "c", color: "sw-paper" });
    style("ps-cauth", { base: "ps-base", font: "sans", size: Math.round(tsz * 0.42), lead: Math.round(tsz * 0.55), align: "c", caps: 1, track: 80, color: "sw-paper" });
    style("ps-back", { base: "ps-base", font: "serif", size: 10.5, lead: 15, align: "l", color: "sw-paper", sa: 6 });
    style("ps-imprint", { base: "ps-base", font: "sans", size: 8, lead: 10, caps: 1, track: 80, color: "sw-paper" });
    style("ps-price", { base: "ps-base", font: "sans", size: 9, lead: 11, align: "r", b: 1, color: "sw-paper" });
    style("ps-bc", { base: "ps-base", font: "mono", size: 6.5, lead: 7, align: "c", color: "sw-black" });
    var spSize = Math.max(5, Math.min(11, g.spine * 0.55));
    style("ps-spine", { base: "ps-base", font: "sans", size: Math.round(spSize * 10) / 10, lead: Math.round(spSize * 12) / 10, align: "c", caps: 1, track: 60, color: "sw-paper" });

    var b = g.bleed;
    // background: the whole wrap in the cover colour, then the picture
    // over the front (to the bleed, and over its flap when there is one)
    item("rect", -b, -b, g.W + 2 * b, g.H + 2 * b, { fill: "sw-cover", sw: 0, lock: 1 });
    var fx = g.front.x, fw = g.front.w + (g.flapR ? 0 : b);
    var pic = item("img", fx, -b, fw, g.H + 2 * b, { fit: "fill" });
    function setPic(it, src) {
      if (!src || typeof src.a !== "string") return;
      it.a = src.a; it.nm = line(src.nm, 120); it.iw = Math.round(num(src.iw, 0, 100000, 0)); it.ih = Math.round(num(src.ih, 0, 100000, 0));
    }
    setPic(pic, s.img);
    var logo = s.logo && typeof s.logo.a === "string" ? s.logo : null;
    // front texts
    var ix = fx + m, iw = g.front.w - 2 * m;
    var top = [["ps-ctitle", title || " "]];
    if (sub) top.push(["ps-csub", sub]);
    text(ix, m + 6 * MM, iw, Math.min(g.H * 0.4, 90 * MM), top, { va: "t" });
    if (author) text(ix, g.H - m - 22 * MM, iw, 22 * MM, [["ps-cauth", author]], { va: "b" });
    // spine: one line turned 90° (reads top to bottom), only when it fits
    // the logo at the foot of the spine (when the spine is 6 mm or more)
    var spLogo = logo && g.spine >= 6 * MM ? g.spine - 2 * MM : 0;
    if (spLogo) setPic(item("img", g.sp.x + MM, g.H - m - spLogo, spLogo, spLogo, { fit: "fit" }), logo);
    if (g.spine >= 3 * MM) {
      var sl = g.H - 2 * m - (spLogo ? spLogo + 4 * MM : 0), cx = g.sp.x + g.spine / 2, cy = m + sl / 2;
      var words = [author, title].filter(Boolean).join("  ·  ") + (imprint ? "  ·  " + imprint : "");
      text(cx - sl / 2, cy - g.spine / 2, sl, g.spine, [["ps-spine", words || " "]], { rot: 90, va: "c" });
    }
    // back: the blurb, the imprint, the barcode
    var bx = g.back.x + m, bw = g.back.w - 2 * m;
    var bcW = 37.29 * MM, bcH = 25.9 * MM;
    if (blurb) text(bx, m + 6 * MM, bw, g.H - 2 * m - bcH - 16 * MM, [["ps-back", blurb]], { va: "t" });
    var lw = logo ? 16 * MM : 0;
    if (logo) setPic(item("img", bx, g.H - m - lw, lw, lw, { fit: "fit" }), logo);
    if (imprint) text(bx + (lw ? lw + 3 * MM : 0), g.H - m - 10 * MM, bw - bcW - 6 * MM - (lw ? lw + 3 * MM : 0), 10 * MM, [["ps-imprint", imprint]], { va: "b" });
    var code = isbn13(s.isbn);
    if (code) {
      var gx = g.back.x + g.back.w - m - bcW, gy = g.H - m - bcH, grp = M.newId("gr");
      var pad = 2 * MM, top2 = 4 * MM, digits = 3.2 * MM, barsH = bcH - top2 - digits - pad;
      item("rect", gx, gy, bcW, bcH, { fill: "sw-paper", sw: 0, grp: grp });
      var hy = code.slice(0, 3) + "-" + code.slice(3, 12) + "-" + code[12];
      if (s.isbnShown && line(s.isbnShown, 20).replace(/[^\d-]/g, "") === line(s.isbnShown, 20) &&
          line(s.isbnShown, 20).replace(/-/g, "") === code) hy = line(s.isbnShown, 20);
      text(gx, gy + pad * 0.5, bcW, top2, [["ps-bc", "ISBN " + hy]], { grp: grp, va: "c" });
      var bx0 = gx + 3.5 * MM, bw0 = bcW - 7 * MM;     // quiet zones
      item("path", bx0, gy + top2 + pad * 0.5, bw0, barsH + 1.6 * MM, { d: barsPath(code, barsH / (barsH + 1.6 * MM)), fill: "sw-black", sw: 0, grp: grp });
      text(gx, gy + top2 + pad * 0.5 + barsH + 0.2 * MM, bcW, digits, [["ps-bc", code[0] + "  " + code.slice(1, 7) + "  " + code.slice(7)]], { grp: grp, va: "t" });
    }
    // the price: its own line just above the barcode (or where the
    // barcode would be), so a long price never crowds the ISBN
    if (price) text(g.back.x + g.back.w - m - bcW, g.H - m - (code ? bcH : 0) - 6 * MM, bcW, 5 * MM, [["ps-price", price]], { va: "b" });
    // fold guides (spine edges, flap folds)
    g.folds.forEach(function (x) { doc.guides.push({ id: M.newId("gd"), m: now, pg: pg.id, o: "v", p: x }); });
    return M.normDoc(doc);
  }

  var API = {
    SIZES: SIZES, PAPERS: PAPERS, MM: MM, STR: STR,
    spineMm: spineMm, paper: paper, geometry: geometry, build: build,
    isbn13: isbn13, ean13: ean13, barsPath: barsPath
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.orosDK = root.orosDK || {}; root.orosDK.cover = API; }
})(typeof window !== "undefined" ? window : globalThis);
