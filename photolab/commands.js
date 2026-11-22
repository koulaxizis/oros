// ============================================================
// orOS Photo Lab — commands.js: what the Assistant may change in a
// picture (AS-EDIT, wave PL1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Photo Lab, in
// the step format of the automations (recipes/core.js specs; the
// photo steps keep the field names of recipesteps.js). The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the projects it
//     is for (targets, on the synced project index), count what it
//     would change on copies of the projects' doc.json (preview) and
//     describe a picture to the AI (outline, with the user's consent);
//   - in Photo Lab (assist.js), which applies it in the editor, one
//     project after the other, every command one undo step there.
// Layer commands pick layers with the same three fields:
//   ids    layer ids from read_in_app (comma separated)
//   what   "" (every layer) | photo | text | shape | adj
//   has    words in the layer's name or text
//   A locked layer is changed only when named by id; the photo
//   commands (pixels) never change a locked layer, as in the editor.
// kind: "doc"  the document record: apply() here, in the app inside
//              one PL.docChange;
//       "px"   pixels of the picked photo layers (and dup, watermark):
//              the app runs the editor's own commands; apply() only
//              counts;
//       "size" the whole picture (crop, canvas, resize, rotate, flip):
//              the app runs the editor's commands; apply() counts and
//              keeps w × h so later commands count right;
//       "out"  export: the app saves the picture into Pictures.
// Unset fields (null, "") leave things as they are.
// Pure: no DOM. Exposes window.PhotoLabCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var R = typeof module !== "undefined" && module.exports ? require("../recipes/core.js") : root.orosRecipes;

  // Copies of designkit/fx.js FILTERS, photolab/core.js BLENDS,
  // view.js FONT_IDS and fx SHAPES (a test keeps them equal), so the
  // Assistant loads nothing else.
  var LOOKS = ["vivid", "warm", "cool", "aegean", "summer", "mono", "noir", "sepia", "vintage", "faded", "drama", "soft"];
  var BLENDS = ["normal", "dissolve", "darken", "multiply", "burn", "linearburn", "darkercolor", "lighten", "screen", "dodge",
                "lineardodge", "lightercolor", "overlay", "soft", "hard", "vivid", "linearlight", "pin", "hardmix", "difference",
                "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity"];
  var FONTS = ["sans", "serif", "mono", "hand", "display"];
  var SHAPES = ["rect", "rounded", "circle", "triangle", "rtriangle", "diamond", "pentagon", "hexagon", "octagon", "star", "burst",
                "heart", "cross", "arrow", "chevron", "parallelogram", "trapezoid", "arch", "drop", "shield", "bubble"];
  var POS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
  var RATIOS = ["1:1", "4:5", "5:4", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];
  var WHAT = ["", "photo", "text", "shape", "adj"];
  var KIND_OF = { photo: "raster", text: "text", shape: "shape", adj: "adj" };
  var ADJ_KINDS = ["gray", "invert", "bc", "hsl", "photo", "posterize"];
  var EFFECTS = ["none", "shadow", "glow", "inner", "stroke", "overlay"];
  var FX_KEY = { shadow: "sh", glow: "gl", inner: "ig", stroke: "st", overlay: "co" };
  var MAX_SIDE = 8192, MAX_LAYERS = 100;
  // PL-AI: assistant/imgai.js IDS and STYLE_IDS (a test keeps them equal); "" = the owner's choice
  var PROVS = ["", "horde", "pollinations", "huggingface", "openai", "stability", "sdwebui", "comfyui"];
  var AI_STYLES = ["", "photo", "illus", "paint", "three", "sketch", "pixel"];
  var PIC_RX = /^\/internal\/(?!(.*\/)?\.)(?!.*\/\/)[^\u0000-\u001f\\]+\.(jpe?g|png|webp|gif|bmp|avif|svg|tiff?|heic)$/i;
  var TEXT_DEF = { f: "sans", z: 72, c: "#000000", a: "l", lh: 120 };

  function num(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  function int(lo, hi) { return { t: "int", lo: lo, hi: hi, def: null }; }
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  var SEL = { ids: { t: "str", max: 2000 }, what: oneOf(WHAT), has: { t: "str", max: 200 } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }
  function slider(lo) { return { t: "int", lo: lo, hi: 100, def: 0 }; }

  var CATALOG = {
    tone: { kind: "px", args: sel({ bright: slider(-100), contrast: slider(-100), sat: slider(-100), warmth: slider(-100), tint: slider(-100),
      fade: slider(0), sepia: slider(0), vignette: slider(0) }) },
    look: { kind: "px", args: sel({ id: { t: "enum", v: LOOKS, def: LOOKS[0], req: 1 } }) },
    gray: { kind: "px", args: sel({}) },
    blur: { kind: "px", args: sel({ r: { t: "num", lo: 0.5, hi: 100, def: 3 } }) },
    sharpen: { kind: "px", args: sel({ amt: { t: "int", lo: 1, hi: 500, def: 80 }, r: { t: "num", lo: 0.1, hi: 20, def: 1.5 } }) },
    noise: { kind: "px", args: sel({ amt: { t: "int", lo: 1, hi: 100, def: 8 }, mono: { t: "bool", def: 1 } }) },
    adjlayer: { kind: "doc", args: { kind: { t: "enum", v: ADJ_KINDS, def: "gray", req: 1 }, bright: int(-100, 100), contrast: int(-100, 100),
      hue: int(-180, 180), sat: int(-100, 100), light: int(-100, 100), c: { t: "color" }, dens: int(1, 100), levels: int(2, 32) } },
    layer: { kind: "doc", args: sel({ opacity: int(0, 100), blend: oneOf([""].concat(BLENDS)), hide: ONOFF, lock: ONOFF, title: { t: "str", max: 80 } }) },
    arrange: { kind: "doc", args: sel({ order: { t: "enum", v: ["front", "back", "forward", "backward"], def: "front", req: 1 } }) },
    place: { kind: "doc", args: sel({ x: num(-32768, 32768), y: num(-32768, 32768), dx: num(-32768, 32768), dy: num(-32768, 32768) }) },
    remove: { kind: "doc", args: sel({}) },
    dup: { kind: "px", args: sel({}) },
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 5000, req: 1 } }) },
    textstyle: { kind: "doc", args: sel({ font: oneOf([""].concat(FONTS)), size: num(4, 2000), c: { t: "color" }, align: oneOf(["", "l", "c", "r"]),
      bold: ONOFF, ital: ONOFF, lh: int(50, 300) }) },
    style: { kind: "doc", args: sel({ effect: { t: "enum", v: EFFECTS, def: "none", req: 1 }, c: { t: "color" }, size: num(0, 500), opacity: int(0, 100) }) },
    add: { kind: "doc", args: { what: { t: "enum", v: ["text", "shape"], def: "text", req: 1 }, text: { t: "str", max: 5000 },
      x: num(-32768, 32768), y: num(-32768, 32768), w: num(1, 16384), h: num(1, 16384), font: oneOf([""].concat(FONTS)), size: num(4, 2000),
      c: { t: "color" }, align: oneOf(["", "l", "c", "r"]), bold: ONOFF, fill: { t: "color" }, shape: oneOf([""].concat(SHAPES)) } },
    watermark: { kind: "px", args: { text: { t: "str", max: 200, req: 1 }, size: { t: "int", lo: 1, hi: 100, def: 5 }, c: { t: "color" },
      pos: { t: "enum", v: POS, def: "br" }, opacity: { t: "int", lo: 5, hi: 100, def: 60 } } },
    crop: { kind: "size", args: { ratio: oneOf([""].concat(RATIOS)), x: num(-32768, 32768), y: num(-32768, 32768), w: num(1, MAX_SIDE), h: num(1, MAX_SIDE) } },
    canvas: { kind: "size", args: { w: { t: "num", lo: 1, hi: MAX_SIDE, def: null, req: 1 }, h: { t: "num", lo: 1, hi: MAX_SIDE, def: null, req: 1 }, pos: { t: "enum", v: POS, def: "c" } } },
    resize: { kind: "size", args: { mode: { t: "enum", v: ["long", "w", "h", "pct"], def: "long" }, v: { t: "int", lo: 1, hi: MAX_SIDE, def: 2048, req: 1 }, up: { t: "bool", def: 0 } } },
    rotate: { kind: "size", args: { deg: { t: "num", lo: -359, hi: 359, def: null, req: 1 } } },
    flip: { kind: "size", args: { dir: { t: "enum", v: ["h", "v"], def: "h", req: 1 } } },
    rename: { kind: "doc", args: { title: { t: "str", max: 80, req: 1 } } },
    // PL-AI (Chris 2026-11-22 «δώσε στο Photolab πλήρη δυνατότητες χρήσης AI»):
    // the image AI the owner chose in the Assistant (Settings › Pictures),
    // or prov for one of the others set up there; nobg runs on the device.
    generate: { kind: "ai", args: { prompt: { t: "str", max: 2000, req: 1 }, style: oneOf(AI_STYLES), prov: oneOf(PROVS),
      w: num(64, MAX_SIDE), h: num(64, MAX_SIDE), x: num(-32768, 32768), y: num(-32768, 32768), title: { t: "str", max: 80 } } },
    nobg: { kind: "ai", args: sel({}) },
    fill: { kind: "ai", args: { prompt: { t: "str", max: 2000, req: 1 }, x: { t: "num", lo: 0, hi: MAX_SIDE, def: null, req: 1 }, y: { t: "num", lo: 0, hi: MAX_SIDE, def: null, req: 1 },
      w: { t: "num", lo: 8, hi: MAX_SIDE, def: null, req: 1 }, h: { t: "num", lo: 8, hi: MAX_SIDE, def: null, req: 1 }, prov: oneOf(PROVS) } },
    expand: { kind: "ai", args: { ratio: oneOf([""].concat(RATIOS)), w: num(1, MAX_SIDE), h: num(1, MAX_SIDE), pos: { t: "enum", v: POS, def: "c" },
      prompt: { t: "str", max: 2000 }, prov: oneOf(PROVS) } },
    upscale: { kind: "ai", args: { f: { t: "enum", v: ["2", "3", "4"], def: "2" }, prov: oneOf(PROVS) } },
    image: { kind: "ai", args: { path: { t: "str", max: 1024, req: 1 }, x: num(-32768, 32768), y: num(-32768, 32768), w: num(1, MAX_SIDE), h: num(1, MAX_SIDE),
      fit: oneOf(["", "contain", "cover"]), title: { t: "str", max: 80 } } },
    create: { kind: "new", args: { from: { t: "str", max: 1024, req: 1 }, title: { t: "str", max: 80 } } },
    export: { kind: "out", args: { fmt: { t: "enum", v: ["jpg", "png", "webp"], def: "jpg" }, quality: { t: "int", lo: 10, hi: 100, def: 90 }, out: { t: "str", max: 1030 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Photo Lab commands (a picture is a project of layers; layer commands pick layers with ids (layer ids from read_in_app), what (\"\" every layer, or photo, text, shape, adj) and has (words in the layer's name or text); " +
    "the photo commands change the pixels of the picked photo layers, by default every visible photo layer; a locked layer changes only when named by id, and its pixels never; sizes are in pixels):\n" + [
    "tone: photo sliders bright, contrast, sat, warmth, tint (-100..100), fade, sepia, vignette (0..100)",
    "look: a ready look, id " + LOOKS.join("|"),
    "gray: black and white",
    "blur: Gaussian blur, r (radius px)",
    "sharpen: unsharp mask, amt (%), r (radius px)",
    "noise: grain, amt, mono (true: grey grain)",
    "adjlayer: a new adjustment layer on top, which changes everything below it and can be edited later: kind gray | invert | bc (bright, contrast) | hsl (hue, sat, light) | photo (photo filter: c, dens 1-100) | posterize (levels 2-32)",
    "layer: opacity (0-100), blend " + BLENDS.join("|") + ", hide on|off, lock on|off, title (the layer's name)",
    "arrange: order front|back|forward|backward",
    "place: x, y (the layer's top left on the canvas) or dx, dy (move by)",
    "remove: delete the picked layers (pick them; the last layer stays)",
    "dup: duplicate the picked layers",
    "replace: find → repl in text layers (cs = match case, word = whole words)",
    "settext: the whole text of the picked text layers becomes `text`",
    "textstyle: text layers: font " + FONTS.join("|") + ", size (px), c (colour #rrggbb), align l|c|r, bold, ital (on|off), lh (line height % 50-300)",
    "style: layer style effect shadow|glow|inner|stroke|overlay (none removes every style), c (colour), size (shadow distance, glow size, stroke width, px), opacity",
    "add: a new layer on top: what text (needs text; font, size, c, align, bold) | shape (shape, fill, w, h); x, y (top left; left out: centred)",
    "watermark: a text mark at pos " + POS.join("|") + ": text, size (% of the short side), c, opacity (%), as its own layer",
    "crop: the canvas to ratio " + RATIOS.join("|") + " (the largest centred part), or to x, y, w, h; the layers keep their pixels outside",
    "canvas: canvas size w, h, the picture anchored at pos",
    "resize: scale the picture: mode long|w|h|pct, v (px or %), up (true: may get larger)",
    "rotate: the whole picture by deg (90, 180, -90 or any angle)",
    "flip: the whole picture, dir h (left-right) | v (top-bottom)",
    "rename: the project's name becomes title",
    "generate: AI draws a new picture from prompt (English reads best) as a new photo layer on top: style " + AI_STYLES.slice(1).join("|") + ", w, h (its size, the canvas when left out; scaled to cover it), x, y, title (the layer's name)",
    "nobg: remove the background of the picked photo layers (as a mask, which can be painted further; on this device, nothing is sent)",
    "fill: AI redraws the box x, y, w, h of the picture as prompt says (generative fill), as a new layer over it",
    "expand: AI grows the picture (generative expand / outpaint) to ratio " + RATIOS.join("|") + " or to w, h, the picture anchored at pos, and draws what is beyond its edges (prompt: what is around, optional) on a new bottom layer",
    "upscale: the whole picture f 2|3|4 times larger (at most " + MAX_SIDE + " px a side); with an AI that can (Stable Diffusion WebUI / Forge, ComfyUI) its sharper copy comes as a top layer",
    "image: a picture file from Claude's folders on the orOS disk (path, an /internal/ path as files_write or files_upload gave it; Claude's own pictures, ComfyUI's or any other) as a new photo layer: x, y, w, h, fit contain|cover (the canvas), title",
    "create: open a picture file from Claude's folders as a NEW Photo Lab project (only as the one command, with designs new): from (its /internal/ path), title",
    "prov (generate, fill, expand, upscale): the image AI to use, " + PROVS.slice(1).join("|") + "; left out, the one the owner chose in the Assistant (Settings › Pictures). It must be set up there (key or address); fill and expand need openai, stability, sdwebui or comfyui. What is sent goes straight from the owner's device to that AI (the box or picture, and the prompt)",
    "export: save the picture into the Pictures folder: fmt jpg|png|webp, quality (10-100, jpg and webp); out (a local write folder local:<root>/<folder>, or a folder of Claude's on the orOS disk such as Drive/Photos with Files at «may change») also saves it there, never over a file, and the answer lists the paths"
  ].join("\n");

  // ---------- 1. Checking ----------
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  function isIdentity(st) {
    return st.op === "tone" && ["bright", "contrast", "sat", "warmth", "tint", "fade", "sepia", "vignette"].every(function (k) { return !st[k]; });
  }
  function picked(st) { return given(st.ids) || given(st.what) || given(st.has); }
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
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if ((raw.op === "remove" || raw.op === "dup") && !picked(st)) return { err: raw.op + ": pick the layers with ids, what or has" };
    if (raw.op === "tone" && isIdentity(st)) return { err: "tone: give at least one slider" };
    if (raw.op === "crop" && !st.ratio && (st.w === null || st.h === null)) return { err: "crop: give ratio, or w and h" };
    if (raw.op === "add" && st.what === "text" && !given(st.text)) return { err: "add: a text needs text" };
    if (raw.op === "layer" && st.opacity === null && !st.blend && !st.hide && !st.lock && !st.title) return { err: "layer: give opacity, blend, hide, lock or title" };
    if (raw.op === "place" && st.x === null && st.y === null && !st.dx && !st.dy) return { err: "place: give x, y, dx or dy" };
    if (raw.op === "rotate" && !(st.deg % 360)) return { err: "rotate: deg must not be 0" };
    if (raw.op === "expand" && !st.ratio && (st.w === null || st.h === null)) return { err: "expand: give ratio, or w and h" };
    if (raw.op === "nobg" && st.what && st.what !== "photo") return { err: "nobg: only photo layers" };
    if (raw.op === "image" && !PIC_RX.test(st.path)) return { err: "image: path must be an /internal/ path of a picture file in Claude's folders" };
    if (raw.op === "create" && !PIC_RX.test(st.from)) return { err: "create: from must be an /internal/ path of a picture file in Claude's folders" };
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
    if (steps.length > 1 && steps.some(function (st) { return st.op === "create"; })) return { ok: false, err: "create is the only command of its list (change the new picture with a second edit_in_app)" };
    return { ok: true, steps: steps };
  }

  // ---------- 2. Picking layers ----------
  function idList(s) { return String(s || "").split(/[\s,]+/).filter(Boolean); }
  function layerText(L) { return L.k === "text" && L.tx ? L.tx.s || "" : ""; }
  // The layers a command picks, bottom → top. Photo commands without a
  // pick take every visible photo layer.
  function pick(doc, st) {
    var ids = idList(st.ids), idSet = {}, has = String(st.has || "").toLowerCase();
    ids.forEach(function (id) { idSet[id] = 1; });
    var px = CATALOG[st.op] && (CATALOG[st.op].kind === "px" || st.op === "nobg") && st.op !== "dup" && st.op !== "watermark";
    return (doc.layers || []).filter(function (L) {
      if (ids.length && !idSet[L.id]) return false;
      if (st.what && L.k !== KIND_OF[st.what]) return false;
      if (has && (String(L.name || "") + " " + layerText(L)).toLowerCase().indexOf(has) < 0) return false;
      if (px && (L.k !== "raster" || L.lock || (!ids.length && !L.vis))) return false;
      return true;
    });
  }
  // A locked layer changes only when named by id.
  function free(L, st) { return !L.lock || idList(st.ids).indexOf(L.id) >= 0; }

  // ---------- 3. Applying ----------
  function setTo(o, k, v) { if (v === null || v === undefined || v === "" || o[k] === v) return 0; o[k] = v; return 1; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  function newId(env) {
    if (env && env.newLayerId) return env.newLayerId();
    var s = "l", A = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 10; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  // A text's box { w, h }: the app measures it (env.measure), the
  // preview estimates it.
  function textBox(tx, env) {
    if (env && env.measure) return env.measure(tx);
    var lines = String(tx.s || "").split("\n"), n = 1;
    lines.forEach(function (l) { n = Math.max(n, l.length); });
    var pad = Math.ceil(tx.z * 0.25);
    return { w: Math.ceil(n * tx.z * 0.55) + pad * 2, h: Math.round(tx.z * tx.lh / 100) * lines.length + pad * 2 };
  }
  function uniqueName(doc, base) {
    var names = {}, n = 1;
    doc.layers.forEach(function (L) { names[L.name] = 1; });
    if (!names[base]) return base;
    while (names[base + " " + n]) n++;
    return base + " " + n;
  }
  // The adjustment layer record of an adjlayer step.
  function adjOf(st) {
    var p = {};
    if (st.kind === "bc") p = { b: st.bright === null ? 0 : Math.round(st.bright * 1.5), c: st.contrast === null ? 0 : st.contrast };
    else if (st.kind === "hsl") p = { h: st.hue || 0, s: st.sat || 0, l: st.light || 0 };
    else if (st.kind === "photo") { p = { d: st.dens === null ? 25 : st.dens }; if (st.c) p.c = st.c; }
    else if (st.kind === "posterize") p = { n: st.levels === null ? 4 : st.levels };
    return { id: st.kind, p: p };
  }
  // The layer style record of a style step (on top of what L has).
  function fxOf(L, st) {
    if (st.effect === "none") return null;
    var fx = L.fx ? JSON.parse(JSON.stringify(L.fx)) : {}, k = FX_KEY[st.effect], o = fx[k] || {};
    if (st.c) o.c = st.c;
    if (st.opacity !== null) o.op = st.opacity;
    if (st.size !== null) {
      if (k === "sh") { o.d = Math.round(st.size); o.s = Math.round(st.size); }
      else if (k === "gl" || k === "ig") o.s = Math.round(st.size);
      else if (k === "st") o.w = Math.max(1, Math.round(st.size));
    }
    fx[k] = o;
    return fx;
  }
  // The output size of a resize step (batchcore targetSize, never
  // larger unless up; percent at most 400).
  function resizeTo(w, h, st) {
    var v = st.mode === "pct" ? Math.min(400, st.v) : st.v, k;
    if (st.mode === "pct") k = v / 100;
    else if (st.mode === "w") k = v / w;
    else if (st.mode === "h") k = v / h;
    else k = v / Math.max(w, h);
    if (!st.up) k = Math.min(1, k);
    return { w: Math.max(1, Math.min(MAX_SIDE, Math.round(w * k))), h: Math.max(1, Math.min(MAX_SIDE, Math.round(h * k))) };
  }
  // The largest centred rectangle of ratio "a:b" inside w × h.
  function cropRect(w, h, st) {
    if (!st.ratio) {
      var x = Math.round(st.x || 0), y = Math.round(st.y || 0);
      return { x: x, y: y, w: Math.max(1, Math.round(st.w)), h: Math.max(1, Math.round(st.h)) };
    }
    var m = /^(\d+):(\d+)$/.exec(st.ratio), k = (+m[1]) / (+m[2]), cw = w, ch = Math.round(w / k);
    if (ch > h) { ch = h; cw = Math.round(h * k); }
    cw = Math.max(1, Math.min(w, cw)); ch = Math.max(1, Math.min(h, ch));
    return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
  }
  // The size the whole picture gets from a size step (preview), or null.
  function sizeAfter(doc, st) {
    var w = doc.w, h = doc.h;
    switch (st.op) {
      case "crop": var r = cropRect(w, h, st); return r.x || r.y || r.w !== w || r.h !== h ? { w: r.w, h: r.h } : null;
      case "canvas": return Math.round(st.w) !== w || Math.round(st.h) !== h ? { w: Math.round(st.w), h: Math.round(st.h) } : null;
      case "resize": var z = resizeTo(w, h, st); return z.w !== w || z.h !== h ? z : null;
      case "rotate":
        var d = ((st.deg % 360) + 360) % 360;
        if (d === 180) return { w: w, h: h };
        if (d === 90 || d === 270) return { w: h, h: w };
        var a = d * Math.PI / 180, co = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
        return { w: Math.min(MAX_SIDE, Math.ceil(w * co + h * si - 1e-9)), h: Math.min(MAX_SIDE, Math.ceil(w * si + h * co - 1e-9)) };
      case "flip": return { w: w, h: h };
    }
    return null;
  }

  // PL-AI: the size expand or upscale gives the picture, or null.
  function aiSize(doc, st) {
    var w = doc.w, h = doc.h;
    if (st.op === "upscale") {
      var f = +st.f || 2, k = Math.min(f, MAX_SIDE / Math.max(w, h));
      return k > 1.0001 ? { w: Math.round(w * k), h: Math.round(h * k) } : null;
    }
    var nw, nh;
    if (st.ratio) {
      var p = st.ratio.split(":"), r = +p[0] / +p[1];
      if (w / h > r) { nw = w; nh = Math.round(w / r); } else { nh = h; nw = Math.round(h * r); }
    } else { nw = Math.max(w, Math.round(st.w)); nh = Math.max(h, Math.round(st.h)); }
    nw = Math.min(MAX_SIDE, nw); nh = Math.min(MAX_SIDE, nh);
    return nw > w || nh > h ? { w: nw, h: nh } : null;
  }
  // Applies one command to a doc (a copy, or in the app the open
  // record inside PL.docChange) → how many layers or settings changed.
  // px, size and out commands only count here (and size keeps w × h).
  function apply(doc, st, env) {
    var kind = CATALOG[st.op].kind, k = 0, list;
    if (kind === "px") {
      if (st.op === "watermark") return 1;
      list = pick(doc, st);
      if (!list.length) note(env, st.op === "dup" ? "noLayers" : "noPhoto");
      if (st.op === "dup") {
        // copies above their layers (the app duplicates in the editor;
        // here they keep later commands counting right)
        var dn = 0;
        list.filter(function (L) { return free(L, st); }).forEach(function (L) {
          if (doc.layers.length >= MAX_LAYERS) { note(env, "maxLayers"); return; }
          var c = JSON.parse(JSON.stringify(L));
          c.id = newId(env);
          if (c.mk) c.mk.id = newId(env);
          doc.layers.splice(doc.layers.indexOf(L) + 1, 0, c);
          dn++;
        });
        return dn;
      }
      return isIdentity(st) ? 0 : list.length;
    }
    if (kind === "ai") {
      // PL-AI: the app runs them; here they count and keep w × h
      if (st.op === "nobg") { list = pick(doc, st); if (!list.length) note(env, "noPhoto"); return list.length; }
      if (st.op === "expand" || st.op === "upscale") { var ez = aiSize(doc, st); if (!ez) return 0; doc.w = ez.w; doc.h = ez.h; return 1; }
      if (doc.layers && doc.layers.length >= MAX_LAYERS) { note(env, "maxLayers"); return 0; }
      return 1;
    }
    if (kind === "new") return 0;
    if (kind === "size") {
      var z = sizeAfter(doc, st);
      if (!z) return 0;
      doc.w = z.w; doc.h = z.h;
      return 1;
    }
    if (kind === "out") return 0;
    switch (st.op) {
      case "rename":
        var nm = String(st.title).trim().slice(0, 80);
        if (!nm || nm === doc.name) return 0;
        doc.name = nm;
        return 1;
      case "adjlayer":
        if (doc.layers.length >= MAX_LAYERS) { note(env, "maxLayers"); return 0; }
        var aj = adjOf(st);
        doc.layers.push({ id: newId(env), k: "adj", name: uniqueName(doc, env && env.adjName ? env.adjName(aj.id) : aj.id), vis: 1, lock: 0, op: 100, bl: "normal", x: 0, y: 0, aj: aj });
        return 1;
      case "add":
        if (doc.layers.length >= MAX_LAYERS) { note(env, "maxLayers"); return 0; }
        var L;
        if (st.what === "text") {
          var tx = { s: st.text, f: st.font || TEXT_DEF.f, z: Math.round(st.size || Math.max(12, Math.min(400, Math.round(Math.min(doc.w, doc.h) / 12)))),
                     c: st.c || TEXT_DEF.c, a: st.align || TEXT_DEF.a, b: st.bold === "on" ? 1 : 0, i: 0, lh: TEXT_DEF.lh };
          var bx = textBox(tx, env);
          L = { id: newId(env), k: "text", name: String(st.text).replace(/\s+/g, " ").trim().slice(0, 40) || "Text", vis: 1, lock: 0, op: 100, bl: "normal",
                x: st.x !== null ? Math.round(st.x) : Math.round((doc.w - bx.w) / 2), y: st.y !== null ? Math.round(st.y) : Math.round((doc.h - bx.h) / 2), tx: tx };
        } else {
          var sw = Math.round(st.w || Math.round(Math.min(doc.w, doc.h) / 3)), sh = Math.round(st.h || sw);
          L = { id: newId(env), k: "shape", name: env && env.shapeName ? env.shapeName(st.shape || "rect") : "Shape", vis: 1, lock: 0, op: 100, bl: "normal",
                x: st.x !== null ? Math.round(st.x) : Math.round((doc.w - sw) / 2), y: st.y !== null ? Math.round(st.y) : Math.round((doc.h - sh) / 2),
                sh: { id: st.shape || "rect", w: sw, h: sh, f: st.fill || st.c || "#000000", s: "", sw: 0, r: 0 } };
        }
        doc.layers.push(L);
        if (env && env.added) env.added(L);
        return 1;
    }
    list = pick(doc, st);
    if (!list.length) { note(env, "noLayers"); return 0; }
    switch (st.op) {
      case "layer":
        list.forEach(function (L) {
          if (!free(L, st) && st.lock !== "off") return;
          var c = 0;
          if (st.opacity !== null && L.op !== st.opacity) { L.op = st.opacity; c = 1; }
          c |= setTo(L, "bl", st.blend);
          if (st.hide) c |= setTo(L, "vis", st.hide === "on" ? 0 : 1);
          if (st.lock) c |= setTo(L, "lock", st.lock === "on" ? 1 : 0);
          if (st.title) c |= setTo(L, "name", String(st.title).trim().slice(0, 80));
          k += c;
        });
        return k;
      case "arrange":
        var mv = list.filter(function (L) { return free(L, st); });
        if (!mv.length) return 0;
        var ids = {};
        mv.forEach(function (L) { ids[L.id] = 1; });
        var before = doc.layers.map(function (L) { return L.id; }).join(",");
        if (st.order === "front" || st.order === "back") {
          var rest = doc.layers.filter(function (L) { return !ids[L.id]; });
          doc.layers = st.order === "front" ? rest.concat(mv) : mv.concat(rest);
        } else {
          var a = doc.layers.slice(), up = st.order === "forward";
          var idx = mv.map(function (L) { return a.indexOf(L); });
          if (up) idx.reverse();
          idx.forEach(function (i) {
            var j = up ? i + 1 : i - 1;
            if (j < 0 || j >= a.length || ids[a[j].id]) return;
            var t = a[i]; a[i] = a[j]; a[j] = t;
          });
          doc.layers = a;
        }
        return doc.layers.map(function (L) { return L.id; }).join(",") === before ? 0 : mv.length;
      case "place":
        list.forEach(function (L) {
          if (!free(L, st) || L.k === "adj") return;
          var x = st.x !== null ? Math.round(st.x) : L.x + Math.round(st.dx || 0), y = st.y !== null ? Math.round(st.y) : L.y + Math.round(st.dy || 0);
          if (x !== L.x || y !== L.y) { L.x = x; L.y = y; k++; }
        });
        return k;
      case "remove":
        var gone = {};
        list.forEach(function (L) { if (free(L, st)) gone[L.id] = 1; });
        var keep = doc.layers.filter(function (L) { return !gone[L.id]; });
        if (!keep.length) { keep = [doc.layers[0]]; note(env, "lastLayer"); }
        k = doc.layers.length - keep.length;
        doc.layers = keep;
        return k;
      case "replace":
        var rx = finder(st);
        list.forEach(function (L) {
          if (L.k !== "text" || !free(L, st)) return;
          var s = L.tx.s, out = s.replace(rx, function () { return st.repl; });
          if (out !== s) { L.tx.s = out.slice(0, 5000); k++; }
        });
        return k;
      case "settext":
        list.forEach(function (L) { if (L.k === "text" && free(L, st) && L.tx.s !== st.text) { L.tx.s = st.text; k++; } });
        return k;
      case "textstyle":
        list.forEach(function (L) {
          if (L.k !== "text" || !free(L, st)) return;
          var c = 0, tx = L.tx;
          c |= setTo(tx, "f", st.font);
          if (st.size !== null) c |= setTo(tx, "z", Math.round(st.size));
          c |= setTo(tx, "c", st.c);
          c |= setTo(tx, "a", st.align);
          if (st.bold) c |= setTo(tx, "b", st.bold === "on" ? 1 : 0);
          if (st.ital) c |= setTo(tx, "i", st.ital === "on" ? 1 : 0);
          if (st.lh !== null) c |= setTo(tx, "lh", st.lh);
          k += c;
        });
        return k;
      case "style":
        list.forEach(function (L) {
          if (L.k === "adj" || !free(L, st)) return;
          var fx = fxOf(L, st), was = JSON.stringify(L.fx || null);
          if (env && env.normFx) fx = env.normFx(fx);
          if (fx) L.fx = fx; else delete L.fx;
          if (JSON.stringify(L.fx || null) !== was) k++;
        });
        return k;
    }
    return 0;
  }

  // ---------- 4. For the Assistant ----------
  // Where a project's record is on the orOS disk (store.js).
  function docPath(id) { return "/internal/Photo Lab/" + id + "/doc.json"; }
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  // data: { docs: [{ id, name }] } (the project index's entries).
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    // PL-AI: a new project from a picture file (create); nothing that exists is picked
    if (designs === "new") return { ok: true, docs: [{ id: "", name: String(name || "") }], fresh: 1 };
    if (designs === "folder") return { ok: false, err: "Photo Lab has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no pictures in Photo Lab yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the picture's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no picture is called " + JSON.stringify(String(name).slice(0, 80)) + "; pictures: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several pictures match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no picture is open in Photo Lab; name the picture (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, made: 0, files, notes[] }. data: { docs: the
  // projects' doc records }.
  function preview(data, ids, steps, ctx) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [], out = { n: 0, d: 0, per: [], cut: 0, made: 0, files: 0, notes: [] };
    if (steps.length && steps[0].op === "create") { out.made = 1; return out; }
    ids.forEach(function (id) {
      var src = null;
      docs.forEach(function (d) { if (d.id === id) src = d; });
      if (!src) return;
      var w = JSON.parse(JSON.stringify(src)), k = 0, env = { notes: out.notes };
      steps.forEach(function (st) {
        if (CATALOG[st.op].kind === "out") { out.files++; return; }
        k += apply(w, st, env);
      });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: src.name || "", n: k }); }
    });
    return out;
  }
  // A picture for the model: size and layers, bottom → top.
  function outline(doc) {
    if (!doc) return null;
    return {
      name: doc.name || "", w: doc.w, h: doc.h, unit: "px", order: "bottom to top",
      layers: (doc.layers || []).map(function (L) {
        var o = { id: L.id, kind: L.k === "raster" ? "photo" : L.k, name: L.name || "" };
        if (!L.vis) o.hidden = true;
        if (L.lock) o.locked = true;
        if (L.op !== 100) o.opacity = L.op;
        if (L.bl && L.bl !== "normal") o.blend = L.bl;
        if (L.k !== "adj") { o.x = L.x; o.y = L.y; }
        if (L.k === "text" && L.tx) { o.text = String(L.tx.s || "").slice(0, 400); o.font = L.tx.f; o.size = L.tx.z; o.c = L.tx.c; if (L.tx.b) o.bold = true; if (L.tx.i) o.ital = true; }
        if (L.k === "shape" && L.sh) { o.shape = L.sh.id; o.w = L.sh.w; o.h = L.sh.h; if (L.sh.f) o.fill = L.sh.f; }
        if (L.k === "adj" && L.aj) o.adj = L.aj.id;
        if (L.fx) o.styles = Object.keys(L.fx).map(function (k) { for (var e in FX_KEY) if (FX_KEY[e] === k) return e; return k; });
        if (L.mk) o.mask = true;
        return o;
      })
    };
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, LOOKS: LOOKS, BLENDS: BLENDS, FONTS: FONTS, SHAPES: SHAPES,
    check: check, pick: pick, apply: apply, docPath: docPath, targets: targets, preview: preview, outline: outline,
    adjOf: adjOf, cropRect: cropRect, resizeTo: resizeTo, sizeAfter: sizeAfter, isIdentity: isIdentity, aiSize: aiSize, PROVS: PROVS, AI_STYLES: AI_STYLES, PIC_RX: PIC_RX
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PhotoLabCommands = api;
})(typeof window !== "undefined" ? window : this);
