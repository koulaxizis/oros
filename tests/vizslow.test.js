// VIZ-SLOW (Chris 2026-11-23, Android: the Light show wallpaper and the
// weather desktop stood still while music played). A busy start of the
// page made both decide "slow device" for the whole session. Now:
// start-up frames never count, a few stalls do not count (median),
// a slow device first gets a lighter light, then rests 1, 2, 4 ... 10
// minutes and tries again, and Settings says why it is still.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const V = require(path.join(ROOT, "vizkit.js"));
const W = require(path.join(ROOT, "wallpaper/wxdesk.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("vizkit 1.3.0+: slow is the median frame gap, stalls alone do not count", () => {
  assert.ok(V.v >= "1.3.0");
  assert.equal(V.isSlow(new Array(90).fill(60)), true);
  assert.equal(V.isSlow(new Array(90).fill(17)), false);
  assert.equal(V.isSlow(new Array(89).fill(200)), false);
  // 40 long stalls (sync, an app loading) among smooth frames: not slow
  const mixed = new Array(50).fill(17).concat(new Array(40).fill(500));
  assert.equal(V.isSlow(mixed), false);
  // most frames late: slow
  const late = new Array(30).fill(17).concat(new Array(60).fill(80));
  assert.equal(V.isSlow(late), true);
});

test("vizkit + wxdesk: a slow device rests 1, 2, 4, 8, 10 minutes, never for good", () => {
  for (const f of [V.slowWait, W.slowWait]) {
    assert.deepEqual([1, 2, 3, 4, 5, 9].map(f), [60000, 120000, 240000, 480000, 600000, 600000]);
  }
  assert.equal(V.BOOT_MS, 20000);
  const src = read("vizkit.js");
  assert.doesNotMatch(src, /slowSeen/, "no session-long slow flag");
  assert.match(src, /t > BOOT_MS/, "start-up frames never count");
  assert.match(src, /slow\.lite \? 1 : win\.devicePixelRatio/, "the lighter light renders at dpr 1");
  assert.match(src, /slow\.lite \? 2 \* FPS_GAP : FPS_GAP/, "the lighter light runs at 15 fps");
  const wx = read("wallpaper/wxdesk.js");
  assert.match(wx, /var VER = "1\.1\.0";/);
  assert.match(wx, /if \(ts > BOOT_MS\)/);
  assert.doesNotMatch(wx, /slow = true/, "no session-long slow flag");
});

test("wxdesk 1.1.0: Energy saver is its own still reason", () => {
  assert.equal(W.stillReason({ saver: true, battery: true }), "saver");
  assert.equal(W.stillReason({ reduced: true, saver: true }), "reduced");
  assert.equal(W.stillReason({ battery: true }), "battery");
});

test("Settings › Wallpaper says why the Light show or the weather is still", () => {
  const sh = read("shell.js");
  assert.match(sh, /still: wpVizStill\(\)/, "the settings snapshot carries the reason");
  assert.match(sh, /onState: function \(\) \{ settingsNotify\(\); \}/);
  const st = read("settings/settings.js");
  assert.match(st, /var WP_STILL = \["reduced", "saver", "battery", "slow"\];/);
  assert.match(st, /t\("a\.wallpaper\.still\." \+ s\.viz\.still\)/);
  assert.match(st, /t\("a\.wallpaper\.still\." \+ s\.wxdesk\.still\)/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  for (const r of ["reduced", "saver", "battery", "slow"]) {
    const k = '"a.wallpaper.still.' + r + '"';
    assert.equal(core.split(k).length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes(k), k + " in DE");
  }
});
