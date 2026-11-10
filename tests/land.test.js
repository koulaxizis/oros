// Living land (wallpaper/land.js) and its shell wiring.
// Run: node --test tests/
//
// land.js is required as is (it exports its API for Node). The shell
// parts are checked in the source: wplandCanon is cut out by name and
// evaluated, the rest are wiring checks. A renamed function fails here.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const L = require(path.join(ROOT, "wallpaper", "land.js"));
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

// A desktop like the real one: a shortcut grid, a widget column, a note.
function desk() {
  const r = [];
  for (let i = 0; i < 8; i++) r.push({ x: 20 + (i % 4) * 96, y: 20 + Math.floor(i / 4) * 100, w: 92, h: 90, k: "tile" });
  r.push({ x: 1100, y: 16, w: 300, h: 220, k: "card" }, { x: 640, y: 420, w: 220, h: 200, k: "note" });
  return r;
}

test("the field is a pure function of its inputs", () => {
  const a = L.field(desk(), 1440, 860, 42), b = L.field(desk(), 1440, 860, 42);
  assert.equal(a.gw, b.gw);
  assert.deepEqual(Array.from(a.v), Array.from(b.v));
  const c = L.field(desk(), 1440, 860, 43);
  assert.notDeepEqual(Array.from(a.v), Array.from(c.v), "another seed, another land");
});

test("every obstacle stands on land, never in water, in every style", () => {
  const SAND = 3;                                   // layerOf: 0 deep, 1 shallow, 2 foam, 3 sand …
  for (const style of L.STYLES) for (const seed of [1, 7, 99, 123456, 999999]) {
    const rs = desk(), f = L.field(rs, 1440, 860, seed, 0, style);
    for (const r of rs) {
      for (let y = r.y; y <= r.y + r.h; y += 4) {
        for (let x = r.x; x <= r.x + r.w; x += 4) {
          assert.ok(L.layerOf(L.sample(f, x, y)) >= SAND, style + " seed " + seed + " at " + x + "," + y);
        }
      }
    }
  }
});

test("open desktop is mostly water", () => {
  const f = L.field([{ x: 20, y: 20, w: 92, h: 90, k: "tile" }], 1440, 860, 5);
  let water = 0, n = 0;
  for (let i = 0; i < f.v.length; i++) { n++; if (L.layerOf(f.v[i]) <= 2) water++; }
  assert.ok(water / n > 0.5, "water share " + (water / n));
});

test("hills and garden are land first, islands water first", () => {
  const share = (style) => {
    const f = L.field([{ x: 20, y: 20, w: 92, h: 90, k: "tile" }], 1440, 860, 5, 0, style);
    let water = 0;
    for (let i = 0; i < f.v.length; i++) if (L.layerOf(f.v[i]) <= 1) water++;
    return water / f.v.length;
  };
  const isl = share("islands"), hil = share("hills"), gar = share("garden");
  assert.ok(isl > 0.5, "islands " + isl);
  assert.ok(hil < 0.25 && hil > 0, "hills have a river, not a sea: " + hil);
  assert.ok(gar < 0.35, "garden ponds " + gar);
  assert.deepEqual(Array.from(L.field(desk(), 400, 300, 9, 0, "lava").v), Array.from(L.field(desk(), 400, 300, 9, 0, "islands").v), "unknown style = islands");
});

test("each style has its own palette, garden has flowers", () => {
  const a = L.palette("islands", "#d4af37", "dark"), b = L.palette("hills", "#d4af37", "dark"), c = L.palette("garden", "#d4af37", "dark");
  assert.notDeepEqual(a.top, b.top);
  assert.notDeepEqual(b.grass, c.grass);
  assert.equal(c.style, "garden");
  const w = 200, h = 140, img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const f = L.field([], w, h, 4, 0, "garden");
  L.paint(img, f, c, 1, 4);
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) seen.add(img.data[i] + "," + img.data[i + 1] + "," + img.data[i + 2]);
  assert.ok(["244,170,196", "250,246,236", "246,214,112", "196,176,240", c.accentRgb.join(",")].some((k) => seen.has(k)), "a flower is drawn");
  assert.match(L.baseCss("#d4af37", "dark", "hills"), /^linear-gradient\(/);
});

