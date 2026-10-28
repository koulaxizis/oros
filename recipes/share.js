// ============================================================
// orOS recipes — share.js: automations that travel (wave A3, v1.0.0)
// An automation can leave the app it was made in two ways, and both
// carry DATA only, checked again where it lands:
// - a .orosrecipe file (Automations › Share / Import): plain JSON
//     { "format": "orosrecipe", "ver": 1, "app", "name", "steps": [...] }
//   read with unpack(): at most 64 KB, steps kept as plain JSON
//   (recipes/core.js normRecipe), so a file from a newer orOS keeps
//   the steps this one cannot run, and they are skipped;
// - a draft from the Assistant (propose_automation) or from another
//   app (an import of a file made for that app): the deep link
//     __orosOpenAt(app, { newRecipe: { app, nm, steps } })
//   opens the app's editor with the steps filled in. Nothing is saved
//   and nothing runs before the person presses Save and then Run.
// CATALOGS is a copy of the three apps' step catalogs (atelier/,
// layout/, photolab/recipesteps.js), so the Assistant can check a
// draft without loading the apps' editing code; tests/recipes-share
// keeps the copies equal to the originals.
// prepare() turns draft steps into editor steps: numbers written as
// text are read as numbers, a step whose fields do not all pass keeps
// the ones that do (the editor marks it), unknown steps stay as they
// are. problems() says in English what is wrong, for the model.
// words() gives a step's name and detail in the person's language.
// Pure: no DOM. Exposes window.orosRecipeShare (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var R = typeof module !== "undefined" && module.exports ? require("./core.js") : root.orosRecipes;
  var FORMAT = "orosrecipe", VER = 1, EXT = ".orosrecipe", MIME = "application/x-oros-recipe", MAX_FILE = 64 * 1024;
  var APPS = ["atelier", "layout", "photolab"];

  // ---------- 1. The catalogs (copies) ----------
  var FILTERS = ["none", "vivid", "warm", "cool", "aegean", "summer", "mono", "noir", "sepia", "vintage", "faded", "drama", "soft"];
  var LOOKS = FILTERS.slice(1);
  var RATIOS = ["1:1", "4:5", "5:4", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];
  var POS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  var TEXT = { find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } };
  var MM = { t: "num", lo: 0, hi: 500, def: 15, req: 1 };
  var PAGES = { t: "str", max: 60 }, ONOFF = { t: "enum", v: ["", "on", "off"], def: "" }, PT = { t: "num", lo: -1, hi: 1000, def: -1 };
  function slider(lo) { return { t: "int", lo: lo, hi: 100, def: 0 }; }
  var CATALOGS = {
    atelier: {
      text: { kind: "doc", args: TEXT },
      color: { kind: "doc", args: { from: { t: "color", req: 1 }, to: { t: "color", req: 1 } } },
      font: { kind: "doc", args: { from: { t: "font" }, to: { t: "font", req: 1 } } },
      size: { kind: "doc", args: { pct: { t: "num", lo: 10, hi: 1000, def: 100, req: 1 } } },
      filter: { kind: "doc", args: { flt: { t: "enum", v: FILTERS, def: "none" } } },
      center: { kind: "doc", args: { what: { t: "enum", v: ["text", "all"], def: "text" } } },
      cutout: { kind: "async", args: {} },
      resize: { kind: "async", args: { sizes: { t: "list", min: 1, max: 12, of: { t: "obj", f: {
        w: { t: "num", lo: 1, hi: 20000, req: 1 }, h: { t: "num", lo: 1, hi: 20000, req: 1 },
        u: { t: "enum", v: ["px", "mm"], def: "px" }, p: { t: "str", max: 40 } } } }, copies: { t: "bool", def: 1 } } },
      export: { kind: "out", args: { fmt: { t: "enum", v: ["png", "jpg", "pdf"], def: "png" }, scale: { t: "enum", v: [1, 2, 3], def: 1 }, dpi: { t: "enum", v: [150, 300], def: 300 } } }
    },
    layout: {
      text: { kind: "doc", args: TEXT },
      pstyle: { kind: "doc", args: { from: { t: "str", max: 80 }, to: { t: "str", max: 80, req: 1 } } },
      style: { kind: "doc", args: { name: { t: "str", max: 80, req: 1 }, size: { t: "num", lo: 0, hi: 400, def: 0 }, lead: { t: "num", lo: 0, hi: 500, def: 0 },
        font: { t: "enum", v: ["", "serif", "sans", "mono"], def: "" }, align: { t: "enum", v: ["", "l", "c", "r", "j"], def: "" }, track: { t: "num", lo: -500, hi: 2000, def: 0 },
        bold: ONOFF, ital: ONOFF, caps: ONOFF, sb: PT, sa: PT, fi: PT, brk: { t: "enum", v: ["", "any", "col", "page", "odd", "even"], def: "" }, hyph: ONOFF } },
      master: { kind: "doc", args: { ms: { t: "str", max: 80 }, on: { t: "enum", v: ["all", "odd", "even"], def: "all" } } },
      margins: { kind: "doc", args: { t: MM, b: MM, i: MM, o: MM } },
      pages: { kind: "doc", args: { n: { t: "int", lo: 1, hi: 500, def: 1, req: 1 }, at: { t: "enum", v: ["end", "before", "after"], def: "end" },
        page: { t: "int", lo: 0, hi: 9999, def: 0 }, flow: { t: "bool", def: 1 } } },
      delpages: { kind: "doc", args: { first: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, last: { t: "int", lo: 0, hi: 9999, def: 0 } } },
      numbering: { kind: "doc", args: { mode: { t: "enum", v: ["set", "shift"], def: "set" }, n: { t: "int", lo: -9999, hi: 9999, def: 1, req: 1 } } },
      bleed: { kind: "doc", args: { mm: { t: "num", lo: 0, hi: 25, def: 3, req: 1 } } },
      fit: { kind: "doc", args: {} },
      grey: { kind: "async", args: { pages: PAGES } },
      imgfit: { kind: "doc", args: { mode: { t: "enum", v: ["fit", "fill"], def: "fit" }, pages: PAGES } },
      preflight: { kind: "check", args: { stop: { t: "bool", def: 1 } } },
      export: { kind: "out", args: { bleed: { t: "bool", def: 0 }, marks: { t: "bool", def: 0 }, spreads: { t: "bool", def: 0 }, q: { t: "enum", v: ["print", "screen"], def: "print" } } }
    },
    photolab: {
      tone: { kind: "px", args: { bright: slider(-100), contrast: slider(-100), sat: slider(-100), warmth: slider(-100), tint: slider(-100),
        fade: slider(0), sepia: slider(0), vignette: slider(0) } },
      look: { kind: "px", args: { id: { t: "enum", v: LOOKS, def: LOOKS[0] } } },
      gray: { kind: "px", args: {} },
      blur: { kind: "px", args: { r: { t: "num", lo: 0.5, hi: 100, def: 3 } } },
      sharpen: { kind: "px", args: { amt: { t: "int", lo: 1, hi: 500, def: 80 }, r: { t: "num", lo: 0.1, hi: 20, def: 1.5 } } },
      noise: { kind: "px", args: { amt: { t: "int", lo: 1, hi: 100, def: 8 }, mono: { t: "bool", def: 1 } } },
      crop: { kind: "size", args: { ratio: { t: "enum", v: RATIOS, def: "1:1" } } },
      resize: { kind: "size", args: { mode: { t: "enum", v: ["long", "w", "h", "pct"], def: "long" }, v: { t: "int", lo: 1, hi: 8192, def: 2048 }, up: { t: "bool", def: 0 } } },
      watermark: { kind: "px", args: { text: { t: "str", max: 200, req: 1 }, size: { t: "int", lo: 1, hi: 100, def: 5 }, c: { t: "color" },
        pos: { t: "enum", v: POS, def: "br" }, opacity: { t: "int", lo: 5, hi: 100, def: 60 } } },
      export: { kind: "out", args: { fmt: { t: "enum", v: ["jpg", "png", "webp"], def: "jpg" }, q: { t: "int", lo: 10, hi: 100, def: 88 } } }
    }
  };

  // What each step does, for the model (English, short). Every op and
  // every field of CATALOGS is named here (a test checks it).
  var GUIDE = {
    atelier: { what: "Atelier (designs: posters, social posts, cards, slides). A run works on one design, the picked ones or all.", ops: {
      text: "replace words in text boxes and tables: find, repl (\"\" removes), cs (match case), word (whole words)",
      color: "every fill, outline, gradient end and table colour that is `from` becomes `to` (#rrggbb)",
      font: "text in font `from` (\"\" = any font) gets font `to`: sans, serif, mono or an id like fs_open_sans",
      size: "text sizes × pct % (10-1000)",
      filter: "the photo filter of every photo: flt one of " + FILTERS.join("|") + " (none removes it)",
      center: "centre on the page: what text (text boxes) | all (every element)",
      cutout: "remove the background of every photo, on the device (no fields)",
      resize: "sizes: [{ w, h, u px|mm }] (1-12); copies true = a new design in each size (the next steps work on the copies), false = this design takes the first size",
      export: "download every page: fmt png|jpg (scale 1|2|3) or pdf (dpi 150|300)"
    } },
    layout: { what: "Layout (print documents: magazines, books, brochures). A run works on the open document or on every document.", ops: {
      text: "find and replace in every story: find, repl, cs (match case), word (whole words)",
      pstyle: "paragraphs in style `from` (\"\" = any) get style `to`; styles by name, e.g. Body, Heading 1",
      style: "change the paragraph style `name` itself (by name, e.g. Body text): size and lead in pt (0 = unchanged), font serif|sans|mono, align l|c|r|j (\"\" = unchanged), track in 1/1000 em (0 = unchanged), bold, ital, caps (bold, italic, capitals) on|off (\"\" = unchanged), sb, sa (space before, after) and fi (first-line indent) in pt (-1 = unchanged), brk where it starts any|col|page|odd|even (\"\" = unchanged), hyph Greek hyphenation on|off",
      master: "pages `on` all|odd|even get master `ms` (by name, \"\" = none)",
      margins: "page margins in mm: t (top), b (bottom), i (inside), o (outside), each 0-500, all four needed",
      pages: "add n pages (1-500) at the end, or before / after page `page` (its position, 1 = the first page); flow true = text that does not fit runs on into them",
      delpages: "remove the pages from position `first` to `last` (0 = only `first`) with everything on them",
      numbering: "page numbers: mode set = the first page gets number n; shift = every number moves by n (e.g. 2 = two later)",
      bleed: "the bleed in mm (0-25)",
      fit: "text that does not fit runs on into as many new pages as it needs (no fields)",
      grey: "make the pictures on `pages` black and white, on the device: pages \"\" (all), odd, even or positions like 3-10,12",
      imgfit: "the pictures on `pages` (as for grey): mode fit (the whole picture) | fill (the frame filled)",
      preflight: "count the problems; stop true = a document with errors is not exported",
      export: "a PDF of each document: q print (300 ppi) | screen (150 ppi), bleed, marks (crop marks), spreads (true/false)"
    } },
    photolab: { what: "Photo Lab (photos). A run works on the open picture, or from Batch on many photos.", ops: {
      tone: "photo sliders, each an integer: bright, contrast, sat, warmth, tint (-100..100), fade, sepia, vignette (0..100); 0 = unchanged",
      look: "a named look: id one of " + LOOKS.join("|"),
      gray: "black and white (no fields)",
      blur: "Gaussian blur: r radius px 0.5-100",
      sharpen: "unsharp mask: amt % 1-500, r radius px 0.1-20",
      noise: "film grain: amt 1-100, mono true/false",
      crop: "the largest centred part with ratio " + RATIOS.join("|"),
      resize: "mode long (long side) | w | h | pct, v pixels (1-8192) or percent, up true = may enlarge",
      watermark: "text, size (% of the picture 1-100), c colour #rrggbb, pos " + POS.join("|") + " (t = top, b = bottom, l = left, r = right, c = centre), opacity 5-100",
      export: "save to Pictures: fmt jpg|png|webp, q quality 10-100"
    } }
  };

  // The model's text: what may go into propose_automation, per app.
  function forModel(apps) {
    var lines = [];
    (apps || APPS).forEach(function (app) {
      var g = GUIDE[app];
      if (!g) return;
      lines.push(app + ": " + g.what + " Steps: " + Object.keys(g.ops).map(function (op) { return op + " (" + g.ops[op] + ")"; }).join(" · "));
    });
    return lines.join("\n");
  }

  // ---------- 2. Reading steps leniently ----------
  var NUM = /^-?\d+(\.\d+)?$/;
  function coerceVal(spec, v) {
    if (typeof v === "string") {
      var s = v.trim();
      if ((spec.t === "num" || spec.t === "int") && NUM.test(s)) return +s;
      if (spec.t === "enum" && typeof spec.v[0] === "number" && NUM.test(s)) return +s;
      if (spec.t === "bool") { if (s === "true" || s === "1") return 1; if (s === "false" || s === "0") return 0; }
      if (spec.t === "color") {
        var c = s.toLowerCase().replace(/^#?/, "#");
        if (/^#[0-9a-f]{3}$/.test(c)) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
        return /^#[0-9a-f]{6}$/.test(c) ? c : v;
      }
      return v;
    }
    if (spec.t === "list" && Array.isArray(v)) return v.map(function (x) { return coerceVal(spec.of, x); });
    if (spec.t === "obj" && v && typeof v === "object" && !Array.isArray(v)) {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = spec.f[k] ? coerceVal(spec.f[k], v[k]) : v[k]; });
      return o;
    }
    return v;
  }
  function coerce(step, catalog) {
    var def = catalog && step && Object.prototype.hasOwnProperty.call(catalog, step.op) ? catalog[step.op] : null;
    if (!def) return step;
    var o = {};
    Object.keys(step).forEach(function (k) { o[k] = def.args && def.args[k] ? coerceVal(def.args[k], step[k]) : step[k]; });
    return o;
  }
  // Draft steps → { steps (for the editor), bad (marked), newer (kept) }.
  // base(op) gives a new step with the app's defaults.
  function prepare(steps, catalog, base) {
    var out = [], bad = 0, newer = 0;
    (steps || []).forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      if (!Object.prototype.hasOwnProperty.call(catalog, raw.op)) { out.push(raw); newer++; return; }
      var s = coerce(raw, catalog), c = R.normStep(s, catalog);
      if (c) { out.push(c); return; }
      // a field that is there but wrong is left empty, so the editor
      // marks it rather than filling in a value nobody asked for
      var o = base ? base(s.op) : { op: s.op }, args = catalog[s.op].args || {};
      Object.keys(args).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) return;
        var v = R.arg(args[k], s[k]);
        o[k] = v !== undefined ? v : args[k].t === "num" || args[k].t === "int" ? null : args[k].t === "list" ? [] : "";
      });
      out.push(o);
      if (!R.normStep(o, catalog)) bad++;
    });
    return { steps: out, bad: bad, newer: newer };
  }

  function specText(spec) {
    switch (spec.t) {
      case "str": return "text" + (spec.req ? ", not empty" : "");
      case "color": return "a colour #rrggbb";
      case "font": return "sans, serif, mono or an fs_ font id";
      case "num": case "int": return (spec.t === "int" ? "an integer " : "a number ") + spec.lo + "-" + spec.hi;
      case "enum": return "one of " + spec.v.join("|");
      case "bool": return "true or false";
      case "list": return "a list of " + (spec.min || 0) + "-" + (spec.max || 20) + " items";
      case "obj": return "{ " + Object.keys(spec.f).join(", ") + " }";
    }
    return "?";
  }
  // What is wrong with a draft, in English, for the model ([] = fine).
  function problems(app, steps) {
    var cat = CATALOGS[app], out = [];
    if (!cat) return ["app must be one of: " + APPS.join(", ") + "."];
    if (!Array.isArray(steps) || !steps.length) return ["steps is empty: give at least one step."];
    if (steps.length > R.MAX_STEPS) out.push("at most " + R.MAX_STEPS + " steps.");
    steps.slice(0, R.MAX_STEPS).forEach(function (raw, i) {
      var n = "step " + (i + 1);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { out.push(n + " is not an object."); return; }
      if (!Object.prototype.hasOwnProperty.call(cat, raw.op)) {
        out.push(n + ": " + app + " has no step \"" + String(raw.op).slice(0, 30) + "\"; its steps are " + Object.keys(cat).join(", ") + ".");
        return;
      }
      var s = coerce(raw, cat), args = cat[s.op].args || {};
      Object.keys(args).forEach(function (k) {
        var bad = R.arg(args[k], s[k]) === undefined ||
          (args[k].t === "enum" && s[k] !== undefined && args[k].v.indexOf(s[k]) < 0);   // never a silent default
        if (bad) out.push(n + " (" + s.op + "): " + k + " must be " + specText(args[k]) + ".");
      });
    });
    return out;
  }

  // ---------- 3. Drafts and files ----------
  // { app, nm | name, steps } → { app, nm, steps } (steps as plain
  // JSON, not yet checked against a catalog), or null.
  function draft(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var r = R.normRecipe({ id: "rc-draft00", m: 1, app: x.app, nm: x.nm != null ? x.nm : x.name, steps: x.steps });
    if (!r || !r.steps.length) return null;
    return { app: r.app, nm: r.nm, steps: r.steps };
  }
  function pack(rec) {
    var d = draft(rec);
    if (!d) return "";
    return JSON.stringify({ format: FORMAT, ver: VER, app: d.app, name: d.nm, steps: d.steps }, null, 1) + "\n";
  }
  // text → { ok: true, draft } or { ok: false, err: big | json | format | app | empty, app? }
  function unpack(text) {
    if (typeof text !== "string" || text.length > MAX_FILE) return { ok: false, err: "big" };
    var o;
    try { o = JSON.parse(text.replace(/^﻿/, "")); } catch (e) { return { ok: false, err: "json" }; }
    if (!o || typeof o !== "object" || o.format !== FORMAT || typeof o.ver !== "number") return { ok: false, err: "format" };
    if (APPS.indexOf(o.app) < 0) return { ok: false, err: "app", app: typeof o.app === "string" ? o.app.slice(0, 24) : "" };
    var d = draft(o);
    return d ? { ok: true, draft: d } : { ok: false, err: "empty" };
  }
  function fileName(nm) {
    var s = String(nm || "").replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
    return (s || "automation") + EXT;
  }

  // ---------- 4. Plain words ----------
  var STR = {
    en: {
      "sh.app.atelier": "Atelier", "sh.app.layout": "Layout", "sh.app.photolab": "Photo Lab",
      "sh.op.atelier.text": "Replace text", "sh.op.atelier.color": "Replace colour", "sh.op.atelier.font": "Change font",
      "sh.op.atelier.size": "Resize text", "sh.op.atelier.filter": "Photo filter", "sh.op.atelier.center": "Centre on the page",
      "sh.op.atelier.cutout": "Remove photo backgrounds", "sh.op.atelier.resize": "New sizes", "sh.op.atelier.export": "Download",
      "sh.op.layout.text": "Find and replace text", "sh.op.layout.pstyle": "Paragraph style", "sh.op.layout.style": "Change a style", "sh.op.layout.master": "Master on pages",
      "sh.op.layout.margins": "Page margins", "sh.op.layout.preflight": "Preflight check", "sh.op.layout.export": "Export PDF",
      "sh.op.layout.pages": "Add pages", "sh.op.layout.delpages": "Remove pages", "sh.op.layout.numbering": "Page numbers",
      "sh.op.layout.bleed": "Bleed", "sh.op.layout.fit": "Fit the text", "sh.op.layout.grey": "Black and white pictures", "sh.op.layout.imgfit": "Pictures in their frames",
      "sh.op.photolab.tone": "Tone", "sh.op.photolab.look": "Look", "sh.op.photolab.gray": "Black and white",
      "sh.op.photolab.blur": "Blur", "sh.op.photolab.sharpen": "Sharpen", "sh.op.photolab.noise": "Grain",
      "sh.op.photolab.crop": "Crop to a ratio", "sh.op.photolab.resize": "Resize", "sh.op.photolab.watermark": "Watermark",
      "sh.op.photolab.export": "Export to Pictures",
      "sh.unknown": "A step this orOS does not know (skipped)",
      "sh.remove": "remove “{a}”", "sh.anyFont": "any font", "sh.anyStyle": "any style", "sh.noMaster": "no master",
      "sh.whatText": "text boxes", "sh.whatAll": "every element", "sh.copies": "as copies", "sh.inPlace": "this design",
      "sh.stop": "stop before export on errors", "sh.on.all": "all pages", "sh.on.odd": "odd pages", "sh.on.even": "even pages",
      "sh.q.print": "print (300 ppi)", "sh.q.screen": "screen (150 ppi)", "sh.bleed": "bleed", "sh.marks": "crop marks", "sh.spreads": "spreads",
      "sh.margins": "top {t}, bottom {b}, inside {i}, outside {o} mm",
      "sh.at.end": "at the end", "sh.at.before": "before page {p}", "sh.at.after": "after page {p}", "sh.flow": "the text runs on",
      "sh.pagesN": "{n} pages", "sh.pages1": "1 page", "sh.pageRange": "pages {a}-{b}", "sh.pageOne": "page {a}",
      "sh.num.set": "the first page is {n}", "sh.num.shift": "numbers move by {n}", "sh.mm": "{n} mm",
      "sh.pg.all": "all pages", "sh.pg.odd": "odd pages", "sh.pg.even": "even pages", "sh.pg.list": "pages {p}",
      "sh.fit.fit": "the whole picture", "sh.fit.fill": "the frame filled",
      "sh.st.bold": "bold", "sh.st.ital": "italic", "sh.st.caps": "capitals", "sh.st.off": "no {w}",
      "sh.st.sb": "space before {n} pt", "sh.st.sa": "space after {n} pt", "sh.st.fi": "first-line indent {n} pt",
      "sh.brk.any": "starts anywhere", "sh.brk.col": "starts a column", "sh.brk.page": "starts a page", "sh.brk.odd": "starts an odd page", "sh.brk.even": "starts an even page",
      "sh.hyph.on": "hyphenation", "sh.hyph.off": "no hyphenation",
      "sh.lead": "leading {n} pt", "sh.track": "tracking {n}", "sh.al.l": "left", "sh.al.c": "centred", "sh.al.r": "right", "sh.al.j": "justified",
      "sh.f.bright": "brightness", "sh.f.contrast": "contrast", "sh.f.sat": "saturation", "sh.f.warmth": "warmth", "sh.f.tint": "tint",
      "sh.f.fade": "fade", "sh.f.sepia": "sepia", "sh.f.vignette": "vignette",
      "sh.mode.long": "long side", "sh.mode.w": "width", "sh.mode.h": "height", "sh.mode.pct": "percent",
      "sh.up": "may enlarge", "sh.mono": "mono", "sh.quality": "quality {q}",
      "sh.pos.tl": "top left", "sh.pos.t": "top", "sh.pos.tr": "top right", "sh.pos.l": "left", "sh.pos.c": "centre",
      "sh.pos.r": "right", "sh.pos.bl": "bottom left", "sh.pos.b": "bottom", "sh.pos.br": "bottom right",
      "sh.flt.none": "Original", "sh.flt.vivid": "Vivid", "sh.flt.warm": "Warm", "sh.flt.cool": "Cool", "sh.flt.aegean": "Aegean",
      "sh.flt.summer": "Summer", "sh.flt.mono": "Mono", "sh.flt.noir": "Noir", "sh.flt.sepia": "Sepia", "sh.flt.vintage": "Vintage",
      "sh.flt.faded": "Faded", "sh.flt.drama": "Dramatic", "sh.flt.soft": "Soft",
      // the Automations panels (Share / Import)
      "sh.share": "Share", "sh.import": "Import", "sh.shared": "Saved {name}. Send the file to anyone with orOS.",
      "sh.err.big": "This file is too large for an automation.", "sh.err.json": "This is not an automation file.",
      "sh.err.format": "This is not an automation file.", "sh.err.app": "This automation needs a newer orOS.",
      "sh.err.empty": "This automation has no steps.", "sh.err.read": "The file could not be read.",
      "sh.other": "This automation is for {app}.", "sh.openIn": "Open in {app}",
      "sh.check": "Check the steps, then Save. Nothing runs until you press Run.",
      "sh.bad": "{n} steps need a look: they are marked.", "sh.bad1": "1 step needs a look: it is marked."
    },
    el: {
      "sh.app.atelier": "Ατελιέ", "sh.app.layout": "Σελιδοποίηση", "sh.app.photolab": "Εργαστήριο εικόνας",
      "sh.op.atelier.text": "Αντικατάσταση κειμένου", "sh.op.atelier.color": "Αντικατάσταση χρώματος", "sh.op.atelier.font": "Αλλαγή γραμματοσειράς",
      "sh.op.atelier.size": "Μέγεθος κειμένου", "sh.op.atelier.filter": "Φίλτρο φωτογραφιών", "sh.op.atelier.center": "Κεντράρισμα στη σελίδα",
      "sh.op.atelier.cutout": "Αφαίρεση φόντου φωτογραφιών", "sh.op.atelier.resize": "Νέα μεγέθη", "sh.op.atelier.export": "Λήψη",
      "sh.op.layout.text": "Εύρεση και αντικατάσταση κειμένου", "sh.op.layout.pstyle": "Στυλ παραγράφου", "sh.op.layout.style": "Αλλαγή στυλ", "sh.op.layout.master": "Master στις σελίδες",
      "sh.op.layout.margins": "Περιθώρια σελίδας", "sh.op.layout.preflight": "Έλεγχος preflight", "sh.op.layout.export": "Εξαγωγή PDF",
      "sh.op.layout.pages": "Προσθήκη σελίδων", "sh.op.layout.delpages": "Αφαίρεση σελίδων", "sh.op.layout.numbering": "Αρίθμηση σελίδων",
      "sh.op.layout.bleed": "Bleed", "sh.op.layout.fit": "Να χωρέσει το κείμενο", "sh.op.layout.grey": "Ασπρόμαυρες εικόνες", "sh.op.layout.imgfit": "Εικόνες στα πλαίσιά τους",
      "sh.op.photolab.tone": "Τόνος", "sh.op.photolab.look": "Εμφάνιση", "sh.op.photolab.gray": "Ασπρόμαυρο",
      "sh.op.photolab.blur": "Θόλωμα", "sh.op.photolab.sharpen": "Όξυνση", "sh.op.photolab.noise": "Κόκκος",
      "sh.op.photolab.crop": "Περικοπή σε αναλογία", "sh.op.photolab.resize": "Αλλαγή μεγέθους", "sh.op.photolab.watermark": "Υδατογράφημα",
      "sh.op.photolab.export": "Εξαγωγή στις Εικόνες",
      "sh.unknown": "Βήμα που αυτό το orOS δεν γνωρίζει (παραλείπεται)",
      "sh.remove": "αφαίρεση του «{a}»", "sh.anyFont": "οποιαδήποτε γραμματοσειρά", "sh.anyStyle": "οποιοδήποτε στυλ", "sh.noMaster": "κανένα master",
      "sh.whatText": "πλαίσια κειμένου", "sh.whatAll": "όλα τα στοιχεία", "sh.copies": "ως αντίγραφα", "sh.inPlace": "αυτό το σχέδιο",
      "sh.stop": "διακοπή πριν την εξαγωγή αν υπάρχουν λάθη", "sh.on.all": "όλες οι σελίδες", "sh.on.odd": "μονές σελίδες", "sh.on.even": "ζυγές σελίδες",
      "sh.q.print": "εκτύπωση (300 ppi)", "sh.q.screen": "οθόνη (150 ppi)", "sh.bleed": "bleed", "sh.marks": "σημάδια κοπής", "sh.spreads": "δισέλιδα",
      "sh.margins": "πάνω {t}, κάτω {b}, μέσα {i}, έξω {o} mm",
      "sh.at.end": "στο τέλος", "sh.at.before": "πριν τη σελίδα {p}", "sh.at.after": "μετά τη σελίδα {p}", "sh.flow": "το κείμενο συνεχίζει",
      "sh.pagesN": "{n} σελίδες", "sh.pages1": "1 σελίδα", "sh.pageRange": "σελίδες {a}-{b}", "sh.pageOne": "σελίδα {a}",
      "sh.num.set": "η πρώτη σελίδα είναι η {n}", "sh.num.shift": "οι αριθμοί μετακινούνται κατά {n}", "sh.mm": "{n} mm",
      "sh.pg.all": "όλες οι σελίδες", "sh.pg.odd": "μονές σελίδες", "sh.pg.even": "ζυγές σελίδες", "sh.pg.list": "σελίδες {p}",
      "sh.fit.fit": "ολόκληρη η εικόνα", "sh.fit.fill": "γεμάτο πλαίσιο",
      "sh.st.bold": "έντονα", "sh.st.ital": "πλάγια", "sh.st.caps": "κεφαλαία", "sh.st.off": "χωρίς {w}",
      "sh.st.sb": "κενό πριν {n} pt", "sh.st.sa": "κενό μετά {n} pt", "sh.st.fi": "εσοχή πρώτης γραμμής {n} pt",
      "sh.brk.any": "ξεκινά οπουδήποτε", "sh.brk.col": "ξεκινά στήλη", "sh.brk.page": "ξεκινά σελίδα", "sh.brk.odd": "ξεκινά σε μονή σελίδα", "sh.brk.even": "ξεκινά σε ζυγή σελίδα",
      "sh.hyph.on": "συλλαβισμός", "sh.hyph.off": "χωρίς συλλαβισμό",
      "sh.lead": "διάστιχο {n} pt", "sh.track": "αραίωση {n}", "sh.al.l": "αριστερά", "sh.al.c": "στο κέντρο", "sh.al.r": "δεξιά", "sh.al.j": "πλήρης στοίχιση",
      "sh.f.bright": "φωτεινότητα", "sh.f.contrast": "αντίθεση", "sh.f.sat": "κορεσμός", "sh.f.warmth": "θερμότητα", "sh.f.tint": "απόχρωση",
      "sh.f.fade": "ξεθώριασμα", "sh.f.sepia": "σέπια", "sh.f.vignette": "βινιέτα",
      "sh.mode.long": "μεγάλη πλευρά", "sh.mode.w": "πλάτος", "sh.mode.h": "ύψος", "sh.mode.pct": "ποσοστό",
      "sh.up": "μπορεί να μεγαλώσει", "sh.mono": "μονόχρωμος", "sh.quality": "ποιότητα {q}",
      "sh.pos.tl": "πάνω αριστερά", "sh.pos.t": "πάνω", "sh.pos.tr": "πάνω δεξιά", "sh.pos.l": "αριστερά", "sh.pos.c": "κέντρο",
      "sh.pos.r": "δεξιά", "sh.pos.bl": "κάτω αριστερά", "sh.pos.b": "κάτω", "sh.pos.br": "κάτω δεξιά",
      "sh.flt.none": "Πρωτότυπο", "sh.flt.vivid": "Ζωντανό", "sh.flt.warm": "Ζεστό", "sh.flt.cool": "Δροσερό", "sh.flt.aegean": "Αιγαίο",
      "sh.flt.summer": "Καλοκαίρι", "sh.flt.mono": "Ασπρόμαυρο", "sh.flt.noir": "Νουάρ", "sh.flt.sepia": "Σέπια", "sh.flt.vintage": "Ρετρό",
      "sh.flt.faded": "Ξεθωριασμένο", "sh.flt.drama": "Δραματικό", "sh.flt.soft": "Απαλό",
      "sh.share": "Κοινοποίηση", "sh.import": "Εισαγωγή", "sh.shared": "Αποθηκεύτηκε το {name}. Στείλε το αρχείο σε όποιον έχει orOS.",
      "sh.err.big": "Το αρχείο είναι πολύ μεγάλο για αυτοματισμό.", "sh.err.json": "Δεν είναι αρχείο αυτοματισμού.",
      "sh.err.format": "Δεν είναι αρχείο αυτοματισμού.", "sh.err.app": "Αυτός ο αυτοματισμός θέλει νεότερο orOS.",
      "sh.err.empty": "Αυτός ο αυτοματισμός δεν έχει βήματα.", "sh.err.read": "Το αρχείο δεν διαβάστηκε.",
      "sh.other": "Αυτός ο αυτοματισμός είναι για: {app}.", "sh.openIn": "Άνοιγμα σε: {app}",
      "sh.check": "Έλεγξε τα βήματα και πάτα Αποθήκευση. Τίποτα δεν τρέχει πριν πατήσεις Εκτέλεση.",
      "sh.bad": "{n} βήματα θέλουν ματιά: είναι σημειωμένα.", "sh.bad1": "1 βήμα θέλει ματιά: είναι σημειωμένο."
    }
  };
  function L() {
    var I = root.orosI18n;
    return I && I.table ? I.table(STR, "recipes") : STR.en;
  }
  function u(key, vars) {
    var s = L()[key] || STR.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function q(s) { return "“" + s + "”"; }
  function fontName(f) {
    if (!f) return u("sh.anyFont");
    if (f === "sans" || f === "serif" || f === "mono") return f.charAt(0).toUpperCase() + f.slice(1);
    return f.replace(/^fs_/, "").split("_").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }
  function sizeText(z) { return z.w + " × " + z.h + " " + z.u; }
  function flags(st, keys) { return keys.filter(function (k) { return st[k]; }).map(function (k) { return u("sh." + k); }); }
  function pagesText(p) {
    var s = String(p || "").replace(/\s+/g, "").toLowerCase();
    if (!s || s === "all") return u("sh.pg.all");
    return s === "odd" || s === "even" ? u("sh.pg." + s) : u("sh.pg.list", { p: s.replace(/,/g, ", ") });
  }
  // A clean step (catalog-checked) → { name, detail }.
  function words(app, st) {
    var name = u("sh.op." + app + "." + st.op);
    if (!CATALOGS[app] || !CATALOGS[app][st.op]) return { name: u("sh.unknown"), detail: "" };
    var d = "", parts;
    switch (app + "." + st.op) {
      case "atelier.text": case "layout.text":
        d = st.repl ? q(st.find) + " → " + q(st.repl) : u("sh.remove", { a: st.find });
        break;
      case "atelier.color": d = st.from + " → " + st.to; break;
      case "atelier.font": d = fontName(st.from) + " → " + fontName(st.to); break;
      case "atelier.size": d = st.pct + "%"; break;
      case "atelier.filter": d = u("sh.flt." + st.flt); break;
      case "atelier.center": d = st.what === "all" ? u("sh.whatAll") : u("sh.whatText"); break;
      case "atelier.resize": d = st.sizes.map(sizeText).join(", ") + " · " + (st.copies ? u("sh.copies") : u("sh.inPlace")); break;
      case "atelier.export": d = st.fmt === "pdf" ? "PDF " + st.dpi + " dpi" : st.fmt.toUpperCase() + " ×" + st.scale; break;
      case "layout.pstyle": d = (st.from || u("sh.anyStyle")) + " → " + st.to; break;
      case "layout.master": d = (st.ms || u("sh.noMaster")) + " · " + u("sh.on." + st.on); break;
      case "layout.style":
        parts = [st.size ? st.size + " pt" : "", st.lead ? u("sh.lead", { n: st.lead }) : "", st.font ? fontName(st.font) : "",
          st.align ? u("sh.al." + st.align) : "", st.track ? u("sh.track", { n: st.track }) : ""].filter(Boolean);
        ["bold", "ital", "caps"].forEach(function (k) {
          if (st[k] === "on") parts.push(u("sh.st." + k));
          else if (st[k] === "off") parts.push(u("sh.st.off", { w: u("sh.st." + k) }));
        });
        ["sb", "sa", "fi"].forEach(function (k) { if (st[k] >= 0) parts.push(u("sh.st." + k, { n: st[k] })); });
        if (st.brk) parts.push(u("sh.brk." + st.brk));
        if (st.hyph) parts.push(u("sh.hyph." + st.hyph));
        d = st.name + (parts.length ? ": " + parts.join(", ") : "");
        break;
      case "layout.margins": d = u("sh.margins", { t: st.t, b: st.b, i: st.i, o: st.o }); break;
      case "layout.pages":
        d = [st.n === 1 ? u("sh.pages1") : u("sh.pagesN", { n: st.n }), st.at === "end" || !st.page ? u("sh.at.end") : u("sh.at." + st.at, { p: st.page })]
          .concat(st.flow ? [u("sh.flow")] : []).join(" · ");
        break;
      case "layout.delpages": d = st.last && st.last !== st.first ? u("sh.pageRange", { a: Math.min(st.first, st.last), b: Math.max(st.first, st.last) }) : u("sh.pageOne", { a: st.first }); break;
      case "layout.numbering": d = st.mode === "shift" ? u("sh.num.shift", { n: (st.n > 0 ? "+" : "") + st.n }) : u("sh.num.set", { n: st.n }); break;
      case "layout.bleed": d = u("sh.mm", { n: st.mm }); break;
      case "layout.grey": d = pagesText(st.pages); break;
      case "layout.imgfit": d = u("sh.fit." + st.mode) + " · " + pagesText(st.pages); break;
      case "layout.preflight": d = st.stop ? u("sh.stop") : ""; break;
      case "layout.export": d = [u("sh.q." + st.q)].concat(flags(st, ["bleed", "marks", "spreads"])).join(", "); break;
      case "photolab.tone":
        parts = Object.keys(CATALOGS.photolab.tone.args).filter(function (k) { return st[k]; }).map(function (k) {
          return u("sh.f." + k) + " " + (st[k] > 0 && CATALOGS.photolab.tone.args[k].lo < 0 ? "+" : "") + st[k];
        });
        d = parts.join(", ");
        break;
      case "photolab.look": d = u("sh.flt." + st.id); break;
      case "photolab.blur": d = st.r + " px"; break;
      case "photolab.sharpen": d = st.amt + "% · " + st.r + " px"; break;
      case "photolab.noise": d = st.amt + (st.mono ? " · " + u("sh.mono") : ""); break;
      case "photolab.crop": d = st.ratio; break;
      case "photolab.resize": d = u("sh.mode." + st.mode) + " " + st.v + (st.mode === "pct" ? "%" : " px") + (st.up ? " · " + u("sh.up") : ""); break;
      case "photolab.watermark": d = q(st.text) + " · " + u("sh.pos." + st.pos); break;
      case "photolab.export": d = st.fmt.toUpperCase() + (st.fmt === "png" ? "" : " · " + u("sh.quality", { q: st.q })); break;
    }
    return { name: name, detail: d };
  }
  function appName(app) { return APPS.indexOf(app) >= 0 ? u("sh.app." + app) : app; }

  var api = {
    FORMAT: FORMAT, VER: VER, EXT: EXT, MIME: MIME, MAX_FILE: MAX_FILE, APPS: APPS, CATALOGS: CATALOGS, GUIDE: GUIDE,
    forModel: forModel, coerce: coerce, prepare: prepare, problems: problems,
    draft: draft, pack: pack, unpack: unpack, fileName: fileName, words: words, appName: appName, str: u
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosRecipeShare = api;
})(typeof window !== "undefined" ? window : this);
