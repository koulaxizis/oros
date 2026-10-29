// ============================================================
// orOS Slides — commands.js: what the Assistant may change in a
// presentation (AS-EDIT, wave SL1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Slides, in the
// step format of the automations (recipes/core.js specs; field names
// as in Atelier's catalog where they mean the same). The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the
//     presentations it is for (targets), count what it would change on
//     copies (preview) and describe a presentation to the AI (outline,
//     with the user's consent);
//   - in Slides (assist.js), which applies it and writes the result as
//     new edits (SL.putDeck), so it syncs like any other change.
// A presentation is worked on as a small store of its own (part(): the
// deck, its slides and their objects, in the shape of core.js data), so
// core.js mutations (addSlide, duplicateSlide, applyLayout, setNotes…)
// do the work and every value stays within core.js bounds.
// Object commands pick objects with the same four fields:
//   ids    object ids from read_in_app (comma separated)
//   pages  slides: "" (all) | odd | even | first | last | "2-4,6" (1 = first)
//   what   "" (every object) | text | title | photo | shape | line | table | chart
//   has    words in the text, or in a picture's description
//   A locked object is moved, aligned, restacked or removed only when
//   named by id. Positions and sizes are in slide units: the slide is
//   1000 high and 1778 (16:9) or 1333 (4:3) wide.
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more.
// Pure: no DOM. Needs slides/core.js (window.OrosSlidesCore).
// Exposes window.SlidesCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var C = node ? require("./core.js").OrosSlidesCore : root.OrosSlidesCore;
  if (!R || !C) return;

  var WHAT = ["", "text", "title", "photo", "shape", "line", "table", "chart"];
  var POS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  var ANIMS = ["none"].concat(C.EFFECTS);
  function num(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  function int(lo, hi) { return { t: "int", lo: lo, hi: hi, def: null }; }
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  var SEL = { ids: { t: "str", max: 2000 }, pages: { t: "str", max: 60 }, what: oneOf(WHAT), has: { t: "str", max: 200 } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }
  var COORD = 6000, SIZE = 8000;

  // kind: "doc" (every command edits the presentation's store)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 4000, req: 1 } }) },
    textstyle: { kind: "doc", args: sel({ font: oneOf([""].concat(C.FONTS)), size: num(6, 400), c: { t: "color" }, bold: ONOFF, ital: ONOFF, under: ONOFF,
      align: oneOf(["", "l", "c", "r", "j"]), valign: oneOf(["", "t", "m", "b"]) }) },
    colors: { kind: "doc", args: sel({ fill: { t: "color" }, stroke: { t: "color" }, sw: num(0, 50) }) },
    photo: { kind: "doc", args: sel({ fit: oneOf(["", "fit", "fill"]), round: int(0, 100), alt: { t: "str", max: 300 } }) },
    place: { kind: "doc", args: sel({ x: num(-COORD, COORD), y: num(-COORD, COORD), w: num(1, SIZE), h: num(1, SIZE),
      dx: num(-COORD, COORD), dy: num(-COORD, COORD), pct: num(1, 1000), rot: num(-360, 360), opacity: int(0, 100),
      pos: oneOf([""].concat(POS)), gap: num(0, 1000) }) },
    align: { kind: "doc", args: sel({ edge: oneOf(["", "l", "c", "r", "t", "m", "b"]), dist: oneOf(["", "h", "v"]), rel: oneOf(["sel", "page"]) }) },
    arrange: { kind: "doc", args: sel({ order: oneOf(["", "front", "back", "forward", "backward"]), lock: ONOFF }) },
    remove: { kind: "doc", args: sel({}) },
    animate: { kind: "doc", args: sel({ anim: oneOf([""].concat(ANIMS)), side: oneOf([""].concat(C.FLY_DIRS)), start: oneOf([""].concat(C.STARTS)) }) },
    add: { kind: "doc", args: { what: { t: "enum", v: ["text", "shape", "line"], def: "text", req: 1 }, page: { t: "int", lo: 1, hi: 9999, def: 1 }, text: { t: "str", max: 4000 },
      x: num(-COORD, COORD), y: num(-COORD, COORD), w: num(1, SIZE), h: num(1, SIZE), font: oneOf([""].concat(C.FONTS)), size: num(6, 400), c: { t: "color" },
      align: oneOf(["", "l", "c", "r", "j"]), bold: ONOFF, fill: { t: "color" }, shape: oneOf([""].concat(C.SHAPES)) } },
    pages: { kind: "doc", args: { n: { t: "int", lo: 1, hi: 100, def: 1, req: 1 }, at: oneOf(["end", "before", "after"]),
      page: { t: "int", lo: 0, hi: 9999, def: 0 }, dup: { t: "bool", def: 0 }, layout: oneOf([""].concat(C.LAYOUT_IDS)) } },
    delpages: { kind: "doc", args: { first: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, last: { t: "int", lo: 0, hi: 9999, def: 0 } } },
    movepage: { kind: "doc", args: { page: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, dest: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 } } },
    slide: { kind: "doc", args: { pages: SEL.pages, layout: oneOf([""].concat(C.LAYOUT_IDS)), trans: oneOf([""].concat(C.TRANSITIONS)), secs: num(0.1, 5), hide: ONOFF } },
    bg: { kind: "doc", args: { pages: SEL.pages, fill: { t: "color", req: 1 } } },
    notes: { kind: "doc", args: { pages: SEL.pages, text: { t: "str", max: 5000, req: 1 }, append: { t: "bool" } } },
    deck: { kind: "doc", args: { theme: oneOf([""].concat(C.THEME_IDS)), aspect: oneOf(["", "16:9", "4:3"]), footer: { t: "str", max: 80 }, num: ONOFF, date: ONOFF } },
    rename: { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Slides commands (documents are presentations; objects are picked with ids, pages (= slides), what (\"\" every object, or text, title, photo, shape, line, table, chart) and has; " +
    "a locked object is moved or removed only when named by id; positions and sizes in slide units: the slide is 1000 high and 1778 (16:9) or 1333 (4:3) wide; null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in texts, tables and the speaker notes of the picked slides (cs = match case, word = whole words; repl \"\" removes)",
    "settext: the whole text of the picked text boxes becomes `text` (one line per paragraph; pick them by ids)",
    "textstyle: font " + C.FONTS.join("|") + ", size (text size in slide units; a title is 80, body text 44), c (text colour #rrggbb), bold, ital, under (on|off), align l|c|r|j, valign t|m|b (where the text sits in its box)",
    "colors: fill (the box's or shape's fill; a line's colour), stroke (outline colour), sw (outline width)",
    "photo: fit fit|fill (the whole picture, or filling its frame), round (corners 0-100), alt (the picture's description for screen readers)",
    "place: x, y (top-left corner), w, h (size), dx, dy (move by), pct (scale %, about the centre), rot (degrees; tables and charts do not turn), opacity (0-100), pos tl|t|tr|l|c|r|bl|b|br (against the slide, gap from its edges)",
    "align: edge l|c|r|t|m|b and/or dist h|v (spread out evenly, 3 or more), rel sel (against each other) | page (the slide)",
    "arrange: order front|back|forward|backward, lock on|off",
    "remove: delete the picked objects (needs ids, what, has or pages)",
    "animate: the entrance animation of the picked objects in the slide show: anim " + C.EFFECTS.join("|") + " or none; side " + C.FLY_DIRS.join("|") + " (where fly comes from: bottom, left, right, top); start c|w|a (on click, with the previous, after the previous)",
    "add: a new object on slide `page` (1 = first): what text (needs text; font, size, c, align, bold) | shape (shape " + C.SHAPES.join("|") + ", fill) | line (c); x, y, w, h (left out: centred, a sensible size)",
    "pages: add n slides (1-100) at the end, or before | after slide `page` (1 = first); dup true = copies of that slide; else new slides with `layout` " + C.LAYOUT_IDS.join("|") + " (default content)",
    "delpages: remove slides first..last (last 0 = only first) with everything on them; at least one slide stays",
    "movepage: slide `page` moves to position `dest`",
    "slide: for the slides in `pages`: layout (" + C.LAYOUT_IDS.join("|") + "; the content moves into the new places), trans (the transition to the slide: " + C.TRANSITIONS.join("|") + "), secs (its length, 0.1-5), hide on|off (skipped in the show)",
    "bg: the background colour of the slides in `pages`: fill",
    "notes: the speaker notes of the slides in `pages` become `text`; append true adds it after the notes there",
    "deck: theme " + C.THEME_IDS.join("|") + " (colours and fonts of the whole presentation), aspect 16:9|4:3, footer (footer text), num on|off (slide numbers), date on|off",
    "rename: the presentation's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var PAGES_RX = /^\s*(|all|odd|even|first|last|\d{1,4}(\s*-\s*\d{1,4})?(\s*,\s*\d{1,4}(\s*-\s*\d{1,4})?)*)\s*$/i;
  // The 0-based positions `spec` names among `count` slides.
  function pageSet(spec, count) {
    var s = String(spec || "").trim().toLowerCase(), out = {};
    if (!PAGES_RX.test(s)) return {};
    for (var i = 0; i < count; i++) {
      if (!s || s === "all" || (s === "odd" && i % 2 === 0) || (s === "even" && i % 2 === 1) || (s === "first" && i === 0) || (s === "last" && i === count - 1)) out[i] = 1;
    }
    if (/^\d/.test(s)) {
      s.split(",").forEach(function (part) {
        var m = part.trim().split(/\s*-\s*/), a = +m[0], b = m.length > 1 ? +m[1] : a;
        for (var p = Math.max(1, a); p <= Math.min(count, b); p++) out[p - 1] = 1;
      });
    }
    return out;
  }
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi)) ||
          (spec.t === "color" && raw[k] !== "" && !v)) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.pages === "string" && !PAGES_RX.test(raw.pages)) bad.push("pages " + JSON.stringify(raw.pages) + " is not a slide list");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (raw.op === "remove" && !given(st.ids) && !given(st.pages) && !given(st.what) && !given(st.has)) return { err: "remove: pick the objects with ids, what, has or pages" };
    if (raw.op === "align" && !st.edge && !st.dist) return { err: "align: give edge or dist" };
    if (raw.op === "animate" && !st.anim) return { err: "animate: give anim" };
    if (raw.op === "add" && st.what === "text" && !given(st.text)) return { err: "add: a text needs text" };
    if (raw.op === "slide" && !st.layout && !st.trans && st.secs === null && !st.hide) return { err: "slide: give layout, trans, secs or hide" };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, i) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (i + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. A presentation as a store of its own ----------
  // A deep copy of one deck, its slides and their objects, in the shape
  // of core.js data, or null.
  function part(data, deckId) {
    var d = data && data.decks && data.decks[deckId];
    if (!d) return null;
    var out = C.emptyData();
    out.decks[deckId] = JSON.parse(JSON.stringify(d));
    C.deckSlides(data, deckId).forEach(function (s) {
      out.slides[s.id] = JSON.parse(JSON.stringify(s));
      C.slideItems(data, s.id).forEach(function (it) { out.items[it.id] = JSON.parse(JSON.stringify(it)); });
    });
    return out;
  }

  // ---------- 3. Picking ----------
  function idSet(s) {
    var o = {};
    String(s || "").split(/[\s,]+/).forEach(function (x) { if (x) o[x] = 1; });
    return o;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function tableText(it) { return it.tb ? it.tb.rows.map(function (r) { return r.join(" "); }).join(" ") : ""; }
  function textOf(it) {
    if (it.k === "text") return C.itemText(it);
    if (it.k === "table") return tableText(it);
    if (it.k === "chart") return (it.ch && it.ch.ttl) || "";
    if (it.k === "image") return (it.img && it.img.alt) || "";
    return "";
  }
  function kindOk(it, what) {
    if (!what) return true;
    if (what === "title") return it.k === "text" && (it.ph === "title" || it.ph === "quote");
    if (what === "photo") return it.k === "image";
    return it.k === what;
  }
  // The slides of the deck the command names, in order.
  function slidesOf(w, deckId, pages) {
    var list = C.deckSlides(w, deckId), set = pageSet(pages, list.length);
    return list.filter(function (s, i) { return set[i]; });
  }
  // The objects a command picks → [item] (in slide order, then stacking order).
  function pick(w, deckId, st) {
    var ids = given(st.ids) ? idSet(st.ids) : null, has = norm(st.has), out = [];
    slidesOf(w, deckId, ids ? "" : st.pages).forEach(function (s) {
      C.slideItems(w, s.id).forEach(function (it) {
        if (ids && !ids[it.id]) return;
        if (!kindOk(it, st.what)) return;
        if (has && norm(textOf(it)).indexOf(has) < 0) return;
        out.push(it);
      });
    });
    return out;
  }
  // Moving, aligning, restacking and removing spare a locked object
  // unless it was named by id.
  function free(it, st) { return !it.lk || (given(st.ids) && idSet(st.ids)[it.id]); }

  // ---------- 4. Applying ----------
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  function newIdOf(env) {
    if (env && env.newId) return env.newId;
    var n = 0;
    return function () { n++; return "snew" + n.toString(36) + Math.random().toString(36).slice(2, 8); };
  }
  function stamp(w, it, now) { it.m = now; C.touchSlide(w, it.s, now); }
  // Replaces in one paragraph's runs; a match that spans runs makes the
  // paragraph one run in the first run's look. → changed?
  function replacePara(p, rx, repl) {
    var before = JSON.stringify(p.r), full = C.paraText(p);
    rx.lastIndex = 0;
    if (!rx.test(full)) return false;
    p.r.forEach(function (r) { rx.lastIndex = 0; r.t = r.t.replace(rx, repl); });
    rx.lastIndex = 0;
    if (rx.test(C.paraText(p))) {
      rx.lastIndex = 0;
      var first = JSON.parse(JSON.stringify(p.r[0] || { t: "" }));
      first.t = full.replace(rx, repl);
      p.r = [first];
    }
    p.r = p.r.filter(function (r) { return r.t; });
    return JSON.stringify(p.r) !== before;
  }
  function setOnOff(o, k, v) {
    if (v === "on" && o[k] !== true) { o[k] = true; return 1; }
    if (v === "off" && o[k]) { delete o[k]; return 1; }
    return 0;
  }
  // Paragraphs from plain text: one per line.
  function parasOf(text) { return String(text).split(/\r?\n/).map(function (l) { return { l: 0, ls: "", r: l ? [{ t: l }] : [] }; }); }
  function slideW(w, deckId) { return C.widthOf(w.decks[deckId].as); }
  function topZ(w, slideId) { var z = 0; C.slideItems(w, slideId).forEach(function (x) { if (x.z > z) z = x.z; }); return z; }

  // One command on a picked object → changed?
  function itemStep(w, deckId, it, st, now) {
    var before = JSON.stringify(it), W = slideW(w, deckId);
    switch (st.op) {
      case "replace":
        var rx = finder(st);
        if (it.k === "text") {
          var paras = JSON.parse(JSON.stringify(it.paras)), hit = false;
          paras.forEach(function (p) { if (replacePara(p, rx, st.repl)) hit = true; });
          if (hit) C.setItemParas(w, it.id, paras, now);
        } else if (it.k === "table") {
          it.tb.rows = it.tb.rows.map(function (r) { return r.map(function (c) { rx.lastIndex = 0; return c.replace(rx, st.repl); }); });
        } else if (it.k === "chart" && it.ch && it.ch.ttl) {
          rx.lastIndex = 0; it.ch.ttl = it.ch.ttl.replace(rx, st.repl);
        }
        break;
      case "settext":
        if (it.k === "text") C.setItemParas(w, it.id, parasOf(st.text), now);
        break;
      case "textstyle":
        if (it.k === "text") {
          if (st.font && it.ff !== st.font) it.ff = st.font;
          if (st.size !== null) it.fs = Math.round(st.size);
          if (st.c) { it.fc = st.c; it.paras.forEach(function (p) { p.r.forEach(function (r) { delete r.c; }); }); }
          ["bold", "ital", "under"].forEach(function (k) {
            var f = k.charAt(0);
            if (st[k]) it.paras.forEach(function (p) { p.r.forEach(function (r) { setOnOff(r, f, st[k]); }); });
          });
          if (st.align) it.al = st.align;
          if (st.valign) it.va = st.valign;
        } else if (it.k === "table") {
          if (st.font) it.ff = st.font;
          if (st.size !== null) it.tb.fs = Math.max(8, Math.min(200, Math.round(st.size)));
          if (st.c) it.fc = st.c;
        }
        break;
      case "colors":
        if (st.fill) { if (it.k === "line") it.st = st.fill; else if (it.k !== "chart") it.fill = st.fill; }
        if (st.stroke) { it.st = st.stroke; if (!it.sw) it.sw = 2; }
        if (st.sw !== null) { if (st.sw === 0) { if (it.k !== "line" && it.k !== "table") { delete it.st; delete it.sw; delete it.dash; } } else if (it.st) it.sw = Math.max(1, Math.round(st.sw)); }
        break;
      case "photo":
        if (it.k !== "image") break;
        if (st.fit && it.img) it.img.fit = st.fit;
        if (st.round !== null) { var rad = Math.round(st.round / 100 * Math.min(it.w, it.h) / 2); if (rad) it.rad = rad; else delete it.rad; }
        if (st.alt && it.img) it.img.alt = st.alt;
        break;
      case "place":
        if (!free(it, st)) break;
        if (st.pct !== null) {
          var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          it.w = Math.max(1, Math.round(it.w * st.pct / 100)); it.h = Math.max(1, Math.round(it.h * st.pct / 100));
          it.x = Math.round(cx - it.w / 2); it.y = Math.round(cy - it.h / 2);
        }
        if (st.w !== null) it.w = Math.round(st.w);
        if (st.h !== null) it.h = Math.round(st.h);
        if (st.x !== null) it.x = Math.round(st.x);
        if (st.y !== null) it.y = Math.round(st.y);
        if (st.dx !== null) it.x += Math.round(st.dx);
        if (st.dy !== null) it.y += Math.round(st.dy);
        if (st.pos) {
          var g = st.gap || 0, p = st.pos;
          it.x = Math.round(/l$/.test(p) ? g : /r$/.test(p) ? W - g - it.w : (W - it.w) / 2);
          it.y = Math.round(/^t/.test(p) ? g : /^b/.test(p) ? C.H - g - it.h : (C.H - it.h) / 2);
        }
        if (st.rot !== null && it.k !== "table" && it.k !== "chart") it.r = ((Math.round(st.rot) % 360) + 540) % 360 - 180;
        if (st.opacity !== null) { if (st.opacity === 100) delete it.op; else it.op = st.opacity; }
        break;
      case "arrange":
        if (st.lock) setOnOff(it, "lk", st.lock);
        break;
      case "animate":
        if (st.anim === "none") { if (it.an) C.setAnim(w, [it.id], null, now); }
        else {
          var an = { e: st.anim };
          if (st.anim === "fly") an.d = st.side || (it.an && it.an.d) || "b";
          an.w = st.start || (it.an && it.an.w) || "c";
          if (it.an && it.an.du) an.du = it.an.du;
          if (it.an && it.an.dl) an.dl = it.an.dl;
          if (it.an && it.an.p) an.p = it.an.p;
          C.setAnim(w, [it.id], an, now);
        }
        break;
    }
    var keep = w.items[it.id] || it, ok = JSON.stringify(keep) !== before;
    if (ok && keep.m !== now) stamp(w, keep, now);
    return ok;
  }
  // Restacks the picked objects of one slide → how many moved.
  function restack(w, slideId, picked, order, now) {
    var list = C.slideItems(w, slideId), want = {}, k = 0;
    picked.forEach(function (it) { want[it.id] = 1; });
    var before = list.map(function (x) { return x.id; }).join(",");
    var mine = list.filter(function (x) { return want[x.id]; }), rest = list.filter(function (x) { return !want[x.id]; }), out;
    if (order === "front") out = rest.concat(mine);
    else if (order === "back") out = mine.concat(rest);
    else {
      out = list.slice();
      var step = order === "forward" ? 1 : -1, idx = out.map(function (x, i) { return want[x.id] ? i : -1; }).filter(function (i) { return i >= 0; });
      if (step > 0) idx.reverse();
      idx.forEach(function (i) {
        var j = i + step;
        if (j < 0 || j >= out.length || want[out[j].id]) return;
        var t = out[i]; out[i] = out[j]; out[j] = t;
      });
    }
    if (out.map(function (x) { return x.id; }).join(",") === before) return 0;
    out.forEach(function (x, i) {
      if (x.z !== i + 1) { x.z = i + 1; x.m = now; if (want[x.id]) k++; }
    });
    C.touchSlide(w, slideId, now);
    return k;
  }
  function alignSlide(w, deckId, items, st, now) {
    if (!items.length) return 0;
    var W = slideW(w, deckId), k = 0, box;
    if (st.rel === "page" || items.length < 2) box = { x: 0, y: 0, w: W, h: C.H };
    else {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      items.forEach(function (it) { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h); });
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    var at = {};
    items.forEach(function (it) { at[it.id] = it.x + "," + it.y; });
    items.forEach(function (it) {
      if (st.edge === "l") it.x = box.x;
      else if (st.edge === "c") it.x = Math.round(box.x + (box.w - it.w) / 2);
      else if (st.edge === "r") it.x = box.x + box.w - it.w;
      else if (st.edge === "t") it.y = box.y;
      else if (st.edge === "m") it.y = Math.round(box.y + (box.h - it.h) / 2);
      else if (st.edge === "b") it.y = box.y + box.h - it.h;
    });
    if (st.dist && items.length >= 3) {
      var hz = st.dist === "h", ord = items.slice().sort(function (a, b) { return hz ? a.x - b.x : a.y - b.y; });
      var first = ord[0], last = ord[ord.length - 1], span = hz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y, used = 0;
      ord.forEach(function (it) { used += hz ? it.w : it.h; });
      var gap = (span - used) / (ord.length - 1), cur = hz ? first.x : first.y;
      ord.forEach(function (it) { if (hz) it.x = Math.round(cur); else it.y = Math.round(cur); cur += (hz ? it.w : it.h) + gap; });
    }
    items.forEach(function (it) { if (at[it.id] !== it.x + "," + it.y) { stamp(w, it, now); k++; } });
    return k;
  }
  // A new object for an add command.
  function addItem(w, deckId, st, now, newId) {
    var list = C.deckSlides(w, deckId), s = list[Math.min(list.length, st.page || 1) - 1];
    if (!s) return 0;
    var W = slideW(w, deckId), o = { id: newId(), m: now, s: s.id, k: st.what, z: topZ(w, s.id) + 1 };
    var dw = st.what === "text" ? Math.round(W * 0.6) : st.what === "line" ? 400 : 300, dh = st.what === "text" ? 200 : st.what === "line" ? 4 : 300;
    o.w = Math.round(st.w || dw); o.h = Math.round(st.h || dh);
    o.x = st.x !== null ? Math.round(st.x) : Math.round((W - o.w) / 2);
    o.y = st.y !== null ? Math.round(st.y) : Math.round((C.H - o.h) / 2);
    if (st.what === "text") {
      o.paras = parasOf(st.text);
      if (st.bold === "on") o.paras.forEach(function (p) { p.r.forEach(function (r) { r.b = true; }); });
      if (st.font) o.ff = st.font;
      if (st.size !== null) o.fs = Math.round(st.size);
      if (st.c) o.fc = st.c;
      o.al = st.align || "l";
      if (st.fill) o.fill = st.fill;
    } else if (st.what === "shape") {
      o.sh = st.shape || "rect";
      o.fill = st.fill || "t:a1";
    } else {
      o.st = st.c || st.fill || "t:fg"; o.sw = 4;
    }
    var it = C.normItem(o);
    if (!it) return 0;
    w.items[it.id] = it;
    C.touchSlide(w, s.id, now);
    return 1;
  }
  // Adds slides → how many. They go at the end, or before / after
  // slide `page`, one after the other in the order they are made.
  function addSlides(w, deckId, st, now, newId, env) {
    var list = C.deckSlides(w, deckId), k = 0;
    if (!list.length) return 0;
    var at = st.at || "end", p = Math.max(1, Math.min(list.length, st.page || (at === "before" ? 1 : list.length)));
    var src = list[(st.page >= 1 ? p : list.length) - 1], prev, next;
    if (at === "before") { prev = p > 1 ? list[p - 2] : null; next = list[p - 1]; }
    else if (at === "after") { prev = list[p - 1]; next = list[p] || null; }
    else { prev = list[list.length - 1]; next = null; }
    for (var i = 0; i < st.n; i++) {
      if (C.deckSlides(w, deckId).length >= C.LIM.slides) { note(env, "maxSlides"); break; }
      var s = st.dup ? C.duplicateSlide(w, src.id, now, newId) : C.addSlide(w, deckId, st.layout || "content", null, now, newId);
      if (!s) break;
      C.moveSlide(w, s.id, prev ? prev.id : null, next ? next.id : null, now);
      prev = s;
      k++;
    }
    return k;
  }

  // Applies one command to a presentation's store (part()) in place →
  // how many objects, slides or settings changed. env: { now, newId,
  // notes[] }.
  function apply(w, deckId, st, env) {
    env = env || {};
    var now = env.now || Date.now(), newId = newIdOf(env), deck = w.decks[deckId], k = 0;
    if (!deck) return 0;
    switch (st.op) {
      case "rename":
        var t = C.cleanLine(st.title, C.LIM.title);
        if (!t || t === deck.t) return 0;
        deck.t = t; deck.m = now;
        return 1;
      case "deck":
        if (st.theme && deck.th !== st.theme) { deck.th = st.theme; deck.m = now; k++; }
        if (st.aspect && C.setAspect(w, deckId, st.aspect, now)) k++;
        var ft = deck.ft, f0 = JSON.stringify(ft);
        if (st.footer && ft.x !== C.cleanLine(st.footer, C.LIM.footer)) ft.x = C.cleanLine(st.footer, C.LIM.footer);
        if (st.num) ft.n = st.num === "on";
        if (st.date) ft.d = st.date === "on";
        if (JSON.stringify(ft) !== f0) { deck.m = now; k++; }
        return k;
      case "pages": return addSlides(w, deckId, st, now, newId, env);
      case "delpages":
        var all = C.deckSlides(w, deckId), last = st.last || st.first, gone = all.slice(st.first - 1, Math.min(all.length, last));
        if (gone.length >= all.length) { gone = gone.slice(0, all.length - 1); note(env, "lastSlide"); }
        gone.forEach(function (s) { if (C.deleteSlide(w, s.id, now)) k++; });
        return k;
      case "movepage":
        var sl = C.deckSlides(w, deckId), from = sl[st.page - 1];
        if (!from) return 0;
        var rest = sl.filter(function (s) { return s.id !== from.id; }), di = Math.min(rest.length, st.dest - 1);
        if (sl.indexOf(from) === di) return 0;
        return C.moveSlide(w, from.id, di > 0 ? rest[di - 1].id : null, rest[di] ? rest[di].id : null, now) ? 1 : 0;
      case "slide":
        slidesOf(w, deckId, st.pages).forEach(function (s) {
          var b = JSON.stringify(s), ch = false;
          if (st.layout && s.ly !== st.layout) { C.applyLayout(w, s.id, st.layout, now, newId); ch = true; }
          if (st.trans) s.tr = st.trans;
          if (st.secs !== null) s.td = Math.round(st.secs * 1000);
          if (st.hide) s.hid = st.hide === "on";
          if (ch || JSON.stringify(s) !== b) { s.m = now; C.touchSlide(w, s.id, now); k++; }
        });
        return k;
      case "bg":
        slidesOf(w, deckId, st.pages).forEach(function (s) {
          if (s.bg === st.fill) return;
          s.bg = st.fill; s.m = now; C.touchSlide(w, s.id, now); k++;
        });
        return k;
      case "notes":
        slidesOf(w, deckId, st.pages).forEach(function (s) {
          var txt = st.append && s.n ? s.n + "\n" + st.text : st.text;
          if (C.setNotes(w, s.id, txt, now)) k++;
        });
        return k;
      case "add": return addItem(w, deckId, st, now, newId);
    }
    var picked = pick(w, deckId, st);
    if (!picked.length) { note(env, "noObjects"); return 0; }
    if ((st.op === "place" || st.op === "align" || st.op === "remove" || (st.op === "arrange" && st.order)) && picked.some(function (it) { return !free(it, st); })) note(env, "locked");
    if (st.op === "remove") {
      picked.filter(function (it) { return free(it, st); }).forEach(function (it) {
        delete w.items[it.id]; w.tombs[it.id] = now; C.touchSlide(w, it.s, now); k++;
      });
      return k;
    }
    var bySlide = {};
    picked.forEach(function (it) { (bySlide[it.s] = bySlide[it.s] || []).push(it); });
    if (st.op === "align") {
      Object.keys(bySlide).forEach(function (sid) { k += alignSlide(w, deckId, bySlide[sid].filter(function (it) { return free(it, st); }), st, now); });
      return k;
    }
    if (st.op === "arrange" && st.order) {
      Object.keys(bySlide).forEach(function (sid) { k += restack(w, sid, bySlide[sid].filter(function (it) { return free(it, st); }), st.order, now); });
      if (!st.lock) return k;
      var kk = 0;
      picked.forEach(function (it) { if (itemStep(w, deckId, it, st, now)) kk++; });
      return Math.max(k, kk);
    }
    picked.forEach(function (it) { if (itemStep(w, deckId, it, st, now)) k++; });
    // the speaker notes of the picked slides, when no object was named
    if (st.op === "replace" && !given(st.ids) && !st.what && !st.has) {
      var rx = finder(st);
      slidesOf(w, deckId, st.pages).forEach(function (s) {
        if (!s.n) return;
        rx.lastIndex = 0;
        var n2 = s.n.replace(rx, st.repl);
        if (n2 !== s.n && C.setNotes(w, s.id, n2, now)) k++;
      });
    }
    return k;
  }

  // ---------- 5. For the Assistant ----------
  // The stored data as a list of documents: { docs: [{ id, name, m }] }
  // plus the store itself (preview reads it; each doc's `store`, for
  // outline, is the same).
  function view(data) {
    if (!data || typeof data !== "object" || !data.decks || !data.slides || !data.items) return { docs: [], data: null };
    var d = C.canonical(data);
    return { docs: C.deckList(d).map(function (x) {
      var o = { id: x.id, name: x.t || "", m: Math.max(x.m, x.tm) };
      Object.defineProperty(o, "store", { value: d });   // for outline(), not copied
      return o;
    }), data: d };
  }
  // Which presentations a request is for. data: view(), open: the open
  // (or last opened) presentation's id. designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "new presentations come from an outline (create_entry kind slides); use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Slides has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no presentations in Slides yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the presentation's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no presentation is called " + JSON.stringify(String(name).slice(0, 80)) + "; presentations: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several presentations match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no presentation is open in Slides; name the presentation (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] }, src = data && data.data;
    if (!src) return out;
    ids.forEach(function (id) {
      var w = part(src, id);
      if (!w) return;
      var k = 0, env = { now: 1, notes: out.notes };
      steps.forEach(function (st) { k += apply(w, id, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: w.decks[id].t || "", n: k }); }
    });
    return out;
  }
  // A presentation for the model: size, theme, footer and per slide its
  // layout, notes and objects (texts in full up to a limit, no picture data).
  var OUT_SLIDES = 120, OUT_TEXT = 600;
  function short(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }
  function outline(doc) {
    var src = doc && doc.store, d = src ? src.decks[doc.id] : null;
    if (!d) return null;
    var list = C.deckSlides(src, d.id), o = {
      name: d.t || "", aspect: d.as, size: C.widthOf(d.as) + " × " + C.H + " slide units", theme: d.th,
      footer: { text: d.ft.x, numbers: d.ft.n, date: d.ft.d }, slides: []
    };
    list.slice(0, OUT_SLIDES).forEach(function (s, i) {
      var e = { slide: i + 1, layout: s.ly };
      if (s.hid) e.hidden = true;
      if (s.tr !== "none") e.transition = s.tr;
      if (s.bg) e.bg = s.bg;
      if (s.n) e.notes = short(s.n, OUT_TEXT);
      e.objects = C.slideItems(src, s.id).map(function (it) {
        var x = { id: it.id, kind: it.k === "image" ? "photo" : it.k, x: it.x, y: it.y, w: it.w, h: it.h };
        if (it.ph) x.place = it.ph;
        if (it.lk) x.locked = true;
        if (it.r) x.rot = it.r;
        if (it.op !== undefined) x.opacity = it.op;
        if (it.fill) x.fill = it.fill;
        if (it.st) { x.stroke = it.st; x.sw = it.sw; }
        if (it.an) { x.anim = it.an.e; if (it.an.d) x.side = it.an.d; if (it.an.w) x.start = it.an.w; }
        if (it.k === "text") {
          x.text = short(C.itemText(it), OUT_TEXT); x.size = it.fs; x.c = it.fc; x.align = it.al;
          if (it.ff) x.font = it.ff;
        } else if (it.k === "image") {
          if (!it.img) x.empty = true; else { x.fit = it.img.fit; if (it.img.alt) x.alt = it.img.alt; }
        } else if (it.k === "shape") x.shape = it.sh;
        else if (it.k === "table") x.text = short(it.tb.rows.map(function (r) { return r.join(" | "); }).join("\n"), OUT_TEXT);
        else if (it.k === "chart") { x.chart = it.ch.t; if (it.ch.ttl) x.text = it.ch.ttl; }
        return x;
      });
      o.slides.push(e);
    });
    if (list.length > OUT_SLIDES) o.note = "Only the first " + OUT_SLIDES + " slides are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, WHAT: WHAT,
    check: check, part: part, pick: pick, pageSet: pageSet, apply: apply, view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.SlidesCommands = api;
})(typeof window !== "undefined" ? window : this);
