// ============================================================
// orOS Slides — core.js (pure logic, v1.0.0)
// Everything that is not the screen: the data model and its merge
// (sync slice "slides"), slide order keys, themes, layouts and their
// placeholders, the outline view (deck <-> plain text) and the ready
// templates. No DOM, no storage, no network: the editor draws, this
// file decides. Node tests load it as is (it attaches OrosSlidesCore
// to its global).
//
// Drawing (designkit/render.js) and the slide show (designkit/show.js)
// live in the shared designkit/ folder; this file only describes WHAT
// is on a slide.
//
// Sections:
//   1. Constants
//   2. Text helpers
//   3. Order keys (fractional positions)
//   4. Themes
//   5. Layouts
//   6. Normalize
//   7. Merge (R5, R17, R26) + recovered text
//   8. Queries
//   9. Mutations (in place, mtime stamped at the mutation site, R27)
//  10. Outline view
//  11. Templates
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants ----------
  var VER = 1;
  var DATA_VER = 1;
  // Slide coordinates: the height is always 1000 units, the width
  // follows the aspect. A 4:3 <-> 16:9 change moves things, it never
  // stretches them.
  var H = 1000;
  var ASPECTS = { "16:9": 1778, "4:3": 1333 };
  var ASPECT_IDS = ["16:9", "4:3"];
  var ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
  var REC_ID_RE = /^r-[a-z0-9][a-z0-9-]{2,39}-[a-z0-9]{1,12}$/;
  var POS_RE = /^[0-9a-z]{1,64}$/;
  // A picture is a designkit asset: /internal/Assets/<sha256>.<jpg|png>.
  var ASSET_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  // A colour is either a fixed #rrggbb or a theme role, so a theme
  // change recolours the whole deck.
  var COLOR_RE = /^(#[0-9a-f]{6}|t:(bg|fg|mu|a1|a2|a3|sf))$/;
  var KINDS = ["text", "image", "shape", "line"];
  var SHAPES = ["rect", "ellipse"];   // what designkit/render.js and pdf.js draw
  var ROLES = ["title", "sub", "body", "body2", "cap", "cap2", "img", "quote"];
  var TRANSITIONS = ["none", "fade", "slide", "push", "zoom"];
  var FONTS = ["sans", "serif", "mono"];
  var LIM = {
    title: 120, footer: 80, notes: 5000, paras: 60, runs: 40, run: 1000, itemText: 4000,
    level: 4, coord: 6000, size: 8000, z: 9999, fs: 400, slides: 300, items: 80, stroke: 50, radius: 500,
    imgPx: 20000, rec: 5000, recovered: 50
  };
  var ROLE_FS = { title: 80, sub: 44, body: 44, body2: 44, cap: 36, cap2: 36, quote: 64 };
  var FS = 40;              // a free text box

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clampInt(v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function sortedObj(o) {
    var out = {};
    Object.keys(o).sort(cmpStr).forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function widthOf(aspect) { return ASPECTS[aspect] || ASPECTS["16:9"]; }

  // ---------- 2. Text helpers ----------
  // One line of user text: control characters out, spaces kept as typed
  // inside (a run boundary may sit next to a space), no line breaks.
  function cleanRun(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
    if (s.length > max) s = s.slice(0, max);
    return s;
  }
  function cleanLine(s, max) {
    s = cleanRun(s, max * 2).replace(/\s+/g, " ").trim();
    if (s.length > max) s = s.slice(0, max).trim();
    return s;
  }
  // Multi-line text (notes): line breaks kept, at most one empty line.
  function cleanBlock(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ")
         .split("\n").map(function (l) { return l.replace(/\s+$/g, ""); }).join("\n")
         .replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    if (s.length > max) s = s.slice(0, max);
    return s;
  }
  function paraText(p) {
    var s = "";
    for (var i = 0; i < p.r.length; i++) s += p.r[i].t;
    return s;
  }
  // Plain text of a text item: one line per paragraph.
  function itemText(it) {
    if (!it || !it.paras) return "";
    return it.paras.map(paraText).join("\n");
  }
  function plainPara(text, ls, l) {
    return { l: l || 0, ls: ls || "", r: [{ t: text }] };
  }

  // ---------- 3. Order keys ----------
  // Fractional keys over 0-9a-z, compared as strings. A key never ends
  // in "0", so there is always room before and after it. Two devices
  // that insert at the same spot may pick the same key: order is then
  // (key, id), the same everywhere.
  var DIG = "0123456789abcdefghijklmnopqrstuvwxyz";
  function posBetween(a, b) {
    a = (typeof a === "string" && POS_RE.test(a)) ? a : "";
    b = (typeof b === "string" && POS_RE.test(b)) ? b : null;
    if (b !== null && a >= b) b = null;
    var out = "", i = 0;
    for (;;) {
      var ca = i < a.length ? DIG.indexOf(a.charAt(i)) : 0;
      var cb = (b !== null && i < b.length) ? DIG.indexOf(b.charAt(i)) : 36;
      if (ca === cb) { out += DIG.charAt(ca); i++; continue; }
      var m = (ca + cb) >> 1;
      if (m > ca) return out + DIG.charAt(m);
      out += DIG.charAt(ca); i++;
      b = null;  // everything after this prefix is below the upper bound
      if (out.length >= 63) return out + "i";  // cannot happen with valid keys; a hard stop anyway
    }
  }

  // ---------- 4. Themes ----------
  // Roles: bg background, fg text, mu muted text, sf surface (boxes,
  // table rows), a1-a3 accents. Fonts are designkit families (Noto with
  // Greek). Every fg/bg and mu/bg pair passes WCAG AA (tests check it).
  var THEMES = [
    { id: "light",  name: { en: "Light",  el: "Φωτεινό" },   ff: "sans",  tf: "sans",
      c: { bg: "#ffffff", fg: "#1f2328", mu: "#57606a", sf: "#f3f4f6", a1: "#2563eb", a2: "#0f766e", a3: "#b45309" } },
    { id: "dark",   name: { en: "Dark",   el: "Σκοτεινό" },  ff: "sans",  tf: "sans",
      c: { bg: "#111827", fg: "#f9fafb", mu: "#9ca3af", sf: "#1f2937", a1: "#60a5fa", a2: "#34d399", a3: "#fbbf24" } },
    { id: "ocean",  name: { en: "Ocean",  el: "Ωκεανός" },   ff: "sans",  tf: "sans",
      c: { bg: "#0b3954", fg: "#f1faff", mu: "#a9cfe3", sf: "#124a6b", a1: "#5fd3f3", a2: "#ffd166", a3: "#ef8a8a" } },
    { id: "forest", name: { en: "Forest", el: "Δάσος" },     ff: "sans",  tf: "serif",
      c: { bg: "#f4f1e8", fg: "#1e3a2b", mu: "#4f6357", sf: "#e6e0cf", a1: "#2f6b45", a2: "#9a5b13", a3: "#7a3e65" } },
    { id: "sunset", name: { en: "Sunset", el: "Ηλιοβασίλεμα" }, ff: "sans", tf: "sans",
      c: { bg: "#fff4ec", fg: "#3b1f17", mu: "#7a4f42", sf: "#ffe3d1", a1: "#c2410c", a2: "#be185d", a3: "#6d28d9" } },
    { id: "paper",  name: { en: "Paper",  el: "Χαρτί" },     ff: "serif", tf: "serif",
      c: { bg: "#fbfaf7", fg: "#26231f", mu: "#625c53", sf: "#f0ede6", a1: "#8b1e1e", a2: "#1f4e79", a3: "#5a6b2f" } },
    { id: "tech",   name: { en: "Terminal", el: "Τερματικό" }, ff: "mono", tf: "mono",
      c: { bg: "#0d1117", fg: "#e6edf3", mu: "#8b949e", sf: "#161b22", a1: "#3fb950", a2: "#58a6ff", a3: "#d29922" } },
    { id: "bold",   name: { en: "Bold",   el: "Έντονο" },    ff: "sans",  tf: "sans",
      c: { bg: "#fde047", fg: "#111111", mu: "#3f3f46", sf: "#facc15", a1: "#1d4ed8", a2: "#b91c1c", a3: "#065f46" } }
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });
  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }
  // A colour value as drawn: theme roles resolved.
  function resolveColor(c, theme) {
    if (typeof c !== "string") return null;
    if (c.charAt(0) === "#") return c;
    var t = theme && theme.c ? theme : themeById(theme);
    return t.c[c.slice(2)] || null;
  }
  // WCAG relative luminance contrast of two #rrggbb colours.
  function contrast(x, y) {
    function lum(h) {
      var v = [1, 3, 5].map(function (i) {
        var c = parseInt(h.substr(i, 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }
    var a = lum(x), b = lum(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  // ---------- 5. Layouts ----------
  // Placeholders: x and w are fractions of the slide width, y and h are
  // units of the 1000-unit height. al: l/c/r/j, va: t/m/b.
  var LAYOUTS = [
    { id: "title",   name: { en: "Title", el: "Τίτλος" }, ph: [
      { role: "title", x: 0.08, y: 300, w: 0.84, h: 230, al: "c", va: "b" },
      { role: "sub",   x: 0.08, y: 560, w: 0.84, h: 140, al: "c", va: "t" } ] },
    { id: "content", name: { en: "Title and content", el: "Τίτλος και περιεχόμενο" }, ph: [
      { role: "title", x: 0.06, y: 60,  w: 0.88, h: 140, al: "l", va: "m" },
      { role: "body",  x: 0.06, y: 230, w: 0.88, h: 690, al: "l", va: "t" } ] },
    { id: "section", name: { en: "Section header", el: "Ενότητα" }, ph: [
      { role: "title", x: 0.08, y: 330, w: 0.84, h: 220, al: "l", va: "b" },
      { role: "sub",   x: 0.08, y: 580, w: 0.84, h: 120, al: "l", va: "t" } ] },
    { id: "two",     name: { en: "Two columns", el: "Δύο στήλες" }, ph: [
      { role: "title", x: 0.06, y: 60,  w: 0.88, h: 140, al: "l", va: "m" },
      { role: "body",  x: 0.06, y: 230, w: 0.43, h: 690, al: "l", va: "t" },
      { role: "body2", x: 0.51, y: 230, w: 0.43, h: 690, al: "l", va: "t" } ] },
    { id: "compare", name: { en: "Comparison", el: "Σύγκριση" }, ph: [
      { role: "title", x: 0.06, y: 60,  w: 0.88, h: 140, al: "l", va: "m" },
      { role: "cap",   x: 0.06, y: 230, w: 0.43, h: 80,  al: "l", va: "m" },
      { role: "body",  x: 0.06, y: 320, w: 0.43, h: 600, al: "l", va: "t" },
      { role: "cap2",  x: 0.51, y: 230, w: 0.43, h: 80,  al: "l", va: "m" },
      { role: "body2", x: 0.51, y: 320, w: 0.43, h: 600, al: "l", va: "t" } ] },
    { id: "imgtext", name: { en: "Picture and text", el: "Εικόνα και κείμενο" }, ph: [
      { role: "title", x: 0.06, y: 60,  w: 0.88, h: 140, al: "l", va: "m" },
      { role: "img",   x: 0.06, y: 230, w: 0.43, h: 690 },
      { role: "body",  x: 0.53, y: 230, w: 0.41, h: 690, al: "l", va: "t" } ] },
    { id: "photo",   name: { en: "Full picture", el: "Εικόνα σε όλη τη διαφάνεια" }, ph: [
      { role: "img",   x: 0,    y: 0,   w: 1,    h: 1000 },
      { role: "cap",   x: 0.06, y: 830, w: 0.88, h: 120, al: "l", va: "b" } ] },
    { id: "quote",   name: { en: "Quote", el: "Παράθεση" }, ph: [
      { role: "quote", x: 0.12, y: 230, w: 0.76, h: 420, al: "c", va: "m" },
      { role: "cap",   x: 0.12, y: 680, w: 0.76, h: 100, al: "c", va: "t" } ] },
    { id: "blank",   name: { en: "Blank", el: "Κενή" }, ph: [] }
  ];
  var LAYOUT_IDS = LAYOUTS.map(function (l) { return l.id; });
  function layoutById(id) {
    for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i].id === id) return LAYOUTS[i];
    return null;
  }
  // Where a role goes when the new layout has no placeholder for it.
  var ROLE_FALLBACK = { sub: ["cap"], cap: ["sub", "title", "quote"], cap2: ["sub"], quote: ["title"], title: ["quote", "cap"] };
  function phBox(ph, aspect) {
    var W = widthOf(aspect);
    return { x: Math.round(ph.x * W), y: ph.y, w: Math.round(ph.w * W), h: ph.h };
  }

  // ---------- 6. Normalize ----------
  // Every entity carries id and m (ms of its last real change, R27).
  // Unknown fields are dropped, every value is bounded: an imported or
  // synced document can never smuggle markup, scripts or huge blobs.
  function normId(v) { return typeof v === "string" && ID_RE.test(v) ? v : null; }
  function normM(v) { return isInt(v) && v >= 0 ? v : null; }
  function normColor(v) { return typeof v === "string" && COLOR_RE.test(v) ? v : null; }

  function normDeck(x) {
    if (!x || typeof x !== "object") return null;
    var id = normId(x.id), m = normM(x.m);
    if (!id || m === null) return null;
    var ft = (x.ft && typeof x.ft === "object") ? x.ft : {};
    return {
      id: id, m: m,
      t: cleanLine(x.t, LIM.title),
      as: ASPECT_IDS.indexOf(x.as) >= 0 ? x.as : "16:9",
      th: THEME_IDS.indexOf(x.th) >= 0 ? x.th : "light",
      ft: { n: ft.n === true, d: ft.d === true, x: cleanLine(ft.x, LIM.footer), s1: ft.s1 !== false },
      c: normM(x.c) === null ? m : x.c,
      tm: normM(x.tm) === null ? 0 : x.tm
    };
  }
  function normSlide(x) {
    if (!x || typeof x !== "object") return null;
    var id = normId(x.id), m = normM(x.m), d = normId(x.d);
    if (!id || m === null || !d || typeof x.p !== "string" || !POS_RE.test(x.p)) return null;
    var o = {
      id: id, m: m, d: d, p: x.p,
      ly: LAYOUT_IDS.indexOf(x.ly) >= 0 ? x.ly : "blank",
      tr: TRANSITIONS.indexOf(x.tr) >= 0 ? x.tr : "none",
      hid: x.hid === true,
      n: cleanBlock(x.n, LIM.notes),
      nb: normM(x.nb) === null ? 0 : x.nb,
      nm: normM(x.nm) === null ? 0 : x.nm,
      tm: normM(x.tm) === null ? 0 : x.tm
    };
    var bg = normColor(x.bg);
    if (bg) o.bg = bg;
    return o;
  }
  function normRun(r) {
    if (!r || typeof r !== "object") return null;
    var t = cleanRun(r.t, LIM.run);
    if (!t) return null;
    var o = { t: t };
    if (r.b === true) o.b = true;
    if (r.i === true) o.i = true;
    if (r.u === true) o.u = true;
    var c = normColor(r.c);
    if (c) o.c = c;
    return o;
  }
  function sameFmt(a, b) { return a.b === b.b && a.i === b.i && a.u === b.u && a.c === b.c; }
  function normPara(p) {
    if (!p || typeof p !== "object") return null;
    var runs = [];
    if (Array.isArray(p.r)) p.r.slice(0, LIM.runs).forEach(function (r) {
      var x = normRun(r);
      if (!x) return;
      var last = runs[runs.length - 1];
      if (last && sameFmt(last, x)) last.t += x.t; else runs.push(x);  // canonical: no split runs
    });
    return {
      l: clampInt(p.l, 0, LIM.level, 0),
      ls: (p.ls === "b" || p.ls === "n") ? p.ls : "",
      r: runs
    };
  }
  function normParas(arr) {
    var out = [], total = 0;
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length && out.length < LIM.paras; i++) {
      var p = normPara(arr[i]);
      if (!p) continue;
      var n = paraText(p).length;
      if (total + n > LIM.itemText) break;
      total += n;
      out.push(p);
    }
    // Trailing empty paragraphs carry nothing.
    while (out.length && !out[out.length - 1].r.length) out.pop();
    return out;
  }
  // Degrees in [-180, 180).
  function normAngle(v) {
    v = clampInt(v, -36000, 36000, 0);
    return ((v % 360) + 540) % 360 - 180;
  }
  function normItem(x) {
    if (!x || typeof x !== "object") return null;
    var id = normId(x.id), m = normM(x.m), s = normId(x.s);
    if (!id || m === null || !s || KINDS.indexOf(x.k) < 0) return null;
    var o = {
      id: id, m: m, s: s, k: x.k,
      x: clampInt(x.x, -LIM.coord, LIM.coord, 0), y: clampInt(x.y, -LIM.coord, LIM.coord, 0),
      w: clampInt(x.w, 1, LIM.size, 100), h: clampInt(x.h, 1, LIM.size, 100),
      r: normAngle(x.r), z: clampInt(x.z, 0, LIM.z, 0)
    };
    if (ROLES.indexOf(x.ph) >= 0) o.ph = x.ph;
    if (x.lk === true) o.lk = true;
    var op = clampInt(x.op, 0, 100, 100);
    if (op !== 100) o.op = op;
    var fill = normColor(x.fill), st = normColor(x.st);
    if (fill) o.fill = fill;
    if (st) { o.st = st; o.sw = clampInt(x.sw, 1, LIM.stroke, 2); if (x.dash === true) o.dash = true; }
    if (x.k === "text") {
      o.paras = normParas(x.paras);
      o.al = ["l", "c", "r", "j"].indexOf(x.al) >= 0 ? x.al : "l";
      o.va = ["t", "m", "b"].indexOf(x.va) >= 0 ? x.va : "t";
      o.fs = clampInt(x.fs, 6, LIM.fs, ROLE_FS[o.ph] || FS);
      o.ff = FONTS.indexOf(x.ff) >= 0 ? x.ff : "";
      o.fc = normColor(x.fc) || (o.ph === "sub" || o.ph === "cap" || o.ph === "cap2" ? "t:mu" : "t:fg");
      if (x.fit === false) o.fit = false;     // shrink to fit is on unless switched off
      o.b = normM(x.b) === null ? 0 : x.b;    // base mtime of the editing session (recovered text)
    } else if (x.k === "image") {
      var im = (x.img && typeof x.img === "object") ? x.img : {};
      if (typeof im.a === "string" && ASSET_RE.test(im.a)) {
        o.img = {
          a: im.a,
          pw: clampInt(im.pw, 1, LIM.imgPx, 1), ph: clampInt(im.ph, 1, LIM.imgPx, 1),
          fit: im.fit === "fit" ? "fit" : "fill",
          ox: clampInt(im.ox, -100, 100, 0), oy: clampInt(im.oy, -100, 100, 0),
          zm: clampInt(im.zm, 100, 800, 100),
          alt: cleanLine(im.alt, 300)
        };
      }
      // No img = an empty picture placeholder.
      var rad = clampInt(x.rad, 0, LIM.radius, 0);
      if (rad) o.rad = rad;
    } else if (x.k === "shape") {
      o.sh = SHAPES.indexOf(x.sh) >= 0 ? x.sh : "rect";
      var rr = clampInt(x.rad, 0, LIM.radius, 0);
      if (rr && o.sh === "rect") o.rad = rr;
      if (!o.fill && !o.st) o.fill = "t:a1";
    } else if (x.k === "line") {
      if (!o.st) { o.st = "t:fg"; o.sw = 4; }
      if (x.flip === true) o.flip = true;  // from the bottom-left corner instead of the top-left
    }
    return o;
  }
  function normRec(x) {
    if (!x || typeof x !== "object") return null;
    var m = normM(x.m), d = normId(x.d), s = normId(x.s);
    if (typeof x.id !== "string" || !REC_ID_RE.test(x.id) || m === null || !d || !s) return null;
    if (x.w !== "notes" && x.w !== "text") return null;
    var t = cleanBlock(x.x, LIM.rec);
    if (!t) return null;
    return { id: x.id, m: m, d: d, s: s, w: x.w, x: t };
  }
  function emptyData() {
    return { ver: DATA_VER, decks: {}, slides: {}, items: {}, ghosts: { decks: {}, slides: {} }, tombs: {} };
  }

  // ---------- 7. Merge ----------
  // Items and recovered texts: LWW per id (newer m; equal m: the
  // larger canonical JSON, so the result never depends on the order,
  // R5). Decks and slides merge in parts, each part LWW on its own
  // clock, so edits to different parts on two devices both survive:
  //   deck:  m  title, aspect, theme, footer     tm  "something inside changed" (max)
  //   slide: m  order, layout, transition, hidden, background
  //          nm notes                              tm  "an item on it changed" (max)
  // Editing an item stamps tm on its slide and deck, a slide change
  // stamps tm on its deck.
  //
  // Deletes (R17): tombstones max-merged. A deck is alive while one of
  // its clocks is after its tomb; a slide while one of its clocks is
  // after its own tomb AND its deck's; an item while its m is after
  // its own, its slide's and its deck's tombs. So a delete wins a tie,
  // an edit made after it (on a device that did not know) brings back
  // the deck, the slide and that edit, and the rest of what was deleted
  // stays deleted. Parts older than the tomb are reset on a revived
  // entity (notes cleared, tm 0): they died with the delete.
  //
  // Deleted decks and slides stay in `ghosts` as small skeletons (no
  // notes, no items): a revived slide needs its order and layout, and
  // keeping every version makes the merge associative, so devices agree
  // in whatever order they sync (tests: merge fuzz). Items are dropped
  // once dead: an item has one clock, a newer version always wins.
  //
  // Recovered text: when two versions of a text item (or of a slide's
  // notes) meet and the loser was NOT the base the winner was edited
  // from (loser.m > winner.b), the loser's text goes to onRecover(r):
  // zero loss when two devices edit the same box offline. Recovered
  // entries are device-local (the editor keeps them in its own key
  // with pushRecovered), not part of the synced data: which versions
  // meet depends on the sync order, so syncing them would make the
  // result depend on it too. The id is derived from the loser, so the
  // same text is offered once.
  function pick(cur, x) {
    if (!cur) return x;
    if (!x) return cur;
    if (x.m !== cur.m) return x.m > cur.m ? x : cur;
    return JSON.stringify(x) > JSON.stringify(cur) ? x : cur;
  }
  // Newer by clock `k`; equal: the larger JSON of the part's fields.
  function pickBy(x, y, k, fields) {
    if (x[k] !== y[k]) return x[k] > y[k] ? x : y;
    var sx = JSON.stringify(fields.map(function (f) { return x[f]; }));
    var sy = JSON.stringify(fields.map(function (f) { return y[f]; }));
    return sx >= sy ? x : y;
  }
  var DECK_PART = ["t", "as", "th", "ft", "c"];
  var SLIDE_PART = ["d", "p", "ly", "tr", "hid", "bg"];
  var NOTES_PART = ["n", "nb"];
  function joinDeck(x, y) {
    if (!x || !y) return x || y;
    var S = pickBy(x, y, "m", DECK_PART);
    return { id: S.id, m: S.m, t: S.t, as: S.as, th: S.th, ft: S.ft, c: S.c, tm: Math.max(x.tm, y.tm) };
  }
  function joinSlide(x, y, addRec) {
    if (!x || !y) return x || y;
    var S = pickBy(x, y, "m", SLIDE_PART), N = pickBy(x, y, "nm", NOTES_PART);
    var L = N === x ? y : x;
    if (L.n && L.n !== N.n && L.nm > N.nb) addRec({ id: recId(L.id, L.nm), m: L.nm, d: L.d, s: L.id, w: "notes", x: L.n });
    var o = { id: S.id, m: S.m, d: S.d, p: S.p, ly: S.ly, tr: S.tr, hid: S.hid };
    if (S.bg) o.bg = S.bg;
    o.n = N.n; o.nb = N.nb; o.nm = N.nm; o.tm = Math.max(x.tm, y.tm);
    return o;
  }
  function joinItem(x, y, addRec) {
    if (!x || !y) return x || y;
    var w = pick(x, y), l = w === x ? y : x;
    if (w.k === "text" && l.k === "text" && l.m > w.b) {
      var lt = itemText(l);
      if (lt && lt !== itemText(w)) addRec({ id: recId(l.id, l.m), m: l.m, d: "", s: l.s, w: "text", x: lt });
    }
    return w;
  }
  function recId(id, m) { return "r-" + id + "-" + m.toString(36); }
  function collect(src, key, norm, join, addRec) {
    var out = {};
    var v = src && src[key];
    if (!v || typeof v !== "object") return out;
    var list = Array.isArray(v) ? v : Object.keys(v).map(function (k) { return v[k]; });
    list.forEach(function (e) {
      var x = norm(e);
      if (x) out[x.id] = own(out, x.id) ? join(out[x.id], x, addRec) : x;
    });
    return out;
  }
  function mergeSlides(A, B, onRecover) {
    var a = (A && typeof A === "object") ? A : {}, b = (B && typeof B === "object") ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        var t = tm[id];
        if (!ID_RE.test(id) || !isInt(t) || t < 0) return;
        if (!own(tombs, id) || t > tombs[id]) tombs[id] = t;
      });
    });
    var rec = {};
    function addRec(r) { rec[r.id] = own(rec, r.id) ? pick(rec[r.id], r) : r; }
    function gather(srcs, key, norm, join) {
      var out = {};
      srcs.forEach(function (src) {
        var x = collect(src, key, norm, join, addRec);
        Object.keys(x).forEach(function (id) { out[id] = own(out, id) ? join(out[id], x[id], addRec) : x[id]; });
      });
      return out;
    }
    var ga = (a.ghosts && typeof a.ghosts === "object") ? a.ghosts : {};
    var gb = (b.ghosts && typeof b.ghosts === "object") ? b.ghosts : {};
    var decks = gather([a, b, ga, gb], "decks", normDeck, joinDeck);
    var slides = gather([a, b, ga, gb], "slides", normSlide, joinSlide);
    var items = gather([a, b], "items", normItem, joinItem);
    function tombOf() {
      var t = -1;
      for (var i = 0; i < arguments.length; i++) {
        var id = arguments[i];
        if (id && own(tombs, id) && tombs[id] > t) t = tombs[id];
      }
      return t;
    }

    var out = emptyData();
    Object.keys(decks).sort(cmpStr).forEach(function (id) {
      var d = decks[id], T = tombOf(id);
      if (d.tm <= T) d.tm = 0;
      if (Math.max(d.m, d.tm) > T) out.decks[id] = d; else out.ghosts.decks[id] = d;
    });
    Object.keys(slides).sort(cmpStr).forEach(function (id) {
      var s = slides[id], T = tombOf(id, s.d);
      if (!own(decks, s.d)) return;   // a deck nobody has: garbage
      if (s.nm <= T) { s.n = ""; s.nb = 0; s.nm = 0; }
      if (s.tm <= T) s.tm = 0;
      if (Math.max(s.m, s.nm, s.tm) > T && own(out.decks, s.d)) out.slides[id] = s;
      else out.ghosts.slides[id] = s;
    });
    Object.keys(items).sort(cmpStr).forEach(function (id) {
      var it = items[id], sl = slides[it.s];
      if (!sl || it.m <= tombOf(id, it.s, sl.d)) return;
      if (own(out.slides, it.s)) out.items[id] = it;
    });
    if (typeof onRecover === "function") Object.keys(rec).sort(cmpStr).forEach(function (id) {
      var r = rec[id];
      if (r.m <= tombOf(id.slice(2, id.lastIndexOf("-")))) return;  // its source was deleted after: nothing to recover
      // A text item knows its slide, not its deck: fill d in from the slide.
      var sl = out.slides[r.s];
      if (r.w === "text") {
        if (!sl) return;
        r = { id: r.id, m: r.m, d: sl.d, s: r.s, w: r.w, x: r.x };
      }
      if (own(out.decks, r.d)) onRecover(r);
    });
    out.tombs = sortedObj(tombs);
    return out;
  }

  // The stored form (R26): the editor saves canonical(data) after each
  // change, so get() is exactly what a merge would produce.
  function canonical(data) { return mergeSlides(data, null); }

  // ---------- 8. Queries ----------
  function cmpPos(x, y) { return cmpStr(x.p, y.p) || cmpStr(x.id, y.id); }
  function deckList(data) {
    return Object.keys(data.decks).map(function (id) { return data.decks[id]; })
      .sort(function (x, y) { return Math.max(y.m, y.tm) - Math.max(x.m, x.tm) || cmpStr(x.id, y.id); });
  }
  function deckSlides(data, deckId) {
    return Object.keys(data.slides).map(function (id) { return data.slides[id]; })
      .filter(function (s) { return s.d === deckId; }).sort(cmpPos);
  }
  function slideItems(data, slideId) {
    return Object.keys(data.items).map(function (id) { return data.items[id]; })
      .filter(function (it) { return it.s === slideId; })
      .sort(function (x, y) { return x.z - y.z || cmpStr(x.id, y.id); });
  }
  function placeholder(data, slideId, role) {
    var list = slideItems(data, slideId);
    for (var i = 0; i < list.length; i++) if (list[i].ph === role) return list[i];
    return null;
  }
  // An empty placeholder is a hint in the editor and nothing in the show.
  function isEmptyPlaceholder(it) {
    if (!it.ph) return false;
    if (it.k === "text") return !itemText(it).trim();
    if (it.k === "image") return !it.img;
    return false;
  }
  // The text a slide is known by (sorter, search, presenter view).
  function slideTitle(data, slideId) {
    var t = titleHolder(data, slideId);
    return t ? cleanLine(itemText(t), LIM.title) : "";
  }

  // ---------- 9. Mutations ----------
  // All in place on a normalized store; each stamps m on what it really
  // changed (R27). `now` is ms, `newId` returns a fresh id (the editor
  // passes a random one, tests a counter).
  function defaultNewId() {
    var s = "";
    for (var i = 0; i < 12; i++) s += DIG.charAt(Math.floor(Math.random() * 36));
    return "s" + s;
  }
  // "Something inside changed": keeps a parent alive against an older
  // delete and orders the deck list, without touching its own fields.
  function touchDeck(data, deckId, now) {
    var d = data.decks[deckId];
    if (d && d.tm < now) d.tm = now;
  }
  function touchSlide(data, slideId, now) {
    var s = data.slides[slideId];
    if (!s) return;
    if (s.tm < now) s.tm = now;
    touchDeck(data, s.d, now);
  }
  function newDeck(data, opts, now, newId) {
    newId = newId || defaultNewId;
    opts = opts || {};
    var d = normDeck({ id: newId(), m: now, c: now, t: opts.t || "", as: opts.as, th: opts.th, ft: opts.ft });
    data.decks[d.id] = d;
    return d;
  }
  function makePlaceholder(ph, slideId, aspect, z, now, newId) {
    var box = phBox(ph, aspect);
    var o = { id: newId(), m: now, s: slideId, k: ph.role === "img" ? "image" : "text",
              x: box.x, y: box.y, w: box.w, h: box.h, z: z, ph: ph.role };
    if (o.k === "text") { o.al = ph.al; o.va = ph.va; o.paras = []; }
    return normItem(o);
  }
  // A new slide after `afterId` (null: at the end).
  function addSlide(data, deckId, layoutId, afterId, now, newId) {
    newId = newId || defaultNewId;
    var deck = data.decks[deckId];
    if (!deck) return null;
    var list = deckSlides(data, deckId);
    if (list.length >= LIM.slides) return null;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === afterId) idx = i;
    if (afterId == null || idx < 0) idx = list.length - 1;
    var before = idx >= 0 ? list[idx].p : "";
    var after = idx + 1 < list.length ? list[idx + 1].p : null;
    var ly = layoutById(layoutId) || layoutById("content");
    var s = normSlide({ id: newId(), m: now, d: deckId, p: posBetween(before, after), ly: ly.id });
    data.slides[s.id] = s;
    ly.ph.forEach(function (ph, k) {
      var it = makePlaceholder(ph, s.id, deck.as, k + 1, now, newId);
      data.items[it.id] = it;
    });
    touchDeck(data, deckId, now);
    return s;
  }
  // Move a slide to sit between two others (ids, null = edge).
  function moveSlide(data, slideId, beforeId, afterId, now) {
    var s = data.slides[slideId];
    if (!s) return false;
    var a = beforeId && data.slides[beforeId] ? data.slides[beforeId].p : "";
    var b = afterId && data.slides[afterId] ? data.slides[afterId].p : null;
    var p = posBetween(a, b);
    if (p === s.p) return false;
    s.p = p; s.m = now;
    touchDeck(data, s.d, now);
    return true;
  }
  function duplicateSlide(data, slideId, now, newId) {
    newId = newId || defaultNewId;
    var s = data.slides[slideId];
    if (!s) return null;
    var list = deckSlides(data, s.d);
    if (list.length >= LIM.slides) return null;
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === slideId) idx = i;
    var next = idx + 1 < list.length ? list[idx + 1].p : null;
    var c = JSON.parse(JSON.stringify(s));
    c.id = newId(); c.m = now; c.p = posBetween(s.p, next); c.nb = 0; c.nm = c.n ? now : 0; c.tm = 0;
    c = normSlide(c);
    data.slides[c.id] = c;
    slideItems(data, slideId).forEach(function (it) {
      var x = JSON.parse(JSON.stringify(it));
      x.id = newId(); x.m = now; x.s = c.id; if (x.k === "text") x.b = 0;
      x = normItem(x);
      data.items[x.id] = x;
    });
    touchDeck(data, s.d, now);
    return c;
  }
  function tomb(data, id, ts) { if (!own(data.tombs, id) || data.tombs[id] < ts) data.tombs[id] = ts; }
  // Cascade with ONE timestamp (see the merge note).
  // A deleted deck or slide stays as a ghost skeleton (see the merge).
  function ghostSlide(data, s) {
    s.n = ""; s.nb = 0; s.nm = 0; s.tm = 0;
    data.ghosts.slides[s.id] = s;
    delete data.slides[s.id];
  }
  function deleteSlide(data, slideId, now) {
    var s = data.slides[slideId];
    if (!s) return false;
    slideItems(data, slideId).forEach(function (it) { delete data.items[it.id]; tomb(data, it.id, now); });
    tomb(data, slideId, now);
    ghostSlide(data, s);
    touchDeck(data, s.d, now);
    return true;
  }
  function deleteDeck(data, deckId, now) {
    if (!data.decks[deckId]) return false;
    deckSlides(data, deckId).forEach(function (s) {
      slideItems(data, s.id).forEach(function (it) { delete data.items[it.id]; tomb(data, it.id, now); });
      tomb(data, s.id, now);
      ghostSlide(data, s);
    });
    var d = data.decks[deckId];
    d.tm = 0;
    data.ghosts.decks[deckId] = d;
    delete data.decks[deckId];
    tomb(data, deckId, now);
    return true;
  }
  // Device-local recovered texts: newest first, one per id, at most
  // LIM.recovered, only valid entries (the list is read back from
  // localStorage, so it is normalized like synced data).
  function pushRecovered(list, r) {
    var out = [], seen = {};
    [r].concat(Array.isArray(list) ? list : []).forEach(function (x) {
      x = normRec(x);
      if (!x || seen[x.id]) return;
      seen[x.id] = true;
      out.push(x);
    });
    out.sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
    return out.slice(0, LIM.recovered);
  }
  function dropRecovered(list, id) {
    return pushRecovered(list, null).filter(function (x) { return x.id !== id; });
  }
  function deckRecovered(list, deckId) {
    return pushRecovered(list, null).filter(function (x) { return x.d === deckId; });
  }

  // Change the layout; content moves into the new placeholders by role.
  // Text or a picture whose role has no place stays on the slide as a
  // free item; empty placeholders without a place go.
  function applyLayout(data, slideId, layoutId, now, newId) {
    newId = newId || defaultNewId;
    var s = data.slides[slideId], ly = layoutById(layoutId);
    if (!s || !ly) return false;
    var deck = data.decks[s.d];
    var items = slideItems(data, slideId);
    var byRole = {};
    items.forEach(function (it) { if (it.ph && !byRole[it.ph]) byRole[it.ph] = it; });
    var used = {};
    var topZ = 0;
    items.forEach(function (it) { if (it.z > topZ) topZ = it.z; });
    ly.ph.forEach(function (ph) {
      var it = byRole[ph.role];
      if (!it || used[it.id]) {
        // A fallback with content beats an empty one.
        var cands = (ROLE_FALLBACK[ph.role] || []).map(function (fb) {
          var alt = byRole[fb];
          return (alt && !used[alt.id] && !ly.ph.some(function (q) { return q.role === fb; })) ? alt : null;
        }).filter(Boolean);
        it = cands.filter(function (c) { return !isEmptyPlaceholder(c); })[0] || cands[0] || null;
      }
      var box = phBox(ph, deck.as);
      if (it && it.k === (ph.role === "img" ? "image" : "text")) {
        used[it.id] = true;
        var ch = it.x !== box.x || it.y !== box.y || it.w !== box.w || it.h !== box.h || it.ph !== ph.role;
        if (it.k === "text") {
          ch = ch || it.al !== ph.al || it.va !== ph.va || it.fs !== (ROLE_FS[ph.role] || FS);
          it.al = ph.al; it.va = ph.va; it.fs = ROLE_FS[ph.role] || FS;
          if (it.fc === "t:mu" || it.fc === "t:fg") it.fc = (ph.role === "sub" || ph.role === "cap" || ph.role === "cap2") ? "t:mu" : "t:fg";
        }
        it.x = box.x; it.y = box.y; it.w = box.w; it.h = box.h; it.ph = ph.role;
        if (ch) it.m = now;
      } else {
        var n = makePlaceholder(ph, slideId, deck.as, ++topZ, now, newId);
        data.items[n.id] = n;
      }
    });
    items.forEach(function (it) {
      if (used[it.id] || !it.ph) return;
      if (isEmptyPlaceholder(it)) { delete data.items[it.id]; tomb(data, it.id, now); return; }
      delete it.ph; it.m = now;       // keeps its content, now a free item
    });
    if (s.ly !== ly.id) { s.ly = ly.id; s.m = now; }
    touchSlide(data, slideId, now);
    return true;
  }
  // 16:9 <-> 4:3: every item keeps its size and its centre moves in
  // proportion; placeholders snap to their new boxes.
  function setAspect(data, deckId, aspect, now) {
    var deck = data.decks[deckId];
    if (!deck || ASPECT_IDS.indexOf(aspect) < 0 || deck.as === aspect) return false;
    var W0 = widthOf(deck.as), W1 = widthOf(aspect);
    deck.as = aspect; deck.m = now;
    deckSlides(data, deckId).forEach(function (s) {
      var ly = layoutById(s.ly);
      slideItems(data, s.id).forEach(function (it) {
        var ph = null;
        if (it.ph && ly) ly.ph.forEach(function (q) { if (q.role === it.ph) ph = q; });
        if (ph) {
          var b = phBox(ph, aspect);
          it.x = b.x; it.w = b.w;
        } else {
          var w = Math.min(it.w, W1);
          var cx = (it.x + it.w / 2) * W1 / W0;
          it.w = w; it.x = Math.round(cx - w / 2);
        }
        it.m = now;
      });
      if (s.tm < now) s.tm = now;
    });
    return true;
  }
  // `base` (optional): the m the editing session started from, so an
  // edit made meanwhile on another device is kept as recovered text.
  // Without it the previous m is the base.
  function setNotes(data, slideId, text, now, base) {
    var s = data.slides[slideId];
    if (!s) return false;
    var n = cleanBlock(text, LIM.notes);
    if (n === s.n) return false;
    s.nb = isInt(base) && base >= 0 && base <= s.nm ? base : s.nm;
    s.n = n; s.nm = now;
    touchDeck(data, s.d, now);
    return true;
  }
  // New paragraphs for a text item; formatting of a paragraph whose
  // text did not change is kept.
  function setItemParas(data, itemId, paras, now, base) {
    var it = data.items[itemId];
    if (!it || it.k !== "text") return false;
    var np = normParas(paras);
    if (JSON.stringify(np) === JSON.stringify(it.paras)) return false;
    it.b = isInt(base) && base >= 0 && base <= it.m ? base : it.m;
    it.paras = np; it.m = now;
    touchSlide(data, it.s, now);
    return true;
  }

  // ---------- 10. Outline view ----------
  // The whole deck as plain text, one block per slide:
  //   # Slide title
  //   A plain line          (subtitle on title/section/quote slides, else a paragraph)
  //   - bullet              (two spaces or a tab per level, up to 4)
  //   1. numbered
  //   --                    (column break: what follows goes to the second column)
  //   > speaker notes
  // Applying an edited outline changes the slides in place: same order,
  // same layouts where the content still has a place, formatting kept
  // on paragraphs whose text did not change. Captions of a comparison
  // and pictures are not part of the outline and are never touched.
  function lineLevel(raw) {
    var m = raw.match(/^([ \t]*)/)[1];
    var n = 0;
    for (var i = 0; i < m.length; i++) n += m.charAt(i) === "\t" ? 2 : 1;
    return Math.min(LIM.level, Math.floor(n / 2));
  }
  function parseOutline(text) {
    var slides = [], cur = null;
    var lines = (typeof text === "string" ? text : "").replace(/\r\n?/g, "\n").split("\n");
    function start(title) {
      cur = { title: title, body: [], body2: [], notes: [], col: 1 };
      slides.push(cur);
    }
    lines.forEach(function (raw) {
      var line = cleanRun(raw, 2000).replace(/\s+$/, "");
      var t = line.trim();
      var h = t.match(/^#(?:\s+(.*))?$/);
      if (h) { start(cleanLine(h[1] || "", LIM.title)); return; }
      if (!t) return;
      if (!cur) start("");
      if (t.charAt(0) === ">") { cur.notes.push(t.replace(/^>\s?/, "")); return; }
      if (t === "--") { cur.col = 2; return; }
      var target = cur.col === 2 ? cur.body2 : cur.body;
      var lvl = lineLevel(raw);   // before cleanRun turns tabs into spaces
      var b = t.match(/^[-*•–]\s+(.*)$/);
      if (b) { target.push(plainPara(cleanLine(b[1], LIM.run), "b", lvl)); return; }
      var n = t.match(/^\d{1,3}[.)]\s+(.*)$/);
      if (n) { target.push(plainPara(cleanLine(n[1], LIM.run), "n", lvl)); return; }
      target.push(plainPara(cleanLine(t, LIM.run).replace(/^\u200b/, ""), "", lvl));
    });
    return slides.slice(0, LIM.slides).map(function (s) {
      return {
        title: s.title, body: s.body, body2: s.body2, notes: s.notes.join("\n"),
        plainOnly: s.body2.length === 0 && s.body.every(function (p) { return !p.ls && !p.l; })
      };
    });
  }
  function parasToOutline(paras) {
    var n = 0, out = [];
    paras.forEach(function (p) {
      var ind = new Array(p.l + 1).join("  ");
      var t = paraText(p);
      if (p.ls === "n") { n++; out.push(ind + n + ". " + t); return; }
      n = 0;
      if (p.ls === "b") out.push(ind + "- " + t);
      // A plain line that would read as markup gets an invisible guard.
      else out.push(ind + (/^([-*•–]\s|\d{1,3}[.)]\s|#(\s|$)|>|--$)/.test(t) ? "\u200b" : "") + t);
    });
    return out;
  }
  // What holds a slide's outline title, and its plain lines.
  function titleHolder(data, slideId) {
    var body = placeholder(data, slideId, "body"), sub = placeholder(data, slideId, "sub");
    return placeholder(data, slideId, "title") || placeholder(data, slideId, "quote") ||
      (!body && !sub ? placeholder(data, slideId, "cap") : null);
  }
  function lineHolder(data, slideId) {
    var t = titleHolder(data, slideId);
    var body = placeholder(data, slideId, "body");
    if (body) return body;
    var sub = placeholder(data, slideId, "sub") || placeholder(data, slideId, "cap");
    return sub && sub !== t ? sub : null;
  }
  function formatOutline(data, deckId) {
    var blocks = [];
    deckSlides(data, deckId).forEach(function (s) {
      var t = titleHolder(data, s.id);
      var lines = ["# " + (t ? cleanLine(itemText(t), LIM.title) : "")];
      var lh = lineHolder(data, s.id);
      if (lh) lines = lines.concat(parasToOutline(lh.paras));
      var b2 = placeholder(data, s.id, "body2");
      if (b2 && b2.paras.length) { lines.push("--"); lines = lines.concat(parasToOutline(b2.paras)); }
      if (s.n) s.n.split("\n").forEach(function (l) { lines.push("> " + l); });
      blocks.push(lines.join("\n"));
    });
    return blocks.join("\n\n");
  }
  // Paragraphs from the outline, keeping the runs (bold, colour) of a
  // paragraph whose text is the same at the same index.
  function mergeParas(old, fresh) {
    return fresh.map(function (p, i) {
      var o = old && old[i];
      if (o && paraText(o) === paraText(p)) return { l: p.l, ls: p.ls, r: o.r };
      return p;
    });
  }
  function pickLayout(ps, index) {
    if (ps.body2.length) return "two";
    if (!ps.body.length) return index === 0 ? "title" : "section";
    if (index === 0 && ps.plainOnly && ps.body.length <= 2) return "title";
    return "content";
  }
  function layoutHas(lyId, role) {
    var ly = layoutById(lyId);
    return !!ly && ly.ph.some(function (p) { return p.role === role; });
  }
  // The layout an existing slide needs for this outline block: its own
  // whenever the content still has a place.
  function neededLayout(data, s, ps, index) {
    var lineOnly = ps.plainOnly && ps.body.length <= 2;
    if (ps.body2.length && !layoutHas(s.ly, "body2")) return "two";
    if (ps.body.length && !layoutHas(s.ly, "body") && !(lineOnly && lineHolder(data, s.id))) return "content";
    if (ps.title && !titleHolder(data, s.id)) return pickLayout(ps, index);
    return s.ly;
  }
  function applyOutline(data, deckId, text, now, newId) {
    newId = newId || defaultNewId;
    if (!data.decks[deckId]) return null;
    var parsed = parseOutline(text);
    var list = deckSlides(data, deckId);
    var res = { added: 0, removed: 0, changed: 0 };
    parsed.forEach(function (ps, i) {
      var s = list[i], before = null;
      if (s) {
        before = JSON.stringify([s, slideItems(data, s.id)]);
        var want = neededLayout(data, s, ps, i);
        if (want !== s.ly) applyLayout(data, s.id, want, now, newId);
      } else {
        s = addSlide(data, deckId, pickLayout(ps, i), null, now, newId);
        if (!s) return;
        res.added++;
      }
      var t = titleHolder(data, s.id);
      if (t) setItemParas(data, t.id, mergeParas(t.paras, ps.title ? [plainPara(ps.title)] : []), now);
      var lh = lineHolder(data, s.id);
      if (lh) setItemParas(data, lh.id, mergeParas(lh.paras, ps.body), now);
      var b2 = placeholder(data, s.id, "body2");
      if (b2) setItemParas(data, b2.id, mergeParas(b2.paras, ps.body2), now);
      setNotes(data, s.id, ps.notes, now);
      if (before !== null && before !== JSON.stringify([data.slides[s.id], slideItems(data, s.id)])) res.changed++;
    });
    for (var k = parsed.length; k < list.length; k++) { deleteSlide(data, list[k].id, now); res.removed++; }
    return res;
  }

  // ---------- 11. Templates ----------
  // Ready decks, written as outlines in both languages (R15: a template
  // becomes ordinary user content in the chosen language once used).
  var TEMPLATES = [
    { id: "project", th: "light", name: { en: "Project update", el: "Ενημέρωση έργου" },
      en: "# Project update\nTeam name · date\n\n# Where we are\n- Done since last time\n- In progress\n- Blocked\n\n# Numbers\n- Budget used\n- Milestones met\n\n# Next steps\n1. First step\n2. Second step\n3. Third step\n\n# Questions\n> Leave time for questions.",
      el: "# Ενημέρωση έργου\nΟμάδα · ημερομηνία\n\n# Πού βρισκόμαστε\n- Τι ολοκληρώθηκε\n- Τι είναι σε εξέλιξη\n- Τι έχει κολλήσει\n\n# Αριθμοί\n- Προϋπολογισμός που χρησιμοποιήθηκε\n- Ορόσημα που πιάσαμε\n\n# Επόμενα βήματα\n1. Πρώτο βήμα\n2. Δεύτερο βήμα\n3. Τρίτο βήμα\n\n# Ερωτήσεις\n> Άφησε χρόνο για ερωτήσεις." },
    { id: "report", th: "paper", name: { en: "Report", el: "Αναφορά" },
      en: "# Report title\nAuthor · date\n\n# Summary\nThe main finding in one sentence.\n\n# Background\n- Why we looked into it\n- What we already knew\n\n# Findings\n- Finding one\n- Finding two\n--\n- What it means\n- What it changes\n\n# Recommendations\n1. Recommendation\n2. Recommendation",
      el: "# Τίτλος αναφοράς\nΣυντάκτης · ημερομηνία\n\n# Σύνοψη\nΤο βασικό εύρημα σε μία πρόταση.\n\n# Πλαίσιο\n- Γιατί το εξετάσαμε\n- Τι ξέραμε ήδη\n\n# Ευρήματα\n- Πρώτο εύρημα\n- Δεύτερο εύρημα\n--\n- Τι σημαίνει\n- Τι αλλάζει\n\n# Προτάσεις\n1. Πρόταση\n2. Πρόταση" },
    { id: "lesson", th: "forest", name: { en: "Lesson", el: "Μάθημα" },
      en: "# Lesson title\nClass · teacher\n\n# Today we will\n- Learn one idea\n- Try it ourselves\n- Check what stuck\n\n# The idea\nExplain it in plain words.\n> An example from everyday life helps.\n\n# Let's try\n1. Exercise one\n2. Exercise two\n\n# Recap\n- Key point\n- Key point",
      el: "# Τίτλος μαθήματος\nΤάξη · εκπαιδευτικός\n\n# Σήμερα θα\n- Μάθουμε μια ιδέα\n- Τη δοκιμάσουμε\n- Δούμε τι κρατήσαμε\n\n# Η ιδέα\nΕξήγησέ τη με απλά λόγια.\n> Βοηθά ένα παράδειγμα από την καθημερινότητα.\n\n# Ας δοκιμάσουμε\n1. Πρώτη άσκηση\n2. Δεύτερη άσκηση\n\n# Ανακεφαλαίωση\n- Βασικό σημείο\n- Βασικό σημείο" },
    { id: "pitch", th: "dark", name: { en: "Pitch", el: "Παρουσίαση ιδέας" },
      en: "# Product name\nOne line that says what it does\n\n# The problem\n- Who has it\n- How often\n- What it costs them\n\n# Our solution\nWhat we built and why it works.\n\n# Why now\n- What changed\n\n# The ask\n- What we need\n- What you get",
      el: "# Όνομα προϊόντος\nΜία γραμμή που λέει τι κάνει\n\n# Το πρόβλημα\n- Ποιος το έχει\n- Πόσο συχνά\n- Τι του κοστίζει\n\n# Η λύση μας\nΤι φτιάξαμε και γιατί δουλεύει.\n\n# Γιατί τώρα\n- Τι άλλαξε\n\n# Τι ζητάμε\n- Τι χρειαζόμαστε\n- Τι κερδίζετε" },
    { id: "album", th: "dark", name: { en: "Photo album", el: "Άλμπουμ φωτογραφιών" },
      en: "# Our trip\nPlace · year\n\n# Day one\n\n# Day two\n\n# The best moment\n\n# Thank you",
      el: "# Το ταξίδι μας\nΤόπος · χρονιά\n\n# Πρώτη μέρα\n\n# Δεύτερη μέρα\n\n# Η καλύτερη στιγμή\n\n# Ευχαριστούμε" },
    { id: "event", th: "sunset", name: { en: "Event", el: "Εκδήλωση" },
      en: "# Event name\nDate · place\n\n# Programme\n- 18:00 Welcome\n- 18:30 Talk\n- 19:30 Music\n\n# Who is coming\n- Guest\n- Guest\n\n# How to get there\nAddress and transport.\n\n# See you there!",
      el: "# Όνομα εκδήλωσης\nΗμερομηνία · χώρος\n\n# Πρόγραμμα\n- 18:00 Υποδοχή\n- 18:30 Ομιλία\n- 19:30 Μουσική\n\n# Ποιοι έρχονται\n- Καλεσμένος\n- Καλεσμένη\n\n# Πώς θα έρθετε\nΔιεύθυνση και συγκοινωνία.\n\n# Σας περιμένουμε!" }
  ];
  function templateById(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return null;
  }
  // A new deck from a template; the album's day slides get the full
  // picture layout so they ask for a photo.
  function fromTemplate(data, tplId, lang, now, newId) {
    newId = newId || defaultNewId;
    var tp = templateById(tplId);
    if (!tp) return null;
    var L = lang === "el" ? "el" : "en";
    var d = newDeck(data, { t: tp.name[L], th: tp.th }, now, newId);
    applyOutline(data, d.id, tp[L], now, newId);
    if (tp.id === "album") {
      deckSlides(data, d.id).forEach(function (s, i, all) {
        if (i > 0 && i < all.length - 1) applyLayout(data, s.id, "photo", now, newId);
      });
    }
    return d;
  }

  root.OrosSlidesCore = {
    VER: VER, DATA_VER: DATA_VER, H: H, ASPECTS: ASPECTS, ASPECT_IDS: ASPECT_IDS, LIM: LIM,
    ID_RE: ID_RE, REC_ID_RE: REC_ID_RE, ASSET_RE: ASSET_RE, COLOR_RE: COLOR_RE,
    KINDS: KINDS, SHAPES: SHAPES, ROLES: ROLES, TRANSITIONS: TRANSITIONS, FONTS: FONTS, ROLE_FS: ROLE_FS,
    THEMES: THEMES, THEME_IDS: THEME_IDS, LAYOUTS: LAYOUTS, LAYOUT_IDS: LAYOUT_IDS, TEMPLATES: TEMPLATES,
    widthOf: widthOf, themeById: themeById, resolveColor: resolveColor, contrast: contrast,
    layoutById: layoutById, phBox: phBox, templateById: templateById,
    cleanLine: cleanLine, cleanBlock: cleanBlock, paraText: paraText, itemText: itemText,
    posBetween: posBetween,
    normDeck: normDeck, normSlide: normSlide, normItem: normItem, normParas: normParas, normRec: normRec,
    emptyData: emptyData, mergeSlides: mergeSlides, canonical: canonical,
    deckList: deckList, deckSlides: deckSlides, slideItems: slideItems, placeholder: placeholder,
    deckRecovered: deckRecovered, isEmptyPlaceholder: isEmptyPlaceholder, slideTitle: slideTitle,
    touchDeck: touchDeck, touchSlide: touchSlide,
    newDeck: newDeck, addSlide: addSlide, moveSlide: moveSlide, duplicateSlide: duplicateSlide,
    deleteSlide: deleteSlide, deleteDeck: deleteDeck,
    pushRecovered: pushRecovered, dropRecovered: dropRecovered,
    applyLayout: applyLayout, setAspect: setAspect, setNotes: setNotes, setItemParas: setItemParas,
    parseOutline: parseOutline, formatOutline: formatOutline, applyOutline: applyOutline,
    fromTemplate: fromTemplate
  };
})(typeof window !== "undefined" ? window : this);
