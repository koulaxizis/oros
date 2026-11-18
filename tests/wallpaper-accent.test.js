// WPACC-1: Accent from wallpaper (Settings › Appearance › System
// colour, this device only). The colour maths (shell.js WpAcc) runs
// here as it is, cut out of the source by name; the wiring is checked
// in the source.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

function cutBlock(head) {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error("missing " + head);
  const open = head.endsWith("[") ? "[" : "{", close = open === "[" ? "]" : "}";
  let depth = 0, j = SRC.indexOf(open, i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === open) depth++;
    else if (SRC[j] === close && --depth === 0) break;
  }
  return SRC.slice(i, j + 1);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(cutBlock("  var WpAcc = (function () {") + ")();\n" +
  cutBlock("  var WALLPAPERS = [") + ";\n" +
  "this.WpAcc = WpAcc; this.WALLPAPERS = WALLPAPERS;", ctx);
const W = ctx.WpAcc;

// Every skin block of style.css: its theme and the two backgrounds.
const SKIN_BLOCKS = [...CSS.matchAll(/^\[data-skin="([a-z0-9-]+)"\]\[data-theme="(dark|light)"\] \{([^}]*)\}/gm)]
  .map(m => ({
    skin: m[1], theme: m[2],
    bg: /--bg:\s*([^;]+);/.exec(m[3])[1].trim(),
    panel: /--panel-bg:\s*([^;]+);/.exec(m[3])[1].trim()
  }));

function rgb(hex) { return W.parse(hex); }

test("style.css has a dark and a light block for all 16 skins", () => {
  assert.equal(SKIN_BLOCKS.length, 32);
});

test("colourful presets give a colour, grey ones none (the skin accent stays)", () => {
  const got = {};
  for (const w of ctx.WALLPAPERS) got[w.id] = W.swatches(W.stops(w.css), 4).length;
  for (const id of ["mono", "hex", "clear", "custom", "land"]) assert.equal(got[id], 0, id);
  for (const id of ["dusk", "plum", "forest", "ember", "nordic", "aurora", "sand", "nebula", "borealis", "obsidian", "terrazzo"])
    assert.ok(got[id] >= 1, id);
  assert.equal(got.terrazzo, 4, "many coloured dots: four to pick from");
});

