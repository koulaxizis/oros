// ============================================================
// orOS Photo Lab — core (no DOM)
// The document model of the image editor and the synced project
// index. Pixels never live here: they are tiles on the orOS disk
// (photolab/store.js); this file only describes them.
//
//   Doc    { ver, id, m, name, w, h, layers: [layer] }   bottom → top
//   Layer  { id, k: "raster" | "text" | "shape", name, vis, lock,
//            op 0-100, bl: blend id, x, y, ... }
//          raster: t = { "tx,ty": tile name }  (tiles of TILE px,
//                  in the layer's own grid; x, y = the layer's
//                  offset on the canvas, so pixels moved off the
//                  canvas are kept, like Photoshop)
//          text:   tx = { s: text, f: font key, z: size px,
//                  c: "#rrggbb", a: "l"|"c"|"r", b: 0|1, i: 0|1,
//                  lh: line height % }
//          shape:  sh = { id: fx shape id, w, h, f: fill|"",
//                  s: stroke|"", sw: stroke width, r: rotation }
//   Index  { ver, projects: [{ id, m, name, w, h }], tombs: { id: ms } }
//          = sync slice "photolab"; LWW per project + tombstones
//          (R5, R17, R26).
//
// UMD: module.exports in Node (tests), window.PhotoLab.core in the app.
// ============================================================
(function (root) {
  "use strict";

  var DOC_VER    = 1;
  var INDEX_VER  = 1;
  var TILE       = 256;
  var MAX_LAYERS = 100;
  var MAX_PROJECTS = 500;
  var NAME_LEN   = 80;
  var TEXT_LEN   = 5000;
  var MIN_SIDE   = 1;
  var DESKTOP_SIDE = 8192;
  var PHONE_SIDE   = 4096;
  var PHONE_AREA   = 16777216;            // iPhone Safari canvas area cap
  var ID_RE      = /^p[a-z0-9]{6,20}$/;
  var LAYER_RE   = /^l[a-z0-9]{4,20}$/;
  var TILE_KEY_RE = /^-?\d{1,4},-?\d{1,4}$/;
  var TILE_NAME_RE = /^[0-9a-f]{28}$/;
  var HEX_RE     = /^#[0-9a-f]{6}$/;
  var FONT_RE    = /^[a-z0-9-]{1,40}$/;
  var SHAPE_RE   = /^[a-z0-9-]{1,30}$/;

  // Canvas 2D globalCompositeOperation names: native, so the screen
  // and the export blend the same way.
  var BLENDS = [
    { id: "normal",      op: "source-over", en: "Normal",      el: "Κανονική" },
    { id: "multiply",    op: "multiply",    en: "Multiply",    el: "Πολλαπλασιασμός" },
    { id: "screen",      op: "screen",      en: "Screen",      el: "Οθόνη" },
    { id: "overlay",     op: "overlay",     en: "Overlay",     el: "Επικάλυψη" },
    { id: "darken",      op: "darken",      en: "Darken",      el: "Σκούρυνση" },
    { id: "lighten",     op: "lighten",     en: "Lighten",     el: "Φωτισμός" },
    { id: "dodge",       op: "color-dodge", en: "Color dodge", el: "Αποφυγή χρώματος" },
    { id: "burn",        op: "color-burn",  en: "Color burn",  el: "Κάψιμο χρώματος" },
    { id: "hard",        op: "hard-light",  en: "Hard light",  el: "Σκληρό φως" },
    { id: "soft",        op: "soft-light",  en: "Soft light",  el: "Απαλό φως" },
    { id: "difference",  op: "difference",  en: "Difference",  el: "Διαφορά" },
    { id: "exclusion",   op: "exclusion",   en: "Exclusion",   el: "Αποκλεισμός" },
    { id: "hue",         op: "hue",         en: "Hue",         el: "Απόχρωση" },
    { id: "saturation",  op: "saturation",  en: "Saturation",  el: "Κορεσμός" },
    { id: "color",       op: "color",       en: "Color",       el: "Χρώμα" },
    { id: "luminosity",  op: "luminosity",  en: "Luminosity",  el: "Φωτεινότητα" }
  ];
  var BLEND_IDS = BLENDS.map(function (b) { return b.id; });

  // New-document presets (px). "dpi" only changes the name shown.
  var PRESETS = [
    { id: "hd",      w: 1920, h: 1080, en: "Full HD 1920 × 1080",       el: "Full HD 1920 × 1080" },
    { id: "square",  w: 1080, h: 1080, en: "Square post 1080 × 1080",   el: "Τετράγωνη ανάρτηση 1080 × 1080" },
    { id: "story",   w: 1080, h: 1920, en: "Story 1080 × 1920",         el: "Story 1080 × 1920" },
    { id: "phone",   w: 1440, h: 3120, en: "Phone wallpaper 1440 × 3120", el: "Ταπετσαρία κινητού 1440 × 3120" },
    { id: "a4",      w: 2480, h: 3508, en: "A4 at 300 dpi",             el: "A4 στα 300 dpi" },
    { id: "a5",      w: 1748, h: 2480, en: "A5 at 300 dpi",             el: "A5 στα 300 dpi" },
    { id: "web",     w: 1200, h: 630,  en: "Web banner 1200 × 630",     el: "Banner ιστού 1200 × 630" },
    { id: "icon",    w: 512,  h: 512,  en: "Icon 512 × 512",            el: "Εικονίδιο 512 × 512" }
  ];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  function cleanName(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || NAME_LEN);
  }
  function cleanText(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, TEXT_LEN);
  }
  function normHex(c, dflt) {
    if (typeof c !== "string") return dflt;
    c = c.toLowerCase();
    return HEX_RE.test(c) ? c : dflt;
  }

  // ---------- Ids ----------
  function randId(prefix, rnd) {
    var r = rnd || Math.random, s = "";
    var A = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 10; i++) s += A.charAt(Math.floor(r() * A.length));
    return prefix + s;
  }
  function newProjectId(rnd) { return randId("p", rnd); }
  function newLayerId(rnd) { return randId("l", rnd); }

  // ---------- Size limits ----------
  // → { side, area } for this device. phone = a touch-first small screen.
  function limitsFor(phone) {
    return phone ? { side: PHONE_SIDE, area: PHONE_AREA }
                 : { side: DESKTOP_SIDE, area: DESKTOP_SIDE * DESKTOP_SIDE };
  }
  // The size a w × h picture gets on this device: { w, h, scaled }.
  // Never silent: the caller says so when scaled is true.
  function fitSize(w, h, lim) {
    w = Math.max(MIN_SIDE, Math.round(w)); h = Math.max(MIN_SIDE, Math.round(h));
    var k = Math.min(1, lim.side / Math.max(w, h), Math.sqrt(lim.area / (w * h)));
    if (k >= 1) return { w: w, h: h, scaled: false };
    return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), scaled: true };
  }
  function normSize(w, h) {
    if (!isInt(w) || !isInt(h) || w < MIN_SIDE || h < MIN_SIDE || w > DESKTOP_SIDE || h > DESKTOP_SIDE) return null;
    return { w: w, h: h };
  }

  // ---------- Tile keys ----------
  function tileKey(tx, ty) { return tx + "," + ty; }
  function parseTileKey(k) {
    var i = k.indexOf(",");
    return { tx: +k.slice(0, i), ty: +k.slice(i + 1) };
  }

  // ---------- Layers ----------
  function normTiles(t) {
    var out = {};
    if (!t || typeof t !== "object" || Array.isArray(t)) return out;
    Object.keys(t).sort(cmpStr).forEach(function (k) {
      if (TILE_KEY_RE.test(k) && typeof t[k] === "string" && TILE_NAME_RE.test(t[k])) out[k] = t[k];
    });
    return out;
  }
  function normTextSpec(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      s: cleanText(raw.s),
      f: typeof raw.f === "string" && FONT_RE.test(raw.f) ? raw.f : "sans",
      z: clampInt(raw.z, 4, 2000, 72),
      c: normHex(raw.c, "#000000"),
      a: raw.a === "c" || raw.a === "r" ? raw.a : "l",
      b: raw.b ? 1 : 0,
      i: raw.i ? 1 : 0,
      lh: clampInt(raw.lh, 50, 300, 120)
    };
  }
  function normShapeSpec(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var f = raw.f === "" ? "" : normHex(raw.f, "#000000");
    var s = raw.s === "" || raw.s == null ? "" : normHex(raw.s, "");
    return {
      id: typeof raw.id === "string" && SHAPE_RE.test(raw.id) ? raw.id : "rect",
      w: clampInt(raw.w, 1, DESKTOP_SIDE * 2, 200),
      h: clampInt(raw.h, 1, DESKTOP_SIDE * 2, 200),
      f: f, s: s,
      sw: clampInt(raw.sw, 0, 500, 0),
      r: clampInt(raw.r, -180, 180, 0)
    };
  }
  function normLayer(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !LAYER_RE.test(raw.id)) return null;
    var k = raw.k === "text" || raw.k === "shape" ? raw.k : (raw.k === "raster" ? "raster" : null);
    if (!k) return null;
    var L = {
      id: raw.id, k: k,
      name: cleanName(raw.name) || (k === "text" ? "Text" : k === "shape" ? "Shape" : "Layer"),
      vis: raw.vis === 0 ? 0 : 1,
      lock: raw.lock ? 1 : 0,
      op: clampInt(raw.op, 0, 100, 100),
      bl: BLEND_IDS.indexOf(raw.bl) >= 0 ? raw.bl : "normal",
      x: clampInt(raw.x, -DESKTOP_SIDE * 4, DESKTOP_SIDE * 4, 0),
      y: clampInt(raw.y, -DESKTOP_SIDE * 4, DESKTOP_SIDE * 4, 0)
    };
    if (k === "raster") L.t = normTiles(raw.t);
    else if (k === "text") L.tx = normTextSpec(raw.tx);
    else L.sh = normShapeSpec(raw.sh);
    return L;
  }

  // ---------- Documents ----------
  function normDoc(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    if (!isInt(raw.m) || raw.m < 0) return null;
    var sz = normSize(raw.w, raw.h);
    if (!sz) return null;
    var seen = {}, layers = [];
    (Array.isArray(raw.layers) ? raw.layers : []).forEach(function (l) {
      if (layers.length >= MAX_LAYERS) return;
      var L = normLayer(l);
      if (!L || seen[L.id]) return;
      seen[L.id] = 1;
      layers.push(L);
    });
    return { ver: DOC_VER, id: raw.id, m: raw.m, name: cleanName(raw.name) || "Untitled",
             w: sz.w, h: sz.h, layers: layers };
  }

  function newDoc(o, rnd) {
    o = o || {};
    var sz = normSize(o.w, o.h) || { w: 1920, h: 1080 };
    var d = { ver: DOC_VER, id: newProjectId(rnd), m: o.now || 0,
              name: cleanName(o.name) || "Untitled", w: sz.w, h: sz.h, layers: [] };
    d.layers.push(normLayer({ id: newLayerId(rnd), k: "raster", name: o.layerName || "Background" }));
    return d;
  }

  // Every tile name the document needs on disk.
  function tilesOf(doc) {
    var set = {};
    (doc && doc.layers || []).forEach(function (L) {
      if (L.k !== "raster") return;
      Object.keys(L.t).forEach(function (k) { set[L.t[k]] = 1; });
    });
    return Object.keys(set).sort(cmpStr);
  }

  function findLayer(doc, id) {
    for (var i = 0; i < doc.layers.length; i++) if (doc.layers[i].id === id) return i;
    return -1;
  }

  // Layer-list edits (pure: return a new layers array).
  function moveLayer(layers, from, to) {
    var out = layers.slice();
    if (from < 0 || from >= out.length) return out;
    to = Math.max(0, Math.min(out.length - 1, to));
    var L = out.splice(from, 1)[0];
    out.splice(to, 0, L);
    return out;
  }

  function blendOp(id) {
    for (var i = 0; i < BLENDS.length; i++) if (BLENDS[i].id === id) return BLENDS[i].op;
    return "source-over";
  }

  // ---------- Project index (sync slice "photolab") ----------
  function entryOf(doc) {
    return { id: doc.id, m: doc.m, name: doc.name, w: doc.w, h: doc.h };
  }
  function normEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    if (!isInt(raw.m) || raw.m < 0) return null;
    var sz = normSize(raw.w, raw.h);
    if (!sz) return null;
    return { id: raw.id, m: raw.m, name: cleanName(raw.name) || "Untitled", w: sz.w, h: sz.h };
  }
  function emptyIndex() { return { ver: INDEX_VER, projects: [], tombs: {} }; }

  function mergeIndex(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.projects, b.projects].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var e = normEntry(raw);
        if (!e) return;
        var cur = best[e.id];
        if (!cur || e.m > cur.m ||
            (e.m === cur.m && JSON.stringify(e) > JSON.stringify(cur))) best[e.id] = e;
      });
    });
    var live = [];
    Object.keys(best).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      live.push(best[id]);
    });
    live.sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
    live = live.slice(0, MAX_PROJECTS);
    live.sort(function (x, y) { return cmpStr(x.id, y.id); });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: INDEX_VER, projects: live, tombs: sortedTombs };
  }
  function normIndex(raw) { return mergeIndex(raw, null); }

  // mtime moves only on a real change (R27): the caller stamps.
  function upsertEntry(index, doc) {
    var list = index.projects.filter(function (e) { return e.id !== doc.id; });
    list.push(entryOf(doc));
    return mergeIndex({ projects: list, tombs: index.tombs }, null);
  }
  function removeEntry(index, id, now) {
    var tombs = {};
    Object.keys(index.tombs).forEach(function (k) { tombs[k] = index.tombs[k]; });
    tombs[id] = Math.max(now, (tombs[id] || 0));
    return mergeIndex({ projects: index.projects, tombs: tombs }, null);
  }

  var API = {
    DOC_VER: DOC_VER, INDEX_VER: INDEX_VER, TILE: TILE, MAX_LAYERS: MAX_LAYERS,
    MAX_PROJECTS: MAX_PROJECTS, BLENDS: BLENDS, BLEND_IDS: BLEND_IDS, PRESETS: PRESETS,
    TILE_NAME_RE: TILE_NAME_RE, ID_RE: ID_RE,
    cleanName: cleanName, cleanText: cleanText,
    newProjectId: newProjectId, newLayerId: newLayerId,
    limitsFor: limitsFor, fitSize: fitSize, normSize: normSize,
    tileKey: tileKey, parseTileKey: parseTileKey,
    normLayer: normLayer, normDoc: normDoc, newDoc: newDoc, tilesOf: tilesOf,
    findLayer: findLayer, moveLayer: moveLayer, blendOp: blendOp,
    entryOf: entryOf, emptyIndex: emptyIndex, normIndex: normIndex, mergeIndex: mergeIndex,
    upsertEntry: upsertEntry, removeEntry: removeEntry
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.core = API; }
})(typeof window !== "undefined" ? window : this);
