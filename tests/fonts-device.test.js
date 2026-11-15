// orOS Settings › Fonts: this device's fonts (FM-3). designkit/fonts.js
// 1.3.0 ttcFace() (one face of a .ttc collection, as device fonts come)
// and the Settings wiring: Local Font Access only on request, a copy
// only after a second press, strings in every language.
// Fixture: tests/fixtures/fonts/pair.ttc (make.py: Noto Serif subset + a renamed Apache twin).
// Run: node --test tests/fonts-device.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "designkit/fonts.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
function ab(p) { const b = fs.readFileSync(path.join(ROOT, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
const TTC = ab("tests/fixtures/fonts/pair.ttc");

test("ttcFace: picks the face by PostScript name, the first without one", () => {
  const a = F.ttcFace(TTC, ""), b = F.ttcFace(TTC, "OrosTwin-Regular");
  assert.equal(F.info(a).family, "Noto Serif");
  assert.equal(F.info(b).family, "Oros Twin");
  assert.equal(F.licence(a).kind, "ofl");
  assert.equal(F.licence(b).kind, "apache");
  // a whole, checked font: coverage, inspect and the import check all read it
  assert.equal(F.check(a).ok, true);
  assert.equal(F.coverage(a).greek.have, F.coverage(ab("tests/fixtures/fonts/noto-serif-sub.ttf")).greek.have);
  // head.checkSumAdjustment makes the whole file sum to 0xB1B0AFBA
  const u8 = new Uint8Array(a); let sum = 0;
  for (let i = 0; i < u8.length; i += 4) sum = (sum + (((u8[i] << 24) | ((u8[i + 1] || 0) << 16) | ((u8[i + 2] || 0) << 8) | (u8[i + 3] || 0)) >>> 0)) >>> 0;
  assert.equal(sum, 0xB1B0AFBA);
});

test("ttcFace: a plain font comes back as it is; an unknown name or a damaged file gives null", () => {
  const ttf = ab("tests/fixtures/fonts/noto-serif-sub.ttf");
  assert.equal(F.ttcFace(ttf, "Anything"), ttf);
  assert.equal(F.ttcFace(TTC, "NoSuchFace"), null);
  const cut = TTC.slice(0, 40);
  assert.equal(F.ttcFace(cut, ""), null);
  const bad = TTC.slice(0); new DataView(bad).setUint32(8, 9999);
  assert.equal(F.ttcFace(bad, ""), null);
  const tiny = new ArrayBuffer(4);
  assert.equal(F.ttcFace(tiny, ""), tiny, "too short to be a collection: as it is");
});

test("settings: this device's fonts only on request, a copy only after a second press", () => {
  const page = read("settings/fonts.js");
  assert.match(page, /var HAS_LOCAL = typeof window\.queryLocalFonts === "function"/);
  assert.match(page, /if \(x\[0\] === "dev" && !HAS_LOCAL\) return;/, "no tab where the browser has no Local Font Access");
  // queryLocalFonts is called from the button only
  const calls = page.match(/queryLocalFonts\(\)/g) || [];
  assert.equal(calls.length, 1);
  assert.match(page, /btn\(t\("fm\.dev\.show"\), "btn primary", loadDev\)/);
  assert.match(page, /if \(!S\.armed\) \{ S\.armed = true; draw\(\); return; \}\s+S\.armed = false;\s+b\.disabled = true;\s+copyDev\(f\);/);
  assert.match(page, /lic\.embed === "restricted"\) \{ c\.appendChild\(el\("div", "msg msg-err", t\("fm\.dev\.noCopy"\)\)\); return; \}/);
  assert.match(page, /DK\.ttcFace\(ab, fd\.postscriptName \|\| ""\)/);
  assert.match(page, /DK\.importFile\(blob, \{ cff: true \}\)/, "the same checks as any added file");
  assert.ok(!/innerHTML/.test(page));
  assert.match(read("solo.js"), /screen-wake-lock; local-fonts"/);
  const de = read("i18n/de/settings.js");
  for (const k of ["fm.tab.dev", "fm.dev.intro", "fm.dev.show", "fm.dev.ask", "fm.dev.denied", "fm.dev.copy", "fm.dev.copySure", "fm.dev.copyWarn", "fm.dev.noCopy", "fm.dev.copied", "fm.dev.copyFail", "fm.dev.readFail"]) {
    assert.ok(page.split('"' + k + '":').length - 1 === 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
});
