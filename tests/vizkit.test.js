// MU-VIZ: the light show (vizkit.js, shared by the sound apps) and its
// wiring in Music (music/host.js sound tap, music/music.js full player).
// The pure part runs here; the browser run lives in the project's
// music/tools/e2e-viz.js.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const V = require(path.join(ROOT, "vizkit.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("styles: four, an unknown one falls back, next cycles", () => {
  assert.deepStrictEqual(V.STYLES, ["glow", "rings", "bars", "wave"]);
  assert.strictEqual(V.normStyle("disco"), "glow");
  assert.strictEqual(V.nextStyle("glow"), "rings");
  assert.strictEqual(V.nextStyle("wave"), "glow");
});

test("labels: EN, EL, DE with the same keys; unknown language = English", () => {
  const keys = Object.keys(V.STR.en).sort();
  assert.deepStrictEqual(Object.keys(V.STR.el).sort(), keys);
  assert.deepStrictEqual(Object.keys(V.STR.de).sort(), keys);
  assert.strictEqual(V.label("style", "el", { s: V.label("rings", "el") }), "Φως: Κύκλοι");
  assert.strictEqual(V.label("btn", "fr"), "Light show");
  assert.strictEqual(V.label("glow", "de-AT"), "Leuchten");
});

test("bands: bass, mids and highs from byte bins", () => {
  const f = new Uint8Array(512);              // 48 kHz: 46.9 Hz a bin
  for (let i = 0; i < 5; i++) f[i] = 255;    // 0..234 Hz
  const b = V.bands(f, 48000);
  assert.ok(b.lo > 0.7 && b.mid === 0 && b.hi === 0, JSON.stringify(b));
  assert.deepStrictEqual(V.bands(null), { lo: 0, mid: 0, hi: 0, all: 0 });
});

test("smooth: quick up, slow down; gain lifts a quiet song, keeps 0..1", () => {
  assert.ok(Math.abs(V.smooth(0, 1) - 0.35) < 1e-9);
  assert.ok(Math.abs(V.smooth(1, 0) - 0.92) < 1e-9);
  const g = V.gain(0, 0.2);
  assert.strictEqual(g.v, 1);
  assert.ok(V.gain(1, 0.5).v <= 1 && V.gain(1, 0.5).v > 0.4);
  assert.strictEqual(V.gain(0, 0).v, 0);
});

test("still: reduced motion, low battery not charging, slow device", () => {
  assert.strictEqual(V.stillReason({ reduced: true }), "reduced");
  assert.strictEqual(V.stillReason({ battery: { level: 0.15, charging: false } }), "battery");
  assert.strictEqual(V.stillReason({ battery: { level: 0.15, charging: true } }), "");
  assert.strictEqual(V.stillReason({ slow: true }), "slow");
  assert.strictEqual(V.stillReason({}), "");
  assert.strictEqual(V.isSlow(new Array(89).fill(100)), false);
  assert.strictEqual(V.isSlow(new Array(90).fill(60)), true);
  assert.strictEqual(V.isSlow(new Array(90).fill(17)), false);
});

test("canvas size: dpr at most 1.25, at most 1.8 M pixels", () => {
  assert.deepStrictEqual(V.fit(400, 800, 3), { w: 500, h: 1000, r: 1.25 });
  const big = V.fit(2560, 1440, 2);
  assert.ok(big.w * big.h <= 1.8e6 + 4000, JSON.stringify(big));
});

test("palette: three glowing colours from the accent, any format", () => {
  const p = V.palette("#d4af37");
  assert.strictEqual(p.length, 3);
  p.forEach((c) => { assert.ok(c[1] >= 55 && c[2] >= 55 && c[2] <= 70, JSON.stringify(c)); });
  assert.deepStrictEqual(V.rgb("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.deepStrictEqual(V.rgb("#abc"), [170, 187, 204]);
  assert.strictEqual(V.palette("not a colour").length, 3);
});

test("bars: log scale, 0..1, empty input gives zeros", () => {
  const f = new Uint8Array(512).fill(128);
  const b = V.bars(f, 28, 48000);
  assert.strictEqual(b.length, 28);
  b.forEach((x) => assert.ok(x >= 0 && x <= 1));
  assert.deepStrictEqual(V.bars(null, 3), [0, 0, 0]);
});

test("idle light never goes dark and stays soft", () => {
  for (let t = 0; t < 60000; t += 777) {
    const l = V.idle(t);
    ["lo", "mid", "hi"].forEach((k) => assert.ok(l[k] > 0.05 && l[k] < 0.5, k + " " + l[k]));
  }
});

test("kit rules in the source: 30 fps, hidden tab, no flashes", () => {
  const s = read("vizkit.js");
  assert.match(s, /var FPS_GAP = 1000 \/ 30;/);
  assert.match(s, /if \(doc && doc\.hidden\) return;/);
  assert.match(s, /Math\.min\(0\.85, a\)/);            // brightest layer under 0.85 alpha
  assert.match(s, /prefers-reduced-motion: reduce/);
  assert.match(s, /getBattery/);
});

test("Music host: the tap is an analyser after the equalizer, never connected onwards", () => {
  const s = read("music/host.js");
  assert.match(s, /master\.connect\(viz\.an\);/);
  assert.doesNotMatch(s, /viz\.an\.connect\(/);
  // routed only for same-origin decks, only while the context runs
  assert.match(s, /function vizRoute\(el\) \{\n    if \(el\._node \|\| !el\._same \|\| !vizNode\(\)\) return;\n    if \(ctx\.state === "running"\) \{ route\(el\); return; \}/);
  assert.match(s, /else if \(viz\.on && el\._same\) vizRoute\(el\);/);
  assert.match(s, /viz: function \(on\) \{ return vizSet\(on\); \},\n    vizFrame: vizFrame,/);
});

test("Music app: button, device-local prefs, kit loaded on first use, host off on close", () => {
  const s = read("music/music.js");
  assert.match(s, /viz: \{ on: false, st: "glow" \}/);
  assert.match(s, /s\.src = "\.\.\/vizkit\.js" \+ q;/);
  assert.match(s, /dlg\.addEventListener\("close", function \(\) \{ vzStop\(\); dlg\.remove\(\); \}\);/);
  assert.match(s, /H\.viz\(false\)/);
  assert.match(s, /fp-viz-btn/);
  const css = read("music/music.css");
  assert.match(css, /\.full-dlg\.viz-on \.fp-viz \{ display: block; \}/);
});

test("help: Light show section in EN, EL, DE", () => {
  assert.match(read("music/help.en.txt"), /^## Light show$/m);
  assert.match(read("music/help.el.txt"), /^## Φωτορυθμικό$/m);
  assert.match(read("i18n/de/help/music.txt"), /^## Lichtshow$/m);
});
