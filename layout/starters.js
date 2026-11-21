// ============================================================
// orOS Layout — Start here: starter books (LY-N1, v1.0.0)
// Twelve kinds of book, each a starter of our own that fits any trim:
// margins, type sizes, columns and frames are worked out from the
// page's width and height, never fixed. The guided New book dialog
// (panels.js startDlg) and orOS Gate's create (commands.js `start`)
// build them here:
//   build({ kind, w, h (pt), pair, margins "tight"|"normal"|"wide",
//           front { half, title, copy, ded, toc }, meta { title,
//           author, publisher, year, isbn }, now, name, t, names })
//     → a normal Layout document (model v1): its own styles and
//       masters, the first pages asked for, a chapter (or a spread of
//       pictures) to start from. t(key) gives the placeholder text in
//       the person's language, names(key) a style's { en, el } name.
// The document says what it was made from in setup.ext.start
// { v: 1, k: kind, title: the style of chapter titles } (R39), so
// Update contents works on it as on a house style's book.
//   - KINDS: [{ id, trim [w, h] mm, facing, text, front, pages }]
//   - PAIRS: [{ id, text, accent }]: the type pairs offered; "noto"
//     is built in, the others are free Fontsource families fetched on
//     first use (setup.ext.fonts lists them, designkit/fonts.js).
//   - TRIMS: the trims offered (mm).
// Pure (designkit/model.js only), testable under Node.
// Exposes LY_START (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("../designkit/model.js");
  else M = root.orosDK.model;

  var MM = 72 / 25.4;

  // id, trim (mm), facing, text kind (prose books have running heads),
  // first pages offered, accent swatch (CMYK)
  var KINDS = [
    { id: "novel", trim: [140, 210], facing: 1, prose: 1, front: 1 },
    { id: "stories", trim: [140, 210], facing: 1, prose: 1, front: 1 },
    { id: "poetry", trim: [130, 200], facing: 1, prose: 1, front: 1 },
    { id: "essay", trim: [140, 210], facing: 1, prose: 1, front: 1 },
    { id: "study", trim: [170, 240], facing: 1, prose: 1, front: 1 },
    { id: "children", trim: [215, 215], facing: 1, front: 1, acc: [0, 45, 90, 0] },
    { id: "photo", trim: [280, 220], facing: 1, front: 1, acc: [0, 0, 0, 85] },
    { id: "cookbook", trim: [180, 250], facing: 1, front: 1, acc: [0, 60, 80, 10] },
    { id: "catalogue", trim: [170, 240], facing: 1, front: 1, acc: [0, 0, 0, 70] },
    { id: "magazine", trim: [210, 297], facing: 1, acc: [0, 90, 70, 0] },
    { id: "workbook", trim: [176, 250], facing: 1, front: 1, acc: [80, 20, 0, 0] },
    { id: "zine", trim: [148, 210], facing: 1, acc: [0, 80, 0, 0] }
  ];
  // the trims offered for every kind (the kind's own is first)
  var TRIMS = [[120, 190], [130, 200], [140, 210], [148, 210], [156, 234], [170, 240], [176, 250], [180, 250], [210, 297], [215, 215], [250, 250], [280, 220]];
  // text: the running text's family; accent: titles, captions, labels.
  // fb is the built-in stand-in while a Fontsource family loads.
  var PAIRS = [
    { id: "noto", text: { id: "serif" }, accent: { id: "sans" } },
    { id: "garamond", text: { id: "fs_eb_garamond", name: "EB Garamond", fb: "serif" }, accent: { id: "fs_fira_sans", name: "Fira Sans", fb: "sans" } },
    { id: "literata", text: { id: "fs_literata", name: "Literata", fb: "serif" }, accent: { id: "fs_open_sans", name: "Open Sans", fb: "sans" } },
    { id: "alegreya", text: { id: "fs_alegreya", name: "Alegreya", fb: "serif" }, accent: { id: "fs_alegreya_sans", name: "Alegreya Sans", fb: "sans" } },
    { id: "sans", text: { id: "fs_fira_sans", name: "Fira Sans", fb: "sans" }, accent: { id: "fs_fira_sans", name: "Fira Sans", fb: "sans" } }
  ];
  var MARGINS = { tight: 0.82, normal: 1, wide: 1.2 };
  var FRONT = ["half", "title", "copy", "ded", "toc"];

  function kindOf(id) { return KINDS.filter(function (k) { return k.id === id; })[0] || null; }
  function pairOf(id) { return PAIRS.filter(function (p) { return p.id === id; })[0] || PAIRS[0]; }
  function h5(n) { return Math.round(n * 2) / 2; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // The first pages a kind starts with (defaults of the dialog).
  function frontFor(kind) {
    var k = kindOf(kind);
    if (!k || !k.front) return {};
    if (k.prose) return { half: 1, title: 1, copy: 1, ded: 0, toc: kind === "novel" || kind === "poetry" ? 0 : 1 };
    return { half: 0, title: 1, copy: 1, ded: 0, toc: kind === "cookbook" || kind === "workbook" ? 1 : 0 };
  }

  // The margins of a trim (pt) in a kind's proportions: a book's
  // inside margin is narrower than its outside, its foot deeper than
  // its head; picture books and magazines keep them even.
  function marginsFor(kind, w, h, how) {
    var f = MARGINS[how] || 1, k = kindOf(kind) || KINDS[0], m;
    if (k.prose) m = { t: h * 0.085, b: h * 0.115, i: w * 0.12, o: w * 0.145 };
    else if (kind === "magazine") m = { t: h * 0.05, b: h * 0.06, i: w * 0.07, o: w * 0.065 };
    else if (kind === "zine") m = { t: w * 0.08, b: w * 0.09, i: w * 0.08, o: w * 0.08 };
    else m = { t: Math.min(w, h) * 0.085, b: Math.min(w, h) * 0.1, i: w * 0.09, o: w * 0.085 };
    return { t: r2(m.t * f), b: r2(m.b * f), i: r2(m.i * f), o: r2(m.o * f) };
  }
  // The running text's size from the trim's width: 10 pt on 120 mm,
  // 10.5 on 140, 11 on 170, 11.5 on a magazine's 210 (never under 9
  // or over 12.5); children's books read larger.
  function bodySize(kind, w) {
    var mmw = w / MM, s = h5(8.5 + mmw * 0.0145);
    if (kind === "children") s = h5(12 + mmw * 0.03);
    if (kind === "magazine") s = h5(6.5 + mmw * 0.0145);
    return clamp(s, 9, kind === "children" ? 22 : 12.5);
  }

  // ---------- the builder ----------
  function B(o) {
    var k = kindOf(o.kind);
    this.k = k; this.kind = k.id; this.now = o.now || 1; this.t = o.t; this.names = o.names;
    this.w = o.w; this.h = o.h;
    var mg = marginsFor(k.id, o.w, o.h, o.margins);
    this.cols = k.id === "magazine" ? 3 : k.id === "cookbook" || k.id === "zine" ? 2 : 1;
    this.doc = M.newDoc({
      name: o.name, w: o.w, h: o.h, unit: "mm", bleed: 3 * MM, mt: mg.t, mb: mg.b, mi: mg.i, mo: mg.o,
      cols: this.cols, gut: r2(Math.max(4 * MM, o.w * 0.025)), facing: k.facing, pages: 1, preset: "custom"
    }, this.now);
    this.doc.pages = [];
    this.z = 0;
    this.pair = pairOf(o.pair);
    this.bs = bodySize(k.id, o.w);
    this.lead = h5(this.bs * (k.id === "children" ? 1.3 : 1.38));
    this.meta = o.meta || {};
  }
  B.prototype.nm = function (key) { return this.names(key); };
  B.prototype.tx = function (key) { return this.t(key); };
  B.prototype.fam = function (role) { return role === "accent" ? this.pair.accent : this.pair.text; };
  // a paragraph style; role "text" | "accent" sets its family
  B.prototype.ps = function (id, key, props, role) {
    var d = this.doc, s = M.find(d.pstyles, id), f = this.fam(role || "text");
    if (!s) { s = { id: id, m: this.now, name: this.nm(key) }; d.pstyles.push(s); }
    Object.keys(props).forEach(function (k) { s[k] = props[k]; });
    if (role || !props.base) {
      s.font = f.fb || f.id;
      if (f.fb) { s.ext = s.ext || {}; s.ext.fam = f.id; }
      else if (s.ext) delete s.ext.fam;
    }
    return s;
  };
  B.prototype.page = function (ms, ext) {
    var p = { id: M.newId("pg"), m: this.now, pos: (this.doc.pages.length + 1) * 1024, ms: ms || "" };
    if (ext) p.ext = ext;
    this.doc.pages.push(p);
    return p;
  };
  B.prototype.side = function (p) { return M.sideOf(this.doc, this.doc.pages.indexOf(p)); };
  // the text area of a page (or a master's side)
  B.prototype.area = function (side) {
    var mg = M.margins(this.doc, side);
    return { x: mg.l, y: mg.t, w: this.w - mg.l - mg.r, h: this.h - mg.t - mg.b };
  };
  B.prototype.item = function (pg, t, x, y, w, h, extra) {
    var it = { id: M.newId("it"), m: this.now, t: t, pg: pg, x: r2(x), y: r2(y), w: r2(w), h: r2(h), z: ++this.z * 1024 };
    Object.keys(extra || {}).forEach(function (k) { it[k] = extra[k]; });
    this.doc.items.push(it);
    return it;
  };
  // paras: [[style, text or [runs]]] (text may hold \n: one paragraph per line)
  B.prototype.story = function (paras, ext) {
    var st = { id: M.newId("st"), m: this.now, h: [], paras: [] };
    paras.forEach(function (p) {
      if (Array.isArray(p[1])) { st.paras.push({ ps: p[0], runs: p[1] }); return; }
      String(p[1]).split("\n").forEach(function (line) { st.paras.push({ ps: p[0], runs: line ? [{ t: line }] : [] }); });
    });
    if (ext) st.ext = ext;
    this.doc.stories.push(st);
    return st;
  };
  B.prototype.text = function (pg, x, y, w, h, paras, extra) {
    var st = this.story(paras, extra && extra.sx);
    extra = extra || {};
    delete extra.sx;
    extra.story = st.id; extra.seq = 1024;
    return this.item(pg, "text", x, y, w, h, extra);
  };
  B.prototype.cont = function (prev, pg, x, y, w, h, extra) {
    extra = extra || {}; extra.story = prev.story; extra.seq = prev.seq + 1024;
    return this.item(pg, "text", x, y, w, h, extra);
  };
  B.prototype.img = function (pg, x, y, w, h) { return this.item(pg, "img", x, y, w, h); };
  // a picture over the whole page and its bleed
  // fill: a colour under it, so white type on it reads before a picture is placed
  B.prototype.bleedImg = function (p, fill) {
    var b = this.doc.setup.bleed;
    if (fill) this.rect(p.id, -b, -b, this.w + 2 * b, this.h + 2 * b, fill);
    return this.img(p.id, -b, -b, this.w + 2 * b, this.h + 2 * b);
  };
  B.prototype.rect = function (pg, x, y, w, h, fill) { return this.item(pg, "rect", x, y, w, h, { fill: fill, sw: 0 }); };
  // a body text frame on each of these pages, threaded
  B.prototype.flow = function (pages, paras, extra) {
    var f = null, self = this;
    pages.forEach(function (p) {
      var a = self.area(self.side(p)), x = JSON.parse(JSON.stringify(extra || {}));
      f = f ? self.cont(f, p.id, a.x, a.y, a.w, a.h, x) : self.text(p.id, a.x, a.y, a.w, a.h, paras, x);
    });
    return f;
  };
  B.prototype.lorem = function (n, first, rest) {
    var out = [];
    for (var i = 0; i < n; i++) out.push([i === 0 && first ? first : rest || "ps-body", this.tx(i % 3 === 0 ? "sx.p1" : i % 3 === 1 ? "sx.p2" : "sx.p3")]);
    return out;
  };

  // ---------- styles ----------
  B.prototype.styles = function () {
    var bs = this.bs, ld = this.lead, k = this.k, prose = !!k.prose;
    this.ps("ps-base", "seed.ps-base", { size: bs, lead: ld, align: "l", color: "sw-black", ext: { kern: 1, hyph: 1 } }, "text");
    this.ps("ps-body", "seed.ps-body", { base: "ps-base", align: prose && this.kind !== "poetry" ? "j" : "l", sa: prose ? 0 : h5(ld * 0.45), fi: prose ? h5(bs * 1.4) : 0, ext: { orph: 2, wid: 2 } });
    this.ps("ps-sfirst", "sk.st.first", { base: "ps-body", fi: 0 });
    var big = h5(bs * (prose ? 1.9 : 2.4));
    this.ps("ps-chap", "sk.st.chap", { base: "ps-base", size: big, lead: h5(big * 1.15), align: prose ? "c" : "l", sa: h5(ld * 2), b: prose ? 0 : 1, ext: { brk: this.kind === "poetry" ? "page" : "odd", sink: r2((this.h * 0.3)), sec: 1, kwn: 1, hyph: 0 } }, prose ? "text" : "accent");
    this.ps("ps-h2", "seed.ps-h2", { base: "ps-base", size: h5(bs * 1.25), lead: h5(bs * 1.6), b: 1, align: "l", sb: ld, sa: h5(ld * 0.5), ext: { kwn: 1, hyph: 0 } }, "accent");
    this.ps("ps-h3", "seed.ps-h3", { base: "ps-base", size: bs, lead: ld, b: 1, sb: h5(ld * 0.6), sa: h5(ld * 0.25), ext: { kwn: 1, hyph: 0 } }, "accent");
    this.ps("ps-cap", "seed.ps-cap", { base: "ps-base", size: h5(Math.max(7, bs - 2)), lead: h5(Math.max(9, bs * 1.15)), i: 1, sb: 4, ext: { hyph: 0 } }, "accent");
    this.ps("ps-quote", "seed.ps-quote", { base: "ps-base", size: h5(bs - 0.5), lead: h5((bs - 0.5) * 1.35), li: h5(bs * 2), ri: h5(bs * 2), sb: h5(ld * 0.6), sa: h5(ld * 0.6), align: "l", fi: 0 }, "text");
    this.ps("ps-folio", "sk.st.folio", { base: "ps-base", size: h5(Math.max(7, bs - 1.5)), lead: h5(Math.max(9, bs)), align: "c", fi: 0, ext: { hyph: 0 } }, prose ? "text" : "accent");
    this.ps("ps-rh", "sk.st.rh", { base: "ps-folio", caps: 1, track: 60, size: h5(Math.max(6.5, bs - 2.5)) });
    this.ps("ps-sep", "sk.st.sep", { base: "ps-base", align: "c", fi: 0, sb: ld, sa: ld });
    // the first pages
    this.ps("ps-half", "sk.st.half", { base: "ps-base", size: h5(bs * 1.5), lead: h5(bs * 1.8), align: "c", caps: 1, track: 80, ext: { hyph: 0 } }, prose ? "text" : "accent");
    this.ps("ps-ttitle", "sk.st.ttitle", { base: "ps-base", size: h5(bs * 2.6), lead: h5(bs * 3), align: "c", sa: h5(ld), b: prose ? 0 : 1, ext: { hyph: 0 } }, prose ? "text" : "accent");
    this.ps("ps-tauth", "sk.st.tauth", { base: "ps-base", size: h5(bs * 1.3), lead: h5(bs * 1.7), align: "c", sa: h5(ld * 3), ext: { hyph: 0 } }, prose ? "text" : "accent");
    this.ps("ps-tpub", "sk.st.tpub", { base: "ps-base", size: h5(bs - 1), lead: h5(bs * 1.3), align: "c", caps: 1, track: 100, ext: { hyph: 0 } }, "accent");
    this.ps("ps-copy", "sk.st.copy", { base: "ps-base", size: h5(Math.max(7, bs - 2.5)), lead: h5(Math.max(9, (bs - 2.5) * 1.4)), align: "l", sa: 3, ext: { hyph: 0 } }, "text");
    this.ps("ps-ded", "sk.st.ded", { base: "ps-base", i: 1, align: "c", ext: { hyph: 0 } }, "text");
    this.ps("ps-toch", "sk.st.toch", { base: "ps-chap", size: h5(bs * 1.5), lead: h5(bs * 1.8), sa: h5(ld * 1.5), ext: { brk: "any", sink: 0, sec: 0, hyph: 0 } });
    var area = this.area("R");
    this.ps("ps-toc", "sk.st.toc", { base: "ps-base", align: "l", fi: 0, sa: h5(ld * 0.3), ext: { tabs: [r2(area.w - bs * 2)], hyph: 0 } }, "text");
  };

  // ---------- masters ----------
  // A: page numbers (and running heads in a prose book); O: page
  // numbers only, for the pages a chapter opens.
  B.prototype.masters = function () {
    var d = this.doc, self = this, heads = this.k.prose && this.kind !== "poetry";
    d.masters = [
      { id: "ms-a", m: this.now, name: this.nm("sk.ms.a"), pre: "A" },
      { id: "ms-o", m: this.now, name: this.nm("sk.ms.o"), pre: "O" }
    ];
    if (!this.k.prose) {
      this.ps("ps-foliol", "sk.st.folio", { base: "ps-folio", align: "l" });
      this.ps("ps-folior", "sk.st.folio", { base: "ps-folio", align: "r" });
    }
    var sides = d.setup.facing ? ["L", "R"] : [""];
    ["ms-a", "ms-o"].forEach(function (ms) {
      sides.forEach(function (sd) {
        var a = self.area(sd || "R"), mg = M.margins(d, sd || "R"), fh = self.lead * 1.2;
        var y = self.h - mg.b + (mg.b - fh) * 0.45;
        // a prose book's numbers are centred, the others' on the outside
        var ps = self.k.prose ? "ps-folio" : sd === "L" ? "ps-foliol" : "ps-folior";
        var it = self.text(ms, a.x, y, a.w, fh, [[ps, [{ f: "pn" }]]]);
        if (sd) it.side = sd;
        if (ms !== "ms-a" || !heads) return;
        // running heads: the book's title on the left, the chapter's on the right (LY-RH)
        var run = sd === "L" ? { t: self.meta.title || self.tx("sx.title") } : { t: self.tx("sx.chap"), ext: { fld: "sec" } };
        var hi = self.text(ms, a.x, Math.max(4, mg.t - self.lead * 2.2), a.w, self.lead * 1.2, [["ps-rh", [run]]], { ext: { rh: 1 } });
        if (sd) hi.side = sd;
      });
    });
  };

  // ---------- the first pages ----------
  // In a facing book every one of them is a right-hand page with its
  // back (the copyright page, else blank) after it, so the first
  // chapter opens on a right-hand page too.
  B.prototype.front = function (want) {
    var self = this, d = this.doc, m = this.meta, fac = d.setup.facing;
    var title = m.title || this.tx("sx.title"), author = m.author || this.tx("sx.author");
    var publisher = m.publisher || this.tx("sx.publisher"), year = m.year || "";
    var make = {
      half: function (p) { var a = self.area(self.side(p)); self.text(p.id, a.x, a.y + a.h * 0.25, a.w, a.h * 0.75, [["ps-half", title]]); },
      title: function (p) {
        var a = self.area(self.side(p));
        self.text(p.id, a.x, a.y + a.h * 0.12, a.w, a.h * 0.6, [["ps-tauth", author], ["ps-ttitle", title]].concat(m.subtitle ? [["ps-tauth", m.subtitle]] : []));
        self.text(p.id, a.x, a.y + a.h * 0.86, a.w, a.h * 0.14, [["ps-tpub", publisher]], { va: "b" });
      },
      copy: function (p) {
        var a = self.area(self.side(p));
        self.text(p.id, a.x, a.y + a.h * 0.55, a.w, a.h * 0.45, [
          ["ps-copy", [{ t: title, b: 1 }]], ["ps-copy", author],
          ["ps-copy", "\u00a9 " + (year ? year + " " : "") + author], ["ps-copy", self.tx("sx.rights")],
          ["ps-copy", m.isbn ? "ISBN " + m.isbn : self.tx("sx.isbn")], ["ps-copy", publisher]
        ], { va: "b" });
      },
      ded: function (p) { var a = self.area(self.side(p)); self.text(p.id, a.x, a.y + a.h * 0.28, a.w, a.h * 0.72, [["ps-ded", self.tx("sx.ded")]]); },
      toc: function (p) {
        var a = self.area(self.side(p));
        self.tocFrame = self.text(p.id, a.x, a.y, a.w, a.h, [["ps-toch", self.tx("sx.toc")], ["ps-toc", self.tx("sx.chap") + "\t1"]], { sx: { hs: "toc" } });
      }
    };
    // right-hand pages, each with its back: the copyright page goes on
    // the back of the title page (else of the half-title, else on its own)
    var rectos = [];
    if (want.half) rectos.push({ k: "half" });
    if (want.title) rectos.push({ k: "title", back: want.copy ? "copy" : "" });
    else if (want.copy) { if (rectos.length) rectos[rectos.length - 1].back = "copy"; else rectos.push({ k: "copy" }); }
    if (want.ded) rectos.push({ k: "ded" });
    if (want.toc) rectos.push({ k: "toc" });
    rectos.forEach(function (r) {
      make[r.k](self.page(""));
      if (r.back) make[r.back](self.page(""));
      else if (fac) self.page("");
    });
  };

  // ---------- the kinds ----------
  B.prototype.prose = function () {
    var kind = this.kind, n = kind === "poetry" ? 4 : kind === "study" ? 5 : 3, pages = [], i;
    for (i = 0; i < n; i++) pages.push(this.page(i === 0 ? "ms-o" : "ms-a"));
    var paras = [];
    if (kind === "study") paras.push(["ps-chno", "1"]);
    paras.push(["ps-chap", this.tx(kind === "stories" ? "sx.story" : kind === "poetry" ? "sx.poem" : "sx.chap")]);
    if (kind === "poetry") {
      this.ps("ps-verse", "sk.st.verse", { base: "ps-body", align: "l", fi: 0, li: h5(this.bs * 2.5), sa: 0, ext: { hyph: 0, orph: 1, wid: 1 } });
      for (var p = 0; p < n; p++) {
        if (p) paras.push(["ps-chap", this.tx("sx.poem") + " " + (p + 1)]);
        [this.tx("sx.v1"), this.tx("sx.v2"), "", this.tx("sx.v3"), this.tx("sx.v4")].forEach(function (v) { paras.push(["ps-verse", v]); });
      }
    } else {
      if (kind === "study") this.ps("ps-chno", "sk.st.chno", { base: "ps-chap", size: h5(this.bs * 3), lead: h5(this.bs * 3.2), sa: h5(this.lead * 0.5), ext: { brk: "odd", sink: r2(this.h * 0.24), sec: 0, kwn: 1 } }, "accent");
      paras = paras.concat(this.lorem(5, "ps-sfirst"));
      if (kind === "essay" || kind === "study") { paras.push(["ps-h2", this.tx(kind === "study" ? "sx.sec1" : "sx.sec")]); paras = paras.concat(this.lorem(3, "ps-sfirst")); paras.push(["ps-quote", this.tx("sx.quote")]); }
      if (kind === "study") { paras.push(["ps-h3", this.tx("sx.sec2")]); paras = paras.concat(this.lorem(3, "ps-sfirst")); }
      if (kind === "novel" || kind === "stories") { paras.push(["ps-sep", "*"]); paras = paras.concat(this.lorem(6, "ps-sfirst")); }
      else paras = paras.concat(this.lorem(4));
    }
    this.flow(pages, paras);
    return pages[0];
  };
  B.prototype.children = function () {
    var self = this, first = null, s = this.doc.setup;
    this.ps("ps-tale", "sk.st.tale", { base: "ps-body", align: "c", sa: h5(this.lead * 0.5) }, "accent");
    first = this.page("");
    var fa = this.area(this.side(first));
    this.text(first.id, fa.x, fa.y + fa.h * 0.3, fa.w, fa.h * 0.7, [["ps-ttitle", this.meta.title || this.tx("sx.title")], ["ps-tauth", this.meta.author || this.tx("sx.author")]]);
    for (var i = 0; i < 6; i++) {
      var l = this.page(""), r = this.page("ms-a");
      this.bleedImg(l);
      var a = this.area(this.side(r));
      this.img(r.id, -s.bleed, -s.bleed, this.w + 2 * s.bleed, this.h * 0.62 + s.bleed);
      this.text(r.id, a.x, this.h * 0.62 + a.y * 0.6, a.w, this.h * 0.38 - a.y * 0.6 - s.mb, [["ps-tale", this.tx(i % 2 ? "sx.kid2" : "sx.kid1")]], { va: "c" });
    }
    return first;
  };
  B.prototype.photo = function () {
    var first = null, g = this.doc.setup.gut;
    this.ps("ps-pcap", "sk.st.pcap", { base: "ps-cap", i: 0, size: h5(Math.max(7, this.bs - 2)) }, "accent");
    first = this.page("ms-o");
    var ia = this.area(this.side(first));
    this.text(first.id, ia.x, ia.y, ia.w, ia.h, [["ps-chap", this.tx("sx.photos")]].concat(this.lorem(2, "ps-sfirst")));
    for (var i = 0; i < 3; i++) {
      var l = this.page(""), r = this.page("ms-a");
      this.bleedImg(l);
      var a = this.area(this.side(r)), cap = this.lead * 2;
      if (i === 1) {
        var hw = (a.h - cap - g) / 2;
        this.img(r.id, a.x, a.y, a.w, hw);
        this.img(r.id, a.x, a.y + hw + g, a.w, hw);
      } else this.img(r.id, a.x, a.y, a.w, a.h - cap - g);
      this.text(r.id, a.x, a.y + a.h - cap, a.w, cap, [["ps-pcap", this.tx("sx.pcap")]], { va: "b" });
    }
    return first;
  };
  B.prototype.cookbook = function () {
    var self = this, first = null;
    this.ps("ps-rmeta", "sk.st.rmeta", { base: "ps-cap", i: 0, caps: 1, track: 60, sa: h5(this.lead) }, "accent");
    this.ps("ps-ingr", "sk.st.ingr", { base: "ps-body", sa: 2, bul: 1, fi: 0 });
    this.ps("ps-step", "sk.st.step", { base: "ps-body", sa: h5(this.lead * 0.4) });
    var op = this.page("ms-o"), oa = this.area(this.side(op));
    first = op;
    this.text(op.id, oa.x, oa.y, oa.w, oa.h, [["ps-chap", this.tx("sx.course")], ["ps-sfirst", this.tx("sx.p1")]], { cols: 1 });
    for (var i = 0; i < 2; i++) {
      var l = this.page(""), r = this.page("ms-a");
      this.bleedImg(l);
      var a = this.area(this.side(r)), paras = [["ps-chap", this.tx("sx.recipe") + " " + (i + 1)], ["ps-rmeta", this.tx("sx.serves")], ["ps-sfirst", this.tx("sx.p2")], ["ps-h3", this.tx("sx.ingr")]];
      for (var k = 1; k <= 6; k++) paras.push(["ps-ingr", this.tx("sx.ingr" + ((k % 3) + 1))]);
      paras.push(["ps-h3", this.tx("sx.method")]);
      for (k = 1; k <= 4; k++) paras.push(["ps-step", k + ". " + this.tx(k % 2 ? "sx.step1" : "sx.step2")]);
      this.text(r.id, a.x, a.y, a.w, a.h, paras, { cols: 2, gut: this.doc.setup.gut });
    }
    this.doc.pstyles.forEach(function (s) { if (s.id === "ps-chap") { s.ext.sink = 0; s.ext.brk = "any"; } });
    return first;
  };
  B.prototype.catalogue = function () {
    var first = null;
    this.ps("ps-artist", "sk.st.artist", { base: "ps-cap", i: 0, b: 1, size: this.bs, sb: h5(this.lead * 0.6) }, "accent");
    this.ps("ps-work", "sk.st.work", { base: "ps-cap", i: 1, size: h5(this.bs - 1), sb: 0 }, "accent");
    var intro = this.page("ms-o"), pg2 = this.page("ms-a");
    first = intro;
    this.flow([intro, pg2], [["ps-chap", this.tx("sx.exhib")]].concat(this.lorem(6, "ps-sfirst")));
    for (var i = 0; i < 6; i++) {
      var p = this.page("ms-a"), a = this.area(this.side(p)), cap = this.lead * 4;
      this.img(p.id, a.x, a.y, a.w, a.h - cap);
      this.text(p.id, a.x, a.y + a.h - cap, a.w, cap, [["ps-artist", this.tx("sx.artist")], ["ps-work", this.tx("sx.work") + ", " + (2001 + i)], ["ps-work", this.tx("sx.medium")]], { va: "b" });
    }
    this.doc.pstyles.forEach(function (s) { if (s.id === "ps-chap") { s.ext.sink = r2(s.ext.sink * 0.6); } });
    return first;
  };
  B.prototype.magazine = function () {
    var s = this.doc.setup, g = s.gut;
    this.swatch("sw-acc", [0, 90, 70, 0]);
    this.ps("ps-mast", "sk.st.mast", { base: "ps-base", size: h5(this.w * 0.115), lead: h5(this.w * 0.12), b: 1, align: "c", color: "sw-paper", ext: { hyph: 0 } }, "accent");
    this.ps("ps-cline", "sk.st.cline", { base: "ps-base", size: h5(this.bs * 1.8), lead: h5(this.bs * 2.1), b: 1, color: "sw-paper", sa: h5(this.lead), ext: { hyph: 0 } }, "accent");
    this.ps("ps-stand", "sk.st.stand", { base: "ps-base", size: h5(this.bs * 1.35), lead: h5(this.bs * 1.75), sa: h5(this.lead), ext: { hyph: 0 } }, "text");
    this.ps("ps-pull", "sk.st.pull", { base: "ps-stand", size: h5(this.bs * 1.6), lead: h5(this.bs * 2), color: "sw-acc", sb: h5(this.lead), sa: h5(this.lead), align: "l", ext: { hyph: 0, orph: 9, wid: 9 } }, "accent");
    var cover = this.page("");
    this.bleedImg(cover, "sw-acc");
    var ca = this.area("R");
    this.text(cover.id, ca.x, ca.y, ca.w, this.w * 0.2, [["ps-mast", this.tx("sx.mag")]]);
    this.text(cover.id, ca.x, ca.y + ca.h * 0.6, ca.w * 0.6, ca.h * 0.4, [["ps-cline", this.tx("sx.cline1")], ["ps-cline", this.tx("sx.cline2")]], { va: "b" });
    var cont = this.page("ms-a"), ed = this.page("ms-a"), a1 = this.area("L"), a2 = this.area("R");
    this.text(cont.id, a1.x, a1.y, a1.w, a1.h, [["ps-chap", this.tx("sx.toc")], ["ps-toc", this.tx("sx.feat") + "\t4"], ["ps-toc", this.tx("sx.sec") + "\t6"]], { sx: { hs: "toc" } });
    this.text(ed.id, a2.x, a2.y, a2.w, a2.h, [["ps-chap", this.tx("sx.edit")]].concat(this.lorem(4, "ps-sfirst")), { cols: 2, gut: g });
    var fl = this.page(""), fr = this.page("ms-a"), last = this.page("ms-a");
    this.bleedImg(fl);
    var ar = this.area("R"), top = ar.h * 0.3;
    this.text(fr.id, ar.x, ar.y, ar.w, top, [["ps-chap", this.tx("sx.feat")], ["ps-stand", this.tx("sx.p2")]]);
    var body = this.lorem(10, "ps-sfirst");
    body.splice(5, 0, ["ps-pull", this.tx("sx.quote")]);
    var f = this.text(fr.id, ar.x, ar.y + top, ar.w, ar.h - top, body, { cols: 3, gut: g });
    var al = this.area("L");
    this.cont(f, last.id, al.x, al.y, al.w, al.h, { cols: 3, gut: g });
    this.doc.pstyles.forEach(function (st) { if (st.id === "ps-chap") { st.ext.sink = 0; st.ext.brk = "any"; } });
    return cover;
  };
  B.prototype.workbook = function () {
    var self = this;
    this.swatch("sw-acc", [80, 20, 0, 0]);
    this.swatch("sw-tint", [12, 3, 0, 0]);
    this.ps("ps-goal", "sk.st.goal", { base: "ps-body", fi: 0, sa: 3 }, "accent");
    this.ps("ps-task", "sk.st.task", { base: "ps-h3", color: "sw-acc" });
    var op = this.page("ms-o"), p2 = this.page("ms-a"), p3 = this.page("ms-a"), p4 = this.page("ms-a");
    var a = this.area(this.side(op)), box = this.lead * 6;
    this.rect(op.id, a.x, a.y + this.h * 0.24, a.w, box, "sw-tint");
    this.text(op.id, a.x + this.bs, a.y + this.h * 0.24 + this.bs * 0.8, a.w - 2 * this.bs, box - 1.6 * this.bs, [["ps-h3", this.tx("sx.goals")], ["ps-goal", this.tx("sx.goal1")], ["ps-goal", this.tx("sx.goal2")]]);
    var paras = [["ps-chap", this.tx("sx.lesson")]].concat(this.lorem(4, "ps-sfirst"));
    paras.push(["ps-h2", this.tx("sx.sec")]);
    paras = paras.concat(this.lorem(4));
    paras.push(["ps-task", this.tx("sx.task")], ["ps-body", this.tx("sx.step1")]);
    var f = this.text(op.id, a.x, a.y + this.h * 0.24 + box + this.lead, a.w, a.h - this.h * 0.24 - box - this.lead, paras);
    [p2, p3].forEach(function (p) { var q = self.area(self.side(p)); f = self.cont(f, p.id, q.x, q.y, q.w, q.h); });
    this.doc.pstyles.forEach(function (st) { if (st.id === "ps-chap") { st.ext.sink = 0; } });
    // a page to write on
    var w = this.area(this.side(p4));
    this.text(p4.id, w.x, w.y, w.w, this.lead * 2, [["ps-h2", this.tx("sx.notes")]]);
    for (var y = w.y + this.lead * 3; y < w.y + w.h; y += this.lead * 1.6) this.item(p4.id, "line", w.x, y, w.w, 0, { stroke: "sw-gray", sw: 0.4 });
    return op;
  };
  B.prototype.zine = function () {
    var s = this.doc.setup, g = s.gut;
    this.swatch("sw-acc", [0, 80, 0, 0]);
    this.ps("ps-ztitle", "sk.st.ztitle", { base: "ps-base", size: h5(this.w * 0.12), lead: h5(this.w * 0.12), b: 1, color: "sw-paper", ext: { hyph: 0 } }, "accent");
    var cover = this.page(""), ca = this.area("R");
    this.bleedImg(cover, "sw-black");
    this.text(cover.id, ca.x, ca.y + ca.h * 0.55, ca.w, ca.h * 0.45, [["ps-ztitle", this.tx("sx.zine")]], { va: "b" });
    var pages = [];
    for (var i = 0; i < 6; i++) pages.push(this.page("ms-a"));
    var self = this;
    pages.forEach(function (p, k) {
      var a = self.area(self.side(p));
      if (k % 2 === 0) self.img(p.id, a.x, a.y, a.w, a.h * 0.45);
    });
    var f = null;
    pages.forEach(function (p, k) {
      var a = self.area(self.side(p)), top = k % 2 === 0 ? a.h * 0.45 + g : 0;
      var x = { cols: 2, gut: g };
      f = f ? self.cont(f, p.id, a.x, a.y + top, a.w, a.h - top, x) : self.text(p.id, a.x, a.y + top, a.w, a.h - top, [["ps-chap", self.tx("sx.feat")]].concat(self.lorem(12, "ps-sfirst")), x);
    });
    var back = this.page(""), ba = this.area(this.side(back));
    this.rect(back.id, -s.bleed, -s.bleed, this.w + 2 * s.bleed, this.h + 2 * s.bleed, "sw-acc");
    this.text(back.id, ba.x, ba.y, ba.w, ba.h, [["ps-tpub", this.tx("sx.publisher")]], { va: "b" });
    this.doc.pstyles.forEach(function (st) { if (st.id === "ps-chap") { st.ext.sink = 0; st.ext.brk = "any"; } });
    return cover;
  };
  B.prototype.swatch = function (id, v) {
    if (M.find(this.doc.swatches, id)) return;
    this.doc.swatches.push({ id: id, m: this.now, name: this.nm("sk.sw." + id.slice(3)), mode: "cmyk", v: v });
  };

  // The contents' first entry points at the page the book opens on.
  B.prototype.fixToc = function (opener) {
    if (!this.tocFrame || !opener) return;
    var st = M.find(this.doc.stories, this.tocFrame.story), labels = M.pageLabels(this.doc), at = "";
    labels.forEach(function (l) { if (l.id === opener.id) at = l.label; });
    if (st && st.paras[1]) st.paras[1].runs = [{ t: this.tx(this.kind === "cookbook" ? "sx.course" : this.kind === "workbook" ? "sx.lesson" : this.kind === "stories" ? "sx.story" : this.kind === "poetry" ? "sx.poem" : this.kind === "catalogue" ? "sx.exhib" : "sx.chap") + "\t" + at }];
  };

  // opts: see the head of this file → a document, or null for an
  // unknown kind
  function build(opts) {
    opts = opts || {};
    var k = kindOf(opts.kind);
    if (!k) return null;
    var w = Number(opts.w) || k.trim[0] * MM, h = Number(opts.h) || k.trim[1] * MM;
    w = clamp(w, 72, 14400); h = clamp(h, 72, 14400);
    var t = typeof opts.t === "function" ? opts.t : function (key) { return key; };
    var names = typeof opts.names === "function" ? opts.names : function (key) { return { en: key, el: key }; };
    var b = new B({ kind: k.id, w: w, h: h, pair: opts.pair, margins: opts.margins, meta: opts.meta, now: opts.now, name: String(opts.name || (opts.meta && opts.meta.title) || t("sk." + k.id)).slice(0, 120), t: t, names: names });
    b.styles();
    b.masters();
    var want = {};
    if (k.front) {
      var f = opts.front || frontFor(k.id);
      FRONT.forEach(function (key) { if (f[key]) want[key] = 1; });
    }
    b.front(want);
    var opener = k.prose ? b.prose() : b[k.id]();
    b.fixToc(opener);
    // the families the styles name (designkit/fonts.js)
    var d = b.doc, fonts = [], seen = {};
    [b.pair.text, b.pair.accent].forEach(function (f) { if (f.fb && !seen[f.id]) { seen[f.id] = 1; fonts.push({ id: f.id, name: f.name, fb: f.fb }); } });
    d.setup.ext = d.setup.ext || {};
    if (fonts.length) d.setup.ext.fonts = fonts;
    d.setup.ext.start = { v: 1, k: k.id, title: "ps-chap" };
    if (opts.cmyk) { d.setup.ext.cm = "cmyk"; d.setup.ext.icc = "fogra39"; }
    d.setup.preset = "custom";
    M.PRESETS.forEach(function (p) {
      if (d.setup.preset !== "custom") return;
      if (Math.abs(p[1] * MM - w) < 0.6 && Math.abs(p[2] * MM - h) < 0.6) d.setup.preset = p[0];
    });
    return M.normDoc(d);
  }

  var api = { KINDS: KINDS, PAIRS: PAIRS, TRIMS: TRIMS, FRONT: FRONT, MARGINS: MARGINS, kindOf: kindOf, frontFor: frontFor, marginsFor: marginsFor, bodySize: bodySize, build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_START = api;
})(typeof window !== "undefined" ? window : this);
