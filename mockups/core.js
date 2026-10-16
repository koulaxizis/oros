// ============================================================
// orOS Mockups — core.js (MockCore, v1.3.0)
// Pure model of the Mockups app. No DOM, no three.js: Node-tested
// in tests/mockups.test.js.
//   - book sizes in mm: trim presets, paper presets, spine width
//     from the page count (pages × thickness of one page)
//   - dims(bk): every measure of the 3D book (block, boards,
//     overhang, cover, hinge, flaps)
//   - profile(bk): the cross-section (seen from the top) of the
//     printed cover and of the hardcover case, as polylines in mm,
//     with per-point thickness, outward normals and the arc length
//     of every point. The printed picture is laid along that arc,
//     so a cover picture follows the book exactly and a full wrap
//     (back + spine + front, with flaps) is split by the real spine
//   - layout(bk): the panels of that picture (flap, back, spine,
//     front, flap) in mm, for composing separate pictures
//   - sets: one book, a front + back pair, a series side by side,
//     a shelf of spines or a stack; volume(p, i) gives book i of
//     the set (its own pages and pictures, or the first book's),
//     setList(p) how each one stands
//   - motion settings (turntable video / GIF) and the credit of a
//     background photo from an open library
//   - template(bk, art, tpl): the cover sheet for the printer
//     (trim, bleed or hardcover wrap, spine, hinges, flaps, safe
//     zone, barcode spot) in mm, as print-on-demand services and
//     local printers ask for it; wrapMap() tells the 3D view which
//     part of a full-wrap picture goes on which panel, so a cover
//     drawn on the template sits exactly on the book
//   - what to show: the closed book (and sets), the open book with
//     its inside spread (openCurve(): the arched pages, dipping into
//     the gutter) or the e-book on a tablet, phone or e-reader
//     (device(): body and screen in mm)
//   - the project model and its merge (synced slice "mockups")
// Data (localStorage "oros-mockups-data"):
//   { ver: 1, prj: [project], tombs: { id: m } }
// LWW per project by m (equal m: larger canonical JSON), tombstones
// remove what is not newer (delete wins ties, a newer edit comes
// back), sorted by id (R5, R17, R26). Pictures are ids of files on
// the orOS disk (/internal/Assets/<sha256>.<jpg|png>, R30), never
// bytes.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.3.0";
  var DATA_VER = 1;
  var DATA_KEY = "oros-mockups-data";
  var PREFS_KEY = "oros-mockups-prefs";
  var MAX_PRJ = 200;
  var ID_RE = /^k[0-9a-z]{6,24}$/;
  var ASSET_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  var HEX_RE = /^#[0-9a-f]{6}$/;
  var MM_PER_IN = 25.4;

  // ---------- Presets ----------
  // Trim sizes (width × height, mm).
  var TRIMS = [
    { k: "a5", w: 148, h: 210, n: "A5" },
    { k: "b", w: 129, h: 198, n: "B-format" },
    { k: "us6x9", w: 152.4, h: 228.6, n: "6 × 9″" },
    { k: "us55x85", w: 139.7, h: 215.9, n: "5.5 × 8.5″" },
    { k: "us5x8", w: 127, h: 203.2, n: "5 × 8″" },
    { k: "royal", w: 156, h: 234, n: "Royal" },
    { k: "pocket", w: 108, h: 175, n: "Pocket" },
    { k: "a6", w: 105, h: 148, n: "A6" },
    { k: "a4", w: 210, h: 297, n: "A4" },
    { k: "letter", w: 215.9, h: 279.4, n: "8.5 × 11″" },
    { k: "sq21", w: 210, h: 210, n: "21 × 21" },
    { k: "kids", w: 216, h: 216, n: "8.5 × 8.5″" },
    { k: "land", w: 279.4, h: 215.9, n: "11 × 8.5″" }
  ];
  // Thickness of ONE page (half a sheet), mm. White and cream follow
  // the figures print-on-demand services publish (0.002252″ and
  // 0.0025″ per page).
  var PAPERS = [
    { k: "white", c: 0.0572 },
    { k: "cream", c: 0.0635 },
    { k: "color", c: 0.0596 },
    { k: "coated", c: 0.05 },
    { k: "bulky", c: 0.075 },
    { k: "custom", c: 0 }
  ];
  var BINDS = ["pb", "hc"];
  var FINISH = ["matte", "gloss", "soft"];
  var EDGES = ["white", "cream", "color"];
  var PLACES = ["stand", "lie", "lean"];
  var BGS = ["none", "solid", "grad", "photo"];
  var RATIOS = ["1:1", "4:5", "3:2", "4:3", "16:9", "9:16"];
  var SIZES = [1024, 2048, 3000, 4096];
  var FMTS = ["png", "jpg", "webp"];
  var ART_MODES = ["parts", "wrap"];
  var SLOTS = ["front", "back", "spine", "flapF", "flapB", "wrap"];
  var VOL_SLOTS = ["front", "back", "spine", "wrap"];
  var SETS = ["one", "pair", "row", "shelf", "stack"];
  var MAX_VOLS = 5;                     // books after the first one
  var GAP_DEF = { one: 0, pair: 24, row: 14, shelf: 1, stack: 0 };
  var MOTIONS = ["spin", "swing"];
  var SECS = [4, 6, 8, 12];
  var VSIZES = [720, 1080];
  var VFMTS = ["video", "gif"];
  var CR_SRC = ["openverse", "commons", "pixabay", "pexels"];
  // Stack: each book a little turned and pushed, so it looks laid by hand.
  var SHOWS = ["book", "open", "ebook"];
  var DEVICES = ["tablet", "phone", "reader"];
  var DCOLS = ["black", "white", "silver"];
  var IN_SLOTS = ["l", "r", "scr"];        // left page, right page, screen
  var STACK_YAW = [0, 7, -5, 9, -8, 4];
  var STACK_DX = [0, 4, -3, 5, -4, 2];

  var LIMIT = {
    w: [40, 600], h: [40, 600], pages: [4, 2000], cal: [0.02, 0.3],
    spine: [0, 150], flapW: [30, 200], bleed: [0, 25],
    turn: [-180, 180], open: [0, 160], th: [-180, 180], ph: [-10, 89],
    fov: [8, 70], zoom: [0.5, 3], dx: [-1, 1], dy: [-1, 1],
    az: [-180, 180], el: [10, 85], str: [0, 2], soft: [0, 1], warm: [-1, 1],
    shadow: [0, 1], ang: [0, 359], n: [2, 6], gap: [0, 80], safe: [0, 20], curl: [0, 1], pdfp: [1, 9999]
  };

  // ---------- Helpers ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function num(v, lim, def, step) {
    var n = typeof v === "number" && isFinite(v) ? v : def;
    if (n < lim[0]) n = lim[0];
    if (n > lim[1]) n = lim[1];
    var s = step || 0.01;
    return Math.round(n / s) * s === 0 ? 0 : +(Math.round(n / s) * s).toFixed(4);
  }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function hex(v, def) { return typeof v === "string" && HEX_RE.test(v.toLowerCase()) ? v.toLowerCase() : def; }
  function bit(v) { return v === 1 || v === true ? 1 : 0; }
  function asset(v) { return typeof v === "string" && ASSET_RE.test(v) ? v : ""; }
  function str(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  // Stable JSON: keys sorted at every level.
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function trimOf(k) { for (var i = 0; i < TRIMS.length; i++) if (TRIMS[i].k === k) return TRIMS[i]; return null; }
  function paperOf(k) { for (var i = 0; i < PAPERS.length; i++) if (PAPERS[i].k === k) return PAPERS[i]; return PAPERS[0]; }
  function mmToIn(mm) { return mm / MM_PER_IN; }
  function inToMm(i) { return i * MM_PER_IN; }

  // ---------- Book model ----------
  function normBook(b) {
    b = b && typeof b === "object" ? b : {};
    var o = {};
    o.w = num(b.w, LIMIT.w, 148, 0.1);
    o.h = num(b.h, LIMIT.h, 210, 0.1);
    var trim = typeof b.trim === "string" && (b.trim === "custom" || trimOf(b.trim)) ? b.trim : "custom";
    if (trim !== "custom") { var tr = trimOf(trim); if (Math.abs(tr.w - o.w) > 0.05 || Math.abs(tr.h - o.h) > 0.05) trim = "custom"; }
    o.trim = trim;
    var pg = isInt(b.pages) ? b.pages : (typeof b.pages === "number" && isFinite(b.pages) ? Math.round(b.pages) : 240);
    pg = Math.max(LIMIT.pages[0], Math.min(LIMIT.pages[1], pg));
    if (pg % 2) pg += 1;                    // a leaf has two pages
    o.pages = pg;
    o.paper = pick(b.paper, PAPERS.map(function (p) { return p.k; }), "white");
    o.cal = num(b.cal, LIMIT.cal, 0.06, 0.0001);
    o.spine = num(b.spine, LIMIT.spine, 0, 0.1);   // 0 = from the pages
    if (o.spine && o.spine < 1) o.spine = 1;
    o.bind = pick(b.bind, BINDS, "pb");
    o.flaps = bit(b.flaps);
    o.flapW = num(b.flapW, LIMIT.flapW, 80, 1);
    o.round = bit(b.round);
    o.band = bit(b.band);
    o.ribbon = bit(b.ribbon);
    o.bandC = hex(b.bandC, "#b0302a");
    o.ribC = hex(b.ribC, "#8c1c24");
    o.edge = pick(b.edge, EDGES, "white");
    o.edgeC = hex(b.edgeC, "#2b5f9e");
    o.inC = hex(b.inC, "#f5f2ea");
    o.clothC = hex(b.clothC, "#26303d");
    o.fin = pick(b.fin, FINISH, "matte");
    return o;
  }
  // Block thickness (mm): typed by hand, else pages × one page.
  function blockMm(bk) {
    var b = normBook(bk);
    if (b.spine) return b.spine;
    var c = b.paper === "custom" ? b.cal : paperOf(b.paper).c;
    return Math.max(1, +(b.pages * c).toFixed(2));
  }

  // Every measure of the 3D book, mm. Axes: x across the cover (spine
  // at -x, fore-edge at +x), y up, z through the book (front at +z).
  function dims(bk) {
    var b = normBook(bk);
    var T = blockMm(b), W = b.w, H = b.h, hc = b.bind === "hc";
    var d = { W: W, H: H, T: T, hc: hc, flaps: !!b.flaps, flapW: Math.min(b.flapW, W - 10), round: hc && !!b.round };
    if (hc) {
      d.b = 2.5;                       // board
      d.o = 3;                         // board overhang (top, bottom, fore-edge)
      d.c = d.b;                       // case thickness on the boards
      d.cs = 1.2;                      // case thickness on the spine
      d.zF = T / 2 + d.b;
      d.xE = W / 2 + d.o;
      d.xS = -W / 2 - 1.5;
      d.xH = -W / 2 + 7;               // the groove (joint)
      d.groove = 1.1;
      d.Hc = H + 2 * d.o;
      d.j = d.flaps ? 0.3 : 0;         // dust jacket paper
      d.bulge = d.round ? Math.max(1.5, T * 0.14) : 0;
    } else {
      d.b = 0; d.o = 0;
      d.c = 0.35;                      // card cover
      d.cs = d.c;
      d.zF = T / 2 + d.c;
      d.xE = W / 2;
      d.xS = -W / 2 - d.c;
      d.xH = -W / 2 + 6;               // the score line
      d.groove = 0;
      d.Hc = H;
      d.j = 0;
      d.bulge = 0;
    }
    // Page block: flaps lie between cover and first page, so the
    // block gives them room.
    var gap = d.flaps ? (hc ? d.j + 0.05 : d.c + 0.05) : 0;
    d.block = { x0: -W / 2, x1: W / 2, z: T / 2 - gap, h: H };
    d.spineMm = +(hc ? T + 2 * d.b + 1 : T + 2 * d.c).toFixed(1);
    // bleed of the printed sheet; a hardcover case wraps 15 mm round
    // the boards (a dust jacket is a printed sheet like a paperback)
    d.bleed = hc && !d.flaps ? 15 : 3.2;
    return d;
  }

  // ---------- Cross-section ----------
  // Append an arc (centre cx,cz, radius r, angles a0 → a1, radians,
  // angle 0 = +x, π/2 = +z) to pts, without its first point.
  function arc(pts, cx, cz, rx, rz, a0, a1, steps) {
    for (var i = 1; i <= steps; i++) {
      var a = a0 + (a1 - a0) * i / steps;
      pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
    }
  }
  // Outer surface of the case (or the paperback cover), back fore-edge
  // → spine → front fore-edge. Returns { pts, iHb, iHf, iSb, iSf }:
  // indexes of the back hinge, front hinge and the two spine edges.
  function caseLine(d) {
    var pts = [], r = Math.min(0.9, d.zF * 0.3);
    var zF = d.zF, xS = d.xS, xH = d.xH, gw = 2.2, g = d.groove;
    pts.push([d.xE, -zF]);
    if (g) { pts.push([xH + gw, -zF]); pts.push([xH, -zF + g]); pts.push([xH - gw, -zF]); }
    else pts.push([xH, -zF]);
    var iHb = g ? 2 : 1, iSb, iSf;
    if (d.bulge) {
      pts.push([xS + 0.01, -zF]);
      iSb = pts.length - 1;
      arc(pts, xS, 0, d.bulge, zF, -Math.PI / 2, -Math.PI * 1.5, 24);
      iSf = pts.length - 1;
      pts[iSf] = [xS + 0.01, zF];
    } else {
      pts.push([xS + r, -zF]);
      iSb = pts.length - 1;
      arc(pts, xS + r, -zF + r, r, r, -Math.PI / 2, -Math.PI, 4);
      pts.push([xS, zF - r]);
      arc(pts, xS + r, zF - r, r, r, Math.PI, Math.PI / 2, 4);
      iSf = pts.length - 1;
    }
    var iHf;
    if (g) { pts.push([xH - gw, zF]); pts.push([xH, zF - g]); iHf = pts.length - 1; pts.push([xH + gw, zF]); }
    else { pts.push([xH, zF]); iHf = pts.length - 1; }
    pts.push([d.xE, zF]);
    return { pts: pts, iHb: iHb, iHf: iHf, iSb: iSb, iSf: iSf };
  }
  // Outward normal at every point (averaged across both neighbours).
  // Travel direction (dx, dz) → outward normal (-dz, dx).
  function normals(pts) {
    var n = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
      var dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
      n.push([-dz / l, dx / l]);
    }
    return n;
  }
  function arcLen(pts) {
    var a = [0];
    for (var i = 1; i < pts.length; i++) a.push(a[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return a;
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  // The printed sheet and the case, split into back / spine / front
  // pieces (the front piece turns on the hinge when the book opens).
  // Each piece: { pts, nrm, th, u } (u = arc length on the printed
  // sheet, mm). Result: { print: {back, spine, front}, caseP: same |
  // null (hardcover with a dust jacket: the cloth case under it),
  // panels: {flapB, back, spine, front, flapF} as [u0, u1], total,
  // hinge: [x, z] }.
  function profile(bk) {
    var d = dims(bk), cl = caseLine(d), base = cl.pts;
    var printPts, iHb = cl.iHb, iHf = cl.iHf, iSb = cl.iSb, iSf = cl.iSf, thick, add = 0, fb = [], ff = [];
    if (d.hc && d.flaps) {
      // jacket: the case line pushed out by the paper, plus the folds
      var nn = normals(base);
      printPts = base.map(function (p, i) { return [p[0] + nn[i][0] * d.j, p[1] + nn[i][1] * d.j]; });
      printPts[0] = [d.xE + d.j * 0.5, -d.zF - d.j];
      printPts[printPts.length - 1] = [d.xE + d.j * 0.5, d.zF + d.j];
      thick = function () { return d.j; };
    } else {
      printPts = base.slice();
      thick = null;
    }
    if (d.flaps) {
      // fold around the fore-edge and go back inside the cover
      var zIn = d.hc ? d.zF - d.b - d.j : d.zF - 2 * d.c;   // flap face (printed side toward the pages)
      var zOut = d.hc ? d.zF + d.j : d.zF;
      var xF = d.hc ? d.xE + d.j : d.xE;
      var rr = (zOut - zIn) / 2, cz = (zOut + zIn) / 2;
      // front: arc from the top (+z) round the edge to zIn, then inward
      ff = [];
      arc(ff, xF - 0.001, cz, rr, rr, Math.PI / 2, -Math.PI / 2, 8);
      ff.push([xF - d.flapW, zIn]);
      // back: mirrored (z → -z), and walked the other way
      fb = ff.map(function (p) { return [p[0], -p[1]]; }).reverse();
      printPts = fb.concat(printPts, ff);
      add = fb.length;
    }
    var P = printPts, nrm = normals(P), u = arcLen(P);
    var th = P.map(function (p, i) {
      if (thick) return thick(i);
      if (d.hc) {
        var k = i - add;
        return (k > cl.iSb - 1 && k < cl.iSf + 1) ? d.cs : d.c;
      }
      return d.c;
    });
    function piece(a, b) {
      return { pts: P.slice(a, b + 1), nrm: nrm.slice(a, b + 1), th: th.slice(a, b + 1), u: u.slice(a, b + 1).map(round3) };
    }
    var hb = iHb + add, hf = iHf + add, sb = iSb + add, sf = iSf + add, last = P.length - 1;
    var print = { back: piece(0, hb), spine: piece(hb, hf), front: piece(hf, last) };
    var fbEnd = add ? add : 0;              // index of the back fore-edge corner
    var ffStart = add ? last - ff.length : last;
    var panels = {
      flapB: [0, round3(u[fbEnd])],
      back: [round3(u[fbEnd]), round3(u[sb])],
      spine: [round3(u[sb]), round3(u[sf])],
      front: [round3(u[sf]), round3(u[ffStart])],
      flapF: [round3(u[ffStart]), round3(u[last])]
    };
    var caseP = null;
    if (d.hc && d.flaps) {
      var cn = normals(base), cu = arcLen(base);
      var cth = base.map(function (p, i) { return (i > cl.iSb - 1 && i < cl.iSf + 1) ? d.cs : d.c; });
      var cpiece = function (a, b) {
        return { pts: base.slice(a, b + 1), nrm: cn.slice(a, b + 1), th: cth.slice(a, b + 1), u: cu.slice(a, b + 1).map(round3) };
      };
      caseP = { back: cpiece(0, cl.iHb), spine: cpiece(cl.iHb, cl.iHf), front: cpiece(cl.iHf, base.length - 1) };
    }
    return { d: d, print: print, caseP: caseP, panels: panels, total: round3(u[last]),
             hinge: [d.xH, d.hc ? d.zF - d.b : d.T / 2] };
  }

  // Panels of the printed picture in mm, left → right as printed
  // (outside up): flap (back), back, spine, front, flap (front).
  function layout(bk) {
    var pr = profile(bk), p = pr.panels, out = [];
    ["flapB", "back", "spine", "front", "flapF"].forEach(function (k) {
      var w = round3(p[k][1] - p[k][0]);
      if (w > 0.01) out.push({ k: k, x: p[k][0], w: w });
    });
    return { panels: out, total: pr.total, h: pr.d.Hc };
  }


  // ---------- Print template ----------
  // The cover sheet as the printer wants it, mm, x from the left
  // trim edge (outside up: back on the left), y from the top trim.
  //   paperback: [flap] back · spine · front [flap]; the spine is the
  //     page block (pages × one page), as print-on-demand services
  //     count it; bleed 3.2 mm (⅛″)
  //   hardcover case: back board · hinge · spine · hinge · front
  //     board, board = width − 3 mm (the joint), 8 mm hinges, the
  //     case spine (block + boards), 15 mm wrap round the boards
  //   dust jacket: flap · back · spine · front · flap, the panels
  //     cover the boards and the joint (width + 5 mm)
  // The printer's own numbers win: the spine width can be typed in
  // the Book tab and the bleed in the Cover tab.
  var BAR = { w: 50.8, h: 30.5 };        // barcode spot, 2 × 1.2″
  var SPINE_SAFE = 1.6;                  // ¹⁄₁₆″ each side of the spine text
  var SPINE_TEXT_MIN = 5;                // thinner spines: no text at most printers
  var TPL_DEF = { safe: 6.35, bar: 1, gd: 1, art: 1 };
  function onBit(v) { return v === 0 || v === false ? 0 : 1; }
  function normTpl(t) {
    t = t && typeof t === "object" ? t : {};
    return { safe: num(t.safe, LIMIT.safe, TPL_DEF.safe, 0.01), bar: onBit(t.bar), gd: onBit(t.gd), art: onBit(t.art) };
  }
  function bleedOf(bk, art) {
    var a = normArt(art);
    return a.bleed >= 0 ? a.bleed : dims(bk).bleed;
  }
  function template(bk, art, tpl) {
    var b = normBook(bk), d = dims(b), o = normTpl(tpl), W = b.w, fw = d.flaps ? d.flapW : 0;
    var kind = d.hc ? (d.flaps ? "jacket" : "case") : "pb";
    var parts = [], S, H;
    function add(k, w) { parts.push({ k: k, x: 0, w: round3(w) }); }
    if (kind === "pb") {
      S = blockMm(b); H = b.h;
      if (fw) add("flapB", fw);
      add("back", W); add("spine", S); add("front", W);
      if (fw) add("flapF", fw);
    } else if (kind === "case") {
      S = d.spineMm; H = d.Hc;
      add("back", W - 3); add("hingeB", 8); add("spine", S); add("hingeF", 8); add("front", W - 3);
    } else {
      S = round3(d.spineMm + 1); H = d.Hc;
      add("flapB", fw); add("back", W + 5); add("spine", S); add("front", W + 5); add("flapF", fw);
    }
    var x = 0;
    parts.forEach(function (p) { p.x = round3(x); x += p.w; });
    var tw = round3(x), bl = round3(bleedOf(b, art)), sf = o.safe, warn = [];
    var folds = [];
    for (var i = 1; i < parts.length; i++) {
      var hinge = /^hinge/.test(parts[i].k) || /^hinge/.test(parts[i - 1].k);
      folds.push({ x: parts[i].x, k: hinge ? "hinge" : "fold" });
    }
    var safe = [];
    parts.forEach(function (p) {
      if (/^hinge/.test(p.k)) return;
      if (p.k === "spine") {
        if (S < SPINE_TEXT_MIN) return;
        safe.push({ k: p.k, x: round3(p.x + SPINE_SAFE), y: round3(sf), w: round3(p.w - 2 * SPINE_SAFE), h: round3(H - 2 * sf) });
        return;
      }
      if (p.w - 2 * sf > 1) safe.push({ k: p.k, x: round3(p.x + sf), y: round3(sf), w: round3(p.w - 2 * sf), h: round3(H - 2 * sf) });
    });
    if (S < SPINE_TEXT_MIN) warn.push("thin");
    var bar = null, back = parts.filter(function (p) { return p.k === "back"; })[0];
    if (o.bar) {
      if (back.w >= BAR.w + 2 * sf && H >= BAR.h + 2 * sf) {
        bar = { x: round3(back.x + back.w - sf - BAR.w), y: round3(H - sf - BAR.h), w: BAR.w, h: BAR.h };
      } else warn.push("nobar");
    }
    return {
      kind: kind, W: tw, H: round3(H), bleed: bl, spine: round3(S),
      sheet: { w: round3(tw + 2 * bl), h: round3(H + 2 * bl) },
      parts: parts, folds: folds, safe: safe, bar: bar, warn: warn
    };
  }
  // Which part of a full-wrap picture (the whole sheet, bleed
  // included) goes on each panel of the 3D cover: [{ k, x0, x1 }] and
  // y0, y1, as fractions of the picture. A hardcover's hinges go
  // with the boards.
  function wrapMap(bk, art) {
    var T = template(bk, art), sw = T.sheet.w, sh = T.sheet.h, bl = T.bleed, out = [];
    function span(keys) {
      var ps = T.parts.filter(function (p) { return keys.indexOf(p.k) >= 0; });
      if (!ps.length) return null;
      var a = ps[0], z = ps[ps.length - 1];
      return [(bl + a.x) / sw, (bl + z.x + z.w) / sw];
    }
    var map = T.kind === "case"
      ? { back: ["back", "hingeB"], spine: ["spine"], front: ["hingeF", "front"] }
      : { flapB: ["flapB"], back: ["back"], spine: ["spine"], front: ["front"], flapF: ["flapF"] };
    layout(bk).panels.forEach(function (p) {
      var s = map[p.k] && span(map[p.k]);
      if (s) out.push({ k: p.k, x0: s[0], x1: s[1] });
    });
    return { panels: out, y0: bl / sh, y1: (bl + T.H) / sh };
  }

  // ---------- Open book + e-book (wave 4) ----------
  // ins: { l, r (left / right inside page), scr (the e-book's screen),
  //        curl 0-1 (how much the pages arch), dev, dc (device and its
  //        colour), pdfp (the PDF page the spread starts at, a hint) }
  function normIns(i) {
    i = i && typeof i === "object" ? i : {};
    var o = {};
    IN_SLOTS.forEach(function (k) { o[k] = asset(i[k]); });
    o.curl = num(i.curl, LIMIT.curl, 0.5, 0.01);
    o.dev = pick(i.dev, DEVICES, "tablet");
    o.dc = pick(i.dc, DCOLS, "black");
    o.pdfp = isInt(i.pdfp) ? Math.max(LIMIT.pdfp[0], Math.min(LIMIT.pdfp[1], i.pdfp)) : 1;
    return o;
  }
  // The top of one half of the open page block, from the gutter (u = 0)
  // to the fore-edge (u = 1): [[x, y]] in mm, x across the page, y the
  // height over the open cover. Each half holds half the pages; the
  // pages dip into the gutter and arch up by curl.
  function openCurve(bk, curl, n) {
    var b = normBook(bk), t = blockMm(b) / 2, W = b.w, H = b.h;
    var c = typeof curl === "number" && isFinite(curl) ? Math.max(0, Math.min(1, curl)) : 0.5;
    var N = n || 32, out = [];
    var lift = c * Math.min(W, H) * 0.06;            // arch height at full curl
    for (var i = 0; i <= N; i++) {
      var u = i / N;
      var rise = 1 - Math.pow(1 - Math.min(1, u / 0.16), 2);   // out of the gutter
      var arch = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.04)), 0.7) * (1 - 0.35 * u);
      var y = t * (0.12 + 0.88 * rise) + lift * arch * rise;
      out.push([round3(u * W * (1 - 0.012 * c)), round3(y)]);
    }
    return out;
  }
  // A device in mm, standing, screen to +z: body w × h × d, corner
  // radius r, screen sw × sh with its centre at (sx, sy) from the
  // body's centre; ink = an e-ink screen (no glow, grey paper).
  var DEVICE_MM = {
    tablet: { w: 179.5, h: 247.6, d: 6.1, r: 12, sw: 163, sh: 228, sx: 0, sy: 0, ink: 0 },
    phone: { w: 71.5, h: 147.6, d: 7.8, r: 10, sw: 65.6, sh: 141.7, sx: 0, sy: 0, ink: 0 },
    reader: { w: 115.5, h: 174.2, d: 8.2, r: 6, sw: 90.6, sh: 122, sx: 0, sy: 14, ink: 1 }
  };
  function device(k) {
    var d = DEVICE_MM[pick(k, DEVICES, "tablet")];
    return Object.assign({ k: pick(k, DEVICES, "tablet") }, d);
  }
  // A picture inside a box (contain), centred: { x, y, w, h }.
  function containIn(iw, ih, bw, bh) {
    if (!(iw > 0 && ih > 0 && bw > 0 && bh > 0)) return { x: 0, y: 0, w: bw, h: bh };
    var k = Math.min(bw / iw, bh / ih), w = iw * k, h = ih * k;
    return { x: round3((bw - w) / 2), y: round3((bh - h) / 2), w: round3(w), h: round3(h) };
  }

  // ---------- Scene + output ----------
  function normArt(a) {
    a = a && typeof a === "object" ? a : {};
    var o = { mode: pick(a.mode, ART_MODES, "parts") };
    SLOTS.forEach(function (k) { o[k] = asset(a[k]); });
    o.c = hex(a.c, "#3b5b8c");        // cover colour where there is no picture
    o.spT = str(a.spT, 80);            // spine text when there is no spine picture
    o.spTC = hex(a.spTC, "#ffffff");
    // -1 = the binding's default
    o.bleed = typeof a.bleed === "number" && isFinite(a.bleed) && a.bleed >= 0 ? num(a.bleed, LIMIT.bleed, 0, 0.1) : -1;
    return o;
  }
  // Credit of a background photo from an open library (what
  // designkit/media.js normCredit keeps), fields clipped.
  function safeUrl(u) {
    if (typeof u !== "string") return "";
    var m = /^https:\/\/([a-z0-9.-]+)(\/[^\s"'<>\\]*)?$/i.exec(u.trim());
    if (!m || /^[.-]|[.-]$|\.\./.test(m[1])) return "";
    return "https://" + m[1].toLowerCase() + (m[2] || "/");
  }
  var CR_FIELDS = { src: 20, id: 160, kind: 8, title: 300, author: 300, authorUrl: 500, page: 500, lic: 12, licVer: 8, licUrl: 500 };
  function normCr(c) {
    if (!c || typeof c !== "object" || CR_SRC.indexOf(c.src) < 0 || typeof c.lic !== "string" || !c.lic) return null;
    var o = {};
    Object.keys(CR_FIELDS).forEach(function (k) {
      var v = typeof c[k] === "string" ? c[k] : "";
      o[k] = /url$|^page$/i.test(k) ? safeUrl(v).slice(0, CR_FIELDS[k]) : str(v, CR_FIELDS[k]);
    });
    if (o.id.indexOf(o.src + ":") !== 0) return null;
    return o;
  }
  function normVol(v) {
    v = v && typeof v === "object" ? v : {};
    var o = {};
    VOL_SLOTS.forEach(function (k) { o[k] = asset(v[k]); });
    o.c = hex(v.c, "");                 // "" = the first book's colour
    o.spT = str(v.spT, 80);             // "" = the first book's spine text
    var pg = typeof v.pages === "number" && isFinite(v.pages) ? Math.round(v.pages) : 0;
    if (pg) { pg = Math.max(LIMIT.pages[0], Math.min(LIMIT.pages[1], pg)); if (pg % 2) pg += 1; }
    o.pages = pg;                       // 0 = the first book's pages
    return o;
  }
  function normSet(s) {
    s = s && typeof s === "object" ? s : {};
    var k = pick(s.k, SETS, "one");
    var n = typeof s.n === "number" && isFinite(s.n) ? Math.round(s.n) : 3;
    return {
      k: k,
      n: Math.max(LIMIT.n[0], Math.min(LIMIT.n[1], n)),
      gap: num(s.gap, LIMIT.gap, GAP_DEF[k], 0.5),
      vols: (Array.isArray(s.vols) ? s.vols : []).slice(0, MAX_VOLS).map(normVol)
    };
  }
  // How many books the set shows.
  function count(p) {
    var st = p && p.set ? p.set : normSet(null);
    return st.k === "one" ? 1 : st.k === "pair" ? 2 : st.n;
  }
  // Book i of the set: { bk, art }. The first book is the project's;
  // the others take their own pages and pictures where they have them
  // (a pair is the same book twice).
  function volume(p, i) {
    var bk = Object.assign({}, p.bk), art = Object.assign({}, p.art), st = p.set || normSet(null);
    var v = i > 0 && st.k !== "pair" && st.k !== "one" ? st.vols[i - 1] : null;
    if (v) {
      if (v.pages) { bk.pages = v.pages; bk.spine = 0; }
      VOL_SLOTS.forEach(function (k) { if (v[k]) art[k] = v[k]; });
      if (v.wrap && art.mode !== "wrap") art.mode = "wrap";
      if (!v.wrap && (v.front || v.back || v.spine) && art.mode === "wrap") art.mode = "parts";
      if (v.c) art.c = v.c;
      if (v.spT) art.spT = v.spT;
    }
    return { bk: normBook(bk), art: normArt(art) };
  }
  // How every book stands: { i, back (shows its back), yaw (degrees),
  // place, dx (mm, a hand-laid push) }.
  function setList(p) {
    var st = p.set || normSet(null), place = p.sc ? p.sc.place : "stand", out = [], n = count(p);
    if (st.k === "one") return [{ i: 0, back: false, yaw: 0, place: place, dx: 0 }];
    if (st.k === "pair") return [{ i: 0, back: false, yaw: 12, place: place, dx: 0 }, { i: 1, back: true, yaw: -12, place: place, dx: 0 }];
    for (var i = 0; i < n; i++) {
      if (st.k === "row") out.push({ i: i, back: false, yaw: 0, place: place, dx: 0 });
      else if (st.k === "shelf") out.push({ i: i, back: false, yaw: 90, place: "stand", dx: 0 });
      else out.push({ i: i, back: false, yaw: STACK_YAW[i % STACK_YAW.length], place: "lie", dx: STACK_DX[i % STACK_DX.length] });
    }
    return out;
  }

  function normScene(s) {
    s = s && typeof s === "object" ? s : {};
    var cam = s.cam && typeof s.cam === "object" ? s.cam : {};
    var bg = s.bg && typeof s.bg === "object" ? s.bg : {};
    var li = s.light && typeof s.light === "object" ? s.light : {};
    return {
      place: pick(s.place, PLACES, "stand"),
      turn: num(s.turn, LIMIT.turn, 0, 1),
      open: num(s.open, LIMIT.open, 0, 1),
      cam: {
        th: num(cam.th, LIMIT.th, -28, 0.1), ph: num(cam.ph, LIMIT.ph, 12, 0.1),
        fov: num(cam.fov, LIMIT.fov, 30, 1), zoom: num(cam.zoom, LIMIT.zoom, 1, 0.01),
        dx: num(cam.dx, LIMIT.dx, 0, 0.01), dy: num(cam.dy, LIMIT.dy, 0, 0.01)
      },
      bg: {
        k: pick(bg.k, BGS, "grad"),
        c1: hex(bg.c1, "#eef1f5"), c2: hex(bg.c2, "#c9d2de"),
        ang: num(bg.ang, LIMIT.ang, 180, 1),
        img: asset(bg.img),
        cr: bg.img ? normCr(bg.cr) : null       // credit when the photo came from an open library
      },
      shadow: num(s.shadow, LIMIT.shadow, 0.45, 0.01),
      light: {
        az: num(li.az, LIMIT.az, 20, 1), el: num(li.el, LIMIT.el, 55, 1),
        str: num(li.str, LIMIT.str, 1, 0.01), soft: num(li.soft, LIMIT.soft, 0.6, 0.01),
        warm: num(li.warm, LIMIT.warm, 0, 0.01)
      }
    };
  }
  function normOut(o) {
    o = o && typeof o === "object" ? o : {};
    var size = SIZES.indexOf(o.size) >= 0 ? o.size : 2048;
    var mo = o.mo && typeof o.mo === "object" ? o.mo : {};
    return {
      ratio: pick(o.ratio, RATIOS, "4:5"), size: size, fmt: pick(o.fmt, FMTS, "png"),
      // turntable: spin all round or swing to and fro, seconds, long side
      mo: { k: pick(mo.k, MOTIONS, "spin"), sec: SECS.indexOf(mo.sec) >= 0 ? mo.sec : 6,
            size: VSIZES.indexOf(mo.size) >= 0 ? mo.size : 1080, fmt: pick(mo.fmt, VFMTS, "video") }
    };
  }
  function ratioOf(r) {
    var m = /^(\d+):(\d+)$/.exec(r || "") || [0, 4, 5];
    return (+m[1]) / (+m[2]);
  }
  // Export size in px for a ratio and the long side.
  function outSize(out, long) {
    var o = normOut(out), r = ratioOf(o.ratio), L = long || o.size;
    return r >= 1 ? { w: L, h: Math.round(L / r) } : { w: Math.round(L * r), h: L };
  }
  // Video / GIF frame size: even numbers (encoders want them); a GIF
  // is kept small (480 px long side).
  function motionSize(out) {
    var o = normOut(out), sz = outSize(o, o.mo.fmt === "gif" ? 480 : o.mo.size);
    return { w: sz.w - sz.w % 2, h: sz.h - sz.h % 2 };
  }
  // Frames of a turntable: { n, fps, turn(i) → degrees added to the
  // book's turn }. Spin: once all round, the last frame one step
  // short of the first (loops cleanly). Swing: 35° each way, eased.
  function motionPlan(out) {
    var o = normOut(out), gif = o.mo.fmt === "gif", fps = gif ? 15 : 30;
    var n = Math.round((gif ? Math.min(8, o.mo.sec) : o.mo.sec) * fps);   // a GIF is at most 8 s
    var spin = o.mo.k === "spin";
    return {
      n: n, fps: fps,
      turn: function (i) {
        var f = (i % n) / n;
        return spin ? +(360 * f).toFixed(4) : +(35 * Math.sin(2 * Math.PI * f)).toFixed(4);
      }
    };
  }

  function normProject(p) {
    if (!p || typeof p !== "object") return null;
    if (typeof p.id !== "string" || !ID_RE.test(p.id)) return null;
    if (!isInt(p.m) || p.m <= 0) return null;
    return {
      id: p.id, m: p.m,
      nm: str(p.nm, 80),
      kind: "book",
      bk: normBook(p.bk),
      art: normArt(p.art),
      sc: normScene(p.sc),
      out: normOut(p.out),
      set: normSet(p.set),
      tpl: normTpl(p.tpl),
      show: pick(p.show, SHOWS, "book"),
      ins: normIns(p.ins),
      unit: p.unit === "in" ? "in" : "mm"
    };
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }

  // ---------- Data + merge ----------
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!ID_RE.test(k) || !isInt(tm[k]) || tm[k] <= 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var best = {};
    [a.prj, b.prj].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var p = normProject(x);
        if (p) best[p.id] = newer(best[p.id], p);
      });
    });
    var prj = [];
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      prj.push(best[k]);
    });
    prj = prj.slice(0, MAX_PRJ);
    var t = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { t[k] = tombs[k]; });
    return { ver: DATA_VER, prj: prj, tombs: t };
  }
  function empty() { return { ver: DATA_VER, prj: [], tombs: {} }; }
  function parse(raw) {
    if (typeof raw !== "string" || !raw) return empty();
    try { return merge(JSON.parse(raw), null); } catch (e) { return empty(); }
  }
  function byId(data, id) {
    for (var i = 0; i < data.prj.length; i++) if (data.prj[i].id === id) return data.prj[i];
    return null;
  }
  function newId(rand) {
    var r = typeof rand === "function" ? rand : Math.random, s = "k";
    for (var i = 0; i < 12; i++) s += "0123456789abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(r() * 36));
    return s;
  }
  function blank(id, now) {
    return normProject({ id: id, m: now, nm: "", bk: { trim: "a5", w: 148, h: 210 }, art: {}, sc: {}, out: {} });
  }
  // Put a project in (new or changed): m moves past the old copy and
  // past its tombstone, so the change always wins.
  function put(data, p, now) {
    var cur = merge(data, null), old = byId(cur, p.id);
    if (!old && cur.prj.length >= MAX_PRJ) return { data: cur, ok: false, why: "full" };
    var m = Math.max(now, old ? old.m + 1 : 0, (cur.tombs[p.id] || 0) + 1);
    var n = normProject(Object.assign({}, p, { m: m }));
    if (!n) return { data: cur, ok: false, why: "bad" };
    cur.prj = cur.prj.filter(function (x) { return x.id !== n.id; }).concat([n]);
    return { data: merge(cur, null), ok: true, prj: n };
  }
  function remove(data, id, now) {
    var cur = merge(data, null), old = byId(cur, id);
    if (!old) return cur;
    var add = {};
    add[id] = Math.max(now, old.m);
    return merge(cur, { tombs: add });
  }
  // Every picture file a project names (for "in use" checks).
  function assetsOf(p) {
    var out = [];
    if (!p) return out;
    SLOTS.forEach(function (k) { if (p.art && p.art[k]) out.push(p.art[k]); });
    if (p.sc && p.sc.bg && p.sc.bg.img) out.push(p.sc.bg.img);
    if (p.ins) IN_SLOTS.forEach(function (k) { if (p.ins[k] && out.indexOf(p.ins[k]) < 0) out.push(p.ins[k]); });
    if (p.set && Array.isArray(p.set.vols)) p.set.vols.forEach(function (v) {
      VOL_SLOTS.forEach(function (k) { if (v && v[k] && out.indexOf(v[k]) < 0) out.push(v[k]); });
    });
    return out;
  }

  function normPrefs(p) {
    p = p && typeof p === "object" ? p : {};
    return { cur: typeof p.cur === "string" && ID_RE.test(p.cur) ? p.cur : "", tab: pick(p.tab, ["book", "cover", "scene", "print", "out"], "book") };
  }

  // Deep link target from Atelier (or anyone): { cover: { front, back,
  // spine, wrap, name, w, h (mm, optional), ww, wh (trim of a full
  // wrap, mm, optional) } } → clean object | null.
  function parseCover(c) {
    if (!c || typeof c !== "object") return null;
    var o = { front: asset(c.front), back: asset(c.back), spine: asset(c.spine), wrap: asset(c.wrap), name: str(c.name, 80) };
    if (!o.front && !o.back && !o.spine && !o.wrap) return null;
    var w = typeof c.w === "number" && isFinite(c.w) ? c.w : 0, h = typeof c.h === "number" && isFinite(c.h) ? c.h : 0;
    if (w >= LIMIT.w[0] && w <= LIMIT.w[1] && h >= LIMIT.h[0] && h <= LIMIT.h[1]) { o.w = +w.toFixed(1); o.h = +h.toFixed(1); }
    // trim size of a full wrap (Atelier sends it for mm / inch designs)
    var ww = typeof c.ww === "number" && isFinite(c.ww) ? c.ww : 0, wh = typeof c.wh === "number" && isFinite(c.wh) ? c.wh : 0;
    if (o.wrap && ww >= 20 && ww <= 2000 && wh >= 20 && wh <= 2000) { o.ww = +ww.toFixed(2); o.wh = +wh.toFixed(2); }
    return o;
  }

  var MockCore = {
    VERSION: VERSION, DATA_VER: DATA_VER, DATA_KEY: DATA_KEY, PREFS_KEY: PREFS_KEY, MAX_PRJ: MAX_PRJ,
    ID_RE: ID_RE, ASSET_RE: ASSET_RE, LIMIT: LIMIT,
    TRIMS: TRIMS, PAPERS: PAPERS, BINDS: BINDS, FINISH: FINISH, EDGES: EDGES, PLACES: PLACES, BGS: BGS,
    RATIOS: RATIOS, SIZES: SIZES, FMTS: FMTS, SLOTS: SLOTS, MM_PER_IN: MM_PER_IN,
    VOL_SLOTS: VOL_SLOTS, SETS: SETS, MAX_VOLS: MAX_VOLS, GAP_DEF: GAP_DEF,
    MOTIONS: MOTIONS, SECS: SECS, VSIZES: VSIZES, VFMTS: VFMTS,
    normCr: normCr, normVol: normVol, normSet: normSet, count: count, volume: volume, setList: setList,
    motionSize: motionSize, motionPlan: motionPlan,
    BAR: BAR, SPINE_SAFE: SPINE_SAFE, SPINE_TEXT_MIN: SPINE_TEXT_MIN, TPL_DEF: TPL_DEF,
    normTpl: normTpl, bleedOf: bleedOf, template: template, wrapMap: wrapMap,
    SHOWS: SHOWS, DEVICES: DEVICES, DCOLS: DCOLS, IN_SLOTS: IN_SLOTS, DEVICE_MM: DEVICE_MM,
    normIns: normIns, openCurve: openCurve, device: device, containIn: containIn,
    trimOf: trimOf, paperOf: paperOf, mmToIn: mmToIn, inToMm: inToMm,
    normBook: normBook, blockMm: blockMm, dims: dims, profile: profile, layout: layout,
    normArt: normArt, normScene: normScene, normOut: normOut, ratioOf: ratioOf, outSize: outSize,
    normProject: normProject, merge: merge, empty: empty, parse: parse, byId: byId, newId: newId,
    blank: blank, put: put, remove: remove, assetsOf: assetsOf, normPrefs: normPrefs, parseCover: parseCover,
    canon: canon
  };
  if (typeof module !== "undefined" && module.exports) module.exports = MockCore;
  else root.MockCore = MockCore;
})(typeof window !== "undefined" ? window : globalThis);
