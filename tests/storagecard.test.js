// Storage bar card (STORE-1, video ideas 2026-11-23 #17): free space in
// the smart top bar: the disk orOS's data is on where the orOS USB /
// Portable host reports it (data-oros-sys-disk), else the browser's
// estimate; the warning colour under 10 %.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "smartbar.js"));
const A = require(path.join(ROOT, "smartbar-apps.js"));

test("a known kind from smartbar-apps.js", () => {
  assert.ok(M.KINDS.includes("storage") && A.KINDS.includes("storage") && A.OWN.storage);
});

test("the host's disk wins; else the browser's estimate; odd values give nothing", () => {
  assert.deepEqual(A.storageOf("183000000000 500000000000", { usage: 1, quota: 2 }),
    { free: 183e9, total: 500e9, pct: 36.6, low: false, host: true });
  assert.deepEqual(A.storageOf(null, { usage: 30e9, quota: 100e9 }), { free: 70e9, total: 100e9, pct: 70, low: false, host: false });
  assert.equal(A.storageOf("", { usage: 95e9, quota: 100e9 }).low, true, "under 10 %");
  assert.equal(A.storageOf("10 100").low, false, "10 % exactly is not low");
  assert.equal(A.storageOf("9 100").low, true);
  assert.equal(A.storageOf("", { usage: 120, quota: 100 }).free, 0);
  for (const bad of ["5 0", "-1 10", "11 10", "1e9 2e9", "1 2 3", "abc"]) assert.equal(A.storageOf(bad, null), null, bad);
  assert.equal(A.storageOf(null, { quota: 0, usage: 0 }), null);
  assert.equal(A.storageOf(null, null), null);
});

test("sizes in decimal units with the language's mark", () => {
  assert.equal(A.bytesOf(183e9, "en-GB"), "183 GB");
  assert.equal(A.bytesOf(7.44e9, "el-GR"), "7,4 GB");
  assert.equal(A.bytesOf(7.44e9, "de-DE"), "7,4 GB");
  assert.equal(A.bytesOf(512e6, "en-GB"), "512 MB");
  assert.equal(A.bytesOf(2.5e12, "en-GB"), "2.5 TB");
});

test("wiring: estimate at most every 10 minutes, the warning class, strings, help", () => {
  const SA = read("smartbar-apps.js");
  assert.match(SA, /Date\.now\(\) - estAt < 600000/);
  assert.match(SA, /getAttribute\("data-oros-sys-disk"\)/);
  assert.match(SA, /cls: s\.low \? "sb-soon" : ""/);
  assert.match(SA, /section: "system", item: "about-device"/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["sb.k.storage", "sb.storage.label", "sb.storage.low", "sb.storage.tip", "sb.storage.tip.disk"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  assert.match(read("help/topics/appearance.en.txt"), /- `Storage`: how much space is free/);
  assert.match(read("help/topics/appearance.el.txt"), /- `Αποθηκευτικός χώρος`:/);
});
