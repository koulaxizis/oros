// ============================================================
// orOS Atelier — collage.js: Photo collage (v1.0.0)
//   - ready grids for 1 to 9 photos; the boxes of a grid are ordinary
//     photo elements (fit "fill") marked ext.clg = { i: box number },
//     so filters, crop, text on top, export and sync work as for any
//     photo. The page background carries the grid as
//     ext.clg = { l: layout id, g: spacing, r: corners } (both in % of
//     the page's shorter side). Older copies ignore ext.clg and show
//     the same picture (R39).
//   - Home › Photo collage: size, photos (several at once), grid,
//     spacing, corners, background → a new design
//   - the Collage panel (More › Photo collage, or Collage on a box):
//     another grid, spacing, corners, background, Add photos
//   - drag a box onto another to swap their photos; tap an empty box
//     to add one (editor.js asks drop() / tapEmpty())
// Changing the grid never loses a photo silently: boxes that no longer
// fit go away only when they are empty, else a toast offers Undo.
// The grid maths is pure (unit-tested); the rest needs a browser.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Pure: the grids ----------
  // g: [columns, rows] of a unit grid; c: boxes [x, y, w, h] in units,
  // in reading order (the order photos fill them)
  var LAYOUTS = [
    { id: "1", g: [1, 1], c: [[0, 0, 1, 1]] },
    { id: "2c", g: [2, 1], c: [[0, 0, 1, 1], [1, 0, 1, 1]] },
    { id: "2r", g: [1, 2], c: [[0, 0, 1, 1], [0, 1, 1, 1]] },
    { id: "2w", g: [3, 1], c: [[0, 0, 2, 1], [2, 0, 1, 1]] },
    { id: "3c", g: [3, 1], c: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]] },
    { id: "3r", g: [1, 3], c: [[0, 0, 1, 1], [0, 1, 1, 1], [0, 2, 1, 1]] },
    { id: "3l", g: [2, 2], c: [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]] },
    { id: "3t", g: [2, 2], c: [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
    { id: "4g", g: [2, 2], c: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
    { id: "4l", g: [3, 3], c: [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]] },
    { id: "4t", g: [3, 3], c: [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]] },
    { id: "4c", g: [4, 1], c: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1]] },
    { id: "5a", g: [6, 2], c: [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]] },
    { id: "5l", g: [4, 2], c: [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]] },
    { id: "5t", g: [4, 3], c: [[0, 0, 4, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], [3, 2, 1, 1]] },
    { id: "6a", g: [3, 2], c: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]] },
    { id: "6b", g: [2, 3], c: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1]] },
    { id: "6l", g: [3, 3], c: [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]] },
    { id: "7a", g: [6, 3], c: [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1], [0, 2, 3, 1], [3, 2, 3, 1]] },
    { id: "8a", g: [4, 2], c: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]] },
    { id: "8b", g: [2, 4], c: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 1, 1], [1, 3, 1, 1]] },
    { id: "9g", g: [3, 3], c: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]] }
  ];
  var MAX = 9, GAP_DEF = 2, GAP_MAX = 10, RAD_MAX = 10;
  var BYID = {};
  LAYOUTS.forEach(function (l) { BYID[l.id] = l; });

  function get(id) { return BYID[id] || null; }
  function forCount(n) { return LAYOUTS.filter(function (l) { return l.c.length === n; }); }
  // the first grid with room for n photos (1..9)
  function bestFor(n) {
    n = Math.max(1, Math.min(MAX, Math.round(n) || 1));
    return LAYOUTS.filter(function (l) { return l.c.length >= n; })[0];
  }
  function pct(v, max, def) {
    return typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(0, Math.round(v * 2) / 2)) : def;
  }
  function normState(s) {
    if (!s || typeof s !== "object" || !get(s.l)) return null;
    return { l: s.l, g: pct(s.g, GAP_MAX, GAP_DEF), r: pct(s.r, RAD_MAX, 0) };
  }

  // The boxes of grid `id` on a W × H page (points): the spacing g (% of
  // the shorter side) runs between the boxes and around the edge.
  function rects(id, W, H, g) {
    var l = get(id);
    if (!l) return [];
    var gap = pct(g, GAP_MAX, GAP_DEF) / 100 * Math.min(W, H);
    var IW = W - 2 * gap, IH = H - 2 * gap, gw = l.g[0], gh = l.g[1];
    return l.c.map(function (c) {
      var x0 = gap + c[0] / gw * IW, x1 = gap + (c[0] + c[2]) / gw * IW;
      var y0 = gap + c[1] / gh * IH, y1 = gap + (c[1] + c[3]) / gh * IH;
      if (c[0] > 0) x0 += gap / 2;
      if (c[0] + c[2] < gw) x1 -= gap / 2;
      if (c[1] > 0) y0 += gap / 2;
      if (c[1] + c[3] < gh) y1 -= gap / 2;
      return { x: round2(x0), y: round2(y0), w: round2(Math.max(1, x1 - x0)), h: round2(Math.max(1, y1 - y0)) };
    });
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  // corners r (% of the page's shorter side) as the roundness of a
  // "rounded" box w × h (fx.shapePath: 100 = half its shorter side)
  function roundness(w, h, r, W, H) {
    var px = pct(r, RAD_MAX, 0) / 100 * Math.min(W, H);
    return Math.max(0, Math.min(100, Math.round(px / (Math.min(w, h) / 2) * 100)));
  }

  // ext helpers: set / remove one key, keep the others
  function setX(it, key, val) {
    var x = {};
    if (it.ext) Object.keys(it.ext).forEach(function (k) { if (k !== key) x[k] = it.ext[k]; });
    if (val !== undefined && val !== null) x[key] = val;
    if (Object.keys(x).length) it.ext = x; else delete it.ext;
  }
  function cellNo(it) {
    var v = it && it.ext && it.ext.clg;
    return v && typeof v.i === "number" && v.i >= 0 && v.i < MAX && v.i % 1 === 0 && it.ax && it.ax.k === "photo" && !it.ax.bg ? v.i : -1;
  }
  function bgOf(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      if (it.pg === pg && it.ax && it.ax.bg) return it;
    }
    return null;
  }
  // the grid of a page, or null
  function stateOf(doc, pg) {
    var b = bgOf(doc, pg);
    return b && b.ext ? normState(b.ext.clg) : null;
  }
  // the boxes of a page, by box number (a duplicate number: the first)
  function cellsOf(doc, pg) {
    var out = [];
    doc.items.forEach(function (it) {
      if (it.pg !== pg) return;
      var i = cellNo(it);
      if (i >= 0 && !out[i]) out[i] = it;
    });
    return out;
  }
  function isCell(doc, it) { return !!(it && cellNo(it) >= 0 && stateOf(doc, it.pg)); }

  // The photo of a box: what moves when two boxes swap or a photo goes in
  var PHOTO_AX = ["adj", "flt", "flh", "flv", "vid", "vs", "ve", "mu", "vol", "nl", "cr"];
  function photoOf(it) {
    var o = { a: it.a || "", nm: it.nm || "", iw: it.iw || 0, ih: it.ih || 0, ax: {} };
    PHOTO_AX.forEach(function (k) { if (it.ax[k] !== undefined) o.ax[k] = it.ax[k]; });
    return o;
  }
  function putPhoto(it, p) {
    it.a = p.a || ""; it.nm = p.nm || ""; it.iw = p.iw || 0; it.ih = p.ih || 0;
    it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1;
    PHOTO_AX.forEach(function (k) { delete it.ax[k]; });
    Object.keys(p.ax || {}).forEach(function (k) { if (PHOTO_AX.indexOf(k) >= 0) it.ax[k] = p.ax[k]; });
  }
  function swap(a, b) {
    var pa = photoOf(a), pb = photoOf(b);
    putPhoto(a, pb); putPhoto(b, pa);
  }

  // Lays page pg of doc out as grid st ({ l, g, r }) and puts `photos`
  // ([{ a, nm, iw, ih }]) into its empty boxes in order. In place; the
  // caller normalizes (AT.op / M.normDoc). Needs AX (ax.js) and M.
  // → { dropped: boxes with a photo that the grid had no room for,
  //     left: photos that found no empty box }
  function apply(doc, pg, st, photos, now, AX, M) {
    st = normState(st);
    var res = { dropped: 0, left: 0 };
    if (!st) return res;
    var bg = bgOf(doc, pg);
    if (!bg) bg = AX.addBackground(doc, pg, "#ffffff", now);
    setX(bg, "clg", { g: st.g, l: st.l, r: st.r });
    M.touch(bg, now);
    var W = doc.setup.w, H = doc.setup.h, boxes = rects(st.l, W, H, st.g);
    var cells = cellsOf(doc, pg), keep = {};
    // boxes keep their order; a smaller grid keeps the filled ones first
    var old = cells.filter(Boolean), order = old;
    if (boxes.length < old.length) {
      order = old.filter(function (it) { return it.a; }).concat(old.filter(function (it) { return !it.a; }));
    }
    var zs = doc.items.filter(function (it) { return it.pg === pg && !(it.ax && it.ax.bg); }).map(function (it) { return it.z; });
    var z0 = zs.length ? Math.min.apply(null, zs) : 1;
    var queue = (photos || []).slice();
    boxes.forEach(function (b, i) {
      var it = order[i];
      if (!it) {
        it = AX.addItem(doc, pg, { k: "photo", a: "", x: 0, y: 0, w: b.w, h: b.h, fit: "fill", z: z0 - boxes.length + i }, now);
        if (!it) return;
      }
      keep[it.id] = 1;
      it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h; it.rot = 0;
      if (it.fit === "custom") { it.fit = "fill"; it.ix = 0; it.iy = 0; it.isc = 1; }
      var rd = roundness(b.w, b.h, st.r, W, H);
      if (rd > 0) { it.ax.shp = "rounded"; it.ax.rd = rd; }
      else if (it.ax.shp === "rounded") { delete it.ax.shp; delete it.ax.rd; }
      if (!it.a && queue.length) putPhoto(it, queue.shift());
      setX(it, "clg", { i: i });
      M.touch(it, now);
    });
    res.left = queue.length;
    order.forEach(function (it) {
      if (keep[it.id]) return;
      if (it.a) res.dropped++;
      doc.items = doc.items.filter(function (x) { return x !== it; });
      doc.tombs[it.id] = now;
    });
    return res;
  }

  var pure = { LAYOUTS: LAYOUTS, MAX: MAX, GAP_DEF: GAP_DEF, GAP_MAX: GAP_MAX, RAD_MAX: RAD_MAX, get: get, forCount: forCount, bestFor: bestFor,
    normState: normState, rects: rects, roundness: roundness, cellNo: cellNo, stateOf: stateOf, cellsOf: cellsOf, isCell: isCell,
    photoOf: photoOf, putPhoto: putPhoto, swap: swap, apply: apply, setX: setX };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ---------- Runtime ----------
  var AT = root.AT, t = AT.t, el = AT.el, A = AT.A, M = AT.M, AX = AT.AX, ED = AT.ed;

  var STR = {
    en: {
      "cl.title": "Photo collage", "cl.home": "Photo collage", "cl.homeSub": "2 to 9 photos in a ready grid",
      "cl.size": "Size", "cl.photos": "Photos", "cl.pick": "Choose photos…", "cl.picked": "{n} photos", "cl.picked1": "1 photo",
      "cl.none": "No photos yet: you can add them later by tapping the empty boxes.", "cl.tooMany": "A collage holds up to 9 photos; the first 9 are used.",
      "cl.grid": "Grid", "cl.gap": "Spacing", "cl.corners": "Corners", "cl.bg": "Background", "cl.make": "Make collage",
      "cl.adding": "Adding photos… {n} of {all}", "cl.made": "Collage ready. Drag a photo onto another to swap them.",
      "cl.add": "Add photos…", "cl.hint": "Drag a photo onto another to swap them. Tap an empty box to add a photo; Crop moves a photo inside its box.",
      "cl.notYet": "Pick a grid to turn this page into a collage. What is already on the page stays.",
      "cl.dropped": "{n} photos did not fit in this grid.", "cl.dropped1": "1 photo did not fit in this grid.", "cl.left": "{n} photos found no empty box.", "cl.left1": "1 photo found no empty box.", "cl.swapped": "Photos swapped",
      "cl.boxes": "{n} photos", "cl.fail": "Some photos could not be added.",
      "cl.sq": "Square", "cl.port": "Portrait", "cl.story": "Story", "cl.land": "Landscape", "cl.a4": "A4"
    },
    el: {
      "cl.title": "Κολάζ φωτογραφιών", "cl.home": "Κολάζ φωτογραφιών", "cl.homeSub": "2 έως 9 φωτογραφίες σε έτοιμο πλέγμα",
      "cl.size": "Μέγεθος", "cl.photos": "Φωτογραφίες", "cl.pick": "Επιλογή φωτογραφιών…", "cl.picked": "{n} φωτογραφίες", "cl.picked1": "1 φωτογραφία",
      "cl.none": "Δεν διάλεξες φωτογραφίες: μπορείς να τις βάλεις μετά πατώντας τα άδεια κουτιά.", "cl.tooMany": "Ένα κολάζ χωράει έως 9 φωτογραφίες· μπαίνουν οι πρώτες 9.",
      "cl.grid": "Πλέγμα", "cl.gap": "Απόσταση", "cl.corners": "Γωνίες", "cl.bg": "Φόντο", "cl.make": "Δημιουργία κολάζ",
      "cl.adding": "Προσθήκη φωτογραφιών… {n} από {all}", "cl.made": "Το κολάζ είναι έτοιμο. Σύρε μια φωτογραφία πάνω σε άλλη για να αλλάξουν θέση.",
      "cl.add": "Προσθήκη φωτογραφιών…", "cl.hint": "Σύρε μια φωτογραφία πάνω σε άλλη για να αλλάξουν θέση. Πάτα ένα άδειο κουτί για να βάλεις φωτογραφία· η Περικοπή μετακινεί τη φωτογραφία μέσα στο κουτί της.",
      "cl.notYet": "Διάλεξε πλέγμα για να γίνει αυτή η σελίδα κολάζ. Ό,τι υπάρχει ήδη στη σελίδα μένει.",
      "cl.dropped": "{n} φωτογραφίες δεν χώρεσαν σε αυτό το πλέγμα.", "cl.dropped1": "1 φωτογραφία δεν χώρεσε σε αυτό το πλέγμα.", "cl.left": "{n} φωτογραφίες δεν βρήκαν άδειο κουτί.", "cl.left1": "1 φωτογραφία δεν βρήκε άδειο κουτί.", "cl.swapped": "Οι φωτογραφίες άλλαξαν θέση",
      "cl.boxes": "{n} φωτογραφίες", "cl.fail": "Κάποιες φωτογραφίες δεν μπήκαν.",
      "cl.sq": "Τετράγωνο", "cl.port": "Κάθετο", "cl.story": "Story", "cl.land": "Οριζόντιο", "cl.a4": "A4"
    }
  };
  // into Atelier's strings; a pack language gets its lines (core.js AT.addStrings)
  AT.addStrings(STR);

  var SIZES = [
    { id: "sq", w: 1080, h: 1080, unit: "px" },
    { id: "port", w: 1080, h: 1350, unit: "px" },
    { id: "story", w: 1080, h: 1920, unit: "px" },
    { id: "land", w: 1920, h: 1080, unit: "px" },
    { id: "a4", w: 210, h: 297, unit: "mm" }
  ];
  var BGS = ["#ffffff", "#000000", "#f5efe6", "#e8e8e8", "#1f2937", "#fde2e4", "#dbeafe", "#dcfce7", "#fef3c7"];

  function button(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function sec(title) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    return s;
  }
  // a small picture of a grid (inline SVG: rectangles only)
  var SVGNS = "http://www.w3.org/2000/svg";
  function thumb(id, w, h) {
    var k = 40 / Math.max(w, h), W = Math.round(w * k), H = Math.round(h * k);
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 " + W + " " + H);
    s.setAttribute("width", W); s.setAttribute("height", H);
    s.setAttribute("aria-hidden", "true");
    rects(id, W, H, 6).forEach(function (r) {
      var e = document.createElementNS(SVGNS, "rect");
      e.setAttribute("x", r.x); e.setAttribute("y", r.y); e.setAttribute("width", r.w); e.setAttribute("height", r.h);
      e.setAttribute("rx", 1.5);
      s.appendChild(e);
    });
    return s;
  }
  // the grid picker: a button per grid (all counts, or only `n` photos)
  function gridPicker(cur, w, h, n, pick) {
    var g = el("div", "cl-grids");
    (n ? forCount(n) : LAYOUTS).forEach(function (l) {
      var b = button("cl-grid" + (l.id === cur ? " on" : ""), "", function () { pick(l.id); });
      b.setAttribute("aria-pressed", l.id === cur ? "true" : "false");
      var lbl = l.c.length === 1 ? t("cl.picked1") : t("cl.boxes", { n: l.c.length });
      b.title = lbl; b.setAttribute("aria-label", lbl);
      b.appendChild(thumb(l.id, w, h));
      g.appendChild(b);
    });
    return g;
  }
  function rangeRow(label, max, value, onInput, onDone) {
    var row = el("label", "rng-row");
    row.appendChild(el("span", "rng-l", label));
    var r = el("input", "rng");
    r.type = "range"; r.min = 0; r.max = max; r.step = 0.5; r.value = value;
    var v = el("span", "rng-v", String(value));
    r.addEventListener("input", function () { v.textContent = r.value; onInput(Number(r.value)); });
    if (onDone) r.addEventListener("change", onDone);
    row.appendChild(r); row.appendChild(v);
    return row;
  }
  function bgRow(cur, pick) {
    var g = el("div", "swp");
    BGS.forEach(function (c) {
      var b = button("sw" + (cur === c ? " on" : ""), "", function () { pick(c); });
      b.style.background = c; b.title = c; b.setAttribute("aria-label", c);
      g.appendChild(b);
    });
    return g;
  }

  function pickFiles() {
    var dlg = AT.dialogHost();
    if (dlg && typeof dlg.openFiles === "function") return dlg.openFiles("image/*").then(function (l) { return l || []; });
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.addEventListener("change", function () { resolve(Array.prototype.slice.call(inp.files || [])); });
      inp.click();
    });
  }
  // files → stored pictures, one after the other (progress(n, all))
  function importAll(files, progress) {
    var out = [], failed = 0, chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        if (progress) progress(i + 1, files.length);
        return A.importFile(f).then(function (res) {
          AT.noteUpload(res.id);
          out.push({ a: res.id, nm: res.name || "", iw: res.w, ih: res.h });
        }, function (e) { if (e && e.message === "nofs") throw e; failed++; });
      });
    });
    return chain.then(function () { return { photos: out, failed: failed }; });
  }
  function fail(e) { AT.toast(e && e.message === "nofs" ? t("img.nofs") : t("cl.fail")); }

  // ---------- Home › Photo collage ----------
  function homeCard() {
    var g = el("div", "size-group");
    g.appendChild(el("h3", "size-h", t("cl.title")));
    var row = el("div", "size-row");
    var b = button("size-card cl-card", "", newCollage);
    b.appendChild(thumb("4l", 40, 40));
    var tx = el("span", "size-txt");
    tx.appendChild(el("span", "size-name", t("cl.home")));
    tx.appendChild(el("span", "size-dim", t("cl.homeSub")));
    b.appendChild(tx);
    row.appendChild(b);
    g.appendChild(row);
    return g;
  }

  function newCollage() {
    var st = { size: SIZES[0], files: [], l: "4g", g: GAP_DEF, r: 0, bg: "#ffffff", busy: false };
    AT.openDialog(t("cl.title"), function (body, close) {
      function draw() {
        body.innerHTML = "";
        var sz = st.size.unit === "mm" ? { w: st.size.w, h: st.size.h } : st.size;
        // size
        var s1 = sec(t("cl.size")), seg = el("div", "seg wrap");
        SIZES.forEach(function (s) {
          var b = button("seg-btn" + (s === st.size ? " on" : ""), t("cl." + s.id), function () { st.size = s; draw(); });
          b.title = s.w + " × " + s.h + " " + s.unit;
          seg.appendChild(b);
        });
        s1.appendChild(seg);
        body.appendChild(s1);
        // photos
        var s2 = sec(t("cl.photos")), n = Math.min(MAX, st.files.length);
        var row = el("div", "pn-row");
        row.appendChild(button("btn", t("cl.pick"), function () {
          pickFiles().then(function (list) {
            list = list.filter(function (f) { return f && (/^image\//.test(f.type || "") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || "")); });
            if (!list.length) return;
            st.files = list;
            var c = Math.min(MAX, list.length);
            if (!get(st.l) || get(st.l).c.length !== c) st.l = bestFor(c).id;
            draw();
          });
        }));
        if (n) row.appendChild(el("span", "hint", n === 1 ? t("cl.picked1") : t("cl.picked", { n: n })));
        s2.appendChild(row);
        if (!n) s2.appendChild(el("p", "hint", t("cl.none")));
        if (st.files.length > MAX) s2.appendChild(el("p", "hint warn", t("cl.tooMany")));
        body.appendChild(s2);
        // grid
        var s3 = sec(t("cl.grid"));
        s3.appendChild(gridPicker(st.l, sz.w, sz.h, n || 0, function (id) { st.l = id; draw(); }));
        body.appendChild(s3);
        // look
        var s4 = sec();
        s4.appendChild(rangeRow(t("cl.gap"), GAP_MAX, st.g, function (v) { st.g = v; }));
        s4.appendChild(rangeRow(t("cl.corners"), RAD_MAX, st.r, function (v) { st.r = v; }));
        s4.appendChild(el("div", "pn-h", t("cl.bg")));
        s4.appendChild(bgRow(st.bg, function (c) { st.bg = c; draw(); }));
        body.appendChild(s4);
        var act = el("div", "dlg-actions");
        act.appendChild(button("btn", t("btn.cancel"), close));
        var go = button("btn primary", t("cl.make"), function () {
          if (st.busy) return;
          st.busy = true; go.disabled = true;
          importAll(st.files.slice(0, MAX), function (i, all) { go.textContent = t("cl.adding", { n: i, all: all }); })
            .then(function (r) {
              close();
              make(st, r.photos);
              if (r.failed) AT.toast(t("cl.fail"));
            }, function (e) { st.busy = false; go.disabled = false; go.textContent = t("cl.make"); fail(e); });
        });
        act.appendChild(go);
        body.appendChild(act);
      }
      draw();
    }, true);
  }

  function make(st, photos) {
    var s = st.size, mm = s.unit === "mm", nw = AT.now();
    var d = AX.newDesign({ name: t("cl.title"), w: mm ? M.fromUnit(s.w, "mm") : s.w, h: mm ? M.fromUnit(s.h, "mm") : s.h, unit: s.unit, bg: st.bg }, nw);
    var pg = M.pagesInOrder(d)[0].id;
    var l = get(st.l);
    if (!l || l.c.length < Math.min(photos.length, MAX)) l = bestFor(photos.length);
    apply(d, pg, { l: l.id, g: st.g, r: st.r }, photos, nw, AX, M);
    AT.addDoc(M.normDoc(d));
    AT.toast(t("cl.made"));
  }

  // ---------- The Collage panel ----------
  function relayout(st, photos, quiet) {
    var res = null, pg = ED.pg;
    AT.op(function (d, nw) { res = apply(d, pg, st, photos || [], nw, AX, M); });
    if (!res || quiet) return res;
    if (res.dropped) AT.toast(res.dropped === 1 ? t("cl.dropped1") : t("cl.dropped", { n: res.dropped }), t("btn.undo"), AT.undo);
    else if (res.left) AT.toast(res.left === 1 ? t("cl.left1") : t("cl.left", { n: res.left }));
    return res;
  }
  function current() {
    return AT.doc && ED.pg ? stateOf(AT.doc, ED.pg) : null;
  }
  function addPhotos() {
    pickFiles().then(function (list) {
      list = list.filter(Boolean);
      if (!list.length) return;
      return importAll(list).then(function (r) {
        if (!AT.doc || !r.photos.length) { if (r.failed) AT.toast(t("cl.fail")); return; }
        var st = current() || { l: "", g: GAP_DEF, r: 0 };
        var have = cellsOf(AT.doc, ED.pg).filter(function (it) { return it && it.a; }).length;
        var need = Math.min(MAX, have + r.photos.length);
        if (!get(st.l) || get(st.l).c.length < need) st.l = bestFor(need).id;
        relayout(st, r.photos);
        if (r.failed) AT.toast(t("cl.fail"));
        AT.renderDrawer();
      });
    }).then(null, fail);
  }
  AT.registerView("collage", function (body) {
    var st = current(), s = AT.doc.setup;
    if (!st) body.appendChild(el("p", "hint", t("cl.notYet")));
    var s1 = sec(t("cl.grid"));
    var counts = {};
    LAYOUTS.forEach(function (l) { counts[l.c.length] = 1; });
    Object.keys(counts).forEach(function (n) {
      s1.appendChild(el("div", "cl-count", Number(n) === 1 ? t("cl.picked1") : t("cl.boxes", { n: n })));
      s1.appendChild(gridPicker(st ? st.l : "", s.w, s.h, Number(n), function (id) {
        var c = current() || { g: GAP_DEF, r: 0 };
        c.l = id;
        relayout(c);
        AT.renderDrawer();
      }));
    });
    body.appendChild(s1);
    var s2 = sec();
    s2.appendChild(button("btn primary block", t("cl.add"), addPhotos));
    if (st) {
      s2.appendChild(rangeRow(t("cl.gap"), GAP_MAX, st.g, function (v) {
        AT.beginGesture();
        var c = current(); if (c) { c.g = v; relayout(c, null, true); }
      }, function () { AT.endGesture(); }));
      s2.appendChild(rangeRow(t("cl.corners"), RAD_MAX, st.r, function (v) {
        AT.beginGesture();
        var c = current(); if (c) { c.r = v; relayout(c, null, true); }
      }, function () { AT.endGesture(); }));
      var bg = AX.background(AT.doc, ED.pg);
      s2.appendChild(el("div", "pn-h", t("cl.bg")));
      s2.appendChild(bgRow(bg && bg.ax.k === "shape" && !bg.ax.g ? bg.ax.fc : null, function (c) {
        var pg = ED.pg;
        AT.op(function (d, nw) {
          var b = AX.background(d, pg);
          if (!b || b.ax.k !== "shape") return false;
          b.ax.fc = c; delete b.ax.g;
          M.touch(b, nw);
        });
        AT.renderDrawer();
      }));
    }
    s2.appendChild(el("p", "hint", t("cl.hint")));
    body.appendChild(s2);
  });
  function open() { AT.openView("collage"); }

  // ---------- Stage hooks (editor.js) ----------
  // While a single box is dragged: the box under the pointer it would
  // swap with, or null.
  function dropTarget(dragId, p) {
    var d = AT.doc;
    if (!d) return null;
    var it = M.find(d.items, dragId);
    if (!isCell(d, it)) return null;
    var cells = cellsOf(d, it.pg);
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!c || c.id === dragId || c.hide) continue;
      if (p.x >= c.x && p.y >= c.y && p.x <= c.x + c.w && p.y <= c.y + c.h) return c;
    }
    return null;
  }
  // Released over another box: the dragged box goes back to its place
  // and the two swap photos (inside the drag's gesture: one undo step).
  function drop(dragId, start, p) {
    var tg = dropTarget(dragId, p);
    if (!tg) return false;
    var tid = tg.id;
    AT.op(function (d, nw) {
      var a = M.find(d.items, dragId), b = M.find(d.items, tid);
      if (!a || !b) return false;
      a.x = start.x; a.y = start.y;
      swap(a, b);
      M.touch(a, nw); M.touch(b, nw);
    });
    AT.live(t("cl.swapped"));
    return true;
  }
  // A tap on an already selected empty box: pick its photo
  function tapEmpty(it) {
    if (!it || it.a || it.lock || !AT.doc || !isCell(AT.doc, it)) return false;
    AT.io.uploadImage(it.id);
    return true;
  }

  AT.collage = { homeCard: homeCard, newCollage: newCollage, open: open, dropTarget: dropTarget, drop: drop, tapEmpty: tapEmpty,
    isCell: function (it) { return !!(AT.doc && isCell(AT.doc, it)); }, pure: pure };
})(typeof window !== "undefined" ? window : this);
