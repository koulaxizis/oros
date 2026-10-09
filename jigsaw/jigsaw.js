// ============================================================
// orOS Jigsaw — App logic (v1.0.0)
// A picture is cut into 12, 24, 48, 96 or 150 pieces and scattered
// around a frame on a table; drag the pieces back together.
//   - the picture: a photo from the device or from the Files disk
//     (read as a bitmap only; SVG is refused), or a built-in picture
//     drawn by the Wallpaper generator (../wallpaper/art.js, as is);
//     cropped to the puzzle's shape with a preview, then downscaled
//   - classic pieces with tabs and blanks (each tab fits the blank of
//     its neighbour) or plain squares; optional rotation (tap = 90°)
//   - pieces click together near their place or a right neighbour,
//     and then move as one group; a group in its place stays put
//   - helpers: preview, faint picture in the frame, edge pieces only,
//     tidy loose pieces to the side; pinch / wheel zoom, pan
//   - timer; the puzzle in progress resumes after closing
// Data:
//   - synced slice "jigsaw" (oros-jigsaw-data): per piece count the
//     puzzles solved and the best time (and when), as per-device rows
//     (each device only grows its own row; merge = per-row join)
//     + a reset stamp br
//   - device-local, never synced: IndexedDB "oros-jigsaw" (store kv:
//     "img" = the cut picture, "game" = the puzzle in progress),
//     oros-jigsaw-prefs (last settings, helpers), oros-jigsaw-device
//     (row id). The photo never leaves the device.
// Performance: every piece is drawn once to its own canvas; moving,
// rotating and zooming only change CSS transforms.
// Sections:
//   1. Constants, i18n, helpers
//   2. Cutting (grid, edges, piece outlines)
//   3. Table model (groups, snapping, rotation, solved, slots, crop)
//   4. Synced data: load / save / normalize / merge (R5, R26)
//   5. Device-local: prefs + IndexedDB (picture, puzzle)
//   6. Picture intake (device, Files disk, built-in) + setup dialog
//   7. Puzzle build (piece canvases) + view (zoom / pan)
//   8. Input (drag, tap, pinch, wheel, keys, Contract Β)
//   9. Game flow (new, resume, timer, solved)
//  10. Render (toolbar, status) + dialogs (preview, records, result)
//  11. Toasts
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-jigsaw-data";
  var PREFS_KEY   = "oros-jigsaw-prefs";
  var DEVICE_KEY  = "oros-jigsaw-device";
  var IDB_NAME    = "oros-jigsaw";
  var DATA_VER    = 1;
  var GAME_VER    = 1;

  var COUNTS = [12, 24, 48, 96, 150];
  var KEYS = ["12", "24", "48", "96", "150"];
  var GRIDS = { 12: [4, 3], 24: [6, 4], 48: [8, 6], 96: [12, 8], 150: [15, 10] };   // long × short side
  var PAD = { c: 0.3, s: 0.05 };       // canvas margin around a cell, in cells (tabs need room)
  var SLOT = { c: 1.36, s: 1.16 };     // spacing of loose pieces, in cells
  var SNAP = 0.24;                     // snapping distance, in cells
  var FIT = 0.1;                       // "already lined up", in cells
  var MAX_LONG = 1600;                 // long side of the cut picture, px
  var MIN_LONG = 720;
  var MIN_SRC = 200;                   // smallest picture accepted, px
  var MAX_SRC = 3200;                  // long side of a photo while it is cropped
  var MAX_FILE = 40 * 1024 * 1024;
  var MAX_TIME = 864000000;            // 10 days in ms: anything above is noise

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "btn.new": "New puzzle (N)",
      "btn.preview": "Preview the picture (P)",
      "btn.ghost": "Faint picture in the frame (G)",
      "btn.edges": "Edge pieces only (E)",
      "btn.tidy": "Tidy loose pieces to the side (T)",
      "btn.zout": "Zoom out (−)",
      "btn.fit": "Whole table (0)",
      "btn.zin": "Zoom in (+)",
      "btn.stats": "Records",
      "st.time": "Time",
      "st.prog": "{p}% put together",
      "msg.empty": "Pick a picture to start",
      "msg.play": "Drag the pieces: they click together",
      "msg.playRot": "Drag the pieces; tap one to turn it",
      "msg.solved": "Solved in {t}",
      "msg.cutting": "Cutting the pieces…",
      "msg.loading": "Loading your puzzle…",
      "msg.drawing": "Drawing the picture…",
      "table.label": "Puzzle table, {n} pieces",
      "empty.title": "Jigsaw",
      "empty.text": "Pick a picture. A photo of yours stays on this device.",
      "src.device": "From this device",
      "src.files": "From Files",
      "src.art": "Built-in pictures",
      "src.same": "Same picture, cut again",
      "src.title": "New puzzle",
      "src.cancel": "Cancel",
      "files.title": "Pick from Files",
      "files.up": "Up one folder",
      "files.empty": "No pictures in this folder",
      "files.loading": "Reading…",
      "art.title": "Built-in pictures",
      "art.more": "Other pictures",
      "art.pick": "Picture {n}",
      "setup.title": "New puzzle",
      "setup.hint": "Drag to move the picture; pinch, the wheel or the slider to zoom",
      "setup.zoom": "Zoom",
      "setup.pieces": "Pieces",
      "setup.phone": "On a phone, 48 pieces or fewer are easier to handle.",
      "setup.shape": "Shape",
      "shape.c": "Classic",
      "shape.s": "Squares",
      "setup.layout": "Layout",
      "orient.l": "Landscape",
      "orient.p": "Portrait",
      "setup.rot": "Rotated pieces (tap one to turn it)",
      "setup.cancel": "Cancel",
      "setup.start": "Start",
      "res.title": "Solved!",
      "res.record": "New record!",
      "res.pieces": "Pieces",
      "res.best": "Best time",
      "res.solved": "Solved",
      "res.close": "Close",
      "res.new": "New puzzle",
      "prev.title": "The picture",
      "prev.close": "Close",
      "stats.title": "Records",
      "stats.head": "Best time · solved",
      "stats.row": "{n} pieces",
      "stats.reset": "Reset records",
      "stats.close": "Close",
      "confirm.reset": "Delete the records on every device?",
      "confirm.yes": "Reset",
      "confirm.no": "Cancel",
      "live.joined": "Pieces joined",
      "live.placed": "In place",
      "live.edgesOn": "Only the edge pieces are shown",
      "live.edgesOff": "All pieces are shown",
      "toast.reset": "Records reset",
      "toast.newgame": "New puzzle",
      "toast.undo": "Undo",
      "toast.svg": "SVG pictures are not accepted: use PNG, JPEG or WebP",
      "toast.notImage": "That is not a picture this app can open",
      "toast.big": "The file is too large (40 MB at most)",
      "toast.small": "The picture is too small (200 × 200 at least)",
      "toast.decode": "Could not read the picture",
      "toast.noFiles": "The Files disk is not available here",
      "toast.filesErr": "Could not read the Files disk",
      "toast.noArt": "The built-in pictures are not available",
      "toast.store": "This puzzle can't be kept on this device: it will not resume",
      "toast.save": "Could not save: storage is full",
      "toast.noPuzzle": "Start a puzzle first",
      "toast.noTidy": "Nothing to tidy: every piece is in a group",
      "toast.solved": "Solved! Start a new puzzle (N)"
    },
    el: {
      "btn.new": "Νέο παζλ (N)",
      "btn.preview": "Προεπισκόπηση της εικόνας (P)",
      "btn.ghost": "Αχνή εικόνα στο πλαίσιο (G)",
      "btn.edges": "Μόνο τα κομμάτια της άκρης (E)",
      "btn.tidy": "Τακτοποίηση των σκόρπιων κομματιών στο πλάι (T)",
      "btn.zout": "Σμίκρυνση (−)",
      "btn.fit": "Όλο το τραπέζι (0)",
      "btn.zin": "Μεγέθυνση (+)",
      "btn.stats": "Ρεκόρ",
      "st.time": "Χρόνος",
      "st.prog": "{p}% έτοιμο",
      "msg.empty": "Διάλεξε μια εικόνα για να ξεκινήσεις",
      "msg.play": "Σύρε τα κομμάτια: κουμπώνουν μόνα τους",
      "msg.playRot": "Σύρε τα κομμάτια· πάτα ένα για να το γυρίσεις",
      "msg.solved": "Λύθηκε σε {t}",
      "msg.cutting": "Κόβω τα κομμάτια…",
      "msg.loading": "Φορτώνω το παζλ σου…",
      "msg.drawing": "Ζωγραφίζω την εικόνα…",
      "table.label": "Τραπέζι παζλ, {n} κομμάτια",
      "empty.title": "Παζλ",
      "empty.text": "Διάλεξε μια εικόνα. Οι φωτογραφίες σου μένουν σε αυτή τη συσκευή.",
      "src.device": "Από τη συσκευή",
      "src.files": "Από τα Αρχεία",
      "src.art": "Έτοιμες εικόνες",
      "src.same": "Ίδια εικόνα, νέο κόψιμο",
      "src.title": "Νέο παζλ",
      "src.cancel": "Άκυρο",
      "files.title": "Επιλογή από τα Αρχεία",
      "files.up": "Έναν φάκελο πάνω",
      "files.empty": "Δεν υπάρχουν εικόνες σε αυτόν τον φάκελο",
      "files.loading": "Διαβάζω…",
      "art.title": "Έτοιμες εικόνες",
      "art.more": "Άλλες εικόνες",
      "art.pick": "Εικόνα {n}",
      "setup.title": "Νέο παζλ",
      "setup.hint": "Σύρε για να μετακινήσεις την εικόνα· τσίμπημα, ροδέλα ή ο ρυθμιστής για ζουμ",
      "setup.zoom": "Ζουμ",
      "setup.pieces": "Κομμάτια",
      "setup.phone": "Στο κινητό, ως 48 κομμάτια πιάνονται πιο άνετα.",
      "setup.shape": "Σχήμα",
      "shape.c": "Κλασικό",
      "shape.s": "Τετράγωνα",
      "setup.layout": "Προσανατολισμός",
      "orient.l": "Οριζόντιο",
      "orient.p": "Κάθετο",
      "setup.rot": "Γυρισμένα κομμάτια (πάτα ένα για να το γυρίσεις)",
      "setup.cancel": "Άκυρο",
      "setup.start": "Ξεκίνα",
      "res.title": "Λύθηκε!",
      "res.record": "Νέο ρεκόρ!",
      "res.pieces": "Κομμάτια",
      "res.best": "Καλύτερος χρόνος",
      "res.solved": "Λυμένα",
      "res.close": "Κλείσιμο",
      "res.new": "Νέο παζλ",
      "prev.title": "Η εικόνα",
      "prev.close": "Κλείσιμο",
      "stats.title": "Ρεκόρ",
      "stats.head": "Καλύτερος χρόνος · λυμένα",
      "stats.row": "{n} κομμάτια",
      "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο",
      "confirm.reset": "Να διαγραφούν τα ρεκόρ σε όλες τις συσκευές;",
      "confirm.yes": "Μηδενισμός",
      "confirm.no": "Άκυρο",
      "live.joined": "Τα κομμάτια ενώθηκαν",
      "live.placed": "Στη θέση του",
      "live.edgesOn": "Φαίνονται μόνο τα κομμάτια της άκρης",
      "live.edgesOff": "Φαίνονται όλα τα κομμάτια",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν",
      "toast.newgame": "Νέο παζλ",
      "toast.undo": "Αναίρεση",
      "toast.svg": "Οι εικόνες SVG δεν γίνονται δεκτές: προτίμησε PNG, JPEG ή WebP",
      "toast.notImage": "Αυτό δεν είναι εικόνα που ανοίγει εδώ",
      "toast.big": "Το αρχείο είναι πολύ μεγάλο (έως 40 MB)",
      "toast.small": "Η εικόνα είναι πολύ μικρή (τουλάχιστον 200 × 200)",
      "toast.decode": "Η εικόνα δεν διαβάστηκε",
      "toast.noFiles": "Ο δίσκος των Αρχείων δεν είναι διαθέσιμος εδώ",
      "toast.filesErr": "Ο δίσκος των Αρχείων δεν διαβάστηκε",
      "toast.noArt": "Οι έτοιμες εικόνες δεν είναι διαθέσιμες",
      "toast.store": "Το παζλ δεν μπορεί να κρατηθεί σε αυτή τη συσκευή: δεν θα συνεχιστεί",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.noPuzzle": "Ξεκίνα πρώτα ένα παζλ",
      "toast.noTidy": "Τίποτα για τακτοποίηση: όλα τα κομμάτια είναι σε ομάδες",
      "toast.solved": "Λύθηκε! Ξεκίνα νέο παζλ (N)"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // crypto RNG in [0, 1)
  function rand() {
    var buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992;
  }
  function randSeed() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] >>> 0) || 1;
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // m:ss, or h:mm:ss from an hour on
  function fmtTime(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    s = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  // dd/mm/yyyy in both languages (Part II)
  function fmtDate(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("jigsaw.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Cutting ----------
  // A small seeded generator (xorshift32): the same seed cuts the same
  // pieces, so a saved puzzle keeps only its seed.
  function prng(seed) {
    var x = (seed >>> 0) || 1;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  // cols × rows for a piece count; a portrait puzzle swaps them.
  function gridFor(n, portrait) {
    var g = GRIDS[n];
    if (!g) return null;
    return portrait ? { cols: g[1], rows: g[0] } : { cols: g[0], rows: g[1] };
  }

  // Every inner edge is cut once and shared by the two pieces on it.
  // h[r * cols + c]: between row r and r + 1 (r < rows - 1);
  // v[r * (cols - 1) + c]: between column c and c + 1.
  // d = +1: the tab bulges into the second piece (below / right),
  // d = -1: into the first one, d = 0: a straight cut (squares).
  function makeEdges(cols, rows, shape, rnd) {
    function one() {
      if (shape === "s") return { d: 0 };
      return {
        d: rnd() < 0.5 ? -1 : 1,
        m: 0.46 + rnd() * 0.08,       // where the tab sits along the edge
        w: 0.085 + rnd() * 0.025,     // half width of the neck
        hr: 0.14 + rnd() * 0.03,      // half width of the head
        h: 0.22 + rnd() * 0.05,       // how far it reaches
        k: (rnd() - 0.5) * 0.04       // a slight lean
      };
    }
    var h = [], v = [], r, c;
    for (r = 0; r < rows - 1; r++) for (c = 0; c < cols; c++) h.push(one());
    for (r = 0; r < rows; r++) for (c = 0; c < cols - 1; c++) v.push(one());
    return { cols: cols, rows: rows, h: h, v: v };
  }

  // The edge as a chain of cubic curves in unit coordinates: u runs
  // along the edge 0 → 1, v across it (v > 0 = toward the second piece).
  // Flat list: x0,y0, then 3 points (2 controls + end) per curve.
  function edgeCurve(e) {
    if (!e || !e.d) return [0, 0, 1 / 3, 0, 2 / 3, 0, 1, 0];
    var m = e.m, w = e.w, hr = e.hr, h = e.h, k = e.k, d = e.d;
    var pts = [
      0, 0,
      (m - w) * 0.5, -0.02, m - w - 0.02, -0.01, m - w, 0,
      m - w + 0.01, h * 0.35, m - hr + k, h * 0.3, m - hr + k, h * 0.62,
      m - hr + k, h * 0.9, m + k - hr * 0.55, h, m + k, h,
      m + k + hr * 0.55, h, m + hr + k, h * 0.9, m + hr + k, h * 0.62,
      m + hr + k, h * 0.3, m + w - 0.01, h * 0.35, m + w, 0,
      m + w + 0.02, -0.01, m + w + (1 - m - w) * 0.5, -0.02, 1, 0
    ];
    for (var i = 1; i < pts.length; i += 2) pts[i] *= d;
    return pts;
  }

  // Reverse a chain (the same curve, walked the other way).
  function reverseChain(pts) {
    var out = [];
    for (var i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
  }

  // Tab (+1), blank (-1) or flat (0) on each side of a piece, as the
  // piece sees it: [top, right, bottom, left].
  function pieceSides(E, id) {
    var cols = E.cols, rows = E.rows, r = Math.floor(id / cols), c = id % cols;
    return [
      r > 0 ? -E.h[(r - 1) * cols + c].d : 0,
      c < cols - 1 ? E.v[r * (cols - 1) + c].d : 0,
      r < rows - 1 ? E.h[r * cols + c].d : 0,
      c > 0 ? -E.v[r * (cols - 1) + c - 1].d : 0
    ];
  }

  // The outline of a piece, clockwise from its top-left corner, in
  // pixels with the cell's top-left at (0, 0): four chains (top, right,
  // bottom, left). A shared edge is the SAME curve for both pieces.
  function pieceOutline(E, id, s) {
    var cols = E.cols, rows = E.rows, r = Math.floor(id / cols), c = id % cols;
    function map(e, fx) {
      var p = edgeCurve(e), out = [];
      for (var i = 0; i < p.length; i += 2) {
        var q = fx(p[i], p[i + 1]);
        out.push(q[0], q[1]);
      }
      return out;
    }
    var top = map(r > 0 ? E.h[(r - 1) * cols + c] : null, function (u, v) { return [u * s, v * s]; });
    var right = map(c < cols - 1 ? E.v[r * (cols - 1) + c] : null, function (u, v) { return [s + v * s, u * s]; });
    var bottom = reverseChain(map(r < rows - 1 ? E.h[r * cols + c] : null, function (u, v) { return [u * s, s + v * s]; }));
    var left = reverseChain(map(c > 0 ? E.v[r * (cols - 1) + c - 1] : null, function (u, v) { return [v * s, u * s]; }));
    return [top, right, bottom, left];
  }

  function isBorder(M, id) {
    var r = Math.floor(id / M.cols), c = id % M.cols;
    return r === 0 || c === 0 || r === M.rows - 1 || c === M.cols - 1;
  }

  // ---------- 3. Table model ----------
  // M = { cols, rows, s (cell px), fx, fy (frame's top-left on the
  // table), tw, th (table size) }. P[id] = { x, y (cell centre on the
  // table), r (quarter turns clockwise), g (group = its smallest id),
  // z (stacking) }.
  function rotVec(x, y, r) {
    r = ((r % 4) + 4) % 4;
    if (r === 1) return [-y, x];
    if (r === 2) return [-x, -y];
    if (r === 3) return [y, -x];
    return [x, y];
  }

  function home(M, id) {
    return { x: M.fx + (id % M.cols + 0.5) * M.s, y: M.fy + (Math.floor(id / M.cols) + 0.5) * M.s };
  }

  // Where piece b belongs when piece a stays where it is.
  function relPos(P, M, a, b) {
    var cols = M.cols;
    var v = rotVec((b % cols - a % cols) * M.s, (Math.floor(b / cols) - Math.floor(a / cols)) * M.s, P[a].r);
    return { x: P[a].x + v[0], y: P[a].y + v[1] };
  }

  function neighbours(M, id) {
    var r = Math.floor(id / M.cols), c = id % M.cols, out = [];
    if (r > 0) out.push(id - M.cols);
    if (c < M.cols - 1) out.push(id + 1);
    if (r < M.rows - 1) out.push(id + M.cols);
    if (c > 0) out.push(id - 1);
    return out;
  }

  function members(P, g) {
    var out = [];
    for (var i = 0; i < P.length; i++) if (P[i].g === g) out.push(i);
    return out;
  }

  function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

  function isPlaced(P, M, id) {
    var h = home(M, id);
    return P[id].r === 0 && dist(P[id].x, P[id].y, h.x, h.y) < 0.01 * M.s;
  }

  function joinGroups(P, a, b) {
    var g = Math.min(a, b);
    for (var i = 0; i < P.length; i++) if (P[i].g === a || P[i].g === b) P[i].g = g;
    return g;
  }

  // Every member exactly where it belongs relative to the anchor.
  function regularize(P, M, g, anchor) {
    members(P, g).forEach(function (m) {
      if (m === anchor) return;
      var q = relPos(P, M, anchor, m);
      P[m].x = q.x; P[m].y = q.y; P[m].r = P[anchor].r;
    });
  }

  // After a drop: the group clicks onto the nearest right neighbour or
  // its own place in the frame (within SNAP cells), then takes in every
  // other group that now lines up (within FIT). Mutates P; returns
  // { g, joined: groups taken in, placed: the group is in its place }.
  function snapGroup(P, M, g) {
    var ids = members(P, g), r = P[ids[0]].r, tol = SNAP * M.s, best = null;
    ids.forEach(function (a) {
      neighbours(M, a).forEach(function (b) {
        if (P[b].g === g || P[b].r !== r) return;
        var e = relPos(P, M, b, a), d = dist(e.x, e.y, P[a].x, P[a].y);
        if (d < tol && (!best || d < best.d)) best = { d: d, dx: e.x - P[a].x, dy: e.y - P[a].y, to: P[b].g, anchor: b };
      });
      if (r === 0) {
        var h = home(M, a), dh = dist(h.x, h.y, P[a].x, P[a].y);
        if (dh < tol && (!best || dh < best.d)) best = { d: dh, dx: h.x - P[a].x, dy: h.y - P[a].y, to: -1, anchor: a };
      }
    });
    if (!best) return { g: g, joined: 0, placed: false };
    ids.forEach(function (a) { P[a].x += best.dx; P[a].y += best.dy; });
    var joined = 0;
    if (best.to >= 0) { g = joinGroups(P, g, best.to); joined++; }
    var fit = FIT * M.s, changed = true;
    while (changed) {
      changed = false;
      var mem = members(P, g);
      for (var i = 0; i < mem.length && !changed; i++) {
        var nb = neighbours(M, mem[i]);
        for (var j = 0; j < nb.length; j++) {
          var b = nb[j];
          if (P[b].g === g || P[b].r !== r) continue;
          var e = relPos(P, M, mem[i], b);
          if (dist(e.x, e.y, P[b].x, P[b].y) < fit) { g = joinGroups(P, g, P[b].g); joined++; changed = true; break; }
        }
      }
    }
    // Anchor: a member already (nearly) in its place keeps the group
    // there exactly; else the piece we clicked onto.
    var anchor = best.anchor, placedAnchor = -1;
    if (r === 0) {
      members(P, g).forEach(function (m) {
        var h = home(M, m);
        if (placedAnchor < 0 && dist(h.x, h.y, P[m].x, P[m].y) < fit) placedAnchor = m;
      });
    }
    if (placedAnchor >= 0) {
      anchor = placedAnchor;
      var hh = home(M, anchor);
      P[anchor].x = hh.x; P[anchor].y = hh.y;
    }
    regularize(P, M, g, anchor);
    return { g: g, joined: joined, placed: placedAnchor >= 0 };
  }

  // Solved = every piece upright and where it belongs relative to the
  // first one (anywhere on the table).
  function isSolved(P, M) {
    if (!P.length) return false;
    for (var i = 0; i < P.length; i++) {
      if (P[i].r !== 0) return false;
      var e = relPos(P, M, 0, i);
      if (dist(e.x, e.y, P[i].x, P[i].y) > 0.02 * M.s) return false;
    }
    return true;
  }

  // Share of the joins made, 0..100.
  function progress(P) {
    if (P.length < 2) return 0;
    var gs = {};
    P.forEach(function (p) { gs[p.g] = 1; });
    return Math.round(100 * (P.length - Object.keys(gs).length) / (P.length - 1));
  }

  // Keep a moving group on the table: the shift, cut so every centre
  // stays inside it.
  function clampShift(P, M, ids, dx, dy) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    ids.forEach(function (i) {
      x0 = Math.min(x0, P[i].x); x1 = Math.max(x1, P[i].x);
      y0 = Math.min(y0, P[i].y); y1 = Math.max(y1, P[i].y);
    });
    var m = M.s * 0.3;
    return [clamp(dx, m - x0, Math.max(m - x0, M.tw - m - x1)), clamp(dy, m - y0, Math.max(m - y0, M.th - m - y1))];
  }

  // A quarter turn clockwise of a whole group around one piece.
  function rotateGroup(P, M, g, pivot) {
    var ids = members(P, g), px = P[pivot].x, py = P[pivot].y;
    ids.forEach(function (i) {
      var v = rotVec(P[i].x - px, P[i].y - py, 1);
      P[i].x = px + v[0]; P[i].y = py + v[1];
      P[i].r = (P[i].r + 1) % 4;
    });
    var sh = clampShift(P, M, ids, 0, 0);
    ids.forEach(function (i) { P[i].x += sh[0]; P[i].y += sh[1]; });
  }

  // Places for loose pieces: a grid around the frame (never on it),
  // nearest to the frame first.
  function slotList(M, shape) {
    var gap = (SLOT[shape] || SLOT.c) * M.s, out = [];
    var nx = Math.floor(M.tw / gap), ny = Math.floor(M.th / gap);
    var ox = (M.tw - nx * gap) / 2, oy = (M.th - ny * gap) / 2;
    var fx0 = M.fx - 0.15 * M.s, fy0 = M.fy - 0.15 * M.s;
    var fx1 = M.fx + M.cols * M.s + 0.15 * M.s, fy1 = M.fy + M.rows * M.s + 0.15 * M.s;
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var x = ox + (i + 0.5) * gap, y = oy + (j + 0.5) * gap, hg = gap * 0.42;
        if (x + hg > fx0 && x - hg < fx1 && y + hg > fy0 && y - hg < fy1) continue;
        var dx = Math.max(fx0 - x, 0, x - fx1), dy = Math.max(fy0 - y, 0, y - fy1);
        out.push({ x: x, y: y, d: Math.round(Math.sqrt(dx * dx + dy * dy) * 1000) });
      }
    }
    out.sort(function (a, b) { return a.d - b.d || a.y - b.y || a.x - b.x; });
    return out;
  }

  // The table: the frame plus a margin on every side, grown on the side
  // that keeps the table closest to the screen's shape, until the loose
  // pieces have room (10% spare).
  function tableFor(cols, rows, s, shape, aspect) {
    var W = cols * s, H = rows * s, gap = (SLOT[shape] || SLOT.c) * s, n = cols * rows;
    var mx = gap, my = gap;
    aspect = clamp(isNum(aspect) && aspect > 0 ? aspect : 1.5, 0.45, 2.4);
    for (var k = 0; k < 400; k++) {
      var M = { cols: cols, rows: rows, s: s, fx: mx, fy: my, tw: W + 2 * mx, th: H + 2 * my };
      if (slotList(M, shape).length >= Math.ceil(n * 1.1)) return M;
      if (M.tw / M.th < aspect) mx += gap / 2; else my += gap / 2;
    }
    return M;
  }

  // Loose pieces to the side: edge pieces first, the rest after, each
  // set in its current reading order (no hint of where they belong).
  function tidyOrder(P, M, ids) {
    return ids.slice().sort(function (a, b) {
      var ea = isBorder(M, a) ? 0 : 1, eb = isBorder(M, b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      var ya = Math.round(P[a].y / M.s), yb = Math.round(P[b].y / M.s);
      return ya - yb || P[a].x - P[b].x || a - b;
    });
  }

  // The crop of a picture (w × h) for a puzzle of the given aspect:
  // zoom 1 = the largest crop that fits; (cx, cy) = wanted centre.
  function cropRect(w, h, aspect, zoom, cx, cy) {
    var cw, ch;
    if (w / h > aspect) { ch = h; cw = h * aspect; } else { cw = w; ch = w / aspect; }
    zoom = clamp(isNum(zoom) ? zoom : 1, 1, 8);
    cw /= zoom; ch /= zoom;
    var x = clamp((isNum(cx) ? cx : w / 2) - cw / 2, 0, w - cw);
    var y = clamp((isNum(cy) ? cy : h / 2) - ch / 2, 0, h - ch);
    return { x: x, y: y, w: cw, h: ch };
  }

  // Raster formats by their first bytes; anything else (SVG, text,
  // HTML, …) is refused before it is decoded.
  function sniffImage(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "png";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
    if (b[0] === 0x42 && b[1] === 0x4D) return "bmp";
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
        b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69) return "avif";
    return null;
  }

  // ---------- 4. Synced data ----------
  // data = {
  //   ver: 1,
  //   br: <reset stamp>,                                     // max-merged
  //   rows: { <deviceId>: { b: <epoch>,
  //                         s: { 12|24|48|96|150: { n: solved, t: best ms, ts: when } } } }
  // }
  // Each device only ever writes ITS OWN row; a row counts from epoch b.
  // Merge per row: the newer epoch wins; equal epochs take, per count,
  // the larger n and the better best (lower t, then the earlier ts).
  // Rows older than br drop. A join (symmetric, associative, idempotent).
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }

  function normCell(v) {
    if (!v || typeof v !== "object" || !isInt(v.n) || !isInt(v.t) || !isInt(v.ts) ||
        v.n < 1 || v.n > 1000000 || v.t < 1 || v.t > MAX_TIME || v.ts < 0) return null;
    return { n: v.n, t: v.t, ts: v.ts };
  }

  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    KEYS.forEach(function (k) {
      var c = normCell(row.s && row.s[k]);
      if (c) { s[k] = c; any = true; }
    });
    return any ? { b: row.b, s: s } : null;
  }

  function joinCell(a, c) {
    var best = (a.t !== c.t) ? (a.t < c.t ? a : c) : (a.ts <= c.ts ? a : c);
    return { n: Math.max(a.n, c.n), t: best.t, ts: best.ts };
  }

  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      s[k] = (a && c) ? joinCell(a, c) : normCell(a || c);
    });
    return { b: x.b, s: s };
  }

  function mergeJigsaw(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) && a.br > 0 ? a.br : 0, isInt(b.br) && b.br > 0 ? b.br : 0);
    var rows = {};
    [a.rows, b.rows].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }

  // Solved count and best time (and when) for a count, every device.
  function totals(d, key) {
    var out = { n: 0, t: 0, ts: 0 };
    Object.keys(d.rows).forEach(function (id) {
      var c = d.rows[id].s[key];
      if (!c) return;
      out.n += c.n;
      if (!out.t || c.t < out.t || (c.t === out.t && c.ts < out.ts)) { out.t = c.t; out.ts = c.ts; }
    });
    return out;
  }

  // One solved puzzle on this device's row; returns the new data and
  // whether it beat every device's best.
  function addSolve(d, dev, key, ms, when) {
    var before = totals(d, key).t;
    var cur = d.rows[dev];
    var row = (cur && cur.b >= d.br) ? { b: cur.b, s: JSON.parse(JSON.stringify(cur.s)) } : { b: d.br, s: {} };
    var c = row.s[key];
    ms = clamp(Math.round(ms), 1, MAX_TIME);
    if (!c) c = { n: 1, t: ms, ts: when };
    else c = (ms < c.t) ? { n: c.n + 1, t: ms, ts: when } : { n: c.n + 1, t: c.t, ts: c.ts };
    row.s[key] = c;
    var next = { ver: DATA_VER, br: d.br, rows: {} };
    Object.keys(d.rows).forEach(function (id) { next.rows[id] = d.rows[id]; });
    next.rows[dev] = row;
    return { data: mergeJigsaw(next, next), record: !before || ms < before };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeJigsaw(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] jigsaw: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = defaultData();
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function ensureDeviceId() {
    try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!deviceId || !/^[a-z0-9]{6,32}$/.test(deviceId)) {
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }

  // ---------- 5. Device-local: prefs + IndexedDB ----------
  var prefs = { n: 0, shape: "c", rot: false, ghost: false, edges: false };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (COUNTS.indexOf(p.n) >= 0) prefs.n = p.n;
        if (p.shape === "c" || p.shape === "s") prefs.shape = p.shape;
        if (typeof p.rot === "boolean") prefs.rot = p.rot;
        if (typeof p.ghost === "boolean") prefs.ghost = p.ghost;
        if (typeof p.edges === "boolean") prefs.edges = p.edges;
      }
    } catch (e) {}
    if (!prefs.n) prefs.n = smallScreen() ? 24 : 48;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function smallScreen() {
    return Math.min(window.innerWidth || 1000, window.innerHeight || 1000) < 600 ||
      !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches && (window.innerWidth || 0) < 900);
  }

  // One store, two keys: "img" { id, blob, w, h } and "game" (below).
  var idbBroken = false;
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no idb")); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("blocked")); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction("kv").objectStore("kv").get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }
  // puts = { key: value | null (delete) }; resolves true when written.
  function idbPut(puts) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("kv", "readwrite"), st = tx.objectStore("kv");
        Object.keys(puts).forEach(function (k) {
          if (puts[k] === null) st.delete(k); else st.put(puts[k], k);
        });
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = tx.onabort = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; }).then(function (ok) {
      if (!ok && !idbBroken) { idbBroken = true; showToast(t("toast.store")); }
      return ok;
    });
  }

  // game = { v, img, n, cols, rows, s, shape, rot, seed, fx, fy, tw, th,
  //          p: [[x, y, r, g, z] × n], el (ms played), done (0|1), at }
  function validGame(G, img) {
    if (!G || typeof G !== "object" || G.v !== GAME_VER || COUNTS.indexOf(G.n) < 0) return null;
    var g1 = gridFor(G.n, false), g2 = gridFor(G.n, true);
    if (!((G.cols === g1.cols && G.rows === g1.rows) || (G.cols === g2.cols && G.rows === g2.rows))) return null;
    if (!isInt(G.s) || G.s < 8 || G.s > 2000 || (G.shape !== "c" && G.shape !== "s") ||
        (G.rot !== 0 && G.rot !== 1) || !isInt(G.seed) || G.seed < 1 || G.seed > 4294967295) return null;
    if (!isNum(G.fx) || !isNum(G.fy) || !isNum(G.tw) || !isNum(G.th) || G.fx < 0 || G.fy < 0 ||
        G.tw < G.fx + G.cols * G.s || G.th < G.fy + G.rows * G.s || G.tw > 40 * G.cols * G.s) return null;
    if (!isInt(G.el) || G.el < 0 || G.el > MAX_TIME || (G.done !== 0 && G.done !== 1) || !isInt(G.at)) return null;
    if (!img || img.id !== G.img || img.w !== G.cols * G.s || img.h !== G.rows * G.s) return null;
    if (!Array.isArray(G.p) || G.p.length !== G.n) return null;
    var P = [], ok = true;
    G.p.forEach(function (q, i) {
      if (!ok) return;
      if (!Array.isArray(q) || q.length !== 5 || !isNum(q[0]) || !isNum(q[1]) || !isInt(q[2]) || !isInt(q[3]) ||
          !isInt(q[4]) || q[2] < 0 || q[2] > 3 || (!G.rot && q[2]) || q[3] < 0 || q[3] > i || q[4] < 0) { ok = false; return; }
      P.push({ x: clamp(q[0], 0, G.tw), y: clamp(q[1], 0, G.th), r: q[2], g: q[3], z: q[4] });
    });
    if (!ok) return null;
    // a group is named by its smallest member and turned as one
    for (var i = 0; i < P.length; i++) {
      if (P[P[i].g].g !== P[i].g || P[P[i].g].r !== P[i].r) return null;
    }
    var M = { cols: G.cols, rows: G.rows, s: G.s, fx: G.fx, fy: G.fy, tw: G.tw, th: G.th };
    var seen = {};
    P.forEach(function (p, i) { if (p.g === i && !seen[i]) { seen[i] = 1; regularize(P, M, i, i); } });
    var order = P.map(function (p, i) { return i; }).sort(function (a, b) { return P[a].z - P[b].z || a - b; });
    order.forEach(function (id, k) { P[id].z = k; });
    return { G: G, M: M, P: P };
  }

  // ---------- 6. Picture intake ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  // Standalone (no shell): a one-shot hidden input.
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function fsApi() {
    try {
      var fs = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return fs && typeof fs.ls === "function" && typeof fs.readBlob === "function" ? fs : null;
    } catch (e) { return null; }
  }

  var ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";
  var IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

  function pickFromDevice() {
    var dlg = dialogHost();
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(ACCEPT) : localPickFile(ACCEPT);
    pick.then(function (file) {
      if (!file) return;                       // cancel: silent exit (R33)
      intake(file, file.name || "");
    });
  }

  // Bytes first (raster only), then a bitmap decode; never an <img> of
  // user data before the check, never SVG.
  function intake(blob, name) {
    if (!blob || typeof blob.size !== "number") { showToast(t("toast.notImage")); return; }
    if (/svg/i.test(blob.type || "") || /\.svgz?$/i.test(name || "")) { showToast(t("toast.svg")); return; }
    if (blob.size > MAX_FILE) { showToast(t("toast.big")); return; }
    blob.slice(0, 32).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      if (!sniffImage(b)) {
        var head = "";
        for (var i = 0; i < b.length; i++) head += String.fromCharCode(b[i]);
        showToast(t(/^\s*(﻿|\xEF\xBB\xBF)?\s*</.test(head) ? "toast.svg" : "toast.notImage"));
        return null;
      }
      return decode(blob).then(function (src) {
        if (src.w < MIN_SRC || src.h < MIN_SRC) { showToast(t("toast.small")); return; }
        setupDialog(shrink(src));
      }, function () { showToast(t("toast.decode")); });
    }).catch(function () { showToast(t("toast.decode")); });
  }

  // A big photo is kept at most MAX_SRC px on its long side while it is
  // cropped (a 48 MP bitmap would hold ~190 MB on a phone).
  function shrink(src) {
    var k = MAX_SRC / Math.max(src.w, src.h);
    if (k >= 1) return src;
    var w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src.img, 0, 0, w, h);
    if (src.img && typeof src.img.close === "function") src.img.close();
    return { img: cv, w: w, h: h };
  }

  function decode(blob) {
    if (typeof window.createImageBitmap === "function") {
      return createImageBitmap(blob).then(function (bm) { return { img: bm, w: bm.width, h: bm.height }; });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve({ img: im, w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      im.src = url;
    });
  }

  // Files disk browser: folders and raster pictures only.
  function filesDialog() {
    var fs = fsApi();
    if (!fs) { showToast(t("toast.noFiles")); return; }
    var dlg = makeDialog("jg-files");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("files.title")));
    var bar = el("div", "fl-bar");
    var up = iconButton("up", t("files.up"), function () { if (cwd !== "/internal") go(cwd.replace(/\/[^/]+$/, "") || "/internal"); });
    var where = el("span", "fl-path", "");
    bar.appendChild(up);
    bar.appendChild(where);
    dlg.appendChild(bar);
    var list = el("div", "fl-list");
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("src.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var cwd = "/internal", gen = 0;
    function go(path) {
      cwd = path;
      var my = ++gen;
      up.disabled = path === "/internal";
      where.textContent = path === "/internal" ? "/" : path.replace(/^\/internal/, "");
      list.textContent = "";
      list.appendChild(el("p", "fl-note", t("files.loading")));
      Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () {
        return fs.ls(path);
      }).then(function (entries) {
        if (my !== gen) return;
        list.textContent = "";
        var shown = 0;
        (entries || []).forEach(function (en) {
          if (!en || typeof en.name !== "string") return;
          if (!en.dir && !IMG_EXT.test(en.name)) return;
          shown++;
          var b = el("button", "fl-item" + (en.dir ? " dir" : ""));
          b.type = "button";
          b.innerHTML = en.dir ? UI_ICONS.folder : UI_ICONS.image;
          b.appendChild(el("span", "", en.name));
          b.addEventListener("click", function () {
            var p = path + "/" + en.name;
            if (en.dir) { go(p); return; }
            fs.readBlob(p).then(function (blob) {
              dlg.close();
              intake(blob, en.name);
            }, function () { showToast(t("toast.filesErr")); });
          });
          list.appendChild(b);
        });
        if (!shown) list.appendChild(el("p", "fl-note", t("files.empty")));
      }, function () {
        if (my !== gen) return;
        list.textContent = "";
        list.appendChild(el("p", "fl-note", t("toast.filesErr")));
      });
    }
    document.body.appendChild(dlg);
    dlg.showModal();
    go("/internal");
  }

  // Built-in pictures: recipes for the Wallpaper generator, drawn here.
  function artApi() { return window.OrosWallArt || null; }
  function randomRecipe(A, style) {
    var pick = function (list) { return list[Math.floor(rand() * list.length)]; };
    return A.normRecipe({
      seed: A.randomSeed(), style: style, pal: pick(A.PALETTES),
      dens: 30 + Math.floor(rand() * 50), chaos: 20 + Math.floor(rand() * 60),
      grain: 0, light: rand() < 0.3 ? 1 : 0
    });
  }
  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d4af37";
  }

  function artDialog() {
    var A = artApi();
    if (!A) { showToast(t("toast.noArt")); return; }
    var dlg = makeDialog("jg-art");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("art.title")));
    var grid = el("div", "art-grid");
    dlg.appendChild(grid);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("src.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("art.more"), "", fill));
    dlg.appendChild(acts);
    function fill() {
      grid.textContent = "";
      // every style in turn, in a new order each time
      var styles = A.STYLES.slice();
      for (var j = styles.length - 1; j > 0; j--) {
        var x = Math.floor(rand() * (j + 1)), tmp = styles[j];
        styles[j] = styles[x]; styles[x] = tmp;
      }
      for (var i = 0; i < 6; i++) {
        (function (k) {
          var recipe = randomRecipe(A, styles[k % styles.length]);
          var b = el("button", "art-item");
          b.type = "button";
          b.setAttribute("aria-label", t("art.pick", { n: k + 1 }));
          var cv = document.createElement("canvas");
          cv.width = 160; cv.height = 160;
          b.appendChild(cv);
          grid.appendChild(b);
          try { A.renderSync(cv.getContext("2d"), 160, 160, recipe, { accent: accent() }); } catch (e) {}
          b.addEventListener("click", function () { dlg.close(); drawArt(recipe); });
        })(i);
      }
    }
    document.body.appendChild(dlg);
    dlg.showModal();
    fill();
  }

  function drawArt(recipe) {
    var A = artApi(), size = MAX_LONG;
    var cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    setBusy(t("msg.drawing"));
    A.render(cv.getContext("2d"), size, size, recipe, { accent: accent() }).then(function () {
      setBusy("");
      setupDialog({ img: cv, w: size, h: size });
    }, function () { setBusy(""); showToast(t("toast.decode")); });
  }

  function sourceButtons(host, onPick) {
    [["device", "src.device", pickFromDevice], ["files", "src.files", filesDialog], ["art", "src.art", artDialog]]
      .forEach(function (x) {
        var b = el("button", "src-btn");
        b.type = "button";
        b.innerHTML = UI_ICONS["src_" + x[0]];
        b.appendChild(el("span", "", t(x[1])));
        b.addEventListener("click", function () { if (onPick) onPick(); x[2](); });
        host.appendChild(b);
      });
  }

  function sourceDialog() {
    var dlg = makeDialog("jg-source");
    dlg.appendChild(el("div", "dlg-title", t("src.title")));
    var list = el("div", "src-list");
    sourceButtons(list, function () { dlg.close(); });
    if (cur) {
      var same = el("button", "src-btn");
      same.type = "button";
      same.innerHTML = UI_ICONS.again;
      same.appendChild(el("span", "", t("src.same")));
      same.addEventListener("click", function () {
        dlg.close();
        setupDialog({ img: cur.bitmap, w: cur.imgRec.w, h: cur.imgRec.h });
      });
      list.appendChild(same);
    }
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    var cancel = button(t("src.cancel"), "", function () { dlg.close(); });
    acts.appendChild(cancel);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    cancel.focus();
  }

  // Crop + settings, with a live preview of the crop.
  function setupDialog(src) {
    var st = {
      n: prefs.n, shape: prefs.shape, rot: prefs.rot,
      portrait: stageAspect() < 1, zoom: 1, cx: src.w / 2, cy: src.h / 2
    };
    var dlg = makeDialog("jg-setup");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("setup.title")));
    var box = el("div", "crop-box");
    var cv = document.createElement("canvas");
    box.appendChild(cv);
    dlg.appendChild(box);
    dlg.appendChild(el("p", "dlg-hint", t("setup.hint")));
    var zr = document.createElement("input");
    zr.type = "range"; zr.min = "1"; zr.max = "4"; zr.step = "0.01"; zr.value = "1";
    zr.className = "zoom-range";
    zr.setAttribute("aria-label", t("setup.zoom"));
    dlg.appendChild(zr);

    function seg(label, items, get, set) {
      var wrap = el("div", "set-row");
      wrap.appendChild(el("span", "set-lbl", label));
      var s = el("div", "seg");
      s.setAttribute("role", "group");
      s.setAttribute("aria-label", label);
      items.forEach(function (it) {
        var b = el("button", "seg-btn", it[1]);
        b.type = "button";
        b.addEventListener("click", function () { set(it[0]); paint(); });
        b._val = it[0];
        s.appendChild(b);
      });
      wrap.appendChild(s);
      dlg.appendChild(wrap);
      return function () {
        [].forEach.call(s.children, function (b) {
          var on = b._val === get();
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
      };
    }
    var pc = seg(t("setup.pieces"), COUNTS.map(function (n) { return [n, String(n)]; }),
      function () { return st.n; }, function (v) { st.n = v; });
    var phone = el("p", "dlg-hint warn", t("setup.phone"));
    dlg.appendChild(phone);
    var sc = seg(t("setup.shape"), [["c", t("shape.c")], ["s", t("shape.s")]],
      function () { return st.shape; }, function (v) { st.shape = v; });
    var oc = seg(t("setup.layout"), [[false, t("orient.l")], [true, t("orient.p")]],
      function () { return st.portrait; }, function (v) { st.portrait = v; });
    var chk = el("label", "chk");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = st.rot;
    cb.addEventListener("change", function () { st.rot = cb.checked; });
    chk.appendChild(cb);
    chk.appendChild(el("span", "", t("setup.rot")));
    dlg.appendChild(chk);

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("setup.cancel"), "", function () { dlg.close(); }));
    var go = button(t("setup.start"), "primary", function () {
      dlg.close();
      prefs.n = st.n; prefs.shape = st.shape; prefs.rot = st.rot;
      savePrefs();
      var g = gridFor(st.n, st.portrait);
      var rc = cropRect(src.w, src.h, g.cols / g.rows, st.zoom, st.cx, st.cy);
      startPuzzle(src, rc, g, st.shape, st.rot);
    });
    acts.appendChild(go);
    dlg.appendChild(acts);

    var bw = 0, bh = 0;
    function aspect() { var g = gridFor(st.n, st.portrait); return g.cols / g.rows; }
    function layoutBox() {
      var a = aspect();
      var maxW = Math.max(160, Math.min(520, (window.innerWidth || 400) - 72));
      var maxH = Math.max(140, Math.min(360, (window.innerHeight || 600) * 0.38));
      bw = maxW; bh = bw / a;
      if (bh > maxH) { bh = maxH; bw = bh * a; }
      bw = Math.floor(bw); bh = Math.floor(bh);
      box.style.width = bw + "px";
      box.style.height = bh + "px";
      var dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(bw * dpr); cv.height = Math.round(bh * dpr);
      cv.style.width = bw + "px"; cv.style.height = bh + "px";
    }
    function draw() {
      var rc = cropRect(src.w, src.h, aspect(), st.zoom, st.cx, st.cy);
      st.cx = rc.x + rc.w / 2; st.cy = rc.y + rc.h / 2;
      var ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src.img, rc.x, rc.y, rc.w, rc.h, 0, 0, cv.width, cv.height);
      // the cut, as a hint
      var g = gridFor(st.n, st.portrait);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i < g.cols; i++) { var x = Math.round(i * cv.width / g.cols) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); }
      for (var j = 1; j < g.rows; j++) { var y = Math.round(j * cv.height / g.rows) + 0.5; ctx.moveTo(0, y); ctx.lineTo(cv.width, y); }
      ctx.stroke();
    }
    function paint() {
      pc(); sc(); oc();
      phone.hidden = !(smallScreen() && st.n > 48);
      layoutBox();
      draw();
    }
    function setZoom(z, fx, fy) {
      // keep the picture point under (fx, fy) (box fractions) in place
      var a = aspect(), before = cropRect(src.w, src.h, a, st.zoom, st.cx, st.cy);
      var px = before.x + before.w * fx, py = before.y + before.h * fy;
      st.zoom = clamp(z, 1, 4);
      var after = cropRect(src.w, src.h, a, st.zoom, st.cx, st.cy);
      st.cx = px - after.w * fx + after.w / 2;
      st.cy = py - after.h * fy + after.h / 2;
      zr.value = String(st.zoom);
      draw();
    }
    zr.addEventListener("input", function () { setZoom(parseFloat(zr.value) || 1, 0.5, 0.5); });

    // drag = move, two fingers = zoom, wheel = zoom
    var ptrs = {}, pinch0 = null;
    function count() { return Object.keys(ptrs).length; }
    box.addEventListener("pointerdown", function (e) {
      box.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() === 2) {
        var p = Object.keys(ptrs).map(function (k) { return ptrs[k]; });
        pinch0 = { d: dist(p[0].x, p[0].y, p[1].x, p[1].y) || 1, z: st.zoom };
      }
    });
    box.addEventListener("pointermove", function (e) {
      var q = ptrs[e.pointerId];
      if (!q) return;
      var dx = e.clientX - q.x, dy = e.clientY - q.y;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() >= 2 && pinch0) {
        var p = Object.keys(ptrs).map(function (k) { return ptrs[k]; });
        var r = box.getBoundingClientRect();
        var mx = ((p[0].x + p[1].x) / 2 - r.left) / bw, my = ((p[0].y + p[1].y) / 2 - r.top) / bh;
        setZoom(pinch0.z * dist(p[0].x, p[0].y, p[1].x, p[1].y) / pinch0.d, clamp(mx, 0, 1), clamp(my, 0, 1));
        return;
      }
      var rc = cropRect(src.w, src.h, aspect(), st.zoom, st.cx, st.cy);
      st.cx -= dx * rc.w / bw;
      st.cy -= dy * rc.h / bh;
      draw();
    });
    function up(e) { delete ptrs[e.pointerId]; if (count() < 2) pinch0 = null; }
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    box.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = box.getBoundingClientRect();
      setZoom(st.zoom * Math.exp(-wheelDelta(e) * 0.0015), clamp((e.clientX - r.left) / bw, 0, 1), clamp((e.clientY - r.top) / bh, 0, 1));
    }, { passive: false });

    document.body.appendChild(dlg);
    dlg.showModal();
    paint();
    go.focus();
  }

  // ---------- 7. Puzzle build + view ----------
  // cur = { G (saved game), M, P, E, imgRec, bitmap, url, els[], paths[], size, pad }
  var cur = null;
  var view = { z: 1, tx: 0, ty: 0, fit: true };
  var hitCtx = null;
  var maxZ = 0;

  function stageAspect() {
    var s = $("stage");
    var w = s ? s.clientWidth : window.innerWidth, h = s ? s.clientHeight : window.innerHeight;
    return w > 0 && h > 0 ? w / h : 1.5;
  }

  // Crop → picture (cols × rows cells of s px, long side ≤ MAX_LONG).
  function startPuzzle(src, rc, grid, shape, rotOn) {
    setBusy(t("msg.cutting"));
    setTimeout(function () {
      var long = clamp(Math.max(rc.w, rc.h), MIN_LONG, MAX_LONG);
      var s = Math.max(8, Math.floor(long / Math.max(grid.cols, grid.rows)));
      var W = grid.cols * s, H = grid.rows * s;
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src.img, rc.x, rc.y, rc.w, rc.h, 0, 0, W, H);
      cv.toBlob(function (blob) {
        if (!blob) { setBusy(""); showToast(t("toast.decode")); return; }
        decode(blob).then(function (pic) {
          var imgRec = { id: Date.now().toString(36) + Math.floor(rand() * 1e9).toString(36), blob: blob, w: W, h: H };
          var M = tableFor(grid.cols, grid.rows, s, shape, stageAspect());
          var seed = randSeed(), rnd = prng(seed ^ 0x5bd1e995);
          var slots = slotList(M, shape), ids = [];
          for (var i = 0; i < grid.cols * grid.rows; i++) ids.push(i);
          for (i = ids.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp; }
          var P = [];
          ids.forEach(function (id, k) {
            var sl = slots[k % slots.length], lap = Math.floor(k / slots.length);
            P[id] = {
              x: clamp(sl.x + (rnd() - 0.5) * 0.24 * s + lap * 0.3 * s, 0.3 * s, M.tw - 0.3 * s),
              y: clamp(sl.y + (rnd() - 0.5) * 0.24 * s + lap * 0.3 * s, 0.3 * s, M.th - 0.3 * s),
              r: rotOn ? Math.floor(rnd() * 4) : 0, g: id, z: k
            };
          });
          var G = {
            v: GAME_VER, img: imgRec.id, n: grid.cols * grid.rows, cols: grid.cols, rows: grid.rows, s: s,
            shape: shape, rot: rotOn ? 1 : 0, seed: seed, fx: M.fx, fy: M.fy, tw: M.tw, th: M.th,
            p: [], el: 0, done: 0, at: Date.now()
          };
          var prev = (cur && !cur.G.done && (elapsed() > 0 || progress(cur.P) > 0)) ? snapshot() : null;
          stopTimer();
          install({ G: G, M: M, P: P }, imgRec, pic.img);
          setBusy("");
          saveAll();
          if (prev) {
            undoToast(t("toast.newgame"), function () {
              stopTimer();
              install(prev.state, prev.imgRec, prev.bitmap);
              saveAll();
            });
          } else live(t("toast.newgame"));
        }, function () { setBusy(""); showToast(t("toast.decode")); });
      }, "image/jpeg", 0.9);
    }, 30);
  }

  function snapshot() {
    syncGameFromP();
    var G = JSON.parse(JSON.stringify(cur.G));
    G.el = clamp(elapsed(), 0, MAX_TIME);
    return {
      state: { G: G, M: cur.M, P: cur.P.map(function (p) { return { x: p.x, y: p.y, r: p.r, g: p.g, z: p.z }; }) },
      imgRec: cur.imgRec, bitmap: cur.bitmap
    };
  }

  // Draw every piece once, to its own canvas.
  function install(state, imgRec, bitmap) {
    var host = $("pieces");
    host.textContent = "";
    if (cur && cur.url) URL.revokeObjectURL(cur.url);
    var G = state.G, M = state.M, P = state.P;
    var E = makeEdges(G.cols, G.rows, G.shape, prng(G.seed));
    var s = G.s, pad = Math.ceil(PAD[G.shape] * s), size = s + 2 * pad;
    var u = Math.max(1, s / 90);
    var els = [], paths = [];
    for (var id = 0; id < G.n; id++) {
      var r = Math.floor(id / G.cols), c = id % G.cols;
      var path = new Path2D(), sides = pieceOutline(E, id, s);
      path.moveTo(sides[0][0] + pad, sides[0][1] + pad);
      sides.forEach(function (pts) {
        for (var i = 2; i < pts.length; i += 6) {
          path.bezierCurveTo(pts[i] + pad, pts[i + 1] + pad, pts[i + 2] + pad, pts[i + 3] + pad, pts[i + 4] + pad, pts[i + 5] + pad);
        }
      });
      path.closePath();
      var cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      cv.className = "pc";
      cv.style.width = size + "px";
      cv.style.height = size + "px";
      cv.setAttribute("data-id", String(id));
      var ctx = cv.getContext("2d");
      ctx.save();
      ctx.clip(path);
      // the part of the picture under this canvas (clamped to the picture)
      var sx = c * s - pad, sy = r * s - pad, sw = size, sh = size, dx = 0, dy = 0;
      if (sx < 0) { dx = -sx; sw += sx; sx = 0; }
      if (sy < 0) { dy = -sy; sh += sy; sy = 0; }
      sw = Math.min(sw, imgRec.w - sx); sh = Math.min(sh, imgRec.h - sy);
      if (sw > 0 && sh > 0) ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, sw, sh);
      // a cut line: light band, dark rim
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 3.2 * u;
      ctx.stroke(path);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1.4 * u;
      ctx.stroke(path);
      ctx.restore();
      host.appendChild(cv);
      els.push(cv);
      paths.push(path);
    }
    cur = { G: G, M: M, P: P, E: E, imgRec: imgRec, bitmap: bitmap, url: URL.createObjectURL(imgRec.blob),
            els: els, paths: paths, size: size, pad: pad };
    maxZ = 0;
    P.forEach(function (p) { maxZ = Math.max(maxZ, p.z); });
    // world: the table and the frame
    var world = $("world");
    world.style.width = M.tw + "px";
    world.style.height = M.th + "px";
    var fr = $("frame");
    fr.style.left = M.fx + "px";
    fr.style.top = M.fy + "px";
    fr.style.width = (M.cols * s) + "px";
    fr.style.height = (M.rows * s) + "px";
    fr.style.borderWidth = Math.max(1, Math.round(s / 40)) + "px";
    $("ghost").src = cur.url;
    $("stage").setAttribute("aria-label", t("table.label", { n: G.n }));
    P.forEach(function (p, i) { placeEl(i); });
    applyEdges();
    fitView();
    renderAll();
  }

  function placeEl(i) {
    var p = cur.P[i], h = cur.size / 2, e = cur.els[i];
    e.style.transform = "translate(" + (p.x - h).toFixed(2) + "px," + (p.y - h).toFixed(2) + "px) rotate(" + (p.r * 90) + "deg)";
    e.style.zIndex = String(p.z + 1);
  }

  function clearPuzzle() {
    if (cur && cur.url) URL.revokeObjectURL(cur.url);
    cur = null;
    $("pieces").textContent = "";
    $("ghost").removeAttribute("src");
    renderAll();
  }

  // Edge pieces only: a group shows when it holds an edge piece.
  function applyEdges() {
    if (!cur) return;
    var show = {};
    if (prefs.edges) cur.P.forEach(function (p, i) { if (isBorder(cur.M, i)) show[p.g] = 1; });
    cur.P.forEach(function (p, i) { cur.els[i].hidden = prefs.edges && !show[p.g]; });
  }

  // view: screen = world × z + (tx, ty), relative to the stage
  function zoomLimits() {
    var st = $("stage"), W = st.clientWidth, H = st.clientHeight;
    var fitZ = cur ? Math.min(W / cur.M.tw, H / cur.M.th) : 1;
    return { fit: fitZ, min: fitZ * 0.75, max: Math.max(fitZ * 6, 2.5 / (window.devicePixelRatio || 1)) };
  }
  function fitView() {
    if (!cur) return;
    var st = $("stage"), W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) return;
    var z = zoomLimits().fit * 0.98;
    view = { z: z, tx: (W - cur.M.tw * z) / 2, ty: (H - cur.M.th * z) / 2, fit: true };
    applyView();
  }
  function clampView() {
    if (!cur) return;
    var st = $("stage"), W = st.clientWidth, H = st.clientHeight;
    var cx = view.tx + cur.M.tw * view.z / 2, cy = view.ty + cur.M.th * view.z / 2;
    view.tx += clamp(cx, 0, W) - cx;
    view.ty += clamp(cy, 0, H) - cy;
  }
  function zoomAt(z, sx, sy) {
    if (!cur) return;
    var L = zoomLimits();
    z = clamp(z, L.min, L.max);
    var wx = (sx - view.tx) / view.z, wy = (sy - view.ty) / view.z;
    view.z = z;
    view.tx = sx - wx * z;
    view.ty = sy - wy * z;
    view.fit = false;
    clampView();
    applyView();
  }
  function zoomStep(f) {
    var st = $("stage");
    zoomAt(view.z * f, st.clientWidth / 2, st.clientHeight / 2);
  }
  function applyView() {
    $("world").style.transform = "translate(" + view.tx.toFixed(2) + "px," + view.ty.toFixed(2) + "px) scale(" + view.z.toFixed(5) + ")";
  }

  // The piece under a screen point (top-most first), or -1.
  function hitTest(sx, sy) {
    if (!cur) return -1;
    if (!hitCtx) hitCtx = document.createElement("canvas").getContext("2d");
    var wx = (sx - view.tx) / view.z, wy = (sy - view.ty) / view.z;
    var best = -1, bestZ = -1, h = cur.size / 2, P = cur.P;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (p.z <= bestZ || cur.els[i].hidden) continue;
      var dx = wx - p.x, dy = wy - p.y;
      if (Math.abs(dx) > h || Math.abs(dy) > h) continue;
      var v = rotVec(dx, dy, 4 - p.r);
      if (hitCtx.isPointInPath(cur.paths[i], v[0] + h, v[1] + h)) { best = i; bestZ = p.z; }
    }
    return best;
  }

  // ---------- 8. Input ----------
  var ptrs = {};          // pointerId → { x, y } (stage coordinates)
  var gest = null;        // { kind: "piece" | "pan" | "pinch", … }
  var dirty = {};         // piece ids to repaint on the next frame
  var raf = 0;

  function stagePt(e) {
    var r = $("stage").getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function npt() { return Object.keys(ptrs).length; }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(function () {
      raf = 0;
      Object.keys(dirty).forEach(function (k) { placeEl(+k); });
      dirty = {};
    });
  }

  function startPinch() {
    var p = Object.keys(ptrs).map(function (k) { return ptrs[k]; });
    var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
    gest = { kind: "pinch", d0: dist(p[0].x, p[0].y, p[1].x, p[1].y) || 1, z0: view.z,
             wx: (mx - view.tx) / view.z, wy: (my - view.ty) / view.z };
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    if (!cur) return;
    e.preventDefault();
    try { $("stage").setPointerCapture(e.pointerId); } catch (err) {}
    var pt = stagePt(e);
    ptrs[e.pointerId] = pt;
    if (npt() === 2) {
      if (gest && gest.kind === "piece") {
        if (gest.moved) return;            // a piece on the move keeps the gesture
        endPiece(false);
      }
      startPinch();
      return;
    }
    if (npt() > 2) return;
    var id = e.button === 1 ? -1 : hitTest(pt.x, pt.y);
    if (id >= 0 && !cur.G.done && !isPlaced(cur.P, cur.M, id)) {
      var g = cur.P[id].g, ids = members(cur.P, g);
      ids.sort(function (a, b) { return cur.P[a].z - cur.P[b].z; });
      ids.forEach(function (i) { cur.P[i].z = ++maxZ; cur.els[i].classList.add("lift"); if (ids.length <= 16) cur.els[i].classList.add("shadow"); dirty[i] = 1; });
      schedule();
      gest = { kind: "piece", pid: e.pointerId, id: id, g: g, ids: ids, sx: pt.x, sy: pt.y, lx: pt.x, ly: pt.y,
               moved: false, t0: Date.now(), touch: e.pointerType !== "mouse" };
      startTimer();
    } else {
      gest = { kind: "pan", pid: e.pointerId, lx: pt.x, ly: pt.y };
    }
  }

  function onMove(e) {
    if (!ptrs[e.pointerId]) return;
    var pt = stagePt(e);
    ptrs[e.pointerId] = pt;
    if (!gest) return;
    if (gest.kind === "pinch") {
      if (npt() < 2) return;
      var p = Object.keys(ptrs).map(function (k) { return ptrs[k]; });
      var L = zoomLimits();
      var z = clamp(gest.z0 * dist(p[0].x, p[0].y, p[1].x, p[1].y) / gest.d0, L.min, L.max);
      var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      view.z = z; view.tx = mx - gest.wx * z; view.ty = my - gest.wy * z; view.fit = false;
      clampView();
      applyView();
      return;
    }
    if (e.pointerId !== gest.pid) return;
    var dx = pt.x - gest.lx, dy = pt.y - gest.ly;
    gest.lx = pt.x; gest.ly = pt.y;
    if (gest.kind === "pan") {
      view.tx += dx; view.ty += dy; view.fit = false;
      clampView();
      applyView();
      return;
    }
    if (!gest.moved && dist(pt.x, pt.y, gest.sx, gest.sy) > (gest.touch ? 10 : 5)) gest.moved = true;
    if (!gest.moved) return;
    var sh = clampShift(cur.P, cur.M, gest.ids, dx / view.z, dy / view.z);
    gest.ids.forEach(function (i) { cur.P[i].x += sh[0]; cur.P[i].y += sh[1]; dirty[i] = 1; });
    schedule();
  }

  function onUp(e) {
    if (!ptrs[e.pointerId]) return;
    delete ptrs[e.pointerId];
    if (!gest) return;
    if (gest.kind === "pinch") {
      if (npt() === 1) {                     // carry on as a pan with the finger left
        var k = Object.keys(ptrs)[0];
        gest = { kind: "pan", pid: +k, lx: ptrs[k].x, ly: ptrs[k].y };
      } else if (!npt()) gest = null;
      return;
    }
    if (e.pointerId !== gest.pid) return;
    if (gest.kind === "piece") endPiece(e.type !== "pointercancel");
    else gest = null;
  }

  function endPiece(commit) {
    var gs = gest;
    gest = null;
    gs.ids.forEach(function (i) { cur.els[i].classList.remove("lift", "shadow"); });
    if (!commit) { saveSoon(); return; }
    if (!gs.moved) {
      if (cur.G.rot && Date.now() - gs.t0 < 600) {
        rotateGroup(cur.P, cur.M, gs.g, gs.id);
        turnAnim(gs.ids);
        afterDrop(cur.P[gs.id].g);
      }
      saveSoon();
      return;
    }
    afterDrop(gs.g);
  }

  function turnAnim(ids) {
    if (reduced) return;
    ids.forEach(function (i) { cur.els[i].classList.add("turning"); });
    setTimeout(function () { if (cur) ids.forEach(function (i) { if (cur.els[i]) cur.els[i].classList.remove("turning"); }); }, 200);
  }

  function afterDrop(g) {
    var res = snapGroup(cur.P, cur.M, g);
    cur.P.forEach(function (p, i) { dirty[i] = 1; });
    schedule();
    if (res.joined) live(t("live.joined"));
    else if (res.placed) live(t("live.placed"));
    if (res.joined && prefs.edges) applyEdges();
    if (isSolved(cur.P, cur.M)) solved();
    else { renderStatus(); saveSoon(); }
  }

  function wheelDelta(e) {
    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
    return clamp(d, -200, 200);
  }

  function wireStage() {
    var st = $("stage");
    st.addEventListener("pointerdown", onDown);
    st.addEventListener("pointermove", onMove);
    st.addEventListener("pointerup", onUp);
    st.addEventListener("pointercancel", onUp);
    st.addEventListener("lostpointercapture", onUp);
    st.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    st.addEventListener("wheel", function (e) {
      if (!cur) return;
      e.preventDefault();
      var pt = stagePt(e);
      zoomAt(view.z * Math.exp(-wheelDelta(e) * 0.0015), pt.x, pt.y);
    }, { passive: false });
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;          // never steal OS combos
      if (document.querySelector("dialog[open]")) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.repeat) return;
      var c = e.code, act = null;
      if (c === "KeyN") act = newPuzzle;
      else if (c === "KeyP") act = previewDialog;
      else if (c === "KeyG") act = toggleGhost;
      else if (c === "KeyE") act = toggleEdges;
      else if (c === "KeyT") act = tidy;
      else if (c === "Digit0" || c === "Numpad0") act = function () { if (needPuzzle()) fitView(); };
      else if (c === "Equal" || c === "NumpadAdd") act = function () { if (needPuzzle()) zoomStep(1.25); };
      else if (c === "Minus" || c === "NumpadSubtract") act = function () { if (needPuzzle()) zoomStep(0.8); };
      if (!act || (e.shiftKey && c !== "Equal")) return;
      e.preventDefault();
      act();
    });

    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // ---------- 9. Game flow ----------
  var timer = { on: false, t0: 0, tick: null };

  function elapsed() { return cur ? cur.G.el + (timer.on ? Math.round(nowMs() - timer.t0) : 0) : 0; }
  function startTimer() {
    if (!cur || cur.G.done || timer.on || document.visibilityState === "hidden") return;
    timer.on = true;
    timer.t0 = nowMs();
    clearInterval(timer.tick);
    timer.tick = setInterval(renderTime, 1000);
  }
  function stopTimer() {
    if (timer.on && cur) cur.G.el = clamp(elapsed(), 0, MAX_TIME);
    timer.on = false;
    clearInterval(timer.tick);
    timer.tick = null;
  }

  function newPuzzle() {
    if (gest) return;
    sourceDialog();
  }

  function solved() {
    stopTimer();
    var G = cur.G;
    G.done = 1;
    // the finished picture glides into the frame
    var a = home(cur.M, 0), dx = a.x - cur.P[0].x, dy = a.y - cur.P[0].y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      if (glideOK(cur.els.length)) cur.els.forEach(function (e) { e.classList.add("glide"); });
      cur.P.forEach(function (p, i) { p.x += dx; p.y += dy; p.g = 0; placeEl(i); });
      setTimeout(function () { if (cur) cur.els.forEach(function (e) { e.classList.remove("glide"); }); }, 600);
    } else cur.P.forEach(function (p) { p.g = 0; });
    var res = addSolve(data, deviceId, String(G.n), G.el, Date.now());
    data = res.data;
    save();
    saveAll();
    if (prefs.edges) { prefs.edges = false; savePrefs(); applyEdges(); }
    renderAll();
    live(t("msg.solved", { t: fmtTime(G.el) }));
    setTimeout(function () { resultDialog(res.record); }, reduced ? 100 : 650);
  }

  function tidy() {
    if (!needPuzzle()) return;
    if (cur.G.done) { showToast(t("toast.solved")); return; }
    var P = cur.P, M = cur.M, loose = [];
    var size = {};
    P.forEach(function (p) { size[p.g] = (size[p.g] || 0) + 1; });
    P.forEach(function (p, i) { if (size[p.g] === 1 && !isPlaced(P, M, i)) loose.push(i); });
    if (!loose.length) { showToast(t("toast.noTidy")); return; }
    // free slots: not under a group of two or more
    var slots = slotList(M, cur.G.shape).filter(function (sl) {
      for (var i = 0; i < P.length; i++) {
        if (size[P[i].g] > 1 && Math.abs(P[i].x - sl.x) < M.s * 0.9 && Math.abs(P[i].y - sl.y) < M.s * 0.9) return false;
      }
      return true;
    });
    if (!slots.length) slots = slotList(M, cur.G.shape);
    var order = tidyOrder(P, M, loose);
    // visible pieces first (edges only: the edge pieces get the near slots)
    order = order.filter(function (i) { return !cur.els[i].hidden; }).concat(order.filter(function (i) { return cur.els[i].hidden; }));
    if (glideOK(order.length)) order.forEach(function (i) { cur.els[i].classList.add("glide"); });
    order.forEach(function (i, k) {
      var sl = slots[k % slots.length], lap = Math.floor(k / slots.length);
      P[i].x = clamp(sl.x + lap * 0.3 * M.s, 0.3 * M.s, M.tw - 0.3 * M.s);
      P[i].y = clamp(sl.y + lap * 0.3 * M.s, 0.3 * M.s, M.th - 0.3 * M.s);
      P[i].z = ++maxZ;
      placeEl(i);
    });
    setTimeout(function () { if (cur) order.forEach(function (i) { if (cur.els[i]) cur.els[i].classList.remove("glide"); }); }, 600);
    saveSoon();
  }

  function toggleGhost() {
    if (!needPuzzle()) return;
    prefs.ghost = !prefs.ghost;
    savePrefs();
    renderToolbar();
  }
  function toggleEdges() {
    if (!needPuzzle()) return;
    if (cur.G.done) { showToast(t("toast.solved")); return; }
    prefs.edges = !prefs.edges;
    savePrefs();
    applyEdges();
    renderToolbar();
    live(t(prefs.edges ? "live.edgesOn" : "live.edgesOff"));
  }
  function needPuzzle() {
    if (cur) return true;
    showToast(t("toast.noPuzzle"));                        // R28
    return false;
  }

  // Saving: the picture once per puzzle, the pieces after each move.
  var saveTimer = null;
  function syncGameFromP() {
    if (!cur) return;
    cur.G.p = cur.P.map(function (p) {
      return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.r, p.g, p.z];
    });
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGame, 400);
  }
  function saveGame() {
    clearTimeout(saveTimer);
    if (!cur) return;
    var G = cur.G, keep = G.el;
    G.el = clamp(elapsed(), 0, MAX_TIME);
    syncGameFromP();
    var copy = JSON.parse(JSON.stringify(G));
    G.el = keep;
    idbPut({ game: copy });
  }
  function saveAll() {
    if (!cur) return;
    syncGameFromP();
    idbPut({ img: cur.imgRec, game: JSON.parse(JSON.stringify(cur.G)) });
  }

  function resume() {
    setBusy(t("msg.loading"));
    Promise.all([idbGet("img"), idbGet("game")]).then(function (res) {
      var imgRec = res[0], v = validGame(res[1], imgRec);
      if (!v || !(imgRec.blob instanceof Blob)) { setBusy(""); renderAll(); return; }
      return decode(imgRec.blob).then(function (pic) {
        setBusy("");
        install(v, imgRec, pic.img);
      });
    }).catch(function () { setBusy(""); renderAll(); });
  }

  // ---------- 10. Render + dialogs ----------
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // A glide makes every moving piece a layer for half a second: fine
  // for a few dozen, a stall for a hundred on a slow phone.
  function glideOK(count) { return !reduced && count <= 60; }
  var busyText = "";

  function setBusy(text) {
    busyText = text || "";
    var b = $("busy");
    b.hidden = !busyText;
    b.textContent = busyText;
    renderStatus();
    $("empty").hidden = !!cur || !!busyText;
  }

  function renderAll() {
    renderToolbar();
    renderStatus();
    $("empty").hidden = !!cur || !!busyText;
    $("world").hidden = !cur;
  }

  function renderToolbar() {
    var has = !!cur, done = has && cur.G.done === 1;
    $("preview-btn").disabled = !has;
    $("ghost-btn").disabled = !has;
    $("edges-btn").disabled = !has || done;
    $("tidy-btn").disabled = !has || done;
    $("zout-btn").disabled = !has;
    $("fit-btn").disabled = !has;
    $("zin-btn").disabled = !has;
    $("ghost-btn").setAttribute("aria-pressed", prefs.ghost ? "true" : "false");
    $("edges-btn").setAttribute("aria-pressed", prefs.edges && !done ? "true" : "false");
    $("frame").classList.toggle("ghost-on", prefs.ghost && has);
  }

  function renderTime() { $("time").textContent = fmtTime(elapsed()); }

  function renderStatus() {
    renderTime();
    var p = cur ? (cur.G.done ? 100 : progress(cur.P)) : 0;
    $("prog").textContent = p + "%";
    $("prog").parentNode.title = t("st.prog", { p: p });
    $("prog").parentNode.setAttribute("aria-label", t("st.prog", { p: p }));
    var msg;
    if (busyText) msg = busyText;
    else if (!cur) msg = t("msg.empty");
    else if (cur.G.done) msg = t("msg.solved", { t: fmtTime(cur.G.el) });
    else msg = t(cur.G.rot ? "msg.playRot" : "msg.play");
    $("msg").textContent = msg;
    $("msg").className = cur && cur.G.done ? "done" : "";
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  function closeDialogs() {
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function row(k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function iconButton(icon, label, fn) {
    var b = el("button", "icon-btn");
    b.type = "button";
    b.innerHTML = UI_ICONS[icon];
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }

  function previewDialog() {
    if (!needPuzzle()) return;
    var dlg = makeDialog("jg-preview");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("prev.title")));
    var im = el("img", "prev-img");
    im.alt = "";
    im.src = cur.url;
    dlg.appendChild(im);
    var acts = el("div", "dlg-actions");
    var close = button(t("prev.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function resultDialog(rec) {
    if (!cur || !cur.G.done) return;
    var key = String(cur.G.n), s = totals(data, key);
    var dlg = makeDialog("jg-result");
    dlg.appendChild(el("div", "dlg-title", t("res.title")));
    dlg.appendChild(el("div", "dlg-hero", fmtTime(cur.G.el)));
    if (rec) dlg.appendChild(el("div", "dlg-badge", t("res.record")));
    dlg.appendChild(row(t("res.pieces"), key));
    dlg.appendChild(row(t("res.best"), s.t ? fmtTime(s.t) : "–"));
    dlg.appendChild(row(t("res.solved"), String(s.n)));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("res.close"), "", function () { dlg.close(); }));
    var again = button(t("res.new"), "primary", function () { dlg.close(); newPuzzle(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("jg-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    KEYS.forEach(function (k) {
      var s = totals(data, k);
      if (s.n) empty = false;
      dlg.appendChild(row(t("stats.row", { n: k }), s.n ? fmtTime(s.t) + " (" + fmtDate(s.ts) + ") · " + s.n : "–"));
    });
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }

  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("jg-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }

  // Reset = a new epoch: every device drops rows older than br and
  // starts its own row again from zero.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeJigsaw(data, data);
    save();
    showToast(t("toast.reset"));
  }

  // ---------- 11. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "jigsaw", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }

  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- Toolbar icons (R9: injected by JS) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:     SVG + '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
    preview: SVG + '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    ghost:   SVG + '<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 3"/><path d="M7 16l3.5-4 2.5 3 2-2 2 3"/></svg>',
    edges:   SVG + '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/></svg>',
    tidy:    SVG + '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    zout:    SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    zin:     SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
    fit:     SVG + '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>',
    stats:   SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    up:      SVG + '<path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    folder:  SVG + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    image:   SVG + '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/></svg>',
    again:   SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    src_device: SVG + '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    src_files:  SVG + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 15l2.5-3 2 2.5 1.5-1.5 2 2"/></svg>',
    src_art:    SVG + '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>'
  };

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("jigsaw", sliceGet, sliceSet, STORAGE_KEY, mergeJigsaw);
  }

  function sliceGet() {
    return mergeJigsaw(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeJigsaw(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
  }

  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["preview-btn", "preview", "btn.preview"], ["ghost-btn", "ghost", "btn.ghost"],
     ["edges-btn", "edges", "btn.edges"], ["tidy-btn", "tidy", "btn.tidy"], ["zout-btn", "zout", "btn.zout"],
     ["fit-btn", "fit", "btn.fit"], ["zin-btn", "zin", "btn.zin"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    sourceButtons($("empty-src"), null);
  }

  function wire() {
    $("new-btn").addEventListener("click", function () { $("new-btn").blur(); newPuzzle(); });
    $("preview-btn").addEventListener("click", previewDialog);
    $("ghost-btn").addEventListener("click", toggleGhost);
    $("edges-btn").addEventListener("click", toggleEdges);
    $("tidy-btn").addEventListener("click", tidy);
    $("zout-btn").addEventListener("click", function () { zoomStep(0.8); });
    $("zin-btn").addEventListener("click", function () { zoomStep(1.25); });
    $("fit-btn").addEventListener("click", fitView);
    $("stats-btn").addEventListener("click", statsDialog);
    wireStage();

    var relayout = function () { if (view.fit) fitView(); else { clampView(); applyView(); } };
    if (window.ResizeObserver) new ResizeObserver(relayout).observe($("stage"));
    else window.addEventListener("resize", relayout);

    // Hidden → the clock stops and the puzzle is saved.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { stopTimer(); saveGame(); renderTime(); }
    });
    window.addEventListener("pagehide", function () { stopTimer(); saveGame(); });

    wireKeyboard();
  }

  function boot() {
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    closeDialogs();
    renderAll();
    resume();
  }

  boot();
})();