test("gentle motion: off by default, still on the seasonal rules", () => {
  assert.equal(L.stillReason({}), "off");
  assert.equal(L.stillReason({ motion: 0 }), "off");
  assert.equal(L.stillReason({ motion: 1 }), "");
  assert.equal(L.stillReason({ motion: 1, reduced: true }), "reduced");
  assert.equal(L.stillReason({ motion: 1, battery: { level: 0.15, charging: false } }), "battery");
  assert.equal(L.stillReason({ motion: 1, battery: { level: 0.15, charging: true } }), "");
  assert.equal(L.stillReason({ motion: 1, battery: { level: 0.5, charging: false } }), "");
  assert.equal(L.stillReason({ motion: 1, slow: true }), "slow");
  let lit = 0;
  for (let t = 0; t < 10; t += 0.033) if (L.glint(1.2, t) > 0.02) lit++;
  assert.ok(lit > 0 && lit < 300 * 0.35, "glints flash, mostly dark: " + lit);
  const src = read("wallpaper/land.js");
  assert.match(src, /ts - lastT < 33/, "≤ 30 fps");
  assert.match(src, /sum \/ frames\.length > 55/, "slow device turns it off");
  assert.match(src, /if \(\(o\.paused && o\.paused\(\)\) \|\| document\.hidden\) \{ motionStop\(\); return; \}/, "never under an app");
});

test("palette follows the theme and leans toward the skin", () => {
  const dark = L.palette("islands", "#d4af37", "dark"), light = L.palette("islands", "#d4af37", "light");
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  for (const k of ["deep", "shallow", "foam", "sand", "grass", "high", "top"]) {
    assert.equal(dark[k].length, 3);
    assert.ok(lum(light[k]) > lum(dark[k]), k + " is lighter in the light theme");
  }
  assert.notDeepEqual(L.palette("islands", "#3584e4", "dark").top, dark.top, "accent tints the plateau");
  // a grey accent tints nothing: same as another grey
  const layers = (p) => ["deep", "shallow", "foam", "sand", "grass", "high", "top"].map((k) => p[k]);
  assert.deepEqual(layers(L.palette("islands", "#e0e0e0", "dark")), layers(L.palette("islands", "#808080", "dark")));
  assert.match(L.baseCss("#d4af37", "dark"), /^linear-gradient\(/);
});

test("paint fills every pixel, opaque", () => {
  const w = 120, h = 80, img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  L.paint(img, L.field(desk().map((r) => ({ x: r.x / 12, y: r.y / 12, w: r.w / 12, h: r.h / 12, k: r.k })), w, h, 3), L.palette("islands", "#d4af37", "dark"), 1, 3);
  for (let i = 3; i < img.data.length; i += 4) assert.equal(img.data[i], 255);
});

test("signature ignores a pixel, not a move", () => {
  const a = desk(), b = desk(), c = desk();
  b[0].x += 1;
  c[0].x += 12;
  assert.equal(L.sig(a), L.sig(b));
  assert.notEqual(L.sig(a), L.sig(c));
});

test("a phone screen draws within budget", () => {
  const w = 360, h = 740, s = 1.25, W = Math.round(w * s), H = Math.round(h * s);
  const rs = [];
  for (let i = 0; i < 12; i++) rs.push({ x: 10 + (i % 4) * 85, y: 14 + Math.floor(i / 4) * 96, w: 80, h: 90, k: "tile" });
  const t0 = Date.now();
  const f = L.field(rs, w, h, 11);
  L.paint({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }, f, L.palette("islands", "#d4af37", "dark"), s, 11);
  assert.ok(Date.now() - t0 < 1500, "took " + (Date.now() - t0) + " ms");
});

test("shell: canonical wpland", () => {
  const canon = new Function("var WP_LAND_STYLES = " + JSON.stringify(L.STYLES) + ";\n" + cut(SHELL, "wplandCanon") + "\nreturn wplandCanon;")();
  assert.deepEqual(canon({}), { style: "islands", seed: 1, motion: 0 });
  assert.deepEqual(canon({ motion: true, seed: 5.7, style: "hills" }), { style: "hills", seed: 5, motion: 1 });
  assert.deepEqual(canon({ style: "lava", seed: -3 }), { style: "islands", seed: 1, motion: 0 });
  assert.deepEqual(Object.keys(canon({ seed: 9 })), ["style", "seed", "motion"], "fixed key order");
  assert.equal(canon(null), null);
  assert.equal(canon([1]), null);
  assert.equal(canon("x"), null);
});

test("shell: land is a wallpaper, travels in the shell slice, pauses under apps", () => {
  assert.match(SHELL, /\{ id: "land",\s+css: "" \}/);
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"wpland"[^\]]*\];/);
  assert.match(SHELL, /var WP_LAND_STYLES = \["islands", "hills", "garden"\];/);
  assert.deepEqual(L.STYLES, ["islands", "hills", "garden"], "shell and land.js know the same styles");
  assert.match(cut(SHELL, "shellBuild"), /wpland:\s+vals\.wpland/);
  assert.match(cut(SHELL, "shellSliceSet"), /wpLandWrite\(state\.wpland\)/);
  assert.match(cut(SHELL, "applyWallpaper"), /w\.id === "land"/);
  assert.match(cut(SHELL, "wpLandApply"), /paused: function \(\) \{ return !!state\.running \|\| document\.hidden; \}/);
  assert.match(cut(SHELL, "returnToDesktop"), /wpLandRefresh\(\)/);
  assert.match(cut(SHELL, "settingsSet"), /case "wpland:new":/);
  assert.match(cut(SHELL, "settingsSet"), /case "wpland:style":/);
  assert.match(cut(SHELL, "settingsSet"), /case "wpland:motion":/);
});

