// ============================================================
// orOS Pixel Avatar — App logic (v1.0.0)
// Pixel faces from a seed: the same seed gives the same face,
// on every device and in every size.
//   - sizes 8×8, 12×12, 16×16; a symmetric face built from parts
//     (head, ears, hair, eyes, brows, glasses, mouth, blush, clothes,
//     hats, headphones)
//   - 8 palettes (one follows the orOS skin), colour or clear
//     background
//   - paint by hand on top (8 colours, drag, keyboard), Undo / Redo,
//     back to the seed
//   - export PNG (crisp, three sizes) / SVG, copy image, copy seed
//   - the Museum: saved faces as recipes, synced
// Data:
//   - synced slice "pixel" (oros-pixel-data): Museum items, LWW per
//     item + tombstones (R5, R17, R26)
//   - device-local (R10): oros-pixel-prefs (face on the desk, paint
//     colour, export size)
// Sections:
//   1. Constants, i18n, helpers
//   2. Random
//   3. Palettes
//   4. Face generator
//   5. Faces: normalise, grid, colours, SVG
//   6. Museum: merge
//   7. Storage + prefs
//   8. Editor state + Undo
//   9. UI
//  10. Export + copy
//  11. Dialogs + toasts
//  12. Keyboard (Contract Β)
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-pixel-data";
  var PREFS_KEY   = "oros-pixel-prefs";
  var DATA_VER    = 1;
  var SIZES       = [8, 12, 16];
  var MAX_ITEMS   = 200;
  var MAX_SEED    = 40;
  var MAX_NAME    = 40;
  var MAX_UNDO    = 100;
  var EXPORT      = [256, 512, 1024];      // target px; the real size is a whole multiple of n
  var NCOL        = 8;                     // colour roles

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
      "app.name": "Pixel Avatar",
      "seed": "Seed", "seed.ph": "Any word, e.g. your name", "btn.new": "New face", "btn.copySeed": "Copy seed",
      "sec.size": "Size", "sec.pal": "Palette", "sec.paint": "Paint", "sec.export": "Export", "sec.museum": "Museum",
      "bg.color": "Colour background", "bg.clear": "Clear background",
      "pal.classic": "Classic", "pal.pastel": "Pastel", "pal.gameboy": "Game Boy", "pal.neon": "Neon",
      "pal.sepia": "Sepia", "pal.mono": "Black & white", "pal.ocean": "Ocean", "pal.oros": "orOS",
      "col0": "Background", "col1": "Skin", "col2": "Shade", "col3": "Hair",
      "col4": "Eyes", "col5": "Mouth", "col6": "Clothes", "col7": "Accent",
      "btn.reset": "Back to the seed", "edited": "edited by hand",
      "btn.undo": "Undo (Ctrl+Z)", "btn.redo": "Redo (Ctrl+Y)",
      "grid": "Face, {n} by {n} pixels", "px": "Row {r}, column {c}: {col}",
      "btn.png": "PNG", "btn.svg": "SVG", "btn.copyImg": "Copy image", "exp.px": "{n} px",
      "btn.save": "Save to the Museum", "museum.empty": "No faces saved yet. Saved faces follow you to all your devices.",
      "item.open": "Open", "item.rename": "Rename", "item.delete": "Delete",
      "rename.title": "Rename", "rename.ok": "Save", "cancel": "Cancel",
      "toast.saved": "Saved to the Museum", "toast.already": "Already in the Museum",
      "toast.full": "The Museum is full ({n})", "toast.deleted": "Deleted from the Museum", "toast.undo": "Undo",
      "toast.copied": "Copied", "toast.copyFail": "Could not copy", "toast.exported": "Exported",
      "toast.reset": "Hand edits removed", "toast.saveFail": "Could not save: storage is full",
      "toast.opened": "Opened “{name}”",
      "live.new": "New face from seed {s}", "keys": "R new face · P next palette · D download PNG"
    },
    el: {
      "app.name": "Pixel Avatar",
      "seed": "Seed", "seed.ph": "Οποιαδήποτε λέξη, π.χ. το όνομά σου", "btn.new": "Νέο πρόσωπο", "btn.copySeed": "Αντιγραφή seed",
      "sec.size": "Μέγεθος", "sec.pal": "Παλέτα", "sec.paint": "Ζωγραφική", "sec.export": "Εξαγωγή", "sec.museum": "Μουσείο",
      "bg.color": "Χρωματιστό φόντο", "bg.clear": "Διάφανο φόντο",
      "pal.classic": "Κλασική", "pal.pastel": "Pastel", "pal.gameboy": "Game Boy", "pal.neon": "Νέον",
      "pal.sepia": "Sepia", "pal.mono": "Ασπρόμαυρη", "pal.ocean": "Ωκεανός", "pal.oros": "orOS",
      "col0": "Φόντο", "col1": "Δέρμα", "col2": "Σκιά", "col3": "Μαλλιά",
      "col4": "Μάτια", "col5": "Στόμα", "col6": "Ρούχα", "col7": "Αξεσουάρ",
      "btn.reset": "Επαναφορά στο seed", "edited": "με διορθώσεις",
      "btn.undo": "Αναίρεση (Ctrl+Z)", "btn.redo": "Επανάληψη (Ctrl+Y)",
      "grid": "Πρόσωπο, {n} επί {n} pixel", "px": "Γραμμή {r}, στήλη {c}: {col}",
      "btn.png": "PNG", "btn.svg": "SVG", "btn.copyImg": "Αντιγραφή εικόνας", "exp.px": "{n} px",
      "btn.save": "Αποθήκευση στο Μουσείο", "museum.empty": "Δεν υπάρχουν ακόμα αποθηκευμένα πρόσωπα. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "item.open": "Άνοιγμα", "item.rename": "Μετονομασία", "item.delete": "Διαγραφή",
      "rename.title": "Μετονομασία", "rename.ok": "Αποθήκευση", "cancel": "Άκυρο",
      "toast.saved": "Αποθηκεύτηκε στο Μουσείο", "toast.already": "Υπάρχει ήδη στο Μουσείο",
      "toast.full": "Το Μουσείο γέμισε ({n})", "toast.deleted": "Διαγράφηκε από το Μουσείο", "toast.undo": "Αναίρεση",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή", "toast.exported": "Η εξαγωγή έγινε",
      "toast.reset": "Οι διορθώσεις αφαιρέθηκαν", "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.opened": "Άνοιξε το «{name}»",
      "live.new": "Νέο πρόσωπο από το seed {s}", "keys": "R νέο πρόσωπο · P επόμενη παλέτα · D λήψη PNG"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clip(s, n) { return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : ""; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("pixel.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Random ----------
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function prng(seed) {               // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  var SEED_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
  function randomSeed() {
    var buf = new Uint32Array(8), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 8; i++) s += SEED_CHARS.charAt(buf[i] % SEED_CHARS.length);
    return s;
  }

  // ---------- 3. Palettes ----------
  // Colour roles: 0 background, 1 skin, 2 shade (skin, darker),
  // 3 hair, 4 eyes, 5 mouth, 6 clothes, 7 accent. Each palette lists
  // choices per role; the seed picks one of each, so a face keeps its
  // look inside a palette. "oros" names CSS variables of the skin.
  var PAL_IDS = ["classic", "pastel", "gameboy", "neon", "sepia", "mono", "ocean", "oros"];
  var PALETTES = {
    classic: {
      bg: ["#f6d860", "#8fd3e8", "#c9b6e4", "#a7e3a1", "#f5a9a9", "#ffd3a1", "#b9c3ff", "#dedede"],
      skin: ["#ffdcb4", "#f2c287", "#e0ad6e", "#c68a4c", "#8e5a2e", "#ffe3c4", "#a8705f"],
      hair: ["#2b1a0f", "#5b3923", "#9f522c", "#d9b46e", "#ececec", "#191919", "#b8443a", "#6b4c94"],
      eyes: ["#1a1a1a", "#2f5f8d", "#3c7b3c", "#5a391a"],
      mouth: ["#a23c3c", "#7c2f2f", "#c4524f"],
      clothes: ["#e53a47", "#457c9e", "#2a9c8e", "#f3a261", "#6c5a7a", "#274653", "#ff7aa3"],
      acc: ["#151515", "#d6b03a", "#f2f2f2", "#e53a47"]
    },
    pastel: {
      bg: ["#fdf1f5", "#eef6fb", "#f1fbef", "#fff8e8", "#f4f0ff"],
      skin: ["#ffe6d5", "#f8d7c0", "#eccab0", "#dfb69a"],
      hair: ["#c9a7eb", "#a7d8f0", "#f5b8c8", "#b8e0c0", "#f3d9a4"],
      eyes: ["#6d6a8a", "#5f7f8f"],
      mouth: ["#e89aa7", "#d98a9a"],
      clothes: ["#b8d8f8", "#f8c8dc", "#c8f0d8", "#fde8a8", "#d8c8f8"],
      acc: ["#ffffff", "#f8b8c8", "#a8c8f0"]
    },
    gameboy: {
      bg: ["#9bbc0f"], skin: ["#8bac0f"], hair: ["#0f380f"], eyes: ["#0f380f"],
      mouth: ["#306230"], clothes: ["#306230"], acc: ["#0f380f"]
    },
    neon: {
      bg: ["#0d0221", "#120a2a", "#05010f"],
      skin: ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff", "#fffb96"],
      hair: ["#fffb96", "#01cdfe", "#ff71ce", "#05ffa1"],
      eyes: ["#0d0221"],
      mouth: ["#ff2a6d", "#d1f7ff"],
      clothes: ["#b967ff", "#01cdfe", "#ff71ce", "#05ffa1"],
      acc: ["#fffb96", "#d1f7ff"]
    },
    sepia: {
      bg: ["#efe2c6", "#e6d3ad"], skin: ["#d9b98c", "#cfa977"], hair: ["#4a3420", "#6b4a2b", "#2e2014"],
      eyes: ["#2e2014"], mouth: ["#8a5a3a"], clothes: ["#7a5636", "#9b7a52", "#5a3e26"], acc: ["#2e2014", "#f4ead2"]
    },
    mono: {
      bg: ["#f2f2f2", "#d9d9d9"], skin: ["#c8c8c8", "#b4b4b4"], hair: ["#1e1e1e", "#4a4a4a", "#e8e8e8"],
      eyes: ["#111111"], mouth: ["#5a5a5a"], clothes: ["#333333", "#6e6e6e", "#9a9a9a"], acc: ["#000000", "#ffffff"]
    },
    ocean: {
      bg: ["#cdeffb", "#a9e2f2", "#e3f7f4"], skin: ["#f3d5b5", "#e0b58f", "#b98560"],
      hair: ["#0b3d5c", "#1d6f8a", "#f2e6c9", "#2a9d8f"], eyes: ["#0b2a3d"], mouth: ["#e76f51", "#c75b48"],
      clothes: ["#0077b6", "#00b4d8", "#2a9d8f", "#264653"], acc: ["#ffffff", "#e9c46a", "#f4a261"]
    },
    oros: {
      bg: ["--panel-bg"], skin: ["--accent"], hair: ["--text"], eyes: ["--bg"],
      mouth: ["--danger"], clothes: ["--text-dim"], acc: ["--bg"]   // hats, glasses: dark, apart from the skin
    }
  };
  // First-paint / standalone values for the orOS palette.
  var OROS_FALLBACK = {
    "--panel-bg": "#1d1a13", "--accent": "#d4af37", "--text": "#f0ead9", "--bg": "#14120d",
    "--danger": "#e06c75", "--text-dim": "#a89f8a"
  };

  function toHex(c) {
    var m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return "#" + m[1].toLowerCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
    if (m) return ("#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c || "");
    if (m) return "#" + [m[1], m[2], m[3]].map(function (v) {
      return ("0" + Math.max(0, Math.min(255, +v)).toString(16)).slice(-2);
    }).join("");
    return null;
  }
  function darken(hex, f) {
    var h = toHex(hex) || "#808080";
    var out = "#";
    for (var i = 1; i < 7; i += 2) {
      var v = Math.round(parseInt(h.substr(i, 2), 16) * (1 - f));
      out += ("0" + v.toString(16)).slice(-2);
    }
    return out;
  }

  // The 8 colours of a face. `cssVar(name)` resolves the orOS palette
  // (null or a missing value falls back to the dark skin).
  function faceColors(seed, palId, cssVar) {
    var P = PALETTES[palId] || PALETTES.classic;
    var rnd = prng(hash32("pal:" + seed));
    function pick(list) {
      var v = list[Math.floor(rnd() * list.length)];
      if (v.charAt(0) === "-") {
        var got = cssVar ? toHex(cssVar(v)) : null;
        v = got || OROS_FALLBACK[v];
      }
      return v;
    }
    var bg = pick(P.bg), skin = pick(P.skin), hair = pick(P.hair), eyes = pick(P.eyes),
        mouth = pick(P.mouth), clothes = pick(P.clothes), acc = pick(P.acc);
    return [bg, skin, darken(skin, 0.18), hair, eyes, mouth, clothes, acc];
  }

  // ---------- 4. Face generator ----------
  // Every size has its own layout; one random stream picks the parts,
  // so a seed is the same person at 8, 12 and 16 pixels. The left half
  // is drawn and mirrored (columns h−1 | h are the middle).
  // heads[k][r] = first skin column of head row r (shape k).
  var LAYOUT = {
    8:  { top: 1, eye: 3, brow: 2, mouth: 5, body: 6, eyeX: 2,
          heads: [[1, 1, 1, 1, 1], [2, 1, 1, 1, 2], [1, 1, 1, 1, 2]] },
    12: { top: 2, eye: 5, brow: 4, mouth: 8, body: 10, eyeX: 3,
          heads: [[3, 2, 2, 2, 2, 2, 3, 4], [2, 2, 2, 2, 2, 2, 2, 3], [3, 3, 3, 3, 3, 3, 3, 4]] },
    16: { top: 3, eye: 7, brow: 6, mouth: 10, body: 13, eyeX: 4,
          heads: [[4, 3, 2, 2, 2, 2, 2, 2, 3, 4], [3, 2, 2, 2, 2, 2, 2, 2, 2, 3], [4, 3, 3, 3, 3, 3, 3, 3, 3, 4]] }
  };

  // The parts a seed picks (same for every size).
  function faceParts(seed) {
    var rnd = prng(hash32("face:" + seed));
    function int(n) { return Math.floor(rnd() * n); }
    return {
      head: int(3),
      ears: rnd() < 0.7,
      hair: int(6),            // 0 short, 1 long, 2 spiky, 3 bald, 4 bun, 5 fringe
      eyes: int(3),            // 0 dot, 1 tall, 2 wide
      brows: rnd() < 0.5,
      glasses: rnd() < 0.22 ? (rnd() < 0.6 ? 1 : 2) : 0,   // 1 round, 2 shades
      mouth: int(4),           // 0 small, 1 wide, 2 smile, 3 open
      blush: rnd() < 0.3,
      hat: rnd() < 0.2 ? 1 + int(3) : 0,                   // 1 cap, 2 beanie, 3 crown
      phones: rnd() < 0.12,
      collar: rnd() < 0.4
    };
  }

  function genFace(seed, n) {
    var L = LAYOUT[n], P = faceParts(seed), h = n / 2;
    var head = L.heads[P.head], last = L.top + head.length - 1;
    var g = [], y, x, r;
    for (y = 0; y < n; y++) { g.push([]); for (x = 0; x < h; x++) g[y].push(0); }
    function set(yy, xx, v) { if (yy >= 0 && yy < n && xx >= 0 && xx < h) g[yy][xx] = v; }
    function get(yy, xx) { return (yy >= 0 && yy < n && xx >= 0 && xx < h) ? g[yy][xx] : -1; }
    function inset(yy) { return head[Math.max(0, Math.min(head.length - 1, yy - L.top))]; }

    // head + shade on the jaw
    for (r = 0; r < head.length; r++) for (x = head[r]; x < h; x++) set(L.top + r, x, 1);
    if (n >= 12) { set(last, inset(last), 2); set(last - 1, inset(last - 1), 2); }
    // ears
    if (P.ears) {
      set(L.eye, inset(L.eye) - 1, 1);
      if (n >= 12) set(L.eye + 1, inset(L.eye + 1) - 1, n === 16 ? 2 : 1);
    }
    // neck + clothes
    var neck = n === 16 ? 2 : 1;
    for (x = h - neck; x < h; x++) set(L.body, x, 1);
    for (x = n === 8 ? 1 : 1; x < h - neck; x++) set(L.body, x, 6);
    for (y = L.body + 1; y < n; y++) for (x = 0; x < h; x++) set(y, x, 6);
    if (P.collar) set(n - 1, h - 1, 7);

    // hair
    var above = L.top - 1, i0 = inset(L.top);
    if (P.hair !== 3) {
      for (x = i0; x < h; x++) set(above, x, 3);
      if (above - 1 >= 0) for (x = i0 + 1; x < h; x++) set(above - 1, x, 3);
      for (x = i0; x < h; x++) set(L.top, x, 3);
      if (n === 16) { set(L.top + 1, inset(L.top + 1), 3); set(L.top + 1, inset(L.top + 1) + 1, 3); }
      else if (n === 12) set(L.top + 1, inset(L.top + 1), 3);
      if (P.hair === 1) {                                        // long
        var end = n === 8 ? L.top + 3 : last - 1;
        for (y = L.top + 1; y <= end; y++) { set(y, inset(y) - 1, 3); set(y, inset(y), 3); }
      } else if (P.hair === 2) {                                 // spiky
        var sy = Math.max(0, above - 1);
        for (x = i0; x < h; x += 2) set(sy - (above - 1 >= 0 ? 1 : 0), x + 1, 3);
        if (sy === 0 && above === 0) for (x = i0; x < h; x += 2) set(0, x, 0);
      } else if (P.hair === 4) {                                 // bun
        var by = Math.max(0, above - (n === 8 ? 0 : 2));
        set(by, h - 1, 3); set(by, h - 2, 3);
      } else if (P.hair === 5) {                                 // fringe
        for (x = inset(L.top + 1); x < h - 1; x++) set(L.top + 1, x, 3);
      }
    } else if (n >= 12) {                                        // bald: a little at the sides
      set(L.eye - 1, inset(L.eye - 1), 3);
    }

    // eyes, brows, glasses
    var ex = Math.min(h - 2, Math.max(L.eyeX, inset(L.eye) + 1));   // never on the edge of the face
    set(L.eye, ex, 4);
    if (P.eyes === 1 && n >= 12) set(L.eye + 1, ex, 4);
    if (P.eyes === 2 && n >= 12) set(L.eye, ex - 1, 4);
    if (P.brows) { set(L.brow, ex, 3); if (n === 16) set(L.brow, ex - 1, 3); }
    if (P.glasses === 1) {
      set(L.eye, ex - 1, 7); set(L.eye, ex + 1, 7);
      if (n >= 12) for (x = ex - 1; x <= ex + 1; x++) set(L.brow, x, 7);
      for (x = ex + 1; x < h; x++) set(L.eye, x, 7);           // bridge
    } else if (P.glasses === 2) {
      for (x = ex - 1; x < h; x++) set(L.eye, x, 7);
      if (n >= 12) set(L.eye + 1, ex, 7);
    }
    // mouth
    var my = L.mouth;
    if (P.mouth === 0 || n === 8) set(my, h - 1, 5);          // 8×8: the chin row is too narrow for more
    else if (P.mouth === 1) { set(my, h - 1, 5); set(my, h - 2, 5); }
    else if (P.mouth === 2) {
      set(my, h - 1, 5); set(my, h - 2, 5);
      if (n >= 12) set(my - 1, h - 3, 5);
    } else {
      set(my, h - 1, 5);
      if (n >= 12) set(my + 1, h - 1, 5); else set(my, h - 2, 5);
    }
    // blush
    if (P.blush && n >= 12 && get(my - 1, ex - 1) === 1) set(my - 1, ex - 1, 5);

    // hats over the hair
    if (P.hat) {
      var hy0 = Math.max(0, above - (n === 8 ? 0 : 1));
      if (P.hat === 3) {                                         // crown
        for (x = i0 + 1; x < h; x++) set(above, x, 7);
        for (x = i0 + 1; x < h; x += 2) set(above - 1 >= 0 ? above - 1 : above, x, 7);
      } else {
        for (y = hy0; y <= L.top; y++) for (x = Math.max(0, inset(L.top) - (y === L.top ? 1 : 0)); x < h; x++) set(y, x, 7);
        if (P.hat === 2 && hy0 - 1 >= 0) set(hy0 - 1, h - 1, 7);   // beanie pompom
        if (P.hat === 1 && n >= 12) set(L.top, inset(L.top) - 1, 7); // cap peak (both sides)
      }
    }
    // headphones over the ears
    if (P.phones) {
      var px0 = Math.max(0, inset(L.eye) - 1);
      set(L.eye, px0, 7); set(L.eye - 1, px0, 7);
      if (n >= 12) set(L.eye + 1, px0, 7);
    }

    var out = "";
    for (y = 0; y < n; y++) out += g[y].join("") + g[y].slice().reverse().join("");
    return out;
  }

  // ---------- 5. Faces: normalise, grid, colours, SVG ----------
  // face = { s: seed (1–40), n: 8|12|16, p: palette id, b: 0 colour | 1 clear,
  //          px: "" (as generated) | n*n digits 0–7 (painted) }
  function normFace(f) {
    if (!f || typeof f !== "object") return null;
    var s = clip(f.s, MAX_SEED);
    if (!s || SIZES.indexOf(f.n) < 0) return null;
    var px = (typeof f.px === "string" && f.px.length === f.n * f.n && /^[0-7]+$/.test(f.px)) ? f.px : "";
    if (px && px === genFace(s, f.n)) px = "";                  // canonical: unedited
    return { s: s, n: f.n, p: PAL_IDS.indexOf(f.p) >= 0 ? f.p : "classic", b: f.b === 1 ? 1 : 0, px: px };
  }
  function faceGrid(f) { return f.px || genFace(f.s, f.n); }
  function sameFace(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Horizontal runs of one colour → <rect>s; a clear background is left out.
  function faceSvg(f, size, colors, standalone) {
    var grid = faceGrid(f), n = f.n, out = "";
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        var c = +grid.charAt(y * n + x), x2 = x + 1;
        while (x2 < n && +grid.charAt(y * n + x2) === c) x2++;
        if (!(c === 0 && f.b === 1)) {
          out += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x) + '" height="1" fill="' + colors[c] + '"/>';
        }
        x = x2;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg"' + (standalone ? "" : ' aria-hidden="true" focusable="false"') +
      ' width="' + size + '" height="' + size + '" viewBox="0 0 ' + n + " " + n +
      '" shape-rendering="crispEdges">' + out + "</svg>";
  }

  // Real export size: a whole number of screen pixels per face pixel.
  function exportPx(n, target) { return n * Math.max(1, Math.round(target / n)); }

  // ---------- 6. Museum: merge ----------
  // item = { id, m: mtime, name (≤ 40), f: face }
  // data = { ver: 1, items: [item…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE = /^[a-z0-9]{6,40}$/;
  function normItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id) ||
        !isInt(it.m) || it.m < 0) return null;
    var f = normFace(it.f);
    if (!f) return null;
    return { id: it.id, m: it.m, name: clip(it.name, MAX_NAME) || f.s, f: f };
  }

  // LWW per item (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergePixel(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.items, b.items].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var it = normItem(raw);
        if (!it) return;
        var cur = best[it.id];
        if (!cur || it.m > cur.m ||
            (it.m === cur.m && JSON.stringify(it) > JSON.stringify(cur))) best[it.id] = it;
      });
    });
    var items = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      items.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, items: items, tombs: sortedTombs };
  }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // Newest first for the shelf.
  function shelf(dat) {
    return dat.items.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }

  // ---------- 7. Storage + prefs ----------
  var data = { ver: DATA_VER, items: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          data = mergePixel(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] pixel: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, items: [], tombs: {} };
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      face: normFace(p.face) || { s: randomSeed(), n: 12, p: "classic", b: 0, px: "" },
      col: isInt(p.col) && p.col >= 0 && p.col < NCOL ? p.col : 3,
      exp: EXPORT.indexOf(p.exp) >= 0 ? p.exp : 512
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 8. Editor state + Undo ----------
  var undoStack = [], redoStack = [];

  // Every change to the face on the desk goes through here.
  function commit(next, opts) {
    var f = normFace(next);
    if (!f || sameFace(f, prefs.face)) return false;
    if (!(opts && opts.noUndo)) {
      undoStack.push(prefs.face);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
    }
    prefs.face = f;
    savePrefs();
    renderAll();
    return true;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(prefs.face);
    prefs.face = undoStack.pop();
    savePrefs(); renderAll();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(prefs.face);
    prefs.face = redoStack.pop();
    savePrefs(); renderAll();
  }
  function withFace(changes) {
    var f = JSON.parse(JSON.stringify(prefs.face));
    Object.keys(changes).forEach(function (k) { f[k] = changes[k]; });
    return f;
  }

  function newFace() {
    commit(withFace({ s: randomSeed(), px: "" }));
    live(t("live.new", { s: prefs.face.s }));
  }
  function nextPalette() {
    var i = PAL_IDS.indexOf(prefs.face.p);
    commit(withFace({ p: PAL_IDS[(i + 1) % PAL_IDS.length] }));
  }

  // ---------- 9. UI ----------
  var ICON = {
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label) {
    var b = el("button", "icon-btn " + cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  }

  function cssVar(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
    catch (e) { return ""; }
  }
  function colorsOf(f) { return faceColors(f.s, f.p, cssVar); }

  // --- the grid (one button per pixel, roving tabindex) ---
  var gridN = 0, focusI = 0, painting = false, strokeStarted = false;

  function buildGrid() {
    var g = $("grid"), n = prefs.face.n;
    g.innerHTML = "";
    g.style.setProperty("--n", n);
    g.setAttribute("aria-label", t("grid", { n: n }));
    for (var i = 0; i < n * n; i++) {
      var b = el("button", "px");
      b.type = "button";
      b.setAttribute("data-i", String(i));
      b.tabIndex = -1;
      g.appendChild(b);
    }
    gridN = n;
    focusI = Math.min(focusI, n * n - 1);
  }

  function renderGrid() {
    if (gridN !== prefs.face.n) buildGrid();
    var f = prefs.face, n = f.n, grid = faceGrid(f), cols = colorsOf(f), kids = $("grid").children;
    for (var i = 0; i < kids.length; i++) {
      var c = +grid.charAt(i), b = kids[i];
      var clear = c === 0 && f.b === 1;
      b.style.background = clear ? "" : cols[c];
      b.classList.toggle("clear", clear);
      b.tabIndex = i === focusI ? 0 : -1;
      b.setAttribute("aria-label", t("px", { r: Math.floor(i / n) + 1, c: i % n + 1, col: t("col" + c) }));
    }
  }

  function paintAt(i) {
    var f = prefs.face, grid = faceGrid(f);
    if (+grid.charAt(i) === prefs.col) return;
    var px = grid.substr(0, i) + prefs.col + grid.substr(i + 1);
    // one Undo step per stroke
    commit(withFace({ px: px }), { noUndo: strokeStarted });
    strokeStarted = true;
  }

  function wireGrid() {
    var g = $("grid");
    g.addEventListener("pointerdown", function (e) {
      var px = e.target.closest && e.target.closest(".px");
      if (!px) return;
      e.preventDefault();
      painting = true; strokeStarted = false;
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      focusI = +px.getAttribute("data-i");
      paintAt(focusI);
    });
    g.addEventListener("pointermove", function (e) {
      if (!painting) return;
      var n = document.elementFromPoint(e.clientX, e.clientY);
      var px = n && n.closest && n.closest(".px");
      if (px && px.parentNode === g) paintAt(+px.getAttribute("data-i"));
    });
    function stop() { painting = false; strokeStarted = false; }
    g.addEventListener("pointerup", stop);
    g.addEventListener("pointercancel", stop);
    g.addEventListener("keydown", function (e) {
      var n = prefs.face.n, i = focusI, r = Math.floor(i / n), c = i % n;
      if (e.key === "ArrowRight") c = Math.min(n - 1, c + 1);
      else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
      else if (e.key === "ArrowDown") r = Math.min(n - 1, r + 1);
      else if (e.key === "ArrowUp") r = Math.max(0, r - 1);
      else if (e.key === "Home") c = 0;
      else if (e.key === "End") c = n - 1;
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault(); strokeStarted = false; paintAt(i); strokeStarted = false;
        var b = $("grid").children[focusI]; if (b) b.focus();
        return;
      } else return;
      e.preventDefault();
      focusI = r * n + c;
      renderGrid();
      $("grid").children[focusI].focus();
    });
    // a click (keyboard Enter on a button) must not paint twice
    g.addEventListener("click", function (e) { if (e.detail === 0) e.preventDefault(); });
  }

  // --- side controls ---
  function buildControls() {
    var sizes = $("sizes");
    SIZES.forEach(function (n) {
      var b = el("button", "chip", n + "×" + n);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-n", n);
      b.addEventListener("click", function () {
        if (prefs.face.n === n) return;
        commit(withFace({ n: n, px: "" }));
      });
      sizes.appendChild(b);
    });
    var pals = $("pals");
    PAL_IDS.forEach(function (id) {
      var b = el("button", "pal");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-p", id);
      b.appendChild(el("span", "pal-strip"));
      b.appendChild(el("span", "pal-name", t("pal." + id)));
      b.addEventListener("click", function () { commit(withFace({ p: id })); });
      pals.appendChild(b);
    });
    var paint = $("paint");
    for (var k = 0; k < NCOL; k++) {
      (function (k) {
        var s = el("button", "sw");
        s.type = "button";
        s.setAttribute("role", "radio");
        s.setAttribute("data-c", String(k));
        s.title = t("col" + k);
        s.setAttribute("aria-label", s.title);
        s.addEventListener("click", function () { prefs.col = k; savePrefs(); renderSide(); });
        paint.appendChild(s);
      })(k);
    }
    var exp = $("exp-sizes");
    EXPORT.forEach(function (v) {
      var b = el("button", "chip");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-e", v);
      b.addEventListener("click", function () { prefs.exp = v; savePrefs(); renderSide(); });
      exp.appendChild(b);
    });
  }

  function renderSide() {
    var f = prefs.face, cols = colorsOf(f);
    var seedIn = $("seed");
    if (document.activeElement !== seedIn) seedIn.value = f.s;
    $("title-sub").textContent = f.s + " · " + f.n + "×" + f.n + (f.px ? " · " + t("edited") : "");
    [].forEach.call(document.querySelectorAll("#sizes .chip"), function (b) {
      var on = +b.getAttribute("data-n") === f.n;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll(".pal"), function (b) {
      var id = b.getAttribute("data-p"), on = id === f.p;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
      var c = faceColors(f.s, id, cssVar), strip = b.querySelector(".pal-strip");
      strip.style.background = "linear-gradient(90deg," + [c[0], c[1], c[3], c[6], c[7]].map(function (x, i) {
        return x + " " + (i * 20) + "% " + ((i + 1) * 20) + "%";
      }).join(",") + ")";
    });
    [].forEach.call(document.querySelectorAll(".sw"), function (s) {
      var k = +s.getAttribute("data-c"), on = k === prefs.col;
      var clear = k === 0 && f.b === 1;
      s.style.background = clear ? "" : cols[k];
      s.classList.toggle("clear", clear);
      s.classList.toggle("on", on); s.setAttribute("aria-checked", on ? "true" : "false");
    });
    var bgBtn = $("bg-btn");
    bgBtn.textContent = f.b ? t("bg.color") : t("bg.clear");
    $("reset-btn").hidden = !f.px;
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    [].forEach.call(document.querySelectorAll("#exp-sizes .chip"), function (b) {
      var v = +b.getAttribute("data-e"), on = v === prefs.exp;
      b.textContent = t("exp.px", { n: exportPx(f.n, v) });
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function renderMuseum() {
    var host = $("museum"), list = shelf(data);
    host.innerHTML = "";
    $("museum-empty").hidden = list.length > 0;
    $("museum-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (it) {
      var li = el("li", "item");
      var open = el("button", "thumb");
      open.type = "button";
      open.innerHTML = faceSvg(it.f, 72, colorsOf(it.f), false);
      if (it.f.b) open.classList.add("clear");
      open.setAttribute("aria-label", t("item.open") + ": " + it.name);
      open.title = it.name;
      open.addEventListener("click", function () {
        commit(JSON.parse(JSON.stringify(it.f)));
        showToast(t("toast.opened", { name: it.name }));
      });
      li.appendChild(open);
      var row = el("div", "item-row");
      row.appendChild(el("span", "item-name", it.name));
      var rn = iconBtn("rn-btn", ICON.pen, t("item.rename") + ": " + it.name);
      rn.addEventListener("click", function () { renameItem(it); });
      row.appendChild(rn);
      var d = iconBtn("del-btn", ICON.del, t("item.delete") + ": " + it.name);
      d.addEventListener("click", function () { deleteItem(it); });
      row.appendChild(d);
      li.appendChild(row);
      host.appendChild(li);
    });
  }

  function renderAll() { renderGrid(); renderSide(); }

  // --- Museum actions ---
  function saveCurrent() {
    var f = prefs.face;
    for (var i = 0; i < data.items.length; i++) {
      if (sameFace(data.items[i].f, f)) { showToast(t("toast.already")); return; }
    }
    if (data.items.length >= MAX_ITEMS) { showToast(t("toast.full", { n: MAX_ITEMS })); return; }
    var it = { id: newId(), m: Date.now(), name: f.s, f: JSON.parse(JSON.stringify(f)) };
    data = mergePixel(data, { items: [it], tombs: {} });
    save(); renderMuseum();
    showToast(t("toast.saved"));
  }
  function deleteItem(it) {
    var snap = JSON.parse(JSON.stringify(it));
    var tombs = {};
    tombs[it.id] = Math.max(Date.now(), it.m);
    data = mergePixel(data, { items: [], tombs: tombs });
    save(); renderMuseum();
    $("save-btn").focus();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = mergePixel(data, { items: [snap], tombs: {} });
      save(); renderMuseum();
    });
  }
  function renameItem(it) {
    var dlg = makeDialog("pixel-rename");
    dlg.appendChild(el("div", "dlg-title", t("rename.title")));
    var input = el("input");
    input.type = "text";
    input.maxLength = MAX_NAME;
    input.value = it.name;
    input.setAttribute("aria-label", t("rename.title"));
    dlg.appendChild(input);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cancel"), "", function () { dlg.close(); }));
    function ok() {
      var name = clip(input.value, MAX_NAME);
      dlg.close();
      if (!name || name === it.name) return;
      var cur = null;
      data.items.forEach(function (x) { if (x.id === it.id) cur = x; });
      if (!cur) return;
      var next = JSON.parse(JSON.stringify(cur));
      next.name = name;
      next.m = Math.max(Date.now(), cur.m + 1);
      data = mergePixel(data, { items: [next], tombs: {} });
      save(); renderMuseum();
    }
    acts.appendChild(button(t("rename.ok"), "primary", ok));
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ok(); } });
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    input.select();
  }

  // ---------- 10. Export + copy ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.exported"));
  }
  var PNG_TYPES = [{ description: "PNG", accept: { "image/png": [".png"] } }];
  var SVG_TYPES = [{ description: "SVG", accept: { "image/svg+xml": [".svg"] } }];

  function fileBase(f) {
    var s = f.s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return "pixel-avatar-" + (s || "face") + "-" + f.n;
  }

  // Straight to a canvas: whole pixels, no smoothing, crisp edges.
  function pngBlob(f, size) {
    return new Promise(function (resolve, reject) {
      try {
        var n = f.n, k = size / n, grid = faceGrid(f), cols = colorsOf(f);
        var cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        var ctx = cv.getContext("2d");
        for (var i = 0; i < n * n; i++) {
          var c = +grid.charAt(i);
          if (c === 0 && f.b === 1) continue;
          ctx.fillStyle = cols[c];
          ctx.fillRect((i % n) * k, Math.floor(i / n) * k, k, k);
        }
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("toBlob")); }, "image/png");
      } catch (e) { reject(e); }
    });
  }
  function exportPng() {
    var f = prefs.face, size = exportPx(f.n, prefs.exp);
    pngBlob(f, size).then(function (b) {
      downloadBlob(b, fileBase(f) + ".png", "image/png", PNG_TYPES);
    }, function () { showToast(t("toast.copyFail")); });
  }
  function exportSvg() {
    var f = prefs.face;
    var b = new Blob([faceSvg(f, exportPx(f.n, prefs.exp), colorsOf(f), true)], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(b, fileBase(f) + ".svg", "image/svg+xml", SVG_TYPES);
  }
  function copyImage() {
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) {
      showToast(t("toast.copyFail"));
      return;
    }
    var f = prefs.face;
    // Safari wants the ClipboardItem created inside the gesture, with a promise.
    navigator.clipboard.write([new window.ClipboardItem({ "image/png": pngBlob(f, exportPx(f.n, 512)) })])
      .then(function () { showToast(t("toast.copied")); },
            function () { showToast(t("toast.copyFail")); });
  }
  function copySeed() {
    var s = prefs.face.s;
    var p = (navigator.clipboard && navigator.clipboard.writeText)
      ? navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; })
      : Promise.resolve(false);
    p.then(function (ok) { showToast(ok ? t("toast.copied") : t("toast.copyFail")); });
  }

  // ---------- 11. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "pixel", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
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

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 12. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      var k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
        return;
      }
      if (e.altKey || e.repeat) return;
      if (k === "r") { e.preventDefault(); newFace(); }
      else if (k === "p") { e.preventDefault(); nextPalette(); }
      else if (k === "d") { e.preventDefault(); exportPng(); }
    });
  }

  // ---------- 13. Sync slice + palette ----------
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
      new MutationObserver(function () {
        inheritPalette();
        renderAll(); renderMuseum();        // the orOS palette follows the skin
      }).observe(
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
    api.registerSlice("pixel", sliceGet, sliceSet, STORAGE_KEY, mergePixel);
  }

  function sliceGet() { return mergePixel(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergePixel(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) !== before) renderMuseum();   // no toast on merge
  }

  // ---------- 14. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("seed").placeholder = t("seed.ph");
    $("seed").setAttribute("aria-label", t("seed"));
    var nb = $("new-btn");
    nb.innerHTML = ICON.dice;
    nb.appendChild(el("span", "", t("btn.new")));
    nb.appendChild(el("kbd", "", "R"));
    [["copy-seed", ICON.copy, "btn.copySeed"], ["undo-btn", ICON.undo, "btn.undo"], ["redo-btn", ICON.redo, "btn.redo"]]
      .forEach(function (x) {
        var b = $(x[0]);
        b.innerHTML = x[1];
        b.setAttribute("aria-label", t(x[2]));
        b.title = t(x[2]);
      });
    var sb = $("save-btn");
    sb.innerHTML = ICON.save;
    sb.appendChild(el("span", "", t("btn.save")));
  }

  function wire() {
    wireGrid();
    $("new-btn").addEventListener("click", newFace);
    $("copy-seed").addEventListener("click", copySeed);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    var seedIn = $("seed"), seedTimer = null;
    seedIn.addEventListener("input", function () {
      clearTimeout(seedTimer);
      seedTimer = setTimeout(function () {
        var s = clip(seedIn.value, MAX_SEED);
        if (s && s !== prefs.face.s) commit(withFace({ s: s, px: "" }));
      }, 250);
    });
    seedIn.addEventListener("blur", function () { seedIn.value = prefs.face.s; });
    $("bg-btn").addEventListener("click", function () { commit(withFace({ b: prefs.face.b ? 0 : 1 })); });
    $("reset-btn").addEventListener("click", function () {
      commit(withFace({ px: "" }));
      showToast(t("toast.reset"));
      $("new-btn").focus();
    });
    $("png-btn").addEventListener("click", exportPng);
    $("svg-btn").addEventListener("click", exportSvg);
    $("copyimg-btn").addEventListener("click", copyImage);
    $("save-btn").addEventListener("click", saveCurrent);
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    buildControls();
    wire();
    registerSync();
    watchPalette();
    renderAll();
    renderMuseum();
  }

  boot();
})();