test("every colour of every preset reads 4.5:1 on every skin, dark and light, and so does its ink", () => {
  let n = 0;
  for (const w of ctx.WALLPAPERS) {
    for (const s of W.swatches(W.stops(w.css), 4)) {
      for (const b of SKIN_BLOCKS) {
        const p = W.palette(s, b.theme, [b.bg, b.panel]);
        assert.ok(p, w.id + " on " + b.skin + "/" + b.theme);
        assert.ok(W.contrast(rgb(p.accent), rgb(b.bg)) >= 4.5, w.id + " accent/bg " + b.skin + "/" + b.theme);
        assert.ok(W.contrast(rgb(p.accent), rgb(b.panel)) >= 4.5, w.id + " accent/panel " + b.skin + "/" + b.theme);
        assert.ok(W.contrast(rgb(p.accent), rgb(p.ink)) >= 4.5, w.id + " ink " + b.skin + "/" + b.theme);
        assert.match(p.accent, /^#[0-9a-f]{6}$/);
        assert.match(p.hover, /^#[0-9a-f]{6}$/);
        assert.ok(p.ink === "#ffffff" || p.ink === "#141414");
        assert.match(p.soft, /^rgba\(\d+, \d+, \d+, 0\.1[26]\)$/);
        n++;
      }
    }
  }
  assert.ok(n > 400, "checked " + n);
});

test("every hue fits on every skin (photos can have any colour)", () => {
  for (let h = 0; h < 360; h += 5) {
    for (const c of [0.02, 0.08, 0.2, 0.35]) {
      for (const b of SKIN_BLOCKS) {
        const p = W.palette({ h, c }, b.theme, [b.bg, b.panel]);
        assert.ok(p, h + "/" + c + " " + b.skin + "/" + b.theme);
        assert.ok(W.contrast(rgb(p.accent), rgb(b.bg)) >= 4.5);
        assert.ok(W.contrast(rgb(p.accent), rgb(p.ink)) >= 4.5);
      }
    }
  }
});

function pixels(colours) {   // [[r,g,b,count]] → RGBA bytes
  const out = [];
  for (const [r, g, b, k] of colours) for (let i = 0; i < k; i++) out.push(r, g, b, 255);
  return out;
}

test("a photo: the biggest colourful area comes first, close hues count once, at most four", () => {
  const px = pixels([[30, 90, 200, 1500], [40, 100, 210, 500], [220, 120, 30, 900], [20, 160, 60, 400],
                     [200, 40, 120, 300], [240, 220, 40, 200], [128, 128, 128, 300]]);
  const sw = W.swatches(px, 4);
  assert.equal(sw.length, 4);
  assert.ok(sw[0].h > 230 && sw[0].h < 280, "blue first: " + sw[0].h);
  for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) {
    const d = Math.abs(sw[i].h - sw[j].h) % 360;
    assert.ok(Math.min(d, 360 - d) >= 35, "apart");
  }
});

test("a black-and-white photo or a transparent picture has no colour", () => {
  const grey = [];
  for (let v = 0; v < 256; v++) grey.push(v, v, v, 255);
  assert.equal(W.swatches(grey, 4).length, 0);
  assert.equal(W.swatches([200, 30, 30, 0, 30, 200, 30, 0], 4).length, 0);
  assert.equal(W.swatches([], 4).length, 0);
  // a tiny coloured speck on grey is not enough
  assert.equal(W.swatches(pixels([[100, 100, 100, 990], [255, 0, 0, 10]]), 4).length, 0);
});

test("stops: hex, short hex and rgba colours of a gradient; fully transparent ones are skipped", () => {
  assert.deepEqual(Array.from(W.stops("linear-gradient(#123456 0%, #abc 50%, rgba(1,2,3,0.5), rgba(9,9,9,0))")),
    [0x12, 0x34, 0x56, 255, 0xaa, 0xbb, 0xcc, 255, 1, 2, 3, 128]);
  assert.equal(W.palette(null, "dark", []), null);
  assert.equal(W.palette({ h: "x" }, "dark", []), null);
});

test("wiring: only the four accent variables, high contrast keeps its own, skin colour for drawn wallpapers", () => {
  assert.match(SRC, /var WPACC_VARS = \["--accent", "--accent-hover", "--accent-soft", "--accent-ink"\];/);
  const apply = cutBlock("  function wpAccApply() {");
  assert.match(apply, /!a11yHigh\(\)/, "high contrast keeps its accent");
  assert.match(cutBlock("  function a11yApply() {"), /wpAccApply\(\)/);
  // wpAccent() feeds the Generator's "orOS" palette and Living land: the skin colour, never the root's.
  const wpa = cutBlock("  function wpAccent() {");
  assert.match(wpa, /SKINS\[i\]\.color/);
  assert.doesNotMatch(wpa, /getComputedStyle|--accent/);
  assert.match(cutBlock("  function applySkin() {"), /orosAppTheme = \{ accent: SKINS\[i\]\.color \}/);
  // re-sets data-skin so every app's watchPalette copies the palette again
  assert.match(cutBlock("  function wpAccPoke() {"), /setAttribute\("data-skin", state\.skin\)/);
  for (const f of ["applyTheme", "applySkin"]) assert.match(cutBlock("  function " + f + "() {"), /wpAccApply\(\); wpAccRefresh\(\);/, f);
  assert.match(cutBlock("  function applyWallpaper() {"), /wpAccRefresh\(\)/);
  assert.match(cutBlock("  function wpShow("), /wpAccRefresh\(\)/);
});

test("this device only: the choice never rides in the shell slice", () => {
  assert.match(SRC, /var WPACC_KEY = "oros-wpaccent";/);
  const core = fs.readFileSync(path.join(ROOT, "settings", "core.js"), "utf8");
  assert.match(core, /wpaccent: "device"/);
  for (const f of ["shellSliceGet", "shellSliceSet", "shellMerge"])
    assert.doesNotMatch(cutBlock("  function " + f + "("), /wpacc|WPACC|wpAcc/i, f);
});

test("Settings strings in English, Greek and German", () => {
  const core = fs.readFileSync(path.join(ROOT, "settings", "core.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n", "de", "settings.js"), "utf8");
  for (const k of ["a.wpacc", "a.wpacc.hint", "a.wpacc.pick", "a.wpacc.n", "a.wpacc.none", "a.wpacc.high", "w.wpaccent"]) {
    assert.equal(core.split('"' + k + '":').length - 1, 2, k + " en + el");
    assert.ok(de.includes('"' + k + '":'), k + " de");
  }
});