test("land.js ships in the late bundle and is precached", () => {
  const idx = read("index.html");
  const late = idx.match(/<template data-oros-late>[\s\S]*?<\/template>/g).join("\n");
  assert.match(late, /<script src="wallpaper\/land\.js\?v=[^"]+"><\/script>/);
  assert.match(read("sw.js"), /"wallpaper\/land\.js"/);
  assert.match(read("style.css"), /html\[data-oros-contrast="high"\] #wp-land/);
});

test("strings in EN, EL and DE; help in all three", () => {
  const tr = read("translations.js");
  assert.equal((tr.match(/"wp\.name\.land":/g) || []).length, 2);
  assert.match(read("i18n/de/shell.js"), /"wp\.name\.land":/);
  const sc = read("settings/core.js");
  assert.equal((sc.match(/"a\.wallpaper\.land\.new":/g) || []).length, 2);
  assert.equal((sc.match(/"a\.wallpaper\.land\.hint":/g) || []).length, 2);
  const sde = read("i18n/de/settings.js");
  assert.match(sde, /"a\.wallpaper\.land\.new":/);
  assert.match(sde, /"a\.wallpaper\.land\.hint":/);
  for (const k of ["style", "islands", "hills", "garden", "motion", "motion.hint"]) {
    assert.equal((sc.match(new RegExp('"a\\.wallpaper\\.land\\.' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(sde, new RegExp('"a\\.wallpaper\\.land\\.' + k.replace(".", "\\.") + '":'), k + " DE");
  }
  assert.match(read("help/topics/appearance.en.txt"), /### Living land/);
  assert.match(read("help/topics/appearance.el.txt"), /### Ζωντανό τοπίο/);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /### Lebendige Landschaft/);
});
