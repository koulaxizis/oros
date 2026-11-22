// ============================================================
// orOS Mockups — goods/cloth.js (v1.1.0)
// T-shirt, tote bag (v1.0.0), hoodie, socks and cap (v1.1.0): the pure part (Node-tested in
// tests/mockups.test.js) plus the model download. Registers "tshirt"
// and "tote" with MockCore.addGood(); sheets in the shape of
// MockCore.template() with T.ink (garment ink: no background, the
// picture fitted inside the print area, not cropped), options for the
// app's generated form (as goods/small.js).
// Print areas are common DTG / screen-print ones: front 300 × 400 mm
// (≈ 12 × 16″), left chest 95 × 95 mm, tote 280 × 300 mm, hoodie front
// 280 × 250 mm above the pocket, sock leg 90 × 250 mm, cap front panel
// 110 × 55 mm. The cap has no model file: cloth3d.js builds it.
// The garments are our own Blender models (koulaxizis/oros-models,
// mockups/make.py, CC0), downloaded only when the person asks, checked
// by SHA-256 and kept in Cache Storage "oros-mockups-models". Without
// them goods/cloth3d.js shows a flat stand-in.
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  var MM = root.MockMedia || (typeof require === "function" ? require("./media.js") : null);
  if (!C || !MM) return;
  var pick = MM.pick, bit = MM.bit, sheet = MM.sheet;

  // ---------- The models (from oros-models mockups/index.json) ----------
  var BASE = "https://koulaxizis.github.io/oros-models/mockups/";
  var MODELS = {
    tshirt: { file: "tshirt.glb", v: 1, bytes: 919940, sha256: "197326a74da6c11045e0f11af82cf6da4dfabf33938fbf2f14f63932ac96c088", main: "shirt",
      w: 796, h: 726, print: { front: { x: -150, y: 250, w: 300, h: 400 }, chest: { x: 60, y: 250, w: 95, h: 95 } } },
    tote: { file: "tote.glb", v: 1, bytes: 546596, sha256: "de93e7f264c03ecb62643579ed64baddc6274c1c20abeafcc892d9d146d70e5b", main: "bag",
      w: 380, h: 420, print: { front: { x: -140, y: 150, w: 280, h: 300 } } },
    hoodie: { file: "hoodie.glb", v: 1, bytes: 1921944, sha256: "78c9f5f2ddce9b9bf6687e4922c04ca44fe598f8d5ebfc86a5aa47c412c803e6", main: "hoodie",
      w: 940, h: 780, print: { front: { x: -140, y: 235, w: 280, h: 250 }, chest: { x: 60, y: 250, w: 95, h: 95 }, back: { x: -150, y: 280, w: 300, h: 400 } } },
    socks: { file: "socks.glb", v: 1, bytes: 589228, sha256: "b2b1dbe71597b3466cc2053e35161bb7191e848d7e78ba75a77a8a506f1f6228", main: "sock_0",
      w: 320, h: 420, print: { sock_0: { x: -120, y: 260, w: 90, h: 250 }, sock_1: { x: 30, y: 220, w: 90, h: 250 } } }
  };
  // the cap is built in code (goods/cloth3d.js): its front panel print, mm, crown base y = 0
  var CAP_PRINT = { x: -55, y: 92, w: 110, h: 55 };

  // ---------- Colours ----------
  var CLOTH_C = { white: "#f2f2ef", black: "#1d1d20", heather: "#9b9da1", navy: "#1f2a44", red: "#a82a2e", forest: "#2f4a37", sand: "#d9c9a8", natural: "#e8dcc2" };
  var TEE_COLS = ["white", "black", "heather", "navy", "red", "forest", "sand"];
  var TOTE_COLS = ["natural", "black", "navy", "red", "forest", "white"];
  var SOCK_COLS = ["white", "black", "heather"];
  var CAP_COLS = ["black", "navy", "red", "forest", "sand", "white"];

  // ---------- T-shirt ----------
  var AREAS = ["front", "chest"];
  function teeNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { col: pick(g.col, TEE_COLS, "white"), area: pick(g.area, AREAS, "front"), back: bit(g.back) };
  }
  function teeDims(g) {
    g = teeNorm(g);
    var M = MODELS.tshirt, a = M.print[g.area];
    return { w: M.w, h: M.h, d: 30, print: { w: a.w, h: a.h }, back: g.back ? { w: M.print.front.w, h: M.print.front.h } : null };
  }
  function inkSheet(key, k, w, h) {
    var T = sheet(key, [[k, k, w]], h, 0, 0);
    T.ink = 1;           // garment ink: nothing printed where the picture has nothing
    return T;
  }
  function teeTemplate(p, s) {
    var D = teeDims(p.g);
    if (s === "teeback") return inkSheet("teeback", "back", MODELS.tshirt.print.front.w, MODELS.tshirt.print.front.h);
    return inkSheet("teefront", "front", D.print.w, D.print.h);
  }

  // ---------- Tote bag ----------
  var HANDLES = ["long", "short"];
  function toteNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { col: pick(g.col, TOTE_COLS, "natural"), handles: pick(g.handles, HANDLES, "long"), back: bit(g.back) };
  }
  function toteDims(g) {
    g = toteNorm(g);
    var M = MODELS.tote, a = M.print.front;
    return { w: M.w, h: M.h, d: 10, handle: g.handles === "long" ? 300 : 150, print: { w: a.w, h: a.h }, back: g.back ? { w: a.w, h: a.h } : null };
  }
  function toteTemplate(p, s) {
    var D = toteDims(p.g);
    return s === "toteback" ? inkSheet("toteback", "back", D.print.w, D.print.h) : inkSheet("totefront", "front", D.print.w, D.print.h);
  }

  // ---------- Hoodie ----------
  function hoodNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { col: pick(g.col, TEE_COLS, "heather"), area: pick(g.area, AREAS, "front"), back: bit(g.back) };
  }
  function hoodDims(g) {
    g = hoodNorm(g);
    var M = MODELS.hoodie, a = M.print[g.area];
    return { w: M.w, h: M.h, d: 40, print: { w: a.w, h: a.h }, back: g.back ? { w: M.print.back.w, h: M.print.back.h } : null };
  }
  function hoodTemplate(p, s) {
    var D = hoodDims(p.g), B = MODELS.hoodie.print.back;
    return s === "hoodback" ? inkSheet("hoodback", "back", B.w, B.h) : inkSheet("hoodfront", "front", D.print.w, D.print.h);
  }

  // ---------- Socks (a pair; the same picture on both legs) ----------
  function sockNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { col: pick(g.col, SOCK_COLS, "white") };
  }
  function sockDims() { var a = MODELS.socks.print.sock_0; return { w: MODELS.socks.w, h: MODELS.socks.h, d: 15, print: { w: a.w, h: a.h } }; }
  function sockTemplate() { var D = sockDims(); return inkSheet("sockleg", "front", D.print.w, D.print.h); }

  // ---------- Cap ----------
  var CAP_STYLES = ["dad", "trucker"];
  var CAP_FINS = ["print", "embroidery"];
  function capNorm(g) {
    g = g && typeof g === "object" ? g : {};
    return { style: pick(g.style, CAP_STYLES, "dad"), col: pick(g.col, CAP_COLS, "black"), fin: pick(g.fin, CAP_FINS, "embroidery"), wfront: bit(g.wfront) };
  }
  function capDims(g) {
    g = capNorm(g);
    return { w: 190, h: g.style === "trucker" ? 122 : 108, d: 270, print: { w: CAP_PRINT.w, h: CAP_PRINT.h } };
  }
  function capTemplate() {
    var T = inkSheet("capfront", "front", CAP_PRINT.w, CAP_PRINT.h);
    return T;
  }

  // What is printed where on a garment's model: [{ mesh, area (mm rect), side (+1 front, -1 back), sheet }].
  function prints(kind, g) {
    var M = MODELS[kind], out = [];
    if (kind === "tshirt") { out.push({ mesh: M.main, area: M.print[g.area], side: 1, sheet: "teefront" }); if (g.back) out.push({ mesh: M.main, area: M.print.front, side: -1, sheet: "teeback" }); }
    else if (kind === "tote") { out.push({ mesh: M.main, area: M.print.front, side: 1, sheet: "totefront" }); if (g.back) out.push({ mesh: M.main, area: M.print.front, side: -1, sheet: "toteback" }); }
    else if (kind === "hoodie") { out.push({ mesh: M.main, area: M.print[g.area], side: 1, sheet: "hoodfront" }); if (g.back) out.push({ mesh: M.main, area: M.print.back, side: -1, sheet: "hoodback" }); }
    else if (kind === "socks") { out.push({ mesh: "sock_0", area: M.print.sock_0, side: 1, sheet: "sockleg" }, { mesh: "sock_1", area: M.print.sock_1, side: 1, sheet: "sockleg" }); }
    else if (kind === "cap") out.push({ mesh: "crown", area: CAP_PRINT, side: 1, sheet: "capfront" });
    return out;
  }

  var OPTS = {
    tshirt: [{ k: "col", t: "sel", v: TEE_COLS, p: "col.", l: "f.ccol" }, { k: "area", t: "seg", v: AREAS, p: "area.", l: "f.area" },
      { k: "back", t: "chk", l: "f.backPrint" }],
    tote: [{ k: "col", t: "sel", v: TOTE_COLS, p: "col.", l: "f.ccol" }, { k: "handles", t: "seg", v: HANDLES, p: "handles.", l: "f.handles" },
      { k: "back", t: "chk", l: "f.backPrint" }],
    hoodie: [{ k: "col", t: "sel", v: TEE_COLS, p: "col.", l: "f.ccol" }, { k: "area", t: "seg", v: AREAS, p: "area.", l: "f.area" },
      { k: "back", t: "chk", l: "f.backPrint" }],
    socks: [{ k: "col", t: "seg", v: SOCK_COLS, p: "col.", l: "f.ccol" }],
    cap: [{ k: "style", t: "seg", v: CAP_STYLES, p: "cap.", l: "f.capStyle" }, { k: "col", t: "sel", v: CAP_COLS, p: "col.", l: "f.ccol" },
      { k: "wfront", t: "chk", l: "f.wfront", when: function (g) { return g.style === "trucker"; } }, { k: "fin", t: "seg", v: CAP_FINS, p: "capfin.", l: "f.capFin" }]
  };

  // ---------- The download (browser only) ----------
  var CACHE = "oros-mockups-models";
  var mem = {}, busy = {};
  function urlOf(name) { return BASE + MODELS[name].file + "?v=" + MODELS[name].v; }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function err(code) { var e = new Error("model " + code); e.code = code; return e; }
  // the bytes, if they are exactly the model's file
  function check(name, buf) {
    var M = MODELS[name];
    if (!buf || buf.byteLength !== M.bytes || !root.crypto || !root.crypto.subtle) return Promise.reject(err("hash"));
    return root.crypto.subtle.digest("SHA-256", buf).then(function (h) {
      if (hex(h) !== M.sha256) throw err("hash");
      return buf;
    });
  }
  function openCache() { return root.caches && root.caches.open ? root.caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null); }
  // A model kept on this device from an earlier download (no network).
  function cached(name) {
    if (!MODELS[name]) return Promise.resolve(false);
    if (mem[name]) return Promise.resolve(true);
    return openCache().then(function (c) {
      if (!c) return false;
      return c.match(urlOf(name)).then(function (r) {
        if (!r) return false;
        return r.arrayBuffer().then(function (b) { return check(name, b); }).then(function (b) { mem[name] = b; return true; }, function () {
          return c.delete(urlOf(name)).then(function () { return false; }, function () { return false; });
        });
      });
    }).catch(function () { return false; });
  }
  // Download, check and keep a model (only when the person asks).
  function load(name, progress) {
    if (!MODELS[name]) return Promise.reject(err("unknown"));
    if (mem[name]) return Promise.resolve(mem[name]);
    if (busy[name]) return busy[name];
    progress = progress || function () {};
    var M = MODELS[name];
    busy[name] = cached(name).then(function (ok) {
      if (ok) return mem[name];
      if (typeof root.fetch !== "function") throw err("offline");
      return root.fetch(urlOf(name), { credentials: "omit", cache: "no-cache" }).then(function (res) {
        if (!res.ok) throw err("download");
        if (!res.body || !res.body.getReader) return res.arrayBuffer();
        var reader = res.body.getReader(), parts = [], got = 0;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              var out = new Uint8Array(got), o = 0;
              parts.forEach(function (q) { out.set(q, o); o += q.byteLength; });
              return out.buffer;
            }
            parts.push(r.value); got += r.value.byteLength; progress(Math.min(0.99, got / M.bytes));
            return pump();
          });
        }
        return pump();
      }, function () { throw err("download"); }).then(function (buf) { return check(name, buf); }).then(function (buf) {
        mem[name] = buf;
        return openCache().then(function (c) {
          if (c) return c.put(urlOf(name), new root.Response(buf.slice(0), { headers: { "Content-Type": "model/gltf-binary" } })).catch(function () {});
        }).then(function () { progress(1); return buf; });
      });
    }).then(function (b) { delete busy[name]; return b; }, function (e) { delete busy[name]; throw e; });
    return busy[name];
  }
  function remove(name) {
    delete mem[name];
    return openCache().then(function (c) { return c ? c.delete(urlOf(name)) : false; }).catch(function () { return false; });
  }
  function buffer(name) { return mem[name] || null; }
  function modelOf(kind) { return MODELS[kind] ? kind : null; }

  var A = {
    VERSION: "1.1.0", BASE: BASE, MODELS: MODELS, CAP_PRINT: CAP_PRINT, CLOTH_C: CLOTH_C, TEE_COLS: TEE_COLS, TOTE_COLS: TOTE_COLS, SOCK_COLS: SOCK_COLS, CAP_COLS: CAP_COLS,
    AREAS: AREAS, HANDLES: HANDLES, CAP_STYLES: CAP_STYLES, CAP_FINS: CAP_FINS, prints: prints,
    teeNorm: teeNorm, teeDims: teeDims, toteNorm: toteNorm, toteDims: toteDims, hoodNorm: hoodNorm, hoodDims: hoodDims, sockNorm: sockNorm, sockDims: sockDims, capNorm: capNorm, capDims: capDims,
    modelOf: modelOf, cached: cached, load: load, remove: remove, buffer: buffer, check: check, urlOf: urlOf
  };
  function reg(kind, def) {
    def.group = "wear"; def.wrap = false; def.noOpen = true;
    if (!def.place) { def.place = "lie"; def.cam = { th: -10, ph: 58 }; }
    if (MODELS[kind]) def.model = kind;
    C.addGood(kind, def);
  }
  reg("tshirt", { slots: [], norm: teeNorm, dims: teeDims, opts: OPTS.tshirt, template: teeTemplate,
    sheets: function (p) { return p.g.back ? ["teefront", "teeback"] : ["teefront"]; },
    shown: function (g) { return g.back ? ["front", "back"] : ["front"]; } });
  reg("tote", { slots: [], norm: toteNorm, dims: toteDims, opts: OPTS.tote, template: toteTemplate,
    sheets: function (p) { return p.g.back ? ["totefront", "toteback"] : ["totefront"]; },
    shown: function (g) { return g.back ? ["front", "back"] : ["front"]; } });
  reg("hoodie", { slots: [], norm: hoodNorm, dims: hoodDims, opts: OPTS.hoodie, template: hoodTemplate,
    sheets: function (p) { return p.g.back ? ["hoodfront", "hoodback"] : ["hoodfront"]; },
    shown: function (g) { return g.back ? ["front", "back"] : ["front"]; } });
  reg("socks", { slots: [], norm: sockNorm, dims: sockDims, opts: OPTS.socks, template: sockTemplate,
    sheets: function () { return ["sockleg"]; }, shown: function () { return ["front"]; } });
  reg("cap", { slots: [], norm: capNorm, dims: capDims, opts: OPTS.cap, template: capTemplate, place: "stand", cam: { th: -28, ph: 14 },
    sheets: function () { return ["capfront"]; }, shown: function () { return ["front"]; } });
  root.MockCloth = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
