// SC (Chris 2026-11-28 «Ναι σε όλα, σύμφωνα με το πλάνο σου»): Smart
// select (SlimSAM) and Colourize (DDColor tiny) on the device, in Photo
// Lab and Atelier. The pure steps of atelier/smartai.js, the models'
// mirror entries, and the wiring in both apps and the Assistant.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SA = require("../atelier/smartai.js");
const PCMD = require("../photolab/commands.js");
const ACMD = require("../atelier/commands.js");

test("the models come from our mirror, SHA-256 pinned, parts under 95 MB", () => {
  ["samEnc", "samDec", "color"].forEach((k) => {
    const m = SA.MODELS[k];
    assert.match(m.sha, /^[0-9a-f]{64}$/, k);
    assert.ok(m.parts.length >= 1);
    m.parts.forEach((p) => {
      assert.ok(p.url.startsWith("https://koulaxizis.github.io/oros-models-vision/"), p.url);
      assert.ok(p.size > 0 && p.size <= 95000000, p.url);
    });
  });
  assert.deepEqual(SA.MODELS.color.parts.map((p) => p.url.slice(-7)), [".part00", ".part01"]);
  const keys = Object.keys(SA.MODELS).map((k) => SA.MODELS[k].key);
  assert.equal(new Set(keys).size, keys.length);
});

test("samSize fits the long side into 1024; samPoints maps clicks into it", () => {
  assert.deepEqual(SA.samSize(2048, 1024), { w: 1024, h: 512, k: 0.5 });
  const s = SA.samSize(915, 1210);
  assert.equal(s.h, 1024); assert.equal(s.w, Math.round(915 * 1024 / 1210));
  const p = SA.samPoints([{ x: 10, y: 20 }, { x: 0, y: 0, add: false }], 2);
  assert.deepEqual(Array.from(p.xy), [21, 41, 1, 1]);
  assert.deepEqual(p.labels, [1, 0]);
});

test("samPrep normalises like SamProcessor and pads with zero", () => {
  const rgba = new Uint8ClampedArray([255, 0, 128, 255]);
  const t = SA.samPrep(rgba, 1, 1), plane = 1024 * 1024;
  assert.equal(t.length, 3 * plane);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(t[plane] - (0 - 0.456) / 0.224) < 1e-5);
  assert.ok(Math.abs(t[2 * plane] - (128 / 255 - 0.406) / 0.225) < 1e-5);
  assert.equal(t[1], 0); assert.equal(t[1024], 0);
});

test("bestMask: the whole object unless it scores far below; part picks among the parts", () => {
  assert.equal(SA.bestMask([0.9, 0.95, 0.8], 3), 0);
  assert.equal(SA.bestMask([0.6, 0.95, 0.8], 3), 1);
  assert.equal(SA.bestMask([0.99, 0.7, 0.8], 3, true), 2);
  assert.equal(SA.bestMask([0.5], 1, true), 0);
});

test("samAlpha turns logits into alpha with a soft edge", () => {
  const G = SA.SAM_GRID, l = new Float32Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) l[y * G + x] = x < G / 2 ? 10 : -10;
  const a = SA.samAlpha(l, 0, 1024, 1024, 8, 2, 1);
  assert.equal(a[0], 255); assert.equal(a[7], 0); assert.equal(a[8], 255);
  const z = SA.samAlpha(new Float32Array(G * G), 0, 1024, 1024, 2, 2, 1);
  assert.deepEqual(Array.from(z), [128, 128, 128, 128]);
});

test("fingerprint changes with the picture", () => {
  const a = new Uint8ClampedArray(64), b = new Uint8ClampedArray(64); b[0] = 1;
  assert.equal(SA.fingerprint(a, 4, 4), SA.fingerprint(new Uint8ClampedArray(64), 4, 4));
  assert.notEqual(SA.fingerprint(a, 4, 4), SA.fingerprint(b, 4, 4));
  assert.notEqual(SA.fingerprint(a, 4, 4), SA.fingerprint(a, 8, 2));
});

test("Lab round trip as OpenCV's float Lab", () => {
  const w = SA.lab(255, 255, 255);
  assert.ok(Math.abs(w[0] - 100) < 0.01 && Math.abs(w[1]) < 0.01 && Math.abs(w[2]) < 0.01);
  const r = SA.lab(255, 0, 0);
  assert.ok(Math.abs(r[0] - 53.24) < 0.1 && Math.abs(r[1] - 80.09) < 0.2 && Math.abs(r[2] - 67.2) < 0.2, r.join());
  const out = [0, 0, 0];
  [[12, 200, 90], [250, 120, 3], [40, 40, 41], [0, 0, 0]].forEach((c) => {
    const L = SA.lab(c[0], c[1], c[2]);
    SA.labToRgb(L[0], L[1], L[2], out, 0);
    c.forEach((v, i) => assert.ok(Math.abs(out[i] - v) <= 1, c + " → " + out));
  });
  assert.ok(Math.abs(SA.lightness(255, 0, 0) - r[0]) < 1e-6);
});

