// ============================================================
// orOS Photo Lab — recipesteps.js: the steps a Photo Lab automation
// may use (wave A2, v1.0.0). The catalog for recipes/core.js
// (orosRecipes) and the pure planning; photolab/recipes.js runs them
// on the open picture or, from Batch process, on every photo.
//   tone       the photo sliders (designkit/fx.js record, adjust "fx")
//   look       a named look (fx FILTERS, adjust "preset")
//   gray       black and white (adjust "gray")
//   blur       Gaussian blur, radius px (filter "gauss")
//   sharpen    unsharp mask, amount % and radius px (filter "unsharp")
//   noise      grain, amount, mono (filter "noise")
//   crop       the largest centred part with a ratio (1:1, 4:5 …)
//   resize     long side, width, height or percent (batchcore
//              targetSize; never larger unless `up`)
//   watermark  a text at one of nine places, size % and opacity
//   export     JPG / PNG / WebP with a quality, saved in Pictures
//              (from Batch process the batch's own output settings
//              are used instead)
// job(st) → { kind: "adjust" | "filter", id, p } for the pixel steps.
// Pure: no DOM. Exposes window.PhotoLabRecipes (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var FX, B;
  if (typeof module !== "undefined" && module.exports) {
    FX = require("../designkit/fx.js"); B = require("./batchcore.js");
  } else {
    FX = root.orosDK.fx; B = root.PhotoLab.batch;
  }

  var LOOKS = FX.FILTERS.map(function (f) { return f.id; }).filter(function (id) { return id !== "none"; });
  var RATIOS = ["1:1", "4:5", "5:4", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];
  function slider(lo) { return { t: "int", lo: lo, hi: 100, def: 0 }; }
  var CATALOG = {
    tone: { kind: "px", args: { bright: slider(-100), contrast: slider(-100), sat: slider(-100), warmth: slider(-100), tint: slider(-100),
      fade: slider(0), sepia: slider(0), vignette: slider(0) } },
    look: { kind: "px", args: { id: { t: "enum", v: LOOKS, def: LOOKS[0] } } },
    gray: { kind: "px", args: {} },
    blur: { kind: "px", args: { r: { t: "num", lo: 0.5, hi: 100, def: 3 } } },
    sharpen: { kind: "px", args: { amt: { t: "int", lo: 1, hi: 500, def: 80 }, r: { t: "num", lo: 0.1, hi: 20, def: 1.5 } } },
    noise: { kind: "px", args: { amt: { t: "int", lo: 1, hi: 100, def: 8 }, mono: { t: "bool", def: 1 } } },
    crop: { kind: "size", args: { ratio: { t: "enum", v: RATIOS, def: "1:1" } } },
    resize: { kind: "size", args: { mode: { t: "enum", v: ["long", "w", "h", "pct"], def: "long" }, v: { t: "int", lo: 1, hi: B.MAX_SIDE, def: 2048 }, up: { t: "bool", def: 0 } } },
    watermark: { kind: "px", args: { text: { t: "str", max: 200, req: 1 }, size: { t: "int", lo: 1, hi: 100, def: 5 }, c: { t: "color" },
      pos: { t: "enum", v: B.POS, def: "br" }, opacity: { t: "int", lo: 5, hi: 100, def: 60 } } },
    export: { kind: "out", args: { fmt: { t: "enum", v: ["jpg", "png", "webp"], def: "jpg" }, q: { t: "int", lo: 10, hi: 100, def: 88 } } }
  };
  var ORDER = ["tone", "look", "gray", "blur", "sharpen", "noise", "crop", "resize", "watermark", "export"];

  // The largest centred rectangle of ratio "a:b" inside w × h.
  function cropRect(w, h, ratio) {
    var m = /^(\d+):(\d+)$/.exec(ratio || "") || [0, 1, 1];
    var k = (+m[1]) / (+m[2]), cw = w, ch = Math.round(w / k);
    if (ch > h) { ch = h; cw = Math.round(h * k); }
    cw = Math.max(1, Math.min(w, cw)); ch = Math.max(1, Math.min(h, ch));
    return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
  }
  // The output size of a resize step (percent at most 400).
  function resizeTo(w, h, st) {
    var v = st.mode === "pct" ? Math.min(400, st.v) : st.v;
    return B.targetSize(w, h, { mode: st.mode, v: v, up: !!st.up });
  }
  function job(st) {
    switch (st.op) {
      case "tone":
        var p = {};
        ["bright", "contrast", "sat", "warmth", "tint", "fade", "sepia", "vignette"].forEach(function (k) { p[k] = st[k]; });
        return { kind: "adjust", id: "fx", p: FX.normAdjust ? FX.normAdjust(p) : p };
      case "look": return { kind: "adjust", id: "preset", p: { id: st.id } };
      case "gray": return { kind: "adjust", id: "gray", p: {} };
      case "blur": return { kind: "filter", id: "gauss", p: { r: st.r } };
      case "sharpen": return { kind: "filter", id: "unsharp", p: { amt: st.amt, r: st.r, th: 2 } };
      case "noise": return { kind: "filter", id: "noise", p: { amt: st.amt, mono: st.mono ? 1 : 0, seed: 7 } };
    }
    return null;
  }
  // The batch watermark settings of a watermark step.
  function wmOf(st) {
    return { kind: "text", text: st.text, size: st.size, c: st.c || "#ffffff", pos: st.pos, op: st.opacity };
  }
  // A tone step that changes nothing.
  function isIdentity(st) { return st.op === "tone" && Object.keys(CATALOG.tone.args).every(function (k) { return !st[k]; }); }

  var api = { CATALOG: CATALOG, ORDER: ORDER, LOOKS: LOOKS, RATIOS: RATIOS, cropRect: cropRect, resizeTo: resizeTo, job: job, wmOf: wmOf, isIdentity: isIdentity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PhotoLabRecipes = api;
})(typeof window !== "undefined" ? window : this);
