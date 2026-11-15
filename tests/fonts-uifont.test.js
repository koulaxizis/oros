// orOS: the font of orOS itself (FM-5). uifont.js adds the chosen
// family to a page as FontFaces named "Nunito" at Nunito's own weights
// (a later face with the same weight wins over fonts.css), with each
// file's unicode-range so Nunito keeps the letters it lacks; a family
// without bold gives its regular face the bold weights too. The shell
// keeps the choice on this device (oros-uifont) and applies it to every
// app page as it loads; Settings sets it from a font's page and shows
// it under Accessibility.
// Fixtures: tests/fixtures/fonts/noto-serif-sub.ttf, noto-serif-sub-apache.ttf.
// Run: node --test tests/fonts-uifont.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const T = require(path.join(ROOT, "designkit/text.js"));
const F = require(path.join(ROOT, "designkit/fonts.js"));
const R = "a".repeat(64) + ".ttf", B = "b".repeat(64) + ".ttf";
function ab(p) { const b = fs.readFileSync(path.join(ROOT, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
const FILES = { ["asset:" + R]: ab("tests/fixtures/fonts/noto-serif-sub.ttf"), ["asset:" + B]: ab("tests/fixtures/fonts/noto-serif-sub-apache.ttf") };

function boot() {
  const fakeF = Object.assign({}, F, { fetcher: (u) => Promise.resolve(FILES[u] ? FILES[u].slice(0) : null) });
  const W = { orosDK: { text: T, fonts: fakeF } };
  vm.runInNewContext(read("uifont.js"), { window: W });
  return W.orosUiFont;
}
function page() {
  const set = new Set();
  function FontFace(family, buf, desc) { this.family = family; this.size = buf.byteLength; Object.assign(this, desc); }
  FontFace.prototype.load = function () { return Promise.resolve(this); };
  const d = { fonts: { add: (f) => set.add(f), delete: (f) => set.delete(f) } };
  d.defaultView = { FontFace };
  return { d, faces: () => [...set] };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test("one regular file: Nunito at every weight, with the file's letters only", async () => {
  const U = boot(), p = page();
  assert.equal(await U.set({ id: "uf_" + "a".repeat(16), name: "Noto Serif", fb: "serif", r: R }, [p.d]), true);
  await tick();
  const f = p.faces();
  assert.deepEqual(f.map((x) => x.weight).sort(), ["300", "400", "500", "600", "700", "800", "900"]);
  assert.ok(f.every((x) => x.family === "Nunito" && x.style === "normal"));
  assert.match(f[0].unicodeRange, /U\+41-42/i);         // A B: the subset's own letters
  assert.match(f[0].unicodeRange, /U\+3ac-3b3/i);       // ά … γ
  assert.doesNotMatch(f[0].unicodeRange, /U\+0-10ffff/i);
});

test("a bold file of its own takes the bold weights; null brings Nunito back", async () => {
  const U = boot(), p = page();
  await U.set({ id: "uf_" + "c".repeat(16), name: "Pair", fb: "serif", r: R, b: B }, [p.d]);
  await tick();
  const by = {};
  p.faces().forEach((x) => { by[x.weight] = x.size; });
  assert.equal(by["400"], FILES["asset:" + R].byteLength);
  assert.equal(by["700"], FILES["asset:" + B].byteLength);
  assert.equal(U.current().name, "Pair");
  await U.set(null, [p.d]);
  assert.equal(p.faces().length, 0);
  assert.equal(U.current(), null);
});

test("a page that loads later gets the faces; a missing file adds nothing", async () => {
  const U = boot(), p = page(), q = page();
  await U.set({ id: "uf_" + "d".repeat(16), name: "Late", fb: "sans", r: R }, [p.d]);
  U.frame(q.d);
  await tick();
  assert.equal(q.faces().length, 7);
  U.frame(q.d);                                          // twice: still one set
  await tick();
  assert.equal(q.faces().length, 7);
  const V = boot(), z = page();
  assert.equal(await V.set({ id: "uf_" + "e".repeat(16), name: "Gone", fb: "sans", r: "f".repeat(64) + ".ttf" }, [z.d]), false);
  await tick();
  assert.equal(z.faces().length, 0);
});

test("shell.js: this device only, checked, applied at boot and to every app page", () => {
  const s = read("shell.js");
  assert.match(s, /var UIF_KEY = "oros-uifont";/);
  assert.match(s, /\^\(fs_\[a-z0-9_\]\{1,60\}\|uf_\[0-9a-f\]\{16\}\)\$/);
  assert.match(s, /case "uiFont":\s+uifSetUser\(value\); return;/);
  assert.match(s, /a11yMark\(d\);\s+if \(window\.orosUiFont\) window\.orosUiFont\.frame\(d\);/);
  assert.match(s, /a11yWatch\(\);\s+uifApply\(\);/);
  assert.match(s, /font: uifGet\(\)/);
  // only when one is set: no script tag for it
  assert.doesNotMatch(read("index.html"), /uifont\.js/);
});

test("Settings: a font's page and Accessibility, strings in every language", () => {
  const fjs = read("settings/fonts.js"), sjs = read("settings/settings.js"), core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(fjs, /function uiCard\(entry, noGreek\)/);
  assert.match(sjs, /set\("uiFont", null\)/);
  assert.match(sjs, /function fontsCtx\(\)/);
  ["fm.ui", "fm.ui.use", "fm.ui.on", "fm.ui.back", "fm.ui.hint", "fm.ui.noGreek"].forEach((k) => {
    assert.equal(fjs.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " DE");
  });
  ["ac.font", "ac.font.back", "ac.font.choose", "ac.font.hint", "ac.font.nunito", "w.uifont"].forEach((k) => {
    assert.equal(core.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " DE");
  });
  assert.match(core, /\["uifont", "accessibility", "ac\.font"\]/);
});