test("colorPrep gives the grey of the lightness; colorApply keeps L* and alpha", () => {
  const rgba = new Uint8ClampedArray([200, 30, 30, 255, 30, 200, 30, 255, 30, 30, 200, 255, 120, 120, 120, 255]);
  const t = SA.colorPrep(rgba, 2);
  for (let i = 0; i < 4; i++) { assert.equal(t[i], t[4 + i]); assert.equal(t[i], t[8 + i]); }
  const grey = new Uint8ClampedArray([128, 128, 128, 77]);
  const ab = new Float32Array([30, 30, 30, 30, 20, 20, 20, 20]);
  const out = SA.colorApply(grey.slice(), 1, 1, ab, 2, 1);
  assert.equal(out[3], 77);
  const L = SA.lab(out[0], out[1], out[2]);
  assert.ok(Math.abs(L[0] - SA.lightness(128, 128, 128)) < 1, L.join());
  assert.ok(L[1] > 20 && L[2] > 12, L.join());
  assert.deepEqual(Array.from(SA.colorApply(grey.slice(), 1, 1, ab, 2, 0)), [128, 128, 128, 77]);
});

test("Photo Lab and Atelier check the new commands", () => {
  assert.ok(PCMD.check([{ op: "smartselect", x: 100, y: 200 }]).ok);
  assert.ok(PCMD.check([{ op: "smartselect", x: 1, y: 2, to: "sel", only: true }]).ok);
  assert.match(PCMD.check([{ op: "smartselect", x: 1 }]).err, /y is missing/);
  assert.match(PCMD.check([{ op: "smartselect", x: 1, y: 1, to: "file" }]).err, /to "file" is not allowed/);
  assert.ok(PCMD.check([{ op: "colorize", amt: 120, fast: true }]).ok);
  assert.ok(PCMD.check([{ op: "colorize", amt: 151 }]).err);
  assert.ok(ACMD.check([{ op: "colorize", amt: 80 }]).ok);
  assert.ok(ACMD.check([{ op: "colorize", amt: -1 }]).err);
});

test("the wiring: tool, menus, Assistant runners, lazy scripts", () => {
  const tools = read("photolab/tools.js"), panels = read("photolab/panels.js"), ai = read("photolab/aiedit.js");
  assert.match(tools, /"quick", "smart"/);
  assert.match(panels, /selSmart/); assert.match(panels, /fColorize/);
  assert.match(ai, /smartselect: smartselect, colorize: colorize/);
  assert.match(read("atelier/assist.js"), /st\.op === "colorize"/);
  assert.match(read("atelier/ai.js"), /smartpick\.js/);
  ["photolab/smart.js", "atelier/smartai.js", "atelier/smartpick.js"].forEach((f) => {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(!read("index.html").includes(f), f + " loads on demand");
  });
  assert.match(read("CREDITS.md"), /SlimSAM/); assert.match(read("CREDITS.md"), /DDColor/);
  assert.match(read("shell.js"), /cr\.slimsam/); assert.match(read("shell.js"), /cr\.ddcolor/);
});

test("strings: every sc. and sp. key in English, Greek and German", () => {
  global.window = global.window || {};
  const pl = read("photolab/strings.js"), de = read("i18n/de/photolab.js");
  const keys = Array.from(new Set(pl.match(/"sc\.[A-Za-z]+"/g)));
  assert.ok(keys.length >= 20);
  keys.forEach((k) => {
    assert.equal(pl.split(k + ":").length - 1, 2, k + " en+el");
    assert.ok(de.includes(k + ":"), k + " de");
  });
  const sp = read("atelier/smartpick.js"), ade = read("i18n/de/atelier.js");
  const spk = Array.from(new Set(sp.match(/"sp\.[A-Za-z]+"(?=:)/g)));
  assert.ok(spk.length >= 10);
  spk.forEach((k) => assert.ok(ade.includes(k + ":"), k + " de"));
  ["ed.op.smartselect", "ed.op.colorize", "ed.f.only", "ed.note.aiNoObject", "ed.note.aiNoSmart"].forEach((k) => {
    assert.equal(read("assistant/assistant.js").split('"' + k + '"').length - 1, 2, k);
    assert.ok(read("i18n/de/assistant.js").includes('"' + k + '"'), k + " de");
  });
});
