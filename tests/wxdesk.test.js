// Weather on the desktop (wallpaper/wxdesk.js, WX-DESK-1) and its wiring.
// Run: node --test tests/
//
// wxdesk.js is required as is (it exports its API for Node); the
// shell, Settings, strings, help and bundle are wiring checks.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = require(path.join(ROOT, "wallpaper/wxdesk.js"));

test("kindOf maps every WMO group, day and night", () => {
  assert.equal(W.kindOf(0, false), "sun");
  assert.equal(W.kindOf(0, true), "stars");
  assert.equal(W.kindOf(1, false), "part");
  assert.equal(W.kindOf(2, true), "part");
  assert.equal(W.kindOf(3), "cloud");
  assert.equal(W.kindOf(45), "fog");
  assert.equal(W.kindOf(48), "fog");
  for (const c of [51, 61, 67, 80, 82]) assert.equal(W.kindOf(c), "rain", String(c));
  for (const c of [71, 77, 85, 86]) assert.equal(W.kindOf(c), "snow", String(c));
  for (const c of [95, 96, 99]) assert.equal(W.kindOf(c), "storm", String(c));
  for (const c of [null, undefined, "", -1, NaN, "x"]) assert.equal(W.kindOf(c), "", String(c));
});

test("plan draws what each kind needs, scaled and clamped", () => {
  const big = W.plan("rain", 1280, 720), small = W.plan("rain", 360, 640);
  assert.ok(big.drops > small.drops && small.drops >= 50 && big.clouds > 0);
  assert.ok(W.plan("storm", 1280, 720).drops > big.drops);
  assert.ok(W.plan("storm", 1280, 720).dark > big.dark);
  assert.ok(W.plan("storm", 9000, 9000).drops <= 420);
  assert.equal(W.plan("sun", 1280, 720).sun, true);
  assert.ok(W.plan("stars", 1280, 720).stars > 0);
  assert.ok(W.plan("snow", 1280, 720).flakes > 0);
  assert.ok(W.plan("fog", 1280, 720).fog > 0);
  assert.equal(W.plan("", 1280, 720), null);
});

test("stillReason and freshness", () => {
  assert.equal(W.stillReason({}), "");
  assert.equal(W.stillReason({ reduced: true, battery: true }), "reduced");
  assert.equal(W.stillReason({ battery: true }), "battery");
  assert.equal(W.stillReason({ slow: true }), "slow");
  const now = Date.now();
  assert.equal(W.fresh({ code: 61, at: now - 60e3 }, now), true);
  assert.equal(W.fresh({ code: 0, at: now - 2.9 * 36e5 }, now), true);
  assert.equal(W.fresh({ code: 61, at: now - 3.1 * 36e5 }, now), false);
  assert.equal(W.fresh({ at: now }, now), false);
  assert.equal(W.fresh(null, now), false);
  assert.equal(W.isNight(22), true);
  assert.equal(W.isNight(5), true);
  assert.equal(W.isNight(12), false);
});

test("off by default, device-local, never a sync slice", () => {
  const src = read("wallpaper/wxdesk.js");
  assert.equal(W.KEY, "oros-wxdesk");
  assert.doesNotMatch(src, /registerSlice|markDirty/);
  assert.match(src, /localStorage\.getItem\(KEY\) === "on"/);
  assert.match(src, /ts - lastTs < 31/);                       // ≤ 30 fps
  assert.match(src, /devicePixelRatio \|\| 1\)/);
  assert.match(src, /pointer-events:none/);
  assert.match(src, /data-oros-contrast=\\"high\\"\] #wxd-layer\{display:none\}/);
  assert.doesNotMatch(src, /innerHTML/);
  assert.doesNotMatch(src, /https?:\/\/(?!claude)/);
});

test("shell, bundle and Settings wiring", () => {
  const shell = read("shell.js"), idx = read("index.html"), sw = read("sw.js");
  const late = idx.match(/<template data-oros-late>[\s\S]*?<\/template>/)[0];
  assert.match(late, /<script src="wallpaper\/wxdesk\.js\?v=/);
  assert.match(sw, /"wallpaper\/wxdesk\.js"/);
  assert.match(shell, /window\.orosWxDesk\.attach\(\{[\s\S]{0,200}weather: function \(\) \{ return wxCacheFor\(wxLoc\(\)\); \}/);
  assert.equal((shell.match(/window\.orosWxDesk\.refresh\(\)/g) || []).length, 2);
  assert.match(shell, /case "wxdesk:on":/);
  assert.match(shell, /wxdesk: \(!SOLO && window\.orosWxDesk\) \? window\.orosWxDesk\.snapshot\(\) : null/);
  const st = read("settings/settings.js");
  assert.match(st, /switchBtn\(!!s\.wxdesk\.on, "wxdesk:on"/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  for (const k of ["a.wallpaper.wx", "a.wallpaper.wx.hint", "a.wallpaper.wx.none"]) {
    assert.equal(core.split('"' + k + '":').length - 1, 2, k + " EN+EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
});

test("help EN/EL/DE", () => {
  assert.match(read("help/topics/appearance.en.txt"), /`Weather on the desktop`/);
  assert.match(read("help/topics/appearance.el.txt"), /`Καιρός στην επιφάνεια εργασίας`/);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /`Wetter auf dem Desktop`/);
});
