// ============================================================
// orOS Atelier — commands.js: what the Assistant may change in a
// design (AS-EDIT, wave AC1, v1.0.0)
// A fixed catalog of commands, in the step format of the automations
// (recipes/core.js specs): the Assistant never writes code or raw
// data, it sends { op, …fields } that check() accepts. The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the designs it
//     is for (targets), count what it would change on copies of the
//     stored designs (preview) and describe a design to the AI
//     (outline, with the user's consent);
//   - in Atelier (assist.js), which applies it to the designs.
// Element commands pick elements with the same four fields:
//   ids    element ids from read_design (comma separated)
//   pages  "" (all) | odd | even | first | last | "2-4,6" (1 = first)
//   what   "" (every element but page backgrounds) | text | photo |
//          video | shape | icon | line | table | chart | bg
//   has    words in the text, or in a photo's file name
//   Locked elements are moved, aligned or removed only when named
//   by id. Lengths are in the design's unit (px, or mm for print).
// Unset fields (null, "") leave things as they are, so a command
// stamps only what it changes (R27) and the same list twice changes
// nothing more.
// apply(doc, step, env) edits a copy of a design in place and returns
// how many elements, pages or settings changed. env: { now, newId,
// normItem, textHeight, addBackground, notes[] }; without the helpers
// (the Assistant's preview) it still counts.
// Pure: no DOM. Exposes window.AtelierCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var R = typeof module !== "undefined" && module.exports ? require("../recipes/core.js") : root.orosRecipes;

  // Copies of designkit/fx.js and atelier/ax.js lists (a test keeps
  // them equal), so the Assistant loads nothing else.
  var FILTERS = ["none", "vivid", "warm", "cool", "aegean", "summer", "mono", "noir", "sepia", "vintage", "faded", "drama", "soft"];
  var SHAPES = ["rect", "rounded", "circle", "triangle", "rtriangle", "diamond", "pentagon", "hexagon", "octagon", "star", "burst",
                "heart", "cross", "arrow", "chevron", "parallelogram", "trapezoid", "arch", "drop", "shield", "bubble"];
  var EFFECTS = ["none", "shadow", "lift", "hollow", "outline", "splice", "echo", "glitch", "neon", "background"];
  var ADJ = ["bright", "contrast", "sat", "warmth", "tint", "fade", "sepia", "vignette", "blur", "sharpen"];
  var POS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  var WHAT = ["", "text", "photo", "video", "shape", "icon", "line", "table", "chart", "bg"];
  var TEXT_DEF = { font: "sans", size: 48, lh: 120, al: "l" }, TABLE_SIZE = 24, RD_DEF = 30, MAX_PAGES = 999;
  var PT_PER = { mm: 72 / 25.4, in: 72, pt: 1 };

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
  var PHOTO = { flt: oneOf([""].concat(FILTERS)) };
  ADJ.forEach(function (k) { PHOTO[k] = /^(fade|sepia|vignette|blur|sharpen)$/.test(k) ? int(0, 100) : int(-100, 100); });
  PHOTO.fit = oneOf(["", "fit", "fill"]);
  PHOTO.shape = oneOf([""].concat(SHAPES));
  PHOTO.round = int(0, 100);
  PHOTO.flip = oneOf(["", "h", "v", "none"]);

  // kind: "doc" (edits the design here), "async" (Atelier runs it on
  // the device: background removal)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 5000, req: 1 } }) },
    textstyle: { kind: "doc", args: sel({ font: { t: "font" }, size: num(2, 2000), c: { t: "color" }, bold: ONOFF, ital: ONOFF, under: ONOFF, caps: ONOFF,
      align: oneOf(["", "l", "c", "r", "j"]), lh: int(70, 300), track: int(-200, 1000), effect: oneOf([""].concat(EFFECTS)), curve: int(-100, 100) }) },
    recolor: { kind: "doc", args: sel({ from: { t: "color", req: 1 }, to: { t: "color", req: 1 } }) },
    colors: { kind: "doc", args: sel({ fill: { t: "color" }, grad: { t: "color" }, ang: int(-360, 360), stroke: { t: "color" }, sw: num(0, 200) }) },
    photo: { kind: "doc", args: sel(PHOTO) },
    cutout: { kind: "async", args: sel({}) },
    place: { kind: "doc", args: sel({ x: num(-20000, 20000), y: num(-20000, 20000), w: num(0.5, 20000), h: num(0.5, 20000),
      dx: num(-20000, 20000), dy: num(-20000, 20000), pct: num(1, 1000), rot: num(-360, 360), opacity: int(0, 100),
      pos: oneOf([""].concat(POS)), gap: num(0, 5000) }) },
    align: { kind: "doc", args: sel({ edge: oneOf(["", "l", "c", "r", "t", "m", "b"]), dist: oneOf(["", "h", "v"]), rel: oneOf(["sel", "page"]) }) },
    arrange: { kind: "doc", args: sel({ order: oneOf(["", "front", "back", "forward", "backward"]), lock: ONOFF, hide: ONOFF }) },
    remove: { kind: "doc", args: sel({}) },
    pages: { kind: "doc", args: { n: { t: "int", lo: 1, hi: 100, def: 1, req: 1 }, at: oneOf(["end", "before", "after"]),
      page: { t: "int", lo: 0, hi: 9999, def: 0 }, dup: { t: "bool", def: 0 } } },
    delpages: { kind: "doc", args: { first: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, last: { t: "int", lo: 0, hi: 9999, def: 0 } } },
    movepage: { kind: "doc", args: { page: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, dest: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 } } },
    bg: { kind: "doc", args: { pages: SEL.pages, fill: { t: "color" }, grad: { t: "color" }, ang: int(-360, 360) } },
    bleed: { kind: "doc", args: { mm: { t: "num", lo: 0, hi: 25, def: 3, req: 1 } } },
    rename: { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;
  // Commands that pick elements: the ones that remove need a pick.
  function picks(op) { return !!(CATALOG[op] && CATALOG[op].args.what); }

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Atelier commands (elements are picked with ids, pages, what, has as described above; null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in texts and tables (cs = match case, word = whole words; repl \"\" removes)",
    "settext: the whole text of the picked text elements becomes `text` (pick them by ids)",
    "textstyle: font (sans|serif|mono or a Fontsource id like fs_open_sans), size (pt), c (text colour #rrggbb), bold, ital, under, caps (on|off), align l|c|r|j, lh (line height % 70-300), track (letter spacing 1/1000 em), effect " + EFFECTS.join("|") + ", curve (-100..100, 0 = straight)",
    "recolor: every fill, outline, gradient end and table colour that is `from` becomes `to`",
    "colors: fill (a shape's fill, a text's colour, an icon's or line's colour), grad (second colour: a gradient from fill to grad at angle ang), stroke (outline colour), sw (outline width)",
    "photo: flt filter " + FILTERS.join("|") + " (mono = black and white), sliders " + ADJ.join(", ") + " (integers; fade, sepia, vignette, blur, sharpen 0..100, the rest -100..100), fit fit|fill, shape (the photo's mask " + SHAPES.join("|") + "), round (corners 0-100), flip h|v|none",
    "cutout: remove the background of the picked photos, on the device",
    "place: x, y (position of the top-left corner), w, h (size; a photo keeps its proportions when only one is given), dx, dy (move by), pct (scale %), rot (degrees), opacity (0-100), pos tl|t|tr|l|c|r|bl|b|br (against the page, gap from its edges)",
    "align: edge l|c|r|t|m|b and/or dist h|v (spread out evenly), rel sel (against each other) | page",
    "arrange: order front|back|forward|backward, lock on|off, hide on|off",
    "remove: delete the picked elements (needs ids, what, has or pages)",
    "pages: add n pages (1-100) at the end, or before | after page `page` (1 = first); dup true = copies of that page (else blank, with its background colour)",
    "delpages: remove pages first..last (last 0 = only first) with everything on them; at least one page stays",
    "movepage: page `page` moves to position `dest`",
    "bg: the page background of `pages`: fill colour, grad (gradient end), ang",
    "bleed: the bleed in mm (print designs only)",
    "rename: the design's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var PAGES_RX = /^\s*(|all|odd|even|first|last|\d{1,4}(\s*-\s*\d{1,4})?(\s*,\s*\d{1,4}(\s*-\s*\d{1,4})?)*)\s*$/i;
  function okPages(s) { return typeof s !== "string" || PAGES_RX.test(s); }
  // The 0-based page positions `spec` names in a design of `count` pages.
  function pageSet(spec, count) {
    var s = String(spec || "").trim().toLowerCase(), out = {};
    if (!PAGES_RX.test(s)) return null;
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
          ((spec.t === "color" || spec.t === "font") && raw[k] !== "" && !v)) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.pages === "string" && !okPages(raw.pages)) bad.push("pages " + JSON.stringify(raw.pages) + " is not a page list");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (raw.op === "remove" && !given(st.ids) && !given(st.pages) && !given(st.what) && !given(st.has)) return { err: "remove: pick the elements with ids, what, has or pages" };
    if (raw.op === "align" && !st.edge && !st.dist) return { err: "align: give edge or dist" };
    if (raw.op === "bg" && !st.fill && !st.grad) return { err: "bg: give fill or grad" };
    return { step: st };
  }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
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

  // ---------- 2. Picking elements ----------
  function byPos(a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function pagesOf(doc) { return (doc.pages || []).slice().sort(byPos); }
  function kindOf(it) {
    var ax = it.ax;
    if (!ax) return "";
    if (ax.bg) return "bg";
    if (ax.k === "photo" && ax.vid) return "video";
    return ax.k;
  }
  function textOf(it) {
    var ax = it.ax || {};
    if (ax.k === "text") return ax.tx || "";
    if (ax.k === "table" && ax.tb && Array.isArray(ax.tb.rows)) return ax.tb.rows.map(function (r) { return (r || []).join(" "); }).join(" ");
    if (ax.k === "photo") return it.nm || "";
    return "";
  }
  function idList(s) { return String(s || "").split(/[\s,]+/).filter(Boolean); }
  // The elements a command picks, in page and stacking order.
  function pick(doc, st) {
    var pages = pagesOf(doc), set = pageSet(st.pages, pages.length) || {}, on = {};
    pages.forEach(function (p, i) { if (set[i]) on[p.id] = i + 1; });
    var ids = idList(st.ids), idSet = {};
    ids.forEach(function (id) { idSet[id] = 1; });
    var has = String(st.has || "").toLowerCase();
    var out = doc.items.filter(function (it) {
      if (!it.ax || !on[it.pg]) return false;
      if (ids.length && !idSet[it.id]) return false;
      var k = kindOf(it);
      if (st.what ? k !== st.what : k === "bg") return false;
      if (has && textOf(it).toLowerCase().indexOf(has) < 0) return false;
      return true;
    });
    out.sort(function (a, b) { return on[a.pg] - on[b.pg] || a.z - b.z || (a.id < b.id ? -1 : 1); });
    return out;
  }
  // A locked element is moved or removed only when named by id.
  function movable(it, st) { return !it.lock || idList(st.ids).indexOf(it.id) >= 0; }

  // ---------- 3. Applying ----------
  function r2(v) { return Math.round(v * 100) / 100; }
  function toPt(doc, v) { return v * (PT_PER[doc.setup && doc.setup.unit] || 1); }
  function lc(c) { return typeof c === "string" ? c.toLowerCase() : c; }
  function setOpt(o, k, v, def) { if (v === def || v === undefined) delete o[k]; else o[k] = v; }
  function flag(o, k, v) { if (v === "on") o[k] = 1; else if (v === "off") delete o[k]; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function swap(s, rx, repl) {
    if (typeof s !== "string" || !s) return s;
    return s.replace(rx, function () { return repl; }).slice(0, 5000);
  }
  function stamp(ent, nw) { ent.m = Math.max(nw, (ent.m || 0) + 1); }
  function newId(env, pre) {
    if (env.newId) return env.newId(pre);
    return pre + "-" + Math.random().toString(36).slice(2, 14);
  }

  function editItem(it, st, doc) {
    var ax = it.ax, k = ax.k, p;
    switch (st.op) {
      case "replace": {
        var rx = finder(st);
        if (k === "text") ax.tx = swap(ax.tx, rx, st.repl);
        if (k === "table" && ax.tb && Array.isArray(ax.tb.rows)) {
          ax.tb.rows = ax.tb.rows.map(function (r) { return (r || []).map(function (c) { return swap(c, rx, st.repl); }); });
        }
        break;
      }
      case "settext":
        if (k === "text") ax.tx = st.text;
        break;
      case "textstyle":
        if (k !== "text" && k !== "table") break;
        if (st.font) setOpt(ax, "font", st.font, k === "table" ? TEXT_DEF.font : undefined);
        if (st.size !== null) setOpt(ax, "size", st.size, k === "table" ? TABLE_SIZE : undefined);
        if (st.c) ax.fc = st.c;
        if (st.align) {
          if (k === "text") setOpt(ax, "al", st.align, TEXT_DEF.al);
          else if (st.align !== "j") setOpt(ax, "al", st.align, "l");
        }
        if (k === "text") {
          flag(ax, "b", st.bold); flag(ax, "i", st.ital); flag(ax, "u", st.under); flag(ax, "caps", st.caps);
          if (st.lh !== null) setOpt(ax, "lh", st.lh, TEXT_DEF.lh);
          if (st.track !== null) setOpt(ax, "tr", st.track, 0);
          if (st.curve !== null) setOpt(ax, "cv", st.curve, 0);
          if (st.effect === "none") delete ax.tfx;
          else if (st.effect) {
            var tfx = ax.tfx && typeof ax.tfx === "object" ? JSON.parse(JSON.stringify(ax.tfx)) : {};
            tfx.type = st.effect;
            ax.tfx = tfx;
          }
        }
        break;
      case "recolor":
        ["fc", "sc"].forEach(function (f) { if (lc(ax[f]) === st.from) ax[f] = st.to; });
        if (ax.g) ["a", "b"].forEach(function (f) { if (lc(ax.g[f]) === st.from) ax.g[f] = st.to; });
        if (ax.tb) ["ac", "bf", "cf"].forEach(function (f) { if (lc(ax.tb[f]) === st.from) ax.tb[f] = st.to; });
        if (ax.tfx && lc(ax.tfx.color) === st.from) ax.tfx.color = st.to;
        break;
      case "colors":
        if (st.fill) {
          if (k === "icon" || k === "line") ax.sc = st.fill;
          else if (k !== "photo") ax.fc = st.fill;
        }
        if (k === "shape") {
          if (st.grad) ax.g = { a: st.fill || ax.fc || (ax.g && ax.g.a) || "#000000", b: st.grad, ang: st.ang !== null ? st.ang : ax.g ? ax.g.ang : 90 };
          else if (st.fill) delete ax.g;
          else if (st.ang !== null && ax.g) ax.g.ang = st.ang;
        }
        if (st.stroke && (k === "shape" || k === "table")) ax.sc = st.stroke;
        if (st.sw !== null && k !== "photo" && k !== "text") it.sw = st.sw;
        break;
      case "photo":
        if (k !== "photo") break;
        if (st.flt) setOpt(ax, "flt", st.flt, "none");
        var adj = ax.adj && typeof ax.adj === "object" ? JSON.parse(JSON.stringify(ax.adj)) : {}, any = false;
        ADJ.forEach(function (a) { if (st[a] !== null && st[a] !== undefined) { adj[a] = st[a]; any = true; } });
        if (any) {
          if (ADJ.every(function (a) { return !adj[a]; })) delete ax.adj;
          else ax.adj = adj;
        }
        if (st.fit) it.fit = st.fit;
        if (st.shape) setOpt(ax, "shp", st.shape, "rect");
        if (st.round !== null) setOpt(ax, "rd", st.round, RD_DEF);
        if (st.flip === "h") ax.flh = 1;
        else if (st.flip === "v") ax.flv = 1;
        else if (st.flip === "none") { delete ax.flh; delete ax.flv; }
        break;
      case "place": {
        if (!movable(it, st) || ax.bg) break;
        var W = doc.setup.w, H = doc.setup.h, ow = it.w, oh = it.h;
        if (st.pct !== null) {
          p = st.pct / 100;
          var cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          it.w = r2(it.w * p); it.h = r2(it.h * p);
          it.x = r2(cx - it.w / 2); it.y = r2(cy - it.h / 2);
          if (k === "text" || k === "table" || k === "chart") ax.size = r2(Math.min(2000, Math.max(2, (ax.size || (k === "table" ? TABLE_SIZE : k === "chart" ? 12 : TEXT_DEF.size)) * p)));
        }
        if (st.w !== null) {
          it.w = r2(toPt(doc, st.w));
          if (st.h === null && (k === "photo" || k === "icon") && ow) it.h = r2(oh * it.w / ow);
        }
        if (st.h !== null && k !== "text") {
          it.h = r2(toPt(doc, st.h));
          if (st.w === null && (k === "photo" || k === "icon") && oh) it.w = r2(ow * it.h / oh);
        }
        if (st.x !== null) it.x = r2(toPt(doc, st.x));
        if (st.y !== null) it.y = r2(toPt(doc, st.y));
        if (st.dx !== null) it.x = r2(it.x + toPt(doc, st.dx));
        if (st.dy !== null) it.y = r2(it.y + toPt(doc, st.dy));
        if (st.pos) {
          var g = st.gap !== null ? toPt(doc, st.gap) : 0, ps = st.pos;
          it.x = r2(/l$/.test(ps) ? g : /r$/.test(ps) ? W - it.w - g : (W - it.w) / 2);
          it.y = r2(/^t/.test(ps) ? g : /^b/.test(ps) ? H - it.h - g : (H - it.h) / 2);
        }
        if (st.rot !== null) it.rot = st.rot;
        if (st.opacity !== null) it.op = st.opacity;
        break;
      }
      case "arrange":
        if (st.lock) { if (st.lock === "on") it.lock = 1; else it.lock = 0; }
        if (st.hide) { if (st.hide === "on") it.hide = 1; else it.hide = 0; }
        break;
    }
  }

  // Stacking order on one page (page backgrounds stay at the bottom).
  function arrange(doc, list, order) {
    var byPg = {};
    list.forEach(function (it) { if (!it.ax.bg) (byPg[it.pg] = byPg[it.pg] || []).push(it); });
    Object.keys(byPg).forEach(function (pg) {
      var mine = byPg[pg], ids = {};
      mine.forEach(function (it) { ids[it.id] = 1; });
      var others = doc.items.filter(function (it) { return it.pg === pg && !ids[it.id] && !(it.ax && it.ax.bg); }).sort(function (a, b) { return a.z - b.z; });
      if (order === "front" || order === "back") {
        var top = others.length ? others[others.length - 1].z : 0, low = others.length ? others[0].z : 1;
        mine.forEach(function (it, i) { it.z = order === "front" ? top + 1 + i : low - mine.length + i; });
        return;
      }
      mine.forEach(function (it) {
        var all = doc.items.filter(function (x) { return x.pg === pg && !(x.ax && x.ax.bg); }).sort(function (a, b) { return a.z - b.z || (a.id < b.id ? -1 : 1); });
        var i = all.indexOf(it);
        if (order === "forward" && i < all.length - 1) it.z = i + 2 < all.length ? r2((all[i + 1].z + all[i + 2].z) / 2) : all[i + 1].z + 1;
        if (order === "backward" && i > 0) it.z = i - 2 >= 0 ? r2((all[i - 1].z + all[i - 2].z) / 2) : all[i - 1].z - 1;
      });
    });
  }
  function alignAll(doc, list, st) {
    var W = doc.setup.w, H = doc.setup.h, byPg = {};
    list.forEach(function (it) { if (!it.ax.bg && movable(it, st)) (byPg[it.pg] = byPg[it.pg] || []).push(it); });
    Object.keys(byPg).forEach(function (pg) {
      var L = byPg[pg];
      if (st.rel === "sel" && L.length < 2) return;
      var x0 = st.rel === "page" ? 0 : Math.min.apply(null, L.map(function (it) { return it.x; }));
      var x1 = st.rel === "page" ? W : Math.max.apply(null, L.map(function (it) { return it.x + it.w; }));
      var y0 = st.rel === "page" ? 0 : Math.min.apply(null, L.map(function (it) { return it.y; }));
      var y1 = st.rel === "page" ? H : Math.max.apply(null, L.map(function (it) { return it.y + it.h; }));
      L.forEach(function (it) {
        if (st.edge === "l") it.x = r2(x0);
        if (st.edge === "c") it.x = r2((x0 + x1 - it.w) / 2);
        if (st.edge === "r") it.x = r2(x1 - it.w);
        if (st.edge === "t") it.y = r2(y0);
        if (st.edge === "m") it.y = r2((y0 + y1 - it.h) / 2);
        if (st.edge === "b") it.y = r2(y1 - it.h);
      });
      if (st.dist && L.length >= (st.rel === "page" ? 1 : 3)) {
        var h = st.dist === "h", s = L.slice().sort(function (a, b) { return h ? a.x - b.x : a.y - b.y; });
        var size = s.reduce(function (n, it) { return n + (h ? it.w : it.h); }, 0);
        var from = st.rel === "page" ? (h ? 0 : 0) : h ? s[0].x : s[0].y;
        var to = st.rel === "page" ? (h ? W : H) : h ? s[s.length - 1].x + s[s.length - 1].w : s[s.length - 1].y + s[s.length - 1].h;
        var gap = st.rel === "page" ? (to - from - size) / (s.length + 1) : (to - from - size) / (s.length - 1);
        var at = st.rel === "page" ? from + gap : from;
        s.forEach(function (it) {
          if (h) it.x = r2(at); else it.y = r2(at);
          at += (h ? it.w : it.h) + gap;
        });
      }
    });
  }

  function newPagePos(pages, idx) {
    var cur = pages[idx], next = pages[idx + 1];
    return cur ? (next ? (cur.pos + next.pos) / 2 : cur.pos + 1024) : 0;
  }
  function bgOf(doc, pg) {
    for (var i = 0; i < doc.items.length; i++) if (doc.items[i].pg === pg && doc.items[i].ax && doc.items[i].ax.bg) return doc.items[i];
    return null;
  }
  function addBackground(doc, pg, colour, env) {
    if (env.addBackground) return env.addBackground(doc, pg, colour, env.now);
    var b = { id: newId(env, "it"), m: env.now, t: "rect", pg: pg, x: 0, y: 0, w: doc.setup.w, h: doc.setup.h, z: -1e9, lock: 1, ax: { k: "shape", bg: 1, shp: "rect", fc: colour } };
    doc.items.push(b);
    return b;
  }
  function note(env, code) { if (env.notes && env.notes.indexOf(code) < 0) env.notes.push(code); }

  function pageCmd(doc, st, env) {
    var nw = env.now, pages = pagesOf(doc), n = 0;
    switch (st.op) {
      case "pages": {
        var room = MAX_PAGES - pages.length, cnt = Math.min(st.n, room);
        if (cnt < st.n) note(env, "maxPages");
        if (cnt <= 0 || !pages.length) return 0;
        var ref = st.at === "end" ? pages.length - 1 : Math.min(pages.length, Math.max(1, st.page || (st.at === "before" ? 1 : pages.length))) - 1;
        var src = pages[ref];
        var lo = st.at === "before" ? (ref > 0 ? pages[ref - 1].pos : src.pos - 1024) : src.pos;
        var hi = st.at === "before" ? src.pos : (pages[ref + 1] ? pages[ref + 1].pos : src.pos + 1024 * (cnt + 1));
        var srcBg = bgOf(doc, src.id);
        for (var i = 0; i < cnt; i++) {
          var p = { id: newId(env, "pg"), m: nw, pos: lo + (hi - lo) * (i + 1) / (cnt + 1), ms: "" };
          doc.pages.push(p);
          n++;
          if (st.dup) {
            doc.items.filter(function (it) { return it.pg === src.id; }).sort(function (a, b) { return a.z - b.z; }).forEach(function (s) {
              var c = JSON.parse(JSON.stringify(s));
              c.id = newId(env, "it"); c.m = nw; c.pg = p.id;
              var cn = env.normItem ? env.normItem(c) : c;
              if (cn) doc.items.push(cn);
            });
          } else {
            var b = addBackground(doc, p.id, srcBg && srcBg.ax.fc ? srcBg.ax.fc : "#ffffff", env);
            if (b && srcBg && srcBg.ax.g) b.ax.g = JSON.parse(JSON.stringify(srcBg.ax.g));
          }
        }
        return n;
      }
      case "delpages": {
        var a = st.first, z = st.last || st.first, gone = {};
        if (z < a) { var t = a; a = z; z = t; }
        pages.forEach(function (p, i) { if (i + 1 >= a && i + 1 <= z) gone[p.id] = 1; });
        var k = Object.keys(gone).length;
        if (!k) return 0;
        if (k >= pages.length) { note(env, "lastPage"); return 0; }
        doc.items.forEach(function (it) { if (gone[it.pg]) doc.tombs[it.id] = nw; });
        doc.items = doc.items.filter(function (it) { return !gone[it.pg]; });
        doc.pages = doc.pages.filter(function (p) { if (gone[p.id]) { doc.tombs[p.id] = nw; return false; } return true; });
        return k;
      }
      case "movepage": {
        var from = st.page - 1, to = Math.min(pages.length, st.dest) - 1;
        if (from < 0 || from >= pages.length || to < 0 || from === to) return 0;
        var mv = pages[from], rest = pages.filter(function (p) { return p !== mv; });
        var before = rest[to - 1], after = rest[to];
        var pos = !before ? after.pos - 1024 : !after ? before.pos + 1024 : (before.pos + after.pos) / 2;
        var pg = null;
        doc.pages.forEach(function (p) { if (p.id === mv.id) pg = p; });
        pg.pos = pos;
        stamp(pg, nw);
        return 1;
      }
      case "bg": {
        var set = pageSet(st.pages, pages.length) || {};
        pages.forEach(function (p, i) {
          if (!set[i]) return;
          var b = bgOf(doc, p.id);
          if (b && b.ax.k !== "shape") { note(env, "photoBg"); return; }
          if (!b) { b = addBackground(doc, p.id, st.fill || "#ffffff", env); if (!b) return; n++; }
          var before = JSON.stringify(b);
          if (st.fill) b.ax.fc = st.fill;
          if (st.grad) b.ax.g = { a: st.fill || b.ax.fc || "#ffffff", b: st.grad, ang: st.ang !== null ? st.ang : b.ax.g ? b.ax.g.ang : 90 };
          else if (st.fill) delete b.ax.g;
          if (JSON.stringify(b) !== before) { stamp(b, nw); n++; }
        });
        return n;
      }
      case "bleed": {
        if (!doc.setup || doc.setup.unit !== "mm") { note(env, "screenBleed"); return 0; }
        var v = r2(st.mm * PT_PER.mm);
        if (Math.abs((doc.setup.bleed || 0) - v) < 0.01) return 0;
        doc.setup.bleed = v;
        stamp(doc, nw);
        return 1;
      }
      case "rename":
        if (doc.name === st.title) return 0;
        doc.name = st.title;
        stamp(doc, nw);
        return 1;
    }
    return 0;
  }

  // One command on a copy of a design → how many things changed.
  function apply(doc, st, env) {
    env = env || {};
    if (!env.now) env.now = Date.now();
    var nw = env.now;
    if (!doc.tombs) doc.tombs = {};
    if (!picks(st.op)) return pageCmd(doc, st, env);
    var list = pick(doc, st);
    if (st.op === "cutout") {
      return list.filter(function (it) { return it.ax.k === "photo" && !it.ax.vid && it.a && !/-cutout\.png$/i.test(it.nm || ""); }).length;
    }
    if (st.op === "remove") {
      var gone = {};
      list.forEach(function (it) { if (movable(it, st)) gone[it.id] = 1; });
      var k = Object.keys(gone).length;
      if (k) {
        doc.items = doc.items.filter(function (it) { if (gone[it.id]) { doc.tombs[it.id] = nw; return false; } return true; });
      }
      if (k < list.length) note(env, "locked");
      return k;
    }
    var before = {};
    list.forEach(function (it) { before[it.id] = JSON.stringify(it); });
    if (st.op === "arrange" && st.order) arrange(doc, list, st.order);
    if (st.op === "align") alignAll(doc, list, st);
    else list.forEach(function (it) { editItem(it, st, doc); });
    var n = 0;
    list.forEach(function (it) {
      if (JSON.stringify(it) === before[it.id]) return;
      if (it.ax.k === "text" && env.textHeight && st.op !== "place" && st.op !== "align" && st.op !== "arrange") it.h = env.textHeight(it);
      else if (it.ax.k === "text" && env.textHeight && st.op === "place" && (st.pct !== null || st.w !== null)) it.h = env.textHeight(it);
      stamp(it, nw);
      n++;
    });
    return n;
  }

  // ---------- 4. For the Assistant ----------
  // Which designs a request is for. data: the stored Atelier data,
  // folders: the folder record, open: the id of the open (or last
  // opened) design. designs: open | named | folder | all; name: the
  // design's or folder's name.
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (!docs.length) return { ok: false, err: "the user has no designs in Atelier yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the design's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no design is called " + JSON.stringify(String(name).slice(0, 80)) + "; designs: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several designs match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else if (designs === "folder") {
      var fq = norm(name), f = null;
      (folders && Array.isArray(folders.folders) ? folders.folders : []).forEach(function (x) { if (!f && norm(x.nm) === fq) f = x; });
      if (!f) return { ok: false, err: "no folder is called " + JSON.stringify(String(name || "").slice(0, 80)) };
      var place = folders.place || {};
      list = docs.filter(function (d) { return place[d.id] && place[d.id].f === f.id; });
      if (!list.length) return { ok: false, err: "the folder " + JSON.stringify(f.nm) + " is empty" };
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no design is open in Atelier; name the design (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut (photos for background removal), notes[] }
  function preview(data, ids, steps) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [], out = { n: 0, d: 0, per: [], cut: 0, notes: [] };
    ids.forEach(function (id) {
      var src = null;
      docs.forEach(function (d) { if (d.id === id) src = d; });
      if (!src) return;
      var w = JSON.parse(JSON.stringify(src)), k = 0, env = { now: 1, notes: out.notes };
      steps.forEach(function (st) {
        if (CATALOG[st.op].kind === "async") { out.cut += apply(w, st, env); return; }
        k += apply(w, st, env);
      });
      out.n += k;
      if (k) out.d++;
      out.per.push({ id: id, name: src.name || "", n: k });
    });
    return out;
  }
  // A design for the AI: its pages and elements, without file data.
  var OUT_ITEMS = 300, OUT_TEXT = 300;
  function unitOf(doc) { return doc.setup && doc.setup.unit === "mm" ? "mm" : "px"; }
  function inUnit(doc, v) { return r2(v / (PT_PER[doc.setup && doc.setup.unit] || 1)); }
  function outline(doc) {
    var pages = pagesOf(doc), n = 0, cut = false;
    var o = { name: doc.name || "", size: inUnit(doc, doc.setup.w) + " × " + inUnit(doc, doc.setup.h) + " " + unitOf(doc), pages: [] };
    if (unitOf(doc) === "mm") o.bleed_mm = r2((doc.setup.bleed || 0) / PT_PER.mm);
    pages.forEach(function (p, i) {
      var pg = { page: i + 1, elements: [] }, b = bgOf(doc, p.id);
      if (b) {
        if (b.ax.k === "photo") pg.background = "photo " + (b.nm || "");
        else pg.background = b.ax.g ? "gradient " + b.ax.g.a + " → " + b.ax.g.b : b.ax.fc || "";
      }
      doc.items.filter(function (it) { return it.pg === p.id && it.ax && !it.ax.bg; }).sort(function (a, b2) { return a.z - b2.z; }).forEach(function (it) {
        if (n >= OUT_ITEMS) { cut = true; return; }
        n++;
        var ax = it.ax, e = { id: it.id, what: kindOf(it), x: inUnit(doc, it.x), y: inUnit(doc, it.y), w: inUnit(doc, it.w), h: inUnit(doc, it.h) };
        if (it.rot) e.rot = it.rot;
        if (it.op !== undefined && it.op !== 100) e.opacity = it.op;
        if (it.lock) e.locked = true;
        if (it.hide) e.hidden = true;
        var tx = textOf(it);
        if (ax.k === "text" || ax.k === "table") {
          e.text = tx.length > OUT_TEXT ? tx.slice(0, OUT_TEXT) + "…" : tx;
          e.font = ax.font || TEXT_DEF.font;
          e.size = ax.size || (ax.k === "table" ? TABLE_SIZE : TEXT_DEF.size);
          if (ax.fc) e.color = ax.fc;
          if (ax.b) e.bold = true;
          if (ax.i) e.italic = true;
          if (ax.al && ax.al !== "l") e.align = ax.al;
          if (ax.tfx && ax.tfx.type) e.effect = ax.tfx.type;
        }
        if (ax.k === "photo") {
          if (it.nm) e.file = it.nm;
          if (ax.flt) e.filter = ax.flt;
          if (ax.shp) e.shape = ax.shp;
        }
        if (ax.k === "shape") {
          e.shape = ax.shp || "rect";
          if (ax.fc) e.fill = ax.fc;
          if (ax.g) e.gradient = ax.g.a + " → " + ax.g.b;
        }
        if ((ax.k === "icon" || ax.k === "line") && ax.sc) e.color = ax.sc;
        if (ax.an) e.animation = ax.an;
        pg.elements.push(e);
      });
      o.pages.push(pg);
    });
    if (cut) o.note = "Only the first " + OUT_ITEMS + " elements are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, FILTERS: FILTERS, SHAPES: SHAPES, EFFECTS: EFFECTS, ADJ: ADJ, WHAT: WHAT, POS: POS,
    check: check, pageSet: pageSet, pick: pick, apply: apply, targets: targets, preview: preview, outline: outline, picks: picks
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierCommands = api;
})(typeof window !== "undefined" ? window : this);
