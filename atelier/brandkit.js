// ============================================================
// orOS Atelier — brandkit.js: the Brand kit record (v1.0.0)
// One per user, synced as its own slice "atelier-brand"
// (oros-atelier-brand), separate from the designs:
//   { ver: 1,
//     colors: [{ id, m, c "#rrggbb", pos }]            ≤ 40
//     fonts:  { h | s | t: { f (font id), b (0|1), m } }  heading,
//             subheading, body text
//     logos:  [{ id, m, a (asset id), w, h, nm, pos }]  ≤ 20
//     dt:     { id: m }   tombstones of removed colours / logos }
// Merge: per entry and per font slot the newer stamp wins (equal
// stamps: the larger canonical JSON, so both sides agree); a
// tombstone removes entries not newer than it. Canonical: fixed
// key order, lists sorted by pos then id (R26).
// Pure: no DOM. Exposes window.AtelierBrand (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1, MAX_COLORS = 40, MAX_LOGOS = 20, SLOTS = ["h", "s", "t"];
  var ID = /^(bc|bl)-[a-z0-9]{6,24}$/;
  var FONT = /^(sans|serif|mono|fs_[a-z0-9]+(_[a-z0-9]+)*)$/;
  var ASSET = /^[0-9a-f]{64}\.(png|jpg)$/;

  function stamp(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : 0; }
  function color(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/.test(v.toLowerCase()) ? v.toLowerCase() : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : 0; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function normColor(x) {
    if (!x || !ID.test(x.id) || x.id.slice(0, 2) !== "bc") return null;
    var c = color(x.c), m = stamp(x.m);
    if (!c || !m) return null;
    return { id: x.id, m: m, c: c, pos: num(x.pos) };
  }
  function normLogo(x) {
    if (!x || !ID.test(x.id) || x.id.slice(0, 2) !== "bl") return null;
    var m = stamp(x.m);
    if (!m || typeof x.a !== "string" || !ASSET.test(x.a)) return null;
    var w = Math.max(1, Math.min(20000, Math.round(+x.w || 0))), h = Math.max(1, Math.min(20000, Math.round(+x.h || 0)));
    return { id: x.id, m: m, a: x.a, w: w, h: h, nm: typeof x.nm === "string" ? x.nm.replace(/[\u0000-\u001f]/g, "").slice(0, 80) : "", pos: num(x.pos) };
  }
  function normSlot(x) {
    if (!x || typeof x.f !== "string" || x.f.length > 63 || !FONT.test(x.f)) return null;
    var m = stamp(x.m);
    if (!m) return null;
    return { f: x.f, b: x.b === 1 || x.b === true ? 1 : 0, m: m };
  }
  function byPos(a, b) { return a.pos - b.pos || cmp(a.id, b.id); }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }

  // merge(a, b) with b optional: also the normalizer
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var dt = {};
    [a.dt, b.dt].forEach(function (t) {
      if (!t || typeof t !== "object") return;
      Object.keys(t).forEach(function (id) {
        var m = stamp(t[id]);
        if (ID.test(id) && m && !(dt[id] >= m)) dt[id] = m;
      });
    });
    function list(key, norm, max) {
      var by = {};
      [a[key], b[key]].forEach(function (l) {
        if (!Array.isArray(l)) return;
        l.forEach(function (x) { var n = norm(x); if (n) by[n.id] = newer(by[n.id], n); });
      });
      return Object.keys(by).map(function (id) { return by[id]; })
        .filter(function (x) { return !(dt[x.id] >= x.m); })
        .sort(byPos).slice(0, max);
    }
    var fonts = {};
    SLOTS.forEach(function (k) {
      var x = newer(normSlot(a.fonts && a.fonts[k]), normSlot(b.fonts && b.fonts[k]));
      if (x) fonts[k] = x;
    });
    // tombstones older than every live entry are kept (cheap) but capped
    var ids = Object.keys(dt).sort(function (p, q) { return dt[q] - dt[p] || cmp(p, q); }).slice(0, 400).sort(cmp);
    var dtOut = {};
    ids.forEach(function (id) { dtOut[id] = dt[id]; });
    return { ver: VER, colors: list("colors", normColor, MAX_COLORS), fonts: fonts, logos: list("logos", normLogo, MAX_LOGOS), dt: dtOut };
  }
  function norm(x) { return merge(x, null); }
  function empty() { return { ver: VER, colors: [], fonts: {}, logos: [], dt: {} }; }

  function newId(kind) {
    var s = "";
    var a = new Uint8Array(10);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < a.length; j++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[a[j] % 36];
    return kind + "-" + s;
  }
  function nextPos(l) { return l.reduce(function (p, x) { return Math.max(p, x.pos); }, 0) + 1; }

  // Mutations return a new normalized record (now: ms stamp).
  function addColor(b, c, now) {
    b = norm(b); c = color(c);
    if (!c || b.colors.some(function (x) { return x.c === c; }) || b.colors.length >= MAX_COLORS) return b;
    b.colors.push({ id: newId("bc"), m: now, c: c, pos: nextPos(b.colors) });
    return norm(b);
  }
  function addLogo(b, res, now) {
    b = norm(b);
    if (b.logos.length >= MAX_LOGOS || b.logos.some(function (x) { return x.a === res.id; })) return b;
    b.logos.push({ id: newId("bl"), m: now, a: res.id, w: res.w, h: res.h, nm: res.name || "", pos: nextPos(b.logos) });
    return norm(b);
  }
  function remove(b, id, now) {
    b = norm(b);
    b.dt[id] = now;
    return norm(b);
  }
  function setFont(b, slot, f, bold, now) {
    b = norm(b);
    if (SLOTS.indexOf(slot) < 0) return b;
    b.fonts[slot] = { f: f, b: bold ? 1 : 0, m: now };
    return norm(b);
  }

  var api = { VER: VER, SLOTS: SLOTS, MAX_COLORS: MAX_COLORS, MAX_LOGOS: MAX_LOGOS,
    merge: merge, norm: norm, empty: empty, addColor: addColor, addLogo: addLogo, remove: remove, setFont: setFont };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierBrand = api;
})(typeof window !== "undefined" ? window : this);
