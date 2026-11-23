// Lock screen look (LOCKLOOK-1, video ideas 2026-11-23 #1): the person's
// own wallpaper blurred behind a big two-line clock, a greeting, the
// number of notifications and the battery; "Plain" keeps the old screen.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../lock.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const good = { v: 1, kind: "pin", salt: "c2FsdA==", hash: "aGFzaA==", i: 600000, idle: 10 };

test("look: Wallpaper by default, Plain only when chosen", () => {
  assert.equal(L.parseLook(undefined), "wall");
  assert.equal(L.parseLook("plain"), "plain");
  assert.equal(L.parseLook("other"), "wall");
  assert.equal(L.parseCfg(JSON.stringify(good)).look, "wall", "a lock from before gets the new look");
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({ look: "plain" }, good))).look, "plain");
  assert.deepEqual(L.LOOKS, ["wall", "plain"]);
});

test("look: no name and no count under Sensitive work or on a till; Plain adds nothing", () => {
  const wall = L.parseCfg(JSON.stringify(good));
  assert.deepEqual(L.lookShown(wall, "off", false), { wall: true, greet: true, name: true, nc: true, bat: true });
  assert.deepEqual(L.lookShown(wall, "on", false), { wall: true, greet: true, name: false, nc: false, bat: true });
  assert.deepEqual(L.lookShown(wall, "hard", false), { wall: true, greet: true, name: false, nc: false, bat: true });
  assert.deepEqual(L.lookShown(wall, "off", true), { wall: true, greet: true, name: false, nc: false, bat: true });
  const plain = L.parseCfg(JSON.stringify(Object.assign({ look: "plain" }, good)));
  assert.deepEqual(L.lookShown(plain, "off", false), { wall: false, greet: false, name: false, nc: false, bat: false });
  assert.deepEqual(L.lookShown(null, "off", false), { wall: false, greet: false, name: false, nc: false, bat: false });
});

test("look: the count joins W4's switches; the clamp keeps the look", () => {
  assert.deepEqual(L.withLook(null, { nc: true }), { ev: false, mu: false, nc: true });
  assert.deepEqual(L.withLook({ ev: true, mu: false, nc: false }, { nc: true }), { ev: true, mu: false, nc: true });
  assert.equal(L.withLook(null, { nc: false }), null);
  const on = { ev: true, mu: true, nc: false };
  assert.equal(L.withLook(on, null), on);
  const wall = L.parseCfg(JSON.stringify(good));
  assert.equal(L.clampCfg(wall, "on").look, "wall");
  assert.equal(L.greetPart(6), "morning");
  assert.equal(L.greetPart(13), "afternoon");
  assert.equal(L.greetPart(21), "evening");
  assert.equal(L.greetPart(3), "evening");
});

test("wiring: only the wallpaper is painted, the backdrop stays opaque, EN/EL/DE strings", () => {
  const lk = read("lock.js");
  assert.match(lk, /else if \(name === "look" && LOOKS\.indexOf\(value\) !== -1\) c\.look = value;/);
  assert.match(lk, /on = withLook\(on, lookShown\(cfg, strictLevel\(\), tillOn\(\)\)\);/);
  assert.match(lk, /var W = root\.__orosLockWall/);
  assert.match(lk, /look: parseLook\(prev \? prev\.look : null\)/, "a new PIN keeps the look");
  const sh = read("shell.js");
  const api = sh.slice(sh.indexOf("window.__orosLockWall = function"), sh.indexOf("// SB2: the Automations step"));
  assert.match(api, /getElementById\("oros-desktop"\)/);
  assert.ok(!/iframe|oros-app|innerHTML/.test(api), "never the apps");
  const css = read("style.css");
  assert.match(css, /dialog#oros-lock::backdrop \{ background: var\(--bg-desktop, var\(--bg\)\); \}/, "the backdrop stays opaque");
  assert.match(css, /#oros-lock\.lk-wall \.lk-bg \{[^}]*filter: blur\(28px\)/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["lock.look.bat", "lock.look.batCharging"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const sc = read("settings/core.js"), sd = read("i18n/de/settings.js");
  for (const k of ["l.look", "l.look.wall", "l.look.plain", "l.look.hint", "l.info.ncLook", "w.lock-look"]) {
    assert.equal(sc.split('"' + k + '":').length - 1, 2, k);
    assert.ok(sd.includes('"' + k + '":'), k + " DE");
  }
  assert.match(read("settings/settings.js"), /L\.option\("look", v\)/);
});
