// Game mode (GAMEMODE-1, video ideas 2026-11-23 #14): off by default,
// this device only. While a Games app runs full screen (or its window
// fills the screen), notifications stay silent and the top bar and the
// Dock step aside; the pointer at the top edge brings the bar back.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");
const SEC = SHELL.slice(SHELL.indexOf("// ---------- 5b-game. GAMEMODE-1"), SHELL.indexOf("// ---------- 5b-icon. MENUICON-1"));

function gameActive() {
  const i = SEC.indexOf("  function gameActive(");
  const src = SEC.slice(i, SEC.indexOf("\n  }\n", i) + 4);
  const ctx = {};
  vm.runInNewContext(src + "this.f = gameActive;", ctx);
  return ctx.f;
}

test("active only when on, a game is in front and the screen is filled", () => {
  const f = gameActive();
  const base = { on: true, game: true, fs: false, sw: 1920, sh: 1080, w: 1920, h: 1080 };
  assert.equal(f(base), true, "a window as large as the screen");
  assert.equal(f({ ...base, w: 1919, h: 1079 }), true, "a pixel of rounding");
  assert.equal(f({ ...base, w: 1600, h: 900 }), false, "a smaller window");
  assert.equal(f({ ...base, w: 1600, h: 900, fs: true }), true, "the Fullscreen API");
  assert.equal(f({ ...base, on: false }), false, "off by default");
  assert.equal(f({ ...base, game: false }), false, "not a game");
  assert.equal(f({ ...base, sw: 0, sh: 0 }), false, "no screen size");
  assert.equal(f(null), false);
});

test("wiring: device-only key, never in SOLO, notifications ask first", () => {
  assert.match(SEC, /var GAME_KEY = "oros-gamemode";/);
  assert.match(SEC, /app\.category === "Games"/);
  assert.match(SEC, /var on = !SOLO && gameActive\(/);
  assert.match(SEC, /window\.__orosGameQuiet = function/);
  assert.match(SHELL, /gamemode: SOLO \? null : \{ on: gameModeOn\(\), active: gameNow \}/);
  assert.match(SHELL, /case "gamemode":\s+if \(!SOLO\) \{ gameModeSet\(!!value\)/);
  const N = read("notifications.js");
  const q = N.indexOf("__orosGameQuiet()");
  assert.ok(q > 0 && q < N.indexOf("function quietFor") + 200, "quietFor asks game mode first");
});

test("the bar and the Dock step aside; the peek brings the bar back", () => {
  const css = read("style.css");
  assert.match(css, /html\[data-oros-game="1"\]:not\(\[data-oros-game-peek\]\) #oros-bar \{[^}]*display: none/);
  assert.match(css, /html\[data-oros-game="1"\] #ld-dock \{[^}]*display: none/);
});

test("Settings: a switch in Notifications, EN, EL and DE, found by search", () => {
  const S = read("settings/settings.js");
  assert.match(S, /function secGameMode\(host, g\)/);
  assert.match(S, /if \(s && s\.gamemode\) secGameMode\(host, s\.gamemode\)/);
  assert.match(S, /set\("gamemode", v\)/);
  const core = require(path.join(ROOT, "settings/core.js"));
  assert.equal(core.SCOPE.gamemode, "device");
  const de = read("i18n/de/settings.js");
  for (const k of ["gm.title", "gm.hint", "gm.on", "gm.now.on", "gm.now.off", "w.gamemode"]) {
    for (const L of ["en", "el"]) assert.notEqual(core.t(L, k), k, L + " " + k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
  assert.ok(core.findItem("gamemode"));
  assert.match(read("help/topics/notifications.en.txt"), /## Game mode/);
  assert.match(read("help/topics/notifications.el.txt"), /## Λειτουργία «Παιχνίδι»/);
});
